/* RemixVerse — game.js
   Interface layer for the supplied RemixVerse engine. All game rules remain in engine.js. */
(function () {
  'use strict';
  const LL = window.LL;
  if (!LL || !LL.engine || !LL.data || !LL.storage) {
    document.getElementById('game-root').innerHTML = '<div class="card"><h2>Game files are missing</h2><p>Make sure storage.js, data.js, engine.js, fx.js, layout.js and game.js are loaded in that order.</p></div>';
    return;
  }
  const E = LL.engine, D = LL.data, S = LL.storage, F = LL.fx;
  const root = document.getElementById('game-root');
  let state = S.loadGame();
  let screen = 'life';
  let notice = '';
  let noticeType = '';
  let ended = S.loadEnded();
  const esc = F.esc;
  const money = E.fmtMoney;
  const cap = (n) => Math.max(0, Math.min(100, Math.round(n || 0)));
  const iconFor = (role) => ({mom:'👩',dad:'👨',partner:'💞',spouse:'💍',child:'🧒',pet:'🐾',friend:'🧑‍🤝‍🧑'}[role] || '👤');

  function save() { if (state && state.alive) S.saveGame(state); }
  function toast(message, type) { notice = message; noticeType = type || ''; }
  function notifyResult(result) {
    if (!result) return;
    if (!result.ok) { toast(result.error || 'That action could not be completed.', 'error'); return; }
    toast(result.text || (result.notes || []).map(n => n.text).join(' ') || 'Your choice has been recorded.', '');
    if (result.newAch && result.newAch.length) toast('Achievement unlocked: ' + result.newAch.map(id => (D.ACHIEVEMENTS.find(a => a.id === id) || {}).name || id).join(', '), 'good');
    if (result.died && state) { state.phase = 'dead'; E.finalize(state); ended = S.loadEnded(); }
    save();
  }
  function stat(name, value, kind) {
    const v = cap(value);
    return `<div><div class="stat-top"><span>${name}</span><strong>${v}/100</strong></div><div class="bar ${kind || ''}"><i style="width:${v}%"></i></div></div>`;
  }
  function stats() {
    return `<div class="stat-list">${stat('Health',state.health,'health')}${stat('Happiness',state.happiness,'happiness')}${stat('Intelligence',state.intelligence,'intelligence')}${stat('Reputation',state.reputation,'reputation')}</div>`;
  }
  function metric(label, value) { return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`; }
  function tabs() {
    return `<div class="tabs">
      <button class="tab ${screen==='life'?'active':''}" data-screen="life">✦ Life</button>
      <button class="tab ${screen==='activities'?'active':''}" data-screen="activities">⚡ Activities</button>
      <button class="tab ${screen==='people'?'active':''}" data-screen="people">♡ Relationships</button>
      <button class="tab ${screen==='career'?'active':''}" data-screen="career">⌁ Career</button>
      <button class="tab ${screen==='history'?'active':''}" data-screen="history">☷ Journal</button>
    </div>`;
  }
  function logHTML() {
    const items = (state.log || []).slice(-8).reverse();
    return items.length ? `<div class="log">${items.map(x=>`<div class="log-item"><i class="log-dot"></i><span><b>${esc(x.title || x.type || 'Life update')}</b><br>${esc(x.text || '')}</span></div>`).join('')}</div>` : '<div class="empty">Your story begins with your first choice.</div>';
  }
  function lifeScreen() {
    const ev = E.eventView(state);
    let main = '';
    if (!state.alive || state.phase === 'dead') return endedScreen();
    if (state.phase === 'event' && ev) {
      main = `<div class="event-card"><span class="eyebrow">A moment in your life</span><h2>${esc(ev.title)}</h2><p>${esc(ev.text)}</p></div><div class="choices">${ev.choices.map(ch=>`<button class="choice" data-choice="${ch.i}" ${ch.locked?'disabled':''}><span><strong>${esc(ch.label)}</strong>${ch.hint?`<small>${esc(ch.hint)}</small>`:''}</span><span class="arrow">›</span></button>`).join('')}</div><p class="small">Choose carefully. The effects can shape your health, relationships, education and future.</p>`;
    } else {
      const out = state.outcome || {};
      main = `<div class="event-card"><span class="eyebrow">Your decision</span><h2>${esc(out.choice || 'Year complete')}</h2><p>${esc(out.text || 'This year has been recorded. Age up when you are ready to continue.')}</p>${(out.notes||[]).map(n=>`<p class="small">${esc(n.text || '')}</p>`).join('')}</div><button class="btn primary" id="age-up">Celebrate birthday &amp; age up →</button><p class="small">Your energy restores at the start of each new year.</p>`;
    }
    return `<div class="grid">
      <section class="card span-8"><div class="eyebrow">Life in progress</div><h2>${esc(state.name)}'s story</h2><p class="muted">Born in ${esc(state.city)} · ${esc(state.stage)} · Age ${state.age}</p>
      <div class="metric-row">${metric('Age',state.age)}${metric('Money',money(state.money))}${metric('Energy',state.energy+'/2')}${metric('Education',(D.EDU_NAMES[state.edu]||D.EDU_NAMES[0]))}</div>${main}</section>
      <aside class="card span-4"><h3>Life indicators</h3>${stats()}<hr style="border:0;border-top:1px solid var(--line);margin:18px 0"><div class="stat-top"><span>Current stage</span><b>${esc(state.stage)}</b></div><div class="stat-top"><span>Career</span><b>${esc(state.job?E.jobTitle(state.job):'Not working')}</b></div><div class="stat-top"><span>Achievements</span><b>${state.achievements.length}</b></div></aside>
      <section class="card span-7"><h3>Recent memories</h3>${logHTML()}</section>
      <section class="card span-5"><h3>Build your legacy</h3><p class="muted">Each year adds to your life story. Balance your wellbeing, build relationships and discover a career.</p><div class="actions"><a class="btn" href="legacy.html">View legacy →</a><button class="btn" id="save-life">Save progress</button></div></section>
    </div>`;
  }
  function activitiesScreen() {
    const acts = D.ACTIVITIES || [];
    return `<div class="grid"><section class="card span-8"><div class="eyebrow">Spend energy wisely</div><h2>Activities</h2><p class="muted">Most activities use one energy point. Energy returns when you age up.</p>
      ${acts.map(a=>{let cost=typeof a.cost==='function'?a.cost(state):(a.cost||0);let locked=state.age<(a.min||0)||(a.req&&!a.req(state))||state.energy<1||(cost>0&&state.money<cost);return `<div class="job-card"><header><div><strong>${esc(a.name||a.title||a.id)}</strong><p>${esc(a.desc||a.description||a.text||'Try this activity and see how your life changes.')}</p></div><span class="pill">${cost?money(cost):'Free'}</span></header><div class="actions"><button class="btn" data-activity="${esc(a.id)}" ${locked?'disabled':''}>Do activity · 1 energy</button></div>${locked?'<p class="small">May require more age, money, energy or a condition to be met.</p>':''}</div>`}).join('')}</section><aside class="card span-4"><h3>Your resources</h3>${stats()}<p class="small">Energy: ${state.energy}/2 · Money: ${money(state.money)}</p><button class="btn" data-screen="life">Back to life</button></aside></div>`;
  }
  function peopleScreen() {
    const people = (state.people||[]).filter(p=>p.alive);
    return `<div class="grid"><section class="card span-8"><div class="eyebrow">People who shape your story</div><h2>Relationships</h2><p class="muted">Spend time together or give gifts to strengthen your bonds.</p>${people.length?people.map(p=>`<div class="person"><div class="avatar">${iconFor(p.role)}</div><div class="person-main"><strong>${esc(p.name)} <span class="pill">${esc(E.roleLabel(p))}</span></strong><div class="stat-top"><span>Bond</span><b>${cap(p.bond)}/100</b></div><div class="bar"><i style="width:${cap(p.bond)}%"></i></div><div class="person-actions"><button class="btn" data-person="${p.id}" data-action="time" ${state.energy<1?'disabled':''}>Spend time</button><button class="btn" data-person="${p.id}" data-action="gift" ${state.money<E.personActionInfo(state,p).gift?'disabled':''}>Gift · ${money(E.personActionInfo(state,p).gift)}</button>${E.personActionInfo(state,p).date?`<button class="btn" data-person="${p.id}" data-action="date" ${state.energy<1||state.money<E.personActionInfo(state,p).date?'disabled':''}>Date · ${money(E.personActionInfo(state,p).date)}</button>`:''}</div></div></div>`).join(''):'<div class="empty">You have not met anyone yet.</div>'}</section><aside class="card span-4"><h3>Relationship advice</h3><p class="muted">Strong bonds are built over time. You can spend time with family even when you have little money.</p><div class="notice">Energy used on relationships returns next year.</div><button class="btn" data-screen="life">Back to life</button></aside></div>`;
  }
  function careerScreen() {
    const eligible = E.eligibleJobs(state) || [];
    const job = state.job;
    return `<div class="grid"><section class="card span-8"><div class="eyebrow">Build a future</div><h2>Career &amp; education</h2>${job?`<div class="event-card"><span class="pill good">Currently employed</span><h3>${esc(E.jobTitle(job))}</h3><p>Salary: ${money(job.salary)} per year · Level ${job.level+1}</p><p class="muted">Experience: ${job.years||0} years</p><div class="actions"><button class="btn" data-career="promote" ${state.energy<1||job.level>=3?'disabled':''}>Ask for promotion</button><button class="btn danger" data-career="quit">Leave job</button></div></div>`:`<p class="muted">No current job. Apply to an available position when you meet its requirements.</p>`}
      <h3>Available positions</h3>${eligible.length?eligible.map(j=>`<div class="job-card"><header><div><strong>${esc(j.title)}</strong><p>Salary: ${money(j.salary)} · Tier ${j.tier+1}</p></div><button class="btn" data-job="${esc(j.id)}" ${state.energy<1?'disabled':''}>Apply</button></header></div>`).join(''):'<div class="empty">No jobs are available at this stage. Continue your education or age up.</div>'}
      <h3 style="margin-top:22px">Education</h3><p class="muted">${esc(D.EDU_NAMES[state.edu]||D.EDU_NAMES[0])}${E.student(state)?' · In education':''}</p><p class="small">Education options appear in life events when you meet the requirements.</p></section><aside class="card span-4"><h3>Career strategy</h3><p class="muted">Education can unlock better-paying work. Applying and asking for a promotion uses energy, so plan your year.</p>${stats()}<p class="small">Energy: ${state.energy}/2</p></aside></div>`;
  }
  function historyScreen() {
    const history=(state.log||[]).slice().reverse();
    return `<div class="grid"><section class="card span-8"><div class="eyebrow">A record of your journey</div><h2>Life journal</h2>${history.length?`<div class="log">${history.map(x=>`<div class="log-item"><i class="log-dot"></i><span><b>${esc(x.title||x.type||'Memory')}</b><br>${esc(x.text||'')}</span></div>`).join('')}</div>`:'<div class="empty">Your memories will appear here as you live.</div>'}</section><aside class="card span-4"><h3>Life overview</h3>${metric('Years lived',state.age)}${metric('Score',E.score(state))}${metric('People',state.people.filter(p=>p.alive).length)}<div class="actions"><button class="btn" data-screen="life">Back to life</button></div></aside></div>`;
  }
  function endedScreen() {
    const sum = state.summary || E.finalize(state);
    return `<div class="grid"><section class="card span-12 life-ended"><div class="eyebrow">Life complete</div><h1>${esc(state.name)}'s legacy</h1><p class="muted">You lived for ${sum.years} years in ${esc(state.city)}.</p><div class="rank gradient-text">${esc(sum.rank)}</div><p>${esc(sum.epitaph)}</p><div class="metric-row" style="text-align:left;margin:24px 0">${metric('Score',sum.score)}${metric('Years lived',sum.years)}${metric('Children',sum.children)}${metric('Peak wealth',money(sum.peakMoney))}</div><div class="actions" style="justify-content:center"><button class="btn primary" id="new-life">Begin another life →</button><a class="btn" href="legacy.html">View all legacies</a></div></section></div>`;
  }
  function render() {
    if (!state) {
      root.innerHTML = `<div class="grid"><section class="card span-8"><div class="eyebrow">Your story starts here</div><h1>Live a thousand different lives.</h1><p class="muted">Every decision opens a new possibility. Grow up, find your people, build a career and leave a legacy.</p><div class="form-row"><input id="life-name" maxlength="30" placeholder="Choose a name (optional)" aria-label="Character name"><select id="life-gift" aria-label="Starting talent"><option value="brains">Curious mind · intelligence</option><option value="heart">People person · happiness & reputation</option><option value="health">Strong constitution · health</option></select><button class="btn primary" id="start-life">Start a new life →</button></div><div class="notice">Your progress is saved locally in this browser. No account or external connection is required.</div></section><aside class="card span-4"><h2>RemixVerse</h2><p class="muted">A life simulation created for the Remix Nexus community.</p><div class="metric-row">${metric('Life stages','6')}${metric('Choices','Hundreds')}</div><p class="small">Your previous life can be reviewed on the Legacy page.</p></aside></div>`;
      return;
    }
    const title = `<section class="hero"><div class="eyebrow">Remix Nexus presents</div><h1><span class="gradient-text">RemixVerse</span></h1><p>Shape your life one year at a time. Your choices influence your wellbeing, career, relationships and final legacy.</p><div class="actions"><span class="pill">${esc(state.stage)}</span><span class="pill">Age ${state.age}</span><span class="pill">${money(state.money)}</span><span class="pill ${state.energy===0?'warn':'good'}">${state.energy}/2 energy</span></div></section>`;
    root.innerHTML = title + `<section class="card" style="margin-top:16px">${tabs()}${notice?`<div class="notice ${noticeType==='error'?'error':''}">${esc(notice)}</div>`:''}${screen==='life'?lifeScreen():screen==='activities'?activitiesScreen():screen==='people'?peopleScreen():screen==='career'?careerScreen():historyScreen()}</section><p class="footer-note">RemixVerse · An original life simulation for Remix Nexus · Saved in this browser only.</p>`;
  }
  root.addEventListener('click', function (e) {
    const b=e.target.closest('button'); if(!b)return;
    if (b.dataset.screen) {screen=b.dataset.screen;notice='';render();return;}
    if (b.id==='start-life') {const name=(document.getElementById('life-name').value||'').trim();const gift=document.getElementById('life-gift').value;state=E.newLife({name,gift});ended=null;S.clearEnded();screen='life';notice='A new life begins. Make your first choice.';save();render();return;}
    if (b.id==='new-life') {state=null;screen='life';notice='';S.clearEnded();render();return;}
    if (b.id==='save-life') {save();toast('Progress saved in this browser.');render();return;}
    if (b.dataset.choice!==undefined) {notifyResult(E.choose(state,Number(b.dataset.choice)));if(state&&!state.alive){E.finalize(state);ended=S.loadEnded();}render();return;}
    if (b.id==='age-up') {notifyResult(E.ageUp(state));if(state&&!state.alive){E.finalize(state);ended=S.loadEnded();}render();return;}
    if (b.dataset.activity) {notifyResult(E.doActivity(state,b.dataset.activity));render();return;}
    if (b.dataset.person && b.dataset.action) {notifyResult(E.personAction(state,Number(b.dataset.person),b.dataset.action));render();return;}
    if (b.dataset.career) {notifyResult(E.careerAction(state,b.dataset.career));render();return;}
    if (b.dataset.job) {notifyResult(E.careerAction(state,'apply',b.dataset.job));render();return;}
  });
  if (state && (!state.alive || state.phase==='dead')) { E.finalize(state); ended=S.loadEnded(); }
  render();
})();
