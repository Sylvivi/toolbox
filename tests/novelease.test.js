/* 小说「拆句」「缩写」（2026-11-09 岚，她读《米德尔马契》要的每段降低难度）。
 * 跑法：bash tests/p.sh novelease    模型请求全是假的，不花钱。
 * 钉三件事：① 小说选单五档、后两样是新的 ② 就这一段、落点不挪 ③ 上下文跟条子上的圆圈走（前文/后文段数），不像说人话写死前两段。 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

function bootNovel() {
    const L = []; for (var i = 1; i <= 12; i++) L.push('第' + i + '段：编的小说正文，姐妹俩坐在窗边说话，句子拐了好几个弯才说到正题。');
    const book = { id: 'bk_n', fileName: '编的小说.txt', fileSize: 1, chapters: [{ title: '第一章', body: L.join('\n') }] };
    window.rbBooks = [book]; window.rbGetBook = function () { return book; }; window._rbHeadsCache = {};
    window.chatResolveCompressModel = function () { return { model: 'scan', baseUrl: 'https://a.com/v1', apiKey: 'k' }; };
    window._slotAsked = [];
    window.chatResolveReadingModel = function (slot) { window._slotAsked.push(slot); return { model: 'main', baseUrl: 'https://b.com/v1', apiKey: 'k' }; };
    window.getKeyItemById = function () { return { id: 'p1', url: 'https://b.com/v1', key: 'k' }; };
    window.chatSelectedModel = 'main';
    try { rdLsRemove('reader_qa'); localStorage.removeItem('reading_book_kind');
          Object.keys(localStorage).filter(k => k.indexOf('reading_ask_ctx2:') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    rbSetBookKind(book.fileName + '|' + book.fileSize, 'novel');
    document.getElementById('chatModalOverlay').classList.add('show');
    readerBookId = 'bk_n'; readerChapterIdx = 0; chatReaderMode = true; chatReadingMode = true;
    chatCurrentConvId = 'reader_bk_n';
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
    await page.evaluate('window._bootNovel = ' + bootNovel.toString());
    const R = await page.evaluate(async () => {
        window._bootNovel();
        const sent = [];
        window.fetch = function (url, opt) {
            try { sent.push(JSON.parse(opt.body)); } catch (e) { sent.push({ _bad: String(e) }); }
            const chunks = ['data: {"choices":[{"delta":{"content":"大意：好"}}]}\n\n', 'data: [DONE]\n\n']; let i = 0;
            return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'text/event-stream' },
                body: { getReader: () => ({ read: () => Promise.resolve(i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true, value: undefined }), cancel: () => Promise.resolve(), releaseLock: () => {} }) },
                json: () => Promise.resolve({ choices: [{ message: { content: '好' } }] }), text: () => Promise.resolve('好') });
        };
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        const openBar = (p) => { readingClearActbar(); readingOnParaClick(document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="' + p + '"]')); return document.querySelector('.reading-actbar'); };
        let bar = openBar(6);
        bar.querySelector('.rp-ask-send').click();
        await new Promise(r => setTimeout(r, 30));
        const pick = bar.querySelector('.rp-guide-pick');
        const 档位 = pick ? [].map.call(pick.querySelectorAll('button'), b => b.getAttribute('data-k')) : [];
        const 文字 = pick ? [].map.call(pick.querySelectorAll('button'), b => b.textContent.trim()) : [];
        readingClearActbar();
        const grab = async (k, p) => {
            sent.length = 0; window._slotAsked.length = 0;
            bar = openBar(p);
            bar.querySelector('.rp-ask-send').click();
            await new Promise(r => setTimeout(r, 30));
            bar.querySelector('.rp-guide-pick button[data-k="' + k + '"]').click();
            await new Promise(r => setTimeout(r, 900));
            const b = sent[0] || {}; const msgs = b.messages || [];
            const 头 = { chai: '拆句', suo: '缩写' }[k];
            let 落点 = null, 问 = null;
            try { const qa = JSON.parse(rdLsGet('reader_qa') || '{}'); const cell = qa['编的小说.txt|1'] && qa['编的小说.txt|1'][0];
                  const hit = ((cell && cell.list) || []).filter(x => (x.q || '').indexOf(头) === 0 && x.p === p); const last = hit[hit.length - 1];
                  落点 = last ? last.p : null; 问 = last ? last.q : null; } catch (e) { 落点 = 'err'; }
            const usr = msgs.filter(m => m.role === 'user').map(m => m.content).join('\n');
            const ps = (usr.match(/\[P(\d+)\] 第/g) || []).map(s => +s.match(/\d+/)[0]);
            return { sys: msgs.filter(m => m.role === 'system').map(m => m.content).join('\n'), usr, ps, 落点, 问, 档: window._slotAsked.slice(), 发了几次: sent.length };
        };
        // 默认圆圈＝前文全章、后文 0
        const chai = await grab('chai', 6);
        // 拨圆圈：前 2 段、后 2 段
        readingSetAskCtx(false, { pre: 2, post: 2 });
        const suo = await grab('suo', 8);
        readingClearActbar();
        return { 档位, 文字, chai, suo };
    });
    eq('小说选单五档：读前/读完/背景/拆句/缩写', R.档位, ['pre', 'post', 'bgone', 'chai', 'suo']);
    eq('都是两个字', R.文字, ['读前', '读完', '背景', '拆句', '缩写']);
    ok('拆句：系统提示带【拆句】和「大意：」格式', /【拆句】/.test(R.chai.sys) && /大意：/.test(R.chai.sys), R.chai.sys.slice(0, 200));
    ok('拆句：不用蘑菇点评人设（不签🍄）', !/蘑菇/.test(R.chai.sys.split('【拆句】')[0]), R.chai.sys.slice(0, 120));
    ok('拆句：人设里禁剧透', /埋下伏笔/.test(R.chai.sys));
    eq('拆句：默认圆圈＝前文铺到章首（含 P1 章名）、后文不给', R.chai.ps, [1, 2, 3, 4, 5, 6]);
    ok('拆句：用户消息末尾钉防剧透', /后续情节一个字都不许提[^]{0,20}$/.test(R.chai.usr), R.chai.usr.slice(-80));
    eq('拆句：落在点的那一段', R.chai.落点, 6);
    eq('拆句：问句', R.chai.问, '拆句');
    eq('拆句：走讲解那一档模型', R.chai.档[0], 'guide');
    eq('拆句：只发一次请求', R.chai.发了几次, 1);
    ok('缩写：系统提示带【缩写】', /【缩写】/.test(R.suo.sys));
    eq('缩写：圆圈拨成前 2 后 2 → 带 P6～P10', R.suo.ps, [6, 7, 8, 9, 10]);
    ok('缩写：给了后文就告诉它可以参照', /后面几段原文我也给你了/.test(R.suo.usr));
    eq('缩写：落在点的那一段', R.suo.落点, 8);
    eq('页面无 JS 报错', pageErrs, []);
    await browser.close();
    let fails = 0;
    for (const r of results) { if (!r.pass) fails++; console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.name + (r.pass ? '' : '   ← ' + (r.detail || ''))); }
    console.log(fails ? `\n${fails} 条没过` : `\n全部 ${results.length} 条通过`);
    process.exit(fails ? 1 : 0);
})();
