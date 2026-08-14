/* 「在书里往回退＝回书架」的回归测试（2026-08-14）。
 *
 * 起因：用户「我希望阅读能成为主界面，现阶段实际上阅读是依附在对话列表上的，这个很反直觉」
 * 「现在我觉得不方便的就是阅读界面左滑总是要进入对话列表」。
 * 她这个"反直觉"有实打实的根据：**阅读会话压根不在对话列表里**（id 以 reader_ 开头的
 * 会话在 chatRenderHistoryList / chatOpenMostRecent 里都被过滤掉），所以从书里退出来，
 * 落到的那个列表里连刚才那本书都找不着。
 *
 * 这组守四件事：
 *   ① 在书里左滑 / 点 ← → 回**书架**，并且落在这本书所在的**文件夹**里（不是最外层）；
 *   ② 退出去时**阅读界面要被关掉**——否则在书架上再滑一下会退回刚才那本书，绕成死圈；
 *   ③ **普通对话不受影响**，照旧退回对话列表（这是最容易被顺手改坏的一条）；
 *   ④ 「去对话列表」那个按钮只在书里露面，普通对话里不出现。
 *
 * ⚠️别把 ③ 删掉图省事：readingBookViewBookId() 只要判歪一点，普通对话就会被甩进书架，
 *   而那条路平时没人走、坏了很久都不会发现。
 *
 * 跑法：bash tests/p.sh readshelfback
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');

const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

function boot() {
    window._swipe = function (selector, x0, y0, x1, y1) {
        const el = document.querySelector(selector);
        const mk = (type, x, y) => {
            const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
            return new TouchEvent(type, {
                touches: type === 'touchend' ? [] : [t], targetTouches: [], changedTouches: [t],
                bubbles: true, cancelable: true
            });
        };
        el.dispatchEvent(mk('touchstart', x0, y0));
        el.dispatchEvent(mk('touchmove', x1, y1));
        el.dispatchEvent(mk('touchend', x1, y1));
    };
    // ⚠️造两本真书：rbRenderShelf 在「书架为空」时会把 rbCurrentFolder 重置成 null，
    //   空书架下文件夹那一层根本不存在（swipeback 那组踩过这个坑）。
    window.rbBooks = [
        { id: 'bk_t1', fileName: '测试书甲.txt', fileSize: 111, chapters: [{ title: '第一章', body: '正文甲' }], _folder: '测试文件夹' },
        { id: 'bk_t2', fileName: '测试书乙.txt', fileSize: 222, chapters: [{ title: '第一章', body: '正文乙' }], _folder: '测试文件夹' }
    ];
    /* ⚠️必须**真的存下去**，只塞内存不行：readingBackToShelf() 开头会调 rbLoad()
       从 IndexedDB 重读书单，内存里这两本会被冲掉 → 空书架 → rbRenderShelf 把
       rbCurrentFolder 重置成 null → 测出来永远停在「文件夹列表」。
       （swipeback 那组没踩到，是因为它走 rbOpenBook 那条路、不经过 rbLoad。） */
    window._booted = (typeof idbSet === 'function')
        ? idbSet('reading_books', { books: window.rbBooks }) : Promise.resolve();

    // 摆成「正在读 bk_t1」的样子
    window.enterBook = function () {
        document.getElementById('chatModalOverlay').classList.add('show');
        chatView = 'conv';
        chatStreaming = false;
        chatReaderMode = true;
        chatReadingMode = true;      // ⚠️进纯阅读时它也会被置真，故意照实模拟
        readerBookId = 'bk_t1';
        chatCurrentConvId = 'reader_bk_t1';
        if (typeof readingSyncAutoScrollUI === 'function') readingSyncAutoScrollUI();
    };

    // 摆成「一个普通对话」的样子
    window.enterPlainChat = function () {
        document.getElementById('chatModalOverlay').classList.add('show');
        chatView = 'conv';
        chatStreaming = false;
        chatReaderMode = false;
        chatReadingMode = false;
        readerBookId = null;
        chatCurrentConvId = 'conv_plain';
        if (typeof readingSyncAutoScrollUI === 'function') readingSyncAutoScrollUI();
    };

    window.snapshot = function () {
        const rb = document.getElementById('rbModal');
        return {
            书架开着: rb.classList.contains('show'),
            书架这一层: !rb.classList.contains('show') ? '关闭'
                : (document.getElementById('rbChapterView').style.display !== 'none' ? '目录'
                    : (rbCurrentFolder !== null ? '文件夹里:' + rbCurrentFolder : '文件夹列表')),
            阅读界面还开着: document.getElementById('chatModalOverlay').classList.contains('show'),
            chatView: chatView
        };
    };
}




(async () => {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(APP);
    await page.waitForTimeout(1200);
    await page.evaluate(boot);
    await page.evaluate(() => window._booted);   // 等书真的写进 IndexedDB 再开测

    // ── A 组：在书里左滑 ──────────────────────────────────────────
    let r = await page.evaluate(() => {
        enterBook();
        const before = readingBookViewBookId();
        _swipe('.chat-modal', 20, 400, 200, 400);
        return { before, after: snapshot() };
    }, );
    eq('A1 认出「在书里」', r.before, 'bk_t1');
    eq('A2 左滑 → 书架，且落在这本书的文件夹里', r.after.书架这一层, '文件夹里:测试文件夹');
    eq('A3 阅读界面已经关掉（不留在后面当背景）', r.after.阅读界面还开着, false);

    // 再滑一下应该继续往外退，而不是绕回刚才那本书
    r = await page.evaluate(() => { _swipe('#rbModal', 20, 400, 200, 400); return snapshot(); });
    eq('A4 在书架上再滑 → 文件夹列表（没绕回书里）', r.书架这一层, '文件夹列表');
    r = await page.evaluate(() => { _swipe('#rbModal', 20, 400, 200, 400); return snapshot(); });
    eq('A5 再滑一下 → 整个关掉（回工具箱主页）', [r.书架开着, r.阅读界面还开着], [false, false]);

    // ── B 组：顶栏左边那个 ← ──────────────────────────────────────
    r = await page.evaluate(() => {
        rbCloseShelf();
        enterBook();
        document.getElementById('chatBackBtn').click();
        return null;
    });
    await page.waitForTimeout(420);   // ← 键是单击/双击二选一，要等过 300ms 那道闸
    r = await page.evaluate(() => snapshot());
    eq('B1 点 ← → 也是回书架（跟左滑同语义）', r.书架这一层, '文件夹里:测试文件夹');

    // ── C 组：普通对话绝不受影响 ─────────────────────────────────
    r = await page.evaluate(() => {
        rbCloseShelf();
        enterPlainChat();
        const isBook = readingBookViewBookId();
        _swipe('.chat-modal', 20, 400, 200, 400);
        return { isBook, after: snapshot() };
    });
    eq('C1 普通对话不算「在书里」', r.isBook, null);
    eq('C2 普通对话左滑 → 仍回对话列表', r.after.chatView, 'list');
    eq('C3 普通对话左滑 → 没有弹出书架', r.after.书架开着, false);

    // ── D 组：「去对话列表」按钮的显隐 ───────────────────────────
    r = await page.evaluate(() => {
        const btn = document.getElementById('chatToListBtn');
        rbCloseShelf();
        enterBook();
        const inBook = btn.style.display !== 'none';
        enterPlainChat();
        const inPlain = btn.style.display !== 'none';
        return { inBook, inPlain, exists: !!btn };
    });
    eq('D1 按钮存在', r.exists, true);
    eq('D2 在书里 → 显示', r.inBook, true);
    eq('D3 普通对话 → 隐藏', r.inPlain, false);

    // ── E 组：全程没有 JS 报错 ───────────────────────────────────
    eq('E1 无 JS 报错', errs, []);

    await browser.close();
    let bad = 0;
    for (const t of results) {
        if (!t.pass) bad++;
        console.log((t.pass ? '  ✅ ' : '  ❌ ') + t.name + (t.pass ? '' : '  → ' + t.detail));
    }
    console.log(bad ? `❌ ${bad} 条失败` : `✅ ${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
