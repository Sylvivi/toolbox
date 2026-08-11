/* 收起状态那条底栏（一句英文 + 「已读 N%」）点一下会怎样——2026-08-11 加。
 *
 * 用户报：「阅读模式下底下的进度条，点击后不用展开对话框，根本用不上」，
 * 追问后又明确：「阅读模式下我不会用下面的输入框打字了，为什么要留入口呢，
 * 那个只有共读模式会用到」。
 * 同日再改一次（她原话「我希望阅读模式下，点下面的进度条，等同于点 clawd 菜单里的 clawd」），
 * 于是阅读模式从「什么都不做」变成「开模型面板」。现在的规矩是：
 *   · 阅读模式（纯看书，chatReaderMode）——开模型面板，且**绝不展开输入框**；
 *   · 共读模式 / 翻译模式——照旧展开输入框（那是打字提问的主要入口）。
 *
 * ⚠️「不展开输入框」这条比「开模型面板」更要紧：一弹键盘正文就被顶上去。
 *   所以阅读模式那一档要同时验两件事，少验一件就漏了真正难受的那个。
 *
 * ⚠️这个测试真正要钉住的是**判据只能用 chatReaderMode**：进阅读模式时
 *   chatReadingMode 也会被置真（readerOpenChapter 里两个都设了），
 *   拿 chatReadingMode 去判会把共读模式一起关掉——那是最容易写错的一处。
 *
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/hinttap.test.js
 *   或  bash tests/p.sh hinttap
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

    const R = await page.evaluate(() => {
        const out = {};
        const area = document.getElementById('chatInputArea');
        const hint = document.getElementById('readingCollapseHint');
        const collapsed = () => area.classList.contains('reading-collapsed');
        // 真的点那一下（不是直接调函数）——onclick 挂在 DOM 上，改错了这里才抓得到
        const tap = () => hint.click();

        out.有这条底栏 = !!hint;
        out.挂的是新函数 = (hint.getAttribute('onclick') || '').indexOf('readingHintTap') >= 0;

        // ── 阅读模式（纯看书）：chatReadingMode 也是真的，这正是最容易判错的地方 ──
        const sheet = document.getElementById('chatModelSheet');
        chatCloseModelSheet();
        chatReadingMode = true; chatTranslateMode = false; chatReaderMode = true;
        readingCollapseInput();
        out.阅读_点前是收起的 = collapsed();
        out.阅读_点前面板是关的 = !sheet.classList.contains('show');
        tap();
        out.阅读_点完还是收起 = collapsed();
        out.阅读_点完开了模型面板 = sheet.classList.contains('show');
        out.阅读_光标不是打字样 = getComputedStyle(hint).cursor !== 'text';
        out.阅读_光标是按钮手型 = getComputedStyle(hint).cursor === 'pointer';
        chatCloseModelSheet();   // 别把面板留给后面两档

        // ── 共读模式：必须照旧展开 ──
        chatReadingMode = true; chatTranslateMode = false; chatReaderMode = false;
        readingCollapseInput();
        out.共读_点前是收起的 = collapsed();
        tap();
        out.共读_点完展开了 = !collapsed();
        out.共读_光标是打字样 = getComputedStyle(hint).cursor === 'text';

        // ── 翻译模式：也照旧展开 ──
        chatReadingMode = false; chatTranslateMode = true; chatReaderMode = false;
        readingCollapseInput();
        tap();
        out.翻译_点完展开了 = !collapsed();

        // 收尾，别把全局状态留给别的用例
        chatReadingMode = false; chatTranslateMode = false; chatReaderMode = false;
        return out;
    });

    ok('底栏还在、点击挂的是 readingHintTap', R.有这条底栏 && R.挂的是新函数);
    ok('阅读模式：点之前是收起状态（前提）', R.阅读_点前是收起的);
    ok('阅读模式：点之前模型面板是关的（前提）', R.阅读_点前面板是关的);
    ok('阅读模式：点一下**不展开输入框**（最要紧的一条）', R.阅读_点完还是收起);
    ok('阅读模式：点一下开出模型面板（＝clawd 菜单那颗）', R.阅读_点完开了模型面板);
    ok('阅读模式：光标不再是「能打字」的样子', R.阅读_光标不是打字样);
    ok('阅读模式：光标是按钮手型', R.阅读_光标是按钮手型);
    ok('共读模式：点之前是收起状态（前提）', R.共读_点前是收起的);
    ok('共读模式：点一下照旧展开输入框', R.共读_点完展开了);
    ok('共读模式：光标仍是「能打字」的样子', R.共读_光标是打字样);
    ok('翻译模式：点一下照旧展开输入框', R.翻译_点完展开了);
    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
