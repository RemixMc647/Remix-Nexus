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

document.getElementById('ringtoneSetting').onclick = () => {
  if (window.RemixCalls && typeof RemixCalls.openRingtoneSettings === 'function') {
    RemixCalls.openRingtoneSettings();
  } else {
    alert('Ringtone settings failed to load. Try refreshing the page.');
  }
};

document.getElementById('clearChats').onclick = async () => {
  if (!confirm(
    'Permanently delete all your chats? This deletes your room messages ' +
    'and your DM conversations from the server for everyone involved. ' +
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

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Could not clear chats. Please try again.');
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

    alert('All your chats have been permanently deleted.');
    location.reload();
  } catch (err) {
    alert('Could not reach the server. Please try again later.');
    clearBtn.style.pointerEvents = '';
    clearBtn.style.opacity = '';
  }
};

// ================================================================
// NEW: WhatsApp & Snapchat Feature Settings Handlers
// ================================================================

const API_BASE = 'https://remix-nexus-bgz9.onrender.com';
let userState = null;

// Load user state (pinned, muted, archived, darkMode, etc.)
async function loadUserState() {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me/state', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) return;
    userState = await res.json();
    applyDarkModeUI();
  } catch (err) {
    console.error('Could not load user state:', err);
  }
}

// Dark Mode toggle
function applyDarkModeUI() {
  const toggle = document.getElementById('darkModeToggle');
  if (!toggle) return;
  const isDark = userState && userState.darkMode;
  toggle.textContent = isDark ? '✅' : '⬜';
  // Apply dark mode to the settings page if needed
  document.body.classList.toggle('dark-mode', !!isDark);
}

document.getElementById('darkModeSetting').onclick = async () => {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  const newState = !(userState && userState.darkMode);
  try {
    const res = await fetch(API_BASE + '/api/me/dark-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ enabled: newState })
    });
    if (!res.ok) return;
    userState = userState || {};
    userState.darkMode = newState;
    applyDarkModeUI();
    // Store in localStorage for cross-page sync
    localStorage.setItem('remix-nexusDarkMode', newState ? '1' : '0');
  } catch (err) {
    console.error('Dark mode toggle error:', err);
  }
};

// Starred Messages — opens a modal showing all starred messages
document.getElementById('starredMessagesSetting').onclick = async () => {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) { alert('Log in to see your starred messages.'); return; }
  try {
    const res = await fetch(API_BASE + '/api/me/starred', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) { alert('Could not load starred messages.'); return; }
    const data = await res.json();
    const msgs = data.messages || [];
    if (!msgs.length) { alert('No starred messages yet. Tap the ⭐ on any message to star it.'); return; }

    let list = msgs.map(m => {
      const text = m.text || (m.media ? (m.media.type === 'video' ? '🎬 Video' : '🖼️ Photo') : m.audio ? '🎤 Voice note' : '');
      const type = m.type === 'dm' ? 'DM' : 'Room';
      const room = m.room || '';
      return `• [${type}] ${room ? room + ': ' : ''}${text.slice(0, 80)}`;
    }).join('\n');
    alert('⭐ Starred Messages:\n\n' + list);
  } catch (err) {
    alert('Could not load starred messages.');
  }
};

// Archived Chats — prompts to unarchive a chat
document.getElementById('archivedChatsSetting').onclick = async () => {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) { alert('Log in to manage archived chats.'); return; }
  try {
    const res = await fetch(API_BASE + '/api/me/state', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) { alert('Could not load archived chats.'); return; }
    const state = await res.json();
    const archived = state.archivedChats || [];
    if (!archived.length) { alert('No archived chats.'); return; }
    const list = archived.map((id, i) => `${i + 1}. ${id}`).join('\n');
    const choice = prompt('📦 Archived Chats:\n\n' + list + '\n\nEnter the number to unarchive, or leave blank to cancel.');
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= archived.length) { alert('Invalid selection.'); return; }
    const chatId = archived[idx];
    const archRes = await fetch(API_BASE + '/api/me/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ id: chatId })
    });
    if (!archRes.ok) { alert('Could not unarchive.'); return; }
    alert('Chat unarchived!');
  } catch (err) {
    alert('Could not load archived chats.');
  }
};

// Muted Chats — prompts to unmute a chat
document.getElementById('mutedChatsSetting').onclick = async () => {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) { alert('Log in to manage muted chats.'); return; }
  try {
    const res = await fetch(API_BASE + '/api/me/state', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) { alert('Could not load muted chats.'); return; }
    const state = await res.json();
    const muted = state.mutedChats || [];
    if (!muted.length) { alert('No muted chats.'); return; }
    const list = muted.map((id, i) => `${i + 1}. ${id}`).join('\n');
    const choice = prompt('🔇 Muted Chats:\n\n' + list + '\n\nEnter the number to unmute, or leave blank to cancel.');
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= muted.length) { alert('Invalid selection.'); return; }
    const chatId = muted[idx];
    const muteRes = await fetch(API_BASE + '/api/me/mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ id: chatId })
    });
    if (!muteRes.ok) { alert('Could not unmute.'); return; }
    alert('Chat unmuted!');
  } catch (err) {
    alert('Could not load muted chats.');
  }
};

// Export Chat — prompts for a user ID or room ID to export
document.getElementById('exportChatSetting').onclick = async () => {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) { alert('Log in to export chats.'); return; }

  const type = prompt('Export:\n1. DM conversation\n2. Room chat\n\nEnter 1 or 2:');
  if (!type) return;

  if (type === '1') {
    const userId = prompt('Enter the user ID of the contact to export:');
    if (!userId) return;
    window.open(API_BASE + '/api/me/export/' + encodeURIComponent(userId) + '?token=' + encodeURIComponent(token), '_blank');
  } else if (type === '2') {
    const roomId = prompt('Enter the room ID to export:');
    if (!roomId) return;
    window.open(API_BASE + '/api/me/export/room/' + encodeURIComponent(roomId) + '?token=' + encodeURIComponent(token), '_blank');
  } else {
    alert('Invalid choice.');
  }
};

// Load state on page load
loadUserState();
