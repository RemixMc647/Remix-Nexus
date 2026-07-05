/* ===============================
   REMIXMC — LATEST VIDEOS
   Add your own video IDs below (the part after "v=" in a
   YouTube URL). No API key needed for this list — swap it
   for a live YouTube Data API v3 fetch later if you want the
   list to update automatically.
================================== */
const YT_CHANNEL_HANDLE = '@remixmc-d6v';

const VIDEOS = [
  { id: '', title: 'Add your latest upload here', meta: '🎮 Set the video ID in Trending.js', badge: 'NEW' },
  { id: '', title: 'Add another video here', meta: '🎮 Set the video ID in Trending.js', badge: 'HOT' },
  { id: '', title: 'Add another video here', meta: '🎮 Set the video ID in Trending.js', badge: 'CLIP' },
];

function videoCardHTML(video, index){
  const player = video.id
    ? `<iframe src="https://www.youtube.com/embed/${video.id}" title="${video.title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`
    : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:60px;">▶️</div>`;

  const watchHref = video.id
    ? `https://www.youtube.com/watch?v=${video.id}`
    : `https://www.youtube.com/${YT_CHANNEL_HANDLE}/videos`;

  return `
    <div class="video-card">
      <div class="trending-badge">${video.badge || '#' + (index + 1)}</div>
      <div class="video-thumb-wrap">${player}</div>
      <h3 class="video-title">${video.title}</h3>
      <div class="video-meta">${video.meta}</div>
      <div class="card-buttons">
        <a class="watch-btn" href="${watchHref}" target="_blank" rel="noopener">▶ Watch on YouTube</a>
        <button class="share-btn" data-share="${watchHref}">🔗 Share</button>
      </div>
    </div>
  `;
}

function renderVideos(){
  const wrap = document.getElementById('videoSection');
  if (!wrap) return;
  wrap.innerHTML = VIDEOS.map(videoCardHTML).join('');

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-share]');
    if (!btn) return;
    const url = btn.getAttribute('data-share');
    navigator.clipboard?.writeText(url).then(() => {
      btn.textContent = '✅ Copied';
      setTimeout(() => { btn.textContent = '🔗 Share'; }, 1600);
    }).catch(() => alert('Share this link: ' + url));
  });
}

document.addEventListener('DOMContentLoaded', renderVideos);

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
