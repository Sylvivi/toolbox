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
    await page.waitForTimeout(6000);   // 应用启动会自己跳一次，等它稳下来
    await page.addScriptTag({ content: 'window._bootNovel=' + bootNovel + ';window._bootSocial=' + bootSocial + ';' });
    // 手势那几组会把 readerMarkBg/readingAskOne 换成记录器；先存一份真的，后面要用时换回来
    await page.evaluate(() => { window._realMarkBg = window.readerMarkBg; window._realAskOne = window.readingAskOne; });

    /* ── A 组：参数护栏（这些数字改回去过一次，代价是用户白花钱） ───────────── */
    const A = await page.evaluate(async () => {
        const grab = async (which) => {
            let opts = null;
            window.readerBgAbort = new AbortController();
            window.chatStreamChat = (o) => { opts = o; return Promise.resolve('P1|甲'); };
            if (which === 'scan') await _rdBgScan({ title: 't' }, ['正文一', '正文二'], [], { model: 'c' }, { model: 'm' });
            else await _rdBgExplain({ title: 't' }, ['一', '二', '三'], { p: 2, term: '甲' }, { model: 'm' });
            return opts;
        };
        return { scan: (await grab('scan')).max_tokens, explain: (await grab('explain')).max_tokens };
    });
    ok('找点 max_tokens ≥ 4000（思考型模型光"想"就能把 800 花光，正文一字不吐）', A.scan >= 4000, '实际 ' + A.scan);
    ok('讲解 max_tokens ≥ 4000（700 卡在边界上＝第 1 条成、后面全空）', A.explain >= 4000, '实际 ' + A.explain);

    /* ── B 组：讲解人设按书种走 ───────────────────────────────────────── */
    const B = await page.evaluate(async () => {
        const one = async (social) => {
            const b = { title: 'x', _fileKey: 'persona-test|1' };
            localStorage.removeItem('reading_book_kind');
            if (social) rbSetBookKind('persona-test|1', 'social');
            let sys = '';
            window.readerBgAbort = new AbortController();
            window.chatStreamChat = (o) => { sys = o.messages[0].content; return Promise.resolve('讲解'); };
            await _rdBgExplain(b, ['一', '二', '三'], { p: 2, term: '甲' }, { model: 'm' });
            return sys;
        };
        const novel = await one(false), social = await one(true);
        localStorage.removeItem('reading_book_kind');
        return {
            novelSaysNovel: novel.indexOf('我在读小说') >= 0,
            novelNoSocialLine: novel.indexOf('我读的是社会学') < 0,
            novelNoSpoiler: novel.indexOf('别提到我还没读到的后续剧情') >= 0,
            socialSaysSocial: social.indexOf('我读的是社会学') >= 0,
            noCommentPersona: !/伏笔|男生子|家族树/.test(novel + social),
            bothHaveInstr: novel.indexOf('讲清楚这一个背景点') >= 0 && social.indexOf('讲清楚这一个背景点') >= 0
        };
    });
    ok('小说书：人设说"我在读小说"', B.novelSaysNovel);
    ok('小说书：不再冒出"我读的是社会学…不是小说"', B.novelNoSocialLine);
    ok('小说书：带"别剧透后面剧情"', B.novelNoSpoiler);
    ok('社科书：仍用社科人设', B.socialSaysSocial);
    ok('两种都没混进共读点评人设（伏笔/男生子/家族树）', B.noCommentPersona);
    ok('两种都带着讲解任务说明', B.bothHaveInstr);

    /* ── C 组：第一遍扫描 ─────────────────────────────────────────────── */
    const C = await page.evaluate(async () => {
        const scan = async (out, done, range) => {
            window.readerBgAbort = new AbortController();
            window.chatStreamChat = () => Promise.resolve(out);
            return await _rdBgScan({ title: 't' }, ['一', '二', '三', '四', '五', '六'], done || [], { model: 'c' }, { model: 'm' }, range);
        };
        const out = {};
        // 模型爱加列表符号/编号/加粗/中文冒号，严格只认 "P7|词" 会整轮解析不出东西
        out.tolerant = (await scan('- P1|甲\n2. **P2**｜乙\nＰ3：丙\np4|**丁**', [])).picks.map(x => x.p + x.term);
        out.dedup = (await scan('P1|甲\nP2|乙', ['甲'])).picks.map(x => x.term);
        out.inRange = (await scan('P1|章首\nP4|节内\nP9|越界', [], { from: 3, to: 5 })).picks.map(x => x.p);
        // 摘要模型多半配在另一个中转站，它挂了不该让整个功能报废
        let tried = [];
        window.readerBgAbort = new AbortController();
        window.chatStreamChat = (o) => { tried.push(o.model); return o.model === 'c' ? Promise.reject(new Error('超时')) : Promise.resolve('P1|甲'); };
        out.fallback = { tried: tried, picks: (await _rdBgScan({ title: 't' }, ['一'], [], { model: 'c' }, { model: 'm' })).picks.length };
        out.fallback.tried = tried;
        // 用户按「停止」不该触发回退（白烧一遍）
        let tried2 = [];
        window.readerBgAbort = new AbortController();
        window.chatStreamChat = (o) => { tried2.push(o.model); const e = new Error('stop'); e.name = 'AbortError'; return Promise.reject(e); };
        try { await _rdBgScan({ title: 't' }, ['一'], [], { model: 'c' }, { model: 'm' }); out.abortThrew = false; } catch (e) { out.abortThrew = e.name === 'AbortError'; }
        out.abortTried = tried2;
        // 回退模型跟主模型是同一个 → 重试没有意义
        let tried3 = [];
        window.readerBgAbort = new AbortController();
        window.chatStreamChat = (o) => { tried3.push(o.model); return Promise.reject(new Error('挂了')); };
        try { await _rdBgScan({ title: 't' }, ['一'], [], { model: 'same' }, { model: 'same' }); } catch (e) {}
        out.sameTried = tried3;
        return out;
    });
    eq('清单解析容错（- / 1. / ** / ：/ 全角Ｐ / 小写p 都要认）', C.tolerant, ['1甲', '2乙', '3丙', '4丁']);
    eq('跨章去重：讲过的词滤掉', C.dedup, ['乙']);

    /* 去重要认得出"同一个词的不同写法"，否则同一个背景被讲两遍、扣两次费 */
    const C2 = await page.evaluate(async () => {
        const scan = async (out, done) => {
            window.readerBgAbort = new AbortController();
            window.chatStreamChat = () => Promise.resolve(out);
            return (await _rdBgScan({ title: 't' }, ['一', '二', '三'], done, { model: 'c' }, { model: 'm' })).picks.map(x => x.term);
        };
        return {
            括号注解: await scan('P1|共济会（Freemasonry）\nP2|大陆会议', ['共济会']),
            书名号: await scan('P1|《联邦党人文集》', ['联邦党人文集']),
            大小写: await scan('P1|Freemasonry', ['freemasonry']),
            空格中点: await scan('P1|圣 巴托罗缪 之夜', ['圣巴托罗缪之夜']),
            同轮变体: await scan('P1|共济会\nP2|共济会（Freemasonry）', []),
            // ⚠️反向保护：包含关系**不算**重复，否则「宪法」讲过就再也讲不了「美国宪法」
            包含不算重复: await scan('P1|美国独立战争', ['独立战争']),
            显示的是原样: await scan('P1|共济会（Freemasonry）', [])
        };
    });
    eq('去重认得「共济会（Freemasonry）」＝「共济会」', C2.括号注解, ['大陆会议']);
    eq('去重认得书名号', C2.书名号, []);
    eq('去重不分英文大小写', C2.大小写, []);
    eq('去重忽略空格/中点', C2.空格中点, []);
    eq('同一轮里的不同写法也只留一条', C2.同轮变体, ['共济会']);
    eq('包含关系不当成重复（「宪法」讲过≠「美国宪法」不用讲）', C2.包含不算重复, ['美国独立战争']);
    eq('归一化只用于比对，显示仍是模型给的原样', C2.显示的是原样, ['共济会（Freemasonry）']);
    eq('按小节标时：区间外的段号丢弃（否则块会插到别的节去）', C.inRange, [4]);
    eq('摘要模型挂了 → 自动换主模型再试', C.fallback.tried, ['c', 'm']);
    ok('回退后照样拿到清单', C.fallback.picks === 1, '实际 ' + C.fallback.picks + ' 条');
    ok('用户按停止 → 抛 AbortError，不回退', C.abortThrew && C.abortTried.length === 1, JSON.stringify(C.abortTried));
    ok('回退模型＝主模型 → 不重试（免得白烧一遍）', C.sameTried.length === 1, JSON.stringify(C.sameTried));

    /* ── D 组：空清单必须分四种报（混为一谈＝用户反复重标、每轮整章重喂） ──── */
    const D = await page.evaluate(async () => {
        const say = async (out, done) => {
            window.readerBgAbort = new AbortController();
            window.chatStreamChat = () => Promise.resolve(out);
            const s = await _rdBgScan({ title: 't' }, ['一', '二', '三'], done || [], { model: 'c' }, { model: 'm' });
            const raw = s.replies.join('\n').trim();
            if (s.picks.length) return '有 ' + s.picks.length + ' 条';
            if (s.matched) return '都已讲过';
            if (!raw) return '一个字没回';
            if (/^无[。.\s]*$/.test(raw)) return '确实没有';
            return '没按格式';
        };
        return {
            都已讲过: await say('P1|甲\nP2|乙', ['甲', '乙']),
            一个字没回: await say('', []),
            确实没有: await say('无', []),
            没按格式: await say('这一章没有特别的历史背景。', []),
            正常: await say('P1|甲', [])
        };
    });
    eq('空清单·词全被去重滤掉 → 说"都已讲过"（曾误报成"没按格式"、冤枉模型）', D.都已讲过, '都已讲过');
    eq('空清单·模型一个字没回 → 单独一种（多半是 max_tokens 被思考吃光）', D.一个字没回, '一个字没回');
    eq('空清单·模型说"无" → 确实没有', D.确实没有, '确实没有');
    eq('空清单·模型答非所问 → 说"没按格式"', D.没按格式, '没按格式');
    eq('有新词时照常走讲解', D.正常, '有 1 条');

    /* ── E 组：端到端，块必须真的插进正文 ────────────────────────────── */
    const e2e = async (stubSrc) => await page.evaluate(async (src) => {
        window._bootNovel();
        eval('(' + src + ')()');
        await readerMarkBg('bk_t', 0);
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        const el = document.querySelector('.chat-msg.ai[data-idx="' + mi + '"]');
        return {
            正文里的块: el ? el.querySelectorAll('blockquote[data-cp]').length : -1,
            存进reader_qa的: readerBgOfChap(readerBookKey('bk_t'), 0).length,
            提示: window._toasts.join(' | ')
        };
    }, stubSrc);

    const E1 = await e2e((() => {
        window.chatStreamChat = (o) => Promise.resolve(
            o.purpose === '标背景·找点' ? 'P2|共济会\nP5|大陆会议\nP9|邦联条例' : '这是讲解内容。');
    }).toString());
    ok('三条全成功：正文里真的有 3 块', E1.正文里的块 === 3, JSON.stringify(E1));
    ok('三条全成功：reader_qa 也存了 3 条（存了没渲染 vs 没存，是两种病）', E1.存进reader_qa的 === 3, JSON.stringify(E1));

    const E2 = await e2e((() => {
        let n = 0;
        window.chatStreamChat = (o) => {
            if (o.purpose === '标背景·找点') return Promise.resolve('P2|甲\nP5|乙\nP9|丙');
            n++; return Promise.resolve(n <= 1 ? '第一条讲解。' : '');   // 用户实测：第 1 条成，后面全空
        };
    }).toString());
    ok('讲解回空必须报出来，不能静默（钱扣了却看不出为什么）', /没成功|失败|没回|思考/.test(E2.提示), JSON.stringify(E2));
    ok('讲解回空时不假装成功：插入数＝真正成功的条数', E2.正文里的块 === E2.存进reader_qa的, JSON.stringify(E2));

    /* 间歇性失败要扛得住：第 1 条成、后面连挂，正是"连着猛发"的形状 */
    const R = await page.evaluate(async () => {
        window._bootNovel();
        const out = {};
        // 每条第 1 次都挂、第 2 次才成 → 三次退避应当全部救回来
        let n = 0;
        window.chatStreamChat = (o) => {
            if (o.purpose === '标背景·找点') return Promise.resolve('P2|甲\nP5|乙\nP9|丙');
            n++;
            return (n % 2 === 1) ? Promise.reject(new Error('HTTP 429: too many requests')) : Promise.resolve('讲解内容。');
        };
        const t0 = Date.now();
        await readerMarkBg('bk_t', 0);
        out.耗时秒 = Math.round((Date.now() - t0) / 1000);
        out.成功条数 = readerBgOfChap(readerBookKey('bk_t'), 0).length;
        out.提示 = window._toasts[window._toasts.length - 1];

        // 三次全挂 → 才算这条失败，且提示要说得出原因
        window._bootNovel();
        window.chatStreamChat = (o) => o.purpose === '标背景·找点'
            ? Promise.resolve('P2|甲') : Promise.reject(new Error('HTTP 500: 中转站炸了'));
        await readerMarkBg('bk_t', 0);
        out.全挂时提示 = window._toasts[window._toasts.length - 1];
        return out;
    });
    ok('单条偶发失败能被退避重试救回来（限流时等更久）', R.成功条数 === 3, JSON.stringify(R));
    ok('限流退避真的等了（不是空转重试）', R.耗时秒 >= 8, '实际 ' + R.耗时秒 + ' 秒');
    ok('三次全挂才算失败，且提示带原因', /没成功|失败/.test(R.全挂时提示 || '') && /500/.test(R.全挂时提示 || ''), JSON.stringify(R));

    /* 失败提示不许 2 秒就溜走——那是"钱花了却没拿到东西"时唯一的解释 */
    const E2b = await page.evaluate(async () => {
        window._bootNovel();
        let sticky = null;
        const orig = window.showToast;
        window.showToast = (m, s) => { sticky = { msg: m, sticky: !!s }; return orig(m, s); };
        window.chatStreamChat = (o) => Promise.resolve(o.purpose === '标背景·找点' ? 'P2|甲\nP5|乙' : '');
        await readerMarkBg('bk_t', 0);
        const fail = sticky;
        // 成功的提示照旧自动消失
        window.chatStreamChat = (o) => Promise.resolve(o.purpose === '标背景·找点' ? 'P3|丙' : '讲解');
        await readerMarkBg('bk_t', 0);
        return { 失败提示: fail, 成功提示: sticky };
    });
    ok('失败提示是 sticky（不会 2 秒就消失）', E2b.失败提示 && E2b.失败提示.sticky === true, JSON.stringify(E2b));
    ok('成功提示照旧自动消失', E2b.成功提示 && E2b.成功提示.sticky === false, JSON.stringify(E2b));

    /* 空回复要说清是"思考吃光了"还是"真的一个字没回" */
    const E2c = await page.evaluate(async () => {
        const run = async (thinkLen) => {
            window.readerBgAbort = new AbortController();
            window.chatStreamChat = () => { chatStreamChat._lastThinkLen = thinkLen; return Promise.resolve(''); };
            chatStreamChat._lastThinkLen = thinkLen;
            try { await _rdBgExplain({ title: 't' }, ['一', '二', '三'], { p: 2, term: '甲' }, { model: 'm' }); return '没抛错'; }
            catch (e) { return e.message; }
        };
        return { 思考吃光: await run(3200), 真的没回: await run(0) };
    });
    ok('只吐思考过程 → 说清是模型在"想"，并建议换模型', /思考过程/.test(E2c.思考吃光) && /3200/.test(E2c.思考吃光), JSON.stringify(E2c));
    ok('一个字没回 → 说清是中转站/模型的问题，别误导成额度不够', /一个字都没回/.test(E2c.真的没回), JSON.stringify(E2c));

    const E3 = await e2e((() => {
        window.chatStreamChat = (o) => Promise.resolve(o.purpose === '标背景·找点' ? '无' : '讲解');
    }).toString());
    ok('模型说"无" → 提示是"没有新的背景"，不是报错', /没有新的背景/.test(E3.提示), JSON.stringify(E3));

    /* ── F 组：按小节标 + 目录段号 ───────────────────────────────────── */
    const F = await page.evaluate(async () => {
        const book = window._bootSocial();
        const ranges = rbSectionRanges(book, 0);
        const out = { 节数: ranges.length, 第二节: ranges[1] ? ('P' + ranges[1].startP + '~' + ranges[1].endP) : null };
        // 目录算出来的小标题段号，必须跟阅读器实际渲染的段号一致（曾差 1，点小节停在上一节末尾）
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        const el = document.querySelector('.chat-msg.ai[data-idx="' + mi + '"]');
        out.对得上 = ranges.every(function (r) {
            const p = el.querySelector('p[data-p="' + r.p + '"]');
            return p && p.textContent.trim().indexOf(r.title) === 0;
        });
        window.chatStreamChat = (o) => o.purpose === '标背景·找点'
            ? Promise.resolve('P2|导语里的词\nP6|上一节的词\nP15|本节的词')   // 前两个都在第 2 节之外
            : Promise.resolve('讲解。');
        await readerMarkBg('bk_s', 0, ranges[1].p);
        // ⚠️必须重新查一次：插入会整段重渲，上面那个 el 已经是被换掉的旧节点（查它永远是空的）
        const el2 = document.querySelector('.chat-msg.ai[data-idx="' + mi + '"]');
        out.插入段号 = [].slice.call(el2.querySelectorAll('blockquote[data-cp]')).map(x => +x.getAttribute('data-cp'));
        return out;
    });
    ok('社科书认出了 2 个小节', F.节数 === 2, JSON.stringify(F));
    ok('目录算的小节段号 = 阅读器实际段号（章节标题占掉 P1，曾差 1）', F.对得上, JSON.stringify(F));
    eq('只标第 2 节：节外的段号一个都不插', F.插入段号, [15]);

    /* ── G 组：进度条不许挡住常用按钮 ───────────────────────────────── */
    const G = await page.evaluate(async () => {
        window._bootNovel();
        _rdBgBarShow('讲第 3/12 条：共济会');
        const bar = document.getElementById('rdBgBar');
        const cl = document.querySelector('.clawd-model-btn');
        const R = (el) => el.getBoundingClientRect();
        const out = {
            z: +getComputedStyle(bar).zIndex,
            barTop: Math.round(R(bar).top),
            barBottom: Math.round(R(bar).bottom),
            clawdTop: Math.round(R(cl).top),
            贴在上半屏: R(bar).bottom < window.innerHeight / 2,
            点得到clawd: document.elementFromPoint(R(cl).left + R(cl).width / 2, R(cl).top + R(cl).height / 2) === cl
                || cl.contains(document.elementFromPoint(R(cl).left + R(cl).width / 2, R(cl).top + R(cl).height / 2)),
            停止点得到: (() => { const s = R(bar.querySelector('.rd-bg-stop')); const h = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2); return !!(h && h.classList.contains('rd-bg-stop')); })(),
            文字没被截: bar.querySelector('.rd-bg-txt').scrollWidth <= bar.querySelector('.rd-bg-txt').clientWidth + 1
        };
        // 顶栏收起/展开会让阅读区上下移 51px，条子要跟着走，否则会压住顶栏
        const area = document.getElementById('chatMessages');
        const real = area.getBoundingClientRect.bind(area);
        area.getBoundingClientRect = () => ({ top: 51, bottom: 718, height: 667, left: 0, right: 390, width: 390 });
        area.dispatchEvent(new Event('scroll'));
        await new Promise(r => setTimeout(r, 30));
        out.跟随阅读区 = Math.round(document.getElementById('rdBgBar').getBoundingClientRect().top);
        area.getBoundingClientRect = real;
        // 反复开关不许积攒监听器 / 留下节点
        for (let i = 0; i < 3; i++) { _rdBgBarHide(); _rdBgBarShow('轮 ' + i); }
        _rdBgBarHide();
        out.收尾残留节点 = !!document.getElementById('rdBgBar');
        out.收尾残留监听 = !!(_rdBgBarPlace && _rdBgBarPlace._on);
        return out;
    });
    ok('进度条 z-index 盖过阅读界面那层 modal（200），否则整条看不见', G.z > 200, '实际 ' + G.z);
    ok('进度条待在上半屏，彻底离开拇指区', G.贴在上半屏, JSON.stringify(G));
    ok('进度条不压住 clawd 按钮（点 clawd 命中 clawd）', G.点得到clawd && G.barBottom < G.clawdTop - 200, JSON.stringify(G));
    ok('「停止」按钮点得到（卡住时这是唯一出口）', G.停止点得到, JSON.stringify(G));
    ok('词名没被截断（条子的意义就是告诉你在标哪个词）', G.文字没被截, JSON.stringify(G));
    ok('顶栏收展时进度条跟着走，不压住顶栏', G.跟随阅读区 === 61, '实际 top=' + G.跟随阅读区 + '（期望 61）');
    ok('反复开关不留残节点 / 不积攒监听器', !G.收尾残留节点 && !G.收尾残留监听, JSON.stringify(G));

    /* ── H 组：正文里的入口（长按「导读」键＝标这一节背景） ─────────────
       用户要「零新增图标」的极简，所以第三态只能靠手势。这组钉住的是：
       短按仍是导读、长按才蓄力、滑开能反悔、打了字长按不接管。 */
    const H = await page.evaluate(async () => {
        const out = {};
        const book = window._bootSocial();
        // 手势测试只关心"调了谁、传了什么"，把两个终点换成记录器
        const calls = [];
        window.readerMarkBg = (id, ci, p) => { calls.push(['bg', id, ci, p]); return Promise.resolve(); };
        window.readingAskOne = (mi, p, q) => { calls.push(['ask', q]); };
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        const para = () => document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="15"]');
        const openBar = () => { readingClearActbar(); readingOnParaClick(para()); return document.querySelector('.reading-actbar'); };
        const pe = (el, type, dx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: 100 + (dx || 0), clientY: 100 }));
        const wait = (ms) => new Promise(r => setTimeout(r, ms));

        let bar = openBar();
        out.按钮初始 = bar.querySelector('.rp-ask-send').textContent;
        out.提示语 = bar.querySelector('.rp-ask').placeholder;

        // ① 短按 → 还是导读
        calls.length = 0;
        let send = bar.querySelector('.rp-ask-send');
        pe(send, 'pointerdown'); await wait(120); pe(send, 'pointerup'); send.click();
        out.短按 = calls.slice();

        // ② 长按到位 → 标签就地变
        bar = openBar(); send = bar.querySelector('.rp-ask-send');
        calls.length = 0;
        pe(send, 'pointerdown'); await wait(600);
        out.蓄力时标签 = send.textContent;
        out.蓄力时高亮 = send.classList.contains('rp-bg-armed');
        pe(send, 'pointerup'); send.click();
        await wait(30);
        out.松手后 = calls.slice();

        // ③ 长按中途滑开 → 反悔
        bar = openBar(); send = bar.querySelector('.rp-ask-send');
        calls.length = 0;
        pe(send, 'pointerdown'); await wait(600);
        pe(send, 'pointermove', 40);          // 手指滑开
        out.滑开后标签 = send.textContent;
        pe(send, 'pointerup'); send.click();
        await wait(30);
        out.滑开后 = calls.slice();

        // ④ 打了字再长按 → 不接管，仍然是讨论
        bar = openBar(); send = bar.querySelector('.rp-ask-send');
        const inp = bar.querySelector('.rp-ask');
        inp.value = '他这句话什么意思'; inp.dispatchEvent(new Event('input'));
        calls.length = 0;
        pe(send, 'pointerdown'); await wait(600);
        out.有字时标签 = send.textContent;
        pe(send, 'pointerup'); send.click();
        await wait(30);
        out.有字时 = calls.slice();
        readingClearActbar();
        return out;
    });
    eq('社科书双击段落，按钮仍是「导读」', H.按钮初始, '导读');
    ok('提示语告诉你有长按这一手', /长按/.test(H.提示语), H.提示语);
    eq('短按 → 还是导读，不会误标背景', H.短按, [['ask', '导读']]);
    eq('按住半秒 → 标签就地变「背景」', H.蓄力时标签, '背景');
    ok('蓄力时按钮高亮（告诉你松手就开始）', H.蓄力时高亮);
    ok('松手 → 开标背景，且传的是双击那一段的段号', H.松手后.length === 1 && H.松手后[0][0] === 'bg' && H.松手后[0][3] === 15, JSON.stringify(H.松手后));
    ok('松手后不会再顺手走一遍导读（pointerup 后面紧跟一个 click）', H.松手后.filter(c => c[0] === 'ask').length === 0, JSON.stringify(H.松手后));
    eq('长按中途滑开 → 标签变回「导读」', H.滑开后标签, '导读');
    eq('长按中途滑开 → 什么都不触发（反悔得掉）', H.滑开后, []);
    eq('输入框有字时长按不接管，标签仍是「讨论」', H.有字时标签, '讨论');
    eq('输入框有字时长按 → 走讨论，不标背景', H.有字时, [['ask', '他这句话什么意思']]);

    /* 长按按钮不许被系统当成"选词复制"（用户实测「偶尔会变成复制选中」） */
    const H3 = await page.evaluate(async () => {
        window._bootSocial();
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        readingClearActbar();
        readingOnParaClick(document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="15"]'));
        const send = document.querySelector('.reading-actbar .rp-ask-send');
        // ⚠️getComputedStyle 返回的是**活对象**：元素之后被重渲染换掉，再读就全是空串。
        //   必须当场取成字符串（第一版栽在这里，报告"样式没生效"其实是节点没了）。
        const cs = getComputedStyle(send);
        const style = { userSelect: cs.userSelect || cs.webkitUserSelect, callout: cs.webkitTouchCallout || '', touchAction: cs.touchAction };
        // 模拟"系统抢在 CSS 之前选中了东西"：选正文段落（按钮本身 user-select:none，选不出内容）
        try {
            const r = document.createRange(); r.selectNodeContents(document.querySelector('.reading-merged p[data-p="15"]'));
            const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        } catch (e) {}
        const before = String(window.getSelection()).length;
        send.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
        await new Promise(r => setTimeout(r, 600));
        const after = String(window.getSelection()).length;
        send.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, clientX: 100, clientY: 100 }));
        readingClearActbar();
        return { userSelect: style.userSelect, callout: style.callout || '(浏览器不支持这个属性)', touchAction: style.touchAction, 选区_长按前: before, 选区_蓄力后: after };
    });
    eq('按钮关掉了文字选中（长按不再变成选词）', H3.userSelect, 'none');
    ok('按钮关掉了 iOS 长按弹出的复制菜单', H3.callout === 'none' || /不支持/.test(H3.callout), H3.callout);
    ok('按钮 touch-action 是 manipulation（去掉双击缩放的等待）', /manipulation/.test(H3.touchAction), H3.touchAction);
    ok('系统抢先选中时，蓄力到位会就地清掉选区', H3.选区_长按前 > 0 && H3.选区_蓄力后 === 0, JSON.stringify(H3));

    /* 小说没有导读，那个空状态本来点了什么都不会发生 → 让给背景，且不用长按 */
    const H2 = await page.evaluate(async () => {
        window._bootNovel();
        const calls = [];
        window.readerMarkBg = (id, ci, p) => { calls.push([id, ci, p]); return Promise.resolve(); };
        window.readingAskOne = (mi, p, q) => { calls.push(['ask', q]); };
        const mi = chatMessages.findIndex(m => m && m.readerChapter === 0);
        readingClearActbar();
        readingOnParaClick(document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="5"]'));
        const bar = document.querySelector('.reading-actbar');
        const send = bar.querySelector('.rp-ask-send');
        const inp = bar.querySelector('.rp-ask');
        const out = { 空着的标签: send.textContent, 提示语: inp.placeholder };

        // 空着点一下 → 直接标背景
        send.click();
        await new Promise(r => setTimeout(r, 30));
        out.空着点一下 = calls.slice();

        // 打字 → 变讨论，走原来的逐段问答
        readingClearActbar();
        readingOnParaClick(document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="5"]'));
        const bar2 = document.querySelector('.reading-actbar');
        const send2 = bar2.querySelector('.rp-ask-send'), inp2 = bar2.querySelector('.rp-ask');
        inp2.value = '他这句什么意思'; inp2.dispatchEvent(new Event('input'));
        out.打字后的标签 = send2.textContent;
        calls.length = 0;
        send2.click();
        await new Promise(r => setTimeout(r, 30));
        out.打字后点 = calls.slice();

        // 清空又变回「背景」
        inp2.value = ''; inp2.dispatchEvent(new Event('input'));
        out.清空后的标签 = send2.textContent;

        // 小说不需要长按（留空点一下就是背景），长按不该再蓄力
        calls.length = 0;
        send2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
        await new Promise(r => setTimeout(r, 600));
        out.长按时的标签 = send2.textContent;
        send2.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 100, clientY: 100 }));
        readingClearActbar();
        return out;
    });
    eq('小说书空着时按钮是「背景」（原来是点了没反应的「讨论」）', H2.空着的标签, '背景');
    ok('小说书提示语说清留空＝背景', /留空＝背景/.test(H2.提示语), H2.提示语);
    ok('小说书空着点一下 → 标整章背景（第 3 参 0）', H2.空着点一下.length === 1 && H2.空着点一下[0][2] === 0, JSON.stringify(H2.空着点一下));
    eq('小说书打字后变「讨论」', H2.打字后的标签, '讨论');
    eq('小说书打字后点 → 走逐段问答，不标背景', H2.打字后点, [['ask', '他这句什么意思']]);
    eq('清空后又变回「背景」', H2.清空后的标签, '背景');
    eq('小说书不需要长按，长按不再蓄力', H2.长按时的标签, '背景');

    /* ⚠️标注途中往上滑会自动补上一章，所有消息下标整体 +2。
       用户实测「三十四章的背景插进了三十三章」，而且这也是「9 条只成 1 条」的真凶。 */
    const P = await page.evaluate(async () => {
        window.readerMarkBg = window._realMarkBg;
        window.readingAskOne = window._realAskOne;
        const out = {};
        // 两章的书：先只载入第 2 章（模拟从目录直接进第 34 章）
        const mk = (n) => { const b = []; for (let i = 1; i <= 10; i++) b.push('第' + n + '章的第' + i + '段正文。'); return b.join('\n'); };
        const book = { id: 'bk_p', fileName: '大唐辟珠记.txt', fileSize: 7, chapters: [
            { title: '第三十三章', body: mk(33) }, { title: '第三十四章', body: mk(34) }] };
        window.rbBooks = [book];
        window.rbGetBook = (id) => id === 'bk_p' ? book : null;
        window.chatResolveCompressModel = () => ({ model: 'scan', baseUrl: 'https://a/v1', apiKey: 'k' });
        window.chatResolveReadingModel = () => ({ model: 'main', baseUrl: 'https://b/v1', apiKey: 'k' });
        window.getKeyItemById = () => ({ id: 'p1', url: 'https://b/v1', key: 'k' });
        window.chatSelectedModel = 'main';
        localStorage.removeItem('reader_qa');
        document.getElementById('chatModalOverlay').classList.add('show');
        readerBookId = 'bk_p'; readerChapterIdx = 1; chatReaderMode = true; chatReadingMode = true;
        chatCurrentConvId = 'reader_bk_p';
        chatMessages = readerChapterPair(book.chapters[1], 1);   // 只有第 34 章
        chatRenderAllMessages(false);

        let n = 0;
        window.chatStreamChat = async (o) => {
            if (o.purpose === '标背景·找点') return 'P2|甲\nP4|乙\nP6|丙';
            n++;
            // ★ 讲完第 1 条之后，模拟用户往上滑触发「补上一章」——下标整体 +2
            if (n === 1) {
                setTimeout(() => {
                    chatMessages = readerChapterPair(book.chapters[0], 0).concat(chatMessages);
                    chatRenderAllMessages(false);
                }, 0);
            }
            return '讲解内容。';
        };
        await readerMarkBg('bk_p', 1);
        const fk = readerBookKey('bk_p');
        out.第34章存了 = readerBgOfChap(fk, 1).length;
        out.第33章被污染 = readerBgOfChap(fk, 0).length;
        const m34 = chatMessages.find(m => m && m.readerChapter === 1);
        const m33 = chatMessages.find(m => m && m.readerChapter === 0);
        out.第34章正文里 = (m34.content.match(/汐：背景：/g) || []).length;
        out.第33章正文里 = (m33.content.match(/汐：背景：/g) || []).length;
        return out;
    });
    eq('补上一章导致下标位移后，3 条仍全部落在第 34 章', P.第34章存了, 3);
    eq('第 33 章一条都没被污染', P.第33章被污染, 0);
    eq('第 34 章的消息正文里也是 3 条', P.第34章正文里, 3);
    eq('第 33 章的消息正文一个字没被动', P.第33章正文里, 0);

    /* ── N 组：车轱辘话（用户 2026-07-28 实测《大唐辟珠记》第 44 章） ──────────
     * 同一段被拆成四条讲：「高门女子悬丝诊脉与帷幔隔诊」「帷幔隔诊」
     * 「丝帕覆腕诊脉是高门女眷就医礼制」「悬丝诊脉与帷幔隔诊礼制」——同一件事说了四遍，
     * 四次扣费、四个块堆在同一段下面。两道闸：同段近义去重 + 每段最多 BG_MAX_PER_PARA 条。 */
    const N = await page.evaluate(async () => {
        // longP: {段号: 这一段多少字} —— 额度是按段落长度给的，短段 1 条、长段最多 3 条
        const scan = async (out, done, donePara, longP) => {
            window.readerBgAbort = new AbortController();
            window.chatStreamChat = () => Promise.resolve(out);
            const lines = [];
            for (let i = 0; i < 25; i++) lines.push('段'.repeat((longP || {})[i + 1] || 10));
            const s = await _rdBgScan({ title: 't' }, lines, done || [], { model: 'c' }, { model: 'm' }, null, donePara);
            return s.picks.map(x => x.p + '|' + x.term);
        };
        return {
            真实案例: await scan('P19|高门女子悬丝诊脉与帷幔隔诊\nP19|帷幔隔诊\nP19|丝帕覆腕诊脉是高门女眷就医礼制\nP19|悬丝诊脉与帷幔隔诊礼制'),
            真实案例2: await scan('P17|绿衣官员\nP17|绿衣官员品级\nP17|绿衣官员指六七品官服颜色为绿色的唐代官服制度\nP17|唐代官服颜色与品级对应'),
            // 反向保护①：不同段里各自的词，一条都不许少
            跨段不受影响: await scan('P3|共济会\nP7|大陆会议\nP11|邦联条例'),
            // 反向保护②：跨段的包含关系仍旧不算重复（C2 组守的那条线）
            跨段包含仍分开: await scan('P3|宪法\nP8|美国宪法'),
            // 反向保护③：两三个字的短词在同一段撞车也不许被吞（「唐」「宋」）
            短词不吞: await scan('P4|唐\nP4|宋'),
            // 重标这一章：这一段已经有背景块了，就别再往上堆第二条
            重标不叠加: await scan('P6|悬丝诊脉\nP9|绿衣官员', ['帷幔隔诊'], [{ p: 6, term: '帷幔隔诊' }]),
            /* ⚠️用户 2026-07-28 提醒：自传/社会学的段落三五百字，一段里真有好几件互不相干的事，
             * 写死「一段 1 条」就是漏。额度按段落长度给。
             * ⚠️2026-08-03 又放宽（120 字/条、封顶 4）：她读讲司马迁的文章时报「一段里有不少
             * 背景点，模型通常只解释一个，还得二次提问」——一段里「太史令」「腐刑」「李陵之祸」
             * 是三件互不相干的事，按老公式 150 字只准 1 条，必然漏两件。
             * 现在：<120 字 1 条、120~239 两条、240~359 三条、≥360 四条封顶。 */
            长段可以多条: await scan('P5|共济会\nP5|大陆会议\nP5|邦联条例', [], null, { 5: 450 }),
            中等长度两条: await scan('P5|共济会\nP5|大陆会议\nP5|邦联条例', [], null, { 5: 150 }),
            短段仍是一条: await scan('P5|共济会\nP5|大陆会议\nP5|邦联条例', [], null, { 5: 80 }),
            密集段能给到四条: await scan('P5|太史令\nP5|腐刑\nP5|李陵之祸\nP5|天汉三年', [], null, { 5: 400 }),
            再长也封顶四条: await scan('P5|甲学派\nP5|乙学派\nP5|丙学派\nP5|丁学派\nP5|戊学派', [], null, { 5: 5000 }),
            // 长段也不许车轱辘：额度变大了，近义那道闸还得管用
            长段仍去车轱辘: await scan('P5|高门女子悬丝诊脉与帷幔隔诊\nP5|帷幔隔诊\nP5|悬丝诊脉与帷幔隔诊礼制\nP5|唐代坊市制度', [], null, { 5: 450 })
        };
    });
    eq('同一段里换四种说法讲同一件事 → 只留一条', N.真实案例, ['19|高门女子悬丝诊脉与帷幔隔诊']);
    eq('「绿衣官员/绿衣官员品级/绿衣官员指…」也只留一条', N.真实案例2, ['17|绿衣官员']);
    eq('不同段的背景点一条不少（近义只在段内比）', N.跨段不受影响, ['3|共济会', '7|大陆会议', '11|邦联条例']);
    eq('跨段的「宪法」和「美国宪法」仍旧分开讲', N.跨段包含仍分开, ['3|宪法', '8|美国宪法']);
    eq('同段里的短词不会被误吞（只是撞了个字）', N.短词不吞.length, 1);   // 短段 1 条的上限
    eq('重标这一章时，已经有背景块的那一段不再加第二条', N.重标不叠加, ['9|绿衣官员']);
    eq('长段（自传/社会学那种）能标 3 条，不会被写死成 1 条', N.长段可以多条, ['5|共济会', '5|大陆会议', '5|邦联条例']);
    eq('中等长度的段落给 2 条', N.中等长度两条, ['5|共济会', '5|大陆会议']);
    eq('短段（小说那种一段一件事）仍旧只给 1 条', N.短段仍是一条, ['5|共济会']);
    // ⚠️这条就是用户那篇司马迁文章的形状：一段里四件互不相干的事，一件都不许漏
    eq('密集段（官职/刑罚/事件/年号）四条都留得住', N.密集段能给到四条, ['5|太史令', '5|腐刑', '5|李陵之祸', '5|天汉三年']);
    eq('再长的段也封顶 4 条（更多就该怀疑模型在重复自己）', N.再长也封顶四条.length, 4);
    eq('长段额度变大后，同一件事的不同说法照样只留一条', N.长段仍去车轱辘, ['5|高门女子悬丝诊脉与帷幔隔诊', '5|唐代坊市制度']);

    /* 进度条点一下能展开清单——用户不想等全部生成完才知道有哪些 */
    const L = await page.evaluate(async () => {
        window.readerMarkBg = window._realMarkBg;      // 前面被换成了记录器，这里要真的跑一轮
        window.readingAskOne = window._realAskOne;
        window._bootNovel();
        const out = {};
        const txt = () => (document.getElementById('rdBgList') || {}).textContent || '';
        let resolveHold, held = new Promise(r => { resolveHold = r; });
        let n = 0;
        window.chatStreamChat = async (o) => {
            if (o.purpose === '标背景·找点') return 'P2|共济会\nP5|大陆会议\nP9|邦联条例';
            n++;
            if (n === 2) await held;           // 卡在第 2 条，方便中途查看状态
            return '讲解内容。';
        };
        const run = readerMarkBg('bk_t', 0);
        // 等清单扫出来
        for (let i = 0; i < 60 && n < 2; i++) await new Promise(r => setTimeout(r, 50));
        const bar = document.getElementById('rdBgBar');
        out.收起时没有清单 = !document.getElementById('rdBgList');
        bar.click();                            // 展开
        out.展开后 = txt();
        out.箭头 = bar.querySelector('.rd-bg-caret').textContent;
        out.清单在条子下方 = document.getElementById('rdBgList').getBoundingClientRect().top
            >= bar.getBoundingClientRect().bottom;
        // 点「停止」不该被当成展开/收起
        const before = !!document.getElementById('rdBgList');
        bar.querySelector('.rd-bg-stop').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        out.点停止不影响清单 = before === !!document.getElementById('rdBgList');
        resolveHold();
        await run;
        out.跑完清单收掉了 = !document.getElementById('rdBgList');
        return out;
    });
    ok('默认收起，不占地方', L.收起时没有清单);
    ok('点一下就能看到这一轮要讲哪些词', /共济会/.test(L.展开后) && /大陆会议/.test(L.展开后) && /邦联条例/.test(L.展开后), L.展开后);
    ok('清单里带进度（第 1 条已完成、第 2 条正在讲、第 3 条待讲）', /✓ 共济会/.test(L.展开后) && /⏳ 大陆会议/.test(L.展开后) && /· 邦联条例/.test(L.展开后), L.展开后);
    ok('顶部写清共几条、已完成几条', /要讲 3 条，已完成 1/.test(L.展开后), L.展开后);
    eq('展开后箭头翻过来', L.箭头, '▴');
    ok('清单贴在条子正下方', L.清单在条子下方);
    ok('点「停止」不会顺手把清单展开/收起', L.点停止不影响清单);
    ok('整轮结束把清单一起收掉', L.跑完清单收掉了);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();

    /* ── 收尾 ─────────────────────────────────────────────────────── */
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
