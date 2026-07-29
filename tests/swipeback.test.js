/* 右滑返回手势的回归测试（聊天面板 + 书架/目录/文件夹）。
 *
 * 起因：用户 2026-07-29「目录和书架我也想做个左滑退出的手势，不然老是要用手去点」，
 * 并当场补充「那个文件夹也要手势」。方向她确认要跟聊天面板/系统返回同向 ——
 * **从屏幕左边缘往右划**。于是把聊天原有的那套抽成公用 attachSwipeBack，两个面板共用。
 *
 * 这个文件守两件事：
 *   ① 书架面板一次退一层：目录 → 书架(文件夹内) → 文件夹列表 → 关掉；
 *   ② 抽取重构没把聊天面板原来的右滑退出弄坏。
 * 外加一组「不该触发」的边界（往左划 / 斜着划 / 右半屏起手 / 划太短 / 面板没开）——
 * 手势最贵的失败不是"滑不动"，是**滚动正文时误触发退出**，那组比主线更值得钉住。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function eq(name, got, want) {
    results.push({ name, pass: JSON.stringify(got) === JSON.stringify(want), detail: '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want) });
}

// 在页面里模拟一次真实的手指滑动（touchstart → touchmove → touchend）
function installSwipe() {
    window._swipe = function (selector, x0, y0, x1, y1) {
        const el = document.querySelector(selector);
        const mk = (type, x, y) => {
            const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
            return new TouchEvent(type, {
                touches: type === 'touchend' ? [] : [t], targetTouches: [], changedTouches: [t],
                bubbles: true, cancelable: true
            });
        };
        el.dispatchEvent(mk('touchstart', x0, y0));
        el.dispatchEvent(mk('touchmove', x1, y1));
        el.dispatchEvent(mk('touchend', x1, y1));
    };
    // ⚠️必须造两本真书：rbRenderShelf 在「书架为空」时会把 rbCurrentFolder 重置成 null，
    // 空书架下文件夹那一层根本不存在，测出来会假阳性地"少退一层"（写这个测试时真踩到）。
    window.rbBooks = [
        { id: 'bk_t1', fileName: '测试书甲.txt', fileSize: 111, chapters: [{ title: '第一章', body: '正文甲' }], _folder: '测试文件夹' },
        { id: 'bk_t2', fileName: '测试书乙.txt', fileSize: 222, chapters: [{ title: '第一章', body: '正文乙' }], _folder: '测试文件夹' }
    ];
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.evaluate(installSwipe);

    // 面板当前停在哪一层
    const layer = () => page.evaluate(() => {
        const m = document.getElementById('rbModal');
        if (!m.classList.contains('show')) return '关闭';
        if (document.getElementById('rbChapterView').style.display !== 'none') return '目录';
        return rbCurrentFolder !== null ? '文件夹里' : '文件夹列表';
    });
    // 摆好某一层的状态
    const setLayer = (l) => page.evaluate((l) => {
        document.getElementById('rbBg').classList.add('show');
        document.getElementById('rbModal').classList.add('show');
        const shelf = document.getElementById('rbShelfView'), chap = document.getElementById('rbChapterView');
        if (l === '目录') { shelf.style.display = 'none'; chap.style.display = ''; rbCurrentFolder = '测试文件夹'; }
        else if (l === '文件夹里') { shelf.style.display = ''; chap.style.display = 'none'; rbCurrentFolder = '测试文件夹'; }
        else { shelf.style.display = ''; chap.style.display = 'none'; rbCurrentFolder = null; }
    }, l);
    const swipe = (sel, x0, y0, x1, y1) => page.evaluate(a => window._swipe(a[0], a[1], a[2], a[3], a[4]), [sel, x0, y0, x1, y1]);
    const back = () => swipe('#rbModal', 20, 400, 140, 400);   // 左边缘往右划 120px（阈值 80px）

    /* —— A 组：一次退一层 —— */
    await setLayer('目录');
    eq('A1 起点＝某本书的目录里', await layer(), '目录');
    await back(); await page.waitForTimeout(150);
    eq('A2 滑第 1 次 → 回书架(仍在文件夹内)', await layer(), '文件夹里');
    await back(); await page.waitForTimeout(150);
    eq('A3 滑第 2 次 → 回文件夹列表', await layer(), '文件夹列表');
    await back(); await page.waitForTimeout(150);
    eq('A4 滑第 3 次 → 关掉面板', await layer(), '关闭');

    /* —— B 组：不该触发的（比主线更重要：误触发＝读者滚正文时面板自己关了）—— */
    await setLayer('目录');
    await swipe('#rbModal', 140, 400, 20, 400); await page.waitForTimeout(150);
    eq('B1 往左划：不动', await layer(), '目录');
    await swipe('#rbModal', 20, 300, 140, 500); await page.waitForTimeout(150);
    eq('B2 斜着划(竖向偏 200px)：不动', await layer(), '目录');
    await swipe('#rbModal', 300, 400, 380, 400); await page.waitForTimeout(150);
    eq('B3 从右半屏起手：不动', await layer(), '目录');
    await swipe('#rbModal', 20, 400, 60, 400); await page.waitForTimeout(150);
    eq('B4 划得太短(40px<阈值80)：不动', await layer(), '目录');
    await page.evaluate(() => document.getElementById('rbModal').classList.remove('show'));
    await back(); await page.waitForTimeout(150);
    eq('B5 面板没开着：不响应', await layer(), '关闭');

    /* —— C 组：抽取重构别把聊天面板原来的右滑弄坏 —— */
    await page.evaluate(() => { openChatModal(); chatSwitchView('list'); chatRenderHistoryList(); });
    await page.waitForTimeout(500);
    await swipe('.chat-modal', 20, 400, 140, 400);
    await page.waitForTimeout(400);
    eq('C1 聊天列表右滑仍能退出', await page.$eval('#chatModalOverlay', e => e.classList.contains('show') ? '开着' : '关闭'), '关闭');

    results.push({ name: 'D1 全程无 JS 报错', pass: errs.length === 0, detail: errs.slice(0, 3).join(' | ') || '(无)' });

    await browser.close();
    let fail = 0;
    results.forEach(r => { if (!r.pass) fail++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail)); });
    console.log(fail ? `❌ ${fail}/${results.length} 条未通过` : `✅ ${results.length} 条全通过`);
    process.exit(fail ? 1 : 0);
})();
