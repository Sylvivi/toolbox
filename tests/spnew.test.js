/* 「＋新建预设」回归测试。
 *
 * 起因：她 2026-08-20 报「每次在那边点新增，我还没输入呢，它居然直接保存当下的提示，
 * 我觉得点新建后，应该出现文本框，然后我输入提示词，接下来才可以保存呢」。
 *
 * 旧逻辑两个入口（chips 的＋新建、管理面板底部的＋新建预设）都是读 #chatSysPrompt 的
 * 现有内容直接去命名保存——她刚套用过别的预设时，框里躺的是别人的内容，一点就又存一遍。
 *
 * ⚠️本文件钉住的是三件一碰就坏的事：
 *   ① 提示词框里**有内容**时点＋新建，新建窗必须是**空的**（这就是她报的那个 bug）。
 *   ② 新建窗**全程不许动 #chatSysPrompt**——那是当前会话正在生效的提示词，
 *      保存/取消/带入都不能改它，否则她正聊着的天会被打断。
 *   ③ 保存后**不设 chatActivePresetIdx**：新内容不在提示词框里，高亮成「当前套用」
 *      就会跟框里实际内容对不上。
 *
 * 跑法：node tests/spnew.test.js
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

    /* ===== A 组：她报的那个 bug —— 框里有内容也不许带进新建窗 ===== */
    const A = await page.evaluate(() => {
        localStorage.setItem('chat_sp_presets', JSON.stringify([{ name: '旧的', content: '旧的内容' }]));
        // 模拟「刚套用过别的预设」：框里躺着不是她这次要写的东西
        document.getElementById('chatSysPrompt').value = '这是套用别的预设留下的内容';
        chatNewSpPresetFromBar();
        return {
            open: document.getElementById('chatSpNewMask').classList.contains('show'),
            content: document.getElementById('chatSpNewContent').value,
            name: document.getElementById('chatSpNewName').value,
            sys: document.getElementById('chatSysPrompt').value,
        };
    });
    ok('A1 点＋新建会弹出新建窗', A.open === true);
    ok('A2 ⚠️框里有内容时，新建窗的内容框仍是空的', A.content === '', JSON.stringify(A.content));
    ok('A3 名字框也是空的', A.name === '');
    ok('A4 开窗不改动当前提示词框', A.sys === '这是套用别的预设留下的内容', A.sys);

    /* ===== B 组：内容/名字没写全不许保存 ===== */
    const B = await page.evaluate(() => {
        var before = chatGetSpPresets().length;
        chatSpNewConfirm();                       // 全空
        var n1 = chatGetSpPresets().length;
        document.getElementById('chatSpNewContent').value = '只写了内容';
        chatSpNewConfirm();                       // 缺名字
        var n2 = chatGetSpPresets().length;
        return { before: before, n1: n1, n2: n2, stillOpen: document.getElementById('chatSpNewMask').classList.contains('show') };
    });
    ok('B1 全空时不保存', B.n1 === B.before, B.n1 + ' vs ' + B.before);
    ok('B2 只有内容没名字时不保存', B.n2 === B.before, B.n2 + ' vs ' + B.before);
    ok('B3 没保存成时窗还开着（不会把她写的字弄丢）', B.stillOpen === true);

    /* ===== C 组：写全了才存得进去，且不碰当前会话 ===== */
    const C = await page.evaluate(() => {
        document.getElementById('chatSpNewName').value = '新人设';
        document.getElementById('chatSpNewContent').value = '我自己写的提示词';
        var activeBefore = chatActivePresetIdx;
        chatSpNewConfirm();
        var ps = chatGetSpPresets();
        return {
            last: ps[ps.length - 1],
            count: ps.length,
            closed: !document.getElementById('chatSpNewMask').classList.contains('show'),
            sys: document.getElementById('chatSysPrompt').value,
            activeBefore: activeBefore,
            activeAfter: chatActivePresetIdx,
            chips: document.getElementById('chatSpBar').textContent,
        };
    });
    ok('C1 存进去的是新建窗里写的内容', C.last && C.last.content === '我自己写的提示词', JSON.stringify(C.last));
    ok('C2 名字也对', C.last && C.last.name === '新人设');
    ok('C3 存完窗自动关掉', C.closed === true);
    ok('C4 ⚠️存完当前提示词框一个字没变', C.sys === '这是套用别的预设留下的内容', C.sys);
    ok('C5 ⚠️不把新预设设成「当前套用」', C.activeAfter === C.activeBefore, C.activeBefore + ' → ' + C.activeAfter);
    ok('C6 chips 上出现了新预设', C.chips.indexOf('新人设') >= 0, C.chips);

    /* ===== D 组：「带入当前提示词框内容」是拷贝，不是引用 ===== */
    const D = await page.evaluate(() => {
        chatOpenSpNew();
        chatSpNewPull();
        var pulled = document.getElementById('chatSpNewContent').value;
        // 改新建窗里的，不该反向影响提示词框
        document.getElementById('chatSpNewContent').value = pulled + '（我又加了一句）';
        return { pulled: pulled, sys: document.getElementById('chatSysPrompt').value };
    });
    ok('D1 带入能把当前内容拷进来', D.pulled === '这是套用别的预设留下的内容', D.pulled);
    ok('D2 带入后再改新建窗，不反向污染提示词框', D.sys === '这是套用别的预设留下的内容', D.sys);

    /* ===== E 组：取消不留痕 ===== */
    const E = await page.evaluate(() => {
        var before = chatGetSpPresets().length;
        chatSpNewCancel();
        return {
            closed: !document.getElementById('chatSpNewMask').classList.contains('show'),
            count: chatGetSpPresets().length, before: before,
            sys: document.getElementById('chatSysPrompt').value,
        };
    });
    ok('E1 取消把窗关掉', E.closed === true);
    ok('E2 取消不新增预设', E.count === E.before);
    ok('E3 取消不动当前提示词框', E.sys === '这是套用别的预设留下的内容', E.sys);

    /* ===== F 组：管理面板那个入口走的是同一套 ===== */
    const F = await page.evaluate(() => {
        document.getElementById('chatSysPrompt').value = '框里还是有东西的';
        chatOpenSpManager();
        chatNewSpPreset();
        return {
            mgrClosed: !document.getElementById('chatSpManagerMask').classList.contains('show'),
            newOpen: document.getElementById('chatSpNewMask').classList.contains('show'),
            content: document.getElementById('chatSpNewContent').value,
        };
    });
    ok('F1 管理面板的＋新建会先关掉管理面板', F.mgrClosed === true);
    ok('F2 它开的是同一个新建窗', F.newOpen === true);
    ok('F3 ⚠️这个入口同样不带入框里的内容', F.content === '', JSON.stringify(F.content));

    ok('G1 全程无 JS 报错', pageErrs.length === 0, pageErrs.join(' / '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('❌ ' + r.name + (r.detail ? '  →  ' + r.detail : '')); });
    console.log(bad.length ? ('❌ ' + bad.length + ' 条失败（共 ' + results.length + ' 条）') : ('✅ 全过（' + results.length + ' 条）'));
    process.exit(bad.length ? 1 : 0);
})();
