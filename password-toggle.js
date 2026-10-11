/* =====================================================================
   REMIX-NEXUS — show / hide password (eye button)
   One shared file: add  <script src="./password-toggle.js"></script>
   to any page and EVERY <input type="password"> gets an eye button.
   It injects its own CSS, so no other file needs to change.
   ===================================================================== */
(function () {
  'use strict';

  var EYE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

  var EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.06-5.94"/>' +
    '<path d="M9.9 4.24A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a19.7 19.7 0 0 1-3.17 4.19"/>' +
    '<path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function addStyles() {
    if (document.getElementById('pw-toggle-styles')) return;
    var css = document.createElement('style');
    css.id = 'pw-toggle-styles';
    css.textContent =
      '.pw-wrap{position:relative;display:block;width:100%}' +
      '.pw-wrap input{padding-right:46px !important}' +
      '.pw-eye{position:absolute;top:0;right:0;height:100%;width:44px;display:flex;' +
      'align-items:center;justify-content:center;padding:0;border:0;background:transparent;' +
      'color:#8a96b5;cursor:pointer;border-radius:0 8px 8px 0;-webkit-tap-highlight-color:transparent}' +
      '.pw-eye:hover,.pw-eye[aria-pressed="true"]{color:#ffffff}' +
      '.pw-eye:focus-visible{outline:2px solid rgba(0,102,255,.7);outline-offset:-2px}';
    document.head.appendChild(css);
  }

  function enhance(input) {
    if (input.dataset.pwToggle) return;          // never add it twice
    input.dataset.pwToggle = '1';

    var wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';                          // must NOT submit the form
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = EYE;
    wrap.appendChild(btn);

    // keep the keyboard open / cursor in the box when tapping the eye
    btn.addEventListener('pointerdown', function (e) { e.preventDefault(); });

    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      var start = input.selectionStart, end = input.selectionEnd;
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus();
      try { input.setSelectionRange(start, end); } catch (_) {}
    });
  }

  function init() {
    addStyles();
    document.querySelectorAll('input[type="password"]').forEach(enhance);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
