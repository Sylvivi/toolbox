/* 翻译追问的「带多少上下文」面板（2026-09-05 加）的回归测试。
 *
 * 起因：她问「翻译模式下追问的上下文是什么，能否像阅读模式一样自行选择呢」。
 * 在这之前翻译追问带什么是写死的：本集前文（预算 20 万字≈整集全带）+ 这段原文 +
 * 这段的译文 + 这段的历史问答 + 剧集记忆四张表。前文那块最大，却一档都关不掉。
 *
 * 这套测试守两件事：
 *   ① 面板真的接到发出去的内容上了（A/B/C/D/E 组）——面板里点了、实际请求里就得变。
 *      共读那边的教训：消费点漏一个就等于开关没接上，而且从界面上看不出来。
 *   ② 没碰过面板的会话，发出去的东西一个字不变（A 组）——默认值就是老行为，
 *      别为了省钱偷偷调小。
 *
 * ⚠️不联网：chatStreamChat 被换成只记账不发请求的假货。
 * 跑法：node tests/transaskctx.test.js   或   bash tests/p.sh transaskctx
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

/* 造一集 15 段的剧本，第 10 段已经译过、并且已经就它问过一轮。
 * 然后对第 10 段发起追问，把送进 chatStreamChat 的 messages 拆开来看带了什么。 */
function boot() {
    const CONV = 'conv_ta_test';
    window.chatCurrentConvId = CONV;
    window._CONV = CONV;
    window.chatSelectedModel = 'test-model';
    window.chatSelectedKeyStr = 'sk-test';
    window.translateBusy = false;
    window.alert = function () {};
    // 落盘/沉淀/渲染全换成空壳：测试只关心「发出去的是什么」
    window.chatEnsureProvider = function () { return { url: 'https://relay.test/v1', name: '测试站', keys: [{ k: 'sk-x' }] }; };
    window.chatTransMemoryPromptBlock = function () { return '【剧集记忆】人物：Jack（男）／地点：码头'; };
    window.chatTransHarvestMemory = function () {};
    window.readingAddQuestionBookmark = function () {};
    window.readingRerenderMsg = function () {};
    window.chatSaveCurrentConv = function () {};
    window.chatStreamChat = async function (opts) { window._sent = opts; return '这是假答案'; };

    const paras = [];
    for (let i = 1; i <= 15; i++) paras.push('[P' + i + '] line' + i + ' 台词内容');
    const ORIG = paras.join('\n');
    const BLOCK = '[[TR s=10 e=10]]第十段的译文\n[[QA]]旧问题[[ANS]]旧答案[[/QA]]\n[[/TR]]';

    // cfg=null → 清掉存的设置，走默认（＝这一版之前的写死行为）
    window._ask = async function (cfg) {
        if (cfg) localStorage.setItem('trans_ask_ctx:' + CONV, JSON.stringify(cfg));
        else localStorage.removeItem('trans_ask_ctx:' + CONV);
        window.chatMessages = [
            { role: 'user', content: ORIG, ts: 1 },
            { role: 'assistant', content: BLOCK, translateMode: true, ts: 2 }
        ];
        window._sent = null;
        window.translateBusy = false;
        await translateAskRun(1, 10, 10, '这句什么意思', null);
        const m = (window._sent && window._sent.messages) || [];
        const sys = m.filter(x => x.role === 'system');
        const user = m.length ? m[m.length - 1].content : '';
        // 【前文】块里到底带了哪几段
        function seg(from, to) {
            const a = user.indexOf(from);
            if (a < 0) return '';
            const b = to ? user.indexOf(to, a) : -1;
            return user.slice(a, b < 0 ? undefined : b);
        }
        const preTxt = seg('【前文', '【我要追问的这一段');
        const postTxt = seg('【后文', '你之前给出的翻译');
        return {
            system条数: sys.length,
            带了记忆表: sys.some(x => x.content.indexOf('【剧集记忆】') >= 0),
            有前文块: preTxt !== '',
            前文段: (preTxt.match(/line(\d+)/g) || []).map(x => +x.slice(4)),
            有后文块: postTxt !== '',
            后文段: (postTxt.match(/line(\d+)/g) || []).map(x => +x.slice(4)),
            带了历史问答: user.indexOf('我们之前就这段的问答') >= 0,
            带了本段原文: user.indexOf('【我要追问的这一段（第 10 段）】') >= 0,
            带了已有译文: user.indexOf('第十段的译文') >= 0,
            人设提了后文: ((m[0] && m[0].content) || '').indexOf('后面的几段原文') >= 0,
            purpose: window._sent && window._sent.purpose
        };
    };
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: '(' + boot + ')();' });

    /* ── A 组：没碰过面板 = 老行为，一个字不变 ──────────────────────────── */
    const A = await page.evaluate(() => window._ask(null));
    eq('A1 默认前文＝本集从头带到追问段前（1–9）', A.前文段, [1,2,3,4,5,6,7,8,9]);
    ok('A2 默认不带后文（不许提前剧透）', A.有后文块 === false, JSON.stringify(A));
    ok('A3 默认带剧集记忆四张表', A.带了记忆表, JSON.stringify(A));
    ok('A4 默认带这一段的历史问答', A.带了历史问答, JSON.stringify(A));
    ok('A5 本段原文和已有译文照旧必带（追问的骨架）', A.带了本段原文 && A.带了已有译文, JSON.stringify(A));
    ok('A6 默认人设里不提后文', A.人设提了后文 === false, JSON.stringify(A));
    eq('A7 记账仍归到「翻译追问」', A.purpose, '翻译追问');

    /* ── B 组：前文段数 ─────────────────────────────────────────────────── */
    const B0 = await page.evaluate(() => window._ask({ pre: 0, post: 0, mt: 1, qa: 1 }));
    ok('B1 前文选「无」→ 整个前文块都不发', B0.有前文块 === false, JSON.stringify(B0));
    ok('B2 前文关掉后，本段原文和译文仍在', B0.带了本段原文 && B0.带了已有译文, JSON.stringify(B0));
    const B5 = await page.evaluate(() => window._ask({ pre: 5, post: 0, mt: 1, qa: 1 }));
    eq('B3 前文选「5段」→ 只带最近 5 段（5–9）', B5.前文段, [5,6,7,8,9]);
    const B20 = await page.evaluate(() => window._ask({ pre: 20, post: 0, mt: 1, qa: 1 }));
    eq('B4 段数超过实有段数不报错、有几段给几段', B20.前文段, [1,2,3,4,5,6,7,8,9]);

    /* ── C 组：后文（她主动按了才给）───────────────────────────────────── */
    const C = await page.evaluate(() => window._ask({ pre: 0, post: 2, mt: 1, qa: 1 }));
    eq('C1 后文选「2段」→ 带 11、12 两段', C.后文段, [11,12]);
    ok('C2 给了后文就要在人设里说清它只用来理解语境', C.人设提了后文, JSON.stringify(C));
    const C10 = await page.evaluate(() => window._ask({ pre: 0, post: 10, mt: 1, qa: 1 }));
    eq('C3 后文越界不报错（只到最后一段为止）', C10.后文段, [11,12,13,14,15]);

    /* ── D 组：剧集记忆开关 ─────────────────────────────────────────────── */
    const D = await page.evaluate(() => window._ask({ pre: 0, post: 0, mt: 0, qa: 1 }));
    ok('D1 关掉记忆表 → 那条 system 不再发出去', D.带了记忆表 === false, JSON.stringify(D));
    eq('D2 关掉后只剩人设一条 system', D.system条数, 1);

    /* ── E 组：本段历史问答开关 ─────────────────────────────────────────── */
    const E = await page.evaluate(() => window._ask({ pre: 0, post: 0, mt: 1, qa: 0 }));
    ok('E1 关掉历史问答 → 不再回喂上一轮问答', E.带了历史问答 === false, JSON.stringify(E));
    ok('E2 但这一段的译文仍在（那是追问对象，不能关）', E.带了已有译文, JSON.stringify(E));

    /* ── F 组：设置按会话各记一份 ───────────────────────────────────────── */
    const F = await page.evaluate(() => {
        localStorage.setItem('trans_ask_ctx:conv_ta_test', JSON.stringify({ pre: 5, post: 0, mt: 0, qa: 0 }));
        const a = translateAskCtx();
        window.chatCurrentConvId = '别的剧集';
        const b = translateAskCtx();          // 换个会话 → 回到默认
        window.chatCurrentConvId = 'conv_ta_test';
        const c = translateAskCtx();          // 换回来 → 还是自己那份
        return { 这个会话: a, 别的会话: b, 换回来: c };
    });
    eq('F1 存的是自己这个会话的设置', F.这个会话, { pre: 5, post: 0, mt: 0, qa: 0 });
    eq('F2 换个会话回到默认（不互相污染）', F.别的会话, { pre: -1, post: 0, mt: 1, qa: 1 });
    eq('F3 换回来还是自己那份', F.换回来, { pre: 5, post: 0, mt: 0, qa: 0 });

    /* ── G 组：圆点档位 + 面板点击 ──────────────────────────────────────── */
    const G = await page.evaluate(() => {
        localStorage.removeItem('trans_ask_ctx:conv_ta_test');
        const lv默认 = translateAskCtxLv();
        translateSetAskCtx({ qa: 0 });
        const lv关问答 = translateAskCtxLv();
        translateSetAskCtx({ mt: 0 });
        const lv全关 = translateAskCtxLv();
        // 面板点击：造一个追问条，点圆点展开，再点「前文 5段」
        localStorage.removeItem('trans_ask_ctx:conv_ta_test');
        const bar = document.createElement('div');
        bar.className = 'translate-askbar';
        // ⚠️照真实调用点的顺序拼：圆点在前、面板在最后（面板夹中间会把输入框挤下去）
        bar.innerHTML = translateAskLvHtml() + '<textarea class="ta-ask"></textarea>' + translateCtxPanelHtml();
        document.body.appendChild(bar);
        translateBindAskLv(bar);
        const dot = bar.querySelector('.rp-lv');
        const panel = bar.querySelector('.rp-ctxpanel');
        const 展开前 = panel.style.display;
        dot.click();
        const 展开后 = panel.style.display;
        const chip = panel.querySelector('[data-tactx="pre:5"]');
        chip.click();
        const 点完的pre = translateAskCtx().pre;
        // 再点一个，验证委托监听器没被 innerHTML 换掉（共读那边踩过：面板只能点一次）
        panel.querySelector('[data-tactx="mt"]').click();
        const 第二次也生效 = translateAskCtx().mt === 0;
        // ⚠️关掉记忆表还不掉档：档位是 qa→2 / mt→1 / 都没有→0，qa 还开着就仍是满档。
        //   要看圆点跟不跟着走，得点那个真会掉档的（关掉问答 → 2 掉到 0，因为 mt 已经关了）
        const 关问答前 = dot.getAttribute('data-lv');
        panel.querySelector('[data-tactx="qa"]').click();
        const 圆点跟着变 = dot.getAttribute('data-lv');
        // 面板必须是追问条的最后一个孩子，否则 flex-wrap 会把输入框顶到第三行
        const 面板在最后 = bar.lastElementChild === panel;
        const 输入框在面板前 = !!(bar.querySelector('.ta-ask') && (bar.querySelector('.ta-ask').compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING));
        bar.remove();
        return { lv默认, lv关问答, lv全关, 展开前, 展开后, 点完的pre, 第二次也生效, 关问答前, 圆点跟着变, 面板在最后, 输入框在面板前 };
    });
    eq('G1 默认圆点＝满档（记忆表+问答都带）', G.lv默认, 2);
    eq('G2 关掉问答 → 半档', G.lv关问答, 1);
    eq('G3 记忆表也关 → 空档', G.lv全关, 0);
    eq('G4 面板默认收着', G.展开前, 'none');
    eq('G5 点圆点展开', G.展开后, 'flex');
    eq('G6 点「5段」真的存进去了', G.点完的pre, 5);
    ok('G7 面板能连点第二次（委托监听器没被 innerHTML 冲掉）', G.第二次也生效, JSON.stringify(G));
    eq('G8 只关记忆表还不掉档（问答开着仍是满档）', G.关问答前, '2');
    eq('G9 问答也关掉 → 圆点跟着变成空档', G.圆点跟着变, '0');
    ok('G10 面板是追问条的最后一个（不然会把输入框挤到第三行）', G.面板在最后, JSON.stringify(G));
    ok('G11 输入框排在面板前面', G.输入框在面板前, JSON.stringify(G));

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('  ❌ ' + r.name + (r.detail ? ' → ' + r.detail : '')); else console.log('  ✅ ' + r.name); });
    console.log(bad.length ? ('\n❌ ' + bad.length + ' 条没过（共 ' + results.length + ' 条）') : ('\n✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})();
