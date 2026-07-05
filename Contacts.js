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
const dmConnectionBadge = document.getElementById('dmConnectionBadge');
const dmMessagesEl = document.getElementById('dmMessages');
const dmMessageForm = document.getElementById('dmMessageForm');
const dmMessageInput = document.getElementById('dmMessageInput');

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
    return `
      <div class="msg ${isMe ? 'me' : ''}">
        <span class="msg-author">${isMe ? 'You' : escapeHTML(activeContact.username)}</span>
        ${escapeHTML(m.text)}
        <span class="msg-time">${new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
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

async function openContact(contactId){
  const contact = contacts.find(c => c.id === contactId);
  if (!contact) return;

  activeContact = contact;
  activeContactNameEl.textContent = contact.username;
  renderContactList();

  dmMessageInput.disabled = false;
  dmMessageForm.querySelector('button[type="submit"]').disabled = false;
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

dmMessageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = dmMessageInput.value.trim();
  if (!text || !activeContact || !socket) return;

  socket.emit('dm:message', { toUserId: activeContact.id, text });
  dmMessageInput.value = '';
});

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
  }
  updateDmBadge();

  loadContacts();
})();
