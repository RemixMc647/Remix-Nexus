const API_BASE = "https://remix-nexus-bgz9.onrender.com";

// ===============================
// "MOST ACTIVE RIGHT NOW" — shown just above the newsletter Subscribe
// button. Pulls whichever chat room has the most messages right now,
// then whoever is posting the most inside that one room, and names them.
// ===============================
(function () {
  const el = document.getElementById('most-active-name');
  if (!el) return;

  fetch(API_BASE + '/api/stats/most-active-user')
    .then((res) => res.json())
    .then((data) => {
      if (!data || !data.available) {
        el.textContent = '';
        el.style.display = 'none';
        return;
      }
      el.innerHTML = `${data.avatar || '🎮'} <strong>${escapeHTML(data.username)}</strong> is on fire right now in <strong>${escapeHTML(data.roomName)}</strong>`;
      el.style.display = '';
    })
    .catch(() => {
      el.textContent = '';
      el.style.display = 'none';
    });

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
})();

/* ===============================
   REMIX-NEXUS — LIVE GAMING NEWS
   Pulls real, current headlines from around the gaming world (via the
   backend's /api/news/gaming route — see server.js) instead of showing
   fixed clips. Refreshes itself every 10 minutes while the page stays
   open, Discord/Snapchat-Discover style.
================================== */
function timeAgo(dateStr){
  const then = new Date(dateStr).getTime();
  if (!then || Number.isNaN(then)) return '';
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function newsCardHTML(item, index){
  const badge = index === 0 ? 'BREAKING' : (index === 1 ? 'HOT' : '#' + (index + 1));
  const thumb = item.image
    ? `<img src="${item.image}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">`
    : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:60px;">📰</div>`;

  return `
    <div class="video-card">
      <div class="trending-badge">${badge}</div>
      <div class="video-thumb-wrap">${thumb}</div>
      <h3 class="video-title">${item.title}</h3>
      <div class="video-meta">📰 ${item.source}${item.pubDate ? ' • ' + timeAgo(item.pubDate) : ''}</div>
      <div class="card-buttons">
        <a class="watch-btn" href="${item.link}" target="_blank" rel="noopener">📰 Read Article</a>
        <button class="share-btn" data-share="${item.link}">🔗 Share</button>
      </div>
    </div>
  `;
}

function renderGamingNews(items){
  const wrap = document.getElementById('videoSection');
  if (!wrap) return;

  if (!items || !items.length) {
    wrap.innerHTML = `<p class="empty-state">No headlines available right now — check back soon.</p>`;
    return;
  }

  wrap.innerHTML = items.map(newsCardHTML).join('');

  wrap.addEventListener('click', (e) => {
    const shareBtn = e.target.closest('button[data-share]');
    if (shareBtn) {
      const url = shareBtn.getAttribute('data-share');
      navigator.clipboard?.writeText(url).then(() => {
        shareBtn.textContent = '✅ Copied';
        setTimeout(() => { shareBtn.textContent = '🔗 Share'; }, 1600);
      }).catch(() => alert('Share this link: ' + url));
    }
  });
}

function loadGamingNews(){
  const wrap = document.getElementById('videoSection');
  if (wrap && !wrap.dataset.loadedOnce) {
    wrap.innerHTML = `<p class="empty-state">Loading the latest gaming headlines…</p>`;
  }

  fetch(API_BASE + '/api/news/gaming')
    .then((res) => res.json())
    .then((data) => {
      renderGamingNews(data && data.available ? data.items : []);
      if (wrap) wrap.dataset.loadedOnce = 'true';
    })
    .catch(() => renderGamingNews([]));
}

document.addEventListener('DOMContentLoaded', loadGamingNews);
// Keep it feeling "live" without needing a page refresh.
setInterval(loadGamingNews, 10 * 60 * 1000);

/* ===============================
   REMIX-NEXUS — WEEKLY LEADERBOARD
   Top 3 most active users (by messages sent in the last 7 days), each
   shown with the one room they were most active in. Pulled from
   /api/stats/leaderboard — see server.js.
================================== */
const RANK_BADGES = ['🥇', '🥈', '🥉'];

function leaderCardHTML(leader, index){
  return `
    <div class="artist-card">
      <h3>${RANK_BADGES[index] || '🏅'} ${leader.avatar} ${escapeHTMLNews(leader.username)}</h3>
      <span>Most active in <strong>${escapeHTMLNews(leader.roomName)}</strong> — ${leader.weeklyMessageCount} messages this week</span>
    </div>
  `;
}

function escapeHTMLNews(str){
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function renderLeaderboard(leaders){
  const grid = document.getElementById('leaderboardGrid');
  if (!grid) return;

  if (!leaders || !leaders.length) {
    grid.innerHTML = `<p class="empty-state">No activity yet this week — be the first on the board!</p>`;
    return;
  }

  grid.innerHTML = leaders.map(leaderCardHTML).join('');
}

function loadLeaderboard(){
  fetch(API_BASE + '/api/stats/leaderboard')
    .then((res) => res.json())
    .then((data) => renderLeaderboard(data && data.available ? data.leaders : []))
    .catch(() => renderLeaderboard([]));
}

document.addEventListener('DOMContentLoaded', loadLeaderboard);
// Rolling 7-day window, so refreshing occasionally keeps it current —
// no need for a hard weekly reset.
setInterval(loadLeaderboard, 10 * 60 * 1000);

// ===============================
// NEWSLETTER SUBSCRIBE (Mailchimp)
// ===============================

(function () {
  const form = document.getElementById('newsletter-form');
  const emailInput = document.getElementById('newsletter-email');
  const message = document.getElementById('newsletter-message');

  if (!form || !emailInput || !message) return;

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  form.addEventListener('submit', function (e) {
    const email = emailInput.value.trim();

    if (!isValidEmail(email)) {
      e.preventDefault();
      message.textContent = 'Please enter a valid email address.';
      message.style.color = '#ff5b5b';
      return;
    }

    if (form.action.includes('YOUR_MAILCHIMP_ACTION_URL')) {
      e.preventDefault();
      message.textContent = 'Newsletter is not connected yet — add your Mailchimp form action URL in the HTML.';
      message.style.color = '#ff5b5b';
      return;
    }

    message.textContent = 'Thanks for subscribing! Check the new tab to confirm.';
    message.style.color = '#00e676';
    emailInput.value = '';
  });
})();
