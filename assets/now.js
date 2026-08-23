/* ============================================================================
   📍 지금 — 아이 손에 쥐어 주는 화면
   ----------------------------------------------------------------------------
   왜 따로 만드나: 일정 카드는 "아빠가 계획을 보는" 화면이다. 세로로 7,000px 이고
   미션은 장소 카드 안쪽에 접혀 있다. 초2가 버스 안에서 자기 미션을 찾으려면
   스크롤을 한참 해야 한다 — 그러면 안 한다.
   그래서 이 화면은 딱 세 가지만 답한다: 지금 어디고 · 내가 뭘 해야 하고 · 다음은 뭔가.

   설계 규칙
   1) 역할(언니/동생/아빠)을 먼저 고르고, 그 사람 미션만 보여준다.
      'both' 미션은 자매가 **각자** 체크한다(공용 체크 하나면 먼저 누른 쪽이 뺏는다).
   2) 지금 시각으로 현재 항목을 고른다. 여행 전이면 미리보기 모드로 전체를 훑게 한다.
   3) 체크는 그 자리에서 저장하고 일정 카드와 양방향으로 동기화한다.
   ========================================================================== */
(function(){
"use strict";
const R=window.TripRecord; if(!R) return;
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const KIND={watch:"👀",shot:"📷",ask:"🙋",do:"✋",keep:"🧺"};
const WHO_EMO={k1:"👧",k2:"🧒",dad:"👨"};
let P=null, REC=null, tick=null, openDay=null;

const me=()=>localStorage.getItem("rec_who")||"dad";
const setMe=w=>{ localStorage.setItem("rec_who",w); paint(); document.dispatchEvent(new CustomEvent("rolechange")); };
const roleName=w=>((REC&&REC.roles)||{})[w]||w;
const hhmm=d=>String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const tmin=t=>{ const m=/^(\d{1,2}):(\d{2})$/.exec(t||""); return m?+m[1]*60+ +m[2]:null; };

/* 장소와 끼니를 한 줄로 합쳐 시간순으로 세운다 — 아이에게 "장소"와 "밥"은 같은 사건이다 */
function timeline(day){
  const out=[];
  (day.stops||[]).forEach((s,i)=>{ const a=window.__tripPlace?window.__tripPlace(s.ref):null;
    out.push({kind:"stop",i,t:s.t||s.time,min:tmin(s.time),ref:s.ref,
      name:(a&&a.name)||s.ref,note:s.note,missions:s.missions||[]}); });
  (day.meals||[]).forEach(m=>{ if(!m.time) return;
    out.push({kind:"meal",t:m.time,min:tmin(m.time),name:`${m.slot} · ${m.near}`,
      slot:m.slot,note:m.note,buffet:m.buffet,candidates:m.candidates||[],missions:[]}); });
  return out.filter(x=>x.min!=null).sort((a,b)=>a.min-b.min);
}

function myMissions(item){ const w=me();
  return (item.missions||[]).filter(m=>R.missionMine(m.who,w)); }

function dayProgress(day){ const w=me(); let done=0,tot=0;
  (day.stops||[]).forEach(s=>(s.missions||[]).forEach(m=>{
    if(!R.missionMine(m.who,w)) return; tot++; if(R.missionDone(day.date,m.id,w)) done++; }));
  return {done,tot}; }

/* ---------------- 화면 ---------------- */
function paint(){
  const box=document.getElementById("nowSheet"); if(!box||box.hidden) return;
  const now=new Date(), today=iso(now), nowMin=now.getHours()*60+now.getMinutes();
  const days=(P&&P.days)||[];
  const live=days.find(d=>d.date===today);
  const day=live||days.find(d=>d.day===(openDay||1))||days[0];
  if(!day){ box.querySelector(".nw-body").innerHTML="<p class='nw-empty'>일정이 없습니다.</p>"; return; }

  const tl=timeline(day);
  let curIdx=-1;
  if(live){ for(let i=0;i<tl.length;i++) if(tl[i].min<=nowMin) curIdx=i; }
  else if(box.dataset.pick!=null) curIdx=+box.dataset.pick;
  /* 미리보기에서 아무것도 안 고른 상태로 두면 빈 화면이 뜬다 — 아이는 거기서 닫는다.
     내 미션이 있는 첫 항목을 기본으로 열어 준다. */
  if(curIdx<0 && tl.length){ const k=tl.findIndex(x=>myMissions(x).length); curIdx = k>=0?k:0; }
  const cur=curIdx>=0?tl[curIdx]:null, nxt=tl[curIdx+1]||null;
  const pr=dayProgress(day);

  // D-day
  const first=days[0]&&days[0].date?new Date(days[0].date+"T00:00:00"):null;
  const t0=new Date(now); t0.setHours(0,0,0,0);
  const dd=first?Math.round((first-t0)/86400000):null;

  const roleBar=`<div class="nw-who" role="group" aria-label="나는 누구">
    ${["k1","k2","dad"].map(w=>`<button type="button" class="nw-w${w===me()?" on":""}" data-w="${w}">
      <b>${WHO_EMO[w]}</b><span>${esc(roleName(w))}</span></button>`).join("")}</div>`;

  const banner = live
    ? `<div class="nw-live">🔴 오늘은 <b>${esc(day.date_label||"")}</b> · 지금 ${hhmm(now)}</div>`
    : `<div class="nw-prev">${dd>0?`여행까지 <b>D-${dd}</b>`:"여행 기간이 아닙니다"} — 미리보기예요. 아래에서 시간을 눌러 연습해 보세요.
        <div class="nw-days">${days.map(d=>`<button type="button" class="nw-d${d.day===day.day?" on":""}" data-day="${d.day}">${esc(d.date_label||(d.day+"일차"))}</button>`).join("")}</div></div>`;

  const missionCard=(item)=>{ const ms=myMissions(item);
    if(!ms.length) return `<p class="nw-nom">여기선 ${esc(roleName(me()))} 미션이 없어요. 다른 사람 걸 도와줘도 좋아요.</p>`;
    return `<div class="nw-ms">${ms.map(m=>{
      const on=R.missionDone(day.date,m.id,me());
      return `<label class="nw-m${on?" on":""}${m.star?" star":""}">
        <input type="checkbox" data-mid="${m.id}" ${on?"checked":""}>
        <span class="nw-k">${KIND[m.k]||"•"}</span>
        <span class="nw-t">${esc(m.t)}</span>
        ${m.star?`<span class="nw-st">⭐</span>`:""}</label>`; }).join("")}</div>`; };

  const itemBlock=(item,cls,label)=>{
    if(!item) return "";
    const isMeal=item.kind==="meal";
    const eats=isMeal?(item.buffet?[item.buffet.name]:item.candidates.map(id=>(window.__tripRest&&window.__tripRest(id)||{}).name).filter(Boolean)):[];
    return `<section class="nw-item ${cls}">
      <div class="nw-hd"><span class="nw-lb">${label}</span><span class="nw-tm">${esc(item.t||"")}</span></div>
      <h3>${isMeal?"🍽️ ":""}${esc(item.name)}</h3>
      ${eats.length?`<p class="nw-eat">${eats.map(esc).join(" · ")}</p>`:""}
      ${item.note?`<p class="nw-no">${esc(item.note).slice(0,180)}${item.note.length>180?"…":""}</p>`:""}
      ${cls==="cur"?missionCard(item):""}
    </section>`; };

  const list = live ? "" : `<div class="nw-tl">${tl.map((x,i)=>{
      const n=myMissions(x).length;
      return `<button type="button" class="nw-tli${i===curIdx?" on":""}" data-pick="${i}">
        <i>${esc(x.t)}</i><span>${esc(x.name)}</span>${n?`<em>${n}</em>`:""}</button>`; }).join("")}</div>`;

  box.querySelector(".nw-body").innerHTML=`
    ${roleBar}${banner}
    <div class="nw-pg"><div class="nw-pgb" style="width:${pr.tot?Math.round(pr.done/pr.tot*100):0}%"></div>
      <span>오늘 내 미션 ${pr.done} / ${pr.tot}</span></div>
    ${list}
    ${cur?itemBlock(cur,"cur",live?"지금 여기":"고른 곳"):`<p class="nw-empty">${live?"오늘 일정이 아직 시작 전이에요.":"위에서 시간을 하나 눌러 보세요."}</p>`}
    ${nxt?itemBlock(nxt,"nxt","다음"):""}
    <button type="button" class="nw-jump">📋 오늘 전체 일정 보기</button>`;

  box.querySelectorAll(".nw-w").forEach(b=>b.onclick=()=>setMe(b.dataset.w));
  box.querySelectorAll(".nw-d").forEach(b=>b.onclick=()=>{ openDay=+b.dataset.day; delete box.dataset.pick; paint(); });
  box.querySelectorAll(".nw-tli").forEach(b=>b.onclick=()=>{ box.dataset.pick=b.dataset.pick; paint(); });
  box.querySelectorAll(".nw-m input").forEach(cb=>cb.onchange=()=>{
    R.toggleMission(day.date,cb.dataset.mid,me());
    // 일정 카드 쪽 체크박스도 같이 맞춘다 — 두 화면이 어긋나면 아이가 두 번 체크한다
    document.querySelectorAll(`.rec-ms input[data-mid="${cb.dataset.mid}"]`).forEach(o=>{
      o.dataset.w=me(); o.checked=R.missionDone(day.date,cb.dataset.mid,me()); });
    paint(); });
  const j=box.querySelector(".nw-jump");
  if(j) j.onclick=()=>{ close(); const t=document.getElementById("day"+day.day);
    t&&t.scrollIntoView({behavior:"smooth",block:"start"}); };
}

function open(){ const box=document.getElementById("nowSheet"); if(!box) return;
  box.hidden=false; document.body.classList.add("nw-open"); paint();
  clearInterval(tick); tick=setInterval(paint,30000);          // 분 단위로 "지금"이 흐른다
  box.querySelector(".nw-x").focus(); }
function close(){ const box=document.getElementById("nowSheet"); if(!box) return;
  box.hidden=true; document.body.classList.remove("nw-open"); clearInterval(tick); tick=null; }

function mount(plan){
  P=plan; REC=(plan.trip||{}).record;
  const old=document.getElementById("nowSheet"); if(old) old.remove();
  const btn=document.getElementById("nowBtn"); if(btn) btn.remove();
  if(!REC) return;                                  // 확정 일정에만 붙인다
  document.body.insertAdjacentHTML("beforeend",
    `<button id="nowBtn" class="nowbtn" type="button" aria-haspopup="dialog">📍 지금</button>
     <div id="nowSheet" class="nw" role="dialog" aria-modal="true" aria-label="지금 할 것" hidden>
       <div class="nw-top"><b>📍 지금</b><button type="button" class="nw-x" aria-label="닫기">✕</button></div>
       <div class="nw-body"></div></div>`);
  document.getElementById("nowBtn").onclick=open;
  document.querySelector("#nowSheet .nw-x").onclick=close;
  document.addEventListener("keydown",e=>{ if(e.key==="Escape") close(); });
  document.addEventListener("missionchange",()=>paint());
}
window.TripNow={mount,open,close};
})();
