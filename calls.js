/* ===========================
   REMIX-NEXUS — CALLS
   Self-contained: doesn't rely on anything from Chat.css, so it's safe
   to add without risking existing layout.
=========================== */

.call-btn{
    background:rgba(255,255,255,.08);
    border:none;
    border-radius:50%;
    width:36px;
    height:36px;
    display:inline-flex;
    align-items:center;
    justify-content:center;
    font-size:16px;
    cursor:pointer;
    color:inherit;
    transition:.15s;
    flex-shrink:0;
}

.call-btn:hover{ background:rgba(0,102,255,.35); }

.call-buttons{
    display:flex;
    gap:6px;
    align-items:center;
    margin-left:auto;
    margin-right:8px;
}

/* ---- Incoming call banner ---- */
.rn-incoming-call{
    position:fixed;
    top:14px;
    left:50%;
    transform:translate(-50%,-140%);
    width:92%;
    max-width:420px;
    background:#111726;
    border:1px solid rgba(255,255,255,.1);
    border-radius:16px;
    padding:12px 14px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    box-shadow:0 10px 30px rgba(0,0,0,.5);
    z-index:9999;
    transition:transform .25s ease;
}

.rn-incoming-call.active{ transform:translate(-50%,0); }

.rn-incoming-info{ display:flex; align-items:center; gap:10px; min-width:0; }

.rn-incoming-avatar{
    width:40px; height:40px; border-radius:50%;
    background:linear-gradient(135deg,#0066ff,#00b7ff);
    display:flex; align-items:center; justify-content:center;
    font-size:18px; flex-shrink:0;
}

.rn-incoming-info strong{ display:block; font-size:14px; }
.rn-incoming-sub{ display:block; font-size:12px; opacity:.7; }

.rn-incoming-actions{ display:flex; gap:8px; flex-shrink:0; }

.rn-incoming-accept, .rn-incoming-decline{
    width:38px; height:38px; border-radius:50%; border:none;
    font-size:16px; cursor:pointer; color:#fff;
}
.rn-incoming-accept{ background:#22c55e; }
.rn-incoming-decline{ background:#ef4444; }

/* ---- In-call overlay ---- */
.rn-call-overlay{
    position:fixed;
    inset:0;
    background:#0a0e17;
    display:none;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    z-index:10000;
}

.rn-call-overlay.active{ display:flex; }

.rn-remote-video{
    position:absolute;
    inset:0;
    width:100%;
    height:100%;
    object-fit:cover;
    background:#0a0e17;
}

.rn-local-video{
    position:absolute;
    bottom:110px;
    right:16px;
    width:110px;
    height:150px;
    border-radius:12px;
    object-fit:cover;
    border:2px solid rgba(255,255,255,.2);
    background:#000;
    display:none;
}

.rn-call-info{
    position:relative;
    z-index:1;
    text-align:center;
    color:#fff;
}

.rn-call-avatar{
    width:96px; height:96px; border-radius:50%;
    background:linear-gradient(135deg,#0066ff,#00b7ff);
    display:flex; align-items:center; justify-content:center;
    font-size:44px; margin:0 auto 14px;
}

.rn-call-subtitle{ opacity:.75; font-size:13px; margin-top:4px; }
.rn-call-timer{ opacity:.6; font-size:12px; margin-top:6px; }

.rn-call-controls{
    position:absolute;
    bottom:30px;
    display:flex;
    gap:18px;
    z-index:2;
}

.rn-call-btn{
    width:56px; height:56px; border-radius:50%;
    background:rgba(255,255,255,.12);
    border:none; color:#fff; font-size:22px; cursor:pointer;
}

.rn-call-btn.rn-hangup{ background:#ef4444; }

@media(max-width:480px){
    .call-btn{ width:32px; height:32px; font-size:14px; }
    .rn-local-video{ width:84px; height:114px; bottom:100px; }
}

/* ===========================
   GROUP CALL PARTICIPANT GRID
   WhatsApp-style mosaic: everyone in the call (including you) gets an
   equal-size tile that shows their own video or an avatar if their
   camera's off / it's a voice call. Only active for room + ad-hoc group
   calls — 1:1 calls keep the original fullscreen-remote + PiP-local look.
=========================== */
.rn-participants-grid{
    position:absolute;
    inset:0;
    display:none;
    gap:3px;
    padding:3px;
    z-index:1;
}

.rn-call-overlay.rn-group-mode .rn-participants-grid{ display:grid; }

/* The single-remote-video layout is only for 1:1 calls — hide it (and the
   center avatar/title) once the grid takes over. */
.rn-call-overlay.rn-group-mode .rn-remote-video,
.rn-call-overlay.rn-group-mode .rn-local-video,
.rn-call-overlay.rn-group-mode .rn-call-avatar,
.rn-call-overlay.rn-group-mode #rnCallTitle{ display:none !important; }

/* Subtitle ("N in call") + timer move to a small top bar instead of
   sitting centered over a video that no longer exists. */
.rn-call-overlay.rn-group-mode .rn-call-info{
    position:absolute;
    top:14px;
    left:50%;
    transform:translateX(-50%);
    z-index:3;
    text-align:center;
    pointer-events:none;
}

/* ---- Grid shape by participant count — same rough breakpoints WhatsApp
   uses: 1 fullscreen, 2 split, 3-4 quad, 5-6 six-pack, 7-9 nine-grid. ---- */
.rn-participants-grid[data-count="1"]{ grid-template-columns:1fr; grid-template-rows:1fr; }

.rn-participants-grid[data-count="2"]{ grid-template-columns:1fr; grid-template-rows:1fr 1fr; }
@media(min-width:700px){
    .rn-participants-grid[data-count="2"]{ grid-template-columns:1fr 1fr; grid-template-rows:1fr; }
}

.rn-participants-grid[data-count="3"],
.rn-participants-grid[data-count="4"]{
    grid-template-columns:1fr 1fr;
    grid-template-rows:1fr 1fr;
}

.rn-participants-grid[data-count="5"],
.rn-participants-grid[data-count="6"]{
    grid-template-columns:1fr 1fr;
    grid-template-rows:repeat(3,1fr);
}

.rn-participants-grid[data-count="7"],
.rn-participants-grid[data-count="8"],
.rn-participants-grid[data-count="9"]{
    grid-template-columns:1fr 1fr 1fr;
    grid-template-rows:repeat(3,1fr);
}

/* 10+ people (rare for a small-mesh call) — stop trying to fit an exact
   grid and let tiles wrap and shrink instead of dropping anyone. */
.rn-participants-grid[data-count="many"]{
    grid-template-columns:repeat(auto-fill,minmax(96px,1fr));
    grid-auto-rows:96px;
}

.rn-tile{
    position:relative;
    background:#141a29;
    border-radius:10px;
    overflow:hidden;
    display:flex;
    align-items:center;
    justify-content:center;
    min-width:0;
    min-height:0;
}

.rn-tile-video{
    width:100%;
    height:100%;
    object-fit:cover;
    background:#0a0e17;
}

.rn-tile-avatar{
    width:64px; height:64px; border-radius:50%;
    background:linear-gradient(135deg,#0066ff,#00b7ff);
    display:flex; align-items:center; justify-content:center;
    font-size:26px; color:#fff; flex-shrink:0;
}

/* Small tiles (6+ people) get a smaller avatar so it doesn't dominate. */
.rn-participants-grid[data-count="7"] .rn-tile-avatar,
.rn-participants-grid[data-count="8"] .rn-tile-avatar,
.rn-participants-grid[data-count="9"] .rn-tile-avatar,
.rn-participants-grid[data-count="many"] .rn-tile-avatar{
    width:40px; height:40px; font-size:18px;
}

.rn-tile-label{
    position:absolute;
    left:6px; bottom:6px;
    display:flex; align-items:center; gap:4px;
    background:rgba(0,0,0,.5);
    padding:3px 8px;
    border-radius:999px;
    font-size:11px;
    color:#fff;
    max-width:calc(100% - 12px);
}

.rn-tile-name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rn-tile-mic-off{ font-size:11px; flex-shrink:0; }
