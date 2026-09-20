/* 小说「读前导读」的去模板化（2026-09-19 起，09-20 重做）。
 *
 * 起因：她报「读前每一篇都会提到一美元多经花」。拉她《欧·亨利小说全集》里
 * 已生成的 8 篇读前一数：**7/8 有一整段讲物价**、8/8 开头「二十世纪初的纽约」、
 * 8/8 结尾「读的时候可以留意…」。回味那档对比鲜明（物价 2/5、「留意」段 0/5）。
 *
 * ⚠️⚠️**09-19 那一版的设计错误就是这套测试存在的理由**：当时清单里还留着
 *   「· 这篇写于什么年代、地方」「· 作者其人」，却在后面另加一段说「这些别讲」。
 *   两段打架，模型照着**清单**走。实测：删掉的那条（物价）立刻消失，
 *   靠后面否定的那两条（年代、作者）原样还在。
 *   **要它不讲，就得把那一条从清单里拿走。** 这里的 B/C 两条就是钉这个的。
 *
 * 现在按「这是不是这本书的第一篇读前导读」分两套（判据 rdPriorPreGuides，
 * 从她的 reader_qa 里算，不依赖任何开关）：第一篇给足背景、第二篇起只讲这一篇特有的。
 *
 * 跑法：node tests/guidepre.test.js   或   bash tests/p.sh guidepre
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

    const R = await page.evaluate(async () => {
        const out = {};
        // ① 两套常量本身
        out.第一篇给年代 = NOVEL_GUIDE_PRE.indexOf('写于什么年代') >= 0;
        out.第一篇给作者 = NOVEL_GUIDE_PRE.indexOf('作者其人') >= 0;
        out.两套都不要物价 = NOVEL_GUIDE_PRE.indexOf('当时的钱值多少') < 0
                        && NOVEL_GUIDE_PRE_MORE.indexOf('当时的钱值多少') < 0;
        /* ⚠️B/C：第二篇那套的清单里**不能有**年代和作者这两个要求项——
           09-19 就是栽在"清单里留着、后面否定"上。这里连"要求"和"否定"一起判：
           出现的必须是带「不要」的那种句子。 */
        const more = NOVEL_GUIDE_PRE_MORE;
        out.第二篇清单没有年代要求 = more.indexOf('· 这一篇里会碰到') >= 0
                                && more.indexOf('· 这本书写于什么年代') < 0
                                && more.indexOf('**不要**交代这本书写于什么年代') >= 0;
        out.第二篇清单没有作者要求 = more.indexOf('· 作者其人') < 0
                                && more.indexOf('**不要**介绍作者是谁') >= 0;
        out.两套都防剧透 = /只补背景和该留意的方向|不许提这一篇的情节走向/.test(NOVEL_GUIDE_PRE)
                      && /不许提这一篇的情节走向/.test(NOVEL_GUIDE_PRE_MORE);
        out.回味没被动 = NOVEL_GUIDE_POST.indexOf('这篇好在哪') >= 0;

        /* ⚠️真正的计数函数也要测一次：G/H 那两条把它换成了假货，
           不测的话「判据本身算错」这种事会从测试的缝里漏过去。 */
        window.readerBookId = 'bk_test';
        window.readerBookKey = function () { return 'K'; };
        window.readerQAAll = function () {
            return { K: {
                3: { list: [{ p: 1, q: '导读·读前：《甲》', a: 'x' }] },
                4: { list: [{ p: 1, q: '导读这段讲的是什么', a: 'x' }] },   // 她自己打的，不算
                5: { list: [{ p: 1, q: '导读·读前：《丙》', a: 'x' }] },
                6: { list: [{ p: 1, q: '导读·回味：《丁》', a: 'x' }] }     // 回味不算
            } };
        };
        out.计数_排除当前章 = rdPriorPreGuides(5) === 1;      // 只剩第 3 章那条
        out.计数_不数回味和用户自打的 = rdPriorPreGuides(99) === 2;
        out.计数_没数据时是0 = (function () {
            window.readerQAAll = function () { return {}; };
            var n = rdPriorPreGuides(1);
            window.readerQAAll = function () { return { K: { 3: { list: [{ q: '导读·读前：《甲》' }] } } }; };
            return n === 0;
        })();

        // ② 真跑 readingAskOne，看挑了哪一套
        const sent = [];
        window.chatStreamChat = async function (o) { sent.push(o); return '假答案'; };
        window.chatEnsureProvider = function () { return { url: 'https://relay.test/v1', name: '测试站', keys: [{ k: 'sk-x' }] }; };
        window.getActiveKey = function () { return 'sk-x'; };
        window.chatSelectedModel = 'test-model';
        window.chatSelectedKeyStr = 'sk-test';
        window.chatSaveCurrentConv = function () {};
        window.readingAddQuestionBookmark = function () {};
        window.readerPersistQA = function () {};
        window.readingRerenderMsg = function () {};
        window.alert = function () {};
        window.showToast = function () {};
        window.chatMessages = [
            { role: 'user', content: '《甲篇》\n\n第一段。\n第二段。\n第三段。\n第四段。', ts: 1 },
            { role: 'assistant', content: '', ts: 1, readingMode: true, readerChapter: 5 }
        ];
        window.chatReaderMode = true; window.chatReadingMode = true; window.chatTranslateMode = false;

        const run = async (priorChapters, kind) => {
            sent.length = 0;
            // 假装这本书里这些章做过读前导读
            window.rdPriorPreGuides = function (cur) {
                return priorChapters.filter(function (c) { return String(c) !== String(cur); }).length;
            };
            await readingAskOne(1, 2, '导读', null, { guide: true, guideKind: kind || 'pre' });
            const m = (sent[0] && sent[0].messages) || [];
            return { sys: m.filter(x => x.role === 'system').map(x => x.content).join('\n'),
                     usr: m.filter(x => x.role === 'user').map(x => x.content).join('\n') };
        };
        const 第一篇 = await run([]);
        const 第三篇 = await run([1, 2]);
        const 只有自己 = await run([5]);          // 删了重做同一章：仍然算第一篇
        const 回味 = await run([1, 2], 'post');

        out.第一篇_用给足那套 = 第一篇.sys.indexOf('这是我在这本书里读的**第一篇**') >= 0;
        out.第三篇_用只讲这篇那套 = 第三篇.sys.indexOf('【只讲这一篇·最要紧】') >= 0
                              && 第三篇.sys.indexOf('这是我在这本书里读的**第一篇**') < 0;
        out.第三篇_正文也提了 = 第三篇.usr.indexOf('一个字都不要再讲') >= 0;
        out.第一篇_正文不提 = 第一篇.usr.indexOf('一个字都不要再讲') < 0;
        out.重做同一章仍算第一篇 = 只有自己.sys.indexOf('这是我在这本书里读的**第一篇**') >= 0;
        out.回味不受影响 = 回味.sys.indexOf('【只讲这一篇·最要紧】') < 0 && 回味.sys.indexOf('这篇好在哪') >= 0;
        // ③ 防剧透必须仍是 userMsg 的最后一句
        out.防剧透还在最末尾 = /只补背景和该留意的方向。\s*$/.test(第一篇.usr)
                          && /只补背景和该留意的方向。\s*$/.test(第三篇.usr);
        return out;
    });

    ok('A 第一篇那套照旧给年代和作者（别留坑）', R.第一篇给年代 && R.第一篇给作者);
    ok('B ⚠️第二篇那套的清单里**没有**年代这一项，只有明确的「不要」', R.第二篇清单没有年代要求);
    ok('C ⚠️第二篇那套的清单里**没有**作者这一项，只有明确的「不要」', R.第二篇清单没有作者要求);
    ok('D 两套都不再把「当时的钱值多少」列为必答项', R.两套都不要物价);
    ok('E 两套都带防剧透', R.两套都防剧透);
    ok('F 回味那一档一个字没动', R.回味没被动);
    ok('G 这本书还没做过读前 → 用「给足」那套', R.第一篇_用给足那套);
    ok('H 已经做过两篇 → 用「只讲这一篇」那套', R.第三篇_用只讲这篇那套);
    ok('I 第二篇起，正文末尾也补一句', R.第三篇_正文也提了 && R.第一篇_正文不提);
    ok('J ⚠️把第一篇删了重做，仍然算第一篇（排除当前章）', R.重做同一章仍算第一篇);
    ok('K 「回味」档完全不进这个分支', R.回味不受影响);
    ok('L ⚠️防剧透那句仍然在 userMsg 的最末尾（位置＝效力）', R.防剧透还在最末尾);
    ok('M 计数函数：排除当前章', R.计数_排除当前章);
    ok('N 计数函数：回味和她自己打的「导读…」都不算', R.计数_不数回味和用户自打的);
    ok('O 计数函数：没数据时返回 0', R.计数_没数据时是0);
    ok('P 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 读前导读：${bad}/${results.length} 条失败` : `\n✅ 读前导读：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
