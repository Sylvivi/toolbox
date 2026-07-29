/* 字体「缺字」兜底槽位的回归测试。
 *
 * 起因：2026-07-29。用户某篇文章的男主名字里有「苼」（U+82BC，在 GBK 但不在 GB2312），
 * 国产花体做子集时基本都不收它。她的引号/短句/精句三个位置都用了「青春例外你是偏爱」——
 * 那个字体确实没收苼（拆 cmap 验过，同时缺的还有 頔、囍），于是名字里其他字是花体、
 * 就苼一个掉回系统字体，一个名字两种笔迹。
 *
 * 解法是加第七个槽位「缺字」，接在装饰位置的字体链尾巴上。浏览器逐字回退，
 * 主字体有的字轮不到它，只有主字体缺的字才用它。
 *
 * 这个文件**只钉同步那一条**（外加三条字体链的断言，很便宜）：
 * 同步载荷里的 fontSlots 是**手写死的**、不是从 READING_FONT_SLOTS 推的（index.html:10318），
 * 而 readingApplyFontSync 会遍历槽位表、把 manifest 里没有的槽位 removeItem 掉。
 * 漏加一个键的后果是「当场好好的、过几小时自己消失」——这种坑肉眼看不见，只能用测试钉。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 两个假字体：主花体（缺生僻字的那种）和补字体（字多的那种）。
// url 用 data: 空样式表，不联网、也不会报错。
function boot() {
    localStorage.setItem('reading_fonts', JSON.stringify([
        { name: '主花体', url: 'data:text/css,' },
        { name: '补字体', url: 'data:text/css,' }
    ]));
    ['reading_font_name', 'reading_font_quote', 'reading_font_quote_short',
     'reading_font_title', 'reading_font_person', 'reading_font_keysent',
     'reading_font_fallback'].forEach(function (k) { localStorage.removeItem(k); });
}
function chainOf(varName) {
    return document.documentElement.style.getPropertyValue(varName).trim();
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._boot=' + boot + ';window._chainOf=' + chainOf + ';' });

    /* ===== A 组：同步（这次改动的真正风险所在）===== */
    const A = await page.evaluate(() => {
        window._boot();
        localStorage.setItem('reading_font_name', '主花体');
        localStorage.setItem('reading_font_quote', '主花体');
        localStorage.setItem('reading_font_fallback', '补字体');
        const m = cfBuildManifest();
        return { 载荷里的缺字: m.fontSlots.fallback, 载荷里的引号: m.fontSlots.quote, 槽位数: Object.keys(m.fontSlots).length };
    });
    eq('推上去的载荷里带着「缺字」选择', A.载荷里的缺字, '补字体');
    eq('载荷里 fontSlots 有全部 7 个槽位（漏一个那个槽位就会自己消失）', A.槽位数, 7);

    const B = await page.evaluate(async () => {
        window._boot();
        localStorage.setItem('reading_font_quote', '主花体');
        localStorage.setItem('reading_font_fallback', '补字体');
        localStorage.setItem('reading_fonts_ts', '2026-07-29T00:00:00.000Z');
        // 云端更新 → 会覆盖本地。用「本机自己刚推上去的那份」当云端，往返一圈不该丢东西。
        const m = cfBuildManifest();
        m.fontsTs = '2026-07-30T00:00:00.000Z';
        readingApplyFontSync(m);
        return { 缺字: localStorage.getItem('reading_font_fallback'), 引号: localStorage.getItem('reading_font_quote') };
    });
    eq('云端拉一圈回来，「缺字」选择还在（不会过几小时自己消失）', B.缺字, '补字体');
    eq('顺带确认别的槽位没被这次改动带坏', B.引号, '主花体');

    const C = await page.evaluate(async () => {
        window._boot();
        localStorage.setItem('reading_font_fallback', '补字体');
        localStorage.setItem('reading_fonts_ts', '2026-07-30T00:00:00.000Z');
        const m = cfBuildManifest();
        m.fontsTs = '2026-07-29T00:00:00.000Z';   // 云端比本地旧
        m.fontSlots.fallback = '';
        readingApplyFontSync(m);
        return localStorage.getItem('reading_font_fallback');
    });
    eq('云端比本地旧时不许覆盖（开机被旧值冲掉的老护栏仍然管着新槽位）', C, '补字体');

    /* ===== B 组：字体链（便宜，顺手钉住「正文不碰」这条约定）===== */
    const D = await page.evaluate(async () => {
        window._boot();
        localStorage.setItem('reading_font_name', '主花体');      // 正文
        localStorage.setItem('reading_font_quote', '主花体');     // 引号
        localStorage.setItem('reading_font_fallback', '补字体');  // 缺字
        readingApplyFonts();
        return {
            正文: window._chainOf('--reading-font'),
            引号: window._chainOf('--reading-font-quote'),
            标题: window._chainOf('--reading-font-title')   // 没选字体 → 该是空的
        };
    });
    ok('正文那条链不接兜底（用户明确要求正文一个字不动）', D.正文.indexOf('补字体') === -1, '实际 ' + D.正文);
    eq('引号链是「主字体在前、兜底在后、serif 收尾」', D.引号, '"主花体", "补字体", serif');
    eq('没单独选字体的槽位照旧不写变量（要靠 CSS inherit 继承父级整条链）', D.标题, '');

    const E = await page.evaluate(async () => {
        window._boot();
        localStorage.setItem('reading_font_quote', '主花体');
        localStorage.setItem('reading_font_fallback', '查无此字体');  // 不在册
        readingApplyFonts();
        const 不在册时 = window._chainOf('--reading-font-quote');
        localStorage.setItem('reading_font_fallback', '主花体');      // 跟主字体同一个
        readingApplyFonts();
        return { 不在册时, 撞车时: window._chainOf('--reading-font-quote') };
    });
    eq('兜底字体还没下载好时，链上不写它（写了会整条声明失效）', E.不在册时, '"主花体", serif');
    eq('兜底跟主字体是同一个时不重复写', E.撞车时, '"主花体", serif');

    /* ===== C 组：删字体时服务器删不掉，必须吭声 =====
     * 2026-07-29 真事：手机上把两个字体删了，服务器上那两份还在。因为 bkSyncDelFont 当时把错误整个吞了，
     * 用户完全不知道只删了一半——而只删一半的下场是下次同步又给拉回来，看起来像「删不掉」。*/
    const F = await page.evaluate(async () => {
        localStorage.setItem('books_sync_url', 'https://books.example.com');
        localStorage.setItem('books_sync_token', 'tok');
        const toasts = [];
        const _toast = window.showToast; window.showToast = function (m) { toasts.push(String(m)); };
        let calls = 0;
        const _fetch = window.fetch;
        window.fetch = function () { calls++; return Promise.reject(new Error('断网')); };
        bkSyncDelFont('要删的字体');
        await new Promise(r => setTimeout(r, 4000));   // 等重试(1.5s)跑完
        window.fetch = _fetch; window.showToast = _toast;
        return { 请求次数: calls, 提示: toasts.join(' ｜ ') };
    });
    eq('删除失败会自己重试一次（手机切网瞬断很常见）', F.请求次数, 2);
    ok('重试还失败就明确告诉用户「只删了本机」', /只删掉了本机/.test(F.提示), '实际提示：' + (F.提示 || '（一声不吭）'));

    const G = await page.evaluate(async () => {
        const toasts = [];
        const _toast = window.showToast; window.showToast = function (m) { toasts.push(String(m)); };
        let calls = 0;
        const _fetch = window.fetch;
        window.fetch = function () { calls++; return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); };
        bkSyncDelFont('要删的字体');
        await new Promise(r => setTimeout(r, 2500));
        window.fetch = _fetch; window.showToast = _toast;
        return { 请求次数: calls, 提示条数: toasts.length };
    });
    eq('删成功时只发一次、不重试', G.请求次数, 1);
    eq('删成功时不打扰用户', G.提示条数, 0);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
