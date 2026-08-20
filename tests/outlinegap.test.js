/* 「超窗但还没折进大纲」的摘要段不许丢 —— 回归测试。
 *
 * 起因：她 2026-08-20 看着摘要弹窗问「有七段摘要的时候，大纲还是只折入一段，这合理吗」。
 * 查下来不合理，而且不是折得慢的问题，是**真的丢记忆**：
 *
 *   两层记忆的规矩是「最近 5 段原样带 + 更早的攒满 3 段折进大纲」，
 *   所以正常就会有 1-2 段处在「超出 5 段窗口了、但还没攒够 3 段没被折」的中间态。
 *   旧代码发请求时是 `slice(covers).slice(-5)` —— 先跳过已折的，再只留最近 5 段，
 *   中间那几段**两头落空**：大纲没覆盖到，发送时又被截掉。
 *   7 段 / covers=1 时，第 2 段（下标 1）就是这么凭空消失的。
 *
 * ⚠️本文件钉的是「大纲覆盖的段 ∪ 发出去的段 == 全部段」这条守恒律，
 *   别改成只断言段数——段数对不代表没漏中间那段。
 *
 * 跑法：node tests/outlinegap.test.js
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

    // 复刻发送时拼「前文摘要」的那段取值逻辑（index.html 里 _restSegs 那几行）。
    // 直接调真函数要连网发请求，这里只验取值规则本身。
    const probe = await page.evaluate(() => {
        function pick(total, covers, usedTables) {
            var segs = [];
            for (var i = 0; i < total; i++) segs.push('S' + i);
            var rest = usedTables ? segs.slice(-CHAT_SUMMARY_MAX_SEGS) : segs.slice(covers || 0);
            if (rest.length > CHAT_SUMMARY_MAX_SEGS + 3) rest = rest.slice(-(CHAT_SUMMARY_MAX_SEGS + 3));
            return rest;
        }
        function covered(covers) { var a = []; for (var i = 0; i < covers; i++) a.push('S' + i); return a; }
        return {
            MAX: CHAT_SUMMARY_MAX_SEGS,
            // 她截图那一幕：7 段、大纲只折入 1 段
            case7: pick(7, 1, false),
            cov7: covered(1),
            // 积压到 2 段（8 段 / covers=1）
            case8: pick(8, 1, false),
            cov8: covered(1),
            // 折过之后（9 段 / covers=4）
            case9: pick(9, 4, false),
            cov9: covered(4),
            // 还没超窗（5 段 / 没大纲）
            case5: pick(5, 0, false),
            // 记忆表那条路：照旧只带最近 5 段
            caseTables: pick(9, 4, true),
            // 异常：大纲一直没生成成功，积压很多
            caseRunaway: pick(40, 0, false),
        };
    });

    ok('A0 最近段窗口仍是 5', probe.MAX === 5, String(probe.MAX));

    // ===== 守恒律：大纲覆盖的 ∪ 发出去的 == 全部 =====
    function union(cov, sent, total) {
        const seen = new Set(cov.concat(sent));
        const missing = [];
        for (let i = 0; i < total; i++) if (!seen.has('S' + i)) missing.push('S' + i);
        return missing;
    }
    const m7 = union(probe.cov7, probe.case7, 7);
    ok('A1 ⚠️7 段 / 已折入 1 段：没有任何一段两头落空', m7.length === 0, '漏了 ' + m7.join(','));
    ok('A2 具体就是第 2 段（S1）必须在发送里', probe.case7.indexOf('S1') >= 0, probe.case7.join(','));

    const m8 = union(probe.cov8, probe.case8, 8);
    ok('B1 ⚠️8 段 / 已折入 1 段（积压 2 段）也不漏', m8.length === 0, '漏了 ' + m8.join(','));

    const m9 = union(probe.cov9, probe.case9, 9);
    ok('C1 折过之后（9 段 / 已折入 4 段）不漏', m9.length === 0, '漏了 ' + m9.join(','));
    ok('C2 折过之后回到精简：只发 5 段', probe.case9.length === 5, String(probe.case9.length));

    ok('D1 还没超窗时（5 段）原样全带', probe.case5.length === 5 && probe.case5[0] === 'S0', probe.case5.join(','));

    ok('E1 走记忆表那条路仍只带最近 5 段', probe.caseTables.length === 5 && probe.caseTables[0] === 'S4', probe.caseTables.join(','));

    ok('F1 大纲一直失败时有兜底闸、不无限膨胀', probe.caseRunaway.length === 8, String(probe.caseRunaway.length));
    ok('F2 兜底时保留的是最近的那几段', probe.caseRunaway[probe.caseRunaway.length - 1] === 'S39', probe.caseRunaway.join(','));

    ok('G1 全程无 JS 报错', pageErrs.length === 0, pageErrs.join(' / '));

    /* ===== H 组：源码断言 =====
     * 上面 A-F 验的是「取值规则该长什么样」，用的是复刻版。
     * 万一哪天有人把 index.html 改回旧写法，复刻版照样全绿——所以这里直接钉源码。 */
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '..', 'index.html'), 'utf8');
    ok('H1 发送路径用的是 _restSegs 这套', src.indexOf('var _restSegs = _usedMemTables') >= 0);
    ok('H2 ⚠️没有残留「跳过已折的之后又截最近 N 段」的旧写法',
        src.indexOf('.slice(chatOutlineCovers || 0)).slice(-CHAT_SUMMARY_MAX_SEGS)') < 0
        && src.indexOf('(chatOutlineCovers || 0)).slice(-CHAT_SUMMARY_MAX_SEGS)') < 0);
    ok('H3 兜底闸还在', src.indexOf('CHAT_SUMMARY_MAX_SEGS + 3') >= 0);

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('❌ ' + r.name + (r.detail ? '  →  ' + r.detail : '')); });
    console.log(bad.length ? ('❌ ' + bad.length + ' 条失败（共 ' + results.length + ' 条）') : ('✅ 全过（' + results.length + ' 条）'));
    process.exit(bad.length ? 1 : 0);
})();
