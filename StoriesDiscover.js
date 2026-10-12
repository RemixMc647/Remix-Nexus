/* =====================================================================
   REMIX NEXUS — STORIES PAGE: "Nexus Worlds" Discover section
   Snapchat-Discover style SIDE section — these posts are NOT anyone's
   personal story. They come from Nexus Realm (photos / videos up to 1
   minute) and disappear after 24 hours.
   Separate file on purpose: Stories.js is not touched.
   ===================================================================== */
(function () {
  'use strict';

  var API = String((typeof BACKEND_URL !== 'undefined' && BACKEND_URL) || 'https://remix-nexus-bgz9.onrender.com').replace(/\/+$/, '');
  var worlds = [];
  var section, rail, lightbox;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function src(w) {
    var s = String((w && w.mediaSrc) || '');
    return s.charAt(0) === '/' ? API + s : s;
  }
  function timeLeft(expiresAt) {
    var ms = new Date(expiresAt).getTime() - Date.now();
    if (!isFinite(ms)) return '';
    if (ms <= 0) return 'expiring';
    var mins = Math.ceil(ms / 60000), h = Math.floor(mins / 60), m = mins % 60;
    return h > 0 ? h + 'h left' : Math.max(1, m) + 'm left';
  }
  function fmtDur(sec) {
    sec = Math.round(Number(sec) || 0);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  /* ---------- build the section once ---------- */
  function build() {
    var wall = document.getElementById('storyWall');
    if (!wall || !wall.parentNode || document.getElementById('nxDiscover')) return false;

    section = document.createElement('section');
    section.id = 'nxDiscover';
    section.className = 'nxd';
    section.innerHTML =
      '<div class="nxd-head">' +
        '<div class="nxd-title"><span class="nxd-ico">🌌</span><div>' +
          '<h3>Nexus Worlds</h3><p>Discover · from Nexus Realm · gone in 24h</p></div></div>' +
        '<div class="nxd-actions">' +
          '<a class="nxd-pill" href="./NexusRealm.html#worlds">Open Realm ↗</a>' +
          '<a class="nxd-pill primary" href="./NexusRealm.html#worlds">＋ Post</a>' +
        '</div>' +
      '</div>' +
      '<div class="nxd-rail" id="nxdRail"></div>';
    wall.parentNode.insertBefore(section, wall);
    rail = document.getElementById('nxdRail');

    lightbox = document.createElement('div');
    lightbox.id = 'nxdLightbox';
    lightbox.className = 'nxd-lightbox';
    lightbox.hidden = true;
    lightbox.innerHTML =
      '<div class="nxd-lb-card" role="dialog" aria-modal="true">' +
        '<button type="button" class="nxd-lb-close" aria-label="Close">✕</button>' +
        '<div class="nxd-lb-media" id="nxdLbMedia"></div>' +
        '<div class="nxd-lb-body">' +
          '<div class="nxd-lb-tags" id="nxdLbTags"></div>' +
          '<h3 id="nxdLbTitle"></h3>' +
          '<p id="nxdLbDesc" class="nxd-lb-desc"></p>' +
          '<p id="nxdLbMeta" class="nxd-lb-meta"></p>' +
          '<a id="nxdLbOpen" class="nxd-pill primary" href="#">Open in Nexus Realm ↗</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(lightbox);

    rail.addEventListener('click', function (e) {
      var card = e.target.closest('[data-id]');
      if (!card) return;
      var w = worlds.filter(function (x) { return String(x._id) === card.getAttribute('data-id'); })[0];
      if (w) openLightbox(w);
    });
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox || e.target.closest('.nxd-lb-close')) closeLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
    });
    return true;
  }

  /* ---------- render the rail ---------- */
  function render() {
    if (!rail) return;
    if (!worlds.length) {
      rail.innerHTML = '<div class="nxd-empty">🌌 No Nexus Worlds right now. Post a photo or a video in <a href="./NexusRealm.html#worlds">Nexus Realm</a> — it shows here for 24 hours.</div>';
      return;
    }
    rail.innerHTML = worlds.map(function (w) {
      var s = src(w);
      var thumb = '';
      if (s && w.mediaType === 'video') {
        thumb = '<video class="nxd-thumb" muted playsinline preload="metadata" src="' + esc(s) + '#t=0.1"></video>' +
                '<span class="nxd-play">▶ ' + esc(fmtDur(w.mediaDuration)) + '</span>';
      } else if (s) {
        thumb = '<img class="nxd-thumb" loading="lazy" alt="" src="' + esc(s) + '">';
      } else {
        thumb = '<div class="nxd-thumb nxd-nothumb">🌌</div>';
      }
      return '<button type="button" class="nxd-card" data-id="' + esc(w._id) + '">' +
        thumb +
        '<span class="nxd-game">' + esc(w.game) + '</span>' +
        '<span class="nxd-left">⏳ ' + esc(timeLeft(w.expiresAt)) + '</span>' +
        '<span class="nxd-info"><strong>' + esc(w.title) + '</strong><em>by ' + esc(w.creatorName || 'Nexus player') + '</em></span>' +
      '</button>';
    }).join('');
    Array.prototype.forEach.call(rail.querySelectorAll('img.nxd-thumb'), function (img) {
      img.addEventListener('error', function () { img.outerHTML = '<div class="nxd-thumb nxd-nothumb">🌌</div>'; });
    });
  }

  /* ---------- lightbox ---------- */
  function openLightbox(w) {
    var s = src(w);
    var media = document.getElementById('nxdLbMedia');
    media.innerHTML = !s ? '<div class="nxd-nothumb big">🌌</div>'
      : (w.mediaType === 'video'
          ? '<video controls autoplay playsinline src="' + esc(s) + '"></video>'
          : '<img alt="" src="' + esc(s) + '">');
    document.getElementById('nxdLbTags').innerHTML =
      '<span>' + esc(w.game) + '</span><span>' + esc(w.category || '') + '</span><span class="warm">⏳ ' + esc(timeLeft(w.expiresAt)) + '</span>';
    document.getElementById('nxdLbTitle').textContent = w.title || '';
    document.getElementById('nxdLbDesc').textContent = w.description || '';
    document.getElementById('nxdLbMeta').textContent = 'Shared by ' + (w.creatorName || 'Nexus player');
    document.getElementById('nxdLbOpen').href = './NexusRealm.html?world=' + encodeURIComponent(w._id) + '#worlds';
    lightbox.hidden = false;
    document.body.classList.add('nxd-lock');
  }
  function closeLightbox() {
    lightbox.hidden = true;
    document.getElementById('nxdLbMedia').innerHTML = '';   // stops video playback
    document.body.classList.remove('nxd-lock');
  }

  /* ---------- load (public — no login needed) ---------- */
  function load() {
    return fetch(API + '/api/realm/worlds')
      .then(function (r) { return r.ok ? r.json() : { worlds: [] }; })
      .then(function (d) { worlds = (d && d.worlds) || []; render(); })
      .catch(function () { if (!worlds.length) render(); });
  }

  function init() {
    if (!build()) return;
    rail.innerHTML = '<div class="nxd-empty">Loading Nexus Worlds…</div>';
    load();
    setInterval(function () { if (!document.hidden) load(); }, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
