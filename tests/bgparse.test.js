/* 「标背景第一遍的清单解析要宽，但不许瞎认」的回归测试。
 *
 * 起因：2026-08-03 用户报「找背景点的时候提示模型没按格式回，试了两次都失败」。
 * 第一遍走的是**摘要模型**（chatResolveCompressModel），多半是个便宜的小模型，
 * 而小模型最不擅长死守「P7|共济会」这种严格格式。老正则只认带 P 且带 |：的行，
 * 差一点点就整轮 0 条 —— 而整章两万字已经实打实喂出去了、钱照扣。
 *
 * ⚠️宽到什么程度是有边界的：段号前面既没「P」也没「第」时必须有明确分隔符，
 *   否则正文里「1958 年大跃进」会被读成 P1958。B 组专门守这条。
 *
 * 跑法：NODE_PATH=$HOME/.toolbox-test/node_modules node tests/bgparse.test.js
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');

const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(5000);

    const R = await page.evaluate(() => {
        const run = arr => arr.map(s => { const r = _rdBgParseLine(s); return r ? (r.p + '|' + r.term) : null; });
        return {
            // A 组：本来就该认的（老正则也认，不许改坏）
            A: run([
                'P7|共济会',
                'p23|宾夕法尼亚议会',
                'Ｐ7|共济会',
                '- P7|共济会',
                '1. P7|共济会',
                '**P7**|共济会',
                'P7|**共济会**',
                'P7：共济会',
                'P7｜共济会'
            ]),
            // B 组：小模型常见的「差一点点」，这次新认的
            B: run([
                '7|共济会',              // 吞掉 P
                '第7段|共济会',          // 写成「第N段」
                '[P7] 共济会',           // 加方括号、空格当分隔
                'P7 共济会',             // 空格当分隔
                'P7-共济会',             // 短横线当分隔
                'P7、共济会',            // 顿号当分隔
                '| P7 | 共济会 |',       // markdown 表格
                '> P7|共济会'            // 引用号
            ]),
            // C 组：不许瞎认
            C: run([
                '1958 年大跃进那阵子，粮食是紧张的',   // ⚠️没 P 没「第」又只有空格 → 绝不能读成 P1958
                '好的，我来找一下这一章的背景点：',      // 开场白
                '无',                                    // 「没有背景」由调用方另判，不该解析成条目
                '|---|---|',                             // 表格分隔行
                'P7 这一段讲的是共济会，它是十八世纪的兄弟会组织',  // 空格分隔时名字要短、不带句读
                'P7|',                                   // 分隔符后面空的
                '2024.11.01'                             // 日期行
            ])
        };
    });

    eq('A 组：原来就认的格式一条没丢', R.A, [
        '7|共济会', '23|宾夕法尼亚议会', '7|共济会', '7|共济会', '7|共济会',
        '7|共济会', '7|共济会', '7|共济会', '7|共济会'
    ]);
    eq('B 组：小模型常见的走样现在都认得出', R.B, [
        '7|共济会', '7|共济会', '7|共济会', '7|共济会', '7|共济会',
        '7|共济会', '7|共济会', '7|共济会'
    ]);
    eq('C 组：该拒的一条都没放进来（尤其「1958 年…」不许读成 P1958）',
        R.C, [null, null, null, null, null, null, null]);

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail)); });
    console.log(bad ? `❌ ${bad}/${results.length} 条没过` : `✅ 全过（${results.length} 条）`);
    process.exit(bad ? 1 : 0);
})();
