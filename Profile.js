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
  currentUser = user;
  applyBanner(user);
}

/*==============================
PROFILE BANNER (YouTube-style cover picture)
- the user picks any picture; it is centre-cropped and shrunk to
  1200x400 so it stays small and loads fast
- it is always saved on this device (instant)
- it is also sent to the server (PUT /api/me/banner). If your server
  doesn't have that route yet, the banner simply stays on this device.
==============================*/
let currentUser = null;

const profileHeader = document.getElementById('profileHeader');
const bannerFileInput = document.getElementById('bannerFileInput');
const bannerChangeBtn = document.getElementById('bannerChangeBtn');
const bannerRemoveBtn = document.getElementById('bannerRemoveBtn');
const bannerMessage = document.getElementById('bannerMessage');

function bannerKey(user){
  const id = user && (user._id || user.id || user.username);
  return id ? 'remixNexusBanner:' + id : null;
}

function getStoredBanner(user){
  if (user && user.banner) return user.banner;       // saved on the server
  const key = bannerKey(user);
  try { return key ? (localStorage.getItem(key) || '') : ''; } catch (e) { return ''; }
}

function applyBanner(user){
  if (!profileHeader) return;
  const src = getStoredBanner(user);
  if (src) {
    profileHeader.style.setProperty('--banner-img', 'url("' + src + '")');
  } else {
    profileHeader.style.removeProperty('--banner-img');
  }
  if (bannerRemoveBtn) bannerRemoveBtn.style.display = src ? '' : 'none';
}

function bannerSay(text, color){
  if (!bannerMessage) return;
  bannerMessage.textContent = text;
  bannerMessage.style.color = color || '#bdbdbd';
}

// picture -> centre-cropped 1200x400 JPEG (small file, any phone photo works)
function fileToBannerDataUrl(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const W = 1200, H = 400;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(W / img.width, H / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that picture.'));
    };
    img.src = url;
  });
}

async function sendBannerToServer(banner){
  try {
    const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/me/banner', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + AUTH.getToken()
      },
      body: JSON.stringify({ banner })
    });
    if (!res.ok) return null;
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    return data.user || {};
  } catch (err) {
    return null;                       // server unreachable / route missing
  }
}

if (bannerChangeBtn && bannerFileInput) {
  bannerChangeBtn.addEventListener('click', () => bannerFileInput.click());

  bannerFileInput.addEventListener('change', async () => {
    const file = bannerFileInput.files && bannerFileInput.files[0];
    bannerFileInput.value = '';                       // lets them pick the same file again
    if (!file) return;

    if (!file.type || file.type.indexOf('image/') !== 0) {
      bannerSay('Please choose a picture (JPG, PNG or WebP).', '#ff5b5b');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      bannerSay('That picture is too big. Please pick one under 15 MB.', '#ff5b5b');
      return;
    }

    bannerSay('Saving banner…');

    try {
      const dataUrl = await fileToBannerDataUrl(file);
      const user = currentUser || (AUTH.getUser && AUTH.getUser());
      const key = bannerKey(user);

      if (key) {
        try {
          localStorage.setItem(key, dataUrl);
        } catch (e) {
          bannerSay('Not enough space on this device to save the banner.', '#ff5b5b');
          return;
        }
      }

      // show it straight away
      profileHeader.style.setProperty('--banner-img', 'url("' + dataUrl + '")');
      bannerRemoveBtn.style.display = '';

      const serverUser = await sendBannerToServer(dataUrl);
      if (serverUser) {
        if (serverUser.username) {
          localStorage.setItem(AUTH.USER_KEY, JSON.stringify(serverUser));
          currentUser = serverUser;
        }
        bannerSay('Banner saved to your account!', '#00e676');
      } else {
        bannerSay('Banner saved on this device.', '#00e676');
      }
    } catch (err) {
      bannerSay(err.message || 'Could not use that picture.', '#ff5b5b');
    }
  });
}

if (bannerRemoveBtn) {
  bannerRemoveBtn.addEventListener('click', async () => {
    const user = currentUser || (AUTH.getUser && AUTH.getUser());
    const key = bannerKey(user);
    try { if (key) localStorage.removeItem(key); } catch (e) { /* ignore */ }

    if (user) user.banner = '';
    profileHeader.style.removeProperty('--banner-img');
    bannerRemoveBtn.style.display = 'none';
    bannerSay('Banner removed.', '#00e676');

    sendBannerToServer('');            // best effort, ignore the result
  });
}


async function loadAvatarPicker(currentAvatar){
  try {
    const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/avatar-options');
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
    const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/me/avatar', {
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
    const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/me/username', {
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
    const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/me/password', {
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

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    AUTH.logout();
    window.location.href = './index.html';
  });
}

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
