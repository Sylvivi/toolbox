/* 「空壳章不许被改名」的回归测试。
 *
 * 起因：2026-08-02 用户报《笑傲江湖（新修版）》目录里「第十回 传剑」排在「第一回 灭门」前面、
 * 「第二十回 探狱」排在「第十一回 聚气」前面。
 *
 * 根因在 rbDeriveTitleAndBody：它会翻每章正文前 8 个非空行，看到像回目的行就拿来当章节名
 * （这是治「epub 把每章 <title> 都设成书名」用的，本身有用）。而金庸那套 epub 每卷开头有个
 * 「卷首目录页」空壳——<h1> 是本卷**第一回**的回目、正文只有一行本卷**最后一回**的回目。
 * 于是「第一回 灭门」被改名成「第十回 传剑」、正文同时清空，目录上凭空多出个假章节。
 *
 * ⚠️ 这个 bug 的隐蔽之处：目录上「第十回 传剑」看着完全正常，**只有字数暴露了它**
 *（假的 6,087 字 vs 真的 24,084 字）。所以 B 组专门断言「改名后正文不能是空的」。
 *
 * 跑法：NODE_PATH=$HOME/.toolbox-test/node_modules node tests/shelltitle.test.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
// 服务器上那本真书（存在才跑 C 组——换台机器没有这份数据也不该让测试红）
const REAL = '/home/ubuntu/cc-books/store/d95fefb7c0e7e7e4c08a5a8b9d89661f5a4d3af1deb5bcbb1dbfae6d7b67a8da.body';

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

    /* ===== A 组：空壳章保住原标题 ===== */
    const A = await page.evaluate(() => {
        // 用户那本书里真实的形状：标题=本卷第一回，正文只有一行=本卷最后一回
        const r1 = rbDeriveTitleAndBody('第一回 灭门', '第十回 传剑');
        // 正文只有回目 + 一堆空行，同样是空壳
        const r2 = rbDeriveTitleAndBody('第十一回 聚气', '\n第二十回 探狱\n\n  \n');
        // 原标题为空时没得可留，只能沿用老行为（拿正文那行当名字）
        const r3 = rbDeriveTitleAndBody('', '第十回 传剑');
        return { t1: r1.title, b1: r1.body, t2: r2.title, t3: r3.title };
    });
    eq('空壳章保住原标题，不被正文里那行回目顶掉', A.t1, '第一回 灭门');
    eq('空壳章的正文原样留着（别顺手清空）', A.b1, '第十回 传剑');
    eq('正文只有回目+空行，同样算空壳', A.t2, '第十一回 聚气');
    eq('原标题为空时没得可留，沿用老行为', A.t3, '第十回 传剑');

    /* ===== B 组：老功能一字未改（epub 把每章标题设成书名）===== */
    const B = await page.evaluate(() => {
        // 这是这段逻辑当初要治的病：标题是书名，真正的回目在正文第一行，后面有正文
        const r = rbDeriveTitleAndBody('笑傲江湖', '第三回 救难\n\n林平之心中一凛，只见那人……');
        // 光秃秃的回数 + 副标题在正文首行
        const r2 = rbDeriveTitleAndBody('第五回', '治伤\n\n令狐冲道：「不妨事。」');
        return { t: r.title, b: r.body, t2: r2.title, b2: r2.body };
    });
    eq('标题是书名时，仍从正文揪出真正的回目', B.t, '第三回 救难');
    eq('揪完把回目那行从正文删掉（阅读时标题会另拼一遍）', B.b, '林平之心中一凛，只见那人……');
    eq('光秃秃的回数仍能接上正文首行的副标题', B.t2, '第五回 治伤');
    eq('副标题也从正文删掉', B.b2, '令狐冲道：「不妨事。」');

    /* ===== C 组：拿用户真实的那本书跑整条导入管线 ===== */
    let chapters = null;
    try { chapters = JSON.parse(fs.readFileSync(REAL, 'utf8')).book.chapters; } catch (e) { }
    if (chapters) {
        const C = await page.evaluate((chs) => {
            const c1 = rbDedupChapters(JSON.parse(JSON.stringify(chs))).chapters;
            const c2 = rbFixChapterTitles(JSON.parse(JSON.stringify(c1)));
            // ⚠️判据不是「标题对不对」而是「有没有正文空了却还叫着回目名的假章节」——
            // 用户那次就是靠字数才看出「第十回 6,087 字」是假的
            const fake = c2.filter(c => !c.body.trim() && /^第[一二三四五六七八九十百千零〇两\d]+[章节回篇卷话]/.test(c.title))
                .map(c => c.title);
            // 真正的回目必须按 1,2,3… 的顺序出现，中间不许插进别的回数
            const nums = [];
            const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
            c2.forEach(c => {
                const m = c.title.match(/^第([一二三四五六七八九十百千零〇两\d]+)回/);
                if (!m || !c.body.trim()) return;
                let s = m[1], n = 0;
                if (s.indexOf('十') >= 0) {
                    const p = s.split('十');
                    n = (p[0] ? CN[p[0]] : 1) * 10 + (p[1] ? CN[p[1]] : 0);
                } else n = CN[s] || 0;
                nums.push(n);
            });
            /* ⚠️判「不倒退」而不是「严格递增」：这套 epub 每卷卷首的目录页空壳保住原标题后，
               「第一回 灭门」会正当地出现两次（6 字的壳 + 27,595 字的正文），那是书本来的样子。
               用户报的错是**倒退**（第十回冒到第一回前面），重复不是。 */
            let ascending = true;
            for (let i = 1; i < nums.length; i++) if (nums[i] < nums[i - 1]) { ascending = false; break; }
            return { total: c2.length, fake, first20: nums.slice(0, 20), ascending };
        }, chapters);
        eq('真书跑完管线不产生「0 字的假回目」', C.fake, []);
        eq('章数不变（51 章，改名逻辑绝不许动章节边界）', C.total, 51);
        ok('回目从头到尾递增，没有第十回插到第一回前面', C.ascending, '实际顺序 ' + JSON.stringify(C.first20));
    } else {
        ok('（跳过 C 组：这台机器上没有那本真书的数据）', true);
    }

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail)); });
    console.log(bad ? `❌ ${bad}/${results.length} 条没过` : `✅ 全过（${results.length} 条）`);
    process.exit(bad ? 1 : 0);
})();
