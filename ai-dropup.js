// ===== AI drop-up button (✨) =====
(function initAiDropup() {
  const form = document.querySelector('.message-form');
  if (!form || form.querySelector('.ai-btn')) return;
  const input = form.querySelector('input[type="text"]');

  // --- styles ---
  const css = document.createElement('style');
  css.textContent = `
    .message-form { position: relative; }
    .message-form .ai-btn {
      width: 50px; height: 50px; padding: 0; flex-shrink: 0;
      border-radius: 50%; background: rgba(255,255,255,.08);
      font-size: 20px; transition: .25s;
    }
    .message-form .ai-btn.open {
      background: #0066ff; transform: rotate(20deg) scale(1.08);
    }
    @media (max-width: 640px) {
      .message-form .ai-btn { width: 38px; height: 38px; font-size: 16px; }
    }
    .ai-panel {
      position: absolute; left: 16px; right: 16px; bottom: calc(100% + 8px);
      z-index: 20; color: #fff; padding: 14px; border-radius: 18px;
      background: rgba(20,20,25,.97);
      border: 1px solid rgba(0,102,255,.35);
      box-shadow: 0 -8px 30px rgba(0,0,0,.5);
      transform-origin: bottom left;
      opacity: 0; transform: translateY(14px) scale(.97);
      visibility: hidden; pointer-events: none;
      transition: opacity .25s ease, transform .25s ease, visibility 0s linear .25s;
    }
    .ai-panel.open {
      opacity: 1; transform: none; visibility: visible; pointer-events: auto;
      transition: opacity .25s ease, transform .25s ease, visibility 0s;
    }
    .ai-panel-title { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
    .ai-panel-title small { display: block; font-weight: 400; font-size: 12px; opacity: .65; }
    .ai-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .ai-panel .ai-chip {
      height: auto; padding: 8px 14px; border-radius: 20px;
      background: rgba(0,102,255,.18); border: 1px solid rgba(0,102,255,.4);
      color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
    }
  `;
  document.head.appendChild(css);

  // --- button ---
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ai-btn';
  btn.title = 'Nexus AI';
  btn.textContent = '✨';
  btn.setAttribute('aria-expanded', 'false');
  const attach = form.querySelector('.attach-btn');
  if (attach) attach.after(btn); else form.prepend(btn);

  // --- drop-up panel ---
  const panel = document.createElement('div');
  panel.className = 'ai-panel';
  panel.innerHTML = `
    <div class="ai-panel-title">✨ Nexus AI
      <small>Pick one, or type @ai before your own question</small>
    </div>
    <div class="ai-chips">
      <button type="button" class="ai-chip" data-p="Tell me a joke">😂 Tell me a joke</button>
      <button type="button" class="ai-chip" data-p="Give me a quick gaming tip">🎮 Gaming tip</button>
      <button type="button" class="ai-chip" data-p="Give me 5 cool gamer name ideas">🏷️ Gamer names</button>
      <button type="button" class="ai-chip" data-p="Tell me a fun gaming fact">🧠 Fun fact</button>
      <button type="button" class="ai-chip" data-p="">✍️ Ask my own</button>
    </div>`;
  form.appendChild(panel);

  // --- open / close ---
  function setOpen(open) {
    panel.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!panel.classList.contains('open'));
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  // --- chips fill the input with "@ai ..." ---
  panel.addEventListener('click', (e) => {
    const chip = e.target.closest('.ai-chip');
    if (!chip || !input) return;
    input.value = '@ai ' + chip.dataset.p;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    setOpen(false);
  });
})();
