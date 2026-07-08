/*==============================
REMIX-NEXUS — PROFILE LOGIC
Shows the real account info (username, email, join date,
avatar) for whoever signed up / logged in, straight from
the database via /api/me.
==============================*/

const loadingEl = document.getElementById('profile-loading');
const loggedOutEl = document.getElementById('profile-loggedout');
const loggedInEl = document.getElementById('profile-loggedin');

const avatarDisplay = document.getElementById('avatarDisplay');
const profileUsername = document.getElementById('profileUsername');
const profileEmail = document.getElementById('profileEmail');
const infoUsername = document.getElementById('infoUsername');
const infoEmail = document.getElementById('infoEmail');
const infoJoined = document.getElementById('infoJoined');
const avatarPicker = document.getElementById('avatarPicker');
const avatarMessage = document.getElementById('avatarMessage');
const logoutBtn = document.getElementById('logoutBtn');

const usernameForm = document.getElementById('usernameForm');
const newUsernameInput = document.getElementById('newUsernameInput');
const usernameMessage = document.getElementById('usernameMessage');

const passwordForm = document.getElementById('passwordForm');
const currentPasswordInput = document.getElementById('currentPasswordInput');
const newPasswordInput = document.getElementById('newPasswordInput');
const passwordMessage = document.getElementById('passwordMessage');

function showState(state){
  loadingEl.style.display = state === 'loading' ? 'block' : 'none';
  loggedOutEl.style.display = state === 'loggedout' ? 'block' : 'none';
  loggedInEl.style.display = state === 'loggedin' ? 'block' : 'none';
}

function formatJoinDate(dateString){
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderUser(user){
  avatarDisplay.textContent = user.avatar || '🎮';
  profileUsername.textContent = user.username;
  profileEmail.textContent = user.email;
  infoUsername.textContent = user.username;
  infoEmail.textContent = user.email;
  infoJoined.textContent = user.createdAt ? formatJoinDate(user.createdAt) : '—';
}

async function loadAvatarPicker(currentAvatar){
  try {
    const res = await fetch('https://remix-nexus-production.up.railway.app/api/avatar-options');
    const data = await res.json();
    const options = data.options || [];

    avatarPicker.innerHTML = options.map(emoji => `
      <button type="button" class="avatar-option ${emoji === currentAvatar ? 'selected' : ''}" data-avatar="${emoji}">${emoji}</button>
    `).join('');

    avatarPicker.querySelectorAll('.avatar-option').forEach(btn => {
      btn.addEventListener('click', () => selectAvatar(btn.dataset.avatar));
    });
  } catch (err) {
    avatarPicker.innerHTML = '';
  }
}

async function selectAvatar(emoji){
  avatarMessage.textContent = 'Saving…';
  avatarMessage.style.color = '#bdbdbd';

  try {
    const res = await fetch('https://remix-nexus-production.up.railway.app/api/me/avatar', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + AUTH.getToken()
      },
      body: JSON.stringify({ avatar: emoji })
    });

    const data = await res.json();

    if (!res.ok) {
      avatarMessage.textContent = data.error || 'Could not update avatar.';
      avatarMessage.style.color = '#ff5b5b';
      return;
    }

    localStorage.setItem(AUTH.USER_KEY, JSON.stringify(data.user));
    renderUser(data.user);

    avatarPicker.querySelectorAll('.avatar-option').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.avatar === emoji);
    });

    avatarMessage.textContent = 'Avatar updated!';
    avatarMessage.style.color = '#00e676';
  } catch (err) {
    avatarMessage.textContent = 'Could not reach the server.';
    avatarMessage.style.color = '#ff5b5b';
  }
}

usernameForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const newUsername = newUsernameInput.value.trim();
  const submitBtn = usernameForm.querySelector('button[type="submit"]');

  if (newUsername.length < 3) {
    usernameMessage.textContent = 'Username must be at least 3 characters.';
    usernameMessage.style.color = '#ff5b5b';
    return;
  }

  submitBtn.disabled = true;
  usernameMessage.textContent = 'Saving…';
  usernameMessage.style.color = '#bdbdbd';

  try {
    const res = await fetch('https://remix-nexus-production.up.railway.app/api/me/username', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + AUTH.getToken()
      },
      body: JSON.stringify({ username: newUsername })
    });

    const data = await res.json();

    if (!res.ok) {
      usernameMessage.textContent = data.error || 'Could not update username.';
      usernameMessage.style.color = '#ff5b5b';
      return;
    }

    localStorage.setItem(AUTH.USER_KEY, JSON.stringify(data.user));

    // The server issues a fresh token whenever the username changes (the
    // old one still has the old name baked into it). Save it the same way
    // auth.js saves it at login, so chat picks up the new name right away.
    if (data.token) {
      if (typeof AUTH.setToken === 'function') {
        AUTH.setToken(data.token);
      } else if (AUTH.TOKEN_KEY) {
        localStorage.setItem(AUTH.TOKEN_KEY, data.token);
      }
    }

    renderUser(data.user);
    newUsernameInput.value = '';

    usernameMessage.textContent = 'Username updated!';
    usernameMessage.style.color = '#00e676';
  } catch (err) {
    usernameMessage.textContent = 'Could not reach the server.';
    usernameMessage.style.color = '#ff5b5b';
  } finally {
    submitBtn.disabled = false;
  }
});

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const submitBtn = passwordForm.querySelector('button[type="submit"]');

  if (newPassword.length < 6) {
    passwordMessage.textContent = 'New password must be at least 6 characters.';
    passwordMessage.style.color = '#ff5b5b';
    return;
  }

  submitBtn.disabled = true;
  passwordMessage.textContent = 'Saving…';
  passwordMessage.style.color = '#bdbdbd';

  try {
    const res = await fetch('https://remix-nexus-production.up.railway.app/api/me/password', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + AUTH.getToken()
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await res.json();

    if (!res.ok) {
      passwordMessage.textContent = data.error || 'Could not update password.';
      passwordMessage.style.color = '#ff5b5b';
      return;
    }

    currentPasswordInput.value = '';
    newPasswordInput.value = '';

    passwordMessage.textContent = 'Password updated!';
    passwordMessage.style.color = '#00e676';
  } catch (err) {
    passwordMessage.textContent = 'Could not reach the server.';
    passwordMessage.style.color = '#ff5b5b';
  } finally {
    submitBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  AUTH.logout();
  window.location.href = './index.html';
});

(async function init(){
  if (!AUTH.isLoggedIn()){
    showState('loggedout');
    return;
  }

  const user = await AUTH.fetchMe();

  if (!user){
    showState('loggedout');
    return;
  }

  renderUser(user);
  loadAvatarPicker(user.avatar);
  showState('loggedin');
})();
