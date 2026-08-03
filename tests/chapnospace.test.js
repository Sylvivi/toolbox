/* 「chapter 和数字之间没空格就切不出章」的回归测试。
 *
 * 起因：用户 2026-08-04 问「服务器上有没有《丛林法则》这本书」，顺手发现它少了 chapter02
 * ——那本是原文标题行多打了个字符（`2chapter02 台风天`），属于个案；但查的时候摸出了
 * 一条真正的规则 bug：`english` 写的是 `^\s*[Cc]hapter\s+\d+`，**`\s+` 要求 chapter 后面
 * 必须有空格**，于是网文里最常见的 `chapter01` 一条都认不出来。
 *
 * ⚠️后果不是"少切几刀"，是**整本换了另一条规则去切**：`rbAutoSplit` 只选得分最高的一条，
 * 这类文里 `【xxx】` 开头的对话/标签行一大堆，english 得 0 分、`bracket` 反而赢了。实测：
 *   《烈酒换桃花》→ 2 章（单章 2 万 3 千字）、《咸鱼小妾在线划水》→ 6 章（首章 5 万 8 千字）、
 *   《一整个宇宙换一颗红豆》→ 8 章。整本等于没切。
 *
 * 在她真实书库上量过（371 本跑改前/改后对比）：19 本受影响、零误伤，7 本章数从个位数涨到几十。
 *
 * 跑法：node tests/chapnospace.test.js（或 bash tests/run.sh 跑全套）
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* ===== A 组：english 规则本身认哪些写法 ===== */
    const A = await page.evaluate(() => {
        const re = new RegExp(RB_PRESETS.english);
        const t = s => re.test(s.trim());
        return {
            无空格: t('chapter01 鲜肉月饼'),
            无空格纯数字: t('chapter01'),
            有空格: t('Chapter 1'),
            有空格补零: t('chapter 01相思'),          // 数字后面直接跟中文，别被 \b 卡掉
            大写: t('Chapter01 锦瑟'),
            行首空白: t('   chapter02 台风天'),
            // 不该认的
            正文提到: t('他翻到 chapter 3 就睡着了'),   // 不在行首
            光有词: t('chapter'),                      // 后面没数字
            像单词: t('chapters 都读完了')              // chapter 后面不是数字
        };
    });
    ok('⚠️`chapter01`（没空格）认——这次修的就是它', A.无空格);
    ok('`chapter01`（光数字没标题）也认', A.无空格纯数字);
    ok('`Chapter 1`（老写法）照旧认', A.有空格);
    ok('`chapter 01相思`（数字后面直接跟中文）认', A.有空格补零);
    ok('`Chapter01 锦瑟`（大写+没空格）认', A.大写);
    ok('行首有空白也认', A.行首空白);
    ok('正文里提到 chapter 的句子不认（不在行首）', !A.正文提到);
    ok('光一个 `chapter`、后面没数字，不认', !A.光有词);
    ok('`chapters 都读完了` 不认', !A.像单词);

    /* ===== B 组：整篇自动切——这才是这个 bug 真正的破坏力 =====
       正文里夹着【】标签行（她那批文的实际形状：聊天记录、角色标签、编者按），
       修之前 english 得 0 分、bracket 赢，整本被切成一坨。
       ⚠️`rbAutoSplit` 是「谁命中多谁赢、平局时表里靠前的赢」（bracket 排在 english 前面），
       所以这里造的数据是 4 条 chapter vs 2 条【】——跟她那三本的真实比例一致
       （《烈酒换桃花》25 条 chapter、《一整个宇宙换一颗红豆》25 条）。 */
    const B = await page.evaluate(() => {
        const txt = [
            'chapter01 锦瑟', '', '【宣照】：你来晚了。', '', '谢舟摇没答话，只把伞收了。', '',
            'chapter02 无端', '', '雨下了一整夜。', '',
            'chapter03 江上', '', '【宣照】：随你。', '', '船靠岸的时候天刚亮。', '',
            'chapter04 舟摇', '', '后来她再没提过那把伞。'
        ].join('\n');
        const chs = rbAutoSplit(txt);
        return { titles: chs.map(c => c.title), bodies: chs.map(c => c.body.length > 0) };
    });
    eq('⚠️夹着【】行的文，按 chapter 切成 4 章（修之前会被 bracket 切成一坨）', B.titles,
        ['chapter01 锦瑟', 'chapter02 无端', 'chapter03 江上', 'chapter04 舟摇']);
    ok('每一章都有正文（没有空章被静默丢掉）', B.bodies.every(Boolean));

    /* ===== C 组：别误伤——原来就切得好好的那些规则，一条都不许被 english 抢走 ===== */
    const C = await page.evaluate(() => {
        const pick = txt => rbAutoSplit(txt).map(c => c.title);
        return {
            中文章回: pick('第一章 相遇\n\n正文甲。\n\n第二章 别离\n\n正文乙。\n\n第三章 重逢\n\n正文丙。'),
            纯方括号: pick('【上部】\n\n正文甲。\n\n【中部】\n\n正文乙。\n\n【下部】\n\n正文丙。'),
            数字编号: pick('1. 相遇\n\n正文甲。\n\n2. 别离\n\n正文乙。\n\n3. 重逢\n\n正文丙。'),
            番外混排: pick('第一章 相遇\n\n正文甲。\n\n第二章 别离\n\n正文乙。\n\n番外·后来\n\n正文丙。')
        };
    });
    eq('「第X章」照旧按中文规则切', C.中文章回, ['第一章 相遇', '第二章 别离', '第三章 重逢']);
    eq('整篇【】标题的照旧按 bracket 切', C.纯方括号, ['【上部】', '【中部】', '【下部】']);
    eq('「1. 相遇」照旧按数字编号切', C.数字编号, ['1. 相遇', '2. 别离', '3. 重逢']);
    eq('正文用第X章、末尾用番外的混排照旧（番外单独成章）', C.番外混排, ['第一章 相遇', '第二章 别离', '番外·后来']);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
