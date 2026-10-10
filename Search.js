/*==============================
REMIX-NEXUS — SEARCH LOGIC
Filters the shared room list (DEFAULT_ROOMS from rooms.js) AND the
logged-in user's contacts as the person types. Discord-style rows,
filter chips, "/" to focus, Esc to clear.
==============================*/

const searchInput = document.getElementById('searchInput');
const resultsList = document.getElementById('resultsList');
const contactsHint = document.getElementById('contactsHint');
const chipsBar = document.getElementById('searchChips');

let contactsCache = []; // stays [] for guests / failed fetches
let activeFilter = 'all'; // all | rooms | contacts

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

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

  const rooms = activeFilter === 'contacts' ? [] : matchingRooms(q);
  const contacts = activeFilter === 'rooms' ? [] : matchingContacts(q);

  if (rooms.length === 0 && contacts.length === 0){
    resultsList.innerHTML = `<p class="empty-state"><b>🔭</b>No ${activeFilter === 'all' ? 'rooms or contacts' : activeFilter} match that search.</p>`;
    return;
  }

  let html = '';

  if (rooms.length > 0){
    html += `<h3 class="results-section-title">Rooms <small>— ${rooms.length}</small></h3>`;
    html += rooms.map(r => `
      <a class="result-item" href="./Chat.html?room=${encodeURIComponent(r.id)}">
        <span class="result-icon">#</span>
        <span class="result-text">
          <span class="name">${escapeHtml(r.name)}</span>
          <span class="sub">Squad room</span>
        </span>
        <span class="enter">Enter chat →</span>
      </a>
    `).join('');
  }

  if (contacts.length > 0){
    html += `<h3 class="results-section-title">Contacts <small>— ${contacts.length}</small></h3>`;
    html += contacts.map(c => `
      <a class="result-item" href="./Contacts.html?user=${encodeURIComponent(c.id)}">
        <span class="result-icon avatar">${escapeHtml(c.avatar || '🎮')}</span>
        <span class="result-text">
          <span class="name">${escapeHtml(c.username)}</span>
          ${c.email ? `<span class="sub">${escapeHtml(c.email)}</span>` : ''}
        </span>
        <span class="enter">Message →</span>
      </a>
    `).join('');
  }

  resultsList.innerHTML = html;
}

searchInput.addEventListener('input', (e) => renderResults(e.target.value));

// Filter chips
chipsBar.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  activeFilter = chip.dataset.filter;
  chipsBar.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
  renderResults(searchInput.value);
});

// Keyboard: "/" jumps to search, Esc clears it (Discord-style).
document.addEventListener('keydown', (e) => {
  const typing = /^(input|textarea|select)$/i.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    renderResults('');
    searchInput.blur();
  }
});

// Only auto-focus where there is a physical keyboard (avoids a pop-up keyboard on phones).
if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  searchInput.focus();
}

loadContacts().then(() => renderResults(searchInput.value));
renderResults('');
