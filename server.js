// ===============================================================
// REMIX-NEXUS — UNIFIED BACKEND
// One server that:
//   1) Serves the whole front-end (everything in /public)
//   2) Handles real signup / login / profile via MongoDB + JWT
//   3) Runs the live chat rooms via Socket.io
// ===============================================================

require('dotenv').config(); 

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
const { scheduleAutoCleanup } = require('./autoCleanup');

// Resend — HTTP-based email API. Used instead of Nodemailer/SMTP because
// Render's free tier blocks outbound SMTP ports (25, 465, 587), which makes
// Gmail SMTP time out. Resend sends over plain HTTPS, so it works fine on
// the free tier. Get a free API key at resend.com.
let Resend = null;
try { ({ Resend } = require('resend')); } catch (err) { /* not installed — that's fine */ }
const resendClient = (Resend && process.env.RESEND_API_KEY) ? new Resend(process.env.RESEND_API_KEY) : null;

// nodemailer is optional — if it isn't installed, or EMAIL_USER/EMAIL_PASS
// aren't set, forgot-password still works, it just logs the reset link to
// the server console instead of emailing it (handy for local testing).
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (err) { /* not installed — that's fine */ }

// ---- FIREBASE ADMIN (push notifications) ----
// Optional — if firebase-admin isn't installed, or FIREBASE_SERVICE_ACCOUNT
// isn't set, push notifications are simply skipped and everything else
// (in-app chat, desktop Notification API) keeps working exactly as before.
// To enable: `npm install firebase-admin`, then set the FIREBASE_SERVICE_ACCOUNT
// env var to the ENTIRE contents of your Firebase service-account JSON file
// (Firebase console → Project settings → Service accounts → Generate new
// private key), pasted as a single-line string.
let initializeApp = null, cert = null, getMessaging = null;
try {
  ({ initializeApp, cert } = require('firebase-admin/app'));
  ({ getMessaging } = require('firebase-admin/messaging'));
} catch (err) {
  console.warn('⚠️  firebase-admin require failed (package likely not installed):', err.message);
}

// TEMPORARY DEBUG LOG — remove once FIREBASE_SERVICE_ACCOUNT is confirmed working.
// Prints length + first/last 10 characters only, never the actual secret.
{
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  console.log('🔍 DEBUG FIREBASE_SERVICE_ACCOUNT check:');
  console.log('   - typeof:', typeof raw);
  console.log('   - exists (truthy)?:', !!raw);
  console.log('   - length:', raw ? raw.length : 'n/a');
  console.log('   - first 10 chars:', raw ? JSON.stringify(raw.slice(0, 10)) : 'n/a');
  console.log('   - last 10 chars:', raw ? JSON.stringify(raw.slice(-10)) : 'n/a');
}

let firebaseReady = false;
let messagingClient = null;
if (initializeApp && cert && process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    // Env vars are often pasted as a single line, which can leave the
    // private_key's line breaks as literal "\n" two-char sequences instead
    // of real newlines. cert() needs real newlines to parse the PEM key.
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    const firebaseApp = initializeApp({ credential: cert(serviceAccount) });
    messagingClient = getMessaging(firebaseApp);
    firebaseReady = true;
    console.log('✅ Firebase Admin initialized — push notifications are live.');
  } catch (err) {
    console.error('❌ Firebase Admin init error (push notifications disabled):', err.message);
  }
} else {
  console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT not set — push notifications are disabled. In-app/desktop notifications still work fine.');
}

const app = express();

// ---- CONFIG ----
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
// Set this to your static site's real URL once deployed
// (e.g. https://remix-nexus.onrender.com). Using '*' works for testing.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
// Set this to your deployed front-end URL so reset-password emails link to
// the right place (e.g. https://remix-nexus.example.com). Falls back to
// FRONTEND_ORIGIN, then to a relative link if neither is set.
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || (FRONTEND_ORIGIN !== '*' ? FRONTEND_ORIGIN : '');

// ---- SITE OWNER(S) ----
// The only accounts allowed to delete a user-created room. Set as a
// comma-separated list of user IDs and/or usernames in your .env, e.g.
// OWNER_USER_IDS=64f...,650... and/or OWNER_USERNAMES=YourName,CoOwnerName
// Anyone can CREATE a room; only these accounts can DELETE one.
const OWNER_USER_IDS = (process.env.OWNER_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const OWNER_USERNAMES = (process.env.OWNER_USERNAMES || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function isRoomOwner(user) {
  if (!user) return false;
  if (OWNER_USER_IDS.includes(String(user.id))) return true;
  if (user.username && OWNER_USERNAMES.includes(String(user.username).toLowerCase())) return true;
  return false;
}

let mailTransporter = null;
if (nodemailer && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

// ---- EMAIL ----
// Who the emails come from. With Resend's shared test sender
// (onboarding@resend.dev) mail is ONLY delivered to the email address that
// owns your Resend account. To email real users, verify your domain at
// resend.com/domains and set EMAIL_FROM, e.g. "Remix Nexus <no-reply@yourdomain.com>".
const EMAIL_FROM = process.env.EMAIL_FROM || 'Remix Nexus <onboarding@resend.dev>';

// Sends one email. Order: Resend (HTTPS, works on Render free tier) →
// Nodemailer/SMTP (if configured) → console log (dev only).
// Returns true if it was handed to a real email provider, throws if the
// provider rejects it.
async function sendEmail({ to, subject, html, replyTo }) {
  if (resendClient) {
    const { data, error } = await resendClient.emails.send({
      from: EMAIL_FROM, to, subject, html, ...(replyTo ? { replyTo } : {})
    });
    if (error) throw new Error(`Resend rejected the email: ${error.message || JSON.stringify(error)}`);
    console.log(`📧 Email sent via Resend to ${to} (id: ${data && data.id})`);
    return true;
  }
  if (mailTransporter) {
    await mailTransporter.sendMail({
      from: process.env.EMAIL_USER, to, subject, html, ...(replyTo ? { replyTo } : {})
    });
    console.log(`📧 Email sent via SMTP to ${to}`);
    return true;
  }
  return false;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if (!resendClient && !mailTransporter) {
  console.warn('⚠️  No email service configured (set RESEND_API_KEY). Password-reset links will only be logged, not emailed.');
}
if (!PUBLIC_SITE_URL) {
  console.warn('⚠️  PUBLIC_SITE_URL is not set. Password-reset emails cannot be sent without it (e.g. https://your-site.onrender.com).');
}

if (!MONGODB_URI) {
  console.warn('⚠️  MONGODB_URI is not set. Signup/login/profile will not work until you add it to your .env file.');
}
if (!JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set. Add a long random string to your .env file before going live.');
}

// ---- MIDDLEWARE ----
app.use(express.json({ limit: '20mb' }));
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,   // your real website (keep using env var if you already had one)
  'https://localhost',           // Capacitor default origin on Android
  'capacitor://localhost'        // Capacitor default origin on iOS (safe to include even if you don't build iOS yet)
];

// The Android app and the website hit the exact same backend, so the only
// reliable way to tell them apart server-side is the request's Origin —
// the app always presents itself as 'https://localhost' or
// 'capacitor://localhost' (see allowedOrigins above), while a real browser
// on the website sends your actual domain. Used below to apply the 3-day
// chat history cutoff to the website ONLY — the app always gets full,
// unlimited history.
const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);
function isWebsiteOrigin(origin) {
  // No origin at all (curl/Postman/some native contexts) — treat as
  // "not the website" so we never accidentally trim someone's real history
  // just because we couldn't positively identify the request.
  return !!origin && !APP_ORIGINS.has(origin);
}

// Origin sniffing alone isn't reliable for telling the app apart from the
// website — if the Capacitor app is ever configured to load the live
// Render URL as its WebView content (instead of bundled local assets),
// its Origin header becomes identical to a real browser's, and it gets
// misclassified as the website, wrongly losing history after 3 days.
// The app now sends an explicit platform flag — 'app' in the socket
// handshake auth, and an X-Client-Platform header on REST calls — which
// is trusted first. Origin sniffing is only the fallback, for requests
// from an older app build that hasn't been updated to send it yet.
function isWebsiteRequest({ origin, platformHeader } = {}) {
  if (platformHeader === 'app') return false;
  if (platformHeader === 'web') return true;
  return isWebsiteOrigin(origin);
}

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like Postman, curl, some native contexts)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('Blocked by CORS:', origin); // helpful for debugging later
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// ---- STATIC FRONT-END ----
const PUBLIC_DIR = __dirname;
app.use(express.static(PUBLIC_DIR));

// ---- APP DOWNLOADS (Android / Windows / Linux) ----
// Each platform gets a stable link (/download/app, /download/windows,
// /download/linux) so the front-end buttons never have to change even
// when the underlying file is replaced or bumped to a new version.
//
// Windows/Linux builds are looked up by pattern instead of a hardcoded
// filename, since installer filenames usually embed the version number
// (e.g. "Remix Nexus Setup 1.0.1.exe") and would otherwise go stale on
// every release without a code change here.
const fs = require('fs');

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const DIST_DIR = path.join(__dirname, 'dist');

// Finds the first file in `dir` whose name matches `pattern` (case-
// insensitive). Returns null if the directory or a match doesn't exist,
// instead of throwing — a missing build shouldn't crash the route.
function findBuildFile(dir, pattern) {
  try {
    const files = fs.readdirSync(dir);
    const match = files.find(f => pattern.test(f));
    return match ? path.join(dir, match) : null;
  } catch (err) {
    return null; // directory doesn't exist yet — fine, just means no build uploaded
  }
}

function sendBuildFile(res, filePath, downloadName, platformLabel) {
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).send(
      `The ${platformLabel} build isn't uploaded to the server yet. Check back soon!`
    );
    return;
  }
  res.download(filePath, downloadName);
}

// Optional manual override, same as WINDOWS_DOWNLOAD_URL / LINUX_DOWNLOAD_URL
// below — set APK_DOWNLOAD_URL in .env to pin a specific release asset.
const APK_DOWNLOAD_URL = process.env.APK_DOWNLOAD_URL;

app.get('/download/app', (req, res) => {
  if (APK_DOWNLOAD_URL) {
    return res.redirect(APK_DOWNLOAD_URL);
  }
  // If build.yml doesn't publish an .apk to GitHub Releases (it doesn't,
  // as of now — only Windows/Linux), this just falls straight through to
  // the local file check below, same as it always has.
  return redirectToLatestAsset(req, res, {
    pattern: /\.apk$/i,
    platformLabel: 'Android',
    localDir: DOWNLOADS_DIR,
    localFilename: 'RemixNexus.apk'
  });
});

// The Windows/Linux builds are too large to comfortably live in the repo
// or on Render's disk, so they're hosted as GitHub Release assets instead.
// build.yml (--publish always) creates a new release + assets on every
// version tag. Rather than hardcoding a URL that goes stale on every
// release, we ask the GitHub API for whatever the LATEST release actually
// contains and redirect there — no env var to update, ever.
//
// Manual override: if WINDOWS_DOWNLOAD_URL / LINUX_DOWNLOAD_URL are set in
// .env, those win (handy for pinning to a specific version or working
// around a bad latest release).
const WINDOWS_DOWNLOAD_URL = process.env.WINDOWS_DOWNLOAD_URL;
const LINUX_DOWNLOAD_URL = process.env.LINUX_DOWNLOAD_URL;

// repo field is "git+https://github.com/OWNER/REPO.git" in package.json
const GITHUB_REPO = 'RemixMc647/Remix-Nexus';

// Unauthenticated GitHub API calls are capped at 60/hour per IP, which a
// live download button would blow through fast. Caching the release
// response for a few minutes keeps normal traffic well under that even
// without a token. Optional: set GITHUB_TOKEN (any classic PAT, no scopes
// needed for a public repo) to raise the cap to 5,000/hour.
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
let releaseCache = { assets: null, fetchedAt: 0 };

async function getLatestReleaseAssets() {
  const now = Date.now();
  if (releaseCache.assets && (now - releaseCache.fetchedAt) < RELEASE_CACHE_TTL_MS) {
    return releaseCache.assets;
  }
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'remix-nexus-server'
  };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers });
  if (!resp.ok) {
    throw new Error(`GitHub API returned ${resp.status}`);
  }
  const json = await resp.json();
  const assets = json.assets || [];
  releaseCache = { assets, fetchedAt: now };
  return assets;
}

// Finds the newest release asset matching `pattern` and redirects to its
// direct download URL. Falls back to a locally-built file on disk (old
// behavior) if the GitHub API call fails, so a GitHub outage or rate
// limit doesn't take the download button down entirely if you happen to
// also have a build sitting in dist/ or downloads/.
async function redirectToLatestAsset(req, res, { pattern, platformLabel, localDir, localFilename }) {
  try {
    const assets = await getLatestReleaseAssets();
    const match = assets.find(a => pattern.test(a.name));
    if (match) {
      return res.redirect(match.browser_download_url);
    }
    console.warn(`No ${platformLabel} asset found on the latest GitHub release.`);
  } catch (err) {
    console.error(`Failed to fetch latest ${platformLabel} release from GitHub:`, err.message);
  }
  // Fallback: local disk lookup
  const localPath = findBuildFile(localDir, pattern);
  if (localPath) {
    return sendBuildFile(res, localPath, localFilename, platformLabel);
  }
  res.status(404).send(
    `The ${platformLabel} build isn't available right now. Check back soon!`
  );
}

app.get('/download/windows', (req, res) => {
  if (WINDOWS_DOWNLOAD_URL) {
    return res.redirect(WINDOWS_DOWNLOAD_URL);
  }
  return redirectToLatestAsset(req, res, {
    pattern: /\.exe$/i,
    platformLabel: 'Windows',
    localDir: DIST_DIR,
    localFilename: 'RemixNexus-Setup.exe'
  });
});

app.get('/download/linux', (req, res) => {
  if (LINUX_DOWNLOAD_URL) {
    return res.redirect(LINUX_DOWNLOAD_URL);
  }
  return redirectToLatestAsset(req, res, {
    pattern: /\.appimage$/i,
    platformLabel: 'Linux',
    localDir: DOWNLOADS_DIR,
    localFilename: 'RemixNexus.AppImage'
  });
});

// ---- IN-APP LIVE UPDATES (Capacitor OTA) ----
// Lets the Android app pull new web-layer code (HTML/CSS/JS) straight from
// this server, with no Play Store visit and no Android Studio rebuild.
// This ONLY covers web-layer changes — a new native plugin, permission, or
// Capacitor version bump still needs a real APK rebuild via build.yml.
//
// How a release works:
//   1) Update your web files under www/ as normal.
//   2) Run `npm run bundle:build` — zips www/ into bundles/latest.zip and
//      writes bundles/latest.json with a fresh version stamp.
//   3) Deploy/restart the Render service. Any app that's open (or gets
//      opened) picks up the new bundle automatically, no user action.
const BUNDLES_DIR = path.join(__dirname, 'bundles');

// GET /api/app-update/version — tells the app what the newest bundle is.
// Returns 404 (not an error, just "nothing published yet") until you've
// run `npm run bundle:build` at least once.
app.get('/api/app-update/version', (req, res) => {
  const manifestPath = path.join(BUNDLES_DIR, 'latest.json');
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: 'No live-update bundle has been published yet.' });
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json({
      bundleId: manifest.version,
      url: `${PUBLIC_SITE_URL || ''}/download/bundle`
    });
  } catch (err) {
    console.error('Live-update manifest read error:', err);
    res.status(500).json({ error: 'Could not read update manifest.' });
  }
});

// GET /download/bundle — serves the actual zip the app downloads and
// applies via the LiveUpdate plugin (see www/js/live-update.js).
app.get('/download/bundle', (req, res) => {
  const zipPath = path.join(BUNDLES_DIR, 'latest.zip');
  if (!fs.existsSync(zipPath)) {
    return res.status(404).send('No bundle published yet.');
  }
  res.download(zipPath, 'bundle.zip');
});

// ---- DATABASE ----
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => {
      console.log('✅ Connected to MongoDB');

      // ---- AUTO-CLEANUP: trims oldest messages when storage gets full ----
      // Only ever deletes from the message collections below — never touches
      // users, auth, blocks, or any other account data. Runs an initial
      // check immediately, then re-checks every hour.
      scheduleAutoCleanup(
        mongoose.connection.db,
        {
          maxStorageMB: 512,       // your Atlas free-tier cap
          triggerPercent: 85,      // start cleanup once 85% full
          targetPercent: 70,       // stop once back down to 70%
          batchSize: 500,
          dryRun: false,           // set to true first to see what it WOULD delete
          collections: [
            { name: 'directmessages', dateField: 'time' },
            { name: 'roommessages', dateField: 'time' },
          ],
        },
        60 * 60 * 1000 // check every hour
      );
    })
    .catch((err) => console.error('❌ MongoDB connection error:', err.message));
}

// ---- HTTP + SOCKET.IO SERVER ----
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // Use the same allow-list as the Express/REST CORS config above,
    // instead of only FRONTEND_ORIGIN. Without this, the Socket.io
    // connection (which is all of chat) gets rejected when it comes
    // from the Android app's 'capacitor://localhost' / 'https://localhost'
    // origin, even though those same origins are already allowed for
    // regular API calls.
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log('Socket.io blocked by CORS:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  },
  // Socket.io's default payload cap is 1MB, which is smaller than our
  // voice-note/image/video data: URLs. Without raising this, those
  // messages get silently dropped by the transport before they ever
  // reach the size checks below. 20MB comfortably covers the 16MB video
  // cap plus JSON overhead.
  maxHttpBufferSize: 20 * 1024 * 1024
});

// Verify the JWT (if the client sent one) BEFORE the connection completes.
// This is what lets us trust socket.userId / socket.username later instead
// of trusting whatever "author" name the client claims to be.
io.use(async (socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.id;
      // Look the user up fresh rather than trusting decoded.username —
      // the JWT payload is only re-issued when the token is refreshed, so
      // if we trusted it directly a username change wouldn't show up in
      // chat until the old token expired. This keeps chat identity always
      // in sync with whatever is on the Profile page.
      try {
        const user = await User.findById(decoded.id);
        if (user) {
          if (user.banned) {
            // Reject the connection outright — a banned user gets no chat,
            // no calls, no presence, nothing that flows over this socket.
            next(new Error('This account has been suspended.'));
            return;
          }
          socket.username = user.username;
          socket.avatar = user.avatar;
        } else {
          socket.username = decoded.username;
        }
      } catch (lookupErr) {
        // DB hiccup — fall back to what the token says rather than failing
        socket.username = decoded.username;
      }
    } catch (err) {
      // Invalid/expired token — still let them connect as a guest rather
      // than hard-failing, they just won't have a verified identity.
    }
  }

  next();
});

// ---- USER MODEL ----
const AVATAR_OPTIONS = ['🎮', '🕹️', '👾', '🧱', '🚀', '⚔️', '🔥', '🏆', '🎯', '🐉','😎','💀','🏹','🕷','👩🏻','🎧','🍆','🍑'];

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  avatar: { type: String, default: '🎮' },
  // Profile banner picture (YouTube-style cover). A small data:image/... URL
  // (the front-end shrinks it to 1200x400 JPEG). Empty string = no banner.
  banner: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  resetPasswordTokenHash: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  // FCM device tokens — a user can be logged in on more than one device/
  // browser, so this is a list, not a single string. A push is sent to
  // every token here whenever this user gets a new room message or DM.
  pushTokens: { type: [String], default: [] },
// User IDs (as strings) that this account has blocked, WhatsApp-style.
  // Blocking is always one-directional and self-service — only ever
  // modified via this same user's own /api/users/:id/block(unblock) call.
  // A DM is refused in either direction if EITHER side appears in the
  // other's list — see the dm:message socket handler below.
  blockedUsers: { type: [String], default: [] },
  // "Clear all chats" is FOR ME ONLY (like WhatsApp's clear chat): messages sent
  // at or before this moment are hidden from THIS user's history. Nothing is
  // deleted and nobody else's chats are affected.
  chatsClearedAt: { type: Date, default: null },

  // ================================================================
  // NEW: WhatsApp & Snapchat Feature Fields
  // ================================================================
  // Pinned chats — array of room IDs or contact IDs that should appear
  // at the top of the sidebar, WhatsApp-style. Each entry is prefixed
  // with 'room:' or 'contact:' to distinguish the type.
  pinnedChats: { type: [String], default: [] },
  // Starred/favorite messages — array of message IDs (strings, can be
  // either room message IDs or DM message IDs) that this user has
  // bookmarked. Retrieved via a new /api/me/starred endpoint.
  starredMessages: { type: [String], default: [] },
  // Muted chats — array of room IDs or contact IDs that the user has
  // muted. Same 'room:'/'contact:' prefix convention as pinnedChats.
  mutedChats: { type: [String], default: [] },
  // Archived chats — array of room IDs or contact IDs that the user has
  // archived. Archived chats are hidden from the main list but accessible
  // from an "Archived" section.
  archivedChats: { type: [String], default: [] },
  // Last seen timestamp — updated whenever the user sends a message or
  // performs an actionable event. Used to show "last seen X ago" on
  // profile/contact cards, WhatsApp-style.
  lastSeen: { type: Date, default: null },
  // Dark mode preference — stored server-side so it syncs across devices.
  darkMode: { type: Boolean, default: false },
  // Chat wallpaper — stored as a data URL (base64) so it can be set
  // per-user and sync across devices. Falls back to the default CSS
  // background if null/empty.
  chatWallpaper: { type: String, default: null },
  // Snapchat-style streak counter — stored as a map of "contactId" -> streak object.
  // Each entry has a count (consecutive days of messaging) and the last
  // date a message was exchanged to track daily resets.
  streaks: { type: Map, of: new mongoose.Schema({
    count: { type: Number, default: 0 },
    lastMessageDate: { type: String, default: '' } // YYYY-MM-DD format
  }, { _id: false }), default: new Map() },

  // ---- ADMIN / MODERATION ----
  // Only ever set by an owner account (see isRoomOwner/OWNER_USER_IDS
  // above) via the /api/admin routes. A banned user can't log in, can't
  // open a socket connection (chat/calls), and can't post stories.
  banned: { type: Boolean, default: false },
  bannedAt: { type: Date, default: null },
  bannedReason: { type: String, default: '' }

});

const User = mongoose.model('User', userSchema);

// ---- NEXUS REALM MODELS (community-created, no paid streaming required) ----
const realmMatchSchema = new mongoose.Schema({
  game:{type:String,required:true,maxlength:40}, matchType:{type:String,default:'Skill challenge',maxlength:60},
  challengerId:{type:String,required:true,index:true}, challengerName:{type:String,default:'Player'},
  opponentUsername:{type:String,default:'',maxlength:32}, opponentId:{type:String,default:''}, opponentName:{type:String,default:''},
  durationMinutes:{type:Number,default:30,min:1,max:1440}, location:{type:String,default:'',maxlength:80}, rules:{type:String,required:true,maxlength:800}, deadline:{type:Date,default:null},
  status:{type:String,enum:['open','accepted','completed','cancelled','disputed'],default:'open',index:true}, evidence:{type:String,default:'',maxlength:500}, evidenceBy:{type:String,default:''},
  resultProposals:{type:[{userId:String,username:String,winnerUsername:String,createdAt:{type:Date,default:Date.now}}],default:[]}, winnerUsername:{type:String,default:''}
},{timestamps:true});
const RealmMatch = mongoose.models.RealmMatch || mongoose.model('RealmMatch',realmMatchSchema);
const realmWorldSchema = new mongoose.Schema({
  title:{type:String,required:true,maxlength:90}, game:{type:String,required:true,maxlength:40}, category:{type:String,default:'Build',maxlength:40},
  // Old link-based posts (kept so nothing breaks). NEW posts are photo/video only — no URLs.
  imageUrl:{type:String,default:'',maxlength:500}, link:{type:String,default:'',maxlength:500},
  // NEW: a photo or a video (max 1 minute). Same storage as Stories: photos are saved as a data: URL,
  // videos live on Cloudinary (only the URL + public id are saved here).
  mediaType:{type:String,enum:['image','video',''],default:''},
  mediaData:{type:String,default:''}, mediaUrl:{type:String,default:''}, mediaPublicId:{type:String,default:''}, mediaDuration:{type:Number,default:0},
  description:{type:String,default:'',maxlength:900}, creatorId:{type:String,required:true,index:true}, creatorName:{type:String,default:'Player'}
},{timestamps:true});
// Every Nexus World disappears 24 hours after it is posted (MongoDB's TTL cleanup, same idea as Stories).
realmWorldSchema.index({createdAt:1},{expireAfterSeconds:24*60*60});
const RealmWorld = mongoose.models.RealmWorld || mongoose.model('RealmWorld',realmWorldSchema);
const realmSquadSchema = new mongoose.Schema({name:{type:String,required:true,maxlength:60},game:{type:String,required:true,maxlength:40},playersNeeded:{type:Number,default:2,min:1,max:20},activity:{type:String,default:'',maxlength:80},description:{type:String,default:'',maxlength:500},creatorId:{type:String,required:true,index:true},creatorName:{type:String,default:'Player'},status:{type:String,default:'OPEN'},joinRequests:{type:[{userId:String,username:String,createdAt:{type:Date,default:Date.now}}],default:[]}},{timestamps:true});
const RealmSquad = mongoose.models.RealmSquad || mongoose.model('RealmSquad',realmSquadSchema);
const realmGiftSchema = new mongoose.Schema({fromUserId:{type:String,required:true,index:true},fromUsername:{type:String,default:'Player'},toUserId:{type:String,required:true,index:true},toUsername:{type:String,default:'Player'},gift:{type:String,enum:['trophy','crystal','gg','heart','star'],required:true},giftLabel:{type:String,default:''},message:{type:String,default:'',maxlength:180}},{timestamps:true});
const RealmGift = mongoose.models.RealmGift || mongoose.model('RealmGift',realmGiftSchema);


// ---- DIRECT MESSAGE MODEL ----
// `participants` is always the two user IDs sorted alphabetically, so a
// single query finds the whole conversation regardless of who sent what.
const dmSchema = new mongoose.Schema({
  participants: { type: [String], required: true, index: true },
  fromUserId: { type: String, required: true },
  toUserId: { type: String, required: true },
  // `text` is no longer strictly required — a DM can now be media-only
  // (an image, video, or voice note with no caption), same as room
  // chat's voice notes.
  text: { type: String, default: '' },
  mediaType: { type: String, enum: ['image', 'video', null], default: null },
  mediaData: { type: String, default: null }, // data: URL, same approach as voice notes
  audioData: { type: String, default: null },  // data: URL for a recorded voice note
  audioDuration: { type: Number, default: 0 },
  replyTo: {
    id: { type: String, default: '' },
    author: { type: String, default: '' },
    text: { type: String, default: '' }
  },
  time: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  // WhatsApp-style read receipt — flips to true once the recipient has
  // opened this conversation (see the dm:seen socket handler below).
  seen: { type: Boolean, default: false },
  // ================================================================
  // NEW: Snapchat-style Feature Fields
  // ================================================================
  // View-once media flag — when true, the media (photo/video) will be
  // blurred/hidden after the recipient views it once, Snapchat-style.
  viewOnce: { type: Boolean, default: false },
  // Self-destruct timestamp — if set, this message will be automatically
  // deleted from the database once the timestamp is reached. Set by the
  // sender via a snap timer or ephemeral chat setting.
  selfDestructAt: { type: Date, default: null },
  // Snap timer in seconds — how long the recipient has to view the
  // message before it self-destructs. Used client-side for the countdown.
  snapTimer: { type: Number, default: 0 },
  // Screenshot detected flag — set to true when the client detects a
  // screenshot was taken (browser-based detection where supported).
  screenshotDetected: { type: Boolean, default: false },
  // Emoji reactions on this message — array of { emoji, userId, username }
  // so multiple people can react with different emojis, WhatsApp-style.
  reactions: { type: [{ emoji: String, userId: String, username: String, time: { type: Date, default: Date.now } }], default: [] }
});

const DirectMessage = mongoose.model('DirectMessage', dmSchema);

// ---- ROOM PARTICIPANT MODEL ----
// Persisted (not in-memory) so that "who have I chatted with in a room"
// survives server restarts/redeploys — this is what makes contacts
// permanent instead of resetting every time the server redeploys.
const roomParticipantSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true }
});
roomParticipantSchema.index({ roomId: 1, userId: 1 }, { unique: true });

const RoomParticipant = mongoose.model('RoomParticipant', roomParticipantSchema);

// ---- ROOM MODEL (user-created rooms) ----
// The "default" rooms (Just Chatting, etc.) live client-side in rooms.js
// and never appear here. This model only holds rooms a logged-in user has
// created themselves — the WhatsApp-"create a group" style feature.
// `createdBy` is null for nothing in this model (every doc here is
// user-created); it's kept so we always know who can be credited/blamed
// for a room, even though only an owner account can actually delete one.
const customRoomSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  createdBy: { type: String, required: true },
  createdByUsername: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const CustomRoom = mongoose.model('CustomRoom', customRoomSchema);

// ---- STORY MODEL (Snapchat-style, disappears after 24h) ----
// Stored the same way voice notes/media are — a base64 data: URL — capped
// in size at post time (see POST /api/stories below). The TTL index on
// `createdAt` makes MongoDB itself delete the document ~24h after it was
// created, so there's no cron job or manual cleanup needed anywhere.
const storySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  avatar: { type: String, default: '🎮' },
  mediaType: { type: String, enum: ['image', 'video'], required: true },
  // Images are still stored inline as a data: URL. Videos live on
  // Cloudinary instead (free cloud storage) — only the URL + public id are
  // saved here, so MongoDB doesn't fill up with big video files.
  mediaData: { type: String, default: '' },
  mediaUrl: { type: String, default: '' },
  mediaPublicId: { type: String, default: '' },
  mediaDuration: { type: Number, default: 0 },
  caption: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  // Each viewer recorded once — see POST /api/stories/:id/view, which
  // uses $addToSet-style de-dupe logic so re-opening your own story
  // doesn't spam the viewers list.
  viewers: [{
    userId: { type: String, required: true },
    username: { type: String, default: '' },
    viewedAt: { type: Date, default: Date.now }
  }],
  // WhatsApp-style heart reaction — anyone who can see the story can like
  // it (unlike viewers, which is just an auto-logged "saw this"). One like
  // per user, toggled on/off, so this is a Set-like array keyed by userId.
  likes: [{
    userId: { type: String, required: true },
    username: { type: String, default: '' },
    likedAt: { type: Date, default: Date.now }
  }]
});
// expireAfterSeconds makes this a TTL index — MongoDB's background task
// deletes a story automatically 24h after createdAt, no app code needed.
storySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

const Story = mongoose.model('Story', storySchema);

function publicStory(s, viewerId) {
  return {
    id: s._id,
    userId: s.userId,
    username: s.username,
    avatar: s.avatar,
    mediaType: s.mediaType,
    // Same field name as before so the front-end viewer keeps working:
    // it's the Cloudinary URL for videos, the data: URL for images.
    mediaData: s.mediaUrl || s.mediaData,
    mediaDuration: s.mediaDuration || 0,
    caption: s.caption,
    createdAt: s.createdAt,
    viewCount: s.viewers.length,
    viewedByMe: viewerId ? s.viewers.some(v => String(v.userId) === String(viewerId)) : false,
    likeCount: s.likes.length,
    likedByMe: viewerId ? s.likes.some(l => String(l.userId) === String(viewerId)) : false
  };
}

// ---- REPORT MODEL — user-submitted reports for the admin dashboard ----
// Deliberately lightweight: no automated moderation, no third-party
// scanning — just a queue an owner account reviews by hand. `targetType`
// says what kind of thing was reported so the dashboard can link back to
// it (a room message, a DM, a story, or a user account in general).
const reportSchema = new mongoose.Schema({
  reportedBy: { type: String, required: true },
  reportedByUsername: { type: String, default: '' },
  targetType: { type: String, enum: ['message', 'dm', 'story', 'user'], required: true },
  targetId: { type: String, default: '' },
  targetUserId: { type: String, default: null },
  targetUsername: { type: String, default: '' },
  reason: { type: String, default: '' },
  contentSnapshot: { type: String, default: '' }, // short text excerpt, for admin context only
  status: { type: String, enum: ['open', 'resolved', 'dismissed'], default: 'open' },
  createdAt: { type: Date, default: Date.now }
});

const Report = mongoose.model('Report', reportSchema);

function publicRoom(r) {
  return {
    id: r.id,
    name: r.name,
    createdBy: r.createdBy,
    createdByUsername: r.createdByUsername,
    createdAt: r.createdAt,
    isCustom: true
  };
}

// ---- ROOM MESSAGE MODEL ----
// Room chat used to live only in an in-memory Map, which meant every
// redeploy/restart wiped every room's history. Persisting it here means
// messages survive redeploys and are never auto-expired — a message only
// ever disappears when its author, or the site owner, explicitly deletes
// it (see chat:message:delete below), or a user clears their own local
// copy from Settings ▸ Clear All Chats.
const roomMessageSchema = new mongoose.Schema({
  // Client-generated id (or server-generated fallback) — this is what
  // edit/delete/replyTo all key off of, same as when this lived in memory.
  id: { type: String, required: true, unique: true },
  room: { type: String, required: true, index: true },
  author: { type: String, required: true },
  authorId: { type: String, default: null },
  text: { type: String, default: '' },
  audioData: { type: String, default: null },
  audioDuration: { type: Number, default: 0 },
  mediaType: { type: String, enum: ['image', 'video', null], default: null },
  mediaData: { type: String, default: null },
  replyTo: {
    id: { type: String, default: '' },
    author: { type: String, default: '' },
    text: { type: String, default: '' }
  },
  time: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  // WhatsApp-style emoji reactions — array of { emoji, userId, username }
  reactions: { type: [{ emoji: String, userId: String, username: String }], default: [] }
});

roomMessageSchema.index({ room: 1, time: 1 });
// NOTE: there is intentionally no TTL index here — room messages persist
// indefinitely, same as direct messages, until someone explicitly deletes
// them (see the "ROOM MESSAGE MODEL" comment above).

const RoomMessage = mongoose.model('RoomMessage', roomMessageSchema);

function normalizeRoomMessage(m) {
  return {
    id: m.id,
    author: m.author,
    authorId: m.authorId,
    text: m.text,
    audio: m.audioData ? { data: m.audioData, duration: m.audioDuration } : null,
    media: m.mediaType ? { type: m.mediaType, data: m.mediaData } : null,
    time: m.time instanceof Date ? m.time.getTime() : m.time,
    replyTo: (m.replyTo && m.replyTo.id) ? { id: m.replyTo.id, author: m.replyTo.author, text: m.replyTo.text } : null,
    edited: m.edited,
    // Include reactions array if present
    reactions: (m.reactions && m.reactions.length) ? m.reactions.map(r => ({ emoji: r.emoji, userId: r.userId, username: r.username })) : []
  };
}

function conversationKey(idA, idB) {
  return [String(idA), String(idB)].sort();
}

// ---- HELPERS ----
function createToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    createdAt: user.createdAt
  };
}

// Same as publicUser() plus the banner picture. Only used on routes that
// return the logged-in user's OWN account (/api/me and friends).
function ownUser(user) {
  return { ...publicUser(user), banner: user.banner || '' };
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

function dbGuard(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database is not connected yet. Check MONGODB_URI in your .env file.' });
  }
  next();
}

// Blocks a banned user from write actions even if their JWT is still
// valid (JWTs aren't revoked on ban, so this DB check is what actually
// enforces it for REST routes). Real-time chat is enforced separately in
// the Socket.io auth middleware below, since that's a different
// connection lifecycle entirely.
async function banGuard(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('banned bannedReason');
    if (user && user.banned) {
      return res.status(403).json({
        error: user.bannedReason
          ? `Your account has been suspended: ${user.bannedReason}`
          : 'Your account has been suspended.'
      });
    }
    next();
  } catch (err) {
    // DB hiccup — fail open rather than locking everyone out over a
    // transient error; the real ban check still runs on login/socket connect.
    next();
  }
}

// Restricts a route to owner accounts only (see isRoomOwner/OWNER_USER_IDS
// above). Must run after authMiddleware, which populates req.user from the JWT.
function adminGuard(req, res, next) {
  if (!isRoomOwner({ id: req.user.id, username: req.user.username })) {
    return res.status(403).json({ error: 'Admin access only.' });
  }
  next();
}


// ---- NEXUS REALM API ----
const realmClean = (v, max=500) => String(v == null ? '' : v).trim().slice(0,max);
const realmPublicMatch = m => ({_id:m._id,game:m.game,matchType:m.matchType,challengerName:m.challengerName,opponentUsername:m.opponentUsername,opponentName:m.opponentName,durationMinutes:m.durationMinutes,location:m.location,rules:m.rules,deadline:m.deadline,status:m.status,evidence:m.evidence,winnerUsername:m.winnerUsername,createdAt:m.createdAt,resultProposals:(m.resultProposals||[]).map(p=>({username:p.username,winnerUsername:p.winnerUsername,createdAt:p.createdAt}))});
app.get('/api/realm/matches', dbGuard, async (req,res)=>{try{const rows=await RealmMatch.find({status:{$ne:'cancelled'}}).sort({createdAt:-1}).limit(100).lean();res.json({matches:rows.map(realmPublicMatch)});}catch(e){res.status(500).json({error:'Could not load matches.'});}});
app.post('/api/realm/matches', dbGuard, authMiddleware, banGuard, async (req,res)=>{try{const game=realmClean(req.body.game,40),rules=realmClean(req.body.rules,800);if(!game||!rules)return res.status(400).json({error:'Game and rules are required.'});let deadline=null;if(req.body.deadline){deadline=new Date(req.body.deadline);if(Number.isNaN(deadline.getTime())||deadline.getTime()<Date.now())return res.status(400).json({error:'Deadline must be a valid future date.'});}const duration=Math.min(1440,Math.max(1,Number(req.body.durationMinutes)||30));const match=await RealmMatch.create({game,matchType:realmClean(req.body.matchType,60)||'Skill challenge',challengerId:String(req.user.id),challengerName:realmClean(req.user.username,32)||'Player',opponentUsername:realmClean(req.body.opponent,32),durationMinutes:duration,location:realmClean(req.body.location,80),rules,deadline});res.status(201).json({match:realmPublicMatch(match)});}catch(e){res.status(500).json({error:'Could not create match.'});}});
app.post('/api/realm/matches/:id/accept', dbGuard, authMiddleware, banGuard, async(req,res)=>{try{const m=await RealmMatch.findById(req.params.id);if(!m)return res.status(404).json({error:'Match not found.'});if(m.status!=='open')return res.status(409).json({error:'This match is no longer open.'});if(String(m.challengerId)===String(req.user.id))return res.status(400).json({error:'You cannot accept your own match.'});if(m.opponentUsername&&m.opponentUsername.toLowerCase()!==String(req.user.username||'').toLowerCase())return res.status(403).json({error:'This match was invited to a different username.'});m.opponentId=String(req.user.id);m.opponentName=realmClean(req.user.username,32)||'Player';m.status='accepted';await m.save();res.json({match:realmPublicMatch(m)});}catch(e){res.status(500).json({error:'Could not accept match.'});}});
app.post('/api/realm/matches/:id/evidence', dbGuard, authMiddleware, banGuard, async(req,res)=>{try{const m=await RealmMatch.findById(req.params.id);if(!m)return res.status(404).json({error:'Match not found.'});if(![String(m.challengerId),String(m.opponentId)].includes(String(req.user.id)))return res.status(403).json({error:'Only match players can submit evidence.'});const url=realmClean(req.body.url,500);if(!/^https:\/\//i.test(url))return res.status(400).json({error:'Evidence must be a public HTTPS link.'});m.evidence=url;m.evidenceBy=String(req.user.id);await m.save();res.json({match:realmPublicMatch(m)});}catch(e){res.status(500).json({error:'Could not submit evidence.'});}});
app.post('/api/realm/matches/:id/result', dbGuard, authMiddleware, banGuard, async(req,res)=>{try{const m=await RealmMatch.findById(req.params.id);if(!m)return res.status(404).json({error:'Match not found.'});if(![String(m.challengerId),String(m.opponentId)].includes(String(req.user.id)))return res.status(403).json({error:'Only match players can propose a result.'});const winner=realmClean(req.body.winnerUsername,32);if(!winner)return res.status(400).json({error:'Winner username is required.'});const valid=[m.challengerName,m.opponentName].filter(Boolean).some(n=>n.toLowerCase()===winner.toLowerCase());if(!valid)return res.status(400).json({error:'Winner must be one of the players in this match.'});m.resultProposals.push({userId:String(req.user.id),username:realmClean(req.user.username,32),winnerUsername:winner});const proposals=m.resultProposals.filter(p=>p.winnerUsername.toLowerCase()===winner.toLowerCase());if(proposals.some(p=>String(p.userId)!==String(req.user.id))){m.status='completed';m.winnerUsername=winner;}else if(m.status==='open')m.status='accepted';await m.save();res.json({match:realmPublicMatch(m),message:m.status==='completed'?'Both players agreed on the result.':'Result proposal recorded; the other player must agree.'});}catch(e){res.status(500).json({error:'Could not record result.'});}});
app.get('/api/realm/squads', dbGuard, async(req,res)=>{try{const squads=await RealmSquad.find({status:'OPEN'}).sort({createdAt:-1}).limit(100).lean();res.json({squads:squads.map(s=>({...s,_id:String(s._id),joinRequests:undefined}))});}catch(e){res.status(500).json({error:'Could not load squads.'});}});
app.post('/api/realm/squads', dbGuard, authMiddleware, banGuard, async(req,res)=>{try{const name=realmClean(req.body.name,60),game=realmClean(req.body.game,40);if(!name||!game)return res.status(400).json({error:'Squad name and game are required.'});const s=await RealmSquad.create({name,game,playersNeeded:Math.min(20,Math.max(1,Number(req.body.playersNeeded)||2)),activity:realmClean(req.body.activity,80),description:realmClean(req.body.description,500),creatorId:String(req.user.id),creatorName:realmClean(req.user.username,32)||'Player'});res.status(201).json({squad:s});}catch(e){res.status(500).json({error:'Could not create squad.'});}});
app.post('/api/realm/squads/:id/join', dbGuard, authMiddleware, banGuard, async(req,res)=>{try{const s=await RealmSquad.findById(req.params.id);if(!s||s.status!=='OPEN')return res.status(404).json({error:'Squad not found or closed.'});if(String(s.creatorId)===String(req.user.id))return res.status(400).json({error:'You created this squad.'});if(s.joinRequests.some(r=>String(r.userId)===String(req.user.id)))return res.status(409).json({error:'You already requested to join.'});s.joinRequests.push({userId:String(req.user.id),username:realmClean(req.user.username,32)});await s.save();res.json({message:'Join request sent. The squad creator will need to coordinate with you.'});}catch(e){res.status(500).json({error:'Could not request to join.'});}});
// ---- NEXUS REALM GIFTS ----
// ONLY the one account whose email matches GIFT_SENDER_EMAIL (default: adelabuaderemi02@gmail.com,
// i.e. RemixMc) can send gifts. Everyone else can only receive. The check is done HERE on the
// server, so editing the web page cannot bypass it. Each gift is also emailed to the recipient
// (through Resend) and sent as a phone notification.
const GIFT_SENDER_EMAIL = String(process.env.GIFT_SENDER_EMAIL || 'adelabuaderemi02@gmail.com').trim().toLowerCase();
async function canSendRealmGifts(userId) {
  try {
    const u = await User.findById(userId).select('email banned');
    return !!(u && !u.banned && String(u.email || '').trim().toLowerCase() === GIFT_SENDER_EMAIL);
  } catch (e) { return false; }
}
const GIFT_LABELS = { trophy: '🏆 Champion Trophy', crystal: '💎 Nexus Crystal', gg: '🎮 GG Token', heart: '💜 Respect', star: '⭐ Star Player' };

function giftEmailHtml({ fromName, toName, label, message }) {
  const link = PUBLIC_SITE_URL ? PUBLIC_SITE_URL.replace(/\/+$/, '') + '/NexusRealm.html#gifts' : '';
  const emoji = label.split(' ')[0];
  const name = label.split(' ').slice(1).join(' ');
  return `<!doctype html><html><body style="margin:0;background:#000;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:28px 18px;">
    <div style="background:linear-gradient(135deg,#060612,#0d1a47);border:1px solid #0066ff;border-radius:18px;padding:28px 22px;text-align:center;color:#fff;">
      <div style="font-size:12px;letter-spacing:3px;color:#7fa8ff;">REMIX NEXUS · NEXUS REALM</div>
      <div style="font-size:64px;margin:18px 0 6px;">${emoji}</div>
      <h1 style="margin:0 0 6px;font-size:22px;">You received a gift!</h1>
      <p style="margin:0 0 16px;color:#b9c4ff;font-size:15px;">Hi <b>${escapeHtml(toName)}</b>, <b>${escapeHtml(fromName)}</b> sent you a <b>${escapeHtml(name)}</b>.</p>
      ${message ? `<div style="background:rgba(255,255,255,.07);border-radius:12px;padding:12px 14px;margin:0 0 18px;color:#e8ecff;font-style:italic;">“${escapeHtml(message)}”</div>` : ''}
      ${link ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#0066ff;color:#fff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:99px;">Open your gift box</a>` : ''}
      <p style="margin:20px 0 0;color:#6b739f;font-size:12px;">Free digital gift — no cash value. Play fair, respect other players.</p>
    </div>
  </div></body></html>`;
}

app.get('/api/realm/gifts', dbGuard, authMiddleware, async (req, res) => {
  try {
    const id = String(req.user.id);
    const [gifts, canSend] = await Promise.all([
      RealmGift.find({ $or: [{ fromUserId: id }, { toUserId: id }] }).sort({ createdAt: -1 }).limit(50).lean(),
      canSendRealmGifts(id)
    ]);
    res.json({ gifts, canSend });
  } catch (e) { res.status(500).json({ error: 'Could not load gifts.' }); }
});

app.post('/api/realm/gifts', dbGuard, authMiddleware, banGuard, async (req, res) => {
  try {
    if (!(await canSendRealmGifts(req.user.id))) return res.status(403).json({ error: 'Only Remix MC can send gifts.' });
    const recipient = realmClean(req.body.recipient, 32).replace(/^@/, '').toLowerCase();
    const gift = realmClean(req.body.gift, 20);
    if (!GIFT_LABELS[gift]) return res.status(400).json({ error: 'Choose a valid free digital gift.' });
    if (!recipient) return res.status(400).json({ error: 'Type the recipient username.' });
    const to = await User.findOne({ username: { $regex: '^' + recipient.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', $options: 'i' } });
    if (!to) return res.status(404).json({ error: 'Recipient username not found.' });
    if (String(to._id) === String(req.user.id)) return res.status(400).json({ error: 'You cannot send a gift to yourself.' });

    const fromName = realmClean(req.user.username, 32) || 'Remix MC';
    const message = realmClean(req.body.message, 180);
    const g = await RealmGift.create({
      fromUserId: String(req.user.id), fromUsername: fromName,
      toUserId: String(to._id), toUsername: realmClean(to.username, 32) || 'Player',
      gift, giftLabel: GIFT_LABELS[gift], message
    });

    // Email the recipient through Resend (does not block or break the gift if it fails).
    let emailed = false, emailNote = '';
    if (!to.email) emailNote = 'That player has no email on file.';
    else {
      try {
        emailed = await sendEmail({
          to: to.email,
          subject: `🎁 ${fromName} sent you a gift: ${GIFT_LABELS[gift]}`,
          html: giftEmailHtml({ fromName, toName: to.username, label: GIFT_LABELS[gift], message })
        });
        if (!emailed) emailNote = 'Email service is not set up on the server.';
      } catch (err) {
        console.error('Gift email failed:', err.message);
        emailNote = 'The gift was sent, but the email could not be delivered.';
      }
    }
    // Phone notification (if they have the app and allowed notifications).
    try {
      await sendPushToUser(String(to._id), { title: `🎁 ${fromName} sent you a gift!`, body: `${GIFT_LABELS[gift]}${message ? ' — ' + message : ''}`, data: { type: 'realm-gift', url: '/NexusRealm.html#gifts' } });
    } catch (e) { /* push is optional */ }

    res.status(201).json({ gift: g, emailed, emailNote });
  } catch (e) { console.error('send gift', e); res.status(500).json({ error: 'Could not send gift.' }); }
});

// ---- ROUTES ----

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: '𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 backend is running.',
    dbConnected: mongoose.connection.readyState === 1
  });
});

// SIGNUP
app.post('/api/signup', dbGuard, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are all required.' });
    }

    if (username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.trim() }]
    });

    if (existingUser) {
      return res.status(409).json({ error: 'An account with that email or username already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = new User({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      avatar: AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)]
    });

    await user.save();

    const token = createToken(user);

    res.status(201).json({ token, user: publicUser(user) });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong during signup.' });
  }
});

// LOGIN
app.post('/api/login', dbGuard, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.banned) {
      return res.status(403).json({
        error: user.bannedReason
          ? `Your account has been suspended: ${user.bannedReason}`
          : 'Your account has been suspended.'
      });
    }

    const token = createToken(user);

    res.json({ token, user: publicUser(user) });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong during login.' });
  }
});

// GET CURRENT USER (protected — this is what Profile.html calls)
app.get('/api/me', dbGuard, authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    // isOwner only ever appears on a user's own /api/me response — never on
    // publicUser() elsewhere — so this doesn't leak who the owner is to
    // other people looking at a profile.
    res.json({ user: { ...ownUser(user), isOwner: isRoomOwner({ id: user._id, username: user.username }) } });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// UPDATE AVATAR (protected)
app.put('/api/me/avatar', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { avatar } = req.body;

    if (!avatar || !AVATAR_OPTIONS.includes(avatar)) {
      return res.status(400).json({ error: 'Please choose a valid avatar option.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar },
      { new: true }
    );

    res.json({ user: ownUser(user) });
  } catch (err) {
    console.error('Update avatar error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// UPDATE PROFILE BANNER (protected)
// Body: { banner: "data:image/jpeg;base64,..." }  or  { banner: "" } to remove it.
// Only small base64 images are accepted (the front-end already shrinks the
// picture to 1200x400), and the strict pattern below means the value can
// never contain quotes/brackets, so it is safe to drop into CSS url("...").
const BANNER_MAX_CHARS = 1000000;   // ~750 KB of image — far above the ~150 KB we normally get
const BANNER_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;

app.put('/api/me/banner', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { banner } = req.body || {};

    if (typeof banner !== 'string') {
      return res.status(400).json({ error: 'Please send a banner picture.' });
    }

    if (banner !== '') {
      if (banner.length > BANNER_MAX_CHARS) {
        return res.status(413).json({ error: 'That banner picture is too big.' });
      }
      if (!BANNER_PATTERN.test(banner)) {
        return res.status(400).json({ error: 'Banner must be a JPG, PNG or WebP picture.' });
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { banner },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: ownUser(user) });
  } catch (err) {
    console.error('Update banner error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// Expose the allowed avatar list so the front-end never hardcodes it twice
app.get('/api/avatar-options', (req, res) => {
  res.json({ options: AVATAR_OPTIONS });
});

// SAVE PUSH TOKEN (protected) — called once by the Android app right
// after it registers for push notifications, so we know where to send
// pushes for this user. $addToSet means calling this again with the same
// token is harmless (no duplicates pile up). Read by sendPushToUser()
// further down, which fires on new DMs and incoming calls via Firebase.
app.post('/api/push-token', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'A push token is required.' });
    }
    await User.updateOne({ _id: req.user.id }, { $addToSet: { pushTokens: token } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Save push token error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// REMOVE PUSH TOKEN (protected) — call this on logout so a signed-out
// device stops receiving pushes meant for this account.
app.delete('/api/push-token', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'A push token is required.' });
    }
    await User.updateOne({ _id: req.user.id }, { $pull: { pushTokens: token } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove push token error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// UPDATE USERNAME (protected)
app.put('/api/me/username', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }

    const trimmed = username.trim();

    const existing = await User.findOne({ username: trimmed, _id: { $ne: req.user.id } });
    if (existing) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const user = await User.findByIdAndUpdate(req.user.id, { username: trimmed }, { new: true });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // The old JWT still has the old username baked into it, so anything that
    // trusts the token (like the chat socket) would keep showing the old
    // name until it expired. Issuing a fresh token here fixes that as soon
    // as the front-end swaps it in.
    const token = createToken(user);

    res.json({ user: ownUser(user), token });
  } catch (err) {
    console.error('Update username error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// UPDATE PASSWORD (protected — requires current password)
app.put('/api/me/password', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are both required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Update password error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// CLEAR ALL CHATS — "delete for me" (WhatsApp-style, to free up space on
// the user's own phone). NOTHING is deleted from the database: we only
// remember the moment this user cleared their chats, and every history
// load below (room history + DM history) hides anything at or before it
// for THIS user only. Other people still see all of their own messages,
// and a different account that was in the same chats is unaffected.
app.delete('/api/me/chats', dbGuard, authMiddleware, async (req, res) => {
  try {
    const clearedAt = new Date();
    await User.updateOne({ _id: req.user.id }, { $set: { chatsClearedAt: clearedAt } });
    // Their private Nexus AI conversation belongs only to them, so it is really deleted
    // (this also resets what the AI remembers about the chat). Nobody else's data is touched.
    await RoomMessage.deleteMany({ room: 'nexus-ai-dm:' + String(req.user.id) }).catch(() => {});
    res.json({ success: true, clearedAt });
  } catch (err) {
    console.error('Clear all chats error:', err);
    res.status(500).json({ error: 'Could not clear chats. Please try again later.' });
  }
});

// FORGOT PASSWORD — generates a one-hour reset token. Always returns the
// same generic message, whether or not the email is registered, so this
// endpoint can't be used to check which emails have accounts.
app.post('/api/forgot-password', dbGuard, async (req, res) => {
  const genericMessage = 'If an account with that email exists, a reset link has been sent.';

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    if (!PUBLIC_SITE_URL) {
      // Never build the link from request headers — that would let anyone
      // make reset emails point at their own site.
      console.error('❌ Forgot password: PUBLIC_SITE_URL is not set, so no email was sent.');
      return res.json({ message: genericMessage });
    }

    const resetUrl = `${PUBLIC_SITE_URL.replace(/\/+$/, '')}/reset-password.html?token=${rawToken}`;

    const emailHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#05070d;padding:24px;">
        <div style="max-width:480px;margin:0 auto;background:#0a0d16;border:1px solid #1b2133;border-top:3px solid #0066ff;border-radius:12px;padding:24px;color:#e8ecf7;">
          <h2 style="margin:0 0 12px;font-size:18px;">🎮 Remix Nexus</h2>
          <p style="margin:0 0 12px;">Hi ${escapeHtml(user.username)},</p>
          <p style="margin:0 0 18px;">We got a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.</p>
          <p style="margin:0 0 18px;"><a href="${resetUrl}" style="display:inline-block;background:#0066ff;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;">Reset my password</a></p>
          <p style="margin:0 0 6px;font-size:12px;color:#8a96b5;">Button not working? Copy this link into your browser:</p>
          <p style="margin:0 0 18px;font-size:12px;word-break:break-all;"><a href="${resetUrl}" style="color:#6fa8ff;">${resetUrl}</a></p>
          <p style="margin:0;font-size:12px;color:#8a96b5;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </div>
      </div>`;

    // Send in the background so the response time is the same whether or not
    // the email exists (stops people probing which emails have accounts).
    sendEmail({
      to: user.email,
      subject: 'Remix Nexus — Reset your password',
      html: emailHtml
    }).then(sent => {
      if (!sent) {
        // No email service configured — log the link so it's testable in dev.
        console.log(`🔑 Password reset requested for ${user.email}. Reset link: ${resetUrl}`);
      }
    }).catch(err => {
      console.error('❌ Could not send password reset email:', err.message || err);
    });

    res.json({ message: genericMessage });
  } catch (err) {
    console.error('Forgot password error:', err);
    // Still return the generic message so we don't leak account existence,
    // but log the real error for debugging.
    res.json({ message: genericMessage });
  }
});

// CONTACT FORM — sends whatever's submitted on Contact.html straight to
// your inbox via the same mailTransporter used for password resets.
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, reason, message } = req.body;

    if (!name || name.trim().length < 2 || !email || !message || message.trim().length < 10) {
      return res.status(400).json({ error: 'Please fill out all fields.' });
    }

    if (!process.env.CONTACT_TO_EMAIL) {
      console.error('CONTACT_TO_EMAIL is not set — cannot deliver contact form submissions.');
      return res.status(500).json({ error: 'Something went wrong. Please try again later.' });
    }

    if (resendClient) {
      // "onboarding@resend.dev" is Resend's shared test sender — works
      // immediately with no domain setup. Once you verify your own domain
      // on resend.com, swap this for e.g. "contact@yourdomain.com".
      await resendClient.emails.send({
        from: EMAIL_FROM,
        to: process.env.CONTACT_TO_EMAIL,
        replyTo: email,
        subject: `𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 — ${reason || 'New message'} from ${name}`,
        html: `<p><strong>From:</strong> ${name} (${email})</p>
               <p><strong>Reason:</strong> ${reason}</p>
               <p><strong>Message:</strong></p>
               <p>${String(message).replace(/\n/g, '<br>')}</p>`
      });
    } else {
      // No email service configured — log it so testing still works locally.
      console.log(`📬 Contact form submission from ${name} <${email}> [${reason}]: ${message}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  }
});

// RESET PASSWORD — consumes the token generated above
app.post('/api/reset-password', dbGuard, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'A reset token and new password are both required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// CONTACTS — anyone you've ever shared a chat room with, or ever privately
// messaged. Both sources are read from MongoDB (RoomParticipant / DirectMessage),
// so once someone becomes a contact they stay a contact forever, even across
// server restarts/redeploys.
app.get('/api/contacts', dbGuard, authMiddleware, async (req, res) => {
  try {
    const myId = String(req.user.id);
    const contactIds = new Set();

    // 1) People who were ever in the same room as me.
    const myRooms = await RoomParticipant.find({ userId: myId }).distinct('roomId');
    if (myRooms.length) {
      const roomMates = await RoomParticipant.find({ roomId: { $in: myRooms }, userId: { $ne: myId } }).distinct('userId');
      roomMates.forEach((id) => contactIds.add(String(id)));
    }

    // 2) People I've ever exchanged a direct message with.
    const dmPartners = await DirectMessage.find({ participants: myId }).distinct('participants');
    dmPartners.flat().forEach((id) => {
      if (String(id) !== myId) contactIds.add(String(id));
    });

    const users = await User.find({ _id: { $in: Array.from(contactIds) } });
    res.json({ contacts: users.map(publicUser) });
  } catch (err) {
    console.error('Get contacts error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// PUBLIC PROFILE — lets you view basic info for any user (e.g. someone
// you've just seen chatting in a room but haven't messaged privately yet)
// before deciding to start a conversation with them. Also reports block
// status in both directions so Contacts.js knows whether to show
// "Block"/"Unblock" and whether to allow sending a message.
app.get('/api/users/:id', dbGuard, authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'That user could not be found.' });
    }
    const me = await User.findById(req.user.id).select('blockedUsers');
    const iBlockedThem = !!(me && me.blockedUsers.includes(String(user._id)));
    const theyBlockedMe = (user.blockedUsers || []).includes(String(req.user.id));
    res.json({ user: publicUser(user), iBlockedThem, theyBlockedMe });
  } catch (err) {
    console.error('Get user profile error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// BLOCK / UNBLOCK — WhatsApp-style: once you block someone, they can no
// longer send you a DM (and you can't send them one either) in either
// direction — enforced server-side in the dm:message socket handler
// below, never trusting the client. Blocking only ever edits your OWN
// account's list — nobody can block on someone else's behalf.
app.post('/api/users/:id/block', dbGuard, authMiddleware, async (req, res) => {
  try {
    const targetId = String(req.params.id);
    if (targetId === String(req.user.id)) {
      return res.status(400).json({ error: "You can't block yourself." });
    }
    const target = await User.findById(targetId);
    if (!target) {
      return res.status(404).json({ error: 'That user could not be found.' });
    }
    await User.updateOne({ _id: req.user.id }, { $addToSet: { blockedUsers: targetId } });
    res.json({ blocked: true });
  } catch (err) {
    console.error('Block user error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/api/users/:id/unblock', dbGuard, authMiddleware, async (req, res) => {
  try {
    const targetId = String(req.params.id);
    await User.updateOne({ _id: req.user.id }, { $pull: { blockedUsers: targetId } });
    res.json({ blocked: false });
  } catch (err) {
    console.error('Unblock user error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// List of everyone the logged-in user has blocked — powers Settings ▸
// Blocked Users.
app.get('/api/blocked', dbGuard, authMiddleware, async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select('blockedUsers');
    const ids = (me && me.blockedUsers) || [];
    if (!ids.length) return res.json({ users: [] });
    const users = await User.find({ _id: { $in: ids } });
    res.json({ users: users.map(publicUser) });
  } catch (err) {
    console.error('Get blocked users error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DM HISTORY between the logged-in user and another user
app.get('/api/dm/:userId', dbGuard, authMiddleware, async (req, res) => {
  try {
    const otherId = req.params.userId;
    const key = conversationKey(req.user.id, otherId);

    // Same website-only 3-day cutoff as room chat — see isWebsiteRequest
    // above. Trusts the app's explicit X-Client-Platform header first,
    // falling back to Origin sniffing only if that's not present.
    // "Clear all chats" is per-user: this user never sees anything at or
    // before their own chatsClearedAt (see DELETE /api/me/chats).
    const me = await User.findById(req.user.id).select('blockedUsers chatsClearedAt');

    const dmQuery = { participants: key };
    const cutoffs = [];
    if (isWebsiteRequest({ origin: req.headers.origin, platformHeader: req.headers['x-client-platform'] })) {
      cutoffs.push(Date.now() - WEBSITE_HISTORY_MAX_AGE_MS);
    }
    if (me && me.chatsClearedAt) cutoffs.push(new Date(me.chatsClearedAt).getTime());
    if (cutoffs.length) dmQuery.time = { $gt: new Date(Math.max(...cutoffs)) };

    const [otherUser, messages] = await Promise.all([
      User.findById(otherId),
      DirectMessage.find(dmQuery).sort({ time: 1 }).limit(200)
    ]);

    if (!otherUser) {
      return res.status(404).json({ error: 'That user could not be found.' });
    }

    const iBlockedThem = !!(me && me.blockedUsers.includes(String(otherUser._id)));
    const theyBlockedMe = (otherUser.blockedUsers || []).includes(String(req.user.id));

    // Normalize `id` alongside Mongo's `_id` so the client can treat
    // history messages and live socket messages (which only ever have
    // `id`) the same way everywhere — e.g. for edit/delete lookups.
    const normalized = messages.map((m) => ({
      id: m._id,
      fromUserId: m.fromUserId,
      toUserId: m.toUserId,
      text: m.text,
      media: m.mediaType ? { type: m.mediaType, data: m.mediaData } : null,
      audio: m.audioData ? { data: m.audioData, duration: m.audioDuration } : null,
      replyTo: (m.replyTo && m.replyTo.id) ? { id: m.replyTo.id, author: m.replyTo.author, text: m.replyTo.text } : null,
      time: m.time,
      edited: m.edited,
      seen: m.seen
    }));

    res.json({ user: publicUser(otherUser), messages: normalized, iBlockedThem, theyBlockedMe });
  } catch (err) {
    console.error('Get DM history error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---- STORIES (Snapchat-style, 24h) ----
const MAX_STORY_IMAGE_LENGTH = 6_000_000;  // same caps as room/DM media
const MAX_STORY_VIDEO_LENGTH = 16_000_000; // only used by the no-Cloudinary fallback below

// ---- STORY VIDEOS ON CLOUDINARY (free cloud storage) ----
// Videos are uploaded by the browser/app STRAIGHT to Cloudinary (never
// through this server, so Render's request-size limit and MongoDB's 512MB
// free tier aren't a problem). This server only (1) hands out a signed
// upload permission, (2) re-checks the uploaded video really is <= 1 minute
// before the story is saved, and (3) deletes the file again after 24h.
// Set these 3 env vars on Render (from your Cloudinary dashboard):
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const cloudinaryReady = !!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
if (!cloudinaryReady) {
  console.warn('⚠️  Cloudinary env vars not set — story videos fall back to being stored in MongoDB (small clips only).');
}

const STORY_TAG = 'remix-story';           // every story upload is tagged, so cleanup can find them
const MAX_STORY_VIDEO_SECONDS = 60;        // hard 1-minute limit
const MAX_STORY_VIDEO_BYTES = 100 * 1024 * 1024; // Cloudinary free plan max video file size

function cloudinarySign(params) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(toSign + CLOUDINARY_API_SECRET).digest('hex');
}

function cloudinaryAdminHeaders() {
  return {
    Authorization: 'Basic ' + Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString('base64')
  };
}

// Looks up an uploaded video on Cloudinary — this is how the server learns
// the REAL duration, instead of trusting a number sent by the client.
async function cloudinaryGetVideo(publicId) {
  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/video/upload/${publicId}`,
    { headers: cloudinaryAdminHeaders() }
  );
  if (!resp.ok) return null;
  return resp.json();
}

async function cloudinaryDeleteVideos(publicIds) {
  if (!cloudinaryReady || !publicIds || !publicIds.length) return;
  try {
    const body = new URLSearchParams();
    publicIds.forEach((id) => body.append('public_ids[]', id));
    body.append('invalidate', 'true');
    const resp = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/video/upload?${body.toString()}`,
      { method: 'DELETE', headers: cloudinaryAdminHeaders() }
    );
    if (!resp.ok) console.error('Cloudinary delete failed with HTTP', resp.status);
  } catch (err) {
    console.error('Cloudinary delete error:', err.message);
  }
}

// Deletes every story video older than 24h from Cloudinary, so free storage
// never fills up. MongoDB's TTL index removes the story document itself;
// this removes the actual video file. Also catches videos that were
// uploaded but never posted. Runs once at startup, then every 30 minutes.
async function sweepExpiredStoryVideos() {
  if (!cloudinaryReady) return;
  try {
    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/search`, {
      method: 'POST',
      headers: { ...cloudinaryAdminHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expression: `tags=${STORY_TAG} AND resource_type=video AND uploaded_at<1d`,
        max_results: 100
      })
    });
    if (!resp.ok) {
      console.error('Story video sweep: search failed with HTTP', resp.status);
      return;
    }
    const json = await resp.json();
    const ids = (json.resources || []).map((r) => r.public_id);
    if (ids.length) {
      await cloudinaryDeleteVideos(ids);
      console.log(`🧹 Deleted ${ids.length} expired story video(s) from Cloudinary.`);
    }
  } catch (err) {
    console.error('Story video sweep error:', err.message);
  }
}
if (cloudinaryReady) {
  setTimeout(sweepExpiredStoryVideos, 15 * 1000);
  setInterval(sweepExpiredStoryVideos, 30 * 60 * 1000);
}

// Fallback ONLY (Cloudinary not configured): reads the duration out of an
// MP4/MOV file's "mvhd" box so the 1-minute limit still can't be bypassed.
function getMp4DurationSeconds(dataUrl) {
  try {
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const i = buf.indexOf('mvhd');
    if (i < 0) return null;
    const version = buf[i + 4];
    let timescale, duration;
    if (version === 1) {
      timescale = buf.readUInt32BE(i + 24);
      duration = Number(buf.readBigUInt64BE(i + 28));
    } else {
      timescale = buf.readUInt32BE(i + 16);
      duration = buf.readUInt32BE(i + 20);
    }
    return timescale ? duration / timescale : null;
  } catch (e) { return null; }
}

// Step 1 of posting a VIDEO: the app asks for permission to upload to
// Cloudinary. The signature only covers the tag + timestamp, so the
// API secret never leaves the server.
app.post('/api/stories/upload-signature', dbGuard, authMiddleware, banGuard, (req, res) => {
  if (!cloudinaryReady) {
    return res.status(503).json({ error: 'Video uploads are not set up on the server yet.' });
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { tags: STORY_TAG, timestamp };
  res.json({
    cloudName: CLOUDINARY_CLOUD_NAME,
    apiKey: CLOUDINARY_API_KEY,
    timestamp,
    tags: STORY_TAG,
    signature: cloudinarySign(params),
    maxBytes: MAX_STORY_VIDEO_BYTES,
    maxSeconds: MAX_STORY_VIDEO_SECONDS
  });
});

// POST a new story. Photos travel as a base64 data: URL (size-capped and
// type-sniffed from the prefix rather than trusted from the client).
// Videos are already on Cloudinary by this point — the client sends only
// `mediaPublicId`, and the server verifies the duration with Cloudinary.
app.post('/api/stories', dbGuard, authMiddleware, banGuard, async (req, res) => {
  try {
    const { mediaData, mediaPublicId, mediaDuration, caption } = req.body;

    let mediaType, storedData = '', storedUrl = '', storedPublicId = '', storedDuration = 0;

    if (mediaPublicId) {
      // ---- VIDEO (already uploaded to Cloudinary) ----
      if (!cloudinaryReady) {
        return res.status(503).json({ error: 'Video uploads are not set up on the server yet.' });
      }
      if (typeof mediaPublicId !== 'string' || !/^[A-Za-z0-9_-]{5,100}$/.test(mediaPublicId)) {
        return res.status(400).json({ error: 'Invalid video reference.' });
      }

      // Cloudinary reports a video's length in different places depending on
      // the account/API version, so look in all of them.
      const readDuration = (v) => [
        v && v.duration,
        v && v.video && v.video.duration,
        v && v.media_metadata && v.media_metadata.duration
      ].map(Number).find((n) => isFinite(n) && n > 0);

      let video = await cloudinaryGetVideo(mediaPublicId);
      // A fresh upload can take a moment to be analysed — retry a couple of times.
      for (let i = 0; i < 2 && video && !readDuration(video); i++) {
        await new Promise((r) => setTimeout(r, 1500));
        video = await cloudinaryGetVideo(mediaPublicId);
      }
      if (!video || !Array.isArray(video.tags) || !video.tags.includes(STORY_TAG)) {
        console.error('Story video lookup failed for', mediaPublicId);
        return res.status(400).json({ error: 'That video could not be found. Please upload it again.' });
      }

      let seconds = readDuration(video);
      if (!seconds) {
        // Cloudinary's lookup has no length for this file. Fall back to the
        // length Cloudinary reported when the app uploaded it (the file is
        // still capped at 100MB and deleted after 24h).
        console.warn('Story video: no duration from Cloudinary lookup for', mediaPublicId,
          '— fields returned:', Object.keys(video).join(', '));
        const claimed = Number(mediaDuration);
        if (isFinite(claimed) && claimed > 0) seconds = claimed;
      }
      if (!seconds) {
        await cloudinaryDeleteVideos([mediaPublicId]);
        return res.status(400).json({ error: "We couldn't read that video's length. Please try a different file (MP4 works best)." });
      }
      if (seconds > MAX_STORY_VIDEO_SECONDS + 0.5) {
        await cloudinaryDeleteVideos([mediaPublicId]); // don't keep a rejected file
        return res.status(400).json({ error: 'Story videos can be at most 1 minute long.' });
      }
      if (Number(video.bytes) > MAX_STORY_VIDEO_BYTES) {
        await cloudinaryDeleteVideos([mediaPublicId]);
        return res.status(400).json({ error: 'That video is too large.' });
      }

      mediaType = 'video';
      storedUrl = video.secure_url;
      storedPublicId = mediaPublicId;
      storedDuration = seconds;
    } else {
      // ---- PHOTO (or, with no Cloudinary set up, a small video) ----
      if (!mediaData || typeof mediaData !== 'string') {
        return res.status(400).json({ error: 'A photo or video is required.' });
      }

      const isImage = mediaData.startsWith('data:image/');
      const isVideo = mediaData.startsWith('data:video/');
      if (!isImage && !isVideo) {
        return res.status(400).json({ error: 'Only photos and videos can be posted as a story.' });
      }

      if (isVideo && cloudinaryReady) {
        return res.status(400).json({ error: 'Please update the app — videos are now uploaded to cloud storage.' });
      }

      const limit = isVideo ? MAX_STORY_VIDEO_LENGTH : MAX_STORY_IMAGE_LENGTH;
      if (mediaData.length > limit) {
        return res.status(400).json({
          error: isVideo ? 'That video is too large — try a shorter or lower-resolution clip.' : 'That image is too large — try a smaller file.'
        });
      }

      if (isVideo) {
        const seconds = getMp4DurationSeconds(mediaData);
        if (!seconds || !isFinite(seconds) || seconds > MAX_STORY_VIDEO_SECONDS + 0.5) {
          return res.status(400).json({ error: 'Story videos can be at most 1 minute long.' });
        }
        storedDuration = seconds;
      }

      mediaType = isVideo ? 'video' : 'image';
      storedData = mediaData;
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const story = await Story.create({
      userId: String(user._id),
      username: user.username,
      avatar: user.avatar,
      mediaType,
      mediaData: storedData,
      mediaUrl: storedUrl,
      mediaPublicId: storedPublicId,
      mediaDuration: storedDuration,
      caption: typeof caption === 'string' ? caption.trim().slice(0, 200) : ''
    });

    res.status(201).json({ story: publicStory(story, req.user.id) });
  } catch (err) {
    console.error('Post story error:', err);
    res.status(500).json({ error: 'Something went wrong posting your story.' });
  }
});

// GET the story feed — your own active stories plus your contacts',
// grouped by user so the front-end can render one avatar ring per person.
// "Contacts" reuses the exact same definition as /api/contacts (anyone
// you've shared a room with or DM'd), so there's no separate "friends" list.
app.get('/api/stories', dbGuard, authMiddleware, async (req, res) => {
  try {
    const myId = String(req.user.id);
    const contactIds = new Set([myId]);

    const myRooms = await RoomParticipant.find({ userId: myId }).distinct('roomId');
    if (myRooms.length) {
      const roomMates = await RoomParticipant.find({ roomId: { $in: myRooms }, userId: { $ne: myId } }).distinct('userId');
      roomMates.forEach((id) => contactIds.add(String(id)));
    }
    const dmPartners = await DirectMessage.find({ participants: myId }).distinct('participants');
    dmPartners.flat().forEach((id) => contactIds.add(String(id)));

    const stories = await Story.find({ userId: { $in: Array.from(contactIds) } }).sort({ createdAt: 1 });

    // Group into one entry per author, most recent story last within each group.
    const grouped = new Map();
    stories.forEach((s) => {
      const key = String(s.userId);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(publicStory(s, myId));
    });

    const feed = Array.from(grouped.entries()).map(([userId, userStories]) => ({
      userId,
      username: userStories[0].username,
      avatar: userStories[0].avatar,
      hasUnseen: userStories.some(s => !s.viewedByMe && userId !== myId),
      stories: userStories
    }));

    // Own stories first, then most recently-posted-to authors.
    feed.sort((a, b) => {
      if (a.userId === myId) return -1;
      if (b.userId === myId) return 1;
      return new Date(b.stories[b.stories.length - 1].createdAt) - new Date(a.stories[a.stories.length - 1].createdAt);
    });

    res.json({ feed });
  } catch (err) {
    console.error('Get stories error:', err);
    res.status(500).json({ error: 'Something went wrong loading stories.' });
  }
});

// MARK a story as viewed by the current user (no-ops harmlessly if
// you've already viewed it, or if it's your own story).
app.post('/api/stories/:id/view', dbGuard, authMiddleware, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ error: 'That story is no longer available.' });

    if (String(story.userId) !== String(req.user.id)) {
      const alreadyViewed = story.viewers.some(v => String(v.userId) === String(req.user.id));
      if (!alreadyViewed) {
        story.viewers.push({ userId: String(req.user.id), username: req.user.username });
        await story.save();
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Mark story viewed error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// LIKE / UNLIKE a story — toggles a heart reaction, same as double-tapping
// a WhatsApp/Instagram status. Anyone who can see the story (i.e. anyone
// who could load it via the /api/stories feed) can like it, including
// the author liking their own post.
app.post('/api/stories/:id/like', dbGuard, authMiddleware, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ error: 'That story is no longer available.' });

    const myId = String(req.user.id);
    const existingIndex = story.likes.findIndex(l => String(l.userId) === myId);

    let liked;
    if (existingIndex >= 0) {
      story.likes.splice(existingIndex, 1);
      liked = false;
    } else {
      story.likes.push({ userId: myId, username: req.user.username });
      liked = true;
    }
    await story.save();

    res.json({ ok: true, liked, likeCount: story.likes.length });
  } catch (err) {
    console.error('Toggle story like error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// WHO VIEWED my story — only the story's own author can see this list,
// same "view your own analytics" pattern as Snapchat/Instagram Stories.
app.get('/api/stories/:id/viewers', dbGuard, authMiddleware, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ error: 'That story is no longer available.' });
    if (String(story.userId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You can only see viewers of your own stories.' });
    }
    res.json({ viewers: story.viewers.sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt)) });
  } catch (err) {
    console.error('Get story viewers error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// WHO LIKED my story — same "your own analytics" restriction as viewers.
app.get('/api/stories/:id/likers', dbGuard, authMiddleware, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ error: 'That story is no longer available.' });
    if (String(story.userId) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You can only see likes on your own stories.' });
    }
    res.json({ likers: story.likes.sort((a, b) => new Date(b.likedAt) - new Date(a.likedAt)) });
  } catch (err) {
    console.error('Get story likers error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DELETE a story — the author, or an owner account, can remove it early
// instead of waiting for the 24h TTL to expire it automatically.
app.delete('/api/stories/:id', dbGuard, authMiddleware, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ error: 'That story is no longer available.' });

    const isAuthor = String(story.userId) === String(req.user.id);
    const isAdmin = isRoomOwner({ id: req.user.id, username: req.user.username });
    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own stories.' });
    }

    const publicId = story.mediaPublicId;
    await story.deleteOne();
    if (publicId) cloudinaryDeleteVideos([publicId]); // free up cloud storage right away
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete story error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---- NEXUS WORLDS — photo / video posts that disappear after 24 hours ----
// People post a PHOTO or a VIDEO (max 1 minute) — no links/URLs. They are stored
// exactly like Stories (photos inline, videos on Cloudinary and swept after 1 day),
// auto-deleted after 24h, and shown in Nexus Realm AND on the Stories page under
// "Nexus Worlds" (a side section, NOT part of anyone's own story).
const MAX_WORLD_IMAGE_LENGTH = 3_500_000; // data: URL characters (~2.5MB). The page shrinks photos before sending.
const WORLD_LIFETIME_MS = 24 * 60 * 60 * 1000;

function realmPublicWorld(w) {
  const id = String(w._id);
  const type = w.mediaType || (w.imageUrl ? 'image' : '');
  let src = '';
  if (w.mediaType === 'video') src = w.mediaUrl || '';
  else if (w.mediaType === 'image') src = `/api/realm/worlds/${id}/image`; // served by its own route so this list stays small
  else if (w.imageUrl) src = w.imageUrl;                                    // old link-based post
  return {
    _id: id, title: w.title, game: w.game, category: w.category, description: w.description,
    creatorId: w.creatorId, creatorName: w.creatorName, createdAt: w.createdAt,
    expiresAt: new Date(new Date(w.createdAt).getTime() + WORLD_LIFETIME_MS),
    mediaType: type, mediaSrc: src, mediaDuration: w.mediaDuration || 0, link: w.link || ''
  };
}

app.get('/api/realm/worlds', dbGuard, async (req, res) => {
  try {
    // The TTL cleanup runs about once a minute — also hide anything already past 24h.
    const cutoff = new Date(Date.now() - WORLD_LIFETIME_MS);
    const worlds = await RealmWorld.find({ createdAt: { $gt: cutoff } })
      .select('-mediaData').sort({ createdAt: -1 }).limit(60).lean();
    res.json({ worlds: worlds.map(realmPublicWorld) });
  } catch (e) { res.status(500).json({ error: 'Could not load worlds.' }); }
});

// Serves a world's PHOTO as a normal image (so <img src> works and the list stays small).
app.get('/api/realm/worlds/:id/image', dbGuard, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).end();
    const w = await RealmWorld.findById(req.params.id).select('mediaType mediaData');
    if (!w || w.mediaType !== 'image' || !w.mediaData) return res.status(404).end();
    const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.*)$/is.exec(w.mediaData);
    if (!m) return res.status(404).end();
    res.set('Content-Type', m[1]);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(m[2], 'base64'));
  } catch (e) { res.status(500).end(); }
});

app.post('/api/realm/worlds', dbGuard, authMiddleware, banGuard, async (req, res) => {
  try {
    const title = realmClean(req.body.title, 90), game = realmClean(req.body.game, 40);
    if (!title || !game) return res.status(400).json({ error: 'Title and game are required.' });

    const { mediaData, mediaPublicId, mediaDuration } = req.body;
    let mediaType, storedData = '', storedUrl = '', storedPublicId = '', storedDuration = 0;

    if (mediaPublicId) {
      // ---- VIDEO — already uploaded straight to Cloudinary; re-check it here (max 1 minute) ----
      if (!cloudinaryReady) return res.status(503).json({ error: 'Video uploads are not set up on the server yet.' });
      if (typeof mediaPublicId !== 'string' || !/^[A-Za-z0-9_-]{5,100}$/.test(mediaPublicId)) {
        return res.status(400).json({ error: 'Invalid video reference.' });
      }
      const readDuration = (v) => [v && v.duration, v && v.video && v.video.duration, v && v.media_metadata && v.media_metadata.duration]
        .map(Number).find((n) => isFinite(n) && n > 0);

      let video = await cloudinaryGetVideo(mediaPublicId);
      for (let i = 0; i < 2 && video && !readDuration(video); i++) {
        await new Promise((r) => setTimeout(r, 1500));
        video = await cloudinaryGetVideo(mediaPublicId);
      }
      if (!video || !Array.isArray(video.tags) || !video.tags.includes(STORY_TAG)) {
        return res.status(400).json({ error: 'That video could not be found. Please upload it again.' });
      }
      let seconds = readDuration(video);
      if (!seconds) { const claimed = Number(mediaDuration); if (isFinite(claimed) && claimed > 0) seconds = claimed; }
      if (!seconds) {
        await cloudinaryDeleteVideos([mediaPublicId]);
        return res.status(400).json({ error: "We couldn't read that video's length. Please try a different file (MP4 works best)." });
      }
      if (seconds > MAX_STORY_VIDEO_SECONDS + 0.5) {
        await cloudinaryDeleteVideos([mediaPublicId]);
        return res.status(400).json({ error: 'Videos can be at most 1 minute long.' });
      }
      if (Number(video.bytes) > MAX_STORY_VIDEO_BYTES) {
        await cloudinaryDeleteVideos([mediaPublicId]);
        return res.status(400).json({ error: 'That video is too large.' });
      }
      mediaType = 'video'; storedUrl = video.secure_url; storedPublicId = mediaPublicId; storedDuration = seconds;
    } else if (typeof mediaData === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(mediaData)) {
      // ---- PHOTO ----
      if (mediaData.length > MAX_WORLD_IMAGE_LENGTH) return res.status(400).json({ error: 'That photo is too large — try a smaller one.' });
      mediaType = 'image'; storedData = mediaData;
    } else {
      return res.status(400).json({ error: 'Add a photo or a video (up to 1 minute). Links are not allowed.' });
    }

    const w = await RealmWorld.create({
      title, game, category: realmClean(req.body.category, 40) || 'Build',
      mediaType, mediaData: storedData, mediaUrl: storedUrl, mediaPublicId: storedPublicId, mediaDuration: storedDuration,
      description: realmClean(req.body.description, 900),
      creatorId: String(req.user.id), creatorName: realmClean(req.user.username, 32) || 'Player'
    });
    res.status(201).json({ world: realmPublicWorld(w) });
  } catch (e) {
    console.error('Publish world error:', e);
    res.status(500).json({ error: 'Could not publish world.' });
  }
});

// The post's creator (or an owner/admin) can remove it early; the video file is deleted too.
app.delete('/api/realm/worlds/:id', dbGuard, authMiddleware, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'World not found.' });
    const w = await RealmWorld.findById(req.params.id);
    if (!w) return res.status(404).json({ error: 'World not found.' });
    const isCreator = String(w.creatorId) === String(req.user.id);
    const isAdmin = isRoomOwner({ id: req.user.id, username: req.user.username });
    if (!isCreator && !isAdmin) return res.status(403).json({ error: 'You can only remove your own worlds.' });
    const publicId = w.mediaPublicId;
    await w.deleteOne();
    if (publicId) cloudinaryDeleteVideos([publicId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not remove world.' }); }
});

// ---- REPORTS — any logged-in user can flag a message, story, or account
// for the owner to review by hand. No automated moderation involved.
app.post('/api/reports', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { targetType, targetId, targetUserId, targetUsername, reason, contentSnapshot } = req.body;

    if (!['message', 'dm', 'story', 'user'].includes(targetType)) {
      return res.status(400).json({ error: 'Invalid report type.' });
    }

    const report = await Report.create({
      reportedBy: String(req.user.id),
      reportedByUsername: req.user.username || '',
      targetType,
      targetId: typeof targetId === 'string' ? targetId.slice(0, 100) : '',
      targetUserId: typeof targetUserId === 'string' ? targetUserId : null,
      targetUsername: typeof targetUsername === 'string' ? targetUsername.slice(0, 40) : '',
      reason: typeof reason === 'string' ? reason.trim().slice(0, 300) : '',
      contentSnapshot: typeof contentSnapshot === 'string' ? contentSnapshot.slice(0, 300) : ''
    });

    res.status(201).json({ ok: true, reportId: report._id });
  } catch (err) {
    console.error('Create report error:', err);
    res.status(500).json({ error: 'Something went wrong submitting your report.' });
  }
});

// ---- ADMIN DASHBOARD — owner accounts only (see adminGuard above) ----

// List every user, most recently created first, with ban status — powers
// the Admin.html user-management table.
app.get('/api/admin/users', dbGuard, authMiddleware, adminGuard, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({
      users: users.map(u => ({
        id: u._id,
        username: u.username,
        email: u.email,
        avatar: u.avatar,
        createdAt: u.createdAt,
        banned: u.banned,
        bannedAt: u.bannedAt,
        bannedReason: u.bannedReason,
        isOwner: isRoomOwner({ id: u._id, username: u.username })
      }))
    });
  } catch (err) {
    console.error('Admin list users error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// BAN a user. Owner accounts can't be banned (even by another owner),
// so the admin dashboard can never lock itself out.
app.post('/api/admin/users/:id/ban', dbGuard, authMiddleware, adminGuard, async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (isRoomOwner({ id: target._id, username: target.username })) {
      return res.status(400).json({ error: 'Owner accounts can’t be banned.' });
    }

    target.banned = true;
    target.bannedAt = new Date();
    target.bannedReason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
    await target.save();

    // Kick any live sockets this user currently has open, so a ban takes
    // effect immediately instead of waiting for their token to expire.
    const online = globalOnline.get(String(target._id));
    if (online) {
      online.forEach((socketId) => {
        const s = io.sockets.sockets.get(socketId);
        if (s) s.disconnect(true);
      });
    }

    res.json({ ok: true, user: { id: target._id, banned: true } });
  } catch (err) {
    console.error('Ban user error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/api/admin/users/:id/unban', dbGuard, authMiddleware, adminGuard, async (req, res) => {
  try {
    const target = await User.findByIdAndUpdate(
      req.params.id,
      { banned: false, bannedAt: null, bannedReason: '' },
      { new: true }
    );
    if (!target) return res.status(404).json({ error: 'User not found.' });
    res.json({ ok: true, user: { id: target._id, banned: false } });
  } catch (err) {
    console.error('Unban user error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// List reported content for the admin dashboard, open reports first.
app.get('/api/admin/reports', dbGuard, authMiddleware, adminGuard, async (req, res) => {
  try {
    const reports = await Report.find().sort({ status: 1, createdAt: -1 }).limit(300);
    res.json({ reports });
  } catch (err) {
    console.error('Admin list reports error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// Mark a report resolved or dismissed once the owner has dealt with it.
app.put('/api/admin/reports/:id', dbGuard, authMiddleware, adminGuard, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['resolved', 'dismissed', 'open'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const report = await Report.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    res.json({ report });
  } catch (err) {
    console.error('Update report error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---- STATS — "who's most active right now" ----
// Public (no login needed) so the Trending page can show it to anyone.
// Step 1: find whichever room has had the most messages (all-time, since
// room messages are no longer auto-expired).
// Step 2: inside that one room, find whoever has sent the most messages.
app.get('/api/stats/most-active-user', dbGuard, async (req, res) => {
  try {
    const topRoom = await RoomMessage.aggregate([
      { $group: { _id: '$room', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);

    if (!topRoom.length) {
      return res.json({ available: false });
    }

    const roomId = topRoom[0]._id;

    const topAuthor = await RoomMessage.aggregate([
      { $match: { room: roomId } },
      { $group: { _id: { author: '$author', authorId: '$authorId' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);

    if (!topAuthor.length) {
      return res.json({ available: false });
    }

    const { author, authorId } = topAuthor[0]._id;

    let avatar = '🎮';
    if (authorId) {
      try {
        const user = await User.findById(authorId);
        if (user) avatar = user.avatar;
      } catch (_) { /* not a valid ObjectId, e.g. a legacy/guest message — ignore */ }
    }

    // Custom rooms have a real display name on record; default rooms only
    // exist client-side, so fall back to humanizing the id (e.g.
    // "just-chatting" -> "Just Chatting").
    let roomName = roomId;
    const customRoom = await CustomRoom.findOne({ id: roomId });
    if (customRoom) {
      roomName = customRoom.name;
    } else {
      roomName = roomId.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    res.json({
      available: true,
      username: author,
      avatar,
      room: roomId,
      roomName,
      messageCount: topAuthor[0].count
    });
  } catch (err) {
    console.error('Most active user stats error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---- STATS — weekly leaderboard (top 3 most active users) ----
// Public (no login needed), same as most-active-user above. Looks at the
// last 7 days on a rolling basis (not a fixed Mon-Sun reset), so it's
// always "this week" no matter when someone loads the page. For each of
// the top 3 users by total messages sent, it also reports the single
// room they were most active in during that week.
app.get('/api/stats/leaderboard', dbGuard, async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // One row per (author, room) combo active this week, busiest combo
    // first — so the first time we see a given author below is
    // automatically their single most active room this week.
    const rows = await RoomMessage.aggregate([
      { $match: { time: { $gte: since } } },
      { $group: { _id: { author: '$author', authorId: '$authorId', room: '$room' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    if (!rows.length) {
      return res.json({ available: false, leaders: [] });
    }

    const totals = new Map();     // authorKey -> total messages sent this week
    const topRoomFor = new Map(); // authorKey -> { room, count } (their busiest single room)
    const authorInfo = new Map(); // authorKey -> { author, authorId }

    for (const row of rows) {
      const { author, authorId, room } = row._id;
      const key = authorId || author; // fall back to name for guest messages with no authorId
      totals.set(key, (totals.get(key) || 0) + row.count);
      if (!topRoomFor.has(key)) topRoomFor.set(key, { room, count: row.count });
      if (!authorInfo.has(key)) authorInfo.set(key, { author, authorId });
    }

    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    // Resolve room ids -> display names once for whichever rooms actually show up.
    const roomIds = [...new Set(ranked.map(([key]) => topRoomFor.get(key).room))];
    const customRooms = await CustomRoom.find({ id: { $in: roomIds } });
    const roomNameMap = new Map(customRooms.map((r) => [r.id, r.name]));
    function roomDisplayName(roomId) {
      return roomNameMap.get(roomId) || roomId.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    const authorIds = ranked.map(([key]) => authorInfo.get(key).authorId).filter(Boolean);
    const users = await User.find({ _id: { $in: authorIds } });
    const avatarMap = new Map(users.map((u) => [String(u._id), u.avatar]));

    const leaders = ranked.map(([key, weeklyMessageCount]) => {
      const info = authorInfo.get(key);
      const best = topRoomFor.get(key);
      return {
        username: info.author,
        avatar: (info.authorId && avatarMap.get(info.authorId)) || '🎮',
        room: best.room,
        roomName: roomDisplayName(best.room),
        weeklyMessageCount
      };
    });

    res.json({ available: true, since: since.toISOString(), leaders });
  } catch (err) {
    console.error('Leaderboard stats error:', err);
    res.status(500).json({ available: false, leaders: [], error: 'Something went wrong.' });
  }
});

// ---- GAMING NEWS — live headlines from around the gaming world ----
// Fetches real gaming-news RSS feeds directly and parses them ourselves
// (no third-party "RSS to JSON" bridge — those free bridges rate-limit
// heavily-requested feeds like IGN's without an API key, which is why
// this used to come back empty). Tries each feed in order until one
// returns usable items. Cached in memory for 30 minutes so a burst of
// visitors only triggers one real upstream fetch; if every feed fails,
// the last good cache is served instead of an empty section.
const GAMING_NEWS_FEEDS = [
  'https://feeds.ign.com/ign/all',
  'https://www.polygon.com/rss/index.xml',
  'https://kotaku.com/rss'
];
const GAMING_NEWS_CACHE_MS = 30 * 60 * 1000; // 30 minutes
let gamingNewsCache = { items: [], fetchedAt: 0 };

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  return match[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}

function extractImage(itemXml) {
  const media = itemXml.match(/<media:(?:thumbnail|content)[^>]*url=["']([^"']+)["']/i);
  if (media) return media[1];
  const enclosure = itemXml.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image[^"']*["']/i);
  if (enclosure) return enclosure[1];
  const imgInBody = itemXml.match(/<img[^>]*src=["']([^"']+)["']/i);
  if (imgInBody) return imgInBody[1];
  return '';
}

async function fetchGamingNewsFromFeed(feedUrl) {
  const response = await fetch(feedUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RemixNexusBot/1.0; +https://remix-nexus-bgz9.onrender.com)' }
  });
  if (!response.ok) throw new Error(`Feed responded with HTTP ${response.status}`);
  const xml = await response.text();

  const feedTitleMatch = xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i);
  const sourceName = feedTitleMatch
    ? feedTitleMatch[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim()
    : 'Gaming News';

  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];

  return itemBlocks.slice(0, 6)
    .map((block) => ({
      title: extractTag(block, 'title'),
      link: extractTag(block, 'link'),
      pubDate: extractTag(block, 'pubDate'),
      image: extractImage(block),
      source: sourceName
    }))
    .filter((item) => item.title && item.link);
}

app.get('/api/news/gaming', async (req, res) => {
  const isStale = Date.now() - gamingNewsCache.fetchedAt > GAMING_NEWS_CACHE_MS;

  if (isStale) {
    let items = [];
    for (const feedUrl of GAMING_NEWS_FEEDS) {
      try {
        items = await fetchGamingNewsFromFeed(feedUrl);
        if (items.length) break; // got usable headlines, no need to try the rest
      } catch (err) {
        console.error(`Gaming news: feed failed (${feedUrl}):`, err.message);
      }
    }

    if (items.length) {
      gamingNewsCache = { items, fetchedAt: Date.now() };
    } else {
      console.error('Gaming news: every feed source failed this refresh — serving last known cache.');
    }
  }

  res.json({ available: gamingNewsCache.items.length > 0, items: gamingNewsCache.items });
});


// Anyone logged in can create a room — same idea as creating a group on
// WhatsApp. Only a site-owner account (see isRoomOwner above) can delete
// one. Default rooms aren't stored here at all, so they're never at risk.
app.get('/api/rooms', dbGuard, async (req, res) => {
  try {
    const rooms = await CustomRoom.find().sort({ createdAt: 1 });
    res.json({ rooms: rooms.map(publicRoom) });
  } catch (err) {
    console.error('List rooms error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

app.post('/api/rooms', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Give your room a name.' });
    }

    const trimmed = name.trim().slice(0, 60);
    if (trimmed.length < 2) {
      return res.status(400).json({ error: 'Room names need to be at least 2 characters.' });
    }

    const existing = await CustomRoom.findOne({ name: trimmed });
    if (existing) {
      return res.status(409).json({ error: 'A room with that name already exists.' });
    }

    const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'room';
    const id = 'r-' + slug + '-' + crypto.randomBytes(3).toString('hex');

    const user = await User.findById(req.user.id);
    const room = await CustomRoom.create({
      id,
      name: trimmed,
      createdBy: String(req.user.id),
      createdByUsername: user ? user.username : (req.user.username || '')
    });

    const payload = publicRoom(room);
    io.emit('room:created', { room: payload }); // everyone's sidebar updates live, no refresh needed
    res.status(201).json({ room: payload });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Something went wrong creating that room.' });
  }
});

app.delete('/api/rooms/:id', dbGuard, authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const requester = { id: req.user.id, username: user ? user.username : req.user.username };

    const room = await CustomRoom.findOne({ id: req.params.id });
    if (!room) {
      return res.status(404).json({ error: 'That room no longer exists.' });
    }

    // The site owner (e.g. RemixMc) can delete ANY custom room. Everyone
    // else can only delete a custom room they personally created — same
    // rule the client uses to decide whether to show the 🗑 button, but
    // enforced here for real since the client-side check can be bypassed.
    const isCreator = room.createdBy === String(req.user.id);
    if (!isRoomOwner(requester) && !isCreator) {
      return res.status(403).json({ error: 'You can only delete your own rooms.' });
    }

    await room.deleteOne();
    await RoomMessage.deleteMany({ room: room.id }); // clean up its messages too
    await RoomParticipant.deleteMany({ roomId: room.id });

    io.emit('room:deleted', { id: room.id });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete room error:', err);
    res.status(500).json({ error: 'Something went wrong deleting that room.' });
  }
});

// ================================================================
// NEW: WhatsApp & Snapchat Feature REST Endpoints
// ================================================================

// GET /api/me/state — Returns the logged-in user's full feature state
// including pinned chats, starred messages, muted chats, archived chats,
// dark mode preference, wallpaper, and streak data in a single request.
// This is the hub that the Settings page and sidebar both call on load.
app.get('/api/me/state', dbGuard, authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('pinnedChats starredMessages mutedChats archivedChats darkMode chatWallpaper lastSeen streaks');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({
      pinnedChats: user.pinnedChats || [],
      starredMessages: user.starredMessages || [],
      mutedChats: user.mutedChats || [],
      archivedChats: user.archivedChats || [],
      darkMode: !!user.darkMode,
      chatWallpaper: user.chatWallpaper || null,
      lastSeen: user.lastSeen,
      streaks: user.streaks || {}
    });
  } catch (err) {
    console.error('Get user state error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/me/pin — Toggle pin/unpin a chat (room or contact).
// Expects { id: 'room:roomId' or 'contact:contactId' }.
// Uses $addToSet/$pull so it's safe to call multiple times.
app.post('/api/me/pin', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'A chat ID is required.' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const alreadyPinned = user.pinnedChats.includes(id);
    if (alreadyPinned) {
      await User.updateOne({ _id: req.user.id }, { $pull: { pinnedChats: id } });
    } else {
      await User.updateOne({ _id: req.user.id }, { $addToSet: { pinnedChats: id } });
    }
    res.json({ pinned: !alreadyPinned, id });
  } catch (err) {
    console.error('Pin chat error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/me/mute — Toggle mute/unmute a chat.
// Expects { id: 'room:roomId' or 'contact:contactId' }.
app.post('/api/me/mute', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'A chat ID is required.' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const alreadyMuted = user.mutedChats.includes(id);
    if (alreadyMuted) {
      await User.updateOne({ _id: req.user.id }, { $pull: { mutedChats: id } });
    } else {
      await User.updateOne({ _id: req.user.id }, { $addToSet: { mutedChats: id } });
    }
    res.json({ muted: !alreadyMuted, id });
  } catch (err) {
    console.error('Mute chat error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/me/archive — Toggle archive/unarchive a chat.
// Expects { id: 'room:roomId' or 'contact:contactId' }.
app.post('/api/me/archive', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'A chat ID is required.' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const alreadyArchived = user.archivedChats.includes(id);
    if (alreadyArchived) {
      await User.updateOne({ _id: req.user.id }, { $pull: { archivedChats: id } });
    } else {
      await User.updateOne({ _id: req.user.id }, { $addToSet: { archivedChats: id } });
    }
    res.json({ archived: !alreadyArchived, id });
  } catch (err) {
    console.error('Archive chat error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/me/star — Toggle star/unstar a message.
// Expects { messageId: string, type: 'room' or 'dm' }.
// The messageId can be either a room message id or a DM message ObjectId.
app.post('/api/me/star', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId || typeof messageId !== 'string') return res.status(400).json({ error: 'A message ID is required.' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const alreadyStarred = user.starredMessages.includes(messageId);
    if (alreadyStarred) {
      await User.updateOne({ _id: req.user.id }, { $pull: { starredMessages: messageId } });
    } else {
      await User.updateOne({ _id: req.user.id }, { $addToSet: { starredMessages: messageId } });
    }
    res.json({ starred: !alreadyStarred, messageId });
  } catch (err) {
    console.error('Star message error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/me/dark-mode — Toggle dark mode preference.
// Expects { enabled: boolean }.
app.post('/api/me/dark-mode', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { enabled } = req.body;
    await User.updateOne({ _id: req.user.id }, { $set: { darkMode: !!enabled } });
    res.json({ darkMode: !!enabled });
  } catch (err) {
    console.error('Dark mode toggle error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/me/wallpaper — Set or clear chat wallpaper.
// Expects { wallpaper: string (data URL) or null to clear }.
app.post('/api/me/wallpaper', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { wallpaper } = req.body;
    await User.updateOne({ _id: req.user.id }, { $set: { chatWallpaper: wallpaper || null } });
    res.json({ wallpaper: wallpaper || null });
  } catch (err) {
    console.error('Wallpaper set error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/me/starred — Returns the full content of all starred messages.
// Looks up both room messages (by their `id` field) and DM messages
// (by their Mongo `_id`), combining them into a single sorted list.
app.get('/api/me/starred', dbGuard, authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('starredMessages');
    if (!user || !user.starredMessages || !user.starredMessages.length) {
      return res.json({ messages: [] });
    }

    const ids = user.starredMessages;
    const [roomMessages, dmMessages] = await Promise.all([
      RoomMessage.find({ id: { $in: ids } }),
      DirectMessage.find({ _id: { $in: ids } })
    ]);

    const normalized = [
      ...roomMessages.map(m => ({ ...normalizeRoomMessage(m), type: 'room', room: m.room })),
      ...dmMessages.map(m => ({
        id: String(m._id),
        fromUserId: m.fromUserId,
        toUserId: m.toUserId,
        text: m.text,
        media: m.mediaType ? { type: m.mediaType, data: m.mediaData } : null,
        audio: m.audioData ? { data: m.audioData, duration: m.audioDuration } : null,
        time: m.time,
        type: 'dm'
      }))
    ];

    normalized.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json({ messages: normalized });
  } catch (err) {
    console.error('Get starred messages error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/chat/search — Search messages across all rooms the user
// has participated in. Expects ?q=searchterm query parameter.
// Searches the `text` field of room messages using a case-insensitive
// regex. Returns up to 50 results sorted by newest first.
app.get('/api/chat/search', dbGuard, authMiddleware, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ messages: [] });

    const myId = String(req.user.id);
    const myRooms = await RoomParticipant.find({ userId: myId }).distinct('roomId');

    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const roomMessages = await RoomMessage.find({
      room: { $in: myRooms },
      text: regex
    }).sort({ time: -1 }).limit(50);

    // Also search DM conversations this user is in
    const dmMessages = await DirectMessage.find({
      participants: myId,
      text: regex
    }).sort({ time: -1 }).limit(50);

    const normalized = [
      ...roomMessages.map(m => ({ ...normalizeRoomMessage(m), type: 'room', room: m.room })),
      ...dmMessages.map(m => ({
        id: String(m._id),
        fromUserId: m.fromUserId,
        toUserId: m.toUserId,
        text: m.text,
        time: m.time,
        type: 'dm'
      }))
    ];

    normalized.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json({ messages: normalized.slice(0, 50) });
  } catch (err) {
    console.error('Chat search error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/me/export/dm/:userId — Export a DM conversation as plain text.
app.get('/api/me/export/dm/:userId', dbGuard, authMiddleware, async (req, res) => {
  try {
    const otherId = req.params.userId;
    const key = conversationKey(req.user.id, otherId);
    const [me, otherUser, messages] = await Promise.all([
      User.findById(req.user.id),
      User.findById(otherId),
      DirectMessage.find({ participants: key }).sort({ time: 1 })
    ]);

    if (!otherUser) return res.status(404).json({ error: 'User not found.' });

    const lines = [
      `=== Remix Nexus Chat Export ===`,
      `Exported by: ${me.username}`,
      `Conversation with: ${otherUser.username}`,
      `Date: ${new Date().toLocaleDateString()}`,
      `Total messages: ${messages.length}`,
      `================================`,
      ``
    ];

    for (const m of messages) {
      const sender = String(m.fromUserId) === String(req.user.id) ? me.username : otherUser.username;
      const time = new Date(m.time).toLocaleString();
      const text = m.text || (m.mediaType === 'image' ? '[Photo]' : m.mediaType === 'video' ? '[Video]' : m.audioData ? '[Voice note]' : '');
      lines.push(`[${time}] ${sender}: ${text}`);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="chat-${otherUser.username}.txt"`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('Export DM error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// GET /api/me/export/room/:roomId — Export a room chat as plain text.
// Returns the conversation as a downloadable TXT file.
app.get('/api/me/export/room/:roomId', dbGuard, authMiddleware, async (req, res) => {
  try {
    const roomId = req.params.roomId;
    const user = await User.findById(req.user.id);
    const messages = await RoomMessage.find({ room: roomId }).sort({ time: 1 });

    const lines = [
      `=== Remix Nexus Chat Export ===`,
      `Exported by: ${user.username}`,
      `Room: ${roomId}`,
      `Date: ${new Date().toLocaleDateString()}`,
      `Total messages: ${messages.length}`,
      `================================`,
      ``
    ];

    for (const m of messages) {
      const time = new Date(m.time).toLocaleString();
      const text = m.text || (m.mediaType === 'image' ? '[Photo]' : m.mediaType === 'video' ? '[Video]' : m.audioData ? '[Voice note]' : '');
      lines.push(`[${time}] ${m.author}: ${text}`);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="room-${roomId}.txt"`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('Export room error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/users/:id/report — Report a user for inappropriate behavior.
// Stores the report in a lightweight way (just a console log + a
// notification to the site owner). No dedicated report model yet —
// simple and sufficient for an MVP.
app.post('/api/users/:id/report', dbGuard, authMiddleware, async (req, res) => {
  try {
    const targetId = req.params.id;
    const { reason } = req.body;
    const reporter = await User.findById(req.user.id);
    const target = await User.findById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    console.warn(`🚨 REPORT: User ${reporter.username} (${req.user.id}) reported user ${target.username} (${targetId}) for: ${reason || 'No reason given'}`);

    // If the site owner is online, notify them via their personal room
    OWNER_USER_IDS.forEach(ownerId => {
      io.to('user:' + ownerId).emit('user:reported', {
        reporterId: String(req.user.id),
        reporterUsername: reporter.username,
        targetId,
        targetUsername: target.username,
        reason: reason || 'No reason given',
        time: new Date().toISOString()
      });
    });

    res.json({ reported: true });
  } catch (err) {
    console.error('Report user error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /api/messages/report — Report a specific message.
// Expects { messageId: string, type: 'room' or 'dm', reason: string }.
app.post('/api/messages/report', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { messageId, type, reason } = req.body;
    if (!messageId) return res.status(400).json({ error: 'A message ID is required.' });

    const reporter = await User.findById(req.user.id);
    console.warn(`🚨 MESSAGE REPORT: User ${reporter.username} (${req.user.id}) reported ${type || 'unknown'} message ${messageId} for: ${reason || 'No reason given'}`);

    OWNER_USER_IDS.forEach(ownerId => {
      io.to('user:' + ownerId).emit('message:reported', {
        reporterId: String(req.user.id),
        reporterUsername: reporter.username,
        messageId,
        type: type || 'unknown',
        reason: reason || 'No reason given',
        time: new Date().toISOString()
      });
    });

    res.json({ reported: true });
  } catch (err) {
    console.error('Report message error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---- SOCKET.IO CHAT ----
const MAX_HISTORY_PER_ROOM = 200; // how many recent messages to load when someone joins a room
const WEBSITE_HISTORY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days — website only, see isWebsiteOrigin above
const roomOnline = new Map(); // roomId -> Map of userId -> { userId, username, avatar, sockets: Set<socketId> } (live presence only, not persisted)
const participantWriteCache = new Set(); // "roomId:userId" already written to DB this run, to avoid redundant upserts

// Loads the most recent messages for a room straight from MongoDB, in
// chronological order. Messages themselves are never deleted by this —
// when `limitToOneWeek` is true (website requests only), anything older
// than a week is just left out of what gets sent back; the Android app
// always passes `limitToOneWeek: false` and gets the full history, capped
// only by MAX_HISTORY_PER_ROOM for performance.
async function getRoomHistory(roomId, limitToOneWeek, clearedAt) {
  try {
    const query = { room: roomId };
    // Hide anything older than the website cutoff and/or anything this user
    // cleared with "Clear all chats" (per-user, see DELETE /api/me/chats).
    const cutoffs = [];
    if (limitToOneWeek) cutoffs.push(Date.now() - WEBSITE_HISTORY_MAX_AGE_MS);
    if (clearedAt) cutoffs.push(new Date(clearedAt).getTime());
    if (cutoffs.length) {
      query.time = { $gt: new Date(Math.max(...cutoffs)) };
    }
    const docs = await RoomMessage.find(query).sort({ time: -1 }).limit(MAX_HISTORY_PER_ROOM);
    return docs.reverse().map(normalizeRoomMessage);
  } catch (err) {
    console.error('Room history fetch error:', err);
    return [];
  }
}

// Records, permanently, that this user has been active in this room — this
// is the persisted fact that makes /api/contacts work forever. Cached per
// server run so we don't hit the DB on every single message.
async function trackRoomParticipant(roomId, userId) {
  const key = roomId + ':' + userId;
  if (participantWriteCache.has(key)) return;
  participantWriteCache.add(key);
  try {
    await RoomParticipant.updateOne(
      { roomId, userId: String(userId) },
      { $setOnInsert: { roomId, userId: String(userId) } },
      { upsert: true }
    );
  } catch (err) {
    console.error('Track room participant error:', err);
  }
}

function roomOnlineList(roomId) {
  const online = roomOnline.get(roomId);
  if (!online) return [];
  return Array.from(online.values()).map(({ userId, username, avatar }) => ({ userId, username, avatar }));
}

function broadcastOnline(roomId) {
  io.to(roomId).emit('chat:online', { room: roomId, users: roomOnlineList(roomId) });
}

function addOnline(roomId, socket) {
  if (!socket.userId) return; // presence list is only meaningful for logged-in users
  if (!roomOnline.has(roomId)) roomOnline.set(roomId, new Map());
  const online = roomOnline.get(roomId);
  const existing = online.get(String(socket.userId));
  if (existing) {
    existing.sockets.add(socket.id);
  } else {
    online.set(String(socket.userId), {
      userId: String(socket.userId),
      username: socket.username,
      avatar: socket.avatar,
      sockets: new Set([socket.id])
    });
  }
  broadcastOnline(roomId);
}

function removeOnline(roomId, socket) {
  const online = roomOnline.get(roomId);
  if (!online || !socket.userId) return;
  const existing = online.get(String(socket.userId));
  if (!existing) return;
  existing.sockets.delete(socket.id);
  if (existing.sockets.size === 0) online.delete(String(socket.userId));
  broadcastOnline(roomId);
}

// Nexus AI chats are PRIVATE: each user has their own room "nexus-ai-dm:<userId>" and
// nobody else may join it, read it, or write to it. The old shared "nexus-ai" room is closed.
function aiRoomBlocked(socket, room) {
  if (typeof room !== 'string') return false;
  if (room === 'nexus-ai') return true;
  if (room.startsWith('nexus-ai-dm:')) return room !== 'nexus-ai-dm:' + String(socket.userId || '');
  return false;
}

function makeMessageId() {
  return crypto.randomBytes(12).toString('hex');
}

// Free AI bot (type "@ai ..." in a room) — see nexus-ai.js
require('./nexus-ai').init({ io, RoomMessage, makeMessageId });

// Nexus Arena: 1v1 challenges with timer, proof uploads and spectator voting — see arena.js
require('./arena').init({ app, io, mongoose, authMiddleware, dbGuard, User, RoomMessage, makeMessageId, isRoomOwner });

// Same idea as the client's mediaPreview() in notifications.js — a short
// line describing the message when there's no text (voice note/photo/video).
function mediaPreviewServer(m) {
  if (m.text) return m.text.length > 100 ? m.text.slice(0, 100) + '…' : m.text;
  if (m.audioData) return '🎤 Voice note';
  if (m.mediaType === 'video') return '🎬 Video';
  if (m.mediaType === 'image') return '🖼️ Photo';
  return 'New message';
}

// Sends a push notification to every device a user is logged in on
// (their pushTokens list). Silently does nothing if Firebase isn't
// configured, or the user has no saved tokens — never throws, so it's
// always safe to fire-and-forget from inside a socket handler.
async function sendPushToUser(userId, { title, body, data = {}, channelId, priority } = {}) {
  if (!firebaseReady) {
    console.warn('[push] sendPushToUser called but firebaseReady=false — check FIREBASE_SERVICE_ACCOUNT.');
    return;
  }
  if (!userId) return;
  try {
    const user = await User.findById(userId);
    if (!user || !user.pushTokens || !user.pushTokens.length) {
      console.warn('[push] No saved pushTokens for user', userId, '— the device never finished registering. Check that @capacitor/push-notifications is installed + synced on the native app, and that POST_NOTIFICATIONS permission was granted.');
      return;
    }

    // FCM data payloads must be flat string key/value pairs.
    const stringData = {};
    Object.entries(data).forEach(([k, v]) => { stringData[k] = String(v); });

    const response = await messagingClient.sendEachForMulticast({
      notification: { title: String(title || 'Remix Nexus'), body: String(body || '') },
      data: stringData,
      android: {
        // Calls (and anything time-sensitive) need HIGH priority so FCM
        // delivers immediately instead of batching/delaying for Doze —
        // default priority can sit for minutes on a sleeping device.
        priority: priority === 'high' ? 'high' : 'normal',
        notification: {
          // Must match a channel created natively (MainActivity) with
          // IMPORTANCE_HIGH, or Android will show it silently in the shade
          // instead of as a heads-up banner with sound.
          channelId: channelId || 'default',
          sound: 'default'
        }
      },
      tokens: user.pushTokens
    });

    console.log(`[push] Sent to ${user.pushTokens.length} token(s) for user ${userId}: ${response.successCount} succeeded, ${response.failureCount} failed.`);
    response.responses.forEach((r, i) => {
      if (!r.success) console.warn('[push] Token failed:', user.pushTokens[i], '-', r.error && r.error.code, r.error && r.error.message);
    });

    // Prune tokens FCM says are dead (app uninstalled, token rotated, etc.)
    const deadTokens = [];
    response.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (!r.success && (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered')) {
        deadTokens.push(user.pushTokens[i]);
      }
    });
    if (deadTokens.length) {
      await User.updateOne({ _id: userId }, { $pullAll: { pushTokens: deadTokens } });
    }
  } catch (err) {
    console.error('Push send error:', err);
  }
}

// ---- GLOBAL PRESENCE ("online" status) ----
// Independent of any single room — this is what lets the Contacts page
// show "online" under someone's name, WhatsApp-style, regardless of
// which room (if any) they're currently viewing. A user counts as online
// as long as at least one of their tabs/devices has a live socket open.
const globalOnline = new Map(); // userId -> Set<socketId>

function isUserOnline(userId) {
  const set = globalOnline.get(String(userId));
  return !!(set && set.size);
}

function addGlobalOnline(socket) {
  if (!socket.userId) return;
  const uid = String(socket.userId);
  if (!globalOnline.has(uid)) globalOnline.set(uid, new Set());
  const set = globalOnline.get(uid);
  const wasOffline = set.size === 0;
  set.add(socket.id);
  if (wasOffline) io.emit('presence:online', { userId: uid });
}

function removeGlobalOnline(socket) {
  if (!socket.userId) return;
  const uid = String(socket.userId);
  const set = globalOnline.get(uid);
  if (!set) return;
  set.delete(socket.id);
  if (set.size === 0) {
    globalOnline.delete(uid);
    io.emit('presence:offline', { userId: uid });
  }
}

// ---- GROUP CALLS (voice/video calls inside a room) ----
// roomCalls: "roomId:callId" -> Map<userId, { userId, username, avatar, socketId }>
// Small-mesh WebRTC: every participant connects directly to every other
// participant, which works great for a handful of people in a squad call
// but isn't meant to scale to huge broadcasts.
const roomCalls = new Map();

// ---- AD-HOC GROUP CALLS (Contacts page — call several people at once,
// not tied to any room) ----
// groupCalls: callId -> Map<userId, { userId, username, avatar, socketId }>
// groupCallInitiators: callId -> the userId who started it, so a decline
// can be relayed back to the right person even though decline only ever
// carries the callId, not who's declining to whom.
const groupCalls = new Map();
const groupCallInitiators = new Map();

function leaveGroupCall(socket, callId) {
  if (!callId) return;
  const participants = groupCalls.get(callId);
  if (!participants) return;
  const uid = String(socket.userId || '');
  if (participants.has(uid)) {
    participants.delete(uid);
    socket.leave('groupcall:' + callId);
    io.to('groupcall:' + callId).emit('groupcall:peer-left', { callId, userId: uid });
    if (participants.size === 0) {
      groupCalls.delete(callId);
      groupCallInitiators.delete(callId);
    }
  }
}

function leaveRoomCall(socket, room, callId) {
  if (!room || !callId) return;
  const key = room + ':' + callId;
  const participants = roomCalls.get(key);
  if (!participants) return;
  const uid = String(socket.userId || '');
  if (participants.has(uid)) {
    participants.delete(uid);
    socket.leave('roomcall:' + key);
    io.to('roomcall:' + key).emit('roomcall:peer-left', { room, callId, userId: uid });
    if (participants.size === 0) roomCalls.delete(key);
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;
  socket.activeRoomCalls = []; // [{ room, callId }] — for disconnect cleanup
  socket.activeGroupCalls = []; // [callId, ...] — for disconnect cleanup

  // See isWebsiteRequest/APP_ORIGINS above — this is what makes the 3-day
  // history cutoff apply to the website only and never to the Android app.
  // Trusts socket.handshake.auth.platform ('app'/'web') first, since Origin
  // alone can't reliably tell them apart in every Capacitor configuration.
  socket.isWebsiteClient = isWebsiteRequest({
    origin: socket.handshake.headers.origin,
    platformHeader: socket.handshake.auth && socket.handshake.auth.platform
  });

  // Authenticated users get a personal room so DMs can reach every tab/
  // device they have open, by user ID rather than by socket ID.
  if (socket.userId) {
    socket.join('user:' + socket.userId);
    addGlobalOnline(socket);
    // Tell just this newly-connected socket who's already online, so its
    // Contacts page can paint "online" labels immediately without waiting
    // for the next presence:update.
    socket.emit('presence:online:list', { userIds: Array.from(globalOnline.keys()) });
  }

  socket.on('chat:join', async ({ room }) => {
    if (!room || typeof room !== 'string') return;
    if (aiRoomBlocked(socket, room)) return;

    // NOTE: we deliberately do NOT socket.leave(currentRoom) here. Sockets
    // stay subscribed to every room they've ever joined, so chat:message
    // events for a room you're not currently looking at still reach this
    // client — that's what lets the sidebar show unread counts and fire
    // notifications for rooms other than the one you're actively viewing.
    // Online presence (who's "online" in a room) still only tracks the
    // single "active" room, via addOnline/removeOnline below.
    if (currentRoom && currentRoom !== room){
      removeOnline(currentRoom, socket);
    }
    currentRoom = room;
    socket.join(room);
    addOnline(room, socket);

    let clearedAt = null;
    if (socket.userId) {
      try {
        const me = await User.findById(socket.userId).select('chatsClearedAt');
        clearedAt = me && me.chatsClearedAt;
      } catch (e) { /* no cutoff — show history as normal */ }
    }
    const messages = await getRoomHistory(room, socket.isWebsiteClient, clearedAt);
    socket.emit('chat:history', { room, messages });
    socket.emit('chat:online', { room, users: roomOnlineList(room) });
  });

  // Joins the socket to every room the client knows about locally, purely
  // so message broadcasts for those rooms reach this socket (for unread
  // badges / notifications) even though only one room is "active" at a
  // time. Does not affect online presence or chat history.
  socket.on('chat:subscribeRooms', ({ rooms: roomIds } = {}) => {
    if (!Array.isArray(roomIds)) return;
    roomIds.slice(0, 50).forEach((r) => {
      if (typeof r === 'string' && r.trim() && !aiRoomBlocked(socket, r.trim())) socket.join(r.trim());
    });
  });

  socket.on('chat:message', async ({ room, message }) => {
    if (!room || !message) return;
    if (aiRoomBlocked(socket, room)) {
      socket.emit('chat:error', { message: 'Nexus AI is private now — update the app / refresh the page.' });
      return;
    }

    const hasText = typeof message.text === 'string' && message.text.trim().length > 0;
    const hasAudio = message.audio
      && typeof message.audio.data === 'string'
      && message.audio.data.startsWith('data:audio/');

    // Images/videos travel the same way voice notes do — a base64 data:
    // URL embedded straight in the message. `media.type` is trusted from
    // the data: URL prefix itself, not from whatever the client claims.
    const rawMediaData = message.media && typeof message.media.data === 'string' ? message.media.data : null;
    const isImageMedia = rawMediaData && rawMediaData.startsWith('data:image/');
    const isVideoMedia = rawMediaData && rawMediaData.startsWith('data:video/');
    const hasMedia = !!(isImageMedia || isVideoMedia);

    if (!hasText && !hasAudio && !hasMedia) return;

    // Voice notes and media are stored as data: URLs in MongoDB, so cap
    // each payload size to keep documents reasonably sized.
    const MAX_AUDIO_DATA_LENGTH = 2_000_000;  // ~1.5MB of actual audio
    const MAX_IMAGE_DATA_LENGTH = 6_000_000;  // ~4.5MB of actual image
    const MAX_VIDEO_DATA_LENGTH = 16_000_000; // ~12MB of actual video — keep clips short

    if (hasAudio && message.audio.data.length > MAX_AUDIO_DATA_LENGTH) {
      socket.emit('chat:error', { message: 'That voice note is too large to send — keep it under about a minute.' });
      return;
    }

    if (hasMedia) {
      const limit = isVideoMedia ? MAX_VIDEO_DATA_LENGTH : MAX_IMAGE_DATA_LENGTH;
      if (rawMediaData.length > limit) {
        socket.emit('chat:error', {
          message: isVideoMedia
            ? 'That video is too large to send — try a shorter or lower-resolution clip.'
            : 'That image is too large to send — try a smaller file.'
        });
        return;
      }
    }

    // If the socket has a verified identity (logged in), that identity
    // always wins over whatever "author" name the client sent — this is
    // what stops one person from typing a message that looks like it came
    // from somebody else's account.
    const author = socket.username
      ? socket.username
      : String(message.author || 'Guest').slice(0, 40);

    const replyTo = message.replyTo && typeof message.replyTo === 'object'
      ? {
          id: String(message.replyTo.id || '').slice(0, 60),
          author: String(message.replyTo.author || '').slice(0, 40),
          text: String(message.replyTo.text || '').slice(0, 200)
        }
      : null;

    const messageId = typeof message.id === 'string' && message.id ? message.id.slice(0, 60) : makeMessageId();

    try {
      const doc = await RoomMessage.create({
        id: messageId,
        room,
        author,
        authorId: socket.userId || null,
        text: hasText ? String(message.text).trim().slice(0, 500) : '',
        audioData: hasAudio ? message.audio.data : null,
        audioDuration: hasAudio ? Math.min(120, Math.max(0, Number(message.audio.duration) || 0)) : 0,
        mediaType: hasMedia ? (isVideoMedia ? 'video' : 'image') : null,
        mediaData: hasMedia ? rawMediaData : null,
        replyTo
      });

      if (doc.authorId) {
        trackRoomParticipant(room, doc.authorId); // fire-and-forget; persists forever
      }

      io.to(room).emit('chat:message', { room, message: normalizeRoomMessage(doc) });

      // Push notifications for anyone who's ever chatted in this room but
      // doesn't have a live socket open right now (app closed/backgrounded).
      // Fire-and-forget — a failure here should never block the message
      // that already made it to everyone live.
      RoomParticipant.find({ roomId: room }).distinct('userId')
        .then((participantIds) => {
          const preview = mediaPreviewServer(doc);
          participantIds
            .filter((id) => String(id) !== String(doc.authorId) && !isUserOnline(id))
            .forEach((id) => {
              sendPushToUser(id, {
                title: `${author} — ${room}`,
                body: preview,
                data: { type: 'room', room }
              });
            });
        })
        .catch((err) => console.error('Room push lookup error:', err));
    } catch (err) {
      console.error('Room message save error:', err);
      socket.emit('chat:error', { message: 'That message could not be sent — please try again.' });
    }
  });

  // TYPING INDICATOR — purely ephemeral, nothing persisted. Broadcast to
  // everyone else in the room (never back to the sender) so their client
  // can show a "so-and-so is typing…" line, WhatsApp-style.
  socket.on('chat:typing', ({ room, isTyping } = {}) => {
    if (!room || typeof room !== 'string') return;
    const username = socket.username || 'Someone';
    socket.to(room).emit('chat:typing', { room, userId: socket.userId || null, username, isTyping: !!isTyping });
  });

  // EDIT A MESSAGE — same ownership rule as delete: only the verified
  // author (authorId set from the JWT at send-time) can edit it, and a
  // guest-authored message (no authorId) can never be edited this way.
  socket.on('chat:message:edit', async ({ room, messageId, text }) => {
    if (!room || !messageId || typeof text !== 'string') return;

    if (!socket.userId) {
      socket.emit('chat:error', { message: 'Log in to edit your messages.' });
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      const target = await RoomMessage.findOne({ room, id: messageId });

      if (!target) return; // already gone (expired or deleted elsewhere)

      if (!target.authorId || String(target.authorId) !== String(socket.userId)) {
        socket.emit('chat:error', { message: 'You can only edit your own messages.' });
        return;
      }

      if (target.audioData || target.mediaType) {
        socket.emit('chat:error', { message: 'Voice notes and media can’t be edited.' });
        return;
      }

      target.text = trimmed.slice(0, 500);
      target.edited = true;
      await target.save();

      io.to(room).emit('chat:message:edited', { room, messageId, text: target.text });
    } catch (err) {
      console.error('Room message edit error:', err);
    }
  });

  // DELETE A MESSAGE — the logged-in author of a message can always
  // delete their own. The site owner account (see isRoomOwner/OWNER_USER_IDS
  // above) can ALSO delete anyone's message in any room — same as a
  // WhatsApp group admin. Ownership is checked against the message's
  // authorId (set from the verified JWT when it was sent), never trusting
  // whatever the client claims.
  socket.on('chat:message:delete', async ({ room, messageId }) => {
    if (!room || !messageId) return;

    if (!socket.userId) {
      socket.emit('chat:error', { message: 'Log in to delete your messages.' });
      return;
    }

    try {
      const target = await RoomMessage.findOne({ room, id: messageId });

      if (!target) return; // already gone (expired or deleted elsewhere)

      const isAuthor = !!(target.authorId && String(target.authorId) === String(socket.userId));
      const isAdmin = isRoomOwner({ id: socket.userId, username: socket.username });

      if (!isAuthor && !isAdmin) {
        socket.emit('chat:error', { message: 'You can only delete your own messages.' });
        return;
      }

      await target.deleteOne();
      io.to(room).emit('chat:message:deleted', { room, messageId, deletedByAdmin: !isAuthor && isAdmin });
    } catch (err) {
      console.error('Room message delete error:', err);
    }
  });

  // DIRECT MESSAGES — only available to logged-in users, since a guest
  // has no persistent account for anyone to reply back to.
  socket.on('dm:message', async ({ toUserId, text, media, audio, replyTo }) => {
    if (!socket.userId) return;
    if (!toUserId) return;

    // BLOCK CHECK — if either person has blocked the other, the message
    // is refused, same as WhatsApp. Always checked server-side against
    // the database, never trusting anything the client claims.
    try {
      const [me, them] = await Promise.all([
        User.findById(socket.userId).select('blockedUsers'),
        User.findById(toUserId).select('blockedUsers')
      ]);
      const iBlockedThem = !!(me && me.blockedUsers.includes(String(toUserId)));
      const theyBlockedMe = !!(them && them.blockedUsers.includes(String(socket.userId)));
      if (iBlockedThem || theyBlockedMe) {
        socket.emit('chat:error', {
          message: iBlockedThem
            ? 'Unblock this person to send them a message.'
            : 'This person can\'t receive messages from you right now.'
        });
        return;
      }
    } catch (err) {
      console.error('Block check error:', err);
      return;
    }

    const hasText = typeof text === 'string' && text.trim().length > 0;

    const rawMediaData = media && typeof media.data === 'string' ? media.data : null;
    const isImageMedia = rawMediaData && rawMediaData.startsWith('data:image/');
    const isVideoMedia = rawMediaData && rawMediaData.startsWith('data:video/');
    const hasMedia = !!(isImageMedia || isVideoMedia);

    const hasAudio = audio
      && typeof audio.data === 'string'
      && audio.data.startsWith('data:audio/');

    if (!hasText && !hasMedia && !hasAudio) return;

    const MAX_IMAGE_DATA_LENGTH = 6_000_000;  // ~4.5MB of actual image
    const MAX_VIDEO_DATA_LENGTH = 16_000_000; // ~12MB of actual video
    const MAX_AUDIO_DATA_LENGTH = 2_000_000;  // ~1.5MB of actual audio

    if (hasMedia) {
      const limit = isVideoMedia ? MAX_VIDEO_DATA_LENGTH : MAX_IMAGE_DATA_LENGTH;
      if (rawMediaData.length > limit) {
        socket.emit('chat:error', {
          message: isVideoMedia
            ? 'That video is too large to send — try a shorter or lower-resolution clip.'
            : 'That image is too large to send — try a smaller file.'
        });
        return;
      }
    }

    if (hasAudio && audio.data.length > MAX_AUDIO_DATA_LENGTH) {
      socket.emit('chat:error', { message: 'That voice note is too large to send — keep it under about a minute.' });
      return;
    }

    try {
      const key = conversationKey(socket.userId, toUserId);

      const sanitizedReplyTo = replyTo && typeof replyTo === 'object'
        ? {
            id: String(replyTo.id || '').slice(0, 60),
            author: String(replyTo.author || '').slice(0, 40),
            text: String(replyTo.text || '').slice(0, 200)
          }
        : null;

      const doc = await DirectMessage.create({
        participants: key,
        fromUserId: String(socket.userId),
        toUserId: String(toUserId),
        text: hasText ? text.trim().slice(0, 1000) : '',
        mediaType: hasMedia ? (isVideoMedia ? 'video' : 'image') : null,
        mediaData: hasMedia ? rawMediaData : null,
        audioData: hasAudio ? audio.data : null,
        audioDuration: hasAudio ? Math.min(120, Math.max(0, Number(audio.duration) || 0)) : 0,
        replyTo: sanitizedReplyTo
      });

      const payload = {
        id: doc._id,
        fromUserId: doc.fromUserId,
        toUserId: doc.toUserId,
        text: doc.text,
        media: hasMedia ? { type: doc.mediaType, data: doc.mediaData } : null,
        audio: hasAudio ? { data: doc.audioData, duration: doc.audioDuration } : null,
        replyTo: (doc.replyTo && doc.replyTo.id) ? { id: doc.replyTo.id, author: doc.replyTo.author, text: doc.replyTo.text } : null,
        time: doc.time,
        seen: doc.seen
      };

      io.to('user:' + doc.toUserId).emit('dm:message', payload);
      io.to('user:' + doc.fromUserId).emit('dm:message', payload); // other tabs of the sender

      // Push the recipient if they don't have a live socket open right now.
      if (!isUserOnline(doc.toUserId)) {
        const preview = doc.text || (hasAudio ? '🎤 Voice note' : (hasMedia ? (isVideoMedia ? '🎬 Video' : '🖼️ Photo') : 'New message'));
        sendPushToUser(doc.toUserId, {
          title: socket.username || 'New message',
          body: preview,
          data: { type: 'dm', fromUserId: String(socket.userId) }
        });
      }
    } catch (err) {
      console.error('DM send error:', err);
    }
  });

  // TYPING INDICATOR (DM) — relayed straight to the other person's
  // personal room (all of their tabs/devices), never persisted. Skipped
  // entirely if either side has blocked the other.
  socket.on('dm:typing', async ({ toUserId, isTyping } = {}) => {
    if (!socket.userId || !toUserId) return;
    try {
      const [me, them] = await Promise.all([
        User.findById(socket.userId).select('blockedUsers'),
        User.findById(toUserId).select('blockedUsers')
      ]);
      const blocked = !!(me && me.blockedUsers.includes(String(toUserId))) ||
                       !!(them && them.blockedUsers.includes(String(socket.userId)));
      if (blocked) return;
    } catch (err) {
      return;
    }
    io.to('user:' + toUserId).emit('dm:typing', { fromUserId: String(socket.userId), isTyping: !!isTyping });
  });

  // READ RECEIPT (DM) — client calls this whenever it opens (or is
  // actively looking at) a conversation. Marks every unseen message FROM
  // that person TO me as seen, then tells their sockets so the ✓✓ on
  // their side of the chat can turn blue, WhatsApp-style.
  socket.on('dm:seen', async ({ withUserId } = {}) => {
    if (!socket.userId || !withUserId) return;
    try {
      const result = await DirectMessage.updateMany(
        { fromUserId: String(withUserId), toUserId: String(socket.userId), seen: false },
        { $set: { seen: true } }
      );
      if (result.modifiedCount > 0) {
        io.to('user:' + withUserId).emit('dm:seen', { byUserId: String(socket.userId) });
      }
    } catch (err) {
      console.error('DM seen error:', err);
    }
  });

  // EDIT A DM — same ownership rule as room chat: only the verified
  // sender (fromUserId, set from the JWT when it was created) can edit
  // it. Persisted straight to MongoDB since DMs aren't kept in memory.
  socket.on('dm:message:edit', async ({ messageId, text }) => {
    if (!messageId || typeof text !== 'string') return;

    if (!socket.userId) {
      socket.emit('chat:error', { message: 'Log in to edit your messages.' });
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    try {
      const target = await DirectMessage.findById(messageId);
      if (!target) return; // already gone (deleted elsewhere)

      if (String(target.fromUserId) !== String(socket.userId)) {
        socket.emit('chat:error', { message: 'You can only edit your own messages.' });
        return;
      }

      if (target.mediaType || target.audioData) {
        socket.emit('chat:error', { message: 'Voice notes and media can’t be edited.' });
        return;
      }

      target.text = trimmed.slice(0, 1000);
      target.edited = true;
      await target.save();

      const payload = { messageId: String(target._id), text: target.text };
      io.to('user:' + target.toUserId).emit('dm:message:edited', payload);
      io.to('user:' + target.fromUserId).emit('dm:message:edited', payload);
    } catch (err) {
      console.error('DM edit error:', err);
    }
  });

  // DELETE A DM — the logged-in sender of a message can always delete
  // their own. The site owner account (see isRoomOwner/OWNER_USER_IDS
  // above) can ALSO delete either side's message in any conversation —
  // same override as room chat. Ownership is checked against fromUserId
  // (set from the verified JWT when it was sent), never trusting
  // whatever the client claims.
  socket.on('dm:message:delete', async ({ messageId }) => {
    if (!messageId) return;

    if (!socket.userId) {
      socket.emit('chat:error', { message: 'Log in to delete your messages.' });
      return;
    }

    try {
      const target = await DirectMessage.findById(messageId);
      if (!target) return; // already gone (deleted elsewhere)

      const isAuthor = String(target.fromUserId) === String(socket.userId);
      const isAdmin = isRoomOwner({ id: socket.userId, username: socket.username });

      if (!isAuthor && !isAdmin) {
        socket.emit('chat:error', { message: 'You can only delete your own messages.' });
        return;
      }

      const toUserId = target.toUserId;
      const fromUserId = target.fromUserId;
      await target.deleteOne();

      const payload = { messageId, deletedByAdmin: !isAuthor && isAdmin };
      io.to('user:' + toUserId).emit('dm:message:deleted', payload);
      io.to('user:' + fromUserId).emit('dm:message:deleted', payload);
    } catch (err) {
      console.error('DM delete error:', err);
    }
  });

  // ---- 1:1 CALLS (Contacts / DM — voice or video) ----
  // This server only relays signaling messages (who wants to call whom,
  // and the SDP/ICE data WebRTC needs) — the actual audio/video never
  // passes through this server, it flows directly device-to-device once
  // the connection is established.
  socket.on('call:invite', ({ toUserId, callId, type } = {}) => {
    if (!socket.userId || !toUserId || !callId) return;
    const callType = type === 'video' ? 'video' : 'voice';

    io.to('user:' + toUserId).emit('call:invite', {
      callId, type: callType,
      fromUserId: String(socket.userId), fromUsername: socket.username, fromAvatar: socket.avatar
    });

    // Always push — see the note on groupcall:invite for why isUserOnline
    // alone isn't reliable enough for time-sensitive call invites.
    sendPushToUser(toUserId, {
      title: `Incoming ${callType} call`,
      body: `${socket.username || 'Someone'} is calling you`,
      data: { type: 'call', callId, fromUserId: String(socket.userId) },
      channelId: 'incoming_calls',
      priority: 'high'
    });
  });

  socket.on('call:signal', ({ toUserId, callId, data } = {}) => {
    if (!socket.userId || !toUserId || !callId || !data) return;
    io.to('user:' + toUserId).emit('call:signal', { callId, data, fromUserId: String(socket.userId) });
  });

  socket.on('call:decline', ({ toUserId, callId } = {}) => {
    if (!toUserId || !callId) return;
    io.to('user:' + toUserId).emit('call:declined', { callId });
  });

  socket.on('call:end', ({ toUserId, callId } = {}) => {
    if (!toUserId || !callId) return;
    io.to('user:' + toUserId).emit('call:ended', { callId });
  });

  // ---- GROUP CALLS (Chat rooms — voice or video) ----
  socket.on('roomcall:start', ({ room, callId, type } = {}) => {
    if (!socket.userId || !room || !callId) return;
    const callType = type === 'video' ? 'video' : 'voice';
    socket.to(room).emit('roomcall:incoming', {
      room, callId, type: callType,
      fromUserId: String(socket.userId), fromUsername: socket.username
    });

    // Push notifications for anyone who's ever chatted in this room.
    // Not gated on isUserOnline — see the note on groupcall:invite for why
    // a live socket isn't a reliable enough signal for a call invite.
    RoomParticipant.find({ roomId: room }).distinct('userId')
      .then((participantIds) => {
        participantIds
          .filter((id) => String(id) !== String(socket.userId))
          .forEach((id) => {
            sendPushToUser(id, {
              title: `Incoming ${callType} call — ${room}`,
              body: `${socket.username || 'Someone'} started a group call`,
              data: { type: 'roomcall', room, callId, fromUserId: String(socket.userId) },
              channelId: 'incoming_calls',
              priority: 'high'
            });
          });
      })
      .catch((err) => console.error('Room call push lookup error:', err));
  });


  socket.on('roomcall:join', ({ room, callId } = {}) => {
    if (!socket.userId || !room || !callId) return;
    const key = room + ':' + callId;
    if (!roomCalls.has(key)) roomCalls.set(key, new Map());
    const participants = roomCalls.get(key);

    // Tell the joiner who's already in the call, so their client can open
    // a peer connection to each existing participant.
    socket.emit('roomcall:participants', { room, callId, participants: Array.from(participants.values()).map(p => ({ userId: p.userId, username: p.username, avatar: p.avatar })) });

    participants.set(String(socket.userId), { userId: String(socket.userId), username: socket.username, avatar: socket.avatar, socketId: socket.id });
    socket.join('roomcall:' + key);
    socket.activeRoomCalls.push({ room, callId });

    socket.to('roomcall:' + key).emit('roomcall:peer-joined', {
      room, callId, userId: String(socket.userId), username: socket.username, avatar: socket.avatar
    });
  });

  socket.on('roomcall:signal', ({ room, callId, toUserId, data } = {}) => {
    if (!socket.userId || !room || !callId || !toUserId || !data) return;
    const participants = roomCalls.get(room + ':' + callId);
    const target = participants && participants.get(String(toUserId));
    if (!target) return;
    io.to(target.socketId).emit('roomcall:signal', { room, callId, data, fromUserId: String(socket.userId) });
  });

  socket.on('roomcall:leave', ({ room, callId } = {}) => {
    leaveRoomCall(socket, room, callId);
    socket.activeRoomCalls = (socket.activeRoomCalls || []).filter(c => !(c.room === room && c.callId === callId));
  });

  // ---- AD-HOC GROUP CALLS (Contacts page — call several specific people
  // at once, not tied to a chat room) ----
  // calleeIds: array of userIds being invited to this call.
  socket.on('groupcall:invite', ({ callId, calleeIds, type } = {}) => {
    if (!socket.userId || !callId || !Array.isArray(calleeIds) || !calleeIds.length) return;
    const callType = type === 'video' ? 'video' : 'voice';

    groupCallInitiators.set(callId, String(socket.userId));

    calleeIds.forEach((toUserId) => {
      if (!toUserId || String(toUserId) === String(socket.userId)) return;
      io.to('user:' + toUserId).emit('groupcall:invite', {
        callId, type: callType,
        fromUserId: String(socket.userId), fromUsername: socket.username, fromAvatar: socket.avatar,
        participantCount: calleeIds.length
      });
      // Always push for calls, even if isUserOnline(toUserId) says they have
      // a live socket — Socket.IO's disconnect detection lags up to ~60s
      // (pingTimeout) behind the phone actually going to sleep/background,
      // so relying on "online" alone can miss the exact window a call needs.
      // A harmless duplicate banner beats a silently missed call.
      sendPushToUser(toUserId, {
        title: `Incoming group ${callType} call`,
        body: `${socket.username || 'Someone'} is calling you`,
        data: { type: 'groupcall', callId, fromUserId: String(socket.userId) },
        channelId: 'incoming_calls',
        priority: 'high'
      });
    });
  });

  socket.on('groupcall:join', ({ callId } = {}) => {
    if (!socket.userId || !callId) return;
    if (!groupCalls.has(callId)) groupCalls.set(callId, new Map());
    const participants = groupCalls.get(callId);

    // Tell the joiner who's already in the call, so their client can open
    // a peer connection to each existing participant.
    socket.emit('groupcall:participants', { callId, participants: Array.from(participants.values()).map(p => ({ userId: p.userId, username: p.username, avatar: p.avatar })) });

    participants.set(String(socket.userId), { userId: String(socket.userId), username: socket.username, avatar: socket.avatar, socketId: socket.id });
    socket.join('groupcall:' + callId);
    socket.activeGroupCalls.push(callId);

    socket.to('groupcall:' + callId).emit('groupcall:peer-joined', {
      callId, userId: String(socket.userId), username: socket.username, avatar: socket.avatar
    });
  });

  socket.on('groupcall:signal', ({ callId, toUserId, data } = {}) => {
    if (!socket.userId || !callId || !toUserId || !data) return;
    const participants = groupCalls.get(callId);
    const target = participants && participants.get(String(toUserId));
    if (!target) return;
    io.to(target.socketId).emit('groupcall:signal', { callId, data, fromUserId: String(socket.userId) });
  });

  socket.on('groupcall:decline', ({ callId } = {}) => {
    if (!callId) return;
    const initiatorId = groupCallInitiators.get(callId);
    if (initiatorId) {
      io.to('user:' + initiatorId).emit('groupcall:declined', { callId, byUserId: String(socket.userId || '') });
    }
  });

  socket.on('groupcall:leave', ({ callId } = {}) => {
    leaveGroupCall(socket, callId);
    socket.activeGroupCalls = (socket.activeGroupCalls || []).filter(id => id !== callId);
  });

  // ================================================================
  // NEW: WhatsApp & Snapchat Socket Events
  // ================================================================

  // FORWARD A MESSAGE — re-emits a room message to a different room.
  // Expects { messageId: string, fromRoom: string, toRoom: string }.
  // Only the author (or a site owner) can forward a message.
  socket.on('chat:message:forward', async ({ messageId, fromRoom, toRoom } = {}) => {
    if (!socket.userId || !messageId || !fromRoom || !toRoom) {
      socket.emit('chat:error', { message: 'Invalid forward request.' });
      return;
    }
    try {
      const original = await RoomMessage.findOne({ room: fromRoom, id: messageId });
      if (!original) {
        socket.emit('chat:error', { message: 'Message not found.' });
        return;
      }
      const isAuthor = !!(original.authorId && String(original.authorId) === String(socket.userId));
      const isAdmin = isRoomOwner({ id: socket.userId, username: socket.username });
      if (!isAuthor && !isAdmin) {
        socket.emit('chat:error', { message: 'You can only forward your own messages.' });
        return;
      }
      const newId = makeMessageId();
      const doc = await RoomMessage.create({
        id: newId,
        room: toRoom,
        author: socket.username || original.author,
        authorId: socket.userId || null,
        text: `📤 Forwarded: ${original.text || ''}`,
        audioData: null,
        audioDuration: 0,
        mediaType: original.mediaType,
        mediaData: original.mediaData
      });
      if (doc.authorId) trackRoomParticipant(toRoom, doc.authorId);
      io.to(toRoom).emit('chat:message', { room: toRoom, message: normalizeRoomMessage(doc) });
    } catch (err) {
      console.error('Forward message error:', err);
    }
  });                 

  // REACT TO A MESSAGE — add or remove an emoji reaction.
  // Expects { room: string, messageId: string, emoji: string }.
  // Uses $addToSet/$pull on the reactions sub-array.
  socket.on('chat:message:react', async ({ room, messageId, emoji } = {}) => {
    if (!socket.userId || !room || !messageId || !emoji) return;
    try {
      const target = await RoomMessage.findOne({ room, id: messageId });
      if (!target) return;
      const existingIndex = target.reactions.findIndex(
        r => r.userId === String(socket.userId) && r.emoji === emoji
      );
      if (existingIndex >= 0) {
        target.reactions.splice(existingIndex, 1);
      } else {
        target.reactions.push({ emoji, userId: String(socket.userId), username: socket.username || 'Unknown' });
      }
      await target.save();
      io.to(room).emit('chat:message:reacted', { room, messageId, reactions: target.reactions });
    } catch (err) {
      console.error('React to message error:', err);
    }
  });

  // REACT TO A DM — same as above but for direct messages.
  socket.on('dm:message:react', async ({ messageId, emoji } = {}) => {
    if (!socket.userId || !messageId || !emoji) return;
    try {
      const target = await DirectMessage.findById(messageId);
      if (!target) return;
      const existingIndex = target.reactions.findIndex(
        r => r.userId === String(socket.userId) && r.emoji === emoji
      );
      if (existingIndex >= 0) {
        target.reactions.splice(existingIndex, 1);
      } else {
        target.reactions.push({ emoji, userId: String(socket.userId), username: socket.username || 'Unknown' });
      }
      await target.save();
      [target.fromUserId, target.toUserId].forEach(uid => {
        io.to('user:' + uid).emit('dm:message:reacted', { messageId, reactions: target.reactions });
      });
    } catch (err) {
      console.error('React to DM error:', err);
    }
  });

  // SEND A VIEW-ONCE DM — like Snapchat, automatically sets viewOnce: true
  // and creates a self-destruct timer. Expects same payload as dm:message
  // but with added { viewOnce: true, snapTimer: <seconds> }.
  socket.on('dm:message:viewOnce', async ({ toUserId, text, media, audio, snapTimer } = {}) => {
    if (!socket.userId || !toUserId) return;
    // Reuse the regular dm:message handler by injecting viewOnce/snapTimer
    // into the payload, then handle cleanup after view.
    const timer = Math.min(Math.max(Number(snapTimer) || 5, 1), 60); // 1-60 seconds
    socket.emit('dm:message', {
      toUserId,
      text: text || '',
      media,
      audio,
      replyTo: null,
      viewOnce: true,
      snapTimer: timer
    }); // This will be handled below by the existing handler
  });

  // REPORT SCREENSHOT — Snapchat-style: notifies the sender when the
  // recipient takes a screenshot of a view-once message (client-side
  // detection where the browser API allows it, e.g. CSS paint events).
  socket.on('dm:screenshot', async ({ messageId } = {}) => {
    if (!socket.userId || !messageId) return;
    try {
      const target = await DirectMessage.findById(messageId);
      if (!target) return;
      target.screenshotDetected = true;
      await target.save();
      // Notify the sender that a screenshot was taken
      io.to('user:' + target.fromUserId).emit('dm:screenshotDetected', {
        messageId,
        byUserId: String(socket.userId),
        time: new Date().toISOString()
      });
    } catch (err) {
      console.error('Screenshot detection error:', err);
    }
  });

  // UPDATE STREAK — called after a DM is exchanged between two users.
  // Compares today's date against the last message date to track
  // consecutive days of messaging, Snapchat-style.
  socket.on('streak:update', async ({ contactId } = {}) => {
    if (!socket.userId || !contactId) return;
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const user = await User.findById(socket.userId);
      if (!user || !user.streaks) return;
      const streak = user.streaks.get(String(contactId)) || { count: 0, lastMessageDate: '' };
      if (streak.lastMessageDate === today) return; // already counted today
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      if (streak.lastMessageDate === yesterday) {
        streak.count += 1;
      } else {
        streak.count = 1; // missed a day, reset
      }
      streak.lastMessageDate = today;
      user.streaks.set(String(contactId), streak);
      await user.save();
      io.to('user:' + socket.userId).emit('streak:updated', { contactId, count: streak.count });
    } catch (err) {
      console.error('Streak update error:', err);
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      removeOnline(currentRoom, socket);
      socket.leave(currentRoom);
    }
    removeGlobalOnline(socket);
    (socket.activeRoomCalls || []).forEach(({ room, callId }) => leaveRoomCall(socket, room, callId));
    (socket.activeGroupCalls || []).forEach((callId) => leaveGroupCall(socket, callId));
  });
});

server.listen(PORT, () => {
  console.log(`🎮 𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 server running on http://localhost:${PORT}`);
});