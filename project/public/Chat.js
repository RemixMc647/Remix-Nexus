/*==============================
REMIXMC — CHAT LOGIC
Talks to the same Express + Socket.io server that serves
this page (same-origin, so no URL config needed).
==============================*/

const socket = window.io ? io(BACKEND_URL) : null;

/* -----------------------------------------------------------
   ROOMS (DEFAULT_ROOMS comes from rooms.js, loaded before this file)
----------------------------------------------------------- */
function getRooms(){
  try {
    const raw = localStorage.getItem('remixmcRooms');
    const stored = raw ? JSON.parse(raw) : null;
    return Array.isArray(stored) && stored.length ? stored : DEFAULT_ROOMS;
  } catch { return DEFAULT_ROOMS; }
}

function saveRooms(rooms){
  localStorage.setItem('remixmcRooms', JSON.stringify(rooms));
}

// Local per-room message cache, used only so the sidebar can show a
// message count and so switching rooms feels instant before history arrives.
function getMessages(roomId){
  try {
    const raw = localStorage.getItem('remixmcMessages:' + roomId);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveMessages(roomId, messages){
  localStorage.setItem('remixmcMessages:' + roomId, JSON.stringify(messages));
}

// Prefer the logged-in account's username. Otherwise, remember a
// per-browser guest name so a person's messages stay consistent.
function getUsername(){
  const user = window.AUTH ? AUTH.getUser() : null;
  if (user && user.username) return user.username;

  let guest = localStorage.getItem('remixmcGuestName');
  if (!guest) {
    guest = 'Guest' + Math.floor(Math.random() * 10000);
    localStorage.setItem('remixmcGuestName', guest);
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

  messagesEl.innerHTML = messages.map(m => `
    <div class="msg ${m.author === me ? 'me' : ''}">
      <span class="msg-author">${escapeHTML(m.author)}</span>
      ${escapeHTML(m.text)}
      <span class="msg-time">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
    </div>
  `).join('') || '<p class="empty-state">No messages yet — say hi 👋</p>';

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

  const message = { author: getUsername(), text: trimmed, time: Date.now() };

  if (socket && socket.connected){
    socket.emit('chat:message', { room: activeRoomId, message });
    return;
  }

  // Server unreachable — still let the person see their own message locally
  const messages = getMessages(activeRoomId);
  messages.push(message);
  saveMessages(activeRoomId, messages);
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
