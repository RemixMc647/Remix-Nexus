/*==============================
REMIX-NEXUS — NATIVE CALL PUSH (runs only inside the Android app)
Add to your chat page(s) AFTER auth.js and BEFORE/AFTER Chat.js:
  <script src="call-native.js"></script>
Safe on the normal website: it does nothing outside the Capacitor app.
==============================*/
(function () {
  const Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;

  const { PushNotifications, App } = Cap.Plugins || {};
  if (!PushNotifications) return;

  // The app loads your live site, so same-origin is always the right server
  const API_BASE = window.location.origin;
  let lastToken = null;

  async function sendTokenToServer(token) {
    const auth = window.AUTH ? AUTH.getToken() : null;
    if (!auth || !token) return; // not logged in yet — sync() will retry later
    try {
      await fetch(API_BASE + '/api/push-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + auth
        },
        body: JSON.stringify({ token, platform: 'android' })
      });
    } catch (err) {
      console.warn('push token upload failed', err);
    }
  }

  async function initPush() {
    try {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;

      PushNotifications.addListener('registration', (t) => {
        lastToken = t.value;
        sendTokenToServer(lastToken);
      });
      PushNotifications.addListener('registrationError', (e) =>
        console.warn('push registration error', e)
      );

      await PushNotifications.register();
    } catch (err) {
      console.warn('push init failed', err);
    }
  }

  // Call this right after a successful login: window.RemixNativePush.sync()
  window.RemixNativePush = { sync: () => sendTokenToServer(lastToken) };

  // The user tapped the call notification (or the lock-screen call screen opened the app)
  function handleCallUrl(url) {
    if (!url || url.indexOf('remixnexus://call') !== 0) return;
    const u = new URL(url);
    const detail = {
      callId: u.searchParams.get('callId'),
      callerName: u.searchParams.get('callerName'),
      callType: u.searchParams.get('callType'),
      room: u.searchParams.get('room'),
      accept: u.searchParams.get('accept') === '1'
    };
    window.__pendingPushCall = detail;
    // Your calls.js should listen for this and show its Accept/Decline screen
    window.dispatchEvent(new CustomEvent('remix:push-call', { detail }));
  }

  if (App) {
    App.addListener('appUrlOpen', (e) => handleCallUrl(e.url));
    App.getLaunchUrl()
      .then((r) => r && handleCallUrl(r.url))
      .catch(() => {});
  }

  initPush();
})();
