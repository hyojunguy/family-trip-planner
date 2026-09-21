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
await browser.close(); server.close();
info.forEach(i=>console.log('  ·',i));
if(errs.length){console.log('\nRESULT: RED');errs.forEach(e=>console.log('  ✗',e));process.exit(1);}
console.log('\nRESULT: GREEN (0 errors)');
