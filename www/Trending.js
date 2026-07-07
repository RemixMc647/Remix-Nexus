/* ===============================
   REMIX-NEXUS — LATEST VIDEOS
   These clips are hosted directly on your own site (as .mp4 files
   sitting next to this script), so they play right here on the page —
   nothing links out to YouTube. To add more clips, just drop another
   .mp4 file next to this one and add an entry below.
================================== */
const YT_CHANNEL_HANDLE = '@remixmc-d6v';

const VIDEOS = [
  { file: './#minecraft.mp4', title: 'Minecraft Clip #1', meta: '🎮 Community clip', badge: 'NEW' },
  { file: './#minecraft (1).mp4', title: 'Minecraft Clip #2', meta: '🎮 Community clip', badge: 'HOT' },
  { file: './#minecraft (2).mp4', title: 'Minecraft Clip #3', meta: '🎮 Community clip', badge: 'CLIP' },
];

function videoCardHTML(video, index){
  const videoId = `clip-${index}`;

  // A raw '#' in a URL marks the start of a fragment identifier, and a raw
  // space isn't valid in a URL either — so a filename like
  // './#minecraft.mp4' gets parsed as "go to './', jump to fragment
  // #minecraft.mp4", and the browser never actually requests the file.
  // Encoding each path segment (preserving the '/' separators) fixes both
  // video playback and the "Share" button's copied link.
  const encodedSrc = video.file ? video.file.split('/').map(encodeURIComponent).join('/') : '';

  const player = video.file
    ? `<video id="${videoId}" controls preload="metadata" playsinline><source src="${encodedSrc}" type="video/mp4">Your browser doesn't support embedded video. <a href="${encodedSrc}">Download the clip</a> instead.</video>`
    : `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:60px;">▶️</div>`;

  const shareHref = encodedSrc || `https://www.youtube.com/${YT_CHANNEL_HANDLE}/videos`;

  return `
    <div class="video-card">
      <div class="trending-badge">${video.badge || '#' + (index + 1)}</div>
      <div class="video-thumb-wrap">${player}</div>
      <h3 class="video-title">${video.title}</h3>
      <div class="video-meta">${video.meta}</div>
      <div class="card-buttons">
        <button class="watch-btn" data-fullscreen="${videoId}">⛶ Fullscreen</button>
        <button class="share-btn" data-share="${shareHref}">🔗 Share</button>
      </div>
    </div>
  `;
}

function renderVideos(){
  const wrap = document.getElementById('videoSection');
  if (!wrap) return;
  wrap.innerHTML = VIDEOS.map(videoCardHTML).join('');

  wrap.addEventListener('click', (e) => {
    const shareBtn = e.target.closest('button[data-share]');
    if (shareBtn) {
      const url = shareBtn.getAttribute('data-share');
      const absoluteUrl = new URL(url, window.location.href).href;
      navigator.clipboard?.writeText(absoluteUrl).then(() => {
        shareBtn.textContent = '✅ Copied';
        setTimeout(() => { shareBtn.textContent = '🔗 Share'; }, 1600);
      }).catch(() => alert('Share this link: ' + absoluteUrl));
      return;
    }

    const fullscreenBtn = e.target.closest('button[data-fullscreen]');
    if (fullscreenBtn) {
      const vid = document.getElementById(fullscreenBtn.getAttribute('data-fullscreen'));
      if (vid?.requestFullscreen) vid.requestFullscreen();
      else if (vid?.webkitEnterFullscreen) vid.webkitEnterFullscreen(); // iOS Safari
    }
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
