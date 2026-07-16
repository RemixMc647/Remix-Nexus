document.getElementById("logoutBtn").onclick=()=>{

if(confirm("Logout of Remix Nexus?")){

AUTH.logout();

location.href="index.html";

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
    const res = await fetch('https://remix-nexus-production.up.railway.app/api/me/chats', {
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