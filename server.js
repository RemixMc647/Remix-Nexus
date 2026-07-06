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
app.use(cors({
  origin: FRONTEND_ORIGIN,
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
  }
});

// Verify the JWT (if the client sent one) BEFORE the connection completes.
// This is what lets us trust socket.userId / socket.username later instead
// of trusting whatever "author" name the client claims to be.
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.id;
      socket.username = decoded.username;
    } catch (err) {
      // Invalid/expired token — still let them connect as a guest rather
      // than hard-failing, they just won't have a verified identity.
    }
  }

  next();
});

// ---- USER MODEL ----
const AVATAR_OPTIONS = ['🎮', '🕹️', '👾', '🧱', '🚀', '⚔️', '🔥', '🏆', '🎯', '🐉','😎','💀','🐱‍👤','🕷','👩🏻','🎧','🍆','🍑'];

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  avatar: { type: String, default: '🎮' },
  createdAt: { type: Date, default: Date.now },
  resetPasswordTokenHash: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }
});

const User = mongoose.model('User', userSchema);

// ---- DIRECT MESSAGE MODEL ----
// `participants` is always the two user IDs sorted alphabetically, so a
// single query finds the whole conversation regardless of who sent what.
const dmSchema = new mongoose.Schema({
  participants: { type: [String], required: true, index: true },
  fromUserId: { type: String, required: true },
  toUserId: { type: String, required: true },
  text: { type: String, required: true },
  time: { type: Date, default: Date.now }
});

const DirectMessage = mongoose.model('DirectMessage', dmSchema);

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

    res.json({ user: publicUser(user) });
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

// CONTACTS — other people you've shared a room with, based on chat activity
// since this server last restarted (room history itself is in-memory only,
// same as the existing chat system, so this list resets on redeploy too).
app.get('/api/contacts', dbGuard, authMiddleware, async (req, res) => {
  try {
    const myId = String(req.user.id);
    const contactIds = new Set();

    for (const participants of roomParticipants.values()) {
      if (participants.has(myId)) {
        participants.forEach((id) => {
          if (id !== myId) contactIds.add(id);
        });
      }
    }

    const users = await User.find({ _id: { $in: Array.from(contactIds) } });
    res.json({ contacts: users.map(publicUser) });
  } catch (err) {
    console.error('Get contacts error:', err);
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

    res.json({ user: publicUser(otherUser), messages });
  } catch (err) {
    console.error('Get DM history error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---- SOCKET.IO CHAT ----
const MAX_HISTORY_PER_ROOM = 200;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // messages older than this get dropped automatically
const roomHistory = new Map(); // roomId -> [{ id, author, authorId, text, time, replyTo }]
const roomParticipants = new Map(); // roomId -> Set of userId (for contacts)

// Messages are always pushed in chronological order, so expired ones are
// always at the front — trimming from the front is enough, no need to
// scan the whole array. This also means chat history clears itself out
// naturally 24 hours after it was sent, on top of clearing completely
// whenever the server restarts/redeploys (since this is in-memory only).
function getHistory(roomId) {
  if (!roomHistory.has(roomId)) roomHistory.set(roomId, []);
  const messages = roomHistory.get(roomId);

  const cutoff = Date.now() - HISTORY_TTL_MS;
  while (messages.length && messages[0].time < cutoff) {
    messages.shift();
  }

  return messages;
}

function trackRoomParticipant(roomId, userId) {
  if (!roomParticipants.has(roomId)) roomParticipants.set(roomId, new Set());
  roomParticipants.get(roomId).add(String(userId));
}

function makeMessageId() {
  return crypto.randomBytes(12).toString('hex');
}

io.on('connection', (socket) => {
  let currentRoom = null;

  // Authenticated users get a personal room so DMs can reach every tab/
  // device they have open, by user ID rather than by socket ID.
  if (socket.userId) {
    socket.join('user:' + socket.userId);
  }

  socket.on('chat:join', ({ room }) => {
    if (!room || typeof room !== 'string') return;

    if (currentRoom) socket.leave(currentRoom);
    currentRoom = room;
    socket.join(room);

    socket.emit('chat:history', { room, messages: getHistory(room) });
  });

  socket.on('chat:message', ({ room, message }) => {
    if (!room || !message) return;

    const hasText = typeof message.text === 'string' && message.text.trim().length > 0;
    const hasAudio = message.audio
      && typeof message.audio.data === 'string'
      && message.audio.data.startsWith('data:audio/');

    if (!hasText && !hasAudio) return;

    // Voice notes live in the same in-memory room history as everything
    // else, so cap the payload size to keep memory use sane.
    const MAX_AUDIO_DATA_LENGTH = 2_000_000; // ~1.5MB of actual audio
    if (hasAudio && message.audio.data.length > MAX_AUDIO_DATA_LENGTH) {
      socket.emit('chat:error', { message: 'That voice note is too large to send — keep it under about a minute.' });
      return;
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

    const clean = {
      id: typeof message.id === 'string' && message.id ? message.id.slice(0, 60) : makeMessageId(),
      author,
      authorId: socket.userId || null,
      text: hasText ? String(message.text).trim().slice(0, 500) : '',
      audio: hasAudio
        ? {
            data: message.audio.data,
            duration: Math.min(120, Math.max(0, Number(message.audio.duration) || 0))
          }
        : null,
      time: Date.now(),
      replyTo
    };

    const history = getHistory(room);
    history.push(clean);
    if (history.length > MAX_HISTORY_PER_ROOM) history.shift();

    if (clean.authorId) {
      trackRoomParticipant(room, clean.authorId);
    }

    io.to(room).emit('chat:message', { room, message: clean });
  });

  // DELETE A MESSAGE — only the logged-in author of a message can delete
  // it. Ownership is checked against the message's authorId (set from the
  // verified JWT when it was sent), never trusting whatever the client
  // claims, so nobody can delete someone else's message. Guest-authored
  // messages (authorId is null) can't be deleted this way at all, since a
  // guest has no persistent identity to prove ownership with.
  socket.on('chat:message:delete', ({ room, messageId }) => {
    if (!room || !messageId) return;

    if (!socket.userId) {
      socket.emit('chat:error', { message: 'Log in to delete your messages.' });
      return;
    }

    const history = getHistory(room);
    const index = history.findIndex((m) => m.id === messageId);

    if (index === -1) return; // already gone (expired or deleted elsewhere)

    const target = history[index];
    if (!target.authorId || String(target.authorId) !== String(socket.userId)) {
      socket.emit('chat:error', { message: 'You can only delete your own messages.' });
      return;
    }

    history.splice(index, 1);
    io.to(room).emit('chat:message:deleted', { room, messageId });
  });

  // DIRECT MESSAGES — only available to logged-in users, since a guest
  // has no persistent account for anyone to reply back to.
  socket.on('dm:message', async ({ toUserId, text }) => {
    if (!socket.userId) return;
    if (!toUserId || typeof text !== 'string' || !text.trim()) return;

    try {
      const key = conversationKey(socket.userId, toUserId);

      const doc = await DirectMessage.create({
        participants: key,
        fromUserId: String(socket.userId),
        toUserId: String(toUserId),
        text: text.trim().slice(0, 1000)
      });

      const payload = {
        id: doc._id,
        fromUserId: doc.fromUserId,
        toUserId: doc.toUserId,
        text: doc.text,
        time: doc.time
      };

      io.to('user:' + doc.toUserId).emit('dm:message', payload);
      io.to('user:' + doc.fromUserId).emit('dm:message', payload); // other tabs of the sender
    } catch (err) {
      console.error('DM send error:', err);
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) socket.leave(currentRoom);
  });
});

server.listen(PORT, () => {
  console.log(`🎮 𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 server running on http://localhost:${PORT}`);
});
