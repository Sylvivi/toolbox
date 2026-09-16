/* 「标背景」回归测试 —— 每次改动 index.html 之后跑一遍。
 *
 * 为什么有这个文件：这个功能两天里返工了七八轮，而且**每一轮都是用户在手机上
 * 真金白银用出来的**（模型请求照发、额度照扣，却什么都没插进正文）。这里把每
 * 个踩过的坑钉成一条断言，改坏了当场红，不用再让用户当小白鼠。
 *
 * 跑法：bash tests/run.sh     （不用装任何东西，run.sh 会找 playwright）
 * 全过 → 退出码 0；有一条挂 → 打印 ✗ 和实际值，退出码 1。
 *
 * 原则：所有模型请求都是**假的**（stub 掉 chatStreamChat），不联网、不花钱。
 */
const { chromium } = require('playwright');

const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html') ;
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

/* 造一本测试书并进入阅读界面。社科书用长段落（rbLineIsHead 要 40 字以上才认正文）。*/
function bootNovel() {
    const body = [];
    for (let i = 1; i <= 12; i++) body.push('这是第' + i + '段正文。');
    const book = { id: 'bk_t', fileName: '测试小说.txt', fileSize: 1, chapters: [{ title: '第一章', body: body.join('\n') }] };
    window.rbBooks = [book];
    window.rbGetBook = function (id) { return id === 'bk_t' ? book : null; };
    window.chatResolveCompressModel = function () { return { model: 'scan', baseUrl: 'https://a.com/v1', apiKey: 'k' }; };
    window.chatResolveReadingModel = function () { return { model: 'main', baseUrl: 'https://b.com/v1', apiKey: 'k' }; };
    window.getKeyItemById = function () { return { id: 'p1', url: 'https://b.com/v1', key: 'k' }; };
    window.chatSelectedModel = 'main';
    try { localStorage.removeItem('reader_qa'); localStorage.removeItem('reading_book_kind'); } catch (e) {}
    document.getElementById('chatModalOverlay').classList.add('show');
    readerBookId = 'bk_t'; readerChapterIdx = 0; chatReaderMode = true; chatReadingMode = true;
    chatCurrentConvId = 'reader_bk_t';
    chatMessages = readerChapterPair(book.chapters[0], 0);
    chatRenderAllMessages(false);
    window._toasts = [];
    if (!window._origToast) window._origToast = window.showToast;
    window.showToast = function (m, s) { window._toasts.push(m); return window._origToast(m, s); };
    return book;
}

/* 社科书：两个小标题 + 长正文，用来测「按小节标」和目录段号。*/
function bootSocial() {
    const para = function (s) { return s + '，这里是一段足够长的正文内容用来充当社科书的段落，需要超过四十个汉字才会被判定为正文长段。'; };
    const L = [para('导语一'), para('导语二')];
    L.push('自我辩护的代价'); for (var i = 0; i < 8; i++) L.push(para('甲' + i));
    L.push('认知失调理论');   for (var j = 0; j < 8; j++) L.push(para('乙' + j));
    const book = { id: 'bk_s', fileName: '社会性动物.txt', fileSize: 1, chapters: [{ title: '第五章 自我辩护', body: L.join('\n') }] };
    window.rbBooks = [book];
    window.rbGetBook = function () { return book; };
    window._rbHeadsCache = {};
    window.chatResolveCompressModel = function () { return { model: 'scan', baseUrl: 'https://a.com/v1', apiKey: 'k' }; };
    window.chatResolveReadingModel = function () { return { model: 'main', baseUrl: 'https://b.com/v1', apiKey: 'k' }; };
    window.getKeyItemById = function () { return { id: 'p1', url: 'https://b.com/v1', key: 'k' }; };
    window.chatSelectedModel = 'main';
    try { localStorage.removeItem('reader_qa'); localStorage.removeItem('reading_book_kind'); } catch (e) {}
    rbSetBookKind(book.fileName + '|' + book.fileSize, 'social');   // 两级目录只对社科书展开
    document.getElementById('chatModalOverlay').classList.add('show');
    readerBookId = 'bk_s'; readerChapterIdx = 0; chatReaderMode = true; chatReadingMode = true;
    chatCurrentConvId = 'reader_bk_s';
    chatMessages = readerChapterPair(book.chapters[0], 0);
    chatRenderAllMessages(false);
    window._toasts = [];
    if (!window._origToast) window._origToast = window.showToast;
    window.showToast = function (m, s) { window._toasts.push(m); return window._origToast(m, s); };
    return book;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._bootNovel=' + bootNovel + ';window._bootSocial=' + bootSocial + ';' });

    /* 小说导读两档（2026-09-16）。这一组**唯一的重点是防剧透**：
       读前那档发出去的正文里，绝不能出现最后那一段。 */
    const R = await page.evaluate(async () => {
        window._bootNovel();
        const sent = [];
        window.fetch = function (url, opt) {
            try { sent.push(JSON.parse(opt.body)); } catch (e) { sent.push({ _bad: String(e) }); }
            // 最小可用的 SSE 回应，让流式那条路能正常收尾、不抛异常
            const chunks = ['data: {"choices":[{"delta":{"content":"好"}}]}\n\n', 'data: [DONE]\n\n'];
            let i = 0;
            return Promise.resolve({
                ok: true, status: 200,
                headers: { get: () => 'text/event-stream' },
                body: { getReader: () => ({
                    read: () => Promise.resolve(i < chunks.length
                        ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
                        : { done: true, value: undefined }),
                    cancel: () => Promise.resolve(), releaseLock: () => {} }) },
                json: () => Promise.resolve({ choices: [{ message: { content: '好' } }] }),
                text: () => Promise.resolve('好')
            });
        };
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        const grab = async (kind) => {
            sent.length = 0;
            readingClearActbar();
            readingOnParaClick(document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="3"]'));
            const bar = document.querySelector('.reading-actbar');
            readingAskOne(mi, 3, '导读', bar, { guide: true, guideKind: kind });
            await new Promise(r => setTimeout(r, 900));
            const b = sent[0] || {};
            // 导读块最后落在哪一段（读前该归章首、读完该归章末）——从存下来的问答里看
            let 落点 = null;
            try {
                const qa = JSON.parse(localStorage.getItem('reader_qa') || '{}');
                const cell = qa['测试小说.txt|1'] && qa['测试小说.txt|1'][0];
                const hit = (cell && cell.list || []).filter(x => /^导读·/.test(x.q || ''));
                落点 = hit.length ? hit[hit.length - 1].p : null;
            } catch (e) { 落点 = 'err:' + e; }
            const msgs = b.messages || [];
            const sys = msgs.filter(m => m.role === 'system').map(m => m.content).join('\n');
            const usr = msgs.filter(m => m.role === 'user').map(m => m.content).join('\n');
            return { sys, usr, 落点, 发了几次: sent.length };
        };
        const pre = await grab('pre');
        const post = await grab('post');
        // 选单本身
        readingClearActbar();
        readingOnParaClick(document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="3"]'));
        const bar = document.querySelector('.reading-actbar');
        const sendBtn = bar.querySelector('.rp-ask-send');
        const 标签 = sendBtn.textContent;
        sendBtn.click();
        await new Promise(r => setTimeout(r, 30));
        const pick = bar.querySelector('.rp-guide-pick');
        readingClearActbar();
        return { pre, post, 标签,
            选单档位: pick ? [].map.call(pick.querySelectorAll('button'), b => b.getAttribute('data-k')) : [],
            选单文字: pick ? [].map.call(pick.querySelectorAll('button'), b => b.textContent.trim()) : [] };
    });

    // ── 防剧透：读前那档看不见最后一段 ───────────────────────────
    ok('读前：正文里没有最后一段（第12段）', !/这是第12段正文/.test(R.pre.usr), R.pre.usr.slice(-160));
    ok('读前：倒数第二段还在（只砍尾巴、没砍开头）', /这是第11段正文/.test(R.pre.usr), '');
    ok('读前：开头第1段在', /这是第1段正文/.test(R.pre.usr), '');
    ok('读前：中段第6段在（不是"只给开头"那种截断）', /这是第6段正文/.test(R.pre.usr), '');
    ok('读前：告诉模型结尾是故意没给的', /结尾我故意没给你/.test(R.pre.usr), R.pre.usr.slice(0, 200));
    ok('读前：末尾再钉一遍防剧透', /不许提这一篇的情节、转折和结局/.test(R.pre.usr), R.pre.usr.slice(-200));
    ok('读前：系统提示词里是读前那一档', /读前导读·入场须知/.test(R.pre.sys), R.pre.sys.slice(0, 120));
    ok('读前：挡住了「我看到的部分到此为止」这类反应', /不要提这一点/.test(R.pre.sys), '');

    // ── 读完那档：整篇都要给 ─────────────────────────────────────
    ok('读完：最后一段在', /这是第12段正文/.test(R.post.usr), R.post.usr.slice(-160));
    ok('读完：第1段也在', /这是第1段正文/.test(R.post.usr), '');
    ok('读完：系统提示词里是读后那一档', /读后导读·回味/.test(R.post.sys), R.post.sys.slice(0, 120));
    ok('读完：明说可以谈结局', /情节和结局可以放心谈/.test(R.post.usr), R.post.usr.slice(-160));
    ok('读完：没有那句「结尾故意没给」', !/结尾我故意没给你/.test(R.post.usr), '');

    // ── 两档都走小说人设，不是社科人设 ──────────────────────────
    ok('读前用的是读小说那套人设、不是社科人设', !/SOCIAL/.test(R.pre.sys) && R.pre.sys.length > 50, String(R.pre.sys.length));

    // ── 入口 ────────────────────────────────────────────────────
    eq('小说空态按钮叫「导读」（跟社科书一样）', R.标签, '导读');
    eq('点一下先弹两档选单', R.选单档位, ['pre', 'post']);
    // ⚠️她 2026-09-16 要的：读前别卡在她点的那一段中间
    eq('读前挂在章首第 1 段（不是她点的第 3 段）', R.pre.落点, 1);
    // 章节第 1 行是标题，所以正文 12 段对应到 P2…P13：读前落在标题底下、读完落在最后一段
    eq('读完挂在章末最后一段（P13）', R.post.落点, 13);
    eq('选单只剩两个字，不带副标题', R.选单文字, ['读前', '读完']);

    ok('页面没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('  ❌ ' + r.name + '\n        → ' + (r.detail || '')); });
    if (bad.length) { console.log('\n❌ ' + bad.length + '/' + results.length + ' 条没过'); process.exit(1); }
    console.log('\n✅ 小说导读：' + results.length + ' 条全过');
})();
