// keyboard-fix.js
// Keeps the message input visible above the on-screen keyboard on mobile, AND keeps
// the open chat (room or DM) BELOW the phone's status bar (clock / battery / wifi).
//
// How: the visible viewport height (window.visualViewport) is published as --app-height.
// The status-bar gap (--safe-top, set by safe-area.css / safe-area.js) is measured from the
// <body> top padding. If a page lays the chat shell out in normal flow, the body padding
// already keeps it clear of the status bar. If some stylesheet pins the open conversation to
// the screen edge (position: fixed/absolute), we push it down by the gap and shrink it by
// the same amount so it never runs under the status bar or off the bottom.

(function () {
  function visibleHeight() {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }

  function safeTop() {
    var b = document.body;
    if (!b) return 0;
    var v = parseFloat(getComputedStyle(b).paddingTop);
    return isFinite(v) ? v : 0;
  }

  function keepPageAtTop() {
    // Focusing an input can make the browser scroll the whole page up, which slides the
    // header under the status bar. The chat scrolls inside .messages, never the page.
    var se = document.scrollingElement || document.documentElement;
    if (se && se.scrollTop !== 0) se.scrollTop = 0;
    if (document.body && document.body.scrollTop !== 0) document.body.scrollTop = 0;
    if (window.scrollY) window.scrollTo(0, 0);
  }

  function applyHeight() {
    var h = visibleHeight();
    var top = safeTop();
    document.documentElement.style.setProperty('--app-height', h + 'px');

    document.querySelectorAll('.chat-shell').forEach(function (el) {
      var pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'absolute') {
        // Pinned to the screen: sit below the status bar and end at the bottom of the viewport.
        el.style.setProperty('top', top + 'px', 'important');
        el.style.setProperty('height', Math.max(0, h - top) + 'px', 'important');
      } else {
        // In normal flow: the body (height --app-height, padded by the status-bar gap) sizes it.
        el.style.removeProperty('top');
        el.style.removeProperty('height');
      }
    });
    keepPageAtTop();
  }

  function scrollActiveThreadToBottom() {
    document.querySelectorAll('.messages').forEach(function (box) {
      if (box.offsetParent !== null) { // visible
        box.scrollTop = box.scrollHeight;
      }
    });
  }

  var pendingFocusTarget = null;

  function handleViewportChange() {
    applyHeight();
    scrollActiveThreadToBottom();
    if (pendingFocusTarget) {
      // 'nearest' so the page itself never scrolls up under the status bar
      pendingFocusTarget.scrollIntoView({ block: 'nearest' });
      keepPageAtTop();
    }
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', applyHeight);
  } else {
    window.addEventListener('resize', applyHeight);
  }
  window.addEventListener('orientationchange', function () { setTimeout(applyHeight, 120); });

  // Opening a room / DM switches the layout (the shell gets .view-conversation). Re-apply then.
  function watchViewChanges() {
    var shells = document.querySelectorAll('.chat-shell');
    if (!shells.length || !window.MutationObserver) return;
    var mo = new MutationObserver(function () { applyHeight(); });
    shells.forEach(function (el) { mo.observe(el, { attributes: true, attributeFilter: ['class', 'style'] }); });
  }

  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t || !t.matches) return;
    if (!t.matches('.message-form input, .chat-search-bar input')) return;

    pendingFocusTarget = t;
    applyHeight();
    scrollActiveThreadToBottom();
    setTimeout(handleViewportChange, 60);
    setTimeout(handleViewportChange, 250); // second pass for slower keyboards
  });

  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches('.message-form input, .chat-search-bar input')) {
      pendingFocusTarget = null;
      setTimeout(applyHeight, 60);
    }
  });

  window.addEventListener('DOMContentLoaded', function () { applyHeight(); watchViewChanges(); });
  window.addEventListener('load', applyHeight);
  applyHeight();
})();
