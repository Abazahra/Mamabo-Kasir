// MAMBO KASIR PWA service worker
// IndexedDB tetap menjadi penyimpanan offline utama.
// Jangan mencegat request jaringan: versi sebelumnya memakai cache fallback
// tanpa pernah melakukan precache, sehingga dapat menghasilkan respons kosong.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('mambo-kasir-shell-')).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
