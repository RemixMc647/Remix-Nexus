/* LifeLoop storage: local cache plus authenticated cloud sync. */
(function () {
  'use strict';
  const LL = (window.LL = window.LL || {});
  const NS = 'lifeloop.v1.';
  const API_BASE = 'https://life-loop-game.onrender.com';
  let cloudReady = false;
  let saveTimer = null;
  let cloudEnabled = false;
  function read(key, fallback) {
    try { const raw = localStorage.getItem(NS + key); return raw === null ? fallback : JSON.parse(raw); }
    catch (_) { return fallback; }
  }
  function rawWrite(key, value) { try { localStorage.setItem(NS + key, JSON.stringify(value)); return true; } catch (_) { return false; } }
  function remove(key) { try { localStorage.removeItem(NS + key); } catch (_) {} }
  function queueCloudSave() {
    if (!cloudEnabled || !cloudReady) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async function () {
      try {
        const payload = { game: read('game', null), ended: read('ended', null), legacy: read('legacy', {lives:[],achievements:{}}), settings: read('settings', {}) };
        const res = await fetch(`${API_BASE}/api/lifeloop/save`, { method:'PUT', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        if (res.status === 401) { cloudEnabled = false; window.dispatchEvent(new CustomEvent('lifeloop:auth-expired')); }
        else if (!res.ok) console.warn('LifeLoop cloud save did not complete.');
        else window.dispatchEvent(new CustomEvent('lifeloop:cloud-saved'));
      } catch (_) { /* Local save remains available if the network is temporarily offline. */ }
    }, 650);
  }
  LL.storage = {
    loadGame(){ const g=read('game',null); return g && g.alive ? g : null; },
    saveGame(state){ const ok=rawWrite('game',state); queueCloudSave(); return ok; },
    clearGame(){ remove('game'); queueCloudSave(); },
    loadEnded(){ return read('ended',null); },
    saveEnded(state){ rawWrite('ended',state); queueCloudSave(); },
    clearEnded(){ remove('ended'); queueCloudSave(); },
    loadLegacy(){ const l=read('legacy',null); if(!l||typeof l!=='object')return {lives:[],achievements:{}}; if(!Array.isArray(l.lives))l.lives=[]; if(!l.achievements||typeof l.achievements!=='object')l.achievements={}; return l; },
    addLife(record){ const l=this.loadLegacy(); l.lives.unshift(record); l.lives=l.lives.slice(0,100); rawWrite('legacy',l); queueCloudSave(); },
    unlock(id){ const l=this.loadLegacy(); if(l.achievements[id])return false; l.achievements[id]=Date.now(); rawWrite('legacy',l); queueCloudSave(); return true; },
    totals(){ const l=this.loadLegacy(); const t={lives:l.lives.length,years:0,oldest:0,bestScore:0,bestRank:'',achievements:Object.keys(l.achievements).length}; l.lives.forEach(function(x){t.years+=x.age||0;if((x.age||0)>t.oldest)t.oldest=x.age;if((x.score||0)>t.bestScore){t.bestScore=x.score;t.bestRank=x.rank||'';}}); return t; },
    resetAll(){ remove('game');remove('ended');remove('legacy');queueCloudSave(); },
    getSetting(key,fallback){ const s=read('settings',{});return Object.prototype.hasOwnProperty.call(s,key)?s[key]:fallback; },
    setSetting(key,value){ const s=read('settings',{});s[key]=value;rawWrite('settings',s);queueCloudSave(); },
    /* Called only after the server confirms the signed-in identity. */
    hydrateFromCloud(data){ rawWrite('game',data.game||null);rawWrite('ended',data.ended||null);rawWrite('legacy',data.legacy||{lives:[],achievements:{}});rawWrite('settings',data.settings||{});cloudEnabled=true;cloudReady=true; },
    enableCloud(){ cloudEnabled=true;cloudReady=true;queueCloudSave(); },
    disableCloud(){ cloudEnabled=false;cloudReady=false; }
  };
})();
