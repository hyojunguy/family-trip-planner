/* ============================================================================
   기록 레이어 — 미션 체크 · 사진 담기 · 하루 마감 · 내보내기
   ----------------------------------------------------------------------------
   설계 원칙 (왜 이렇게 만들었나):
   1) 사진은 **평소처럼 카메라 앱으로** 찍는다. 이 앱은 촬영기가 아니라 "고르는 곳"이다.
      저녁에 각자 오늘 사진을 골라 담는 행위 자체가 하루 마감 의식의 1단계다.
   2) 원본은 사진첩에 그대로 두고, 여기엔 긴 변 1440px 로 줄인 사본만 저장한다
      (아이폰 4일치 사진을 통째로 IndexedDB 에 넣으면 Safari 가 evict 한다).
   3) 텍스트(미션 체크·한마디·별점)는 localStorage, 사진 바이트는 IndexedDB.
      크기가 다른 두 데이터를 한 통에 넣지 않는다.
   4) 모든 상태는 여행/날짜 단위 키로 격리한다. 날짜가 곧 파일 이름이 된다.
   ========================================================================== */
(function(){
"use strict";
const DB_NAME="familytrip", DB_VER=1, STORE="shots";
const MAXPX=1440, QUALITY=0.82;
let _db=null;

/* ---------- IndexedDB ---------- */
function db(){ return _db ? Promise.resolve(_db) : new Promise((res,rej)=>{
  const rq=indexedDB.open(DB_NAME,DB_VER);
  rq.onupgradeneeded=()=>{ const d=rq.result;
    if(!d.objectStoreNames.contains(STORE)){
      const s=d.createObjectStore(STORE,{keyPath:"id"});
      s.createIndex("byDay","day",{unique:false}); } };
  rq.onsuccess=()=>{ _db=rq.result; res(_db); }; rq.onerror=()=>rej(rq.error); }); }

async function tx(mode){ const d=await db(); return d.transaction(STORE,mode).objectStore(STORE); }
async function putShot(o){ const s=await tx("readwrite"); return new Promise((res,rej)=>{ const r=s.put(o); r.onsuccess=()=>res(o); r.onerror=()=>rej(r.error); }); }
async function delShot(id){ const s=await tx("readwrite"); return new Promise(res=>{ s.delete(id).onsuccess=()=>res(); }); }
async function dayShots(day){ const s=await tx("readonly"); return new Promise(res=>{
  const out=[], rq=s.index("byDay").openCursor(IDBKeyRange.only(day));
  rq.onsuccess=e=>{ const c=e.target.result; if(c){ out.push(c.value); c.continue(); }
    else res(out.sort((a,b)=>(a.ts||0)-(b.ts||0))); };
  rq.onerror=()=>res([]); }); }
async function allShots(){ const s=await tx("readonly"); return new Promise(res=>{
  const r=s.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>res([]); }); }

/* ---------- 이미지 축소 (원본은 사진첩에 그대로 둔다) ---------- */
function shrink(file){ return new Promise((res,rej)=>{
  const img=new Image(), url=URL.createObjectURL(file);
  img.onload=()=>{ URL.revokeObjectURL(url);
    const sc=Math.min(1,MAXPX/Math.max(img.width,img.height));
    const w=Math.round(img.width*sc), h=Math.round(img.height*sc);
    const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
    cv.getContext("2d").drawImage(img,0,0,w,h);
    cv.toBlob(b=>b?res({blob:b,w,h}):rej(new Error("encode fail")),"image/jpeg",QUALITY); };
  img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error("이미지를 읽지 못했습니다")); };
  img.src=url; }); }

/* ---------- 텍스트 상태 (localStorage) ---------- */
const K=(day,k)=>`rec_${day}_${k}`;
const getJ=(k,d)=>{ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } };
const setJ=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
const missions=day=>getJ(K(day,"missions"),{});
const toggleMission=(day,id)=>{ const m=missions(day); m[id]=!m[id]; setJ(K(day,"missions"),m); return m[id]; };
const notes=day=>getJ(K(day,"notes"),{});
const setNote=(day,who,field,val)=>{ const n=notes(day); n[who]=n[who]||{}; n[who][field]=val; setJ(K(day,"notes"),n); };
const stars=day=>getJ(K(day,"stars"),{});
const setStars=(day,who,v)=>{ const s=stars(day); s[who]=v; setJ(K(day,"stars"),s); };
const closed=day=>!!localStorage.getItem(K(day,"closed"));
const close=day=>localStorage.setItem(K(day,"closed"),new Date().toISOString());

window.TripRecord={db,putShot,delShot,dayShots,allShots,shrink,
  missions,toggleMission,notes,setNote,stars,setStars,closed,close,K,getJ,setJ,MAXPX};

/* ============================ ZIP (store, 무압축) ==========================
   JPEG 은 이미 압축돼 있어 deflate 이득이 거의 없다. 외부 라이브러리를 붙이는
   대신 store 방식 ZIP 을 직접 쓴다 (호텔 와이파이가 끊겨도 내보내기가 된다).
   ======================================================================== */
const CRCT=(()=>{ const t=new Uint32Array(256);
  for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=CRCT[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function dosTime(d){ return ((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()/2))&0xFFFF; }
function dosDate(d){ return (((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xFFFF; }

async function makeZip(files){                  // files: [{name, data:Uint8Array}]
  const enc=new TextEncoder(), now=new Date(), chunks=[], central=[]; let off=0;
  for(const f of files){
    const nm=enc.encode(f.name), crc=crc32(f.data), sz=f.data.length;
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);
    lh.setUint16(8,0,true); lh.setUint16(10,dosTime(now),true); lh.setUint16(12,dosDate(now),true);
    lh.setUint32(14,crc,true); lh.setUint32(18,sz,true); lh.setUint32(22,sz,true);
    lh.setUint16(26,nm.length,true); lh.setUint16(28,0,true);
    chunks.push(new Uint8Array(lh.buffer),nm,f.data);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true);
    ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true);
    ch.setUint16(12,dosTime(now),true); ch.setUint16(14,dosDate(now),true);
    ch.setUint32(16,crc,true); ch.setUint32(20,sz,true); ch.setUint32(24,sz,true);
    ch.setUint16(28,nm.length,true); ch.setUint32(42,off,true);
    central.push(new Uint8Array(ch.buffer),nm);
    off+=30+nm.length+sz;
  }
  const cstart=off; let clen=0; central.forEach(c=>clen+=c.length);
  const end=new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true); end.setUint16(8,files.length,true); end.setUint16(10,files.length,true);
  end.setUint32(12,clen,true); end.setUint32(16,cstart,true);
  return new Blob([...chunks,...central,new Uint8Array(end.buffer)],{type:"application/zip"});
}
window.TripRecord.makeZip=makeZip;
})();
