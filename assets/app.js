/* 가족여행 플래너 v4 — cities · map · transport · meals(route-inline) · ratings · custom route builder */
const REPO_URL = "https://github.com/sylvanus4/family-trip-planner";
const DAYCOL = {1:"#0E7C7B",2:"#E15A38",3:"#DE9A2E",4:"#6D28D9",5:"#0369A1"};
const S = { cities:[], city:null, plans:[], hotels:{}, at:{}, rest:{}, cur:null, map:null };

const $ = s => document.querySelector(s);
const won = n => n==null ? "-" : Number(n).toLocaleString("ko-KR");
const enc = s => encodeURIComponent(s);
const commons = f => f ? `https://commons.wikimedia.org/wiki/Special:FilePath/${enc(f)}?width=500` : null;
const kakaoTo = p => `https://map.kakao.com/link/to/${enc(p.name)},${p.lat},${p.lon}`;
const TRANSIT = new Set(["station","airport"]);

function haversine(a,b){ const R=6371,r=x=>x*Math.PI/180;
  const dLat=r(b.lat-a.lat),dLon=r(b.lon-a.lon);
  const s=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s)); }
const round100 = n => Math.round(n/100)*100;

function leg(a,b){ if(!a||!b||!a.lat||!b.lat) return null;
  const d=haversine(a,b),t=S.city.transport;
  if(d<0.45) return {icon:"🚶",mode:"도보",mins:Math.max(2,Math.round(d*15)),cost:0,note:"가까워요"};
  // 렌터카가 확정된 여행(trip.rentcar)은 구간을 자차 기준으로 계산한다.
  // 직선거리 × 1.3 = 도로거리, 평균 50km/h, 연비 9km/L·휘발유 1,700원/L 가정.
  if(S.drive){ const km=d*1.3;
    return {icon:"🚗",mode:"렌터카",mins:Math.max(5,Math.round(km/50*60+5)),cost:round100(km/9*1700),
      link:kakaoTo(b),linklabel:"카카오내비",note:"도로거리·연료비 추정 · 제주는 통행료 없음"}; }
  if(t.has_subway&&d<=12) return {icon:"🚇",mode:"지하철",mins:Math.round(d*4+8),cost:t.subway4,link:kakaoTo(b),linklabel:"길찾기",note:"4인(추정)"};
  const cost=round100(t.taxi_base+d*t.taxi_per_km);
  return {icon:"🚕",mode:"택시",mins:Math.round(d*3+5),cost,link:kakaoTo(b),linklabel:"카카오T 호출",note:t.has_subway?"택시비(추정)":"택시비 추정 · 렌터카도 편해요"}; }

function nearestRest(target,k,excl){ if(!target) return [];
  const fav=S.favR||new Set();
  return Object.entries(S.rest).filter(([id,r])=>r.lat&&!excl.has(id))
    .sort((a,b)=>((fav.has(b[0])?1:0)-(fav.has(a[0])?1:0)) || (haversine(target,a[1])-haversine(target,b[1]))).slice(0,k).map(x=>x[0]); }

/* ---------- ratings ---------- */
function stars(r){ if(r==null) return ""; const f=Math.round(r);
  return `<span class="stars">${"★".repeat(f)}${"☆".repeat(Math.max(0,5-f))}</span>`; }
function ratingLine(o){ if(!o) return "";
  if(o.rating==null){ return o.sentiment?`<div class="rate"><span class="senti">“${o.sentiment}”</span></div>`:""; }
  const rv=o.reviews?(o.reviews>=1000?(o.reviews/1000).toFixed(1)+"k":o.reviews):null;
  return `<div class="rate">${stars(o.rating)}<b>${o.rating}</b>${rv?`<span class="rev">리뷰 ${rv}</span>`:""}${o.sentiment?`<span class="senti">“${o.sentiment}”</span>`:""}</div>`; }
/* 3 blog/review discovery links (search-based, always valid — no fabricated post URLs) */
function reviewLinks(name,kind){ if(!name) return "";
  const third = kind==="food"
    ? {u:`https://map.kakao.com/?q=${enc(name)}`,t:"카카오맵"}
    : {u:`https://search.naver.com/search.naver?query=${enc(name+" 리뷰")}`,t:"네이버리뷰"};
  return `<div class="reviews"><span class="rv-h">📝 후기</span>`+
    `<a class="rlnk" href="https://search.naver.com/search.naver?ssc=tab.blog.all&query=${enc(name+" 후기")}" target="_blank" rel="noopener">네이버블로그</a>`+
    `<a class="rlnk" href="https://www.google.com/search?q=${enc(name+" 블로그 후기")}" target="_blank" rel="noopener">구글</a>`+
    `<a class="rlnk" href="${third.u}" target="_blank" rel="noopener">${third.t}</a></div>`; }

/* photo: prefer real Wikimedia (img) then generated illustration (photo) */
function resolveImg(o){ if(!o) return null; if(o.img) return commons(o.img); if(o.photo) return o.photo; return null; }

/* ---------- favorites → 내 코스 ---------- */
function favKey(t){ return `fav${t}_${S.city.id}`; }
function loadFavs(){ try{ S.fav=new Set(JSON.parse(localStorage.getItem(favKey("A"))||"[]")); }catch(e){ S.fav=new Set(); }
  try{ S.favR=new Set(JSON.parse(localStorage.getItem(favKey("R"))||"[]")); }catch(e){ S.favR=new Set(); } }
function toggleFav(id,t){ const set=t==="R"?S.favR:S.fav; set.has(id)?set.delete(id):set.add(id);
  localStorage.setItem(favKey(t),JSON.stringify([...set]));
  document.querySelectorAll(`[data-fav="${t}:${id}"]`).forEach(b=>{ const on=set.has(id); b.classList.toggle("on",on); b.textContent=on?"✓ 담김":"＋ 내 코스"; });
  renderFavPill(); }
function favBtn(id,t){ const on=(t==="R"?S.favR:S.fav).has(id);
  return `<button class="favbtn${on?' on':''}" data-fav="${t}:${id}">${on?"✓ 담김":"＋ 내 코스"}</button>`; }
function bindFavs(scope){ (scope||document).querySelectorAll(".favbtn").forEach(b=>b.onclick=e=>{ e.preventDefault(); const [t,id]=b.dataset.fav.split(":"); toggleFav(id,t); }); }
function renderFavPill(){ let el=$("#favPill"); if(!el){ el=document.createElement("button"); el.id="favPill"; document.body.appendChild(el); }
  const n=(S.fav?.size||0)+(S.favR?.size||0);
  if(!n){ el.style.display="none"; return; }
  el.style.display="flex"; el.innerHTML=`🧩 담은 곳 <b>${n}</b> · 내 코스 만들기 →`;
  el.onclick=openBuilder; }
function buildFromFavorites(){
  const ids=[...(S.fav||[])].filter(id=>S.at[id]);
  if(ids.length<2){ alert("여행지를 2곳 이상 '＋ 내 코스'로 담아주세요. (맛집은 담으면 해당 코스 식사에 우선 반영됩니다)"); return; }
  const hotelId=Object.keys(S.hotels)[0];
  const plan=buildCustomPlan(ids,hotelId,3);
  localStorage.setItem(`custom_${S.city.id}`,JSON.stringify({ids,hotel:hotelId,days:3}));
  upsertCustom(plan); renderPlanPicker(); selectPlan("custom");
}

function renderVideo(){ const el=$("#tripVideo"); if(!el) return; const c=S.city; el.innerHTML="";
  const vids=[[c.intro_video, c.id==="jeju"?"✈️ 비행기 타고 출발":"🚄 SRT 타고 출발"],[c.feel_video,"🌊 이번 여행 미리보기"]].filter(v=>v[0]);
  if(!vids.length) return;
  el.innerHTML=`<div class="tv-h">🎬 여행 미리보기</div><div class="tv-grid">${vids.map(([src,cap])=>`<figure class="tv"><video src="${src}" muted loop autoplay playsinline preload="metadata" onerror="this.closest('figure').style.display='none'"></video><figcaption>${cap}</figcaption></figure>`).join("")}</div>`;
  setTimeout(()=>{ if(![...el.querySelectorAll('figure')].some(f=>f.style.display!=='none')) el.innerHTML=""; },2500); }

function bookingCard(){ const c=S.city, b=c.booking||[], ht=c.home_transfer, rc=c.rentcar;
  return `<div class="card book"><div class="book-hd">🎫 예매 & 출발 준비</div>
    <div class="book-row"><b>${c.cost.intercity_label} 예매</b><div class="lnks">${b.map(x=>`<a class="lnk" href="${x.url}" target="_blank" rel="noopener">${x.label}</a>`).join("")}</div></div>
    ${rc?`<div class="book-row"><b>🚗 ${rc.label}</b>${rc.note?`<div class="bt-note">${rc.note}</div>`:""}<div class="lnks">${(rc.book||[]).map(x=>`<a class="lnk" href="${x.url}" target="_blank" rel="noopener">${x.label}</a>`).join("")}</div></div>`:""}
    ${ht?`<div class="book-row"><b>🚐 ${ht.label}</b><div class="bt-note">${ht.note}</div>
      ${(ht.options||[]).length?`<div class="ht-opts">${ht.options.map(o=>`<div class="ht-o${o.best?" best":""}"><div class="ht-t"><b>${o.label}</b>${o.best?`<span class="ht-bg">추천</span>`:""}</div><div class="ht-p">${o.price}</div><div class="ht-w">${o.why}</div></div>`).join("")}</div>`:""}
      ${ht.lead?`<div class="dl-ct">⚠️ ${ht.lead}</div>`:""}
      <div class="lnks">${(ht.book||[]).map(x=>`<a class="lnk" href="${x.url}" target="_blank" rel="noopener">${x.label}</a>`).join("")}</div></div>`:""}</div>`; }

/* ---------- 🍊 꼭 먹을 것 · 간식 ------------------------------------------
   "제주 가면 뭘 먹어야 하나"는 끼니 카드(가까운 집 3곳)로는 절대 안 보인다.
   그건 "어디서" 이고 이건 "무엇을" 이다. 그래서 별도 카드로 세운다.
   아이 입맛(상/중/하)과 "우리 일정 중 언제 먹는지"를 같이 붙여, 리스트가
   구경거리로 끝나지 않고 실제 끼니에 연결되게 한다. */
function mustEatCard(){ const me=S.city.must_eat; if(!me||!(me.items||[]).length) return "";
  const K={"상":"아이도 잘 먹음","중":"반반","하":"어른 입맛"};
  const it=x=>`<details class="me-it">
    <summary><span class="me-nm">${x.food}</span>
      ${x.kid?`<span class="me-kid k-${x.kid}" title="${K[x.kid]||""}">${x.kid}</span>`:""}
      ${x.when?`<span class="me-when">${x.when}</span>`:""}
      ${x.planned?`<span class="me-plan">${x.planned}</span>`:`<span class="me-plan off">일정 밖</span>`}</summary>
    <div class="me-in">${x.why?`<p>${x.why}</p>`:""}
      ${x.kid_note?`<div class="rest-kid">👶 ${x.kid_note}</div>`:""}
      ${x.where?`<div class="me-wh">📍 ${x.where}</div>`:""}
      <div class="lnks">${(x.refs||[]).filter(id=>S.rest[id]).map(id=>
        `<button type="button" class="lnk" data-focus="${id}">📍 ${S.rest[id].name}</button>`).join("")}
        <a class="lnk" href="https://map.kakao.com/?q=${enc(x.query||x.food+" 제주")}" target="_blank" rel="noopener">🗺️ 파는 곳 찾기</a></div>
    </div></details>`;
  return `<div class="card must" id="musteat"><div class="me-hd">🍊 제주 가면 꼭 먹는 것
      <span class="deck-sub">아이 입맛 · 우리 일정에서 언제 먹는지</span></div>
    ${me.note?`<p class="me-no">${me.note}</p>`:""}
    <div class="me-list">${me.items.map(it).join("")}</div>
    ${me.snack_note?`<p class="me-no snack">🍡 ${me.snack_note}</p>`:""}</div>`; }

/* ---------- 🎟️ 온라인 예약 할인 · 취소/환불 --------------------------------
   현장 정가와 온라인가를 나란히 놓고 "이 여행에서 얼마 아끼는지"를 코드가 계산한다.
   모델이 쓴 숫자를 그대로 싣지 않는다 — 합계는 항상 데이터에서 다시 더한다.
   환불 규정을 같은 카드에 두는 이유: 아이 동반 여행은 취소가 실제로 일어난다. */
function dealsRefs(p){ const seen=new Set(), out=[];
  const add=r=>{ if(!r||r.startsWith("hotel:")||seen.has(r)) return;
    const a=S.at[r]; if(!a||!a.booking) return; seen.add(r); out.push([r,a]); };
  (p.days||[]).forEach(d=>{ (d.stops||[]).forEach(s=>add(s.ref));
    ((d.picks||{}).options||[]).forEach(o=>add(o.ref)); });
  return out; }

function dealsCard(p){ const rows=dealsRefs(p); if(!rows.length) return "";
  const party=(p.trip||{}).party||{}, ad=party.adults??2, kd=party.kids??2;
  /* 어른·아이 중 한쪽 값만 있으면 합계를 내지 않는다. 반쪽 숫자로 총액을 내면
     "온라인이 더 싸다"를 과장하거나 축소한다 — 모르면 모른다고 적는다. */
  const sum=b=>{ const o=b||{}; if(typeof o.adult!=="number"||typeof o.child!=="number") return null;
    return o.adult*ad + o.child*kd; };
  let save=0, partial=0;
  const body=rows.map(([id,a])=>{ const b=a.booking||{};
    const g=sum(b.gate), o=sum(b.online), cut=(g!=null&&o!=null&&o<g)?g-o:0;
    if(cut) save+=cut; else if(b.online&&o==null) partial++;
    const money = (g==null&&o==null)
      ? `<div class="dl-pr none">요금 미확인 — 전화로 확인하세요</div>`
      : `<div class="dl-pr">${g!=null?(cut?`<s>${won(g)}원</s>`:`<b>${won(g)}원</b>`):""}
          ${cut?`<b>${won(o)}원</b><span class="dl-sv">−${won(cut)}</span>`:""}
          <i>어른${ad}+아이${kd} 합계</i></div>
         ${(b.online&&o==null)?`<div class="dl-ct">온라인가가 한쪽(어른 또는 아이)만 확인돼 합계를 내지 않았습니다.</div>`:""}`;
    return `<details class="dl">
      <summary><span class="dl-nm">${a.name}</span>${b.channel?`<span class="dl-ch">${b.channel}</span>`:""}${b.discount?`<span class="dl-dc">${b.discount}</span>`:""}</summary>
      <div class="dl-in">${money}
        ${b.refund?`<div class="dl-rf"><b>취소·환불</b> ${b.refund}</div>`:""}
        ${b.validity?`<div class="dl-vd"><b>유효기간</b> ${b.validity}</div>`:""}
        ${b.caution?`<div class="dl-ct">⚠️ ${b.caution}</div>`:""}
        <div class="lnks">${b.url?`<a class="lnk go" href="${b.url}" target="_blank" rel="noopener">🎟️ 바로 예약</a>`:""}${b.official?`<a class="lnk" href="${b.official}" target="_blank" rel="noopener">공식</a>`:""}<a class="lnk" href="https://map.naver.com/p/search/${enc(a.name)}" target="_blank" rel="noopener">네이버 지도</a>${b.phone?`<a class="lnk" href="tel:${b.phone.replace(/[^0-9]/g,"")}">📞 ${b.phone}</a>`:""}</div>
      </div></details>`; }).join("");
  return `<div class="card deals" id="deals"><div class="dl-hd">🎟️ 온라인 예약 · 취소/환불
      <span class="deck-sub">확인된 절감 ${save?`약 ${won(save)}원`:"없음"}${partial?` · 부분확인 ${partial}곳`:""}</span></div>
    <p class="me-no">네이버 예약 링크는 이번에 확보하지 못했습니다(네이버 도메인 접근 차단). 아래 "네이버 지도"로 시설을 열어 <b>예약</b> 탭을 직접 확인하세요. 가격은 실제로 열어 본 채널 기준이고, 확인 못 한 것은 비워 뒀습니다.</p>
    <p class="me-no">⚠️ 9월 하순 제주는 태풍 영향권이 남습니다. 야외·해상 시설은 <b>날짜지정권을 사지 말고</b> "미사용 100% 환불" 오픈권으로 사세요.</p>
    ${body}</div>`; }

/* ---------- ✈️ 출발 공항 허브(김포) — 게이트 전에 뭘 먹나 ------------------ */
function hubCard(){ const h=S.city.departure_hub; if(!h) return "";
  const f=(h.food||[]).map(x=>`<details class="hb-f">
      <summary><span class="me-nm">${x.name}</span>${x.floor?`<span class="hb-fl">${x.floor}</span>`:""}${x.kid?`<span class="me-kid k-${x.kid}">${x.kid}</span>`:""}${x.open?`<span class="me-when">${x.open}~</span>`:""}</summary>
      <div class="me-in">${x.type||x.price?`<div class="rest-mn">${[x.type,x.price].filter(Boolean).join(" · ")}</div>`:""}${x.note?`<div class="rest-kid">👶 ${x.note}</div>`:""}
      <div class="lnks"><a class="lnk" href="https://map.naver.com/p/search/${enc(h.map_prefix?h.map_prefix+" "+x.name:x.name)}" target="_blank" rel="noopener">네이버 지도</a></div></div></details>`).join("");
  return `<div class="card hub" id="hub"><div class="hb-hd">✈️ ${h.name}
      ${h.subtitle?`<span class="deck-sub">${h.subtitle}</span>`:""}</div>
    ${h.reality?`<p class="hb-real">⚠️ ${h.reality}</p>`:""}
    ${(h.timeline||[]).length?`<ol class="hb-tl">${h.timeline.map(t=>`<li><b>${t.t}</b> ${t.what}</li>`).join("")}</ol>`:""}
    ${(h.floors||[]).length?`<div class="hb-fls">${h.floors.map(x=>`<div><b>${x.f}</b> ${x.what}</div>`).join("")}</div>`:""}
    ${f?`<div class="hb-flist">${f}</div>`:""}
    ${h.note?`<p class="me-no">${h.note}</p>`:""}</div>`; }

function packingCard(){ const pk=S.city.packing; if(!pk) return "";
  const item=(x,i,g)=>{const k=`pk_${S.city.id}_${g}_${i}`;return `<label class="pk"><input type="checkbox" data-k="${k}" ${localStorage.getItem(k)?"checked":""}><span>${x}</span></label>`;};
  return `<div class="card pack"><div class="pack-hd">🧳 여행 준비물 <span class="deck-sub">체크하며 챙기세요</span></div>
    <div class="pack-grp">공통</div><div class="pack-list">${pk.common.map((x,i)=>item(x,i,"c")).join("")}</div>
    <div class="pack-grp">${S.city.name} 맞춤</div><div class="pack-list">${pk.specific.map((x,i)=>item(x,i,"s")).join("")}</div></div>`; }

async function boot(){
  $("#repoLink").href=REPO_URL+"#readme";
  S.cities=(await fetch("data/cities.json").then(r=>r.json())).cities;
  renderCityPicker();
  const h=location.hash.replace("#","").split("/");
  await selectCity(S.cities.find(c=>c.id===h[0])?h[0]:S.cities[0].id, h[1]);
  $("#cmpBtn").onclick=toggleCompare;
  $("#buildBtn").onclick=openBuilder;
  $("#liveBtn").onclick=openLive;
}

function renderCityPicker(){ const el=$("#cityPicker"); el.innerHTML="";
  S.cities.forEach(c=>{ const b=document.createElement("button");
    b.className="city-btn"+(c.id===(S.city&&S.city.id)?" active":""); b.textContent=`${c.emoji} ${c.name}`;
    b.dataset.id=c.id; b.onclick=()=>selectCity(c.id); el.appendChild(b); }); }

async function selectCity(id, wantPlan){
  S.city=S.cities.find(c=>c.id===id); const d=S.city.dir;
  const [plans,hotels,at,rest]=await Promise.all([
    fetch(`${d}/plans.json`).then(r=>r.json()),
    fetch(`${d}/hotels.json`).then(r=>r.json()),
    fetch(`${d}/attractions.json`).then(r=>r.json()),
    fetch(`${d}/restaurants.json`).then(r=>r.ok?r.json():{}).catch(()=>({}))]);
  S.plans=plans.plans; S.hotels=hotels; S.at=at; S.rest=rest||{};
  loadFavs(); restoreCustom();
  document.querySelectorAll(".city-btn").forEach(b=>b.classList.toggle("active",b.dataset.id===id));
  $("#builder").hidden=true; $("#compare").hidden=true;
  renderPlanPicker(); renderFavPill();
  selectPlan(wantPlan && S.plans.find(p=>p.id===wantPlan) ? wantPlan : S.plans[0].id);
}

/* "지금" 화면이 장소·맛집 이름을 물어볼 수 있게 접근자를 노출한다.
   S 를 통째로 열지 않는 이유: 읽기 전용 조회 두 개면 충분하다. */
window.__tripPlace=ref=>place(ref);
window.__tripRest=id=>S.rest[id];
function place(ref){ if(ref.startsWith("hotel:")){ const h=S.hotels[ref.slice(6)]; return h&&{...h,_type:"hotel"}; }
  const a=S.at[ref]; return a&&{...a,_type:"poi"}; }

function renderPlanPicker(){ const el=$("#planPicker"); el.innerHTML="";
  S.plans.forEach(p=>{ const b=document.createElement("button");
    b.className="plan-btn"+(p.id===S.cur?" active":"")+(p.id==="custom"?" custom":"");
    b.innerHTML=(localStorage.getItem(`cfm_${S.city.id}_${p.id}`)?'<span class="chk">✓</span> ':'')+(p.id==="custom"?"🧩 ":"")+p.short;
    b.dataset.id=p.id; b.onclick=()=>selectPlan(p.id); el.appendChild(b); }); }

function selectPlan(id){ S.cur=id; location.hash=`${S.city.id}/${id}`; $("#compare").hidden=true; $("#builder").hidden=true; const lv=$("#live"); if(lv) lv.hidden=true;
  document.querySelectorAll(".plan-btn").forEach(b=>b.classList.toggle("active",b.dataset.id===id));
  const p=S.plans.find(x=>x.id===id); if(!p) return;
  S.drive=!!(p.trip&&p.trip.rentcar);   // 구간 계산 모드(자차 vs 대중교통)
  renderHead(p); renderMap(p); renderSide(p); renderCost(p); renderConfirm(p);
  broadcastCtx(p);
  window.scrollTo({top:0,behavior:"smooth"}); }

/* 도시/숙소 상태의 단일 출처(single source of truth)는 이 파일이다.
   계산기(calc.js)는 자체 도시 상태를 갖지 않고 이 이벤트만 따라간다.
   (과거 버그: 제주 탭을 눌러도 계산기가 부산 호텔을 계속 보여줌 = 상태 이중화) */
function broadcastCtx(p){
  const ctx={city:S.city.id, hotel:(p&&p.base_hotel)||null, plan:(p&&p.id)||null};
  window.__tripCtx=ctx;                                   // calc.js 가 늦게 초기화돼도 받도록
  document.dispatchEvent(new CustomEvent("tripcontext",{detail:ctx}));
}

function renderHead(p){ $("#planHead").innerHTML=`
  ${S.city.hero?`<img class="phero" src="${S.city.hero}" alt="${S.city.name}" onerror="this.style.display='none'">`:""}
  <div class="ph-top"><span class="ph-city">${S.city.emoji} ${S.city.name}</span><span class="ph-arr">${S.city.arrival}</span></div>
  <h2>${p.title}</h2>
  <p class="pintro">${p.intro||p.subtitle||""}</p>
  ${p.recommended_for?`<p class="recfor">👨‍👩‍👧‍👧 이런 가족에게 &nbsp;<b>${p.recommended_for}</b></p>`:""}
  ${p.trip?`<p class="phdate">🗓️ ${kdate(p.trip.start)} ~ ${kdate(p.trip.end)} <b>${DDAY(p.trip.start)}</b></p>`:""}
  <div class="chips">
    ${(p.chips||[]).map(c=>`<span class="chip">${c}</span>`).join("")}
    ${p.total!=null?`<span class="chip total">예상 총경비 ${won(p.total)}원</span>`:""}
    ${p.budget?`<span class="chip ok">예산 ${won(p.budget)}원 이내 👍</span>`:""}
  </div>`; }

function orderedStops(p){ const o=[]; let n=0;
  p.days.forEach(d=>d.stops.forEach(s=>{ const h=s.ref.startsWith("hotel:"); o.push({...s,day:d.day,isHotel:h,n:h?null:++n}); })); return o; }

function renderMap(p){ if(S.map){ S.map.remove(); S.map=null; }
  const map=L.map("map",{scrollWheelZoom:true}); S.map=map;
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"&copy; OpenStreetMap"}).addTo(map);
  const pts=[];
  p.days.forEach(d=>{ const co=d.stops.map(s=>place(s.ref)).filter(x=>x&&x.lat).map(x=>[x.lat,x.lon]);
    if(co.length>1) L.polyline(co,{color:DAYCOL[d.day]||"#333",weight:4,opacity:.75,dashArray:"2 8"}).addTo(map); });
  orderedStops(p).forEach(s=>{ const a=place(s.ref); if(!a||!a.lat) return;
    const html=s.isHotel?`<div class="pin hotel"><span>🏨</span></div>`:`<div class="pin d${s.day}"><span>${s.n}</span></div>`;
    L.marker([a.lat,a.lon],{icon:L.divIcon({className:"",html,iconSize:[32,32],iconAnchor:[16,30]})}).addTo(map).bindPopup(s.isHotel?popupHotel(a):popupPoi(a,s)); pts.push([a.lat,a.lon]); });
  if(pts.length) map.fitBounds(pts,{padding:[48,48]});
  renderFoodMarkers(p);
  renderMapActions(p); renderVideo(); setTimeout(()=>map.invalidateSize(),120); }

/* 이 여행안 식사에 등장하는 맛집 id (중복 제거, 등장 순서 유지) */
function planRestIds(p){ const seen=new Set(), out=[];
  (p.days||[]).forEach(d=>(d.meals||[]).forEach(m=>(m.candidates||[]).forEach(id=>{
    if(!seen.has(id)&&S.rest[id]&&S.rest[id].lat){ seen.add(id); out.push(id); } })));
  return out; }

const FOOD_KEY="showFood";
function foodOn(){ return localStorage.getItem(FOOD_KEY)!=="0"; }   // 기본 ON

/* 맛집 = 동선 핀(물방울·일자색)과 색·모양을 모두 달리한 원형 라즈베리 마커.
   색만으로 구분하지 않는다(색각 이상 대응) — 모양도 다르다. */
function renderFoodMarkers(p){ const map=S.map; if(!map) return;
  if(S.foodLayer){ map.removeLayer(S.foodLayer); S.foodLayer=null; }
  S.restMarkers={};
  const ids=planRestIds(p); if(!ids.length) return;
  const layer=L.layerGroup();
  ids.forEach(id=>{ const r=S.rest[id];
    const mk=L.marker([r.lat,r.lon],{icon:L.divIcon({className:"",html:'<div class="fpin"><span>🍴</span></div>',
      iconSize:[26,26],iconAnchor:[13,13]}),zIndexOffset:-200});
    mk.bindPopup(popupRest(r)); layer.addLayer(mk); S.restMarkers[id]=mk; });
  S.foodLayer=layer; if(foodOn()) layer.addTo(map); }

function popupRest(r){ return `<div class="pop"><h4>🍴 ${r.name}${r.category?` <small>${r.category}</small>`:""}</h4>${ratingLine(r)}
  <p class="pm">${[r.menu,r.price].filter(Boolean).join(" · ")}</p>${r.kid_note?`<p class="pm">👶 ${r.kid_note}</p>`:""}
  <div class="pl">${r.naver?`<a href="${r.naver}" target="_blank" rel="noopener">네이버</a>`:""}<a href="https://map.kakao.com/?q=${enc(r.name)}" target="_blank" rel="noopener">카카오맵</a>${r.phone?`<a href="tel:${r.phone}">전화</a>`:""}</div></div>`; }

/* 사이드바 → 지도. 목록에서 누른 그 집을 지도에서 바로 보여준다. */
function focusRest(id){ const mk=S.restMarkers&&S.restMarkers[id], r=S.rest[id]; if(!mk||!r) return;
  if(S.foodLayer&&!S.map.hasLayer(S.foodLayer)){ S.foodLayer.addTo(S.map); localStorage.setItem(FOOD_KEY,"1"); syncFoodBtn(); }
  S.map.setView([r.lat,r.lon],16,{animate:true}); mk.openPopup();
  document.querySelector(".map-wrap")?.scrollIntoView({behavior:"smooth",block:"nearest"}); }

/* 상단 고정바(브랜드+도시+여행안)의 실제 높이를 CSS 변수로 흘려보낸다.
   모바일에선 컨트롤이 2줄로 접혀 137px, 태블릿은 100px 로 제각각이라 하드코딩하면
   점프바가 상단바 뒤로 숨는다(2026-08-03 측정). */
function syncStickyH(){
  const tb=document.querySelector(".topbar"), pb=document.querySelector(".plan-bar");
  if(!tb) return;
  const tbH=Math.round(tb.getBoundingClientRect().height);
  let hgt=tbH;
  if(pb&&getComputedStyle(pb).position==="sticky") hgt+=Math.round(pb.getBoundingClientRect().height);
  const st=document.documentElement.style;
  st.setProperty("--tb-h",tbH+"px");          // 여행안 바가 이 아래에 붙는다
  st.setProperty("--topbar-h",hgt+"px");      // 점프바·스크롤 오프셋 기준
}
let _syncT; function scheduleSync(){ clearTimeout(_syncT); _syncT=setTimeout(syncStickyH,80); }
window.addEventListener("resize",scheduleSync);
window.addEventListener("orientationchange",scheduleSync);
if(window.ResizeObserver) new ResizeObserver(scheduleSync).observe(document.documentElement);

function syncFoodBtn(){ const b=document.getElementById("foodBtn"); if(!b) return;
  const on=foodOn(); b.classList.toggle("off",!on); b.setAttribute("aria-pressed",String(on));
  b.textContent=on?"🍴 맛집 핀 켬":"🍴 맛집 핀 끔"; }

function popupPoi(a,s){ const img=resolveImg(a);
  return `<div class="pop">${img?`<img src="${img}" alt="${a.name}" onerror="this.style.display='none'">`:""}
    <h4>${s.n}. ${a.name}</h4>${ratingLine(a)}<p class="pm">${a.price_hours||a.blurb||""}</p>
    <div class="pl">${a.naver?`<a href="${a.naver}" target="_blank" rel="noopener">네이버</a>`:""}${a.official?`<a href="${a.official}" target="_blank" rel="noopener">예매</a>`:""}<a href="${kakaoTo(a)}" target="_blank" rel="noopener">🚕</a></div></div>`; }
function popupHotel(h){ return `<div class="pop"><h4>🏨 ${h.name}</h4>${ratingLine(h)}${h.pool?`<p class="pm">🏊 ${h.pool}</p>`:""}<p class="pm">${h.price_range||""}</p>
    <div class="pl">${h.naver_map?`<a href="${h.naver_map}" target="_blank" rel="noopener">네이버</a>`:""}${h.booking?`<a href="${h.booking}" target="_blank" rel="noopener">예약</a>`:""}${h.phone?`<a href="tel:${h.phone}">전화</a>`:""}<a href="${kakaoTo(h)}" target="_blank" rel="noopener">🚕</a></div></div>`; }

function gmapsDir(stops){ const c=stops.map(s=>place(s.ref)).filter(x=>x&&x.lat); if(c.length<2) return null;
  const o=c[0],dd=c[c.length-1],w=c.slice(1,-1).map(x=>`${x.lat},${x.lon}`).join("|");
  let u=`https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lon}&destination=${dd.lat},${dd.lon}&travelmode=transit`;
  if(w) u+=`&waypoints=${enc(w)}`; return u; }
function renderMapActions(p){ const el=$("#mapActions"); el.innerHTML="";
  const g=gmapsDir(p.days.flatMap(d=>d.stops));
  if(g) el.insertAdjacentHTML("beforeend",`<a href="${g}" target="_blank" rel="noopener">🧭 구글맵 전체 길찾기</a>`);
  if(p.kml) el.insertAdjacentHTML("beforeend",`<a href="${p.kml}" download>⬇️ KML(구글 마이맵)</a>`);
  el.insertAdjacentHTML("beforeend",`<a href="${S.city.dir}/all.kml" download title="다운로드 후 구글 마이맵(mymaps.google.com)에서 가져오기→업로드">🗺️ 구글 마이맵용 KML (${S.city.name} 전체)</a>`);
  el.insertAdjacentHTML("beforeend",`<button id="printBtn">🖨️ 전체 요약 인쇄</button>`);
  $("#printBtn").onclick=()=>openPrint(p);
  if(p.days.some(d=>(d.picks&&(d.picks.options||[]).length))){
    el.insertAdjacentHTML("beforeend",`<button id="pickBtn" class="pickbtn">🙋 고르기 시트 (A4)</button>`);
    $("#pickBtn").onclick=()=>openPickSheet(p); }
  if(planRestIds(p).length){
    el.insertAdjacentHTML("afterbegin",`<button id="foodBtn" class="foodbtn" aria-pressed="true">🍴 맛집 핀 켬</button>`);
    syncFoodBtn();
    $("#foodBtn").onclick=()=>{ const on=!foodOn(); localStorage.setItem(FOOD_KEY,on?"1":"0");
      if(S.foodLayer){ on?S.foodLayer.addTo(S.map):S.map.removeLayer(S.foodLayer); } syncFoodBtn(); };
  } }

/* 맛집 = 요약 한 줄(항상 보임) + 펼침 상세(전체 정보, 삭제 없음).
   맨 위 후보(가장 가까운 집)는 펼친 채로 두고 나머지는 접는다 — 전부 펼치면
   식사 한 끼가 790px 를 먹어 오른쪽 컬럼이 1만 px 로 늘어난다(2026-08-03 실측). */
function restCard(id,open){ const r=S.rest[id]; if(!r) return "";
  const rv=r.reviews?(r.reviews>=1000?(r.reviews/1000).toFixed(1)+"k":r.reviews):null;
  const sum=[r.category,r.price].filter(Boolean).join(" · ");
  return `<details class="rest"${open?" open":""}>
    <summary>
      <span class="rest-nm">${r.name}</span>
      ${r.rating!=null?`<span class="rest-rt">★ ${r.rating}${rv?`<i>(${rv})</i>`:""}</span>`:""}
      ${sum?`<span class="rest-sum">${sum}</span>`:""}
      ${r.lat?`<button class="rest-map" type="button" data-focus="${id}" title="지도에서 보기" aria-label="${r.name} 지도에서 위치 보기">📍</button>`:""}
    </summary>
    <div class="rest-in">
      ${r.sentiment?`<div class="rate"><span class="senti">“${r.sentiment}”</span></div>`:""}
      ${r.menu?`<div class="rest-mn">${r.menu}</div>`:""}
      ${r.kid_note?`<div class="rest-kid">👶 ${r.kid_note}</div>`:""}${r.wait?`<div class="rest-wt">⏱️ ${r.wait}</div>`:""}
      <div class="lnks">${r.naver?`<a class="lnk" href="${r.naver}" target="_blank" rel="noopener">네이버</a>`:""}${r.phone?`<a class="lnk" href="tel:${r.phone}">📞 ${r.phone}</a>`:""}<a class="lnk" href="https://map.kakao.com/?q=${enc(r.name)}" target="_blank" rel="noopener">🗺️ 카카오맵</a>${favBtn(id,"R")}</div>
      ${reviewLinks(r.name,"food")}
    </div></details>`; }

/* 끼니 아이콘 — 아침은 호텔 조식, 간식은 따로 보이게 한다.
   전부 🍽️ 로 뭉개면 "간식을 넣었다"는 사실 자체가 화면에서 안 보인다. */
const SLOT_IC={"아침":"🏨","간식":"🍡","야식":"🌙","커피":"☕"};
const slotIc=s=>SLOT_IC[s]||"🍽️";

function mealBlock(mm,domId){ const bf=mm.buffet;
  /* 아침을 전부 호텔 조식으로 못 박았으므로, 조식 카드는 접힌 채로 두면 안 된다 —
     그날 아침에 실제로 필요한 정보(여는 시각·어디로 가나)가 안 보인다. 기본 펼침. */
  const b=bf?`<details class="rest buffet" open><summary><span class="rest-nm">🏨 ${bf.name}</span><span class="rest-sum">호텔 조식·뷔페</span></summary><div class="rest-in">${bf.hours?`<div class="rest-wt">⏱️ ${bf.hours}</div>`:""}${bf.place?`<div class="me-wh">📍 ${bf.place}</div>`:""}${bf.price?`<div class="rest-mn">${bf.price}</div>`:""}${bf.kid_note?`<div class="rest-kid">👶 ${bf.kid_note}</div>`:""}<div class="lnks">${bf.naver?`<a class="lnk" href="${bf.naver}" target="_blank" rel="noopener">네이버</a>`:""}</div></div></details>`:"";
  const n=(mm.candidates||[]).length;
  return `<div class="meal${mm.slot==="간식"?" snack":""}${mm.slot==="아침"?" bfast":""}"${domId?` id="${domId}"`:""}><div class="meal-slot">${mm.time?`<span class="meal-t">${mm.time}</span>`:""}${slotIc(mm.slot)} ${mm.slot} <span class="meal-near">${mm.near}${mm.near_suffix||" 근처"}</span>
      ${n>1?`<button class="meal-all" type="button" data-all="1">모두 펼치기</button>`:""}</div>
    ${mm.note?`<p class="meal-no">${linkify(mm.note)}</p>`:""}
    ${b}${mm.candidates.map((id,i)=>restCard(id,i===0)).join("")}</div>`; }

/* 메모 안의 https:// 링크를 실제 링크로. 데이터에 URL 을 넣어두면 그대로 눌린다. */
function linkify(t){ return String(t).replace(/(https?:\/\/[^\s<]+)/g,'<a class="lnk" href="$1" target="_blank" rel="noopener">🗺️ 지도에서 찾기</a>'); }

/* ---------- 확정 일정(trip): 날짜/항공/숙소/렌터카/주의/차 안 놀이 ---------- */
const DDAY=iso=>{ const t=new Date(iso+"T00:00:00"), n=new Date(); n.setHours(0,0,0,0);
  const d=Math.round((t-n)/86400000); return d>0?`D-${d}`:d===0?"D-DAY":`D+${-d}`; };
const kdate=iso=>{ const d=new Date(iso+"T00:00:00");
  return `${d.getFullYear()}. ${d.getMonth()+1}. ${d.getDate()} (${"일월화수목금토"[d.getDay()]})`; };

function tripCards(p){ const t=p.trip; if(!t) return "";
  const h=S.hotels[(t.lodging||{}).ref]||S.hotels[p.base_hotel]||{};
  const fl=(t.flights||[]).map(f=>`<div class="tg"><b>✈️ ${f.dir}</b>
      <span class="tg-v">${f.date.slice(5).replace("-","/")} · ${f.airline} · ${f.from} <i>${f.dep}</i> → ${f.to} <i>${f.arr}</i></span>
      ${f.note?`<em>${f.note}</em>`:""}</div>`).join("");
  const lg=t.lodging?`<div class="tg"><b>🏨 숙소</b><span class="tg-v">${h.name||""} · ${t.lodging.nights_label||(t.nights+"박")} · 체크인 ${t.lodging.checkin} / 체크아웃 ${t.lodging.checkout}</span>${t.lodging.note?`<em>${t.lodging.note}</em>`:""}</div>`:"";
  const rc=t.rentcar||{};
  let out=`<div class="card trip"><div class="trip-hd">📌 확정 일정<span class="trip-dd">${DDAY(t.start)}</span></div>
    <div class="trip-when">${kdate(t.start)} ~ ${kdate(t.end)} · ${t.nights}박 ${t.nights+1}일 · ${(t.party||{}).label||""}</div>
    <div class="trip-grid">${fl}${lg}
      ${rc.vendor?`<div class="tg"><b>🚗 렌터카</b><span class="tg-v">${rc.vendor} · ${rc.car||""}</span></div>`:""}</div></div>`;

  if(rc.pickup_steps) out+=`<div class="card rentcar"><div class="rc-hd">🚗 ${rc.pickup_title||"렌터카 인수"}</div>
    <ol class="rc-steps">${rc.pickup_steps.map(x=>`<li>${x}</li>`).join("")}</ol>
    ${rc.pickup_note?`<p class="rc-no">${rc.pickup_note}</p>`:""}
    ${rc.check?`<div class="rc-chk"><b>차 받을 때 확인할 것</b><ul>${rc.check.map(x=>`<li>${x}</li>`).join("")}</ul></div>`:""}
    ${rc.return_note?`<p class="rc-no ret"><b>반납</b> ${rc.return_note}</p>`:""}</div>`;

  if(t.alerts&&t.alerts.length) out+=`<div class="card alerts">${t.alerts.map(a=>
    `<div class="al ${a.level||"info"}"><b>${{crit:"⛔",warn:"⚠️"}[a.level]||"ℹ️"} ${a.title}</b><p>${a.body}</p></div>`).join("")}</div>`;

  const kp=t.kid_play;
  if(kp&&kp.games) out+=`<div class="card kidplay"><div class="kp-hd">🎲 ${kp.title||"차 안에서 노는 법"}</div>
    ${kp.games.map(g=>`<div class="kp"><b>${g.name}</b><span>${g.how}</span></div>`).join("")}</div>`;
  return out; }

function renderSide(p){ const el=$("#side"); el.innerHTML="";
  const h=S.hotels[p.base_hotel];
  // 긴 컬럼을 훑지 않고 바로 뛸 수 있게 — 오른쪽이 1만 px 이라 스크롤만으론 길을 잃는다
  el.insertAdjacentHTML("beforeend",`<nav class="daynav" aria-label="일정 바로가기">
    <a href="#top" data-jump="top">🏨 숙소·예매</a>
    ${S.city.departure_hub?`<a href="#hub" data-jump="hub">✈️ 출발</a>`:""}
    ${dealsRefs(p).length?`<a href="#deals" data-jump="deals">🎟️ 예약</a>`:""}
    ${(S.city.must_eat&&(S.city.must_eat.items||[]).length)?`<a href="#musteat" data-jump="musteat">🍊 먹거리</a>`:""}
    ${p.days.map(d=>`<a href="#day${d.day}" data-jump="day${d.day}" style="--dc:${DAYCOL[d.day]||'#333'}">${d.date_label||(d.day+"일차")}</a>`).join("")}
    <a href="#cost" data-jump="cost">💳 비용</a></nav>`);
  el.insertAdjacentHTML("beforeend",tripCards(p));
  if(h) el.insertAdjacentHTML("beforeend",`<div class="card hotel"><div class="hd">🏨 베이스 숙소 · ${p.nights||2}박</div>
    ${resolveImg(h)?`<img class="hbanner" src="${resolveImg(h)}" alt="${h.name}" onerror="this.style.display='none'">`:""}<div class="in"><div class="grow"><p class="nm">${h.name}</p>${ratingLine(h)}${h.pool?`<p class="pool">🏊 ${h.pool}</p>`:""}<p class="meta">${h.family_note||""}</p><p class="price">${h.price_range||""}</p>
    <div class="lnks">${h.naver_map?`<a class="lnk" href="${h.naver_map}" target="_blank" rel="noopener">네이버 지도</a>`:""}${h.booking?`<a class="lnk" href="${h.booking}" target="_blank" rel="noopener">예약</a>`:""}${h.phone?`<a class="lnk" href="tel:${h.phone}">📞 ${h.phone}</a>`:""}<a class="lnk" href="${kakaoTo(h)}" target="_blank" rel="noopener">🚕 카카오T</a></div>
    ${reviewLinks(h.name,"hotel")}</div></div></div>`);
  el.insertAdjacentHTML("beforeend",bookingCard());
  el.insertAdjacentHTML("beforeend",hubCard());
  el.insertAdjacentHTML("beforeend",dealsCard(p));
  el.insertAdjacentHTML("beforeend",mustEatCard());
  if(p.decisions&&p.decisions.length) el.insertAdjacentHTML("beforeend",`<div class="card deck"><div class="deck-hd">✅ 결정 체크리스트 <span class="deck-sub">배우자 컨펌용</span></div>
    ${p.decisions.map((x,i)=>{const k=`chk_${S.city.id}_${p.id}_${i}`;return `<label class="deci"><input type="checkbox" data-k="${k}" ${localStorage.getItem(k)?"checked":""}><span><b>${x.label}</b><em>${x.note||""}</em></span></label>`;}).join("")}</div>`);
  const ct=S.city.city_tour;
  if(ct) el.insertAdjacentHTML("beforeend",`<div class="card tour"><div class="tour-hd">🚌 ${ct.name}</div><p class="tour-tx">${ct.note}</p>
    <div class="lnks">${ct.url?`<a class="lnk" href="${ct.url}" target="_blank" rel="noopener">홈페이지</a>`:""}${ct.booking?`<a class="lnk" href="${ct.booking}" target="_blank" rel="noopener">예약</a>`:""}${ct.phone?`<a class="lnk" href="tel:${ct.phone}">📞 ${ct.phone}</a>`:""}</div></div>`);
  p.days.forEach(d=>{ const col=DAYCOL[d.day]||"#333", g=gmapsDir(d.stops); let rows="";
    const strip=[];   // 하루 흐름 한 줄 요약 — 세부를 다 읽지 않고도 동선을 잡는다
    const mealsAfter=i=>(d.meals||[]).filter(m=>m.after===i).map((m,j)=>{
      strip.push({k:`d${d.day}m${i}_${j}`,t:m.slot,food:true});
      return mealBlock(m,`d${d.day}m${i}_${j}`); }).join("");
    rows+=mealsAfter(-1);
    for(let i=0;i<d.stops.length;i++){ const s=d.stops[i], a=place(s.ref); if(!a) continue;
      const isH=s.ref.startsWith("hotel:"), label=isH?"🏨":numFor(p,d,i), img=!isH?resolveImg(a):null;
      strip.push({k:`d${d.day}s${i}`,t:a.name,time:s.time,num:isH?"🏨":label});
      rows+=`<div class="stop" id="d${d.day}s${i}"><div class="num"${isH?' style="background:#111"':''}>${label}</div>
        ${img?`<img class="thumb" src="${img}" alt="${a.name}" onerror="this.style.display='none'">`:""}
        <div class="body"><div class="nmrow">${s.time?`<span class="t">${s.time}</span>`:""}<span class="nm">${a.name}</span>${s.optional?'<span class="lnk opt">선택</span>':''}</div>
        ${(!isH&&!TRANSIT.has(a.category))?`<span class="livewrap" data-lat="${a.lat}" data-lon="${a.lon}" data-cat="${a.category}"></span>`:""}${ratingLine(a)}${s.note?`<div class="no">${s.note}</div>`:""}
        <div class="lnks">${(a.naver||a.naver_map)?`<a class="lnk" href="${a.naver||a.naver_map}" target="_blank" rel="noopener">네이버</a>`:""}${a.official?`<a class="lnk" href="${a.official}" target="_blank" rel="noopener">예매</a>`:""}${(!isH&&!TRANSIT.has(a.category))?favBtn(s.ref,"A"):""}</div>${!isH?reviewLinks(a.name,"spot"):""}</div></div>`;
      if(i<d.stops.length-1){ const b=place(d.stops[i+1].ref), lg=leg(a,b);
        if(lg) rows+=`<div class="leg"><span class="lg-ic">${lg.icon}</span><span class="lg-tx">${lg.mode} · 약 ${lg.mins}분${lg.cost?` · ₩${won(lg.cost)}`:" · 무료"}<span class="lg-no">${lg.note||""}</span></span>${lg.link?`<a class="lg-lk" href="${lg.link}" target="_blank" rel="noopener">${lg.linklabel}</a>`:""}</div>`; }
      rows+=mealsAfter(i);
    }
    const stripHtml=strip.length?`<div class="dstrip" role="list" aria-label="${d.day}일차 흐름 요약">${
      strip.map(x=>`<button type="button" role="listitem" class="dchip${x.food?" food":""}" data-goto="${x.k}">${
        x.food?`${slotIc(x.t)} ${x.t}`:`${x.time?`<i>${x.time}</i>`:`<i>${x.num}</i>`}${x.t}`}</button>`).join('<span class="darr" aria-hidden="true">›</span>')}</div>`:"";
    el.insertAdjacentHTML("beforeend",`<div class="card day-block" id="day${d.day}"><div class="day-hd" style="background:${col}"><h3>${d.date_label?`<span class="dh-dt">${d.date_label}</span>`:""}<span class="dh-n">${d.day}일차</span> · ${d.label||""}</h3>${g?`<a class="zone" href="${g}" target="_blank" rel="noopener">🧭 길찾기</a>`:""}</div>${d.dad_tip?`<p class="dad-tip">👨‍👧‍👧 ${d.dad_tip}</p>`:""}${stripHtml}<div class="day-body">${rows}</div>${picksBlock(p,d)}</div>`);
  });
  if(p.highlights&&p.highlights.length) el.insertAdjacentHTML("beforeend",`<div class="card hilite"><div class="hl-hd">✨ 이 여행의 하이라이트</div>${p.highlights.map(x=>`<div class="hl"><b>${x.name}</b> — ${x.blurb}</div>`).join("")}</div>`);
  el.insertAdjacentHTML("beforeend",packingCard());
  el.querySelectorAll("input[data-k]").forEach(cb=>cb.onchange=()=>{ cb.checked?localStorage.setItem(cb.dataset.k,"1"):localStorage.removeItem(cb.dataset.k); });
  // 📍 지도 보기 — summary 안의 버튼이라 details 토글로 새지 않게 막는다
  el.querySelectorAll("[data-focus]").forEach(b=>b.onclick=e=>{ e.preventDefault(); e.stopPropagation(); focusRest(b.dataset.focus); });
  el.querySelectorAll(".meal-all").forEach(b=>b.onclick=()=>{ const box=b.closest(".meal");
    const ds=[...box.querySelectorAll("details.rest")], open=ds.some(d=>!d.open);
    ds.forEach(d=>{ d.open=open; }); b.textContent=open?"모두 접기":"모두 펼치기"; });
  el.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>{ const t=document.getElementById(b.dataset.goto);
    if(!t) return; t.scrollIntoView({behavior:"smooth",block:"center"});
    t.classList.add("flash"); setTimeout(()=>t.classList.remove("flash"),1200); });
  el.querySelectorAll("[data-jump]").forEach(a=>a.onclick=e=>{ e.preventDefault();
    const k=a.dataset.jump, t=k==="top"?document.querySelector(".layout"):document.getElementById(k);
    t?.scrollIntoView({behavior:"smooth",block:"start"}); });
  bindPicks(el,p); bindFavs(el); fillLive(p); syncStickyH();
  // 기록 레이어(미션·사진·하루 마감)는 별도 파일이 소유한다. 없으면 그냥 지나간다.
  window.__tripPlace=place;
  if(window.TripRecordUI) window.TripRecordUI.mount(p).catch(e=>console.error("record mount",e));
  if(window.TripNow) window.TripNow.mount(p); }
function numFor(p,day,idx){ let n=0; for(const d of p.days){ for(let i=0;i<d.stops.length;i++){ if(!d.stops[i].ref.startsWith("hotel:")) n++; if(d===day&&i===idx) return n; } } return n; }

function renderCost(p){ const el=$("#cost"); if(!p.cost||!p.cost.length){ el.innerHTML=""; return; }
  const rows=p.cost.map(c=>`<tr><td class="cat">${c.cat}</td><td class="detail">${c.detail||""}</td><td class="n">${won(c.amount)}</td><td>${c.type?`<span class="badge ${c.type==='확정'?'f':'e'}">${c.type}</span>`:""}</td></tr>`).join("");
  const left=p.budget?p.budget-p.total:null;
  el.innerHTML=`<div class="card"><h3>💰 전체 경비 (${p.people||4}인 기준) · 식비는 위 맛집 참고</h3>
    <div class="tbl-wrap"><table><thead><tr><th>항목</th><th>내역</th><th class="n">금액(원)</th><th>구분</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>합계</td><td class="detail">${p.budget?`예산 ${won(p.budget)}원 이내`:""}</td><td class="n">${won(p.total)}</td><td></td></tr>
    ${left!=null?`<tr class="buf"><td>남는 여유</td><td class="detail">업그레이드 여력</td><td class="n">+${won(left)}</td><td></td></tr>`:""}</tfoot></table></div></div>`; }

function renderConfirm(p){ const el=$("#confirmBar"), key=`cfm_${S.city.id}_${p.id}`, done=localStorage.getItem(key);
  const cnt=S.plans.filter(x=>localStorage.getItem(`cfm_${S.city.id}_${x.id}`)).length;
  el.innerHTML=`<span class="st">${done?`✓ <b>${p.short}</b> 컨펌함`:`이 여행안이 마음에 드나요?`} · ${S.city.name} 컨펌 ${cnt}개</span>
    <button class="btn p ${done?'done':''}" id="cfm">${done?'컨펌 취소':'이 안으로 컨펌 👍'}</button><button class="btn s" id="shr">🔗 링크 공유</button>`;
  $("#cfm").onclick=()=>{ done?localStorage.removeItem(key):localStorage.setItem(key,new Date().toISOString()); renderPlanPicker(); renderConfirm(p); document.querySelectorAll(".plan-btn").forEach(b=>b.classList.toggle("active",b.dataset.id===p.id)); };
  $("#shr").onclick=async()=>{ const url=location.origin+location.pathname+`#${S.city.id}/${p.id}`; try{ await navigator.clipboard.writeText(url); $("#shr").textContent="✓ 복사됨"; setTimeout(()=>$("#shr").textContent="🔗 링크 공유",1500);}catch(e){ prompt("링크:",url);} }; }

/* ---------- compare ---------- */
function toggleCompare(){ const el=$("#compare"); $("#builder").hidden=true; if(!el.hidden){ el.hidden=true; return; }
  const rows=S.plans.map(p=>{ const done=localStorage.getItem(`cfm_${S.city.id}_${p.id}`), m=p.metrics||{};
    return `<tr><td class="cat">${p.id==="custom"?"🧩 ":""}${p.short}${done?' <span class="chk">✓</span>':''}<div class="cmp-sub">${p.recommended_for||""}</div></td>
      <td class="n">${won(p.total)}</td><td class="n">${m.stops??"-"}곳</td><td class="n">${m.meals??"-"}끼</td><td class="n">${m.indoor??"-"}</td><td class="n">${m.kid??"-"}</td>
      <td><button class="btn s mini" data-go="${p.id}">열기 →</button></td></tr>`; }).join("");
  el.innerHTML=`<div class="card"><div class="cmp-head"><h3>📊 ${S.city.name} 여행안 비교 (${S.plans.length}개)</h3><button class="cmp-x" id="cmpX">닫기 ✕</button></div>
    <div class="tbl-wrap"><table class="cmp"><thead><tr><th>여행안 / 추천 대상</th><th class="n">총경비</th><th class="n">방문지</th><th class="n">식사</th><th class="n">실내</th><th class="n">아이만족<br><span class="mini2">(3=상)</span></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="cmp-tip">💡 실내 = 실내형 방문지 수(우천 대비) · 아이만족 = kid-fit 평균 · 식사 = 끼니별 맛집 슬롯 수.</p></div>`;
  el.hidden=false; $("#cmpX").onclick=()=>el.hidden=true;
  el.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>selectPlan(b.dataset.go)); el.scrollIntoView({behavior:"smooth"}); }

/* ---------- custom route builder ---------- */
const CATLABEL={beach:"🏖️ 해변",aquarium:"🐠 아쿠아리움",temple:"⛩️ 사찰",themepark:"🎢 놀이공원",experience:"🎡 체험",village:"🏘️ 마을",view:"🌆 전망",science:"🔬 과학관",mall:"🏬 실내몰",nature:"🌿 자연",waterfall:"💧 폭포",cave:"🕳️ 동굴",museum:"🖼️ 박물관",island:"⛴️ 섬(배)",drive:"🚗 드라이브"};
function openBuilder(){ $("#compare").hidden=true; const el=$("#builder"); if(!el.hidden){ el.hidden=true; return; }
  const byCat={}; Object.entries(S.at).forEach(([id,a])=>{ if(TRANSIT.has(a.category)) return; (byCat[a.category]=byCat[a.category]||[]).push([id,a]); });
  const hotelOpts=Object.entries(S.hotels).map(([id,h])=>`<option value="${id}">${h.name} · ${h.price_range||""}</option>`).join("");
  const chk=id=>(S.fav&&S.fav.has(id))?" checked":"";
  const groups=Object.keys(byCat).sort().map(cat=>`<div class="bg"><div class="bg-h">${CATLABEL[cat]||cat}</div><div class="bg-items">
    ${byCat[cat].map(([id,a])=>`<label class="bo"><input type="checkbox" value="${id}"${chk(id)}><span>${a.name}${a.rating?` <em>★${a.rating}</em>`:""}</span></label>`).join("")}</div></div>`).join("");
  el.innerHTML=`<div class="card"><div class="cmp-head"><h3>🧩 내 코스 만들기 <span class="deck-sub">가고 싶은 곳을 담고 인원·일수를 고르면 완성됩니다</span></h3><button class="cmp-x" id="bX">닫기 ✕</button></div>
    <div class="bctrl"><label>숙소 <select id="bHotel">${hotelOpts}</select></label>
      <label>기간 <select id="bDays"><option value="2">2박3일</option><option value="1">1박2일</option><option value="3">3박4일</option></select></label>
      <label>인원 <select id="bPpl"><option value="2">2명</option><option value="3">3명</option><option value="4" selected>4명</option><option value="5">5명</option><option value="6">6명</option></select></label>
      <label>출발일 <input type="date" id="bDate"></label>
      <button class="btn p" id="bGo">코스 생성 →</button><span class="bcount" id="bCount">0곳 선택</span></div>
    <div class="bgroups">${groups}</div></div>`;
  el.hidden=false;
  const cbs=[...el.querySelectorAll('.bo input')];
  const upd=()=>$("#bCount").textContent=`${cbs.filter(c=>c.checked).length}곳 선택`; upd();
  cbs.forEach(c=>c.onchange=upd);
  $("#bX").onclick=()=>el.hidden=true;
  $("#bGo").onclick=()=>{ const ids=cbs.filter(c=>c.checked).map(c=>c.value);
    if(ids.length<2){ alert("2곳 이상 선택해주세요."); return; }
    const hotel=$("#bHotel").value, days=+$("#bDays").value+1, ppl=+$("#bPpl").value, date=$("#bDate").value;
    const plan=buildCustomPlan(ids,hotel,days,ppl,date);
    upsertCustom(plan); localStorage.setItem(`custom_${S.city.id}`,JSON.stringify({ids,hotel,days,ppl,date}));
    el.hidden=true; renderPlanPicker(); selectPlan("custom"); };
  el.scrollIntoView({behavior:"smooth"}); }

function buildDayMeals(stops,hotel,dayNum){
  const pois=stops.map((s,i)=>[i,S.at[s.ref]]).filter(([i,a])=>a&&a.lat&&!TRANSIT.has(a.category));
  const used=new Set(), meals=[];
  if(dayNum>1&&hotel&&hotel.lat){ const b=nearestRest(hotel,2,used); b.forEach(x=>used.add(x)); if(b.length) meals.push({slot:"아침",after:-1,near:hotel.name,candidates:b}); }
  if(pois.length){ const [li,la]=pois[Math.floor(pois.length/2)]; const c=nearestRest(la,3,used); c.forEach(x=>used.add(x)); if(c.length) meals.push({slot:"점심",after:li,near:la.name,candidates:c});
    const last=stops[stops.length-1], lastTransit=S.at[last.ref]&&TRANSIT.has(S.at[last.ref].category);
    let di=null,da=null,near=null; const afterL=pois.filter(([i])=>i>li);
    if(afterL.length){ [di,da]=afterL[afterL.length-1]; near=da.name; } else if(hotel&&hotel.lat&&!lastTransit){ di=stops.length-1; da=hotel; near=hotel.name; }
    if(da){ const c2=nearestRest(da,3,used); if(c2.length) meals.push({slot:"저녁",after:di,near,candidates:c2}); } }
  return meals;
}
function buildCustomPlan(ids,hotelId,ndays,people,date){
  people=people||4; date=date||"";
  const hotel=S.hotels[hotelId], spots=ids.map(id=>({id,...S.at[id]})).filter(x=>x.lat);
  let cur=hotel&&hotel.lat?hotel:spots[0], rem=[...spots], order=[];
  while(rem.length){ rem.sort((a,b)=>haversine(cur,a)-haversine(cur,b)); const n=rem.shift(); order.push(n); cur=n; }
  const perDay=Math.ceil(order.length/ndays), days=[];
  const arr=S.city.arrival_ref;
  for(let d=0; d<ndays; d++){ const slice=order.slice(d*perDay,(d+1)*perDay); if(!slice.length) continue;
    const stops=[];
    if(d===0&&arr&&S.at[arr]) stops.push({ref:arr,time:"",note:"도착"});
    if(hotel) stops.push({ref:"hotel:"+hotelId,time:"",note:d===0?"체크인":"숙소"});
    slice.forEach(s=>stops.push({ref:s.id,time:"",note:""}));
    if(d===ndays-1&&arr&&S.at[arr]) stops.push({ref:arr,time:"",note:"귀가"});
    days.push({day:d+1,label:"내 코스",stops,meals:buildDayMeals(stops,hotel,d+1)});
  }
  const cc=S.city.cost, pf=people/4, sc=v=>Math.round(v*pf/100)*100;
  const paid=sc([...new Set(ids)].reduce((s,id)=>s+((S.at[id]||{}).price4||0),0));
  const rooms=Math.max(1,Math.ceil(people/2));   // 4인 = 2객실 (침대 4개 or 3개+킹 요구조건)
  const lodging=(hotel&&hotel.nightly?hotel.nightly:220000)*ndays*rooms;
  const cost=[{cat:cc.intercity_label,detail:`왕복 ${people}인`,amount:sc(cc.intercity),type:"추정"},
    ...(cc.home_transfer?[{cat:"집↔출발지 이동",detail:"잠실↔수서/공항 벤 왕복",amount:cc.home_transfer,type:"추정"}]:[]),
    {cat:"현지 교통",detail:"구간별 표시",amount:cc.local,type:"추정"},
    {cat:`숙박 ${ndays}박`,detail:`${hotel?hotel.name:""}${rooms>1?` · ${rooms}객실`:""}`,amount:lodging,type:"추정"},
    {cat:"입장·체험",detail:[...new Set(ids)].map(id=>(S.at[id]||{}).name).filter(Boolean).join(", "),amount:paid,type:"추정"},
    {cat:"식비",detail:`${people}인·${ndays+1}일`,amount:sc(cc.food),type:"추정"},{cat:"예비·기념품",detail:"버퍼",amount:cc.misc,type:"추정"}];
  const total=cost.reduce((s,c)=>s+c.amount,0);
  const kid={상:3,중:2,하:1}, kv=ids.map(id=>kid[(S.at[id]||{}).kid_fit]||0);
  const over=total>cc.budget;
  return {id:"custom",short:"내 코스",title:`${S.city.name} · 우리 가족 코스`,
    intro:`우리 가족이 직접 고른 ${ids.length}곳을 가까운 순서대로 이어 붙였습니다. 끼니마다 근처 맛집을 넣고 이동수단과 경비까지 자동으로 계산했어요.${date?` ${date}에 출발하는 ${people}인 기준입니다.`:` ${people}인 기준입니다.`}`,
    subtitle:`직접 고른 ${ids.length}곳 · ${people}인 · ${ndays}박${ndays+1}일${date?` · ${date} 출발`:""}`,
    region:S.city.name,base_hotel:hotelId,budget:cc.budget,total,chips:["직접 선택",`${people}인`,over?"예산 초과":"맞춤 코스"],recommended_for:"우리 가족이 직접 고른 코스",
    days,cost,decisions:[{label:cc.intercity_label+" 예매",note:"예매 오픈 즉시"},{label:"숙소 예약",note:hotel?hotel.name:""},{label:"예산 확정",note:`총액 ${won(total)}원`}],
    highlights:[],metrics:{stops:ids.length,indoor:0,kid:kv.length?+(kv.reduce((a,b)=>a+b,0)/kv.length).toFixed(1):0,meals:days.reduce((s,d)=>s+d.meals.length,0)}};
}
function upsertCustom(plan){ const i=S.plans.findIndex(p=>p.id==="custom"); if(i>=0) S.plans[i]=plan; else S.plans.push(plan); }
function restoreCustom(){ try{ const raw=localStorage.getItem(`custom_${S.city.id}`); if(!raw) return; const {ids,hotel,days,ppl,date}=JSON.parse(raw);
  const valid=ids.filter(id=>S.at[id]); if(valid.length>=2&&S.hotels[hotel]) upsertCustom(buildCustomPlan(valid,hotel,days,ppl,date)); }catch(e){} }

/* ---------- print / PDF (핵심 요약) ---------- */
function openPrint(p){
  const c=S.city, h=S.hotels[p.base_hotel];
  const restName=id=>(S.rest[id]||{}).name||"";
  let daysHtml="";
  p.days.forEach(d=>{
    const meal=slot=>{ const m=(d.meals||[]).find(x=>x.slot===slot); return m?`${slot}: ${m.candidates.map(restName).filter(Boolean).slice(0,2).join(" / ")}`:""; };
    let stops="";
    d.stops.forEach(s=>{ const a=place(s.ref); if(!a) return; const isH=s.ref.startsWith("hotel:");
      stops+=`<li>${s.time?`<b>${s.time}</b> `:""}${isH?"🏨 ":""}${a.name}${s.note?` <span class="pg">— ${s.note}</span>`:""}</li>`; });
    const meals=["아침","점심","저녁"].map(meal).filter(Boolean).join(" · ");
    daysHtml+=`<div class="pd"><h3>${d.date_label?d.date_label+" · ":""}${d.day}일차 · ${d.label||""}</h3><ol>${stops}</ol>${meals?`<div class="pm">🍽️ ${meals}</div>`:""}</div>`;
  });
  const cost=(p.cost||[]).map(x=>`<tr><td>${x.cat}</td><td>${x.detail||""}</td><td style="text-align:right">${won(x.amount)}</td></tr>`).join("");
  const pk=c.packing?[...c.packing.common,...c.packing.specific]:[];
  const book=(c.booking||[]).map(x=>x.label).join(", ");
  let sheet=$("#printSheet"); if(!sheet){ sheet=document.createElement("div"); sheet.id="printSheet"; document.body.appendChild(sheet); }
  sheet.className="";   // 고르기 시트를 먼저 뽑았다면 .pick 이 남아 있다 — 모드는 매번 다시 정한다
  sheet.innerHTML=`
    <div class="ps-head"><h1>${p.title}</h1>
      <p>${c.emoji} ${c.name} · ${p.trip?((p.trip.party||{}).label||""):"어른 2 + 아이 2"} · ${p.nights||2}박 ${(p.nights||2)+1}일${p.trip?` · ${kdate(p.trip.start)} ~ ${kdate(p.trip.end)}`:""} · 예상 총경비 <b>${won(p.total)}원</b> (예산 ${won(p.budget)}원 이내)</p>
      <p>🏨 숙소: ${h?h.name:""}${h&&h.pool?` (${h.pool})`:""} · 🚄/✈️ ${c.arrival}</p></div>
    <div class="ps-days">${daysHtml}</div>
    <div class="ps-cost"><h3>💰 경비 (${p.people||4}인)</h3><table>${cost}<tr class="tot"><td>합계</td><td></td><td style="text-align:right">${won(p.total)}원</td></tr></table></div>
    <div class="ps-two">
      <div><h3>🎫 예매 & 이동</h3><p>${c.cost.intercity_label}: ${book}</p><p>${c.home_transfer?c.home_transfer.label+" (왕복 약 "+won(c.home_transfer.amount)+"원)":""}</p></div>
      <div><h3>🧳 준비물</h3><p>${pk.join(" · ")}</p></div>
    </div>
    <div class="ps-foot">가족여행 플래너 · 가격·시간은 추정 포함, 예약 전 재확인</div>`;
  document.body.classList.add("printing");
  const done=()=>{ document.body.classList.remove("printing"); window.removeEventListener("afterprint",done); };
  window.addEventListener("afterprint",done);
  setTimeout(()=>window.print(),200);
}

/* ---------- 고르기(picks) — 아이들이 직접 선택하는 후보 ----------------------
   확정 일정(비행기·체크인·앵커 관광지)은 아빠가 정하고, 그 위에 얹을 것은
   아이들이 고른다. 결정권을 주면 이동 시간 불평이 줄어든다(kid_play "하루 대장"과 같은 원리).
   - 언니/동생이 각자 누르고, 둘 다 누르면 '확정'으로 굳는다.
   - 화면에서 고른 결과가 A4 고르기 시트에 그대로 찍힌다(●). 종이로만 고를 거면 빈 ○ 에 색칠.
   - 상태는 여행·날짜 단위 키로 격리한다(rec_* 와 같은 규율). */
const PICK_WHO=["k1","k2"];
const pickKey=(p,d)=>`pick_${S.city.id}_${p.id}_d${d.day}`;
function picksOf(p,d){ try{ return JSON.parse(localStorage.getItem(pickKey(p,d))||"{}"); }catch(e){ return {}; } }
function optId(o){ return o.id||o.ref; }
function pickRole(p,w){ const r=((p.trip||{}).record||{}).roles||{}; return r[w]||(w==="k1"?"언니":"동생"); }
function togglePick(p,d,oid,w){ const s=picksOf(p,d); s[oid]=s[oid]||{}; s[oid][w]=!s[oid][w];
  localStorage.setItem(pickKey(p,d),JSON.stringify(s)); return s[oid][w]; }

/* 후보 한 줄에 필요한 표시값을 attractions 에서 끌어온다(이름·요금·링크를 두 번 적지 않는다). */
function pickView(o){ const a=o.ref?place(o.ref):null;
  return { name:o.name||(a&&a.name)||"", why:o.why||(a&&a.blurb)||"",
    dur:o.dur||"", cost:o.cost||"", move:o.move||"", tag:o.tag||"",
    naver:(a&&(a.naver||a.naver_map))||o.naver||"", official:(a&&a.official)||o.official||"" }; }

function picksBlock(p,d){ const pk=d.picks; if(!pk||!(pk.options||[]).length) return "";
  const sel=picksOf(p,d);
  const rows=pk.options.map(o=>{ const oid=optId(o), v=pickView(o), s=sel[oid]||{};
    const both=s.k1&&s.k2;
    return `<div class="pkr${both?" both":""}" data-oid="${oid}">
      <div class="pk-main">
        <div class="pk-top"><span class="pk-nm">${v.name}</span>${v.tag?`<span class="pk-tag">${v.tag}</span>`:""}${both?`<span class="pk-ok">둘 다 골랐어요</span>`:""}</div>
        ${v.why?`<p class="pk-why">${v.why}</p>`:""}
        <div class="pk-meta">${[v.dur&&`⏱️ ${v.dur}`,v.cost&&`💰 ${v.cost}`,v.move&&`🚗 ${v.move}`].filter(Boolean).join("<span class='pk-dot'>·</span>")}</div>
        ${(v.naver||v.official)?`<div class="lnks">${v.naver?`<a class="lnk" href="${v.naver}" target="_blank" rel="noopener">네이버</a>`:""}${v.official?`<a class="lnk" href="${v.official}" target="_blank" rel="noopener">예매·홈페이지</a>`:""}</div>`:""}
      </div>
      <div class="pk-vote" role="group" aria-label="${v.name} 고르기">
        ${PICK_WHO.map(w=>`<button type="button" class="pk-b${s[w]?" on":""}" data-w="${w}" aria-pressed="${!!s[w]}">${pickRole(p,w)}</button>`).join("")}
      </div></div>`; }).join("");
  const n=pk.options.length;
  return `<div class="picks" id="picks${d.day}">
    <div class="pk-hd">🙋 ${pk.title||"오늘 뭐 할지 골라 보자"}${pk.max?`<span class="pk-max">${n}개 중 ${pk.max}개까지</span>`:""}
      <button type="button" class="pk-print" data-day="${d.day}">🖨️ 이 날만 A4</button></div>
    ${pk.note?`<p class="pk-no">${pk.note}</p>`:""}
    <div class="pk-list">${rows}</div></div>`; }

function bindPicks(el,p){ el.querySelectorAll(".picks .pk-b").forEach(b=>b.onclick=()=>{
    const row=b.closest(".pkr"), dnum=+b.closest(".picks").id.replace("picks","");
    const d=p.days.find(x=>x.day===dnum); if(!d) return;
    const on=togglePick(p,d,row.dataset.oid,b.dataset.w);
    b.classList.toggle("on",on); b.setAttribute("aria-pressed",String(on));
    const s=picksOf(p,d)[row.dataset.oid]||{}; row.classList.toggle("both",!!(s.k1&&s.k2)); });
  el.querySelectorAll(".picks .pk-print").forEach(b=>b.onclick=()=>openPickSheet(p,+b.dataset.day)); }

/* ---------- A4 고르기 시트 (핵심만 + 아이 선택란) ---------------------------
   종이 한 장으로 결정을 받는 도구다. 그래서 전체 정보를 다 넣지 않는다.
   각 날짜에 (1) 이미 정해진 뼈대 한 줄, (2) 고를 것만 남긴다. 비용표·준비물·
   렌터카 안내는 전부 뺐다 — 그건 openPrint(전체 요약)가 소유한다. */
function openPickSheet(p,only){
  const t=p.trip||{}, c=S.city;
  const days=only?p.days.filter(d=>d.day===only):p.days;
  const dayBlocks=days.map(d=>{
    const spine=d.stops.map(s=>{ const a=place(s.ref); if(!a) return null;
      const nm=s.ref.startsWith("hotel:")?"숙소":a.name; return `${s.time?s.time+" ":""}${nm}`; }).filter(Boolean).join(" › ");
    const pk=d.picks||{}; const opts=(pk.options||[]);
    const sel=picksOf(p,d);
    const list=opts.map(o=>{ const oid=optId(o), v=pickView(o), s=sel[oid]||{};
      // 동그라미는 CSS 로 그린다 — ○ 글자를 겹쳐 넣으면 테두리와 이중으로 보인다(◎).
      const box=w=>`<span class="kbox${s[w]?" on":""}" aria-hidden="true"></span><span class="kwho">${pickRole(p,w)}</span>`;
      const meta=[v.dur,v.cost,v.move].filter(Boolean).join(" · ");
      return `<tr><td class="kv">${PICK_WHO.map(box).join("")}</td>
        <td class="kn"><b>${v.name}</b>${v.tag?` <i>${v.tag}</i>`:""}${meta?`<span class="km">${meta}</span>`:""}
          ${v.why?`<span class="kw">${v.why}</span>`:""}</td></tr>`; }).join("");
    // 고를 것이 없는 날(도착·귀가처럼 이동만 하는 날)은 한 줄로 접는다.
    // A4 한 장에 들어가야 아이가 손에 들고 동그라미를 친다 — 빈 블록이 자리를 먹으면 안 된다.
    if(!opts.length) return `<div class="kd slim"><div class="kd-h"><b>${d.date_label||(d.day+"일차")}</b> ${d.label||""}<span class="kd-x">고를 것 없음 · ${spine||"이동"}</span></div></div>`;
    return `<div class="kd">
      <div class="kd-h"><b>${d.date_label||(d.day+"일차")}</b> ${d.label||""}</div>
      ${spine?`<div class="kd-s"><span>정해진 것</span>${spine}</div>`:""}
      <div class="kd-p"><span>고를 것${pk.max?` — ${pk.max}개까지`:""}</span>${pk.note?`<em>${pk.note}</em>`:""}</div><table class="ktb">${list}</table>
    </div>`; }).join("");

  let sheet=$("#printSheet"); if(!sheet){ sheet=document.createElement("div"); sheet.id="printSheet"; document.body.appendChild(sheet); }
  sheet.className="pick";
  sheet.innerHTML=`
    <div class="ks-head">
      <h1>🧭 ${only?`${(days[0]||{}).date_label||""} 뭐 할지 골라 보자`:"우리 제주 여행, 뭐 할지 골라 보자"}</h1>
      <p>${only?`${(days[0]||{}).label||""} · `:""}${t.start?`${kdate(t.start)} ~ ${kdate(t.end)}`:""} · ${(t.party||{}).label||""} · 베이스 ${((S.hotels[p.base_hotel]||{}).name)||""}</p>
      <p class="ks-how"><b>고르는 법</b> ① 하고 싶은 것 옆의 동그라미를 색칠한다 ② 언니·동생이 <b>둘 다</b> 고른 건 그냥 간다 ③ 한 명만 고른 건 저녁에 같이 정한다 ④ 제일 하고 싶은 것 하나에 ★ 를 그린다</p>
    </div>
    <div class="ks-days">${dayBlocks}</div>
    <div class="ks-sign">
      <div><b>우리가 정한 것</b><span class="sl"></span><span class="sl"></span><span class="sl"></span></div>
      <div class="ks-nm"><b>${pickRole(p,"k1")}</b><span class="sl"></span><b>${pickRole(p,"k2")}</b><span class="sl"></span><b>아빠</b><span class="sl"></span></div>
    </div>
    <div class="ps-foot">가족여행 플래너 · 요금·시간은 바뀔 수 있으니 예약 전에 다시 확인하세요</div>`;
  document.body.classList.add("printing");
  const done=()=>{ document.body.classList.remove("printing"); sheet.className=""; window.removeEventListener("afterprint",done); };
  window.addEventListener("afterprint",done);
  setTimeout(()=>window.print(),200);
}

/* ---------- LIVE: 실시간 날씨/미세먼지·UV/해변 수온·파고 (open-meteo, 무키) + 혼잡 예상 ---------- */
const WX={}, AQ={}, MAR={};
const wkey=p=>`${(+p.lat).toFixed(3)},${(+p.lon).toFixed(3)}`;
const hm=iso=>{ try{ const d=new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }catch(e){ return ""; } };
function wcode(c){ if(c===0)return["☀️","맑음"]; if([1,2].includes(c))return["🌤️","대체로 맑음"]; if(c===3)return["☁️","흐림"];
  if([45,48].includes(c))return["🌫️","안개"]; if([51,53,55,56,57].includes(c))return["🌦️","이슬비"];
  if([61,63,65,66,67,80,81,82].includes(c))return["🌧️","비"]; if([71,73,75,77,85,86].includes(c))return["🌨️","눈"];
  if([95,96,99].includes(c))return["⛈️","뇌우"]; return["🌡️","-"]; }
function pmLvl(v){ if(v==null)return null; v=Math.round(v); return v<=15?["좋음","c-ok"]:v<=35?["보통","c-mid"]:v<=75?["나쁨","c-hi"]:["매우나쁨","c-hi"]; }
function uvLvl(v){ if(v==null)return null; v=Math.round(v); return v<=2?["낮음","c-ok"]:v<=5?["보통","c-mid"]:v<=7?["높음","c-mid"]:["매우높음","c-hi"]; }
function waveLbl(w){ if(w==null)return null; return w<0.5?"물놀이 좋음":w<1.2?"파도 주의":"파도 큼"; }
async function _fetch(base,params,need,store,pick){
  if(!need.length) return;
  const lat=need.map(p=>(+p.lat).toFixed(3)).join(","), lon=need.map(p=>(+p.lon).toFixed(3)).join(",");
  try{ const r=await fetch(`${base}?latitude=${lat}&longitude=${lon}&${params}&timezone=Asia%2FSeoul`).then(x=>x.json());
    const arr=Array.isArray(r)?r:[r]; need.forEach((p,i)=>{ const d=arr[i]||arr[0]; if(d) store[wkey(p)]=pick(d); }); }catch(e){}
}
function _uniqNeed(points,cache,filter){ const u={}; points.forEach(p=>{ if(p&&p.lat&&(!filter||filter(p))) u[wkey(p)]=p; });
  return Object.values(u).filter(p=>!cache[wkey(p)]); }
async function fetchWeather(points){ await _fetch("https://api.open-meteo.com/v1/forecast",
  "current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability&daily=sunrise,sunset&forecast_days=1",
  _uniqNeed(points,WX), WX, d=>{ const hh=new Date().getHours(); return {t:Math.round(d.current.temperature_2m),code:d.current.weather_code,
    wind:Math.round(d.current.wind_speed_10m), pp:d.hourly?.precipitation_probability?.[hh]??null,
    sr:d.daily?.sunrise?.[0], ss:d.daily?.sunset?.[0], hT:d.hourly?.temperature_2m, hP:d.hourly?.precipitation_probability }; }); }
async function fetchAir(points){ await _fetch("https://air-quality-api.open-meteo.com/v1/air-quality",
  "current=pm2_5,pm10,uv_index", _uniqNeed(points,AQ), AQ, d=>({pm25:d.current.pm2_5,pm10:d.current.pm10,uv:d.current.uv_index})); }
async function fetchMarine(points){ await _fetch("https://marine-api.open-meteo.com/v1/marine",
  "current=wave_height,sea_surface_temperature", _uniqNeed(points,MAR,p=>["beach","island"].includes(p.category)), MAR,
  d=>({wave:d.current.wave_height,sst:d.current.sea_surface_temperature})); }
async function fetchLiveAll(points){ await Promise.all([fetchWeather(points),fetchAir(points),fetchMarine(points)]); }
function crowdLvl(cat,dt){ dt=dt||new Date(); const wd=dt.getDay(), we=wd===0||wd===6, h=dt.getHours(); const pm=h>=11&&h<=17; let b=0;
  if(["beach","themepark","experience","aquarium","island"].includes(cat)) b=pm?2:1;
  else if(["nature","village","view","waterfall","temple","drive","cave"].includes(cat)) b=pm?1:0; else b=pm?1:0;
  if(we) b=Math.min(2,b+1); if(h<9||h>=20) b=Math.max(0,b-1); return b; }
const CROWD=[["여유","c-ok"],["보통","c-mid"],["붐빔","c-hi"]];
function liveChip(a){ const w=WX[wkey(a)], cl=crowdLvl(a.category), aq=AQ[wkey(a)], mr=MAR[wkey(a)];
  const wx=w?`${wcode(w.code)[0]} ${w.t}°${w.pp!=null?` · 비 ${w.pp}%`:""}`:"날씨 …";
  const pm=aq?pmLvl(aq.pm25):null, uv=aq?uvLvl(aq.uv):null;
  const extra=[ pm?`<span class="lc-cr ${pm[1]}">미세 ${pm[0]}</span>`:"",
    (uv&&uv[1]!=="c-ok")?`<span class="lc-cr ${uv[1]}">UV ${uv[0]}</span>`:"",
    mr?`<span class="lc-wx">🌊 ${Math.round(mr.sst)}°${mr.wave!=null?` 파고 ${mr.wave}m`:""}</span>`:"" ].join("");
  return `<span class="lc"><span class="lc-wx">${wx}</span><span class="lc-cr ${CROWD[cl][1]}">지금 ${CROWD[cl][0]} 예상</span>${extra}</span>`; }
async function fillLive(p){ const pts=[]; p.days.forEach(d=>d.stops.forEach(s=>{ const a=S.at[s.ref]; if(a&&a.lat&&!TRANSIT.has(a.category)) pts.push(a); }));
  await fetchLiveAll(pts);
  document.querySelectorAll(".livewrap").forEach(el=>{ el.innerHTML=liveChip({lat:el.dataset.lat,lon:el.dataset.lon,category:el.dataset.cat}); }); }
function wxScore(w){ if(!w) return 1; const [,l]=wcode(w.code); if(["비","뇌우","눈"].includes(l)) return 0; if((w.pp||0)>=60) return 0; if(l==="흐림"||l==="이슬비"||l==="안개") return 1; return 2; }
function hourStrip(w){ if(!w||!w.hT) return ""; const now=new Date().getHours();
  let bars=""; for(let h=6;h<=22;h++){ const t=w.hT[h], pp=w.hP?w.hP[h]:0; const hh=Math.max(6,Math.min(34,t))-6;
    const col=pp>=60?"#3B82F6":pp>=30?"#8EC5F0":"#DE9A2E"; bars+=`<div class="hb${h===now?' now':''}" style="height:${8+hh*3}px;background:${col}" title="${h}시 ${Math.round(t)}° 비${pp}%"></div>`; }
  return `<div class="hstrip"><div class="hs-h">오늘 시간대 (6~22시) · 파랑=비 확률 높음</div><div class="hbars">${bars}</div></div>`; }
async function openLive(){ const el=$("#live"); $("#compare").hidden=true; $("#builder").hidden=true; if(!el.hidden){ el.hidden=true; return; }
  el.innerHTML=`<div class="card"><div class="cmp-head"><h3>🔴 지금 상황 <span class="deck-sub">${S.city.name} · 실시간 날씨·미세먼지 + 혼잡 예상</span></h3><button class="cmp-x" id="lX">닫기 ✕</button></div><p class="cmp-tip">불러오는 중…</p></div>`;
  el.hidden=false; el.scrollIntoView({behavior:"smooth"});
  const spots=Object.entries(S.at).filter(([id,a])=>a.lat&&!TRANSIT.has(a.category)).map(([id,a])=>({id,...a}));
  await fetchLiveAll(spots);
  const now=new Date(); let mode="best"; const rep=WX[wkey(spots[0])]||{};
  const render=()=>{
    const rows=spots.map(a=>{ const w=WX[wkey(a)], cl=crowdLvl(a.category), sc=wxScore(w)*2-cl+({상:1,중:0,하:-1}[a.kid_fit]||0); return {a,w,cl,sc}; });
    rows.sort((x,y)=> mode==="best"? y.sc-x.sc : mode==="calm"? x.cl-y.cl : x.a.name.localeCompare(y.a.name,"ko"));
    const list=rows.map(({a,w,cl})=>{ const aq=AQ[wkey(a)], mr=MAR[wkey(a)], pm=aq?pmLvl(aq.pm25):null, uv=aq?uvLvl(aq.uv):null;
      return `<div class="lrow"><img class="lthumb" src="${resolveImg(a)||""}" alt="" onerror="this.style.visibility='hidden'">
      <div class="lg1"><div class="lnm">${a.name} <span class="lcat">${(CATLABEL[a.category]||a.category)}</span></div>
        <div class="lmeta">${w?`${wcode(w.code)[0]} ${wcode(w.code)[1]} ${w.t}°${w.pp!=null?` · 강수 ${w.pp}%`:""}${w.wind!=null?` · 바람 ${w.wind}m/s`:""}`:"날씨 정보 없음"}${pm?` · 미세먼지 ${pm[0]}`:""}${uv?` · UV ${uv[0]}`:""}${mr?` · 🌊 수온 ${Math.round(mr.sst)}°${mr.wave!=null?` 파고 ${mr.wave}m(${waveLbl(mr.wave)})`:""}`:""}</div></div>
      <div class="lg2"><span class="lc-cr ${CROWD[cl][1]}">${CROWD[cl][0]}</span><a class="lnk" href="${a.naver}" target="_blank" rel="noopener">지도</a></div></div>`; }).join("");
    el.querySelector(".card").innerHTML=`<div class="cmp-head"><h3>🔴 지금 상황 <span class="deck-sub">${S.city.name} · ${now.getHours()}시 ${String(now.getMinutes()).padStart(2,'0')}분 기준</span></h3><button class="cmp-x" id="lX">닫기 ✕</button></div>
      <div class="lsun">${rep.sr?`🌅 일출 ${hm(rep.sr)}`:""}${rep.ss?` · 🌇 일몰 ${hm(rep.ss)}`:""}</div>
      ${hourStrip(rep)}
      <div class="lsort"><button data-m="best" class="${mode==='best'?'on':''}">지금 좋은 순</button><button data-m="calm" class="${mode==='calm'?'on':''}">여유 순</button><button data-m="name" class="${mode==='name'?'on':''}">이름순</button>
        <span class="lleg"><i class="c-ok"></i>여유·좋음 <i class="c-mid"></i>보통 <i class="c-hi"></i>붐빔·나쁨</span></div>
      <div class="llist">${list}</div>
      <p class="cmp-tip">🌤️ 날씨·미세먼지·UV·해변 수온/파고는 open-meteo <b>실시간</b>(무키)입니다. 혼잡도는 요일·시간·유형 기반 <b>예상</b>이라 실제와 다를 수 있어요. 미세먼지 나쁨·UV 매우높음·파고 큼이면 아이 야외활동을 조절하세요.</p>`;
    el.querySelector("#lX").onclick=()=>el.hidden=true;
    el.querySelectorAll(".lsort button").forEach(b=>b.onclick=()=>{ mode=b.dataset.m; render(); });
  };
  render();
}

boot().catch(e=>{ $("#planHead").innerHTML='<p style="color:#E15A38">데이터 로드 실패: '+e.message+'</p>'; });
