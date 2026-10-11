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
    try { rdLsRemove('reader_qa'); localStorage.removeItem('reading_book_kind'); } catch (e) {}
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
    try { rdLsRemove('reader_qa'); localStorage.removeItem('reading_book_kind'); } catch (e) {}
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

    /* 问答的时间标记（2026-09-18 她要的）。
       ⚠️这一组里**最要紧的是「老问答不补时间」**：问答是每次从正文重新解析的，
         时间只能像模型印记那样一路继承。要是判据写松了，老条目会被盖成「今天」——
         那是假数据，比空着糟得多，而且**界面上看不出来**（时间戳长得一模一样）。 */
    const R = await page.evaluate(async () => {
        window._bootNovel();
        const out = {};
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        const msg = chatMessages[mi];
        msg.content = (msg.content || '') + '\n\n[P3] 汐：他这里好嗑\n因为他一直在硬撑啊。';
        localStorage.setItem('reading_qa_time', '0');
        readerPersistQA(mi);
        let cell = (readerQAAll()['测试小说.txt|1'] || {})[0];
        out.新问答有时间 = !!(cell.list || []).length && !!cell.list[0].t;

        // 老条目：抹掉 t 再存一次，不该被补上
        cell.list[0].t = undefined;
        let all = readerQAAll(); all['测试小说.txt|1'][0] = cell; readerQASaveAll(all);
        readerPersistQA(mi);
        cell = (readerQAAll()['测试小说.txt|1'] || {})[0];
        out.老条目不补时间 = !cell.list[0].t;

        // 开关关着：一个都不该渲染
        chatRenderAllMessages(true);
        await new Promise(r => setTimeout(r, 200));
        out.关着时个数 = document.querySelectorAll('.rd-qa-t').length;

        // 开：补回时间再开开关
        const t0 = Date.now();
        cell.list[0].t = t0;
        all = readerQAAll(); all['测试小说.txt|1'][0] = cell; readerQASaveAll(all);
        readingToggleQaTime();
        await new Promise(r => setTimeout(r, 300));
        const els = document.querySelectorAll('.rd-qa-t');
        out.开着时个数 = els.length;
        out.文字 = els.length ? els[0].textContent : '';
        out.按钮亮 = !!document.getElementById('chipQaTime').classList.contains('active');
        // ⚠️2026-09-18 她改过一回位置（跟在问题后面）；2026-10-11 又改：有回答的，时间放在**回答最后一行的右边**
        out.在问题行里 = els.length ? !!els[0].closest('.reading-q') : true;
        out.没被荧光笔底盖住 = els.length ? !els[0].closest('.reading-q-hl') : false;
        out.在回答最后一行 = els.length ? (function () {
            var p = els[0].closest('p'); if (!p || p.closest('.reading-q')) return false;
            return Math.abs(p.getBoundingClientRect().bottom - els[0].getBoundingClientRect().bottom) < 10;
        })() : false;
        out.靠右 = els.length ? (function () { var p = els[0].closest('p'); return p && Math.abs(p.getBoundingClientRect().right - els[0].getBoundingClientRect().right) < 4; })() : false;
        out.问题行HTML = els.length ? (els[0].closest('p') || els[0]).outerHTML.slice(0, 300) : '';

        // 格式：当天只给时分、隔天给日期、跨年补年份
        out.今天 = rdQaTimeFmt(t0);
        out.昨天 = rdQaTimeFmt(t0 - 864e5);
        out.去年 = rdQaTimeFmt(t0 - 400 * 864e5);
        out.坏时间 = rdQaTimeFmt(NaN);

        // 再关掉：要收干净
        readingToggleQaTime();
        await new Promise(r => setTimeout(r, 300));
        out.再关掉个数 = document.querySelectorAll('.rd-qa-t').length;
        return out;
    });

    ok('新问答存下了时间', R.新问答有时间, '');
    ok('⚠️老问答不会被补上假时间', R.老条目不补时间, '');
    eq('开关关着时一个都不显示', R.关着时个数, 0);
    eq('开关打开后显示一个', R.开着时个数, 1);
    ok('按钮跟着亮起来', R.按钮亮, '');
    eq('有回答时不在问题行里', R.在问题行里, false);
    ok('⚠️没被荧光笔底盖住（必须在 .reading-q-hl 外面）', R.没被荧光笔底盖住, R.问题行HTML);
    ok('⚠️落在回答的最后一行（10-11 她要的）', R.在回答最后一行, R.问题行HTML);
    ok('靠右边', R.靠右, R.问题行HTML);
    eq('再关掉就收干净', R.再关掉个数, 0);

    ok('当天只给时分（14:32 这种）', /^\d{2}:\d{2}$/.test(R.今天), R.今天);
    ok('隔天给日期＋时分（9/17 14:32 这种）', /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(R.昨天), R.昨天);
    ok('跨年补上年份（2025/8/14 14:32 这种）', /^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(R.去年), R.去年);
    eq('坏时间返回空串、不显示 Invalid Date', R.坏时间, '');

    ok('页面没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('  ❌ ' + r.name + '\n        → ' + (r.detail || '')); });
    if (bad.length) { console.log('\n❌ ' + bad.length + '/' + results.length + ' 条没过'); process.exit(1); }
    console.log('\n✅ 问答时间标记：' + results.length + ' 条全过');
})();
