/*==============================
REMIX-NEXUS — VOICE & VIDEO CALLS
Shared by Chat.html (group/room calls) and Contacts.html (1:1 calls).
Talks to the same Socket.io connection those pages already create; this
file only relays WebRTC signaling through the server — actual audio/video
travels directly device-to-device once connected.

NOTE ON RELIABILITY: this uses public Google STUN servers only. That's
enough for most home wifi / most mobile networks, but a small percentage
of connections (strict corporate firewalls, some carrier-grade NAT setups)
will fail to connect without a TURN server. If calls don't connect for some
users, add a TURN server (e.g. a free tier from Twilio, Metered, or your
own coturn) to ICE_SERVERS below.
==============================*/

(function () {
  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'bdb075382d6df379c55ef888', credential: '7xzC1Hi9hgPQZFRm' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'bdb075382d6df379c55ef888', credential: '7xzC1Hi9hgPQZFRm' },
    { urls: 'turn:global.relay.metered.ca:443', username: 'bdb075382d6df379c55ef888', credential: '7xzC1Hi9hgPQZFRm' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'bdb075382d6df379c55ef888', credential: '7xzC1Hi9hgPQZFRm' }
    // TURN credentials above are from your Metered dashboard (project
    // "remix-nexus"). The 80/tcp/443/turns variants aren't redundant —
    // they're fallbacks so a call can still get through on networks that
    // block plain UDP or non-standard ports (many corporate/school wifi
    // setups only allow 80/443). Keep all four TURN entries.
  ];

  let socket = null;
  let ctx = { getMyUserId: () => null, getMyUsername: () => 'You', getMyAvatar: () => '🎮' };

  // ---- CALL STATE ----
  // For a 1:1 call: `call` holds { callId, type, peerUserId, peerUsername, peerAvatar, pc, localStream, remoteStream, direction }
  // For a room call: `roomCall` holds { callId, room, roomName, type, localStream, peers: Map<userId, {pc, username, avatar, stream}> }
  let call = null;
  let roomCall = null;
  let incomingInvite = null; // a pending 1:1 invite waiting on Accept/Decline
  let incomingRoomInvite = null; // a pending room-call invite

  /* -----------------------------------------------------------
     CALL SOUNDS — a ringback tone for the caller ("calling…") and a
     ringtone for the callee ("someone's calling you"), both synthesized
     with the Web Audio API so nothing needs to be hosted. The ringtone
     can be swapped for a preset or a user-uploaded file via
     openRingtoneSettings() further down, same idea as a phone's
     per-device ringtone setting.
  ----------------------------------------------------------- */
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  // Browsers block audio until the page has seen at least one real user
  // interaction. This quietly unlocks the AudioContext the first time
  // someone taps/clicks anywhere, so it's already unlocked by the time a
  // real call comes in.
  function unlockAudioOnce() {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    document.removeEventListener('click', unlockAudioOnce);
    document.removeEventListener('touchstart', unlockAudioOnce);
  }
  document.addEventListener('click', unlockAudioOnce);
  document.addEventListener('touchstart', unlockAudioOnce);

  function beep(freq, startTime, duration, volume) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  // ---- OUTGOING RINGBACK (what the caller hears while it rings) ----
  let ringbackTimer = null;
  function playRingbackCycle() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    beep(480, now, 0.9, 0.12);
    beep(620, now, 0.9, 0.12);
  }
  function startRingback() {
    stopRingback();
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    playRingbackCycle();
    ringbackTimer = setInterval(playRingbackCycle, 3000);
  }
  function stopRingback() {
    clearInterval(ringbackTimer);
    ringbackTimer = null;
  }

  // ---- INCOMING RINGTONE (what the callee hears) ----
  const RINGTONE_PRESETS = {
    classic: { label: 'Classic Chime', notes: [659.25, 880.00], toneLen: 0.35, noteGap: 0.10, loopGap: 1300 },
    pulse:   { label: 'Digital Pulse', notes: [440, 440, 440],  toneLen: 0.12, noteGap: 0.10, loopGap: 900 },
    marimba: { label: 'Marimba Rise',  notes: [523.25, 659.25, 783.99], toneLen: 0.22, noteGap: 0.05, loopGap: 1100 },
    retro:   { label: 'Retro Beep',    notes: [300, 300],       toneLen: 0.15, noteGap: 0.15, loopGap: 1000 }
  };
  const RINGTONE_PRESET_KEY = 'remix-nexusRingtonePreset';
  const CUSTOM_RINGTONE_DATA_KEY = 'remix-nexusCustomRingtoneData';
  const CUSTOM_RINGTONE_NAME_KEY = 'remix-nexusCustomRingtoneName';
  const MAX_CUSTOM_RINGTONE_LENGTH = 3_000_000; // ~2.2MB of actual audio

  function getSelectedPresetId() {
    const id = localStorage.getItem(RINGTONE_PRESET_KEY);
    return (id && RINGTONE_PRESETS[id]) ? id : 'classic';
  }

  function playPresetCycle(preset) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    let t = ctx.currentTime;
    preset.notes.forEach((freq) => {
      beep(freq, t, preset.toneLen, 0.18);
      t += preset.toneLen + preset.noteGap;
    });
  }

  let ringtoneTimer = null;
  let ringtoneAudioEl = null;

  function startIncomingRingtone() {
    stopIncomingRingtone();

    const customData = localStorage.getItem(CUSTOM_RINGTONE_DATA_KEY);
    if (customData) {
      ringtoneAudioEl = new Audio(customData);
      ringtoneAudioEl.loop = true;
      ringtoneAudioEl.play().catch(() => {});
      return;
    }

    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});

    const preset = RINGTONE_PRESETS[getSelectedPresetId()];
    const cycleLength = preset.notes.length * (preset.toneLen + preset.noteGap) * 1000 + preset.loopGap;
    playPresetCycle(preset);
    ringtoneTimer = setInterval(() => playPresetCycle(preset), cycleLength);
  }

  function stopIncomingRingtone() {
    clearInterval(ringtoneTimer);
    ringtoneTimer = null;
    if (ringtoneAudioEl) {
      ringtoneAudioEl.pause();
      ringtoneAudioEl = null;
    }
  }

  /* -----------------------------------------------------------
     RINGTONE SETTINGS — lets each person choose which sound plays on
     THEIR OWN device when someone calls them. Stored in localStorage,
     same as a phone's per-device ringtone — it never affects what
     anyone else hears.
  ----------------------------------------------------------- */
  let ringtoneModal = null;

  function refreshRingtoneModalSelection() {
    if (!ringtoneModal) return;
    const currentPreset = getSelectedPresetId();
    const hasCustom = !!localStorage.getItem(CUSTOM_RINGTONE_DATA_KEY);

    ringtoneModal.querySelectorAll('[data-preset-id]').forEach((row) => {
      const id = row.dataset.presetId;
      const selected = !hasCustom && currentPreset === id;
      row.textContent = (selected ? '● ' : '○ ') + RINGTONE_PRESETS[id].label;
      row.style.borderColor = selected ? '#7f5bff' : 'rgba(255,255,255,0.1)';
    });

    const uploadLabel = document.getElementById('rnRingtoneUploadLabel');
    if (uploadLabel) {
      const text = hasCustom
        ? '● Custom: ' + (localStorage.getItem(CUSTOM_RINGTONE_NAME_KEY) || 'your file')
        : '○ Upload your own sound…';
      Array.from(uploadLabel.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) uploadLabel.removeChild(node);
      });
      uploadLabel.insertBefore(document.createTextNode(text), uploadLabel.firstChild);
    }
  }

  function buildRingtoneModal() {
    if (ringtoneModal) return;

    ringtoneModal = document.createElement('div');
    ringtoneModal.className = 'rn-ringtone-modal';
    ringtoneModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);align-items:center;justify-content:center;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#161622;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;width:90%;max-width:380px;color:#fff;font-family:inherit;';

    const heading = document.createElement('h3');
    heading.textContent = '🔔 Call Ringtone';
    heading.style.cssText = 'margin:0 0 6px;';
    card.appendChild(heading);

    const sub = document.createElement('p');
    sub.textContent = 'Choose the sound that plays when someone calls you.';
    sub.style.cssText = 'margin:0 0 18px;opacity:0.7;font-size:0.9em;';
    card.appendChild(sub);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:16px;';

    Object.entries(RINGTONE_PRESETS).forEach(([id, preset]) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.presetId = id;
      row.style.cssText = 'text-align:left;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;font-family:inherit;font-size:0.95em;';
      row.addEventListener('click', () => {
        localStorage.removeItem(CUSTOM_RINGTONE_DATA_KEY);
        localStorage.removeItem(CUSTOM_RINGTONE_NAME_KEY);
        localStorage.setItem(RINGTONE_PRESET_KEY, id);
        playPresetCycle(preset);
        refreshRingtoneModalSelection();
      });
      list.appendChild(row);
    });
    card.appendChild(list);

    const uploadLabel = document.createElement('label');
    uploadLabel.id = 'rnRingtoneUploadLabel';
    uploadLabel.style.cssText = 'display:block;background:rgba(127,91,255,0.15);border:1px solid rgba(127,91,255,0.4);color:#fff;padding:10px 14px;border-radius:10px;cursor:pointer;margin-bottom:18px;text-align:left;font-size:0.95em;';

    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'audio/*';
    uploadInput.style.display = 'none';
    uploadInput.addEventListener('change', async () => {
      const file = uploadInput.files && uploadInput.files[0];
      if (!file) return;

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      if (dataUrl.length > MAX_CUSTOM_RINGTONE_LENGTH) {
        alert('That file is too large — pick a shorter clip (under about 2MB).');
        return;
      }

      localStorage.setItem(CUSTOM_RINGTONE_DATA_KEY, dataUrl);
      localStorage.setItem(CUSTOM_RINGTONE_NAME_KEY, file.name);
      refreshRingtoneModalSelection();

      const preview = new Audio(dataUrl);
      preview.play().catch(() => {});
      setTimeout(() => preview.pause(), 3000);
    });

    uploadLabel.appendChild(uploadInput);
    uploadLabel.addEventListener('click', (e) => {
      // uploadInput lives INSIDE this <label>, so the browser already
      // forwards a click to it natively the instant the label is clicked
      // (same as clicking a <label for="..."> for a checkbox). Without
      // preventDefault() here, that native forward fires AND this handler's
      // own uploadInput.click() fires a moment later — two file-picker
      // opens for one tap. On most browsers the second call cancels the
      // first dialog before a file can be chosen, which is why picking a
      // file looked like it silently did nothing. preventDefault() stops
      // the native forward so only the one manual click() below runs.
      if (e.target === uploadInput) return;
      e.preventDefault();
      uploadInput.click();
    });
    card.appendChild(uploadLabel);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Done';
    closeBtn.style.cssText = 'width:100%;background:linear-gradient(90deg,#7f5bff,#00d4ff);border:none;color:#fff;font-weight:600;padding:12px;border-radius:999px;cursor:pointer;font-family:inherit;';
    closeBtn.addEventListener('click', () => { ringtoneModal.style.display = 'none'; });
    card.appendChild(closeBtn);

    ringtoneModal.appendChild(card);
    ringtoneModal.addEventListener('click', (e) => {
      if (e.target === ringtoneModal) ringtoneModal.style.display = 'none';
    });
    document.body.appendChild(ringtoneModal);
  }

  function openRingtoneSettings() {
    buildRingtoneModal();
    refreshRingtoneModalSelection();
    ringtoneModal.style.display = 'flex';
  }

  /* -----------------------------------------------------------
     UI — built once, at runtime, so neither Chat.html nor
     Contacts.html need to be touched beyond adding the call buttons.
  ----------------------------------------------------------- */
  let overlay, remoteVideoEl, localVideoEl, callTitleEl, callSubtitleEl, callTimerEl,
      muteBtn, cameraBtn, hangupBtn, incomingBanner, incomingText, acceptBtn, declineBtn;

  function buildUI() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.id = 'rnCallOverlay';
    overlay.className = 'rn-call-overlay';
    overlay.innerHTML = `
      <video id="rnRemoteVideo" class="rn-remote-video" autoplay playsinline></video>
      <video id="rnLocalVideo" class="rn-local-video" autoplay playsinline muted></video>
      <div class="rn-call-info">
        <div class="rn-call-avatar" id="rnCallAvatar">🎮</div>
        <h3 id="rnCallTitle">Calling…</h3>
        <p id="rnCallSubtitle" class="rn-call-subtitle"></p>
        <p id="rnCallTimer" class="rn-call-timer"></p>
      </div>
      <div class="rn-call-controls">
        <button type="button" id="rnMuteBtn" class="rn-call-btn" title="Mute">🎤</button>
        <button type="button" id="rnCameraBtn" class="rn-call-btn" title="Turn camera off">📷</button>
        <button type="button" id="rnHangupBtn" class="rn-call-btn rn-hangup" title="Hang up">📞</button>
      </div>
    `;
    document.body.appendChild(overlay);

    incomingBanner = document.createElement('div');
    incomingBanner.id = 'rnIncomingCall';
    incomingBanner.className = 'rn-incoming-call';
    incomingBanner.innerHTML = `
      <div class="rn-incoming-info">
        <span class="rn-incoming-avatar" id="rnIncomingAvatar">🎮</span>
        <div>
          <strong id="rnIncomingText">Incoming call</strong>
          <span class="rn-incoming-sub" id="rnIncomingSub"></span>
        </div>
      </div>
      <div class="rn-incoming-actions">
        <button type="button" id="rnDeclineBtn" class="rn-incoming-decline" title="Decline">✕</button>
        <button type="button" id="rnAcceptBtn" class="rn-incoming-accept" title="Accept">✓</button>
      </div>
    `;
    document.body.appendChild(incomingBanner);

    remoteVideoEl = document.getElementById('rnRemoteVideo');
    localVideoEl = document.getElementById('rnLocalVideo');
    callTitleEl = document.getElementById('rnCallTitle');
    callSubtitleEl = document.getElementById('rnCallSubtitle');
    callTimerEl = document.getElementById('rnCallTimer');
    muteBtn = document.getElementById('rnMuteBtn');
    cameraBtn = document.getElementById('rnCameraBtn');
    hangupBtn = document.getElementById('rnHangupBtn');
    incomingText = document.getElementById('rnIncomingText');
    acceptBtn = document.getElementById('rnAcceptBtn');
    declineBtn = document.getElementById('rnDeclineBtn');

    muteBtn.addEventListener('click', toggleMute);
    cameraBtn.addEventListener('click', toggleCamera);
    hangupBtn.addEventListener('click', hangUpWhicheverCall);
    acceptBtn.addEventListener('click', acceptIncoming);
    declineBtn.addEventListener('click', declineIncoming);
  }

  // The hang-up button is shared by both call types, but previously it only
  // ever tore down a 1:1 `call` — a room call was left with `roomCall` still
  // set (mic/camera still on, peer connections still open, server never
  // notified). That stuck `roomCall` then made every future startRoomCall /
  // startDMCall call silently no-op because of the `if (call || roomCall) return;`
  // guards — i.e. the call button "worked once" and never again.
  function hangUpWhicheverCall() {
    if (roomCall) leaveRoomCallLocally(true);
    else if (call) endCall(true);
  }

  function showOverlay(title, subtitle, avatar) {
    buildUI();
    document.getElementById('rnCallAvatar').textContent = avatar || '🎮';
    callTitleEl.textContent = title;
    callSubtitleEl.textContent = subtitle || '';
    callTimerEl.textContent = '';
    overlay.classList.add('active');
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove('active');
    remoteVideoEl.srcObject = null;
    localVideoEl.srcObject = null;
  }

  function showIncomingBanner(text, sub, avatar) {
    buildUI();
    document.getElementById('rnIncomingAvatar').textContent = avatar || '🎮';
    incomingText.textContent = text;
    document.getElementById('rnIncomingSub').textContent = sub || '';
    incomingBanner.classList.add('active');
  }

  function hideIncomingBanner() {
    if (!incomingBanner) return;
    incomingBanner.classList.remove('active');
  }

  let timerInterval = null;
  function startTimer() {
    const start = Date.now();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - start) / 1000);
      const m = Math.floor(secs / 60);
      const s = (secs % 60).toString().padStart(2, '0');
      if (callTimerEl) callTimerEl.textContent = `${m}:${s}`;
    }, 1000);
  }
  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  /* -----------------------------------------------------------
     MEDIA + PEER CONNECTION HELPERS
  ----------------------------------------------------------- */
  async function getLocalStream(type) {
    const constraints = type === 'video'
      ? { audio: true, video: { width: { ideal: 640 }, height: { ideal: 480 } } }
      : { audio: true, video: false };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  // `onFailed` fires once if ICE never reaches "connected"/"completed"
  // within CONNECT_TIMEOUT_MS, or if it explicitly reaches "failed"/
  // "disconnected" and stays there — this is what makes a dead call (rings,
  // then silently hangs forever with STUN-only + both sides behind NAT)
  // show up as an actual error instead of nothing happening.
  const CONNECT_TIMEOUT_MS = 20000;

  function makePeerConnection(onIceCandidate, onTrack, onFailed) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (e.candidate) onIceCandidate(e.candidate);
    };
    pc.ontrack = (e) => onTrack(e.streams[0]);

    let settled = false;
    const connectTimeout = setTimeout(() => {
      if (settled) return;
      const state = pc.iceConnectionState;
      if (state !== 'connected' && state !== 'completed') {
        console.warn('[calls] ICE never connected within timeout (state: ' + state + '). Likely needs a TURN server — see ICE_SERVERS at the top of calls.js.');
        settled = true;
        if (onFailed) onFailed('timeout');
      }
    }, CONNECT_TIMEOUT_MS);

    pc.oniceconnectionstatechange = () => {
      console.log('[calls] ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        settled = true;
        clearTimeout(connectTimeout);
      } else if (pc.iceConnectionState === 'failed') {
        if (!settled) {
          settled = true;
          clearTimeout(connectTimeout);
          if (onFailed) onFailed('failed');
        }
      }
    };

    return pc;
  }

  function toggleMute() {
    const stream = call ? call.localStream : (roomCall ? roomCall.localStream : null);
    if (!stream) return;
    stream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; muteBtn.textContent = t.enabled ? '🎤' : '🔇'; });
  }

  function toggleCamera() {
    const stream = call ? call.localStream : (roomCall ? roomCall.localStream : null);
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    if (!tracks.length) return;
    tracks.forEach(t => { t.enabled = !t.enabled; cameraBtn.textContent = t.enabled ? '📷' : '🚫'; });
  }

  /* -----------------------------------------------------------
     1:1 CALLS (Contacts page)
  ----------------------------------------------------------- */
  function generateCallId() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('call-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  }

  async function startDMCall(toUserId, toUsername, toAvatar, type) {
    if (!socket || call || roomCall) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Calling needs microphone/camera access, and this browser doesn't support it.");
      return;
    }

    const callId = generateCallId();
    let localStream;
    try {
      localStream = await getLocalStream(type);
    } catch (err) {
      alert('Microphone/camera access was blocked. Allow it in your browser settings to make calls.');
      return;
    }

    const pc = makePeerConnection(
      (candidate) => socket.emit('call:signal', { toUserId, callId, data: { kind: 'candidate', candidate } }),
      (stream) => { remoteVideoEl.srcObject = stream; },
      () => {
        if (call && call.callId === callId) {
          alert("Call couldn't connect — this usually means a TURN server is needed for one of your networks. See the note at the top of calls.js.");
          endCall(true);
        }
      }
    );
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    call = { callId, type, peerUserId: String(toUserId), peerUsername: toUsername, peerAvatar: toAvatar, pc, localStream, direction: 'outgoing' };

    showOverlay(`Calling ${toUsername}…`, type === 'video' ? 'Video call' : 'Voice call', toAvatar);
    localVideoEl.srcObject = type === 'video' ? localStream : null;
    localVideoEl.style.display = type === 'video' ? 'block' : 'none';
    cameraBtn.style.display = type === 'video' ? 'inline-flex' : 'none';

    socket.emit('call:invite', { toUserId, callId, type });
    startRingback();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call:signal', { toUserId, callId, data: { kind: 'offer', sdp: offer } });
  }

  function handleCallInvite({ callId, type, fromUserId, fromUsername, fromAvatar } = {}) {
    if (call || roomCall) {
      // Already on a call — auto-decline, same as a busy signal.
      socket.emit('call:decline', { toUserId: fromUserId, callId });
      return;
    }
    incomingInvite = { callId, type, fromUserId: String(fromUserId), fromUsername, fromAvatar };
    showIncomingBanner(`${fromUsername || 'Someone'} is calling…`, type === 'video' ? 'Video call' : 'Voice call', fromAvatar);
    startIncomingRingtone();
  }

  async function acceptIncoming() {
    if (!incomingInvite) return;
    const { callId, type, fromUserId, fromUsername, fromAvatar, pendingOfferData, pendingCandidates } = incomingInvite;
    incomingInvite = null;
    hideIncomingBanner();
    stopIncomingRingtone();

    let localStream;
    try {
      localStream = await getLocalStream(type);
    } catch (err) {
      alert('Microphone/camera access was blocked. Allow it in your browser settings to answer calls.');
      socket.emit('call:decline', { toUserId: fromUserId, callId });
      return;
    }

    const pc = makePeerConnection(
      (candidate) => socket.emit('call:signal', { toUserId: fromUserId, callId, data: { kind: 'candidate', candidate } }),
      (stream) => { remoteVideoEl.srcObject = stream; },
      () => {
        if (call && call.callId === callId) {
          alert("Call couldn't connect — this usually means a TURN server is needed for one of your networks. See the note at the top of calls.js.");
          endCall(true);
        }
      }
    );
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    call = { callId, type, peerUserId: fromUserId, peerUsername: fromUsername, peerAvatar: fromAvatar, pc, localStream, direction: 'incoming' };

    showOverlay(fromUsername || 'Player', type === 'video' ? 'Video call' : 'Voice call', fromAvatar);
    localVideoEl.srcObject = type === 'video' ? localStream : null;
    localVideoEl.style.display = type === 'video' ? 'block' : 'none';
    cameraBtn.style.display = type === 'video' ? 'inline-flex' : 'none';
    startTimer();

    // The caller's offer may have arrived (and been stashed) before we
    // finished getting camera/mic access and setting up our side.
    if (pendingOfferData) {
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferData));
      flushQueuedCandidates(call);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:signal', { toUserId: fromUserId, callId, data: { kind: 'answer', sdp: answer } });
      (pendingCandidates || []).forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
    }
  }

  function declineIncoming() {
    if (!incomingInvite) return;
    socket.emit('call:decline', { toUserId: incomingInvite.fromUserId, callId: incomingInvite.callId });
    incomingInvite = null;
    hideIncomingBanner();
    stopIncomingRingtone();
  }

  async function handleCallSignal({ callId, data, fromUserId } = {}) {
    if (!call || call.callId !== callId) {
      // Offer/candidates arrived before Accept finished setting up the peer
      // connection — stash them so acceptIncoming() can replay them once ready.
      if (incomingInvite && incomingInvite.callId === callId) {
        if (data.kind === 'offer') incomingInvite.pendingOfferData = data.sdp;
        if (data.kind === 'candidate') {
          incomingInvite.pendingCandidates = incomingInvite.pendingCandidates || [];
          incomingInvite.pendingCandidates.push(data.candidate);
        }
      }
      return;
    }

    try {
      if (data.kind === 'offer') {
        await call.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        flushQueuedCandidates(call);
        const answer = await call.pc.createAnswer();
        await call.pc.setLocalDescription(answer);
        socket.emit('call:signal', { toUserId: fromUserId, callId, data: { kind: 'answer', sdp: answer } });
      } else if (data.kind === 'answer') {
        await call.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        flushQueuedCandidates(call);
        stopRingback();
        startTimer();
      } else if (data.kind === 'candidate') {
        // If the remote description isn't applied yet, addIceCandidate()
        // throws and the old code just swallowed that error — losing the
        // candidate for good. Queuing it here instead means it gets added
        // the moment the offer/answer above finishes, so a candidate that
        // arrives early no longer just vanishes.
        if (call.pc.remoteDescription) {
          await call.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
        } else {
          call.queuedCandidates = call.queuedCandidates || [];
          call.queuedCandidates.push(data.candidate);
        }
      }
    } catch (err) {
      console.error('Call signal error:', err);
    }
  }

  function flushQueuedCandidates(callObj) {
    if (!callObj.queuedCandidates || !callObj.queuedCandidates.length) return;
    const queued = callObj.queuedCandidates;
    callObj.queuedCandidates = [];
    queued.forEach((c) => callObj.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
  }

  function endCall(notifyPeer) {
    stopRingback();
    if (call) {
      if (notifyPeer && socket) socket.emit('call:end', { toUserId: call.peerUserId, callId: call.callId });
      if (call.localStream) call.localStream.getTracks().forEach(t => t.stop());
      if (call.pc) call.pc.close();
      call = null;
    }
    stopTimer();
    hideOverlay();
  }

  function handleCallEnded({ callId } = {}) {
    if (call && call.callId === callId) endCall(false);
    if (incomingInvite && incomingInvite.callId === callId) {
      incomingInvite = null;
      hideIncomingBanner();
      stopIncomingRingtone();
    }
  }

  function handleCallDeclined({ callId } = {}) {
    if (call && call.callId === callId) {
      alert(`${call.peerUsername || 'They'} declined the call.`);
      endCall(false);
    }
  }

  /* -----------------------------------------------------------
     GROUP / ROOM CALLS (Chat page)
  ----------------------------------------------------------- */
  async function startRoomCall(room, roomName, type) {
    if (!socket || call || roomCall) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Calling needs microphone/camera access, and this browser doesn't support it.");
      return;
    }

    let localStream;
    try {
      localStream = await getLocalStream(type);
    } catch (err) {
      alert('Microphone/camera access was blocked. Allow it in your browser settings to make calls.');
      return;
    }

    const callId = generateCallId();
    roomCall = { callId, room, roomName, type, localStream, peers: new Map() };

    showOverlay(roomName, type === 'video' ? 'Video call' : 'Voice call', '🎮');
    localVideoEl.srcObject = type === 'video' ? localStream : null;
    localVideoEl.style.display = type === 'video' ? 'block' : 'none';
    cameraBtn.style.display = type === 'video' ? 'inline-flex' : 'none';
    startTimer();

    socket.emit('roomcall:start', { room, callId, type });
    socket.emit('roomcall:join', { room, callId });
    startRingback();
  }

  function joinRoomCall(room, roomName, callId, type) {
    if (call || roomCall) return;
    (async () => {
      let localStream;
      try {
        localStream = await getLocalStream(type);
      } catch (err) {
        alert('Microphone/camera access was blocked. Allow it in your browser settings to join calls.');
        return;
      }
      roomCall = { callId, room, roomName, type, localStream, peers: new Map() };
      showOverlay(roomName, type === 'video' ? 'Video call' : 'Voice call', '🎮');
      localVideoEl.srcObject = type === 'video' ? localStream : null;
      localVideoEl.style.display = type === 'video' ? 'block' : 'none';
      cameraBtn.style.display = type === 'video' ? 'inline-flex' : 'none';
      startTimer();
      socket.emit('roomcall:join', { room, callId });
    })();
  }

  function makeRoomPeer(peerUserId) {
    const pc = makePeerConnection(
      (candidate) => socket.emit('roomcall:signal', { room: roomCall.room, callId: roomCall.callId, toUserId: peerUserId, data: { kind: 'candidate', candidate } }),
      (stream) => { renderRoomRemote(); }
    );
    roomCall.localStream.getTracks().forEach(track => pc.addTrack(track, roomCall.localStream));
    return pc;
  }

  // Mesh calls can have several remote streams — this keeps the single
  // <video id="rnRemoteVideo"> showing whichever peer most recently sent
  // video/audio, which is a reasonable simple default for small squad calls.
  function renderRoomRemote() {
    if (!roomCall) return;
    const streams = Array.from(roomCall.peers.values()).map(p => p.stream).filter(Boolean);
    remoteVideoEl.srcObject = streams.length ? streams[streams.length - 1] : null;
    callSubtitleEl.textContent = `${roomCall.peers.size + 1} in call`;
  }

  async function handleRoomCallParticipants({ room, callId, participants } = {}) {
    if (!roomCall || roomCall.room !== room || roomCall.callId !== callId) return;
    for (const p of participants) {
      if (roomCall.peers.has(p.userId)) continue;
      const pc = makeRoomPeer(p.userId);
      roomCall.peers.set(p.userId, { pc, username: p.username, avatar: p.avatar, stream: null });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('roomcall:signal', { room, callId, toUserId: p.userId, data: { kind: 'offer', sdp: offer } });
    }
    if (roomCall.peers.size > 0) stopRingback();
    renderRoomRemote();
  }

  function handleRoomPeerJoined({ room, callId, userId } = {}) {
    if (!roomCall || roomCall.room !== room || roomCall.callId !== callId) return;
    if (roomCall.peers.has(userId)) return;
    // Wait for them to send us an offer — handled in handleRoomCallSignal.
    renderRoomRemote();
  }

  async function handleRoomCallSignal({ room, callId, data, fromUserId } = {}) {
    if (!roomCall || roomCall.room !== room || roomCall.callId !== callId) return;

    let peer = roomCall.peers.get(fromUserId);
    if (!peer) {
      const pc = makeRoomPeer(fromUserId);
      peer = { pc, username: '', avatar: '', stream: null };
      roomCall.peers.set(fromUserId, peer);
      pc.ontrack = (e) => { peer.stream = e.streams[0]; renderRoomRemote(); };
    }

    try {
      if (data.kind === 'offer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        flushQueuedCandidates(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        socket.emit('roomcall:signal', { room, callId, toUserId: fromUserId, data: { kind: 'answer', sdp: answer } });
      } else if (data.kind === 'answer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        flushQueuedCandidates(peer);
      } else if (data.kind === 'candidate') {
        if (peer.pc.remoteDescription) {
          await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
        } else {
          peer.queuedCandidates = peer.queuedCandidates || [];
          peer.queuedCandidates.push(data.candidate);
        }
      }
    } catch (err) {
      console.error('Room call signal error:', err);
    }
  }

  function handleRoomPeerLeft({ room, callId, userId } = {}) {
    if (!roomCall || roomCall.room !== room || roomCall.callId !== callId) return;
    const peer = roomCall.peers.get(userId);
    if (peer) {
      if (peer.pc) peer.pc.close();
      roomCall.peers.delete(userId);
    }
    renderRoomRemote();
  }

  function leaveRoomCallLocally(notifyServer) {
    if (!roomCall) return;
    stopRingback();
    if (notifyServer && socket) socket.emit('roomcall:leave', { room: roomCall.room, callId: roomCall.callId });
    roomCall.peers.forEach(p => p.pc && p.pc.close());
    if (roomCall.localStream) roomCall.localStream.getTracks().forEach(t => t.stop());
    roomCall = null;
    stopTimer();
    hideOverlay();
  }

  function handleRoomCallIncoming({ room, roomName, callId, type, fromUsername } = {}) {
    if (call || roomCall) return; // already busy
    incomingRoomInvite = { room, roomName: roomName || room, callId, type, fromUsername };
    showIncomingBanner(`${fromUsername || 'Someone'} started a ${type} call`, 'Tap to join', '🎮');
    startIncomingRingtone();
  }

  /* -----------------------------------------------------------
     Wire the shared Accept/Decline banner to whichever kind of
     invite is currently pending (1:1 or room).
  ----------------------------------------------------------- */
  const originalAccept = acceptIncoming;
  function acceptWhicheverIncoming() {
    if (incomingInvite) { acceptIncoming(); return; }
    if (incomingRoomInvite) {
      stopIncomingRingtone();
      const { room, roomName, callId, type } = incomingRoomInvite;
      incomingRoomInvite = null;
      hideIncomingBanner();
      joinRoomCall(room, roomName, callId, type);
    }
  }
  function declineWhicheverIncoming() {
    if (incomingInvite) { declineIncoming(); return; }
    if (incomingRoomInvite) {
      stopIncomingRingtone();
      incomingRoomInvite = null;
      hideIncomingBanner();
    }
  }

  /* -----------------------------------------------------------
     PUBLIC API
  ----------------------------------------------------------- */
  function init(socketInstance, context) {
    socket = socketInstance;
    ctx = Object.assign(ctx, context || {});
    buildUI();

    // Re-wire the buttons now that the "whichever" handlers exist.
    acceptBtn.removeEventListener('click', originalAccept);
    acceptBtn.addEventListener('click', acceptWhicheverIncoming);
    declineBtn.removeEventListener('click', declineIncoming);
    declineBtn.addEventListener('click', declineWhicheverIncoming);

    socket.on('call:invite', handleCallInvite);
    socket.on('call:signal', handleCallSignal);
    socket.on('call:ended', handleCallEnded);
    socket.on('call:declined', handleCallDeclined);

    socket.on('roomcall:incoming', handleRoomCallIncoming);
    socket.on('roomcall:participants', handleRoomCallParticipants);
    socket.on('roomcall:peer-joined', handleRoomPeerJoined);
    socket.on('roomcall:signal', handleRoomCallSignal);
    socket.on('roomcall:peer-left', handleRoomPeerLeft);
  }

  function attachSocket(socketInstance) {
    // Contacts.js creates its socket asynchronously after login — call this
    // once that socket exists (init() calls it internally too).
    init(socketInstance, ctx);
  }

  window.RemixCalls = {
    init,
    attachSocket,
    startDMCall,
    startRoomCall,
    isBusy: () => !!(call || roomCall),
    leaveRoomCall: () => leaveRoomCallLocally(true),
    openRingtoneSettings
  };
})();