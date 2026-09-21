/* 제주 GO — 현장용 단계 진행 앱. 의존성 0. */
(() => {
'use strict';
const CITY='jeju', PLAN='jeju-2609-jungmun', APPNAME='hyojunguy.github.io';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KIND={watch:'👀',shot:'📷',ask:'🙋',do:'✋',keep:'🧺'};
const WHO={k1:'언니',k2:'동생',both:'자매',all:'셋 다',dad:'아빠'};
let D={}, days=[], di=0, cards=[];

/* ── 저장 ── */
const KEY='jejugo.v1';
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||{}}catch{return{}}};
const save=o=>{try{localStorage.setItem(KEY,JSON.stringify(o))}catch{}};
let ST=load();

/* ── 네이버 지도 ── */
function openNaver(q,lat,lon,mode){
  const name=encodeURIComponent(q||'');
  let scheme,web;
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
  const bail=()=>{ if(Date.now()-t<1600 && document.visibilityState==='visible') window.location.href=web; };
  setTimeout(bail,1200);
  window.location.href=scheme;
}
function nearbyFood(fallbackName){
  const go=(lat,lon)=>openNaver('맛집',lat,lon,'search');
  if(!navigator.geolocation) return openNaver(`${fallbackName||''} 맛집`.trim(),null,null,'search');
  const btnTxt='📍 위치 확인 중…'; const b=document.activeElement; const old=b&&b.textContent;
  if(b&&old) b.textContent=btnTxt;
  navigator.geolocation.getCurrentPosition(
    p=>{ if(b&&old)b.textContent=old; go(p.coords.latitude,p.coords.longitude); },
    ()=>{ if(b&&old)b.textContent=old; openNaver(`${fallbackName||''} 맛집`.trim(),null,null,'search'); },
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
  // 출발 시퀀스가 공항 도착·렌터카를 이미 덮으므로 Day1 의 airport 스톱은 건너뛴다(중복 방지)
  const skip=new Set(useDep?(D.dep.replaces||['airport']):[]);
  (day.stops||[]).forEach((s,i)=>{ if(!skip.has(s.ref)) out.push({_t:'stop',s}); push(i); });
  return out;
}
function mid(c,i,j){ return c._t==='dep'?`d${c.id}.${j}`:`${di}.${i}.${j}`; }

function missionHTML(list,cid){
  if(!list||!list.length) return '';
  return `<h3 class="mh">미션 ${list.length}개</h3>`+list.map((m,j)=>{
    const id=`${cid}.${j}`, on=ST.m&&ST.m[id];
    const who=m.who?`<span class="who ${esc(m.who)}">${esc(WHO[m.who]||m.who)}</span>`:'';
    return `<button class="mi${on?' on':''}" data-m="${esc(id)}">
      <span class="bx">${on?'✓':''}</span>
      <span class="mt">${KIND[m.k]||'•'} ${esc(m.t)}${m.star?' <span class="star">★</span>':''}${who}</span></button>`;
  }).join('');
}

function cardHTML(c,i){
  if(c._t==='meal'){
    const m=c.m, nm=(m.near||'')+(m.near_suffix||'');
    const cands=(m.candidates||[]).map(id=>D.rest[id]).filter(Boolean);
    const buf=m.buffet?`<div class="note"><b>${esc(m.buffet.name)}</b><br>${esc(m.buffet.price||'')}</div>`:'';
    return `<section class="stop is-meal" data-i="${i}">
      <span class="tag">${esc(m.slot)}</span>
      <div class="time">${esc(m.time||'')}</div>
      <h2 class="ttl">${esc(m.slot)} · ${esc(nm||'주변에서')}</h2>
      <div class="sub">여기서 정하지 말고, 도착해서 고릅니다</div>
      <div class="acts">
        <button class="act go wide" data-food="${esc(nm)}">🍽 지금 내 위치 주변 맛집</button>
        ${nm?`<button class="act wide" data-map="${esc(nm)}">🗺 ${esc(nm)} 길찾기</button>`:''}
      </div>
      ${m.note?`<div class="note">${esc(m.note)}</div>`:''}${buf}
      ${cands.length?`<h3 class="mh">참고 후보 (안 가도 됩니다)</h3>`+cands.map(r=>
        `<button class="mi" data-map="${esc(r.name)}" data-lat="${r.lat||''}" data-lon="${r.lon||''}">
          <span class="bx">🍽</span><span class="mt">${esc(r.name)}<br>
          <span class="sub">${esc(r.category||'')} ${r.rating?'★'+r.rating:''} ${esc(r.price||'')}</span></span></button>`).join(''):''}
    </section>`;
  }
  const isDep=c._t==='dep';
  const s=isDep?c:c.s, p=isDep?null:place(s.ref);
  const name=isDep?s.name:(p?p.name:s.ref);
  const sub =isDep?(s.sub||''):(p?p.sub:'');
  const mapq=isDep?(s.map||name):name;
  const lat=p?p.lat:'', lon=p?p.lon:'';
  const cid=isDep?`d.${s.id}`:`${di}.${i}`;
  const kind=isDep?(s.kind||''):'poi';
  const noMap=kind==='home', noFood=['home','move','gate'].includes(kind);
  const mapLbl=kind==='move'?'🗺 길찾기':'🗺 지도로 이동';
  const acts=[
    noMap?'':`<button class="act go${noFood?' wide':''}" data-map="${esc(mapq)}" data-lat="${lat}" data-lon="${lon}">${mapLbl}</button>`,
    noFood?'':`<button class="act${noMap?' go wide':''}" data-food="${esc(name)}">🍽 주변 맛집</button>`
  ].filter(Boolean).join('');
  return `<section class="stop" data-i="${i}">
    <span class="tag">${isDep?({home:'출발 준비',move:'이동',airport:'공항',gate:'탑승',meal:'식사',car:'렌터카'}[kind]||'출발'):'코스'}</span>
    <div class="time">${esc(s.time||'')}</div>
    <h2 class="ttl">${esc(name)}</h2>
    ${sub?`<div class="sub">${esc(sub)}</div>`:''}
    ${acts?`<div class="acts">${acts}</div>`:'<div style="height:12px"></div>'}
    ${s.note?`<div class="note">${esc(s.note)}</div>`:''}
    ${missionHTML(s.missions,cid)}
  </section>`;
}

function render(){
  const day=days[di];
  const dl=day.date_label||day.date, hasDow=day.dow&&dl.includes(day.dow);
  $('#dayDate').textContent=`${dl}${!hasDow&&day.dow?' ('+day.dow+')':''} · Day${day.day}`;
  $('#dayLabel').textContent=day.label||'';
  $('#dayPrev').disabled=di===0; $('#dayNext').disabled=di===days.length-1;
  const cap=day.captain?`<b>오늘 대장: ${esc(WHO[day.captain]||day.captain)}</b> · `:'';
  $('#goalbar').innerHTML=cap+esc(day.goal||'');
  cards=buildCards(day);
  $('#deck').innerHTML=cards.map(cardHTML).join('');
  $('#deck').scrollLeft=0; cur=0; syncStep();
  document.body.classList.remove('loading'); $('#app').classList.remove('loading');
}

/* ── 시트 ── */
function sheet(html){ $('#sheetBody').innerHTML=html; $('#sheet').showModal(); }
function showAlerts(){
  const a=D.plan.trip.alerts||[];
  sheet('<h2>⚠️ 이 여행의 주의사항</h2>'+a.map(x=>
    `<div class="al ${esc(x.level)}"><b>${esc(x.title)}</b>${esc(x.body)}</div>`).join(''));
}
function showPlay(){
  const k=D.plan.trip.kid_play||{};
  sheet(`<h2>🚗 ${esc(k.title||'차 안 놀이')}</h2>`+(k.games||[]).map(g=>
    `<h4>${esc(g.name)}</h4><p>${esc(g.how)}</p>`).join(''));
}
function showClose(){
  const c=D.plan.trip.record.closing, one=D.plan.trip.record.one_second;
  const day=days[di], k=`c.${day.date}`;
  const v=(ST.c&&ST.c[k])||{};
  sheet(`<h2>🌙 ${esc(c.title)}</h2><p>${esc(one.rule)}</p><div class="qa">`+
    c.questions.map(q=>`<h4>${q.icon} ${esc(q.q)}</h4>
      <textarea data-q="${esc(k)}|${esc(q.id)}" placeholder="한 줄이면 충분합니다">${esc(v[q.id]||'')}</textarea>`).join('')+
    '</div>');
}

/* ── 이벤트 ── */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-map],[data-food],[data-m]');
  if(!t) return;
  if(t.dataset.map!==undefined){ openNaver(t.dataset.map,t.dataset.lat||null,t.dataset.lon||null); return; }
  if(t.dataset.food!==undefined){ nearbyFood(t.dataset.food); return; }
  if(t.dataset.m!==undefined){
    const id=t.dataset.m; ST.m=ST.m||{}; ST.m[id]=!ST.m[id]; save(ST);
    t.classList.toggle('on',ST.m[id]); t.querySelector('.bx').textContent=ST.m[id]?'✓':'';
    if(ST.m[id]&&navigator.vibrate) navigator.vibrate(18);
  }
});
document.addEventListener('input',e=>{
  const q=e.target.dataset&&e.target.dataset.q; if(!q) return;
  const [k,id]=q.split('|'); ST.c=ST.c||{}; ST.c[k]=ST.c[k]||{}; ST.c[k][id]=e.target.value; save(ST);
});
let cur=0;
function syncStep(){
  const n=cards.length||1;
  $('#sNum').textContent=`${cur+1} / ${n}`;
  $('#sFill').style.width=`${((cur+1)/n)*100}%`;
  $('#sPrev').disabled=cur===0; $('#sNext').disabled=cur>=n-1;
}
function goStep(i){
  cur=Math.max(0,Math.min(cards.length-1,i));
  const el=$('#deck').children[cur];
  if(el) el.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'});
  syncStep();
}
$('#deck').addEventListener('scroll',()=>{
  const w=$('#deck').clientWidth||1, i=Math.round($('#deck').scrollLeft/w);
  if(i!==cur){ cur=i; syncStep(); }
},{passive:true});
$('#sPrev').onclick=()=>goStep(cur-1);
$('#sNext').onclick=()=>goStep(cur+1);
$('#dayPrev').onclick=()=>{ if(di>0){di--;render();} };
$('#dayNext').onclick=()=>{ if(di<days.length-1){di++;render();} };
$('#btnAlerts').onclick=showAlerts; $('#btnPlay').onclick=showPlay; $('#btnClose').onclick=showClose;
$('#sheetX').onclick=()=>$('#sheet').close();

/* ── 부팅 ── */
const j=u=>fetch(u,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error(u);return r.json()});
Promise.all([
  j(`data/${CITY}/plans.json`), j(`data/${CITY}/attractions.json`),
  j(`data/${CITY}/hotels.json`), j(`data/${CITY}/restaurants.json`),
  j(`data/${CITY}/go-departure.json`).catch(()=>null)
]).then(([pl,attr,hotels,rest,dep])=>{
  const plan=(pl.plans||pl).find(p=>p.id===PLAN)||(pl.plans||pl)[0];
  D={plan,attr,hotels,rest,dep}; days=plan.days||[];
  const today=new Date().toISOString().slice(0,10);
  const k=days.findIndex(d=>d.date===today); di=k>=0?k:0;
  render();
}).catch(err=>{ $('#deck').innerHTML=`<div class="err">데이터를 못 불러왔습니다.<br>${esc(err.message)}</div>`;
  document.body.classList.remove('loading'); $('#app').classList.remove('loading'); });

if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
