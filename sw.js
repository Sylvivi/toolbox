var CACHE = 'toolbox-v8';   // v7→v8：顺便把之前误存进来的书籍/字体响应（单个能有 19MB）整批清掉
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
  if (e.request.url.indexOf('.workers.dev') !== -1) return;
  // 书籍/字体同步服务器（Caddy 把 https://<域名>/books/* 反代过去）：绝对不能进缓存。
  // 这是同步数据不是页面资源，缓存它有两个害处：① 一个字体响应就有 19MB，r.clone() 要在内存里
  // 多留一份、再写一份进 Cache Storage；② Cache Storage 和 IndexedDB 共用同一个源的存储配额，
  // 缓存被这些大响应顶满时，字体落盘的 idbSet 事务会失败——而那个失败是静默的，
  // 表现就是「另一台设备怎么都拉不到字体，书却一切正常」（2026-07-29 查了半天的那个）。
  if (e.request.url.indexOf('/books/') !== -1) return;
  e.respondWith(
    fetch(e.request).then(function(r) {
      if (r.ok) { var rc = r.clone(); caches.open(CACHE).then(function(c) { c.put(e.request, rc); }); }
      return r;
    }).catch(function() { return caches.match(e.request); })
  );
});