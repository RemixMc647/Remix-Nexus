// ===== Nexus AI drop-up button (✨) — Chat + Contacts =====
// Single source of truth: Chat.js and Contacts.js no longer contain their
// own copy of this. The panel is attached to <body> (position: fixed) so no
// parent with overflow:hidden / transforms / z-index can ever clip or hide it,
// and it stays above the full-screen conversation view on phones.
(function initAiDropup() {
  if (window.__nexusAiDropupReady) return;

  const form = document.querySelector('.message-form');
  if (!form || form.querySelector('.ai-btn')) return;
  window.__nexusAiDropupReady = true;

  const input = form.querySelector('input[type="text"]');

  // ---------- styles ----------
  const css = document.createElement('style');
  css.id = 'nexus-ai-style';
  css.textContent = `
    .message-form .ai-btn {
      width: 36px; height: 36px; padding: 0; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      border: 0; border-radius: 8px; background: transparent;
      font-size: 18px; line-height: 1; cursor: pointer;
      transition: background .15s ease, transform .15s ease;
    }
    .message-form .ai-btn:hover { background: #171c2b; }
    .message-form .ai-btn.open { background: #0066ff; transform: rotate(15deg) scale(1.05); }

    .ai-panel {
      position: fixed; z-index: 3000; box-sizing: border-box;
      max-width: calc(100vw - 16px); overflow-y: auto;
      padding: 14px; border-radius: 12px; color: #e8ecf7;
      font-family: 'Poppins', system-ui, sans-serif;
      background: #0a0d16; border: 1px solid rgba(0,102,255,.45);
      box-shadow: 0 -8px 30px rgba(0,0,0,.6);
      opacity: 0; transform: translateY(10px) scale(.98); transform-origin: bottom left;
      visibility: hidden; pointer-events: none;
      transition: opacity .18s ease, transform .18s ease, visibility 0s linear .18s;
    }
    .ai-panel.open {
      opacity: 1; transform: none; visibility: visible; pointer-events: auto;
      transition: opacity .18s ease, transform .18s ease, visibility 0s;
    }
    .ai-panel-title { font-weight: 700; font-size: 15px; }
    .ai-panel-title small { display: block; margin-top: 2px; font-weight: 400; font-size: 12px; color: #8a96b5; }
    .ai-note {
      display: none; margin-top: 10px; padding: 8px 10px; border-radius: 8px;
      background: rgba(245,166,35,.12); color: #f7b955; font-size: 12px;
    }
    .ai-panel.locked .ai-note { display: block; }
    .ai-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .ai-panel .ai-chip {
      padding: 8px 14px; border-radius: 20px; cursor: pointer;
      background: rgba(0,102,255,.16); border: 1px solid rgba(0,102,255,.45);
      color: #fff; font-family: inherit; font-size: 13px; font-weight: 600;
      transition: background .12s ease;
    }
    .ai-panel .ai-chip:hover { background: rgba(0,102,255,.4); }
    .ai-panel.locked .ai-chip { opacity: .4; cursor: not-allowed; }
  `;
  document.head.appendChild(css);

  // ---------- button ----------
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ai-btn';
  btn.title = 'Nexus AI';
  btn.setAttribute('aria-label', 'Nexus AI');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = '✨';
  const attach = form.querySelector('.attach-btn');
  if (attach) attach.after(btn); else form.prepend(btn);

  // ---------- panel (lives on <body>) ----------
  const panel = document.createElement('div');
  panel.className = 'ai-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Nexus AI');
  panel.innerHTML = `
    <div class="ai-panel-title">✨ Nexus AI
      <small>Pick one, or type @ai before your own question</small>
    </div>
    <div class="ai-note">Open a conversation first, then ask Nexus AI.</div>
    <div class="ai-chips">
      <button type="button" class="ai-chip" data-p="Tell me a joke">😂 Tell me a joke</button>
      <button type="button" class="ai-chip" data-p="Give me a quick gaming tip">🎮 Gaming tip</button>
      <button type="button" class="ai-chip" data-p="Give me 5 cool gamer name ideas">🏷️ Gamer names</button>
      <button type="button" class="ai-chip" data-p="Tell me a fun gaming fact">🧠 Fun fact</button>
      <button type="button" class="ai-chip" data-p="">✍️ Ask my own</button>
    </div>`;
  document.body.appendChild(panel);

  // ---------- positioning ----------
  function place() {
    const r = form.getBoundingClientRect();
    const vh = document.documentElement.clientHeight;
    const width = Math.min(r.width, 440);
    panel.style.width = width + 'px';
    panel.style.left = Math.max(8, r.left) + 'px';
    panel.style.bottom = Math.max(8, vh - r.top + 8) + 'px';
    panel.style.maxHeight = Math.max(140, r.top - 16) + 'px';
  }

  function isOpen() { return panel.classList.contains('open'); }

  function setOpen(open) {
    if (open) {
      place();
      panel.classList.toggle('locked', !!(input && input.disabled));
    }
    panel.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!isOpen());
  });

  document.addEventListener('click', (e) => {
    if (isOpen() && !panel.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });
  window.addEventListener('resize', () => { if (isOpen()) place(); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => { if (isOpen()) place(); });
  }

  // ---------- chips ----------
  function submitForm() {
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }

  panel.addEventListener('click', (e) => {
    const chip = e.target.closest('.ai-chip');
    if (!chip || !input || input.disabled) return;

    const prompt = chip.dataset.p || '';
    input.value = '@ai ' + prompt;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    setOpen(false);

    if (prompt) {
      // ready-made question → send it straight away
      submitForm();
    } else {
      // "Ask my own" → leave "@ai " in the box and let them type
      input.focus();
      const end = input.value.length;
      try { input.setSelectionRange(end, end); } catch (_) { /* ignore */ }
    }
  });
})();
