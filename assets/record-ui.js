/* ============================================================================
   기록 UI — 미션 체크 · 오늘의 1초 · 사진 담기 · 하루 마감 플레이어 · 내보내기
   ----------------------------------------------------------------------------
   근거(전부 실제 원문 확인):
   · 하루 1초만 의무화 — Cesar Kuriyama, 1 Second Everyday (TED 2012)
   · 손→얼굴→넓게 3샷 — Michael Rosenblum "BBC 5 shot" (①손 WHAT ②얼굴 WHO ③와이드 WHERE
     ④어깨너머 ⑤특이각). 아이는 앞 3개, 아빠가 뒤 2개.
   · 찾기형 미션 우선 — Rick Steves Europe Scavenger Hunt(15 items) · 박물관 look-for 카드
   · 저녁 3문답 Rose/Thorn/Bud — CatholicMom 가족 프롬프트
   · 아이가 직접 찍고 그 사진에 한 문장 — Wendy Ewald, Literacy Through Photography
   ========================================================================== */
(function(){
"use strict";
const R=window.TripRecord; if(!R) return;
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const KIND={watch:"👀",shot:"📷",ask:"🙋",do:"✋",keep:"🧺"};
const SHOT={hands:"🤲",face:"😀",wide:"🏞️",ots:"👀",odd:"🙃"};
let P=null, REC=null, urls=[];

const roleName=w=>((REC&&REC.roles)||{})[w]||w;
const revoke=()=>{ urls.forEach(u=>URL.revokeObjectURL(u)); urls=[]; };
const objURL=b=>{ const u=URL.createObjectURL(b); urls.push(u); return u; };
const dayOf=el=>el.closest(".day-block").dataset.date;

/* ---------------- mount: renderSide 직후 day 카드에 주입 ---------------- */
async function mount(plan){
  P=plan; REC=(plan.trip||{}).record; revoke();
  if(!REC) return;                                   // 확정 일정이 아닌 여행안은 건드리지 않는다
  for(const d of plan.days){
    const box=document.getElementById("day"+d.day); if(!box) continue;
    box.dataset.date=d.date; box.dataset.day=d.day;
    const hd=box.querySelector(".day-hd");
    if(d.goal) hd.insertAdjacentHTML("afterend",
      `<div class="rec-goal"><span class="rg-l">오늘의 목표</span><b>${esc(d.goal)}</b>
       ${d.captain?`<span class="rg-cap">👑 오늘의 대장 · ${esc(roleName(d.captain))}</span>`:""}</div>`);
    box.querySelectorAll(".stop").forEach((st,i)=>{
      const ms=(d.stops[i]||{}).missions||[]; if(!ms.length) return;
      const done=R.missions(d.date);
      st.querySelector(".body").insertAdjacentHTML("beforeend",
        `<div class="rec-ms">${ms.map(m=>`
          <label class="rec-m${m.star?" star":""}">
            <input type="checkbox" data-mid="${m.id}" ${done[m.id]?"checked":""}>
            <span class="rm-k">${KIND[m.k]||"•"}${m.shot?`<i>${SHOT[m.shot]||""}</i>`:""}</span>
            <span class="rm-t">${esc(m.t)}<em>${esc(roleName(m.who))}</em></span>
          </label>`).join("")}</div>`);
    });
    box.querySelector(".day-body").insertAdjacentHTML("beforeend", panelHtml(d));
    await paintShots(d.date);
  }
  bind();
  document.querySelectorAll(".rec-goal").forEach(()=>{});
  syncProgress();
}

function panelHtml(d){
  const who=localStorage.getItem("rec_who")||"dad";
  const cards=(REC.shot_cards||{}).cards||[];
  return `<div class="rec-panel" data-date="${d.date}">
    <div class="rp-hd">📼 ${esc(d.date_label||"")} 기록</div>

    <div class="rp-one"><b>⭐ ${esc((REC.one_second||{}).title||"오늘의 1초")}</b>
      <p>${esc((REC.one_second||{}).rule||"").replace(/\*\*(.+?)\*\*/g,"$1")}</p>
      <small>${esc((REC.one_second||{}).why||"")}</small></div>

    <details class="rp-shots"><summary>🎬 ${esc((REC.shot_cards||{}).title||"3장 훈련")}</summary>
      <p class="rp-why">${esc((REC.shot_cards||{}).why||"")}</p>
      <div class="rp-cards">${cards.map(c=>`<div class="rp-card"><b>${c.icon} ${esc(c.name)}</b>
        <span>${esc(c.q)}</span><em>${esc(c.tip)}</em></div>`).join("")}</div></details>

    <div class="rp-who" role="group" aria-label="지금 사진을 고르는 사람">
      <span>누가 고르는 중?</span>
      ${["k1","k2","dad"].map(w=>`<button type="button" class="rp-w${w===who?" on":""}" data-who="${w}">${esc(roleName(w))}</button>`).join("")}
    </div>

    <label class="rp-add">
      <input type="file" accept="image/*" multiple hidden>
      <span>📷 오늘 사진 담기</span>
      <small>사진첩에서 고르세요. 원본은 그대로 두고 여기엔 줄인 사본만 저장됩니다.</small>
    </label>
    <div class="rp-grid" aria-live="polite"></div>

    <div class="rp-actions">
      <button type="button" class="rp-close">🌙 하루 마감하기</button>
      <button type="button" class="rp-exp">⬇️ 오늘 기록 내보내기</button>
    </div>
    <p class="rp-stat"></p>
    <p class="rp-next">내보낸 zip 을 맥으로 옮기면 그날의 <b>일기 PDF</b>와 <b>리캡 영상</b>이 만들어집니다.
      <code>python3 scripts/make_recap_video.py jeju-${d.date}.zip</code></p></div>`;
}

/* ---------------- 담긴 사진 그리드 ---------------- */
async function paintShots(date){
  const grid=document.querySelector(`.rec-panel[data-date="${date}"] .rp-grid`); if(!grid) return;
  const shots=await R.dayShots(date);
  grid.innerHTML = shots.length ? shots.map(s=>`
    <figure class="rp-ph" data-id="${s.id}">
      <img src="${objURL(s.blob)}" alt="${esc(s.caption||"담은 사진")}">
      <span class="rp-tag">${esc(roleName(s.who))}</span>
      <button type="button" class="rp-del" data-del="${s.id}" aria-label="이 사진 빼기">×</button>
      <input class="rp-cap" data-cap="${s.id}" value="${esc(s.caption||"")}" placeholder="이 사진에 대해 한 문장">
    </figure>`).join("") : `<p class="rp-empty">아직 담은 사진이 없습니다. 저녁에 셋이 둘러앉아 오늘 사진을 고르는 것부터가 마감의 시작이에요.</p>`;
  const st=document.querySelector(`.rec-panel[data-date="${date}"] .rp-stat`);
  if(st) st.textContent=`담긴 사진 ${shots.length}장`;
}

/* ---------------- 이벤트 ---------------- */
function bind(){
  document.querySelectorAll('.rec-ms input[data-mid]').forEach(cb=>cb.onchange=()=>{
    R.toggleMission(dayOf(cb),cb.dataset.mid); syncProgress(); });

  document.querySelectorAll(".rp-w").forEach(b=>b.onclick=()=>{
    localStorage.setItem("rec_who",b.dataset.who);
    b.parentElement.querySelectorAll(".rp-w").forEach(x=>x.classList.toggle("on",x===b)); });

  document.querySelectorAll(".rp-add input").forEach(inp=>inp.onchange=async e=>{
    const date=inp.closest(".rec-panel").dataset.date;
    const who=localStorage.getItem("rec_who")||"dad";
    const lab=inp.closest(".rp-add").querySelector("span"), old=lab.textContent;
    const files=[...e.target.files]; let ok=0, bad=0;
    for(let i=0;i<files.length;i++){
      lab.textContent=`⏳ ${i+1}/${files.length} 줄이는 중…`;
      try{ const {blob,w,h}=await R.shrink(files[i]);
        await R.putShot({id:`${date}_${Date.now()}_${i}`,day:date,who,blob,w,h,caption:"",ts:Date.now()+i}); ok++; }
      catch(err){ bad++; console.error(err); }
    }
    lab.textContent=old; e.target.value="";
    await paintShots(date);
    if(bad) alert(`${ok}장 담았습니다. ${bad}장은 읽지 못했어요(HEIC 등은 사진첩에서 JPG로 공유하면 됩니다).`);
  });

  document.querySelectorAll(".rp-grid").forEach(g=>{
    g.onclick=async e=>{ const b=e.target.closest("[data-del]"); if(!b) return;
      if(!confirm("이 사진을 기록에서 뺄까요?")) return;
      await R.delShot(b.dataset.del); await paintShots(g.closest(".rec-panel").dataset.date); };
    g.addEventListener("change",async e=>{ const i=e.target.closest("[data-cap]"); if(!i) return;
      const date=g.closest(".rec-panel").dataset.date;
      const shots=await R.dayShots(date), s=shots.find(x=>x.id===i.dataset.cap);
      if(s){ s.caption=i.value.slice(0,120); await R.putShot(s); } });
  });

  document.querySelectorAll(".rp-close").forEach(b=>b.onclick=()=>openPlayer(b.closest(".rec-panel").dataset.date));
  document.querySelectorAll(".rp-exp").forEach(b=>b.onclick=()=>exportDay(b.closest(".rec-panel").dataset.date));
}

function syncProgress(){
  if(!P) return;
  P.days.forEach(d=>{
    const box=document.getElementById("day"+d.day); if(!box) return;
    const all=d.stops.reduce((n,s)=>n+((s.missions||[]).length),0);
    if(!all) return;
    const done=R.missions(d.date), n=Object.keys(done).filter(k=>done[k]).length;
    let el=box.querySelector(".rg-prog");
    if(!el&&box.querySelector(".rec-goal")){ el=document.createElement("span"); el.className="rg-prog";
      box.querySelector(".rec-goal").appendChild(el); }
    if(el){ el.textContent=`미션 ${n}/${all}`; el.classList.toggle("full",n>=all); }
  });
}
window.TripRecordUI={mount};

/* ======================= 하루 마감 플레이어 ======================= */
async function openPlayer(date){
  const d=P.days.find(x=>x.date===date); if(!d) return;
  const shots=await R.dayShots(date), done=R.missions(date);
  const ms=d.stops.flatMap(s=>s.missions||[]);
  const hit=ms.filter(m=>done[m.id]);
  const next=P.days.find(x=>x.day===d.day+1);
  const stopName=r=>{ const a=(window.__tripPlace||(()=>null))(r); return a?a.name:r; };

  const slides=[];
  slides.push({cls:"s-cover",html:`<div class="pl-cover">
    <p class="pc-d">${esc(d.date_label||"")}</p><h2>${esc(d.label||"")}</h2>
    ${d.goal?`<p class="pc-g">오늘의 목표<br><b>${esc(d.goal)}</b></p>`:""}
    ${d.captain?`<p class="pc-c">👑 오늘의 대장 · ${esc(roleName(d.captain))}</p>`:""}</div>`});

  slides.push({cls:"s-route",html:`<div class="pl-route"><h3>오늘 우리가 간 곳</h3>
    <ol>${d.stops.map(s=>`<li><b>${esc(s.time||"")}</b> ${esc(stopName(s.ref))}</li>`).join("")}</ol>
    ${(d.meals||[]).length?`<p class="pr-m">🍽️ ${d.meals.map(m=>esc(m.slot)).join(" · ")}</p>`:""}</div>`});

  shots.forEach((s,i)=>slides.push({cls:"s-photo",html:`
    <img class="pl-img" src="${objURL(s.blob)}" alt="">
    <div class="pl-cap"><span class="plc-w">${esc(roleName(s.who))}</span>
      ${s.caption?esc(s.caption):`<i>${i+1}번째 사진</i>`}</div>`}));

  slides.push({cls:"s-ms",html:`<div class="pl-ms"><h3>오늘의 미션</h3>
    <p class="pm-n"><b>${hit.length}</b> / ${ms.length}</p>
    ${hit.length?`<ul>${hit.slice(0,8).map(m=>`<li>${KIND[m.k]||"•"} ${esc(m.t)}</li>`).join("")}</ul>`
      :`<p class="pm-e">체크한 미션이 없네요. 괜찮습니다. 오늘 하루는 이미 지나갔고 사진은 남았어요.</p>`}</div>`});

  const qs=((REC.closing||{}).questions)||[];
  const nt=R.notes(date);
  slides.push({cls:"s-talk",hold:true,html:`<div class="pl-talk"><h3>${esc((REC.closing||{}).title||"하루 마감")}</h3>
    <p class="pt-why">${esc((REC.closing||{}).why||"")}</p>
    ${["k1","k2","dad"].map(w=>`<div class="pt-p"><b>${esc(roleName(w))}</b>
      ${qs.map(q=>`<label class="pt-q"><span>${q.icon} ${esc(q.q)}</span>
        <input data-who="${w}" data-q="${q.id}" value="${esc(((nt[w]||{})[q.id])||"")}" placeholder="한 문장이면 충분해요"></label>`).join("")}
      </div>`).join("")}</div>`});

  slides.push({cls:"s-end",html:`<div class="pl-end">
    <h2>${next?"내일은":"여행 끝"}</h2>
    ${next?`<p class="pe-d">${esc(next.date_label||"")} · ${esc(next.label||"")}</p>
        ${next.goal?`<p class="pe-g">${esc(next.goal)}</p>`:""}<p class="pe-s">잘 자자 🌙</p>`
      :`<p class="pe-g">3박 4일, 셋이서 잘 다녀왔습니다.</p>
        <p class="pe-s">내려가서 <b>여행 전체 영상</b>을 만들어 보세요.</p>`}</div>`});

  let el=$("#recPlayer");
  if(!el){ el=document.createElement("div"); el.id="recPlayer"; document.body.appendChild(el); }
  let i=0;
  const draw=()=>{ const s=slides[i];
    el.innerHTML=`<div class="pl-bar">${slides.map((_,k)=>`<i class="${k<=i?"on":""}"></i>`).join("")}</div>
      <button class="pl-x" type="button" aria-label="닫기">×</button>
      <div class="pl-slide ${s.cls}">${s.html}</div>
      <div class="pl-nav">
        <button type="button" class="pl-prev"${i===0?" disabled":""}>이전</button>
        <button type="button" class="pl-next">${i===slides.length-1?"마치기":"다음"}</button></div>`;
    el.querySelector(".pl-x").onclick=shut;
    el.querySelector(".pl-prev").onclick=()=>{ if(i>0){ i--; draw(); } };
    el.querySelector(".pl-next").onclick=()=>{ if(i<slides.length-1){ i++; draw(); } else finish(); };
    el.querySelectorAll("[data-q]").forEach(inp=>inp.onchange=()=>
      R.setNote(date,inp.dataset.who,inp.dataset.q,inp.value.slice(0,200)));
  };
  const shut=()=>{ el.remove(); document.body.classList.remove("pl-open"); };
  const finish=()=>{ R.close(date); shut();
    const p=document.querySelector(`.rec-panel[data-date="${date}"] .rp-stat`);
    if(p) p.textContent=p.textContent+" · 마감 완료 ✓"; };
  document.body.classList.add("pl-open"); draw();
}

/* ======================= 내보내기 (ZIP) ======================= */
async function exportDay(date){
  const d=P.days.find(x=>x.date===date);
  const shots=await R.dayShots(date);
  if(!shots.length && !confirm("담은 사진이 없습니다. 텍스트 기록만 내보낼까요?")) return;
  const files=[]; const manifest={
    trip:{title:P.title,start:P.trip.start,end:P.trip.end,party:P.trip.party},
    day:{date:d.date,label:d.label,date_label:d.date_label,goal:d.goal,captain:d.captain,
         stops:d.stops.map(s=>({time:s.time,ref:s.ref,note:s.note})),
         meals:(d.meals||[]).map(m=>({slot:m.slot,time:m.time,near:m.near}))},
    missions:d.stops.flatMap(s=>(s.missions||[]).map(m=>({...m,done:!!R.missions(date)[m.id]}))),
    notes:R.notes(date), photos:[]};
  for(let i=0;i<shots.length;i++){
    const s=shots[i], nm=`photos/${String(i+1).padStart(2,"0")}_${s.who}.jpg`;
    files.push({name:nm,data:new Uint8Array(await s.blob.arrayBuffer())});
    manifest.photos.push({file:nm,who:s.who,caption:s.caption||"",w:s.w,h:s.h,ts:s.ts});
  }
  files.unshift({name:"day.json",data:new TextEncoder().encode(JSON.stringify(manifest,null,2))});
  const blob=await R.makeZip(files);
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=`jeju-${date}.zip`; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),4000);
}
})();
