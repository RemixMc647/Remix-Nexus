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

/* -----------------------------------------------------------
   MESSAGE SEARCH — client-side, over whatever's currently loaded for
   the open conversation (activeMessages, the same array renderDMMessages
   reads from). Matches highlight inline instead of hiding non-matching
   messages, same approach as room chat's search.
----------------------------------------------------------- */
const dmSearchToggleBtn = document.getElementById('dmSearchToggleBtn');
const dmSearchBar = document.getElementById('dmSearchBar');
const dmSearchInput = document.getElementById('dmSearchInput');
const dmSearchCount = document.getElementById('dmSearchCount');
const dmSearchPrevBtn = document.getElementById('dmSearchPrevBtn');
const dmSearchNextBtn = document.getElementById('dmSearchNextBtn');
const dmSearchCloseBtn = document.getElementById('dmSearchCloseBtn');

let dmSearchQuery = '';
let dmSearchMatchIds = [];
let dmSearchCurrentIndex = -1;

function escapeRegExp(str){
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text, query){
  const escaped = escapeHTML(text || '');
  if (!query) return escaped;
  const escapedQuery = escapeRegExp(escapeHTML(query));
  if (!escapedQuery) return escaped;
  return escaped.replace(new RegExp(escapedQuery, 'gi'), (match) => `<mark>${match}</mark>`);
}

function updateDmSearchCount(){
  if (!dmSearchCount) return;
  dmSearchCount.textContent = dmSearchMatchIds.length
    ? `${dmSearchCurrentIndex + 1}/${dmSearchMatchIds.length}`
    : '0/0';
}

function recomputeDmSearchMatches(){
  if (!dmSearchQuery){
    dmSearchMatchIds = [];
    dmSearchCurrentIndex = -1;
    return;
  }
  const q = dmSearchQuery.toLowerCase();
  dmSearchMatchIds = activeMessages
    .filter(m => m.text && m.text.toLowerCase().includes(q))
    .map(m => m.id);
  dmSearchCurrentIndex = dmSearchMatchIds.length ? 0 : -1;
}

function focusCurrentDmMatch(){
  dmMessagesEl.querySelectorAll('.msg.search-current').forEach(el => el.classList.remove('search-current'));
  dmMessagesEl.querySelectorAll('mark.current-match').forEach(el => el.classList.remove('current-match'));

  if (dmSearchCurrentIndex < 0 || !dmSearchMatchIds[dmSearchCurrentIndex]) return;

  const id = dmSearchMatchIds[dmSearchCurrentIndex];
  const row = dmMessagesEl.querySelector(`.msg[data-id="${CSS.escape(String(id))}"]`);
  if (!row) return;

  row.classList.add('search-current');
  const firstMark = row.querySelector('mark');
  if (firstMark) firstMark.classList.add('current-match');
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function runDmSearch(query){
  dmSearchQuery = query.trim();
  recomputeDmSearchMatches();
  renderDMMessages();
  updateDmSearchCount();
  focusCurrentDmMatch();
}

function goToDmMatch(direction){
  if (!dmSearchMatchIds.length) return;
  dmSearchCurrentIndex = (dmSearchCurrentIndex + direction + dmSearchMatchIds.length) % dmSearchMatchIds.length;
  updateDmSearchCount();
  focusCurrentDmMatch();
}

function openDmSearch(){
  if (!dmSearchBar) return;
  dmSearchBar.style.display = 'flex';
  if (dmSearchInput) dmSearchInput.focus();
}

function closeDmSearch(){
  if (dmSearchBar) dmSearchBar.style.display = 'none';
  if (dmSearchInput) dmSearchInput.value = '';
  dmSearchQuery = '';
  dmSearchMatchIds = [];
  dmSearchCurrentIndex = -1;
  renderDMMessages();
}

if (dmSearchToggleBtn){
  dmSearchToggleBtn.addEventListener('click', () => {
    if (!activeContact) return;
    if (dmSearchBar && dmSearchBar.style.display === 'flex') closeDmSearch();
    else openDmSearch();
  });
}

if (dmSearchInput){
  dmSearchInput.addEventListener('input', () => runDmSearch(dmSearchInput.value));
  dmSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){
      e.preventDefault();
      goToDmMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape'){
      closeDmSearch();
    }
  });
}

if (dmSearchPrevBtn) dmSearchPrevBtn.addEventListener('click', () => goToDmMatch(-1));
if (dmSearchNextBtn) dmSearchNextBtn.addEventListener('click', () => goToDmMatch(1));
if (dmSearchCloseBtn) dmSearchCloseBtn.addEventListener('click', closeDmSearch);

/* -----------------------------------------------------------
   GROUP CALLS — pick several contacts and ring them all at once, same
   flow as starting a new group call in WhatsApp. Selecting is a mode
   toggled on the contact list itself (checkboxes appear on each row);
   tapping a contact while in this mode selects/deselects instead of
   opening the conversation.
----------------------------------------------------------- */
const groupCallToggleBtn = document.getElementById('groupCallToggleBtn');
const groupCallBar = document.getElementById('groupCallBar');
const groupCallSelectedCount = document.getElementById('groupCallSelectedCount');
const groupCallVoiceBtn = document.getElementById('groupCallVoiceBtn');
const groupCallVideoBtn = document.getElementById('groupCallVideoBtn');
const groupCallCancelBtn = document.getElementById('groupCallCancelBtn');

let groupCallSelectMode = false;
let groupCallSelectedIds = new Set();

function updateGroupCallBar(){
  if (!groupCallSelectedCount) return;
  const n = groupCallSelectedIds.size;
  groupCallSelectedCount.textContent = n === 1 ? '1 selected' : `${n} selected`;
  const disabled = n < 1;
  if (groupCallVoiceBtn) groupCallVoiceBtn.disabled = disabled;
  if (groupCallVideoBtn) groupCallVideoBtn.disabled = disabled;
}

function enterGroupCallSelectMode(){
  groupCallSelectMode = true;
  groupCallSelectedIds = new Set();
  if (contactListEl) contactListEl.classList.add('group-select-mode');
  if (groupCallBar) groupCallBar.style.display = 'flex';
  updateGroupCallBar();
  renderContactList();
}

function exitGroupCallSelectMode(){
  groupCallSelectMode = false;
  groupCallSelectedIds = new Set();
  if (contactListEl) contactListEl.classList.remove('group-select-mode');
  if (groupCallBar) groupCallBar.style.display = 'none';
  renderContactList();
}

function toggleContactSelected(contactId){
  const id = String(contactId);
  if (groupCallSelectedIds.has(id)) groupCallSelectedIds.delete(id);
  else groupCallSelectedIds.add(id);
  updateGroupCallBar();
  renderContactList();
}

function startSelectedGroupCall(type){
  if (!window.RemixCalls || groupCallSelectedIds.size < 1) return;
  if (RemixCalls.isBusy()){
    alert("You're already on a call.");
    return;
  }
  RemixCalls.startGroupCall(Array.from(groupCallSelectedIds), type);
  exitGroupCallSelectMode();
}

if (groupCallToggleBtn){
  groupCallToggleBtn.addEventListener('click', () => {
    if (groupCallSelectMode) exitGroupCallSelectMode();
    else enterGroupCallSelectMode();
  });
}
if (groupCallCancelBtn) groupCallCancelBtn.addEventListener('click', exitGroupCallSelectMode);
if (groupCallVoiceBtn) groupCallVoiceBtn.addEventListener('click', () => startSelectedGroupCall('voice'));
if (groupCallVideoBtn) groupCallVideoBtn.addEventListener('click', () => startSelectedGroupCall('video'));

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

// isNativeApp is defined once below (see the helper function near line 135)
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

  const vv = window.visualViewport;
  const viewportHeight = vv ? vv.height : window.innerHeight;

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
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', adjustChatShellHeight);
  window.visualViewport.addEventListener('scroll', adjustChatShellHeight);
}
adjustChatShellHeight();

/* -----------------------------------------------------------
   KEYBOARD-AWARE INPUT — WhatsApp-style: when the DM input is focused,
   force an immediate re-measure instead of waiting on the
   visualViewport 'resize' event (which can lag, under-fire, or fire
   mid-animation in the Android WebView), and scroll the newest
   messages into view once the keyboard has settled.
----------------------------------------------------------- */
(function setupKeyboardAwareInput(){
  if (!dmMessageInput || !dmMessagesEl) return;

  function settle(){
    adjustChatShellHeight();
    dmMessagesEl.scrollTop = dmMessagesEl.scrollHeight;
  }

  dmMessageInput.addEventListener('focus', () => {
    // Re-measure a few times across the keyboard's slide-in animation
    // so both the shell height and scroll position land correctly once
    // it's fully open, rather than settling mid-animation.
    settle();
    setTimeout(settle, 150);
    setTimeout(settle, 350);
  });

  dmMessageInput.addEventListener('blur', () => {
    setTimeout(adjustChatShellHeight, 150);
  });
})();

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
    const isSelected = groupCallSelectedIds.has(String(c.id));
    return `
    <div class="contact-item ${activeContact && activeContact.id === c.id ? 'active' : ''} ${isSelected ? 'group-selected' : ''}" data-id="${c.id}">
      <span class="contact-select-check">${isSelected ? '✓' : ''}</span>
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
      bodyBlock = `<span class="msg-text">${highlightText(m.text, dmSearchQuery)}</span>`;
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
  closeDmSearch();
  renderDmTypingIndicator(false);
  clearTimeout(incomingTypingTimeout);
  renderContactHeader(contact);
  renderContactList();

  blockStatus = { iBlockedThem: blockedIds.has(String(contactId)), theyBlockedMe: false };
  applyBlockStateToUI();
  dmMessagesEl.innerHTML = '<p class="empty-state">Loading conversation…</p>';

  try {
    const res = await fetch(API_BASE + '/api/dm/' + encodeURIComponent(contactId), {
      headers: {
        Authorization: 'Bearer ' + AUTH.getToken(),
        'X-Client-Platform': isNativeApp() ? 'app' : 'web'
      }
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
  if (groupCallSelectMode){
    toggleContactSelected(item.dataset.id);
    return;
  }
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

  socket = window.io ? io(API_BASE, {
    auth: {
      token: AUTH.getToken(),
      // Origin sniffing alone can't reliably tell the app apart from the
      // website (see server.js isWebsiteRequest) — say so explicitly, so
      // the app never loses history after 3 days like the website does.
      platform: isNativeApp() ? 'app' : 'web'
    }
  }) : null;
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

// ================================================================
// NEW: WhatsApp & Snapchat Features for DMs
// ================================================================

// State for DM features
let dmPinnedContacts = [];
let dmStarredMessages = [];
let dmMutedContacts = [];
let dmArchivedContacts = [];
let dmStreaks = {};
let dmReactionMsgId = null;

// Context menu for DMs
let dmContextMenuEl = null;
let dmContextMenuTargetId = null;
let dmContextMenuTargetText = '';

function buildDmContextMenu() {
  if (dmContextMenuEl) return;
  dmContextMenuEl = document.createElement('div');
  dmContextMenuEl.id = 'dmContextMenu';
  dmContextMenuEl.className = 'context-menu';
  dmContextMenuEl.style.cssText = 'display:none;position:fixed;z-index:5000;background:#1d2330;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:6px 0;min-width:180px;box-shadow:0 8px 30px rgba(0,0,0,0.5);';
  dmContextMenuEl.addEventListener('click', handleDmContextMenuClick);
  document.body.appendChild(dmContextMenuEl);
}

function showDmContextMenu(x, y, msgId, text) {
  buildDmContextMenu();
  dmContextMenuTargetId = msgId;
  dmContextMenuTargetText = text || '';

  const msg = activeMessages.find(m => String(m.id) === String(msgId));
  const isOwn = msg && me && String(msg.fromUserId) === String(me.id);

  const options = [
    { id: 'reply', label: '↩ Reply' },
    { id: 'copy', label: '📋 Copy' },
    { id: 'star', label: '⭐ Star' },
    { id: 'deleteMe', label: '🗑 Delete for Me' },
  ];
  if (isOwn || isSiteOwner) {
    options.push({ id: 'deleteAll', label: '🚫 Delete for Everyone' });
  }

  dmContextMenuEl.innerHTML = options.map(opt =>
    `<button type="button" class="context-menu-item" data-action="${opt.id}" style="display:block;width:100%;text-align:left;background:none;border:none;color:#fff;padding:8px 16px;cursor:pointer;font-size:13px;font-family:inherit;">${opt.label}</button>`
  ).join('');

  const maxX = window.innerWidth - 200;
  const maxY = window.innerHeight - 300;
  dmContextMenuEl.style.left = Math.min(x, maxX) + 'px';
  dmContextMenuEl.style.top = Math.min(y, maxY) + 'px';
  dmContextMenuEl.style.display = 'block';
}

function hideDmContextMenu() {
  if (dmContextMenuEl) dmContextMenuEl.style.display = 'none';
  dmContextMenuTargetId = null;
  dmContextMenuTargetText = '';
}

function handleDmContextMenuClick(e) {
  const btn = e.target.closest('.context-menu-item');
  if (!btn) return;
  const action = btn.dataset.action;
  const msgId = dmContextMenuTargetId;
  const text = dmContextMenuTargetText;
  hideDmContextMenu();

  if (!msgId) return;

  switch (action) {
    case 'reply': {
      const msgEl = document.querySelector(`.msg[data-id="${CSS.escape(msgId)}"]`);
      if (msgEl) setDmReplyTarget({ id: msgEl.dataset.id, author: msgEl.dataset.author, text: msgEl.dataset.text });
      break;
    }
    case 'copy': {
      if (text) navigator.clipboard.writeText(text).catch(() => {});
      break;
    }
    case 'star': {
      toggleDmStar(msgId);
      break;
    }
    case 'deleteMe': {
      activeMessages = activeMessages.filter(m => String(m.id) !== String(msgId));
      renderDMMessages();
      break;
    }
    case 'deleteAll': {
      if (!confirm('Delete this message for everyone?')) return;
      if (socket && socket.connected) {
        socket.emit('dm:message:delete', { messageId: msgId });
      }
      break;
    }
  }
}

// Close DM context menu on outside click
document.addEventListener('click', (e) => {
  if (dmContextMenuEl && !dmContextMenuEl.contains(e.target)) hideDmContextMenu();
});

// Enhanced right-click for DMs — show full context menu
dmMessagesEl.addEventListener('contextmenu', (e) => {
  const msgEl = e.target.closest('.msg');
  if (!msgEl) return;
  e.preventDefault();
  const msgId = msgEl.dataset.id;
  const text = msgEl.dataset.text || '';
  showDmContextMenu(e.clientX, e.clientY, msgId, text);
});

// Toggle star for a DM message via REST
async function toggleDmStar(messageId) {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me/star', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ messageId })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.starred) {
      if (!dmStarredMessages.includes(messageId)) dmStarredMessages.push(messageId);
    } else {
      dmStarredMessages = dmStarredMessages.filter(id => id !== messageId);
    }
    renderDMMessages();
  } catch (err) {
    console.error('Toggle DM star error:', err);
  }
}

// ================================================================
// NEW: Emoji Reaction Picker for DMs
// ================================================================
const DM_REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '🔥', '🎉'];
let dmReactionPickerEl = null;

function buildDmReactionPicker() {
  if (dmReactionPickerEl) return;
  dmReactionPickerEl = document.createElement('div');
  dmReactionPickerEl.id = 'dmReactionPicker';
  dmReactionPickerEl.className = 'reaction-picker';
  dmReactionPickerEl.style.cssText = 'display:none;position:fixed;z-index:5000;background:#1d2330;border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:8px 12px;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
  dmReactionPickerEl.innerHTML = DM_REACTION_EMOJIS.map(emoji =>
    `<button type="button" class="reaction-btn" data-emoji="${emoji}" style="background:none;border:none;font-size:22px;cursor:pointer;padding:4px 6px;transition:transform 0.15s;">${emoji}</button>`
  ).join('');
  dmReactionPickerEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.reaction-btn');
    if (!btn) return;
    const emoji = btn.dataset.emoji;
    if (socket && socket.connected && dmReactionMsgId) {
      socket.emit('dm:message:react', { messageId: dmReactionMsgId, emoji: emoji });
    }
    hideDmReactionPicker();
  });
  document.body.appendChild(dmReactionPickerEl);
}

function showDmReactionPicker(x, y, msgId) {
  buildDmReactionPicker();
  dmReactionMsgId = msgId;
  dmReactionPickerEl.style.left = Math.min(x, window.innerWidth - 280) + 'px';
  dmReactionPickerEl.style.top = Math.min(y, window.innerHeight - 80) + 'px';
  dmReactionPickerEl.style.display = 'flex';
}

function hideDmReactionPicker() {
  if (dmReactionPickerEl) dmReactionPickerEl.style.display = 'none';
  dmReactionMsgId = null;
}

// ================================================================
// NEW: Snapchat-style View-Once Media Support
// ================================================================
let viewOnceTimers = {};

// Handle view-once media from the other person
function renderViewOnceMedia(msgEl, m) {
  if (!m.viewOnce) return;
  const mediaEl = msgEl.querySelector('.media-note img, .media-note video');
  if (!mediaEl) return;
  // Add view-once overlay
  msgEl.classList.add('view-once-overlay');
  if (m.viewOnceViewed) {
    // Already viewed — show a "viewed" placeholder
    const placeholder = document.createElement('div');
    placeholder.className = 'view-once-placeholder';
    placeholder.textContent = '👁️ Media viewed';
    placeholder.style.cssText = 'padding:20px;text-align:center;background:rgba(0,0,0,0.3);border-radius:12px;color:rgba(255,255,255,0.5);';
    if (mediaEl.parentNode) mediaEl.parentNode.replaceChild(placeholder, mediaEl);
  } else {
    // Not viewed yet — tap to reveal
    msgEl.addEventListener('click', function revealViewOnce(e) {
      if (e.target.closest('.msg-edit-btn') || e.target.closest('.msg-delete-btn')) return;
      msgEl.classList.remove('view-once-overlay');
      msgEl.classList.add('viewed');
      // Notify server that view-once media was viewed
      if (socket && socket.connected) {
        socket.emit('dm:message:viewed', { messageId: m.id });
      }
      // Set self-destruct timer if snapTimer is set
      if (m.snapTimer && m.snapTimer > 0) {
        const timerId = setTimeout(() => {
          activeMessages = activeMessages.filter(msg => String(msg.id) !== String(m.id));
          renderDMMessages();
        }, m.snapTimer * 1000);
        viewOnceTimers[m.id] = timerId;
      }
    }, { once: true });
  }
}

// ================================================================
// NEW: Send View-Once or Timed Media
// ================================================================
async function sendDmViewOnceMedia(file, snapTimer) {
  if (!file || !activeContact || !socket) return;

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) {
    alert('Only photos and videos can be sent as view-once.');
    return;
  }

  const dataUrl = await dmBlobToDataURL(file);
  const limit = isVideo ? MAX_VIDEO_DATA_URL_LENGTH : MAX_IMAGE_DATA_URL_LENGTH;
  if (dataUrl.length > limit) {
    alert(isVideo ? 'That video is too large.' : 'That image is too large.');
    return;
  }

  socket.emit('dm:message', {
    toUserId: activeContact.id,
    text: '',
    media: { type: isVideo ? 'video' : 'image', data: dataUrl },
    viewOnce: true,
    snapTimer: snapTimer || 0,
    replyTo: dmReplyingTo ? { id: dmReplyingTo.id, author: dmReplyingTo.author, text: dmReplyingTo.text } : null
  });
  clearDmReplyTarget();
}

// ================================================================
// NEW: Message Search in DMs
// ================================================================
let dmMsgSearchActive = false;
let dmMsgSearchQuery = '';

let dmSearchBarEl = null;
let dmSearchInputEl = null;

function buildDmMessageSearch() {
  if (dmSearchBarEl) return;
  const header = document.querySelector('.chat-header');
  if (!header) return;

  dmSearchBarEl = document.createElement('div');
  dmSearchBarEl.id = 'dmMsgSearchBar';
  dmSearchBarEl.style.cssText = 'display:none;align-items:center;gap:8px;padding:8px 24px;border-bottom:1px solid rgba(255,255,255,0.08);';

  dmSearchInputEl = document.createElement('input');
  dmSearchInputEl.type = 'text';
  dmSearchInputEl.placeholder = '🔎 Search messages…';
  dmSearchInputEl.style.cssText = 'flex:1;height:32px;border-radius:16px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#fff;padding:0 12px;font-size:13px;outline:none;font-family:inherit;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#8a9bc4;cursor:pointer;font-size:16px;padding:4px 8px;';
  closeBtn.addEventListener('click', () => {
    dmSearchBarEl.style.display = 'none';
    dmSearchInputEl.value = '';
    dmMsgSearchActive = false;
    dmMsgSearchQuery = '';
    renderDMMessages();
  });

  dmSearchInputEl.addEventListener('input', () => {
    dmMsgSearchQuery = dmSearchInputEl.value.trim().toLowerCase();
    dmMsgSearchActive = !!dmMsgSearchQuery;
    renderDMMessages();
  });

  dmSearchBarEl.appendChild(dmSearchInputEl);
  dmSearchBarEl.appendChild(closeBtn);

  // Add search button to header
  const searchTriggerBtn = document.createElement('button');
  searchTriggerBtn.type = 'button';
  searchTriggerBtn.textContent = '🔎';
  searchTriggerBtn.title = 'Search messages';
  searchTriggerBtn.style.cssText = 'background:none;border:none;color:#8a9bc4;cursor:pointer;font-size:16px;padding:4px;';
  searchTriggerBtn.addEventListener('click', () => {
    dmSearchBarEl.style.display = 'flex';
    dmSearchInputEl.focus();
  });
  header.appendChild(searchTriggerBtn);

  header.parentNode.insertBefore(dmSearchBarEl, header.nextSibling);
}

// ================================================================
// NEW: Streak Counter Display
// ================================================================
function getStreakForContact(contactId) {
  const key = me && me.id ? [String(me.id), String(contactId)].sort().join(':') : '';
  return dmStreaks[key] || 0;
}

function renderStreakCounter() {
  if (!activeContact) return;
  const streak = getStreakForContact(activeContact.id);
  if (streak < 2) return;
  let streakEl = document.getElementById('dmStreakCounter');
  if (!streakEl) {
    streakEl = document.createElement('span');
    streakEl.id = 'dmStreakCounter';
    streakEl.className = 'streak-badge';
    if (activeContactJoinedEl) {
      activeContactJoinedEl.insertAdjacentElement('afterend', streakEl);
    }
  }
  const fireIcons = streak >= 7 ? '🔥🔥' : streak >= 3 ? '🔥' : '✨';
  streakEl.textContent = `${fireIcons} ${streak} day streak`;
  streakEl.style.display = 'inline-block';
}

// ================================================================
// NEW: Friend Status Emoji Indicators
// ================================================================
function getFriendStatusEmoji(contactId) {
  const online = isContactOnline(contactId);
  const streak = getStreakForContact(contactId);
  if (online && streak >= 7) return '💎';
  if (online && streak >= 3) return '🌟';
  if (online) return '🟢';
  if (streak >= 7) return '🔥';
  return '';
}

// Update renderContactList to show friend status emoji
const originalRenderContactList = renderContactList;
renderContactList = function() {
  if (!contacts.length) {
    contactListEl.innerHTML = '<p class="empty-state">No contacts yet — chat in a room first, then people you talk with will show up here.</p>';
    return;
  }

  const unread = getUnreadContacts();

  contactListEl.innerHTML = contacts.map(c => {
    const count = unread[c.id] || 0;
    const online = isContactOnline(c.id);
    const isBlocked = blockedIds.has(String(c.id));
    const friendEmoji = getFriendStatusEmoji(c.id);
    return `
    <div class="contact-item ${activeContact && activeContact.id === c.id ? 'active' : ''}" data-id="${c.id}">
      <span class="contact-item-info">
        <span class="contact-avatar${online ? ' is-online' : ''}">${c.avatar || '🎮'}${online ? '<span class="online-dot" title="Online"></span>' : ''}</span>
        <span class="contact-name">${escapeHTML(c.username)}</span>
        ${friendEmoji ? `<span class="friend-status-emoji" title="Friend status">${friendEmoji}</span>` : ''}
        ${isBlocked ? '<span class="room-item-custom-tag">Blocked</span>' : ''}
      </span>
      ${count > 0 ? `<span class="room-count">${count > 99 ? '99+' : count}</span>` : ''}
    </div>
  `;
  }).join('');
};

// ================================================================
// NEW: Enhanced renderDMMessages with search, reactions, stars, view-once
// ================================================================
const originalRenderDMMessages = renderDMMessages;
renderDMMessages = function() {
  if (!activeMessages.length) {
    dmMessagesEl.innerHTML = '<p class="empty-state">' + (dmMsgSearchActive ? 'No messages match your search.' : 'No messages yet — say hi 👋') + '</p>';
    return;
  }

  // Filter by search query if active
  let filteredMessages = activeMessages;
  if (dmMsgSearchActive && dmMsgSearchQuery) {
    filteredMessages = activeMessages.filter(m =>
      (m.text && m.text.toLowerCase().includes(dmMsgSearchQuery)) ||
      (m.fromUserId && m.fromUserId.toLowerCase().includes(dmMsgSearchQuery))
    );
  }

  dmMessagesEl.innerHTML = filteredMessages.map(m => {
    const isMe = String(m.fromUserId) === String(me.id);
    const hasMedia = m.media && m.media.data;
    const hasAudio = m.audio && m.audio.data;
    const isStarred = dmStarredMessages.includes(String(m.id));
    const isViewOnce = !!m.viewOnce;
    const isViewOnceViewed = !!m.viewOnceViewed;

    let bodyBlock;
    if (hasMedia) {
      if (isViewOnce && !isViewOnceViewed && !isMe) {
        // View-once media from other person — show blurred overlay
        bodyBlock = `<div class="media-note view-once-media">
          <div class="view-once-placeholder" style="padding:30px;text-align:center;background:rgba(0,0,0,0.3);border-radius:12px;cursor:pointer;">
            <span style="font-size:24px;">👁️</span>
            <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.5);">Tap to view once</p>
          </div>
        </div>`;
      } else if (isViewOnce && isViewOnceViewed && !isMe) {
        // Already viewed
        bodyBlock = `<div class="media-note"><div class="view-once-placeholder" style="padding:30px;text-align:center;background:rgba(0,0,0,0.3);border-radius:12px;"><span style="font-size:24px;opacity:0.5;">👁️</span><p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.3);">Viewed</p></div></div>`;
      } else {
        bodyBlock = m.media.type === 'video'
          ? `<div class="media-note"><video controls preload="metadata" src="${m.media.data}"></video></div>`
          : `<div class="media-note"><img src="${m.media.data}" alt="Shared image" loading="lazy"></div>`;
        // Add snap timer overlay if set
        if (m.snapTimer && m.snapTimer > 0) {
          bodyBlock += `<span class="snap-timer-badge">⏱ ${m.snapTimer}s</span>`;
        }
      }
    } else if (hasAudio) {
      bodyBlock = `<div class="voice-note">
           <audio controls preload="metadata" src="${m.audio.data}"></audio>
           <span class="voice-note-duration">${formatDuration(m.audio.duration)}</span>
         </div>`;
    } else {
      let displayText = escapeHTML(m.text);
      // Highlight search match
      if (dmMsgSearchActive && dmMsgSearchQuery && m.text) {
        const lowerText = m.text.toLowerCase();
        const idx = lowerText.indexOf(dmMsgSearchQuery);
        if (idx !== -1) {
          const before = escapeHTML(m.text.slice(0, idx));
          const match = escapeHTML(m.text.slice(idx, idx + dmMsgSearchQuery.length));
          const after = escapeHTML(m.text.slice(idx + dmMsgSearchQuery.length));
          displayText = before + '<mark class="search-highlight">' + match + '</mark>' + after;
        }
      }
      bodyBlock = `<span class="msg-text">${displayText}</span>`;
    }

    const replyBlock = m.replyTo
      ? `<div class="msg-quote">
           <span class="msg-quote-author">${escapeHTML(m.replyTo.author)}</span>
           <span class="msg-quote-text">${escapeHTML(m.replyTo.text)}</span>
         </div>`
      : '';

    const replyText = m.text || (hasAudio ? '🎤 Voice note' : (hasMedia ? (m.media.type === 'video' ? '🎬 Video' : '🖼️ Photo') : ''));
    const authorName = isMe ? (me.username || 'You') : (activeContact ? activeContact.username : '');

    const editBtn = (isMe && !hasMedia && !hasAudio)
      ? `<button type="button" class="msg-edit-btn" title="Edit message">✏️</button>`
      : '';

    const canDelete = isMe || isSiteOwner;

    // WhatsApp-style read receipt
    const tickBlock = isMe
      ? `<span class="msg-tick" style="margin-left:4px;letter-spacing:-2px;color:${m.seen ? '#53bdeb' : 'inherit'};opacity:${m.seen ? '1' : '0.6'};">${m.seen ? '✓✓' : '✓'}</span>`
      : '';

    // Star indicator
    const starBlock = isStarred ? '<span class="msg-starred">⭐</span>' : '';

    // Reactions display
    const reactionsBlock = (m.reactions && m.reactions.length)
      ? `<span class="msg-reactions">${m.reactions.map(r => r.emoji).join(' ')}</span>`
      : '';

    // Snap timer badge for self-destructing messages
    const snapTimerBlock = m.snapTimer && m.snapTimer > 0 && !isMe
      ? `<span class="snap-timer-badge">⏱ ${m.snapTimer}s</span>`
      : '';

    return `
      <div class="msg ${isMe ? 'me' : ''} ${isStarred ? 'starred' : ''}" data-id="${m.id}" data-author="${escapeHTML(authorName)}" data-text="${escapeHTML(replyText)}">
        <span class="msg-reply-icon" title="Reply">↩</span>
        ${replyBlock}
        <span class="msg-author">${isMe ? 'You' : escapeHTML(activeContact.username)}</span>
        ${bodyBlock}
        <span class="msg-time">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}${m.edited ? ' · edited' : ''}${tickBlock}${snapTimerBlock}</span>
        ${reactionsBlock}
        ${starBlock}
        ${canDelete ? `
          <span class="msg-actions">
            ${editBtn}
            <button type="button" class="msg-delete-btn" title="Delete message">🗑️</button>
          </span>
        ` : ''}
      </div>
    `;
  }).join('');

  if (!dmMsgSearchActive) {
    dmMessagesEl.scrollTop = dmMessagesEl.scrollHeight;
  }
};

// ================================================================
// NEW: Handle view-once tap on media
// ================================================================
dmMessagesEl.addEventListener('click', (e) => {
  // Check if clicking on a view-once placeholder
  const viewOncePlaceholder = e.target.closest('.view-once-placeholder');
  if (viewOncePlaceholder) {
    const msgEl = viewOncePlaceholder.closest('.msg');
    if (!msgEl) return;
    const msgId = msgEl.dataset.id;
    const targetMsg = activeMessages.find(m => String(m.id) === String(msgId));
    if (!targetMsg || !targetMsg.viewOnce || targetMsg.viewOnceViewed) return;

    // Mark as viewed locally
    targetMsg.viewOnceViewed = true;
    // Notify server
    if (socket && socket.connected) {
      socket.emit('dm:message:viewed', { messageId: msgId });
    }
    renderDMMessages();
    return;
  }
});

// ================================================================
// NEW: Socket handlers for DM reactions, streaks, view-once, screenshot
// ================================================================
function handleDmReacted({ messageId, reactions } = {}) {
  const target = activeMessages.find(m => String(m.id) === String(messageId));
  if (target) {
    target.reactions = reactions || [];
    renderDMMessages();
  }
}

function handleDmStreakUpdate({ streak, contactId } = {}) {
  if (!contactId) return;
  const key = me && me.id ? [String(me.id), String(contactId)].sort().join(':') : '';
  if (key) dmStreaks[key] = streak || 0;
  renderStreakCounter();
  renderContactList();
}

function handleDmScreenshot({ messageId, fromUserId } = {}) {
  if (String(fromUserId) === String(me.id)) {
    // I took a screenshot of someone else's view-once media
    alert('⚠️ Screenshot detected! The sender has been notified.');
  } else {
    // Someone else took a screenshot of my view-once media
    alert('⚠️ The recipient took a screenshot of your view-once media.');
  }
}

function handleDmScreenRecording({ messageId, fromUserId } = {}) {
  if (String(fromUserId) === String(me.id)) {
    alert('⚠️ Screen recording detected! The sender has been notified.');
  } else {
    alert('⚠️ The recipient was screen recording while viewing your media.');
  }
}

function handleDmViewOnceViewed({ messageId, byUserId } = {}) {
  // Update view-once status in active messages
  const target = activeMessages.find(m => String(m.id) === String(messageId));
  if (target) {
    target.viewOnceViewed = true;
    renderDMMessages();
  }
}

// ================================================================
// NEW: Append additional socket listeners in init()
// ================================================================
// These are applied inside the existing init() function below.
// We'll patch the socket setup after the existing init runs.

// Create a function to add the new listeners
function addDmFeatureListeners() {
  if (!socket) return;
  socket.on('dm:message:reacted', handleDmReacted);
  socket.on('dm:streak:update', handleDmStreakUpdate);
  socket.on('dm:screenshot:detected', handleDmScreenshot);
  socket.on('dm:screenrecording:detected', handleDmScreenRecording);
  socket.on('dm:message:viewed', handleDmViewOnceViewed);
  socket.on('dm:message:starred', ({ messageId, starred } = {}) => {
    if (!messageId) return;
    if (starred) {
      if (!dmStarredMessages.includes(messageId)) dmStarredMessages.push(messageId);
    } else {
      dmStarredMessages = dmStarredMessages.filter(id => id !== messageId);
    }
    renderDMMessages();
  });
}

// Patch into init by wrapping the socket setup
// We'll call addDmFeatureListeners after socket is created
// This is done in the init function patch below

// ================================================================
// NEW: Build UI elements on page load
// ================================================================
buildDmContextMenu();
buildDmMessageSearch();

// Patch the init function to add our listeners
// We need to call addDmFeatureListeners after the socket is set up
// Since init is async IIFE, we'll add a listener after it runs
// using a MutationObserver or setTimeout
setTimeout(() => {
  addDmFeatureListeners();
  
  // Load streaks from server
  if (socket && window.AUTH && AUTH.isLoggedIn()) {
    fetch(API_BASE + '/api/me/state', {
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    }).then(res => res.json()).then(state => {
      dmStreaks = state.streaks || {};
      renderStreakCounter();
      renderContactList();
    }).catch(() => {});
  }
}, 1000);

// Also ensure the DM context menu closes on click outside
document.addEventListener('click', (e) => {
  if (dmContextMenuEl && !dmContextMenuEl.contains(e.target)) hideDmContextMenu();
  if (dmReactionPickerEl && !dmReactionPickerEl.contains(e.target)) hideDmReactionPicker();
});

document.addEventListener("keydown",(e)=>{
  if(e.key==="Escape"){
    clearReplyTarget();
    hideDmContextMenu();
    hideDmReactionPicker();
  }});


