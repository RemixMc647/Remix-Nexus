document.getElementById("logoutBtn").onclick=()=>{

if(confirm("Logout of Remix Nexus?")){

AUTH.logout();

location.href="index.html";

}

};

document.getElementById('clearChats').onclick = () => {
  if (!confirm('Clear all chats on this device? This will not delete messages for other users.')) {
    return;
  }

  Object.keys(localStorage).forEach(key => {
    // Room chats — both the regular browser cache and the native-app
    // (Capacitor) backup copy, so this actually clears everything on
    // the Android app too, not just the web cache.
    if (key.startsWith('remix-nexusMessages:') || key.startsWith('app-chat-backup:')) {
      localStorage.removeItem(key);
    }

    // DM chats (kept for forward-compatibility, though DMs currently
    // load fresh from the server each time rather than being cached).
    if (key.startsWith('remix-nexusDM')) {
      localStorage.removeItem(key);
    }

    // Unread counters
    if (key.startsWith('remix-nexusUnreadRooms:') ||
        key.startsWith('remix-nexusUnreadContacts:')) {
      localStorage.removeItem(key);
    }
  });

  alert('All local chats have been cleared.');
  location.reload();
};