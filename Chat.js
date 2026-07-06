/*==============================
REMIX-NEXUS — CHAT LOGIC
Talks to the Express + Socket.io server hosted on Railway.
==============================*/

console.log('DEBUG window.AUTH exists?', !!window.AUTH);
console.log('DEBUG AUTH.getToken() at socket-creation time:', window.AUTH ? AUTH.getToken() : 'no AUTH object');

const socket = io("https://remix-nexus-production.up.railway.app", {
  auth: { token: window.AUTH ? AUTH.getToken() : null }
});

console.log('DEBUG socket.auth immediately after creation:', socket.auth);

/* -----------------------------------------------------------
   ROOMS (DEFAULT_ROOMS comes from rooms.js, loaded before this file)
----------------------------------------------------------- */
function getRooms(){
  try {
    const raw = localStorage.getItem('remix-nexusRooms');
    const stored = raw ? JSON.parse(raw) : null;
    return Array.isArray(stored) && stored.length ? stored : DEFAULT_ROOMS;
  } catch { return DEFAULT_ROOMS; }
}

function saveRooms(rooms){
  localStorage.setItem('remix-nexusRooms', JSON.stringify(rooms));
}

// Local per-room message cache, used only so the sidebar can show a
// message count and so switching rooms feels instant before history arrives.
function getMessages(roomId){
  try {
    const raw = localStorage.getItem('remix-nexusMessages:' + roomId);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveMessages(roomId, messages){
  localStorage.setItem('remix-nexusMessages:' + roomId, JSON.stringify(messages));
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
let rooms = getRooms();
const params = new URLSearchParams(window.location.search);
let activeRoomId = (params.get('room') && rooms.some(r => r.id === params.get('room')))
  ? params.get('room')
  : (rooms[0]?.id || 'lounge');

const roomListEl = document.getElementById('roomList');
const messagesEl = document.getElementById('messages');
const activeRoomNameEl = document.getElementById('activeRoomName');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const newRoomInput = document.getElementById('newRoomName');
const createRoomBtn = document.getElementById('createRoomBtn');
const connectionBadge = document.getElementById('connectionBadge');

const replyPreview = document.getElementById('replyPreview');
const replyPreviewAuthor = document.getElementById('replyPreviewAuthor');
const replyPreviewText = document.getElementById('replyPreviewText');
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

function formatDuration(seconds){
  const total = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

if (cancelReplyBtn){
  cancelReplyBtn.addEventListener('click', clearReplyTarget);
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
  socket.on('connect', () => { updateConnectionBadge(); switchRoom(activeRoomId); });
  socket.on('disconnect', updateConnectionBadge);
  socket.on('connect_error', updateConnectionBadge);
}
updateConnectionBadge();

function renderRooms(){
  roomListEl.innerHTML = rooms.map(r => `
    <div class="room-item ${r.id === activeRoomId ? 'active' : ''}" data-room="${r.id}">
      <span>${escapeHTML(r.name)}</span>
      <span class="room-count">${getMessages(r.id).length}</span>
    </div>
  `).join('');
}

function renderMessages(){
  const room = rooms.find(r => r.id === activeRoomId);
  activeRoomNameEl.textContent = room ? room.name : 'Room';

  const messages = getMessages(activeRoomId);
  const me = getUsername();
  const myUserId = getMyUserId();

  messagesEl.innerHTML = messages.map(m => {
    const isMe = m.author === me;
    const canDelete = !!(myUserId && m.authorId && String(m.authorId) === myUserId);

    const replyBlock = m.replyTo
      ? `<div class="msg-quote">
           <span class="msg-quote-author">${escapeHTML(m.replyTo.author)}</span>
           <span class="msg-quote-text">${escapeHTML(m.replyTo.text)}</span>
         </div>`
      : '';

    const bodyBlock = (m.audio && m.audio.data)
      ? `<div class="voice-note">
           <audio controls preload="metadata" src="${m.audio.data}"></audio>
           <span class="voice-note-duration">${formatDuration(m.audio.duration)}</span>
         </div>`
      : escapeHTML(m.text);

    const replyText = m.text || (m.audio ? '🎤 Voice note' : '');

    const canEdit = canDelete && !m.audio; // voice notes can't be edited, only text
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

  onlineUsers = [];
  renderOnlineList();
  renderRooms();
  renderMessages();
}

function sendMessage(text){
  const trimmed = text.trim();
  if (!trimmed) return;

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

function createRoom(name){
  const trimmed = name.trim();
  if (!trimmed) return;
  const id = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || ('room-' + Date.now());
  if (rooms.some(r => r.id === id)) { switchRoom(id); return; }

  rooms.push({ id, name: trimmed });
  saveRooms(rooms);
  switchRoom(id);
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

  // Only treat this as a reply-swipe if the motion is mostly horizontal
  // and leftward — otherwise let the page scroll normally.
  if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5 && deltaX < 0){
    touchState.active = true;
    const clamped = Math.max(deltaX, -SWIPE_MAX_PX);
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

  if (active && deltaX <= -SWIPE_TRIGGER_PX){
    setReplyTarget(readMsgFromRow(row));
  }

  touchState = null;
});

/* -----------------------------------------------------------
   EVENTS
----------------------------------------------------------- */
roomListEl.addEventListener('click', (e) => {
  const item = e.target.closest('.room-item');
  if (!item) return;
  switchRoom(item.dataset.room);
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(messageInput.value);
  messageInput.value = '';
});

createRoomBtn.addEventListener('click', () => {
  createRoom(newRoomInput.value);
  newRoomInput.value = '';
});

newRoomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter'){
    e.preventDefault();
    createRoom(newRoomInput.value);
    newRoomInput.value = '';
  }
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
    if (room === activeRoomId) renderMessages();
    renderRooms();
  });

  socket.on('chat:online', ({ room, users }) => {
    if (room !== activeRoomId) return;
    onlineUsers = users || [];
    renderOnlineList();
  });

  if (socket.connected) socket.emit('chat:join', { room: activeRoomId });
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

/* -----------------------------------------------------------
   DESKTOP LAYOUT FIX — keep the chat panel's height pinned to the
   real leftover viewport space so long conversations scroll inside
   the panel instead of growing the whole page. Mobile/tablet keeps
   its original natural-page-scroll behavior untouched.
----------------------------------------------------------- */
const DESKTOP_BREAKPOINT = 821;

function adjustChatShellHeight(){
  if (window.innerWidth < DESKTOP_BREAKPOINT){
    document.documentElement.style.removeProperty('--chat-shell-height');
    return;
  }

  const header = document.querySelector('.nav-bar');
  const footer = document.querySelector('.footer');
  const shell = document.querySelector('.chat-shell');
  if (!header || !footer || !shell) return;

  const headerBottom = header.getBoundingClientRect().bottom;
  const footerHeight = footer.offsetHeight;
  const shellStyles = getComputedStyle(shell);
  const shellMarginTop = parseFloat(shellStyles.marginTop) || 0;
  const shellMarginBottom = parseFloat(shellStyles.marginBottom) || 0;
  const buffer = 20; // a little breathing room so nothing touches the footer

  const available = window.innerHeight
    - headerBottom
    - shellMarginTop
    - shellMarginBottom
    - footerHeight
    - buffer;

  document.documentElement.style.setProperty('--chat-shell-height', Math.max(available, 480) + 'px');
}

window.addEventListener('resize', adjustChatShellHeight);
window.addEventListener('load', adjustChatShellHeight);
adjustChatShellHeight();

/* -----------------------------------------------------------
   INIT
----------------------------------------------------------- */
renderRooms();
renderMessages();
