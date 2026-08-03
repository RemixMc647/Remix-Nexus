/*==============================
REMIX-NEXUS — ADMIN DASHBOARD LOGIC
Only ever usable by an owner account (isRoomOwner / OWNER_USER_IDS /
OWNER_USERNAMES on the server — see server.js). Every route this page
calls is protected server-side by adminGuard, so even if someone
reaches this page directly, the API itself refuses non-owner requests.
==============================*/

const API_BASE = "https://remix-nexus-bgz9.onrender.com";

let allUsers = [];
let allReports = [];
let activeReportFilter = 'open';

function authHeaders() {
  return { Authorization: 'Bearer ' + (window.AUTH ? AUTH.getToken() : '') };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* -----------------------------------------------------------
   ACCESS CHECK — confirm this account is actually an owner before
   showing anything. /api/me only ever includes isOwner on your own
   response (see server.js publicUser + isRoomOwner), so this can't be
   spoofed by editing localStorage.
----------------------------------------------------------- */
async function checkAccess() {
  if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) {
    location.href = './Profile.html';
    return false;
  }
  try {
    const res = await fetch(API_BASE + '/api/me', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok || !data.user || !data.user.isOwner) {
      document.getElementById('adminGate').style.display = 'block';
      return false;
    }
    document.getElementById('adminContainer').style.display = 'block';
    return true;
  } catch (err) {
    document.getElementById('adminGate').style.display = 'block';
    return false;
  }
}

/* -----------------------------------------------------------
   TABS
----------------------------------------------------------- */
document.querySelectorAll('.admin-tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.admin-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('usersTab').style.display = tab === 'users' ? 'block' : 'none';
    document.getElementById('reportsTab').style.display = tab === 'reports' ? 'block' : 'none';
  };
});

/* -----------------------------------------------------------
   USERS
----------------------------------------------------------- */
async function loadUsers() {
  try {
    const res = await fetch(API_BASE + '/api/admin/users', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    allUsers = data.users || [];
    renderUsers();
  } catch (err) {
    document.getElementById('usersList').innerHTML = '<p class="admin-empty">Could not load users.</p>';
  }
}

function renderUsers() {
  const query = document.getElementById('userSearchInput').value.trim().toLowerCase();
  const filtered = query
    ? allUsers.filter(u => u.username.toLowerCase().includes(query) || u.email.toLowerCase().includes(query))
    : allUsers;

  const list = document.getElementById('usersList');
  if (!filtered.length) {
    list.innerHTML = '<p class="admin-empty">No users found.</p>';
    return;
  }

  list.innerHTML = filtered.map(u => `
    <div class="admin-card">
      <div class="admin-card-avatar">${u.avatar || '🎮'}</div>
      <div class="admin-card-body">
        <h3>${escapeHtml(u.username)}</h3>
        <p>${escapeHtml(u.email)}</p>
        ${u.isOwner ? '<span class="admin-pill owner">Owner</span>' : ''}
        ${u.banned ? `<span class="admin-pill banned">Banned${u.bannedReason ? ': ' + escapeHtml(u.bannedReason) : ''}</span>` : ''}
      </div>
      <div class="admin-card-actions">
        ${u.isOwner ? '' : (u.banned
          ? `<button class="admin-btn unban" data-id="${u.id}">Unban</button>`
          : `<button class="admin-btn ban" data-id="${u.id}">Ban</button>`)}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.admin-btn.ban').forEach(btn => {
    btn.onclick = () => banUser(btn.dataset.id);
  });
  list.querySelectorAll('.admin-btn.unban').forEach(btn => {
    btn.onclick = () => unbanUser(btn.dataset.id);
  });
}

async function banUser(userId) {
  const reason = prompt('Reason for banning this user (shown to them on login):') || '';
  if (!confirm('Ban this user? They will be signed out immediately and blocked from logging in.')) return;
  try {
    const res = await fetch(API_BASE + '/api/admin/users/' + userId + '/ban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadUsers();
  } catch (err) {
    alert(err.message || 'Could not ban this user.');
  }
}

async function unbanUser(userId) {
  try {
    const res = await fetch(API_BASE + '/api/admin/users/' + userId + '/unban', {
      method: 'POST',
      headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadUsers();
  } catch (err) {
    alert(err.message || 'Could not unban this user.');
  }
}

document.getElementById('userSearchInput').addEventListener('input', renderUsers);

/* -----------------------------------------------------------
   REPORTS
----------------------------------------------------------- */
async function loadReports() {
  try {
    const res = await fetch(API_BASE + '/api/admin/reports', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    allReports = data.reports || [];
    renderReports();
    const openCount = allReports.filter(r => r.status === 'open').length;
    const badge = document.getElementById('openReportsBadge');
    if (openCount > 0) {
      badge.textContent = openCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    document.getElementById('reportsList').innerHTML = '<p class="admin-empty">Could not load reports.</p>';
  }
}

function renderReports() {
  const filtered = activeReportFilter === 'all'
    ? allReports
    : allReports.filter(r => r.status === activeReportFilter);

  const list = document.getElementById('reportsList');
  if (!filtered.length) {
    list.innerHTML = '<p class="admin-empty">Nothing here.</p>';
    return;
  }

  list.innerHTML = filtered.map(r => `
    <div class="admin-card">
      <div class="admin-card-avatar">🚩</div>
      <div class="admin-card-body">
        <h3>${escapeHtml(r.targetType)} — reported by ${escapeHtml(r.reportedByUsername)}</h3>
        <p>${escapeHtml(r.reason) || 'No reason given.'}</p>
        ${r.contentSnapshot ? `<p style="opacity:.5;">"${escapeHtml(r.contentSnapshot)}"</p>` : ''}
        ${r.targetUsername ? `<p style="opacity:.5;">Against: ${escapeHtml(r.targetUsername)}</p>` : ''}
        <span class="admin-pill ${r.status}">${r.status}</span>
      </div>
      <div class="admin-card-actions">
        ${r.status !== 'resolved' ? `<button class="admin-btn resolve" data-id="${r._id}" data-status="resolved">Resolve</button>` : ''}
        ${r.status !== 'dismissed' ? `<button class="admin-btn dismiss" data-id="${r._id}" data-status="dismissed">Dismiss</button>` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.admin-btn').forEach(btn => {
    btn.onclick = () => updateReportStatus(btn.dataset.id, btn.dataset.status);
  });
}

async function updateReportStatus(reportId, status) {
  try {
    const res = await fetch(API_BASE + '/api/admin/reports/' + reportId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadReports();
  } catch (err) {
    alert(err.message || 'Could not update this report.');
  }
}

document.querySelectorAll('.admin-filter-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.admin-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeReportFilter = btn.dataset.status;
    renderReports();
  };
});

/* -----------------------------------------------------------
   BOOT
----------------------------------------------------------- */
(async () => {
  const ok = await checkAccess();
  if (ok) {
    loadUsers();
    loadReports();
  }
})();
