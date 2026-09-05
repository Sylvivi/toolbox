/* 「重新生成之后，另一台设备收不到」的回归测试。
 *
 * 起因：用户 2026-09-05 报「对话模式下，一个会话我在另一个设备让它重回了，会话条数没变，
 * 但是这个重回的会话内容不会在另一个设备同步，不过我再回一条，就会同步了」。
 *
 * 病根在 chatSaveCurrentConv：它判断「这次有没有真的改动」用的是**消息条数变没变**。
 * 而「重新生成 / 重roll / 编辑后重发」都是先把最后一条 AI 回复删掉、再补一条新的，
 * 条数一进一出正好回到原样 → 判成「没改动」→ 不更新 updated、不标 _dirty → 永不推云端。
 * 「再回一条就同步了」＝那一下条数才变，顺路把重新生成的内容一起捎上去。
 *
 * ⚠️危害不止「晚同步」：那台没收到的设备接着聊两句，会把**旧回复**推上去让云端变长，
 * 而 _chatMergeMessages 遇到分叉是「取更长的一方」——重新生成的结果会被永久覆盖。
 *
 * 这套测试钉两件必须同时成立的事：
 *   ① 条数没变但内容换了 → 必须标脏（A/E/G 组，正题）
 *   ② 消息一字未动的那些保存 → 必须**不**标脏（B/F 组，护栏）
 *      切模型、改系统提示词、拖上下文滑块也会调到 chatSaveCurrentConv，它们不该顶新
 *      时间戳去跟别的设备抢。别为了修①把判据改成「每次保存都标脏」。
 *
 * 跑法：node tests/regensync.test.js   或   bash tests/p.sh regensync
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

/* 造一条「已经同步干净」的对话：updated 停在很久以前的 T0、_dirty=false。
 * 然后把 chatMessages 换成待保存的那份，调 chatSaveCurrentConv，看它标不标脏。
 * 落盘走真实的 chatSetHistory/chatGetHistory，只把推云端换成记账用的假货（不联网）。 */
function boot() {
    const T0 = 1000000;
    window._T0 = T0;
    window._pushes = 0;
    window.chatScheduleSyncPush = function () { window._pushes++; };
    window._setup = function (convMsgs, curMsgs) {
        chatSetHistory([{
            id: 'c_regen', title: '测试对话', messages: convMsgs,
            created: T0, updated: T0, _dirty: false, aiTitle: true
        }]);
        window.chatCurrentConvId = 'c_regen';
        window.chatMessages = curMsgs;
        window._pushes = 0;
    };
    window._readBack = function () {
        const l = chatGetHistory().filter(c => c.id === 'c_regen')[0];
        const last = l.messages[l.messages.length - 1];
        return {
            标脏: !!l._dirty,
            时间顶新: (l.updated || 0) > T0,
            存进去的末条: typeof last.content === 'string' ? last.content : JSON.stringify(last.content),
            存进去的条数: l.messages.length,
            model: l.model
        };
    };
}

const U1 = { role: 'user', content: '帮我写个开头', ts: 1 };
const A_OLD = { role: 'assistant', content: '旧回复：从前有座山。', ts: 2 };
const A_NEW = { role: 'assistant', content: '新回复：那年冬天特别冷。', ts: 3 };

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: '(' + boot + ')();' });

    /* ── A 组：重新生成（条数不变、最后一条换了内容）── 正题 ─────────────── */
    const A = await page.evaluate(() => {
        const U1 = { role: 'user', content: '帮我写个开头', ts: 1 };
        _setup([U1, { role: 'assistant', content: '旧回复：从前有座山。', ts: 2 }],
               [U1, { role: 'assistant', content: '新回复：那年冬天特别冷。', ts: 3 }]);
        chatSaveCurrentConv();
        return Object.assign(_readBack(), { 推了几次: window._pushes });
    });
    ok('A1 重新生成后标脏（这是修的正题）', A.标脏, JSON.stringify(A));
    ok('A2 updated 被顶新（别的设备靠它判断要不要拉）', A.时间顶新, JSON.stringify(A));
    eq('A3 新回复真的存进去了', A.存进去的末条, '新回复：那年冬天特别冷。');
    eq('A4 条数一条没多一条没少', A.存进去的条数, 2);
    ok('A5 排了一次推送', A.推了几次 === 1, JSON.stringify(A));

    /* ── B 组：消息一字未动 ── 护栏，不许误标脏 ──────────────────────────── */
    const B = await page.evaluate(() => {
        const U1 = { role: 'user', content: '帮我写个开头', ts: 1 };
        const A1 = { role: 'assistant', content: '旧回复：从前有座山。', ts: 2 };
        // 新数组、同内容——模拟「切了个模型/改了系统提示词」触发的保存
        _setup([U1, A1], [JSON.parse(JSON.stringify(U1)), JSON.parse(JSON.stringify(A1))]);
        window.chatSelectedModel = 'claude-换了一个';
        chatSaveCurrentConv();
        return _readBack();
    });
    ok('B1 消息没变就不标脏', B.标脏 === false, JSON.stringify(B));
    ok('B2 updated 保持原样（不去跟别的设备抢时间戳）', B.时间顶新 === false, JSON.stringify(B));
    eq('B3 但设置照旧存下来了（不标脏≠不存）', B.model, 'claude-换了一个');

    /* ── C 组：正常追加消息 ── 老行为不许回归 ────────────────────────────── */
    const C = await page.evaluate(() => {
        const U1 = { role: 'user', content: '帮我写个开头', ts: 1 };
        const A1 = { role: 'assistant', content: '旧回复：从前有座山。', ts: 2 };
        _setup([U1, A1], [U1, A1, { role: 'user', content: '再来一段', ts: 4 }, { role: 'assistant', content: '好的。', ts: 5 }]);
        chatSaveCurrentConv();
        return _readBack();
    });
    ok('C1 追加消息照旧标脏', C.标脏, JSON.stringify(C));
    eq('C2 四条都在', C.存进去的条数, 4);

    /* ── D 组：forceDirty 仍然管用（追加评论那类调用靠它）─────────────────── */
    const D = await page.evaluate(() => {
        const U1 = { role: 'user', content: '帮我写个开头', ts: 1 };
        const A1 = { role: 'assistant', content: '旧回复：从前有座山。', ts: 2 };
        _setup([U1, A1], [JSON.parse(JSON.stringify(U1)), JSON.parse(JSON.stringify(A1))]);
        chatSaveCurrentConv(true);
        return _readBack();
    });
    ok('D1 forceDirty=true 时照标不误', D.标脏, JSON.stringify(D));

    /* ── E 组：编辑最后一条消息后重发（条数同样不变）───────────────────── */
    const E = await page.evaluate(() => {
        const U1 = { role: 'user', content: '帮我写个开头', ts: 1 };
        const A1 = { role: 'assistant', content: '旧回复：从前有座山。', ts: 2 };
        _setup([U1, A1, { role: 'user', content: '改错字前', ts: 4 }],
               [U1, A1, { role: 'user', content: '改错字后', ts: 4 }]);
        chatSaveCurrentConv();
        return _readBack();
    });
    ok('E1 编辑最后一条用户消息也标脏', E.标脏, JSON.stringify(E));
    eq('E2 改后的内容存进去了', E.存进去的末条, '改错字后');

    /* ── F 组：连续两次保存 ── 第二次没新改动就不该再顶时间 ───────────────── */
    const F = await page.evaluate(() => {
        const U1 = { role: 'user', content: '帮我写个开头', ts: 1 };
        _setup([U1, { role: 'assistant', content: '旧回复：从前有座山。', ts: 2 }],
               [U1, { role: 'assistant', content: '新回复：那年冬天特别冷。', ts: 3 }]);
        chatSaveCurrentConv();                       // 第一次：重新生成，标脏
        const first = chatGetHistory().filter(c => c.id === 'c_regen')[0].updated;
        chatGetHistory().filter(c => c.id === 'c_regen')[0]._dirty = false;  // 假装推成功了
        chatSaveCurrentConv();                       // 第二次：什么都没改
        const l = chatGetHistory().filter(c => c.id === 'c_regen')[0];
        return { 又标脏了: !!l._dirty, 时间又变了: (l.updated || 0) !== first };
    });
    ok('F1 第二次保存没新改动 → 不再标脏', F.又标脏了 === false, JSON.stringify(F));
    ok('F2 第二次保存也不再顶时间戳', F.时间又变了 === false, JSON.stringify(F));

    /* ── G 组：图片/文件消息（content 是数组，不是字符串）也要认得出变化 ──── */
    const G = await page.evaluate(() => {
        const U1 = { role: 'user', content: [{ type: 'text', text: '看这张图' }, { type: 'image_url', image_url: { url: 'x' } }], ts: 1 };
        _setup([U1, { role: 'assistant', content: [{ type: 'text', text: '旧的看图回复' }], ts: 2 }],
               [U1, { role: 'assistant', content: [{ type: 'text', text: '新的看图回复' }], ts: 3 }]);
        chatSaveCurrentConv();
        return _readBack();
    });
    ok('G1 数组型内容变化也标脏（_chatMsgSig 会 JSON 化）', G.标脏, JSON.stringify(G));

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('  ❌ ' + r.name + (r.detail ? ' → ' + r.detail : '')); else console.log('  ✅ ' + r.name); });
    console.log(bad.length ? ('\n❌ ' + bad.length + ' 条没过（共 ' + results.length + ' 条）') : ('\n✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})();
