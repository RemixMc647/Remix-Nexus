/*==============================
REMIX-NEXUS — NEXUS AI FLOATING BALL
Works on Chat.html AND Contacts.html (one file, add it to both pages).

- Chat.html:     adds "✨ Nexus AI" as a default room. The floating ball jumps
                 straight into that room. Anything you type there is sent to
                 the existing @ai bot automatically (no need to type "@ai").
- Contacts.html: adds "✨ Nexus AI" as a default contact at the top of the list.
                 The ball opens that conversation. It is a private chat just
                 for you (a hidden per-user room), answered by the same @ai bot.

No server changes needed. Load this file AFTER Chat.js / Contacts.js.
==============================*/
(function () {
  'use strict';

  var AI_NAME = 'Nexus AI';
  var AI_ICON = '✨';
  var AI_ROOM_ID = 'nexus-ai';            // replaced in initChat() by this user's PRIVATE room: nexus-ai-dm:<userId>
  var isChatPage = !!document.getElementById('roomList');
  var isContactsPage = !!document.getElementById('contactList');
  if (!isChatPage && !isContactsPage) return;

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  /* -----------------------------------------------------------
     STYLES (injected, so no CSS file to deploy)
  ----------------------------------------------------------- */
  (function injectStyles() {
    if (document.getElementById('nexus-ai-ball-style')) return;
    var st = document.createElement('style');
    st.id = 'nexus-ai-ball-style';
    st.textContent = [
      '.nexus-ai-ball{position:fixed;right:20px;bottom:96px;z-index:900;height:58px;min-width:58px;padding:0;border:0;border-radius:29px;',
      'display:flex;align-items:center;justify-content:center;gap:0;cursor:pointer;color:#fff;font-family:inherit;',
      'background:radial-gradient(circle at 30% 25%,#6fa8ff 0%,#0066ff 55%,#0036a8 100%);',
      'box-shadow:0 6px 22px rgba(0,102,255,.55),0 0 0 1px rgba(255,255,255,.12) inset;',
      'transition:transform .15s ease,box-shadow .2s ease;-webkit-tap-highlight-color:transparent;overflow:hidden;}',
      '.nexus-ai-ball:hover{transform:scale(1.07);box-shadow:0 8px 28px rgba(0,102,255,.75),0 0 0 1px rgba(255,255,255,.2) inset;}',
      '.nexus-ai-ball:active{transform:scale(.94);}',
      '.nexus-ai-ball .nx-ball-icon{font-size:26px;line-height:58px;width:58px;text-align:center;flex-shrink:0;}',
      '.nexus-ai-ball .nx-ball-label{max-width:0;opacity:0;white-space:nowrap;font-size:14px;font-weight:600;overflow:hidden;',
      'transition:max-width .35s ease,opacity .25s ease,padding .35s ease;}',
      '.nexus-ai-ball.nx-expanded .nx-ball-label{max-width:140px;opacity:1;padding-right:18px;}',
      '.nexus-ai-ball::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;',
      'box-shadow:0 0 0 0 rgba(111,168,255,.55);animation:nxBallPulse 2.6s ease-out infinite;}',
      '@keyframes nxBallPulse{0%{box-shadow:0 0 0 0 rgba(111,168,255,.55);}70%,100%{box-shadow:0 0 0 16px rgba(111,168,255,0);}}',
      '@media (prefers-reduced-motion:reduce){.nexus-ai-ball::after{animation:none;}}',
      'body.nexus-ai-active .nexus-ai-ball,.nexus-ai-ball.nx-hidden{display:none !important;}',
      '@media (max-width:820px){',
      '.nexus-ai-ball{right:14px;bottom:calc(78px + env(safe-area-inset-bottom,0px));}',
      'body.conversation-fullscreen .nexus-ai-ball{display:none !important;}',
      '}',
      /* the default room / contact row */
      '.room-item[data-room^="nexus-ai-dm:"],.contact-item.nexus-ai-contact{border-left:3px solid #0066ff;',
      'background:linear-gradient(90deg,rgba(0,102,255,.14),transparent) !important;}',
      '.room-item[data-room^="nexus-ai-dm:"].active,.contact-item.nexus-ai-contact.active{background:linear-gradient(90deg,rgba(0,102,255,.32),rgba(0,102,255,.05)) !important;}',
      '.nx-ai-avatar{background:radial-gradient(circle at 30% 25%,#6fa8ff,#0066ff 60%,#0036a8) !important;color:#fff;}',
      '.nx-ai-msg .msg-text{white-space:pre-wrap;word-break:break-word;}',
      '.nx-ai-welcome{text-align:center;padding:28px 16px;opacity:.95;}',
      '.nx-ai-welcome .nx-ai-big{font-size:46px;margin-bottom:6px;}',
      '.nx-ai-welcome h3{margin:0 0 6px;font-size:18px;}',
      '.nx-ai-welcome p{margin:0 0 14px;opacity:.75;font-size:14px;}',
      '.nx-ai-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;}',
      '.nx-ai-chip{border:1px solid rgba(111,168,255,.45);background:rgba(0,102,255,.12);color:inherit;',
      'border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;font-family:inherit;}',
      '.nx-ai-chip:hover{background:rgba(0,102,255,.3);}'
    ].join('');
    document.head.appendChild(st);
  })();

  /* -----------------------------------------------------------
     THE FLOATING BALL
  ----------------------------------------------------------- */
  var ball = document.createElement('button');
  ball.type = 'button';
  ball.id = 'nexusAiBall';
  ball.className = 'nexus-ai-ball';
  ball.setAttribute('aria-label', 'Open ' + AI_NAME);
  ball.title = AI_NAME;
  ball.innerHTML = '<span class="nx-ball-icon">' + AI_ICON + '</span><span class="nx-ball-label">' + AI_NAME + '</span>';
  document.body.appendChild(ball);

  // Briefly show the "Nexus AI" label so people notice what the ball is, then
  // collapse it into a plain ball (like Meta AI's bubble).
  setTimeout(function () { ball.classList.add('nx-expanded'); }, 600);
  setTimeout(function () { ball.classList.remove('nx-expanded'); }, 5000);

  /* ===========================================================
     CHAT.HTML — default room + ball
  =========================================================== */
  function initChat() {
    // Nexus AI is PRIVATE per account (like Meta AI): the room id contains the
    // signed-in user's id, and the server only lets that user into it. The same
    // room is used on Contacts.html, so it's one conversation everywhere.
    var uid = (typeof getMyUserId === 'function') ? getMyUserId() : null;
    if (!uid) {                       // not logged in → no private AI; ball sends them to log in
      ball.addEventListener('click', function () { window.location.href = './Login.html'; });
      return;
    }
    AI_ROOM_ID = 'nexus-ai-dm:' + uid;
    // Forget cached AI chats of any OTHER account (or the old shared room) on this phone.
    try {
      ['remix-nexusMessages:', 'app-chat-backup:'].forEach(function (pre) {
        Object.keys(localStorage).forEach(function (k) {
          if (k.indexOf(pre + 'nexus-ai') === 0 && k !== pre + AI_ROOM_ID) localStorage.removeItem(k);
        });
      });
    } catch (e) {}
    var AI_ROOM = { id: AI_ROOM_ID, name: AI_ICON + ' ' + AI_NAME };

    // Always list Nexus AI first, ahead of the other default rooms and any
    // custom rooms. Chat.js calls rebuildRoomList() whenever rooms change.
    if (typeof rebuildRoomList === 'function') {
      rebuildRoomList = function () {
        rooms = [AI_ROOM].concat(
          DEFAULT_ROOMS.filter(function (r) { return r.id !== AI_ROOM_ID; }),
          customRooms
        );
      };
      rebuildRoomList();
    }
    if (typeof renderRooms === 'function') renderRooms();
    if (typeof subscribeToKnownRooms === 'function') subscribeToKnownRooms();

    // Hide the leading "@ai " in bubbles inside the Nexus AI room (it is added
    // automatically on send, the person never has to type it).
    if (typeof highlightText === 'function') {
      var origHighlight = highlightText;
      highlightText = function (text, query) {
        if (activeRoomId === AI_ROOM_ID && typeof text === 'string') {
          text = text.replace(/^@ai\s+/i, '');
        }
        return origHighlight(text, query);
      };
    }

    // In the Nexus AI room every message is meant for the bot, so add "@ai "
    // for the person. Capture phase on document = runs before Chat.js reads it.
    document.addEventListener('submit', function (e) {
      if (e.target !== messageForm || activeRoomId !== AI_ROOM_ID) return;
      var v = messageInput.value.trim();
      if (v && !/^@ai\b/i.test(v)) messageInput.value = '@ai ' + v;
    }, true);

    var defaultPlaceholder = messageInput.getAttribute('placeholder') || '';
    function syncAiRoomState() {
      var inAi = activeRoomId === AI_ROOM_ID;
      document.body.classList.toggle('nexus-ai-active', inAi);
      messageInput.setAttribute('placeholder', inAi ? 'Ask ' + AI_NAME + ' anything…' : defaultPlaceholder);
    }
    // renderMessages() rewrites the room title on every room switch.
    new MutationObserver(syncAiRoomState).observe(activeRoomNameEl, { childList: true, characterData: true, subtree: true });
    syncAiRoomState();

    function goToAiRoom() {
      if (typeof openRoomConversation === 'function') openRoomConversation(AI_ROOM_ID);
      else window.location.href = './Chat.html?room=' + AI_ROOM_ID;
    }
    ball.addEventListener('click', goToAiRoom);

    // Reloading while inside Nexus AI (URL has ?room=nexus-ai) stays in it.
    var wantedRoom = new URLSearchParams(window.location.search).get('room');
    if (wantedRoom === AI_ROOM_ID || wantedRoom === 'nexus-ai') goToAiRoom();
  }

  /* ===========================================================
     CONTACTS.HTML — default contact + ball
  =========================================================== */
  function initContacts() {
    var AI_CONTACT_ID = 'nexus-ai';
    var aiMode = false;
    var aiRoom = null;
    var aiMessages = [];
    var listenersAttached = false;
    var thinkingTimer = null;

    var attachBtn = document.getElementById('dmAttachBtn');
    var voiceBtn = document.getElementById('dmVoiceBtn');

    function myId() { return me && me.id ? String(me.id) : null; }

    /* ---- the contact row, always first in the list ---- */
    function ensureAiRow() {
      if (!contactListEl) return;
      var first = contactListEl.firstElementChild;
      if (first && first.classList.contains('nexus-ai-contact')) {
        first.classList.toggle('active', aiMode);
        return;
      }
      var row = document.createElement('div');
      row.className = 'contact-item nexus-ai-contact' + (aiMode ? ' active' : '');
      row.setAttribute('data-id', AI_CONTACT_ID);
      row.innerHTML =
        '<span class="contact-item-info">' +
        '<span class="contact-avatar nx-ai-avatar">' + AI_ICON + '</span>' +
        '<span class="contact-name">' + AI_NAME + '</span>' +
        '<span class="room-item-custom-tag">AI</span>' +
        '</span>';
      contactListEl.insertBefore(row, contactListEl.firstChild);
    }
    new MutationObserver(ensureAiRow).observe(contactListEl, { childList: true });
    ensureAiRow();

    /* ---- show the ball only when the contacts screen is actually showing ---- */
    function syncBallVisibility() {
      var shown = shellEl && shellEl.style.display !== 'none' && myId();
      ball.classList.toggle('nx-hidden', !shown);
    }
    if (shellEl) new MutationObserver(syncBallVisibility).observe(shellEl, { attributes: true, attributeFilter: ['style'] });
    setInterval(syncBallVisibility, 1500); // `me` loads async, so re-check for a bit
    syncBallVisibility();

    /* ---- rendering the AI conversation ---- */
    function renderAi() {
      if (!aiMode) return;
      var mine = myId();
      if (!aiMessages.length) {
        dmMessagesEl.innerHTML =
          '<div class="nx-ai-welcome">' +
          '<div class="nx-ai-big">' + AI_ICON + '</div>' +
          '<h3>Hi, I\'m ' + AI_NAME + '</h3>' +
          '<p>Ask me anything — game tips, ideas, homework help, or just chat. This conversation is private to you.</p>' +
          '<div class="nx-ai-chips">' +
          '<button type="button" class="nx-ai-chip">Give me a game recommendation</button>' +
          '<button type="button" class="nx-ai-chip">Tell me a joke</button>' +
          '<button type="button" class="nx-ai-chip">Help me write a bio</button>' +
          '</div></div>';
        return;
      }
      dmMessagesEl.innerHTML = aiMessages.map(function (m) {
        var isMe = mine && m.authorId && String(m.authorId) === mine;
        var text = String(m.text || '').replace(/^@ai\s+/i, '');
        var t = m.time ? new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        return '<div class="msg nx-ai-msg ' + (isMe ? 'me' : '') + '">' +
          '<span class="msg-author">' + (isMe ? 'You' : AI_NAME) + '</span>' +
          '<span class="msg-text">' + esc(text) + '</span>' +
          '<span class="msg-time">' + t + '</span>' +
          '</div>';
      }).join('');
      dmMessagesEl.scrollTop = dmMessagesEl.scrollHeight;
    }

    function showThinking(on) {
      clearTimeout(thinkingTimer);
      if (!dmTypingIndicatorEl) return;
      if (!on || !aiMode) { dmTypingIndicatorEl.style.display = 'none'; dmTypingIndicatorEl.textContent = ''; return; }
      dmTypingIndicatorEl.textContent = AI_NAME + ' is thinking…';
      dmTypingIndicatorEl.style.display = 'block';
      thinkingTimer = setTimeout(function () { showThinking(false); }, 25000);
    }

    function attachSocketListeners() {
      if (listenersAttached || !socket) return;
      listenersAttached = true;

      socket.on('chat:history', function (p) {
        if (!p || p.room !== aiRoom) return;
        aiMessages = p.messages || [];
        renderAi();
      });
      socket.on('chat:message', function (p) {
        if (!p || p.room !== aiRoom || !p.message) return;
        if (p.message.id && aiMessages.some(function (m) { return m.id === p.message.id; })) return;
        aiMessages.push(p.message);
        var fromMe = p.message.authorId && String(p.message.authorId) === myId();
        if (!fromMe) showThinking(false);
        renderAi();
      });
      // After a dropped connection, re-join so replies keep arriving.
      socket.on('connect', function () {
        if (aiMode && aiRoom) socket.emit('chat:join', { room: aiRoom });
      });
    }

    function sendToAi(text) {
      text = (text || '').trim();
      if (!text || !socket || !aiRoom) return;
      var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      socket.emit('chat:message', {
        room: aiRoom,
        message: { id: id, author: (me && me.username) || 'You', text: '@ai ' + text.slice(0, 480), time: Date.now() }
      });
      showThinking(true);
    }

    /* ---- entering / leaving the AI conversation ---- */
    function enterAi() {
      if (!socket || !myId()) {
        alert('Still connecting — try again in a moment.');
        return;
      }
      attachSocketListeners();

      aiMode = true;
      activeContact = null; // keeps Contacts.js from treating this as a real DM
      aiRoom = 'nexus-ai-dm:' + myId();
      aiMessages = [];

      document.body.classList.add('nexus-ai-active');
      if (typeof clearDmReplyTarget === 'function') clearDmReplyTarget();
      if (typeof renderDmTypingIndicator === 'function') renderDmTypingIndicator(false);
      var searchBar = document.getElementById('dmSearchBar');
      if (searchBar) searchBar.style.display = 'none';
      var blockedNotice = document.getElementById('dmBlockedNotice');
      if (blockedNotice) blockedNotice.style.display = 'none';
      if (dmPresenceEl) dmPresenceEl.style.display = 'none';

      activeContactNameEl.textContent = AI_NAME;
      activeContactAvatarEl.textContent = AI_ICON;
      activeContactAvatarEl.style.display = 'flex';
      activeContactJoinedEl.textContent = 'AI assistant · always online';
      var callBtns = document.getElementById('dmCallButtons');
      if (callBtns) callBtns.style.display = 'none';

      dmMessageInput.disabled = false;
      dmMessageInput.setAttribute('placeholder', 'Ask ' + AI_NAME + ' anything…');
      var sendBtn = dmMessageForm.querySelector('button[type="submit"]');
      if (sendBtn) sendBtn.disabled = false;
      if (attachBtn) attachBtn.style.display = 'none';
      if (voiceBtn) voiceBtn.style.display = 'none';

      renderAi();
      if (typeof renderContactList === 'function') renderContactList();
      ensureAiRow();
      socket.emit('chat:join', { room: aiRoom });
    }

    function leaveAi() {
      if (!aiMode) return;
      aiMode = false;
      showThinking(false);
      document.body.classList.remove('nexus-ai-active');
      dmMessageInput.setAttribute('placeholder', 'Message this person privately…');
      if (attachBtn) attachBtn.style.display = '';
      if (voiceBtn) voiceBtn.style.display = '';
      ensureAiRow();
    }

    // Any real conversation opening (tap, notification, ?uid= link) leaves AI mode.
    if (typeof openContact === 'function') {
      var origOpenContact = openContact;
      openContact = function () {
        leaveAi();
        return origOpenContact.apply(this, arguments);
      };
    }

    /* ---- events ---- */
    // Capture on the list so we beat Contacts.js's own click handler.
    contactListEl.addEventListener('click', function (e) {
      var row = e.target.closest('.nexus-ai-contact');
      if (!row) return;
      e.stopImmediatePropagation();
      e.stopPropagation();
      if (typeof groupCallSelectMode !== 'undefined' && groupCallSelectMode) return; // AI can't join calls
      setMobileView('conversation');
      enterAi();
    }, true);

    ball.addEventListener('click', function () {
      setMobileView('conversation');
      enterAi();
    });

    document.addEventListener('submit', function (e) {
      if (e.target !== dmMessageForm || !aiMode) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var text = dmMessageInput.value;
      dmMessageInput.value = '';
      sendToAi(text);
    }, true);

    dmMessagesEl.addEventListener('click', function (e) {
      var chip = e.target.closest('.nx-ai-chip');
      if (!chip || !aiMode) return;
      sendToAi(chip.textContent);
    });
  }

  /* -----------------------------------------------------------
     GO
  ----------------------------------------------------------- */
  try {
    if (isChatPage) initChat();
    else initContacts();
  } catch (err) {
    console.error('Nexus AI ball failed to start:', err);
  }
})();
