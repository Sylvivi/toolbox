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

    /* ── D 组：双击背景块＝背景追问模式 ─────────────────────────────
     * 用户 2026-07-28 报：「双击的明明是背景知识，AI 却带入正文人物的动机跟我交流」。
     * 根因是 readingOnCommentClick 只取段号、把「你双击的是哪一块」直接扔了，
     * 于是双击背景块和双击正文段落发出去的东西**一模一样**——共读点评人设
     * ＋「结合该段原文认真回答」＋记忆表/摘要，全在往剧情上拽。
     * ⚠️用户明确说「不是说不可以聊正文」，所以定的是**背景优先**、不是禁止聊剧情。 */
    const D = await page.evaluate(async () => {
        const body = []; for (let i = 1; i <= 30; i++) body.push('第' + i + '段：' + '正'.repeat(120));
        const book = { id: 'bk_b', fileName: '大唐辟珠记.txt', fileSize: 42, chapters: [{ title: '第四十四章', body: body.join('\n') }] };
        window.rbBooks = [book]; window.rbGetBook = (id) => (id === 'bk_b' ? book : null);
        window.getKeyItemById = () => ({ id: 'p1', url: 'https://x/v1', key: 'k' });
        window.chatSelectedModel = 'm1'; window.chatResolveReadingModel = () => null;
        document.getElementById('chatModalOverlay').classList.add('show');
        window.readerBookId = 'bk_b'; window.readerChapterIdx = 0;
        window.chatReaderMode = true; window.chatReadingMode = true;
        window.chatCurrentConvId = 'reader_bk_b';
        window.chatMessages = readerChapterPair(book.chapters[0], 0);
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        // 同一段上挂两块：一条普通问答 + 一条背景讲解。双击哪块，行为必须不同。
        chatMessages[mi].content += '\n[P17] 汐：他为什么这么说？\n因为他在试探。';
        chatMessages[mi].content += '\n[P17] 汐：背景：绿衣官员\n唐代六七品官员穿绿色官服，见到紫袍红袍就得低头。🍄';
        window.chatMemoryTables = { characters: [{ '人物': '甲', '身份': '书生', '关系': '', '当前状态': '', '备注': '' }], places: [], timeline: [], plotlines: [] };
        window.chatCompressSummaries = ['前情摘要'.repeat(50)];
        chatRenderAllMessages(false);

        const out = {};
        const bqs = [...document.querySelector('.chat-msg.ai[data-idx="' + mi + '"]').querySelectorAll('blockquote[data-cp="17"]')];
        out.谁被标成背景 = bqs.map(x => (x.hasAttribute('data-bg') ? 'BG' : '普通'));

        let sent;
        window.chatStreamChat = async (o) => { sent = o; return '这是回答。'; };

        readingOnCommentClick(bqs[1]);              // ① 双击背景块
        let bar = document.querySelector('.reading-actbar');
        out.按钮文字 = bar.querySelector('.rp-ask-send').textContent;
        out.占位文字 = bar.querySelector('.rp-ask').placeholder;
        bar.querySelector('.rp-ask').value = '那这个颜色是谁定的？';
        bar.querySelector('.rp-ask-send').click();
        await new Promise(r => setTimeout(r, 400));
        out.背景 = {
            环节: sent.purpose,
            带了记忆表或摘要: sent.messages.some(m => /人物表|前情摘要/.test(m.content)),
            带了背景讲解: /唐代六七品官员穿绿色官服/.test(sent.messages[1].content),
            带了同段别的问答: /他在试探/.test(sent.messages[1].content),
            段号: (sent.messages[1].content.match(/\[P(\d+)\]/g) || []).filter((v, i, a) => a.indexOf(v) === i),
            人设是背景那套: /我在读小说，读到不懂的时代背景来问你/.test(sent.messages[0].content),
            // ⚠️别拿「伏笔」当标记：背景指令里就有「别主动去分析人物动机、伏笔、剧情走向」，
            // 会把自己的话当成泄漏。只认共读点评人设独有的那几句。
            没混进共读点评人设: !/男生子|家族树|像朋友唠嗑，不是文学赏析课/.test(sent.messages[0].content),
            允许聊剧情: /那就正常聊/.test(sent.messages[0].content),
            总字数: sent.messages.map(m => m.content).join('').length,
            分块: sent.parts
        };

        readingClearActbar();                       // ② 双击普通问答块：老路一字不变
        const bqs2 = [...document.querySelector('.chat-msg.ai[data-idx="' + mi + '"]').querySelectorAll('blockquote[data-cp="17"]')];
        readingOnCommentClick(bqs2[0]);
        bar = document.querySelector('.reading-actbar');
        bar.querySelector('.rp-ask').value = '他后来怎么了？';
        bar.querySelector('.rp-ask-send').click();
        await new Promise(r => setTimeout(r, 400));
        out.普通 = {
            环节: sent.purpose,
            带了记忆表或摘要: sent.messages.some(m => /人物表|前情摘要/.test(m.content)),
            总字数: sent.messages.map(m => m.content).join('').length
        };
        return out;
    });
    eq('背景块在渲染时就被标出来（不然双击时认不出）', D.谁被标成背景, ['普通', 'BG']);
    eq('双击背景块：按钮变「追问」', D.按钮文字, '追问');
    eq('双击背景块：输入框提示「问问这个背景…」', D.占位文字, '问问这个背景…');
    eq('单独记账成「背景追问」（记成共读提问就看不出省没省）', D.背景.环节, '背景追问');
    ok('背景追问带上了那条背景讲解', D.背景.带了背景讲解);
    ok('背景追问不带同一段里别的问答（那正是跑偏的诱因之一）', !D.背景.带了同段别的问答);
    eq('背景追问带前后各三段原文', D.背景.段号, ['[P17]', '[P14]', '[P15]', '[P16]', '[P18]', '[P19]', '[P20]']);
    ok('背景追问不带记忆表和前文摘要', !D.背景.带了记忆表或摘要, JSON.stringify(D.背景));
    ok('背景追问用的是背景人设（"我在读小说，读到不懂的时代背景"）', D.背景.人设是背景那套);
    ok('没混进共读点评人设（伏笔/男生子/家族树）', D.背景.没混进共读点评人设);
    /* ⚠️反向保护：用户原话「不是说不可以聊正文」。写成硬禁令会从一个毛病换成另一个毛病——
     * 她顺口问一句「那他当时是不是在装傻」会被模型拦回去。 */
    ok('但仍允许她主动问剧情（不是硬禁令）', D.背景.允许聊剧情);
    ok('背景追问比普通提问省一大截', D.背景.总字数 < D.普通.总字数 * 0.6,
        '背景 ' + D.背景.总字数 + ' 字 / 普通 ' + D.普通.总字数 + ' 字');
    /* 背景追问现在也能自己调档（见 E 组），所以分块里会有「记忆表/前文摘要」两栏；
     * 默认的 ○ 档下它们必须是 0——照实记，才看得出调高一档到底贵多少。 */
    eq('背景追问的分块栏目齐全', Object.keys(D.背景.分块).sort(),
        ['人设+指令', '原文节选', '前文摘要', '我的问题', '背景讲解', '记忆表'].sort());
    eq('默认 ○ 档下，记忆表和摘要记的是 0（确实没发）',
        [D.背景.分块['记忆表'], D.背景.分块['前文摘要']], [0, 0]);
    eq('双击普通问答块：老路一字不变，仍记「共读提问」', D.普通.环节, '共读提问');
    ok('双击普通问答块：记忆表和摘要照样带（没误伤）', D.普通.带了记忆表或摘要);

    /* ── E 组：提问上下文面板（2026-08-29 起，取代了原来的三档小圆点）───────────
     * 起因：她报「特殊情况下选中提问会因为前文的内容被谷歌排斥」，要一个界面自己控制发多少。
     * 她拍板的四件事，本组逐条钉住：
     *   ① 圆点**不再循环换档**，点一下＝展开面板（一套真相，免得面板和圆点互相覆盖）；
     *   ② 原文是「前 N 段 / 后 M 段」两个数，**后文默认 0**（防剧透靠这个默认守）；
     *   ③ 记忆表和摘要**是两个独立开关**（摘要浓度可能比原文还高，要能单独扔）；
     *   ④ 设置**按书各记一份**。
     * ⚠️老的三档 readingAskLv 仍然活着，当「这本书还没调过面板」时的默认值来源——
     *   下面「老数据行为不变」那几条就是钉它的，别因为面板做好了就把它删了。 */
    const E = await page.evaluate(async () => {
        const body = []; for (let i = 1; i <= 30; i++) body.push('第' + i + '段：' + '正'.repeat(120));
        const book = { id: 'bk_l', fileName: '书.txt', fileSize: 9, chapters: [{ title: '第一章', body: body.join('\n') }] };
        window.rbBooks = [book]; window.rbGetBook = (id) => (id === 'bk_l' ? book : null);
        window.getKeyItemById = () => ({ id: 'p1', url: 'https://x/v1', key: 'k' });
        window.chatSelectedModel = 'm1'; window.chatResolveReadingModel = () => null;
        document.getElementById('chatModalOverlay').classList.add('show');
        window.readerBookId = 'bk_l'; window.readerChapterIdx = 0;
        window.chatReaderMode = true; window.chatReadingMode = true;
        window.chatCurrentConvId = 'reader_bk_l';
        window.chatMessages = readerChapterPair(book.chapters[0], 0);
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        chatMessages[mi].content += '\n[P5] 汐：早先问过的？\n早先答过的。';
        chatMessages[mi].content += '\n[P17] 汐：背景：绿衣官员\n唐代六七品官员穿绿色官服。🍄';
        window.chatMemoryTables = { characters: [{ '人物': '甲', '身份': '书生', '关系': '', '当前状态': '', '备注': '' }], places: [], timeline: [], plotlines: [] };
        window.chatCompressSummaries = ['前情摘要'.repeat(50)];
        const clearCtx = () => {
            ['reading_ask_lv', 'reading_ask_lv_bg', 'reading_ask_ctx'].forEach(k => localStorage.removeItem(k));
            Object.keys(localStorage).filter(k => k.indexOf('reading_ask_ctx2:') === 0).forEach(k => localStorage.removeItem(k));
        };
        clearCtx();
        chatRenderAllMessages(false);

        const out = {};
        out.默认档 = { 普通: readingAskLv(false), 背景: readingAskLv(true) };
        localStorage.setItem('reading_ask_ctx', '1');
        out.老开关勾上过 = readingAskLv(false);      // 旧数据要落到「全带」
        localStorage.removeItem('reading_ask_ctx');

        let sent;
        window.chatStreamChat = async (o) => { sent = o; return '答。'; };
        const openBar = (bgIdx) => {
            readingClearActbar();
            const msgEl = document.querySelector('.chat-msg.ai[data-idx="' + mi + '"]');
            if (bgIdx != null) readingOnCommentClick([...msgEl.querySelectorAll('blockquote[data-cp="17"]')][bgIdx]);
            else readingOpenAskBar(mi, 20, msgEl.querySelector('p[data-p="20"]'));
            return document.querySelector('.reading-actbar');
        };
        const askAt = async (bgIdx) => {
            const bar = openBar(bgIdx);
            bar.querySelector('.rp-ask').value = '问题？';
            bar.querySelector('.rp-ask-send').click();
            await new Promise(r => setTimeout(r, 300));
            const last = sent.messages[sent.messages.length - 1].content;
            return {
                表格摘要: sent.messages.some(m => /人物表|前情摘要/.test(m.content)),
                人物表: sent.messages.some(m => /人物表/.test(m.content)),
                前情摘要: sent.messages.some(m => /前情摘要/.test(m.content)),
                前文问答: /早先答过的/.test(last),
                段号: [...new Set((last.match(/\[P(\d+)\]/g) || []).map(x => parseInt(x.slice(2), 10)))].sort((a, b) => a - b),
                人设: sent.messages[0].content,
                字数: sent.messages.map(m => m.content).join('').length
            };
        };
        // ① 老数据行为不变：这本书还没调过面板 → 一切照老三档来
        out.老档0 = (readingSetAskLv(false, 0), await askAt(null));
        out.老档1 = (readingSetAskLv(false, 1), await askAt(null));
        out.老档2 = (readingSetAskLv(false, 2), await askAt(null));
        out.背景老档0 = (readingSetAskLv(true, 0), await askAt(0));
        out.背景老档1 = (readingSetAskLv(true, 1), await askAt(0));
        clearCtx();

        // ② 面板本身：默认收起、点圆点展开、再点收起
        const bar0 = openBar(null);
        const el0 = bar0.querySelector('.rp-lv');
        const panel0 = bar0.querySelector('.rp-ctxpanel');
        out.控件存在 = !!el0 && !!panel0;
        out.默认收起 = panel0.style.display === 'none';
        el0.click(); out.点开 = panel0.style.display;
        el0.click(); out.再点收起 = panel0.style.display;
        el0.click();

        // ③ 勾一下就存进「这本书」那份，圆点跟着变脸
        const chip = (act) => panel0.querySelector('[data-rdctx="' + act + '"]');
        out.圆点起始 = el0.getAttribute('data-lv');
        chip('pre:5').click();
        out.存了前文5 = readingAskCtx(false).pre;
        out.选中会高亮 = chip('pre:5').classList.contains('active') && !chip('pre:-1').classList.contains('active');
        chip('sum').click();
        out.拆得开 = { 摘要: readingAskCtx(false).sum, 记忆表: readingAskCtx(false).mt };
        out.圆点跟着变 = el0.getAttribute('data-lv');
        chip('qa').click();
        out.圆点满档 = el0.getAttribute('data-lv');
        out.存储键带书 = _rdCtxKey();
        clearCtx();

        // ④ 各项真的生效
        readingSetAskCtx(false, { pre: 2, post: 0, mt: 1, sum: 1, qa: 0 });
        out.前2段 = await askAt(null);
        readingSetAskCtx(false, { post: 3 });
        out.前2后3 = await askAt(null);
        readingSetAskCtx(false, { pre: -1, post: 0, mt: 1, sum: 0 });
        out.只带表 = await askAt(null);
        readingSetAskCtx(false, { mt: 0, sum: 1 });
        out.只带摘要 = await askAt(null);
        readingSetAskCtx(false, { mt: 0, sum: 0 });
        out.都不带 = await askAt(null);
        readingSetAskCtx(false, { qa: 1 });
        out.带前文问答 = await askAt(null);

        // 普通提问和背景追问仍是两套，各记各的
        readingSetAskCtx(true, { pre: 1 });
        out.两套互不干扰 = { 普通: readingAskCtx(false).pre, 背景: readingAskCtx(true).pre };

        // ⑤ 按书各记一份：换本书就回到默认（用一个跟默认不同的值才验得出来）
        readingSetAskCtx(false, { pre: 10 });
        out.这本书 = readingAskCtx(false).pre;
        window.readerBookId = 'bk_other';
        window.chatCurrentConvId = 'reader_bk_other';
        out.另一本书 = readingAskCtx(false).pre;
        window.readerBookId = 'bk_l';
        window.chatCurrentConvId = 'reader_bk_l';
        out.换回来还在 = readingAskCtx(false).pre;
        clearCtx();
        return out;
    });
    /* ⚠️「老数据行为不变」这一组是整个改动的安全绳：她的书都还没调过面板，
     * 读出来的必须跟 08-29 之前一模一样，否则等于在她没要求的情况下动了行为和花费。 */
    eq('普通提问的默认仍是「＋记忆表和摘要」', E.默认档.普通, 1);
    eq('背景追问的默认仍是「只带原文」', E.默认档.背景, 0);
    eq('老开关勾过的人，仍迁移成「全带」', E.老开关勾上过, 2);
    ok('老 0 档：表格摘要和前文问答都不带', !E.老档0.表格摘要 && !E.老档0.前文问答, JSON.stringify(E.老档0));
    ok('老 1 档：带表格摘要，不带前文问答', E.老档1.表格摘要 && !E.老档1.前文问答, JSON.stringify(E.老档1));
    ok('老 2 档：两样都带', E.老档2.表格摘要 && E.老档2.前文问答, JSON.stringify(E.老档2));
    ok('老档位越高发得越多（梯子还是单调的）',
        E.老档0.字数 < E.老档1.字数 && E.老档1.字数 < E.老档2.字数,
        [E.老档0.字数, E.老档1.字数, E.老档2.字数].join(' < '));
    ok('背景追问的老档也还在（调到 ◐ 就带上表格摘要）', E.背景老档1.表格摘要 && !E.背景老档0.表格摘要);

    ok('提问条上有圆点，也有那张面板', E.控件存在);
    ok('面板默认收着，不占地方', E.默认收起);
    eq('⚠️点圆点是展开面板，不再是换档', [E.点开, E.再点收起], ['flex', 'none']);
    eq('勾「前文 5 段」立刻存进这本书那份', E.存了前文5, 5);
    ok('选中的那颗高亮、别的取消（不然不知道自己选了啥）', E.选中会高亮);
    eq('⚠️记忆表和摘要是两个独立开关：关掉摘要，人物表还在', E.拆得开, { 摘要: 0, 记忆表: 1 });
    eq('圆点跟着面板变脸（表还在→◐，再加前文问答→●）', [E.圆点起始, E.圆点跟着变, E.圆点满档], ['1', '1', '2']);
    ok('设置存在「按书」的键上，不是全局一份', /^reading_ask_ctx2:.+/.test(E.存储键带书) && !/:_$/.test(E.存储键带书), E.存储键带书);

    eq('前 2 段：只发 P18-P20', E.前2段.段号, [18, 19, 20]);
    eq('⚠️后文默认 0；拨到 3 才多出 P21-P23', E.前2后3.段号, [18, 19, 20, 21, 22, 23]);
    ok('给了后文就跟 AI 说一声（否则跟「绝不剧透」自相矛盾）', /后面的几段原文也给你了/.test(E.前2后3.人设), E.前2后3.人设.slice(-120));
    ok('没给后文时不说那句话', !/后面的几段原文也给你了/.test(E.前2段.人设));
    ok('只带记忆表：有人物表、没有前情摘要', E.只带表.人物表 && !E.只带表.前情摘要, JSON.stringify(E.只带表));
    ok('只带摘要：有前情摘要、没有人物表', E.只带摘要.前情摘要 && !E.只带摘要.人物表, JSON.stringify(E.只带摘要));
    ok('两个都关：一样都不发', !E.都不带.表格摘要, JSON.stringify(E.都不带));
    ok('前文问答那一栏搬进面板后照样管用', E.带前文问答.前文问答);
    eq('⚠️按书各记一份：换本书回到默认（全章），换回来自己那份还在',
        [E.这本书, E.另一本书, E.换回来还在], [10, -1, 10]);
    eq('普通提问和背景追问仍是两套，各记各的', E.两套互不干扰, { 普通: -1, 背景: 1 });

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
