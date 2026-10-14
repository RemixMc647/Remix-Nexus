/* RemixVerse — engine.js
   The rules of the game. No DOM code in here: it only changes the state object
   and returns results for the interface (game.js) to show. */

(function () {
  'use strict';

  const LL = (window.LL = window.LL || {});
  const D = () => LL.data;

  const MONEY_FLOOR = -50000;
  const FX_KEYS = { h: 'health', p: 'happiness', i: 'intelligence', r: 'reputation', m: 'money' };

  /* ---------- helpers ---------- */

  const clamp = (v, lo, hi) => Math.max(lo === undefined ? 0 : lo, Math.min(hi === undefined ? 100 : hi, v));
  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const chance = p => Math.random() < p;
  const err = msg => ({ ok: false, error: msg });

  function resolveW(w, s) {
    if (typeof w === 'function') return Math.max(0, w(s));
    return w === undefined || w === null ? 1 : w;
  }

  function weighted(items, getW) {
    let total = 0;
    const ws = items.map(function (it) {
      const w = getW(it);
      total += w;
      return w;
    });
    if (total <= 0) return items[0];
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= ws[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function fmtMoney(n) {
    const sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }

  function stageFor(age) {
    const st = D().STAGES;
    for (let i = st.length - 1; i >= 0; i--) {
      if (age >= st[i].from) return st[i];
    }
    return st[0];
  }

  /* ---------- people ---------- */

  function addPerson(s, role, opts) {
    const d = D();
    const o = opts || {};
    const pool = role === 'mom' ? d.NAMES_F : role === 'dad' ? d.NAMES_M : role === 'pet' ? d.PET_NAMES : d.NAMES_ALL;
    const used = {};
    s.people.forEach(function (p) { used[p.name] = true; });
    used[s.name] = true;

    let name = o.name;
    if (!name) {
      const avail = pool.filter(function (n) { return !used[n]; });
      name = pick(avail.length ? avail : pool);
    }

    const p = {
      id: s.pid++,
      role: role,
      name: name,
      kind: o.kind || '',
      age: o.age !== undefined ? o.age : s.age,
      bond: o.bond !== undefined ? o.bond : rnd(45, 65),
      alive: true,
      gone: ''
    };
    s.people.push(p);
    s.lastAdded = { name: p.name, role: role };
    return p;
  }

  function getPerson(s, role) {
    return s.people.find(function (p) { return p.role === role && p.alive; });
  }

  function anyPerson(s, role) {
    return getPerson(s, role) || s.people.filter(function (p) { return p.role === role; }).pop();
  }

  function bondDelta(s, role, d) {
    const p = getPerson(s, role);
    if (p) p.bond = clamp(p.bond + (d > 0 ? soften(p.bond, d) : d));
  }

  function endPerson(s, role, why, notes) {
    const p = getPerson(s, role);
    if (!p) return;
    p.alive = false;
    p.gone = why;
    if (notes) notes.push({ t: 'bad', text: p.name + ' (' + roleLabel(p).toLowerCase() + ') ' + why });
  }

  function roleLabel(p) {
    const labels = { mom: 'Mom', dad: 'Dad', friend: 'Friend', partner: 'Partner', spouse: 'Spouse', child: 'Child' };
    if (p.role === 'pet') return p.kind || 'Pet';
    return labels[p.role] || p.role;
  }

  /* ---------- text ---------- */

  function fill(text, s) {
    if (!text) return '';
    return String(text).replace(/\{(\w+)\}/g, function (m, key) {
      let p;
      switch (key) {
        case 'name': return s.name;
        case 'city': return s.city;
        case 'mom': p = anyPerson(s, 'mom'); return p ? p.name : 'Mom';
        case 'dad': p = anyPerson(s, 'dad'); return p ? p.name : 'Dad';
        case 'friend': p = getPerson(s, 'friend') || addPerson(s, 'friend'); return p.name;
        case 'partner': p = getPerson(s, 'spouse') || getPerson(s, 'partner'); return p ? p.name : 'your partner';
        case 'kid': p = getPerson(s, 'child'); return p ? p.name : 'your child';
        case 'pet': p = getPerson(s, 'pet'); return p ? p.name : 'your pet';
        case 'job': return s.job ? jobTitle(s.job).toLowerCase() : 'work';
        case 'new': return s.lastAdded ? s.lastAdded.name : 'someone';
        case 'hobby': return D().HOBBY_NAMES[s.flags.hobby] || 'your hobby';
        default: return m;
      }
    });
  }

  function addLog(s, type, text) {
    s.log.push({ age: s.age, type: type, text: text });
    if (s.log.length > 300) s.log.shift();
  }

  /* ---------- jobs ---------- */

  function jobTitle(job) {
    if (job.teen || job.consultant) return job.title;
    return D().LEVEL_NAMES[job.level] + job.title;
  }

  function startJob(s, tier, notes) {
    const d = D();
    let list;
    if (tier === 'teen') list = d.TEEN_JOBS;
    else {
      const t = tier === 'best' ? s.edu : Math.min(tier, s.edu);
      list = d.JOBS.filter(function (j) { return j.tier === t; });
    }
    if (!list.length) return;
    const j = pick(list);
    s.job = { id: j.id, title: j.title, tier: j.tier, level: 0, salary: j.salary, years: 0, teen: !!j.teen };
    if (notes) notes.push({ t: 'good', text: 'New job: ' + jobTitle(s.job) });
    addLog(s, 'win', 'Started work as ' + jobTitle(s.job) + '.');
  }

  function tryPromote(s, notes) {
    const j = s.job;
    if (!j || j.teen || j.consultant || j.level >= 3) return false;
    const odds = clamp(0.2 + s.intelligence * 0.003 + s.reputation * 0.003 + Math.min(j.years, 8) * 0.02 + (s.happiness > 60 ? 0.04 : 0), 0.1, 0.85);
    if (chance(odds)) {
      j.level += 1;
      j.salary = Math.round(j.salary * 1.3);
      s.promoWait = 3;
      if (j.level >= 3) s.flags.topLevel = true;
      notes.push({ t: 'good', text: 'Promoted to ' + jobTitle(j) });
      addLog(s, 'win', 'Promoted to ' + jobTitle(j) + '.');
      return 'win';
    }
    s.promoWait = 2;
    notes.push({ t: 'bad', text: 'No promotion this time' });
    return 'lose';
  }

  function retire(s, mode, notes) {
    const base = s.job ? s.job.salary : 12000;
    s.flags.pension = Math.round(Math.max(7000, base * 0.45));
    s.flags.retired = true;
    if (mode === 'consult') {
      s.job = { id: 'consult', title: 'Consultant', tier: 3, level: 0, salary: 14000, years: 0, consultant: true };
      notes.push({ t: 'good', text: 'Now consulting part-time' });
    } else {
      s.job = null;
      notes.push({ t: 'good', text: 'Retired with a pension of ' + fmtMoney(s.flags.pension) + ' a year' });
    }
    addLog(s, 'milestone', 'Retired from full-time work.');
  }

  function eligibleJobs(s) {
    const d = D();
    if (s.age < 15 || s.flags.retired || student(s)) return [];
    if (s.age < 18) return d.TEEN_JOBS.filter(function (j) { return !s.job || s.job.id !== j.id; });
    const hi = s.edu;
    const lo = Math.max(0, s.edu - 1);
    return d.JOBS.filter(function (j) {
      return j.tier >= lo && j.tier <= hi && (!s.job || s.job.id !== j.id);
    }).sort(function (a, b) { return b.salary - a.salary; });
  }

  function student(s) {
    return !!(s.flags.uni || s.flags.trade);
  }

  function applyOdds(s, j) {
    if (j.teen) return 0.85;
    return clamp(0.32 + s.intelligence * 0.004 + s.reputation * 0.003 - j.tier * 0.03, 0.15, 0.92);
  }

  /* ---------- state ---------- */

  function newLife(opts) {
    const d = D();
    const o = opts || {};
    const family = weighted([0, 1, 2], function (n) { return [30, 50, 20][n]; });

    const s = {
      v: 1,
      id: Date.now(),
      name: (o.name || '').trim() || pick(d.NAMES_ALL),
      city: pick(d.CITIES),
      gift: o.gift || 'brains',
      family: family,
      age: 0,
      stage: 'Baby',
      money: 0,
      health: rnd(78, 98),
      happiness: rnd(70, 90),
      intelligence: rnd(38, 62),
      reputation: rnd(40, 58),
      energy: 2,
      phase: 'event',
      eventId: null,
      quiet: '',
      outcome: null,
      job: null,
      edu: 0,
      flags: {},
      seen: {},
      people: [],
      log: [],
      history: [],
      peak: { money: 0, intelligence: 0, reputation: 0, happiness: 0, health: 0 },
      happySum: 0,
      years: 0,
      achievements: [],
      alive: true,
      cause: '',
      recorded: false,
      lastYear: null,
      promoWait: 0,
      pid: 1,
      lastAdded: null
    };

    if (s.gift === 'brains') s.intelligence = clamp(s.intelligence + 12);
    else if (s.gift === 'heart') {
      s.happiness = clamp(s.happiness + 8);
      s.reputation = clamp(s.reputation + 10);
    } else {
      s.health = clamp(s.health + 12);
      s.happiness = clamp(s.happiness + 4);
    }

    addPerson(s, 'mom', { age: rnd(22, 36), bond: 70 });
    addPerson(s, 'dad', { age: rnd(24, 40), bond: 65 });

    addLog(s, 'milestone', 'Born in ' + s.city + ', into ' + d.FAMILY_TEXT[s.family] + '.');
    selectEvent(s);
    trackPeaks(s);
    snapshot(s);
    return s;
  }

  function snapshot(s) {
    s.history.push([s.age, s.health, s.happiness, s.intelligence, s.reputation, s.money]);
    if (s.history.length > 125) s.history.shift();
  }

  function trackPeaks(s) {
    s.peak.money = Math.max(s.peak.money, s.money);
    s.peak.intelligence = Math.max(s.peak.intelligence, s.intelligence);
    s.peak.reputation = Math.max(s.peak.reputation, s.reputation);
    s.peak.happiness = Math.max(s.peak.happiness, s.happiness);
    s.peak.health = Math.max(s.peak.health, s.health);
    if (s.health <= 10) s.flags.nearDeath = true;
    if (s.flags.nearDeath && s.health >= 60) s.flags.comeback = true;
  }

  /* ---------- events ---------- */

  function eligible(ev, s) {
    if (ev.id === 'quiet') return false;
    if (s.age < ev.min || s.age > ev.max) return false;
    if (ev.once && s.seen[ev.id] !== undefined) return false;
    if (ev.cool && s.seen[ev.id] !== undefined && s.age - s.seen[ev.id] < ev.cool) return false;
    if (ev.cond && !ev.cond(s)) return false;
    return true;
  }

  function selectEvent(s) {
    const list = D().EVENTS.filter(function (ev) { return eligible(ev, s); });
    const forced = list.filter(function (ev) { return ev.force; }).sort(function (a, b) { return b.force - a.force; });

    let ev = null;
    if (forced.length) ev = forced[0];
    else if (list.length && !chance(0.1)) {
      ev = weighted(list, function (e) { return e.w === undefined ? 10 : resolveW(e.w, s); });
    }

    if (!ev) {
      ev = D().EVENT_MAP.quiet;
      s.quiet = pick(D().QUIET_TEXTS);
    }

    s.eventId = ev.id;
    s.phase = 'event';
    s.outcome = null;
  }

  function eventView(s) {
    const ev = D().EVENT_MAP[s.eventId];
    if (!ev) return null;
    const rawText = ev.id === 'quiet' ? s.quiet : (typeof ev.text === 'function' ? ev.text(s) : ev.text);
    return {
      id: ev.id,
      title: fill(ev.title, s),
      text: fill(rawText, s),
      choices: ev.choices.map(function (ch, i) {
        const locked = ch.req ? !ch.req(s) : false;
        return {
          i: i,
          label: fill(ch.label, s),
          hint: locked ? (ch.reqText || 'Not available') : (ch.hint || ''),
          locked: locked
        };
      })
    };
  }

  /* ---------- applying effects ---------- */

  /* gains get harder near the top, so maxing a stat takes real effort */
  function soften(current, gain) {
    if (current >= 90) return Math.max(1, Math.ceil(gain / 3));
    if (current >= 80) return Math.max(1, Math.ceil(gain / 2));
    return gain;
  }

  function applyFx(s, fx, deltas) {
    Object.keys(fx).forEach(function (k) {
      const key = FX_KEYS[k] || k;
      let v = fx[k];
      if (typeof v === 'function') v = v(s);
      v = Math.round(v);
      const before = s[key];
      if (key !== 'money' && v > 0) v = soften(before, v);
      s[key] = key === 'money' ? Math.max(MONEY_FLOOR, before + v) : clamp(before + v);
      deltas[key] = (deltas[key] || 0) + (s[key] - before);
    });
  }

  function applyOutcome(s, out) {
    const deltas = {};
    const notes = [];

    applyFx(s, out.fx || {}, deltas);

    if (out.flags) Object.keys(out.flags).forEach(function (k) { s.flags[k] = out.flags[k]; });
    if (out.inc) Object.keys(out.inc).forEach(function (k) { s.flags[k] = (s.flags[k] || 0) + out.inc[k]; });

    if (out.edu !== undefined && out.edu > s.edu) {
      s.edu = out.edu;
      notes.push({ t: 'good', text: 'Education: ' + D().EDU_NAMES[s.edu] });
    }

    if (out.add) {
      [].concat(out.add).forEach(function (a) {
        const p = addPerson(s, a.role, a);
        notes.push({ t: 'good', text: 'New ' + roleLabel(p).toLowerCase() + ': ' + p.name });
      });
    }

    if (out.upgrade) {
      const p = getPerson(s, out.upgrade.from);
      if (p) {
        p.role = out.upgrade.to;
        notes.push({ t: 'good', text: p.name + ' is now your ' + roleLabel(p).toLowerCase() });
        addLog(s, 'win', 'You and ' + p.name + ' got married.');
      }
    }

    if (out.bond) Object.keys(out.bond).forEach(function (role) { bondDelta(s, role, out.bond[role]); });
    if (out.end) {
      endPerson(s, out.end.role, out.end.why, notes);
      if (out.end.role === 'spouse') addLog(s, 'loss', 'Your marriage ended.');
    }

    if (out.job === 'quit') {
      if (s.job) notes.push({ t: 'info', text: 'You left ' + jobTitle(s.job) });
      s.job = null;
    } else if (out.job !== undefined) {
      startJob(s, out.job, notes);
    }

    let promoted = null;
    if (out.promote) promoted = tryPromote(s, notes);

    if (out.retire) retire(s, out.retire, notes);
    if (out.fn) out.fn(s, notes);

    let text = fill(out.text, s);
    if (promoted === 'win') text += ' It pays off. You get the promotion.';
    if (promoted === 'lose') text += ' Unfortunately, the answer is not yet.';

    return { text: text, deltas: deltas, notes: notes, die: out.die || '' };
  }

  function finish(s, res) {
    if (res.die) die(s, res.die);
    trackPeaks(s);
    const newAch = checkAchievements(s);
    return {
      ok: true,
      text: res.text,
      deltas: res.deltas,
      notes: res.notes,
      died: !s.alive,
      cause: s.cause,
      newAch: newAch
    };
  }

  function choose(s, idx) {
    if (!s.alive) return err('This life is over.');
    if (s.phase !== 'event') return err('Age up first.');
    const ev = D().EVENT_MAP[s.eventId];
    const ch = ev && ev.choices[idx];
    if (!ch) return err('That choice does not exist.');
    if (ch.req && !ch.req(s)) return err(ch.reqText || 'You cannot choose that right now.');

    const out = weighted(ch.out, function (x) { return resolveW(x.w, s); });
    const res = applyOutcome(s, out);

    s.seen[ev.id] = s.age;
    s.phase = 'outcome';
    s.outcome = { choice: fill(ch.label, s), text: res.text, deltas: res.deltas, notes: res.notes };

    addLog(s, 'event', res.text);
    const result = finish(s, res);
    if (!s.alive) {
      s.phase = 'dead';
      s.outcome = { choice: fill(ch.label, s), text: res.text, deltas: res.deltas, notes: res.notes };
    }
    return result;
  }

  /* ---------- economy ---------- */

  function moneyFlow(s) {
    const age = s.age;
    let gross = 0;
    if (s.job) gross += s.job.salary;
    if (s.flags.pension) gross += s.flags.pension;

    let tax = 0;
    if (s.job && age >= 18) tax = Math.round(s.job.salary * (s.job.salary > 50000 ? 0.25 : 0.12));

    let living = 0;
    if (age >= 18) {
      if (student(s)) living = Math.max(2500, 7000 - s.family * 2000);
      else if (s.flags.withFamily) living = 5000;
      else if (s.flags.house) living = 15000 + Math.min(10000, Math.max(0, age - 30) * 300);
      else living = 25000 + Math.min(14000, Math.max(0, age - 25) * 450);
      if (s.flags.retired && !s.flags.house) living = Math.min(living, 22000);
      const kids = s.people.filter(function (p) { return p.role === 'child' && p.alive && p.age < 18; }).length;
      living += kids * 7000;
    }

    const interest = s.money < 0 ? Math.round(-s.money * 0.07) : 0;
    const expenses = living + interest;
    return { gross: gross, tax: tax, income: gross - tax, expenses: expenses, net: gross - tax - expenses };
  }

  /* ---------- the yearly tick ---------- */

  function tickPeople(s, notes, yd) {
    s.people.forEach(function (p) {
      if (!p.alive) return;
      p.age += 1;

      let decay;
      if (p.role === 'pet') decay = rnd(0, 2);
      else if (p.role === 'mom' || p.role === 'dad' || p.role === 'child' || p.role === 'spouse') decay = rnd(0, 2);
      else decay = rnd(0, 3);
      p.bond = clamp(p.bond - decay);

      let pd;
      if (p.role === 'pet') pd = p.age >= 11 ? (p.age - 10) * 0.07 : 0.004;
      else pd = p.age < 60 ? 0.001 : Math.min(0.4, Math.pow((p.age - 55) / 50, 3) * 0.6);

      if (chance(pd)) {
        p.alive = false;
        p.gone = 'passed away';
        const hit = Math.round(5 + p.bond * 0.15) + (p.role === 'spouse' ? 10 : 0);
        applyFx(s, { p: -hit }, yd);
        const txt = p.name + ', your ' + roleLabel(p).toLowerCase() + ', passed away.';
        notes.push({ t: 'bad', text: txt });
        addLog(s, 'loss', txt);
        return;
      }

      if ((p.role === 'friend' || p.role === 'partner') && p.bond <= 4 && chance(0.5)) {
        p.alive = false;
        p.gone = p.role === 'partner' ? 'drifted apart' : 'drifted apart';
        const txt2 = 'You and ' + p.name + ' drifted apart.';
        notes.push({ t: 'bad', text: txt2 });
        addLog(s, 'loss', txt2);
      }
    });

    const sp = getPerson(s, 'spouse');
    if (sp) s.flags.troubled = sp.bond < 25;
  }

  function drift(s, yd) {
    const a = s.age;
    let h;
    if (a >= 80) h = -rnd(2, 5);
    else if (a >= 60) h = -rnd(1, 3);
    else if (a >= 40) h = -rnd(0, 2);
    else if (a >= 18) h = rnd(-1, 1);
    else h = rnd(0, 2);
    if (s.health < 40 && a < 60) h += 1;

    let p = Math.round((65 - s.happiness) * 0.15) + rnd(-3, 2);
    if (s.money < 0) p -= 3;
    if (!s.job && a >= 18 && a < 65 && !student(s) && s.money < 3000) p -= 2;
    const bonds = s.people.filter(function (x) { return x.alive && x.role !== 'pet'; });
    if (bonds.length) {
      const avg = bonds.reduce(function (t, x) { return t + x.bond; }, 0) / bonds.length;
      p += Math.round((avg - 50) * 0.04);
    }

    let r = s.reputation > 55 ? -rnd(0, 2) : rnd(-1, 1);
    let i = a >= 60 ? -rnd(0, 2) : (a < 25 ? rnd(0, 1) : 0);
    /* staying at the top takes effort */
    if (s.reputation > 85) r -= rnd(1, 3);
    if (s.intelligence > 82) i -= rnd(1, 3);

    applyFx(s, { h: h, p: p, r: r, i: i }, yd);
  }

  function deathChance(s) {
    const a = s.age;
    const base = a < 1 ? 0.002 : a < 40 ? 0.0004 : Math.min(0.9, 0.9 * Math.pow(a / 105, 9) + 0.0009);
    let mult = 1;
    if (s.health < 50) mult += (50 - s.health) / 25;
    else if (s.health > 80) mult *= 0.8;
    let extra = 0;
    if (s.health <= 5) extra += 0.1;
    else if (s.health <= 15) extra += 0.02;
    return Math.min(0.95, base * mult + extra);
  }

  function causeFor(s) {
    const a = s.age;
    if (s.health <= 10 && a < 70) return pick(['a long illness', 'complications from poor health', 'heart failure']);
    if (a < 18) return pick(['a sudden illness', 'a rare childhood illness']);
    if (a < 50) return pick(['an unexpected illness', 'a heart condition nobody saw coming', 'a freak accident']);
    if (a < 75) return pick(['heart failure', 'a stroke', 'complications from illness']);
    return pick(['natural causes', 'old age', 'a peaceful passing at home', 'natural causes, in their sleep']);
  }

  function die(s, cause) {
    s.alive = false;
    s.cause = cause;
    s.phase = 'dead';
    addLog(s, 'milestone', 'Passed away at ' + s.age + ' from ' + cause + '.');
  }

  function ageUp(s) {
    if (!s.alive) return err('This life is over.');
    if (s.phase !== 'outcome') return err('Make a choice first.');

    const start = { health: s.health, happiness: s.happiness, intelligence: s.intelligence, reputation: s.reputation, money: s.money };
    const notes = [];
    const yd = {};

    s.age += 1;
    s.years += 1;
    s.stage = stageFor(s.age).name;
    s.energy = 2;
    s.outcome = null;
    if (s.promoWait > 0) s.promoWait -= 1;

    const milestone = D().MILESTONES[s.age] || null;
    if (milestone) addLog(s, 'milestone', 'Turned ' + s.age + '. ' + milestone + '.');

    if (s.age === 18) s.flags.withFamily = true;
    if (s.age >= 27 && s.flags.withFamily && !student(s)) {
      delete s.flags.withFamily;
      notes.push({ t: 'info', text: 'You moved into your own place' });
    }

    if (s.flags.uni) {
      s.flags.uni -= 1;
      if (s.flags.uni <= 0) {
        delete s.flags.uni;
        s.edu = Math.max(s.edu, 3);
        notes.push({ t: 'good', text: 'You graduated with a degree' });
        addLog(s, 'win', 'Graduated from university.');
      }
    }
    if (s.flags.trade) {
      s.flags.trade -= 1;
      if (s.flags.trade <= 0) {
        delete s.flags.trade;
        s.edu = Math.max(s.edu, 2);
        notes.push({ t: 'good', text: 'You earned your trade certificate' });
        addLog(s, 'win', 'Earned a trade certificate.');
      }
    }

    if (s.job) {
      s.job.years += 1;
      s.job.salary = Math.round(s.job.salary * 1.01);
      if (s.age === 18 && s.job.teen) {
        notes.push({ t: 'info', text: 'Your teenage job ended. Time to find a proper one' });
        s.job = null;
      }
    }

    if (s.age >= 75 && s.job && !s.flags.retired) {
      retire(s, 'full', notes);
    }

    const flow = moneyFlow(s);
    s.money = Math.max(MONEY_FLOOR, s.money + flow.net);
    s.lastYear = { income: flow.income, expenses: flow.expenses, net: flow.net };

    tickPeople(s, notes, yd);
    drift(s, yd);

    s.happySum += s.happiness;
    trackPeaks(s);

    if (chance(deathChance(s))) die(s, causeFor(s));
    else selectEvent(s);

    snapshot(s);
    const newAch = checkAchievements(s);

    return {
      ok: true,
      age: s.age,
      died: !s.alive,
      cause: s.cause,
      notes: notes,
      eco: s.lastYear,
      milestone: milestone,
      newAch: newAch,
      deltas: {
        health: s.health - start.health,
        happiness: s.happiness - start.happiness,
        intelligence: s.intelligence - start.intelligence,
        reputation: s.reputation - start.reputation,
        money: s.money - start.money
      }
    };
  }

  /* ---------- actions ---------- */

  function doActivity(s, id) {
    if (!s.alive) return err('This life is over.');
    const a = D().ACTIVITIES.find(function (x) { return x.id === id; });
    if (!a) return err('Unknown activity.');
    if (s.age < (a.min || 0)) return err('You are too young for that.');
    if (a.req && !a.req(s)) return err(a.reqText || 'Not available right now.');
    const cost = typeof a.cost === 'function' ? a.cost(s) : (a.cost || 0);
    if (cost > 0 && s.money < cost) return err('You need ' + fmtMoney(cost) + ' for that.');
    if (s.energy < 1) return err('No energy left this year. Age up to recharge.');

    s.energy -= 1;
    const out = weighted(a.out, function (x) { return resolveW(x.w, s); });
    const res = applyOutcome(s, out);
    if (cost > 0) {
      s.money -= cost;
      res.deltas.money = (res.deltas.money || 0) - cost;
    }
    return finish(s, res);
  }

  function personActionInfo(s, p) {
    const family = p.role === 'child' ? 25 : p.role === 'pet' ? 20 : 40;
    const info = { gift: family, date: 0 };
    if (p.role === 'partner' || p.role === 'spouse') info.date = 80;
    return info;
  }

  function personAction(s, pid, act) {
    if (!s.alive) return err('This life is over.');
    const p = s.people.find(function (x) { return x.id === pid; });
    if (!p || !p.alive) return err('That person is not here any more.');
    const info = personActionInfo(s, p);
    const deltas = {};
    let text;

    if (act === 'time') {
      if (s.energy < 1) return err('No energy left this year. Age up to recharge.');
      s.energy -= 1;
      const gain = rnd(7, 12);
      p.bond = clamp(p.bond + soften(p.bond, gain));
      applyFx(s, { p: rnd(1, 4) }, deltas);
      const lines = p.role === 'pet'
        ? ['You and ' + p.name + ' spend the afternoon outside.', p.name + ' falls asleep on your feet while you read.']
        : ['You spend a slow afternoon with ' + p.name + '.', 'You and ' + p.name + ' talk for hours about nothing important.', 'You and ' + p.name + ' cook something together and eat way too much.'];
      text = pick(lines);
    } else if (act === 'gift') {
      if (s.money < info.gift) return err('You need ' + fmtMoney(info.gift) + ' for that.');
      s.money -= info.gift;
      deltas.money = -info.gift;
      p.bond = clamp(p.bond + soften(p.bond, rnd(5, 9)));
      applyFx(s, { p: 1 }, deltas);
      text = p.name + ' loves the gift. The smile is worth more than the money.';
    } else if (act === 'date') {
      if (!info.date) return err('Not an option.');
      if (s.energy < 1) return err('No energy left this year. Age up to recharge.');
      if (s.money < info.date) return err('You need ' + fmtMoney(info.date) + ' for that.');
      s.energy -= 1;
      s.money -= info.date;
      deltas.money = -info.date;
      p.bond = clamp(p.bond + soften(p.bond, rnd(10, 14)));
      applyFx(s, { p: 4 }, deltas);
      text = 'A proper date night with ' + p.name + '. Candles, laughter, and a great dessert.';
    } else {
      return err('Unknown action.');
    }

    trackPeaks(s);
    return { ok: true, text: text, deltas: deltas, notes: [], died: false, newAch: checkAchievements(s) };
  }

  function careerAction(s, act, jobId) {
    if (!s.alive) return err('This life is over.');
    const notes = [];
    const deltas = {};
    let text = '';

    if (act === 'apply') {
      const j = D().ALL_JOBS.find(function (x) { return x.id === jobId; });
      if (!j || !eligibleJobs(s).some(function (x) { return x.id === j.id; })) return err('That job is not available to you.');
      if (s.energy < 1) return err('No energy left this year. Age up to recharge.');
      s.energy -= 1;
      if (chance(applyOdds(s, j))) {
        const salary = j.salary;
        s.job = { id: j.id, title: j.title, tier: j.tier, level: 0, salary: salary, years: 0, teen: !!j.teen };
        notes.push({ t: 'good', text: 'Hired as ' + jobTitle(s.job) });
        applyFx(s, { p: 5, r: 1 }, deltas);
        addLog(s, 'win', 'Hired as ' + jobTitle(s.job) + '.');
        text = 'The interview goes well, and a few days later the call comes in. You start as ' + jobTitle(s.job) + '.';
      } else {
        applyFx(s, { p: -3 }, deltas);
        text = 'The interview for ' + j.title + ' does not go your way. They say they will keep your CV on file.';
        notes.push({ t: 'bad', text: 'Application rejected' });
      }
    } else if (act === 'promote') {
      if (!s.job || s.job.teen || s.job.consultant) return err('There is nothing to be promoted in.');
      if (s.job.level >= 3) return err('You are already at the top.');
      if (s.promoWait > 0) return err('Wait ' + s.promoWait + ' more year' + (s.promoWait > 1 ? 's' : '') + ' before asking again.');
      if (s.energy < 1) return err('No energy left this year. Age up to recharge.');
      s.energy -= 1;
      const r = tryPromote(s, notes);
      if (r === 'win') {
        applyFx(s, { p: 6, r: 3 }, deltas);
        text = 'Your boss calls you in and says the words you have been waiting for.';
      } else {
        applyFx(s, { p: -3 }, deltas);
        text = 'Your boss says you are doing great work, but the timing is not right.';
      }
    } else if (act === 'quit') {
      if (!s.job) return err('You do not have a job.');
      notes.push({ t: 'info', text: 'You left ' + jobTitle(s.job) });
      addLog(s, 'event', 'Quit ' + jobTitle(s.job) + '.');
      s.job = null;
      applyFx(s, { p: 2 }, deltas);
      text = 'You hand in your notice and walk out into the sunshine. What comes next is up to you.';
    } else {
      return err('Unknown career action.');
    }

    trackPeaks(s);
    return { ok: true, text: text, deltas: deltas, notes: notes, died: false, newAch: checkAchievements(s) };
  }

  /* ---------- achievements ---------- */

  function checkAchievements(s) {
    const fresh = [];
    D().ACHIEVEMENTS.forEach(function (a) {
      if (s.achievements.indexOf(a.id) !== -1) return;
      let ok = false;
      try { ok = a.check(s); } catch (e) { ok = false; }
      if (ok) {
        s.achievements.push(a.id);
        fresh.push(a.id);
        if (LL.storage) LL.storage.unlock(a.id);
      }
    });
    return fresh;
  }

  /* ---------- the end ---------- */

  const RANKS = [
    [0, 'Passing Through'],
    [1450, 'Well Lived'],
    [1700, 'Remarkable'],
    [1950, 'Legendary'],
    [2200, 'Mythic']
  ];

  function score(s) {
    const avgHappy = s.years ? s.happySum / s.years : s.happiness;
    const kids = s.people.filter(function (p) { return p.role === 'child'; }).length;
    const bonds = s.people.filter(function (p) { return p.role !== 'pet'; }).map(function (p) { return p.bond; });
    const bondScore = bonds.reduce(function (t, b) { return t + b; }, 0) / 6;

    return Math.round(
      s.age * 8 +
      avgHappy * 5 +
      s.peak.intelligence * 2 +
      s.peak.reputation * 3 +
      Math.min(s.peak.money, 1000000) / 2500 +
      s.achievements.length * 40 +
      kids * 25 +
      Math.min(bondScore, 120)
    );
  }

  function rankFor(sc) {
    let r = RANKS[0][1];
    RANKS.forEach(function (x) { if (sc >= x[0]) r = x[1]; });
    return r;
  }

  function epitaph(s) {
    const avgHappy = s.years ? s.happySum / s.years : s.happiness;
    const kids = s.people.filter(function (p) { return p.role === 'child'; }).length;
    const love = (s.flags.married ? 30 : 0) + kids * 15 + s.people.filter(function (p) { return p.bond >= 80; }).length * 8;
    const pillars = [
      ['brain', s.peak.intelligence],
      ['fame', s.peak.reputation],
      ['joy', avgHappy],
      ['wealth', Math.min(100, s.peak.money / 5000)],
      ['love', Math.min(100, love * 1.2)]
    ];
    pillars.sort(function (a, b) { return b[1] - a[1]; });

    const lines = {
      brain: s.name + ' never stopped asking why, and the world was better for the answers.',
      fame: 'Everyone knew ' + s.name + '\'s name, and most of them were glad to.',
      joy: s.name + ' laughed more than most, and it showed.',
      wealth: s.name + ' built something that outlasted the paycheck.',
      love: s.name + ' loved, and was loved well.'
    };
    return lines[pillars[0][0]];
  }

  function summary(s) {
    const sc = score(s);
    return {
      score: sc,
      rank: rankFor(sc),
      epitaph: epitaph(s),
      years: s.age,
      avgHappiness: s.years ? Math.round(s.happySum / s.years) : s.happiness,
      peakMoney: s.peak.money,
      children: s.people.filter(function (p) { return p.role === 'child'; }).length,
      jobTitle: s.job ? jobTitle(s.job) : (s.flags.retired ? 'Retired' : 'No job')
    };
  }

  function finalize(s) {
    s.summary = summary(s);
    if (!s.recorded) {
      s.recorded = true;
      if (LL.storage) {
        LL.storage.addLife({
          id: s.id,
          name: s.name,
          city: s.city,
          age: s.age,
          cause: s.cause,
          score: s.summary.score,
          rank: s.summary.rank,
          peakMoney: s.peak.money,
          achievements: s.achievements.length,
          date: Date.now()
        });
        LL.storage.clearGame();
        LL.storage.saveEnded(s);
      }
    }
    return s.summary;
  }

  /* ---------- public api ---------- */

  LL.engine = {
    newLife: newLife,
    eventView: eventView,
    choose: choose,
    ageUp: ageUp,
    doActivity: doActivity,
    personAction: personAction,
    personActionInfo: personActionInfo,
    careerAction: careerAction,
    eligibleJobs: eligibleJobs,
    applyOdds: applyOdds,
    moneyFlow: moneyFlow,
    jobTitle: jobTitle,
    roleLabel: roleLabel,
    finalize: finalize,
    fill: fill,
    fmtMoney: fmtMoney,
    stageFor: stageFor,
    deathChance: deathChance,
    student: student,
    score: score
  };
})();
