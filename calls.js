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
    { urls: 'stun:stun1.l.google.com:19302' }
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
    hangupBtn.addEventListener('click', () => endCall(true));
    acceptBtn.addEventListener('click', acceptIncoming);
    declineBtn.addEventListener('click', declineIncoming);
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

  function makePeerConnection(onIceCandidate, onTrack) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (e) => {
      if (e.candidate) onIceCandidate(e.candidate);
    };
    pc.ontrack = (e) => onTrack(e.streams[0]);
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
      (stream) => { remoteVideoEl.srcObject = stream; }
    );
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    call = { callId, type, peerUserId: String(toUserId), peerUsername: toUsername, peerAvatar: toAvatar, pc, localStream, direction: 'outgoing' };

    showOverlay(`Calling ${toUsername}…`, type === 'video' ? 'Video call' : 'Voice call', toAvatar);
    localVideoEl.srcObject = type === 'video' ? localStream : null;
    localVideoEl.style.display = type === 'video' ? 'block' : 'none';
    cameraBtn.style.display = type === 'video' ? 'inline-flex' : 'none';

    socket.emit('call:invite', { toUserId, callId, type });

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
  }

  async function acceptIncoming() {
    if (!incomingInvite) return;
    const { callId, type, fromUserId, fromUsername, fromAvatar, pendingOfferData, pendingCandidates } = incomingInvite;
    incomingInvite = null;
    hideIncomingBanner();

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
      (stream) => { remoteVideoEl.srcObject = stream; }
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
        const answer = await call.pc.createAnswer();
        await call.pc.setLocalDescription(answer);
        socket.emit('call:signal', { toUserId: fromUserId, callId, data: { kind: 'answer', sdp: answer } });
      } else if (data.kind === 'answer') {
        await call.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        startTimer();
      } else if (data.kind === 'candidate') {
        await call.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      }
    } catch (err) {
      console.error('Call signal error:', err);
    }
  }

  function endCall(notifyPeer) {
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
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        socket.emit('roomcall:signal', { room, callId, toUserId: fromUserId, data: { kind: 'answer', sdp: answer } });
      } else if (data.kind === 'answer') {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.kind === 'candidate') {
        await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
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
  }

  /* -----------------------------------------------------------
     Wire the shared Accept/Decline banner to whichever kind of
     invite is currently pending (1:1 or room).
  ----------------------------------------------------------- */
  const originalAccept = acceptIncoming;
  function acceptWhicheverIncoming() {
    if (incomingInvite) { acceptIncoming(); return; }
    if (incomingRoomInvite) {
      const { room, roomName, callId, type } = incomingRoomInvite;
      incomingRoomInvite = null;
      hideIncomingBanner();
      joinRoomCall(room, roomName, callId, type);
    }
  }
  function declineWhicheverIncoming() {
    if (incomingInvite) { declineIncoming(); return; }
    if (incomingRoomInvite) {
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
    leaveRoomCall: () => leaveRoomCallLocally(true)
  };
})();
