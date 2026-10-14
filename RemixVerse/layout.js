/* Remix Verse game shell — deliberately no website header, navigation or footer. */
(function () {
  'use strict';
  const LL = (window.LL = window.LL || {});
  LL.NEXUS_URL = 'https://remix-nexus-tygt.onrender.com';

  function scenery() {
    const aurora = document.createElement('div');
    aurora.className = 'aurora';
    aurora.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.id = 'bg-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const curtain = document.createElement('div');
    curtain.className = 'curtain';
    curtain.setAttribute('aria-hidden', 'true');
    curtain.innerHTML = '<div class="curtain-mark"><span class="brand-ring">✦</span><b>REMIX VERSE</b></div>';
    document.body.insertBefore(aurora, document.body.firstChild);
    document.body.insertBefore(canvas, document.body.firstChild);
    document.body.appendChild(curtain);
  }

  function transitions() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(https?:|mailto:|tel:|javascript:)/i.test(href)) return;
      if (LL.fx && LL.fx.reduced && LL.fx.reduced()) return;
      e.preventDefault();
      document.body.classList.add('leaving');
      if (LL.fx && LL.fx.sound) LL.fx.sound.play('click');
      window.setTimeout(function () { window.location.href = href; }, 360);
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) document.body.classList.remove('leaving');
    });
  }

  function pointerGlow() {
    document.addEventListener('pointermove', function (e) {
      const t = e.target.closest && e.target.closest('.btn, .choice, .act, .nexus-exit-btn');
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      t.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  scenery();
  transitions();
  pointerGlow();
  if (LL.fx) LL.fx.startBackground();
  document.addEventListener('click', function (e) {
    const t = e.target.closest && e.target.closest('.btn, .choice, .tab, .act');
    if (t && LL.fx && LL.fx.sound && !t.disabled) LL.fx.sound.play('click');
  });
})();
