/*==============================
REMIX-NEXUS — STORIES LOGIC
Snapchat-style: post a photo/video that disappears after 24h (enforced
server-side by a MongoDB TTL index — see Story schema in server.js),
see who viewed it, and reply is just a DM to that person.
==============================*/

const API_BASE = "https://remix-nexus-bgz9.onrender.com";

if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) {
  alert('Please log in to view and post stories.');
  location.href = './Profile.html';
}

const me = window.AUTH ? AUTH.getUser() : null;
const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;
const MAX_VIDEO_DATA_URL_LENGTH = 16_000_000;

let feed = [];          // [{ userId, username, avatar, hasUnseen, stories: [...] }]
let activeGroup = null; // the feed entry currently open in the viewer
let activeIndex = 0;    // index within activeGroup.stories
let progressTimer = null;
const STORY_DURATION_MS = 5000; // how long an image stays up before auto-advancing

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function authHeaders() {
  return { Authorization: 'Bearer ' + (window.AUTH ? AUTH.getToken() : '') };
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  return hrs + 'h';
}

/* -----------------------------------------------------------
   LOAD + RENDER THE STORY TRAY
----------------------------------------------------------- */
async function loadStories() {
  try {
    const res = await fetch(API_BASE + '/api/stories', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load stories');
    feed = data.feed || [];
    renderTray();
  } catch (err) {
    console.error('Load stories error:', err);
  }
}

function renderTray() {
  const tray = document.getElementById('storyTray');
  const emptyState = document.getElementById('storiesEmptyState');
  tray.innerHTML = '';

  const myGroup = feed.find(g => String(g.userId) === String(me.id));
  const others = feed.filter(g => String(g.userId) !== String(me.id));

  // "Your Story" tile — always shown, with a + badge to post another one.
  const myTile = document.createElement('button');
  myTile.type = 'button';
  myTile.className = 'story-tile';
  myTile.innerHTML = `
    <div class="story-tile-ring ${myGroup ? '' : ''}">
      <div class="story-tile-avatar">${myGroup && myGroup.stories.length ? myGroup.avatar : (me.avatar || '🎮')}
        <span class="story-tile-plus" title="Add to your story">➕</span>
      </div>
    </div>
    <span class="story-tile-name">Your Story</span>
  `;
  myTile.onclick = (e) => {
    // The + badge always opens the picker; tapping the rest of the tile
    // opens the viewer if you already have an active story.
    if (myGroup && myGroup.stories.length) {
      openViewer(myGroup);
    } else {
      document.getElementById('storyFileInput').click();
    }
  };
  myTile.querySelector('.story-tile-plus').onclick = (e) => {
    e.stopPropagation();
    document.getElementById('storyFileInput').click();
  };
  tray.appendChild(myTile);

  others.forEach(group => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'story-tile';
    tile.innerHTML = `
      <div class="story-tile-ring ${group.hasUnseen ? 'unseen' : ''}">
        <div class="story-tile-avatar">${group.avatar || '🎮'}</div>
      </div>
      <span class="story-tile-name">${escapeHtml(group.username)}</span>
    `;
    tile.onclick = () => openViewer(group);
    tray.appendChild(tile);
  });

  emptyState.style.display = (others.length === 0 && (!myGroup || !myGroup.stories.length)) ? 'block' : 'none';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* -----------------------------------------------------------
   FULL-SCREEN VIEWER
----------------------------------------------------------- */
function openViewer(group) {
  activeGroup = group;
  activeIndex = 0;
  document.getElementById('storyViewer').style.display = 'flex';
  buildProgressBars();
  showStory();
}

function buildProgressBars() {
  const row = document.getElementById('storyProgressRow');
  row.innerHTML = activeGroup.stories.map(() =>
    '<div class="story-progress-bar"><div class="story-progress-fill"></div></div>'
  ).join('');
}

function showStory() {
  clearTimeout(progressTimer);
  const story = activeGroup.stories[activeIndex];
  if (!story) { closeViewer(); return; }

  const isMine = String(activeGroup.userId) === String(me.id);

  document.getElementById('storyViewerAvatar').textContent = activeGroup.avatar || '🎮';
  document.getElementById('storyViewerUsername').textContent = activeGroup.username;
  document.getElementById('storyViewerTime').textContent = timeAgo(story.createdAt);
  document.getElementById('storyDeleteBtn').style.display = isMine ? 'inline-flex' : 'none';
  document.getElementById('storyReportBtn').style.display = isMine ? 'none' : 'inline-flex';
  document.getElementById('storyViewersBtn').style.display = isMine ? 'block' : 'none';
  document.getElementById('storyViewersCount').textContent = story.viewCount || 0;

  document.getElementById('storyLikeCount').textContent = story.likeCount || 0;
  document.getElementById('storyLikeIcon').textContent = story.likedByMe ? '❤️' : '🤍';
  document.getElementById('storyLikeBtn').classList.toggle('liked', !!story.likedByMe);

  const caption = document.getElementById('storyCaption');
  if (story.caption) {
    caption.textContent = story.caption;
    caption.style.display = 'block';
  } else {
    caption.style.display = 'none';
  }

  const mediaBox = document.getElementById('storyViewerMedia');
  mediaBox.innerHTML = '';
  let mediaEl;
  if (story.mediaType === 'video') {
    mediaEl = document.createElement('video');
    mediaEl.src = story.mediaData;
    mediaEl.autoplay = true;
    mediaEl.playsInline = true;
    mediaEl.muted = false;
    mediaEl.onended = () => nextStory();
  } else {
    mediaEl = document.createElement('img');
    mediaEl.src = story.mediaData;
  }
  mediaBox.appendChild(mediaEl);

  // Mark viewed (no-op server-side for your own stories).
  fetch(API_BASE + '/api/stories/' + story.id + '/view', {
    method: 'POST',
    headers: authHeaders()
  }).catch(() => {});

  animateProgress(story.mediaType === 'video' ? null : STORY_DURATION_MS, mediaEl);
}

function animateProgress(durationMs, mediaEl) {
  const bars = document.querySelectorAll('.story-progress-fill');
  bars.forEach((bar, i) => {
    bar.style.transition = 'none';
    bar.style.width = i < activeIndex ? '100%' : '0%';
  });

  const currentBar = bars[activeIndex];
  if (!currentBar) return;

  if (durationMs) {
    // Image — fixed timer.
    requestAnimationFrame(() => {
      currentBar.style.transition = `width ${durationMs}ms linear`;
      currentBar.style.width = '100%';
    });
    progressTimer = setTimeout(() => nextStory(), durationMs);
  } else if (mediaEl) {
    // Video — tie the bar to actual playback progress.
    const tick = () => {
      if (!mediaEl.duration) return;
      currentBar.style.transition = 'none';
      currentBar.style.width = ((mediaEl.currentTime / mediaEl.duration) * 100) + '%';
      if (!mediaEl.paused && !mediaEl.ended) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function nextStory() {
  activeIndex++;
  if (activeIndex >= activeGroup.stories.length) {
    closeViewer();
  } else {
    showStory();
  }
}

function prevStory() {
  clearTimeout(progressTimer);
  if (activeIndex > 0) {
    activeIndex--;
    showStory();
  }
}

function closeViewer() {
  clearTimeout(progressTimer);
  document.getElementById('storyViewer').style.display = 'none';
  activeGroup = null;
  loadStories(); // refresh unseen-ring state
}

document.getElementById('storyCloseBtn').onclick = closeViewer;
document.getElementById('storyNextZone').onclick = nextStory;
document.getElementById('storyPrevZone').onclick = prevStory;

document.getElementById('storyDeleteBtn').onclick = async () => {
  if (!activeGroup) return;
  const story = activeGroup.stories[activeIndex];
  if (!confirm('Delete this story?')) return;
  try {
    await fetch(API_BASE + '/api/stories/' + story.id, { method: 'DELETE', headers: authHeaders() });
    closeViewer();
  } catch (err) {
    alert('Could not delete this story. Please try again.');
  }
};

document.getElementById('storyReportBtn').onclick = async () => {
  if (!activeGroup) return;
  const story = activeGroup.stories[activeIndex];
  const reason = prompt('What\'s wrong with this story? (goes straight to the site owner)');
  if (reason === null) return;
  try {
    await fetch(API_BASE + '/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        targetType: 'story',
        targetId: story.id,
        targetUserId: activeGroup.userId,
        targetUsername: activeGroup.username,
        reason
      })
    });
    alert('Thanks — this has been reported to the site owner.');
  } catch (err) {
    alert('Could not submit the report. Please try again.');
  }
};

document.getElementById('storyLikeBtn').onclick = async () => {
  if (!activeGroup) return;
  const story = activeGroup.stories[activeIndex];
  const btn = document.getElementById('storyLikeBtn');
  const icon = document.getElementById('storyLikeIcon');
  const countEl = document.getElementById('storyLikeCount');

  // Optimistic update so the heart feels instant, same as WhatsApp/IG.
  const wasLiked = btn.classList.contains('liked');
  const prevCount = parseInt(countEl.textContent, 10) || 0;
  const nextLiked = !wasLiked;
  btn.classList.toggle('liked', nextLiked);
  icon.textContent = nextLiked ? '❤️' : '🤍';
  countEl.textContent = prevCount + (nextLiked ? 1 : -1);

  try {
    const res = await fetch(API_BASE + '/api/stories/' + story.id + '/like', {
      method: 'POST',
      headers: authHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not like this story.');

    // Reconcile with the server's real count, and keep the local feed
    // copy in sync so re-opening the viewer shows the right state.
    story.likedByMe = data.liked;
    story.likeCount = data.likeCount;
    countEl.textContent = data.likeCount;
  } catch (err) {
    // Roll back on failure.
    btn.classList.toggle('liked', wasLiked);
    icon.textContent = wasLiked ? '❤️' : '🤍';
    countEl.textContent = prevCount;
  }
};

document.getElementById('storyViewersBtn').onclick = async () => {
  if (!activeGroup) return;
  const story = activeGroup.stories[activeIndex];
  try {
    const res = await fetch(API_BASE + '/api/stories/' + story.id + '/viewers', { headers: authHeaders() });
    const data = await res.json();
    const list = document.getElementById('storyViewersList');
    list.innerHTML = (data.viewers || []).length
      ? data.viewers.map(v => `
          <div class="story-viewer-row">
            <span class="story-viewer-row-avatar">👤</span>
            <span>${escapeHtml(v.username)}</span>
          </div>`).join('')
      : '<p style="opacity:.6;">No one has viewed this yet.</p>';
    document.getElementById('storyViewersSheet').style.display = 'flex';
  } catch (err) {
    alert('Could not load viewers.');
  }

  try {
    const likeRes = await fetch(API_BASE + '/api/stories/' + story.id + '/likers', { headers: authHeaders() });
    const likeData = await likeRes.json();
    const likersList = document.getElementById('storyLikersList');
    likersList.innerHTML = (likeData.likers || []).length
      ? likeData.likers.map(l => `
          <div class="story-viewer-row">
            <span class="story-viewer-row-avatar">👤</span>
            <span>${escapeHtml(l.username)}</span>
          </div>`).join('')
      : '<p style="opacity:.6;">No likes yet.</p>';
  } catch (err) {
    // Non-fatal — the viewers list above still shows.
  }
};

document.getElementById('storyViewersCloseBtn').onclick = () => {
  document.getElementById('storyViewersSheet').style.display = 'none';
};

/* -----------------------------------------------------------
   UPLOAD FLOW
----------------------------------------------------------- */
let pendingDataUrl = null;
let pendingIsVideo = false;

document.getElementById('storyFileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) {
    alert('Only photos and videos can be posted as a story.');
    return;
  }

  const dataUrl = await blobToDataURL(file);
  const limit = isVideo ? MAX_VIDEO_DATA_URL_LENGTH : MAX_IMAGE_DATA_URL_LENGTH;
  if (dataUrl.length > limit) {
    alert(isVideo
      ? 'That video is too large — try a shorter or lower-resolution clip.'
      : 'That image is too large — try a smaller file.');
    return;
  }

  pendingDataUrl = dataUrl;
  pendingIsVideo = isVideo;

  const preview = document.getElementById('storyUploadPreview');
  preview.innerHTML = '';
  const el = document.createElement(isVideo ? 'video' : 'img');
  el.src = dataUrl;
  if (isVideo) { el.controls = true; el.autoplay = true; el.muted = true; }
  preview.appendChild(el);

  document.getElementById('storyCaptionInput').value = '';
  document.getElementById('storyUploadModal').style.display = 'flex';
});

document.getElementById('storyUploadCancelBtn').onclick = () => {
  pendingDataUrl = null;
  document.getElementById('storyUploadModal').style.display = 'none';
};

document.getElementById('storyPostBtn').onclick = async () => {
  if (!pendingDataUrl) return;
  const postBtn = document.getElementById('storyPostBtn');
  postBtn.disabled = true;
  postBtn.textContent = 'Posting…';

  try {
    const res = await fetch(API_BASE + '/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        mediaData: pendingDataUrl,
        caption: document.getElementById('storyCaptionInput').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not post your story.');

    pendingDataUrl = null;
    document.getElementById('storyUploadModal').style.display = 'none';
    await loadStories();
  } catch (err) {
    alert(err.message || 'Could not post your story. Please try again.');
  } finally {
    postBtn.disabled = false;
    postBtn.textContent = 'Post to your story';
  }
};

// Keyboard support for desktop (left/right arrows, Escape to close).
document.addEventListener('keydown', (e) => {
  if (document.getElementById('storyViewer').style.display !== 'flex') return;
  if (e.key === 'ArrowRight') nextStory();
  if (e.key === 'ArrowLeft') prevStory();
  if (e.key === 'Escape') closeViewer();
});

loadStories();
