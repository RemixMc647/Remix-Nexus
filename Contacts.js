/*==============================
REMIX-NEXUS — CONTACTS / DM LOGIC
Lists people you've shared a chat room with, and lets you
message any of them privately, one-to-one, like a DM.
==============================*/

const API_BASE = 'https://remix-nexus-production.up.railway.app';

// Marks this as a full-screen, app-style page on phones/tablets — see the
// mobile rules in Chat.css (shared with Contacts.css). Desktop is unaffected.
document.body.classList.add('app-shell-page');

const loggedOutEl = document.getElementById('contacts-loggedout');
const shellEl = document.getElementById('contacts-shell');
const dmBackBtn = document.getElementById('dmBackBtn');

const contactListEl = document.getElementById('contactList');
const activeContactNameEl = document.getElementById('activeContactName');
const activeContactAvatarEl = document.getElementById('activeContactAvatar');
const activeContactJoinedEl = document.getElementById('activeContactJoined');
const dmConnectionBadge = document.getElementById('dmConnectionBadge');
const dmCallButtons = document.getElementById('dmCallButtons');
const dmVoiceCallBtn = document.getElementById('dmVoiceCallBtn');
const dmVideoCallBtn = document.getElementById('dmVideoCallBtn');
const dmMessagesEl = document.getElementById('dmMessages');
const dmMessageForm = document.getElementById('dmMessageForm');
const dmMessageInput = document.getElementById('dmMessageInput');
const dmAttachBtn = document.getElementById('dmAttachBtn');
const dmMediaInput = document.getElementById('dmMediaInput');
const dmVoiceBtn = document.getElementById('dmVoiceBtn');
const dmRecordingBar = document.getElementById('dmRecordingBar');
const dmRecordingTimerEl = document.getElementById('dmRecordingTimer');
const dmCancelRecordingBtn = document.getElementById('dmCancelRecordingBtn');
const dmStopRecordingBtn = document.getElementById('dmStopRecordingBtn');

let socket = null;
let me = null;
let contacts = [];
let activeContact = null; // { id, username, avatar, ... }
let activeMessages = [];
let dmReplyingTo = null; // { id, author, text }
const onlineUserIds = new Set(); // populated from presence:snapshot / presence:update

function isContactOnline(id){
  return onlineUserIds.has(String(id));
}

function renderActiveContactPresence(){
  if (!activeContact) return;
  const onlineTag = document.getElementById('activeContactOnline');
  if (!onlineTag) return;
  const online = isContactOnline(activeContact.id);
  onlineTag.textContent = online ? 'Online' : '';
  onlineTag.style.display = online ? 'inline' : 'none';
}

function handlePresenceSnapshot({ online } = {}){
  onlineUserIds.clear();
  (online || []).forEach(id => onlineUserIds.add(String(id)));
  renderContactList();
  renderActiveContactPresence();
}

function handlePresenceUpdate({ userId, online } = {}){
  if (!userId) return;
  if (online) onlineUserIds.add(String(userId));
  else onlineUserIds.delete(String(userId));
  renderContactList();
  renderActiveContactPresence();
}

// Reply preview bar isn't part of the original Contacts.html, so it's
// built here at runtime and inserted right above the message form —
// same trick Chat.js uses for its reply preview.
// "Online" indicator next to the contact's name in the header — WhatsApp
// style. Built at runtime so Contacts.html doesn't need to be touched
// beyond the call buttons/back button already added.
if (activeContactNameEl && !document.getElementById('activeContactOnline')) {
  const onlineTag = document.createElement('span');
  onlineTag.id = 'activeContactOnline';
  onlineTag.style.cssText = 'display:none;font-size:11px;color:#22c55e;font-weight:600;margin-left:8px;';
  activeContactNameEl.insertAdjacentElement('afterend', onlineTag);
}

let dmReplyPreviewEl = null;
let dmReplyPreviewAuthorEl = null;
let dmReplyPreviewTextEl = null;
if (dmMessageForm) {
  dmReplyPreviewEl = document.createElement('div');
  dmReplyPreviewEl.id = 'dmReplyPreview';
  dmReplyPreviewEl.className = 'reply-preview';
  dmReplyPreviewEl.style.cssText = 'display:none;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-left:3px solid currentColor;opacity:0.9;';

  const textWrap = document.createElement('div');
  dmReplyPreviewAuthorEl = document.createElement('div');
  dmReplyPreviewAuthorEl.className = 'reply-preview-author';
  dmReplyPreviewAuthorEl.style.cssText = 'font-weight:600;font-size:0.85em;';
  dmReplyPreviewTextEl = document.createElement('div');
  dmReplyPreviewTextEl.className = 'reply-preview-text';
  dmReplyPreviewTextEl.style.cssText = 'font-size:0.85em;opacity:0.8;';
  textWrap.appendChild(dmReplyPreviewAuthorEl);
  textWrap.appendChild(dmReplyPreviewTextEl);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.id = 'dmCancelReplyBtn';
  cancelBtn.textContent = '✕';
  cancelBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1em;';
  cancelBtn.addEventListener('click', clearDmReplyTarget);

  dmReplyPreviewEl.appendChild(textWrap);
  dmReplyPreviewEl.appendChild(cancelBtn);
  dmMessageForm.insertAdjacentElement('beforebegin', dmReplyPreviewEl);
}

// "So-and-so is typing…" line, WhatsApp-style — built at runtime and
// inserted right above the message form, same as the reply preview.
let dmTypingIndicatorEl = document.getElementById('dmTypingIndicator');
if (!dmTypingIndicatorEl && dmMessageForm) {
  dmTypingIndicatorEl = document.createElement('div');
  dmTypingIndicatorEl.id = 'dmTypingIndicator';
  dmTypingIndicatorEl.className = 'typing-indicator';
  dmTypingIndicatorEl.style.cssText = 'display:none;padding:4px 12px;font-size:0.85em;font-style:italic;opacity:0.75;';
  dmMessageForm.insertAdjacentElement('beforebegin', dmTypingIndicatorEl);
}

function setDmReplyTarget(msg){
  if (!msg || !msg.id) return;
  dmReplyingTo = { id: String(msg.id), author: msg.author, text: msg.text };
  if (dmReplyPreviewAuthorEl) dmReplyPreviewAuthorEl.textContent = msg.author;
  if (dmReplyPreviewTextEl) dmReplyPreviewTextEl.textContent = msg.text.length > 120 ? msg.text.slice(0, 120) + '…' : msg.text;
  if (dmReplyPreviewEl) dmReplyPreviewEl.style.display = 'flex';
  if (dmMessageInput) dmMessageInput.focus();
}

function clearDmReplyTarget(){
  dmReplyingTo = null;
  if (dmReplyPreviewEl) dmReplyPreviewEl.style.display = 'none';
}

/* -----------------------------------------------------------
   TYPING INDICATOR — shows only for the conversation currently open.
   Purely visual, nothing persisted.
----------------------------------------------------------- */
let incomingTypingTimeout = null;
const DM_TYPING_STALE_MS = 4000; // if no follow-up "still typing" arrives, assume they stopped

function renderDmTypingIndicator(isTyping){
  if (!dmTypingIndicatorEl) return;
  if (!isTyping || !activeContact){
    dmTypingIndicatorEl.style.display = 'none';
    dmTypingIndicatorEl.textContent = '';
    return;
  }
  dmTypingIndicatorEl.textContent = `${activeContact.username} is typing…`;
  dmTypingIndicatorEl.style.display = 'block';
}

function handleIncomingDmTyping({ fromUserId, isTyping } = {}){
  if (!activeContact || String(fromUserId) !== String(activeContact.id)) return;

  clearTimeout(incomingTypingTimeout);

  if (!isTyping){
    renderDmTypingIndicator(false);
    return;
  }

  renderDmTypingIndicator(true);
  incomingTypingTimeout = setTimeout(() => renderDmTypingIndicator(false), DM_TYPING_STALE_MS);
}

// Debounced outgoing "I'm typing" — fires isTyping:true right away, then
// automatically sends isTyping:false after a pause with no keystrokes.
let outgoingDmTypingActive = false;
let outgoingDmTypingTimeout = null;
const OUTGOING_DM_TYPING_IDLE_MS = 2000;

function emitDmTyping(isTyping){
  if (!socket || !activeContact) return;
  socket.emit('dm:typing', { toUserId: activeContact.id, isTyping });
}

function handleDmTypingInput(){
  if (!activeContact) return;
  if (!outgoingDmTypingActive){
    outgoingDmTypingActive = true;
    emitDmTyping(true);
  }
  clearTimeout(outgoingDmTypingTimeout);
  outgoingDmTypingTimeout = setTimeout(() => {
    outgoingDmTypingActive = false;
    emitDmTyping(false);
  }, OUTGOING_DM_TYPING_IDLE_MS);
}

function stopDmTypingNow(){
  clearTimeout(outgoingDmTypingTimeout);
  if (outgoingDmTypingActive){
    outgoingDmTypingActive = false;
    emitDmTyping(false);
  }
}

if (dmMessageInput){
  dmMessageInput.addEventListener('input', handleDmTypingInput);
}

function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDuration(seconds){
  const total = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* -----------------------------------------------------------
   MOBILE NAVIGATION — WhatsApp/Snapchat-style: on a phone/tablet only
   one panel (the contact list, or an open conversation) is visible at a
   time. Desktop always shows both side by side, unaffected — the CSS
   classes below only do anything under Chat.css's 820px breakpoint.
----------------------------------------------------------- */
function setMobileView(view){
  if (!shellEl) return;
  shellEl.classList.remove('view-list', 'view-conversation');
  shellEl.classList.add(view === 'conversation' ? 'view-conversation' : 'view-list');
}

if (dmBackBtn){
  dmBackBtn.addEventListener('click', () => setMobileView('list'));
}

/* -----------------------------------------------------------
   LAYOUT FIX — same idea as Chat.js: pin the panel's height to the real
   leftover viewport space at every screen size, so the contact list /
   conversation fills the screen with no page-level scrolling.
----------------------------------------------------------- */
const DESKTOP_BREAKPOINT = 821;

function adjustChatShellHeight(){
  const header = document.querySelector('.nav-bar');
  const footer = document.querySelector('.footer');
  const shell = document.querySelector('.chat-shell');
  if (!header || !shell) return;

  const isMobile = window.innerWidth < DESKTOP_BREAKPOINT;

  const headerBottom = header.getBoundingClientRect().bottom;
  const footerHeight = (!isMobile && footer) ? footer.offsetHeight : 0; // footer is hidden on mobile
  const shellStyles = getComputedStyle(shell);
  const shellMarginTop = parseFloat(shellStyles.marginTop) || 0;
  const shellMarginBottom = parseFloat(shellStyles.marginBottom) || 0;
  const buffer = isMobile ? 10 : 20;

  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;

  const available = viewportHeight
    - headerBottom
    - shellMarginTop
    - shellMarginBottom
    - footerHeight
    - buffer;

  document.documentElement.style.setProperty('--chat-shell-height', Math.max(available, isMobile ? 320 : 480) + 'px');
}

window.addEventListener('resize', adjustChatShellHeight);
window.addEventListener('load', adjustChatShellHeight);
if (window.visualViewport) window.visualViewport.addEventListener('resize', adjustChatShellHeight);
adjustChatShellHeight();

/* -----------------------------------------------------------
   UNREAD COUNTS + DESKTOP NOTIFICATIONS
   The badge is per-contact (shown on their name in the sidebar). The
   desktop notification fires for any incoming DM whenever the tab isn't
   actually in front of the person — same trigger WhatsApp Web uses.
----------------------------------------------------------- */
function unreadContactsStorageKey(){
  const uid = me && me.id ? String(me.id) : null;
  return 'remix-nexusUnreadContacts:' + (uid || 'guest');
}

function getUnreadContacts(){
  try {
    const raw = localStorage.getItem(unreadContactsStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveUnreadContacts(counts){
  localStorage.setItem(unreadContactsStorageKey(), JSON.stringify(counts));
}

function bumpUnreadContact(contactId){
  const counts = getUnreadContacts();
  counts[contactId] = (counts[contactId] || 0) + 1;
  saveUnreadContacts(counts);
}

function clearUnreadContact(contactId){
  const counts = getUnreadContacts();
  if (!counts[contactId]) return;
  delete counts[contactId];
  saveUnreadContacts(counts);
}

// The tab counts as "not being looked at" if it's hidden (a different tab
// or app is in front) or the browser window itself doesn't have focus.
function isAppInForeground(){
  return document.visibilityState === 'visible' && document.hasFocus();
}

if ('Notification' in window && Notification.permission === 'default'){
  Notification.requestPermission().catch(() => {});
}

function notifyNewDM(payload, otherId){
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (isAppInForeground()) return;

  const contact = contacts.find(c => c.id === otherId);
  const name = contact ? contact.username : 'New message';
  const preview = payload.text
    || (payload.audio ? '🎤 Voice note' : (payload.media ? (payload.media.type === 'video' ? '🎬 Video' : '🖼️ Photo') : ''));

  try {
    const n = new Notification(name, {
      body: preview,
      tag: 'dm:' + otherId // replaces any earlier notification for this same conversation instead of stacking
    });
    n.onclick = () => {
      window.focus();
      openContact(otherId, contact ? { username: contact.username, avatar: contact.avatar } : { username: name });
      setMobileView('conversation');
      n.close();
    };
  } catch (err) {
    console.error('Notification error:', err);
  }
}

// When the tab regains focus, whatever conversation is currently open
// counts as "seen" again — clear its badge.
function handleDmForegroundReturn(){
  if (isAppInForeground() && activeContact){
    clearUnreadContact(activeContact.id);
    renderContactList();
  }
}
window.addEventListener('focus', handleDmForegroundReturn);
document.addEventListener('visibilitychange', handleDmForegroundReturn);

function updateDmBadge(){
  if (!dmConnectionBadge) return;
  if (!socket){
    dmConnectionBadge.textContent = 'Offline';
    return;
  }
  dmConnectionBadge.textContent = socket.connected ? 'Live' : 'Connecting…';
}

function renderContactList(){
  if (!contacts.length){
    contactListEl.innerHTML = '<p class="empty-state">No contacts yet — chat in a room first, then people you talk with will show up here.</p>';
    return;
  }

  const unread = getUnreadContacts();

  contactListEl.innerHTML = contacts.map(c => {
    const count = unread[c.id] || 0;
    const online = isContactOnline(c.id);
    return `
    <div class="contact-item ${activeContact && activeContact.id === c.id ? 'active' : ''}" data-id="${c.id}">
      <span class="contact-item-info">
        <span class="contact-avatar" style="position:relative;">
          ${c.avatar || '🎮'}
          ${online ? '<span style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid #0a0e17;"></span>' : ''}
        </span>
        <span class="contact-name">${escapeHTML(c.username)}</span>
      </span>
      ${count > 0 ? `<span class="room-count">${count > 99 ? '99+' : count}</span>` : ''}
    </div>
  `;
  }).join('');
}

function renderDMMessages(){
  if (!activeMessages.length){
    dmMessagesEl.innerHTML = '<p class="empty-state">No messages yet — say hi 👋</p>';
    return;
  }

  dmMessagesEl.innerHTML = activeMessages.map(m => {
    const isMe = String(m.fromUserId) === String(me.id);
    const hasMedia = m.media && m.media.data;
    const hasAudio = m.audio && m.audio.data;

    let bodyBlock;
    if (hasMedia){
      bodyBlock = m.media.type === 'video'
        ? `<div class="media-note"><video controls preload="metadata" src="${m.media.data}"></video></div>`
        : `<div class="media-note"><img src="${m.media.data}" alt="Shared image" loading="lazy"></div>`;
    } else if (hasAudio){
      bodyBlock = `<div class="voice-note">
           <audio controls preload="metadata" src="${m.audio.data}"></audio>
           <span class="voice-note-duration">${formatDuration(m.audio.duration)}</span>
         </div>`;
    } else {
      bodyBlock = `<span class="msg-text">${escapeHTML(m.text)}</span>`;
    }

    const replyBlock = m.replyTo
      ? `<div class="msg-quote">
           <span class="msg-quote-author">${escapeHTML(m.replyTo.author)}</span>
           <span class="msg-quote-text">${escapeHTML(m.replyTo.text)}</span>
         </div>`
      : '';

    const replyText = m.text || (hasAudio ? '🎤 Voice note' : (hasMedia ? (m.media.type === 'video' ? '🎬 Video' : '🖼️ Photo') : ''));
    const authorName = isMe ? (me.username || 'You') : (activeContact ? activeContact.username : '');

    // Voice notes and media messages can't be edited, only deleted —
    // same rule as room chat.
    const editBtn = (isMe && !hasMedia && !hasAudio)
      ? `<button type="button" class="msg-edit-btn" title="Edit message">✏️</button>`
      : '';

    return `
      <div class="msg ${isMe ? 'me' : ''}" data-id="${m.id}" data-author="${escapeHTML(authorName)}" data-text="${escapeHTML(replyText)}">
        <span class="msg-reply-icon" title="Reply">↩</span>
        ${replyBlock}
        <span class="msg-author">${isMe ? 'You' : escapeHTML(activeContact.username)}</span>
        ${bodyBlock}
        <span class="msg-time">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}${m.edited ? ' · edited' : ''}</span>
        ${isMe ? `
          <span class="msg-actions">
            ${editBtn}
            <button type="button" class="msg-delete-btn" title="Delete message">🗑️</button>
          </span>
        ` : ''}
      </div>
    `;
  }).join('');

  dmMessagesEl.scrollTop = dmMessagesEl.scrollHeight;
}

async function loadContacts(){
  try {
    const res = await fetch(API_BASE + '/api/contacts', {
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });
    const data = await res.json();
    contacts = data.contacts || [];
    renderContactList();
  } catch (err) {
    contactListEl.innerHTML = '<p class="empty-state">Could not load contacts. Please try again later.</p>';
  }
}

function renderContactHeader(contact){
  activeContactNameEl.textContent = contact.username;

  if (contact.avatar){
    activeContactAvatarEl.textContent = contact.avatar;
    activeContactAvatarEl.style.display = 'flex';
  } else {
    activeContactAvatarEl.style.display = 'none';
  }

  if (contact.createdAt){
    const joined = new Date(contact.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    activeContactJoinedEl.textContent = 'Member since ' + joined;
  } else {
    activeContactJoinedEl.textContent = '';
  }

  if (dmCallButtons) dmCallButtons.style.display = 'flex';
  renderActiveContactPresence();
}

if (dmVoiceCallBtn){
  dmVoiceCallBtn.addEventListener('click', () => {
    if (!activeContact || !window.RemixCalls) return;
    RemixCalls.startDMCall(activeContact.id, activeContact.username, activeContact.avatar, 'voice');
  });
}

if (dmVideoCallBtn){
  dmVideoCallBtn.addEventListener('click', () => {
    if (!activeContact || !window.RemixCalls) return;
    RemixCalls.startDMCall(activeContact.id, activeContact.username, activeContact.avatar, 'video');
  });
}

// `fallback` lets us open a conversation with someone who isn't in the
// contacts list yet — e.g. arriving here from a "view profile" link
// elsewhere in the app. Once messages are exchanged, the server-side
// contacts list (persisted in MongoDB) will include them permanently too.
async function openContact(contactId, fallback){
  let contact = contacts.find(c => c.id === contactId);

  if (!contact && fallback){
    contact = { id: contactId, username: fallback.username || 'Player', avatar: fallback.avatar || '' };
    contacts = [contact, ...contacts];
  }

  if (!contact) return;

  activeContact = contact;
  clearUnreadContact(contactId);
  clearDmReplyTarget();
  renderDmTypingIndicator(false);
  clearTimeout(incomingTypingTimeout);
  renderContactHeader(contact);
  renderContactList();

  dmMessageInput.disabled = false;
  dmMessageForm.querySelector('button[type="submit"]').disabled = false;
  if (dmAttachBtn) dmAttachBtn.disabled = false;
  if (dmVoiceBtn) dmVoiceBtn.disabled = false;
  dmMessagesEl.innerHTML = '<p class="empty-state">Loading conversation…</p>';

  try {
    const res = await fetch(API_BASE + '/api/dm/' + encodeURIComponent(contactId), {
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });
    const data = await res.json();

    if (!res.ok){
      dmMessagesEl.innerHTML = `<p class="empty-state">${escapeHTML(data.error || 'Could not load this conversation.')}</p>`;
      return;
    }

    // The server's user record is the source of truth (correct current
    // username/avatar/join date), so refresh the contact + header with it.
    if (data.user){
      activeContact = { id: contactId, username: data.user.username, avatar: data.user.avatar, createdAt: data.user.createdAt };
      contacts = contacts.map(c => c.id === contactId ? { ...c, ...activeContact } : c);
      renderContactHeader(activeContact);
      renderContactList();
    }

    activeMessages = data.messages || [];
    renderDMMessages();
  } catch (err) {
    dmMessagesEl.innerHTML = '<p class="empty-state">Could not reach the server.</p>';
  }
}

contactListEl.addEventListener('click', (e) => {
  const item = e.target.closest('.contact-item');
  if (!item) return;
  openContact(item.dataset.id);
  setMobileView('conversation');
});

dmMessagesEl.addEventListener('click', (e) => {
  const replyIcon = e.target.closest('.msg-reply-icon');
  if (replyIcon){
    const msgEl = replyIcon.closest('.msg');
    if (msgEl) setDmReplyTarget({ id: msgEl.dataset.id, author: msgEl.dataset.author, text: msgEl.dataset.text });
    return;
  }

  const editBtn = e.target.closest('.msg-edit-btn');
  const deleteBtn = e.target.closest('.msg-delete-btn');
  if (!editBtn && !deleteBtn) return;

  const msgEl = e.target.closest('.msg');
  const messageId = msgEl && msgEl.dataset.id;
  if (!messageId || !socket) return;

  if (editBtn) {
    const current = activeMessages.find(m => String(m.id) === String(messageId));
    if (!current) return;

    const next = window.prompt('Edit message:', current.text);
    if (next === null) return; // cancelled

    const trimmed = next.trim();
    if (!trimmed || trimmed === current.text) return;

    socket.emit('dm:message:edit', { messageId, text: trimmed });
  }

  if (deleteBtn) {
    if (!window.confirm('Delete this message? This can\'t be undone.')) return;
    socket.emit('dm:message:delete', { messageId });
  }
});

// Right-click (desktop) also starts a reply — same convenience Chat.js offers.
dmMessagesEl.addEventListener('contextmenu', (e) => {
  const msgEl = e.target.closest('.msg');
  if (!msgEl) return;
  e.preventDefault();
  setDmReplyTarget({ id: msgEl.dataset.id, author: msgEl.dataset.author, text: msgEl.dataset.text });
});

// Swipe-left-to-reply on touch devices — same gesture as room chat.
let dmTouchState = null; // { msgEl, startX, startY, active }
const DM_SWIPE_TRIGGER_PX = 60;
const DM_SWIPE_MAX_PX = 90;

dmMessagesEl.addEventListener('touchstart', (e) => {
  const msgEl = e.target.closest('.msg');
  if (!msgEl) return;
  const touch = e.touches[0];
  dmTouchState = { msgEl, startX: touch.clientX, startY: touch.clientY, active: false };
}, { passive: true });

dmMessagesEl.addEventListener('touchmove', (e) => {
  if (!dmTouchState) return;
  const touch = e.touches[0];
  const deltaX = touch.clientX - dmTouchState.startX;
  const deltaY = touch.clientY - dmTouchState.startY;

  if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5 && deltaX < 0){
    dmTouchState.active = true;
    const clamped = Math.max(deltaX, -DM_SWIPE_MAX_PX);
    dmTouchState.msgEl.style.transform = `translateX(${clamped}px)`;
  }
}, { passive: true });

dmMessagesEl.addEventListener('touchend', () => {
  if (!dmTouchState) return;
  const { msgEl, active } = dmTouchState;

  const transform = msgEl.style.transform;
  const match = /translateX\((-?\d+(\.\d+)?)px\)/.exec(transform);
  const deltaX = match ? parseFloat(match[1]) : 0;
  msgEl.style.transform = '';

  if (active && deltaX <= -DM_SWIPE_TRIGGER_PX){
    setDmReplyTarget({ id: msgEl.dataset.id, author: msgEl.dataset.author, text: msgEl.dataset.text });
  }

  dmTouchState = null;
});

function handleDmEdited({ messageId, text }){
  const target = activeMessages.find(m => String(m.id) === String(messageId));
  if (!target) return;
  target.text = text;
  target.edited = true;
  renderDMMessages();
}

function handleDmDeleted({ messageId }){
  const before = activeMessages.length;
  activeMessages = activeMessages.filter(m => String(m.id) !== String(messageId));
  if (activeMessages.length !== before) renderDMMessages();
}

dmMessageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = dmMessageInput.value.trim();
  if (!text || !activeContact || !socket) return;

  stopDmTypingNow();
  socket.emit('dm:message', {
    toUserId: activeContact.id,
    text,
    replyTo: dmReplyingTo ? { id: dmReplyingTo.id, author: dmReplyingTo.author, text: dmReplyingTo.text } : null
  });
  dmMessageInput.value = '';
  clearDmReplyTarget();
});

/* -----------------------------------------------------------
   PHOTOS & VIDEOS — same data-URL approach as room chat's
   voice notes, just sent over the dm:message channel.
----------------------------------------------------------- */
function dmBlobToDataURL(blob){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;  // ~4.5MB of actual image
const MAX_VIDEO_DATA_URL_LENGTH = 16_000_000; // ~12MB of actual video — keep clips short
const MAX_VIDEO_DURATION_SECONDS = 30 * 60;   // videos over 30 minutes are rejected

// Reads how long a video file is by loading just its metadata (not the
// whole file) into an off-DOM <video> element. Resolves with NaN if the
// browser can't determine it, so callers can decide how to handle that.
function getVideoDurationSeconds(file){
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanUp = () => URL.revokeObjectURL(video.src);

    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanUp();
      resolve(Number.isFinite(duration) ? duration : NaN);
    };
    video.onerror = () => {
      cleanUp();
      resolve(NaN);
    };

    video.src = URL.createObjectURL(file);
  });
}

async function sendDmMedia(file){
  if (!file || !activeContact || !socket) return;

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage){
    alert('Only photos and videos can be sent this way.');
    return;
  }

  if (isVideo){
    const durationSeconds = await getVideoDurationSeconds(file);
    if (Number.isFinite(durationSeconds) && durationSeconds > MAX_VIDEO_DURATION_SECONDS){
      alert('That video is too long to send — videos can be at most 30 minutes.');
      return;
    }
  }

  const dataUrl = await dmBlobToDataURL(file);
  const limit = isVideo ? MAX_VIDEO_DATA_URL_LENGTH : MAX_IMAGE_DATA_URL_LENGTH;

  if (dataUrl.length > limit){
    alert(isVideo
      ? 'That video is too large to send — try a shorter clip or lower resolution.'
      : 'That image is too large to send — try a smaller file.');
    return;
  }

  socket.emit('dm:message', {
    toUserId: activeContact.id,
    text: '',
    media: { type: isVideo ? 'video' : 'image', data: dataUrl },
    replyTo: dmReplyingTo ? { id: dmReplyingTo.id, author: dmReplyingTo.author, text: dmReplyingTo.text } : null
  });
  clearDmReplyTarget();
}

if (dmAttachBtn && dmMediaInput){
  dmAttachBtn.addEventListener('click', () => {
    if (!activeContact) return;
    dmMediaInput.click();
  });

  dmMediaInput.addEventListener('change', () => {
    const file = dmMediaInput.files && dmMediaInput.files[0];
    dmMediaInput.value = ''; // reset so picking the same file again still fires 'change'
    if (file) sendDmMedia(file);
  });
}

/* -----------------------------------------------------------
   VOICE NOTES — record with MediaRecorder, send as a data URL,
   same approach as room chat.
----------------------------------------------------------- */
const MAX_RECORDING_SECONDS = 120; // keeps things reasonable
const MAX_AUDIO_DATA_URL_LENGTH = 2_000_000; // ~1.5MB of actual audio

let dmMediaRecorder = null;
let dmRecordedChunks = [];
let dmRecordingStartTime = 0;
let dmRecordingTimerInterval = null;
let dmRecordingCancelled = false;

function pickAudioMimeType(){
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function showDmRecordingUI(){
  if (!dmRecordingBar) return;
  dmMessageForm.style.display = 'none';
  dmRecordingBar.classList.add('active');
}

function hideDmRecordingUI(){
  if (!dmRecordingBar) return;
  dmMessageForm.style.display = 'flex';
  dmRecordingBar.classList.remove('active');
  if (dmRecordingTimerEl) dmRecordingTimerEl.textContent = '0:00';
}

async function startDmRecording(){
  if (!activeContact || !socket) return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    alert("Voice notes need microphone access, and this browser doesn't support it.");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    alert('Microphone access was blocked. Allow it in your browser settings to send voice notes.');
    return;
  }

  dmRecordedChunks = [];
  dmRecordingCancelled = false;

  const mimeType = pickAudioMimeType();
  dmMediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  dmMediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) dmRecordedChunks.push(e.data);
  });

  dmMediaRecorder.addEventListener('stop', () => {
    stream.getTracks().forEach(track => track.stop());
    clearInterval(dmRecordingTimerInterval);
    hideDmRecordingUI();

    if (dmRecordingCancelled || dmRecordedChunks.length === 0) return;

    const durationSeconds = Math.min(
      MAX_RECORDING_SECONDS,
      Math.round((Date.now() - dmRecordingStartTime) / 1000)
    );

    const blob = new Blob(dmRecordedChunks, { type: dmMediaRecorder.mimeType || 'audio/webm' });
    sendDmVoiceNote(blob, durationSeconds);
  });

  dmMediaRecorder.start();
  dmRecordingStartTime = Date.now();
  showDmRecordingUI();

  dmRecordingTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - dmRecordingStartTime) / 1000;
    if (dmRecordingTimerEl) dmRecordingTimerEl.textContent = formatDuration(elapsed);
    if (elapsed >= MAX_RECORDING_SECONDS) stopDmRecording(false);
  }, 250);
}

function stopDmRecording(cancelled){
  if (!dmMediaRecorder || dmMediaRecorder.state === 'inactive') return;
  dmRecordingCancelled = !!cancelled;
  dmMediaRecorder.stop();
}

async function sendDmVoiceNote(blob, durationSeconds){
  if (!activeContact || !socket) return;

  const dataUrl = await dmBlobToDataURL(blob);

  if (dataUrl.length > MAX_AUDIO_DATA_URL_LENGTH){
    alert('That voice note is too long to send — try keeping it under about a minute.');
    return;
  }

  socket.emit('dm:message', {
    toUserId: activeContact.id,
    text: '',
    audio: { data: dataUrl, duration: durationSeconds },
    replyTo: dmReplyingTo ? { id: dmReplyingTo.id, author: dmReplyingTo.author, text: dmReplyingTo.text } : null
  });
  clearDmReplyTarget();
}

if (dmVoiceBtn){
  dmVoiceBtn.addEventListener('click', () => {
    if (!activeContact) return;
    if (dmMediaRecorder && dmMediaRecorder.state === 'recording') return;
    startDmRecording();
  });
}

if (dmStopRecordingBtn) dmStopRecordingBtn.addEventListener('click', () => stopDmRecording(false));
if (dmCancelRecordingBtn) dmCancelRecordingBtn.addEventListener('click', () => stopDmRecording(true));

function handleIncomingDM(payload){
  const isMine = String(payload.fromUserId) === String(me.id);
  const otherId = isMine ? String(payload.toUserId) : String(payload.fromUserId);

  const isActiveConversation = activeContact && String(activeContact.id) === otherId;

  if (isActiveConversation){
    activeMessages.push(payload);

    if (isAppInForeground()){
      clearUnreadContact(otherId);
    } else if (!isMine){
      bumpUnreadContact(otherId);
    }

    renderDMMessages();
    renderContactList();

    if (!isMine) notifyNewDM(payload, otherId);
    return;
  }

  if (isMine) return; // don't badge/notify for my own messages sent from another tab

  bumpUnreadContact(otherId);
  renderContactList();
  notifyNewDM(payload, otherId);

  // A message from someone not yet in the sidebar (a brand-new
  // conversation partner) — refresh from the server so they show up.
  if (!contacts.some(c => c.id === otherId)) loadContacts();
}

(async function init(){
  if (!AUTH.isLoggedIn()){
    loggedOutEl.style.display = 'block';
    shellEl.style.display = 'none';
    return;
  }

  me = await AUTH.fetchMe();

  if (!me){
    loggedOutEl.style.display = 'block';
    shellEl.style.display = 'none';
    return;
  }

  loggedOutEl.style.display = 'none';
  shellEl.style.display = 'grid';

  socket = window.io ? io(API_BASE, { auth: { token: AUTH.getToken() } }) : null;

  if (socket){
    socket.on('connect', updateDmBadge);
    socket.on('disconnect', updateDmBadge);
    socket.on('connect_error', updateDmBadge);
    socket.on('dm:message', handleIncomingDM);
    socket.on('dm:message:edited', handleDmEdited);
    socket.on('dm:message:deleted', handleDmDeleted);
    socket.on('dm:typing', handleIncomingDmTyping);
    socket.on('presence:snapshot', handlePresenceSnapshot);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('chat:error', (payload) => {
      if (payload && payload.message) window.alert(payload.message);
    });

    if (window.RemixCalls){
      RemixCalls.init(socket, {
        getMyUserId: () => me ? me.id : null,
        getMyUsername: () => me ? me.username : 'You',
        getMyAvatar: () => me ? me.avatar : '🎮'
      });
    }
  }
  updateDmBadge();

  await loadContacts();

  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid');
  if (uid && uid !== String(me.id)){
    setMobileView('conversation');
    openContact(uid, {
      username: params.get('username') || '',
      avatar: params.get('avatar') || ''
    });
  } else {
    // Start on the contact list, same as opening WhatsApp fresh, until
    // someone actually taps a conversation.
    setMobileView('list');
  }
})();