/*==============================
REMIX NEXUS — USER PROFILE POPUP (shared by Chat.html and Contacts.html)

Tap another player's icon / name → a Discord-style profile card with their
record and the challenges they've played (Nexus Arena duels + Match Arena
matches). Any element with data-pf-uid / data-pf-name / data-pf-av opens it.

Add it as a script on the page BEFORE Chat.js / Contacts.js:
  <script src="./user-profile.js"></script>
Optional: window.NexusProfileOptions = { onMessage({uid,name,avatar}) }
  lets a page open the DM itself instead of navigating to Contacts.html.
==============================*/
(() => {
'use strict';
if (window.NexusProfile) return;

const BASE = String((typeof BACKEND_URL !== 'undefined' && BACKEND_URL) || 'https://remix-nexus-bgz9.onrender.com').replace(/\/+$/, '');
const tok = () => { try { return window.AUTH && AUTH.getToken ? AUTH.getToken() : null; } catch (e) { return null; } };
const myId = () => { try { const u = window.AUTH && AUTH.getUser ? AUTH.getUser() : null; return u && u.id ? String(u.id) : ''; } catch (e) { return ''; } };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

async function get(path) {
  const headers = {};
  const t = tok();
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch(BASE + path, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
  return data;
}

/* ---------- styles ---------- */
const css = `
.msg-av{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-right:6px;border-radius:50%;background:linear-gradient(135deg,#0050d6,#00b7ff);font-size:11px;line-height:1;vertical-align:middle;color:#fff;font-weight:700}
.msg-author-link:hover .msg-av{border-radius:6px}
[data-pf-uid]{cursor:pointer}
.npf-modal{position:fixed;inset:0;z-index:9500;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(0,0,0,.72);font-family:'Poppins',system-ui,sans-serif}
.npf-modal.open{display:flex}
.npf-card{position:relative;width:100%;max-width:420px;max-height:calc(100dvh - 28px);overflow-y:auto;border-radius:16px;background:var(--nx-bg-2,#0a0d16);border:1px solid var(--nx-line,rgba(255,255,255,.08));color:var(--nx-text,#e8ecf7);box-shadow:0 22px 64px rgba(0,0,0,.65)}
.npf-banner{height:84px;background:linear-gradient(135deg,hsl(var(--hue,215) 80% 40%),hsl(calc(var(--hue,215) + 50) 85% 55%))}
.npf-close{position:absolute;top:10px;right:10px;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:14px;cursor:pointer}
.npf-head{display:flex;align-items:flex-end;gap:12px;margin:-34px 16px 0}
.npf-avatar{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#0050d6,#00b7ff);border:5px solid var(--nx-bg-2,#0a0d16);font-size:34px;color:#fff}
.npf-name{margin:0 0 6px;font-size:17px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.npf-actions{display:flex;gap:8px;margin:12px 16px 0;flex-wrap:wrap}
.npf-btn{padding:8px 14px;border:0;border-radius:8px;background:var(--nx-bg-4,#171c2b);color:#fff;font:600 12px/1.2 inherit;font-family:inherit;text-decoration:none;cursor:pointer}
.npf-btn.primary{background:var(--nx-blue,#0066ff)}
.npf-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 16px 0}
.npf-stat{padding:9px 4px;border-radius:10px;background:var(--nx-bg-1,#05070d);text-align:center}
.npf-stat b{display:block;font-size:17px;color:#fff}
.npf-stat span{font-size:10px;color:var(--nx-muted,#8a96b5)}
.npf-h{margin:16px 16px 8px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--nx-muted,#8a96b5)}
.npf-list{display:flex;flex-direction:column;gap:6px;margin:0 16px 14px}
.npf-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--nx-bg-1,#05070d);color:inherit;text-decoration:none;transition:background .12s}
.npf-row:hover{background:var(--nx-bg-3,#10141f)}
.npf-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.npf-info b{font-size:13px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.npf-info small{font-size:11px;color:var(--nx-muted,#8a96b5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.npf-chip{flex-shrink:0;padding:4px 9px;border-radius:9px;background:var(--nx-bg-4,#171c2b);font-size:11px;font-weight:700;white-space:nowrap}
.npf-chip.win{background:rgba(35,165,90,.2);color:#5ee08e}
.npf-chip.loss{background:rgba(242,63,67,.16);color:#ff7a7d}
.npf-chip.live{background:rgba(242,63,67,.18);color:#ff6b6e}
.npf-empty{padding:14px 6px;text-align:center;font-size:12px;color:var(--nx-muted,#8a96b5)}
`;
const styleEl = document.createElement('style');
styleEl.id = 'nexusProfileStyles';
styleEl.textContent = css;
document.head.appendChild(styleEl);

/* ---------- helpers ---------- */
function hueOf(str) { let h = 0; String(str).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
function ago(v) {
  const mins = Math.floor((Date.now() - new Date(v).getTime()) / 60000);
  if (!isFinite(mins) || mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const h = Math.floor(mins / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d < 30 ? d + 'd ago' : Math.floor(d / 30) + 'mo ago';
}
function isEmoji(a) { a = String(a || ''); return !!a && a.length <= 8 && !/^https?:/i.test(a); }
function iconFor(avatar, name) { return isEmoji(avatar) ? avatar : String(name || '?').trim().charAt(0).toUpperCase() || '?'; }

const REALM_STATUS = { open: 'OPEN', accepted: 'LIVE', completed: 'COMPLETED', disputed: 'DISPUTED' };

function arenaRow(c) {
  let chip = '<span class="npf-chip">⏳ Waiting</span>';
  if (c.status === 'live') chip = '<span class="npf-chip live">🔴 LIVE</span>';
  else if (c.status === 'judging') chip = '<span class="npf-chip">🗳 Voting</span>';
  else if (c.status === 'completed') chip = c.draw ? '<span class="npf-chip">🤝 Draw</span>' : `<span class="npf-chip win">🏆 ${esc(c.winnerName || 'Winner')}</span>`;
  else if (c.status === 'declined') chip = '<span class="npf-chip">🚫 Declined</span>';
  else if (c.status === 'expired') chip = '<span class="npf-chip">⌛ Expired</span>';
  return `<a class="npf-row" href="./Chat.html?room=${encodeURIComponent(c.room)}&arena=${encodeURIComponent(c.id)}">
    <span class="npf-info"><b>${esc(c.gameName || 'Duel')} · ${esc(c.minutes)} min</b><small>${esc(c.challenger.username)} vs ${esc(c.opponent.username)} · ${esc(ago(c.updatedAt || c.createdAt))}</small></span>${chip}</a>`;
}
function realmRow(m, uid) {
  const meSide = String(m.challengerId) === uid ? m.challengerName : m.opponentName;
  const other = String(m.challengerId) === uid ? (m.opponentName || m.opponentUsername || 'Open slot') : m.challengerName;
  let chip = `<span class="npf-chip">${esc(REALM_STATUS[m.status] || String(m.status || '').toUpperCase())}</span>`;
  if (m.status === 'completed') {
    const won = String(m.winnerUsername || '').toLowerCase() === String(meSide || '').toLowerCase();
    chip = won ? '<span class="npf-chip win">🏆 Won</span>' : '<span class="npf-chip loss">Lost</span>';
  } else if (m.status === 'accepted') chip = '<span class="npf-chip live">🔴 LIVE</span>';
  return `<a class="npf-row" href="./NexusRealm.html?match=${encodeURIComponent(m._id)}#challenges">
    <span class="npf-info"><b>🎮 ${esc(m.game)} · ${esc(m.matchType || 'Challenge')}</b><small>vs ${esc(other)} · ${esc(ago(m.createdAt))}</small></span>${chip}</a>`;
}

/* ---------- modal ---------- */
let seq = 0;
function modalEl() {
  let m = $('#npf-modal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'npf-modal';
  m.className = 'npf-modal';
  m.setAttribute('aria-hidden', 'true');
  m.innerHTML = `
    <div class="npf-card" role="dialog" aria-modal="true">
      <div class="npf-banner" id="npf-banner"></div>
      <button type="button" class="npf-close" id="npf-close" aria-label="Close">✕</button>
      <div class="npf-head"><div class="npf-avatar" id="npf-avatar">?</div><h3 class="npf-name" id="npf-name"></h3></div>
      <div class="npf-actions" id="npf-actions"></div>
      <div class="npf-stats" id="npf-stats"></div>
      <div id="npf-arena-wrap" hidden><h4 class="npf-h">⚔️ Nexus Arena duels</h4><div class="npf-list" id="npf-arena"></div></div>
      <div id="npf-realm-wrap" hidden><h4 class="npf-h">🎮 Match Arena history</h4><div class="npf-list" id="npf-realm"></div></div>
      <div class="npf-empty" id="npf-status"></div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('#npf-close')) close(); });
  return m;
}
function close() {
  const m = $('#npf-modal');
  if (!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  seq++;
}

async function open(opts) {
  const uid = String(opts.uid || '');
  if (!uid) return;
  const name = opts.name || 'Player';
  const isMe = !!myId() && myId() === uid;
  const m = modalEl();
  const my = ++seq;

  $('#npf-banner').style.setProperty('--hue', String(hueOf(name)));
  $('#npf-avatar').textContent = iconFor(opts.avatar, name);
  $('#npf-name').textContent = name;
  $('#npf-stats').innerHTML = ['Challenges', 'Wins', 'Losses', 'Draws'].map(l => `<div class="npf-stat"><b>–</b><span>${l}</span></div>`).join('');
  $('#npf-arena-wrap').hidden = true;
  $('#npf-realm-wrap').hidden = true;
  $('#npf-status').textContent = 'Loading…';

  // Message button: pages can open the DM themselves, otherwise go to Contacts.html.
  const actions = $('#npf-actions');
  actions.innerHTML = '';
  if (!isMe) {
    const onMessage = window.NexusProfileOptions && window.NexusProfileOptions.onMessage;
    if (typeof onMessage === 'function') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'npf-btn primary';
      b.textContent = '💬 Message';
      b.onclick = () => { close(); onMessage({ uid, name, avatar: opts.avatar || '' }); };
      actions.appendChild(b);
    } else {
      const a = document.createElement('a');
      a.className = 'npf-btn primary';
      a.textContent = '💬 Message';
      a.href = './Contacts.html?uid=' + encodeURIComponent(uid) + '&username=' + encodeURIComponent(name) + '&avatar=' + encodeURIComponent(opts.avatar || '');
      actions.appendChild(a);
    }
  }
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');

  const [arenaRes, realmRes] = await Promise.allSettled([
    tok() ? get('/api/arena/user/' + encodeURIComponent(uid)) : Promise.reject(new Error('login')),
    get('/api/realm/users/' + encodeURIComponent(uid) + '/profile')
  ]);
  if (my !== seq) return;                       // closed or replaced meanwhile

  const A = arenaRes.status === 'fulfilled' ? arenaRes.value : null;
  const R = realmRes.status === 'fulfilled' ? realmRes.value : null;
  if (!A && !R) {
    $('#npf-status').textContent = tok() ? 'Could not load this profile right now.' : 'Log in to see this player’s challenges.';
    return;
  }

  const user = (R && R.user) || (A && A.user);
  if (user) {
    $('#npf-name').textContent = user.username || name;
    $('#npf-avatar').textContent = iconFor(user.avatar, user.username || name);
    window.dispatchEvent(new CustomEvent('nexus:profile', { detail: { uid, avatar: user.avatar || '' } }));
  }

  const as = (A && A.stats) || {}, rs = (R && R.stats) || {};
  const num = (v) => Number(v) || 0;
  const created = num(as.created) + num(rs.created);
  const wins = num(as.wins) + num(rs.wins);
  const losses = num(as.losses) + num(rs.losses);
  const draws = num(as.draws);
  $('#npf-stats').innerHTML = [['Challenges', created], ['Wins', wins], ['Losses', losses], ['Draws', draws]]
    .map(([l, v]) => `<div class="npf-stat"><b>${v}</b><span>${l}</span></div>`).join('');

  const arenaList = (A && A.challenges) || [];
  const realmList = (R && R.matches) || [];
  if (arenaList.length) { $('#npf-arena').innerHTML = arenaList.map(arenaRow).join(''); $('#npf-arena-wrap').hidden = false; }
  if (realmList.length) { $('#npf-realm').innerHTML = realmList.map(x => realmRow(x, uid)).join(''); $('#npf-realm-wrap').hidden = false; }
  $('#npf-status').textContent = (arenaList.length || realmList.length)
    ? ''
    : (isMe ? "You haven't" : 'This player hasn’t') + ' played any challenges yet.';
}

/* ---------- wiring ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest && e.target.closest('[data-pf-uid]');
  if (!t || t.closest('#npf-modal')) return;
  if (t.closest('.group-select-mode')) return;   // picking people for a group call — don't hijack the tap
  e.stopPropagation();
  e.preventDefault();
  open({ uid: t.dataset.pfUid, name: t.dataset.pfName, avatar: t.dataset.pfAv });
}, true);

document.addEventListener('keydown', (e) => {
  const m = $('#npf-modal');
  if (e.key === 'Escape' && m && m.classList.contains('open')) { e.stopImmediatePropagation(); close(); }
}, true);

window.NexusProfile = { open, close };
})();
