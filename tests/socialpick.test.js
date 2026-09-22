/* 社科书「空着点一下」弹的那一行：导读 / 说人话 / 举例 / 论证（2026-09-21 晗加）。
 * 跑法：bash tests/p.sh socialpick    模型请求全是假的，不花钱。 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

function bootSocial() {
    const para = function (s) { return s + '，这里是一段足够长的正文内容用来充当社科书的段落，需要超过四十个汉字才会被判定为正文长段。'; };
    const L = [para('导语一'), para('导语二')];
    L.push('自我辩护的代价'); for (var i = 0; i < 8; i++) L.push(para('甲' + i));
    L.push('认知失调理论');   for (var j = 0; j < 8; j++) L.push(para('乙' + j));
    const book = { id: 'bk_s', fileName: '社会性动物.txt', fileSize: 1, chapters: [{ title: '第五章 自我辩护', body: L.join('\n') }] };
    window.rbBooks = [book]; window.rbGetBook = function () { return book; }; window._rbHeadsCache = {};
    window.chatResolveCompressModel = function () { return { model: 'scan', baseUrl: 'https://a.com/v1', apiKey: 'k' }; };
    window._slotAsked = [];
    window.chatResolveReadingModel = function (slot) { window._slotAsked.push(slot); return { model: 'main', baseUrl: 'https://b.com/v1', apiKey: 'k' }; };
    window.getKeyItemById = function () { return { id: 'p1', url: 'https://b.com/v1', key: 'k' }; };
    window.chatSelectedModel = 'main';
    try { localStorage.removeItem('reader_qa'); localStorage.removeItem('reading_book_kind'); } catch (e) {}
    rbSetBookKind(book.fileName + '|' + book.fileSize, 'social');
    document.getElementById('chatModalOverlay').classList.add('show');
    readerBookId = 'bk_s'; readerChapterIdx = 0; chatReaderMode = true; chatReadingMode = true;
    chatCurrentConvId = 'reader_bk_s';
    chatMessages = readerChapterPair(book.chapters[0], 0);
    chatRenderAllMessages(false);
    return book;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = []; page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(1500);
    await page.evaluate('window._bootSocial = ' + bootSocial.toString());
    const R = await page.evaluate(async () => {
        window._bootSocial();
        const sent = [];
        window.fetch = function (url, opt) {
            try { sent.push(JSON.parse(opt.body)); } catch (e) { sent.push({ _bad: String(e) }); }
            const chunks = ['data: {"choices":[{"delta":{"content":"好"}}]}\n\n', 'data: [DONE]\n\n']; let i = 0;
            return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'text/event-stream' },
                body: { getReader: () => ({ read: () => Promise.resolve(i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true, value: undefined }), cancel: () => Promise.resolve(), releaseLock: () => {} }) },
                json: () => Promise.resolve({ choices: [{ message: { content: '好' } }] }), text: () => Promise.resolve('好') });
        };
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        const openBar = (p) => { readingClearActbar(); readingOnParaClick(document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="' + p + '"]')); return document.querySelector('.reading-actbar'); };
        // ① 空着点一下 → 弹四个键
        let bar = openBar(5);
        const 标签 = bar.querySelector('.rp-ask-send').textContent;
        bar.querySelector('.rp-ask-send').click();
        await new Promise(r => setTimeout(r, 30));
        const pick = bar.querySelector('.rp-guide-pick');
        const 档位 = pick ? [].map.call(pick.querySelectorAll('button'), b => b.getAttribute('data-k')) : [];
        const 文字 = pick ? [].map.call(pick.querySelectorAll('button'), b => b.textContent.trim()) : [];
        // ② 逐个点，抓提示词和落点
        const grab = async (k, p) => {
            sent.length = 0; window._slotAsked.length = 0;
            bar = openBar(p);
            bar.querySelector('.rp-ask-send').click();
            await new Promise(r => setTimeout(r, 30));
            const btn = bar.querySelector('.rp-guide-pick button[data-k="' + k + '"]');
            if (!btn) { readingAskOne(mi, p, k, bar, { social: k }); }   // 行里没这个键（举例已撤）→ 直接走代码路径
            else btn.click();
            await new Promise(r => setTimeout(r, 900));
            const b = sent[0] || {}; const msgs = b.messages || [];
            // ⚠️reader_qa 的 list 是按段号排的，不能拿"最后一条"当"刚存的"——按问句开头找
            const 头 = { plain: '说人话', example: '举个例子', argue: '论证', guide: '导读' }[k];
            let 落点 = null, 问 = null;
            try { const qa = JSON.parse(localStorage.getItem('reader_qa') || '{}'); const cell = qa['社会性动物.txt|1'] && qa['社会性动物.txt|1'][0];
                  const hit = ((cell && cell.list) || []).filter(x => (x.q || '').indexOf(头) === 0); const last = hit[hit.length - 1];
                  落点 = last ? last.p : null; 问 = last ? last.q : null; } catch (e) { 落点 = 'err'; }
            return { sys: msgs.filter(m => m.role === 'system').map(m => m.content).join('\n'), usr: msgs.filter(m => m.role === 'user').map(m => m.content).join('\n'), 落点, 问, 档: window._slotAsked.slice(), 发了几次: sent.length };
        };
        const plain = await grab('plain', 5);
        const example = await grab('example', 6);   // 按钮没了；直接调 opts 仍走得通
        const argue = await grab('argue', 5);
        const guide = await grab('guide', 5);
        readingClearActbar();
        return { 标签, 档位, 文字, plain, example, argue, guide };
    });
    eq('空着时按钮叫「导读」', R.标签, '导读');
    eq('弹出四个档（举例已撤、背景 09-22 加）', R.档位, ['guide', 'plain', 'argue', 'bgone']);
    eq('四个短词', R.文字, ['导读', '说人话', '论证', '背景']);
    // 说人话：就这一段、带 [P5] 原文、指令是重写、不带前文摘要
    ok('说人话：系统提示带【说人话】', /【说人话】/.test(R.plain.sys), R.plain.sys.slice(-200));
    ok('说人话：用户消息带 [P5] 那一段（P1 是章名，P5＝甲0）', /\[P5\]/.test(R.plain.usr) && /甲0/.test(R.plain.usr), R.plain.usr.slice(0, 200));
    ok('说人话：只带前两段参照', /\[P3\]/.test(R.plain.usr) && /\[P4\]/.test(R.plain.usr) && !/\[P2\]/.test(R.plain.usr), R.plain.usr.slice(0, 260));
    eq('说人话：落在点的那一段', R.plain.落点, 5);
    eq('说人话：问答块的问句', R.plain.问, '说人话');
    eq('说人话：走导读/讲解那一档模型', R.plain.档[0], 'guide');
    eq('说人话：只发一次请求', R.plain.发了几次, 1);
    // 举例
    ok('举例：系统提示带【举个例子】', /【举个例子】/.test(R.example.sys));
    eq('举例：落在点的那一段', R.example.落点, 6);
    eq('举例：问句', R.example.问, '举个例子');
    // 论证：整节、挂节末
    ok('论证：系统提示带三行格式', /主张：/.test(R.argue.sys) && /凭什么：/.test(R.argue.sys) && /反谁：/.test(R.argue.sys));
    ok('论证：用户消息带整节原文', /甲0/.test(R.argue.usr) && /甲7/.test(R.argue.usr), R.argue.usr.slice(0, 120));
    eq('论证：挂在节末（第一节最后一段＝P12）', R.argue.落点, 12);
    ok('论证：问句带小节名', /^论证：《自我辩护的代价》/.test(R.argue.问 || ''), R.argue.问);
    // 导读没被改坏
    ok('导读：还是社科导读那套', /【导读任务】/.test(R.guide.sys));
    eq('导读：还挂在小标题段（P4）', R.guide.落点, 4);
    eq('页面无 JS 报错', pageErrs, []);
    await browser.close();
    let fails = 0;
    for (const r of results) { if (!r.pass) fails++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.name + (r.pass ? '' : '   ← ' + (r.detail || ''))); }
    console.log(fails ? `\n${fails} 条没过` : `\n全部 ${results.length} 条通过`);
    process.exit(fails ? 1 : 0);
})();
