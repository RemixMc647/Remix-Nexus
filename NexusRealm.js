/* =====================================================================
   NEXUS REALM — page script
   - talks to the BACKEND (BACKEND_URL from config.js), not the static site
   - uses the same AUTH helper as the rest of Remix Nexus
   - gifts can only be SENT by the owner (the server enforces it too)
   ===================================================================== */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const API = String((typeof BACKEND_URL !== 'undefined' && BACKEND_URL) || 'https://remix-nexus-bgz9.onrender.com').replace(/\/+$/, '');
const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

const GIFTS = {
  trophy:  { emoji: '🏆', name: 'Champion Trophy' },
  crystal: { emoji: '💎', name: 'Nexus Crystal' },
  gg:      { emoji: '🎮', name: 'GG Token' },
  heart:   { emoji: '💜', name: 'Respect' },
  star:    { emoji: '⭐', name: 'Star Player' }
};

let me = null;                 // the signed-in user (from /api/me), or null
let tab = 'challenges';
let matchFilter = 'all';
let canSendGifts = false;
const cache = { matches: [], worlds: [], squads: [], gifts: [] };
const loaded = { matches: false, worlds: false, squads: false, gifts: false };
let pendingFocus = null;       // { type, id } from a shared link

/* ------------------------------------------------------------ helpers */
function esc(v = '') {
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initial(name) { return esc((String(name || '?').trim()[0] || '?').toUpperCase()); }
function niceDate(v) { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function when(v) {
  const t = new Date(v).getTime(); if (!t) return '';
  const diff = t - Date.now(), abs = Math.abs(diff);
  let s;
  if (abs < 6e4) s = 'moments';
  else if (abs < 36e5) s = Math.round(abs / 6e4) + ' min';
  else if (abs < 864e5) s = Math.round(abs / 36e5) + ' hr';
  else { const d = Math.round(abs / 864e5); s = d + ' day' + (d === 1 ? '' : 's'); }
  return diff > 0 ? 'in ' + s : s + ' ago';
}
function myId() { return me ? String(me.id || me._id || '') : ''; }
function myName() { return me ? String(me.username || '').toLowerCase() : ''; }
function isOwner() { return !!(me && me.isOwner) || canSendGifts; }
function avatarHtml(name, avatar) {
  const a = String(avatar || '');
  if (a && a.length <= 8 && !/^https?:/i.test(a)) return `<span class="av">${esc(a)}</span>`;
  return `<span class="av">${initial(name)}</span>`;
}

function token() {
  try { if (window.AUTH && typeof AUTH.getToken === 'function') { const t = AUTH.getToken(); if (t) return t; } } catch (e) {}
  for (const k of ['token', 'authToken', 'jwt', 'accessToken', 'remixToken', 'remix_nexus_token']) {
    try { const v = localStorage.getItem(k); if (v && v !== 'undefined' && v !== 'null') return v; } catch (e) {}
  }
  return null;
}

let lastWakeToast = 0;
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const t = token();
  if (t) headers.Authorization = 'Bearer ' + t;
  // The free Render server sleeps — tell people why the first load is slow.
  const wake = setTimeout(() => {
    if (Date.now() - lastWakeToast > 20000) { lastWakeToast = Date.now(); toast('Waking up the server — this can take up to a minute…'); }
  }, 6000);
  try {
    let r;
    try { r = await fetch(API + path, { ...opts, headers }); }
    catch (e) { throw new Error('Could not reach the server. Check your connection and try again.'); }
    let data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) {
      if (r.status === 401 && t) { me = null; renderIdentity(); }
      const err = new Error(data.error || data.message || `Request failed (${r.status})`);
      err.status = r.status;
      throw err;
    }
    return data;
  } finally { clearTimeout(wake); }
}

/* ------------------------------------------------------------ toast + modal + confetti */
function toast(msg, type) {
  const box = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 5400 : 3600);
}

function modal({ title, text, type, placeholder, options, okText = 'OK' }) {
  return new Promise(resolve => {
    const back = $('#modal'), body = $('#modal-body'), ok = $('#modal-ok'), cancel = $('#modal-cancel');
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text || '';
    body.innerHTML = '';
    ok.textContent = okText;
    let input = null, chosen = null;
    if (type) {
      input = document.createElement('input');
      input.type = type; input.placeholder = placeholder || ''; input.maxLength = 500;
      body.appendChild(input);
    }
    if (options) {
      const wrap = document.createElement('div'); wrap.className = 'pick';
      options.forEach(o => {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = o;
        b.onclick = () => { chosen = o; $$('button', wrap).forEach(x => x.classList.toggle('on', x === b)); };
        wrap.appendChild(b);
      });
      body.appendChild(wrap);
    }
    const onKey = e => { if (e.key === 'Escape') done(null); else if (e.key === 'Enter' && input) submit(); };
    function done(val) {
      back.classList.remove('open'); back.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', onKey);
      ok.onclick = cancel.onclick = back.onclick = null;
      resolve(val);
    }
    function submit() {
      if (input) { const v = input.value.trim(); if (!v) { input.focus(); return; } done(v); }
      else if (options) { if (!chosen) { toast('Pick one first.', 'err'); return; } done(chosen); }
      else done(true);
    }
    ok.onclick = submit;
    cancel.onclick = () => done(null);
    back.onclick = e => { if (e.target === back) done(null); };
    document.addEventListener('keydown', onKey);
    back.classList.add('open'); back.setAttribute('aria-hidden', 'false');
    setTimeout(() => input && input.focus(), 60);
  });
}

const fx = $('#fx'), fctx = fx.getContext('2d');
let parts = [], raf = 0;
function sizeFx() { fx.width = innerWidth; fx.height = innerHeight; }
function confetti(x = innerWidth / 2, y = innerHeight / 3, n = 90) {
  if (REDUCED) return;
  const colors = ['#63e6f4', '#a78bfa', '#ff70c5', '#ffd166', '#57f5a5', '#ffffff'];
  for (let i = 0; i < n; i++) parts.push({
    x, y, vx: (Math.random() - .5) * 11, vy: Math.random() * -11 - 3, g: .3,
    r: Math.random() * 7 + 4, c: colors[(Math.random() * colors.length) | 0],
    rot: Math.random() * 6, vr: (Math.random() - .5) * .45, life: 0, max: 100 + Math.random() * 60
  });
  if (!raf) raf = requestAnimationFrame(tickFx);
}
function tickFx() {
  fctx.clearRect(0, 0, fx.width, fx.height);
  parts = parts.filter(p => p.life < p.max);
  for (const p of parts) {
    p.life++; p.vy += p.g; p.vx *= .992; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot);
    fctx.globalAlpha = Math.max(0, 1 - p.life / p.max); fctx.fillStyle = p.c;
    fctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r * .6); fctx.restore();
  }
  if (parts.length) raf = requestAnimationFrame(tickFx); else { raf = 0; fctx.clearRect(0, 0, fx.width, fx.height); }
}
function confettiAt(el) { const r = el.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2); }

function countTo(el, n) {
  if (!el) return;
  if (REDUCED || n < 2) { el.textContent = n; return; }
  const start = performance.now(), dur = 700;
  (function step(t) {
    const k = Math.min(1, (t - start) / dur);
    el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  })(start);
}
function setStat(name, n) { countTo($(`[data-stat="${name}"]`), n); }

function copyText(text, okMsg) {
  const done = () => toast(okMsg);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => toast(text));
  else toast(text);
}
const skeleton = n => Array.from({ length: n }, () => '<div class="skel"></div>').join('');
const emptyHtml = (icon, html) => `<div class="empty"><span class="big">${icon}</span>${html}</div>`;

/* ------------------------------------------------------------ identity */
function renderIdentity() {
  const chip = $('#user-chip');
  $('#auth-banner').hidden = !!me;
  chip.hidden = false;
  chip.className = 'user-chip' + (me ? ' me' : '');
  if (me) {
    chip.href = './Profile.html';
    chip.innerHTML = `${avatarHtml(me.username, me.avatar)}<span class="nm">${esc(me.username)}</span>${me.isOwner ? '<span class="crown" title="Owner">👑</span>' : ''}`;
  } else {
    chip.href = './Login.html';
    chip.innerHTML = '<span class="nm">Log in</span> →';
  }
  const showForm = isOwner();
  $('#gift-form').hidden = !showForm;
  $('#gift-locked').hidden = showForm;
  $('#gift-sent-wrap').hidden = !(showForm && sentGifts().length);
  if (showForm) updatePreview();
}

async function loadMe() {
  if (!token()) { me = null; return; }
  try { const d = await api('/api/me'); me = d.user || null; } catch (e) { me = null; }
}
function needLogin() {
  if (me) return true;
  if (!token()) {
    toast('Please log in to do that.', 'err');
    const b = $('#auth-banner'); b.hidden = false; b.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  toast('Your session expired — please log in again.', 'err');
  return false;
}
async function guarded(btn, fn) {
  if (btn) { btn.classList.add('busy'); btn.disabled = true; }
  try { await fn(); } catch (e) { toast(e.message, 'err'); }
  finally { if (btn) { btn.classList.remove('busy'); btn.disabled = false; } }
}

/* ------------------------------------------------------------ tabs */
const TABS = ['challenges', 'worlds', 'squads', 'gifts'];
function moveGlider() {
  const a = $('.tab.active'), g = $('#glider'), bar = $('#tabs');
  if (!a) return;
  g.style.width = a.offsetWidth + 'px';
  g.style.transform = `translateX(${a.offsetLeft}px)`;
  bar.scrollTo({ left: a.offsetLeft - (bar.clientWidth - a.offsetWidth) / 2, behavior: REDUCED ? 'auto' : 'smooth' });
}
function switchTab(next, { scroll = false, refresh = true } = {}) {
  if (!TABS.includes(next)) next = 'challenges';
  tab = next;
  $$('.tab').forEach(b => { b.classList.toggle('active', b.dataset.tab === next); b.setAttribute('aria-selected', b.dataset.tab === next); });
  $$('.realm-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + next));
  moveGlider();
  try { history.replaceState(null, '', location.pathname + location.search + '#' + next); } catch (e) {}
  if (refresh) {
    ({ challenges: [renderMatches, loadMatches], worlds: [renderWorlds, loadWorlds], squads: [renderSquads, loadSquads], gifts: [renderGifts, loadGifts] })[next]
      .forEach((fn, i) => i === 0 ? fn() : fn(true));
  }
  if (scroll) window.scrollTo({ top: $('#tabs').getBoundingClientRect().top + scrollY - 76, behavior: REDUCED ? 'auto' : 'smooth' });
}
$$('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$$('[data-go]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.go, { scroll: true })));
window.addEventListener('resize', () => { moveGlider(); sizeFx(); });

/* soft spotlight that follows the pointer over cards */
document.addEventListener('pointermove', e => {
  const c = e.target.closest && e.target.closest('.item-card');
  if (!c) return;
  const r = c.getBoundingClientRect();
  c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
  c.style.setProperty('--my', (e.clientY - r.top) + 'px');
}, { passive: true });

function applyFocus(type, listSel) {
  if (!pendingFocus || pendingFocus.type !== type) return;
  const card = $(`${listSel} [data-id="${CSS.escape(pendingFocus.id)}"]`);
  if (!card) return;
  pendingFocus = null;
  card.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
  card.classList.add('flash');
}

/* ------------------------------------------------------------ MATCHES */
const STATUS = { open: 'OPEN', accepted: 'LIVE', completed: 'COMPLETED', disputed: 'DISPUTED' };

function matchCard(m, i) {
  const st = m.status || 'open';
  const mine = m.mine || {};
  const isPlayer = !!(mine.challenger || mine.opponent);
  const oppName = m.opponentName || m.opponentUsername || '';
  const win = String(m.winnerUsername || '').toLowerCase();
  const canAccept = !!me && st === 'open' && !mine.challenger && (!m.opponentUsername || m.opponentUsername.toLowerCase() === myName());
  const player = (name, role, open) => {
    const isWin = win && String(name).toLowerCase() === win;
    return `<div class="player${isWin ? ' winner' : ''}${open ? ' open' : ''}"><span class="av">${open ? '?' : initial(name)}</span><b>${esc(open ? 'Open slot' : name)}</b><small>${role}${isWin ? ' · 🏆' : ''}</small></div>`;
  };
  const props = (m.resultProposals || []).map(p => `${esc(p.username)} says ${esc(p.winnerUsername)} won`).join(' · ');
  let actions = '';
  if (canAccept) actions += `<button class="btn btn-primary" data-act="accept" data-id="${esc(m._id)}">⚔ Accept match</button>`;
  if (!me && st === 'open') actions += `<a class="btn btn-primary" href="./Login.html">Log in to accept</a>`;
  if (isPlayer && st !== 'cancelled') actions += `<button class="btn btn-ghost" data-act="evidence" data-id="${esc(m._id)}">📎 Evidence</button>`;
  if (isPlayer && (st === 'accepted' || st === 'disputed')) actions += `<button class="btn btn-ghost" data-act="winner" data-id="${esc(m._id)}">🏆 Propose winner</button>`;
  if (mine.challenger && (st === 'open' || st === 'accepted')) actions += `<button class="btn btn-danger" data-act="cancel" data-id="${esc(m._id)}">Cancel</button>`;
  actions += `<button class="btn btn-ghost" data-act="copy" data-id="${esc(m._id)}">🔗 Share</button>`;
  return `<article class="item-card" data-id="${esc(m._id)}" style="--i:${Math.min(i, 8)}">
    <div class="item-top"><span class="game-chip">🎮 ${esc(m.game)} · ${esc(m.matchType || 'Challenge')}</span><span class="tag s-${esc(st)}">${esc(STATUS[st] || st.toUpperCase())}</span></div>
    <div class="vs-row">${player(m.challengerName || 'Player', 'Challenger')}<span class="vs">VS</span>${player(oppName, m.opponentName ? 'Opponent' : 'Invited', !oppName)}</div>
    ${st === 'completed' && m.winnerUsername ? `<div class="banner win">🏆 ${esc(m.winnerUsername)} won this match</div>` : ''}
    ${st === 'disputed' ? `<div class="banner dispute">⚠ The players picked different winners. Add evidence so it can be reviewed.</div>` : ''}
    <p><b style="color:#d8dcf5">Rules:</b> ${esc(m.rules)}</p>
    <div class="meta-row"><span>📍 ${esc(m.location || 'Any map')}</span><span>⏱ ${esc(m.durationMinutes)} min</span><span>⏳ ${m.deadline ? esc(niceDate(m.deadline)) + ' (' + esc(when(m.deadline)) + ')' : 'No deadline'}</span></div>
    ${m.evidence ? `<p>📎 Evidence: <a class="link" target="_blank" rel="noopener noreferrer" href="${esc(m.evidence)}">Open submission ↗</a></p>` : ''}
    ${props ? `<div class="proposals">${props}</div>` : ''}
    <div class="item-actions">${actions}</div>
  </article>`;
}

function renderMatches() {
  const box = $('#match-list');
  if (!loaded.matches) { box.innerHTML = skeleton(3); return; }
  const f = matchFilter;
  const items = cache.matches.filter(m => f === 'all' || (f === 'open' && m.status === 'open') || (f === 'accepted' && (m.status === 'accepted' || m.status === 'disputed')) || (f === 'completed' && m.status === 'completed'));
  box.innerHTML = items.length ? items.map(matchCard).join('')
    : emptyHtml('⚔', cache.matches.length ? 'No matches in this filter.' : 'No public matches yet.<br>Create the first challenge!');
  applyFocus('match', '#match-list');
}
async function loadMatches(silent) {
  try {
    const d = await api('/api/realm/matches');
    cache.matches = d.matches || []; loaded.matches = true;
    setStat('matches', cache.matches.length);
    renderMatches();
  } catch (e) {
    if (!silent || !loaded.matches) $('#match-list').innerHTML = emptyHtml('📡', esc(e.message) + '<br>Tap ↻ to try again.');
  }
}

$('#match-list').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.dataset.id, m = cache.matches.find(x => String(x._id) === id);
  const act = b.dataset.act;
  if (act === 'copy') return copyText(`${location.origin}${location.pathname}?match=${id}#challenges`, 'Match link copied.');
  if (!needLogin()) return;
  if (act === 'accept') guarded(b, async () => {
    await api(`/api/realm/matches/${encodeURIComponent(id)}/accept`, { method: 'POST', body: '{}' });
    toast('⚔ Match accepted — good luck!'); confettiAt(b); await loadMatches(true);
  });
  if (act === 'evidence') modal({ title: 'Submit evidence', text: 'Paste a public screenshot or video link (HTTPS). Never share passwords or private info.', type: 'url', placeholder: 'https://…', okText: 'Submit' }).then(url => {
    if (!url) return;
    if (!/^https:\/\//i.test(url)) return toast('The link must start with https://', 'err');
    guarded(null, async () => { await api(`/api/realm/matches/${encodeURIComponent(id)}/evidence`, { method: 'POST', body: JSON.stringify({ url }) }); toast('📎 Evidence submitted.'); await loadMatches(true); });
  });
  if (act === 'winner' && m) modal({ title: 'Who won?', text: 'This is a proposal — the other player has to agree for it to count.', options: [m.challengerName, m.opponentName].filter(Boolean), okText: 'Propose winner' }).then(name => {
    if (!name) return;
    guarded(null, async () => { const d = await api(`/api/realm/matches/${encodeURIComponent(id)}/result`, { method: 'POST', body: JSON.stringify({ winnerUsername: name }) }); toast(d.message || 'Result recorded.'); if (d.match && d.match.status === 'completed') confetti(); await loadMatches(true); });
  });
  if (act === 'cancel') modal({ title: 'Cancel this match?', text: 'It will disappear from the public board.', okText: 'Yes, cancel it' }).then(ok => {
    if (!ok) return;
    guarded(null, async () => { await api(`/api/realm/matches/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }); toast('Match cancelled.'); await loadMatches(true); });
  });
});
$('#match-filters').addEventListener('click', e => {
  const c = e.target.closest('[data-filter]');
  if (!c) return;
  matchFilter = c.dataset.filter;
  $$('#match-filters .chip').forEach(x => x.classList.toggle('active', x === c));
  renderMatches();
});
$('#refresh-matches').addEventListener('click', () => { const b = $('#refresh-matches'); b.style.transition = 'transform .6s'; b.style.transform = 'rotate(360deg)'; setTimeout(() => { b.style.transform = ''; }, 650); loadMatches(); });

$('#challenge-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!needLogin()) return;
  const form = e.currentTarget, btn = $('[type=submit]', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.durationMinutes = Number(payload.duration); delete payload.duration;
  payload.deadline = payload.deadline ? new Date(payload.deadline).toISOString() : null;
  guarded(btn, async () => {
    await api('/api/realm/matches', { method: 'POST', body: JSON.stringify(payload) });
    form.reset(); toast('⚔ Challenge created! Share the match link with your rival.'); confettiAt(btn); await loadMatches(true);
  });
});

/* ------------------------------------------------------------ WORLDS */
function renderWorlds() {
  const box = $('#world-list');
  if (!loaded.worlds) { box.innerHTML = skeleton(2); return; }
  const a = cache.worlds;
  box.innerHTML = a.length ? a.map((w, i) => {
    const canRemove = !!me && (String(w.creatorId) === myId() || me.isOwner);
    return `<article class="item-card" data-id="${esc(w._id)}" style="--i:${Math.min(i, 8)}">
      ${w.imageUrl ? `<div class="cover-wrap"><img class="world-cover" loading="lazy" src="${esc(w.imageUrl)}" alt=""></div>` : ''}
      <span class="tag">${esc(w.game)} · ${esc(w.category)}</span>
      <h4 style="margin-top:10px">${esc(w.title)}</h4>
      <p>${esc(w.description || 'No description provided.')}</p>
      <p>Shared by <b style="color:#d8dcf5">${esc(w.creatorName || 'Nexus player')}</b> · ${esc(when(w.createdAt))}</p>
      <div class="item-actions">
        ${w.link ? `<a class="btn btn-primary" target="_blank" rel="noopener noreferrer" href="${esc(w.link)}">Explore ↗</a>` : ''}
        <button class="btn btn-ghost" data-act="share" data-id="${esc(w._id)}">🔗 Share</button>
        ${canRemove ? `<button class="btn btn-danger" data-act="remove" data-id="${esc(w._id)}">Remove</button>` : ''}
      </div>
    </article>`;
  }).join('') : `<div style="grid-column:1/-1">${emptyHtml('🌌', 'No worlds shared yet.<br>Publish the first discovery!')}</div>`;
  $$('img.world-cover', box).forEach(img => img.addEventListener('error', () => { const w = img.closest('.cover-wrap'); if (w) w.remove(); }));
  applyFocus('world', '#world-list');
}
async function loadWorlds(silent) {
  try { const d = await api('/api/realm/worlds'); cache.worlds = d.worlds || []; loaded.worlds = true; setStat('worlds', cache.worlds.length); renderWorlds(); }
  catch (e) { if (!silent || !loaded.worlds) $('#world-list').innerHTML = `<div style="grid-column:1/-1">${emptyHtml('📡', esc(e.message))}</div>`; }
}
$('#world-list').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === 'share') return copyText(`${location.origin}${location.pathname}?world=${id}#worlds`, 'World link copied.');
  if (b.dataset.act === 'remove') modal({ title: 'Remove this world?', text: 'This can’t be undone.', okText: 'Remove' }).then(ok => {
    if (!ok) return;
    guarded(null, async () => { await api(`/api/realm/worlds/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('World removed.'); await loadWorlds(true); });
  });
});
$('#world-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!needLogin()) return;
  const form = e.currentTarget, btn = $('[type=submit]', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  guarded(btn, async () => { await api('/api/realm/worlds', { method: 'POST', body: JSON.stringify(payload) }); form.reset(); toast('🌌 Discovery published!'); confettiAt(btn); await loadWorlds(true); });
});

/* ------------------------------------------------------------ SQUADS */
function renderSquads() {
  const box = $('#squad-list');
  if (!loaded.squads) { box.innerHTML = skeleton(3); return; }
  const a = cache.squads;
  box.innerHTML = a.length ? a.map((s, i) => {
    const need = Number(s.playersNeeded) || 1, got = Math.min(Number(s.requestCount) || 0, need);
    const slots = Array.from({ length: need }, (_, k) => `<span class="slot${k < got ? ' fill' : ''}"></span>`).join('');
    let btn;
    if (s.mine) btn = '';
    else if (!me) btn = `<a class="btn btn-primary" href="./Login.html">Log in to join</a>`;
    else if (s.requested) btn = `<button class="btn btn-ghost" disabled>✓ Request sent</button>`;
    else btn = `<button class="btn btn-primary" data-act="join" data-id="${esc(s._id)}">Request to join</button>`;
    const canRemove = s.mine || (me && me.isOwner);
    return `<article class="item-card" data-id="${esc(s._id)}" style="--i:${Math.min(i, 8)}">
      <div class="item-top"><div><h4>${esc(s.name)}</h4><p style="margin:0">${esc(s.game)} · ${esc(need)} player${need === 1 ? '' : 's'} needed</p></div><span class="tag s-open">${esc(s.status || 'OPEN')}</span></div>
      <div class="slots" title="${got} of ${need} spots requested">${slots}<span class="muted" style="margin-left:6px">${got}/${need} requested</span></div>
      <p><b style="color:#d8dcf5">${esc(s.activity || 'Looking for teammates')}</b></p>
      <p>${esc(s.description || 'No extra details.')}</p>
      <p>Created by ${esc(s.creatorName || 'Nexus player')} · ${esc(when(s.createdAt))}</p>
      ${s.mine && s.requests && s.requests.length ? `<div class="reqs">👋 Wants to join: <b>${s.requests.map(esc).join(', ')}</b></div>` : ''}
      <div class="item-actions">${btn}<button class="btn btn-ghost" data-act="share" data-id="${esc(s._id)}">🔗 Share</button>${canRemove ? `<button class="btn btn-danger" data-act="remove" data-id="${esc(s._id)}">Remove</button>` : ''}</div>
    </article>`;
  }).join('') : emptyHtml('👥', 'No squads listed yet.<br>Create one to find teammates!');
  applyFocus('squad', '#squad-list');
}
async function loadSquads(silent) {
  try { const d = await api('/api/realm/squads'); cache.squads = d.squads || []; loaded.squads = true; setStat('squads', cache.squads.length); renderSquads(); }
  catch (e) { if (!silent || !loaded.squads) $('#squad-list').innerHTML = emptyHtml('📡', esc(e.message)); }
}
$('#squad-list').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  if (act === 'share') return copyText(`${location.origin}${location.pathname}?squad=${id}#squads`, 'Squad link copied.');
  if (!needLogin()) return;
  if (act === 'join') guarded(b, async () => { await api(`/api/realm/squads/${encodeURIComponent(id)}/join`, { method: 'POST', body: '{}' }); toast('👋 Join request sent!'); confettiAt(b); await loadSquads(true); });
  if (act === 'remove') modal({ title: 'Remove this squad?', text: 'The listing will disappear for everyone.', okText: 'Remove' }).then(ok => {
    if (!ok) return;
    guarded(null, async () => { await api(`/api/realm/squads/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('Squad removed.'); await loadSquads(true); });
  });
});
$('#squad-form').addEventListener('submit', e => {
  e.preventDefault();
  if (!needLogin()) return;
  const form = e.currentTarget, btn = $('[type=submit]', form);
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.playersNeeded = Number(payload.playersNeeded);
  guarded(btn, async () => { await api('/api/realm/squads', { method: 'POST', body: JSON.stringify(payload) }); form.reset(); toast('👥 Squad published!'); confettiAt(btn); await loadSquads(true); });
});

/* ------------------------------------------------------------ GIFTS */
const SEEN_KEY = 'nexusRealmSeenGifts';
function seenSet() { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (e) { return new Set(); } }
function markSeen(id) { const s = seenSet(); s.add(id); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-300))); } catch (e) {} }
const toMe = g => !!me && (String(g.toUserId) === myId() || String(g.toUsername || '').toLowerCase() === myName());
const fromMe = g => !!me && (String(g.fromUserId) === myId() || String(g.fromUsername || '').toLowerCase() === myName());
const receivedGifts = () => cache.gifts.filter(toMe);
const sentGifts = () => cache.gifts.filter(fromMe);

function renderGifts() {
  const got = receivedGifts(), seen = seenSet();
  // trophy cabinet
  const counts = {}; got.forEach(g => { counts[g.gift] = (counts[g.gift] || 0) + 1; });
  $('#cabinet').innerHTML = Object.entries(GIFTS).map(([k, v]) =>
    `<div class="cab${counts[k] ? ' has' : ''}" title="${esc(v.name)}"><span class="ce">${v.emoji}</span><span class="cn">${esc(v.name)}</span>${counts[k] ? `<span class="cc">${counts[k]}</span>` : ''}</div>`).join('');

  const list = $('#gift-list');
  if (!me) list.innerHTML = emptyHtml('🔒', 'Log in to see the gifts you’ve received.');
  else if (!loaded.gifts) list.innerHTML = skeleton(2);
  else if (!got.length) list.innerHTML = emptyHtml('🎁', 'No gifts yet.<br>Play well and be a great teammate — the Realm owner hands them out!');
  else list.innerHTML = got.map((g, i) => {
    const sealed = !seen.has(String(g._id));
    const info = GIFTS[g.gift] || { emoji: '🎁' };
    return `<article class="gift-card${sealed ? ' sealed' : ''}" data-gid="${esc(g._id)}" data-emoji="${info.emoji}" style="--i:${Math.min(i, 8)}">
      <span class="new-ribbon">NEW</span>
      <span class="ge">${sealed ? '🎁' : info.emoji}</span>
      <div class="seal-text"><b>You have a gift!</b><span>Tap to open it</span></div>
      <div class="gbody"><h4>${esc(g.giftLabel || g.gift)}</h4><p>From <b style="color:#d8dcf5">${esc(g.fromUsername || 'Remix MC')}</b></p><p>${esc(g.message || 'A gift from Nexus Realm.')}</p><span class="when">${esc(niceDate(g.createdAt))}</span></div>
    </article>`;
  }).join('');

  const unseen = got.filter(g => !seen.has(String(g._id))).length;
  const badge = $('#gift-badge'); badge.hidden = !unseen; badge.textContent = unseen;

  const sent = sentGifts();
  $('#gift-sent-wrap').hidden = !(isOwner() && sent.length);
  $('#gift-sent').innerHTML = sent.slice(0, 12).map((g, i) => {
    const info = GIFTS[g.gift] || { emoji: '🎁' };
    return `<article class="gift-card" style="--i:${Math.min(i, 8)}"><span class="ge">${info.emoji}</span><div class="gbody"><h4>${esc(g.giftLabel || g.gift)}</h4><p>To <b style="color:#d8dcf5">${esc(g.toUsername || 'player')}</b></p>${g.message ? `<p>${esc(g.message)}</p>` : ''}<span class="when">${esc(niceDate(g.createdAt))}</span></div></article>`;
  }).join('');
}
async function loadGifts() {
  if (!token()) { loaded.gifts = false; renderGifts(); return; }
  try {
    const d = await api('/api/realm/gifts');
    cache.gifts = d.gifts || []; canSendGifts = !!d.canSend; loaded.gifts = true;
    renderIdentity(); renderGifts();
  } catch (e) { $('#gift-list').innerHTML = emptyHtml('📡', esc(e.message)); }
}
$('#gift-list').addEventListener('click', e => {
  const card = e.target.closest('.gift-card.sealed'); if (!card) return;
  markSeen(card.dataset.gid);
  card.classList.add('opening');
  $('.ge', card).textContent = card.dataset.emoji;
  setTimeout(() => card.classList.remove('sealed'), 120);
  confettiAt(card);
  const badge = $('#gift-badge'), n = Math.max(0, (parseInt(badge.textContent, 10) || 1) - 1);
  badge.textContent = n; badge.hidden = !n;
});

/* owner-only send form */
const gform = $('#gift-form');
function updatePreview() {
  const g = GIFTS[gform.elements.gift.value] || GIFTS.trophy;
  const to = gform.elements.recipient.value.trim().replace(/^@/, '') || 'a player';
  const msg = gform.elements.message.value.trim();
  $('#gift-preview').innerHTML = `<span class="pe">${g.emoji}</span><div class="pt"><b>${esc(g.name)}</b> for <b>@${esc(to)}</b>${msg ? `<br>“${esc(msg)}”` : ''}</div>`;
}
gform.addEventListener('input', updatePreview);
gform.addEventListener('change', updatePreview);

const sug = $('#suggest'); let sugTimer = 0, sugSeq = 0;
function hideSug() { sug.hidden = true; sug.innerHTML = ''; }
gform.elements.recipient.addEventListener('input', () => {
  clearTimeout(sugTimer);
  const q = gform.elements.recipient.value.trim().replace(/^@/, '');
  if (!q) return hideSug();
  sugTimer = setTimeout(async () => {
    const seq = ++sugSeq;
    try {
      const d = await api('/api/realm/users?q=' + encodeURIComponent(q));
      if (seq !== sugSeq) return;
      const users = d.users || [];
      if (!users.length) return hideSug();
      sug.innerHTML = users.map(u => `<button type="button" data-u="${esc(u.username)}">${avatarHtml(u.username, u.avatar)}<span>${esc(u.username)}</span></button>`).join('');
      sug.hidden = false;
    } catch (e) { hideSug(); }
  }, 220);
});
sug.addEventListener('pointerdown', e => e.preventDefault());
sug.addEventListener('click', e => {
  const b = e.target.closest('[data-u]'); if (!b) return;
  gform.elements.recipient.value = b.dataset.u; hideSug(); updatePreview();
});
document.addEventListener('click', e => { if (!e.target.closest('.suggest-wrap')) hideSug(); });
gform.elements.recipient.addEventListener('keydown', e => { if (e.key === 'Escape') hideSug(); });

gform.addEventListener('submit', e => {
  e.preventDefault();
  if (!needLogin()) return;
  if (!isOwner()) return toast('Only Remix MC (the owner) can send gifts.', 'err');
  const btn = $('[type=submit]', gform);
  const payload = Object.fromEntries(new FormData(gform).entries());
  guarded(btn, async () => {
    await api('/api/realm/gifts', { method: 'POST', body: JSON.stringify(payload) });
    toast(`🎁 Gift sent to @${String(payload.recipient).replace(/^@/, '')}!`);
    confettiAt(btn);
    gform.elements.recipient.value = ''; gform.elements.message.value = ''; hideSug(); updatePreview();
    await loadGifts();
  });
});

/* ------------------------------------------------------------ boot */
async function boot() {
  sizeFx();
  $('#match-list').innerHTML = skeleton(3);
  $('#world-list').innerHTML = skeleton(2);
  $('#squad-list').innerHTML = skeleton(3);

  const qs = new URLSearchParams(location.search);
  let start = (location.hash || '').replace('#', '') || qs.get('tab') || 'challenges';
  if (qs.get('match')) { pendingFocus = { type: 'match', id: qs.get('match') }; start = 'challenges'; }
  else if (qs.get('world')) { pendingFocus = { type: 'world', id: qs.get('world') }; start = 'worlds'; }
  else if (qs.get('squad')) { pendingFocus = { type: 'squad', id: qs.get('squad') }; start = 'squads'; }

  switchTab(start, { refresh: false });
  await loadMe();
  renderIdentity();
  // load everything once so the hero numbers and the gift badge are right
  await Promise.allSettled([loadMatches(), loadWorlds(), loadSquads(), me ? loadGifts() : Promise.resolve()]);
  renderGifts();
  moveGlider();

  // quiet auto-refresh of the live board
  setInterval(() => { if (!document.hidden && tab === 'challenges') loadMatches(true); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && tab === 'challenges') loadMatches(true); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveGlider);
}
boot();
})();
