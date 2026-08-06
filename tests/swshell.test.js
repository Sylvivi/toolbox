/* Service Worker「外壳先拿缓存秒开、后台更新」的回归测试（2026-08-07 加）。
 *
 * 起因：线上搬到自建服务器（美国加州）之后，index.html 带 no-cache、Cloudflare 也不缓存它，
 * 每次打开都要穿太平洋取 478KB。用户连说两次「感觉变很慢了」「开网页还是有点慢」。
 * 于是 sw.js v8→v9 改成 stale-while-revalidate。
 *
 * ⚠️为什么必须真起一个 HTTP 服务器来测：Service Worker 只在 https 或 **localhost** 下注册，
 *   `file://` 一律不生效——拿 file:// 测这套等于什么都没测（会假绿）。
 *
 * 守四件事：
 *   ① 装好之后，外壳进了缓存，且键是**统一的 SHELL_KEY('index.html')**。
 *      不统一的话 '/' 和 '/index.html' 会各存一份、各自更新，
 *      出现「桌面图标进是新的、浏览器进还是旧的」。
 *   ② 服务器上的文件换了新版之后，**这一次打开仍然是旧的**（这正是秒开的代价，是预期行为）。
 *   ③ 但页面要收到「有新版本」的提示——不提示的话用户会以为改动没生效。
 *   ④ **再打开一次就是新版了**。后台那趟更新必须真的落了盘
 *      （sw.js 里 e.waitUntil 同步登记就是为了这个；漏了会「怎么刷都还是旧版」）。
 *
 * 跑法：bash tests/p.sh swshell
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

const SRC = path.resolve(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swtest-'));
const PORT = 8000 + Math.floor(Math.random() * 900);

// 把「发布集」拷进临时目录，并在 <title> 里塞一个版本号当探针
function build(tag) {
    let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
    html = html.replace('<title>工具箱</title>', '<title>工具箱' + tag + '</title>');
    fs.writeFileSync(path.join(DIR, 'index.html'), html);
}

(async () => {
    for (const f of ['sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png']) {
        fs.copyFileSync(path.join(SRC, f), path.join(DIR, f));
    }
    build('V1');

    const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1200));

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const page = await ctx.newPage();
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    const URLBASE = 'http://127.0.0.1:' + PORT + '/';

    try {
        // ── 首次访问：注册 SW、预缓存外壳
        /* ⚠️用 domcontentloaded：默认的 'load' 会等 <head> 里那条 Google Fonts 的外链，
           这台机器上它可能很慢/不通，一等就是几十秒，三次加载直接把测试拖过超时。 */
        await page.goto(URLBASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(7000);
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.waitForTimeout(1500);

        const A = await page.evaluate(async () => {
            const ks = await caches.keys();
            const c = await caches.open('toolbox-v9');
            const hit = await c.match('index.html');
            return { 缓存名: ks, 外壳在缓存里: !!hit, 标题: document.title };
        });
        ok('① 缓存用的是 v9', A.缓存名.indexOf('toolbox-v9') !== -1, JSON.stringify(A.缓存名));
        ok('① 外壳存在统一键 index.html 下', A.外壳在缓存里, JSON.stringify(A));
        ok('首次访问拿到的是 V1', /V1$/.test(A.标题), A.标题);

        // ── 服务器换新版（内容和 Last-Modified 都变）
        await page.waitForTimeout(1100);   // 让 mtime 秒级确实往前走
        build('V2');

        // ── 第二次打开：应当还是旧的(V1)，但要弹「有新版本」
        /* ⚠️用 domcontentloaded：默认的 'load' 会等 <head> 里那条 Google Fonts 的外链，
           这台机器上它可能很慢/不通，一等就是几十秒，三次加载直接把测试拖过超时。 */
        await page.goto(URLBASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3500);
        const B = await page.evaluate(() => {
            const t = document.getElementById('toast');
            return { 标题: document.title, 提示: t ? t.textContent : '', 提示可见: !!(t && t.classList.contains('show')) };
        });
        ok('② 这一次打开仍是旧版（秒开的代价，预期行为）', /V1$/.test(B.标题), B.标题);
        ok('③ 弹出了「有新版本」提示', B.提示可见 && /新版本/.test(B.提示), JSON.stringify(B));

        // ── 第三次打开：后台那趟更新该落盘了，应当是 V2
        /* ⚠️用 domcontentloaded：默认的 'load' 会等 <head> 里那条 Google Fonts 的外链，
           这台机器上它可能很慢/不通，一等就是几十秒，三次加载直接把测试拖过超时。 */
        await page.goto(URLBASE, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        const C = await page.evaluate(() => document.title);
        ok('④ 再打开一次就是新版了（后台更新真的落了盘）', /V2$/.test(C), C);

        ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));
    } catch (e) {
        ok('测试跑完没抛异常', false, String(e).slice(0, 300));
    }

    await browser.close();
    srv.kill();
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {}

    let bad = 0;
    for (const r of results) {
        if (r.pass) console.log('  ✅ ' + r.name);
        else { bad++; console.log('  ❌ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
    }
    console.log((bad ? '❌ ' : '✅ ') + (results.length - bad) + '/' + results.length + ' 通过');
    process.exit(bad ? 1 : 0);
})();
