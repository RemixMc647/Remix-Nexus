/*==============================
REMIX NEXUS — NEXUS ARENA (client)
One file for Chat.html AND NexusRealm.html. Add it as the LAST script
(after Chat.js / NexusRealm.js, and after nexus-ai-ball.js). It needs
rooms.js loaded before it (Chat.html already has it; add it to NexusRealm.html).
==============================*/
(() => {
'use strict';
if (window.__nexusArena) return; window.__nexusArena = true;

const BASE = String((typeof BACKEND_URL !== 'undefined' && BACKEND_URL) || 'https://remix-nexus-bgz9.onrender.com').replace(/\/+$/, '');
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tok = () => { try { return window.AUTH && AUTH.getToken ? AUTH.getToken() : null; } catch (e) { return null; } };
const IN_CHAT = !!$('#messages') && !!$('#activeRoomName');
const IN_REALM = !!$('#panel-challenges');
const chatSocket = () => { try { return typeof socket !== 'undefined' ? socket : null; } catch (e) { return null; } };
const curRoom = () => { try { return typeof activeRoomId !== 'undefined' ? activeRoomId : ''; } catch (e) { return ''; } };
const gameRooms = () => { try { return (typeof DEFAULT_ROOMS !== 'undefined' ? DEFAULT_ROOMS : []).filter(r => r.id !== 'lounge'); } catch (e) { return []; } };

let ME = null, CAN_DECIDE = false;
const store = new Map();       // id -> brief challenge
let open = null;               // { id } of the detail modal that is open

async function api(path, opt = {}) {
  const t = tok();
  const res = await fetch(BASE + path, { ...opt, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) } });
  let d = {}; try { d = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(d.error || 'Something went wrong (' + res.status + ').');
  return d;
}
async function loadMe() {
  if (ME || !tok()) return ME;
  try { const d = await api('/api/me'); ME = d.user || d; ME.id = String(ME.id || ME._id || ''); } catch (e) {}
  return ME;
}
const myId = () => (ME ? ME.id : '');

/* ---------------- styles ---------------- */
const css = document.createElement('style');
css.textContent = `
.ar-btn{font:600 13px Poppins,system-ui,sans-serif;border:0;border-radius:10px;padding:9px 14px;cursor:pointer;color:#fff;background:#0066ff;transition:.15s}
.ar-btn:hover{filter:brightness(1.15)} .ar-btn:disabled{opacity:.5;cursor:default}
.ar-btn.ghost{background:#14141f;border:1px solid #26263a;color:#cfd6ff} .ar-btn.red{background:#d63a4a} .ar-btn.green{background:#1f9d62}
#arStrip{display:flex;gap:10px;overflow-x:auto;padding:8px 12px;background:#05050b;border-bottom:1px solid #1b1b2b;scrollbar-width:none}
#arStrip:empty{display:none} #arStrip::-webkit-scrollbar{display:none}
.ar-card{flex:0 0 auto;min-width:210px;background:linear-gradient(135deg,#0b0b18,#10122a);border:1px solid #223;border-radius:12px;padding:9px 12px;cursor:pointer;color:#e8ecff;font:500 12px Poppins,system-ui,sans-serif;position:relative;overflow:hidden}
.ar-card.live{border-color:#0066ff;box-shadow:0 0 14px rgba(0,102,255,.35)}
.ar-card.live::after{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 40%,rgba(0,102,255,.18) 50%,transparent 60%);animation:arSweep 2.6s linear infinite}
.ar-vs{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px}.ar-vs i{font-style:normal;color:#5b8cff;font-size:11px}
.ar-meta{margin-top:4px;color:#8f98c9;display:flex;justify-content:space-between;gap:8px}
.ar-chip{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;background:#1a2040;color:#8fb0ff}
.ar-chip.live{background:#0a3a1f;color:#4dff9b}.ar-chip.judging{background:#3a2e08;color:#ffd24d}.ar-chip.completed{background:#2a1046;color:#caa6ff}
@keyframes arSweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
#arBanners{position:fixed;top:10px;left:0;right:0;z-index:99998;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;padding:0 10px}
.ar-banner{pointer-events:auto;width:min(480px,100%);background:linear-gradient(135deg,#060612,#0d1a47);border:1px solid #0066ff;border-radius:16px;padding:14px;color:#fff;font:500 13px Poppins,system-ui,sans-serif;box-shadow:0 0 0 1px #000,0 10px 40px rgba(0,102,255,.45);animation:arIn .6s cubic-bezier(.2,1.3,.4,1) both;position:relative;overflow:hidden}
.ar-banner.out{animation:arOut .4s ease-in both}
.ar-banner::before{content:"";position:absolute;inset:-60%;background:conic-gradient(from 0deg,transparent,rgba(0,102,255,.35),transparent 30%);animation:arSpin 4s linear infinite}
.ar-banner>*{position:relative}
.ar-banner h4{margin:0 0 6px;font-size:11px;letter-spacing:2px;color:#7fa8ff;text-transform:uppercase}
.ar-big{display:flex;align-items:center;justify-content:center;gap:12px;font-size:17px;font-weight:800}
.ar-big b{animation:arPulse 1.2s ease-in-out infinite;color:#4d8dff}
.ar-ava{width:42px;height:42px;border-radius:50%;background:#0b1233;border:2px solid #0066ff;display:inline-flex;align-items:center;justify-content:center;font-size:20px;flex:none}
.ar-row{display:flex;gap:8px;margin-top:10px;justify-content:center;flex-wrap:wrap}
.ar-banner.win{border-color:#ffd24d;box-shadow:0 0 40px rgba(255,210,77,.5)}
@keyframes arIn{from{transform:translateY(-140%) scale(.8);opacity:0}to{transform:none;opacity:1}}
@keyframes arOut{to{transform:translateY(-140%);opacity:0}}
@keyframes arSpin{to{transform:rotate(360deg)}} @keyframes arPulse{50%{transform:scale(1.35)}}
.ar-ov{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center;animation:arFade .2s both}
@media(min-width:700px){.ar-ov{align-items:center}}
.ar-sheet{width:min(560px,100%);max-height:94vh;overflow:auto;background:#07070f;border:1px solid #1d2140;border-radius:18px 18px 0 0;padding:16px;color:#e8ecff;font:500 13px Poppins,system-ui,sans-serif;animation:arUp .3s ease both}
@media(min-width:700px){.ar-sheet{border-radius:18px}}
.ar-sheet h3{margin:0 0 12px;font-size:16px}
.ar-sheet label{display:block;margin:10px 0 4px;color:#8f98c9;font-size:12px}
.ar-sheet input,.ar-sheet select,.ar-sheet textarea{width:100%;box-sizing:border-box;background:#0d0d1a;border:1px solid #26263a;border-radius:10px;padding:10px;color:#fff;font:inherit}
.ar-chips{display:flex;gap:6px;flex-wrap:wrap}.ar-chips button{background:#0d0d1a;border:1px solid #26263a;color:#cfd6ff;border-radius:99px;padding:7px 12px;font:600 12px inherit;cursor:pointer}
.ar-chips button.on{background:#0066ff;border-color:#0066ff;color:#fff}
.ar-sug{background:#0d0d1a;border:1px solid #26263a;border-radius:10px;margin-top:4px;overflow:hidden}
.ar-sug div{padding:9px 10px;cursor:pointer;display:flex;gap:8px;align-items:center}.ar-sug div:hover{background:#15183a}
.ar-clock{text-align:center;font:800 30px Poppins,system-ui,sans-serif;color:#4d8dff;margin:8px 0;letter-spacing:2px}
.ar-proofs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
.ar-proof{background:#0b0b16;border:1px solid #1d2140;border-radius:12px;padding:8px;text-align:center;font-size:12px}
.ar-proof img{width:100%;border-radius:8px;margin-top:6px;cursor:zoom-in;max-height:220px;object-fit:cover}
.ar-wait{padding:34px 4px;color:#6b739f}
.ar-bar{height:10px;border-radius:99px;background:#d63a4a;overflow:hidden;margin:6px 0}.ar-bar i{display:block;height:100%;background:#0066ff;transition:width .5s}
.ar-votes{display:flex;justify-content:space-between;font-weight:700}
.ar-toast{position:fixed;bottom:84px;left:50%;transform:translateX(-50%);background:#10142e;border:1px solid #0066ff;color:#fff;padding:10px 16px;border-radius:12px;z-index:100000;font:600 13px Poppins,system-ui,sans-serif;animation:arUp .3s both;max-width:90vw}
.ar-win{text-align:center;font-size:18px;font-weight:800;color:#ffd24d;padding:12px;background:rgba(255,210,77,.08);border:1px solid rgba(255,210,77,.4);border-radius:12px;margin:10px 0;animation:arPulseS 1.6s ease-in-out infinite}
@keyframes arPulseS{50%{box-shadow:0 0 24px rgba(255,210,77,.45)}}
@keyframes arFade{from{opacity:0}} @keyframes arUp{from{transform:translateY(40px);opacity:0}}
#arRealm{margin:0 0 16px;padding:14px;border-radius:16px;background:linear-gradient(135deg,rgba(0,102,255,.12),rgba(0,0,0,.4));border:1px solid rgba(0,102,255,.4)}
#arRealm .ar-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font:700 15px Poppins,system-ui,sans-serif;color:#fff}
#arRealm .ar-list{display:flex;flex-direction:column;gap:8px}#arRealm .ar-card{min-width:0}
.ar-empty{color:#8f98c9;text-align:center;padding:12px;font-size:12px}
`;
document.head.appendChild(css);

/* ---------------- tiny helpers ---------------- */
function toast(msg) { const t = document.createElement('div'); t.className = 'ar-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }
function fmt(ms) { if (ms < 0) ms = 0; const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; const p = n => String(n).padStart(2, '0'); return (h ? h + ':' : '') + p(m) + ':' + p(x); }
function ava(p) { const a = String(p.avatar || '🎮'); return `<span class="ar-ava">${a.length <= 8 && !/^https?:|^data:/.test(a) ? esc(a) : esc((p.username || '?')[0].toUpperCase())}</span>`; }
function target(c) { return c.status === 'pending' ? new Date(c.createdAt).getTime() + 30 * 60000 : c.status === 'live' ? new Date(c.endsAt).getTime() : c.status === 'judging' ? new Date(c.votingEndsAt).getTime() : 0; }
function cdLabel(c) { return { pending: 'Expires in', live: 'Ends in', judging: 'Voting closes in' }[c.status] || ''; }
function statusText(c) {
  if (c.status === 'completed') return c.draw ? 'Draw' : '🏆 ' + c.winnerName;
  return { pending: 'Waiting', live: 'LIVE', judging: 'Voting', declined: 'Declined', cancelled: 'Cancelled', expired: 'Expired' }[c.status] || c.status;
}
function roomName(id) { const r = (gameRooms().concat([{ id: 'lounge', name: 'Lounge' }])).find(x => x.id === id); return r ? r.name : id; }

setInterval(() => {
  document.querySelectorAll('[data-cd]').forEach(el => { const t = +el.dataset.cd; el.textContent = t ? fmt(t - Date.now()) : ''; });
}, 1000);

/* ---------------- card html ---------------- */
function cardHtml(c) {
  const t = target(c);
  return `<div class="ar-card ${c.status === 'live' ? 'live' : ''}" data-ar-open="${esc(c.id)}">
    <div class="ar-vs">${esc(c.challenger.username)} <i>VS</i> ${esc(c.opponent.username)}</div>
    <div class="ar-meta"><span>${esc(c.gameName)}</span><span class="ar-chip ${esc(c.status)}">${esc(statusText(c))}</span></div>
    ${t ? `<div class="ar-meta"><span>${esc(cdLabel(c))}</span><b data-cd="${t}">${fmt(t - Date.now())}</b></div>` : ''}
  </div>`;
}
document.addEventListener('click', e => { const el = e.target.closest('[data-ar-open]'); if (el) openDetail(el.dataset.arOpen); });

/* ---------------- banner ---------------- */
function banner(c, event) {
  let host = $('#arBanners'); if (!host) { host = document.createElement('div'); host.id = 'arBanners'; document.body.appendChild(host); }
  const mineTarget = c.opponent.userId === myId();
  let title = '⚔ New challenge', extra = '', cls = '';
  if (event === 'created') title = '⚔ Challenge issued';
  if (event === 'accepted') title = '🔥 Match is LIVE';
  if (event === 'judging') title = '⏱ Time! Upload proof';
  if (event === 'completed') { title = c.draw ? '🤝 Draw' : '🏆 Winner'; cls = c.draw ? '' : 'win'; }
  if (event === 'declined') title = '🚫 Declined';
  const t = target(c);
  const mid = event === 'completed' && !c.draw
    ? `<div class="ar-big">🏆 ${esc(c.winnerName)}</div><div style="text-align:center;color:#b9c4ff;margin-top:4px">wins ${esc(c.gameName)}</div>`
    : `<div class="ar-big">${ava(c.challenger)}<span>${esc(c.challenger.username)}</span><b>VS</b><span>${esc(c.opponent.username)}</span>${ava(c.opponent)}</div>
       <div style="text-align:center;color:#b9c4ff;margin-top:6px">${esc(c.gameName)} · ${c.minutes} min${t && event !== 'completed' ? ` · <b data-cd="${t}">${fmt(t - Date.now())}</b>` : ''}</div>`;
  if (event === 'created' && mineTarget) extra = `<button class="ar-btn green" data-act="accept">Accept</button><button class="ar-btn red" data-act="decline">Decline</button>`;
  const el = document.createElement('div');
  el.className = 'ar-banner ' + cls;
  el.innerHTML = `<h4>${title}</h4>${mid}<div class="ar-row">${extra}<button class="ar-btn ghost" data-act="watch">${event === 'judging' || event === 'completed' ? 'View' : 'Watch'}</button></div>`;
  el.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'watch') { openDetail(c.id); close(); }
    else try { await api(`/api/arena/${c.id}/${a}`, { method: 'POST', body: '{}' }); close(); toast(a === 'accept' ? '🔥 Game on! Timer started.' : 'Declined.'); } catch (er) { toast(er.message); }
  });
  host.appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 400); };
  setTimeout(close, event === 'created' && mineTarget ? 25000 : 9000);
}

/* ---------------- room strip (Chat) ---------------- */
let stripRoom = '';
async function refreshStrip() {
  if (!IN_CHAT) return;
  const room = curRoom();
  let strip = $('#arStrip');
  if (!strip) { strip = document.createElement('div'); strip.id = 'arStrip'; $('#messages').before(strip); }
  if (!room || room === 'nexus-ai') { strip.innerHTML = ''; return; }
  stripRoom = room;
  try {
    const d = await api('/api/arena?view=active&room=' + encodeURIComponent(room));
    if (room !== stripRoom) return;
    d.challenges.forEach(c => store.set(c.id, c));
    strip.innerHTML = d.challenges.map(cardHtml).join('');
  } catch (e) { /* silent */ }
}

/* ---------------- live updates ---------------- */
function onUpdate({ room, event, challenge }) {
  if (!challenge) return;
  const prev = store.get(challenge.id);
  if (prev && prev.updatedAt === challenge.updatedAt) return;
  store.set(challenge.id, challenge);
  const involved = challenge.challenger.userId === myId() || challenge.opponent.userId === myId();
  const inRoom = !IN_CHAT || curRoom() === challenge.room;
  if (['created', 'accepted', 'judging', 'completed', 'declined'].includes(event) && (inRoom || involved)) banner(challenge, event);
  if (IN_CHAT && (challenge.room === curRoom())) refreshStrip();
  if (IN_REALM) renderRealm();
  if (open && open.id === challenge.id) renderDetail();
}
function hookSocket() {
  const s = chatSocket(); if (!s || s.__arena) return; s.__arena = true;
  s.on('arena:update', onUpdate);
}

/* ---------------- create modal ---------------- */
function overlay(html) {
  const ov = document.createElement('div'); ov.className = 'ar-ov';
  ov.innerHTML = `<div class="ar-sheet">${html}</div>`;
  ov.addEventListener('mousedown', e => { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov); return ov;
}
async function openCreate(presetOpponent) {
  await loadMe();
  if (!tok()) { toast('Log in to challenge someone.'); return; }
  const rooms = gameRooms(); if (!rooms.length) { toast('Game list not loaded.'); return; }
  const cur = curRoom(); const def = rooms.some(r => r.id === cur) ? cur : rooms[0].id;
  const ov = overlay(`<h3>⚔ Challenge a player</h3>
    <label>Opponent</label><input id="arOpp" placeholder="Type a username…" autocomplete="off" value="${esc(presetOpponent || '')}"><div id="arSug"></div>
    <label>Game</label><select id="arGame">${rooms.map(r => `<option value="${esc(r.id)}" ${r.id === def ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    <label>Time limit</label><div class="ar-chips" id="arMin">${[15, 30, 60, 120].map(m => `<button type="button" data-m="${m}" class="${m === 30 ? 'on' : ''}">${m < 60 ? m + ' min' : m / 60 + ' hr'}</button>`).join('')}<button type="button" data-m="0">Custom</button></div>
    <input id="arCustom" type="number" min="5" max="720" placeholder="Minutes (5–720)" style="display:none;margin-top:8px">
    <label>What are you competing in? (optional)</label><input id="arNote" maxlength="200" placeholder="e.g. most kills in 30 minutes">
    <div class="ar-row" style="margin-top:16px"><button class="ar-btn ghost" id="arCancel">Cancel</button><button class="ar-btn" id="arGo">Send challenge</button></div>`);
  let mins = 30, timer;
  const opp = $('#arOpp', ov), sug = $('#arSug', ov);
  opp.addEventListener('input', () => {
    clearTimeout(timer); const q = opp.value.trim(); if (q.length < 2) { sug.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try { const d = await api('/api/arena/users?q=' + encodeURIComponent(q));
        sug.innerHTML = d.users.length ? `<div class="ar-sug">${d.users.map(u => `<div data-u="${esc(u.username)}">${ava(u)} ${esc(u.username)}</div>`).join('')}</div>` : ''; } catch (e) {}
    }, 250);
  });
  sug.addEventListener('click', e => { const d = e.target.closest('[data-u]'); if (d) { opp.value = d.dataset.u; sug.innerHTML = ''; } });
  $('#arMin', ov).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    ov.querySelectorAll('#arMin button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    mins = +b.dataset.m; $('#arCustom', ov).style.display = mins ? 'none' : 'block';
  });
  $('#arCancel', ov).onclick = () => ov.remove();
  $('#arGo', ov).onclick = async () => {
    const btn = $('#arGo', ov); const m = mins || parseInt($('#arCustom', ov).value, 10);
    const sel = $('#arGame', ov); const r = rooms.find(x => x.id === sel.value);
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api('/api/arena', { method: 'POST', body: JSON.stringify({ opponent: opp.value.trim(), room: r.id, gameName: r.name.replace(/^[^\w]+/u, '').trim() || r.name, minutes: m, note: $('#arNote', ov).value, tzOffset: new Date().getTimezoneOffset() }) });
      ov.remove(); toast('⚔ Challenge sent to the room!');
    } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Send challenge'; }
  };
}

/* ---------------- detail modal ---------------- */
let detailOv = null, detailData = null, detailPoll = null;
async function openDetail(id) {
  await loadMe();
  open = { id };
  if (detailOv) detailOv.remove();
  detailOv = overlay('<div class="ar-empty">Loading…</div>');
  const obs = new MutationObserver(() => { if (!document.body.contains(detailOv)) { open = null; clearInterval(detailPoll); obs.disconnect(); } });
  obs.observe(document.body, { childList: true });
  await fetchDetail();
  clearInterval(detailPoll); detailPoll = setInterval(fetchDetail, 12000);
}
async function fetchDetail() {
  if (!open) return;
  try { const d = await api('/api/arena/' + open.id); detailData = d.challenge; CAN_DECIDE = !!d.canDecide; store.set(detailData.id, detailData); renderDetail(); }
  catch (e) { if (detailOv) detailOv.querySelector('.ar-sheet').innerHTML = `<div class="ar-empty">${esc(e.message)}</div>`; }
}
function compress(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => reject(new Error('Could not read that image.')); img.src = url;
  });
}
function renderDetail() {
  if (!detailOv || !detailData || !open || open.id !== detailData.id) return;
  const c = detailData, me = myId();
  const isPlayer = c.challenger.userId === me || c.opponent.userId === me;
  const t = target(c);
  const n = c.votes, a = c.challenger, b = c.opponent;
  const total = (n[a.userId] || 0) + (n[b.userId] || 0);
  const pct = total ? Math.round((n[a.userId] || 0) / total * 100) : 50;
  const proofOf = u => (c.proofs || []).find(p => p.userId === u.userId);
  const proofBox = u => { const p = proofOf(u); return `<div class="ar-proof"><b>${esc(u.username)}</b>${p ? `<img src="${p.image}" alt="Proof by ${esc(u.username)}" data-zoom>${p.note ? `<div style="margin-top:4px;color:#aab3e0">${esc(p.note)}</div>` : ''}` : `<div class="ar-wait">${c.status === 'live' || c.status === 'pending' ? '⏳ Not yet' : '📭 No proof'}</div>`}</div>`; };
  let actions = '';
  if (c.status === 'pending' && c.opponent.userId === me) actions = `<button class="ar-btn green" data-d="accept">Accept</button><button class="ar-btn red" data-d="decline">Decline</button>`;
  else if (c.status === 'pending' && c.challenger.userId === me) actions = `<button class="ar-btn red" data-d="decline">Cancel challenge</button>`;
  if (c.status === 'judging' && isPlayer) actions = `<button class="ar-btn" data-d="proof">📸 ${proofOf(c.challenger.userId === me ? a : b) ? 'Replace my proof' : 'Upload my proof'}</button><input type="file" accept="image/*" id="arFile" hidden>`;
  const voteBtns = c.status === 'judging' && !isPlayer && me
    ? `<div class="ar-row"><button class="ar-btn ${c.myVote === a.userId ? '' : 'ghost'}" data-v="${esc(a.userId)}">${c.myVote === a.userId ? '✓ ' : ''}Vote ${esc(a.username)}</button><button class="ar-btn ${c.myVote === b.userId ? '' : 'ghost'}" data-v="${esc(b.userId)}">${c.myVote === b.userId ? '✓ ' : ''}Vote ${esc(b.username)}</button></div>` : '';
  const admin = CAN_DECIDE && (c.status === 'judging' || c.status === 'live')
    ? `<div class="ar-row"><span style="color:#8f98c9;width:100%;text-align:center">Admin decision</span><button class="ar-btn ghost" data-w="${esc(a.userId)}">${esc(a.username)} wins</button><button class="ar-btn ghost" data-w="${esc(b.userId)}">${esc(b.username)} wins</button><button class="ar-btn ghost" data-w="">Draw</button></div>` : '';
  detailOv.querySelector('.ar-sheet').innerHTML = `
    <div class="ar-row" style="justify-content:space-between;margin:0 0 8px"><span class="ar-chip ${esc(c.status)}">${esc(statusText(c))}</span><button class="ar-btn ghost" data-d="close">✕</button></div>
    <div class="ar-big">${ava(a)}<span>${esc(a.username)}</span><b>VS</b><span>${esc(b.username)}</span>${ava(b)}</div>
    <div style="text-align:center;color:#b9c4ff;margin-top:6px">${esc(c.gameName)} · ${c.minutes} min${c.note ? '<br>“' + esc(c.note) + '”' : ''}</div>
    ${t ? `<div style="text-align:center;color:#8f98c9;margin-top:10px">${esc(cdLabel(c))}</div><div class="ar-clock" data-cd="${t}">${fmt(t - Date.now())}</div>` : ''}
    ${c.status === 'completed' ? `<div class="ar-win">${c.draw ? '🤝 It\'s a draw' : '🏆 ' + esc(c.winnerName) + ' wins!'}<div style="font-size:11px;color:#b9c4ff;font-weight:500">${c.resolvedBy === 'votes' ? 'Decided by spectator votes' : c.resolvedBy === 'forfeit' ? 'Other player sent no proof' : c.resolvedBy === 'admin' ? 'Decided by an admin' : ''}</div></div>` : ''}
    ${c.status === 'live' ? `<div class="ar-empty">👀 Players are competing. Proof opens when the timer hits zero — then everyone votes.</div>` : ''}
    ${['judging', 'completed'].includes(c.status) ? `<div class="ar-proofs">${proofBox(a)}${proofBox(b)}</div>
      <div class="ar-votes"><span>${esc(a.username)} · ${n[a.userId] || 0}</span><span>${n[b.userId] || 0} · ${esc(b.username)}</span></div>
      <div class="ar-bar"><i style="width:${pct}%"></i></div>` : ''}
    ${voteBtns}
    ${c.status === 'judging' && !isPlayer && !me ? '<div class="ar-empty">Log in to vote.</div>' : ''}
    ${c.status === 'judging' && isPlayer ? '<div class="ar-empty">Players can’t vote. Upload a screenshot that shows your result.</div>' : ''}
    <div class="ar-row">${actions}</div>${admin}`;
}
document.addEventListener('click', async e => {
  if (!detailOv || !detailOv.contains(e.target)) return;
  const img = e.target.closest('[data-zoom]');
  if (img) { const z = overlay(`<img src="${img.src}" style="width:100%;border-radius:10px">`); return; }
  const d = e.target.closest('[data-d]'), v = e.target.closest('[data-v]'), w = e.target.closest('[data-w]');
  const id = open && open.id;
  try {
    if (d) {
      const a = d.dataset.d;
      if (a === 'close') { detailOv.remove(); return; }
      if (a === 'proof') { $('#arFile', detailOv).click(); return; }
      await api(`/api/arena/${id}/${a}`, { method: 'POST', body: '{}' }); await fetchDetail();
    } else if (v) { await api(`/api/arena/${id}/vote`, { method: 'POST', body: JSON.stringify({ forUserId: v.dataset.v }) }); toast('🗳 Vote saved'); await fetchDetail(); }
    else if (w) { await api(`/api/arena/${id}/decide`, { method: 'POST', body: JSON.stringify({ winnerId: w.dataset.w }) }); await fetchDetail(); }
  } catch (er) { toast(er.message); }
});
document.addEventListener('change', async e => {
  if (!e.target || e.target.id !== 'arFile' || !e.target.files[0]) return;
  try { toast('Uploading proof…'); const image = await compress(e.target.files[0]);
    await api(`/api/arena/${open.id}/proof`, { method: 'POST', body: JSON.stringify({ image }) }); toast('📸 Proof uploaded'); await fetchDetail();
  } catch (er) { toast(er.message); }
});

/* ---------------- Chat page: header button ---------------- */
function mountChat() {
  const hdr = $('#roomCallButtons'); if (!hdr || $('#arOpenBtn')) return;
  const b = document.createElement('button'); b.type = 'button'; b.id = 'arOpenBtn'; b.className = 'call-btn'; b.title = 'Challenge a player'; b.textContent = '⚔';
  b.addEventListener('click', () => openCreate()); hdr.appendChild(b);
  const nm = $('#activeRoomName');
  new MutationObserver(() => { refreshStrip(); const ai = curRoom() === 'nexus-ai'; b.style.display = ai ? 'none' : ''; }).observe(nm, { childList: true, characterData: true, subtree: true });
  refreshStrip(); setInterval(refreshStrip, 60000);
  const tryHook = () => { hookSocket(); if (!(chatSocket() || {}).__arena) setTimeout(tryHook, 800); }; tryHook();
}

/* ---------------- Realm page: live arena panel ---------------- */
let realmList = [];
function renderRealm() {
  const box = $('#arRealm .ar-list'); if (!box) return;
  realmList = Array.from(store.values()).filter(c => ['pending', 'live', 'judging', 'completed'].includes(c.status)).sort((x, y) => new Date(y.updatedAt) - new Date(x.updatedAt)).slice(0, 12);
  box.innerHTML = realmList.length ? realmList.map(cardHtml).join('') : '<div class="ar-empty">No arena challenges yet. Be the first!</div>';
}
async function loadRealm() {
  try { const d = await api('/api/arena?view=all&limit=20'); d.challenges.forEach(c => store.set(c.id, c)); renderRealm(); } catch (e) {}
}
function mountRealm() {
  const panel = $('#panel-challenges'); if (!panel || $('#arRealm')) return;
  const box = document.createElement('div'); box.id = 'arRealm';
  box.innerHTML = `<div class="ar-head"><span>🏟 Live Arena</span><button class="ar-btn" id="arRealmNew">⚔ New duel</button></div><div class="ar-list"><div class="ar-empty">Loading…</div></div>`;
  panel.prepend(box);
  $('#arRealmNew').onclick = () => openCreate();
  loadRealm(); setInterval(loadRealm, 15000);
}

/* ---------------- boot ---------------- */
window.NexusArena = { openCreate, openDetail };
(async function boot() {
  await loadMe();
  if (IN_CHAT) mountChat();
  if (IN_REALM) mountRealm();
  const id = new URLSearchParams(location.search).get('arena'); if (id) openDetail(id);
})();
})();
