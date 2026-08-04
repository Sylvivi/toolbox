/* 「收菜单的那一下点击不该顺带翻页」的回归测试。
 *
 * 起因：用户 2026-08-04 报「点了 clawd 的菜单，我点屏幕是想让这个东西关闭，
 * 这个时候也已触发了下滑」。根因是**共读时飘在页面上的菜单/面板全都靠 document 上的
 * `click` 自己关**，而「点屏幕往下翻一屏」听的也是 `click`——同一下点击两边都收到，
 * 于是菜单关了、页也翻了。
 *
 * 已有的机制是 `_rdOverlayClosedAt`（划线小条早就挂了：pointerdown 阶段标一下时间戳，
 * 随后 400ms 内的 click 不翻页），只是别的菜单一个都没挂进去。修法＝一条捕获期的
 * pointerdown 监听，点在这些浮层**外面**时统一标记。
 *
 * ⚠️这里测的是「标没标记」而不是「翻没翻页」——真翻页要等 250ms 的连击判定、还依赖
 * 真实排版高度，在无头环境里又慢又脆。`_rdOverlayClosedAt` 是那道闸的唯一输入，
 * 钉住它就等于钉住了行为（闸本身另有 D 组直接读源码守着）。
 *
 * 跑法：node tests/overlaytap.test.js
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* 在共读模式下，把某个菜单打开，然后点正文，看有没有标上「这一下是来收浮层的」。
       ⚠️这些菜单在源码里躺在**隐藏的**聊天面板里，光给它自己设 display 也量不出尺寸
       （`getClientRects()` 看的是整条祖先链），所以测试里先把节点临时挪到 body 上、量完还回去。 */
    async function tap(openId, tapInsideMenu) {
        return page.evaluate(({ openId, tapInsideMenu }) => {
            window._ovRestore = function () {
                (window._ovStash || []).forEach(s => { try { s.parent.insertBefore(s.el, s.next); } catch (e) {} });
                window._ovStash = [];
            };
            window._ovShow = function (id) {
                const m = document.getElementById(id);
                if (!m) return null;
                m.style.cssText = 'display:block;position:fixed;left:10px;top:10px;width:120px;height:80px;opacity:0';
                m.classList.add('show');
                if (!m.getClientRects().length) {
                    (window._ovStash = window._ovStash || []).push({ el: m, parent: m.parentNode, next: m.nextSibling });
                    document.body.appendChild(m);
                }
                return m.getClientRects().length ? m : null;
            };
            chatReadingMode = true;
            _rdOverlayClosedAt = 0;
            // 先把所有候选浮层都藏起来，免得上一组的残留影响这一组
            ['clawdReadingMenu', 'chatTopMenu', 'chatNavPanel', 'chatBookmarkPanel', 'chatModelDropdown', 'chatAttachMenu']
                .forEach(id => { const el = document.getElementById(id); if (el) { el.style.display = 'none'; el.classList.remove('show'); } });

            let target = document.getElementById('chatMessages');   // 默认点正文区
            if (openId) {
                const m = window._ovShow(openId);
                if (!m) return { err: openId + ' 撑不出尺寸，这组测不了' };
                if (tapInsideMenu) target = m;
            }
            target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const r = { marked: _rdOverlayClosedAt > 0 };
            if (openId) { const m = document.getElementById(openId); m.style.cssText = 'display:none'; m.classList.remove('show'); }
            window._ovRestore();
            return r;
        }, { openId, tapInsideMenu });
    }

    /* ===== A 组：菜单开着 + 点正文 → 必须标记（＝那一下只收菜单，不翻页） ===== */
    for (const id of ['clawdReadingMenu', 'chatTopMenu', 'chatNavPanel', 'chatBookmarkPanel', 'chatModelDropdown', 'chatAttachMenu']) {
        const r = await tap(id, false);
        ok('A·' + id + ' 开着时点正文 → 标记为「收浮层」', !r.err && r.marked, r.err || JSON.stringify(r));
    }

    /* ===== B 组：不该误伤 ===== */
    const b1 = await tap(null, false);
    ok('B1 什么都没开时点正文 → 不标记（照常翻页）', !b1.err && !b1.marked, JSON.stringify(b1));

    const b2 = await tap('clawdReadingMenu', true);
    ok('B2 点在菜单「里面」→ 不标记（那是在用菜单，不是收它）', !b2.err && !b2.marked, JSON.stringify(b2));

    const b3 = await page.evaluate(() => {
        chatReadingMode = false; _rdOverlayClosedAt = 0;
        const m = document.getElementById('clawdReadingMenu');
        m.style.display = 'block'; m.style.position = 'fixed';
        m.style.left = '10px'; m.style.top = '10px'; m.style.width = '120px'; m.style.height = '80px';
        document.getElementById('chatMessages').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        const r = { marked: _rdOverlayClosedAt > 0 };
        m.style.display = 'none';
        return r;
    });
    ok('B3 不在共读模式时不做任何事（省掉每次点击的 DOM 查询）', !b3.marked, JSON.stringify(b3));

    /* ===== C 组：暗幕不能列进名单（它铺满整屏，contains 恒为真会把自己废掉） =====
       ⚠️`_rdIsOverlayDismissTap`/`RD_OVERLAY_SEL` 关在 IIFE 里、页面上取不到，
       所以这几条源码级断言直接读 index.html 的文本。 */
    const SRC = require('fs').readFileSync(require('path').resolve(__dirname, '..', 'index.html'), 'utf8');
    const selLine = (SRC.match(/var RD_OVERLAY_SEL = '([^']*)'/) || [])[1] || '';
    ok('C1 选择器里没有 #readingPanelMask', selLine && !/readingPanelMask/.test(selLine), selLine);

    const c2 = await page.evaluate(() => {
        chatReadingMode = true; _rdOverlayClosedAt = 0;
        const mask = document.getElementById('readingPanelMask');
        const panel = window._ovShow('chatBookmarkPanel');
        if (!panel || !mask) return { err: '缺节点' };
        mask.classList.add('show');
        mask.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));   // 点暗幕＝想关面板
        const r = { marked: _rdOverlayClosedAt > 0 };
        panel.style.cssText = 'display:none'; panel.classList.remove('show'); mask.classList.remove('show');
        window._ovRestore();
        return r;
    });
    ok('C2 点面板背后的暗幕 → 照样标记（靠前面那个面板认出来）', !c2.err && c2.marked, JSON.stringify(c2));

    /* ===== D 组：源码级——那道 400ms 闸和这条监听都得在 ===== */
    const fnSrc = (SRC.match(/function _rdIsOverlayDismissTap[\s\S]*?\n            \}/) || [''])[0];
    ok('D1 翻页那边的 400ms 闸还在', /_rdOverlayClosedAt\s*<\s*400/.test(SRC));
    ok('D2 判「开着没」用 getClientRects（不依赖各菜单自己的开关写法）', /getClientRects\(\)\.length/.test(fnSrc), fnSrc.slice(0, 80));
    ok('D3 点在浮层内部一律 return false', /contains\(target\)\)\s*return false/.test(fnSrc), fnSrc.slice(0, 80));
    ok('D4 这条监听走捕获期的 pointerdown（要赶在菜单自己关掉之前）',
        /_rdIsOverlayDismissTap\(e\.target\)\)\s*_rdOverlayClosedAt = Date\.now\(\);\s*\n\s*\}, true\);/.test(SRC));

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  ← ' + (r.detail || ''))));
    console.log(bad.length ? `\n❌ ${bad.length} 条没过（共 ${results.length} 条）` : `\n✅ 全过（${results.length} 条）`);
    process.exit(bad.length ? 1 : 0);
})();
