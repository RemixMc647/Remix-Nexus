// keyboard-fix.js
// Keeps the message input visible above the on-screen keyboard on mobile,
// the same way WhatsApp does it: the chat shell's height is kept in sync
// with the real visible viewport (window.visualViewport), which shrinks
// when the keyboard opens. Because the input bar is a normal flex child
// pinned to the bottom of that shell (not fixed to the window), it rides
// up automatically as the shell shrinks — no manual translateY needed.

(function () {
  function visibleHeight() {
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  }

  function applyHeight() {
    var h = visibleHeight();
    document.documentElement.style.setProperty('--app-height', h + 'px');
    // Apply directly to whichever shell is on this page (Chat.html or Contacts.html)
    var shells = document.querySelectorAll('.chat-shell');
    shells.forEach(function (el) {
      el.style.height = h + 'px';
    });
  }

  function scrollActiveThreadToBottom() {
    // Only the visible .messages panel matters
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
      pendingFocusTarget.scrollIntoView({ block: 'end' });
    }
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', applyHeight);
  } else {
    // Older WebViews without visualViewport support
    window.addEventListener('resize', applyHeight);
  }

  // When an input/textarea in the chat gets focus, the keyboard is about
  // to open. We re-apply the height shortly after (some Android WebViews
  // fire the viewport resize a beat after focus) and nudge the field into
  // view, exactly like WhatsApp scrolling the composer up.
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (!t) return;
    var isChatField = t.matches('.message-form input, .chat-search-bar input');
    if (!isChatField) return;

    pendingFocusTarget = t;
    applyHeight();
    scrollActiveThreadToBottom();
    setTimeout(handleViewportChange, 60);
    setTimeout(handleViewportChange, 250); // second pass for slower keyboards
  });

  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (t && t.matches('.message-form input, .chat-search-bar input')) {
      pendingFocusTarget = null;
      setTimeout(applyHeight, 60);
    }
  });

  window.addEventListener('DOMContentLoaded', applyHeight);
  applyHeight();
})();
