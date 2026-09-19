/* 小说「读前导读」的去模板化（2026-09-19）。
 *
 * 起因：她报「读前每一篇都会提到一美元多经花」。拉她《欧·亨利小说全集》里
 * 已生成的 8 篇读前一数：**7/8 有一整段讲物价**、8/8 开头「二十世纪初的纽约」、
 * 8/8 结尾「读的时候可以留意…」。回味那档对比鲜明（物价 2/5、「留意」段 0/5）。
 *
 * 病根不是模型，是 NOVEL_GUIDE_PRE 那四条写成了**必答项**，
 * 而短篇集里「年代/地点/作者/物价」整本共通 → 每篇照着填一遍表。
 * ⚠️而且「当时的钱值多少」本来就不归导读——代码里原始分工是
 *   「标背景管点状（一块八毛七值多少）／导读管面状」，是两段提示词自己打架。
 *
 * 这套测试钉三件事：
 *   ① 钱那条真的从读前里没了，而且配了明确的否定句（光删挡不住 7/8 的习惯）；
 *   ② 「短篇集」那段补丁**只在标了短篇集的书 + 只在读前**挂上去；
 *   ③ ⚠️防剧透那句仍然在 userMsg 的**最末尾**（位置＝效力，这是读前的头号规矩）。
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
        // ① 常量本身
        out.读前不再要求讲钱 = NOVEL_GUIDE_PRE.indexOf('当时的钱值多少') < 0;
        out.读前明确禁止讲物价 = NOVEL_GUIDE_PRE.indexOf('不要专门用一段讲当时的物价') >= 0;
        out.短篇集补丁存在 = /短篇集/.test(NOVEL_GUIDE_PRE_ANTH) && /一个字都不要再讲/.test(NOVEL_GUIDE_PRE_ANTH);
        out.回味没被动 = NOVEL_GUIDE_POST.indexOf('这篇好在哪') >= 0 && NOVEL_GUIDE_POST.indexOf('短篇集') < 0;

        // ② 真跑一次 readingAskOne，看发出去的 system / user 带了什么
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

        // 造一章：user 放原文，assistant 是阅读消息
        window.chatMessages = [
            { role: 'user', content: '《甲篇》\n\n第一段。\n第二段。\n第三段。\n第四段。', ts: 1 },
            { role: 'assistant', content: '', ts: 1, readingMode: true, readerChapter: 0 }
        ];
        window.chatReaderMode = true; window.chatReadingMode = true; window.chatTranslateMode = false;

        const run = async (isAnth) => {
            sent.length = 0;
            window.rbIsAnthology = function () { return isAnth; };
            await readingAskOne(1, 2, '导读', null, { guide: true, guideKind: 'pre' });
            const m = sent[0] && sent[0].messages || [];
            return { sys: (m.filter(x => x.role === 'system').map(x => x.content).join('\n')),
                     usr: (m.filter(x => x.role === 'user').map(x => x.content).join('\n')) };
        };
        const A = await run(true);
        const B = await run(false);
        out.发出去了 = !!A.sys;
        out.短篇集_挂上了 = A.sys.indexOf('这是一本短篇集') >= 0;
        out.短篇集_正文末尾也提了 = A.usr.indexOf('一篇一篇读') >= 0;
        out.长篇_没挂 = B.sys.indexOf('这是一本短篇集') < 0 && B.usr.indexOf('一篇一篇读') < 0;
        // ③ 防剧透必须仍是 userMsg 的最后一句
        out.防剧透还在最末尾 = /只补背景和该留意的方向。\s*$/.test(A.usr) && /只补背景和该留意的方向。\s*$/.test(B.usr);

        // 回味那一档不该被短篇集补丁碰到
        sent.length = 0;
        window.rbIsAnthology = function () { return true; };
        await readingAskOne(1, 2, '导读', null, { guide: true, guideKind: 'post' });
        const P = sent[0] && sent[0].messages || [];
        out.回味_没挂短篇集 = P.filter(x => x.role === 'system').map(x => x.content).join('\n').indexOf('这是一本短篇集') < 0;
        return out;
    });

    ok('A 读前不再把「当时的钱值多少」列为必答项', R.读前不再要求讲钱);
    ok('B 读前配了明确的「别专门讲物价」（光删挡不住 7/8 的习惯）', R.读前明确禁止讲物价);
    ok('C 短篇集补丁存在', R.短篇集补丁存在);
    ok('D 回味那一档一个字没动', R.回味没被动);
    ok('E 请求真的发出去了（后面几条才有意义）', R.发出去了);
    ok('F 标了短篇集 → 补丁挂进 system', R.短篇集_挂上了);
    ok('G 标了短篇集 → 正文末尾也带了一句', R.短篇集_正文末尾也提了);
    ok('H ⚠️没标短篇集（长篇）→ 一个字都不加', R.长篇_没挂);
    ok('I ⚠️防剧透那句仍然在 userMsg 的最末尾（位置＝效力）', R.防剧透还在最末尾);
    ok('J 「回味」档不挂短篇集补丁（它本来就不僵）', R.回味_没挂短篇集);
    ok('K 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 读前导读：${bad}/${results.length} 条失败` : `\n✅ 读前导读：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
