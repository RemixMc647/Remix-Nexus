/*==============================
REMIX-NEXUS — STORIES LOGIC
Discord layout + WhatsApp Status list + Snapchat wall / viewer.

 • post a photo / video, or a TEXT status (rendered to an image, so the
   backend needs no changes). Everything disappears after 24h — enforced
   server-side by a MongoDB TTL index (see Story schema in server.js).
 • see who viewed it + who liked it, reply = a DM to that person.
 • viewer: auto-advances through everyone's stories, hold to pause,
   double-tap to like, ← → / Space / Esc on desktop.
==============================*/

const API_BASE = "https://remix-nexus-bgz9.onrender.com";

if (!window.AUTH || !AUTH.isLoggedIn || !AUTH.isLoggedIn()) {
  alert('Please log in to view and post stories.');
  location.href = './Profile.html';
}

const me = window.AUTH && AUTH.isLoggedIn && AUTH.isLoggedIn() ? AUTH.getUser() : null;
const MAX_IMAGE_DATA_URL_LENGTH = 6_000_000;
const MAX_VIDEO_SECONDS = 60;                 // hard 1-minute limit (server re-checks it)
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;    // Cloudinary free plan max video size
const STORY_DURATION_MS = 5000; // how long an image stays up before auto-advancing

let feed = [];          // [{ userId, username, avatar, hasUnseen, stories: [...] }]
let queue = [];         // other people's groups, in the order shown on screen
let activeGroup = null; // the feed entry currently open in the viewer
let activeIndex = 0;    // index within activeGroup.stories
const view = { filter: 'all', term: '' };

const $ = (id) => document.getElementById(id);

/* -----------------------------------------------------------
   HELPERS
----------------------------------------------------------- */
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


/* -----------------------------------------------------------
   VIDEO UPLOAD — videos go straight from the phone to Cloudinary
   (free cloud storage); only a small reference is sent to our server.
----------------------------------------------------------- */
function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const done = (val) => { URL.revokeObjectURL(url); resolve(val); };
    v.onloadedmetadata = () => {
      // Some phone videos report Infinity/NaN until the browser seeks to the
      // end. Force that seek so we get the real length.
      if (!isFinite(v.duration)) {
        v.ontimeupdate = () => { v.ontimeupdate = null; done(v.duration); };
        try { v.currentTime = 1e101; } catch (_) { done(v.duration); }
        setTimeout(() => done(v.duration), 3000);   // never hang
      } else {
        done(v.duration);
      }
    };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    v.src = url;
  });
}

async function uploadVideoToCloud(file, onProgress) {
  const sigRes = await fetch(API_BASE + '/api/stories/upload-signature', {
    method: 'POST',
    headers: authHeaders()
  });
  const sig = await sigRes.json().catch(() => ({}));
  if (!sigRes.ok) throw new Error(sig.error || 'Could not start the video upload.');

  const form = new FormData();
  form.append('file', file);
  form.append('api_key', sig.apiKey);
  form.append('timestamp', sig.timestamp);
  form.append('tags', sig.tags);
  form.append('signature', sig.signature);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + sig.cloudName + '/video/upload');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      let json = {};
      try { json = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && json.public_id) resolve({ publicId: json.public_id, duration: Number(json.duration) || 0 });
      else reject(new Error((json.error && json.error.message) || 'Video upload failed. Please try again.'));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading the video.'));
    xhr.send(form);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  return hrs + 'h';
}

function storyTime(s) { return new Date(s.createdAt).getTime() || 0; }
function newestStory(group) {
  return group.stories.reduce((a, b) => (storyTime(b) >= storyTime(a) ? b : a), group.stories[0]);
}
function isMineGroup(g) { return me && String(g.userId) === String(me.id); }

/* Segmented status ring (one segment per story, like WhatsApp). */
function ringSvg(count, kind) {
  const r = 24, C = 2 * Math.PI * r;
  const n = Math.max(1, Math.min(count || 1, 30));
  let dash = C + ' 0';
  if (n > 1) {
    const gap = Math.min(6, (C / n) * 0.3);
    dash = (C / n - gap).toFixed(2) + ' ' + gap.toFixed(2);
  }
  return `<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="${kind}" cx="26" cy="26" r="${r}" stroke-dasharray="${dash}"/></svg>`;
}

function ringHtml(group, kind, extraClass) {
  const n = group && group.stories ? group.stories.length : 1;
  const avatar = escapeHtml((group && group.avatar) || (me && me.avatar) || '🎮');
  const pf = (group && group.userId && !isMineGroup(group))
    ? ` data-pf-uid="${escapeHtml(group.userId)}" data-pf-name="${escapeHtml(group.username)}" data-pf-av="${escapeHtml(group.avatar || '🎮')}" title="View profile"`
    : '';
  return `<div class="st-ring ${extraClass || ''}">${ringSvg(n, kind)}<div class="st-av"${pf}>${avatar}</div></div>`;
}

function mediaThumb(story) {
  let el;
  if (story.mediaType === 'video') {
    el = document.createElement('video');
    el.src = story.mediaData + '#t=0.1';
    el.muted = true;
    el.playsInline = true;
    el.preload = 'metadata';
  } else {
    el = document.createElement('img');
    el.src = story.mediaData;
    el.alt = '';
    el.loading = 'lazy';
  }
  el.className = 'st-card-media';
  return el;
}

function button(html, className, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.innerHTML = html;
  b.onclick = onclick;
  return b;
}

/* -----------------------------------------------------------
   LOAD + RENDER
----------------------------------------------------------- */
async function loadStories() {
  try {
    const res = await fetch(API_BASE + '/api/stories', { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load stories');
    feed = data.feed || [];
    renderAll();
  } catch (err) {
    console.error('Load stories error:', err);
  }
}

function computeView() {
  const myGroup = feed.find(g => isMineGroup(g) && g.stories && g.stories.length) || null;
  const others = feed.filter(g => !isMineGroup(g) && g.stories && g.stories.length);
  const term = view.term.trim().toLowerCase();

  const newest = (a, b) => storyTime(newestStory(b)) - storyTime(newestStory(a));
  const matches = others.filter(g => !term || (g.username || '').toLowerCase().includes(term));
  const unseen = matches.filter(g => g.hasUnseen).sort(newest);
  const seen = view.filter === 'unseen' ? [] : matches.filter(g => !g.hasUnseen).sort(newest);

  queue = [...unseen, ...seen];
  return {
    myGroup,
    others,
    unseen,
    seen,
    unseenTotal: others.filter(g => g.hasUnseen).length
  };
}

function renderAll() {
  const v = computeView();
  renderSidebar(v);
  renderTray(v);
  renderWall(v);

  const badge = $('unseenBadge');
  badge.textContent = v.unseenTotal;
  badge.style.display = v.unseenTotal > 0 ? 'inline-block' : 'none';

  const empty = $('storiesEmptyState');
  if (queue.length === 0) {
    empty.querySelector('p').textContent = v.others.length === 0
      ? 'No stories yet. Be the first — post one that disappears in 24 hours.'
      : 'No stories match that search.';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
  }
}

/* ---- left list (WhatsApp Status inside a Discord channel list) ---- */
function renderSidebar(v) {
  const list = $('storyList');
  list.innerHTML = '';

  // My status
  const mine = v.myGroup;
  const myRow = document.createElement('div');
  myRow.className = 'st-row';
  myRow.setAttribute('role', 'button');
  myRow.tabIndex = 0;
  myRow.innerHTML = `
    ${ringHtml(mine, 'mine')}
    <span class="st-row-text">
      <span class="st-row-name">My status</span>
      <span class="st-row-sub">${mine
        ? `${mine.stories.length} update${mine.stories.length > 1 ? 's' : ''} • ${timeAgo(newestStory(mine).createdAt)}`
        : 'Tap ＋ to add a status update'}</span>
    </span>
    <span class="st-row-plus" title="Add to your story">＋</span>`;
  const openMine = () => { mine ? openViewer(mine) : pickMedia(); };
  myRow.onclick = openMine;
  myRow.onkeydown = (e) => { if (e.key === 'Enter') openMine(); };
  myRow.querySelector('.st-row-plus').onclick = (e) => { e.stopPropagation(); pickMedia(); };
  list.appendChild(myRow);

  const addGroup = (labelText, groups, unseenFlag) => {
    if (!groups.length) return;
    const label = document.createElement('div');
    label.className = 'st-label';
    label.textContent = `${labelText} — ${groups.length}`;
    list.appendChild(label);

    groups.forEach(g => {
      const n = g.stories.length;
      const row = button(`
        ${ringHtml(g, unseenFlag ? 'unseen' : 'seen')}
        <span class="st-row-text">
          <span class="st-row-name">${escapeHtml(g.username)}</span>
          <span class="st-row-sub">${n} update${n > 1 ? 's' : ''} • ${timeAgo(newestStory(g).createdAt)}</span>
        </span>
        ${unseenFlag ? '<span class="st-row-dot"></span>' : ''}`,
        'st-row' + (unseenFlag ? ' unseen' : ''),
        () => openViewer(g));
      list.appendChild(row);
    });
  };

  addGroup('Recent updates', v.unseen, true);
  addGroup('Viewed updates', v.seen, false);

  if (!v.unseen.length && !v.seen.length) {
    const msg = document.createElement('div');
    msg.className = 'st-empty-side';
    msg.textContent = v.others.length ? 'Nothing matches.' : 'No updates from others yet.';
    list.appendChild(msg);
  }
}

/* ---- phone ring tray ---- */
function renderTray(v) {
  const tray = $('storyTray');
  tray.innerHTML = '';

  const mine = v.myGroup;
  const myTile = button(`
    <div class="st-ring">${ringSvg(mine ? mine.stories.length : 1, 'mine')}
      <div class="st-av">${escapeHtml((mine && mine.avatar) || (me && me.avatar) || '🎮')}</div>
      <span class="story-tile-plus" title="Add to your story">＋</span>
    </div>
    <span class="story-tile-name">Your Story</span>`,
    'story-tile',
    () => { mine ? openViewer(mine) : pickMedia(); });
  myTile.querySelector('.story-tile-plus').onclick = (e) => { e.stopPropagation(); pickMedia(); };
  tray.appendChild(myTile);

  queue.forEach(g => {
    tray.appendChild(button(`
      ${ringHtml(g, g.hasUnseen ? 'unseen' : 'seen')}
      <span class="story-tile-name">${escapeHtml(g.username)}</span>`,
      'story-tile',
      () => openViewer(g)));
  });
}

/* ---- wall (Snapchat Discover style) ---- */
function renderWall(v) {
  const wall = $('storyWall');
  wall.innerHTML = '';

  const showMine = view.filter === 'all' && !view.term.trim();
  if (showMine) {
    if (v.myGroup) wall.appendChild(storyCard(v.myGroup, true));
    else {
      wall.appendChild(button(
        `<span class="st-card-add-icon">＋</span><span class="lbl">Add to your story</span>`,
        'st-card add', pickMedia));
    }
  }
  queue.forEach(g => wall.appendChild(storyCard(g, false)));
}

function storyCard(group, mine) {
  const n = group.stories.length;
  const newest = newestStory(group);
  const card = document.createElement('div');
  card.className = 'st-card ' + (group.hasUnseen && !mine ? 'unseen' : 'seen');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.appendChild(mediaThumb(newest));

  const bars = document.createElement('div');
  bars.className = 'st-card-bars';
  bars.innerHTML = '<i></i>'.repeat(Math.min(n, 8));
  card.appendChild(bars);

  const info = document.createElement('div');
  info.className = 'st-card-info';
  info.innerHTML = `
    ${ringHtml(group, mine ? 'mine' : (group.hasUnseen ? 'unseen' : 'seen'))}
    <span class="st-card-text">
      <span class="st-card-name">${mine ? 'Your story' : escapeHtml(group.username)}</span>
      <span class="st-card-time">${timeAgo(newest.createdAt)}</span>
    </span>`;
  card.appendChild(info);

  if (!mine && group.hasUnseen) {
    const tag = document.createElement('span');
    tag.className = 'st-card-new';
    tag.textContent = 'NEW';
    card.appendChild(tag);
  }
  if (mine) {
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'st-card-mine-add';
    plus.title = 'Add to your story';
    plus.textContent = '＋';
    plus.onclick = (e) => { e.stopPropagation(); pickMedia(); };
    card.appendChild(plus);
  }

  card.onclick = () => openViewer(group);
  card.onkeydown = (e) => { if (e.key === 'Enter') openViewer(group); };
  return card;
}

/* sidebar search + tabs */
$('storySearch').addEventListener('input', (e) => { view.term = e.target.value; renderAll(); });
$('storyTabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.st-tab');
  if (!tab) return;
  view.filter = tab.dataset.filter;
  document.querySelectorAll('#storyTabs .st-tab').forEach(t => t.classList.toggle('active', t === tab));
  renderAll();
});

/* -----------------------------------------------------------
   VIEWER — progress engine (supports pause / resume)
----------------------------------------------------------- */
const pauseReasons = new Set();   // 'hold' | 'key' | 'sheet' | 'tab'
let rafId = null;
let lastTs = 0;
let elapsed = 0;
let mediaReady = false;
let curMedia = null;
let curStory = null;

const isPaused = () => pauseReasons.size > 0;

/* ---- sound ----
   Browsers (especially phones) sometimes refuse to play a video WITH sound
   until you tap. We try with sound first; if blocked we play muted and show
   a "Tap for sound" button instead of staying silent with no explanation. */
let soundOn = true;   // remembered for the whole session

function getSoundBtn() {
  let b = $('storySoundBtn');
  if (!b) {
    b = document.createElement('button');
    b.id = 'storySoundBtn';
    b.type = 'button';
    b.style.cssText = 'position:absolute;top:72px;right:12px;z-index:30;display:none;' +
      'padding:8px 12px;border:0;border-radius:999px;background:rgba(0,0,0,.65);' +
      'color:#fff;font:600 13px/1 inherit;font-family:inherit;cursor:pointer;';
    b.onclick = (e) => {
      e.stopPropagation();
      if (!curMedia || curMedia.tagName !== 'VIDEO') return;
      curMedia.muted = !curMedia.muted;
      soundOn = !curMedia.muted;
      updateSoundBtn();
      if (curMedia.paused && !isPaused()) curMedia.play().catch(() => {});
    };
    // don't let the tap zones treat a tap on this button as next/previous
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('pointerup', (e) => e.stopPropagation());
    ($('storyCard') || $('storyViewer')).appendChild(b);
  }
  return b;
}

function updateSoundBtn() {
  const b = getSoundBtn();
  if (!curMedia || curMedia.tagName !== 'VIDEO') { b.style.display = 'none'; return; }
  b.style.display = 'block';
  b.textContent = curMedia.muted ? '🔇 Tap for sound' : '🔊 Sound on';
}

function playVideo(el) {
  el.muted = !soundOn;
  const p = el.play();
  if (p && p.catch) {
    p.catch(() => {
      // Blocked with sound → play muted so the story still plays.
      el.muted = true;
      el.play().catch(() => {});
      updateSoundBtn();
    });
  }
}

function applyPause() {
  const showIcon = pauseReasons.has('hold') || pauseReasons.has('key');
  $('storyPauseIndicator').style.display = showIcon ? 'flex' : 'none';
  if (curMedia && curMedia.tagName === 'VIDEO') {
    if (isPaused()) curMedia.pause();
    else playVideo(curMedia);
  }
}
function pauseStory(reason) { pauseReasons.add(reason); applyPause(); }
function resumeStory(reason) { pauseReasons.delete(reason); lastTs = 0; applyPause(); }

function stopProgress() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  lastTs = 0;
}

function startProgress() {
  stopProgress();
  elapsed = 0;
  rafId = requestAnimationFrame(tick);
}

function tick(ts) {
  rafId = requestAnimationFrame(tick);
  if (!activeGroup || !curStory) { stopProgress(); return; }

  const dt = lastTs ? Math.min(ts - lastTs, 100) : 0;
  lastTs = ts;

  const bar = document.querySelectorAll('.story-progress-fill')[activeIndex];
  if (!bar) return;

  let pct = 0;
  if (curStory.mediaType === 'video') {
    if (curMedia && curMedia.duration) pct = curMedia.currentTime / curMedia.duration;   // end handled by onended
  } else {
    if (mediaReady && !isPaused()) elapsed += dt;
    pct = elapsed / STORY_DURATION_MS;
  }
  bar.style.width = (Math.min(pct, 1) * 100) + '%';

  if (curStory.mediaType !== 'video' && pct >= 1) nextStory();
}

function setBars() {
  document.querySelectorAll('.story-progress-fill').forEach((bar, i) => {
    bar.style.width = i < activeIndex ? '100%' : '0%';
  });
}

/* -----------------------------------------------------------
   VIEWER — open / show / navigate / close
----------------------------------------------------------- */
function openViewer(group) {
  activeGroup = group;
  activeIndex = 0;
  pauseReasons.clear();
  if (document.hidden) pauseReasons.add('tab');
  $('storyViewer').style.display = 'flex';
  buildProgressBars();
  showStory();
}

function buildProgressBars() {
  $('storyProgressRow').innerHTML = activeGroup.stories.map(() =>
    '<div class="story-progress-bar"><div class="story-progress-fill"></div></div>'
  ).join('');
}

function showStory() {
  stopProgress();
  const story = activeGroup.stories[activeIndex];
  if (!story) { closeViewer(); return; }

  curStory = story;
  mediaReady = false;
  pauseReasons.delete('hold');
  pauseReasons.delete('key');

  const isMine = isMineGroup(activeGroup);

  $('storyViewerAvatar').textContent = activeGroup.avatar || '🎮';
  $('storyViewerUsername').textContent = isMine ? 'Your story' : activeGroup.username;
  $('storyViewerTime').textContent = timeAgo(story.createdAt);
  $('storyDeleteBtn').style.display = isMine ? 'inline-flex' : 'none';
  $('storyReportBtn').style.display = isMine ? 'none' : 'inline-flex';
  $('storyViewersBtn').style.display = isMine ? 'block' : 'none';
  $('storyViewersCount').textContent = story.viewCount || 0;

  const reply = $('storyReplyBtn');
  if (isMine) {
    reply.style.display = 'none';
  } else {
    reply.style.display = 'block';
    reply.href = './Contacts.html?uid=' + encodeURIComponent(activeGroup.userId)
      + '&username=' + encodeURIComponent(activeGroup.username || '')
      + '&avatar=' + encodeURIComponent(activeGroup.avatar || '');
    $('storyReplyName').textContent = activeGroup.username;
  }

  $('storyLikeCount').textContent = story.likeCount || 0;
  $('storyLikeIcon').textContent = story.likedByMe ? '❤️' : '🤍';
  $('storyLikeBtn').classList.toggle('liked', !!story.likedByMe);

  const caption = $('storyCaption');
  if (story.caption) {
    caption.textContent = story.caption;
    caption.style.display = 'block';
  } else {
    caption.style.display = 'none';
  }

  // blurred backdrop (images only)
  const bg = $('storyViewerBg');
  bg.innerHTML = '';
  if (story.mediaType !== 'video') {
    const bgImg = document.createElement('img');
    bgImg.src = story.mediaData;
    bgImg.alt = '';
    bg.appendChild(bgImg);
  }

  const mediaBox = $('storyViewerMedia');
  mediaBox.innerHTML = '';
  let mediaEl;
  if (story.mediaType === 'video') {
    mediaEl = document.createElement('video');
    mediaEl.src = story.mediaData;
    mediaEl.autoplay = true;
    mediaEl.playsInline = true;
    mediaEl.muted = !soundOn;
    mediaEl.volume = 1;
    mediaEl.onended = () => nextStory();
    mediaReady = true;
  } else {
    mediaEl = document.createElement('img');
    mediaEl.onload = () => { mediaReady = true; };
    mediaEl.src = story.mediaData;
    if (mediaEl.complete) mediaReady = true;
  }
  curMedia = mediaEl;
  mediaBox.appendChild(mediaEl);
  updateSoundBtn();

  // Mark viewed (no-op server-side for your own stories).
  fetch(API_BASE + '/api/stories/' + story.id + '/view', {
    method: 'POST',
    headers: authHeaders()
  }).catch(() => {});

  setBars();
  applyPause();
  startProgress();
}

function nextStory() {
  stopProgress();
  activeIndex++;
  if (activeIndex < activeGroup.stories.length) { showStory(); return; }

  // Finished this person → continue with the next person on screen (like WhatsApp).
  const i = queue.indexOf(activeGroup);
  if (i >= 0 && i < queue.length - 1) {
    activeGroup = queue[i + 1];
    activeIndex = 0;
    buildProgressBars();
    showStory();
  } else {
    closeViewer();
  }
}

function prevStory() {
  stopProgress();
  if (activeIndex > 0) {
    activeIndex--;
    showStory();
    return;
  }
  const i = queue.indexOf(activeGroup);
  if (i > 0) {
    activeGroup = queue[i - 1];
    activeIndex = activeGroup.stories.length - 1;
    buildProgressBars();
  }
  showStory(); // first story of the first person: just restart it
}

function closeViewer() {
  stopProgress();
  pauseReasons.clear();
  $('storyViewerMedia').innerHTML = '';
  $('storyViewerBg').innerHTML = '';
  $('storyViewer').style.display = 'none';
  $('storyViewersSheet').style.display = 'none';
  $('storyPauseIndicator').style.display = 'none';
  activeGroup = null;
  curStory = null;
  curMedia = null;
  updateSoundBtn();
  loadStories(); // refresh unseen-ring state
}

$('storyCloseBtn').onclick = closeViewer;
$('storyNextArrow').onclick = nextStory;
$('storyPrevArrow').onclick = prevStory;

/* Tap = navigate, press-and-hold = pause (Snapchat / WhatsApp / Instagram). */
function bindTapZone(el, action) {
  let holdTimer = null;
  let held = false;

  el.addEventListener('pointerdown', () => {
    held = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { held = true; pauseStory('hold'); }, 220);
  });
  const endHold = () => {
    clearTimeout(holdTimer);
    if (held) resumeStory('hold');
  };
  el.addEventListener('pointerup', () => {
    const wasHeld = held;
    endHold();
    held = false;
    if (!wasHeld) action();
  });
  el.addEventListener('pointerleave', endHold);
  el.addEventListener('pointercancel', endHold);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') action(); });
}
bindTapZone($('storyNextZone'), nextStory);
bindTapZone($('storyPrevZone'), prevStory);

document.addEventListener('visibilitychange', () => {
  if (!activeGroup) return;
  document.hidden ? pauseStory('tab') : resumeStory('tab');
});

/* ---- delete / report ---- */
$('storyDeleteBtn').onclick = async () => {
  if (!activeGroup) return;
  const story = activeGroup.stories[activeIndex];
  pauseStory('sheet');
  if (!confirm('Delete this story?')) { resumeStory('sheet'); return; }
  try {
    await fetch(API_BASE + '/api/stories/' + story.id, { method: 'DELETE', headers: authHeaders() });
    closeViewer();
  } catch (err) {
    resumeStory('sheet');
    alert('Could not delete this story. Please try again.');
  }
};

$('storyReportBtn').onclick = async () => {
  if (!activeGroup) return;
  const story = activeGroup.stories[activeIndex];
  pauseStory('sheet');
  const reason = prompt('What\'s wrong with this story? (goes straight to the site owner)');
  if (reason === null) { resumeStory('sheet'); return; }
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
  resumeStory('sheet');
};

/* ---- likes (button + double-tap) ---- */
async function toggleLike(onlyIfNotLiked) {
  if (!activeGroup) return;
  const story = activeGroup.stories[activeIndex];
  const btn = $('storyLikeBtn');
  const icon = $('storyLikeIcon');
  const countEl = $('storyLikeCount');

  const wasLiked = btn.classList.contains('liked');
  if (onlyIfNotLiked && wasLiked) return;

  // Optimistic update so the heart feels instant.
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

    // Reconcile with the server and keep the local feed copy in sync.
    story.likedByMe = data.liked;
    story.likeCount = data.likeCount;
    if (activeGroup && activeGroup.stories[activeIndex] === story) {
      countEl.textContent = data.likeCount;
      btn.classList.toggle('liked', !!data.liked);
      icon.textContent = data.liked ? '❤️' : '🤍';
    }
  } catch (err) {
    if (activeGroup && activeGroup.stories[activeIndex] === story) {
      btn.classList.toggle('liked', wasLiked);
      icon.textContent = wasLiked ? '❤️' : '🤍';
      countEl.textContent = prevCount;
    }
  }
}
$('storyLikeBtn').onclick = () => toggleLike(false);

$('storyCard').addEventListener('dblclick', (e) => {
  if (e.target.closest('button, a')) return;     // only the picture itself
  const rect = $('storyCard').getBoundingClientRect();
  const heart = document.createElement('div');
  heart.className = 'sv-heart';
  heart.textContent = '❤️';
  heart.style.left = (e.clientX - rect.left) + 'px';
  heart.style.top = (e.clientY - rect.top) + 'px';
  $('storyCard').appendChild(heart);
  setTimeout(() => heart.remove(), 850);
  toggleLike(true);
});

/* ---- viewers + likers sheet (own stories) ---- */
$('storyViewersBtn').onclick = async () => {
  if (!activeGroup) return;
  const story = activeGroup.stories[activeIndex];
  pauseStory('sheet');

  const row = (u) => `
    <div class="story-viewer-row">
      <span class="story-viewer-row-avatar">${escapeHtml(u.avatar || '👤')}</span>
      <span>${escapeHtml(u.username)}</span>
    </div>`;

  $('storyViewersList').innerHTML = '<p style="opacity:.6;">Loading…</p>';
  $('storyLikersList').innerHTML = '';
  $('storyViewersSheet').style.display = 'flex';

  try {
    const res = await fetch(API_BASE + '/api/stories/' + story.id + '/viewers', { headers: authHeaders() });
    const data = await res.json();
    $('storyViewersList').innerHTML = (data.viewers || []).length
      ? data.viewers.map(row).join('')
      : '<p style="opacity:.6;">No one has viewed this yet.</p>';
  } catch (err) {
    $('storyViewersList').innerHTML = '<p style="opacity:.6;">Could not load viewers.</p>';
  }

  try {
    const likeRes = await fetch(API_BASE + '/api/stories/' + story.id + '/likers', { headers: authHeaders() });
    const likeData = await likeRes.json();
    $('storyLikersList').innerHTML = (likeData.likers || []).length
      ? likeData.likers.map(row).join('')
      : '<p style="opacity:.6;">No likes yet.</p>';
  } catch (err) {
    // Non-fatal — the viewers list above still shows.
  }
};

$('storyViewersCloseBtn').onclick = () => {
  $('storyViewersSheet').style.display = 'none';
  resumeStory('sheet');
};

/* -----------------------------------------------------------
   POSTING — photo / video
----------------------------------------------------------- */
let pendingDataUrl = null;   // photos: base64 data URL
let pendingFile = null;      // videos: the raw file, uploaded straight to Cloudinary
let pendingDuration = 0;     // videos: length in seconds as measured by this phone
let pendingPreviewUrl = null;

function clearPending() {
  pendingDataUrl = null;
  pendingFile = null;
  pendingDuration = 0;
  if (pendingPreviewUrl) { URL.revokeObjectURL(pendingPreviewUrl); pendingPreviewUrl = null; }
  $('storyUploadPreview').innerHTML = '';
}

function pickMedia() { $('storyFileInput').click(); }
document.querySelectorAll('.js-add-media').forEach(b => b.addEventListener('click', pickMedia));

$('storyFileInput').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) {
    alert('Only photos and videos can be posted as a story.');
    return;
  }

  clearPending();
  const preview = $('storyUploadPreview');
  const el = document.createElement(isVideo ? 'video' : 'img');

  if (isVideo) {
    // 1-minute limit is checked BEFORE uploading anything.
    let duration;
    try { duration = await getVideoDuration(file); }
    catch (err) { alert('Could not read that video. Try a different file.'); return; }
    // Only block when we KNOW it is too long. If the phone can't tell us the
    // length, let it upload — the server re-checks the real length anyway.
    if (isFinite(duration) && duration > MAX_VIDEO_SECONDS + 0.5) {
      alert('Story videos can be at most 1 minute long. Please trim it and try again.');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      alert('That video is too large (100MB max) — try a shorter or lower-resolution clip.');
      return;
    }
    pendingFile = file;
    pendingDuration = isFinite(duration) ? duration : 0;
    pendingPreviewUrl = URL.createObjectURL(file);
    el.src = pendingPreviewUrl;
    el.controls = true; el.muted = false; el.playsInline = true;   // tap play to hear it with sound
  } else {
    const dataUrl = await blobToDataURL(file);
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      alert('That image is too large — try a smaller file.');
      return;
    }
    pendingDataUrl = dataUrl;
    el.src = dataUrl;
  }

  preview.appendChild(el);
  $('storyCaptionInput').value = '';
  $('storyUploadModal').style.display = 'flex';
});

$('storyUploadCancelBtn').onclick = () => {
  clearPending();
  $('storyUploadModal').style.display = 'none';
};

// `payload` is { mediaData } for photos/text, or { mediaPublicId } for videos.
async function submitStory(payload, caption, btn, idleLabel) {
  btn.disabled = true;
  btn.textContent = 'Posting…';
  try {
    const res = await fetch(API_BASE + '/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ ...payload, caption })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not post your story.');
    await loadStories();
    return true;
  } catch (err) {
    alert(err.message || 'Could not post your story. Please try again.');
    return false;
  } finally {
    btn.disabled = false;
    btn.textContent = idleLabel;
  }
}

$('storyPostBtn').onclick = async () => {
  if (!pendingDataUrl && !pendingFile) return;
  const btn = $('storyPostBtn');
  const idle = 'Post to your story';
  let payload;

  if (pendingFile) {
    btn.disabled = true;
    try {
      const up = await uploadVideoToCloud(pendingFile, (pct) => { btn.textContent = 'Uploading ' + pct + '%'; });
      payload = { mediaPublicId: up.publicId, mediaDuration: up.duration || pendingDuration || 0 };
    } catch (err) {
      btn.disabled = false;
      btn.textContent = idle;
      alert(err.message || 'Video upload failed. Please try again.');
      return;
    }
  } else {
    payload = { mediaData: pendingDataUrl };
  }

  const ok = await submitStory(payload, $('storyCaptionInput').value, btn, idle);
  if (ok) {
    clearPending();
    $('storyUploadModal').style.display = 'none';
  }
};

/* -----------------------------------------------------------
   POSTING — text status (WhatsApp style), rendered to an image
----------------------------------------------------------- */
const TEXT_BGS = [
  ['#0050d6', '#00b7ff'],
  ['#7b2ff7', '#f107a3'],
  ['#11998e', '#38ef7d'],
  ['#f12711', '#f5af19'],
  ['#232526', '#414345'],
  ['#ee0979', '#ff6a00']
];
const TEXT_FONTS = [
  { cls: '',        canvas: '700 {s}px Poppins, sans-serif' },
  { cls: 'f-serif', canvas: 'italic 700 {s}px Georgia, "Times New Roman", serif' },
  { cls: 'f-mono',  canvas: '700 {s}px "Courier New", monospace' }
];
let textBg = 0;
let textFont = 0;

function applyTextStyle() {
  const [a, b] = TEXT_BGS[textBg];
  $('storyTextStage').style.background = `linear-gradient(135deg, ${a}, ${b})`;
  document.querySelectorAll('#storyTextSwatches .st-swatch').forEach((s, i) => s.classList.toggle('active', i === textBg));
  const input = $('storyTextInput');
  input.classList.remove('f-serif', 'f-mono');
  if (TEXT_FONTS[textFont].cls) input.classList.add(TEXT_FONTS[textFont].cls);
}

function buildSwatches() {
  const box = $('storyTextSwatches');
  box.innerHTML = '';
  TEXT_BGS.forEach(([a, b], i) => {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'st-swatch';
    s.style.background = `linear-gradient(135deg, ${a}, ${b})`;
    s.setAttribute('aria-label', 'Background ' + (i + 1));
    s.onclick = () => { textBg = i; applyTextStyle(); };
    box.appendChild(s);
  });
}

function openTextComposer() {
  textBg = Math.floor(Math.random() * TEXT_BGS.length);
  textFont = 0;
  $('storyTextInput').value = '';
  buildSwatches();
  applyTextStyle();
  $('storyTextModal').style.display = 'flex';
  setTimeout(() => $('storyTextInput').focus(), 50);
}
function closeTextComposer() { $('storyTextModal').style.display = 'none'; }

document.querySelectorAll('.js-add-text').forEach(b => b.addEventListener('click', openTextComposer));
$('storyTextCancelBtn').onclick = closeTextComposer;
$('storyTextBgBtn').onclick = () => { textBg = (textBg + 1) % TEXT_BGS.length; applyTextStyle(); };
$('storyTextFontBtn').onclick = () => { textFont = (textFont + 1) % TEXT_FONTS.length; applyTextStyle(); };

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  text.split('\n').forEach(paragraph => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); return; }
    let line = '';
    words.forEach(word => {
      // break a single huge word if it can't fit on a line by itself
      while (ctx.measureText(word).width > maxWidth) {
        let cut = word.length - 1;
        while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut--;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else { lines.push(line); line = word; }
    });
    lines.push(line);
  });
  return lines;
}

async function renderTextStatus(text) {
  const W = 720, H = 1280;
  const size = text.length < 30 ? 84 : text.length < 70 ? 68 : text.length < 120 ? 56 : 46;
  const fontSpec = TEXT_FONTS[textFont].canvas.replace('{s}', size);

  if (document.fonts && document.fonts.load) {
    try { await document.fonts.load(fontSpec); } catch (e) { /* fall back to system font */ }
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const [a, b] = TEXT_BGS[textBg];
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.font = fontSpec;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.25)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;

  const lines = wrapLines(ctx, text, W - 130);
  const lineH = size * 1.3;
  const y0 = (H - lines.length * lineH) / 2 + lineH / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y0 + i * lineH));

  return canvas.toDataURL('image/jpeg', 0.88);
}

$('storyTextPostBtn').onclick = async () => {
  const text = $('storyTextInput').value.trim();
  if (!text) { $('storyTextInput').focus(); return; }

  const btn = $('storyTextPostBtn');
  btn.disabled = true;
  let dataUrl;
  try {
    dataUrl = await renderTextStatus(text);
  } catch (err) {
    btn.disabled = false;
    alert('Could not create your text status. Please try again.');
    return;
  }
  btn.disabled = false;

  const ok = await submitStory({ mediaData: dataUrl }, '', btn, 'Post text status');
  if (ok) closeTextComposer();
};

/* -----------------------------------------------------------
   ⚔️ ARENA HISTORY + PLAYER PROFILES
   Stories vanish after 24h, but Arena challenges stay: finished
   duels live in "History" forever. Tap any player's emoji to open
   their profile and see the challenges they created.
   (This block injects its own markup + styles, so Stories.html and
   Stories.css need no changes.)
----------------------------------------------------------- */
const arena = { active: [], done: [], tab: 'active', expanded: false, loaded: false };

(function injectArenaStyles() {
  const css = `
  .ar-section{margin:0 0 16px;padding:12px;border:1px solid var(--nx-line,rgba(255,255,255,.08));border-radius:12px;background:var(--nx-bg-1,#05070d)}
  .ar-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
  .ar-title{margin:0;font-size:14px;font-weight:700;color:var(--nx-text,#e8ecf7)}
  .ar-note{flex:1;min-width:140px;font-size:11px;color:var(--nx-muted,#8a96b5)}
  .ar-tabs{display:flex;gap:6px}
  .ar-tab{padding:5px 12px;border:0;border-radius:14px;background:var(--nx-bg-3,#10141f);color:var(--nx-muted,#8a96b5);font:600 12px/1 inherit;font-family:inherit;cursor:pointer}
  .ar-tab.active{background:var(--nx-blue,#0066ff);color:#fff}
  .ar-list{display:flex;flex-direction:column;gap:6px}
  .ar-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--nx-bg-2,#0a0d16);cursor:pointer;transition:background .12s}
  .ar-row:hover{background:var(--nx-bg-3,#10141f)}
  .ar-players{display:flex;align-items:center;gap:5px;flex-shrink:0;font-size:11px;color:var(--nx-muted,#8a96b5)}
  .ar-av,.pf-chal-av{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:50%;background:linear-gradient(135deg,#0050d6,#00b7ff);font-size:17px;line-height:1;cursor:pointer;transition:border-radius .15s}
  .ar-av:hover{border-radius:11px}
  .ar-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
  .ar-info b{font-size:13px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ar-info small{font-size:11px;color:var(--nx-muted,#8a96b5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ar-chip{flex-shrink:0;padding:4px 9px;border-radius:10px;background:var(--nx-bg-4,#171c2b);font-size:11px;font-weight:700;white-space:nowrap}
  .ar-chip.live{background:rgba(242,63,67,.18);color:#ff6b6e}
  .ar-chip.vote{background:rgba(0,102,255,.2);color:#6fa8ff}
  .ar-chip.win{background:rgba(35,165,90,.2);color:#5ee08e}
  .ar-empty{padding:18px 8px;text-align:center;font-size:12px;color:var(--nx-muted,#8a96b5)}
  .ar-empty a{color:var(--nx-blue-soft,#6fa8ff);font-weight:600}
  .ar-more{margin-top:8px;width:100%;padding:8px;border:0;border-radius:8px;background:var(--nx-bg-3,#10141f);color:var(--nx-muted,#8a96b5);font:600 12px/1 inherit;font-family:inherit;cursor:pointer}
  .ar-more:hover{background:var(--nx-bg-4,#171c2b);color:#fff}
  .st-av[data-pf-uid]{cursor:pointer}

  .pf-modal{position:fixed;inset:0;z-index:1300;display:flex;align-items:center;justify-content:center;padding:14px;background:rgba(0,0,0,.7);font-family:'Poppins',system-ui,sans-serif}
  .pf-card{position:relative;width:100%;max-width:420px;max-height:calc(100dvh - 28px);overflow-y:auto;border-radius:16px;background:var(--nx-bg-2,#0a0d16);border:1px solid var(--nx-line,rgba(255,255,255,.08));color:var(--nx-text,#e8ecf7);box-shadow:0 20px 60px rgba(0,0,0,.6)}
  .pf-banner{height:84px;background:linear-gradient(135deg,hsl(var(--hue,215) 80% 40%),hsl(calc(var(--hue,215) + 50) 85% 55%))}
  .pf-close{position:absolute;top:10px;right:10px;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.45);color:#fff;font-size:14px;cursor:pointer}
  .pf-head{display:flex;align-items:flex-end;gap:12px;margin:-34px 16px 0}
  .pf-avatar{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#0050d6,#00b7ff);border:5px solid var(--nx-bg-2,#0a0d16);font-size:34px}
  .pf-name{margin:0 0 6px;font-size:17px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pf-actions{display:flex;gap:8px;margin:12px 16px 0;flex-wrap:wrap}
  .pf-btn{padding:8px 14px;border:0;border-radius:8px;background:var(--nx-bg-4,#171c2b);color:#fff;font:600 12px/1.2 inherit;font-family:inherit;text-decoration:none;cursor:pointer}
  .pf-btn.primary{background:var(--nx-blue,#0066ff)}
  .pf-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 16px 0}
  .pf-stat{padding:9px 4px;border-radius:10px;background:var(--nx-bg-1,#05070d);text-align:center}
  .pf-stat b{display:block;font-size:17px;color:#fff}
  .pf-stat span{font-size:10px;color:var(--nx-muted,#8a96b5)}
  .pf-h4{margin:16px 16px 8px;font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--nx-muted,#8a96b5)}
  .pf-list{display:flex;flex-direction:column;gap:6px;margin:0 16px 16px}
  `;
  const el = document.createElement('style');
  el.id = 'arenaStoriesStyles';
  el.textContent = css;
  document.head.appendChild(el);
})();

function agoLong(dateStr) {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (!isFinite(mins) || mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days < 30 ? days + 'd ago' : Math.floor(days / 30) + 'mo ago';
}

function minsLeft(endsAt) {
  const m = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 60000);
  return m > 0 ? m + 'm left' : 'time!';
}

function arenaChip(c) {
  switch (c.status) {
    case 'pending':   return '<span class="ar-chip">⏳ Waiting</span>';
    case 'live':      return `<span class="ar-chip live">🔴 LIVE · ${escapeHtml(minsLeft(c.endsAt))}</span>`;
    case 'judging':   return '<span class="ar-chip vote">🗳 Voting open</span>';
    case 'completed': return c.draw
      ? '<span class="ar-chip">🤝 Draw</span>'
      : `<span class="ar-chip win">🏆 ${escapeHtml(c.winnerName || 'Winner')}</span>`;
    case 'declined':  return '<span class="ar-chip">🚫 Declined</span>';
    case 'expired':   return '<span class="ar-chip">⌛ Expired</span>';
    default:          return '<span class="ar-chip">✖ Cancelled</span>';
  }
}

function arenaAvatar(p, cls) {
  return `<button type="button" class="${cls}" data-pf-uid="${escapeHtml(p.userId)}" data-pf-name="${escapeHtml(p.username)}" data-pf-av="${escapeHtml(p.avatar || '🎮')}" title="View ${escapeHtml(p.username)}'s profile">${escapeHtml(p.avatar || '🎮')}</button>`;
}

function arenaRow(c) {
  return `
    <div class="ar-row" data-room="${escapeHtml(c.room)}" data-id="${escapeHtml(c.id)}">
      <span class="ar-players">${arenaAvatar(c.challenger, 'ar-av')}vs${arenaAvatar(c.opponent, 'ar-av')}</span>
      <span class="ar-info">
        <b>${escapeHtml(c.gameName || 'Challenge')} · ${c.minutes} min</b>
        <small>${escapeHtml(c.challenger.username)} vs ${escapeHtml(c.opponent.username)} · ${agoLong(c.updatedAt || c.createdAt)}</small>
      </span>
      ${arenaChip(c)}
    </div>`;
}

function openChallenge(room, id) {
  location.href = './Chat.html?room=' + encodeURIComponent(room) + '&arena=' + encodeURIComponent(id);
}

function ensureArenaSection() {
  let sec = document.getElementById('arenaSection');
  if (sec) return sec;
  const wall = $('storyWall');
  if (!wall || !wall.parentNode) return null;
  sec = document.createElement('section');
  sec.id = 'arenaSection';
  sec.className = 'ar-section';
  sec.innerHTML = `
    <div class="ar-head">
      <h2 class="ar-title">⚔️ Arena</h2>
      <span class="ar-note">Stories vanish after 24h — challenges stay in History.</span>
      <div class="ar-tabs">
        <button type="button" class="ar-tab active" data-tab="active">Live &amp; open</button>
        <button type="button" class="ar-tab" data-tab="done">History</button>
      </div>
    </div>
    <div class="ar-list" id="arenaList"></div>`;
  wall.parentNode.insertBefore(sec, wall);

  sec.addEventListener('click', (e) => {
    const tab = e.target.closest('.ar-tab');
    if (tab) {
      arena.tab = tab.dataset.tab;
      arena.expanded = false;
      sec.querySelectorAll('.ar-tab').forEach(t => t.classList.toggle('active', t === tab));
      renderArena();
      return;
    }
    if (e.target.closest('.ar-more')) { arena.expanded = !arena.expanded; renderArena(); return; }
    if (e.target.closest('[data-pf-uid]')) return;   // handled by the profile opener
    const row = e.target.closest('.ar-row');
    if (row) openChallenge(row.dataset.room, row.dataset.id);
  });
  return sec;
}

function renderArena() {
  const sec = ensureArenaSection();
  if (!sec) return;
  const list = $('arenaList');
  const items = arena.tab === 'active' ? arena.active : arena.done;

  if (!arena.loaded) { list.innerHTML = '<div class="ar-empty">Loading challenges…</div>'; return; }
  if (!items.length) {
    list.innerHTML = arena.tab === 'active'
      ? '<div class="ar-empty">No open challenges right now. <a href="./Chat.html">Challenge someone from a room →</a></div>'
      : '<div class="ar-empty">No finished challenges yet — they will be kept here.</div>';
    return;
  }
  const LIMIT = 4;
  const shown = arena.expanded ? items : items.slice(0, LIMIT);
  list.innerHTML = shown.map(arenaRow).join('') +
    (items.length > LIMIT
      ? `<button type="button" class="ar-more">${arena.expanded ? 'Show less' : 'Show all (' + items.length + ')'}</button>`
      : '');
}

async function loadArena() {
  try {
    const get = (qs) => fetch(API_BASE + '/api/arena?' + qs, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('arena ' + r.status)));
    const [a, d] = await Promise.all([get('view=active&limit=30'), get('view=done&limit=50')]);
    arena.active = a.challenges || [];
    arena.done = d.challenges || [];
    arena.loaded = true;
    renderArena();
  } catch (err) {
    console.error('Load arena error:', err);
    if (!arena.loaded) {
      const list = $('arenaList');
      if (list) list.innerHTML = '<div class="ar-empty">Could not load challenges right now.</div>';
    }
  }
}

/* ---- profile popup ---- */
let profileToken = 0;
let profileOnClose = null;

function ensureProfileModal() {
  let m = document.getElementById('pfModal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'pfModal';
  m.className = 'pf-modal';
  m.style.display = 'none';
  m.innerHTML = `
    <div class="pf-card" role="dialog" aria-modal="true">
      <div class="pf-banner" id="pfBanner"></div>
      <button type="button" class="pf-close" id="pfClose" aria-label="Close">✕</button>
      <div class="pf-head">
        <div class="pf-avatar" id="pfAvatar">🎮</div>
        <h3 class="pf-name" id="pfName"></h3>
      </div>
      <div class="pf-actions" id="pfActions"></div>
      <div class="pf-stats" id="pfStats"></div>
      <h4 class="pf-h4">⚔️ Challenges created</h4>
      <div class="pf-list" id="pfList"></div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('#pfClose')) closeProfile(); });
  $('pfList').addEventListener('click', (e) => {
    if (e.target.closest('[data-pf-uid]')) return;
    const row = e.target.closest('.ar-row');
    if (row) openChallenge(row.dataset.room, row.dataset.id);
  });
  return m;
}

function closeProfile() {
  const m = document.getElementById('pfModal');
  if (!m || m.style.display === 'none') return;
  m.style.display = 'none';
  profileToken++;
  const cb = profileOnClose;
  profileOnClose = null;
  if (cb) cb();
}

function hueOf(str) {
  let h = 0;
  String(str).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) % 360; });
  return h;
}

async function openProfile(opts) {
  const uid = String(opts.uid);
  const isMe = me && String(me.id) === uid;
  const m = ensureProfileModal();
  const token = ++profileToken;
  profileOnClose = opts.onClose || profileOnClose;   // keep the resume-story callback when hopping between profiles

  $('pfBanner').style.setProperty('--hue', String(hueOf(opts.name || uid)));
  $('pfAvatar').textContent = opts.avatar || '🎮';
  $('pfName').textContent = opts.name || 'Player';

  // buttons
  const group = feed.find(g => String(g.userId) === uid && !isMineGroup(g) && g.stories && g.stories.length);
  let actions = '';
  if (!isMe) {
    actions += `<a class="pf-btn primary" href="./Contacts.html?uid=${encodeURIComponent(uid)}&username=${encodeURIComponent(opts.name || '')}&avatar=${encodeURIComponent(opts.avatar || '')}">💬 Message</a>`;
  }
  if (group && !opts.fromViewer) actions += '<button type="button" class="pf-btn" id="pfStoryBtn">📸 View story</button>';
  $('pfActions').innerHTML = actions;
  const sb = document.getElementById('pfStoryBtn');
  if (sb) sb.onclick = () => { profileOnClose = null; closeProfile(); openViewer(group); };

  $('pfStats').innerHTML = ['Created', 'Wins', 'Losses', 'Draws']
    .map(l => `<div class="pf-stat"><b>–</b><span>${l}</span></div>`).join('');
  $('pfList').innerHTML = '<div class="ar-empty">Loading…</div>';
  m.style.display = 'flex';

  try {
    const res = await fetch(API_BASE + '/api/arena/user/' + encodeURIComponent(uid), { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (token !== profileToken) return;               // closed or replaced meanwhile
    if (!res.ok) throw new Error(data.error || 'Could not load this profile.');

    if (data.user) {
      $('pfName').textContent = data.user.username || opts.name || 'Player';
      $('pfAvatar').textContent = data.user.avatar || opts.avatar || '🎮';
    }
    const s = data.stats || {};
    $('pfStats').innerHTML = [['Created', s.created], ['Wins', s.wins], ['Losses', s.losses], ['Draws', s.draws]]
      .map(([l, v]) => `<div class="pf-stat"><b>${Number(v) || 0}</b><span>${l}</span></div>`).join('');

    const list = data.challenges || [];
    $('pfList').innerHTML = list.length
      ? list.map(arenaRow).join('')
      : `<div class="ar-empty">${isMe ? "You haven't" : "This player hasn't"} created any challenges yet.</div>`;
  } catch (err) {
    if (token !== profileToken) return;
    $('pfList').innerHTML = `<div class="ar-empty">${escapeHtml(err.message || 'Could not load challenges.')}</div>`;
  }
}

// Tap any player's emoji (sidebar, wall cards, Arena rows…) → their profile.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-pf-uid]');
  if (!t) return;
  e.stopPropagation();
  e.preventDefault();
  openProfile({ uid: t.dataset.pfUid, name: t.dataset.pfName, avatar: t.dataset.pfAv });
}, true);

// …and the avatar inside the story viewer (the story pauses while you look).
$('storyViewerAvatar').style.cursor = 'pointer';
$('storyViewerAvatar').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!activeGroup || isMineGroup(activeGroup)) return;
  pauseStory('sheet');
  openProfile({
    uid: activeGroup.userId,
    name: activeGroup.username,
    avatar: activeGroup.avatar,
    fromViewer: true,
    onClose: () => resumeStory('sheet')
  });
});

// Esc closes the profile first (before the viewer / modals see it).
document.addEventListener('keydown', (e) => {
  const m = document.getElementById('pfModal');
  if (e.key === 'Escape' && m && m.style.display !== 'none') {
    e.stopImmediatePropagation();
    closeProfile();
  }
}, true);

/* -----------------------------------------------------------
   KEYBOARD (desktop) + AUTO REFRESH
----------------------------------------------------------- */
document.addEventListener('keydown', (e) => {
  if ($('storyTextModal').style.display === 'flex') {
    if (e.key === 'Escape') closeTextComposer();
    return;
  }
  if ($('storyUploadModal').style.display === 'flex') {
    if (e.key === 'Escape') $('storyUploadCancelBtn').click();
    return;
  }
  if ($('storyViewer').style.display !== 'flex') return;

  if (e.key === 'ArrowRight') nextStory();
  else if (e.key === 'ArrowLeft') prevStory();
  else if (e.key === 'Escape') {
    if ($('storyViewersSheet').style.display === 'flex') $('storyViewersCloseBtn').click();
    else closeViewer();
  } else if (e.key === ' ') {
    e.preventDefault();
    pauseReasons.has('key') ? resumeStory('key') : pauseStory('key');
  }
});

if (me) {
  loadStories();
  renderArena();
  loadArena();

  // Pick up new stories (and refresh "2h" labels) without a reload.
  setInterval(() => {
    const busy = $('storyViewer').style.display === 'flex'
      || $('storyUploadModal').style.display === 'flex'
      || $('storyTextModal').style.display === 'flex';
    if (!busy && !document.hidden) { loadStories(); loadArena(); }
  }, 60000);
}
