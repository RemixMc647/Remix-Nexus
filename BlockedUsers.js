/*==============================
REMIX-NEXUS — BLOCKED USERS
Lists everyone the logged-in account has blocked, and lets them
unblock any of them. Talks to the same Express + Socket.io server
as the rest of the app.
==============================*/

const API_BASE = 'https://remix-nexus-bgz9.onrender.com';

const blockedListEl = document.getElementById('blockedList');
const blockedLoggedOutEl = document.getElementById('blockedLoggedOut');

function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function renderBlockedUsers(users){
  if (!users.length){
    blockedListEl.innerHTML = '<p style="text-align:center; opacity:0.75; padding:20px;">You haven\'t blocked anyone.</p>';
    return;
  }

  blockedListEl.innerHTML = users.map(u => `
    <div class="setting-card" data-id="${escapeHTML(u.id)}" style="cursor:default;">
      ${escapeHTML(u.avatar || '🎮')}
      <div style="flex:1;">
        <h3>${escapeHTML(u.username)}</h3>
        <p>Blocked</p>
      </div>
      <button type="button" class="unblock-btn" data-id="${escapeHTML(u.id)}" data-username="${escapeHTML(u.username)}"
        style="background:#0066ff; color:#fff; border:none; border-radius:8px; padding:8px 14px; cursor:pointer; font-weight:600;">
        Unblock
      </button>
    </div>
  `).join('');
}

async function loadBlockedUsers(){
  try {
    const res = await fetch(API_BASE + '/api/blocked', {
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });
    if (!res.ok){
      blockedListEl.innerHTML = '<p style="text-align:center; opacity:0.75; padding:20px;">Could not load your blocked list.</p>';
      return;
    }
    const data = await res.json();
    renderBlockedUsers(data.users || []);
  } catch (err) {
    blockedListEl.innerHTML = '<p style="text-align:center; opacity:0.75; padding:20px;">Could not reach the server.</p>';
  }
}

async function unblockUser(id, username){
  if (!confirm(`Unblock ${username}? They'll be able to message you again.`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(id)}/unblock`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });
    if (!res.ok){
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Could not unblock this user.');
      return;
    }
    loadBlockedUsers();
  } catch (err) {
    alert('Could not reach the server.');
  }
}

blockedListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.unblock-btn');
  if (!btn) return;
  unblockUser(btn.dataset.id, btn.dataset.username);
});

(function init(){
  if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()){
    blockedLoggedOutEl.style.display = 'block';
    blockedListEl.style.display = 'none';
    return;
  }
  loadBlockedUsers();
})();
