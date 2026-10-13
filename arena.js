/*==============================
REMIX NEXUS — NEXUS ARENA (server module)
1v1 game challenges with a timer, proof uploads, spectator voting and a winner.
Free: uses your existing MongoDB + Socket.io. No new packages.

Wire it up in server.js with ONE block (see bottom of this file).
==============================*/
'use strict';

module.exports.init = function init(deps) {
  const { app, io, mongoose, authMiddleware, dbGuard, User, RoomMessage, makeMessageId, isRoomOwner } = deps;

  const MAX_PROOF_CHARS = 1800000;        // ~1.3MB image after base64
  const PENDING_TTL_MS = 30 * 60 * 1000;  // an unanswered challenge expires after 30 min
  const MIN_MINUTES = 5, MAX_MINUTES = 720;
  const MIN_VOTE_WINDOW_MS = 3 * 60 * 60 * 1000; // voting stays open at least 3h after the timer ends

  const person = { userId: String, username: String, avatar: { type: String, default: '🎮' } };
  const challengeSchema = new mongoose.Schema({
    room: { type: String, required: true, index: true },
    gameName: { type: String, default: '' },
    note: { type: String, default: '' },
    minutes: { type: Number, required: true },
    status: { type: String, default: 'pending', index: true }, // pending | live | judging | completed | declined | cancelled | expired
    challenger: person,
    opponent: person,
    createdAt: { type: Date, default: Date.now },
    startedAt: Date,
    endsAt: Date,
    votingEndsAt: Date,
    tzOffset: { type: Number, default: 0 },
    proofs: [{ userId: String, username: String, image: String, note: String, at: { type: Date, default: Date.now } }],
    votes: [{ userId: String, username: String, forUserId: String, at: { type: Date, default: Date.now } }],
    winnerId: { type: String, default: '' },
    winnerName: { type: String, default: '' },
    draw: { type: Boolean, default: false },
    resolvedBy: { type: String, default: '' }, // votes | forfeit | admin | none
    updatedAt: { type: Date, default: Date.now }
  });
  const Challenge = mongoose.models.ArenaChallenge || mongoose.model('ArenaChallenge', challengeSchema);

  const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
  const uid = (req) => String(req.user.id);

  function counts(c) {
    const a = c.challenger.userId, b = c.opponent.userId;
    let va = 0, vb = 0;
    (c.votes || []).forEach(v => { if (v.forUserId === a) va++; else if (v.forUserId === b) vb++; });
    return { [a]: va, [b]: vb };
  }

  // Light version — NO proof images (used in lists and live events).
  function brief(c) {
    return {
      id: String(c._id), room: c.room, gameName: c.gameName, note: c.note, minutes: c.minutes, status: c.status,
      challenger: c.challenger, opponent: c.opponent,
      createdAt: c.createdAt, startedAt: c.startedAt, endsAt: c.endsAt, votingEndsAt: c.votingEndsAt,
      proofsBy: (c.proofs || []).map(p => p.userId),
      votes: counts(c), totalVotes: (c.votes || []).length,
      winnerId: c.winnerId, winnerName: c.winnerName, draw: c.draw, resolvedBy: c.resolvedBy,
      updatedAt: c.updatedAt
    };
  }
  function full(c, meId) {
    const out = brief(c);
    out.proofs = (c.proofs || []).map(p => ({ userId: p.userId, username: p.username, image: p.image, note: p.note, at: p.at }));
    const mine = (c.votes || []).find(v => v.userId === meId);
    out.myVote = mine ? mine.forUserId : '';
    return out;
  }

  function emit(c, event) {
    c.updatedAt = new Date();
    const payload = { event, challenge: brief(c) };
    io.to(c.room).emit('arena:update', { room: c.room, ...payload });
    io.to('user:' + c.challenger.userId).emit('arena:update', { room: c.room, ...payload });
    io.to('user:' + c.opponent.userId).emit('arena:update', { room: c.room, ...payload });
  }

  async function systemMessage(room, text) {
    try {
      const doc = await RoomMessage.create({ id: makeMessageId(), room, author: 'Nexus Arena', authorId: null, text, time: new Date() });
      io.to(room).emit('chat:message', { room, message: {
        id: doc.id, author: doc.author, authorId: null, text: doc.text, audio: null, media: null,
        time: doc.time.getTime(), replyTo: null, edited: false, reactions: []
      } });
    } catch (e) { /* the banner still shows even if the history line fails */ }
  }

  async function save(c, event, chatText) {
    c.updatedAt = new Date();
    await c.save();
    emit(c, event);
    if (chatText) systemMessage(c.room, chatText);
  }

  function pickWinner(c) {
    const a = c.challenger, b = c.opponent;
    const pa = (c.proofs || []).some(p => p.userId === a.userId);
    const pb = (c.proofs || []).some(p => p.userId === b.userId);
    if (!pa && !pb) return { draw: true, by: 'none' };
    if (pa && !pb) return { winner: a, by: 'forfeit' };
    if (pb && !pa) return { winner: b, by: 'forfeit' };
    const n = counts(c);
    if (n[a.userId] > n[b.userId]) return { winner: a, by: 'votes' };
    if (n[b.userId] > n[a.userId]) return { winner: b, by: 'votes' };
    return { draw: true, by: 'votes' };
  }

  async function finish(c, result) {
    c.status = 'completed';
    c.draw = !!result.draw;
    c.winnerId = result.winner ? result.winner.userId : '';
    c.winnerName = result.winner ? result.winner.username : '';
    c.resolvedBy = result.by;
    const n = counts(c);
    const tally = `${n[c.challenger.userId]}–${n[c.opponent.userId]}`;
    const text = c.draw
      ? `🤝 Arena result: ${c.challenger.username} vs ${c.opponent.username} (${c.gameName}) ended in a DRAW.`
      : `🏆 ${c.winnerName} wins the ${c.gameName} challenge against ${c.winnerId === c.challenger.userId ? c.opponent.username : c.challenger.username}! (${c.resolvedBy === 'votes' ? 'votes ' + tally : c.resolvedBy === 'forfeit' ? 'other player sent no proof' : 'decided by admin'})`;
    await save(c, 'completed', text);
  }

  // ---------- routes ----------
  const guards = [dbGuard, authMiddleware];

  app.get('/api/arena/users', ...guards, async (req, res) => {
    try {
      const q = clean(req.query.q, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (q.length < 2) return res.json({ users: [] });
      const users = await User.find({ username: new RegExp('^' + q, 'i'), banned: { $ne: true }, _id: { $ne: req.user.id } })
        .select('username avatar').limit(8).lean();
      res.json({ users: users.map(u => ({ id: String(u._id), username: u.username, avatar: u.avatar || '🎮' })) });
    } catch (e) { res.status(500).json({ error: 'Could not search players.' }); }
  });

  app.get('/api/arena', ...guards, async (req, res) => {
    try {
      const q = {};
      if (req.query.room) q.room = clean(req.query.room, 60);
      if (req.query.mine === '1') q.$or = [{ 'challenger.userId': uid(req) }, { 'opponent.userId': uid(req) }];
      const view = req.query.view || 'active';
      if (view === 'active') q.status = { $in: ['pending', 'live', 'judging'] };
      else if (view === 'done') q.status = 'completed';
      else q.status = { $in: ['pending', 'live', 'judging', 'completed'] };
      const list = await Challenge.find(q).sort({ updatedAt: -1 }).limit(Math.min(parseInt(req.query.limit, 10) || 20, 50));
      res.json({ challenges: list.map(brief) });
    } catch (e) { res.status(500).json({ error: 'Could not load challenges.' }); }
  });

  // A player's public Arena profile: win/loss record + the challenges they created.
  // (Registered before '/api/arena/:id' — they don't clash, this has an extra path segment.)
  app.get('/api/arena/user/:id', ...guards, async (req, res) => {
    try {
      const id = clean(req.params.id, 40);
      const u = await User.findById(id).select('username avatar banned').lean();
      if (!u || u.banned) return res.status(404).json({ error: 'Player not found.' });
      const all = await Challenge.find({ $or: [{ 'challenger.userId': id }, { 'opponent.userId': id }] })
        .sort({ updatedAt: -1 }).limit(200);
      let wins = 0, losses = 0, draws = 0;
      all.forEach(c => {
        if (c.status !== 'completed') return;
        if (c.draw) draws++; else if (c.winnerId === id) wins++; else losses++;
      });
      const created = all.filter(c => c.challenger.userId === id);
      const shown = created.filter(c => ['pending', 'live', 'judging', 'completed', 'declined', 'expired'].includes(c.status)).slice(0, 30);
      res.json({
        user: { id: String(u._id), username: u.username, avatar: u.avatar || '🎮' },
        stats: { created: created.length, wins, losses, draws },
        challenges: shown.map(brief)
      });
    } catch (e) { res.status(404).json({ error: 'Player not found.' }); }
  });

  app.get('/api/arena/:id', ...guards, async (req, res) => {
    try {
      const c = await Challenge.findById(req.params.id);
      if (!c) return res.status(404).json({ error: 'Challenge not found.' });
      res.json({ challenge: full(c, uid(req)), canDecide: isRoomOwner(req.user) });
    } catch (e) { res.status(404).json({ error: 'Challenge not found.' }); }
  });

  app.post('/api/arena', ...guards, async (req, res) => {
    try {
      const b = req.body || {};
      const room = clean(b.room, 60);
      if (!room || room === 'nexus-ai' || room.startsWith('nexus-ai-dm')) return res.status(400).json({ error: 'Pick a game room.' });
      const gameName = clean(b.gameName, 60) || room;
      const minutes = Math.round(Number(b.minutes));
      if (!(minutes >= MIN_MINUTES && minutes <= MAX_MINUTES)) return res.status(400).json({ error: `Time must be ${MIN_MINUTES}–${MAX_MINUTES} minutes.` });
      const name = clean(b.opponent, 30);
      if (!name) return res.status(400).json({ error: 'Choose who you want to challenge.' });
      const [me, them] = await Promise.all([
        User.findById(req.user.id).select('username avatar banned'),
        User.findOne({ username: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).select('username avatar banned')
      ]);
      if (!me || me.banned) return res.status(403).json({ error: 'Your account cannot create challenges.' });
      if (!them || them.banned) return res.status(404).json({ error: 'Player not found.' });
      if (String(them._id) === String(me._id)) return res.status(400).json({ error: "You can't challenge yourself." });
      const open = await Challenge.countDocuments({ 'challenger.userId': String(me._id), status: { $in: ['pending', 'live', 'judging'] } });
      if (open >= 3) return res.status(429).json({ error: 'You already have 3 open challenges. Finish one first.' });
      const c = await Challenge.create({
        room, gameName, minutes, note: clean(b.note, 200),
        tzOffset: Math.max(-840, Math.min(840, Math.round(Number(b.tzOffset) || 0))),
        challenger: { userId: String(me._id), username: me.username, avatar: me.avatar || '🎮' },
        opponent: { userId: String(them._id), username: them.username, avatar: them.avatar || '🎮' }
      });
      await save(c, 'created', `⚔️ ${me.username} challenged ${them.username} to a ${minutes}-minute ${gameName} duel! Waiting for ${them.username} to accept.`);
      res.json({ challenge: brief(c) });
    } catch (e) { console.error('arena create', e); res.status(500).json({ error: 'Could not create the challenge.' }); }
  });

  async function load(req, res) {
    let c = null;
    try { c = await Challenge.findById(req.params.id); } catch (e) {}
    if (!c) { res.status(404).json({ error: 'Challenge not found.' }); return null; }
    return c;
  }

  app.post('/api/arena/:id/accept', ...guards, async (req, res) => {
    const c = await load(req, res); if (!c) return;
    if (c.status !== 'pending') return res.status(400).json({ error: 'This challenge is no longer waiting.' });
    if (c.opponent.userId !== uid(req)) return res.status(403).json({ error: 'Only the challenged player can accept.' });
    c.status = 'live'; c.startedAt = new Date(); c.endsAt = new Date(Date.now() + c.minutes * 60000);
    await save(c, 'accepted', `🔥 LIVE: ${c.challenger.username} vs ${c.opponent.username} — ${c.gameName}! ${c.minutes} minutes on the clock. Tap the banner to watch.`);
    res.json({ challenge: brief(c) });
  });

  app.post('/api/arena/:id/decline', ...guards, async (req, res) => {
    const c = await load(req, res); if (!c) return;
    if (c.status !== 'pending') return res.status(400).json({ error: 'This challenge is no longer waiting.' });
    if (c.opponent.userId !== uid(req) && c.challenger.userId !== uid(req)) return res.status(403).json({ error: 'Not your challenge.' });
    const byOpp = c.opponent.userId === uid(req);
    c.status = byOpp ? 'declined' : 'cancelled';
    await save(c, c.status, byOpp ? `🚫 ${c.opponent.username} declined ${c.challenger.username}'s ${c.gameName} challenge.` : null);
    res.json({ challenge: brief(c) });
  });

  app.post('/api/arena/:id/proof', ...guards, async (req, res) => {
    const c = await load(req, res); if (!c) return;
    const me = uid(req);
    if (c.challenger.userId !== me && c.opponent.userId !== me) return res.status(403).json({ error: 'Only the two players can upload proof.' });
    if (c.status === 'live' && c.endsAt && c.endsAt.getTime() <= Date.now()) await advance(c);
    if (c.status !== 'judging') return res.status(400).json({ error: c.status === 'live' ? 'Proof opens when the timer ends.' : 'Proof is closed for this challenge.' });
    const image = String((req.body || {}).image || '');
    if (!/^data:image\/(jpeg|png|webp);base64,/i.test(image)) return res.status(400).json({ error: 'Upload a screenshot (JPG, PNG or WebP).' });
    if (image.length > MAX_PROOF_CHARS) return res.status(413).json({ error: 'Image is too big. Try a smaller screenshot.' });
    const who = c.challenger.userId === me ? c.challenger : c.opponent;
    c.proofs = (c.proofs || []).filter(p => p.userId !== me);
    c.proofs.push({ userId: me, username: who.username, image, note: clean((req.body || {}).note, 200), at: new Date() });
    await save(c, 'proof', c.proofs.length === 2 ? `📸 Both proofs are in for ${c.challenger.username} vs ${c.opponent.username}! Spectators — go vote.` : null);
    res.json({ challenge: full(c, me) });
  });

  app.post('/api/arena/:id/vote', ...guards, async (req, res) => {
    const c = await load(req, res); if (!c) return;
    const me = uid(req);
    if (c.status !== 'judging') return res.status(400).json({ error: 'Voting is not open.' });
    if (c.challenger.userId === me || c.opponent.userId === me) return res.status(403).json({ error: "Players can't vote in their own challenge." });
    const forId = String((req.body || {}).forUserId || '');
    if (forId !== c.challenger.userId && forId !== c.opponent.userId) return res.status(400).json({ error: 'Pick one of the two players.' });
    const u = await User.findById(me).select('username');
    c.votes = (c.votes || []).filter(v => v.userId !== me);
    c.votes.push({ userId: me, username: u ? u.username : '', forUserId: forId, at: new Date() });
    await save(c, 'vote', null);
    res.json({ challenge: full(c, me) });
  });

  app.post('/api/arena/:id/decide', ...guards, async (req, res) => {
    if (!isRoomOwner(req.user)) return res.status(403).json({ error: 'Admins only.' });
    const c = await load(req, res); if (!c) return;
    if (c.status !== 'judging' && c.status !== 'live') return res.status(400).json({ error: 'This challenge cannot be decided now.' });
    const forId = String((req.body || {}).winnerId || '');
    const winner = forId === c.challenger.userId ? c.challenger : forId === c.opponent.userId ? c.opponent : null;
    await finish(c, winner ? { winner, by: 'admin' } : { draw: true, by: 'admin' });
    res.json({ challenge: full(c, uid(req)) });
  });

  // ---------- timers ----------
  function votingDeadline(c) {
    const ends = c.endsAt.getTime(), off = (c.tzOffset || 0) * 60000;
    const local = ends - off;
    const endOfDay = (Math.floor(local / 86400000) + 1) * 86400000 + off - 60000; // 23:59 in the creator's day
    return new Date(Math.max(endOfDay, ends + MIN_VOTE_WINDOW_MS));
  }
  async function advance(c) {
    const now = Date.now();
    if (c.status === 'pending' && now - c.createdAt.getTime() > PENDING_TTL_MS) {
      c.status = 'expired';
      await save(c, 'expired', `⌛ ${c.opponent.username} didn't answer ${c.challenger.username}'s ${c.gameName} challenge in time.`);
    } else if (c.status === 'live' && c.endsAt && c.endsAt.getTime() <= now) {
      c.status = 'judging'; c.votingEndsAt = votingDeadline(c);
      await save(c, 'judging', `⏱️ TIME! ${c.challenger.username} vs ${c.opponent.username} (${c.gameName}) — both players upload proof now. Voting closes ${c.votingEndsAt.toUTCString().slice(17, 22)} UTC.`);
    } else if (c.status === 'judging' && c.votingEndsAt && c.votingEndsAt.getTime() <= now) {
      await finish(c, pickWinner(c));
    }
  }
  async function sweep() {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const list = await Challenge.find({ status: { $in: ['pending', 'live', 'judging'] } });
      for (const c of list) await advance(c);
    } catch (e) { console.error('arena sweep', e.message); }
  }
  setInterval(sweep, 20000);
  setTimeout(sweep, 5000);
};

/* ---------- ADD THIS TO server.js (anywhere AFTER `makeMessageId` is defined,
   e.g. right under the line `require('./nexus-ai').init({ io, RoomMessage, makeMessageId });`) ----------

require('./arena').init({ app, io, mongoose, authMiddleware, dbGuard, User, RoomMessage, makeMessageId, isRoomOwner });

*/
