/*
 * Remix Nexus loader — website-side loading overlay.
 * Add this script early in <head> so it can cover the page while it loads.
 * This is a visual loading indicator, not a measurement of actual network progress.
 */
(function () {
  if (window.__REMIX_NEXUS_LOADER_INSTALLED__) return;
  window.__REMIX_NEXUS_LOADER_INSTALLED__ = true;

  var startTime = Date.now();
  var MINIMUM_DISPLAY_MS = 1050;
  var finished = false;
  var progress = 6;
  var timer = null;
  var statusIndex = 0;
  var statusLines = ["Connecting to the Nexus", "Loading your realm", "Preparing your experience"];

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
        '<h1 class="rnxl-wordmark">REMIX <span class="rnxl-accent">NEXUS</span></h1>' +
        '<div class="rnxl-tagline">Enter another level</div>' +
        '<div class="rnxl-status" id="rnxl-status-text">Connecting to the Nexus</div>' +
        '<div class="rnxl-track" aria-hidden="true"><div class="rnxl-progress" id="rnxl-progress"></div></div>' +
        '<div class="rnxl-percent"><span>INITIALIZING</span><strong id="rnxl-percent-text">6%</strong></div>' +
      '</div>' +
      '<div class="rnxl-footer">A WORLD BUILT BY PLAYERS</div>';
    document.documentElement.appendChild(root);

    var particleHost = root.querySelector(".rnxl-particles");
    for (var i = 0; i < 34; i++) {
      var p = document.createElement("i");
      p.className = "rnxl-particle";
      p.style.left = (Math.random() * 100) + "%";
      p.style.top = (Math.random() * 100) + "%";
      p.style.setProperty("--duration", (4 + Math.random() * 7) + "s");
      p.style.setProperty("--delay", (-Math.random() * 8) + "s");
      if (i % 4 === 0) {
        p.style.width = "2px";
        p.style.height = "2px";
      }
      particleHost.appendChild(p);
    }
  }

  function updateProgress(value) {
    progress = Math.max(progress, Math.min(94, value));
    var bar = document.getElementById("rnxl-progress");
    var label = document.getElementById("rnxl-percent-text");
    if (bar) bar.style.width = progress + "%";
    if (label) label.textContent = Math.round(progress) + "%";
  }

  function hideLoader() {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    var remaining = Math.max(0, MINIMUM_DISPLAY_MS - (Date.now() - startTime));
    window.setTimeout(function () {
      updateProgress(100);
      var label = document.getElementById("rnxl-percent-text");
      var status = document.getElementById("rnxl-status-text");
      if (label) label.textContent = "100%";
      if (status) status.textContent = "Welcome to Remix Nexus";
      window.setTimeout(function () {
        var root = document.getElementById("remix-nexus-loader");
        if (!root) return;
        root.classList.add("rnxl-hidden");
        window.setTimeout(function () {
          if (root.parentNode) root.parentNode.removeChild(root);
        }, 650);
      }, 180);
    }, remaining);
  }

  function boot() {
    createLoader();
    timer = window.setInterval(function () {
      if (finished) return;
      if (progress < 88) updateProgress(progress + Math.max(1, (88 - progress) * 0.075));
      if (progress > 35 && statusIndex === 0) {
        statusIndex = 1;
        var status = document.getElementById("rnxl-status-text");
        if (status) status.textContent = statusLines[statusIndex];
      } else if (progress > 68 && statusIndex === 1) {
        statusIndex = 2;
        var status2 = document.getElementById("rnxl-status-text");
        if (status2) status2.textContent = statusLines[statusIndex];
      }
    }, 140);

    if (document.readyState === "complete") {
      window.setTimeout(hideLoader, 120);
    } else {
      window.addEventListener("load", hideLoader, { once: true });
    }

    // Safety fallback so a failed third-party resource cannot trap the user forever.
    window.setTimeout(hideLoader, 12000);
  }

  // If script is placed in <head>, render immediately; otherwise still show on next task.
  if (document.documentElement) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
