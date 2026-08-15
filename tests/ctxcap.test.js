/* 「发送最近 N 轮」＝不带记忆档 的回归测试。
 *
 * 起因：用户 2026-08-15 说「我让它执行翻译任务，不需要摘要，只需要少量或者完全不需要上下文，
 * 让系统提示词发挥作用即可」。滑块 chatCtxRange 本来就在代码里，只是被 display:none 藏着，
 * 而且藏着的那版**只限制发几条，不阻止摘要**——摘要照跑照花钱、还会被塞回请求。
 *
 * 这次把它放出来并与压缩联动：chatCtxCapped() 为真时 ①不触发压缩 ②旧摘要不进请求 ③界面置灰。
 * ⚠️封顶只作用于普通对话模式：共读按「章」压、翻译模式固定 10 条压，都不能被这个滑块掐断。
 *
 * 跑法：node tests/ctxcap.test.js
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

    /* ===== A 组：chatCtxCapped 的判定 ===== */
    const A = await page.evaluate(() => {
        const out = {};
        chatReadingMode = false; chatTranslateMode = false;
        chatContextMax = 0; out.zero = chatCtxCapped();
        chatContextMax = 1; out.one = chatCtxCapped();
        chatContextMax = 5; out.five = chatCtxCapped();
        chatReadingMode = true; out.reading = chatCtxCapped();
        chatReadingMode = false; chatTranslateMode = true; out.translate = chatCtxCapped();
        chatTranslateMode = false; chatContextMax = 0;
        return out;
    });
    ok('A1 全部（0）不算封顶', A.zero === false);
    ok('A2 1 轮算封顶', A.one === true);
    ok('A3 5 轮算封顶', A.five === true);
    ok('A4 共读模式不受滑块影响', A.reading === false);
    ok('A5 翻译模式不受滑块影响', A.translate === false);

    /* ===== B 组：封顶时压缩不跑（这是省钱那一条，最要紧） ===== */
    const B = await page.evaluate(async () => {
        // 造一段超过默认触发值（40）的假对话，正常情况下必然会触发压缩
        chatReadingMode = false; chatTranslateMode = false;
        chatStreaming = false; chatCompressing = false;
        chatCompressedCount = 0; chatCompressSummaries = []; chatCompressSegEnds = [];
        chatMessages = [];
        for (let i = 0; i < 60; i++) chatMessages.push({ role: i % 2 ? 'assistant' : 'user', content: '第' + i + '句' });

        // 拦住真正的网络调用：压缩一旦往下走就会调 chatStreamChat，记一笔并返回假摘要
        const realStream = window.chatStreamChat;
        let called = 0;
        window.chatStreamChat = async function () { called++; return '假摘要'; };
        // 空白页没配任何中转站，压缩会在「取模型」那步就 return——那样 B2 测的是缺密钥、不是滑块。
        // 这里假装配好了一个站点和模型，让它能真正往下走到发请求。
        const realGetKey = window.getKeyItemById;
        window.getKeyItemById = function () { return { id: 'x', url: 'https://example.com/v1', key: 'sk-test' }; };
        chatSelectedModel = 'test-model';

        chatContextMax = 1;
        await chatCompressContext();
        const cappedCalls = called;

        chatContextMax = 0;
        await chatCompressContext();
        const freeCalls = called;

        window.chatStreamChat = realStream;
        window.getKeyItemById = realGetKey;
        chatSelectedModel = '';
        chatContextMax = 0; chatMessages = []; chatCompressedCount = 0; chatCompressSummaries = [];
        return { cappedCalls, freeCalls };
    });
    ok('B1 封顶时压缩一次都不调（不花摘要的钱）', B.cappedCalls === 0, '调用 ' + B.cappedCalls + ' 次');
    // 反证：同样这段对话在不封顶时确实会走到调用，说明 B1 不是因为压缩本来就没触发
    ok('B2 不封顶时确实会压缩（证明 B1 是滑块拦下的）', B.freeCalls > 0, '调用 ' + B.freeCalls + ' 次');

    /* ===== C 组：界面联动——她问过「我需要把上下文压缩关了吗」，答案要写在界面上 ===== */
    const C = await page.evaluate(() => {
        chatReadingMode = false; chatTranslateMode = false;
        const note = document.getElementById('compressLockNote');
        const row = document.getElementById('compressToggleRow');
        const hint = document.getElementById('chatCtxHint');

        chatContextMax = 0; chatCtxSyncHint();
        const free = { note: note.style.display, dim: row.style.opacity, hint: hint.textContent };

        chatContextMax = 1; chatCtxSyncHint();
        const capped = { note: note.style.display, dim: row.style.opacity, hint: hint.textContent };

        chatContextMax = 0; chatCtxSyncHint();
        return { free, capped, label1: chatCtxLabelText(1), label0: chatCtxLabelText(0), label5: chatCtxLabelText(5) };
    });
    ok('C1 不封顶时不置灰、不显示说明', C.free.note === 'none' && !C.free.dim);
    ok('C2 封顶时压缩行置灰', C.capped.dim === '0.4', C.capped.dim);
    ok('C3 封顶时显示「不用去关」的说明', C.capped.note !== 'none' && C.capped.dim === '0.4');
    ok('C4 提示文案跟着档位变', C.free.hint !== C.capped.hint && /只发你刚打的这一句/.test(C.capped.hint), C.capped.hint);
    ok('C5 滑块标签：0=全部 / 1=只发这句 / 5=5 轮',
        C.label0 === '全部' && C.label1 === '只发这句' && C.label5 === '5 轮',
        [C.label0, C.label1, C.label5].join(' | '));

    /* ===== D 组：滑块和开关都在折叠里，没有多出裸露的一块（她说「突兀不和谐」） ===== */
    const D = await page.evaluate(() => {
        const sec = document.getElementById('compressFoldSection');
        return {
            rangeInFold: sec.contains(document.getElementById('chatCtxRange')),
            toggleInFold: sec.contains(document.getElementById('compressToggle')),
            foldTitle: document.getElementById('compressFold').textContent.trim().slice(0, 3),
        };
    });
    ok('D1 「发送最近」收在折叠里', D.rangeInFold === true);
    ok('D2 压缩开关还在同一个折叠里', D.toggleInFold === true);
    ok('D3 折叠标题已改成「上下文」', D.foldTitle === '上下文', D.foldTitle);

    ok('E1 全程无 JS 报错', pageErrs.length === 0, pageErrs.join(' / '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('❌ ' + r.name + (r.detail ? '  →  ' + r.detail : '')); });
    console.log(bad.length ? ('❌ ' + bad.length + ' 条失败（共 ' + results.length + ' 条）') : ('✅ 全过（' + results.length + ' 条）'));
    process.exit(bad.length ? 1 : 0);
})();
