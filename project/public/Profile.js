/*==============================
REMIXMC — PROFILE LOGIC
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
    const res = await fetch(BACKEND_URL + '/api/avatar-options');
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
    const res = await fetch(BACKEND_URL + '/api/me/avatar', {
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
