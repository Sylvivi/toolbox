/* 悬浮球的「剪贴板那一条」（2026-09-16 她要的：省掉粘贴那一步）。
 *
 * 她存一篇小红书原来六步：复制 → 切回来 → 点球 → 点「存小红书」→ 长按粘贴 → 确定。
 * 链接本来就在剪贴板里，让球自己看一眼就够了。
 *
 * 守四件事：
 *  ① 认得出三类：小红书链接 / 别的网址 / 一段文字；
 *  ② **认不出就整条不出现**（宁可少一格，别给她莫名其妙的按钮）；
 *  ③ 读不到剪贴板（没授权 / 不是 https）要**静默**，绝不能挡住那 2×2；
 *  ④ 2×2 本身一格不少——这条是加在上面的，不是挤掉谁。
 *
 * 跑法：node tests/fabclip.test.js  或  bash tests/p.sh fabclip
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    const R = await page.evaluate(async () => {
        const out = {};
        const fab = document.getElementById('fabWrap');
        const menu = document.getElementById('fabMenu');

        // 剪贴板是私有函数，只能从行为上验：换掉 readText 再开合菜单
        function setClip(t) {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { readText: () => (t === null ? Promise.reject(new Error('denied')) : Promise.resolve(t)) }
            });
        }
        async function openAndRead() {
            // ⚠️球是 pointerdown/up 那套手势（点/长按/拖三选一），**click 事件根本不触发**，
            //   所以要真的发一对 pointer 事件，位移为 0 才算"点"。
            const ball = document.getElementById('fabBall');
            if (fab.classList.contains('open')) {
                ball.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 400, pointerId: 1 }));
                ball.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 300, clientY: 400, pointerId: 1 }));
                await new Promise(r => setTimeout(r, 20));
            }
            ball.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 400, pointerId: 1 }));
            ball.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 300, clientY: 400, pointerId: 1 }));
            await new Promise(r => setTimeout(r, 80));
            const row = menu.querySelector('.fab-clip');
            return { acts: menu.querySelectorAll('.fab-act').length,
                     row: row ? row.textContent.trim() : null };
        }

        setClip('看看这个 https://xhslink.cn/o/2EuAPkcjjV0 很好看');
        out.xhs = await openAndRead();
        setClip('https://example.com/a/b');
        out.url = await openAndRead();
        setClip('这是一段随手记下来的话');
        out.txt = await openAndRead();
        setClip('');
        out.empty = await openAndRead();
        setClip(null);                      // 没授权
        out.denied = await openAndRead();
        return out;
    });

    ok('小红书链接 → 「存这条」', R.xhs.row && R.xhs.row.indexOf('存这条') === 0, JSON.stringify(R.xhs));
    ok('别的网址 → 「让蘑菇读」', R.url.row && R.url.row.indexOf('让蘑菇读') === 0, JSON.stringify(R.url));
    ok('一段文字 → 「存成资料」', R.txt.row && R.txt.row.indexOf('存成资料') === 0, JSON.stringify(R.txt));
    ok('剪贴板空 → 整条不出现', R.empty.row === null, JSON.stringify(R.empty));
    ok('没授权 → 静默，不出现也不报错', R.denied.row === null, JSON.stringify(R.denied));
    ok('2×2 一格没少（五种情况都是 4 格）',
        [R.xhs, R.url, R.txt, R.empty, R.denied].every(x => x.acts === 4),
        JSON.stringify([R.xhs.acts, R.url.acts, R.txt.acts, R.empty.acts, R.denied.acts]));
    ok('没有页面报错', errs.length === 0, errs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail && !r.pass ? '  → ' + r.detail : '')); }
    console.log(bad ? `\n${bad} 项没过` : '\n全过');
    process.exit(bad ? 1 : 0);
})();
