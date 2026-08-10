/* 长按主页搜索键 → 打开哪个窗口（chatOpenMostRecent）。
 *
 * 用户 2026-08-10 定的规则：**只要读过书，就一律回书**，别管对话有多新。
 * 她的原话：「我偶尔会聊对话，然后有时候对话就变成默认打开的窗口了，
 *   其实我是希望能够打开阅读的，对话那边就不用管了，因为那个用得还是少一点」。
 * 改之前是拿阅读会话和对话比 updated、谁新进谁——聊两句天就把入口抢走了。
 *
 * ⚠️例外只有一个：**从没读过书**（或那本书已删/换设备没同步过来）才走「最近的对话」，
 *   这条不能删——这 app 她朋友也在用，别把只聊天的人硬塞进书架。
 *
 * 跑法：node tests/openrecent.test.js   或   bash tests/p.sh openrecent
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

    const R = await page.evaluate(async () => {
        const out = {};
        // 把「打开了什么」记下来，不真跳转
        const calls = [];
        const realResume = window.readerResumeLast, realLoad = window.chatLoadConv,
              realNew = window.chatNewConv, realEnter = window.readerEnter;
        window.readerResumeLast = function () { calls.push('回书'); };
        window.chatLoadConv = function (id) { calls.push('开对话:' + id); };
        window.chatNewConv = function () { calls.push('新对话'); };
        window.readerEnter = function () { calls.push('开书架'); };

        // 造数据：一本书 + 一条**更新的**普通对话 + 一条较旧的阅读会话
        const book = { id: 'bk_test1', name: '测试书', chapters: [{ title: '第一章', text: '正文' }] };
        idbSet('reading_books', { books: [book] });
        if (typeof rbLoad === 'function') rbLoad();
        const now = Date.now();
        const hist = [
            { id: 'reader_bk_test1', title: '测试书', updated: now - 100000 },   // 读书是很久以前
            { id: 'c_chat1', title: '随便聊聊', updated: now }                    // 对话是刚刚
        ];
        const realHist = window.chatGetHistory;
        window.chatGetHistory = function () { return hist; };

        // ① 读过书 + 对话更新 → 仍然回书
        localStorage.setItem('reader_last_book', 'bk_test1');
        calls.length = 0; chatOpenMostRecent();
        out.A_对话更新也回书 = calls.join(',');

        // ② 反过来（读书更新）当然也回书
        hist[0].updated = now; hist[1].updated = now - 100000;
        calls.length = 0; chatOpenMostRecent();
        out.B_读书更新也回书 = calls.join(',');

        // ③ 从没读过书 → 照旧开最近的对话
        localStorage.removeItem('reader_last_book');
        calls.length = 0; chatOpenMostRecent();
        out.C_没读过书开对话 = calls.join(',');

        // ④ 记着一本已经不存在的书（删了/换设备没同步）→ 不许卡住，退回对话
        localStorage.setItem('reader_last_book', 'bk_不存在');
        calls.length = 0; chatOpenMostRecent();
        out.D_书没了退回对话 = calls.join(',');

        // ⑤ 既没读过书、也一条对话都没有 → 开个新对话
        window.chatGetHistory = function () { return []; };
        localStorage.removeItem('reader_last_book');
        calls.length = 0; chatOpenMostRecent();
        out.E_全空开新对话 = calls.join(',');

        window.chatGetHistory = realHist;
        window.readerResumeLast = realResume; window.chatLoadConv = realLoad;
        window.chatNewConv = realNew; window.readerEnter = realEnter;
        localStorage.removeItem('reader_last_book');
        return out;
    });

    ok('A ⚠️对话比读书新，长按仍然回书（这条是本次改动的重点）', R.A_对话更新也回书 === '回书', R.A_对话更新也回书);
    ok('B 读书比对话新时当然也回书', R.B_读书更新也回书 === '回书', R.B_读书更新也回书);
    ok('C ⚠️从没读过书的人照旧开最近对话（别把只聊天的人塞进书架）', R.C_没读过书开对话 === '开对话:c_chat1', R.C_没读过书开对话);
    ok('D 记着的那本书已不存在 → 退回对话，不卡住', R.D_书没了退回对话 === '开对话:c_chat1', R.D_书没了退回对话);
    ok('E 什么都没有 → 开新对话', R.E_全空开新对话 === '新对话', R.E_全空开新对话);
    ok('F 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 长按搜索键开哪个窗口：${bad}/${results.length} 条失败` : `\n✅ 长按搜索键开哪个窗口：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
