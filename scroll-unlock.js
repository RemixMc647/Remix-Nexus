/* scroll-unlock.js — keeps static pages scrollable even if another script
   (auth.js, chat-notifications.js, a modal, etc.) locks the page.
   Load this LAST on About / Terms / Contact. */
(function () {
  var html = document.documentElement;

  function unlock() {
    [html, document.body].forEach(function (el) {
      if (!el) return;
      el.style.setProperty('overflow-y', 'auto', 'important');
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('position', 'static', 'important');
      el.style.removeProperty('touch-action');
    });
    document.body.classList.remove('no-scroll', 'modal-open', 'overflow-hidden', 'chat-open');
  }

  unlock();

  var mo = new MutationObserver(function () {
    var b = document.body;
    var bad =
      getComputedStyle(b).overflowY === 'hidden' ||
      getComputedStyle(html).overflowY === 'hidden' ||
      getComputedStyle(b).position === 'fixed';
    if (bad) unlock();
  });
  mo.observe(html, { attributes: true, attributeFilter: ['style', 'class'] });
  if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('load', unlock);
  window.addEventListener('pageshow', unlock);
})();
