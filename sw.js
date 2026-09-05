/* v8→v9（2026-08-07）：外壳改成「先拿缓存秒开、后台悄悄更新」（stale-while-revalidate）。
   起因：线上从 GitHub Pages 搬到自建服务器后，服务器在**美国加州**，而 index.html 带 no-cache、
   Cloudflare 不缓存它（cf-cache-status 一直是 DYNAMIC），于是**每次打开都要穿太平洋取 478KB**。
   用户连着说了两次「感觉变很慢了」「开网页还是有点慢」。
   改完之后：有缓存就瞬间出画面，新版在后台取、下次打开就是新的；
   取到新版时给页面发一条消息，弹「有新版本，点这里刷新」，免得她以为改动没生效。
   ⚠️版本号一定要跟着变（v8→v9），否则 activate 里那段清旧缓存不会跑。 */
var CACHE = 'toolbox-v11';   // ⚠️2026-09-06 +1：靠 activate 里那段清掉被同步响应撑到 8.48GB 的旧缓存
/* ⚠️故意**不预缓存 './'**：它和 'index.html' 是同一个 1.9MB 的文件，会白存两份。
   下面 fetch 里外壳一律归一到 SHELL_KEY，'./' 那份存了也没人读，纯浪费配额。
   而 Cache Storage 跟 IndexedDB **共用同一个源的配额**——顶满时字体落盘的 idbSet 会**静默**失败
   （2026-07-29 查了半天的「另一台设备怎么都拉不到字体，书却一切正常」就是这个）。 */
var PRECACHE = ['index.html', 'manifest.json'];
/* 外壳在缓存里的**统一键**：'/'（导航请求）和 '/index.html' 是同一个文件，
   但它们的 Request URL 不同。不统一的话会存成两份、各自更新，
   出现「从桌面图标进是新的、从浏览器进还是旧的」这种见了鬼的现象。 */
var SHELL_KEY = 'index.html';

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

// 这个请求要的是不是「应用外壳」（那个 1.9MB 的 index.html）
function _isShell(req) {
  if (req.mode === 'navigate') return true;
  try {
    var u = new URL(req.url);
    if (u.origin !== self.location.origin) return false;
    return u.pathname === '/' || /\/index\.html$/.test(u.pathname);
  } catch (e) { return false; }
}

/* 拿来判断「是不是同一版」的指纹。
   ⚠️源站（Caddy 的 file_server）**不发 ETag、只发 Last-Modified**，经 Cloudflare 之后也还在，
   所以两个都取、谁有用谁。两边都拿不到时就当「没变」——宁可不提示，也别每次都弹。 */
function _stamp(r) {
  return r ? (r.headers.get('ETag') || r.headers.get('Last-Modified') || '') : '';
}

/* 这个请求值不值得存进离线缓存。⚠️白名单，不是黑名单——理由见下面 fetch 末尾那段。 */
function _cacheable(req) {
  try {
    var u = new URL(req.url);
    return /\.(woff2?|ttf|otf|css|js|png|jpe?g|webp|gif|svg|ico)$/i.test(u.pathname);
  } catch (e) { return false; }
}

function _tellClients() {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(function(cs) {
    cs.forEach(function(c) { c.postMessage({ type: 'toolbox-update' }); });
  });
}

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  if (e.request.url.indexOf('api.github.com') !== -1) return;
  if (e.request.url.indexOf('/v1/') !== -1) return;
  if (e.request.url.indexOf('.workers.dev') !== -1) return;
  /* ⚠️⚠️云同步的响应**绝对不能进缓存**（2026-09-06 查出来的，代价是 8.48GB）。
     她截图问「为啥我的 toolbox 在本地有 9GB 数据」，明细一看：离线缓存 8.48GB，
     而书和对话加起来才 109MB。
     怎么堆起来的：自动同步每 30 秒 GET 一次 `_manifest`（**那一包已经 2.64MB**），
     而 cfReq 为了防缓存在网址后面挂了 `_t=时间戳`——**每次网址都不一样**，
     在 Cache Storage 眼里就是一个个全新的文件，于是一天两千多份、每份 2.64MB。
     ⚠️原来只排除了 `.workers.dev`，可她的 Worker 挂在**自定义域** sync.masterofmydomain.top 上，
       那条规则一次都没匹配上——**别再用「云服务商的默认域名」来做排除判断**。
     ⚠️所以这里改成认两样东西，任缺一样都会漏：
       ① 同步用的两个域名（旧 CF 的 sync.、自建的 tbsync.）；
       ② 网址里带 `_t=` 的——那是「这一趟不许拿缓存」的标记，
          任何带它的请求本来就不该被存下来。 */
  if (e.request.url.indexOf('//sync.') !== -1) return;
  if (e.request.url.indexOf('//tbsync.') !== -1) return;
  if (/[?&]_t=\d/.test(e.request.url)) return;
  // 书籍/字体同步服务器（Caddy 把 https://<域名>/books/* 反代过去）：绝对不能进缓存。
  // 这是同步数据不是页面资源，缓存它有两个害处：① 一个字体响应就有 19MB，r.clone() 要在内存里
  // 多留一份、再写一份进 Cache Storage；② Cache Storage 和 IndexedDB 共用同一个源的存储配额，
  // 缓存被这些大响应顶满时，字体落盘的 idbSet 事务会失败——而那个失败是静默的，
  // 表现就是「另一台设备怎么都拉不到字体，书却一切正常」（2026-07-29 查了半天的那个）。
  if (e.request.url.indexOf('/books/') !== -1) return;

  /* ===== 外壳：先拿缓存秒开，后台更新 =====
     ⚠️两个顺序上的讲究，别图省事改：
       ① fetch **必须立刻发起**、且 e.waitUntil 要在事件处理函数里**同步**登记。
          写成「等查完缓存再 fetch」的话，respondWith 早就用缓存把响应给出去了，
          浏览器随时可能把 Service Worker 杀掉，后台那趟更新就半路夭折——
          表现是「怎么刷都还是旧版」，而且极难查。
       ② 只有**旧的存在**时才提示新版。首次访问没有旧的，一提示就成了莫名其妙的弹窗。 */
  if (_isShell(e.request)) {
    var hitP = caches.open(CACHE).then(function(c) {
      return c.match(SHELL_KEY).then(function(hit) { return { c: c, hit: hit }; });
    });
    var netP = fetch(e.request).then(function(r) {
      if (!r || !r.ok) return r;
      return hitP.then(function(o) {
        var before = _stamp(o.hit), after = _stamp(r);
        return o.c.put(SHELL_KEY, r.clone()).then(function() {
          if (o.hit && before && after && before !== after) return _tellClients();
        }).then(function() { return r; });
      });
    }).catch(function() { return hitP.then(function(o) { return o.hit; }); });
    e.waitUntil(netP);
    e.respondWith(hitP.then(function(o) { return o.hit || netP; }));
    return;
  }

  /* 其余资源：先走网络，断网才回缓存。
     ⚠️**但只有白名单里的才存**（2026-09-06 改）。原来是「只要 r.ok 就 put」，
       配一串黑名单挡掉不该存的——而黑名单永远会漏：这次就漏在
       「Worker 绑了自定义域名，`.workers.dev` 那条匹配不上」，一路漏了 8.48GB。
     ⚠️白名单只认**扩展名**，认的是「这是一个看得见的资源文件」：
       字体 / 图片 / 样式 / 图标。API 响应、同步数据、书库数据都没有这种扩展名，
       天然进不来——**以后再加什么新接口、连什么新域名，都不需要记得来这里加排除**。
     ⚠️代价：没有扩展名的资源不再被离线缓存（比如某些动态图片地址），
       断网时它们取不到。那是可以接受的——真正要离线可用的是外壳，那条走上面的分支。 */
  if (!_cacheable(e.request)) return;
  e.respondWith(
    fetch(e.request).then(function(r) {
      if (r.ok) { var rc = r.clone(); caches.open(CACHE).then(function(c) { c.put(e.request, rc); }); }
      return r;
    }).catch(function() { return caches.match(e.request); })
  );
});
