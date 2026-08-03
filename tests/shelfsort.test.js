/* 「书架文件夹内按最近阅读排序」的回归测试。
 *
 * 起因：2026-08-03 用户说「点开文件夹，应该也要做一个排序，最新阅读的文档放在最前面」。
 * 之前只有**文件夹列表**按最近读过排（取组内最大时间戳），点进文件夹后是原始导入顺序。
 *
 * ⚠️ 两条容易写坏的地方，都在这儿钉死了：
 *   1) 排序不许改动 rbBooks 本身的顺序（groups 里装的是同一批对象引用，直接 sort 会串味）——
 *      rbBooks 的顺序是会被 rbSave 存下来的。
 *   2) 没读过的书(ts=0)必须保持原来的导入顺序，不许按名字/字数重排——
 *      同一套书的上下册是按顺序传上来的，重排了反而找不着。
 *
 * 跑法：NODE_PATH=$HOME/.toolbox-test/node_modules node tests/shelfsort.test.js
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');

const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(5000);

    const R = await page.evaluate(() => {
        function mk(name, folder) {
            // ⚠️分类字段是 `_folder`（服务器 manifest 给的），不是 `folder`
            return { id: 'id-' + name, fileName: name + '.txt', fileSize: name.length, _folder: folder, chapters: [{ title: '一', body: '正文' }], lastChapter: null };
        }
        // 同一个文件夹里 5 本，导入顺序 A B C D E
        rbBooks = ['A', 'B', 'C', 'D', 'E'].map(n => mk(n, '测试夹'));
        // 再放一本别的文件夹的，确认分组没被排序带跑
        rbBooks.push(mk('Z', '另一个夹'));
        const importOrder = rbBooks.map(b => b.fileName);

        // 阅读记录：C 最新，A 次新，E 再次；B、D 没读过
        const key = n => n + '.txt|' + n.length;
        localStorage.setItem('reader_pos', JSON.stringify({
            [key('C')]: { ts: 3000 }, [key('A')]: { ts: 2000 }
        }));
        // 「打开时间」这一路也要生效，并且和 reader_pos 取较新的那个
        localStorage.setItem('reading_book_opened', JSON.stringify({
            [key('E')]: 1000, [key('A')]: 500
        }));

        rbCurrentFolder = '测试夹';
        rbRenderShelf();
        const names = [...document.querySelectorAll('#rbShelfList .rb-book-name')].map(e => e.textContent);

        // 文件夹列表视图也再跑一遍，确认没被我这次改动带坏
        rbCurrentFolder = null;
        rbRenderShelf();
        const folders = [...document.querySelectorAll('#rbShelfList .rb-book-name')].map(e => e.textContent);

        return { names, folders, importOrder, after: rbBooks.map(b => b.fileName) };
    });

    eq('文件夹内按最近阅读排：C(3000) > A(2000) > E(1000)，没读过的 B D 按原顺序垫底',
        R.names, ['C.txt', 'A.txt', 'E.txt', 'B.txt', 'D.txt']);
    eq('排序没有反过来改动 rbBooks 本身的顺序', R.after, R.importOrder);
    eq('文件夹列表仍按组内最近时间排（测试夹有 3000、另一个夹没读过）', R.folders, ['测试夹', '另一个夹']);

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail)); });
    console.log(bad ? `❌ ${bad}/${results.length} 条没过` : `✅ 全过（${results.length} 条）`);
    process.exit(bad ? 1 : 0);
})();
