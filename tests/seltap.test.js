/* 「点别处取消选中的那一下，不该顺带翻页」的回归测试。
 *
 * 起因：用户 2026-08-06 报「在正文选中然后点其他部位，不会触发下滑翻页；
 * 但在问答这类段落里选中一段文字，然后点其他部位取消选中，却会触发下滑翻页」。
 *
 * 根因：正文躲得过纯属**顺带**——选中正文会冒「划线小条」，而收小条那一下在
 * pointerdown 阶段标了 `_rdOverlayClosedAt`，翻页那边的 400ms 闸就把它吃掉了。
 * 而问答/评论块 `blockquote[data-cp]` 选中时**根本不冒小条**（`rdHlCurrentSel()`
 * 只认 `.reading-merged p[data-p]`），所以从来没有任何东西保护它。
 *
 * ⚠️为什么不能靠 click 里那道「有选区就不翻页」的闸：浏览器**在 click 之前**
 * 就把选区收掉了，跑到那一行时 `String(sel)` 已经是空的，它拦不住。
 * 所以修法必须在 `pointerdown` 阶段记——那时选区还在。
 *
 * ⚠️这里跟 overlaytap.test.js 一样，测的是「标没标记 `_rdOverlayClosedAt`」而不是
 * 「真翻没翻页」——真翻页要等 250ms 连击判定、还依赖真实排版高度，无头环境又慢又脆。
 * 那个变量是闸的唯一输入，钉住它就等于钉住了行为（闸本身由 D 组读源码守着）。
 *
 * 跑法：node tests/seltap.test.js   或   bash tests/p.sh seltap
 */
const { chromium } = require('playwright');
const path = require('path');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SRC = require('fs').readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* 造一条共读消息的 DOM：一个原文段落 + 一个问答/评论块，两者都挂在 .reading-merged 里。
       然后在指定元素里做一次真实选区，再往别处发 pointerdown，看有没有标记。 */
    await page.addScriptTag({
        content: `
        window._selSetup = function () {
            var old = document.getElementById('selTestHost');
            if (old) old.remove();
            var host = document.createElement('div');
            host.id = 'selTestHost';
            host.innerHTML = '<div class="chat-msg ai" data-idx="0"><div class="reading-merged">' +
                '<p data-p="1" id="selPara">这是一段正文，用来测选中之后点别处。</p>' +
                '<blockquote data-cp="1" id="selQuote">这是一条问答/评论块里的文字。</blockquote>' +
                '<p data-p="2" id="selOther">另一段正文，用来当"点其他部位"的落点。</p>' +
                '</div></div>';
            document.body.appendChild(host);
            chatReadingMode = true;
            chatReaderMode = false;
            _rdOverlayClosedAt = 0;
            try { window.getSelection().removeAllRanges(); } catch (e) {}
        };
        window._selIn = function (id) {
            var el = document.getElementById(id);
            var r = document.createRange();
            r.selectNodeContents(el);
            var s = window.getSelection();
            s.removeAllRanges(); s.addRange(r);
            return String(s).trim().length;
        };
        window._tapOn = function (id) {
            document.getElementById(id).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return _rdOverlayClosedAt > 0;
        };`
    });

    /* ===== A 组：问答/评论块——这次报的毛病 ===== */
    const A = await page.evaluate(() => {
        window._selSetup();
        const len = window._selIn('selQuote');
        const marked = window._tapOn('selOther');
        return { len, marked };
    });
    ok('A1 问答块里确实选中了文字（测试前提）', A.len > 0, '选中长度 ' + A.len);
    ok('A2 问答块选中后点别处 → 标记为「这一下是来收选中的」，不翻页', A.marked, JSON.stringify(A));

    /* ===== B 组：正文也要走同一道新闸 =====
       ⚠️注意这条**不是**在验「正文原有的保护还在」。正文原来那层保护是「划线小条冒出来、
       收小条时顺带标记」，而小条要等 selectionchange 的 220ms 防抖才出现，无头环境里
       这一步不稳。这里验的是：新闸对正文同样生效——于是正文的正确行为**不再依赖**
       小条这个副作用，两种段落走同一条规矩。 */
    const B = await page.evaluate(() => {
        window._selSetup();
        window._selIn('selPara');
        return { marked: window._tapOn('selOther') };
    });
    ok('B1 正文选中后点别处 → 走同一道新闸，不再靠划线小条的副作用', B.marked, JSON.stringify(B));

    /* ===== C 组：没选中时不许误伤——正常单击翻页是这个功能的主用途 ===== */
    const C = await page.evaluate(() => {
        window._selSetup();                       // 没有任何选区
        const 空选区时 = window._tapOn('selOther');
        window._selSetup();
        const s = window.getSelection();           // 光标折叠态（点一下产生的那种），不算选中
        const r = document.createRange();
        const el = document.getElementById('selPara');
        r.setStart(el.firstChild, 3); r.collapse(true);
        s.removeAllRanges(); s.addRange(r);
        const 折叠光标时 = window._tapOn('selOther');
        return { 空选区时, 折叠光标时 };
    });
    ok('C1 没选中时不标记（否则正常单击翻页会被吃掉）', !C.空选区时, JSON.stringify(C));
    ok('C2 只有折叠光标、没真选中文字时也不标记', !C.折叠光标时, JSON.stringify(C));

    /* ===== D 组：源码级——修法必须在 pointerdown 阶段，且非共读模式不介入 ===== */
    const fn = (SRC.match(/document\.addEventListener\('pointerdown', function\(\) \{\s*\n\s*if \(!chatReadingMode && !chatReaderMode\) return;[\s\S]*?\}, true\);/) || [''])[0];
    ok('D1 这条监听存在，且走捕获期 pointerdown（click 阶段选区已被浏览器收掉，拦不住）',
        /\}, true\);/.test(fn) && fn.length > 0, fn.slice(0, 90));
    ok('D2 判定要求真有选中文字（isCollapsed + trim 长度都查）',
        /isCollapsed/.test(fn) && /trim\(\)\.length\s*>\s*0/.test(fn), fn.slice(0, 120));
    ok('D3 复用同一道 400ms 闸（别再造第二道，两道会分叉）', /_rdOverlayClosedAt = Date\.now\(\)/.test(fn));
    ok('D4 翻页那边的 400ms 闸还在', /_rdOverlayClosedAt\s*<\s*400/.test(SRC));
    ok('D5 非共读/非阅读器模式直接 return（别影响普通对话的选词复制）',
        /if \(!chatReadingMode && !chatReaderMode\) return;/.test(fn));

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await page.evaluate(() => { const h = document.getElementById('selTestHost'); if (h) h.remove(); });
    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  ← ' + (r.detail || ''))));
    console.log(bad.length ? `\n❌ ${bad.length} 条没过（共 ${results.length} 条）` : `\n✅ 全过（${results.length} 条）`);
    process.exit(bad.length ? 1 : 0);
})();
