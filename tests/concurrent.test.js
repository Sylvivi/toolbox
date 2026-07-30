/* 共读提问「可并发」的回归测试（2026-07-30 加）。
 *
 * 起因：用户报「阅读的时候，如果有背景知识在生成、或者共读提问在生成，我就没办法
 * 对其他段落进行双击，总是要等它们生成完才可以。像我在翻译模式下，就可以同时翻译
 * 不同段落来着」。
 *
 * 两个根因，缺一不可（只修一个，她照样会撞上另一个）：
 *   ① 一把全局锁 readingCommenting，readingOnParaClick 第一行就把双击挡回去；
 *   ② 正在生成的小气泡当初是手工 insertBefore 进 DOM 的、**不属于渲染数据**，
 *      标背景那种「边标边整条重渲」的循环一过，气泡连同刚弹出来的提问条一起被抹掉。
 *
 * 所以这套测试守两件事：**同时能开几笔**，以及**重渲之后它们还在**。
 * 改动共读提问/点评/渲染时必跑。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 一章 40 段的书，够在相隔很远的两段上分别提问
function bootBook() {
    const body = []; for (let i = 1; i <= 40; i++) body.push('第' + i + '段：' + '正'.repeat(60));
    const book = { id: 'bk_c', fileName: '并发测试书.txt', fileSize: 7, chapters: [{ title: '第一章', body: body.join('\n') }] };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === 'bk_c' ? book : null);
    window.getKeyItemById = () => ({ id: 'p1', url: 'https://x/v1', key: 'k' });
    window.chatSelectedModel = 'm1';
    window.chatResolveReadingModel = () => null;
    window.chatMemoryTables = null;
    window.chatCompressSummaries = [];
    document.getElementById('chatModalOverlay').classList.add('show');
    window.readerBookId = 'bk_c'; window.readerChapterIdx = 0;
    window.chatReaderMode = true; window.chatReadingMode = true;
    window.chatCurrentConvId = 'reader_bk_c';
    window.chatMessages = readerChapterPair(book.chapters[0], 0);
    chatRenderAllMessages(false);
    return chatMessages.findIndex(m => m && m.readerChapter === 0);
}

/* 可控的假模型：每笔请求挂在 window._gates[标记] 上，测试想让它出字/收尾时再放行。
   认 signal，好让「停止」这条路测得出来。 */
function installFakeStream() {
    // 清场：上一组故意挂着不放行的请求会一直留在 readingPending 里，不清就跨组累加、
    // 后面每组的计数全对不上（第一版测试就是这么红的，不是代码的毛病）
    while (readingPending.length) readingRemovePending(readingPending[0].id);
    window._gates = {};
    window._calls = [];
    window.chatStreamChat = function (o) {
        const tag = 'c' + (window._calls.length + 1);
        window._calls.push({ tag, purpose: o.purpose });
        return new Promise((resolve, reject) => {
            window._gates[tag] = {
                delta: (t) => o.onDelta && o.onDelta(t),
                done: (t) => resolve(t)
            };
            if (o.signal) {
                o.signal.addEventListener('abort', () => {
                    const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
                });
            }
        });
    };
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._bootBook=' + bootBook + ';window._installFakeStream=' + installFakeStream + ';' });

    /* ── A 组：一段在生成时，双击别的段落照样有反应 ──────────────────
     * 这就是用户报的那句话本身。锁一旦加回来，A1 立刻红。 */
    const A = await page.evaluate(async () => {
        const mi = window._bootBook();
        window._installFakeStream();
        readingAskOne(mi, 10, '第十段怎么讲？', null);          // 故意不 await：让它一直挂着
        await new Promise(r => setTimeout(r, 50));
        const out = { 第一笔在跑: readingPending.length };
        // 双击第 20 段
        const p20 = document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="20"]');
        readingOnParaClick(p20);
        out.提问条弹出来了 = !!document.querySelector('.reading-actbar');
        out.第二段被选中 = p20.classList.contains('rp-active');
        // 在第 20 段也发一笔
        const input = document.querySelector('.reading-actbar .rp-ask');
        input.value = '第二十段呢？';
        document.querySelector('.reading-actbar .rp-ask-send').click();
        await new Promise(r => setTimeout(r, 80));
        out.同时在跑的笔数 = readingPending.length;
        out.气泡数 = document.querySelectorAll('.rd-stream-bq').length;
        out.气泡挂的段号 = [...document.querySelectorAll('.chat-msg.ai .reading-merged > *')]
            .reduce((acc, el, i, arr) => {
                if (el.classList.contains('rd-stream-bq')) {
                    for (let j = i - 1; j >= 0; j--) if (arr[j].tagName === 'P') { acc.push(arr[j].getAttribute('data-p')); break; }
                }
                return acc;
            }, []);
        return out;
    });
    eq('第一笔正在跑', A.第一笔在跑, 1);
    ok('⚠️生成期间双击别的段落仍弹出提问条（用户报的就是这条）', A.提问条弹出来了, JSON.stringify(A));
    ok('被双击的那一段亮起来', A.第二段被选中);
    eq('两笔可以同时跑（翻译模式一直如此，共读现在也是）', A.同时在跑的笔数, 2);
    eq('两个气泡同时在页面上', A.气泡数, 2);
    eq('气泡各自挂在自己那一段下面，没串位', A.气泡挂的段号, ['10', '20']);

    /* ── B 组：两笔各自收尾，互不干扰 ───────────────────────────── */
    const B = await page.evaluate(async () => {
        const mi = window._bootBook();
        window._installFakeStream();
        const p1 = readingAskOne(mi, 5, '甲问题', null);
        await new Promise(r => setTimeout(r, 30));
        const p2 = readingAskOne(mi, 25, '乙问题', null);
        await new Promise(r => setTimeout(r, 30));
        const out = {};
        // 让第二笔先出字、先收尾——后发的先到，最容易暴露「两笔共用一个状态」的毛病
        window._gates.c2.delta('乙答案正在出');
        await new Promise(r => setTimeout(r, 30));
        out.乙出字后甲仍是占位 = !!document.querySelector('.rd-stream-bq.rd-pending');
        out.乙的气泡不再是占位 = document.querySelectorAll('.rd-stream-bq').length === 2
            && document.querySelectorAll('.rd-stream-bq.rd-pending').length === 1;
        window._gates.c2.done('乙的最终答案');
        await p2;
        out.乙收尾后还剩 = readingPending.length;
        out.甲的气泡还在 = !!document.querySelector('.rd-stream-bq');
        window._gates.c1.done('甲的最终答案');
        await p1;
        out.全收尾后 = readingPending.length;
        out.没有残留气泡 = document.querySelectorAll('.rd-stream-bq').length === 0;
        const c = chatMessages[chatMessages.indexOf(chatMessages.find(m => m && m.readerChapter === 0))].content;
        out.正文里两条都在 = /\[P5\] 汐：甲问题\n甲的最终答案/.test(c) && /\[P25\] 汐：乙问题\n乙的最终答案/.test(c);
        return out;
    });
    ok('后发的先出字时，先发的那个仍老实显示「思考中…」', B.乙出字后甲仍是占位 && B.乙的气泡不再是占位, JSON.stringify(B));
    eq('一笔收尾后另一笔还在跑', B.乙收尾后还剩, 1);
    ok('先发那笔的气泡没被后发那笔的收尾重渲抹掉', B.甲的气泡还在);
    eq('全部收尾后记录清空', B.全收尾后, 0);
    ok('收尾后没有残留的临时气泡', B.没有残留气泡);
    ok('两条问答都正确写进了正文（各归各段）', B.正文里两条都在, JSON.stringify(B));

    /* ── C 组：整条重渲不会把「正在生成」和「提问条」冲掉 ──────────
     * ⚠️这一组守的是那个真正的病根。标背景每讲完一条就 readingRerenderMsg(mi) 一次，
     * 老写法下这一下就把手工插进去的气泡和刚弹出的输入框一起抹了——表现就是
     * 「标背景的时候双击没用」。把气泡改回手工 insertBefore，C1/C3 立刻红。 */
    const C = await page.evaluate(async () => {
        const mi = window._bootBook();
        window._installFakeStream();
        readingAskOne(mi, 12, '丙问题', null);
        await new Promise(r => setTimeout(r, 40));
        window._gates.c1.delta('丙答案出了一半');
        await new Promise(r => setTimeout(r, 30));
        // 在别的段落开着提问条、还打了一半的字
        const p30 = document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="30"]');
        readingOnParaClick(p30);
        document.querySelector('.reading-actbar .rp-ask').value = '打了一半的问题';
        // 模拟标背景插进来一条：改正文 + 整条重渲
        chatMessages[mi].content += '\n[P3] 汐：背景：某某\n某某是……';
        readingRerenderMsg(mi);
        await new Promise(r => setTimeout(r, 30));
        return {
            气泡还在: document.querySelectorAll('.rd-stream-bq').length,
            气泡里还是刚才那半截: /丙答案出了一半/.test(document.querySelector('.rd-stream-bq') ? document.querySelector('.rd-stream-bq').textContent : ''),
            提问条还在: !!document.querySelector('.reading-actbar'),
            打的字还在: (document.querySelector('.reading-actbar .rp-ask') || {}).value,
            那一段还亮着: !!document.querySelector('.reading-merged p[data-p="30"].rp-active'),
            背景块也画出来了: !!document.querySelector('blockquote[data-cp="3"][data-bg="1"]'),
            记录仍在跑: readingPending.length
        };
    });
    eq('⚠️整条重渲后，正在生成的气泡还在（标背景边标边重渲的那条路）', C.气泡还在, 1);
    ok('重渲后气泡里已经出的字没丢（partial 存在记录里，不靠 DOM）', C.气泡里还是刚才那半截, JSON.stringify(C));
    ok('⚠️重渲后提问条还在（否则「标背景时双击没用」原样复发）', C.提问条还在, JSON.stringify(C));
    eq('重渲后打了一半的字还在，不用重打', C.打的字还在, '打了一半的问题');
    ok('重渲后那一段仍是选中态', C.那一段还亮着);
    ok('重渲本身有效：新插的背景块画出来了', C.背景块也画出来了);
    eq('重渲不影响进行中的记录', C.记录仍在跑, 1);

    /* ── D 组：同一段不许重复发（手滑双击两次 / 以为没反应又点一次） ── */
    const D = await page.evaluate(async () => {
        const mi = window._bootBook();
        window._installFakeStream();
        readingAskOne(mi, 8, '丁问题', null);
        await new Promise(r => setTimeout(r, 40));
        await readingAskOne(mi, 8, '丁问题再来一次', null);
        await new Promise(r => setTimeout(r, 30));
        return { 笔数: readingPending.length, 请求数: window._calls.length };
    });
    eq('同一段重复发被挡下（只有一笔在跑）', D.笔数, 1);
    eq('也没有真的把第二个请求发出去（不白扣费）', D.请求数, 1);

    /* ── E 组：「停止」只掐自己那一笔 ───────────────────────────── */
    const E = await page.evaluate(async () => {
        const mi = window._bootBook();
        window._installFakeStream();
        readingAskOne(mi, 6, '戊问题', null);
        await new Promise(r => setTimeout(r, 30));
        readingAskOne(mi, 16, '己问题', null);
        await new Promise(r => setTimeout(r, 40));
        const bqs = [...document.querySelectorAll('.rd-stream-bq')];
        const 第一个的id = bqs[0].getAttribute('data-pid');
        bqs[0].querySelector('.rd-stream-stop').click();   // 停掉第一笔
        await new Promise(r => setTimeout(r, 60));
        return {
            还剩: readingPending.length,
            剩下的不是被停的那个: readingPending[0] && String(readingPending[0].id) !== 第一个的id,
            气泡数: document.querySelectorAll('.rd-stream-bq').length,
            正文没被写进去: !/戊问题/.test(chatMessages[mi].content)
        };
    });
    eq('停止只掐一笔，另一笔照跑', E.还剩, 1);
    ok('留下的确实是没被点停的那一笔', E.剩下的不是被停的那个, JSON.stringify(E));
    eq('被停那笔的气泡收掉了', E.气泡数, 1);
    ok('中止的那笔不会往正文里写东西', E.正文没被写进去);

    /* ── F 组：派生量 readingCommenting 仍然可用 ────────────────────
     * 后台压缩用 _waitIfStreaming 让路，它读的就是这个布尔。改成 pending 列表之后
     * 必须保持同义，否则后台任务会在用户等答案时抢网。 */
    const F = await page.evaluate(async () => {
        const mi = window._bootBook();
        window._installFakeStream();
        const out = { 开跑前: readingCommenting };
        const p = readingAskOne(mi, 7, '庚问题', null);
        await new Promise(r => setTimeout(r, 40));
        out.跑起来后 = readingCommenting;
        window._gates.c1.done('庚答案');
        await p;
        out.收尾后 = readingCommenting;
        return out;
    });
    eq('没在跑时为 false', F.开跑前, false);
    eq('有笔在跑时为 true（_waitIfStreaming 靠它让路）', F.跑起来后, true);
    eq('全收尾后回到 false', F.收尾后, false);

    /* ── G 组：标背景运行中不再挡住提问 ───────────────────────────── */
    const G = await page.evaluate(async () => {
        const mi = window._bootBook();
        window._installFakeStream();
        window.readerBgRunning = true;      // 假装正在标背景
        await new Promise(r => setTimeout(r, 10));
        const p20 = document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="20"]');
        readingOnParaClick(p20);
        const 弹出来了 = !!document.querySelector('.reading-actbar');
        document.querySelector('.reading-actbar .rp-ask').value = '标背景期间也想问';
        document.querySelector('.reading-actbar .rp-ask-send').click();
        await new Promise(r => setTimeout(r, 60));
        const out = { 弹出来了, 发出去了: readingPending.length };
        window.readerBgRunning = false;
        return out;
    });
    ok('标背景跑着的时候，双击照样弹提问条', G.弹出来了, JSON.stringify(G));
    eq('标背景跑着的时候，提问也发得出去', G.发出去了, 1);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) {
        if (r.pass) console.log('  ✅ ' + r.name);
        else { bad++; console.log('  ❌ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
    }
    console.log((bad ? '❌ ' : '✅ ') + (results.length - bad) + '/' + results.length + ' 通过');
    process.exit(bad ? 1 : 0);
})();
