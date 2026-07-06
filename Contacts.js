/*==============================
REMIX-NEXUS — CONTACTS / DM LOGIC
Lists people you've shared a chat room with, and lets you
message any of them privately, one-to-one, like a DM.
==============================*/

const API_BASE = 'https://remix-nexus-production.up.railway.app';

const loggedOutEl = document.getElementById('contacts-loggedout');
const shellEl = document.getElementById('contacts-shell');

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

let socket = null;
let me = null;
let contacts = [];
let activeContact = null; // { id, username, avatar, ... }
let activeMessages = [];

function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

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

  contactListEl.innerHTML = contacts.map(c => `
    <div class="contact-item ${activeContact && activeContact.id === c.id ? 'active' : ''}" data-id="${c.id}">
      <div class="contact-avatar">${c.avatar || '🎮'}</div>
      <span class="contact-name">${escapeHTML(c.username)}</span>
    </div>
  `).join('');
}

function renderDMMessages(){
  if (!activeMessages.length){
    dmMessagesEl.innerHTML = '<p class="empty-state">No messages yet — say hi 👋</p>';
    return;
  }

  dmMessagesEl.innerHTML = activeMessages.map(m => {
    const isMe = String(m.fromUserId) === String(me.id);
    const hasMedia = m.media && m.media.data;

    const bodyBlock = hasMedia
      ? (m.media.type === 'video'
          ? `<div class="media-note"><video controls preload="metadata" src="${m.media.data}"></video></div>`
          : `<div class="media-note"><img src="${m.media.data}" alt="Shared image" loading="lazy"></div>`)
      : `<span class="msg-text">${escapeHTML(m.text)}</span>`;

    // Media messages can't be edited, only deleted — same rule as
    // voice notes in room chat.
    const editBtn = (isMe && !hasMedia)
      ? `<button type="button" class="msg-edit-btn" title="Edit message">✏️</button>`
      : '';

    return `
      <div class="msg ${isMe ? 'me' : ''}" data-id="${m.id}">
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
  renderContactHeader(contact);
  renderContactList();

  dmMessageInput.disabled = false;
  dmMessageForm.querySelector('button[type="submit"]').disabled = false;
  if (dmAttachBtn) dmAttachBtn.disabled = false;
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
});

dmMessagesEl.addEventListener('click', (e) => {
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

  socket.emit('dm:message', { toUserId: activeContact.id, text });
  dmMessageInput.value = '';
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

async function sendDmMedia(file){
  if (!file || !activeContact || !socket) return;

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage){
    alert('Only photos and videos can be sent this way.');
    return;
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
    media: { type: isVideo ? 'video' : 'image', data: dataUrl }
  });
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

function handleIncomingDM(payload){
  if (!activeContact) return;

  const belongsToActiveConversation =
    (String(payload.fromUserId) === String(activeContact.id) && String(payload.toUserId) === String(me.id)) ||
    (String(payload.fromUserId) === String(me.id) && String(payload.toUserId) === String(activeContact.id));

  if (!belongsToActiveConversation) return;

  activeMessages.push(payload);
  renderDMMessages();
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
    socket.on('chat:error', (payload) => {
      if (payload && payload.message) window.alert(payload.message);
    });
  }
  updateDmBadge();

  await loadContacts();

  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid');
  if (uid && uid !== String(me.id)){
    openContact(uid, {
      username: params.get('username') || '',
      avatar: params.get('avatar') || ''
    });
  }
})();
