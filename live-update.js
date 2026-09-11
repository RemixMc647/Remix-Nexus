// www/js/live-update.js
//
// Runs ONLY inside the native Android app (skips itself entirely on the
// website). On launch, and every few hours after that, it asks the server
// "is there a newer web bundle than what I'm running?" — if yes, it
// downloads it, sets it as the next bundle, and reloads. No Play Store
// visit, no Android Studio rebuild needed for web-layer changes.
//
// Pair this with server.js's /api/app-update/version + /download/bundle
// routes, and `npm run bundle:build` to publish a new version.
(function () {
  var Capacitor = window.Capacitor;
  if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) {
    return; // website — nothing to do here
  }

  var LiveUpdate = Capacitor.Plugins && Capacitor.Plugins.LiveUpdate;
  if (!LiveUpdate) {
    console.warn('[live-update] LiveUpdate plugin not found on this build — did you run `npx cap sync` after installing it?');
    return;
  }

  // Same backend the rest of the app already talks to. Change this if
  // your Render URL is different from what's baked into your other
  // API calls (Chat.js / Contacts.js etc.).
  var VERSION_URL = 'https://remix-nexus.onrender.com/api/app-update/version';

  // How often to re-check while the app stays open in the background.
  var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

  function checkForUpdate() {
    LiveUpdate.getCurrentBundle()
      .then(function (current) {
        return fetch(VERSION_URL, { cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) throw new Error('version check returned ' + res.status);
            return res.json();
          })
          .then(function (latest) {
            if (!latest.bundleId || latest.bundleId === current.bundleId) {
              return; // already up to date
            }
            console.log('[live-update] New bundle ' + latest.bundleId + ' found (current: ' + (current.bundleId || 'default') + ') — downloading…');
            return LiveUpdate.downloadBundle({ bundleId: latest.bundleId, url: latest.url })
              .then(function () {
                return LiveUpdate.setNextBundle({ bundleId: latest.bundleId });
              })
              .then(function () {
                console.log('[live-update] Applying update now.');
                return LiveUpdate.reload();
              });
          });
      })
      .catch(function (err) {
        // Offline, server unreachable, or nothing published yet — all
        // fine, just try again on the next interval.
        console.warn('[live-update] Update check skipped:', err.message);
      });
  }

  // Give the app a few seconds to finish its own startup first, then check.
  setTimeout(checkForUpdate, 3000);
  setInterval(checkForUpdate, CHECK_INTERVAL_MS);
})();
