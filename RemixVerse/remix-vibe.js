/* Remix Verse arcade vibe: colorful motion and original synthesized UI sounds. */
(function(){
 'use strict';
 if(window.__remixVerseVibeLoaded)return;window.__remixVerseVibeLoaded=true;
 const reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const emojis=['✦','✧','★','✿','◆','●','✨','💫','⭐','🌈','🪐','💎','🎮','⚡','🦋','🌟','🎉','🟣','🔹'];
 function scenery(){
   if(reduced)return;
   const layer=document.createElement('div');layer.className='rv-floater-layer';layer.setAttribute('aria-hidden','true');
   for(let i=0;i<34;i++){
     const s=document.createElement('span');s.className='rv-floater';s.textContent=emojis[Math.floor(Math.random()*emojis.length)];
     s.style.setProperty('--x',(Math.random()*100)+'%');s.style.setProperty('--size',(12+Math.random()*26)+'px');s.style.setProperty('--duration',(10+Math.random()*19)+'s');s.style.setProperty('--delay',(-Math.random()*28)+'s');s.style.setProperty('--drift',(-130+Math.random()*260)+'px');s.style.setProperty('--rot',(-80+Math.random()*160)+'deg');s.style.setProperty('--glow',['rgba(66,200,255,.7)','rgba(255,79,216,.7)','rgba(184,255,69,.65)','rgba(255,154,66,.65)'][Math.floor(Math.random()*4)]);layer.appendChild(s);
   }
   document.body.appendChild(layer);
 }
 let ctx=null,lastTone=0;
 function soundAllowed(){try{if(window.LL&&LL.fx&&LL.fx.sound)return !!LL.fx.sound.enabled;return localStorage.getItem('rvSound')!=='off'}catch(e){return true}}
 function toggleSound(){
   let on;
   try{
     if(window.LL&&LL.fx&&LL.fx.sound){on=LL.fx.sound.toggle();}
     else{on=!soundAllowed();localStorage.setItem('rvSound',on?'on':'off');}
   }catch(e){on=!soundAllowed();try{localStorage.setItem('rvSound',on?'on':'off')}catch(_){} }
   const b=document.getElementById('rv-sound-toggle');if(b){b.setAttribute('aria-pressed',on?'true':'false');b.textContent=on?'🔊 SOUND ON':'🔇 SOUND OFF';}
   if(on)chime('success');
 }
 function addSoundToggle(){
   if(document.getElementById('rv-sound-toggle'))return;
   const b=document.createElement('button');b.id='rv-sound-toggle';b.type='button';b.className='rv-sound-toggle';b.setAttribute('aria-label','Toggle game sounds');b.setAttribute('aria-pressed',soundAllowed()?'true':'false');b.textContent=soundAllowed()?'🔊 SOUND ON':'🔇 SOUND OFF';
   b.addEventListener('click',toggleSound);document.body.appendChild(b);
 }
 function chime(kind){if(!soundAllowed())return;const now=Date.now();if(now-lastTone<38)return;lastTone=now;try{
   const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;if(!ctx)ctx=new AC();if(ctx.state==='suspended')ctx.resume();
   const sets={hover:[740],click:[620,880],exit:[523,659,784,1046],success:[659,784,988,1175],page:[392,523,659,784]};
   const notes=sets[kind]||sets.click;
   notes.forEach((f,i)=>{const t=ctx.currentTime+i*.052,o=ctx.createOscillator(),g=ctx.createGain();o.type=kind==='hover'?'sine':'triangle';o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*1.025,t+.07);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(kind==='hover'?.009:.027,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+.16);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+.18)});
 }catch(e){}}
 function pop(x,y){if(reduced)return;const colors=['#ff4fd8','#42c8ff','#c8ff57','#ff9a48','#9b5cff'];for(let i=0;i<4;i++){const p=document.createElement('span');p.className='rv-click-pop';p.style.left=(x+(Math.random()*28-14))+'px';p.style.top=(y+(Math.random()*28-14))+'px';p.style.setProperty('--rv-color',colors[Math.floor(Math.random()*colors.length)]);document.body.appendChild(p);setTimeout(()=>p.remove(),680)}}
 document.addEventListener('pointerover',e=>{const t=e.target.closest&&e.target.closest('.btn,.choice,.list-action,.nexus-exit-btn,.tab');if(t&&!t.dataset.rvHovered){t.dataset.rvHovered='1';chime('hover')}else if(t&&e.relatedTarget&&!t.contains(e.relatedTarget))chime('hover')},{passive:true});
 document.addEventListener('click',e=>{const t=e.target.closest&&e.target.closest('button,.nexus-exit-btn,.btn,.choice,.tab,.list-action');if(t&&t.id!=='rv-sound-toggle'){chime(t.classList.contains('nexus-exit-btn')?'exit':'click');pop(e.clientX,e.clientY)}},{passive:true});
 document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('button,a,.btn'))chime('click')});
 function start(){addSoundToggle();scenery();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
