/* RemixVerse — layout.js
   Builds the shared header and footer, starts the background, and plays the
   page-transition curtain between pages. */

(function () {
  'use strict';

  const LL = (window.LL = window.LL || {});
  const NEXUS_URL = '../NexusRealm.html';
  LL.NEXUS_URL = NEXUS_URL;

  const page = document.body.getAttribute('data-page') || '';

  const links = [
    ['index.html', 'Home', 'home'],
    ['play.html', 'Play', 'play'],
    ['legacy.html', 'Legacy', 'legacy'],
    ['guide.html', 'Guide', 'guide'],
    ['account.html', 'Account', 'account']
  ];

  const ringSvg =
    '<svg class="brand-ring" viewBox="0 0 32 32" aria-hidden="true">' +
    '<circle cx="16" cy="16" r="12" fill="none" stroke="rgba(120,170,255,.25)" stroke-width="3"/>' +
    '<path d="M16 4 A12 12 0 1 1 4.6 20" fill="none" stroke="#4f95ff" stroke-width="3" stroke-linecap="round"/>' +
    '<circle cx="16" cy="4" r="3" fill="#fff"/>' +
    '</svg>';

  const soundOn =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';

  const soundOff =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z"/></svg>';

  function buildHeader() {
    const header = document.createElement('header');
    header.className = 'topbar';

    const nav = links.map(function (l) {
      return '<a href="' + l[0] + '"' + (l[2] === page ? ' class="active" aria-current="page"' : '') + '>' + l[1] + '</a>';
    }).join('');

    header.innerHTML =
      '<a class="brand" href="index.html" aria-label="RemixVerse home">' + ringSvg + '<span>RemixVerse</span></a>' +
      '<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>' +
      '<nav id="site-nav" class="site-nav" aria-label="Main">' + nav + '</nav>' +
      '<div class="top-actions"><a class="nexus-pill" href="account.html">Account</a>' +
      '<button class="icon-btn" id="sound-btn" type="button" aria-label="Sound" aria-pressed="true"></button>' +
      '<a class="nexus-pill" href="' + NEXUS_URL + '">Nexus Realm</a>' +
      '</div>';

    document.body.insertBefore(header, document.body.firstChild);

    const menuBtn = header.querySelector('.menu-btn');
    const navEl = header.querySelector('.site-nav');
    menuBtn.addEventListener('click', function () {
      const open = navEl.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    const soundBtn = header.querySelector('#sound-btn');
    function paintSound() {
      const on = LL.fx && LL.fx.sound.enabled;
      soundBtn.innerHTML = on ? soundOn : soundOff;
      soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      soundBtn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
    }
    paintSound();
    soundBtn.addEventListener('click', function () {
      LL.fx.sound.toggle();
      paintSound();
    });
  }

  function buildFooter() {
    if (document.body.getAttribute('data-footer') === 'off') return;
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML =
      '<div class="footer-inner">' +
      '<div><strong>RemixVerse</strong><p>An original life-simulation game, featured on Remix Nexus. Signed-in players can save lives and achievements to their private cloud account.</p></div>' +
      '<div class="footer-links">' +
      links.map(function (l) { return '<a href="' + l[0] + '">' + l[1] + '</a>'; }).join('') +
      '<a href="' + NEXUS_URL + '">Nexus Realm</a>' +
      '</div></div>';
    document.body.appendChild(footer);
  }

  function buildScenery() {
    const aurora = document.createElement('div');
    aurora.className = 'aurora';
    aurora.setAttribute('aria-hidden', 'true');

    const canvas = document.createElement('canvas');
    canvas.id = 'bg-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    const curtain = document.createElement('div');
    curtain.className = 'curtain';
    curtain.setAttribute('aria-hidden', 'true');
    curtain.innerHTML = '<div class="curtain-mark">' + ringSvg + '</div>';

    document.body.insertBefore(aurora, document.body.firstChild);
    document.body.insertBefore(canvas, document.body.firstChild);
    document.body.appendChild(curtain);
  }

  function wireTransitions() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(https?:|mailto:|tel:)/i.test(href)) return;
      if (LL.fx && LL.fx.reduced()) return;
      e.preventDefault();
      document.body.classList.add('leaving');
      if (LL.fx) LL.fx.sound.play('click');
      window.setTimeout(function () { window.location.href = href; }, 440);
    });

    window.addEventListener('pageshow', function (e) {
      if (e.persisted) document.body.classList.remove('leaving');
    });
  }

  function wirePointerGlow() {
    document.addEventListener('pointermove', function (e) {
      const t = e.target.closest && e.target.closest('.btn, .choice, .act');
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      t.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }

  buildScenery();
  buildHeader();
  buildFooter();
  wireTransitions();
  wirePointerGlow();
  if (LL.fx) LL.fx.startBackground();

  document.addEventListener('click', function (e) {
    const t = e.target.closest && e.target.closest('.btn, .choice, .tab, .act');
    if (t && LL.fx && !t.disabled) LL.fx.sound.play('click');
  });
})();
