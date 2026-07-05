/*==============================
REMIX-NEXUS — CHAT LOGIC
Talks to the Express + Socket.io server hosted on Railway.
==============================*/

const socket = io("https://remix-nexus-production.up.railway.app", {
  auth: { token: window.AUTH ? AUTH.getToken() : null }
});

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

let replyingTo = null; // { id, author, text }

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

  messagesEl.innerHTML = messages.map(m => {
    const isMe = m.author === me;
    const replyBlock = m.replyTo
      ? `<div class="msg-quote">
           <span class="msg-quote-author">${escapeHTML(m.replyTo.author)}</span>
           <span class="msg-quote-text">${escapeHTML(m.replyTo.text)}</span>
         </div>`
      : '';

    return `
    <div class="msg-row ${isMe ? 'me' : ''}" data-id="${escapeHTML(m.id || '')}" data-author="${escapeHTML(m.author)}" data-text="${escapeHTML(m.text)}">
      <span class="msg-reply-icon">↩</span>
      <div class="msg ${isMe ? 'me' : ''}">
        ${replyBlock}
        <span class="msg-author">${escapeHTML(m.author)}</span>
        ${escapeHTML(m.text)}
        <span class="msg-time">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
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

function switchRoom(roomId){
  activeRoomId = roomId;
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomId);
  window.history.replaceState({}, '', url);

  if (socket && socket.connected){
    socket.emit('chat:join', { room: activeRoomId });
  }

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

  if (socket.connected) socket.emit('chat:join', { room: activeRoomId });
}

/* -----------------------------------------------------------
   INIT
----------------------------------------------------------- */
renderRooms();
renderMessages();
