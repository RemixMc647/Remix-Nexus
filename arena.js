/*==============================
REMIX NEXUS — NEXUS ARENA (server module)
1v1 game challenges with a timer, proof uploads, spectator voting and a winner.
Free: uses your existing MongoDB + Socket.io. No new packages.

Wire it up in server.js with ONE block (see bottom of this file).
==============================*/
'use strict';
const crypto = require('crypto');

module.exports.init = function init(deps) {
  const { app, io, mongoose, authMiddleware, dbGuard, User, RoomMessage, makeMessageId, isRoomOwner } = deps;

  // Cloudinary helpers handed over by server.js (same account the Stories use).
  // If server.js doesn't pass them, picture proofs still work and video proofs
  // are simply switched off.
  const cl = deps.cloudinary || { ready: false };
  const ARENA_TAG = 'remix-arena';                 // every proof video is tagged so cleanup can find it
  const MAX_VIDEO_SECONDS = 60;                    // hard 1-minute limit
  const MAX_VIDEO_BYTES = cl.maxBytes || 100 * 1024 * 1024;
  const VIDEO_KEEP_DAYS = 7;                       // proof videos stay watchable for a week after upload

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
    proofs: [{ userId: String, username: String, kind: { type: String, default: 'image' }, image: String, video: String, videoPublicId: String, videoDuration: Number, note: String, at: { type: Date, default: Date.now } }],
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
  // A still frame from a proof video, so the player shows a picture before you press play.
  function posterFor(url) {
    const m = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)\.[a-z0-9]+$/i.exec(url || '');
    return m ? m[1] + 'so_1,w_640,c_limit/' + m[2] + '.jpg' : '';
  }
  function full(c, meId) {
    const out = brief(c);
    out.proofs = (c.proofs || []).map(p => ({
      userId: p.userId, username: p.username, kind: p.kind || 'image', image: p.image || '',
      video: p.video || '', poster: p.video ? posterFor(p.video) : '', videoDuration: p.videoDuration || 0,
      note: p.note, at: p.at
    }));
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

  // Step 1 of a VIDEO proof: permission to upload straight to Cloudinary. The file name is
  // locked to THIS challenge + THIS player, so nobody can reuse someone else's video.
  app.post('/api/arena/:id/proof-signature', ...guards, async (req, res) => {
    const c = await load(req, res); if (!c) return;
    const me = uid(req);
    if (c.challenger.userId !== me && c.opponent.userId !== me) return res.status(403).json({ error: 'Only the two players can upload proof.' });
    if (!cl.ready) return res.status(503).json({ error: 'Video uploads are not set up on the server yet. You can still upload a picture.' });
    if (c.status === 'live' && c.endsAt && c.endsAt.getTime() <= Date.now()) await advance(c);
    if (c.status !== 'judging') return res.status(400).json({ error: c.status === 'live' ? 'Proof opens when the timer ends.' : 'Proof is closed for this challenge.' });
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = `arena_${c.id}_${me}_${crypto.randomBytes(6).toString('hex')}`;
    const params = { public_id: publicId, tags: ARENA_TAG, timestamp };
    res.json({
      cloudName: cl.cloudName, apiKey: cl.apiKey, timestamp, tags: ARENA_TAG, publicId,
      signature: cl.sign(params), maxBytes: MAX_VIDEO_BYTES, maxSeconds: MAX_VIDEO_SECONDS
    });
  });

  // Step 2 (or the only step for a picture): save the proof. A picture arrives as `image`
  // (data: URL). A video is already on Cloudinary — the app sends `mediaPublicId` and the
  // server checks the REAL length with Cloudinary (max 1 minute).
  app.post('/api/arena/:id/proof', ...guards, async (req, res) => {
    const c = await load(req, res); if (!c) return;
    const me = uid(req);
    if (c.challenger.userId !== me && c.opponent.userId !== me) return res.status(403).json({ error: 'Only the two players can upload proof.' });
    if (c.status === 'live' && c.endsAt && c.endsAt.getTime() <= Date.now()) await advance(c);
    if (c.status !== 'judging') return res.status(400).json({ error: c.status === 'live' ? 'Proof opens when the timer ends.' : 'Proof is closed for this challenge.' });
    const body = req.body || {};
    const who = c.challenger.userId === me ? c.challenger : c.opponent;
    const note = clean(body.note, 200);
    let entry;

    if (body.mediaPublicId) {
      // ---- VIDEO ----
      if (!cl.ready) return res.status(503).json({ error: 'Video uploads are not set up on the server yet. You can still upload a picture.' });
      const id = String(body.mediaPublicId);
      if (!/^[A-Za-z0-9_-]{10,160}$/.test(id) || !id.startsWith(`arena_${c.id}_${me}_`)) {
        return res.status(400).json({ error: 'That video does not belong to this challenge. Please upload it again.' });
      }
      const readDuration = (v) => [v && v.duration, v && v.video && v.video.duration, v && v.media_metadata && v.media_metadata.duration]
        .map(Number).find((n) => isFinite(n) && n > 0);
      let video = await cl.getVideo(id);
      for (let i = 0; i < 2 && video && !readDuration(video); i++) {   // a fresh upload can take a moment to be analysed
        await new Promise((r) => setTimeout(r, 1500));
        video = await cl.getVideo(id);
      }
      if (!video || !Array.isArray(video.tags) || !video.tags.includes(ARENA_TAG)) {
        return res.status(400).json({ error: 'That video could not be found. Please upload it again.' });
      }
      let seconds = readDuration(video);
      if (!seconds) {
        // Cloudinary gave no length for this file — fall back to the length it reported at upload time.
        const claimed = Number(body.mediaDuration);
        if (isFinite(claimed) && claimed > 0) seconds = claimed;
      }
      if (!seconds) {
        await cl.deleteVideos([id]);
        return res.status(400).json({ error: "We couldn't read that video's length. Please try a different file (MP4 works best)." });
      }
      if (seconds > MAX_VIDEO_SECONDS + 0.5) {
        await cl.deleteVideos([id]);
        return res.status(400).json({ error: 'Proof videos can be at most 1 minute long.' });
      }
      if (Number(video.bytes) > MAX_VIDEO_BYTES) {
        await cl.deleteVideos([id]);
        return res.status(400).json({ error: 'That video is too large.' });
      }
      entry = { userId: me, username: who.username, kind: 'video', image: '', video: video.secure_url, videoPublicId: id, videoDuration: seconds, note, at: new Date() };
    } else {
      // ---- PICTURE ----
      const image = String(body.image || '');
      if (!/^data:image\/(jpeg|png|webp);base64,/i.test(image)) return res.status(400).json({ error: 'Upload a screenshot (JPG, PNG or WebP) or a video up to 1 minute.' });
      if (image.length > MAX_PROOF_CHARS) return res.status(413).json({ error: 'Image is too big. Try a smaller screenshot.' });
      entry = { userId: me, username: who.username, kind: 'image', image, note, at: new Date() };
    }

    // Replacing an old video proof? Free its storage.
    const old = (c.proofs || []).find(p => p.userId === me);
    if (old && old.videoPublicId && old.videoPublicId !== entry.videoPublicId && cl.ready) cl.deleteVideos([old.videoPublicId]);

    c.proofs = (c.proofs || []).filter(p => p.userId !== me);
    c.proofs.push(entry);
    await save(c, 'proof', c.proofs.length === 2 ? `📸 Both proofs are in for ${c.challenger.username} vs ${c.opponent.username}! Spectators — go watch and vote.` : null);
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

  // Deletes proof videos older than VIDEO_KEEP_DAYS from Cloudinary so free storage never fills up.
  // (The result stays in the challenge; the video simply shows "expired".) Also removes videos that
  // were uploaded but never submitted.
  async function sweepArenaVideos() {
    if (!cl.ready) return;
    try {
      const resp = await fetch(`https://api.cloudinary.com/v1_1/${cl.cloudName}/resources/search`, {
        method: 'POST',
        headers: { ...cl.adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expression: `tags=${ARENA_TAG} AND resource_type=video AND uploaded_at<${VIDEO_KEEP_DAYS}d`, max_results: 100 })
      });
      if (!resp.ok) { console.error('Arena video sweep: search failed with HTTP', resp.status); return; }
      const json = await resp.json();
      const ids = (json.resources || []).map(r => r.public_id);
      if (ids.length) { await cl.deleteVideos(ids); console.log(`🧹 Deleted ${ids.length} old arena proof video(s) from Cloudinary.`); }
    } catch (e) { console.error('Arena video sweep error:', e.message); }
  }
  if (cl.ready) { setTimeout(sweepArenaVideos, 30 * 1000); setInterval(sweepArenaVideos, 60 * 60 * 1000); }
};

/* ---------- ADD THIS TO server.js (anywhere AFTER `makeMessageId` is defined,
   e.g. right under the line `require('./nexus-ai').init({ io, RoomMessage, makeMessageId });`) ----------

require('./arena').init({ app, io, mongoose, authMiddleware, dbGuard, User, RoomMessage, makeMessageId, isRoomOwner,
  cloudinary: { ready: cloudinaryReady, cloudName: CLOUDINARY_CLOUD_NAME, apiKey: CLOUDINARY_API_KEY, sign: cloudinarySign,
    getVideo: cloudinaryGetVideo, deleteVideos: cloudinaryDeleteVideos, adminHeaders: cloudinaryAdminHeaders, maxBytes: MAX_STORY_VIDEO_BYTES } });

*/
