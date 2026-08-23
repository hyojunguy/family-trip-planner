/* 확정 일정 화면 렌더 검증 — 코드리뷰로는 안 잡히는 것만 본다.
   (1) 320~1440 가로 오버플로 0  (2) 새 카드가 실제로 그려지는가
   (3) 아침이 조식만인가(식당 카드 0)  (4) 간식 슬롯이 화면에 있는가
   실행: NODE_PATH="$(npm root -g)" node scripts/render_check.mjs [planId] */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PLAN = process.argv[2] || 'jeju-2609-jungmun';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.mp4':'video/mp4', '.kml':'application/xml' };

const server = createServer(async (req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const fp = join(ROOT, normalize(u === '/' ? '/index.html' : u).replace(/^(\.\.[/\\])+/, ''));
  try {
    const buf = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errs = [], warns = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrs = [];
page.on('pageerror', e => consoleErrs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });

// 해시 라우팅(#도시/여행안)이 정본이다 — 버튼을 더듬지 않는다
await page.goto(`${base}#jeju/${PLAN}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const got = await page.evaluate(() => {
  const q = s => document.querySelector(s);
  const meals = [...document.querySelectorAll('.meal')].map(m => ({
    slot: (m.querySelector('.meal-slot')?.textContent || '').trim().replace(/\s+/g, ' '),
    snack: m.classList.contains('snack'), bfast: m.classList.contains('bfast'),
    buffet: !!m.querySelector('.rest.buffet'),
    rests: m.querySelectorAll('details.rest:not(.buffet)').length }));
  return {
    plan: (location.hash.split('/')[1] || null),
    musteat: !!q('#musteat'), mustItems: document.querySelectorAll('#musteat .me-it').length,
    deals: !!q('#deals'), dealItems: document.querySelectorAll('#deals .dl').length,
    hub: !!q('#hub'), hubFood: document.querySelectorAll('#hub .hb-f').length,
    days: document.querySelectorAll('.day-block').length, meals,
    dealSub: q('#deals .deck-sub')?.textContent?.trim() || null };
});

if (got.plan !== PLAN) errs.push(`여행안 선택 실패: ${got.plan} (원했던 것 ${PLAN})`);
if (got.days < 4) errs.push(`일자 카드 ${got.days}개 (4개여야 함)`);
const bfast = got.meals.filter(m => m.slot.includes('아침'));
if (!bfast.length) errs.push('아침 끼니가 화면에 없음');
bfast.forEach((m, i) => {
  if (!m.buffet) errs.push(`아침[${i}] 조식 카드 없음`);
  if (m.rests) errs.push(`아침[${i}] 식당 카드 ${m.rests}개 — 조식만 있어야 함`);
  if (!m.bfast) warns.push(`아침[${i}] .bfast 색 구분 클래스 없음`);
});
const snacks = got.meals.filter(m => m.snack);
if (!snacks.length) warns.push('간식 슬롯이 화면에 없음');
if (!got.musteat || !got.mustItems) warns.push('필수 음식 카드가 비어 있음');
if (!got.deals || !got.dealItems) warns.push('예약 할인 카드가 비어 있음');
if (!got.hub) warns.push('출발 허브(공항) 카드 없음');

// ---- 📍 지금 시트: 아이가 실제로 쓰는 경로를 375px 에서 태운다 ----
await page.setViewportSize({ width: 375, height: 780 });
await page.waitForTimeout(400);
const nowRes = await (async () => {
  const btn = await page.$('#nowBtn');
  if (!btn) return { ok: false, why: '지금 버튼 없음' };
  await btn.click();
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => {
    const b = document.getElementById('nowSheet');
    return b && !b.hidden && document.querySelectorAll('#nowSheet .nw-w').length;
  });
  if (!shown) return { ok: false, why: '시트가 안 열림' };
  // 동생(k2)으로 전환 → 그 아이 미션만 나오는지
  const perChild = await page.evaluate(async () => {
    const pick = w => document.querySelector(`#nowSheet .nw-w[data-w="${w}"]`)?.click();
    const missionsOf = () => [...document.querySelectorAll('#nowSheet .nw-m .nw-t')].map(e => e.textContent.trim());
    pick('k1'); await new Promise(r => setTimeout(r, 250));
    const a = missionsOf();
    pick('k2'); await new Promise(r => setTimeout(r, 250));
    const b = missionsOf();
    // 아무 미션 하나 체크 → 저장되고 일정 카드와 맞물리는지
    const cb = document.querySelector('#nowSheet .nw-m input');
    let synced = null, mid = null;
    if (cb) { mid = cb.dataset.mid; cb.click(); await new Promise(r => setTimeout(r, 250));
      const other = document.querySelector(`.rec-ms input[data-mid="${mid}"]`);
      synced = other ? other.checked : 'no-day-card';
      const again = document.querySelector(`#nowSheet .nw-m input[data-mid="${mid}"]`);
      if (again) { again.click(); await new Promise(r => setTimeout(r, 200)); } }
    return { k1: a, k2: b, checked: !!cb, synced, mid };
  });
  const ov = await page.evaluate(() => {
    const b = document.getElementById('nowSheet');
    return { sw: b.scrollWidth, cw: b.clientWidth };
  });
  await page.evaluate(() => document.querySelector('#nowSheet .nw-x')?.click());
  await page.waitForTimeout(300);
  return { ok: true, ...perChild, ov };
})();
if (!nowRes.ok) errs.push(`지금 시트: ${nowRes.why}`);
else {
  if (!nowRes.k1.length && !nowRes.k2.length) warns.push('지금 시트에 미션이 하나도 안 뜸(미리보기 모드에서는 정상일 수 있음)');
  if (nowRes.k1.length && nowRes.k2.length && JSON.stringify(nowRes.k1) === JSON.stringify(nowRes.k2))
    warns.push('언니/동생 미션 목록이 동일 — 역할 분리가 안 먹었을 수 있음');
  if (nowRes.checked && nowRes.synced === false) errs.push('지금 시트에서 체크한 미션이 일정 카드와 동기화되지 않음');
  if (nowRes.ov.sw > nowRes.ov.cw + 1) errs.push(`지금 시트 가로 오버플로 ${nowRes.ov.sw - nowRes.ov.cw}px`);
}

for (const w of [320, 375, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(350);
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    wide: [...document.querySelectorAll('body *')]
      .filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 4).map(e => `${e.tagName}.${(e.className || '').toString().split(' ')[0]}`) }));
  if (o.sw > o.cw + 1) errs.push(`${w}px 가로 오버플로 ${o.sw - o.cw}px — ${o.wide.join(', ')}`);
}
if (consoleErrs.length) errs.push(`콘솔 에러 ${consoleErrs.length}건: ${consoleErrs[0].slice(0, 140)}`);

await browser.close(); server.close();
console.log('=== RENDER CHECK ===');
console.log(JSON.stringify({ plan: got.plan, days: got.days, meals: got.meals.length,
  breakfasts: bfast.length, snacks: snacks.length, mustEat: got.mustItems,
  deals: got.dealItems, hubFood: got.hubFood, dealSub: got.dealSub,
  now: { opened: nowRes.ok, k1: (nowRes.k1||[]).length, k2: (nowRes.k2||[]).length,
         synced: nowRes.synced } }, null, 1));
for (const w of warns) console.log('WARN:', w);
for (const e of errs) console.log('FAIL:', e);
console.log(errs.length ? `RESULT: RED (${errs.length} errors)` : `RESULT: GREEN (0 errors, ${warns.length} warns)`);
process.exit(errs.length ? 1 : 0);
