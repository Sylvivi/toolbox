/* 「同一个文件导第二次」的回归测试（2026-08-06 加）。
 *
 * 起因：用户「我发现在手机上，书架里有两本社会性动物」，追问时补了一句
 * 「不是重了，就是两个会一起移动什么的」——那句正是关键线索：两条书架记录
 * 的文件夹/书名/划线/小注全是联动的，因为它们**按 fileKey 存**，而两条的
 * fileKey 一模一样。也就是说数据层面本来就是同一本书，只是 rbBooks 里排了两行。
 *
 * 根因：rbAddBook 一句查重都没有，同一个文件导第二次就无脑 unshift 一本新的。
 *
 * 守四件事：
 *   ① 同 fileKey 再导 → 弹窗问一句（用户选的是「问我」，不是静默跳过）。
 *   ② 点「确定」＝打开已有那本，**书架不增加**。
 *   ③ 点「取消」＝仍然再存一份（她说有时确实想要两份）。
 *   ④ ⚠️只拦本地正本，**_remote 占位书不算重复**——否则「服务器上有、想导到本地」
 *      这条路会被自己拦死。
 *
 * 跑法：bash tests/p.sh dupbook
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* confirm 是原生弹窗，headless 里会挂住。装一个可编程的替身：
       window.__confirmAnswer 决定点「确定」还是「取消」，并记下弹窗文案。 */
    await page.addScriptTag({ content: `
        window.__confirmLog = [];
        window.__confirmAnswer = true;
        window.confirm = function (msg) { window.__confirmLog.push(msg); return window.__confirmAnswer; };
        // rbSave 会写 IndexedDB，测试里不需要，省掉避免异步干扰
        window.__realSave = window.rbSave; window.rbSave = function () {};
        // bkSyncPush 会往服务器发请求，测试里掐掉
        window.bkSyncPush = function () {};
        window.__reset = function () {
            window.rbBooks = [];
            window.rbActiveBookId = null;
            window.__confirmLog = [];
        };
        window.__shelf = function () {
            return window.rbBooks.map(function (b) {
                return { name: b.fileName, size: b.fileSize, remote: !!b._remote, id: b.id };
            });
        };
    ` });

    /* ── A 组：第一次导入照常进书架 ─────────────────────────────── */
    const A = await page.evaluate(() => {
        window.__reset();
        rbAddBook('社会性动物.epub', 1672192, 'epub', [{ title: '第一章', body: '正文甲' }], '正文甲');
        return { 书架: window.__shelf(), 弹窗: window.__confirmLog.length };
    });
    eq('第一次导入：进书架，不弹窗', [A.书架.length, A.弹窗], [1, 0]);

    /* ── B 组：同一个文件再导 → 弹窗；点「确定」＝打开已有的，不新增 ── */
    const B = await page.evaluate(() => {
        window.__reset();
        rbAddBook('社会性动物.epub', 1672192, 'epub', [{ title: '第一章', body: '正文甲' }], '正文甲');
        const 原id = window.rbBooks[0].id;
        window.__confirmAnswer = true;   // 点「确定」
        rbAddBook('社会性动物.epub', 1672192, 'epub', [{ title: '第一章', body: '正文甲' }], '正文甲');
        return { 书架: window.__shelf(), 弹窗文案: window.__confirmLog[0] || '', 原id, 当前打开: window.rbActiveBookId };
    });
    eq('① 同一个文件再导，书架仍然只有 1 本', B.书架.length, 1);
    ok('① 确实弹了窗、且说清了是哪本书', /社会性动物\.epub/.test(B.弹窗文案) && /已经有了/.test(B.弹窗文案), B.弹窗文案);
    ok('② 点「确定」＝打开的是已有那本（id 没变）', B.当前打开 === B.原id, B.当前打开 + ' vs ' + B.原id);

    /* ── C 组：点「取消」＝仍然再存一份 ─────────────────────────── */
    const C = await page.evaluate(() => {
        window.__reset();
        rbAddBook('社会性动物.epub', 1672192, 'epub', [{ title: '第一章', body: '正文甲' }], '正文甲');
        window.__confirmAnswer = false;  // 点「取消」
        rbAddBook('社会性动物.epub', 1672192, 'epub', [{ title: '第一章', body: '正文甲' }], '正文甲');
        return window.__shelf();
    });
    eq('③ 点「取消」＝真的再存一份（书架 2 本）', C.length, 2);

    /* ── D 组：大小不同 ＝ 不同的书，别误拦 ─────────────────────── */
    const D = await page.evaluate(() => {
        window.__reset();
        rbAddBook('社会性动物.epub', 1672192, 'epub', [{ title: '第一章', body: '甲' }], '甲');
        window.__confirmAnswer = true;
        // 同名但大小不同（换了个版本）→ 是另一本书，不该拦
        rbAddBook('社会性动物.epub', 999999, 'epub', [{ title: '第一章', body: '乙' }], '乙');
        return { 书架: window.__shelf(), 弹窗: window.__confirmLog.length };
    });
    eq('同名但大小不同＝另一本书，不拦、不弹窗', [D.书架.length, D.弹窗], [2, 0]);

    /* ── E 组：⚠️占位书不算重复 ────────────────────────────────── */
    const E = await page.evaluate(() => {
        window.__reset();
        // 模拟「服务器上有、本地还没下载」的占位书
        window.rbBooks = [{ id: 'remote_x', fileName: '社会性动物.epub', fileSize: 1672192, chapters: [], _remote: true }];
        window.__confirmAnswer = true;
        rbAddBook('社会性动物.epub', 1672192, 'epub', [{ title: '第一章', body: '正文甲' }], '正文甲');
        const s = window.__shelf();
        return { 弹窗: window.__confirmLog.length, 本地正本数: s.filter(b => !b.remote).length };
    });
    /* ⚠️占位书拦下来的话，「服务器上有、我想导到本地」这条路会被自己堵死。 */
    eq('④ 占位书不算重复：不弹窗，本地正本照常建出来', [E.弹窗, E.本地正本数], [0, 1]);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) {
        if (r.pass) console.log('  ✅ ' + r.name);
        else { bad++; console.log('  ❌ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
    }
    console.log((bad ? '❌ ' : '✅ ') + (results.length - bad) + '/' + results.length + ' 通过');
    process.exit(bad ? 1 : 0);
})();
