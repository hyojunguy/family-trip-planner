/* 제주 GO v2 — 현장용. 의존성 0. 방향: docs/go-design-direction.md */
(() => {
'use strict';
const CITY='jeju', PLAN='jeju-2609-jungmun', APPNAME='hyojunguy.github.io';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KIND={watch:'👀',shot:'📷',ask:'🙋',do:'✋',keep:'🧺'};
const WHO={k1:'언니',k2:'동생',both:'자매',all:'셋 다',dad:'아빠'};
// ⛔ toISOString() 은 UTC — KST 오전 9시 이전이면 '어제'가 된다(첫날 07:30 출발이 그 구간)
const localDay=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const FILTERS=[['*','전체'],['dad','👨 아빠'],['k1','👧 언니'],['k2','👧 동생']];
let D={}, days=[], di=0, cards=[], cur=0, filter='*', tick=null;

/* ── 저장 ── */
const KEY='jejugo.v1';
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{}}catch{return{}}};
const save=o=>{try{localStorage.setItem(KEY,JSON.stringify(o))}catch{}};
let ST=load();

/* ── 테마: 라이트가 기본, 밤은 수동 ── */
function applyTheme(){
  const night=ST.night===true;
  document.documentElement.dataset.theme=night?'night':'day';
  const m=document.querySelector('meta[name=theme-color]');
  if(m) m.content=night?'#0E1513':'#FFFFFF';
  const b=$('#theme'); if(b){ b.textContent=night?'☀️':'🌙'; b.setAttribute('aria-label',night?'낮 모드':'밤 모드'); }
}

/* ── 네이버 지도 ── */
function openNaver(q,lat,lon,mode){
  const name=encodeURIComponent(q||''); let scheme,web;
  if(mode==='search'){
    scheme=`nmap://search?query=${name}${lat?`&lat=${lat}&lng=${lon}`:''}&appname=${APPNAME}`;
    web=`https://map.naver.com/p/search/${name}`+(lat?`?c=${lon},${lat},15,0,0,0,dh`:'');
  }else if(lat&&lon){
    scheme=`nmap://route/car?dlat=${lat}&dlng=${lon}&dname=${name}&appname=${APPNAME}`;
    web=`https://map.naver.com/p/search/${name}?c=${lon},${lat},16,0,0,0,dh`;
  }else{
    scheme=`nmap://search?query=${name}&appname=${APPNAME}`;
    web=`https://map.naver.com/p/search/${name}`;
  }
  const t=Date.now();
  setTimeout(()=>{ if(Date.now()-t<1600 && document.visibilityState==='visible') location.href=web; },1200);
  location.href=scheme;
}
function nearbyFood(fb,btn){
  const bail=()=>openNaver(`${fb||''} 맛집`.trim(),null,null,'search');
  if(!navigator.geolocation) return bail();
  const old=btn&&btn.textContent; if(btn) btn.textContent='📍 위치 확인 중…';
  navigator.geolocation.getCurrentPosition(
    p=>{ if(btn)btn.textContent=old; openNaver('맛집',p.coords.latitude,p.coords.longitude,'search'); },
    ()=>{ if(btn)btn.textContent=old; bail(); },
    {enableHighAccuracy:true,timeout:6000,maximumAge:60000});
}

/* ── ref 해석 ── */
function place(ref){
  if(!ref) return null;
  if(String(ref).startsWith('hotel:')){const h=D.hotels[ref.slice(6)];return h?{name:h.name,lat:h.lat,lon:h.lon,sub:h.area||''}:null;}
  const a=D.attr[ref]; return a?{name:a.name,lat:a.lat,lon:a.lon,sub:a.price_hours||a.blurb||''}:null;
}

/* ── 카드 조립 ── */
function buildCards(day){
  const out=[]; const useDep=day.day===1&&D.dep;
  if(useDep) D.dep.stops.forEach(s=>out.push({...s,_t:'dep'}));
  const meals=(day.meals||[]).slice();
  const push=at=>meals.filter(m=>m.after===at).forEach(m=>out.push({_t:'meal',m}));
  push(-1);
  const skip=new Set(useDep?(D.dep.replaces||['airport']):[]);
  (day.stops||[]).forEach((s,i)=>{ if(!skip.has(s.ref)) out.push({_t:'stop',s}); push(i); });
  return out;
}

/* ── 시간 인지 ── */
function cardTime(c){ return c._t==='meal'?(c.m.time||''):(c._t==='dep'?c.time:c.s.time)||''; }
function updateClock(){
  const el=$('#clock'); if(!el||!cards.length) return;
  const now=new Date();
  const hhmm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const t=cardTime(cards[cur]); const day=days[di];
  el.className='';
  if(!t||!/^\d{1,2}:\d{2}$/.test(t)){ el.innerHTML=`⏱ 지금 <b>${hhmm}</b>`; return; }
  // 오늘이 그 날일 때만 비교한다 — 다른 날 카드에 "늦음"을 띄우면 거짓말이 된다
  const today=localDay();
  if(day.date!==today){ el.innerHTML=`⏱ 지금 <b>${hhmm}</b> · ${esc(day.date_label||day.date)} 일정을 보는 중`; return; }
  const [h,m]=t.split(':').map(Number);
  const diff=Math.round((h*60+m)-(now.getHours()*60+now.getMinutes()));
  const abs=Math.abs(diff), hh=Math.floor(abs/60), mm=abs%60;
  const span=hh?`${hh}시간 ${mm}분`:`${mm}분`;
  if(diff>=0){ el.innerHTML=`⏱ 지금 <b>${hhmm}</b> · <b>${span}</b> 여유`; if(diff<=10) el.className='soon'; }
  else { el.innerHTML=`⏱ 지금 <b>${hhmm}</b> · <b>${span}</b> 늦음`; el.className='late'; }
}

/* ── 미션 ── */
function visible(list){
  if(filter==='*') return list||[];
  return (list||[]).filter(m=>m.who===filter||m.who==='all'||m.who==='both'&&(filter==='k1'||filter==='k2'));
}
function missionHTML(list,cid){
  const all=list||[]; if(!all.length) return '';
  const vis=visible(all);
  const done=all.filter((m,j)=>ST.m&&ST.m[`${cid}.${j}`]).length;
  const head=`<h3 class="mh">미션 ${all.length}개<span>${done}/${all.length} 완료</span></h3>`;
  if(!vis.length) return head+`<div class="empty">이 사람 미션은 여기 없어요</div>`;
  return head+all.map((m,j)=>{
    if(!vis.includes(m)) return '';
    const id=`${cid}.${j}`, on=ST.m&&ST.m[id];
    const who=m.who?`<span class="who ${esc(m.who)}">${esc(WHO[m.who]||m.who)}</span>`:'';
    return `<button class="mi${on?' on':''}" data-m="${esc(id)}" aria-pressed="${on?'true':'false'}">
      <span class="bx">${on?'✓':''}</span>
      <span class="mt">${KIND[m.k]||'•'} ${esc(m.t)}${m.star?' <span class="star">★</span>':''}${who}</span></button>`;
  }).join('');
}

function cardHTML(c,i){
  if(c._t==='meal'){
    const m=c.m, nm=(m.near||'')+(m.near_suffix||'');
    const cands=(m.candidates||[]).map(id=>D.rest[id]).filter(Boolean);
    const buf=m.buffet?`<div class="note"><b>${esc(m.buffet.name)}</b><br>${esc(m.buffet.price||'')}</div>`:'';
    return `<section class="stop is-meal">
      <span class="tag">${esc(m.slot)}</span>
      <div class="time">${esc(m.time||'')}</div>
      <h2 class="ttl">${esc(m.slot)} · ${esc(nm||'주변에서')}</h2>
      <div class="sub">여기서 정하지 말고, 도착해서 고릅니다</div>
      <div class="acts">
        <button class="act go" data-food="${esc(nm)}">🍽 지금 내 위치 주변 맛집</button>
        ${nm?`<button class="act" data-map="${esc(nm)}">🗺 ${esc(nm)} 길찾기</button>`:''}
      </div>
      ${m.note?`<div class="note">${esc(m.note)}</div>`:''}${buf}
      ${cands.length?`<h3 class="mh">참고 후보 <span>안 가도 됩니다</span></h3>`+cands.map(r=>
        `<button class="mi" data-map="${esc(r.name)}" data-lat="${r.lat||''}" data-lon="${r.lon||''}">
          <span class="bx">🍽</span><span class="mt">${esc(r.name)}<br>
          <span class="sub">${esc(r.category||'')} ${r.rating?'★'+r.rating:''} ${esc(r.price||'')}</span></span></button>`).join(''):''}
    </section>`;
  }
  const isDep=c._t==='dep', s=isDep?c:c.s, p=isDep?null:place(s.ref);
  const name=isDep?s.name:(p?p.name:s.ref), sub=isDep?(s.sub||''):(p?p.sub:'');
  const mapq=isDep?(s.map||name):name, lat=p?p.lat:'', lon=p?p.lon:'';
  const cid=isDep?`d.${s.id}`:`${di}.${i}`;
  const kind=isDep?(s.kind||''):'poi';
  const noMap=kind==='home', noFood=['home','move','gate'].includes(kind);
  const mapLbl=kind==='move'?'🗺 길찾기':'🗺 지도로 이동';
  const btns=[
    noMap?'':`<button class="act go" data-map="${esc(mapq)}" data-lat="${lat}" data-lon="${lon}">${mapLbl}</button>`,
    noFood?'':`<button class="act${noMap?' go':''}" data-food="${esc(name)}">🍽 주변 맛집</button>`
  ].filter(Boolean);
  const TAG={home:'출발 준비',move:'이동',airport:'공항',gate:'탑승',car:'렌터카'};
  return `<section class="stop">
    <span class="tag">${isDep?(TAG[kind]||'출발'):'코스'}</span>
    <div class="time">${esc(s.time||'')}</div>
    <h2 class="ttl">${esc(name)}</h2>
    ${sub?`<div class="sub">${esc(sub)}</div>`:''}
    ${btns.length?`<div class="acts${btns.length>1?' two':''}">${btns.join('')}</div>`:'<div style="height:10px"></div>'}
    ${s.note?`<div class="note">${esc(s.note)}</div>`:''}
    ${missionHTML(s.missions,cid)}
  </section>`;
}

function syncStep(){
  const n=cards.length||1;
  $('#sNum').textContent=`${cur+1} / ${n}`;
  $('#sFill').style.width=`${((cur+1)/n)*100}%`;
  $('#sPrev').disabled=cur===0; $('#sNext').disabled=cur>=n-1;
  updateClock();
}
function goStep(i){
  cur=Math.max(0,Math.min(cards.length-1,i));
  const el=$('#deck').children[cur];
  // smooth 를 쓰지 않는다 — 이동 중에도 손으로 잡아 되돌릴 수 있어야 한다
  if(el) $('#deck').scrollLeft=el.offsetLeft-($('#deck').clientWidth-el.clientWidth)/2;
  syncStep();
}
function renderCards(keep){
  const at=keep?cur:0;
  cards=buildCards(days[di]);
  $('#deck').innerHTML=cards.map(cardHTML).join('');
  cur=Math.min(at,cards.length-1);
  $('#deck').scrollLeft=cur?($('#deck').children[cur]||{offsetLeft:0}).offsetLeft:0;
  syncStep();
}
function render(){
  const day=days[di];
  const dl=day.date_label||day.date, hasDow=day.dow&&dl.includes(day.dow);
  $('#dayDate').textContent=`${dl}${!hasDow&&day.dow?' ('+day.dow+')':''} · Day${day.day}`;
  $('#dayLabel').textContent=[day.captain?`오늘 대장 ${WHO[day.captain]||day.captain}`:'',day.goal||day.label].filter(Boolean).join(' · ');
  $('#dayPrev').disabled=di===0; $('#dayNext').disabled=di===days.length-1;
  $('#who').innerHTML=FILTERS.map(([v,l])=>
    `<button class="wf${filter===v?' on':''}" data-w="${v}" aria-pressed="${filter===v}">${l}</button>`).join('');
  renderCards(false);
  document.body.classList.remove('loading'); $('#app').classList.remove('loading');
}

/* ── 시트 ── */
function sheet(h){ $('#sheetBody').innerHTML=h; $('#sheet').showModal(); }
function showAlerts(){
  sheet('<h2>⚠️ 이 여행의 주의사항</h2>'+(D.plan.trip.alerts||[]).map(x=>
    `<div class="al ${esc(x.level)}"><b>${esc(x.title)}</b>${esc(x.body)}</div>`).join(''));
}
function showPlay(){
  const k=D.plan.trip.kid_play||{};
  sheet(`<h2>🚗 ${esc(k.title||'차 안 놀이')}</h2>`+(k.games||[]).map(g=>
    `<h4>${esc(g.name)}</h4><p>${esc(g.how)}</p>`).join(''));
}
function showClose(){
  const c=D.plan.trip.record.closing, one=D.plan.trip.record.one_second;
  const day=days[di], k=`c.${day.date}`, v=(ST.c&&ST.c[k])||{};
  sheet(`<h2>🌙 ${esc(c.title)}</h2><p>${esc(one.rule)}</p><div class="qa">`+
    c.questions.map(q=>`<h4>${q.icon} ${esc(q.q)}</h4>
      <textarea data-q="${esc(k)}|${esc(q.id)}" placeholder="한 줄이면 충분합니다">${esc(v[q.id]||'')}</textarea>`).join('')+'</div>');
}

/* ── 이벤트 ── */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-map],[data-food],[data-m],[data-w]');
  if(!t) return;
  if(t.dataset.w!==undefined){ filter=t.dataset.w;
    [...$('#who').children].forEach(b=>{const on=b.dataset.w===filter;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);});
    renderCards(true); return; }
  if(t.dataset.map!==undefined){ openNaver(t.dataset.map,t.dataset.lat||null,t.dataset.lon||null); return; }
  if(t.dataset.food!==undefined){ nearbyFood(t.dataset.food,t); return; }
  if(t.dataset.m!==undefined){
    const id=t.dataset.m; ST.m=ST.m||{}; ST.m[id]=!ST.m[id]; save(ST);
    t.classList.toggle('on',ST.m[id]); t.setAttribute('aria-pressed',ST.m[id]?'true':'false');
    t.querySelector('.bx').textContent=ST.m[id]?'✓':'';
    const h=t.closest('.stop').querySelector('.mh span');
    if(h){ const items=[...t.closest('.stop').querySelectorAll('.mi[data-m]')];
      const tot=(h.textContent.match(/\/(\d+)/)||[])[1]||items.length;
      const base=h.textContent.includes('완료');
      if(base){ let n=0; for(const k in ST.m) if(ST.m[k]&&k.startsWith(id.split('.').slice(0,-1).join('.')+'.')) n++;
        h.textContent=`${n}/${tot} 완료`; } }
    if(ST.m[id]&&navigator.vibrate) navigator.vibrate(18);
  }
});
document.addEventListener('input',e=>{
  const q=e.target.dataset&&e.target.dataset.q; if(!q) return;
  const [k,id]=q.split('|'); ST.c=ST.c||{}; ST.c[k]=ST.c[k]||{}; ST.c[k][id]=e.target.value; save(ST);
});
$('#deck').addEventListener('scroll',()=>{
  const w=$('#deck').clientWidth||1, i=Math.round($('#deck').scrollLeft/w);
  if(i!==cur){ cur=i; syncStep(); }
},{passive:true});
$('#sPrev').onclick=()=>goStep(cur-1);
$('#sNext').onclick=()=>goStep(cur+1);
$('#dayPrev').onclick=()=>{ if(di>0){di--;render();} };
$('#dayNext').onclick=()=>{ if(di<days.length-1){di++;render();} };
$('#theme').onclick=()=>{ ST.night=!ST.night; save(ST); applyTheme(); };
$('#btnAlerts').onclick=showAlerts; $('#btnPlay').onclick=showPlay; $('#btnClose').onclick=showClose;
$('#sheetX').onclick=()=>$('#sheet').close();

/* ── 부팅 ── */
applyTheme();
const j=u=>fetch(u,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(u);return r.json()});
Promise.all([
  j(`data/${CITY}/plans.json`), j(`data/${CITY}/attractions.json`),
  j(`data/${CITY}/hotels.json`), j(`data/${CITY}/restaurants.json`),
  j(`data/${CITY}/go-departure.json`).catch(()=>null)
]).then(([pl,attr,hotels,rest,dep])=>{
  const plan=(pl.plans||pl).find(p=>p.id===PLAN)||(pl.plans||pl)[0];
  D={plan,attr,hotels,rest,dep}; days=plan.days||[];
  const today=localDay();
  const k=days.findIndex(d=>d.date===today); di=k>=0?k:0;
  render();
  tick=setInterval(updateClock,30000);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') updateClock(); });
}).catch(err=>{ $('#deck').innerHTML=`<div class="err">데이터를 못 불러왔습니다.<br>${esc(err.message)}</div>`;
  document.body.classList.remove('loading'); $('#app').classList.remove('loading'); });

if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
