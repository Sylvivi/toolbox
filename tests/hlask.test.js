/* 划线上点「问」（11-06 岚）：她「对一个段落中的某一句话或者某几句话有疑问……只能复制下来，然后双击段落，粘贴」。
 * 先划线 → 点划线 → 小条上「问」→ 框开在段落下面 → 发出去的问题带「划的句子」→ 回答块开头一行灰字是那几句、问题行里不重复。
 * 模型请求全是假的，不联网、不花钱。
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

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._bootNovel=' + bootNovel + ';' });
    const R = await page.evaluate(async () => {
        window._bootNovel();
        const sent = [];
        window.fetch = function (url, opt) {
            try { sent.push(JSON.parse(opt.body)); } catch (e) {}
            const chunks = ['data: {"choices":[{"delta":{"content":"因为这句在铺垫。"}}]}\n\n', 'data: [DONE]\n\n'];
            let i = 0;
            return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'text/event-stream' },
                body: { getReader: () => ({
                    read: () => Promise.resolve(i < chunks.length
                        ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true }),
                    cancel: () => Promise.resolve(), releaseLock: () => {} }) },
                json: () => Promise.resolve({ choices: [{ message: { content: '因为这句在铺垫。' } }] }),
                text: () => Promise.resolve('x') });
        };
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        const P = () => document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="6"]');
        _rdHlPending = { msgIdx: mi, pNum: 6, start: 0, end: 5, text: '这是第6段' };
        rdHlCreate('gold');
        const mark = P().querySelector('mark.rd-hl');
        rdHlShowEditBar(mark);
        const hlBar = document.getElementById('rdHlBar');
        const hasAsk = !!(hlBar && hlBar.querySelector('[data-act="ask"]'));
        hlBar.querySelector('[data-act="ask"]').click();
        const bar = document.querySelector('.reading-actbar');
        const barAfterP = !!bar && P().nextElementSibling === bar;
        const inp = bar.querySelector('.rp-ask'), send = bar.querySelector('.rp-ask-send');
        const ph = inp.placeholder, label0 = send.textContent;
        send.click();   // 空着点：不该发
        await new Promise(r => setTimeout(r, 300));
        const sentEmpty = sent.length;
        inp.value = '为什么这么说'; inp.dispatchEvent(new Event('input'));
        send.click();
        await new Promise(r => setTimeout(r, 1500));
        const ms = (sent[0] || {}).messages || [];
        const usr = ms.filter(m => m.role === 'user').map(m => m.content).join('\n');
        const bq = P().parentNode.querySelector('blockquote[data-cp="6"]');
        const qd = bq && bq.querySelector('.reading-q');
        const quoteEl = qd && qd.querySelector('.rd-q-quote');
        const qhl = qd && qd.querySelector('.reading-q-hl');
        const stored = chatMessages[mi].content;
        // 普通双击提问不受影响：没有灰字
        readingClearActbar();
        readingOnParaClick(document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="8"]'));
        const b2 = document.querySelector('.reading-actbar');
        const ph2 = b2.querySelector('.rp-ask').placeholder;
        return { hasAsk, barAfterP, ph, label0, sentEmpty, usr, quote: quoteEl && quoteEl.textContent,
                 qtext: qhl && qhl.textContent, stored, ph2, nQuote: document.querySelectorAll('.rd-q-quote').length };
    });
    ok('划线小条上有「问」', R.hasAsk);
    ok('提问框开在段落正下方（跟双击一样）', R.barAfterP);
    eq('框里的提示', R.ph, '问问划的这句…');
    eq('空着时按钮叫「问」', R.label0, '问');
    eq('空着点不发请求', R.sentEmpty, 0);
    ok('发出去的问题带着划的句子', /我的问题是：「这是第6段」为什么这么说/.test(R.usr), R.usr.slice(-200));
    ok('末尾锚点落在划的这几句上', /我划出来的「这是第6段」这几句：回答落在这几句上/.test(R.usr), R.usr.slice(-160));
    ok('末尾不再是「落在这一段上」那句', !/回答都要落在 \[P6\] 这一段上/.test(R.usr), '');
    eq('回答块开头那行灰字', R.quote, '这是第6段');
    ok('问题那行里不重复划的句子', R.qtext && !/这是第6段/.test(R.qtext) && /为什么这么说/.test(R.qtext), R.qtext);
    ok('存储格式照旧（一行「汐：」问题）', /\[P6\] 汐：「这是第6段」为什么这么说\n/.test(R.stored), R.stored.slice(-80));
    ok('普通双击提问照旧', /留空＝讲解/.test(R.ph2), R.ph2);
    eq('页面上只有这一条灰字', R.nQuote, 1);
    ok('页面没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));
    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('  ❌ ' + r.name + '\n        → ' + (r.detail || '')); });
    if (bad.length) { console.log('\n❌ ' + bad.length + '/' + results.length + ' 条没过'); process.exit(1); }
    console.log('\n✅ 划线上问：' + results.length + ' 条全过');
})();
