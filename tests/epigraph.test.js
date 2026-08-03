/* 「章首题词不许被当成副标题剪走」的回归测试。
 *
 * 起因：2026-08-03 用户报《米德尔马契》「目录会把正文的第一句跟标题的第几章连在一起，
 * 部分章节出现了这个问题」。这本书每章开头有一段**题词**（引诗/引语），按诗行折行，
 * 第一行自然以逗号收尾；而 epub 里章标题就是光秃秃的「第一章」，于是 _rbLooksLikeSubtitle
 * 那条「逗号对偶回目」的规矩把题词首行当成副标题接了上去。
 *
 * ⚠️两处伤，第二处更重：① 目录变成「第一章 我身为弱女子行不了大善，」；
 *   ② **正文那一行同时被剪走**，这一章从题词第二句开始，半句话没头没脑。全书 97 章中招 27 章。
 *
 * 跑法：NODE_PATH=$HOME/.toolbox-test/node_modules node tests/epigraph.test.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
// 服务器上那本真书（存在才跑 C 组——换台机器没有这份数据也不该让测试红）
const MID = '/home/ubuntu/cc-books/store/28d5a92bf6bb47b0cc0863203214550f6915f44843c0457d83f98a81a20d0f60.body';

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

    /* ===== A 组：题词首行不许上位、正文一个字不许少 ===== */
    const A = await page.evaluate(() => {
        // 用户那本书里真实的形状：标题是光秃秃的「第一章」，正文第一行是题词首行（逗号收尾）
        const body = '我身为弱女子行不了大善，\n只能持之以恒勉力为之。\n\n ——博蒙特与弗莱彻《少女的悲剧》\n\n 多罗西娅那样的容貌，在简朴服饰的衬托下似乎更为明艳。';
        const r = rbDeriveTitleAndBody('第一章', body);
        // 连跑三遍要幂等（云端下回来的书每次同步都会重跑一遍标题修复）
        let x = { title: '第一章', body: body };
        for (let i = 0; i < 3; i++) x = rbDeriveTitleAndBody(x.title, x.body);
        return { t: r.title, same: r.body === body, tx: x.title, samex: x.body === body };
    });
    eq('题词首行不许接到「第一章」后面', A.t, '第一章');
    ok('正文一个字都没被剪走', A.same, '正文被改动了');
    eq('反复同步跑三遍仍是原样（幂等）', [A.tx, A.samex], ['第一章', true]);

    /* ===== B 组：别误伤——真正的副标题照旧接得上 ===== */
    const B = await page.evaluate(() => ({
        // 光秃秃的回数 + 正文首行是真副标题（不以逗号收尾）
        普通副标题: rbDeriveTitleAndBody('第五回', '治伤\n\n令狐冲道：「不妨事。」').title,
        // 传统回目对句：逗号在**句中**，不在句尾 → 仍算副标题
        回目对句: rbDeriveTitleAndBody('第三十三回', '弹指红颜老，刹那芳华\n\n那日天色将晚，众人聚在厅上。').title,
        // 全角空格分隔的回目体
        回目体: rbDeriveTitleAndBody('第十回', '教单于折箭　六军辟易\n\n耶律洪基见状大惊。').title,
        // 以逗号收尾 → 拒（这次新加的那道闸）
        逗号收尾: rbDeriveTitleAndBody('第七章', '喜悦与甜瓜，\n需要相同的气候。\n\n ——意大利谚语').title,
        顿号收尾: rbDeriveTitleAndBody('第八章', '风雨雷电、\n皆是天意。\n\n那一夜他没有睡。').title,
        /* ⚠️用户报「第三章和第五十七章还没好」：这两章的题词行**断在句子中间**、不以逗号收尾，
           上面那道闸拦不住。补的判据＝「逗号要对得齐」，见 _rbLooksLikeSubtitle 里的注释。 */
        断句不齐三段: rbDeriveTitleAndBody('第三章', '女神，告诉我，当拉斐尔\n这慈祥的大天使……\n\n 如果卡索邦真的觉得多罗西娅适合当他的妻子，那么她接受求婚的理由已经埋植在她脑海里。').title,
        断句不齐两段: rbDeriveTitleAndBody('第五十七章', '那年他们才八岁，有个名字\n在他们心头浮现，激起万般情绪；\n\n 那本书带给他们无比的喜悦与庄严的忧伤。').title,
        // 别误伤：顿号是枚举，标题里很常见
        顿号枚举: rbDeriveTitleAndBody('第四章', '三体、周文王、长夜\n\n汪淼再次进入三体游戏时，是在一个雪夜。').title,
        顿号前缀: rbDeriveTitleAndBody('第一章', '☆、治伤\n\n那日天色将晚，他倚在窗边等了很久。').title,
        // 别误伤：行首装饰不算进「对不对得齐」
        带序号前缀: rbDeriveTitleAndBody('第七章', '07 引人注目，夺人心魄\n\n他站在台上，底下一片安静。').title
    }));
    eq('真副标题照旧接得上（别把这条功能修没了）', B.普通副标题, '第五回 治伤');
    eq('传统回目对句照旧算副标题（逗号在句中）', B.回目对句, '第三十三回 弹指红颜老，刹那芳华');
    eq('全角空格分隔的回目体照旧算副标题', B.回目体, '第十回 教单于折箭　六军辟易');
    eq('以逗号收尾的题词行 → 拒', B.逗号收尾, '第七章');
    eq('以顿号收尾的行 → 拒', B.顿号收尾, '第八章');
    eq('断成三段的引诗行 → 拒（用户报的第三章）', B.断句不齐三段, '第三章');
    eq('两段长短不齐（7字/4字）的引诗行 → 拒（用户报的第五十七章）', B.断句不齐两段, '第五十七章');
    eq('顿号枚举照旧算副标题（三体那种）', B.顿号枚举, '第四章 三体、周文王、长夜');
    eq('☆、开头的晋江式副标题照旧接得上', B.顿号前缀, '第一章 ☆、治伤');
    eq('行首序号不算进「对得齐」的长度（07 引人注目，夺人心魄）', B.带序号前缀, '第七章 07 引人注目，夺人心魄');

    /* ===== C 组：拿服务器上那本真书跑一遍，97 章一个都不许再被啃 ===== */
    let chs = null;
    try { chs = JSON.parse(fs.readFileSync(MID, 'utf8')).book.chapters; } catch (e) { }
    if (chs) {
        const C = await page.evaluate((arr) => {
            const before = arr.map(c => c.title + '|' + c.body.length);
            const after = rbFixChapterTitles(JSON.parse(JSON.stringify(arr))).map(c => c.title + '|' + c.body.length);
            const changed = [];
            for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) changed.push(i + ': ' + before[i] + ' → ' + after[i]);
            // 修好之后不该再有「第N章 + 一句以逗号收尾的话」这种标题
            const stillBad = after.filter(s => /^第[一二三四五六七八九十百千零〇两\d]+[章节回篇卷话]\s+.*[，、；,;]\|/.test(s)).length;
            return { n: arr.length, changed, stillBad };
        }, chs);
        eq('真书跑一遍标题修复，97 章一个都不动', C.changed, []);
        eq('章数还是 97', C.n, 97);
        eq('没有「第N章＋逗号收尾的半句话」这种标题了', C.stillBad, 0);
    } else {
        ok('（跳过 C 组：这台机器上没有《米德尔马契》数据）', true);
    }

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail)); });
    console.log(bad ? `❌ ${bad}/${results.length} 条没过` : `✅ 全过（${results.length} 条）`);
    process.exit(bad ? 1 : 0);
})();
