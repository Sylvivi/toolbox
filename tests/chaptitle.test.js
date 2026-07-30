/* 「标题字体在长章名上不生效」的回归测试。
 *
 * 起因：用户 2026-07-30 报——导进来的知乎存档三本书，章名长这样
 *   「【商业经济】教育家 - 为什么，这几年教育培训机构频繁倒闭？」
 * 换了「标题」槽位的字体却没反应。
 *
 * 查下来：标题字体只有一个作用位置 `.reading-merged .reading-chap-title`，
 * 而哪一行算标题原本**只靠 READING_TITLE_RE 猜**，那条正则要求同时满足
 *   ① 以「第X章/节/回/篇/卷/话」开头 ② 后面 ≤20 字 ③ 不含逗号句号问号顿号
 * 所以连「第一章 为什么，这几年…？」都不认（有逗号问号）。数据侧无解——
 * 要过正则就得把章名砍到 20 字内且不带标点，那既看不出讲什么、也搜不到了。
 *
 * 修法：阅读模式根本不用猜。readerChapterPair 是把章节标题拼在正文最前面的，
 * 第一段就是章名（CLAUDE.md 里那条「标题占掉 P1」）。于是
 *   _isRdTitle = chatReaderMode && p === 0 && paras[p].length <= 120
 * 和原来的正则并联。共读模式一字不动（那边正文是发进来的，P1 不保证是标题）。
 *
 * 跑法：bash tests/run.sh
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
        // 被测函数只吃「原文」，第一段=章名是阅读模式的既有约定（readerChapterPair 拼的）
        const ZH = '【商业经济】教育家 - 为什么，这几年教育培训机构频繁倒闭？';
        const BODY = '教育培训机构这几年的倒闭潮，根子不在疫情。';
        const NOVEL = '第一章 剑气恩仇';
        const LONG = '甲'.repeat(200);   // 超 120 字：万一 P1 不是章名，别把整段套花体

        // 取 data-p="n" 那个 <p> 的 class（没有 class 属性就返回空串）
        const clsOf = (html, n) => {
            const m = html.match(new RegExp('<p data-p="' + n + '"([^>]*)>'));
            if (!m) return '(没有这一段)';
            const c = m[1].match(/class="([^"]*)"/);
            return c ? c[1] : '';
        };
        const render = (text, readerMode) => {
            chatReaderMode = !!readerMode;
            _readingMergeCache = { text: null, ps: null, namesSig: null };  // 每次重算，别被上一轮缓存干扰
            return readingModeRenderMerged(text, '');
        };

        const out = {};
        // A 阅读模式：长章名的第一段拿到标题类，正文段不拿
        let h = render(ZH + '\n\n' + BODY, true);
        out.A1 = clsOf(h, 1);
        out.A2 = clsOf(h, 2);
        // B 共读模式：同一段文字，第一段**不**能拿到（共读那条路必须一字未变）
        h = render(ZH + '\n\n' + BODY, false);
        out.B1 = clsOf(h, 1);
        // C 传统章回体在共读模式照旧生效（原有正则那条路没被改坏）
        h = render(NOVEL + '\n\n' + BODY, false);
        out.C1 = clsOf(h, 1);
        // D 120 字上限：阅读模式下超长的第一段不打标题类
        h = render(LONG + '\n\n' + BODY, true);
        out.D1 = clsOf(h, 1);
        // E 缓存不许串模式：同一段文字先共读渲染、再切阅读渲染，第二次必须带上类
        //   （缓存签名没带 rdMode 的话这里会拿到上一轮的 <p>、静默错样式）
        chatReaderMode = false;
        _readingMergeCache = { text: null, ps: null, namesSig: null };
        const same = ZH + '\n\n' + BODY;
        readingModeRenderMerged(same, '');          // 第一次：共读，进缓存
        chatReaderMode = true;
        out.E1 = clsOf(readingModeRenderMerged(same, ''), 1);   // 第二次：阅读，必须重算
        chatReaderMode = false;
        return out;
    });

    ok('A1 阅读模式：长章名第一段 = 标题类', R.A1 === 'reading-chap-title', '实际 "' + R.A1 + '"');
    ok('A2 阅读模式：正文段不是标题', R.A2 === '', '实际 "' + R.A2 + '"');
    ok('B1 共读模式：第一段不当标题', R.B1 === '', '实际 "' + R.B1 + '"');
    ok('C1 共读模式：第X章 照旧认', R.C1 === 'reading-chap-title', '实际 "' + R.C1 + '"');
    ok('D1 阅读模式：超 120 字的第一段不打标题类', R.D1 === '', '实际 "' + R.D1 + '"');
    ok('E1 缓存带 rdMode：切模式后重算', R.E1 === 'reading-chap-title', '实际 "' + R.E1 + '"');
    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  ← ' + (r.detail || ''))); });
    console.log(bad ? `\n❌ ${bad}/${results.length} 条失败` : `\n✅ ${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
