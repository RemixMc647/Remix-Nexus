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

const app = express();

// ---- CONFIG ----
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
// Set this to your static site's real URL once deployed
// (e.g. https://remix-nexus.onrender.com). Using '*' works for testing.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

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

// ---- USER MODEL ----
const AVATAR_OPTIONS = ['🎮', '🕹️', '👾', '🧱', '🚀', '⚔️', '🔥', '🏆', '🎯', '🐉'];

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  avatar: { type: String, default: '🎮' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

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

// ---- SOCKET.IO CHAT ----
const MAX_HISTORY_PER_ROOM = 200;
const roomHistory = new Map(); // roomId -> [{ author, text, time }]

function getHistory(roomId) {
  if (!roomHistory.has(roomId)) roomHistory.set(roomId, []);
  return roomHistory.get(roomId);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('chat:join', ({ room }) => {
    if (!room || typeof room !== 'string') return;

    if (currentRoom) socket.leave(currentRoom);
    currentRoom = room;
    socket.join(room);

    socket.emit('chat:history', { room, messages: getHistory(room) });
  });

  socket.on('chat:message', ({ room, message }) => {
    if (!room || !message || typeof message.text !== 'string' || !message.text.trim()) return;

    const clean = {
      author: String(message.author || 'Guest').slice(0, 40),
      text: String(message.text).trim().slice(0, 500),
      time: Date.now(),
    };

    const history = getHistory(room);
    history.push(clean);
    if (history.length > MAX_HISTORY_PER_ROOM) history.shift();

    io.to(room).emit('chat:message', { room, message: clean });
  });

  socket.on('disconnect', () => {
    if (currentRoom) socket.leave(currentRoom);
  });
});

server.listen(PORT, () => {
  console.log(`🎮 𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 server running on http://localhost:${PORT}`);
});
