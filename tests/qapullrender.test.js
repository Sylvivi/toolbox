/* 「另一台设备产生的问答/背景，本机页面开着时能不能自己显示出来」的回归测试。
 *
 * 起因：用户 2026-08-09「两边页面都开着的时候，在一边产生了读痕（问答、背景知识那些），
 * 如果要同步到另一边，总感觉好像需要触发点什么，有时候碰巧能触发，有时候就怎么也触发不了，
 * 刷新也不太能解决」。
 *
 * ⚠️病根不在同步、在渲染：推(readerPersistQA)、拉(readerMergeByChapter)一直都是好的，
 * `readerHydrateLoadedQA`（用同步来的问答重灌正文）也早就写好了——但它**全项目只在
 * chatLoadConv 里调过一次**，也就是只有「打开这本书的会话」那一刻才灌。页面已经开着时，
 * 数据进了 localStorage，屏幕上那份正文快照没人动 → 得退出去再进来才看得见。
 *
 * 这组钉四件事：
 *   ① 拉到新问答后，开着的正文当场就更新（别再退回「只写 localStorage」）
 *   ② 只重渲**内容真的变了**的那几章，没变的不许动（重渲会动提问条和阅读位置）
 *   ③ 流式回答中 / 标背景中一律不插手（那两个过程自己在改同一块 DOM）
 *   ④ 背景知识走的是同一条路（它就是 q 以「背景：」开头的一条问答）
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 造一个「正开着某本书的阅读会话」的现场：两章都已载入，问答区是空的（＝换设备时的旧快照）
function bootReaderConv() {
    // ⚠️每章要有足够多的段落：问答是按 [P段号] 挂在具体某一段下面的，
    // 段号在正文里不存在的话，数据灌进去了、屏幕上却渲不出来（第一版每章只写一段，A4 就假挂在这儿）。
    const paras = (n) => Array.from({ length: 8 }, (_, i) => '第' + n + '章第' + (i + 1) + '段的正文内容。').join('\n\n');
    const book = {
        id: 'bk_q', fileName: '测试书.txt', fileSize: 4321, fileType: 'text',
        chapters: [
            { title: '第一章', body: paras('一') },
            { title: '第二章', body: paras('二') }
        ]
    };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === 'bk_q' ? book : null);
    window.chatReaderMode = true;
    window.chatReadingMode = false;
    window.chatStreaming = false;
    window.readerBgRunning = false;
    window.readerBookId = 'bk_q';
    window.chatCurrentConvId = 'reader_bk_q';
    localStorage.setItem('reader_qa', '{}');
    window.chatMessages = [];
    for (let i = 0; i < 2; i++) {
        const pair = readerChapterPair(book.chapters[i], i);
        chatMessages.push(pair[0], pair[1]);
    }
    // 真渲染出来，好让 readingRerenderMsg 有 DOM 可换
    document.getElementById('chatModalOverlay').style.display = 'flex';
    const cont = document.getElementById('chatMessages');
    cont.innerHTML = '';
    cont.style.height = '600px';
    cont.style.overflowY = 'auto';
    chatAppendMsgRange(cont, 0, chatMessages.length, 0, -1, false);
    return { msgCount: chatMessages.length, aiContents: chatMessages.filter(m => m.readerChapter != null).map(m => m.content) };
}

// 模拟「另一台设备刚推上来、本机刚拉下来」：直接把云端那份合并进 reader_qa
function pullFromCloud(cloudQA) {
    const local = JSON.parse(localStorage.getItem('reader_qa') || '{}');
    const changed = readerMergeByChapter(local, cloudQA);
    if (changed) {
        localStorage.setItem('reader_qa', JSON.stringify(local));
        readerApplyPulledQA();
    }
    return changed;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    await page.goto(APP);
    await page.waitForTimeout(600);
    await page.addScriptTag({ content: 'window.pullFromCloud = ' + pullFromCloud.toString() + ';' });

    const boot = await page.evaluate(bootReaderConv);
    eq('A1 现场就绪：两章、问答区是空的（旧快照）', boot.aiContents, ['', '']);

    // ── A 组：拉到新问答 → 开着的正文当场更新 ────────────────────────
    const a = await page.evaluate(() => {
        const changed = pullFromCloud({
            '测试书.txt|4321': { '1': { list: [{ p: 3, q: '这段什么意思', a: '意思是这样那样' }], ts: 9999 } }
        });
        const ai = chatMessages.filter(m => m.readerChapter != null).map(m => m.content);
        const dom = document.querySelector('.chat-msg.ai[data-idx="3"]');
        return { changed, ai, domHasQ: !!(dom && dom.textContent.indexOf('这段什么意思') >= 0) };
    });
    ok('A2 合并确实发生了', a.changed, JSON.stringify(a));
    ok('A3 第二章的正文数据里出现了同步来的问答', a.ai[1].indexOf('这段什么意思') >= 0, JSON.stringify(a.ai));
    ok('A4 ⭐屏幕上（DOM）也真的显示出来了，不用退出重进', a.domHasQ, 'DOM 里没找到那句问答');
    eq('A5 没有问答的第一章原样不动', a.ai[0], '');

    // ── B 组：只重渲变了的那几章 ────────────────────────────────────
    const b = await page.evaluate(() => {
        // 给两章的 DOM 各打个记号，重渲会把节点换掉、记号跟着没
        document.querySelector('.chat-msg.ai[data-idx="1"]').dataset.mark = 'keep1';
        document.querySelector('.chat-msg.ai[data-idx="3"]').dataset.mark = 'keep3';
        pullFromCloud({
            '测试书.txt|4321': { '0': { list: [{ p: 1, q: '第一章的问题', a: '答' }], ts: 8888 } }
        });
        return {
            ch0Replaced: !document.querySelector('.chat-msg.ai[data-idx="1"]').dataset.mark,
            ch1Kept: document.querySelector('.chat-msg.ai[data-idx="3"]').dataset.mark === 'keep3'
        };
    });
    ok('B1 内容变了的第一章被重渲了', b.ch0Replaced, '第一章没重渲');
    ok('B2 ⭐没变的第二章没被动（不白刷、不动提问条和阅读位置）', b.ch1Kept, '第二章被误重渲了');

    // 同样一份数据再拉一次：什么都没变，不该有任何重渲
    const b3 = await page.evaluate(() => {
        document.querySelector('.chat-msg.ai[data-idx="1"]').dataset.mark = 'again';
        const changed = pullFromCloud({
            '测试书.txt|4321': { '0': { list: [{ p: 1, q: '第一章的问题', a: '答' }], ts: 8888 } }
        });
        return { changed, kept: document.querySelector('.chat-msg.ai[data-idx="1"]').dataset.mark === 'again' };
    });
    eq('B3 同样的数据再拉一次＝没变化', b3.changed, false);
    ok('B4 没变化时一次都不重渲', b3.kept, '被无谓重渲了');

    // ── C 组：正忙的时候不插手 ──────────────────────────────────────
    const c = await page.evaluate(() => {
        const snapshot = chatMessages[3].content;
        window.chatStreaming = true;
        pullFromCloud({ '测试书.txt|4321': { '1': { list: [{ p: 5, q: '流式期间的问答', a: 'x' }], ts: 20000 } } });
        const duringStream = chatMessages[3].content;
        window.chatStreaming = false;

        window.readerBgRunning = true;
        pullFromCloud({ '测试书.txt|4321': { '1': { list: [{ p: 6, q: '标背景期间的问答', a: 'y' }], ts: 30000 } } });
        const duringBg = chatMessages[3].content;
        window.readerBgRunning = false;

        // 忙完之后的下一轮拉取要能补上
        pullFromCloud({ '测试书.txt|4321': { '1': { list: [{ p: 7, q: '忙完之后的问答', a: 'z' }], ts: 40000 } } });
        return { snapshot, duringStream, duringBg, after: chatMessages[3].content };
    });
    eq('C1 流式回答期间不动屏幕上那份', c.duringStream, c.snapshot);
    eq('C2 标背景期间不动屏幕上那份', c.duringBg, c.snapshot);
    ok('C3 忙完之后下一轮拉取能补上', c.after.indexOf('忙完之后的问答') >= 0, c.after);

    // ── D 组：背景知识走同一条路 ────────────────────────────────────
    const d = await page.evaluate(() => {
        pullFromCloud({
            '测试书.txt|4321': { '0': { list: [{ p: 2, q: '背景：共济会', a: '十八世纪的一个兄弟会组织' }], ts: 50000 } }
        });
        const dom = document.querySelector('.chat-msg.ai[data-idx="1"]');
        const fk = readerBookKey('bk_q');
        return {
            inDom: !!(dom && dom.textContent.indexOf('共济会') >= 0),
            bgCount: readerBgOfChap(fk, 0).length
        };
    });
    ok('D1 同步来的背景知识也当场显示', d.inDom, 'DOM 里没有背景内容');
    eq('D2 且被认成「背景」而不是普通问答', d.bgCount, 1);

    /* ── E 组：⭐少的不许盖掉多的 ────────────────────────────────────
       用户 2026-08-09 自己看出来的：「似乎会让读痕少的覆盖多的，这对吗」——对。
       现场：另一台设备给第二章存了 3 条问答（已进本机 localStorage），
       但本机视图还是旧的（正在流式/标背景时不重灌，窗口就是这么敞开的）。
       这时在本机问一个新问题 → 原来会打包写「第二章＝1 条」把那 3 条冲掉。 */
    const e = await page.evaluate(() => {
        const fk = '测试书.txt|4321';
        // 另一台设备的 3 条，已经躺在本机存储里
        localStorage.setItem('reader_qa', JSON.stringify({
            [fk]: { '1': { list: [
                { p: 1, q: '别处问的甲', a: 'A' },
                { p: 2, q: '别处问的乙', a: 'B' },
                { p: 4, q: '别处问的丙', a: 'C' }
            ], ts: 1000 } }
        }));
        // 本机视图是旧的：只有刚在本机问的这一条
        chatMessages[3].content = '[P3] 汐：本机刚问的\n本机的答案';
        readerPersistQA(3);
        const cell = JSON.parse(localStorage.getItem('reader_qa'))[fk]['1'];
        return { n: cell.list.length, qs: cell.list.map(x => x.q), ps: cell.list.map(x => x.p) };
    });
    eq('E1 ⭐三条旧的全部保住，加上本机新的一条＝4', e.n, 4);
    ok('E2 别处那三条一条没少', ['别处问的甲', '别处问的乙', '别处问的丙'].every(q => e.qs.indexOf(q) >= 0), JSON.stringify(e.qs));
    ok('E3 本机新问的那条也在', e.qs.indexOf('本机刚问的') >= 0, JSON.stringify(e.qs));
    eq('E4 按段号排好序（渲染顺序不跳）', e.ps, [1, 2, 3, 4]);

    /* ── F 组：但「明确删除」必须还能删掉 ────────────────────────────
       ⚠️E 组那条护栏最容易矫枉过正成「删了又自己回来」：删除时视图里少了一条，
       如果不告诉 readerPersistQA「这条是我删的」，它就会当成「本机没同步到」补回去。 */
    const f = await page.evaluate(() => {
        const fk = '测试书.txt|4321';
        localStorage.setItem('reader_qa', JSON.stringify({
            [fk]: { '1': { list: [
                { p: 1, q: '留下的', a: 'A' },
                { p: 2, q: '要删的', a: 'B' }
            ], ts: 1000 } }
        }));
        chatMessages[3].content = '[P1] 汐：留下的\nA\n[P2] 汐：要删的\nB';
        readingRerenderMsg(3);
        readingDeleteBlock(3, 2, 0);
        const cell = JSON.parse(localStorage.getItem('reader_qa'))[fk]['1'];
        return { qs: cell.list.map(x => x.q) };
    });
    eq('F1 ⭐明确删掉的那条没被"补"回来', f.qs, ['留下的']);

    // F2：删除时，别处同步来的、视图里没有的条目仍然要保住（两条规则得同时成立）
    const f2 = await page.evaluate(() => {
        const fk = '测试书.txt|4321';
        localStorage.setItem('reader_qa', JSON.stringify({
            [fk]: { '1': { list: [
                { p: 1, q: '留下的', a: 'A' },
                { p: 2, q: '要删的', a: 'B' },
                { p: 5, q: '别处来的', a: 'C' }   // 本机视图里没有这条
            ], ts: 1000 } }
        }));
        chatMessages[3].content = '[P1] 汐：留下的\nA\n[P2] 汐：要删的\nB';
        readingRerenderMsg(3);
        readingDeleteBlock(3, 2, 0);
        const cell = JSON.parse(localStorage.getItem('reader_qa'))[fk]['1'];
        return { qs: cell.list.map(x => x.q) };
    });
    eq('F2 删一条的同时，别处同步来的那条仍在', f2.qs, ['留下的', '别处来的']);

    await browser.close();

    let fail = 0;
    for (const r of results) {
        if (!r.pass) fail++;
        console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail));
    }
    console.log(fail === 0 ? '  全部通过 (' + results.length + ')' : '  ' + fail + ' 条失败');
    process.exit(fail === 0 ? 0 : 1);
})();
