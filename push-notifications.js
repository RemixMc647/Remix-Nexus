/*==============================
REMIX-NEXUS — PUSH NOTIFICATION REGISTRATION (Android app only)
Include this on any page after auth.js, e.g.:
  <script src="./push-notifications.js"></script>

Does nothing at all in a regular browser tab — it only activates when
running inside the Capacitor-wrapped Android app, where
window.Capacitor.Plugins.PushNotifications is available.
==============================*/

(function () {
  const API_BASE = 'https://remix-nexus-production.up.railway.app'; // update this alongside Chat.js/Contacts.js when you switch hosts

  function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications);
  }

  async function sendTokenToServer(token) {
    if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) return;
    try {
      await fetch(API_BASE + '/api/push-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH.getToken() },
        body: JSON.stringify({ token, platform: 'android' })
      });
    } catch (err) {
      console.error('Could not register push token:', err);
    }
  }

  async function initPush() {
    if (!isNativeApp()) return; // running in a normal browser — nothing to do
    if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) return; // only register once logged in

    const { PushNotifications } = window.Capacitor.Plugins;

    try {
      const permStatus = await PushNotifications.checkPermissions();
      let granted = permStatus.receive === 'granted';

      if (!granted) {
        const requested = await PushNotifications.requestPermissions();
        granted = requested.receive === 'granted';
      }

      if (!granted) {
        console.log('Push permission not granted — notifications will stay off until the user enables them in Android settings.');
        return;
      }

      // Fires once Firebase hands back a device token — this is what the
      // server needs in order to target this specific device.
      PushNotifications.addListener('registration', (token) => {
        sendTokenToServer(token.value);
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('Push registration error:', err);
      });

      // App is open/foregrounded when the push arrives — Android won't show
      // its own banner in this case, so surface it via the existing
      // in-page Notification-style UI already used elsewhere, if you have
      // one. At minimum this keeps foreground behavior from going silent.
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push received while app open:', notification);
      });

      // User tapped the system notification — route them to the right
      // conversation. Chat.html and Contacts.html both read a `room`/`uid`
      // query param on load, so a simple redirect covers it.
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification.data || {};
        if (data.type === 'dm' && data.fromUserId) {
          window.location.href = './Contacts.html?uid=' + encodeURIComponent(data.fromUserId);
        } else if (data.type === 'room' && data.roomId) {
          window.location.href = './Chat.html?room=' + encodeURIComponent(data.roomId);
        }
      });

      await PushNotifications.register();
    } catch (err) {
      console.error('Push notification setup failed:', err);
    }
  }

  // AUTH's own load timing varies by page, so try shortly after the page
  // settles rather than racing it.
  window.addEventListener('load', () => setTimeout(initPush, 500));

  // Also unregister this device's token on logout, if auth.js exposes a
  // logout function — wrap it so existing logout buttons keep working
  // unchanged. Safe to skip if AUTH.logout doesn't exist.
  if (window.AUTH && typeof AUTH.logout === 'function') {
    const originalLogout = AUTH.logout.bind(AUTH);
    AUTH.logout = async function (...args) {
      if (isNativeApp()) {
        try {
          const { PushNotifications } = window.Capacitor.Plugins;
          // Capacitor doesn't expose the current token directly; re-registering
          // and reading it again here is the reliable way to get it for cleanup.
          PushNotifications.addListener('registration', async (token) => {
            try {
              await fetch(API_BASE + '/api/push-token', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH.getToken() },
                body: JSON.stringify({ token: token.value })
              });
            } catch (err) { /* not critical — token just goes stale and gets pruned server-side */ }
          });
        } catch (err) { /* not critical */ }
      }
      return originalLogout(...args);
    };
  }
})();
