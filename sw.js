var CACHE = 'toolbox-v1';
var PRECACHE = ['./', 'index.html', 'manifest.json'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(PRECACHE); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(ks) {
    return Promise.all(ks.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  if (e.request.url.indexOf('api.github.com') !== -1) return;
  if (e.request.url.indexOf('/v1/') !== -1) return;
  e.respondWith(
    fetch(e.request).then(function(r) {
      if (r.ok) { var rc = r.clone(); caches.open(CACHE).then(function(c) { c.put(e.request, rc); }); }
      return r;
    }).catch(function() { return caches.match(e.request); })
  );
});