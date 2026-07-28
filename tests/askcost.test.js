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
    eq('背景追问的分块照实记（没有记忆表/摘要那两块）', Object.keys(D.背景.分块).sort(),
        ['人设+指令', '前后三段原文', '我的问题', '背景讲解'].sort());
    eq('双击普通问答块：老路一字不变，仍记「共读提问」', D.普通.环节, '共读提问');
    ok('双击普通问答块：记忆表和摘要照样带（没误伤）', D.普通.带了记忆表或摘要);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
