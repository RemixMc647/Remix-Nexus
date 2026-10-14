/* RemixVerse — fx.js
   Animation and feedback: particle background, confetti, floating numbers,
   typewriter text, toasts, confirm dialog and sound. Respects reduced motion. */

(function () {
  'use strict';

  const LL = (window.LL = window.LL || {});
  const fx = (LL.fx = {});

  const reduced = function () {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  fx.reduced = reduced;

  fx.esc = function (str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch];
    });
  };

  /* ---------------------------------------------------------------
     Background particles
  --------------------------------------------------------------- */

  let tint = { r: 255, g: 255, b: 255, amt: 0 };

  fx.pulse = function (kind) {
    tint = kind === 'bad' ? { r: 255, g: 93, b: 115, amt: 1 } : { r: 255, g: 255, b: 255, amt: 1 };
  };

  fx.startBackground = function () {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas || !canvas.getContext) return;

    const ctx = canvas.getContext('2d');
    const base = { r: 110, g: 165, b: 255 };
    const still = reduced();
    let w = 0;
    let h = 0;
    let parts = [];
    let raf = 0;

    function make(anywhere) {
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : h + 10,
        r: Math.random() * 1.6 + 0.5,
        vx: (Math.random() - 0.5) * 0.14,
        vy: -(Math.random() * 0.28 + 0.06),
        a: Math.random() * 0.55 + 0.2,
        ph: Math.random() * 6.28
      };
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(70, Math.max(26, (w * h) / 26000)));
      parts = [];
      for (let i = 0; i < count; i++) parts.push(make(true));
      if (still) draw(0);
    }

    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      tint.amt *= 0.965;
      const mix = function (a, b) { return Math.round(a + (b - a) * tint.amt); };
      const cr = mix(base.r, tint.r);
      const cg = mix(base.g, tint.g);
      const cb = mix(base.b, tint.b);

      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!still) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.y < -10 || p.x < -10 || p.x > w + 10) {
            parts[i] = make(false);
            continue;
          }
        }
        const tw = 0.6 + 0.4 * Math.sin(t / 900 + p.ph);
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (p.a * tw).toFixed(3) + ')';
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }

      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const dx = parts[i].x - parts[j].x;
          const dy = parts[i].y - parts[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 11025) {
            const al = 0.13 * (1 - Math.sqrt(d2) / 105);
            ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + al.toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(parts[i].x, parts[i].y);
            ctx.lineTo(parts[j].x, parts[j].y);
            ctx.stroke();
          }
        }
      }
    }

    function frame(t) {
      draw(t);
      raf = window.requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize);

    if (!still) {
      raf = window.requestAnimationFrame(frame);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) window.cancelAnimationFrame(raf);
        else raf = window.requestAnimationFrame(frame);
      });
    }
  };

  /* ---------------------------------------------------------------
     Sound (tiny synthesised blips, no audio files)
  --------------------------------------------------------------- */

  const sound = (fx.sound = {
    ctx: null,
    enabled: true,

    init: function () {
      this.enabled = LL.storage ? LL.storage.getSetting('sound', true) : true;
    },

    _ctx: function () {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },

    tone: function (freq, dur, type, vol, delay) {
      const c = this._ctx();
      if (!c) return;
      const t0 = c.currentTime + (delay || 0);
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.05, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    },

    play: function (name) {
      if (!this.enabled) return;
      try {
        switch (name) {
          case 'click':
            this.tone(540, 0.07, 'sine', 0.04);
            break;
          case 'good':
            this.tone(440, 0.14, 'triangle', 0.05, 0);
            this.tone(554, 0.14, 'triangle', 0.05, 0.1);
            this.tone(659, 0.26, 'triangle', 0.05, 0.2);
            break;
          case 'bad':
            this.tone(220, 0.28, 'sawtooth', 0.03, 0);
            this.tone(165, 0.4, 'sawtooth', 0.03, 0.16);
            break;
          case 'milestone':
            [523, 659, 784, 1046].forEach(function (f, i) { sound.tone(f, 0.22, 'triangle', 0.05, i * 0.09); });
            break;
          case 'achieve':
            this.tone(880, 0.14, 'triangle', 0.05, 0);
            this.tone(1318, 0.34, 'triangle', 0.05, 0.12);
            break;
          case 'death':
            this.tone(196, 1.0, 'triangle', 0.05, 0);
            this.tone(130, 1.4, 'triangle', 0.05, 0.4);
            break;
          default:
            break;
        }
      } catch (e) { /* audio is optional */ }
    },

    toggle: function () {
      this.enabled = !this.enabled;
      if (LL.storage) LL.storage.setSetting('sound', this.enabled);
      if (this.enabled) this.play('click');
      return this.enabled;
    }
  });

  /* ---------------------------------------------------------------
     Confetti
  --------------------------------------------------------------- */

  let confettiParts = [];
  let confettiRaf = 0;

  fx.confetti = function (opts) {
    if (reduced()) return;
    const o = opts || {};
    let cv = document.getElementById('fx-canvas');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.id = 'fx-canvas';
      cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv);
    }
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = ['#1f6bff', '#4f95ff', '#ffffff', '#dce9ff', '#8fb8ff'];
    const n = o.count || 110;
    const ox = o.x !== undefined ? o.x : W / 2;
    const oy = o.y !== undefined ? o.y : H * 0.38;

    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = 5 + Math.random() * 9;
      confettiParts.push({
        x: ox, y: oy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        w: 5 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 0.4,
        c: colors[Math.floor(Math.random() * colors.length)],
        life: 0
      });
    }

    if (confettiRaf) return;

    function step() {
      ctx.clearRect(0, 0, W, H);
      confettiParts = confettiParts.filter(function (p) { return p.y < H + 30 && p.life < 190; });
      confettiParts.forEach(function (p) {
        p.vy += 0.28;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life += 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - p.life / 190);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (confettiParts.length) confettiRaf = window.requestAnimationFrame(step);
      else {
        confettiRaf = 0;
        if (cv.parentNode) cv.parentNode.removeChild(cv);
      }
    }

    confettiRaf = window.requestAnimationFrame(step);
  };

  /* ---------------------------------------------------------------
     Small helpers: floating numbers, count-up, typewriter, shake, flash
  --------------------------------------------------------------- */

  fx.float = function (anchor, text, kind) {
    if (!anchor || reduced()) return;
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'float-delta ' + (kind || '');
    el.textContent = text;
    el.setAttribute('aria-hidden', 'true');
    el.style.left = (r.left + r.width * 0.72 + (Math.random() * 16 - 8)) + 'px';
    el.style.top = (r.top + r.height / 2) + 'px';
    document.body.appendChild(el);
    window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
  };

  fx.countTo = function (el, from, to, ms, fmt) {
    if (!el) return;
    const format = fmt || function (v) { return String(Math.round(v)); };
    if (el._cnt) window.cancelAnimationFrame(el._cnt);
    if (reduced() || from === to) {
      el.textContent = format(to);
      return;
    }
    const dur = ms || 700;
    const t0 = performance.now();
    function step(now) {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(from + (to - from) * e);
      if (k < 1) el._cnt = window.requestAnimationFrame(step);
      else el.textContent = format(to);
    }
    el._cnt = window.requestAnimationFrame(step);
  };

  fx.type = function (el, text, speed) {
    el.textContent = '';
    if (reduced()) {
      el.textContent = text;
      return { skip: function () {}, done: Promise.resolve() };
    }
    let i = 0;
    let timer = 0;
    let stopped = false;
    let resolveDone;
    const done = new Promise(function (r) { resolveDone = r; });

    function finish() {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timer);
      el.textContent = text;
      el.classList.remove('typing');
      resolveDone();
    }

    function tick() {
      if (stopped) return;
      i += 2;
      el.textContent = text.slice(0, i);
      if (i >= text.length) finish();
      else timer = window.setTimeout(tick, speed || 14);
    }

    el.classList.add('typing');
    tick();
    return { skip: finish, done: done };
  };

  fx.shake = function (el) {
    if (!el || reduced()) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    window.setTimeout(function () { el.classList.remove('shake'); }, 560);
  };

  fx.flash = function (kind) {
    if (reduced()) return;
    let v = document.getElementById('flash');
    if (!v) {
      v = document.createElement('div');
      v.id = 'flash';
      v.setAttribute('aria-hidden', 'true');
      document.body.appendChild(v);
    }
    v.className = '';
    void v.offsetWidth;
    v.className = 'on ' + (kind || 'good');
    window.setTimeout(function () { v.className = ''; }, 900);
  };

  /* ---------------------------------------------------------------
     Toasts
  --------------------------------------------------------------- */

  fx.toast = function (text, kind, title) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    if (title) {
      const strong = document.createElement('strong');
      strong.textContent = title;
      el.appendChild(strong);
    }
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    box.appendChild(el);
    window.requestAnimationFrame(function () { el.classList.add('show'); });
    window.setTimeout(function () {
      el.classList.remove('show');
      window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 380);
    }, 3800);
    while (box.children.length > 4) box.removeChild(box.firstChild);
  };

  /* ---------------------------------------------------------------
     Confirm dialog (returns a Promise<boolean>)
  --------------------------------------------------------------- */

  fx.confirm = function (o) {
    return new Promise(function (resolve) {
      const previous = document.activeElement;
      const veil = document.createElement('div');
      veil.className = 'modal-veil';
      veil.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">' +
        '<h2 id="modal-title">' + fx.esc(o.title || 'Are you sure?') + '</h2>' +
        '<p>' + fx.esc(o.body || '') + '</p>' +
        '<div class="modal-actions">' +
        '<button type="button" class="btn btn-ghost" data-act="no">' + fx.esc(o.cancel || 'Cancel') + '</button>' +
        '<button type="button" class="btn btn-solid" data-act="yes">' + fx.esc(o.confirm || 'Confirm') + '</button>' +
        '</div></div>';
      document.body.appendChild(veil);

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        veil.classList.add('out');
        window.setTimeout(function () { if (veil.parentNode) veil.parentNode.removeChild(veil); }, 200);
        if (previous && previous.focus) previous.focus();
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(false);
        }
        if (e.key === 'Tab') {
          const btns = veil.querySelectorAll('button');
          const first = btns[0];
          const last = btns[btns.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }

      veil.addEventListener('click', function (e) {
        if (e.target === veil) close(false);
        const act = e.target.closest && e.target.closest('[data-act]');
        if (act) close(act.getAttribute('data-act') === 'yes');
      });

      document.addEventListener('keydown', onKey, true);
      veil.querySelector('[data-act="yes"]').focus();
    });
  };

  fx.sound.init();
})();
