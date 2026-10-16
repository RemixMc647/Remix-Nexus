/* Remix Nexus — animated startup screen.
 * Shows ONCE per app launch: when the app is opened fresh (not already
 * running in the background). Moving between pages, or coming back to the
 * app from the background, does not show it again.
 *
 * How "once per launch" works: sessionStorage lives as long as the app's
 * WebView / browser tab lives. If the app is closed completely, the next
 * open starts a new session and the screen shows again.
 *
 * This is an animated visual indicator, not actual network-download progress.
 */
(function () {
  if (window.__REMIX_NEXUS_LOADER_INSTALLED__) return;
  window.__REMIX_NEXUS_LOADER_INSTALLED__ = true;

  // ---- show only once per launch -------------------------------------
  var SEEN_KEY = "remixNexusLoaderSeen";
  try {
    if (window.sessionStorage.getItem(SEEN_KEY) === "1") return; // already shown this launch
    window.sessionStorage.setItem(SEEN_KEY, "1");
  } catch (e) {
    // Storage blocked (e.g. some private modes): fall through and show it.
  }

  var startTime = Date.now();
  var TARGET_DISPLAY_MS = 8000;      // how long the screen stays up (change this to shorten it)
  var MAX_WAIT_FALLBACK_MS = 10000;  // never trap users if "load" never fires
  var closing = false;
  var timer = null;
  var statusIndex = -1;
  var statusLines = [
    "Connecting to the Nexus",
    "Loading your realm",
    "Preparing your experience"
  ];

  function createLoader() {
    if (document.getElementById("remix-nexus-loader")) return;
    var root = document.createElement("div");
    root.id = "remix-nexus-loader";
    root.setAttribute("role", "status");
    root.setAttribute("aria-label", "Loading Remix Nexus");
    root.innerHTML =
      '<div class="rnxl-grid" aria-hidden="true"></div>' +
      '<div class="rnxl-orb" aria-hidden="true"></div>' +
      '<div class="rnxl-particles" aria-hidden="true"></div>' +
      '<div class="rnxl-content">' +
        '<div class="rnxl-emblem" aria-hidden="true"><span>RN</span></div>' +
        // div, not h1: the page has its own h1 and this one disappears anyway
        '<div class="rnxl-wordmark">REMIX <span class="rnxl-accent">NEXUS</span></div>' +
        '<div class="rnxl-tagline">Enter another level</div>' +
        '<div class="rnxl-status" id="rnxl-status-text">Connecting to the Nexus</div>' +
        '<div class="rnxl-track" aria-hidden="true"><div class="rnxl-progress" id="rnxl-progress"></div></div>' +
        '<div class="rnxl-percent"><span>INITIALIZING</span><strong id="rnxl-percent-text">6%</strong></div>' +
      '</div>' +
      '<div class="rnxl-footer">A WORLD BUILT BY PLAYERS</div>';
    document.documentElement.appendChild(root);

    var particleHost = root.querySelector(".rnxl-particles");
    for (var i = 0; i < 34; i++) {
      var particle = document.createElement("i");
      particle.className = "rnxl-particle";
      particle.style.left = (Math.random() * 100) + "%";
      particle.style.top = (Math.random() * 100) + "%";
      particle.style.setProperty("--duration", (4 + Math.random() * 7) + "s");
      particle.style.setProperty("--delay", (-Math.random() * 8) + "s");
      if (i % 4 === 0) {
        particle.style.width = "2px";
        particle.style.height = "2px";
      }
      particleHost.appendChild(particle);
    }
  }

  function updateProgress(value) {
    var safeValue = Math.max(6, Math.min(100, value));
    var bar = document.getElementById("rnxl-progress");
    var label = document.getElementById("rnxl-percent-text");
    if (bar) bar.style.width = safeValue + "%";
    if (label) label.textContent = Math.round(safeValue) + "%";
  }

  function setStatus(index) {
    if (index === statusIndex || !statusLines[index]) return;
    statusIndex = index;
    var status = document.getElementById("rnxl-status-text");
    if (status) status.textContent = statusLines[index];
  }

  function hideLoader() {
    if (closing) return;
    closing = true;
    // The progress timer keeps running while we wait out the remaining
    // display time, so the bar never freezes. It stops at the very end.
    var remaining = Math.max(0, TARGET_DISPLAY_MS - (Date.now() - startTime));
    window.setTimeout(function () {
      if (timer) window.clearInterval(timer);
      updateProgress(100);
      var status = document.getElementById("rnxl-status-text");
      if (status) status.textContent = "Welcome to Remix Nexus";
      window.setTimeout(function () {
        var root = document.getElementById("remix-nexus-loader");
        if (!root) return;
        root.classList.add("rnxl-hidden");
        window.setTimeout(function () {
          if (root.parentNode) root.parentNode.removeChild(root);
        }, 700);
      }, 220);
    }, remaining);
  }

  function boot() {
    createLoader();
    timer = window.setInterval(function () {
      var elapsed = Date.now() - startTime;
      var fraction = Math.min(1, elapsed / TARGET_DISPLAY_MS);
      updateProgress(6 + fraction * 88);
      if (elapsed >= 2400 && elapsed < 5000) setStatus(1);
      else if (elapsed >= 5000) setStatus(2);
    }, 100);

    if (document.readyState === "complete") {
      window.setTimeout(hideLoader, 0);
    } else {
      window.addEventListener("load", hideLoader, { once: true });
    }

    // Keep the overlay from trapping users if a resource prevents the load event.
    window.setTimeout(hideLoader, MAX_WAIT_FALLBACK_MS);
  }

  if (document.documentElement) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
