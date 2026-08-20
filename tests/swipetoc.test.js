/* 阅读界面「左滑开目录」手势的回归测试。
 *
 * 起因：她 2026-08-21「阅读界面的右滑手势是退出，我想弄一个左滑手势是把目录自动打开」，
 * 紧接着补了一句 **「这种手势不能影响到我长按选中文章的文字哦」**。
 *
 * 所以这个文件的重点不是"能不能开目录"（那只有一条），而是**一整组不该触发的情况**：
 *   ⚠️选字守卫（起手时已有选区 / 划到一半才冒出选区）——左滑跟「选中后把右边小圆点往左拖」
 *     完全同向，比右滑更容易撞上，这是她点名的要求；
 *   ⚠️方向、竖偏、起手区、模式（普通聊天不该开目录）、流式中；
 *   ⚠️以及右滑返回没被带坏——同一个 .chat-modal 上现在挂了两个方向。
 *
 * 跑法：node tests/swipetoc.test.js
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

function installHarness() {
    // 模拟一次真手指滑动
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
    // 记账：目录开了几次、返回走了几次。不真跑那两个函数（会连带渲染书架/切视图）
    window._tocCalls = 0; window._backCalls = 0;
    window.rbOpenShelf = function () { window._tocCalls++; };
    window.chatBackToList = function () { window._backCalls++; };
    // 摆成「阅读模式的正文页」
    window._asReader = function () {
        chatReaderMode = true; chatView = 'conv'; chatStreaming = false;
        window._tocCalls = 0; window._backCalls = 0;
        var s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges();
    };
    // 造一段可见文字并选中它（模拟长按选字）
    // ⚠️必须挂在 document.body 上、且真渲染出来：.chat-modal 默认隐藏，挂它里面的话
    //   Selection.toString() 读出来是空串，测试会假报「守卫没生效」（swipeselect 那边踩过，这里又踩了一次）
    window._selectSomeText = function () {
        var p = document.getElementById('_selProbe');
        if (!p) {
            p = document.createElement('p');
            p.id = '_selProbe';
            p.textContent = '这是一段用来测试选中的正文文字';
            p.style.cssText = 'position:fixed;left:20px;top:600px;font-size:16px;z-index:99999;background:#fff';
            document.body.appendChild(p);
        }
        var r = document.createRange();
        r.selectNodeContents(p);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        return String(sel).trim().length;
    };
    window._clearSel = function () {
        var p = document.getElementById('_selProbe'); if (p) p.remove();
        var s = window.getSelection(); if (s) s.removeAllRanges();
    };
}

(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.evaluate(installHarness);

    // 视口 400 宽 → edge = min(400*0.45, 160) = 160；左滑起手区是 x >= 240
    const swipe = (x0, y0, x1, y1) => page.evaluate(([a, b, c, d]) => {
        window._asReader();
        window._swipe('.chat-modal', a, b, c, d);
        return { toc: window._tocCalls, back: window._backCalls };
    }, [x0, y0, x1, y1]);

    /* ===== A 组：正常该开 ===== */
    ok('A1 从右边缘往左划够 80px → 开目录', (await swipe(380, 400, 280, 400)).toc === 1);
    ok('A2 划得更远也只开一次', (await swipe(390, 400, 150, 400)).toc === 1);
    ok('A3 起手区内侧边界（x=240）也算数', (await swipe(250, 400, 150, 400)).toc === 1);

    /* ===== B 组：⚠️她点名的——不许影响选字 ===== */
    const B1 = await page.evaluate(() => {
        window._asReader();
        var len = window._selectSomeText();          // 先选中一段（模拟长按选字）
        window._swipe('.chat-modal', 380, 400, 280, 400);
        var r = { selLen: len, toc: window._tocCalls, stillSelected: String(window.getSelection()).trim().length };
        window._clearSel();
        return r;
    });
    ok('B0 选区真的建起来了（不是空串）', B1.selLen > 0, String(B1.selLen));
    ok('B1 ⚠️已有选区时左滑不开目录', B1.toc === 0, '开了 ' + B1.toc + ' 次');
    ok('B2 ⚠️手势也没把选区弄掉', B1.stillSelected > 0, String(B1.stillSelected));

    const B3 = await page.evaluate(() => {
        window._asReader();
        var el = document.querySelector('.chat-modal');
        const mk = (type, x, y) => {
            const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
            return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true });
        };
        // 起手时没有选区 → 划到一半才冒出来（iPad 上长按选中后手指不抬接着拖就是这样）
        el.dispatchEvent(mk('touchstart', 380, 400));
        window._selectSomeText();
        el.dispatchEvent(mk('touchmove', 280, 400));
        el.dispatchEvent(mk('touchend', 280, 400));
        var r = { toc: window._tocCalls };
        window._clearSel();
        return r;
    });
    ok('B3 ⚠️划到一半才出现选区，立刻收手不开目录', B3.toc === 0, '开了 ' + B3.toc + ' 次');

    /* ===== C 组：方向 / 距离 / 角度 ===== */
    ok('C1 往右划不开目录', (await swipe(380, 400, 395, 400)).toc === 0);
    ok('C2 划不够 80px 不开', (await swipe(380, 400, 320, 400)).toc === 0);
    ok('C3 斜着划（竖偏 >60）不开', (await swipe(380, 300, 280, 400)).toc === 0);
    ok('C4 从左半屏起手不开（那是右滑返回的地盘）', (await swipe(60, 400, 10, 400)).toc === 0);
    ok('C5 从屏幕中间起手不开', (await swipe(200, 400, 100, 400)).toc === 0);

    /* ===== D 组：模式限制 ===== */
    const D1 = await page.evaluate(() => {
        window._asReader(); chatReaderMode = false;      // 普通对话
        window._swipe('.chat-modal', 380, 400, 280, 400);
        return window._tocCalls;
    });
    ok('D1 普通对话模式左滑不开目录', D1 === 0, '开了 ' + D1 + ' 次');

    const D2 = await page.evaluate(() => {
        window._asReader(); chatView = 'list';           // 对话列表页
        window._swipe('.chat-modal', 380, 400, 280, 400);
        return window._tocCalls;
    });
    ok('D2 对话列表页左滑不开目录', D2 === 0, '开了 ' + D2 + ' 次');

    const D3 = await page.evaluate(() => {
        window._asReader(); chatStreaming = true;        // 正在出字
        window._swipe('.chat-modal', 380, 400, 280, 400);
        chatStreaming = false;
        return window._tocCalls;
    });
    ok('D3 正在流式输出时不开目录', D3 === 0, '开了 ' + D3 + ' 次');

    /* ===== E 组：右滑返回没被带坏（同一个元素上现在挂了两个方向） ===== */
    const E1 = await page.evaluate(() => {
        window._asReader();
        window._swipe('.chat-modal', 40, 400, 160, 400);   // 左边缘往右划
        return { back: window._backCalls, toc: window._tocCalls };
    });
    ok('E1 右滑仍然是返回', E1.back === 1, JSON.stringify(E1));
    ok('E2 右滑不会顺带开目录', E1.toc === 0, JSON.stringify(E1));

    ok('F1 全程无 JS 报错', errs.length === 0, errs.join(' / '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('❌ ' + r.name + (r.detail ? '  →  ' + r.detail : '')); });
    console.log(bad.length ? ('❌ ' + bad.length + ' 条失败（共 ' + results.length + ' 条）') : ('✅ 全过（' + results.length + ' 条）'));
    process.exit(bad.length ? 1 : 0);
})();
