/* 共读提问「输入分块字数」的回归测试。
 *
 * 起因：用户 2026-07-28 问「共读提问一次上万 token，主要是输入，怎么优化」。
 * 总数看得见、构成看不见，砍哪一块全靠猜——而且记忆表格和前文问答有多大，
 * 只有用户手机上的数据知道，服务器这边测不出来。所以先量再砍：
 * 每笔共读提问记下各块字数，用量明细里点开就是一排条形图。
 *
 * ⚠️这套测试守的是「量得准」：分块加起来必须≈真正发出去的内容，
 * 少记一块就会让用户按错误的比例去砍，白折腾一轮还以为是自己判断错了。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 一章 60 段长正文：从靠后的段落提问，原文上下文才会被塞满，才测得出它是不是大头
function bootBook() {
    const body = []; for (let i = 1; i <= 60; i++) body.push('第' + i + '段：' + '正'.repeat(160));
    const book = { id: 'bk_p', fileName: '测试书.txt', fileSize: 9, chapters: [{ title: '第一章', body: body.join('\n') }] };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === 'bk_p' ? book : null);
    window.getKeyItemById = () => ({ id: 'p1', url: 'https://x/v1', key: 'k' });
    window.chatSelectedModel = 'm1';
    window.chatResolveReadingModel = () => null;
    localStorage.removeItem('toolbox_api_log');
    localStorage.removeItem('toolbox_api_agg');
    document.getElementById('chatModalOverlay').classList.add('show');
    window.readerBookId = 'bk_p'; window.readerChapterIdx = 0;
    window.chatReaderMode = true; window.chatReadingMode = true;
    window.chatCurrentConvId = 'reader_bk_p';
    window.chatMessages = readerChapterPair(book.chapters[0], 0);
    chatRenderAllMessages(false);
    return chatMessages.findIndex(m => m && m.readerChapter === 0);
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._bootBook=' + bootBook + ';' });

    /* ── A 组：分块量得准不准 ─────────────────────────────────────── */
    const A = await page.evaluate(async () => {
        const mi = window._bootBook();
        window.chatMemoryTables = { characters: [{ '人物': '甲', '身份': '书生', '关系': '', '当前状态': '', '备注': '' }], places: [], timeline: [], plotlines: [] };
        // 两样都给上料：用户 2026-07-28 量出「记忆表+摘要 6700 字」，正问该砍哪个，
        // 而当时它俩被记成一块、恰好看不出来。这里要确认它们各记各的。
        window.chatCompressSummaries = ['前情摘要甲'.repeat(40), '前情摘要乙'.repeat(40)];
        const out = {};
        window.chatStreamChat = async (o) => {
            out.parts = o.parts;
            out.purpose = o.purpose;
            // 真正发出去的全部内容，用来核对分块加起来对不对
            out.真实字数 = (o.messages || []).map(m => typeof m.content === 'string' ? m.content : '').join('').length;
            apiLogRecord(o.purpose, o.model, 9999, 300, false, o.baseUrl, 0, o.parts);
            return '这是回答。';
        };
        await readingAskOne(mi, 50, '他为什么这么说？', null);
        const log = JSON.parse(localStorage.getItem('toolbox_api_log') || '[]');
        out.落盘的 = log[0] && log[0].parts;
        out.分块合计 = Object.keys(out.parts).reduce((s, k) => s + out.parts[k], 0);
        return out;
    });
    ok('共读提问带上了分块字数', !!A.parts, JSON.stringify(A));
    eq('记在「共读提问」这个环节下', A.purpose, '共读提问');
    /* ⚠️最重要的一条：分块加起来必须接近真正发出去的字数。
     * 允许 5% 误差（拼接时的提示语、分隔符不属于任何一块），但差太多就是漏记了某一块，
     * 用户会按错误的比例去砍——比如以为原文占九成、砍完发现没省多少。 */
    ok('分块加起来≈真正发出去的字数（漏记一块＝让用户按错比例砍）',
        Math.abs(A.分块合计 - A.真实字数) / A.真实字数 < 0.05,
        '分块合计 ' + A.分块合计 + ' / 真实 ' + A.真实字数);
    /* ⚠️记忆表和摘要必须分开记（2026-07-28 拆）。合成一块时用户量出 6700 字，
     * 正要决定砍哪个，而量表恰好在这里糊住了——最该分辨的地方失焦，等于没量。 */
    ok('记忆表单独记（不再和摘要糊成一块）', A.parts['记忆表'] > 0, JSON.stringify(A.parts));
    ok('前文摘要单独记', A.parts['前文摘要'] > 0, JSON.stringify(A.parts));
    eq('前文摘要记的是摘要本身的字数', A.parts['前文摘要'], 400);
    ok('分块跟着落进了明细日志', !!A.落盘的, JSON.stringify(A.落盘的));
    ok('字数为 0 的块不落盘（省地方，也省得展开时一排 0）', !('前文问答' in (A.落盘的 || {})), JSON.stringify(A.落盘的));

    /* ── B 组：只记共读提问（用户明确说导读没必要） ───────────────── */
    const B = await page.evaluate(async () => {
        const mi = window._bootBook();
        let got;
        window.chatStreamChat = async (o) => { got = { purpose: o.purpose, parts: o.parts || null }; return '导读内容。'; };
        // 造一个有小标题结构的章节，让导读路径走得通
        window.rbSectionOf = () => ({ headP: 3, startP: 4, endP: 20, title: '小节标题' });
        window.rbSectionText = () => ({ text: '节内正文'.repeat(50), truncated: false });
        await readingAskOne(mi, 5, '导读', null, { guide: true });
        return got;
    });
    eq('社科导读走的是「社科导读」环节', B.purpose, '社科导读');
    eq('社科导读不记分块（用户：没必要，主要是共读提问花得多）', B.parts, null);

    /* ── C 组：明细面板里点开看 ───────────────────────────────────── */
    const C = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_api_log');
        localStorage.removeItem('toolbox_api_agg');
        apiLogRecord('共读提问', 'm1', 9000, 300, false, 'https://x/v1', 0,
            { '本章原文': 7900, '记忆表': 3400, '前文摘要': 3300, '人设+指令': 948, '我的问题': 8, '前文问答': 0 });
        apiLogRecord('共读点评', 'm1', 3000, 200, false, 'https://x/v1', 0);   // 没分块，不该可点
        if (document.querySelector('.api-log-modal-mask')) document.querySelector('.api-log-modal-mask').remove();
        apiLogShowPanel();
        const rows = [...document.querySelectorAll('#apiLogBody div[onclick]')];
        const box = document.querySelector('#apiLogBody .api-parts');
        const out = {
            可点的行数: rows.length,
            展开前: box && box.style.display,
            零字数的块没画出来: !/前文问答/.test(box ? box.innerHTML : ''),
            条形顺序: [...box.querySelectorAll('span[style*="width:5.2em"]')].map(s => s.textContent),
            占比文案: [...box.querySelectorAll('span[style*="text-align:right"]')].map(s => s.textContent.trim())
        };
        rows[0].click(); out.点一下 = box.style.display; out.箭头翻了 = /▴/.test(rows[0].textContent);
        rows[0].click(); out.再点一下 = box.style.display;
        return out;
    });
    eq('只有带分块的那一条可以点开（共读点评没被误加）', C.可点的行数, 1);
    eq('默认收着，不打扰', C.展开前, 'none');
    ok('字数为 0 的块不画进条形图', C.零字数的块没画出来);
    eq('条形按字数从大到小排（最长的那根就是该砍的）', C.条形顺序, ['本章原文', '记忆表', '前文摘要', '人设+指令', '我的问题']);
    eq('每根条后面写清字数和占比', C.占比文案, ['7,900 字 51%', '3,400 字 22%', '3,300 字 21%', '948 字 6%', '8 字 0%']);
    eq('点一下展开', C.点一下, 'block');
    ok('展开后箭头翻过来', C.箭头翻了);
    eq('再点一下收起', C.再点一下, 'none');

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
