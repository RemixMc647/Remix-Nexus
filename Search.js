/*==============================
REMIX-NEXUS — SEARCH LOGIC
Filters the shared room list (DEFAULT_ROOMS from rooms.js) AND the
logged-in user's contacts, WhatsApp-style, as the person types.
==============================*/

const searchInput = document.getElementById('searchInput');
const resultsList = document.getElementById('resultsList');
const contactsHint = document.getElementById('contactsHint');

let contactsCache = []; // stays [] for guests / failed fetches

async function loadContacts() {
  if (!AUTH.isLoggedIn()) {
    if (contactsHint) contactsHint.style.display = 'block';
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/contacts`, {
      headers: { Authorization: 'Bearer ' + AUTH.getToken() }
    });

    if (!res.ok) return;

    const data = await res.json();
    contactsCache = Array.isArray(data.contacts) ? data.contacts : [];
  } catch (err) {
    // Silently fall back to room-only search if the backend is unreachable.
  }
}

function matchingRooms(q){
  return !q
    ? DEFAULT_ROOMS
    : DEFAULT_ROOMS.filter(r => r.name.toLowerCase().includes(q) || r.id.includes(q));
}

function matchingContacts(q){
  if (!q) return contactsCache;
  return contactsCache.filter(c =>
    (c.username || '').toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  );
}

function renderResults(query){
  const q = query.trim().toLowerCase();

  const rooms = matchingRooms(q);
  const contacts = matchingContacts(q);

  if (rooms.length === 0 && contacts.length === 0){
    resultsList.innerHTML = '<p class="empty-state">No rooms or contacts match that search.</p>';
    return;
  }

  let html = '';

  if (rooms.length > 0){
    html += `<h3 class="results-section-title">🎮 Rooms</h3>`;
    html += rooms.map(r => `
      <a class="result-item" href="./Chat.html?room=${encodeURIComponent(r.id)}">
        <span class="name">${r.name}</span>
        <span class="enter">Enter chat →</span>
      </a>
    `).join('');
  }

  if (contacts.length > 0){
    html += `<h3 class="results-section-title">👥 Contacts</h3>`;
    html += contacts.map(c => `
      <a class="result-item" href="./Contacts.html?user=${encodeURIComponent(c.id)}">
        <span class="name">${c.avatar || '🎮'} ${c.username}</span>
        <span class="enter">Message →</span>
      </a>
    `).join('');
  }

  resultsList.innerHTML = html;
}

searchInput.addEventListener('input', (e) => renderResults(e.target.value));

loadContacts().then(() => renderResults(searchInput.value));
renderResults('');
