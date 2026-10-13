/* REMIX NEXUS — SAFE AREA FALLBACK
   Add near the end of every page:  <script src="./safe-area.js"></script>

   Why: on some Android phones/WebViews, env(safe-area-inset-top) reports 0
   even though the status bar (clock, battery, wifi) is drawn on top of the
   page. This script:
     1) tells the Capacitor app NOT to draw the page under the status bar,
     2) measures what the phone really reports and, only if it is 0 while
        the page is clearly running full-screen inside the native app,
        adds a safe default so nothing collides.
*/
(function () {
  var root = document.documentElement;
  var cap = window.Capacitor;
  var isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

  // 1) Native app: ask for a normal (non-overlay) status bar.
  try {
    var SB = cap && cap.Plugins && cap.Plugins.StatusBar;
    if (isNative && SB) {
      SB.setOverlaysWebView({ overlay: false });
      SB.setBackgroundColor({ color: '#000000' });
      SB.setStyle({ style: 'DARK' }); // light icons on a dark bar
    }
  } catch (e) { /* plugin not installed — CSS fallback below still works */ }

  // 2) Measure the real inset the browser gives us.
  function measure() {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
    var h = probe.getBoundingClientRect().height;
    probe.remove();
    return h;
  }

  function apply() {
    var reported = measure();
    var extra = 0;

    // Native app, status bar plugin missing, and env() still says 0:
    // the page is almost certainly drawn under the status bar, so use a
    // default of 28px (a normal Android status bar is ~24dp; 28 also
    // clears most punch-hole cameras). Normal browsers never hit this.
    var SB = cap && cap.Plugins && cap.Plugins.StatusBar;
    if (isNative && !SB && reported === 0) extra = 28;

    root.style.setProperty('--safe-top-extra', extra + 'px');
  }

  if (document.body) apply(); else document.addEventListener('DOMContentLoaded', apply);
  window.addEventListener('orientationchange', function () { setTimeout(apply, 300); });
  window.addEventListener('resize', apply);
})();
