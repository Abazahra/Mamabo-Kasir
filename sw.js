const CACHE_NAME='mambo-kasir-shell-v2'; // PWA refresh: manifest/icon update
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin)return;
 // Network-first: avoid serving stale JavaScript or HTML during deployments.
 event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
