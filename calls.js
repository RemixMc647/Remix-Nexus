/*==============================
REMIX-NEXUS — VOICE & VIDEO CALLS (v2, Discord style)
Shared by Chat.html (room calls) and Contacts.html (personal + group calls).
Same public API and same socket events as before — drop-in replacement,
pair with the new Calls.css.

Call kinds (always labelled in the UI, WhatsApp-style):
  dm     → "Personal voice/video call"  (blue, remote full-screen + you in a small window)
  group  → "Group voice/video call"     (violet, tile grid + participants panel)
  room   → "Room voice/video call"      (violet, same as group, tied to a chat room)

Features: mute, speaker (deafen), camera on/off (also turns a voice call
into video), flip camera, screen share, speaking indicators, remote
mic/camera state, pin/spotlight a tile, participants panel, minimise to a
floating card, fullscreen, no-answer timeout, auto-reconnect (ICE restart),
accept-as-voice-only, missed/declined/completed call history with call-back,
ringtone settings, keyboard shortcuts (M mute, V camera, D speaker, Esc minimise).
==============================*/
(function () {
  'use strict';

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'bdb075382d6df379c55ef888', credential: '7xzC1Hi9hgPQZFRm' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'bdb075382d6df379c55ef888', credential: '7xzC1Hi9hgPQZFRm' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'bdb075382d6df379c55ef888', credential: '7xzC1Hi9hgPQZFRm' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'bdb075382d6df379c55ef888', credential: '7xzC1Hi9hgPQZFRm' }
    // Keep all four TURN entries — the 80/tcp/443/turns variants are fallbacks for
    // networks that block UDP or non-standard ports.
  ];

  const RING_TIMEOUT_MS = 45000;      // caller gives up if nobody answers
  const INVITE_TIMEOUT_MS = 60000;    // callee's banner auto-dismisses as "missed"
  const CONNECT_TIMEOUT_MS = 20000;   // after answering, ICE must connect within this

  let socket = null;
  let boundSocket = null;
  let ctx = { getMyUserId: () => null, getMyUsername: () => 'You', getMyAvatar: () => '🎮' };
  let session = null;   // the active call (any kind)
  let incoming = null;  // a pending invite waiting on Accept/Decline
  const R = {};         // UI element refs

  /* ---------- tiny helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const gum = (c) => navigator.mediaDevices.getUserMedia(c);
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const genId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('call-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmt(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  function humanizeRoom(id) {
    return String(id || 'Room').replace(/^r-/, '').replace(/-[0-9a-f]{6}$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function kindMeta(kind, type) {
    const v = type === 'video' ? 'video' : 'voice';
    if (kind === 'dm') return { icon: '👤', tag: 'Personal', label: `Personal ${v} call` };
    if (kind === 'group') return { icon: '👥', tag: 'Group', label: `Group ${v} call` };
    return { icon: '#', tag: 'Room', label: `Room ${v} call` };
  }
  function toast(msg) {
    let w = $('rnToasts');
    if (!w) { w = document.createElement('div'); w.id = 'rnToasts'; w.className = 'rn-toast-wrap'; document.body.appendChild(w); }
    const t = document.createElement('div');
    t.className = 'rn-toast'; t.textContent = msg; w.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 3600);
  }

  /* -----------------------------------------------------------
     SOUNDS — ringback (caller) + ringtone (callee), Web Audio
  ----------------------------------------------------------- */
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; audioCtx = new C(); }
    return audioCtx;
  }
  function unlockAudioOnce() {
    const c = getAudioCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    document.removeEventListener('click', unlockAudioOnce);
    document.removeEventListener('touchstart', unlockAudioOnce);
  }
  document.addEventListener('click', unlockAudioOnce);
  document.addEventListener('touchstart', unlockAudioOnce);

  function beep(freq, start, dur, vol) {
    const c = getAudioCtx(); if (!c) return;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(start); osc.stop(start + dur + 0.02);
  }

  let ringbackTimer = null;
  function startRingback() {
    stopRingback();
    const c = getAudioCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {});
    const cycle = () => { const cc = getAudioCtx(); if (!cc) return; const n = cc.currentTime; beep(480, n, 0.9, 0.12); beep(620, n, 0.9, 0.12); };
    cycle(); ringbackTimer = setInterval(cycle, 3000);
  }
  function stopRingback() { clearInterval(ringbackTimer); ringbackTimer = null; }

  const RINGTONE_PRESETS = {
    classic: { label: 'Classic Chime', notes: [659.25, 880.00], toneLen: 0.35, noteGap: 0.10, loopGap: 1300 },
    pulse:   { label: 'Digital Pulse', notes: [440, 440, 440],  toneLen: 0.12, noteGap: 0.10, loopGap: 900 },
    marimba: { label: 'Marimba Rise',  notes: [523.25, 659.25, 783.99], toneLen: 0.22, noteGap: 0.05, loopGap: 1100 },
    retro:   { label: 'Retro Beep',    notes: [300, 300],       toneLen: 0.15, noteGap: 0.15, loopGap: 1000 }
  };
  const RT_PRESET_KEY = 'remix-nexusRingtonePreset';
  const RT_DATA_KEY = 'remix-nexusCustomRingtoneData';
  const RT_NAME_KEY = 'remix-nexusCustomRingtoneName';
  const MAX_CUSTOM_RT = 3_000_000;
  const getPresetId = () => { const id = localStorage.getItem(RT_PRESET_KEY); return (id && RINGTONE_PRESETS[id]) ? id : 'classic'; };
  function playPresetCycle(p) {
    const c = getAudioCtx(); if (!c) return;
    let t = c.currentTime;
    p.notes.forEach((f) => { beep(f, t, p.toneLen, 0.18); t += p.toneLen + p.noteGap; });
  }
  let ringtoneTimer = null, ringtoneAudio = null;
  function startRingtone() {
    stopRingtone();
    const custom = localStorage.getItem(RT_DATA_KEY);
    if (custom) { ringtoneAudio = new Audio(custom); ringtoneAudio.loop = true; ringtoneAudio.play().catch(() => {}); return; }
    const c = getAudioCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {});
    const p = RINGTONE_PRESETS[getPresetId()];
    const len = p.notes.length * (p.toneLen + p.noteGap) * 1000 + p.loopGap;
    playPresetCycle(p); ringtoneTimer = setInterval(() => playPresetCycle(p), len);
    if (navigator.vibrate) navigator.vibrate([400, 250, 400]);
  }
  function stopRingtone() {
    clearInterval(ringtoneTimer); ringtoneTimer = null;
    if (ringtoneAudio) { ringtoneAudio.pause(); ringtoneAudio = null; }
    if (navigator.vibrate) navigator.vibrate(0);
  }

  /* -----------------------------------------------------------
     CALL HISTORY (this device only) + MODALS
  ----------------------------------------------------------- */
  const HIST_KEY = 'remix-nexusCallHistory';
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; } }
  function logCall(e) {
    try {
      const h = loadHistory();
      h.unshift(Object.assign({ id: Date.now() + '-' + Math.random().toString(36).slice(2), time: Date.now() }, e));
      localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 50)));
    } catch (err) { /* storage full — not critical */ }
  }

  function makeModal(id, title, sub) {
    const root = document.createElement('div');
    root.id = id; root.className = 'rn-modal';
    root.innerHTML = `<div class="rn-modal-card"><h3></h3><p></p><div class="rn-modal-body"></div><div class="rn-modal-actions"></div></div>`;
    root.querySelector('h3').textContent = title;
    root.querySelector('p').textContent = sub;
    root.addEventListener('click', (e) => { if (e.target === root) root.classList.remove('open'); });
    document.body.appendChild(root);
    return { root, body: root.querySelector('.rn-modal-body'), actions: root.querySelector('.rn-modal-actions') };
  }

  let histModal = null;
  function openCallHistory() {
    if (!histModal) {
      histModal = makeModal('rnHistoryModal', '📞 Recent calls', 'Calls made and received on this device.');
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'rn-btn ghost'; clear.textContent = 'Clear';
      clear.onclick = () => { localStorage.removeItem(HIST_KEY); openCallHistory(); };
      const done = document.createElement('button'); done.type = 'button'; done.className = 'rn-btn'; done.textContent = 'Done';
      done.onclick = () => histModal.root.classList.remove('open');
      histModal.actions.append(clear, done);
    }
    const list = loadHistory();
    histModal.body.innerHTML = '';
    if (!list.length) histModal.body.innerHTML = '<div class="rn-empty">No calls yet.</div>';
    list.forEach((h) => {
      const missed = h.status === 'missed';
      const dirIcon = missed ? '✕' : (h.dir === 'out' ? '↗' : '↙');
      const statusText = { completed: h.duration ? fmt(h.duration * 1000) : 'Completed', missed: 'Missed', declined: 'Declined', noanswer: 'No answer', cancelled: 'Cancelled' }[h.status] || '';
      const when = new Date(h.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const meta = kindMeta(h.kind, h.type);
      const row = document.createElement('div'); row.className = 'rn-hist-row';
      row.innerHTML = `
        <div class="rn-hist-av">${esc(h.avatar || (h.kind === 'dm' ? '🎮' : '👥'))}</div>
        <div class="rn-hist-info">
          <strong class="${missed ? 'missed' : ''}">${esc(h.name || 'Call')} <span class="rn-hist-chip ${h.kind === 'dm' ? '' : 'group'}">${meta.tag}</span></strong>
          <span>${dirIcon} ${h.type === 'video' ? '🎥' : '🎤'} ${esc(statusText)} · ${esc(when)}</span>
        </div>`;
      if (h.kind === 'dm' && h.userId) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'rn-hist-call'; b.title = 'Call back'; b.textContent = '📞';
        b.onclick = () => { histModal.root.classList.remove('open'); startDMCall(h.userId, h.name, h.avatar, h.type); };
        row.appendChild(b);
      }
      histModal.body.appendChild(row);
    });
    histModal.root.classList.add('open');
  }

  let rtModal = null;
  function refreshRingtoneModal() {
    if (!rtModal) return;
    const cur = getPresetId(), hasCustom = !!localStorage.getItem(RT_DATA_KEY);
    rtModal.body.querySelectorAll('[data-preset]').forEach((b) => {
      const sel = !hasCustom && cur === b.dataset.preset;
      b.textContent = (sel ? '● ' : '○ ') + RINGTONE_PRESETS[b.dataset.preset].label;
      b.classList.toggle('selected', sel);
    });
    const up = rtModal.body.querySelector('[data-upload]');
    up.firstChild.nodeValue = hasCustom ? '● Custom: ' + (localStorage.getItem(RT_NAME_KEY) || 'your file') : '○ Upload your own sound…';
    up.classList.toggle('selected', hasCustom);
  }
  function openRingtoneSettings() {
    if (!rtModal) {
      rtModal = makeModal('rnRingtoneModal', '🔔 Call ringtone', 'Choose the sound that plays when someone calls you.');
      Object.entries(RINGTONE_PRESETS).forEach(([id, p]) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'rn-opt'; b.dataset.preset = id;
        b.onclick = () => {
          localStorage.removeItem(RT_DATA_KEY); localStorage.removeItem(RT_NAME_KEY);
          localStorage.setItem(RT_PRESET_KEY, id); playPresetCycle(p); refreshRingtoneModal();
        };
        rtModal.body.appendChild(b);
      });
      const up = document.createElement('label'); up.className = 'rn-opt'; up.dataset.upload = '1';
      up.appendChild(document.createTextNode(''));
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*'; input.style.display = 'none';
      input.onchange = async () => {
        const f = input.files && input.files[0]; if (!f) return;
        const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
        if (url.length > MAX_CUSTOM_RT) { toast('That file is too large — pick a clip under about 2MB.'); return; }
        localStorage.setItem(RT_DATA_KEY, url); localStorage.setItem(RT_NAME_KEY, f.name);
        refreshRingtoneModal();
        const pv = new Audio(url); pv.play().catch(() => {}); setTimeout(() => pv.pause(), 3000);
      };
      up.appendChild(input);
      up.addEventListener('click', (e) => { if (e.target === input) return; e.preventDefault(); input.click(); });
      rtModal.body.appendChild(up);
      const done = document.createElement('button'); done.type = 'button'; done.className = 'rn-btn'; done.textContent = 'Done';
      done.onclick = () => rtModal.root.classList.remove('open');
      rtModal.actions.appendChild(done);
    }
    refreshRingtoneModal();
    rtModal.root.classList.add('open');
  }

  /* -----------------------------------------------------------
     UI — built once at runtime
  ----------------------------------------------------------- */
  /* -----------------------------------------------------------
     FUN LAYER — things the big apps don't combine in one place
       Snapchat : camera filters with live effects, call streaks 🔥
       WhatsApp : floating reactions, connection quality, quick reply on decline, add people to a call
       Telegram : raise hand, in-call chat
       Discord  : soundboard, push-to-talk, per-person volume
       Remix    : shared "call vibe" themes everyone sees together
  ----------------------------------------------------------- */
  function tone(c, type, f1, f2, start, dur, vol) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, start);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(c.destination); o.start(start); o.stop(start + dur + 0.03);
  }
  function noise(c, start, dur, vol, freq) {
    const len = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 1800;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination); src.start(start);
  }
  const SOUNDS = {
    airhorn:  { ic: '📯', label: 'Airhorn',  play: (c, t) => { [0, 0.2, 0.4].forEach((o) => { tone(c, 'sawtooth', 420, 520, t + o, 0.16, 0.22); tone(c, 'square', 210, 260, t + o, 0.16, 0.08); }); } },
    applause: { ic: '👏', label: 'Applause', play: (c, t) => { for (let i = 0; i < 14; i++) noise(c, t + i * 0.07 + Math.random() * 0.05, 0.12, 0.5, 1500 + Math.random() * 2500); } },
    drums:    { ic: '🥁', label: 'Drumroll', play: (c, t) => { for (let i = 0; i < 16; i++) { tone(c, 'sine', 180, 60, t + i * 0.06, 0.08, 0.35); noise(c, t + i * 0.06, 0.05, 0.2, 3000); } tone(c, 'sine', 120, 40, t + 1.05, 0.3, 0.5); noise(c, t + 1.05, 0.4, 0.5, 5000); } },
    sad:      { ic: '🎺', label: 'Sad horn', play: (c, t) => { [392, 370, 349].forEach((f, i) => tone(c, 'sawtooth', f, f * 0.97, t + i * 0.35, 0.33, 0.18)); tone(c, 'sawtooth', 330, 260, t + 1.05, 0.7, 0.2); } },
    wow:      { ic: '😮', label: 'Wow',      play: (c, t) => { tone(c, 'sine', 300, 1200, t, 0.5, 0.25); tone(c, 'triangle', 600, 1800, t + 0.05, 0.45, 0.1); } },
    ding:     { ic: '🔔', label: 'Ding',     play: (c, t) => { tone(c, 'sine', 1318, null, t, 0.5, 0.25); tone(c, 'sine', 1760, null, t + 0.12, 0.6, 0.2); } }
  };
  function playSound(id) {
    const c = getAudioCtx(); if (!c || !SOUNDS[id]) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    SOUNDS[id].play(c, c.currentTime + 0.01);
  }

  const REACTIONS = ['❤️', '😂', '😮', '👏', '🔥', '🎉', '👍', '😢'];

  const THEMES = {
    default: { label: 'Default', dot: '#0066ff' },
    ocean:   { label: 'Ocean',   accent: '#00b7ff', bg: '#03121a', grad: 'linear-gradient(135deg,#0080ff,#00e5ff)', dot: '#00b7ff' },
    violet:  { label: 'Violet',  accent: '#7c5cff', bg: '#0b0716', grad: 'linear-gradient(135deg,#5b3cff,#a58bff)', dot: '#7c5cff' },
    sunset:  { label: 'Sunset',  accent: '#ff6a3d', bg: '#17090a', grad: 'linear-gradient(135deg,#ff3d6e,#ffb347)', dot: '#ff6a3d' },
    matrix:  { label: 'Matrix',  accent: '#00e676', bg: '#020a05', grad: 'linear-gradient(135deg,#00a050,#b6ff00)', dot: '#00e676' },
    rose:    { label: 'Rose',    accent: '#ff4d8d', bg: '#14060d', grad: 'linear-gradient(135deg,#ff2d75,#ff9ac1)', dot: '#ff4d8d' }
  };
  function applyTheme(id) {
    const s = session; if (!s || !R.overlay) return;
    const th = THEMES[id] || THEMES.default;
    s.theme = THEMES[id] ? id : 'default';
    ['--rn-accent', '--rn-bg', '--rn-grad'].forEach((p) => R.overlay.style.removeProperty(p));
    if (th.accent) { R.overlay.style.setProperty('--rn-accent', th.accent); R.overlay.style.setProperty('--rn-bg', th.bg); R.overlay.style.setProperty('--rn-grad', th.grad); }
    R.vibeRow.querySelectorAll('[data-vibe]').forEach((b) => b.classList.toggle('selected', b.dataset.vibe === s.theme));
  }
  function setTheme(id) {
    const s = session; if (!s) return;
    applyTheme(id);
    s.peers.forEach((p) => { if (p.connected) sendSignal(s, p.userId, { kind: 'theme', id: s.theme, explicit: true }); });
  }

  const FILTERS = {
    none:  { ic: '🚫', label: 'None' },
    noir:  { ic: '🎞️', label: 'Noir',      css: 'grayscale(1) contrast(1.15)' },
    sepia: { ic: '🟤', label: 'Sepia',     css: 'sepia(.9) contrast(1.05)' },
    neon:  { ic: '⚡', label: 'Neon',      css: 'saturate(2.2) contrast(1.15) hue-rotate(-15deg) brightness(1.05)' },
    retro: { ic: '📼', label: 'Camcorder', css: 'sepia(.45) contrast(1.2) saturate(1.3)', fx: 'cam' },
    ice:   { ic: '❄️', label: 'Frost',     css: 'hue-rotate(160deg) saturate(1.3) brightness(1.05)', fx: 'snow' },
    pop:   { ic: '🎨', label: 'Pop',       css: 'saturate(2) contrast(1.25)' },
    dream: { ic: '💖', label: 'Dream',     css: 'blur(1.2px) brightness(1.1) saturate(1.4)', fx: 'hearts' }
  };
  // Filters run on a canvas, so the OTHER people see your filter too (not just your preview).
  function stopPipeline(s) {
    if (s.pipe) { clearInterval(s.pipe.iv); try { s.pipe.vid.srcObject = null; } catch (e) {} }
    if (s.pipeTrack) s.pipeTrack.stop();
    s.pipe = null; s.pipeTrack = null;
  }
  const camOut = (s) => s.pipeTrack || ((s.camTrack && s.camTrack.readyState === 'live') ? s.camTrack : null);
  function updateFilterRow() {
    const s = session; if (!s || !R.filterRow) return;
    R.filterRow.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('selected', b.dataset.filter === (s.filter || 'none')));
  }
  function applyFilter(id) {
    const s = session; if (!s) return;
    const f = FILTERS[id] || FILTERS.none;
    if (id !== 'none') {
      if (!('filter' in CanvasRenderingContext2D.prototype)) { toast('Filters need Chrome, Edge or Firefox.'); return; }
      if (!s.camTrack || s.camTrack.readyState !== 'live') { toast('Turn your camera on first.'); return; }
    }
    stopPipeline(s); s.filter = id;
    if (id === 'none') { if (!s.screenTrack) setOutgoingVideo(camOut(s)); updateFilterRow(); return; }
    const st = s.camTrack.getSettings(), w = st.width || 640, h = st.height || 480;
    const vid = document.createElement('video'); vid.muted = true; vid.playsInline = true;
    vid.srcObject = new MediaStream([s.camTrack]); vid.play().catch(() => {});
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'), parts = [], started = Date.now();
    const iv = setInterval(() => {
      if (vid.readyState < 2) return;
      cx.filter = f.css; cx.drawImage(vid, 0, 0, w, h); cx.filter = 'none';
      if (f.fx === 'snow') {
        if (parts.length < 60 && Math.random() < 0.6) parts.push({ x: Math.random() * w, y: -10, v: 1 + Math.random() * 2, r: 2 + Math.random() * 3 });
        cx.fillStyle = 'rgba(255,255,255,.85)';
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]; p.y += p.v; p.x += Math.sin(p.y / 20) * 0.6;
          cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 6.3); cx.fill();
          if (p.y > h + 10) parts.splice(i, 1);
        }
      } else if (f.fx === 'hearts') {
        if (parts.length < 14 && Math.random() < 0.15) parts.push({ x: Math.random() * w, y: h + 10, v: 1 + Math.random() * 1.5, s: 16 + Math.random() * 16 });
        cx.globalAlpha = 0.85;
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]; p.y -= p.v; p.x += Math.sin(p.y / 25) * 0.8;
          cx.font = p.s + 'px sans-serif'; cx.fillText('💖', p.x, p.y);
          if (p.y < -30) parts.splice(i, 1);
        }
        cx.globalAlpha = 1;
      } else if (f.fx === 'cam') {
        if (Math.floor((Date.now() - started) / 500) % 2) { cx.fillStyle = '#f23f43'; cx.beginPath(); cx.arc(22, 24, 7, 0, 6.3); cx.fill(); }
        cx.fillStyle = '#fff'; cx.font = 'bold 16px monospace';
        cx.fillText('REC ' + fmt(Date.now() - started), 38, 30);
        cx.fillText(new Date().toLocaleDateString(), w - 120, h - 14);
      }
    }, 33);
    s.pipe = { iv, vid, cv };
    s.pipeTrack = cv.captureStream(30).getVideoTracks()[0];
    if (!s.screenTrack) setOutgoingVideo(s.pipeTrack);
    updateFilterRow();
  }

  // Snapchat-style streak: consecutive days you've had a completed personal call with the same person.
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  function callStreak(userId) {
    if (!userId) return 0;
    const days = new Set(loadHistory().filter((h) => h.kind === 'dm' && String(h.userId) === String(userId) && h.status === 'completed').map((h) => dayKey(h.time)));
    let n = 0; const d = new Date();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  // WhatsApp-style connection quality (worst peer wins)
  function setQuality(level, tip) {
    if (!R.quality) return;
    R.quality.hidden = false; R.quality.className = 'rn-quality q' + level; R.quality.title = tip;
  }
  async function pollQuality() {
    const s = session; if (!s || !s.connected) return;
    let level = 3, tip = 'Connection: good';
    for (const peer of s.peers.values()) {
      if (!peer.connected) continue;
      try {
        const stats = await peer.pc.getStats();
        let rtt = null, lost = 0, recv = 0;
        stats.forEach((r) => {
          if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime * 1000;
          if (r.type === 'inbound-rtp' && !r.isRemote) { lost += r.packetsLost || 0; recv += r.packetsReceived || 0; }
        });
        const dl = lost - (peer.prevLost || 0), dr = recv - (peer.prevRecv || 0);
        peer.prevLost = lost; peer.prevRecv = recv;
        const loss = (dl + dr) > 0 ? (dl / (dl + dr)) * 100 : 0;
        const lv = ((rtt != null && rtt > 350) || loss > 8) ? 1 : (((rtt != null && rtt > 150) || loss > 3) ? 2 : 3);
        if (lv < level) { level = lv; tip = `Connection: ${lv === 1 ? 'poor' : 'fair'} (${rtt != null ? Math.round(rtt) + ' ms' : '? ms'}, ${loss.toFixed(1)}% loss)`; }
      } catch (e) { /* stats unavailable */ }
    }
    setQuality(level, tip);
  }

  /* ---------- reactions, hand, sounds, chat, PTT ---------- */
  function floatReaction(emoji, name) {
    if (!R.floats) return;
    const el = document.createElement('div'); el.className = 'rn-float'; el.style.left = (8 + Math.random() * 76) + '%';
    el.innerHTML = '<span class="e"></span><span class="n"></span>';
    el.querySelector('.e').textContent = emoji; el.querySelector('.n').textContent = name;
    R.floats.appendChild(el); setTimeout(() => el.remove(), 3200);
  }
  function sendReaction(emoji) {
    const s = session; if (!s) return;
    const now = Date.now(); if (now - (s.lastReactAt || 0) < 120) return; s.lastReactAt = now;
    floatReaction(emoji, 'You');
    s.peers.forEach((p) => { if (p.connected) sendSignal(s, p.userId, { kind: 'react', emoji }); });
  }
  function sendSound(id) {
    const s = session; if (!s || !SOUNDS[id]) return;
    const now = Date.now(); if (now - (s.lastSoundAt || 0) < 1500) { toast('Easy — wait a second between sounds.'); return; }
    s.lastSoundAt = now; playSound(id);
    s.peers.forEach((p) => { if (p.connected) sendSignal(s, p.userId, { kind: 'sound', id }); });
  }
  function onSound(peer, data) {
    const id = data && data.id; if (!SOUNDS[id]) return;
    const now = Date.now(); if (now - (peer.lastSoundAt || 0) < 1200) return; peer.lastSoundAt = now;
    if (!session.deafened) playSound(id);
    toast(`${peer.username || 'Someone'} played ${SOUNDS[id].ic} ${SOUNDS[id].label}`);
  }
  function toggleHand() {
    const s = session; if (!s) return;
    s.hand = !s.hand; render(); broadcastState();
    toast(s.hand ? '✋ Hand raised' : 'Hand lowered');
  }

  function pttHold(on) {
    const s = session; if (!s) return;
    const t = s.localStream.getAudioTracks()[0]; if (!t) return;
    t.enabled = on; s.muted = !on; render(); broadcastState();
  }
  function setPtt(on) {
    const s = session; if (!s) return;
    s.ptt = on; if (R.pttChk) R.pttChk.checked = on;
    if (on) { pttHold(false); toast('Push-to-talk on — hold Space to talk.'); } else pttHold(true);
  }

  function updateBadge() {
    const s = session; if (!R.chatBadge || !s) return;
    R.chatBadge.hidden = !s.unread; R.chatBadge.textContent = s.unread > 9 ? '9+' : String(s.unread || '');
  }
  function toggleChat(force) {
    const open = force !== undefined ? force : !R.chat.classList.contains('open');
    R.chat.classList.toggle('open', open); R.chatBtn.classList.toggle('active', open);
    if (open) {
      R.members.classList.remove('open'); R.membersBtn.classList.remove('active');
      if (session) { session.unread = 0; updateBadge(); }
      R.chatInput.focus();
    }
  }
  function addChatLine(name, text, mine) {
    const row = document.createElement('div'); row.className = 'rn-msg' + (mine ? ' mine' : '');
    const b = document.createElement('b'); b.textContent = name;
    const sp = document.createElement('span'); sp.textContent = text;
    row.append(b, sp); R.chatList.appendChild(row); R.chatList.scrollTop = R.chatList.scrollHeight;
  }
  function sendChat(text) {
    const s = session; text = String(text || '').trim().slice(0, 300); if (!s || !text) return;
    s.peers.forEach((p) => { if (p.connected) sendSignal(s, p.userId, { kind: 'chat', text }); });
    addChatLine('You', text, true);
  }
  function onChatMsg(peer, data) {
    const text = String((data && data.text) || '').slice(0, 300); if (!text) return;
    addChatLine(peer.username || 'Player', text, false);
    if (!R.chat.classList.contains('open')) { session.unread = (session.unread || 0) + 1; updateBadge(); }
  }

  // WhatsApp-style "add people" for an ongoing group call
  let addModal = null;
  async function openAddPeople() {
    const s = session; if (!s || s.kind !== 'group') return;
    const base = (typeof API_BASE !== 'undefined') ? API_BASE : '';
    const token = (window.AUTH && AUTH.getToken) ? AUTH.getToken() : null;
    if (!base || !token) { toast("Couldn't load your contacts on this page."); return; }
    let contacts = [];
    try { const r = await fetch(base + '/api/contacts', { headers: { Authorization: 'Bearer ' + token } }); contacts = (await r.json()).contacts || []; }
    catch (e) { toast("Couldn't load your contacts."); return; }
    const inCall = new Set([String(ctx.getMyUserId()), ...s.peers.keys()]);
    const list = contacts.filter((c) => !inCall.has(String(c.id)));
    if (!addModal) {
      addModal = makeModal('rnAddModal', '➕ Add people', 'Ring more contacts into this group call.');
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'rn-btn ghost'; cancel.textContent = 'Cancel';
      cancel.onclick = () => addModal.root.classList.remove('open');
      const go = document.createElement('button'); go.type = 'button'; go.className = 'rn-btn'; go.textContent = 'Invite';
      go.onclick = () => {
        const ids = Array.from(addModal.body.querySelectorAll('input:checked')).map((i) => i.value);
        if (ids.length && session && session.kind === 'group') {
          socket.emit('groupcall:invite', { callId: session.callId, calleeIds: ids, type: session.type });
          toast(`Invited ${ids.length} ${ids.length === 1 ? 'person' : 'people'}.`);
        }
        addModal.root.classList.remove('open');
      };
      addModal.actions.append(cancel, go);
    }
    addModal.body.innerHTML = '';
    if (!list.length) addModal.body.innerHTML = '<div class="rn-empty">Everyone in your contacts is already in this call.</div>';
    list.forEach((c) => {
      const row = document.createElement('label'); row.className = 'rn-check-row';
      row.innerHTML = '<input type="checkbox"><span class="rn-hist-av"></span><span class="rn-member-name"></span>';
      row.querySelector('input').value = c.id;
      row.querySelector('.rn-hist-av').textContent = c.avatar || '🎮';
      row.querySelector('.rn-member-name').textContent = c.username;
      addModal.body.appendChild(row);
    });
    addModal.root.classList.add('open');
  }

  function sendQuickReply(text) {
    const inv = incoming; if (!inv || inv.kind !== 'dm' || !socket) return;
    socket.emit('dm:message', { toUserId: inv.fromUserId, text });
    declineIncoming(); toast('Reply sent.');
  }

  function buildFun() {
    R.reactRow.innerHTML = ''; R.soundRow.innerHTML = ''; R.filterRow.innerHTML = ''; R.vibeRow.innerHTML = '';
    REACTIONS.forEach((e) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rn-chip big'; b.textContent = e; b.onclick = () => sendReaction(e); R.reactRow.appendChild(b); });
    Object.entries(SOUNDS).forEach(([id, snd]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rn-chip'; b.textContent = snd.ic + ' ' + snd.label; b.onclick = () => sendSound(id); R.soundRow.appendChild(b); });
    Object.entries(FILTERS).forEach(([id, f]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rn-chip'; b.dataset.filter = id; b.textContent = f.ic + ' ' + f.label; b.onclick = () => applyFilter(id); R.filterRow.appendChild(b); });
    Object.entries(THEMES).forEach(([id, t]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'rn-chip'; b.dataset.vibe = id; b.title = t.label; b.innerHTML = `<i class="rn-dot" style="background:${t.dot}"></i>${t.label}`; b.onclick = () => setTheme(id); R.vibeRow.appendChild(b); });
    R.pttChk.onchange = () => setPtt(R.pttChk.checked);
    updateFilterRow();
  }

  const CTL = (id, ic, label, cls) => `<button type="button" id="${id}" class="rn-ctl ${cls || ''}" title="${label}"><span class="ic"><span>${ic}</span></span><span class="lb">${label}</span></button>`;

  function buildUI() {
    if (R.overlay) return;
    const o = document.createElement('div');
    o.id = 'rnCallOverlay'; o.className = 'rn-call-overlay'; o.dataset.kind = 'dm';
    o.innerHTML = `
      <div class="rn-top">
        <div class="rn-kind"><span id="rnKindIcon">👤</span><span id="rnKindLabel">Personal call</span></div>
        <div class="rn-title-wrap"><h3 id="rnCallTitle">Call</h3><p id="rnCallStatus"></p></div>
        <div class="rn-top-actions">
          <span class="rn-streak" id="rnStreak" hidden></span>
          <span class="rn-quality" id="rnQuality" title="Connection" hidden><i></i><i></i><i></i></span>
          <button type="button" id="rnChatBtn" class="rn-icon-btn" title="In-call chat">💬<span class="rn-badge" id="rnChatBadge" hidden></span></button>
          <button type="button" id="rnMembersBtn" class="rn-icon-btn" title="Participants">👥</button>
          <button type="button" id="rnMinBtn" class="rn-icon-btn" title="Minimise">▁</button>
          <button type="button" id="rnFsBtn" class="rn-icon-btn" title="Fullscreen">⛶</button>
        </div>
      </div>
      <div class="rn-stage">
        <div id="rnGrid" class="rn-grid" data-kind="dm" data-count="1"></div>
        <aside id="rnMembers" class="rn-members"></aside>
        <aside id="rnChat" class="rn-chat">
          <h4>In-call chat</h4>
          <div id="rnChatList" class="rn-chat-list"></div>
          <form id="rnChatForm" class="rn-chat-form" autocomplete="off"><input id="rnChatInput" type="text" maxlength="300" placeholder="Message everyone in the call…"><button type="submit">➤</button></form>
        </aside>
        <div class="rn-float-layer" id="rnFloats"></div>
      </div>
      <div class="rn-fun" id="rnFun">
        <div class="rn-fun-sec"><h5>Reactions</h5><div class="rn-fun-row" id="rnReactRow"></div></div>
        <div class="rn-fun-sec"><h5>Soundboard — everyone hears it</h5><div class="rn-fun-row" id="rnSoundRow"></div></div>
        <div class="rn-fun-sec"><h5>Camera filters — everyone sees them</h5><div class="rn-fun-row" id="rnFilterRow"></div></div>
        <div class="rn-fun-sec"><h5>Call vibe — changes it for everyone</h5><div class="rn-fun-row" id="rnVibeRow"></div></div>
        <div class="rn-fun-sec"><label class="rn-switch"><input type="checkbox" id="rnPttChk"> 🎙️ Push-to-talk (hold Space)</label></div>
      </div>
      <div class="rn-controls">
        ${CTL('rnMuteBtn', '🎤', 'Mute')}
        ${CTL('rnCameraBtn', '📷', 'Camera')}
        ${CTL('rnFlipBtn', '🔄', 'Flip')}
        ${CTL('rnShareBtn', '🖥️', 'Share')}
        ${CTL('rnSpeakerBtn', '🔊', 'Speaker')}
        ${CTL('rnHandBtn', '✋', 'Hand')}
        ${CTL('rnFunBtn', '✨', 'Fun')}
        ${CTL('rnHangupBtn', '📞', 'Leave', 'hangup')}
      </div>
      <div class="rn-mini" id="rnMini">
        <div class="rn-mini-av" id="rnMiniAv">🎮</div>
        <div class="rn-mini-text"><strong id="rnMiniTitle">Call</strong><span id="rnMiniStatus"></span></div>
        <button type="button" id="rnMiniMute" class="rn-icon-btn" title="Mute">🎤</button>
        <button type="button" id="rnMiniHang" class="rn-icon-btn" title="Leave" style="background:var(--rn-red)">✕</button>
      </div>`;
    document.body.appendChild(o);

    const b = document.createElement('div');
    b.id = 'rnIncomingCall'; b.className = 'rn-incoming-call'; b.dataset.kind = 'dm';
    b.innerHTML = `
      <div class="rn-incoming-info">
        <div class="rn-incoming-avatar-wrap"><div class="rn-incoming-avatar" id="rnIncomingAvatar">🎮</div><span class="rn-incoming-badge" id="rnIncomingBadge">👤</span></div>
        <div class="rn-incoming-text">
          <strong><span id="rnIncomingText">Incoming call</span><span class="rn-incoming-tag" id="rnIncomingTag">Personal</span></strong>
          <span class="rn-incoming-sub" id="rnIncomingSub"></span>
        </div>
      </div>
      <div class="rn-incoming-actions">
        <button type="button" id="rnQuickBtn" class="rn-incoming-voice" title="Reply with a message">💬</button>
        <button type="button" id="rnDeclineBtn" class="rn-incoming-decline" title="Decline">✕</button>
        <button type="button" id="rnVoiceOnlyBtn" class="rn-incoming-voice" title="Answer with voice only">🎤</button>
        <button type="button" id="rnAcceptBtn" class="rn-incoming-accept" title="Accept">✓</button>
      </div>
      <div class="rn-quick-row" id="rnQuickRow">
        <button type="button">Can’t talk right now 🙏</button><button type="button">I’ll call you back 📞</button><button type="button">Text me instead 💬</button>
      </div>`;
    document.body.appendChild(b);

    Object.assign(R, {
      overlay: o, inBanner: b, grid: $('rnGrid'), members: $('rnMembers'), title: $('rnCallTitle'), status: $('rnCallStatus'),
      kindIcon: $('rnKindIcon'), kindLabel: $('rnKindLabel'), membersBtn: $('rnMembersBtn'), minBtn: $('rnMinBtn'), fsBtn: $('rnFsBtn'),
      mute: $('rnMuteBtn'), cam: $('rnCameraBtn'), flip: $('rnFlipBtn'), share: $('rnShareBtn'), speaker: $('rnSpeakerBtn'), hang: $('rnHangupBtn'),
      miniAv: $('rnMiniAv'), miniTitle: $('rnMiniTitle'), miniStatus: $('rnMiniStatus'), miniMute: $('rnMiniMute'), miniHang: $('rnMiniHang'),
      voiceOnly: $('rnVoiceOnlyBtn'),
      chatBtn: $('rnChatBtn'), chatBadge: $('rnChatBadge'), chat: $('rnChat'), chatList: $('rnChatList'), chatInput: $('rnChatInput'),
      quality: $('rnQuality'), streak: $('rnStreak'), floats: $('rnFloats'), fun: $('rnFun'), handBtn: $('rnHandBtn'), funBtn: $('rnFunBtn'),
      reactRow: $('rnReactRow'), soundRow: $('rnSoundRow'), filterRow: $('rnFilterRow'), vibeRow: $('rnVibeRow'), pttChk: $('rnPttChk'),
      quickBtn: $('rnQuickBtn'), quickRow: $('rnQuickRow')
    });
    buildFun();
    R.chatBtn.onclick = () => toggleChat();
    $('rnChatForm').onsubmit = (e) => { e.preventDefault(); sendChat(R.chatInput.value); R.chatInput.value = ''; };
    R.handBtn.onclick = toggleHand;
    R.funBtn.onclick = (e) => { e.stopPropagation(); R.fun.classList.toggle('open'); R.funBtn.classList.toggle('live', R.fun.classList.contains('open')); };
    document.addEventListener('click', (e) => {
      if (R.fun.classList.contains('open') && !R.fun.contains(e.target) && !R.funBtn.contains(e.target)) { R.fun.classList.remove('open'); R.funBtn.classList.remove('live'); }
    });
    R.members.addEventListener('click', (e) => { if (e.target.closest('#rnAddBtn')) openAddPeople(); });
    R.members.addEventListener('input', (e) => {
      const el = e.target.closest('.rn-vol'); if (!el || !session) return;
      const p = session.peers.get(el.dataset.uid);
      if (p) { p.volume = el.value / 100; if (p.tile) p.tile.video.volume = p.volume; }
    });
    R.quickBtn.onclick = () => R.quickRow.classList.toggle('open');
    R.quickRow.querySelectorAll('button').forEach((b) => { b.onclick = () => sendQuickReply(b.textContent); });
    window.addEventListener('blur', () => { if (session && session.ptt) pttHold(false); });

    R.mute.onclick = toggleMute; R.miniMute.onclick = (e) => { e.stopPropagation(); toggleMute(); };
    R.cam.onclick = toggleCamera; R.flip.onclick = flipCamera; R.share.onclick = toggleShare; R.speaker.onclick = toggleSpeaker;
    R.hang.onclick = () => endSession(true, 'completed');
    R.miniHang.onclick = (e) => { e.stopPropagation(); endSession(true, 'completed'); };
    R.minBtn.onclick = () => setMinimized(true);
    $('rnMini').onclick = () => setMinimized(false);
    R.membersBtn.onclick = () => { R.members.classList.toggle('open'); R.membersBtn.classList.toggle('active', R.members.classList.contains('open')); if (R.members.classList.contains('open')) toggleChat(false); };
    R.fsBtn.onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (R.overlay.requestFullscreen) R.overlay.requestFullscreen().catch(() => {});
    };
    if (!R.overlay.requestFullscreen) R.fsBtn.style.display = 'none';
    $('rnAcceptBtn').onclick = () => acceptIncoming(false);
    R.voiceOnly.onclick = () => acceptIncoming(true);
    $('rnDeclineBtn').onclick = () => declineIncoming();

    document.addEventListener('keydown', (e) => {
      if (!session || !R.overlay.classList.contains('active')) return;
      if (/^(input|textarea|select)$/i.test((e.target && e.target.tagName) || '')) return;
      if (e.code === 'Space' && session.ptt) { e.preventDefault(); if (!e.repeat) pttHold(true); }
      else if (e.key === 'm' || e.key === 'M') toggleMute();
      else if (e.key === 'h' || e.key === 'H') toggleHand();
      else if (e.key === 'v' || e.key === 'V') toggleCamera();
      else if (e.key === 'd' || e.key === 'D') toggleSpeaker();
      else if (e.key === 'Escape') setMinimized(!session.minimized);
    });
    document.addEventListener('keyup', (e) => { if (session && session.ptt && e.code === 'Space') pttHold(false); });
  }

  function setMinimized(v) {
    if (!session) return;
    session.minimized = v;
    R.overlay.classList.toggle('minimized', v);
  }

  /* ---------- tiles ---------- */
  function makeTile(name, avatar, isLocal) {
    const tile = document.createElement('div');
    tile.className = 'rn-tile' + (isLocal ? ' local' : '');
    const video = document.createElement('video');
    video.className = 'rn-tile-video off'; video.autoplay = true; video.playsInline = true;
    if (isLocal) video.muted = true;
    const av = document.createElement('div'); av.className = 'rn-tile-avatar'; av.textContent = avatar || '🎮';
    const label = document.createElement('div'); label.className = 'rn-tile-label';
    const nameEl = document.createElement('span'); nameEl.className = 'rn-tile-name'; nameEl.textContent = isLocal ? 'You' : (name || 'Player');
    const micEl = document.createElement('span'); micEl.textContent = '🔇'; micEl.hidden = true;
    const shareEl = document.createElement('span'); shareEl.textContent = '🖥️'; shareEl.hidden = true;
    const eq = document.createElement('span'); eq.className = 'rn-eq'; eq.innerHTML = '<i></i><i></i><i></i>';
    const handEl = document.createElement('span'); handEl.textContent = '✋'; handEl.hidden = true;
    label.append(nameEl, eq, micEl, handEl, shareEl);
    tile.append(video, av, label);
    const refs = { tile, video, avEl: av, nameEl, micEl, handEl, shareEl, stopWatch: null, userId: null };
    tile.addEventListener('click', () => {
      if (!session || session.kind === 'dm') return;
      const key = isLocal ? 'local' : refs.userId;
      session.pinned = session.pinned === key ? null : key;
      render();
    });
    return refs;
  }

  function removeTile(refs) {
    if (!refs) return;
    if (refs.stopWatch) refs.stopWatch();
    if (refs.tile.parentNode) refs.tile.parentNode.removeChild(refs.tile);
  }

  function setTile(refs, stream, showVideo) {
    if (refs.video.srcObject !== stream) {
      refs.video.srcObject = stream || null;
      if (stream) refs.video.play().catch(() => {});
    }
    refs.video.classList.toggle('off', !showVideo);
    refs.tile.classList.toggle('has-video', !!showVideo);
  }

  // Live voice detection: sets --lvl (0..1) on the tile every 100ms so the avatar can
  // "vibrate" with the real volume, and flags the tile as .speaking (with a short hold so it doesn't flicker).
  function watchSpeaking(stream, refs, isLocal, uid) {
    const ac = getAudioCtx();
    if (!ac || !stream || !stream.getAudioTracks().length) return;
    try {
      const src = ac.createMediaStreamSource(stream);
      const an = ac.createAnalyser(); an.fftSize = 256; src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      let lastLoud = 0, speaking = false;
      const iv = setInterval(() => {
        let lvl = 0;
        if (!(isLocal && session && session.muted)) {
          an.getByteFrequencyData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
          lvl = Math.min(1, (sum / buf.length) / 50);
        }
        const now = Date.now();
        if (lvl > 0.28) lastLoud = now;
        const on = now - lastLoud < 350;
        refs.tile.style.setProperty('--lvl', on ? lvl.toFixed(2) : '0');
        if (on !== speaking) { speaking = on; refs.tile.classList.toggle('speaking', on); setSpeaking(uid, on); }
      }, 100);
      refs.stopWatch = () => { clearInterval(iv); try { src.disconnect(); } catch (e) {} setSpeaking(uid, false); };
    } catch (e) { /* analyser unsupported — indicator just won't show */ }
  }

  function setSpeaking(uid, on) {
    const s = session; if (!s) return;
    if (on) s.speaking.add(uid); else s.speaking.delete(uid);
    if (R.members) R.members.querySelectorAll('.rn-member').forEach((el) => el.classList.toggle('speaking', s.speaking.has(el.dataset.uid)));
    updateStatus();
  }

  function speakerNames(s) {
    if (s.kind === 'dm' || !s.speaking.size) return '';
    const names = Array.from(s.speaking).map((id) => id === 'local' ? 'You' : ((s.peers.get(id) || {}).username || 'Someone'));
    return ' · 🗣 ' + names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : '');
  }

  function localPreview(s) {
    if (!s.videoTrack) return null;
    if (!s.preview || s.previewTrack !== s.videoTrack) { s.preview = new MediaStream([s.videoTrack]); s.previewTrack = s.videoTrack; }
    return s.preview;
  }
  const sendingVideo = (s) => !!(s.videoTrack && (s.screenTrack || (s.camTrack && s.camTrack.enabled)));

  function peerShowsVideo(s, peer) {
    const has = !!(peer.stream && peer.stream.getVideoTracks().length);
    const camOn = peer.state.cam !== undefined ? peer.state.cam : s.type === 'video';
    return has && camOn;
  }

  function render() {
    const s = session; if (!s || !R.grid) return;

    if (!s.localTile) {
      s.localTile = makeTile('You', ctx.getMyAvatar(), true);
      R.grid.appendChild(s.localTile.tile);
      watchSpeaking(s.localStream, s.localTile, true, 'local');
    }
    const lt = s.localTile, sv = sendingVideo(s);
    setTile(lt, sv ? localPreview(s) : null, sv);
    lt.tile.classList.toggle('sharing', !!s.screenTrack);
    lt.tile.classList.toggle('hide-local', s.kind === 'dm' && !sv);
    lt.micEl.hidden = !s.muted; lt.shareEl.hidden = !s.screenTrack; lt.handEl.hidden = !s.hand;

    s.peers.forEach((peer) => {
      if (!peer.tile) { peer.tile = makeTile(peer.username, peer.avatar, false); peer.tile.userId = peer.userId; R.grid.appendChild(peer.tile.tile); }
      const t = peer.tile;
      t.nameEl.textContent = peer.username || 'Player';
      t.avEl.textContent = peer.avatar || '🎮';
      setTile(t, peer.stream, peerShowsVideo(s, peer));
      t.video.muted = !!s.deafened;
      t.video.volume = peer.volume == null ? 1 : peer.volume;
      t.handEl.hidden = !peer.state.hand;
      t.micEl.hidden = peer.state.mic !== false;
      t.shareEl.hidden = !peer.state.sharing;
      if (peer.stream && !peer.watched && peer.stream.getAudioTracks().length) { peer.watched = true; watchSpeaking(peer.stream, t, false, peer.userId); }
    });

    // pin / spotlight
    if (s.pinned && s.pinned !== 'local' && !s.peers.has(s.pinned)) s.pinned = null;
    R.grid.classList.toggle('has-pin', !!s.pinned && s.kind !== 'dm');
    lt.tile.classList.toggle('pinned', s.pinned === 'local');
    s.peers.forEach((p) => p.tile && p.tile.tile.classList.toggle('pinned', s.pinned === p.userId));

    const total = s.peers.size + 1;
    R.grid.dataset.kind = s.kind;
    R.grid.dataset.count = total > 9 ? 'many' : String(total);

    renderMembers();
    updateStatus();
    updateControls();
  }

  function renderMembers() {
    const s = session; if (!s || s.kind === 'dm') return;
    const rows = [{ uid: 'local', name: ctx.getMyUsername() + ' (you)', av: ctx.getMyAvatar(), mic: !s.muted, share: !!s.screenTrack, cam: sendingVideo(s), hand: !!s.hand, self: true }];
    s.peers.forEach((p) => rows.push({ uid: p.userId, name: p.username || 'Player', av: p.avatar, mic: p.state.mic !== false, share: !!p.state.sharing, cam: peerShowsVideo(s, p), hand: !!p.state.hand }));
    const sig = JSON.stringify(rows.map((r) => [r.uid, r.name, r.av, r.mic, r.share, r.cam, r.hand])) + s.kind;
    if (s._memSig === sig) return;      // nothing changed — don't rebuild (keeps volume sliders draggable)
    s._memSig = sig;
    const add = s.kind === 'group' ? '<button type="button" id="rnAddBtn" class="rn-add-btn">➕ Add people</button>' : '';
    R.members.innerHTML = `<h4>In call — ${rows.length}</h4>${add}` + rows.map((r) => {
      const p = s.peers.get(r.uid);
      const vol = (!r.self && p) ? `<input type="range" class="rn-vol" min="0" max="100" value="${Math.round((p.volume == null ? 1 : p.volume) * 100)}" data-uid="${esc(r.uid)}" title="Their volume">` : '';
      return `<div class="rn-member${s.speaking.has(r.uid) ? ' speaking' : ''}" data-uid="${esc(r.uid)}"><div class="rn-member-av">${esc(r.av || '🎮')}</div>
        <div class="rn-member-main"><div class="rn-member-name">${esc(r.name)}</div>${vol}</div>
        <div class="rn-member-icons">${r.hand ? '✋' : ''}${r.mic ? '' : '🔇'}${r.cam ? '🎥' : ''}${r.share ? '🖥️' : ''}</div></div>`;
    }).join('');
  }

  function statusText() {
    const s = session; if (!s) return '';
    const n = s.peers.size + 1;
    if (s.reconnecting) return 'Reconnecting…';
    if (!s.connected) {
      if (s.dir === 'out') return s.kind === 'dm' ? 'Calling…' : (s.kind === 'room' ? 'Calling the room…' : 'Ringing…');
      return 'Connecting…';
    }
    const t = s.startedAt ? fmt(Date.now() - s.startedAt) : '';
    if (s.kind === 'dm') return t;
    return (n === 1 ? 'Waiting for others… · ' + t : `${n} in call · ${t}`) + speakerNames(s);
  }

  function updateStatus() {
    const s = session; if (!s || !R.status) return;
    const txt = statusText();
    R.status.textContent = txt; R.miniStatus.textContent = txt;
  }

  function updateControls() {
    const s = session; if (!s || !R.mute) return;
    const setCtl = (btn, icon, label, cls) => {
      btn.querySelector('.ic span').textContent = icon; btn.querySelector('.lb').textContent = label;
      btn.classList.toggle('off', cls === 'off'); btn.classList.toggle('live', cls === 'live');
    };
    setCtl(R.mute, s.muted ? '🔇' : '🎤', s.ptt ? (s.muted ? 'Hold Space' : 'Talking…') : (s.muted ? 'Unmute' : 'Mute'), s.muted ? 'off' : (s.ptt ? 'live' : ''));
    setCtl(R.hand, '✋', s.hand ? 'Lower hand' : 'Hand', s.hand ? 'live' : '');
    const camOn = !!(s.camTrack && s.camTrack.enabled && s.camTrack.readyState === 'live');
    setCtl(R.cam, camOn ? '📷' : '🚫', camOn ? 'Camera' : (s.camTrack ? 'Camera off' : 'Camera'), s.camTrack && !camOn ? 'off' : '');
    setCtl(R.share, '🖥️', s.screenTrack ? 'Stop share' : 'Share', s.screenTrack ? 'live' : '');
    setCtl(R.speaker, s.deafened ? '🔇' : '🔊', 'Speaker', s.deafened ? 'off' : '');
    R.flip.style.display = (isTouch && s.camTrack) ? '' : 'none';
    R.share.style.display = (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && !isTouch) ? '' : 'none';
    R.membersBtn.style.display = s.kind === 'dm' ? 'none' : '';
    R.miniMute.textContent = s.muted ? '🔇' : '🎤';
  }

  function openUI() {
    buildUI();
    const s = session, meta = kindMeta(s.kind, s.type);
    R.overlay.dataset.kind = s.kind;
    R.kindIcon.textContent = meta.icon; R.kindLabel.textContent = meta.label;
    R.title.textContent = s.title; R.miniTitle.textContent = s.title;
    R.miniAv.textContent = s.avatar || (s.kind === 'dm' ? '🎮' : '👥');
    R.members.classList.remove('open'); R.membersBtn.classList.remove('active');
    R.overlay.classList.remove('minimized');
    const streak = s.kind === 'dm' ? callStreak(s.userId) : 0;
    R.streak.hidden = streak < 2; R.streak.textContent = '🔥 ' + streak + '-day streak';
    R.quality.hidden = true; R.chatList.innerHTML = ''; s.unread = 0; updateBadge();
    R.pttChk.checked = false; updateFilterRow();
    R.vibeRow.querySelectorAll('[data-vibe]').forEach((b) => b.classList.toggle('selected', b.dataset.vibe === 'default'));
    R.overlay.classList.add('active');
    render();
  }

  function closeUI() {
    if (!R.overlay) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    R.overlay.classList.remove('active', 'minimized');
    ['--rn-accent', '--rn-bg', '--rn-grad'].forEach((p) => R.overlay.style.removeProperty(p));
    R.fun.classList.remove('open'); R.funBtn.classList.remove('live');
    R.chat.classList.remove('open'); R.chatBtn.classList.remove('active'); R.floats.innerHTML = '';
    R.grid.querySelectorAll('video').forEach((v) => { v.srcObject = null; });
    R.grid.innerHTML = ''; R.members.innerHTML = '';
  }

  /* -----------------------------------------------------------
     SESSION + PEERS
  ----------------------------------------------------------- */
  function newSession(o) {
    return Object.assign({
      peers: new Map(), known: new Map(), muted: false, deafened: false, connected: false, startedAt: 0,
      pinned: null, minimized: false, facing: 'user', localTile: null, timer: null, ringTimeout: null,
      reconnecting: false, avatar: '', screenTrack: null, screenStream: null, speaking: new Set(),
      filter: 'none', hand: false, ptt: false, unread: 0, theme: 'default', qTimer: null, pipe: null, pipeTrack: null, lastSoundAt: 0, lastReactAt: 0
    }, o);
  }

  function sendSignal(s, toUserId, data) {
    if (!socket) return;
    if (s.kind === 'dm') socket.emit('call:signal', { toUserId, callId: s.callId, data });
    else if (s.kind === 'room') socket.emit('roomcall:signal', { room: s.room, callId: s.callId, toUserId, data });
    else socket.emit('groupcall:signal', { callId: s.callId, toUserId, data });
  }

  function createPeer(userId, info) {
    const s = session; userId = String(userId);
    const known = s.known.get(userId) || {};
    info = Object.assign({}, known, info || {});
    const peer = {
      userId, username: info.username || '', avatar: info.avatar || '', stream: null, pc: null, queued: [],
      state: {}, connected: false, restarted: false, videoSender: null, tile: null, watched: false, connectTimer: null, pendingReneg: false
    };
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peer.pc = pc;
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal(s, userId, { kind: 'candidate', candidate: e.candidate }); };
    pc.ontrack = (e) => {
      peer.stream = e.streams[0] || new MediaStream([e.track]);
      peer.stream.onaddtrack = () => render();
      e.track.onunmute = () => render();
      render();
    };
    pc.oniceconnectionstatechange = () => onIce(peer);
    s.localStream.getAudioTracks().forEach((t) => pc.addTrack(t, s.localStream));
    if (s.videoTrack) peer.videoSender = pc.addTrack(s.videoTrack, s.localStream);
    s.peers.set(userId, peer);
    return peer;
  }

  function closePeer(peer) {
    clearTimeout(peer.connectTimer);
    try { peer.pc.close(); } catch (e) {}
    removeTile(peer.tile); peer.tile = null;
  }

  function armConnectTimer(peer) {
    clearTimeout(peer.connectTimer);
    if (peer.connected) return;
    peer.connectTimer = setTimeout(() => { if (!peer.connected) peerFailed(peer); }, CONNECT_TIMEOUT_MS);
  }

  function onIce(peer) {
    const s = session; if (!s || s.peers.get(peer.userId) !== peer) return;
    const st = peer.pc.iceConnectionState;
    if (st === 'connected' || st === 'completed') {
      peer.connected = true; peer.restarted = false; clearTimeout(peer.connectTimer);
      s.reconnecting = false;
      if (!s.connected) {
        s.connected = true; s.startedAt = Date.now();
        stopRingback(); clearTimeout(s.ringTimeout);
        s.timer = setInterval(updateStatus, 1000);
        s.qTimer = setInterval(pollQuality, 3000); setTimeout(pollQuality, 800);
      }
      sendSignal(s, peer.userId, { kind: 'state', state: myState() });
      if (s.theme && s.theme !== 'default') sendSignal(s, peer.userId, { kind: 'theme', id: s.theme, explicit: false });
      render();
    } else if (st === 'disconnected') {
      s.reconnecting = true; updateStatus();
    } else if (st === 'failed') {
      if (!peer.restarted) { peer.restarted = true; s.reconnecting = true; renegotiate(peer, { iceRestart: true }); updateStatus(); }
      else peerFailed(peer);
    }
  }

  function peerFailed(peer) {
    const s = session; if (!s) return;
    if (s.kind === 'dm') {
      toast("Call couldn't connect — one of the networks may need a TURN server.");
      endSession(true, s.connected ? 'completed' : 'noanswer');
    } else {
      toast(`Lost connection to ${peer.username || 'a participant'}.`);
      closePeer(peer); s.peers.delete(peer.userId); s.reconnecting = false; render();
    }
  }

  async function renegotiate(peer, opts) {
    const pc = peer.pc;
    if (pc.signalingState !== 'stable') { peer.pendingReneg = true; return; }
    try {
      const offer = await pc.createOffer(opts || {});
      await pc.setLocalDescription(offer);
      sendSignal(session, peer.userId, { kind: 'offer', sdp: offer });
    } catch (e) { console.error('[calls] renegotiate error:', e); }
  }

  function flushQueued(peer) {
    const q = peer.queued; peer.queued = [];
    q.forEach((c) => peer.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
  }

  async function handleSignal(s, fromUserId, data) {
    fromUserId = String(fromUserId);
    let peer = s.peers.get(fromUserId);
    if (!peer) { if (s.kind === 'dm') return; peer = createPeer(fromUserId, {}); }
    if (data.kind === 'state') {
      const wasHand = !!peer.state.hand;
      peer.state = data.state || {};
      if (peer.state.hand && !wasHand) { toast(`✋ ${peer.username || 'Someone'} raised their hand`); playSound('ding'); }
      render(); return;
    }
    if (data.kind === 'chat') { onChatMsg(peer, data); return; }
    if (data.kind === 'react') { floatReaction(String(data.emoji || '').slice(0, 8), peer.username || 'Someone'); return; }
    if (data.kind === 'sound') { onSound(peer, data); return; }
    if (data.kind === 'theme') {
      if (THEMES[data.id] && (data.explicit || session.theme === 'default')) {
        applyTheme(data.id);
        if (data.explicit) toast(`${peer.username || 'Someone'} set the vibe to ${THEMES[data.id].label}`);
      }
      return;
    }
    const pc = peer.pc;
    try {
      if (data.kind === 'offer') {
        if (pc.signalingState !== 'stable') {
          const polite = String(ctx.getMyUserId()) < fromUserId;   // glare: one side backs off
          if (!polite) return;
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        flushQueued(peer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(s, fromUserId, { kind: 'answer', sdp: answer });
        armConnectTimer(peer);
      } else if (data.kind === 'answer') {
        if (pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        flushQueued(peer); armConnectTimer(peer);
        if (peer.pendingReneg) { peer.pendingReneg = false; renegotiate(peer); }
      } else if (data.kind === 'candidate') {
        if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
        else peer.queued.push(data.candidate);
      }
    } catch (err) { console.error('[calls] signal error:', err); }
  }

  /* ---------- local media ---------- */
  async function acquire(type) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("Calling needs microphone/camera access, and this browser doesn't support it."); return null;
    }
    try {
      const stream = await gum(type === 'video'
        ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } }
        : { audio: true });
      return { stream, type };
    } catch (err) {
      if (type === 'video') {
        try { const stream = await gum({ audio: true }); toast('Camera unavailable — continuing with voice only.'); return { stream, type: 'voice' }; } catch (e) { /* fall through */ }
      }
      toast('Microphone access was blocked. Allow it in your browser settings to make calls.');
      return null;
    }
  }

  function myState() {
    const s = session;
    return { mic: !s.muted, cam: sendingVideo(s), sharing: !!s.screenTrack, hand: !!s.hand };
  }
  function broadcastState() {
    const s = session; if (!s) return;
    s.peers.forEach((p) => { if (p.connected) sendSignal(s, p.userId, { kind: 'state', state: myState() }); });
  }

  function setOutgoingVideo(track) {
    const s = session; if (!s) return;
    s.videoTrack = track;
    s.peers.forEach((peer) => {
      if (peer.videoSender) peer.videoSender.replaceTrack(track).catch(() => {});
      else if (track) { peer.videoSender = peer.pc.addTrack(track, s.localStream); renegotiate(peer); }
    });
    render(); broadcastState();
  }

  function toggleMute() {
    const s = session; if (!s) return;
    if (s.ptt) { setPtt(false); return; }
    const t = s.localStream.getAudioTracks()[0]; if (!t) return;
    t.enabled = !t.enabled; s.muted = !t.enabled;
    render(); broadcastState();
  }

  function toggleSpeaker() {
    const s = session; if (!s) return;
    s.deafened = !s.deafened;
    s.peers.forEach((p) => { if (p.tile) p.tile.video.muted = s.deafened; });
    updateControls(); toast(s.deafened ? 'Speaker off — you can’t hear others.' : 'Speaker on.');
  }

  async function enableCamera() {
    const s = session;
    try {
      const st = await gum({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: s.facing } });
      const t = st.getVideoTracks()[0];
      s.camTrack = t; s.localStream.addTrack(t);
      if (s.filter && s.filter !== 'none') applyFilter(s.filter);
      else if (!s.screenTrack) setOutgoingVideo(t); else { render(); broadcastState(); }
    } catch (e) { toast('Camera access was blocked.'); }
  }

  function toggleCamera() {
    const s = session; if (!s) return;
    if (!s.camTrack || s.camTrack.readyState !== 'live') { enableCamera(); return; }
    s.camTrack.enabled = !s.camTrack.enabled;
    render(); broadcastState();
  }

  async function flipCamera() {
    const s = session; if (!s || !s.camTrack) return;
    s.facing = s.facing === 'user' ? 'environment' : 'user';
    const old = s.camTrack; old.stop();
    try {
      const st = await gum({ video: { facingMode: { ideal: s.facing } } });
      const t = st.getVideoTracks()[0];
      s.localStream.removeTrack(old); s.camTrack = t; s.localStream.addTrack(t);
      if (s.filter && s.filter !== 'none') applyFilter(s.filter);
      else if (!s.screenTrack) setOutgoingVideo(t); else render();
    } catch (e) { toast('Could not switch camera.'); }
  }

  async function toggleShare() {
    const s = session; if (!s) return;
    if (s.screenTrack) { stopShare(); return; }
    let ds;
    try { ds = await navigator.mediaDevices.getDisplayMedia({ video: true }); } catch (e) { return; }
    const t = ds.getVideoTracks()[0];
    s.screenStream = ds; s.screenTrack = t;
    t.onended = () => { if (session === s && s.screenTrack === t) stopShare(); };
    setOutgoingVideo(t); toast('You’re sharing your screen.');
  }

  function stopShare() {
    const s = session; if (!s || !s.screenTrack) return;
    s.screenTrack.stop(); s.screenStream = null; s.screenTrack = null;
    const cam = s.camTrack;
    setOutgoingVideo(camOut(s));
  }

  /* -----------------------------------------------------------
     STARTING CALLS
  ----------------------------------------------------------- */
  function beginSession(opts, got) {
    session = newSession(Object.assign({ type: got.type, localStream: got.stream }, opts));
    session.camTrack = got.stream.getVideoTracks()[0] || null;
    session.videoTrack = session.camTrack;
    openUI();
  }

  async function startDMCall(toUserId, toUsername, toAvatar, type) {
    if (!socket || session || incoming) return;
    const got = await acquire(type === 'video' ? 'video' : 'voice'); if (!got) return;
    const callId = genId();
    beginSession({ kind: 'dm', callId, dir: 'out', title: toUsername || 'Player', avatar: toAvatar, peerId: String(toUserId), userId: String(toUserId) }, got);
    const s = session;
    const peer = createPeer(toUserId, { username: toUsername, avatar: toAvatar });
    socket.emit('call:invite', { toUserId, callId, type: got.type });
    startRingback();
    s.ringTimeout = setTimeout(() => {
      if (session === s && !s.connected) { toast(`${s.title} didn't answer.`); endSession(true, 'noanswer'); }
    }, RING_TIMEOUT_MS);
    renegotiate(peer);
    render();
  }

  async function startRoomCall(room, roomName, type) {
    if (!socket || session || incoming) return;
    const got = await acquire(type === 'video' ? 'video' : 'voice'); if (!got) return;
    const callId = genId();
    beginSession({ kind: 'room', callId, dir: 'out', room, title: roomName || humanizeRoom(room), avatar: '#' }, got);
    const s = session;
    socket.emit('roomcall:start', { room, callId, type: got.type });
    socket.emit('roomcall:join', { room, callId });
    startRingback();
    s.ringTimeout = setTimeout(() => { if (session === s && !s.connected) stopRingback(); }, RING_TIMEOUT_MS);
  }

  async function startGroupCall(participantIds, type) {
    if (!socket || session || incoming) return;
    const calleeIds = (participantIds || []).map(String).filter(Boolean);
    if (!calleeIds.length) return;
    const got = await acquire(type === 'video' ? 'video' : 'voice'); if (!got) return;
    const callId = genId();
    beginSession({ kind: 'group', callId, dir: 'out', title: 'Group call', avatar: '👥', invited: calleeIds.length }, got);
    const s = session;
    socket.emit('groupcall:invite', { calleeIds, callId, type: got.type });
    socket.emit('groupcall:join', { callId });
    startRingback();
    s.ringTimeout = setTimeout(() => {
      if (session === s && !s.connected) { toast('No one joined the group call.'); endSession(true, 'noanswer'); }
    }, RING_TIMEOUT_MS);
  }

  /* -----------------------------------------------------------
     INCOMING
  ----------------------------------------------------------- */
  function onInvite(kind, p) {
    p = p || {};
    const inv = {
      kind, callId: p.callId, type: p.type === 'video' ? 'video' : 'voice', room: p.room,
      fromUserId: String(p.fromUserId || ''), fromUsername: p.fromUsername || 'Someone', avatar: p.fromAvatar || '',
      count: p.participantCount || 0, pending: [], timeout: null,
      title: kind === 'room' ? (p.roomName || humanizeRoom(p.room)) : (p.fromUsername || 'Someone')
    };
    if (session || incoming) {
      if (kind === 'dm') socket.emit('call:decline', { toUserId: inv.fromUserId, callId: inv.callId });
      else if (kind === 'group') socket.emit('groupcall:decline', { callId: inv.callId });
      if (kind !== 'room') logCall({ kind, dir: 'in', status: 'missed', type: inv.type, name: inv.title, avatar: inv.avatar, userId: inv.fromUserId });
      return;
    }
    incoming = inv;
    showIncoming(inv);
    startRingtone();
    inv.timeout = setTimeout(() => dismissIncoming('missed'), INVITE_TIMEOUT_MS);
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        const n = new Notification(inv.title, { body: kindMeta(kind, inv.type).label, tag: 'call:' + inv.callId });
        n.onclick = () => { window.focus(); n.close(); };
      } catch (e) {}
    }
  }

  function showIncoming(inv) {
    buildUI();
    const meta = kindMeta(inv.kind, inv.type);
    R.inBanner.dataset.kind = inv.kind;
    $('rnIncomingAvatar').textContent = inv.avatar || (inv.kind === 'dm' ? '🎮' : (inv.kind === 'group' ? '👥' : '#'));
    $('rnIncomingBadge').textContent = meta.icon;
    $('rnIncomingTag').textContent = meta.tag;
    $('rnIncomingText').textContent = inv.title;
    let sub = meta.label;
    if (inv.kind === 'group' && inv.count > 0) sub += ` · ${inv.count + 1} people · from ${inv.fromUsername}`;
    else if (inv.kind === 'room') sub = `${inv.fromUsername} started a ${inv.type} call`;
    $('rnIncomingSub').textContent = sub;
    if (inv.kind === 'dm') { const st = callStreak(inv.fromUserId); if (st >= 2) sub += ` · 🔥 ${st}-day streak`; }
    $('rnIncomingSub').textContent = sub;
    R.voiceOnly.style.display = inv.type === 'video' ? '' : 'none';
    R.quickBtn.style.display = inv.kind === 'dm' ? '' : 'none';
    R.quickRow.classList.remove('open');
    R.inBanner.classList.add('active');
  }

  function hideIncoming() { if (R.inBanner) R.inBanner.classList.remove('active'); }

  function dismissIncoming(status) {
    const inv = incoming; if (!inv) return;
    incoming = null; clearTimeout(inv.timeout);
    hideIncoming(); stopRingtone();
    if (status === 'missed') {
      logCall({ kind: inv.kind, dir: 'in', status: 'missed', type: inv.type, name: inv.title, avatar: inv.avatar, userId: inv.fromUserId });
      toast(`Missed ${kindMeta(inv.kind, inv.type).label.toLowerCase()} from ${inv.fromUsername}`);
    }
  }

  function declineIncoming() {
    const inv = incoming; if (!inv) return;
    if (inv.kind === 'dm') socket.emit('call:decline', { toUserId: inv.fromUserId, callId: inv.callId });
    else if (inv.kind === 'group') socket.emit('groupcall:decline', { callId: inv.callId });
    logCall({ kind: inv.kind, dir: 'in', status: 'declined', type: inv.type, name: inv.title, avatar: inv.avatar, userId: inv.fromUserId });
    incoming = null; clearTimeout(inv.timeout); hideIncoming(); stopRingtone();
  }

  async function acceptIncoming(voiceOnly) {
    const inv = incoming; if (!inv) return;
    incoming = null; clearTimeout(inv.timeout); hideIncoming(); stopRingtone();
    const got = await acquire(voiceOnly ? 'voice' : inv.type);
    if (!got) {
      if (inv.kind === 'dm') socket.emit('call:decline', { toUserId: inv.fromUserId, callId: inv.callId });
      else if (inv.kind === 'group') socket.emit('groupcall:decline', { callId: inv.callId });
      return;
    }
    beginSession({
      kind: inv.kind, callId: inv.callId, dir: 'in', room: inv.room, title: inv.title,
      avatar: inv.kind === 'room' ? '#' : (inv.kind === 'group' ? '👥' : inv.avatar), userId: inv.fromUserId
    }, got);
    const s = session;
    if (inv.kind === 'dm') {
      s.peerId = inv.fromUserId;
      createPeer(inv.fromUserId, { username: inv.fromUsername, avatar: inv.avatar });
      for (const item of inv.pending) await handleSignal(s, item.from, item.data);   // offer/candidates that arrived while ringing
    } else if (inv.kind === 'room') {
      socket.emit('roomcall:join', { room: inv.room, callId: inv.callId });
    } else {
      socket.emit('groupcall:join', { callId: inv.callId });
    }
    render();
  }

  /* -----------------------------------------------------------
     ENDING
  ----------------------------------------------------------- */
  function endSession(notify, status) {
    const s = session; if (!s) return;
    session = null;
    stopRingback(); clearInterval(s.timer); clearInterval(s.qTimer); clearTimeout(s.ringTimeout);
    stopPipeline(s);
    const streakBefore = s.kind === 'dm' ? callStreak(s.userId) : 0;
    if (notify && socket) {
      if (s.kind === 'dm') socket.emit('call:end', { toUserId: s.peerId, callId: s.callId });
      else if (s.kind === 'room') socket.emit('roomcall:leave', { room: s.room, callId: s.callId });
      else socket.emit('groupcall:leave', { callId: s.callId });
    }
    s.peers.forEach(closePeer);
    s.localStream.getTracks().forEach((t) => t.stop());
    if (s.camTrack) s.camTrack.stop();
    if (s.screenTrack) s.screenTrack.stop();
    if (s.localTile) removeTile(s.localTile);
    const duration = s.startedAt ? Math.round((Date.now() - s.startedAt) / 1000) : 0;
    const finalStatus = s.connected ? 'completed' : (status || (s.dir === 'out' ? 'cancelled' : 'missed'));
    logCall({ kind: s.kind, dir: s.dir, status: finalStatus, type: s.type, name: s.title, avatar: s.avatar, userId: s.userId, duration });
    closeUI();
    if (s.connected) toast(`Call ended · ${fmt(duration * 1000)}`);
    if (s.kind === 'dm' && finalStatus === 'completed') {
      const after = callStreak(s.userId);
      if (after >= 2 && after > streakBefore) setTimeout(() => toast(`🔥 ${after}-day call streak with ${s.title}!`), 1200);
    }
  }

  function onRemoteEnded(callId) {
    if (session && session.kind === 'dm' && session.callId === callId) { endSession(false, 'completed'); return; }
    if (incoming && incoming.kind === 'dm' && incoming.callId === callId) dismissIncoming('missed');
  }

  function matches(kind, callId) { return session && session.kind === kind && session.callId === callId; }

  function routeSignal(kind, callId, from, data) {
    if (!data) return;
    if (matches(kind, callId)) { handleSignal(session, from, data); return; }
    if (kind === 'dm' && incoming && incoming.kind === 'dm' && incoming.callId === callId) incoming.pending.push({ from, data });
  }

  function onParticipants(kind, callId, list) {
    if (!matches(kind, callId)) return;
    (list || []).forEach((p) => {
      const id = String(p.userId);
      session.known.set(id, { username: p.username, avatar: p.avatar });
      if (!session.peers.has(id)) {
        const peer = createPeer(id, p);
        renegotiate(peer);        // the joiner always offers to people already in the call
      }
    });
    render();
  }

  function onPeerJoined(kind, callId, p) {
    if (!matches(kind, callId)) return;
    const id = String(p.userId);
    session.known.set(id, { username: p.username, avatar: p.avatar });
    if (!session.peers.has(id)) createPeer(id, p);   // they'll send us an offer
    render();
  }

  function onPeerLeft(kind, callId, userId) {
    if (!matches(kind, callId)) return;
    const peer = session.peers.get(String(userId));
    if (peer) { closePeer(peer); session.peers.delete(String(userId)); }
    render();
  }

  /* -----------------------------------------------------------
     PUBLIC API
  ----------------------------------------------------------- */
  function init(socketInstance, context) {
    socket = socketInstance;
    ctx = Object.assign(ctx, context || {});
    buildUI();
    if (!socket || boundSocket === socket) return;   // don't double-bind if init/attachSocket run twice
    boundSocket = socket;

    socket.on('call:invite', (p) => onInvite('dm', p));
    socket.on('call:signal', (p) => { p = p || {}; routeSignal('dm', p.callId, p.fromUserId, p.data); });
    socket.on('call:ended', (p) => onRemoteEnded((p || {}).callId));
    socket.on('call:declined', (p) => {
      if (matches('dm', (p || {}).callId)) { toast(`${session.title || 'They'} declined the call.`); endSession(false, 'declined'); }
    });

    socket.on('roomcall:incoming', (p) => onInvite('room', p));
    socket.on('roomcall:participants', (p) => { p = p || {}; onParticipants('room', p.callId, p.participants); });
    socket.on('roomcall:peer-joined', (p) => { p = p || {}; onPeerJoined('room', p.callId, p); });
    socket.on('roomcall:signal', (p) => { p = p || {}; routeSignal('room', p.callId, p.fromUserId, p.data); });
    socket.on('roomcall:peer-left', (p) => { p = p || {}; onPeerLeft('room', p.callId, p.userId); });

    socket.on('groupcall:invite', (p) => onInvite('group', p));
    socket.on('groupcall:participants', (p) => { p = p || {}; onParticipants('group', p.callId, p.participants); });
    socket.on('groupcall:peer-joined', (p) => { p = p || {}; onPeerJoined('group', p.callId, p); });
    socket.on('groupcall:signal', (p) => { p = p || {}; routeSignal('group', p.callId, p.fromUserId, p.data); });
    socket.on('groupcall:peer-left', (p) => { p = p || {}; onPeerLeft('group', p.callId, p.userId); });
    socket.on('groupcall:declined', (p) => { if (matches('group', (p || {}).callId)) toast('Someone declined the group call.'); });
  }

  function attachSocket(socketInstance) { init(socketInstance, ctx); }

  window.RemixCalls = {
    init,
    attachSocket,
    startDMCall,
    startRoomCall,
    startGroupCall,
    isBusy: () => !!(session || incoming),
    leaveRoomCall: () => { if (session && session.kind === 'room') endSession(true, 'completed'); },
    leaveGroupCall: () => { if (session && session.kind === 'group') endSession(true, 'completed'); },
    openRingtoneSettings,
    openCallHistory
  };
})();
