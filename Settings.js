// Show the user's banner picture (set on the Profile page) on the
// profile card at the top of Settings. Display only.
function paintProfileBanner(src) {
  try {
    const art = document.querySelector('.profile-banner .banner-art');
    if (!art || !src) return;
    art.style.setProperty('background-image', 'url("' + src + '")', 'important');
    art.style.setProperty('background-size', 'cover', 'important');
    art.style.setProperty('background-position', 'center', 'important');
  } catch (e) { /* keep the default blue banner */ }
}

(function showProfileBanner() {
  try {
    if (!window.AUTH || !AUTH.getUser) return;
    const u = AUTH.getUser();
    if (!u) return;
    let src = u.banner || '';
    if (!src) {
      const id = u._id || u.id || u.username;
      if (id) src = localStorage.getItem('remixNexusBanner:' + id) || '';
    }
    paintProfileBanner(src);
  } catch (e) { /* ignore */ }
})();

// Only the owner account sees the Admin Dashboard link — /api/me only
// ever reports isOwner:true on your OWN account's response, so this
// can't be spoofed by editing localStorage.
(async () => {
  if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) return;
  try {
    const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/me', {
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });
    const data = await res.json();
    if (res.ok && data.user && data.user.isOwner) {
      document.getElementById('adminCard').style.display = 'flex';
    }
    // banner saved on the server (e.g. set from another device)
    if (res.ok && data.user && data.user.banner) paintProfileBanner(data.user.banner);
  } catch (err) {
    // Server unreachable — just leave the card hidden, no big deal.
  }
})();

document.getElementById("logoutBtn").onclick=()=>{

if(confirm("Logout of Remix Nexus?")){

AUTH.logout();

location.href="index.html";

}

};

document.getElementById('clearChats').onclick = async () => {
  if (!confirm(
    'Clear all your chats? Every message in your rooms and DMs will ' +
    'disappear for YOU only, and the copies saved on this device are ' +
    'removed too (frees up space). Other people keep their own messages. ' +
    'This cannot be undone.'
  )) {
    return;
  }

  const clearBtn = document.getElementById('clearChats');
  clearBtn.style.pointerEvents = 'none';
  clearBtn.style.opacity = '0.6';

  try {
    const res = await fetch('https://remix-nexus-bgz9.onrender.com/api/me/chats', {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + AUTH.getToken()
      }
    });

    // Read the reply safely — a sleeping/restarting server can answer with
    // an HTML error page instead of JSON, which used to be reported as
    // "could not reach the server".
    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }

    if (!res.ok) {
      alert(data.error || ('Could not clear chats (error ' + res.status + '). Please try again.'));
      clearBtn.style.pointerEvents = '';
      clearBtn.style.opacity = '';
      return;
    }

    // Clear local caches too, so nothing stale flashes on screen
    // before the next server fetch.
    Object.keys(localStorage).forEach(key => {
      if (
        key.startsWith('remix-nexusMessages:') ||
        key.startsWith('app-chat-backup:') ||
        key.startsWith('remix-nexusDM') ||
        key.startsWith('remix-nexusUnreadRooms:') ||
        key.startsWith('remix-nexusUnreadContacts:')
      ) {
        localStorage.removeItem(key);
      }
    });

    alert('All your chats have been cleared for you. Other people still have theirs.');
    location.reload();
  } catch (err) {
    alert('Could not reach the server. Please try again later.');
    clearBtn.style.pointerEvents = '';
    clearBtn.style.opacity = '';
  }
};
