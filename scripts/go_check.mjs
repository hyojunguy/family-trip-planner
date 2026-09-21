/* 제주 GO (go.html) 현장앱 렌더 게이트 — 아이폰 실폭에서만 드러나는 것만 본다.
   (1) 375/390/430 가로 오버플로 0  (2) 카드가 실제로 그려지나
   (3) 스와이프(scroll-snap)로 다음 카드가 오나  (4) 터치타깃 44px
   (5) 본문 글자 >=17px  (6) 네이버 링크가 좌표를 물고 있나  (7) 미션 체크 영속
   실행: NODE_PATH="$(npm root -g)" node scripts/go_check.mjs */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT=process.cwd();
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
  const u=decodeURIComponent(req.url.split('?')[0]);
  const fp=join(ROOT,normalize(u==='/'?'/go.html':u).replace(/^(\.\.[/\\])+/,''));
  try{const b=await readFile(fp);res.writeHead(200,{'Content-Type':MIME[extname(fp)]||'application/octet-stream'});res.end(b);}
  catch{res.writeHead(404);res.end('nf');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const errs=[],info=[];

for(const [w,h,tag] of [[375,812,'iPhone SE/12mini'],[390,844,'iPhone 12/13/14'],[430,932,'14 Pro Max']]){
  const pg=await browser.newPage({viewport:{width:w,height:h},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const bad=[];pg.on('console',m=>{if(m.type()==='error')bad.push(m.text())});
  await pg.goto(`${base}/go.html`,{waitUntil:'networkidle'});
  await pg.waitForSelector('.stop',{timeout:8000}).catch(()=>errs.push(`[${tag}] 카드가 안 그려짐`));
  const n=await pg.locator('.stop').count();
  if(n<5) errs.push(`[${tag}] 카드 ${n}개 — Day1 출발시퀀스9+스톱5 이상이어야`);
  else info.push(`[${tag}] 카드 ${n}개`);
  const ov=await pg.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  if(ov>0) errs.push(`[${tag}] 가로 오버플로 ${ov}px`);
  const small=await pg.evaluate(()=>[...document.querySelectorAll('.mt,.note,.act')]
    .filter(e=>parseFloat(getComputedStyle(e).fontSize)<17).length);
  if(small) errs.push(`[${tag}] 17px 미만 글자 ${small}개`);
  const tiny=await pg.evaluate(()=>[...document.querySelectorAll('button')]
    .filter(e=>{const r=e.getBoundingClientRect();return r.height>0&&r.height<44}).length);
  if(tiny) errs.push(`[${tag}] 44px 미만 터치타깃 ${tiny}개`);
  if(w===390){
    const deck=pg.locator('#deck');
    const x0=await deck.evaluate(e=>e.scrollLeft);
    await deck.evaluate(e=>e.scrollLeft=e.clientWidth);
    await pg.waitForTimeout(400);
    const x1=await deck.evaluate(e=>e.scrollLeft);
    if(x1<=x0) errs.push('스와이프로 다음 카드가 안 옴'); else info.push(`스와이프 OK (${x0}→${x1})`);
    const geo=await pg.locator('[data-food]').count();
    if(!geo) errs.push('주변 맛집 버튼 없음'); else info.push(`주변 맛집 버튼 ${geo}개`);
    const withCoord=await pg.evaluate(()=>[...document.querySelectorAll('[data-map][data-lat]')]
      .filter(e=>e.dataset.lat&&e.dataset.lat!=='').length);
    info.push(`좌표 물린 지도버튼 ${withCoord}개`);
    const mi=pg.locator('.mi[data-m]').first();
    if(await mi.count()){
      await mi.click(); await pg.waitForTimeout(150);
      const on=await mi.evaluate(e=>e.classList.contains('on'));
      const ls=await pg.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('jejugo.v1')||'{}').m||{}).length);
      if(!on||!ls) errs.push('미션 체크가 저장 안 됨'); else info.push('미션 체크·저장 OK');
    } else errs.push('미션 항목 없음');
    await pg.screenshot({path:'/tmp/go-390.png',fullPage:false});
  }
  if(bad.length) errs.push(`[${tag}] console error: ${bad.slice(0,2).join(' | ')}`);
  await pg.close();
}

// ── v2 신규 게이트: 야외 가독성 · Dynamic Type · 즉시 피드백 ──
{
  const pg=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await pg.goto(`${base}/go.html`,{waitUntil:'networkidle'});
  await pg.waitForSelector('.stop');

  // (A) 확대 차단 금지 — Dynamic Type
  const vp=await pg.evaluate(()=>document.querySelector('meta[name=viewport]').content);
  if(/maximum-scale|user-scalable\s*=\s*no/.test(vp)) errs.push(`확대 차단됨: ${vp}`);
  else info.push('Dynamic Type 허용 OK');

  // (B) 기본이 라이트인가 (야외)
  const theme=await pg.evaluate(()=>document.documentElement.dataset.theme);
  const bg=await pg.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  const lum=(c)=>{const m=c.match(/\d+/g).map(Number);
    const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
    return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2]);};
  if(theme!=='day'||lum(bg)<0.5) errs.push(`기본 테마가 밝지 않음 (theme=${theme} bg=${bg})`);
  else info.push(`라이트 퍼스트 OK (배경 휘도 ${lum(bg).toFixed(2)})`);

  // (C) 본문/버튼 대비 AA 4.5:1
  const ratios=await pg.evaluate(()=>{
    const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
    const L=c=>{const m=(c.match(/\d+/g)||[0,0,0]).map(Number);return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};
    const out=[];
    for(const sel of ['.mt','.note','.act.go','.tag','#clock','.sub']){
      const e=document.querySelector(sel); if(!e) continue;
      let bg=getComputedStyle(e).backgroundColor, n=e;
      while(bg==='rgba(0, 0, 0, 0)'&&n.parentElement){n=n.parentElement;bg=getComputedStyle(n).backgroundColor;}
      const a=L(getComputedStyle(e).color), b=L(bg);
      out.push([sel,+(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2))]);
    }
    return out;
  });
  for(const [sel,r] of ratios){ if(r<4.5) errs.push(`대비 미달 ${sel} = ${r}:1 (AA 4.5 필요)`); }
  info.push('대비: '+ratios.map(([s,r])=>`${s} ${r}`).join(' · '));

  // (D) pointer-down 즉시 피드백 (:active 규칙 존재)
  const act=await pg.evaluate(()=>[...document.styleSheets].flatMap(s=>{try{return [...s.cssRules]}catch{return[]}})
    .filter(r=>r.selectorText&&r.selectorText.includes(':active')).length);
  if(act<4) errs.push(`:active 규칙 ${act}개 — 탭 피드백 부족`); else info.push(`:active 규칙 ${act}개`);

  // (E) 시간 인지 스트립 · 사람 필터
  const ct=(await pg.locator('#clock').textContent()||'').trim();
  if(!ct.includes('지금')) errs.push('시간 인지 스트립 비어 있음'); else info.push(`시간 스트립: ${ct}`);
  const wf=await pg.locator('.wf').count();
  if(wf<4) errs.push(`사람 필터 ${wf}개 (4 필요)`); else info.push(`사람 필터 ${wf}개`);
  // 필터가 실제로 미션을 줄이나
  const before=await pg.locator('.stop').first().locator('.mi[data-m]').count();
  await pg.locator('.wf[data-w="k2"]').click(); await pg.waitForTimeout(250);
  const after=await pg.locator('.stop').first().locator('.mi[data-m]').count();
  if(after>=before) errs.push(`필터가 미션을 안 줄임 (${before}→${after})`); else info.push(`필터 동작 ${before}→${after}`);

  // (F) 밤 모드 토글
  await pg.locator('.wf[data-w="*"]').click();
  await pg.locator('#theme').click(); await pg.waitForTimeout(200);
  const nt=await pg.evaluate(()=>document.documentElement.dataset.theme);
  const nbg=await pg.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  if(nt!=='night'||lum(nbg)>0.5) errs.push(`밤 모드 전환 실패 (${nt} ${nbg})`); else info.push('밤 모드 OK');
  await pg.locator('#theme').click(); await pg.waitForTimeout(400);
  const backBg=await pg.evaluate(()=>getComputedStyle(document.querySelector('.mi')).backgroundColor);
  if(lum(backBg)<0.5) errs.push(`낮 모드 복귀 실패 (.mi=${backBg})`); else info.push('낮 복귀 OK');
  await pg.screenshot({path:'/tmp/go-v2.png'});
  await pg.close();
}
// ── 시간 인지 회귀: KST 오전 9시 이전 UTC 날짜 버그 (2026-09-21) ──
for(const [iso,label,step,want] of [
  ['2026-09-22T07:25:00+09:00','첫날 07:25 (UTC로는 전날 — 회귀 고정)',0,'여유'],
  ['2026-09-22T11:52:00+09:00','당일 11:52',8,'여유'],
  ['2026-09-22T12:45:00+09:00','당일 12:45 지연',8,'늦음'],
]){
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Seoul'});
  await ctx.addInitScript(`{const F=Date;const T=new F(${JSON.stringify(iso)}).getTime();
    class D extends F{constructor(...a){if(!a.length)super(T);else super(...a)}static now(){return T}}
    window.Date=D;}`);
  const pg=await ctx.newPage();
  await pg.goto(`${base}/go.html`,{waitUntil:'networkidle'});
  await pg.waitForSelector('.stop');
  for(let k=0;k<step;k++){ await pg.click('#sNext'); await pg.waitForTimeout(80); }
  await pg.waitForTimeout(300);
  const txt=(await pg.locator('#clock').textContent()).trim().replace(/\s+/g,' ');
  if(!txt.includes(want)) errs.push(`시간인지 ${label}: "${want}" 기대했으나 → ${txt}`);
  else info.push(`시간인지 ${label} → ${txt}`);
  await ctx.close();
}

// ── 요일 중복 회귀 (go.js·build_print.mjs 둘 다 같은 실수를 했다) ──
{
  const pg=await browser.newPage({viewport:{width:390,height:844}});
  await pg.goto(`${base}/go.html`,{waitUntil:'networkidle'});
  await pg.waitForSelector('.stop');
  const t=await pg.locator('#dayDate').textContent();
  const dup=(t.match(/\((월|화|수|목|금|토|일)\)/g)||[]).length;
  if(dup>1) errs.push(`날짜에 요일 중복: ${t}`); else info.push(`날짜 표기 OK: ${t.trim()}`);
  await pg.close();
}

await browser.close(); server.close();
info.forEach(i=>console.log('  ·',i));
if(errs.length){console.log('\nRESULT: RED');errs.forEach(e=>console.log('  ✗',e));process.exit(1);}
console.log('\nRESULT: GREEN (0 errors)');
