/*==============================
REMIX-NEXUS — CHAT LOGIC
Talks to the Express + Socket.io server hosted on Railway.
==============================*/

console.log('DEBUG window.AUTH exists?', !!window.AUTH);
console.log('DEBUG AUTH.getToken() at socket-creation time:', window.AUTH ? AUTH.getToken() : 'no AUTH object');

const API_BASE = "https://remix-nexus-bgz9.onrender.com";

const socket = io("https://remix-nexus-bgz9.onrender.com", {
  auth: {
    token: window.AUTH ? AUTH.getToken() : null,
    // Origin sniffing alone can't reliably tell the app apart from the
    // website (see server.js isWebsiteRequest), so say so explicitly —
    // this is what keeps the app from ever losing history after 3 days.
    platform: isNativeApp() ? 'app' : 'web'
  }
});

console.log('DEBUG socket.auth immediately after creation:', socket.auth);

/* -----------------------------------------------------------
   SERVER STATUS BANNER — Render's free tier spins the backend down
   after ~15 min idle, so the first connection attempt after that can
   take up to a minute (cold start). Rather than let chat silently fail
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

let hasConnectedOnce = false;

socket.on('connect', () => { hasConnectedOnce = true; hideServerBanner(); });
socket.on('disconnect', () => { hasConnectedOnce = false; scheduleServerBanner(); });
socket.on('connect_error', scheduleServerBanner);
// Reconnection lifecycle events (reconnect_attempt/reconnect_error/etc.)
// actually fire on the Manager (socket.io), not the socket itself — this
// covers the "already connected once, then dropped" case.
socket.io.on('reconnect_attempt', scheduleServerBanner);

// IMPORTANT: on Render's free tier, a sleeping backend usually doesn't
// throw a connection *error* while waking up — it just holds the very
// first request open until the container finishes booting, then answers
// normally. That means 'connect_error' may never fire for a cold start,
// so relying on error events alone misses it entirely. This proactively
// shows the banner if we simply haven't connected a few seconds after
// page load, which catches that silent-wait case too.
setTimeout(() => {
  if (!hasConnectedOnce) scheduleServerBanner();
}, 3000);

// Manual test: open DevTools console on this page and run
// window.__testServerBanner() to force it visible for a few seconds,
// without needing to wait for an actual Render cold start.
window.__testServerBanner = () => {
  showServerBanner();
  setTimeout(hideServerBanner, 5000);
};

// Marks this as a full-screen, app-style page on phones/tablets — see the
// mobile rules in Chat.css. Desktop is unaffected.
document.body.classList.add('app-shell-page');

/* -----------------------------------------------------------
   ROOMS (DEFAULT_ROOMS comes from rooms.js, loaded before this file)
   Users can no longer create their own rooms — the room list is always
   just the fixed DEFAULT_ROOMS set.
----------------------------------------------------------- */
function getRooms(){
  return DEFAULT_ROOMS;
}

function getMessages(roomId){
  try {
    let raw = localStorage.getItem('remix-nexusMessages:' + roomId);
    if (isNativeApp()){
      raw = localStorage.getItem('app-chat-backup:' + roomId) || raw;
    }
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveMessages(roomId, messages){
  localStorage.setItem('remix-nexusMessages:' + roomId, JSON.stringify(messages));
  if (isNativeApp()){
    localStorage.setItem('app-chat-backup:' + roomId, JSON.stringify(messages));
  }
}

// Prefer the logged-in account's username. Otherwise, remember a
// per-browser guest name so a person's messages stay consistent.
function getUsername(){
  const user = window.AUTH ? AUTH.getUser() : null;
  if (user && user.username) return user.username;

  let guest = localStorage.getItem('remix-nexusGuestName');
  if (!guest) {
    guest = 'Guest' + Math.floor(Math.random() * 10000);
    localStorage.setItem('remix-nexusGuestName', guest);
  }
  return guest;
}

// Real, verified user id (if logged in) — used to decide which messages
// show a delete button. Never trust display names for this, since two
// people could share a guest name; the server checks this same id again
// before actually deleting anything.
function getMyUserId(){
  const user = window.AUTH ? AUTH.getUser() : null;
  return (user && user.id) ? String(user.id) : null;
}

/* -----------------------------------------------------------
   STATE
----------------------------------------------------------- */
let customRooms = []; // rooms created by users at runtime — see fetchCustomRooms() below
let rooms = getRooms();
const params = new URLSearchParams(window.location.search);
const hadExplicitRoomParam = !!(params.get('room') && rooms.some(r => r.id === params.get('room')));
let activeRoomId = hadExplicitRoomParam
  ? params.get('room')
  : (rooms[0]?.id || 'lounge');
// ================================================================
// NEW: WhatsApp & Snapchat Feature State
// ================================================================
let pinnedChats = [];      // array of "room:roomId" or "contact:contactId"
let starredMessages = [];   // array of message IDs
let mutedChats = [];        // array of room/contact IDs
let archivedChats = [];     // array of room/contact IDs
let userDarkMode = false;
let userChatWallpaper = null;
let userStreaks = {};

// Emoji reaction picker state
let activeReactionMsgId = null;  // msg id of the message whose reaction picker is open
let activeReactionType = null;   // 'room' or 'dm'

// Context menu state
let contextMenuEl = null;
let contextMenuTargetId = null;
let contextMenuTargetRoom = null;
let contextMenuTargetText = '';
let contextMenuIsDM = false;

// Chat search state
let chatSearchActive = false;
let chatSearchQuery = '';
let chatSearchResults = [];

// Pinned rooms sorted to the top
function getSortedRooms() {
  const pinnedIds = new Set(pinnedChats.filter(id => id.startsWith('room:')).map(id => id.replace('room:', '')));
  const sorted = [...rooms];
  sorted.sort((a, b) => {
    const aPinned = pinnedIds.has(a.id);
    const bPinned = pinnedIds.has(b.id);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return 0;
  });
  return sorted;
}

// Fetch full user state from /api/me/state
async function fetchUserState() {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me/state', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!res.ok) return;
    const data = await res.json();
    pinnedChats = data.pinnedChats || [];
    starredMessages = data.starredMessages || [];
    mutedChats = data.mutedChats || [];
    archivedChats = data.archivedChats || [];
    userDarkMode = !!data.darkMode;
    userChatWallpaper = data.chatWallpaper || null;
    userStreaks = data.streaks || {};

    // Apply dark mode
    document.body.classList.toggle('dark-mode', userDarkMode);

    // Apply wallpaper
    if (userChatWallpaper) {
      document.documentElement.style.setProperty('--chat-bg', `url(${userChatWallpaper})`);
    } else {
      document.documentElement.style.removeProperty('--chat-bg');
    }

    renderRooms();
    renderMessages();
  } catch (err) {
    console.error('Fetch user state error:', err);
  }
}

// Toggle pin via REST
async function togglePin(chatId) {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ id: chatId })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.pinned) {
      if (!pinnedChats.includes(chatId)) pinnedChats.push(chatId);
    } else {
      pinnedChats = pinnedChats.filter(id => id !== chatId);
    }
    renderRooms();
  } catch (err) {
    console.error('Toggle pin error:', err);
  }
}

// Toggle mute via REST
async function toggleMute(chatId) {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me/mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ id: chatId })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.muted) {
      if (!mutedChats.includes(chatId)) mutedChats.push(chatId);
    } else {
      mutedChats = mutedChats.filter(id => id !== chatId);
    }
    renderRooms();
  } catch (err) {
    console.error('Toggle mute error:', err);
  }
}

// Toggle archive via REST
async function toggleArchive(chatId) {
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ id: chatId })
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.archived) {
      if (!archivedChats.includes(chatId)) archivedChats.push(chatId);
    } else {
      archivedChats = archivedChats.filter(id => id !== chatId);
    }
    renderRooms();
  } catch (err) {
    console.error('Toggle archive error:', err);
  }
}

// Toggle star via REST
async function toggleStar(messageId) {
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
      if (!starredMessages.includes(messageId)) starredMessages.push(messageId);
    } else {
      starredMessages = starredMessages.filter(id => id !== messageId);
    }
    renderMessages();
  } catch (err) {
    console.error('Toggle star error:', err);
  }
}

const roomListEl = document.getElementById('roomList');
const messagesEl = document.getElementById('messages');
const activeRoomNameEl = document.getElementById('activeRoomName');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const connectionBadge = document.getElementById('connectionBadge');
const chatShellEl = document.querySelector('.chat-shell');
const backToRoomsBtn = document.getElementById('backToRoomsBtn');
const createRoomBtn = document.getElementById('createRoomBtn');

const replyPreview = document.getElementById('replyPreview');
const replyPreviewAuthor = document.getElementById('replyPreviewAuthor');
const replyPreviewText = document.getElementById('replyPreviewText');

/* -----------------------------------------------------------
   MESSAGE SEARCH — client-side, over whatever's currently loaded for
   the active room (same source renderMessages already reads from).
   Matches highlight inline (like WhatsApp) instead of hiding
   non-matching messages, so the conversation stays readable while
   searching.
----------------------------------------------------------- */
const searchToggleBtn = document.getElementById('searchToggleBtn');
const chatSearchBar = document.getElementById('chatSearchBar');
const chatSearchInput = document.getElementById('chatSearchInput');
const chatSearchCount = document.getElementById('chatSearchCount');
const chatSearchPrevBtn = document.getElementById('chatSearchPrevBtn');
const chatSearchNextBtn = document.getElementById('chatSearchNextBtn');
const chatSearchCloseBtn = document.getElementById('chatSearchCloseBtn');

let searchQuery = '';
let searchMatchIds = []; // message ids (in render order) whose text matches
let searchCurrentIndex = -1;

// Escapes a string for safe use inside a RegExp.
function escapeRegExp(str){
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Escapes text for HTML, then wraps case-insensitive matches of `query`
// in <mark>. With an empty query this behaves exactly like escapeHTML.
function highlightText(text, query){
  const escaped = escapeHTML(text || '');
  if (!query) return escaped;
  const escapedQuery = escapeRegExp(escapeHTML(query));
  if (!escapedQuery) return escaped;
  return escaped.replace(new RegExp(escapedQuery, 'gi'), (match) => `<mark>${match}</mark>`);
}

function updateSearchCount(){
  if (!chatSearchCount) return;
  chatSearchCount.textContent = searchMatchIds.length
    ? `${searchCurrentIndex + 1}/${searchMatchIds.length}`
    : '0/0';
}

// Recomputes which messages in the active room match the current query,
// in the same order renderMessages displays them.
function recomputeSearchMatches(){
  if (!searchQuery){
    searchMatchIds = [];
    searchCurrentIndex = -1;
    return;
  }
  const q = searchQuery.toLowerCase();
  const messages = getMessages(activeRoomId);
  searchMatchIds = messages
    .filter(m => m.text && m.text.toLowerCase().includes(q))
    .map(m => m.id);
  searchCurrentIndex = searchMatchIds.length ? 0 : -1;
}

// Ring the current match and scroll it into view; clears the ring from
// whatever was previously marked current.
function focusCurrentMatch(){
  messagesEl.querySelectorAll('.msg-row.search-current').forEach(el => el.classList.remove('search-current'));
  messagesEl.querySelectorAll('mark.current-match').forEach(el => el.classList.remove('current-match'));

  if (searchCurrentIndex < 0 || !searchMatchIds[searchCurrentIndex]) return;

  const id = searchMatchIds[searchCurrentIndex];
  const row = messagesEl.querySelector(`.msg-row[data-id="${CSS.escape(String(id))}"]`);
  if (!row) return;

  row.classList.add('search-current');
  const firstMark = row.querySelector('mark');
  if (firstMark) firstMark.classList.add('current-match');
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function runSearch(query){
  searchQuery = query.trim();
  recomputeSearchMatches();
  renderMessages();
  updateSearchCount();
  focusCurrentMatch();
}

function goToMatch(direction){
  if (!searchMatchIds.length) return;
  searchCurrentIndex = (searchCurrentIndex + direction + searchMatchIds.length) % searchMatchIds.length;
  updateSearchCount();
  focusCurrentMatch();
}

function openSearch(){
  if (!chatSearchBar) return;
  chatSearchBar.style.display = 'flex';
  if (chatSearchInput) chatSearchInput.focus();
}

function closeSearch(){
  if (chatSearchBar) chatSearchBar.style.display = 'none';
  if (chatSearchInput) chatSearchInput.value = '';
  searchQuery = '';
  searchMatchIds = [];
  searchCurrentIndex = -1;
  renderMessages();
}

if (searchToggleBtn){
  searchToggleBtn.addEventListener('click', () => {
    if (chatSearchBar && chatSearchBar.style.display === 'flex') closeSearch();
    else openSearch();
  });
}

if (chatSearchInput){
  chatSearchInput.addEventListener('input', () => runSearch(chatSearchInput.value));
  chatSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){
      e.preventDefault();
      goToMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape'){
      closeSearch();
    }
  });
}

if (chatSearchPrevBtn) chatSearchPrevBtn.addEventListener('click', () => goToMatch(-1));
if (chatSearchNextBtn) chatSearchNextBtn.addEventListener('click', () => goToMatch(1));
if (chatSearchCloseBtn) chatSearchCloseBtn.addEventListener('click', closeSearch);
const cancelReplyBtn = document.getElementById('cancelReplyBtn');

// Online-users strip isn't part of the original Chat.html, so it's built
// here at runtime and inserted into the existing .chat-header — this way
// Chat.html never needs to be touched.
let onlineListEl = document.getElementById('onlineList');
if (!onlineListEl) {
  const header = document.querySelector('.chat-header');
  if (header) {
    onlineListEl = document.createElement('div');
    onlineListEl.id = 'onlineList';
    onlineListEl.className = 'online-list';
    header.insertAdjacentElement('afterend', onlineListEl);
  }
}

// Same runtime-injection trick for the "so-and-so is typing…" line —
// lives right above the message input, WhatsApp-style.
let typingIndicatorEl = document.getElementById('typingIndicator');
if (!typingIndicatorEl && messageForm) {
  typingIndicatorEl = document.createElement('div');
  typingIndicatorEl.id = 'typingIndicator';
  typingIndicatorEl.className = 'typing-indicator';
  typingIndicatorEl.style.display = 'none';
  typingIndicatorEl.style.cssText = 'display:none;padding:4px 12px;font-size:0.85em;font-style:italic;opacity:0.75;';
  messageForm.insertAdjacentElement('beforebegin', typingIndicatorEl);
}

let replyingTo = null; // { id, author, text }
let editingId = null;  // id of the message currently being edited, if any
let onlineUsers = [];  // [{ userId, username, avatar }] for the active room

function generateId(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function setReplyTarget(msg){
  if (!msg || !msg.text) return;
  replyingTo = { id: msg.id || '', author: msg.author, text: msg.text };
  replyPreviewAuthor.textContent = msg.author;
  replyPreviewText.textContent = msg.text.length > 120 ? msg.text.slice(0, 120) + '…' : msg.text;
  replyPreview.style.display = 'flex';
  messageInput.focus();
}

function clearReplyTarget(){
  replyingTo = null;
  replyPreview.style.display = 'none';
}

// The ✕ button on the reply preview — lets someone back out of a reply
// they no longer want to send, without having to send/delete a message
// or click elsewhere on the page.
if (cancelReplyBtn){
  cancelReplyBtn.addEventListener('click', clearReplyTarget);
}

function formatDuration(seconds){
  const total = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* -----------------------------------------------------------
   MOBILE NAVIGATION — WhatsApp/Snapchat-style: on a phone/tablet only
   one panel (the room list, or an open conversation) is visible at a
   time. Desktop always shows both side by side, unaffected — the CSS
   classes below only do anything under Chat.css's 820px breakpoint.
----------------------------------------------------------- */
// Injects the CSS needed for full-screen conversation mode below, once —
// kept here in JS (instead of Chat.css) so this works immediately without
// needing a separate CSS deploy.
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
  if (!chatShellEl) return;
  chatShellEl.classList.remove('view-list', 'view-conversation');
  chatShellEl.classList.add(view === 'conversation' ? 'view-conversation' : 'view-list');

  // WhatsApp-style: while a room is open on mobile, hide the top nav bar
  // + footer entirely and let the conversation fill the whole screen.
  // Desktop is unaffected — the @media rule above only applies under 820px.
  document.body.classList.toggle('conversation-fullscreen', view === 'conversation');

  // The nav bar just changed height (or disappeared), so the shell's
  // pinned height needs to be recalculated against the new layout.
  if (typeof adjustChatShellHeight === 'function') {
    requestAnimationFrame(adjustChatShellHeight);
  }
}

function openRoomConversation(roomId){
  switchRoom(roomId);
  setMobileView('conversation');
}

if (backToRoomsBtn){
  backToRoomsBtn.addEventListener('click', () => setMobileView('list'));
}

// Land straight in a conversation only if the URL explicitly asked for one
// (e.g. a notification click or a shared link) — otherwise start on the
// room list, same as opening WhatsApp fresh.
setMobileView(hadExplicitRoomParam ? 'conversation' : 'list');

/* -----------------------------------------------------------
   CUSTOM ROOMS — anyone logged in can create a room (like starting a
   WhatsApp group); only a site-owner account can delete one. The fixed
   DEFAULT_ROOMS set always stays, custom rooms are layered on top and
   kept in sync for everyone live via the room:created/room:deleted
   socket events further down.
----------------------------------------------------------- */
let isSiteOwner = false;

function rebuildRoomList(){
  rooms = [...DEFAULT_ROOMS, ...customRooms];
}

async function fetchCustomRooms(){
  try {
    const res = await fetch(API_BASE + '/api/rooms');
    if (!res.ok) return;
    const data = await res.json();
    customRooms = (data.rooms || []).map(r => ({
      id: r.id, name: r.name, isCustom: true,
      createdBy: r.createdBy, createdByUsername: r.createdByUsername
    }));
    rebuildRoomList();
    renderRooms();
    subscribeToKnownRooms();

    // A URL like Chat.html?room=r-abc123 might point at a custom room that
    // didn't exist yet at the very first render above — catch it now.
    const requestedRoom = params.get('room');
    if (requestedRoom && requestedRoom !== activeRoomId && rooms.some(r => r.id === requestedRoom)){
      openRoomConversation(requestedRoom);
    }
  } catch (err) {
    console.error('Could not load custom rooms:', err);
  }
}

// Only this account's own /api/me response says whether it's a site
// owner — this decides whether the delete button shows up on custom
// rooms, and on every OTHER person's message (not just this account's
// own), for this particular person.
async function fetchOwnerStatus(){
  const token = window.AUTH ? AUTH.getToken() : null;
  if (!token) return;
  try {
    const res = await fetch(API_BASE + '/api/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const data = await res.json();
    isSiteOwner = !!(data.user && data.user.isOwner);
    renderRooms();
    renderMessages();
  } catch (err) {
    console.error('Could not check owner status:', err);
  }
}

async function createRoom(){
  if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()){
    alert('Log in first to create a room.');
    return;
  }

  const name = window.prompt('Name your new room (everyone will be able to join it):');
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;

  try {
    const res = await fetch(API_BASE + '/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AUTH.getToken() },
      body: JSON.stringify({ name: trimmed })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok){
      alert(data.error || 'Could not create that room.');
      return;
    }

    // The room:created socket event (below) adds it to everyone's list,
    // including ours — we just jump straight into it once that lands.
    openRoomConversation(data.room.id);
  } catch (err) {
    alert('Could not reach the server to create that room.');
  }
}

if (createRoomBtn){
  createRoomBtn.addEventListener('click', createRoom);
}

async function requestDeleteRoom(roomId){
  if (!roomId) return;
  if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) return;
  if (!confirm('Delete this room for everyone? This can\'t be undone.')) return;

  try {
    const res = await fetch(API_BASE + '/api/rooms/' + encodeURIComponent(roomId), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok){
      alert(data.error || 'Could not delete that room.');
    }
    // On success, the room:deleted socket event (below) removes it from
    // everyone's list, including ours.
  } catch (err) {
    alert('Could not reach the server to delete that room.');
  }
}

/* -----------------------------------------------------------
   UNREAD COUNTS + DESKTOP NOTIFICATIONS
   The badge count is per-room (shown on the room name in the sidebar).
   The desktop notification fires for any new message, in any room,
   whenever the tab isn't actually in front of the person — same trigger
   WhatsApp Web uses.
----------------------------------------------------------- */
function unreadRoomsStorageKey(){
  const uid = getMyUserId();
  return 'remix-nexusUnreadRooms:' + (uid || 'guest');
}

function isNativeApp() {
    return !!window.Capacitor;
}

function getUnreadCounts(){
  try {
    const raw = localStorage.getItem(unreadRoomsStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveUnreadCounts(counts){
  localStorage.setItem(unreadRoomsStorageKey(), JSON.stringify(counts));
}

function bumpUnread(roomId){
  const counts = getUnreadCounts();
  counts[roomId] = (counts[roomId] || 0) + 1;
  saveUnreadCounts(counts);
}

function clearUnread(roomId){
  const counts = getUnreadCounts();
  if (!counts[roomId]) return;
  delete counts[roomId];
  saveUnreadCounts(counts);
}

// The tab counts as "not being looked at" if it's hidden (a different tab
// or app is in front) or the browser window itself doesn't have focus.
function isAppInForeground(){
  return document.visibilityState === 'visible' && document.hasFocus();
}

if ('Notification' in window && Notification.permission === 'default'){
  Notification.requestPermission().catch(() => {});
}

function notifyNewRoomMessage(message, roomId){
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (isAppInForeground()) return;

  const roomMeta = rooms.find(r => r.id === roomId);
  const roomName = roomMeta ? roomMeta.name : 'a room';
  const preview = message.text
    || (message.audio ? '🎤 Voice note' : (message.media ? (message.media.type === 'video' ? '🎬 Video' : '🖼️ Photo') : ''));

  try {
    const n = new Notification(`${message.author} — ${roomName}`, {
      body: preview,
      tag: 'room:' + roomId // replaces any earlier notification for this same room instead of stacking
    });
    n.onclick = () => {
      window.focus();
      openRoomConversation(roomId);
      n.close();
    };
  } catch (err) {
    console.error('Notification error:', err);
  }
}

// When the tab regains focus, whatever room is currently open counts as
// "seen" again — clear its badge.
function handleForegroundReturn(){
  if (isAppInForeground() && activeRoomId){
    clearUnread(activeRoomId);
    renderRooms();
    renderMessages();
  }
}
window.addEventListener('focus', handleForegroundReturn);
document.addEventListener('visibilitychange', handleForegroundReturn);

// Joins every locally-known room's socket.io channel so message broadcasts
// for rooms you're not currently viewing still reach this client — that's
// what makes unread badges and notifications possible for those rooms.
function subscribeToKnownRooms(){
  if (!socket || !socket.connected) return;
  socket.emit('chat:subscribeRooms', { rooms: rooms.map(r => r.id) });
}

/* -----------------------------------------------------------
   TYPING INDICATOR — mirrors WhatsApp: shows who's currently typing
   in the room you're looking at. Purely visual, nothing persisted.
----------------------------------------------------------- */
const typingUsers = new Map(); // username -> auto-clear timeout id (active room only)
const TYPING_STALE_MS = 4000;   // if no follow-up "still typing" arrives in this window, assume they stopped

function renderTypingIndicator(){
  if (!typingIndicatorEl) return;
  const names = Array.from(typingUsers.keys());
  if (!names.length){
    typingIndicatorEl.style.display = 'none';
    typingIndicatorEl.textContent = '';
    return;
  }
  const label = names.length === 1
    ? `${names[0]} is typing…`
    : names.length === 2
      ? `${names[0]} and ${names[1]} are typing…`
      : `${names.length} people are typing…`;
  typingIndicatorEl.textContent = label;
  typingIndicatorEl.style.display = 'block';
}

function clearTypingIndicator(){
  typingUsers.forEach(timeoutId => clearTimeout(timeoutId));
  typingUsers.clear();
  renderTypingIndicator();
}

function handleIncomingTyping({ room, username, isTyping } = {}){
  if (room !== activeRoomId || !username) return;

  const existingTimeout = typingUsers.get(username);
  if (existingTimeout) clearTimeout(existingTimeout);

  if (!isTyping){
    typingUsers.delete(username);
    renderTypingIndicator();
    return;
  }

  const timeoutId = setTimeout(() => {
    typingUsers.delete(username);
    renderTypingIndicator();
  }, TYPING_STALE_MS);
  typingUsers.set(username, timeoutId);
  renderTypingIndicator();
}

// Debounced outgoing "I'm typing" — fires an isTyping:true right away,
// then automatically sends isTyping:false after a pause with no keystrokes.
let outgoingTypingActive = false;
let outgoingTypingTimeout = null;
const OUTGOING_TYPING_IDLE_MS = 2000;

function emitTyping(isTyping){
  if (!socket || !socket.connected) return;
  socket.emit('chat:typing', { room: activeRoomId, isTyping });
}

function handleTypingInput(){
  if (!outgoingTypingActive){
    outgoingTypingActive = true;
    emitTyping(true);
  }
  clearTimeout(outgoingTypingTimeout);
  outgoingTypingTimeout = setTimeout(() => {
    outgoingTypingActive = false;
    emitTyping(false);
  }, OUTGOING_TYPING_IDLE_MS);
}

function stopTypingNow(){
  clearTimeout(outgoingTypingTimeout);
  if (outgoingTypingActive){
    outgoingTypingActive = false;
    emitTyping(false);
  }
}

if (messageInput){
  messageInput.addEventListener('input', handleTypingInput);
}



function updateConnectionBadge(){
  if (!connectionBadge) return;
  if (!socket){
    connectionBadge.textContent = 'Offline';
    return;
  }
  connectionBadge.textContent = socket.connected ? 'Live' : 'Connecting…';
}

if (socket){
  socket.on('connect', () => { updateConnectionBadge(); switchRoom(activeRoomId); subscribeToKnownRooms(); });
  socket.on('disconnect', updateConnectionBadge);
  socket.on('connect_error', updateConnectionBadge);
}
updateConnectionBadge();

function renderRooms(){
  const unread = getUnreadCounts();
  const sorted = getSortedRooms();
  roomListEl.innerHTML = sorted.map(r => {
    const count = unread[r.id] || 0;
    const isCustom = !!r.isCustom;
    const roomChatId = 'room:' + r.id;
    const isPinned = pinnedChats.includes(roomChatId);
    const isMuted = mutedChats.includes(roomChatId);
    const isArchived = archivedChats.includes(roomChatId);
    const deleteBtn = (isCustom && isSiteOwner)
      ? `<button type="button" class="room-item-delete" data-room="${escapeHTML(r.id)}" title="Delete this room">🗑</button>`
      : '';
    const pinIcon = isPinned ? '<span class="room-item-icon" title="Pinned">📌</span>' : '';
    const muteIcon = isMuted ? '<span class="room-item-icon" title="Muted">🔇</span>' : '';
    const archiveIcon = isArchived ? '<span class="room-item-icon" title="Archived">📦</span>' : '';
    return `
    <div class="room-item ${r.id === activeRoomId ? 'active' : ''} ${isArchived ? 'archived' : ''}" data-room="${r.id}">
      <span class="room-item-name-wrap">
        ${pinIcon}${muteIcon}${archiveIcon}
        <span>${escapeHTML(r.name)}</span>
        ${isCustom ? '<span class="room-item-custom-tag">Custom</span>' : ''}
      </span>
      <span style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
        ${count > 0 && !isMuted ? `<span class="room-count">${count > 99 ? '99+' : count}</span>` : ''}
        ${deleteBtn}
      </span>
    </div>
  `;
  }).join('');
}

function renderMessages(){
  const room = rooms.find(r => r.id === activeRoomId);
  activeRoomNameEl.textContent = room ? room.name : 'Room';

  const messages = getMessages(activeRoomId);
  const me = getUsername();
  const myUserId = getMyUserId();

  messagesEl.innerHTML = messages.map(m => {
    const isMe = m.author === me;
    const isOwnMessage = !!(myUserId && m.authorId && String(m.authorId) === myUserId);
    // The site owner can delete ANY message (like a WhatsApp group admin),
    // not just their own — actual enforcement happens server-side too, in
    // chat:message:delete, never trusting this client-side flag alone.
    const canDelete = isOwnMessage || isSiteOwner;

    const replyBlock = m.replyTo
      ? `<div class="msg-quote">
           <span class="msg-quote-author">${escapeHTML(m.replyTo.author)}</span>
           <span class="msg-quote-text">${escapeHTML(m.replyTo.text)}</span>
         </div>`
      : '';

    let bodyBlock;
    if (m.media && m.media.data){
      bodyBlock = m.media.type === 'video'
        ? `<div class="media-note"><video controls preload="metadata" src="${m.media.data}"></video></div>`
        : `<div class="media-note"><img src="${m.media.data}" alt="Shared image" loading="lazy"></div>`;
    } else if (m.audio && m.audio.data){
      bodyBlock = `<div class="voice-note">
           <audio controls preload="metadata" src="${m.audio.data}"></audio>
           <span class="voice-note-duration">${formatDuration(m.audio.duration)}</span>
         </div>`;
    } else {
      bodyBlock = `<span class="msg-text">${highlightText(m.text, searchQuery)}</span>`;
    }

    const replyText = m.text || (m.audio ? '🎤 Voice note' : (m.media ? (m.media.type === 'video' ? '🎬 Video' : '🖼️ Photo') : ''));

    const canEdit = isOwnMessage && !m.audio && !m.media; // voice notes & media can't be edited, only text
    const isEditingThis = editingId === m.id;

    const deleteBlock = canDelete
      ? `<button type="button" class="msg-delete-btn" title="Delete message">🗑</button>`
      : '';

    const editBlock = canEdit
      ? `<button type="button" class="msg-edit-btn" title="Edit message">✏️</button>`
      : '';

    // Clickable author name (to view their profile / start a DM) only makes
    // sense for someone else's verified, logged-in message.
    const authorIsClickable = !isMe && !!m.authorId;
    const authorSpan = authorIsClickable
      ? `<button type="button" class="msg-author msg-author-link" data-uid="${escapeHTML(String(m.authorId))}" data-username="${escapeHTML(m.author)}" title="View profile & message ${escapeHTML(m.author)}">${escapeHTML(m.author)}</button>`
      : `<span class="msg-author">${escapeHTML(m.author)}</span>`;

    const editedTag = m.edited ? `<span class="msg-edited-tag">(edited)</span>` : '';

    const bubbleInner = isEditingThis
      ? `<form class="msg-edit-form" data-id="${escapeHTML(m.id || '')}">
           <input type="text" class="msg-edit-input" value="${escapeHTML(m.text || '')}" maxlength="500">
           <button type="submit" class="msg-edit-save">Save</button>
           <button type="button" class="msg-edit-cancel">✕</button>
         </form>`
      : `${replyBlock}
         ${authorSpan}
         ${bodyBlock}
         <span class="msg-time">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}${editedTag}</span>`;

    return `
    <div class="msg-row ${isMe ? 'me' : ''}" data-id="${escapeHTML(m.id || '')}" data-author="${escapeHTML(m.author)}" data-text="${escapeHTML(replyText)}">
      <span class="msg-reply-icon">↩</span>
      ${editBlock}
      ${deleteBlock}
      <div class="msg ${isMe ? 'me' : ''}">
        ${bubbleInner}
      </div>
    </div>`;
  }).join('') || '<p class="empty-state">No messages yet — say hi 👋</p>';

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Sends the person straight to Contacts.html with this user pre-selected,
// so they can see the profile and start/continue a private conversation —
// works even if this is the very first time these two have interacted.
function goToContact(userId, username, avatar){
  if (!userId) return;
  const url = new URL('./Contacts.html', window.location.href);
  url.searchParams.set('uid', userId);
  if (username) url.searchParams.set('username', username);
  if (avatar) url.searchParams.set('avatar', avatar);
  window.location.href = url.toString();
}

function renderOnlineList(){
  if (!onlineListEl) return;

  const myUserId = getMyUserId();
  const others = onlineUsers.filter(u => String(u.userId) !== myUserId);

  if (!others.length){
    onlineListEl.innerHTML = '<span class="online-empty">No one else online in this room</span>';
    return;
  }

  onlineListEl.innerHTML = `
    <span class="online-label">Online now</span>
    ${others.map(u => `
      <button type="button" class="online-user" data-uid="${escapeHTML(String(u.userId))}" data-username="${escapeHTML(u.username || '')}" data-avatar="${escapeHTML(u.avatar || '')}" title="View profile & message ${escapeHTML(u.username || '')}">
        <span class="online-avatar">${escapeHTML(u.avatar || '🎮')}</span>
        <span class="online-username">${escapeHTML(u.username || 'Player')}</span>
      </button>
    `).join('')}
  `;
}

if (onlineListEl){
  onlineListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.online-user');
    if (!btn) return;
    goToContact(btn.dataset.uid, btn.dataset.username, btn.dataset.avatar);
  });
}

function switchRoom(roomId){
  activeRoomId = roomId;
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);

  if (socket && socket.connected){
    socket.emit('chat:join', { room: activeRoomId });
  }

  clearUnread(roomId);
  onlineUsers = [];
  renderOnlineList();
  clearTypingIndicator();
  closeSearch();
  renderRooms();
  renderMessages();
}

function sendMessage(text){
  const trimmed = text.trim();
  if (!trimmed) return;

  stopTypingNow();

  const message = {
    id: generateId(),
    author: getUsername(),
    text: trimmed,
    time: Date.now(),
    replyTo: replyingTo ? { id: replyingTo.id, author: replyingTo.author, text: replyingTo.text } : null
  };

  if (socket && socket.connected){
    socket.emit('chat:message', { room: activeRoomId, message });
    clearReplyTarget();
    return;
  }

  // Server unreachable — still let the person see their own message locally
  const messages = getMessages(activeRoomId);
  messages.push(message);
  saveMessages(activeRoomId, messages);
  clearReplyTarget();
  renderRooms();
  renderMessages();
}

/* -----------------------------------------------------------
   REPLY GESTURES — swipe left on touch devices, right-click on desktop
----------------------------------------------------------- */
function readMsgFromRow(row){
  if (!row) return null;
  return { id: row.dataset.id, author: row.dataset.author, text: row.dataset.text };
}

messagesEl.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.msg-row');
  if (!row) return;
  e.preventDefault();
  setReplyTarget(readMsgFromRow(row));
});

/* -----------------------------------------------------------
   DELETE OWN MESSAGE
----------------------------------------------------------- */
function removeMessageLocally(roomId, messageId){
  const messages = getMessages(roomId).filter(m => m.id !== messageId);
  saveMessages(roomId, messages);
  if (roomId === activeRoomId) renderMessages();
  renderRooms();
}

function requestDeleteMessage(messageId){
  if (socket && socket.connected){
    socket.emit('chat:message:delete', { room: activeRoomId, messageId });
    return;
  }
  // Server unreachable — remove it locally so the UI stays responsive;
  // it'll come back on next sync with the server if it wasn't actually deleted.
  removeMessageLocally(activeRoomId, messageId);
}

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

  // Tapping the dimmed background (not the image itself) closes it —
  // clicking the image does nothing, same as every photo app.
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

messagesEl.addEventListener('click', (e) => {
  const authorLink = e.target.closest('.msg-author-link');
  if (authorLink){
    e.stopPropagation();
    goToContact(authorLink.dataset.uid, authorLink.dataset.username, '');
    return;
  }

  const editBtn = e.target.closest('.msg-edit-btn');
  if (editBtn){
    e.stopPropagation();
    const row = editBtn.closest('.msg-row');
    if (!row) return;
    editingId = row.dataset.id;
    renderMessages();
    const input = messagesEl.querySelector('.msg-edit-input');
    if (input) { input.focus(); input.select(); }
    return;
  }

  const cancelBtn = e.target.closest('.msg-edit-cancel');
  if (cancelBtn){
    e.stopPropagation();
    editingId = null;
    renderMessages();
    return;
  }

  const deleteBtn = e.target.closest('.msg-delete-btn');
  if (deleteBtn){
    e.stopPropagation();
    const row = deleteBtn.closest('.msg-row');
    const messageId = row ? row.dataset.id : null;
    if (!messageId) return;

    if (!confirm('Delete this message for everyone?')) return;
    requestDeleteMessage(messageId);
    return;
  }

  const sharedImage = e.target.closest('.media-note img');
  if (sharedImage){
    openLightbox(sharedImage.src);
  }
});

messagesEl.addEventListener('submit', (e) => {
  const form = e.target.closest('.msg-edit-form');
  if (!form) return;
  e.preventDefault();

  const messageId = form.dataset.id;
  const input = form.querySelector('.msg-edit-input');
  const newText = input ? input.value.trim() : '';

  if (!newText){
    editingId = null;
    renderMessages();
    return;
  }

  requestEditMessage(messageId, newText);
});

function requestEditMessage(messageId, text){
  if (socket && socket.connected){
    socket.emit('chat:message:edit', { room: activeRoomId, messageId, text });
  } else {
    // Server unreachable — edit locally so the UI stays responsive; it'll
    // reconcile with the server on next sync if this didn't actually save.
    applyEditedMessageLocally(activeRoomId, messageId, text);
  }
  editingId = null;
}

function applyEditedMessageLocally(roomId, messageId, text){
  const messages = getMessages(roomId);
  const target = messages.find(m => m.id === messageId);
  if (!target) return;
  target.text = text;
  target.edited = true;
  saveMessages(roomId, messages);
  if (roomId === activeRoomId) renderMessages();
}

let touchState = null; // { row, bubble, startX, startY, active }
const SWIPE_TRIGGER_PX = 60;
const SWIPE_MAX_PX = 90;

messagesEl.addEventListener('touchstart', (e) => {
  const row = e.target.closest('.msg-row');
  if (!row) return;
  const bubble = row.querySelector('.msg');
  const touch = e.touches[0];
  touchState = { row, bubble, startX: touch.clientX, startY: touch.clientY, active: false };
}, { passive: true });

messagesEl.addEventListener('touchmove', (e) => {
  if (!touchState) return;
  const touch = e.touches[0];
  const deltaX = touch.clientX - touchState.startX;
  const deltaY = touch.clientY - touchState.startY;

  // Only treat this as a reply-swipe if the motion is mostly horizontal —
  // either direction, left or right — otherwise let the page scroll normally.
  if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5){
    touchState.active = true;
    const clamped = Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, deltaX));
    touchState.bubble.style.transform = `translateX(${clamped}px)`;
    touchState.row.classList.toggle('swiping', Math.abs(clamped) > 20);
  }
}, { passive: true });

messagesEl.addEventListener('touchend', () => {
  if (!touchState) return;
  const { row, bubble, active } = touchState;

  const transform = bubble.style.transform;
  const match = /translateX\((-?\d+(\.\d+)?)px\)/.exec(transform);
  const deltaX = match ? parseFloat(match[1]) : 0;

  bubble.style.transform = '';
  row.classList.remove('swiping');

  if (active && Math.abs(deltaX) >= SWIPE_TRIGGER_PX){
    setReplyTarget(readMsgFromRow(row));
  }

  touchState = null;
});

/* -----------------------------------------------------------
   EVENTS
----------------------------------------------------------- */
roomListEl.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.room-item-delete');
  if (deleteBtn){
    e.stopPropagation();
    requestDeleteRoom(deleteBtn.dataset.room);
    return;
  }

  const item = e.target.closest('.room-item');
  if (!item) return;
  openRoomConversation(item.dataset.room);
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(messageInput.value);
  messageInput.value = '';
});

if (socket){
  socket.on('chat:history', ({ room, messages }) => {
    saveMessages(room, messages || []);
    if (room === activeRoomId) renderMessages();
    renderRooms();
  });

  socket.on('chat:message', ({ room, message }) => {
    const messages = getMessages(room);
    messages.push(message);
    saveMessages(room, messages);

    const myId = getMyUserId();
    const isMine = myId
      ? (message.authorId && String(message.authorId) === myId)
      : (message.author === getUsername());

    if (room === activeRoomId && isAppInForeground()){
      clearUnread(room);
      renderMessages();
    } else if (!isMine){
      bumpUnread(room);
    }

    if (!isMine){
      notifyNewRoomMessage(message, room);
    }

    renderRooms();
  });

  socket.on('chat:online', ({ room, users }) => {
    if (room !== activeRoomId) return;
    onlineUsers = users || [];
    renderOnlineList();
  });

  socket.on('chat:typing', handleIncomingTyping);

  socket.on('room:created', ({ room } = {}) => {
    if (!room || !room.id || customRooms.some(r => r.id === room.id)) return;
    customRooms.push({ id: room.id, name: room.name, isCustom: true, createdBy: room.createdBy, createdByUsername: room.createdByUsername });
    rebuildRoomList();
    renderRooms();
    subscribeToKnownRooms(); // start receiving broadcasts for the new room too
  });

  socket.on('room:deleted', ({ id } = {}) => {
    if (!id) return;
    customRooms = customRooms.filter(r => r.id !== id);
    rebuildRoomList();
    if (activeRoomId === id){
      openRoomConversation(rooms[0]?.id || 'lounge');
      setMobileView('list');
    }
    renderRooms();
  });

  if (socket.connected) { socket.emit('chat:join', { room: activeRoomId }); subscribeToKnownRooms(); }
}

/* -----------------------------------------------------------
   VOICE NOTES — record with MediaRecorder, send as a data URL
----------------------------------------------------------- */
const voiceBtn = document.getElementById('voiceBtn');
const recordingBar = document.getElementById('recordingBar');
const recordingTimerEl = document.getElementById('recordingTimer');
const cancelRecordingBtn = document.getElementById('cancelRecordingBtn');
const stopRecordingBtn = document.getElementById('stopRecordingBtn');

const MAX_RECORDING_SECONDS = 120; // keeps in-memory room history reasonable
const MAX_AUDIO_DATA_URL_LENGTH = 2_000_000; // ~1.5MB of actual audio

let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = 0;
let recordingTimerInterval = null;
let recordingCancelled = false;

function pickAudioMimeType(){
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function showRecordingUI(){
  messageForm.style.display = 'none';
  recordingBar.classList.add('active');
}

function hideRecordingUI(){
  messageForm.style.display = 'flex';
  recordingBar.classList.remove('active');
  recordingTimerEl.textContent = '0:00';
}

async function startRecording(){
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

  recordedChunks = [];
  recordingCancelled = false;

  const mimeType = pickAudioMimeType();
  mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  });

  mediaRecorder.addEventListener('stop', () => {
    stream.getTracks().forEach(track => track.stop());
    clearInterval(recordingTimerInterval);
    hideRecordingUI();

    if (recordingCancelled || recordedChunks.length === 0) return;

    const durationSeconds = Math.min(
      MAX_RECORDING_SECONDS,
      Math.round((Date.now() - recordingStartTime) / 1000)
    );

    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    sendVoiceNote(blob, durationSeconds);
  });

  mediaRecorder.start();
  recordingStartTime = Date.now();
  showRecordingUI();

  recordingTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - recordingStartTime) / 1000;
    recordingTimerEl.textContent = formatDuration(elapsed);
    if (elapsed >= MAX_RECORDING_SECONDS) stopRecording(false);
  }, 250);
}

function stopRecording(cancelled){
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  recordingCancelled = !!cancelled;
  mediaRecorder.stop();
}

function blobToDataURL(blob){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendVoiceNote(blob, durationSeconds){
  const dataUrl = await blobToDataURL(blob);

  if (dataUrl.length > MAX_AUDIO_DATA_URL_LENGTH){
    alert('That voice note is too long to send — try keeping it under about a minute.');
    return;
  }

  const message = {
    id: generateId(),
    author: getUsername(),
    text: '',
    audio: { data: dataUrl, duration: durationSeconds },
    time: Date.now(),
    replyTo: replyingTo ? { id: replyingTo.id, author: replyingTo.author, text: replyingTo.text } : null
  };

  if (socket && socket.connected){
    socket.emit('chat:message', { room: activeRoomId, message });
    clearReplyTarget();
    return;
  }

  // Server unreachable — still let the person see their own voice note locally
  const messages = getMessages(activeRoomId);
  messages.push(message);
  saveMessages(activeRoomId, messages);
  clearReplyTarget();
  renderRooms();
  renderMessages();
}

voiceBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') return;
  startRecording();
});

stopRecordingBtn.addEventListener('click', () => stopRecording(false));
cancelRecordingBtn.addEventListener('click', () => stopRecording(true));

/* -----------------------------------------------------------
   PHOTOS & VIDEOS — pick a file, send as a data URL (same
   approach as voice notes, just a bigger size cap for video).
----------------------------------------------------------- */
const attachBtn = document.getElementById('attachBtn');
const mediaInput = document.getElementById('mediaInput');

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

async function sendMedia(file){
  if (!file) return;

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

  const dataUrl = await blobToDataURL(file);
  const limit = isVideo ? MAX_VIDEO_DATA_URL_LENGTH : MAX_IMAGE_DATA_URL_LENGTH;

  if (dataUrl.length > limit){
    alert(isVideo
      ? 'That video is too large to send — try a shorter clip or lower resolution.'
      : 'That image is too large to send — try a smaller file.');
    return;
  }

  const message = {
    id: generateId(),
    author: getUsername(),
    text: '',
    media: { type: isVideo ? 'video' : 'image', data: dataUrl },
    time: Date.now(),
    replyTo: replyingTo ? { id: replyingTo.id, author: replyingTo.author, text: replyingTo.text } : null
  };

  if (socket && socket.connected){
    socket.emit('chat:message', { room: activeRoomId, message });
    clearReplyTarget();
    return;
  }

  // Server unreachable — still let the person see it locally
  const messages = getMessages(activeRoomId);
  messages.push(message);
  saveMessages(activeRoomId, messages);
  clearReplyTarget();
  renderRooms();
  renderMessages();
}

if (attachBtn && mediaInput){
  attachBtn.addEventListener('click', () => mediaInput.click());

  mediaInput.addEventListener('change', () => {
    const file = mediaInput.files && mediaInput.files[0];
    mediaInput.value = ''; // reset so picking the same file again still fires 'change'
    if (file) sendMedia(file);
  });
}

if (socket){
  socket.on('chat:error', ({ message } = {}) => {
    if (message) alert(message);
  });

  socket.on('chat:message:deleted', ({ room, messageId } = {}) => {
    if (!room || !messageId) return;
    removeMessageLocally(room, messageId);
  });

  socket.on('chat:message:edited', ({ room, messageId, text } = {}) => {
    if (!room || !messageId) return;
    applyEditedMessageLocally(room, messageId, text || '');
  });
}

// NOTE: this used to unconditionally wipe every cached
// "remix-nexusMessages:*" key on every page load, which made chat
// history disappear locally even though nothing had actually been
// deleted. Local history now only clears when a user explicitly chooses
// Settings ▸ Clear All Chats.

/* -----------------------------------------------------------
   LAYOUT FIX — keep the chat panel's height pinned to the real leftover
   viewport space, at every screen size, so a long conversation scrolls
   *inside* the panel instead of growing the whole page. On mobile the
   footer is hidden (see Chat.css/app-shell-page), so this effectively
   makes the room list / conversation fill the entire screen with no
   page-level scrolling — app-style.
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
  const buffer = isMobile ? 10 : 20; // a little breathing room so nothing touches the footer/edge

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
   KEYBOARD-AWARE INPUT — WhatsApp-style: when the message input is
   focused, force an immediate re-measure instead of waiting on the
   visualViewport 'resize' event (which can lag, under-fire, or fire
   mid-animation in the Android WebView), and scroll the newest
   messages into view once the keyboard has settled.
----------------------------------------------------------- */
(function setupKeyboardAwareInput(){
  const input = document.getElementById('messageInput');
  const messagesEl = document.getElementById('messages');
  if (!input || !messagesEl) return;

  function settle(){
    adjustChatShellHeight();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  input.addEventListener('focus', () => {
    // Re-measure a few times across the keyboard's slide-in animation
    // so both the shell height and scroll position land correctly once
    // it's fully open, rather than settling mid-animation.
    settle();
    setTimeout(settle, 150);
    setTimeout(settle, 350);
  });

  input.addEventListener('blur', () => {
    setTimeout(adjustChatShellHeight, 150);
  });
})();

/* -----------------------------------------------------------
   VOICE / VIDEO CALLS (calls.js — shared with Contacts.js)
----------------------------------------------------------- */
function getMyAvatar(){
  const user = window.AUTH ? AUTH.getUser() : null;
  return (user && user.avatar) ? user.avatar : '🎮';
}

if (window.RemixCalls) {
  RemixCalls.init(socket, {
    getMyUserId,
    getMyUsername: getUsername,
    getMyAvatar
  });

  const roomVoiceCallBtn = document.getElementById('roomVoiceCallBtn');
  const roomVideoCallBtn = document.getElementById('roomVideoCallBtn');

  function startActiveRoomCall(type){
    const room = rooms.find(r => r.id === activeRoomId);
    RemixCalls.startRoomCall(activeRoomId, room ? room.name : 'Room', type);
  }

  if (roomVoiceCallBtn) roomVoiceCallBtn.addEventListener('click', () => startActiveRoomCall('voice'));
  if (roomVideoCallBtn) roomVideoCallBtn.addEventListener('click', () => startActiveRoomCall('video'));
} else {
  console.error('RemixCalls (calls.js) failed to load — call buttons will not work.');
}

// ================================================================
// NEW: Context Menu — right-click / long-press on messages
// Shows options: Reply, Copy, Forward, Star, Delete for Me, Delete for Everyone
// ================================================================
const CONTEXT_MENU_OPTIONS = [
  { id: 'reply', label: '↩ Reply' },
  { id: 'copy', label: '📋 Copy' },
  { id: 'forward', label: '↪ Forward' },
  { id: 'star', label: '⭐ Star' },
  { id: 'deleteMe', label: '🗑 Delete for Me' },
  { id: 'deleteAll', label: '🚫 Delete for Everyone' }
];

function buildContextMenu() {
  if (contextMenuEl) return;
  contextMenuEl = document.createElement('div');
  contextMenuEl.id = 'chatContextMenu';
  contextMenuEl.className = 'context-menu';
  contextMenuEl.style.cssText = 'display:none;position:fixed;z-index:5000;background:#1d2330;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:6px 0;min-width:180px;box-shadow:0 8px 30px rgba(0,0,0,0.5);';
  contextMenuEl.addEventListener('click', handleContextMenuClick);
  document.body.appendChild(contextMenuEl);
}

function showContextMenu(x, y, msgId, roomId, text, isDM) {
  buildContextMenu();
  contextMenuTargetId = msgId;
  contextMenuTargetRoom = roomId;
  contextMenuTargetText = text || '';
  contextMenuIsDM = isDM;

  const myUserId = getMyUserId();
  const messages = getMessages(roomId);
  const msg = messages.find(m => m.id === msgId);
  const isOwn = msg && myUserId && msg.authorId && String(msg.authorId) === myUserId;

  const filtered = CONTEXT_MENU_OPTIONS.filter(opt => {
    if (opt.id === 'deleteAll' && !isOwn && !isSiteOwner) return false;
    if (opt.id === 'deleteAll' && !isOwn) return false;
    if (opt.id === 'deleteMe' && !isOwn) return false;
    if (opt.id === 'forward' && !text) return false;
    return true;
  });

  contextMenuEl.innerHTML = filtered.map(opt =>
    `<button type="button" class="context-menu-item" data-action="${opt.id}" style="display:block;width:100%;text-align:left;background:none;border:none;color:#fff;padding:8px 16px;cursor:pointer;font-size:13px;font-family:inherit;">${opt.label}</button>`
  ).join('');

  // Position within viewport
  const maxX = window.innerWidth - 200;
  const maxY = window.innerHeight - 300;
  contextMenuEl.style.left = Math.min(x, maxX) + 'px';
  contextMenuEl.style.top = Math.min(y, maxY) + 'px';
  contextMenuEl.style.display = 'block';
}

function hideContextMenu() {
  if (contextMenuEl) contextMenuEl.style.display = 'none';
  contextMenuTargetId = null;
  contextMenuTargetRoom = null;
  contextMenuTargetText = '';
}

function handleContextMenuClick(e) {
  const btn = e.target.closest('.context-menu-item');
  if (!btn) return;
  const action = btn.dataset.action;
  const msgId = contextMenuTargetId;
  const roomId = contextMenuTargetRoom;
  const text = contextMenuTargetText;
  hideContextMenu();

  if (!msgId || !roomId) return;

  switch (action) {
    case 'reply': {
      const row = document.querySelector(`.msg-row[data-id="${CSS.escape(msgId)}"]`);
      if (row) setReplyTarget(readMsgFromRow(row));
      break;
    }
    case 'copy': {
      if (text) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      break;
    }
    case 'forward': {
      forwardMessagePrompt(msgId, roomId, text);
      break;
    }
    case 'star': {
      toggleStar(msgId);
      break;
    }
    case 'deleteMe': {
      removeMessageLocally(roomId, msgId);
      break;
    }
    case 'deleteAll': {
      if (!confirm('Delete this message for everyone?')) return;
      if (socket && socket.connected) {
        socket.emit('chat:message:delete', { room: roomId, messageId: msgId });
      }
      break;
    }
  }
}

// Close context menu on outside click
document.addEventListener('click', (e) => {
  if (contextMenuEl && !contextMenuEl.contains(e.target)) hideContextMenu();
});

// Enhanced contextmenu handler — shows the full context menu instead of just reply
messagesEl.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.msg-row');
  if (!row) return;
  e.preventDefault();
  const msgId = row.dataset.id;
  const roomId = activeRoomId;
  const text = row.dataset.text || '';
  showContextMenu(e.clientX, e.clientY, msgId, roomId, text, false);
});

// ================================================================
// NEW: Forward Message — shows a prompt to select target room
// ================================================================
function forwardMessagePrompt(msgId, sourceRoomId, text) {
  if (!text) return;
  const allRoomNames = rooms.map(r => r.name + ' (' + r.id + ')').join('\n');
  const targetId = prompt(
    'Forward this message to which room?\n\nAvailable rooms:\n' + allRoomNames + '\n\nEnter the room ID (e.g. "lounge"):',
    ''
  );
  if (!targetId) return;

  const trimmed = targetId.trim();
  const targetRoom = rooms.find(r => r.id === trimmed || r.name.includes(trimmed));
  if (!targetRoom) {
    alert('Room not found. Use the ID shown in parentheses.');
    return;
  }

  if (socket && socket.connected) {
    socket.emit('chat:message:forward', {
      fromRoom: sourceRoomId,
      toRoom: targetRoom.id,
      messageId: msgId,
      text: text
    });
    alert('Message forwarded to ' + targetRoom.name);
  }
}

// ================================================================
// NEW: Emoji Reaction Picker — click star/fav area to toggle reactions
// ================================================================
const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '😡', '👍', '🔥', '🎉'];

let reactionPickerEl = null;

function buildReactionPicker() {
  if (reactionPickerEl) return;
  reactionPickerEl = document.createElement('div');
  reactionPickerEl.id = 'reactionPicker';
  reactionPickerEl.className = 'reaction-picker';
  reactionPickerEl.style.cssText = 'display:none;position:fixed;z-index:5000;background:#1d2330;border:1px solid rgba(255,255,255,0.1);border-radius:24px;padding:8px 12px;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
  reactionPickerEl.innerHTML = REACTION_EMOJIS.map(emoji =>
    `<button type="button" class="reaction-btn" data-emoji="${emoji}" style="background:none;border:none;font-size:22px;cursor:pointer;padding:4px 6px;transition:transform 0.15s;">${emoji}</button>`
  ).join('');
  reactionPickerEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.reaction-btn');
    if (!btn) return;
    const emoji = btn.dataset.emoji;
    if (socket && socket.connected && activeReactionMsgId) {
      socket.emit('chat:message:react', {
        room: activeRoomId,
        messageId: activeReactionMsgId,
        emoji: emoji
      });
    }
    hideReactionPicker();
  });
  document.body.appendChild(reactionPickerEl);
}

function showReactionPicker(x, y, msgId) {
  buildReactionPicker();
  activeReactionMsgId = msgId;
  activeReactionType = 'room';
  reactionPickerEl.style.left = Math.min(x, window.innerWidth - 280) + 'px';
  reactionPickerEl.style.top = Math.min(y, window.innerHeight - 80) + 'px';
  reactionPickerEl.style.display = 'flex';
}

function hideReactionPicker() {
  if (reactionPickerEl) reactionPickerEl.style.display = 'none';
  activeReactionMsgId = null;
}

// ================================================================
// NEW: Chat Search — search bar at top of room list
// ================================================================
let chatSearchBarEl = null;
let chatSearchInputEl = null;

function buildChatSearch() {
  if (chatSearchBarEl) return;

  const titleRow = document.querySelector('.chat-rooms-title-row');
  if (!titleRow) return;

  chatSearchBarEl = document.createElement('div');
  chatSearchBarEl.className = 'chat-search-bar';
  chatSearchBarEl.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px;';

  chatSearchInputEl = document.createElement('input');
  chatSearchInputEl.type = 'text';
  chatSearchInputEl.placeholder = '🔎 Search chats…';
  chatSearchInputEl.style.cssText = 'flex:1;height:34px;border-radius:20px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#fff;padding:0 12px;font-size:13px;outline:none;font-family:inherit;';

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.textContent = '🔎';
  toggleBtn.style.cssText = 'background:none;border:none;color:#8a9bc4;cursor:pointer;font-size:18px;';
  toggleBtn.title = 'Toggle search';

  chatSearchInputEl.addEventListener('input', () => {
    chatSearchQuery = chatSearchInputEl.value.trim().toLowerCase();
    filterRoomList();
  });

  chatSearchBarEl.appendChild(chatSearchInputEl);
  titleRow.parentNode.insertBefore(chatSearchBarEl, titleRow.nextSibling);
}

function filterRoomList() {
  if (!chatSearchQuery) {
    renderRooms();
    return;
  }
  const unread = getUnreadCounts();
  const sorted = getSortedRooms();
  const filtered = sorted.filter(r => r.name.toLowerCase().includes(chatSearchQuery));
  roomListEl.innerHTML = filtered.map(r => {
    const count = unread[r.id] || 0;
    const isCustom = !!r.isCustom;
    return `
    <div class="room-item ${r.id === activeRoomId ? 'active' : ''}" data-room="${r.id}">
      <span class="room-item-name-wrap">
        <span>${escapeHTML(r.name)}</span>
        ${isCustom ? '<span class="room-item-custom-tag">Custom</span>' : ''}
      </span>
      ${count > 0 ? `<span class="room-count">${count > 99 ? '99+' : count}</span>` : ''}
    </div>
  `;
  }).join('') || '<p class="empty-state" style="padding:12px;text-align:center;font-size:13px;">No chats match "' + escapeHTML(chatSearchQuery) + '"</p>';
}

// ================================================================
// NEW: Message Search — search messages within active room
// ================================================================
let msgSearchBarEl = null;
let msgSearchInputEl = null;

function buildMessageSearch() {
  if (msgSearchBarEl) return;
  const header = document.querySelector('.chat-header');
  if (!header) return;

  msgSearchBarEl = document.createElement('div');
  msgSearchBarEl.id = 'msgSearchBar';
  msgSearchBarEl.style.cssText = 'display:none;align-items:center;gap:8px;padding:8px 24px;border-bottom:1px solid rgba(255,255,255,0.08);';

  msgSearchInputEl = document.createElement('input');
  msgSearchInputEl.type = 'text';
  msgSearchInputEl.placeholder = '🔎 Search messages…';
  msgSearchInputEl.style.cssText = 'flex:1;height:32px;border-radius:16px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);color:#fff;padding:0 12px;font-size:13px;outline:none;font-family:inherit;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#8a9bc4;cursor:pointer;font-size:16px;padding:4px 8px;';
  closeBtn.addEventListener('click', () => {
    msgSearchBarEl.style.display = 'none';
    msgSearchInputEl.value = '';
    chatSearchActive = false;
    renderMessages();
  });

  msgSearchInputEl.addEventListener('input', () => {
    performMessageSearch(msgSearchInputEl.value.trim());
  });

  msgSearchBarEl.appendChild(msgSearchInputEl);
  msgSearchBarEl.appendChild(closeBtn);

  // Add search button to header
  const searchTriggerBtn = document.createElement('button');
  searchTriggerBtn.type = 'button';
  searchTriggerBtn.textContent = '🔎';
  searchTriggerBtn.title = 'Search messages';
  searchTriggerBtn.style.cssText = 'background:none;border:none;color:#8a9bc4;cursor:pointer;font-size:16px;padding:4px;';
  searchTriggerBtn.addEventListener('click', () => {
    msgSearchBarEl.style.display = 'flex';
    msgSearchInputEl.focus();
  });
  header.appendChild(searchTriggerBtn);

  header.parentNode.insertBefore(msgSearchBarEl, header.nextSibling);
}

function performMessageSearch(query) {
  chatSearchActive = !!query;
  chatSearchQuery = query.toLowerCase();
  if (!chatSearchActive) {
    renderMessages();
    return;
  }
  renderMessages();
}

// Override renderMessages to support search highlighting
const originalRenderMessages = renderMessages;
renderMessages = function() {
  const room = rooms.find(r => r.id === activeRoomId);
  activeRoomNameEl.textContent = room ? room.name : 'Room';

  const messages = getMessages(activeRoomId);
  const me = getUsername();
  const myUserId = getMyUserId();

  // If search active, filter messages
  let filteredMessages = messages;
  if (chatSearchActive && chatSearchQuery) {
    filteredMessages = messages.filter(m =>
      (m.text && m.text.toLowerCase().includes(chatSearchQuery)) ||
      (m.author && m.author.toLowerCase().includes(chatSearchQuery))
    );
  }

  messagesEl.innerHTML = (filteredMessages.length ? filteredMessages : messages).map(m => {
    const isMe = m.author === me;
    const isOwnMessage = !!(myUserId && m.authorId && String(m.authorId) === myUserId);
    const canDelete = isOwnMessage || isSiteOwner;
    const isStarred = starredMessages.includes(m.id);

    const replyBlock = m.replyTo
      ? `<div class="msg-quote">
           <span class="msg-quote-author">${escapeHTML(m.replyTo.author)}</span>
           <span class="msg-quote-text">${escapeHTML(m.replyTo.text)}</span>
         </div>`
      : '';

    let bodyBlock;
    if (m.media && m.media.data){
      bodyBlock = m.media.type === 'video'
        ? `<div class="media-note"><video controls preload="metadata" src="${m.media.data}"></video></div>`
        : `<div class="media-note"><img src="${m.media.data}" alt="Shared image" loading="lazy"></div>`;
    } else if (m.audio && m.audio.data){
      bodyBlock = `<div class="voice-note">
           <audio controls preload="metadata" src="${m.audio.data}"></audio>
           <span class="voice-note-duration">${formatDuration(m.audio.duration)}</span>
         </div>`;
    } else {
      // Highlight search match if active
      let displayText = escapeHTML(m.text);
      if (chatSearchActive && chatSearchQuery && m.text) {
        const lowerText = m.text.toLowerCase();
        const idx = lowerText.indexOf(chatSearchQuery);
        if (idx !== -1) {
          const before = escapeHTML(m.text.slice(0, idx));
          const match = escapeHTML(m.text.slice(idx, idx + chatSearchQuery.length));
          const after = escapeHTML(m.text.slice(idx + chatSearchQuery.length));
          displayText = before + '<mark class="search-highlight">' + match + '</mark>' + after;
        }
      }
      bodyBlock = displayText;
    }

    const replyText = m.text || (m.audio ? '🎤 Voice note' : (m.media ? (m.media.type === 'video' ? '🎬 Video' : '🖼️ Photo') : ''));

    const canEdit = isOwnMessage && !m.audio && !m.media;
    const isEditingThis = editingId === m.id;

    const deleteBlock = canDelete
      ? `<button type="button" class="msg-delete-btn" title="Delete message">🗑</button>`
      : '';

    const editBlock = canEdit
      ? `<button type="button" class="msg-edit-btn" title="Edit message">✏️</button>`
      : '';

    // Star indicator
    const starBlock = isStarred ? '<span class="msg-starred">⭐</span>' : '';

    // Reactions display
    const reactionsBlock = (m.reactions && m.reactions.length)
      ? `<span class="msg-reactions">${m.reactions.map(r => r.emoji).join(' ')}</span>`
      : '';

    const authorIsClickable = !isMe && !!m.authorId;
    const authorSpan = authorIsClickable
      ? `<button type="button" class="msg-author msg-author-link" data-uid="${escapeHTML(String(m.authorId))}" data-username="${escapeHTML(m.author)}" title="View profile & message ${escapeHTML(m.author)}">${escapeHTML(m.author)}</button>`
      : `<span class="msg-author">${escapeHTML(m.author)}</span>`;

    const editedTag = m.edited ? `<span class="msg-edited-tag">(edited)</span>` : '';

    // Sent/Delivered indicators (for own messages in DMs, shown as ticks)
    const tickBlock = isMe && m.fromUserId ? `<span class="msg-tick" style="margin-left:4px;opacity:0.6;">✓</span>` : '';

    const bubbleInner = isEditingThis
      ? `<form class="msg-edit-form" data-id="${escapeHTML(m.id || '')}">
           <input type="text" class="msg-edit-input" value="${escapeHTML(m.text || '')}" maxlength="500">
           <button type="submit" class="msg-edit-save">Save</button>
           <button type="button" class="msg-edit-cancel">✕</button>
         </form>`
      : `${replyBlock}
         ${authorSpan}
         ${bodyBlock}
         <span class="msg-time">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}${editedTag}${tickBlock}</span>
         ${reactionsBlock}
         ${starBlock}`;

    return `
    <div class="msg-row ${isMe ? 'me' : ''} ${isStarred ? 'starred' : ''}" data-id="${escapeHTML(m.id || '')}" data-author="${escapeHTML(m.author)}" data-text="${escapeHTML(replyText)}">
      <span class="msg-reply-icon">↩</span>
      ${editBlock}
      ${deleteBlock}
      <div class="msg ${isMe ? 'me' : ''}">
        ${bubbleInner}
      </div>
    </div>`;
  }).join('') || '<p class="empty-state">' + (chatSearchActive ? 'No messages match your search.' : 'No messages yet — say hi 👋') + '</p>';

  if (!chatSearchActive) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
};

// ================================================================
// NEW: Voice Message Playback Speed — add speed selector to audio elements
// ================================================================
function addVoiceSpeedControls() {
  document.querySelectorAll('.voice-note audio').forEach(audio => {
    if (audio.dataset.speedAdded) return;
    audio.dataset.speedAdded = 'true';
    const parent = audio.closest('.voice-note');
    if (!parent) return;
    // Check if speed control already exists
    if (parent.querySelector('.voice-speed-btn')) return;
    const speedBtn = document.createElement('button');
    speedBtn.type = 'button';
    speedBtn.className = 'voice-speed-btn';
    speedBtn.textContent = '1x';
    speedBtn.style.cssText = 'background:rgba(255,255,255,0.1);border:none;color:#fff;font-size:10px;padding:2px 6px;border-radius:8px;cursor:pointer;flex-shrink:0;font-family:inherit;';
    const speeds = [0.5, 1, 1.5, 2];
    let idx = 1; // starts at 1x
    speedBtn.addEventListener('click', () => {
      idx = (idx + 1) % speeds.length;
      audio.playbackRate = speeds[idx];
      speedBtn.textContent = speeds[idx] + 'x';
    });
    parent.querySelector('.voice-note-duration').insertAdjacentElement('afterend', speedBtn);
  });
}

// Periodically check for new audio elements and add speed controls
const speedObserver = new MutationObserver(() => addVoiceSpeedControls());
if (messagesEl) {
  speedObserver.observe(messagesEl, { childList: true, subtree: true });
}

// ================================================================
// NEW: Floating "New Messages" Button — appears when scrolled up
// ================================================================
let newMsgBtnEl = null;

function buildNewMsgButton() {
  if (newMsgBtnEl) return;
  newMsgBtnEl = document.createElement('button');
  newMsgBtnEl.type = 'button';
  newMsgBtnEl.id = 'newMsgBtn';
  newMsgBtnEl.textContent = '⬇ New messages';
  newMsgBtnEl.style.cssText = 'display:none;position:absolute;bottom:80px;left:50%;transform:translateX(-50%);background:#0066ff;border:none;color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;z-index:100;box-shadow:0 4px 15px rgba(0,102,255,0.4);font-family:inherit;';
  newMsgBtnEl.addEventListener('click', () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    newMsgBtnEl.style.display = 'none';
  });
  const chatMain = document.querySelector('.chat-main');
  if (chatMain) {
    chatMain.style.position = 'relative';
    chatMain.appendChild(newMsgBtnEl);
  }
}

function handleScrollForNewMsgBtn() {
  if (!newMsgBtnEl) return;
  const isAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
  newMsgBtnEl.style.display = isAtBottom ? 'none' : 'block';
}

if (messagesEl) {
  messagesEl.addEventListener('scroll', handleScrollForNewMsgBtn);
}

// ================================================================
// NEW: Handle socket events for reactions, forward, and starred updates
// ================================================================
if (socket) {
  socket.on('chat:message:reacted', ({ room, messageId, reactions } = {}) => {
    if (!room || !messageId) return;
    const messages = getMessages(room);
    const target = messages.find(m => m.id === messageId);
    if (target) {
      target.reactions = reactions || [];
      saveMessages(room, messages);
      if (room === activeRoomId) renderMessages();
    }
  });

  socket.on('chat:message:forwarded', ({ room, message } = {}) => {
    if (!room || !message) return;
    const messages = getMessages(room);
    messages.push(message);
    saveMessages(room, messages);
    if (room === activeRoomId) renderMessages();
    renderRooms();
  });

  socket.on('chat:message:starred', ({ messageId, starred } = {}) => {
    if (!messageId) return;
    if (starred) {
      if (!starredMessages.includes(messageId)) starredMessages.push(messageId);
    } else {
      starredMessages = starredMessages.filter(id => id !== messageId);
    }
    renderMessages();
  });

  socket.on('dm:message:reacted', ({ messageId, reactions } = {}) => {
    // Handled by Contacts.js
  });
}

/* -----------------------------------------------------------
   INIT
----------------------------------------------------------- */
renderRooms();
renderMessages();
fetchCustomRooms();
fetchOwnerStatus();
fetchUserState(); // Load pinned, starred, muted, archived, darkMode, wallpaper
buildChatSearch(); // Build chat search bar
buildMessageSearch(); // Build message search bar
buildNewMsgButton(); // Build floating new messages button
buildContextMenu(); // Build context menu
addVoiceSpeedControls(); // Add speed controls to existing audio elements

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
