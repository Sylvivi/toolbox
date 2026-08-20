/* 目录/书架面板「从上往下滑收回去」的回归测试。
 *
 * 起因：她 2026-08-21「再加一个手势，目录弹出来的时候从上往下滑他又会收回去」。
 *
 * 这个面板是从屏幕底下升上来的 sheet，往下推＝关掉，是它本来的物理直觉。
 * 但**它最容易坏的地方是跟滚动打架**：目录的章节列表、书架的书单本身都能上下滚，
 * 在列表中间往下滑那是滚动、不是关面板。所以本文件的重点是那一组「不该关」：
 *   ⚠️列表没滚到顶时不认（起手那一刻看 scrollTop）
 *   ⚠️选字守卫（她 08-21 点名要求手势不能影响长按选字，章节名同样能选）
 *   ⚠️横着划不认（那是右滑返回/左滑开目录的地盘，三个手势必须互斥）
 *   ⚠️搜索框里滑不认
 *
 * 跑法：node tests/sheetdismiss.test.js
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

function installHarness() {
    window._touchOn = function (selector, x0, y0, x1, y1, hook) {
        const el = document.querySelector(selector);
        const mk = (type, x, y) => {
            const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
            return new TouchEvent(type, {
                touches: type === 'touchend' ? [] : [t], targetTouches: [], changedTouches: [t],
                bubbles: true, cancelable: true
            });
        };
        el.dispatchEvent(mk('touchstart', x0, y0));
        if (hook) hook();
        el.dispatchEvent(mk('touchmove', x1, y1));
        el.dispatchEvent(mk('touchend', x1, y1));
    };
    window._closes = 0; window._backs = 0;
    window.rbCloseShelf = function () { window._closes++; };
    window.rbBackToShelf = function () { window._backs++; };
    // 摆成「目录已经弹出来了」，并让章节列表真的有得滚
    window._asToc = function () {
        document.getElementById('rbModal').classList.add('show');
        document.getElementById('rbShelfView').style.display = 'none';
        document.getElementById('rbChapterView').style.display = '';
        var list = document.getElementById('rbChapterList');
        list.style.cssText = 'height:200px;overflow-y:auto';
        list.innerHTML = '';
        for (var i = 0; i < 60; i++) {
            var d = document.createElement('div');
            d.textContent = '第 ' + (i + 1) + ' 章 测试章节名';
            d.style.cssText = 'height:40px;line-height:40px';
            list.appendChild(d);
        }
        list.scrollTop = 0;
        window._closes = 0; window._backs = 0;
        var s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges();
        return { canScroll: list.scrollHeight > list.clientHeight };
    };
    window._selectSomeText = function () {
        // ⚠️必须挂 document.body 且真渲染：挂隐藏容器里 Selection.toString() 读出来是空串
        var p = document.getElementById('_selProbe2');
        if (!p) {
            p = document.createElement('p');
            p.id = '_selProbe2';
            p.textContent = '这是一段用来测试选中的章节名';
            p.style.cssText = 'position:fixed;left:20px;top:600px;font-size:16px;z-index:99999;background:#fff';
            document.body.appendChild(p);
        }
        var r = document.createRange(); r.selectNodeContents(p);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        return String(sel).trim().length;
    };
    window._clearSel = function () {
        var p = document.getElementById('_selProbe2'); if (p) p.remove();
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

    const prep = await page.evaluate(() => window._asToc());
    ok('A0 章节列表确实是能滚的（不然后面几条测了个寂寞）', prep.canScroll === true);

    // 在章节列表上滑
    const onList = (x0, y0, x1, y1) => page.evaluate(([a, b, c, d]) => {
        window._asToc();
        window._touchOn('#rbChapterList', a, b, c, d);
        return window._closes;
    }, [x0, y0, x1, y1]);

    /* ===== A 组：该收起来 ===== */
    ok('A1 列表在顶部时往下滑 → 面板收起', await onList(200, 200, 200, 320) === 1);
    ok('A2 在不滚动的表头上往下滑也收起', await page.evaluate(() => {
        window._asToc();
        window._touchOn('.rb-sticky-head', 200, 120, 200, 250);
        return window._closes;
    }) === 1);
    ok('A3 在顶上那条抓手上往下滑也收起', await page.evaluate(() => {
        window._asToc();
        window._touchOn('#rbModal .sheet-handle', 200, 100, 200, 240);
        return window._closes;
    }) === 1);

    /* ===== B 组：⚠️不许跟滚动打架 ===== */
    const B1 = await page.evaluate(() => {
        window._asToc();
        document.getElementById('rbChapterList').scrollTop = 300;   // 已经滚到中间了
        window._touchOn('#rbChapterList', 200, 200, 200, 320);
        return window._closes;
    });
    ok('B1 ⚠️列表滚到中间时往下滑是滚动，不收面板', B1 === 0, '收了 ' + B1 + ' 次');

    ok('B2 往上滑不收', await onList(200, 320, 200, 200) === 0);
    ok('B3 下滑不够 80px 不收', await onList(200, 200, 200, 250) === 0);

    /* ===== C 组：⚠️不许影响长按选字 ===== */
    const C1 = await page.evaluate(() => {
        window._asToc();
        var len = window._selectSomeText();
        window._touchOn('#rbChapterList', 200, 200, 200, 320);
        var r = { selLen: len, closes: window._closes, stillSel: String(window.getSelection()).trim().length };
        window._clearSel();
        return r;
    });
    ok('C0 选区真的建起来了', C1.selLen > 0, String(C1.selLen));
    ok('C1 ⚠️已有选区时下滑不收面板', C1.closes === 0, '收了 ' + C1.closes + ' 次');
    ok('C2 ⚠️手势没把选区弄掉', C1.stillSel > 0, String(C1.stillSel));

    const C3 = await page.evaluate(() => {
        window._asToc();
        window._touchOn('#rbChapterList', 200, 200, 200, 320, function () { window._selectSomeText(); });
        var r = window._closes; window._clearSel(); return r;
    });
    ok('C3 ⚠️划到一半才冒出选区，立刻收手', C3 === 0, '收了 ' + C3 + ' 次');

    /* ===== D 组：⚠️跟另外两个手势互斥 ===== */
    ok('D1 斜着往右下划不收（横偏 >60）', await onList(200, 200, 300, 320) === 0);
    ok('D2 斜着往左下划也不收', await onList(200, 200, 100, 320) === 0);

    const D3 = await page.evaluate(() => {
        window._asToc();
        window._touchOn('#rbModal', 40, 400, 160, 400);   // 纯右滑＝返回
        return { closes: window._closes, backs: window._backs };
    });
    ok('D3 右滑仍然是退一层、不是关面板', D3.backs === 1 && D3.closes === 0, JSON.stringify(D3));

    /* ===== E 组：搜索框里滑不算 ===== */
    const E1 = await page.evaluate(() => {
        window._asToc();
        var box = document.getElementById('rbChapterSearch');
        if (!box) return 'no-input';
        var mk = function (type, x, y) {
            var t = new Touch({ identifier: 1, target: box, clientX: x, clientY: y });
            return new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true });
        };
        box.dispatchEvent(mk('touchstart', 200, 150));
        box.dispatchEvent(mk('touchmove', 200, 280));
        box.dispatchEvent(mk('touchend', 200, 280));
        return window._closes;
    });
    ok('E1 在「搜索章节」框里往下滑不收面板', E1 === 0 || E1 === 'no-input', String(E1));

    /* ===== F 组：面板没开着时不认 ===== */
    const F1 = await page.evaluate(() => {
        window._asToc();
        document.getElementById('rbModal').classList.remove('show');
        window._touchOn('#rbChapterList', 200, 200, 200, 320);
        return window._closes;
    });
    ok('F1 面板没开着时下滑什么也不做', F1 === 0, '收了 ' + F1 + ' 次');

    ok('G1 全程无 JS 报错', errs.length === 0, errs.join(' / '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('❌ ' + r.name + (r.detail ? '  →  ' + r.detail : '')); });
    console.log(bad.length ? ('❌ ' + bad.length + ' 条失败（共 ' + results.length + ' 条）') : ('✅ 全过（' + results.length + ' 条）'));
    process.exit(bad.length ? 1 : 0);
})();
