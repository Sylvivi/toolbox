/* 英文直引号也要被当成引号（2026-09-16 补）。
 *
 * 为什么补：她报《鲁滨逊漂流记》「引号不是中文的，所以总是无法被正确识别然后渲染」。
 * 病根在 `readingSplitSentences`——它只对 「『“ 记引号深度，**不管 `"`**。
 * 于是一段直引号对话只要内部有句号，就会被从中间切开，
 * 切完每半边各剩一个落单的引号 → `readingHighlightQuotes` 配不成对 → 整段引号样式全失效。
 * ⚠️不是孤例：全库 25 本有直引号，其中「周六的事 / 山雨 / 你到的时候刚好」这些
 *   **一个中文引号都没有**，整本都受影响。
 * ⚠️直引号开合同形，只能用开关翻转、不能像 「」 那样计数。
 *
 * 跑法：node tests/straightquote.test.js   或   bash tests/p.sh straightquote
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
        /* ⚠️只数**外层**那个 span：长引号会多带一个 `rq-wide`（`class="reading-quote rq-wide"`），
           所以要允许后面跟引号或空格；`reading-quote-inner` 后面跟的是 `-`，自然排除。 */
        const n = s => (readingBuildParaInner(s, null).match(/class="reading-quote[" ]/g) || []).length;
        const out = {};
        /* 取自《鲁滨逊漂流记》原文。⚠️挑这一段是因为**它的引号里含 ？和 ！**——
           正是这些句末标点让旧代码在引号中间断了句。实测：修复前 0 组，修复后 2 组。 */
        const real = '于是他上船向我要斧子。"干什么，佐立？"我问。"我要把它的头砍下来！"他说。'
                   + '结果，佐立没法把狮子头砍下来，却砍下了一只脚带回来。';
        out.直引号包出几组 = n(real);
        // ⚠️关键点：引号**内部**的句号不许断句，否则引号就被切散了
        out.引号内句号不断句 = readingSplitSentences('他说"走吧。别等了"。然后就走了。').length === 2;
        out.中文引号照旧 = n('他说“不必再提”。她答“当年那桩事牵连甚广，如今再提无益”。') === 2;
        // 奇数个引号（对话跨段）：不许抛错，整段照样渲染出内容
        try {
            const h = readingBuildParaInner('"这话没说完，他就停住了。屋里很安静。', null);
            out.奇数引号不炸 = h.length > 0;
        } catch (e) { out.奇数引号不炸 = false; out.err = String(e).slice(0, 80); }
        return out;
    });

    ok('A 直引号对话包成 2 组（修复前是 0 组）', R.直引号包出几组 === 2, '实得 ' + R.直引号包出几组);
    ok('B ⚠️引号内部的句号不断句', R.引号内句号不断句);
    ok('C 中文引号照旧认得', R.中文引号照旧);
    ok('D 段内奇数个引号也不抛错', R.奇数引号不炸, R.err || '');
    ok('E 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 直引号：${bad}/${results.length} 条失败` : `\n✅ 直引号：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
