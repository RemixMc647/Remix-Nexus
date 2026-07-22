/*==============================
REMIX-NEXUS — CONTACTS / DM LOGIC
Lists people you've shared a chat room with, and lets you
message any of them privately, one-to-one, like a DM.
==============================*/

const API_BASE = 'https://remix-nexus-bgz9.onrender.com';

// Marks this as a full-screen, app-style page on phones/tablets — see the
// mobile rules in Chat.css (shared with Contacts.css). Desktop is unaffected.
document.body.classList.add('app-shell-page');

/* -----------------------------------------------------------
   SERVER STATUS BANNER — Render's free tier spins the backend down
   after ~15 min idle, so the first connection attempt after that can
   take up to a minute (cold start). Rather than let DMs silently fail
   to connect, show a friendly banner for as long as that takes, and
   hide it the moment we're actually connected.
----------------------------------------------------------- */
const serverStatusBanner = document.getElementById('serverStatusBanner');
const serverStatusBannerText = document.getElementById('serverStatusBannerText');
let bannerShowTimer = null;
let bannerSlowTimer = null;

function showServerBanner(){
  if (!serverStatusBanner) return;
  if (serverStatusBannerText) serverStatusBannerText.textContent = 'Waking up the server, this can take up to a minute…';
  serverStatusBanner.classList.add('visible');
  clearTimeout(bannerSlowTimer);
  bannerSlowTimer = setTimeout(() => {
    if (serverStatusBanner.classList.contains('visible') && serverStatusBannerText) {
      serverStatusBannerText.textContent = 'Still waking up the server — thanks for your patience…';
    }
  }, 15000);
}

function hideServerBanner(){
  if (!serverStatusBanner) return;
  clearTimeout(bannerShowTimer);
  clearTimeout(bannerSlowTimer);
  serverStatusBanner.classList.remove('visible');
}

// Don't flash the banner for a brief network blip — only show it if the
// disconnect/reconnect attempt lasts more than ~2 seconds.
function scheduleServerBanner(){
  if (bannerShowTimer || (serverStatusBanner && serverStatusBanner.classList.contains('visible'))) return;
  bannerShowTimer = setTimeout(showServerBanner, 2000);
}

// socket itself is created later, inside init() below (only once we know
// the person is logged in) — attachServerStatusBanner() wires these same
// handlers onto it the moment it exists.
let hasConnectedOnce = false;

function attachServerStatusBanner(socketInstance){
  if (!socketInstance) return;
  socketInstance.on('connect', () => { hasConnectedOnce = true; hideServerBanner(); });
  socketInstance.on('disconnect', () => { hasConnectedOnce = false; scheduleServerBanner(); });
  socketInstance.on('connect_error', scheduleServerBanner);
  // Reconnection lifecycle events (reconnect_attempt/reconnect_error/etc.)
  // actually fire on the Manager (socketInstance.io), not the socket
  // itself — this covers "already connected once, then dropped" cases.
  socketInstance.io.on('reconnect_attempt', scheduleServerBanner);

  // IMPORTANT: on Render's free tier, a sleeping backend usually doesn't
  // throw a connection *error* while waking up — it just holds the very
  // first request open until the container finishes booting, then answers
  // normally. That means 'connect_error' may never fire for a cold start,
  // so relying on error events alone misses it entirely. This proactively
  // shows the banner if we simply haven't connected a few seconds after
  // the socket was created, which catches that silent-wait case too.
  setTimeout(() => {
    if (!hasConnectedOnce) scheduleServerBanner();
  }, 3000);
}

// Manual test: open DevTools console on this page and run
// window.__testServerBanner() to force it visible for a few seconds,
// without needing to wait for an actual Render cold start.
window.__testServerBanner = () => {
  showServerBanner();
  setTimeout(hideServerBanner, 5000);
};

const loggedOutEl = document.getElementById('contacts-loggedout');
const shellEl = document.getElementById('contacts-shell');
const dmBackBtn = document.getElementById('dmBackBtn');

const contactListEl = document.getElementById('contactList');
const activeContactNameEl = document.getElementById('activeContactName');
const activeContactAvatarEl = document.getElementById('activeContactAvatar');
const activeContactJoinedEl = document.getElementById('activeContactJoined');
const dmConnectionBadge = document.getElementById('dmConnectionBadge');
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
const dmBlockBtn = document.getElementById('dmBlockBtn');

let socket = null;
let me = null;
let contacts = [];
let activeContact = null; // { id, username, avatar, ... }
let activeMessages = [];
let dmReplyingTo = null; // { id, author, text }

// Site owner (see isRoomOwner/OWNER_USER_IDS on the server) can delete
// ANY DM in a conversation, not just their own — same override as room
// chat gets in Chat.js.
let isSiteOwner = false;

// Block status for the conversation currently open — refreshed every
// time a contact is opened, from /api/dm/:userId.
let blockStatus = { iBlockedThem: false, theyBlockedMe: false };

// Every user id (as a string) that the logged-in account has blocked —
// powers the "Blocked" tag in the contact list.
let blockedIds = new Set();

// PRESENCE — who's currently online, keyed by userId (always compared as
// strings since ids can arrive as either numbers or strings from Mongo).
let onlineUserIds = new Set();

function isContactOnline(userId){
  return onlineUserIds.has(String(userId));
}

// Only this account's own /api/me response says whether it's a site
// owner — see the matching function in Chat.js.
async function fetchOwnerStatus(){
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const data = await res.json();
    isSiteOwner = !!(data.user && data.user.isOwner);
    renderDMMessages();
  } catch (err) {
    console.error('Could not check owner status:', err);
  }
}

async function loadBlockedIds(){
  try {
    const res = await fetch(API_BASE + '/api/blocked', {
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });
    if (!res.ok) return;
    const data = await res.json();
    blockedIds = new Set((data.users || []).map(u => String(u.id)));
    renderContactList();
  } catch (err) {
    console.error('Could not load blocked users:', err);
  }
}

// Reply preview bar isn't part of the original Contacts.html, so it's
// built here at runtime and inserted right above the message form —
// same trick Chat.js uses for its reply preview.
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

// "🟢 Online" line under the active contact's name in the header — built
// at runtime and dropped into the existing header text column, right
// after the "Member since…" subtext.
let dmPresenceEl = document.getElementById('dmPresence');
if (!dmPresenceEl && activeContactJoinedEl) {
  dmPresenceEl = document.createElement('span');
  dmPresenceEl.id = 'dmPresence';
  dmPresenceEl.className = 'chat-header-subtext dm-presence';
  dmPresenceEl.style.cssText = 'display:none;';
  activeContactJoinedEl.insertAdjacentElement('afterend', dmPresenceEl);
}

function renderPresenceForHeader(){
  if (!dmPresenceEl || !activeContact) return;
  if (isContactOnline(activeContact.id)){
    dmPresenceEl.textContent = '🟢 Online';
    dmPresenceEl.style.display = 'block';
    dmPresenceEl.style.color = '#3ddc84';
  } else {
    dmPresenceEl.style.display = 'none';
  }
}

function isNativeApp() {
    return !!window.Capacitor;
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

// READ RECEIPT — fires when the other person has just opened this
// conversation. Flips `seen` on every message of mine currently shown
// (only messages TO them matter, but everything else is already true/
// irrelevant) so the ✓✓ turns blue without waiting for a full reload.
function handleIncomingDmSeen({ byUserId } = {}){
  if (!byUserId || !activeContact || String(byUserId) !== String(activeContact.id)) return;

  let changed = false;
  activeMessages = activeMessages.map(m => {
    if (!m.seen && String(m.fromUserId) === String(me.id) && String(m.toUserId) === String(byUserId)){
      changed = true;
      return { ...m, seen: true };
    }
    return m;
  });

  if (changed) renderDMMessages();
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

function isNativeApp() {
    return !!window.Capacitor;
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

// NOTE: this page used to unconditionally wipe every cached
// "remix-nexusMessages:*" key on load — which also cleared room chat's
// local cache (Chat.js) any time someone simply visited Contacts.html,
// even though DMs here were never stored under that key in the first
// place. Removed — see Settings ▸ Clear All Chats for the real,
// user-initiated way to clear local chat history.

/* -----------------------------------------------------------
   MOBILE NAVIGATION — WhatsApp/Snapchat-style: on a phone/tablet only
   one panel (the contact list, or an open conversation) is visible at a
   time. Desktop always shows both side by side, unaffected — the CSS
   classes below only do anything under Chat.css's 820px breakpoint.
----------------------------------------------------------- */
// Injects the CSS needed for full-screen conversation mode below, once —
// kept here in JS (instead of Chat.css) so this works immediately without
// needing a separate CSS deploy. Chat.js injects the same block (guarded
// by the same id), so whichever page loads first wins — no duplicates.
(function ensureFullScreenStyles(){
  if (document.getElementById('chat-fullscreen-style')) return;
  const style = document.createElement('style');
  style.id = 'chat-fullscreen-style';
  style.textContent = `
    @media (max-width: 820px) {
      body.conversation-fullscreen .nav-bar,
      body.conversation-fullscreen .footer {
        display: none !important;
      }
      body.conversation-fullscreen .chat-shell,
      body.conversation-fullscreen #contacts-shell {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: 100% !important;
        margin: 0 !important;
        border-radius: 0 !important;
        z-index: 1000;
      }
    }
  `;
  document.head.appendChild(style);
})();

function setMobileView(view){
  if (!shellEl) return;
  shellEl.classList.remove('view-list', 'view-conversation');
  shellEl.classList.add(view === 'conversation' ? 'view-conversation' : 'view-list');

  // WhatsApp-style: while a DM is open on mobile, hide the top nav bar
  // + footer entirely and let the conversation fill the whole screen.
  // Desktop is unaffected — the @media rule above only applies under 820px.
  document.body.classList.toggle('conversation-fullscreen', view === 'conversation');

  // The nav bar just changed height (or disappeared), so the panel's
  // pinned height needs to be recalculated against the new layout.
  if (typeof adjustChatShellHeight === 'function') {
    requestAnimationFrame(adjustChatShellHeight);
  }
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

/* -----------------------------------------------------------
   PRESENCE — tracks which contacts are currently online and reflects it
   in the sidebar (green dot) and the open conversation's header.

   Expects the server to emit, over the same socket used for DMs:
     'presence:online'  { userId }              — someone just connected
     'presence:offline' { userId }               — someone just disconnected
     'presence:online:list' { userIds: [...] }   — full snapshot, sent
                                                    once right after connect
   If your server doesn't have these yet, they're cheap to add: track
   connected userIds in a Set/Map on the socket server, broadcast
   'presence:online'/'presence:offline' on each socket connect/disconnect
   (from the decoded auth token, same as the rest of this app's auth),
   and on a fresh connection emit 'presence:online:list' back to just
   that socket with the current Set.
----------------------------------------------------------- */
function handlePresenceOnline({ userId } = {}){
  if (userId === undefined || userId === null) return;
  onlineUserIds.add(String(userId));
  renderContactList();
  renderPresenceForHeader();
  if (activeContact && String(activeContact.id) === String(userId)){
    notifyContactOnline(activeContact);
  }
}

function handlePresenceOffline({ userId } = {}){
  if (userId === undefined || userId === null) return;
  onlineUserIds.delete(String(userId));
  renderContactList();
  renderPresenceForHeader();
}

function handlePresenceOnlineList({ userIds } = {}){
  onlineUserIds = new Set((userIds || []).map(String));
  renderContactList();
  renderPresenceForHeader();
}

// Desktop notification for "X is online" — only for the person you
// currently have open, and only when you're not actively looking at the
// tab (same foreground check the message notifications use), so it
// doesn't fire constantly while you're mid-conversation with them.
function notifyContactOnline(contact){
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (isAppInForeground()) return;

  try {
    const n = new Notification(contact.username, {
      body: '🟢 is now online',
      tag: 'presence:' + contact.id // replaces any earlier online-notification for this same person
    });
    n.onclick = () => {
      window.focus();
      openContact(contact.id, { username: contact.username, avatar: contact.avatar });
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
    markConversationSeen(activeContact.id);
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
    const isBlocked = blockedIds.has(String(c.id));
    return `
    <div class="contact-item ${activeContact && activeContact.id === c.id ? 'active' : ''}" data-id="${c.id}">
      <span class="contact-item-info">
        <span class="contact-avatar${online ? ' is-online' : ''}">${c.avatar || '🎮'}${online ? '<span class="online-dot" title="Online"></span>' : ''}</span>
        <span class="contact-name">${escapeHTML(c.username)}</span>
        ${isBlocked ? '<span class="room-item-custom-tag">Blocked</span>' : ''}
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

    // The site owner can delete ANY message in the conversation (like a
    // WhatsApp group admin), not just their own — real enforcement is
    // server-side, in dm:message:delete.
    const canDelete = isMe || isSiteOwner;

    // WhatsApp-style read receipt — only shown on messages I sent.
    // Single grey ✓ = sent, double blue ✓✓ = the other person has opened
    // this conversation since I sent it (see the dm:seen socket handler).
    const tickBlock = isMe
      ? `<span class="msg-tick" style="margin-left:4px;letter-spacing:-2px;color:${m.seen ? '#53bdeb' : 'inherit'};opacity:${m.seen ? '1' : '0.6'};">${m.seen ? '✓✓' : '✓'}</span>`
      : '';

    return `
      <div class="msg ${isMe ? 'me' : ''}" data-id="${m.id}" data-author="${escapeHTML(authorName)}" data-text="${escapeHTML(replyText)}">
        <span class="msg-reply-icon" title="Reply">↩</span>
        ${replyBlock}
        <span class="msg-author">${isMe ? 'You' : escapeHTML(activeContact.username)}</span>
        ${bodyBlock}
        <span class="msg-time">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}${m.edited ? ' · edited' : ''}${tickBlock}</span>
        ${canDelete ? `
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

  const dmCallButtonsEl = document.getElementById('dmCallButtons');
  if (dmCallButtonsEl) dmCallButtonsEl.style.display = 'flex';

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

  renderPresenceForHeader();
}

// Reflects the current blockStatus in the UI: shows the right icon on the
// block button, disables the message form (either direction) when
// either side has blocked the other, and shows a short explanatory
// notice — same idea as WhatsApp graying out the input for a blocked chat.
function applyBlockStateToUI(){
  if (!activeContact) return;

  if (dmBlockBtn){
    dmBlockBtn.style.display = 'inline-flex';
    dmBlockBtn.textContent = blockStatus.iBlockedThem ? '✅' : '🚫';
    dmBlockBtn.title = blockStatus.iBlockedThem
      ? `Unblock ${activeContact.username}`
      : `Block ${activeContact.username}`;
  }

  const blocked = blockStatus.iBlockedThem || blockStatus.theyBlockedMe;

  dmMessageInput.disabled = blocked;
  const sendBtn = dmMessageForm.querySelector('button[type="submit"]');
  if (sendBtn) sendBtn.disabled = blocked;
  if (dmAttachBtn) dmAttachBtn.disabled = blocked;
  if (dmVoiceBtn) dmVoiceBtn.disabled = blocked;

  const dmVoiceCallBtn = document.getElementById('dmVoiceCallBtn');
  const dmVideoCallBtn = document.getElementById('dmVideoCallBtn');
  if (dmVoiceCallBtn) dmVoiceCallBtn.disabled = blocked;
  if (dmVideoCallBtn) dmVideoCallBtn.disabled = blocked;

  let noticeEl = document.getElementById('dmBlockedNotice');
  if (blocked){
    if (!noticeEl){
      noticeEl = document.createElement('div');
      noticeEl.id = 'dmBlockedNotice';
      noticeEl.className = 'typing-indicator';
      noticeEl.style.cssText = 'padding:4px 12px;font-size:0.85em;font-style:italic;opacity:0.85;';
      dmMessageForm.insertAdjacentElement('beforebegin', noticeEl);
    }
    noticeEl.textContent = blockStatus.iBlockedThem
      ? `You've blocked ${activeContact.username}. Unblock them to send a message.`
      : `You can't message ${activeContact.username} right now.`;
    noticeEl.style.display = 'block';
  } else if (noticeEl){
    noticeEl.style.display = 'none';
  }
}

async function toggleBlockActiveContact(){
  if (!activeContact) return;

  const blocking = !blockStatus.iBlockedThem;
  const confirmMsg = blocking
    ? `Block ${activeContact.username}? They won't be able to message you, and you won't be able to message them, until you unblock them.`
    : `Unblock ${activeContact.username}?`;
  if (!window.confirm(confirmMsg)) return;

  try {
    const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(activeContact.id)}/${blocking ? 'block' : 'unblock'}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });
    const data = await res.json();

    if (!res.ok){
      window.alert(data.error || `Could not ${blocking ? 'block' : 'unblock'} this person.`);
      return;
    }

    blockStatus.iBlockedThem = !!data.blocked;

    if (blockStatus.iBlockedThem) blockedIds.add(String(activeContact.id));
    else blockedIds.delete(String(activeContact.id));

    applyBlockStateToUI();
    renderContactList();
  } catch (err) {
    window.alert('Could not reach the server.');
  }
}

if (dmBlockBtn){
  dmBlockBtn.addEventListener('click', toggleBlockActiveContact);
}

// `fallback` lets us open a conversation with someone who isn't in the
// contacts list yet — e.g. arriving here from a "view profile" link
// elsewhere in the app. Once messages are exchanged, the server-side
// contacts list (persisted in MongoDB) will include them permanently too.
// Tells the server every unseen message FROM this person TO me should be
// marked seen — fires whenever a conversation is opened, and again on
// every new incoming message while that conversation stays open. No-op
// on the server if there's nothing unseen to update.
function markConversationSeen(otherUserId){
  if (!socket || !otherUserId) return;
  socket.emit('dm:seen', { withUserId: String(otherUserId) });
}

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

  blockStatus = { iBlockedThem: blockedIds.has(String(contactId)), theyBlockedMe: false };
  applyBlockStateToUI();
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

    blockStatus = { iBlockedThem: !!data.iBlockedThem, theyBlockedMe: !!data.theyBlockedMe };
    applyBlockStateToUI();

    activeMessages = data.messages || [];
    renderDMMessages();
    markConversationSeen(contactId);
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

/* -----------------------------------------------------------
   IMAGE LIGHTBOX — tap a shared photo to view it full-size, the same
   way WhatsApp/Instagram do. One shared overlay, reused for every image.
----------------------------------------------------------- */
let lightboxEl = null;
let lightboxImgEl = null;

function ensureLightbox(){
  if (lightboxEl) return;

  lightboxEl = document.createElement('div');
  lightboxEl.className = 'image-lightbox';

  lightboxImgEl = document.createElement('img');
  lightboxImgEl.alt = 'Shared image';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'image-lightbox-close';
  closeBtn.title = 'Close';
  closeBtn.textContent = '✕';

  lightboxEl.appendChild(lightboxImgEl);
  lightboxEl.appendChild(closeBtn);
  document.body.appendChild(lightboxEl);

  function closeLightbox(){
    lightboxEl.classList.remove('open');
    lightboxImgEl.src = '';
  }

  lightboxEl.addEventListener('click', (e) => {
    if (e.target === lightboxEl) closeLightbox();
  });
  closeBtn.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxEl.classList.contains('open')) closeLightbox();
  });
}

function openLightbox(src){
  ensureLightbox();
  lightboxImgEl.src = src;
  lightboxEl.classList.add('open');
}

dmMessagesEl.addEventListener('click', (e) => {
  const replyIcon = e.target.closest('.msg-reply-icon');
  if (replyIcon){
    const msgEl = replyIcon.closest('.msg');
    if (msgEl) setDmReplyTarget({ id: msgEl.dataset.id, author: msgEl.dataset.author, text: msgEl.dataset.text });
    return;
  }

  const sharedImage = e.target.closest('.media-note img');
  if (sharedImage){
    openLightbox(sharedImage.src);
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

// Swipe-to-reply (either direction) on touch devices — same gesture as room chat.
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

  if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5){
    dmTouchState.active = true;
    const clamped = Math.max(-DM_SWIPE_MAX_PX, Math.min(DM_SWIPE_MAX_PX, deltaX));
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

  if (active && Math.abs(deltaX) >= DM_SWIPE_TRIGGER_PX){
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
      if (!isMine) markConversationSeen(otherId);
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
  attachServerStatusBanner(socket);

  if (socket){
    socket.on('connect', updateDmBadge);
    socket.on('disconnect', updateDmBadge);
    socket.on('connect_error', updateDmBadge);
    socket.on('dm:message', handleIncomingDM);
    socket.on('dm:message:edited', handleDmEdited);
    socket.on('dm:message:deleted', handleDmDeleted);
    socket.on('dm:typing', handleIncomingDmTyping);
    socket.on('dm:seen', handleIncomingDmSeen);
    socket.on('presence:online', handlePresenceOnline);
    socket.on('presence:offline', handlePresenceOffline);
    socket.on('presence:online:list', handlePresenceOnlineList);
    socket.on('chat:error', (payload) => {
      if (payload && payload.message) window.alert(payload.message);
    });

    if (window.RemixCalls){
      // Use init() (not attachSocket()) so our getMyUserId/getMyUsername/getMyAvatar
      // context actually gets registered — attachSocket() only forwards the socket
      // and reuses whatever context was set by a previous init() call, which on
      // this page never happened.
      RemixCalls.init(socket, {
        getMyUserId: () => (me && me.id) ? String(me.id) : null,
        getMyUsername: () => (me && me.username) ? me.username : 'You',
        getMyAvatar: () => (me && me.avatar) ? me.avatar : '🎮'
      });
    } else {
      console.error('RemixCalls (calls.js) failed to load — call buttons will not work.');
    }
  }
  updateDmBadge();

  const dmVoiceCallBtn = document.getElementById('dmVoiceCallBtn');
  const dmVideoCallBtn = document.getElementById('dmVideoCallBtn');

  function startActiveContactCall(type){
    if (!activeContact || !window.RemixCalls) return;
    RemixCalls.startDMCall(activeContact.id, activeContact.username, activeContact.avatar, type);
  }

  if (dmVoiceCallBtn) dmVoiceCallBtn.addEventListener('click', () => startActiveContactCall('voice'));
  if (dmVideoCallBtn) dmVideoCallBtn.addEventListener('click', () => startActiveContactCall('video'));

  await loadContacts();
  fetchOwnerStatus();
  loadBlockedIds();

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

document.addEventListener("click",(e)=>{

if(!replyPreview.contains(e.target)
&&
!messageInput.contains(e.target)){

clearReplyTarget();

}

});

document.addEventListener("keydown",(e)=>{

if(e.key==="Escape"){

clearReplyTarget();

}

});
