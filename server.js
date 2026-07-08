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

// nodemailer is optional — if it isn't installed, or EMAIL_USER/EMAIL_PASS
// aren't set, forgot-password still works, it just logs the reset link to
// the server console instead of emailing it (handy for local testing).
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (err) { /* not installed — that's fine */ }

// firebase-admin sends push notifications through FCM — this is what
// reaches a user even when the app is fully closed (not just backgrounded).
// Run: npm install firebase-admin
let admin = null;
try { admin = require('firebase-admin'); } catch (err) { /* not installed yet — see setup notes */ }

let firebaseReady = false;
if (admin && process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    // Paste the whole service-account JSON (from Firebase Console) as a
    // single-line string into this env var.
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    firebaseReady = true;
    console.log('✅ Firebase Admin initialized — push notifications enabled');
  } catch (err) {
    console.error('❌ Firebase Admin init error:', err.message);
  }
} else {
  console.warn('⚠️  FIREBASE_SERVICE_ACCOUNT not set — push notifications to closed/background apps will not be sent yet.');
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

if (!MONGODB_URI) {
  console.warn('⚠️  MONGODB_URI is not set. Signup/login/profile will not work until you add it to your .env file.');
}
if (!JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set. Add a long random string to your .env file before going live.');
}

// ---- MIDDLEWARE ----
app.use(express.json());
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,   // your real website (keep using env var if you already had one)
  'https://localhost',           // Capacitor default origin on Android
  'capacitor://localhost'        // Capacitor default origin on iOS (safe to include even if you don't build iOS yet)
];

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

// ---- DATABASE ----
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch((err) => console.error('❌ MongoDB connection error:', err.message));
}

// ---- HTTP + SOCKET.IO SERVER ----
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
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
  createdAt: { type: Date, default: Date.now },
  resetPasswordTokenHash: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  // FCM device tokens — a user can be logged in on more than one device/
  // browser, so this is a list, not a single string. A push is sent to
  // every token here whenever this user gets a new room message or DM.
  pushTokens: { type: [String], default: [] }
});

const User = mongoose.model('User', userSchema);

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
  time: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false }
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

// ---- ROOM MESSAGE MODEL ----
// Room chat used to live only in an in-memory Map, which meant every
// redeploy/restart wiped every room's history. Persisting it here means
// messages survive redeploys — they only disappear once MongoDB's TTL
// index below actually expires them, 3 days after they were sent.
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
  edited: { type: Boolean, default: false }
});

roomMessageSchema.index({ room: 1, time: 1 });
// TTL index: MongoDB automatically deletes a document 3 days after its
// `time` value, regardless of server restarts/redeploys in between.
roomMessageSchema.index({ time: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

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
    edited: m.edited
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
    res.json({ user: publicUser(user) });
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

    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Update avatar error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// Expose the allowed avatar list so the front-end never hardcodes it twice
app.get('/api/avatar-options', (req, res) => {
  res.json({ options: AVATAR_OPTIONS });
});

// DOWNLOAD THE ANDROID APP — serves the signed release APK sitting in
// /downloads on this same server. res.download() sets the headers that
// make the browser save the file instead of trying to open/render it,
// which is what a plain <a href="..."> link can't reliably guarantee on
// its own, especially for a cross-origin download link.
app.get('/download/app', (req, res) => {
  const apkPath = path.join(__dirname, 'downloads', 'remix-nexus.apk');
  res.download(apkPath, 'RemixNexus.apk', (err) => {
    if (err) {
      console.error('APK download error:', err.message);
      if (!res.headersSent) {
        res.status(404).json({ error: 'The app download is not available right now.' });
      }
    }
  });
});

// SAVE PUSH TOKEN (protected) — called once by the Android app right
// after it registers with Firebase, so we know where to send pushes for
// this user. $addToSet means calling this again with the same token is
// harmless (no duplicates pile up).
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

    res.json({ user: publicUser(user), token });
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

    const resetUrl = `${PUBLIC_SITE_URL}/reset-password.html?token=${rawToken}`;

    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: '𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 — Reset your password',
        html: `<p>Hi ${user.username},</p>
               <p>Click the link below to reset your password. This link expires in 1 hour.</p>
               <p><a href="${resetUrl}">${resetUrl}</a></p>
               <p>If you didn't request this, you can safely ignore this email.</p>`
      });
    } else {
      // No email service configured yet — log the link so the flow is
      // still fully testable during development.
      console.log(`🔑 Password reset requested for ${user.email}. Reset link: ${resetUrl}`);
    }

    res.json({ message: genericMessage });
  } catch (err) {
    console.error('Forgot password error:', err);
    // Still return the generic message so we don't leak account existence,
    // but log the real error for debugging.
    res.json({ message: genericMessage });
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
// before deciding to start a conversation with them.
app.get('/api/users/:id', dbGuard, authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'That user could not be found.' });
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Get user profile error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// DM HISTORY between the logged-in user and another user
app.get('/api/dm/:userId', dbGuard, authMiddleware, async (req, res) => {
  try {
    const otherId = req.params.userId;
    const key = conversationKey(req.user.id, otherId);

    const [otherUser, messages] = await Promise.all([
      User.findById(otherId),
      DirectMessage.find({ participants: key }).sort({ time: 1 }).limit(200)
    ]);

    if (!otherUser) {
      return res.status(404).json({ error: 'That user could not be found.' });
    }

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
      time: m.time,
      edited: m.edited
    }));

    res.json({ user: publicUser(otherUser), messages: normalized });
  } catch (err) {
    console.error('Get DM history error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---- SOCKET.IO CHAT ----
const MAX_HISTORY_PER_ROOM = 200; // how many recent messages to load when someone joins a room
const roomOnline = new Map(); // roomId -> Map of userId -> { userId, username, avatar, sockets: Set<socketId> } (live presence only, not persisted)
const participantWriteCache = new Set(); // "roomId:userId" already written to DB this run, to avoid redundant upserts

// Loads the most recent messages for a room straight from MongoDB, in
// chronological order. Expired messages (older than 3 days) are already gone
// by this point, since MongoDB's TTL index removes them automatically.
async function getRoomHistory(roomId) {
  try {
    const docs = await RoomMessage.find({ room: roomId }).sort({ time: -1 }).limit(MAX_HISTORY_PER_ROOM);
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

function makeMessageId() {
  return crypto.randomBytes(12).toString('hex');
}

// Same idea as the client's mediaPreview() in notifications.js — a short
// line describing the message when there's no text (voice note/photo/video).
function mediaPreviewServer(m) {
  if (m.text) return m.text.length > 100 ? m.text.slice(0, 100) + '…' : m.text;
  if (m.audioData) return '🎤 Voice note';
  if (m.mediaType === 'video') return '🎬 Video';
  if (m.mediaType === 'image') return '🖼️ Photo';
  return 'New message';
}

// Sends a push through Firebase to every device token belonging to the
// given user IDs. Safe to call even if Firebase isn't configured yet —
// it just quietly does nothing (in-app notifications still work).
async function sendPushToUsers(userIds, { title, body, data }) {
  if (!firebaseReady || !userIds || !userIds.length) return;

  try {
    const users = await User.find(
      { _id: { $in: userIds }, pushTokens: { $exists: true, $ne: [] } },
      { pushTokens: 1 }
    );

    const tokens = users.flatMap((u) => u.pushTokens);
    if (!tokens.length) return;

    const message = {
      notification: { title, body },
      // FCM data payloads must be flat string-to-string maps.
      data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
      tokens
    };

    const result = await admin.messaging().sendEachForMulticast(message);

    // Prune tokens Firebase reports as dead (app uninstalled, token
    // expired, etc.) so we stop wasting sends on them.
    const deadTokens = [];
    result.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          deadTokens.push(tokens[i]);
        }
      }
    });

    if (deadTokens.length) {
      await User.updateMany({}, { $pull: { pushTokens: { $in: deadTokens } } });
    }
  } catch (err) {
    console.error('Push send error:', err.message);
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;

  // Authenticated users get a personal room so DMs can reach every tab/
  // device they have open, by user ID rather than by socket ID.
  if (socket.userId) {
    socket.join('user:' + socket.userId);
  }

  socket.on('chat:join', async ({ room }) => {
    if (!room || typeof room !== 'string') return;

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

    const messages = await getRoomHistory(room);
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
      if (typeof r === 'string' && r.trim()) socket.join(r.trim());
    });
  });

  socket.on('chat:message', async ({ room, message }) => {
    if (!room || !message) return;

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

      // Push notification to everyone who has ever chatted in this room,
      // except the sender — this is what reaches them even if the app is
      // fully closed, not just backgrounded. Fire-and-forget: a slow or
      // failed push should never hold up the chat itself.
      RoomParticipant.find({ roomId: room }).then((participants) => {
        const recipientIds = participants
          .map((p) => p.userId)
          .filter((id) => String(id) !== String(doc.authorId));

        if (recipientIds.length) {
          sendPushToUsers(recipientIds, {
            title: `${author} — ${room.charAt(0).toUpperCase() + room.slice(1)}`,
            body: mediaPreviewServer(doc),
            data: { type: 'room', room }
          });
        }
      }).catch((err) => console.error('Room push lookup error:', err));
    } catch (err) {
      console.error('Room message save error:', err);
      socket.emit('chat:error', { message: 'That message could not be sent — please try again.' });
    }
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

  // DELETE A MESSAGE — only the logged-in author of a message can delete
  // it. Ownership is checked against the message's authorId (set from the
  // verified JWT when it was sent), never trusting whatever the client
  // claims, so nobody can delete someone else's message. Guest-authored
  // messages (authorId is null) can't be deleted this way at all, since a
  // guest has no persistent identity to prove ownership with.
  socket.on('chat:message:delete', async ({ room, messageId }) => {
    if (!room || !messageId) return;

    if (!socket.userId) {
      socket.emit('chat:error', { message: 'Log in to delete your messages.' });
      return;
    }

    try {
      const target = await RoomMessage.findOne({ room, id: messageId });

      if (!target) return; // already gone (expired or deleted elsewhere)

      if (!target.authorId || String(target.authorId) !== String(socket.userId)) {
        socket.emit('chat:error', { message: 'You can only delete your own messages.' });
        return;
      }

      await target.deleteOne();
      io.to(room).emit('chat:message:deleted', { room, messageId });
    } catch (err) {
      console.error('Room message delete error:', err);
    }
  });

  // DIRECT MESSAGES — only available to logged-in users, since a guest
  // has no persistent account for anyone to reply back to.
  socket.on('dm:message', async ({ toUserId, text, media, audio }) => {
    if (!socket.userId) return;
    if (!toUserId) return;

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

      const doc = await DirectMessage.create({
        participants: key,
        fromUserId: String(socket.userId),
        toUserId: String(toUserId),
        text: hasText ? text.trim().slice(0, 1000) : '',
        mediaType: hasMedia ? (isVideoMedia ? 'video' : 'image') : null,
        mediaData: hasMedia ? rawMediaData : null,
        audioData: hasAudio ? audio.data : null,
        audioDuration: hasAudio ? Math.min(120, Math.max(0, Number(audio.duration) || 0)) : 0
      });

      const payload = {
        id: doc._id,
        fromUserId: doc.fromUserId,
        toUserId: doc.toUserId,
        text: doc.text,
        media: hasMedia ? { type: doc.mediaType, data: doc.mediaData } : null,
        audio: hasAudio ? { data: doc.audioData, duration: doc.audioDuration } : null,
        time: doc.time
      };

      io.to('user:' + doc.toUserId).emit('dm:message', payload);
      io.to('user:' + doc.fromUserId).emit('dm:message', payload); // other tabs of the sender

      // Push notification to the recipient only — reaches them even if
      // the app is fully closed.
      sendPushToUsers([doc.toUserId], {
        title: socket.username || 'New message',
        body: mediaPreviewServer({ text: doc.text, audioData: doc.audioData, mediaType: doc.mediaType }),
        data: { type: 'dm', uid: doc.fromUserId }
      });
    } catch (err) {
      console.error('DM send error:', err);
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

  // DELETE A DM — only the logged-in sender of a message can delete it.
  // Ownership is checked against fromUserId (set from the verified JWT
  // when it was sent), never trusting whatever the client claims.
  socket.on('dm:message:delete', async ({ messageId }) => {
    if (!messageId) return;

    if (!socket.userId) {
      socket.emit('chat:error', { message: 'Log in to delete your messages.' });
      return;
    }

    try {
      const target = await DirectMessage.findById(messageId);
      if (!target) return; // already gone (deleted elsewhere)

      if (String(target.fromUserId) !== String(socket.userId)) {
        socket.emit('chat:error', { message: 'You can only delete your own messages.' });
        return;
      }

      const toUserId = target.toUserId;
      const fromUserId = target.fromUserId;
      await target.deleteOne();

      const payload = { messageId };
      io.to('user:' + toUserId).emit('dm:message:deleted', payload);
      io.to('user:' + fromUserId).emit('dm:message:deleted', payload);
    } catch (err) {
      console.error('DM delete error:', err);
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      removeOnline(currentRoom, socket);
      socket.leave(currentRoom);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🎮 𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 server running on http://localhost:${PORT}`);
});
