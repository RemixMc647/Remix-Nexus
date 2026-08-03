/*==============================
REMIX-NEXUS — PUSH NOTIFICATION REGISTRATION (Android app only)
Include this on any page after auth.js, e.g.:
  <script src="./push-notifications.js"></script>

Does nothing at all in a regular browser tab — it only activates when
running inside the Capacitor-wrapped Android app, where
window.Capacitor.Plugins.PushNotifications is available.
==============================*/

(function () {
  const API_BASE = 'https://remix-nexus-bgz9.onrender.com'; // update this alongside Chat.js/Contacts.js when you switch hosts

  function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications);
  }

  // Cached the moment 'registration' fires (see initPush below) — this is
  // what lets logout clean up the token without needing to re-register,
  // which Capacitor doesn't support anyway (there's no "get current token").
  let cachedToken = null;

  async function sendTokenToServer(token) {
    if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) {
      console.warn('[push] Got an FCM token but AUTH says not logged in — token NOT sent to server.');
      return;
    }
    try {
      const res = await fetch(API_BASE + '/api/push-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH.getToken() },
        body: JSON.stringify({ token, platform: 'android' })
      });
      if (!res.ok) {
        console.error('[push] Server rejected push-token save, status:', res.status, await res.text().catch(() => ''));
      } else {
        console.log('[push] Device token saved to server OK.');
      }
    } catch (err) {
      console.error('[push] Could not register push token (network error):', err);
    }
  }

  async function initPush() {
    if (!isNativeApp()) {
      console.warn('[push] window.Capacitor.Plugins.PushNotifications not found — either this isn\'t the native app, or @capacitor/push-notifications isn\'t installed/synced into the Android project.');
      return;
    }
    if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) {
      console.log('[push] Not logged in yet — will not register for push until login.');
      return;
    }

    const { PushNotifications } = window.Capacitor.Plugins;

    try {
      const permStatus = await PushNotifications.checkPermissions();
      let granted = permStatus.receive === 'granted';

      if (!granted) {
        const requested = await PushNotifications.requestPermissions();
        granted = requested.receive === 'granted';
      }

      if (!granted) {
        console.warn('[push] Push permission NOT granted — notifications stay off until enabled in Android settings. (Android 13+ also needs POST_NOTIFICATIONS declared in the manifest.)');
        return;
      }

      // Fires once Firebase hands back a device token — this is what the
      // server needs in order to target this specific device.
      PushNotifications.addListener('registration', (token) => {
        console.log('[push] FCM registration token received, length:', token.value ? token.value.length : 0);
        cachedToken = token.value;
        sendTokenToServer(token.value);
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('[push] Push registration error (this is why no token ever gets saved):', err);
      });

      // App is open/foregrounded when the push arrives — Android won't show
      // its own banner in this case, so surface it via the existing
      // in-page Notification-style UI already used elsewhere, if you have
      // one. At minimum this keeps foreground behavior from going silent.
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[push] Push received while app open:', notification);
      });

      // User tapped the system notification — route them to the right
      // conversation. Chat.html and Contacts.html both read a `room`/`uid`
      // query param on load, so a simple redirect covers it.
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification.data || {};
        if (data.type === 'call' && data.fromUserId) {
          // The original call:invite socket event is long gone by the time a
          // killed app relaunches, so we can't auto-resume the call — but we
          // can drop the user straight into a callback with that person.
          window.location.href = './Contacts.html?uid=' + encodeURIComponent(data.fromUserId) + '&callback=' + encodeURIComponent(data.callId || '');
        } else if (data.type === 'groupcall' && data.fromUserId) {
          // Same idea as a missed 1:1 call — the original invite is gone by
          // relaunch, so land them on the caller's conversation rather than
          // trying to silently rejoin a group call that may have ended.
          window.location.href = './Contacts.html?uid=' + encodeURIComponent(data.fromUserId) + '&callback=' + encodeURIComponent(data.callId || '');
        } else if (data.type === 'dm' && data.fromUserId) {
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
    AUTH.logout = function (...args) {
      // Fire-and-forget on purpose: Settings.js/Profile.js call AUTH.logout()
      // without awaiting it and redirect immediately afterward, so this has
      // to survive page navigation on its own — that's what `keepalive`
      // does (it tells the browser to finish the request even after the
      // page that started it is gone). Using the token cached from the
      // 'registration' listener above instead of re-registering, since
      // Capacitor has no "get current token" call to re-fetch it with.
      if (isNativeApp() && cachedToken && window.AUTH && AUTH.getToken && AUTH.getToken()) {
        try {
          fetch(API_BASE + '/api/push-token', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH.getToken() },
            body: JSON.stringify({ token: cachedToken }),
            keepalive: true
          }).catch(() => {}); // not critical — token just goes stale and gets pruned server-side
        } catch (err) { /* not critical */ }
      }
      return originalLogout(...args);
    };
  }
})();
