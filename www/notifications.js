/*==============================
REMIX-NEXUS — SITE-WIDE NOTIFICATIONS

Why this file exists: Chat.js and Contacts.js only run while someone is
actually on Chat.html or Contacts.html. That means, before this file
existed, a message sent to someone browsing GamingHome.html, Trending.html,
Profile.html, etc. would never reach them at all — no socket connection,
no notification, nothing — because the only script that knew how to
listen for it wasn't loaded on that page.

This script is meant to be included on every page of the site (it's
harmless to include it on Chat.html/Contacts.html too — it detects those
pages and does nothing there, since Chat.js/Contacts.js already handle
notifications for themselves while you're actually looking at them).

It opens a lightweight background socket connection, subscribes to every
room and to your own DM channel, and fires a desktop notification for any
message that isn't yours, whenever this tab isn't actually in the
foreground — same trigger WhatsApp Web uses.

IMPORTANT LIMITATION: this (like any browser-based notification) only
works while this tab is still open somewhere — even just in the
background. If the browser is fully closed, no JavaScript on the page can
run, so nothing can notify you. Catching that case requires real Web Push
(a service worker + push subscriptions + a server that can wake a closed
browser), which is a separate, bigger feature — ask if you want that built.
==============================*/

(function () {
  // Chat.js / Contacts.js already handle notifications for their own
  // pages — don't double up (and don't open a second socket) there.
  if (document.getElementById('roomList') || document.getElementById('contactList')) return;

  if (!window.AUTH || !AUTH.isLoggedIn()) return;
  if (typeof BACKEND_URL === 'undefined') return; // config.js must load before this file

  function isAppInForeground(){
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  if ('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission().catch(() => {});
  }

  /*==============================
  REAL PUSH (works even with the app fully closed)
  ------------------------------
  Everything above (Web Notification API + this file's socket listeners)
  only fires while the app is open somewhere, even just backgrounded —
  there is no JavaScript running at all once the app is fully killed.
  Reaching the user in that case requires Firebase Cloud Messaging,
  wired up through the Capacitor Push Notifications plugin, which is
  what this block does. It's a no-op in a normal desktop browser —
  window.Capacitor only exists inside the native app.
  ==============================*/
  function setupNativePush(){
    if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) return;
    const PushNotifications = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
    if (!PushNotifications) return; // plugin not installed yet

    PushNotifications.requestPermissions().then((result) => {
      if (result.receive !== 'granted') return;
      PushNotifications.register();
    }).catch((err) => console.error('Push permission error:', err));

    // Firebase handed us a device token — tell the backend so it knows
    // where to send this user's pushes.
    PushNotifications.addListener('registration', (token) => {
      fetch(BACKEND_URL + '/api/push-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + AUTH.getToken()
        },
        body: JSON.stringify({ token: token.value })
      }).catch((err) => console.error('Push token save error:', err));
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration error:', err);
    });

    // App was backgrounded/closed, a push arrived, and the user tapped
    // the system notification — this is what opens the right room or DM,
    // same as tapping a WhatsApp notification opens that exact chat.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = (action.notification && action.notification.data) || {};
      if (data.type === 'room' && data.room) {
        window.location.href = './Chat.html?room=' + encodeURIComponent(data.room);
      } else if (data.type === 'dm' && data.uid) {
        window.location.href = './Contacts.html?uid=' + encodeURIComponent(data.uid);
      }
    });
  }

  setupNativePush();

  function getUnreadRooms(){
    try { return JSON.parse(localStorage.getItem('remix-nexusUnreadRooms') || '{}'); } catch { return {}; }
  }
  function bumpUnreadRoom(roomId){
    const counts = getUnreadRooms();
    counts[roomId] = (counts[roomId] || 0) + 1;
    localStorage.setItem('remix-nexusUnreadRooms', JSON.stringify(counts));
  }

  function getUnreadContacts(){
    try { return JSON.parse(localStorage.getItem('remix-nexusUnreadContacts') || '{}'); } catch { return {}; }
  }
  function bumpUnreadContact(contactId){
    const counts = getUnreadContacts();
    counts[contactId] = (counts[contactId] || 0) + 1;
    localStorage.setItem('remix-nexusUnreadContacts', JSON.stringify(counts));
  }

  function showNotification(title, body, tag, destinationUrl){
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body, tag });
      n.onclick = () => {
        window.focus();
        window.location.href = destinationUrl;
        n.close();
      };
    } catch (err) {
      console.error('Notification error:', err);
    }
  }

  // Cache contact usernames so a DM notification can show a real name
  // instead of just an ID — Contacts.js already has this list loaded when
  // you're on that page, but other pages start with nothing.
  let contactsById = {};
  fetch(BACKEND_URL + '/api/contacts', { headers: { Authorization: 'Bearer ' + AUTH.getToken() } })
    .then((res) => res.json())
    .then((data) => {
      (data.contacts || []).forEach((c) => { contactsById[c.id] = c.username; });
    })
    .catch(() => {});

  function mediaPreview(payload){
    return payload.text
      || (payload.audio ? '🎤 Voice note' : (payload.media ? (payload.media.type === 'video' ? '🎬 Video' : '🖼️ Photo') : ''));
  }

  function boot(){
    const socket = io(BACKEND_URL, { auth: { token: AUTH.getToken() } });

    socket.on('connect', () => {
      // Subscribe to every known room so its messages reach this socket
      // too — chat:join only subscribes to whatever room you're actively
      // viewing, which is nothing at all on a non-chat page.
      if (typeof DEFAULT_ROOMS !== 'undefined'){
        socket.emit('chat:subscribeRooms', { rooms: DEFAULT_ROOMS.map((r) => r.id) });
      }
    });

    socket.on('chat:message', ({ room, message }) => {
      const me = AUTH.getUser();
      const isMine = me && message.authorId && String(message.authorId) === String(me.id);
      if (isMine) return;

      bumpUnreadRoom(room);

      if (isAppInForeground()) return; // only notify when this tab isn't actually in front

      const roomMeta = (typeof DEFAULT_ROOMS !== 'undefined') ? DEFAULT_ROOMS.find((r) => r.id === room) : null;
      const roomName = roomMeta ? roomMeta.name : 'a room';

      showNotification(
        `${message.author} — ${roomName}`,
        mediaPreview(message),
        'room:' + room,
        './Chat.html?room=' + encodeURIComponent(room)
      );
    });

    socket.on('dm:message', (payload) => {
      const me = AUTH.getUser();
      if (!me) return;

      const isMine = String(payload.fromUserId) === String(me.id);
      if (isMine) return;

      const otherId = String(payload.fromUserId);
      bumpUnreadContact(otherId);

      if (isAppInForeground()) return;

      showNotification(
        contactsById[otherId] || 'New message',
        mediaPreview(payload),
        'dm:' + otherId,
        './Contacts.html?uid=' + encodeURIComponent(otherId)
      );
    });
  }

  if (window.io){
    boot();
  } else {
    const script = document.createElement('script');
    script.src = BACKEND_URL + '/socket.io/socket.io.js';
    script.onload = boot;
    document.head.appendChild(script);
  }
})();