/* 翻译模式的时间标记（2026-09-19 她要的「翻译模式下应该也要显示时间比较好哦」）。
 *
 * 做法：时间戳写进块头本身 —— `[[TR s=1 e=3 t=<毫秒>]]`、`[[QA t=<毫秒>]]`，
 * 跟着 msg.content 走、跟着云同步走，零新增存储键。
 * 显示跟阅读那边**共用同一个开关**（齿轮 → 零碎 → 「时间」，localStorage `reading_qa_time`）。
 *
 * ⚠️这套测试真正守的是**向后兼容**：`t=` 是后加的，四条正则里但凡有一条写死了
 *   `s=\d+ e=\d+]]`，老译文块就会整章解析不出来——那是「译文凭空消失」级别的事故。
 *   所以老格式和新格式两种内容都要跑一遍。
 *
 * 跑法：node tests/transtime.test.js   或   bash tests/p.sh transtime
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
    await page.waitForTimeout(6500);

    const R = await page.evaluate(() => {
        const out = {};
        const T = 1758240000000;   // 2026-09-19 08:00 左右，固定值，跟"今天"无关
        // 老格式（2026-09-19 之前存下来的）
        const OLD = '[[TR s=1 e=2]]\n旧译文\n[[/TR]]\n[[TR s=3 e=3]]\n第二块\n[[QA]]老问题[[ANS]]老答案[[/QA]]\n[[/TR]]';
        // 新格式
        const NEW = '[[TR s=1 e=2 t=' + T + ']]\n新译文\n[[/TR]]';

        const bOld = translateModeParseBlocks(OLD);
        out.老格式照样解析 = bOld.length === 2 && bOld[0].text.trim() === '旧译文';
        out.老格式没时间 = !bOld[0].t;
        const bNew = translateModeParseBlocks(NEW);
        out.新格式解析出时间 = bNew.length === 1 && bNew[0].t === T;

        // 老块里的追问照样拆得出来（QA 的 t= 也是后加的）
        const qOld = translateBlockSplitQA(bOld[1].text);
        out.老追问照样拆 = qOld.qas.length === 1 && qOld.qas[0].q === '老问题' && qOld.qas[0].a === '老答案';
        out.老追问没时间 = !qOld.qas[0].t;

        // 往带 t= 的块里塞追问，再读回来：位置对、时间在
        const appended = translateAppendQA(NEW, 1, 2, '新问题', '新答案');
        const bA = translateModeParseBlocks(appended);
        const qA = translateBlockSplitQA(bA[0].text);
        out.新块能塞追问 = bA.length === 1 && qA.qas.length === 1 && qA.qas[0].q === '新问题';
        out.追问自带时间 = !!qA.qas[0].t;
        out.塞完块头时间还在 = bA[0].t === T;
        out.塞完主译文还在 = qA.main.trim() === '新译文';

        // 删块：带 t= 的也要删得掉（正则漏了 [^\]]* 就会删不动）
        out.带时间的块删得掉 = translateStripBlock(NEW, 1, 2).trim() === '';
        out.老块也删得掉 = translateStripBlock(OLD, 1, 2).indexOf('旧译文') < 0;

        // 渲染：开关关着不出时间，开着才出
        const orig = '第一段\n第二段\n第三段';
        window.chatUserName = function () { return '汐'; };
        localStorage.setItem('reading_qa_time', '0');
        const hOff = translateModeRenderMerged(orig, appended, 0);
        localStorage.setItem('reading_qa_time', '1');
        const hOn = translateModeRenderMerged(orig, appended, 0);
        const hOldOn = translateModeRenderMerged(orig, OLD, 0);
        localStorage.setItem('reading_qa_time', '0');
        out.关着时没有时间 = hOff.indexOf('rd-qa-t') < 0;
        out.开着时块上有时间 = (hOn.match(/rd-qa-t/g) || []).length === 2;   // 块 1 + 追问 1
        out.老块开着也不瞎编 = hOldOn.indexOf('rd-qa-t') < 0;
        out.译文本身没被时间挤掉 = hOn.indexOf('新译文') > 0 && hOn.indexOf('新答案') > 0;
        return out;
    });

    ok('A ⚠️老译文块照样解析得出来（向后兼容，漏了就是整章译文消失）', R.老格式照样解析);
    ok('B 老块没有时间戳', R.老格式没时间);
    ok('C 新块解析出时间戳', R.新格式解析出时间);
    ok('D ⚠️老追问照样拆得出问/答', R.老追问照样拆);
    ok('E 老追问没有时间戳', R.老追问没时间);
    ok('F 带 t= 的块还能塞进追问', R.新块能塞追问);
    ok('G 新追问自带时间', R.追问自带时间);
    ok('H 塞完追问，块头的时间和主译文都没丢', R.塞完块头时间还在 && R.塞完主译文还在);
    ok('I ⚠️带 t= 的块删得掉', R.带时间的块删得掉);
    ok('J 老块也照样删得掉', R.老块也删得掉);
    ok('K 开关关着时一个时间都不渲染', R.关着时没有时间);
    ok('L 开关开着：译文块和追问各一个时间', R.开着时块上有时间);
    ok('M ⚠️老块就算开着开关也不显示时间（别补「今天」）', R.老块开着也不瞎编);
    ok('N 时间没把译文正文挤掉', R.译文本身没被时间挤掉);
    ok('O 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 翻译时间标记：${bad}/${results.length} 条失败` : `\n✅ 翻译时间标记：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
