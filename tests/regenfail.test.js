/* 「🔄 重答」：请求失败之后应该重发**失败的那一轮**，不是把上一条成功的回答删掉重来。
 * 2026-09-22 她报的坑，见 clawdRegenLast 注释。跑法：bash tests/p.sh regenfail */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(n, p, d) { results.push({ n, p: !!p, d }); }
function eq(n, g, w) { ok(n, JSON.stringify(g) === JSON.stringify(w), '实际 ' + JSON.stringify(g) + ' / 期望 ' + JSON.stringify(w)); }
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
    await page.goto(APP); await page.waitForTimeout(1200);
    const R = await page.evaluate(async () => {
        const out = {};
        window.chatStreaming = false;
        window._req = 0;
        window.chatDoRequest = function () { window._req++; };   // 只记一次调用，不真发
        window.chatRenderAllMessages = function () {};
        window.showToast = function (m) { window._toast = m; };

        // ① 上一轮答成了、这一轮失败（末尾是用户消息）→ 该从这条用户消息重发
        chatMessages = [
            { role: 'user', content: '第一问' },
            { role: 'assistant', content: '第一答' },
            { role: 'user', content: '第二问（这轮 fail 了）' },
        ];
        window._req = 0; clawdRegenLast();
        out.失败后 = { 条数: chatMessages.length, 末尾: chatMessages[chatMessages.length - 1].content, 发了: window._req };

        // ② 正常情况：末尾是 AI 回复 → 删掉它重答（老行为不变）
        chatMessages = [
            { role: 'user', content: '第一问' },
            { role: 'assistant', content: '第一答' },
        ];
        window._req = 0; clawdRegenLast();
        out.正常 = { 条数: chatMessages.length, 末尾: chatMessages[chatMessages.length - 1].content, 发了: window._req };

        // ③ 最后一条是图片 → 仍然拦下来
        chatMessages = [
            { role: 'user', content: '画一张' },
            { role: 'assistant', content: '图', genImage: true },
        ];
        window._req = 0; window._toast = ''; clawdRegenLast();
        out.图片 = { 条数: chatMessages.length, 发了: window._req, 提示: window._toast };

        // ④ 空对话
        chatMessages = []; window._req = 0; window._toast = ''; clawdRegenLast();
        out.空 = { 发了: window._req, 提示: window._toast };
        return out;
    });
    eq('失败那轮：保留用户提问、不动前面的回答', R.失败后.条数, 3);
    eq('失败那轮：末尾还是那条提问', R.失败后.末尾, '第二问（这轮 fail 了）');
    eq('失败那轮：发了一次请求', R.失败后.发了, 1);
    eq('正常重答：删掉最后那条 AI 回复', R.正常.条数, 1);
    eq('正常重答：末尾变回用户提问', R.正常.末尾, '第一问');
    eq('正常重答：发了一次请求', R.正常.发了, 1);
    eq('最后是图片：不发请求', R.图片.发了, 0);
    ok('最后是图片：给提示', /图片/.test(R.图片.提示 || ''), R.图片.提示);
    eq('空对话：不发请求', R.空.发了, 0);
    ok('空对话：给提示', /没有/.test(R.空.提示 || ''), R.空.提示);
    eq('页面无 JS 报错', errs, []);
    await browser.close();
    let f = 0;
    for (const r of results) { if (!r.p) f++; console.log((r.p ? '  ✓ ' : '  ✗ ') + r.n + (r.p ? '' : '   ← ' + (r.d || ''))); }
    console.log(f ? `\n${f} 条没过` : `\n全部 ${results.length} 条通过`);
    process.exit(f ? 1 : 0);
})();
