/*==============================
REMIX-NEXUS — BACKGROUND CHAT NOTIFICATIONS (Android)
Starts/stops the native foreground service that keeps a socket
connection alive and shows notifications while the app is
backgrounded, without Firebase/FCM.

Include this AFTER config.js, rooms.js, and auth.js on any page,
or just once in a shared layout. Safe to call on non-Android
platforms — it just does nothing there.
==============================*/

function isNativeAndroidApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
    && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'android');
}

async function startChatNotifications() {
  if (!isNativeAndroidApp()) return;
  if (!window.AUTH || !AUTH.getToken || !AUTH.getToken()) return; // guests don't get background notifications

  try {
    const { ChatNotifications } = Capacitor.Plugins;
    const user = AUTH.getUser();
    const rooms = (typeof DEFAULT_ROOMS !== 'undefined' ? DEFAULT_ROOMS : []).map(r => r.id);

    await ChatNotifications.start({
      backendUrl: BACKEND_URL,
      token: AUTH.getToken(),
      userId: user ? String(user.id) : null,
      rooms: JSON.stringify(rooms)
    });
  } catch (err) {
    console.error('Failed to start background chat notifications:', err);
  }
}

async function stopChatNotifications() {
  if (!isNativeAndroidApp()) return;
  try {
    const { ChatNotifications } = Capacitor.Plugins;
    await ChatNotifications.stop();
  } catch (err) {
    console.error('Failed to stop background chat notifications:', err);
  }
}

// Start automatically once the page loads, if already logged in.
window.addEventListener('load', startChatNotifications);

// Call stopChatNotifications() from your logout button's click handler,
// e.g.: logoutBtn.addEventListener('click', () => { stopChatNotifications(); AUTH.logout(); });
