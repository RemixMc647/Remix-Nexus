/* ==========================================================
   REMIX NEXUS — chat-style.js
   1) Gives every message bubble its grouped WhatsApp-style layout and
      a coloured sender line with the emoji icon.
   2) Clicking a name or emoji icon opens a profile card with the
      user's banner.
   Works on Chat.html and Contacts.html. Load it LAST, after Chat.js /
   Contacts.js. It doesn't edit those files — it enhances their output.
   ========================================================== */
(function () {
  'use strict';

  var BANNER_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;

  /* ---------- small helpers ---------- */
  function apiBase() {
    try { return API_BASE; } catch (e) { return 'https://remix-nexus-bgz9.onrender.com'; }
  }
  function token() {
    return window.AUTH && AUTH.getToken ? AUTH.getToken() : null;
  }
  function myId() {
    var u = window.AUTH && AUTH.getUser ? AUTH.getUser() : null;
    if (u && u.id) return String(u.id);
    try { if (typeof me !== 'undefined' && me && me.id) return String(me.id); } catch (e) {}
    return null;
  }
  function currentContact() {
    try { return typeof activeContact !== 'undefined' ? activeContact : null; } catch (e) { return null; }
  }
  function hueOf(s) {
    var h = 0, str = String(s || '');
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }
  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /* ==========================================================
     1) BUBBLES
     ========================================================== */
  function enhance(container, mode) {
    var items = Array.prototype.slice.call(
      container.querySelectorAll(mode === 'room' ? '.msg-row' : '.msg')
    );
    var prevKey = null;

    items.forEach(function (item) {
      var bubble = mode === 'room' ? item.querySelector('.msg') : item;
      if (!bubble) return;

      var own = bubble.classList.contains('me');
      var author = item.dataset.author || '';
      var key = (own ? 'me' : 'o') + '|' + author;
      var continued = key === prevKey;
      prevKey = key;

      bubble.classList.add('bx');
      bubble.classList.toggle('bx-tail', !continued);
      bubble.classList.toggle('bx-cont', continued);

      if (own) return;

      var head = bubble.querySelector('.msg-author');
      if (!head || head.dataset.bx) return;
      head.dataset.bx = '1';
      head.classList.add('bx-head');
      bubble.style.setProperty('--bx-name', 'hsl(' + hueOf(author) + ' 85% 72%)');

      if (mode === 'dm') {
        // DMs have no icon on the sender line yet — add it, and tell the
        // profile card who this is.
        var c = currentContact();
        if (c) {
          head.dataset.bxUid = String(c.id);
          head.dataset.bxName = c.username || '';
          head.dataset.bxAv = c.avatar || '';
        }
        var av = el('span', 'msg-av');
        av.textContent = (c && c.avatar) || author.charAt(0).toUpperCase() || '?';
        head.insertBefore(av, head.firstChild);
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
      }
    });
  }

  function watch(id, mode) {
    var box = document.getElementById(id);
    if (!box) return;
    var queued = false;
    function run() { queued = false; enhance(box, mode); }
    // Chat.js / Contacts.js rebuild the list with innerHTML, which is a
    // direct child change — so we only watch childList (no loops).
    new MutationObserver(function () {
      if (!queued) { queued = true; requestAnimationFrame(run); }
    }).observe(box, { childList: true });
    run();
  }

  /* ==========================================================
     2) PROFILE CARD
     ========================================================== */
  var cache = new Map(); // uid -> { t, user }

  function loadProfile(uid) {
    var hit = cache.get(uid);
    if (hit && Date.now() - hit.t < 60000) return Promise.resolve(hit.user);
    var t = token();
    if (!t) return Promise.resolve(null);
    return fetch(apiBase() + '/api/users/' + encodeURIComponent(uid), {
      headers: { Authorization: 'Bearer ' + t }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.user) return null;
        cache.set(uid, { t: Date.now(), user: d.user });
        return d.user;
      })
      .catch(function () { return null; });
  }

  function closeCard() {
    var old = document.getElementById('bxCard');
    if (old) old.remove();
  }

  function messageUser(p) {
    closeCard();
    var onContactsPage = !!document.getElementById('contacts-shell');
    if (onContactsPage && window.NexusProfileOptions &&
        typeof NexusProfileOptions.onMessage === 'function') {
      NexusProfileOptions.onMessage({ uid: p.uid, name: p.name, avatar: p.avatar });
      return;
    }
    var url = new URL('./Contacts.html', window.location.href);
    url.searchParams.set('uid', p.uid);
    if (p.name) url.searchParams.set('username', p.name);
    if (p.avatar) url.searchParams.set('avatar', p.avatar);
    window.location.href = url.toString();
  }

  // Nexus Realm: how many matches / squads / worlds this player has created.
  function loadStats(uid, box) {
    fetch(apiBase() + '/api/realm/users/' + encodeURIComponent(uid) + '/profile')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.made || !box.isConnected) return;
        [['⚔', 'Matches', d.made.matches], ['👥', 'Squads', d.made.squads], ['🌌', 'Worlds', d.made.worlds]]
          .forEach(function (s) {
            var t = el('div', 'bx-stat');
            var b = el('b'); b.textContent = s[0] + ' ' + (Number(s[2]) || 0);
            var l = el('span'); l.textContent = s[1] + ' created';
            t.appendChild(b); t.appendChild(l); box.appendChild(t);
          });
      })
      .catch(function () { /* stats just stay hidden */ });
  }

  function openCard(p) {
    closeCard();
    var isSelf = String(p.uid) === myId();
    var hue = hueOf(p.name || p.uid);

    var overlay = el('div', 'bx-card-overlay');
    overlay.id = 'bxCard';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var card = el('div', 'bx-card');
    var banner = el('div', 'bx-card-banner');
    // Shown until (or instead of) a real banner picture.
    banner.style.backgroundImage =
      'linear-gradient(135deg, hsl(' + hue + ' 70% 38%), hsl(' + ((hue + 60) % 360) + ' 75% 28%))';

    var closeBtn = el('button', 'bx-card-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close profile');
    closeBtn.textContent = '✕';

    var body = el('div', 'bx-card-body');
    var av = el('div', 'bx-card-av');
    av.textContent = p.avatar || (p.name || '?').charAt(0).toUpperCase();
    var name = el('h3', 'bx-card-name');
    name.textContent = p.name || 'Player';
    var sub = el('p', 'bx-card-sub');
    sub.textContent = 'Loading profile…';

    var actions = el('div', 'bx-card-actions');
    if (!isSelf) {
      var msgBtn = el('button', 'bx-card-btn');
      msgBtn.type = 'button';
      msgBtn.textContent = '💬 Message';
      msgBtn.addEventListener('click', function () { messageUser(p); });
      actions.appendChild(msgBtn);
    }
    var doneBtn = el('button', 'bx-card-btn ghost');
    doneBtn.type = 'button';
    doneBtn.textContent = 'Close';
    doneBtn.addEventListener('click', closeCard);
    actions.appendChild(doneBtn);

    body.appendChild(av);
    body.appendChild(name);
    body.appendChild(sub);
    var stats = el('div', 'bx-card-stats');
    body.appendChild(stats);
    body.appendChild(actions);
    card.appendChild(banner);
    card.appendChild(closeBtn);
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    closeBtn.focus();
    loadStats(p.uid, stats);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeCard(); });
    closeBtn.addEventListener('click', closeCard);

    loadProfile(String(p.uid)).then(function (u) {
      if (!document.body.contains(overlay)) return; // closed meanwhile
      if (!u) { sub.textContent = 'Could not load this profile.'; return; }

      if (u.username) name.textContent = u.username;
      if (u.avatar) av.textContent = u.avatar;
      if (u.banner && BANNER_RE.test(u.banner)) {
        banner.style.backgroundImage = 'url("' + u.banner + '")';
      }
      if (u.createdAt) {
        sub.textContent = 'Member since ' + new Date(u.createdAt).toLocaleDateString(
          undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      } else {
        sub.textContent = isSelf ? 'This is you' : '';
      }
    });
  }

  // Other scripts (user-profile.js, Chat.js) also open a profile when something
  // with data-pf-uid is clicked, which is why two profiles used to appear.
  // We take those attributes over (data-pf-* -> data-bx-*) so only THIS card exists.
  function claimProfileLinks() {
    document.querySelectorAll('[data-pf-uid]').forEach(function (n) {
      n.dataset.bxUid = n.getAttribute('data-pf-uid');
      n.dataset.bxName = n.getAttribute('data-pf-name') || '';
      n.dataset.bxAv = n.getAttribute('data-pf-av') || '';
      n.removeAttribute('data-pf-uid');
      n.removeAttribute('data-pf-name');
      n.removeAttribute('data-pf-av');
    });
  }
  var claimQueued = false;
  function queueClaim() {
    if (claimQueued) return;
    claimQueued = true;
    requestAnimationFrame(function () { claimQueued = false; claimProfileLinks(); });
  }

  // Registered on window in the capture phase: nothing else on the page sees the click.
  window.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-bx-uid]') : null;
    if (!t || !t.dataset.bxUid || t.closest('#bxCard')) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openCard({
      uid: t.dataset.bxUid,
      name: t.dataset.bxName || '',
      avatar: t.dataset.bxAv || ''
    });
  }, true);

  // Keyboard: Enter/Space on the DM sender line, Esc to close.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeCard(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList &&
        e.target.classList.contains('bx-head') && e.target.dataset.bxUid) {
      e.preventDefault();
      e.target.click();
    }
  });

  function init() {
    claimProfileLinks();
    new MutationObserver(queueClaim).observe(document.body, { childList: true, subtree: true });
    watch('messages', 'room');   // Chat.html
    watch('dmMessages', 'dm');   // Contacts.html
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
