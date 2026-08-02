/* 「服务器改了文件夹名，手机上已下载的书跟不跟得上」的回归测试。
 *
 * 起因：2026-08-02。用户让我在服务器上把「bg男生子文包」改成「bg文包」（27 本）。
 * 改完才发现 bkSyncInjectManifest 里那句 `if (localKeys[fk]) return;` ——
 * 本地已有正本的书**整个跳过**，_folder 停在下载那天记下的值。
 * 后果是书架上**两个文件夹并排**：老名字装着已下载的几本、新名字装着还没下载的，
 * 同一批书被劈成两半，而且肉眼看不出是同步的毛病（像是自己手滑建了个新文件夹）。
 *
 * 分类跟正文不同：它本来就是服务器 manifest 给的字段，跟回来不动 fileKey/正文/章数，
 * 所以这里改成「正文不动、分类跟着服务器走」。
 *
 * 这个文件钉三条：① 已下载的书跟着改；② 用户手动「移动到文件夹」的仍然赢；
 * ③ 没变化时不许白写一遍 IndexedDB（rbSave 会把整个书库连正文写一遍，几百本很贵）。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 造两本「已经下载到本地的正本」+ 一本只在服务器上的。落盘一律拦掉，测试不碰 IndexedDB。
function boot() {
    localStorage.removeItem('reading_book_folders');
    window._saved = 0;
    window.rbSave = function () { window._saved++; };
    rbBooks = [
        { id: 'bk_1', fileName: '怨夫.txt', fileSize: 100, chapters: [{ title: 'a', body: 'x' }], _folder: 'bg男生子文包' },
        { id: 'bk_2', fileName: '少爷.txt', fileSize: 200, chapters: [{ title: 'a', body: 'x' }], _folder: 'bg男生子文包' }
    ];
}
// 服务器清单：两本已下载的改了文件夹名，外加一本本地没有的
function srvItems(folder) {
    return {
        '怨夫.txt|100': { fileName: '怨夫.txt', fileSize: 100, nchap: 1, folder: folder },
        '少爷.txt|200': { fileName: '少爷.txt', fileSize: 200, nchap: 1, folder: folder },
        '新书.txt|300': { fileName: '新书.txt', fileSize: 300, nchap: 1, folder: folder }
    };
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._boot=' + boot + ';window._srvItems=' + srvItems + ';' });

    /* ===== A 组：已下载的书跟着服务器改（这次改动的正题）===== */
    const A = await page.evaluate(() => {
        window._boot();
        const added = bkSyncInjectManifest(window._srvItems('bg文包'));
        const 本地两本 = rbBooks.filter(b => !b._remote).map(b => rbBookFolder(b));
        return {
            本地两本: 本地两本,
            新增占位: added,
            正文还在: rbBooks.filter(b => !b._remote).every(b => b.chapters.length === 1),
            存盘次数: window._saved
        };
    });
    eq('已下载的两本跟着改成新文件夹名', A.本地两本, ['bg文包', 'bg文包']);
    eq('本地没有的那本照旧作为占位塞进来', A.新增占位, 1);
    eq('正文一个字没动（分类跟回来，正文仍以本地为主）', A.正文还在, true);
    eq('分类真变了才写盘', A.存盘次数, 1);

    /* ===== B 组：手动「移动到文件夹」仍然赢过服务器 ===== */
    const B = await page.evaluate(() => {
        window._boot();
        // 用户在手机上把《怨夫》挪去了「自行整理」，另一本挪进未分类（空串）
        rbSetBookFolder('怨夫.txt|100', '自行整理');
        rbSetBookFolder('少爷.txt|200', '');
        window._saved = 0;
        bkSyncInjectManifest(window._srvItems('bg文包'));
        const b1 = rbBooks.find(b => b.fileName === '怨夫.txt');
        const b2 = rbBooks.find(b => b.fileName === '少爷.txt');
        return { 显示1: rbBookFolder(b1), 显示2: rbBookFolder(b2), 底下的服务器值: b1._folder };
    });
    eq('手动挪过的书不被服务器冲掉', B.显示1, '自行整理');
    eq('手动挪进「未分类」的也守得住（空串能盖过服务器分类）', B.显示2, '');
    eq('底下仍然记着服务器的新分类（哪天撤销手动覆盖就回到它）', B.底下的服务器值, 'bg文包');

    /* ===== C 组：没变化时不许白写盘 ===== */
    const C = await page.evaluate(() => {
        window._boot();
        bkSyncInjectManifest(window._srvItems('bg男生子文包'));   // 跟本地一模一样
        const 第一次 = window._saved;
        bkSyncInjectManifest(window._srvItems('bg男生子文包'));   // 再来一遍（缓存+联网，一次开书架会调两回）
        return { 第一次: 第一次, 两次之后: window._saved };
    });
    eq('分类没变就不写盘（rbSave 要把整个书库连正文写一遍，很贵）', C.第一次, 0);
    eq('开一次书架调两遍也不会写盘', C.两次之后, 0);

    /* ===== D 组：重复调用不许把书越堆越多（老行为，顺手钉住）===== */
    const D = await page.evaluate(() => {
        window._boot();
        bkSyncInjectManifest(window._srvItems('bg文包'));
        bkSyncInjectManifest(window._srvItems('bg文包'));
        return { 总数: rbBooks.length, 正本数: rbBooks.filter(b => !b._remote).length };
    });
    eq('调两遍还是 3 本（旧占位先清掉，不会重复）', D.总数, 3);
    eq('正本仍是 2 本', D.正本数, 2);

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail)); });
    console.log(bad ? `❌ ${bad}/${results.length} 条没过` : `✅ 全过（${results.length} 条）`);
    process.exit(bad ? 1 : 0);
})();
