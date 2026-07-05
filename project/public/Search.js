/*==============================
REMIXMC — SEARCH LOGIC
Filters the shared room list (DEFAULT_ROOMS from rooms.js)
as the person types.
==============================*/

const searchInput = document.getElementById('searchInput');
const resultsList = document.getElementById('resultsList');

function renderResults(query){
  const q = query.trim().toLowerCase();

  const rooms = !q
    ? DEFAULT_ROOMS
    : DEFAULT_ROOMS.filter(r => r.name.toLowerCase().includes(q) || r.id.includes(q));

  if (rooms.length === 0){
    resultsList.innerHTML = '<p class="empty-state">No rooms match that search.</p>';
    return;
  }

  resultsList.innerHTML = rooms.map(r => `
    <a class="result-item" href="./Chat.html?room=${encodeURIComponent(r.id)}">
      <span class="name">${r.name}</span>
      <span class="enter">Enter chat →</span>
    </a>
  `).join('');
}

searchInput.addEventListener('input', (e) => renderResults(e.target.value));

renderResults('');
