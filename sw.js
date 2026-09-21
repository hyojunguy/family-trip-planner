/* 제주 GO — 오프라인 캐시. 제주 산간에서 신호가 끊겨도 일정은 열린다. */
const C='jejugo-v1';
const ASSETS=['go.html','assets/go.css','assets/go.js','manifest.webmanifest',
  'data/jeju/plans.json','data/jeju/attractions.json','data/jeju/hotels.json',
  'data/jeju/restaurants.json','data/jeju/go-departure.json'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'}))))
    .then(()=>self.skipWaiting()).catch(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(
    fetch(e.request).then(r=>{
      if(r&&r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}
      return r;
    }).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(m=>m||caches.match('go.html')))
  );
});
