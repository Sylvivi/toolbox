/* 正文「改错字」的回归测试。
 *
 * 起因：用户 2026-07-28 说「我上传的书希望能编辑，改错字……但有些同步是跟书的标题和大小绑定的，
 * 我如果编辑了，会不撼动这个？」——她的担心完全正确，这套测试守的就是那个担心。
 *
 * ⚠️三条铁律，每一条都对应一类"改完把别的东西弄错位"的事故：
 *   ① 书的身份证 fileName|fileSize 一个字节都不许动（读痕/划线/问答/背景/名单/进度全按它认书）
 *   ② 段落数量永远不变（读痕全按「第几章·第几段」钉位，一拆段后面集体错位，还极难发现）
 *   ③ 会话消息和书架里的书要一起改（只改一边＝书还是错的，或者眼前不变）
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

/* 造一本两章的书，第 2 段里埋一个错字「情不自陆」。
 * mode='reader' → 阅读模式（消息自带 readerChapter，章号 100% 准）
 * mode='reading' → 共读模式（章节正文是发出去的独立副本，带 [Pn] 前缀，章号得靠内容反查）
 */
function boot(mode) {
    const ch0body = ['他站在原地，情不自陆地笑了。', '第三段随便写点什么充数。', '第四段也是。'].join('\n');
    const book = {
        id: 'bk_e', fileName: '测试书.txt', fileSize: 12345,
        chapters: [{ title: '第一章 开端', body: ch0body }, { title: '第二章 后续', body: '另一章的正文。' }]
    };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === 'bk_e' ? book : null);
    // 落盘/推云都换成记账用的假货：测试不碰 IndexedDB、不联网
    const calls = { rbSave: 0, push: 0, saveConv: 0 };
    window.rbSave = () => { calls.rbSave++; };
    window.bkSyncPush = () => { calls.push++; };
    window.chatSaveCurrentConv = () => { calls.saveConv++; };
    window._calls = calls;
    localStorage.removeItem('reading_book_edits');
    localStorage.removeItem('reading_highlights');
    document.getElementById('chatModalOverlay').classList.add('show');

    if (mode === 'reader') {
        window.readerBookId = 'bk_e'; window.readerChapterIdx = 0;
        window.chatReaderMode = true; window.chatReadingMode = true;
        window.chatCurrentConvId = 'reader_' + book.fileName + '|' + book.fileSize;
        window.chatMessages = readerChapterPair(book.chapters[0], 0);
    } else {
        window.readerBookId = null;
        window.chatReaderMode = false; window.chatReadingMode = true;
        window.chatCurrentConvId = 'chat_e1';
        localStorage.setItem('reading_conv_book', JSON.stringify({ chat_e1: 'bk_e' }));
        // 共读：正文是 rbInsertChapter 填进输入框发出去的，chatSend 会给每个非空行打 [Pn]
        const raw = book.chapters[0].title + '\n\n' + book.chapters[0].body;
        window.chatMessages = [
            { role: 'user', content: readingModeAddParaNums(raw).text, ts: Date.now() },
            { role: 'assistant', content: '', ts: Date.now(), readingMode: true }
        ];
    }
    chatRenderAllMessages(false);
    const mi = chatMessages.length - 1;
    return { mi, book };
}

// 「情不自陆」在第 2 段里的位置（段 1 是章标题）
const P = 2, START = 6, END = 10, OLD = '情不自陆', NEW = '情不自禁';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._boot=' + boot + ';' });

    /* ── A 组：段落定位（段号＝第几个非空行，两种前缀都要认） ───────────── */
    const A = await page.evaluate(() => {
        const plain = '第一章 开端\n\n他站在原地。\n\n第三段。';
        const numbered = readingModeAddParaNums(plain).text;
        return {
            p1: _rdEditFindLine(plain, 1).para,
            p2: _rdEditFindLine(plain, 2).para,
            p3: _rdEditFindLine(plain, 3).para,
            越界: _rdEditFindLine(plain, 9),
            带前缀p2: _rdEditFindLine(numbered, 2).para,
            带前缀的前缀: _rdEditFindLine(numbered, 2).prefix,
            无前缀的前缀: _rdEditFindLine(plain, 2).prefix,
            // 空行不算段：段号必须跟 readingModeRenderMerged 的数法一致
            渲染出的段数: (function () {
                const d = document.createElement('div');
                d.innerHTML = readingModeRenderMerged(plain, '');
                return d.querySelectorAll('p[data-p]').length;
            })()
        };
    });
    eq('A1 第 1 段＝章标题', A.p1, '第一章 开端');
    eq('A2 第 2 段认得对（空行不算一段）', A.p2, '他站在原地。');
    eq('A3 第 3 段认得对', A.p3, '第三段。');
    eq('A4 段号越界返回 null（不许瞎猜）', A.越界, null);
    eq('A5 共读的 [Pn] 前缀会被剥掉再比对', A.带前缀p2, '他站在原地。');
    eq('A6 前缀被原样记下（写回时要还回去）', A.带前缀的前缀, '[P2] ');
    eq('A7 阅读模式的正文没有前缀', A.无前缀的前缀, '');
    eq('A8 段数跟正文渲染出来的一致', A.渲染出的段数, 3);

    /* ── B 组：铁律① 身份证一个字节都不许动 ─────────────────────────── */
    const B = await page.evaluate(() => {
        const { mi, book } = window._boot('reader');
        const before = { fileName: book.fileName, fileSize: book.fileSize, key: rbBookFileKey(book) };
        const convIdBefore = readingMarksConvId();
        const r = rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自禁');
        return {
            改成功: r.ok,
            fileName: book.fileName, fileSize: book.fileSize,
            身份证: rbBookFileKey(book), 身份证原值: before.key,
            读痕键前: convIdBefore, 读痕键后: readingMarksConvId(),
            // 正文真的变了才说明这条断言有意义（不是因为压根没改所以身份证没动）
            书里的正文: book.chapters[0].body.split('\n')[0]
        };
    });
    ok('B1 改成功了', B.改成功, JSON.stringify(B));
    eq('B2 fileName 没动', B.fileName, '测试书.txt');
    eq('B3 fileSize 没动（⚠️绝不按新内容重算）', B.fileSize, 12345);
    eq('B4 身份证 fileKey 没动', B.身份证, '测试书.txt|12345');
    eq('B5 读痕的会话键跟着没动（换设备还认得出是同一本）', B.读痕键后, B.读痕键前);
    eq('B6 正文确实改了（否则上面几条是假阳性）', B.书里的正文, '他站在原地，情不自禁地笑了。');

    /* ── C 组：铁律② 段落数量永远不变 ───────────────────────────────── */
    const C = await page.evaluate(() => {
        const { mi, book } = window._boot('reader');
        const segs = () => ((book.chapters[0].title + '\n\n' + book.chapters[0].body)
            .split('\n').filter(x => x.trim().length).length);
        const before = segs();
        const 换行 = rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自\n禁');
        const 清空 = rdEditApply(mi, 2, 0, _rdEditFindLine(_rdEditMsgText(chatMessages[_rdEditOrigMsgIdx(mi)]).text, 2).para.length, _rdEditFindLine(_rdEditMsgText(chatMessages[_rdEditOrigMsgIdx(mi)]).text, 2).para, '   ');
        const 正常 = rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自禁');
        return {
            换行被拒: !换行.ok, 换行理由: 换行.reason,
            清空被拒: !清空.ok, 清空理由: 清空.reason,
            正常通过: 正常.ok,
            段数前: before, 段数后: segs()
        };
    });
    ok('C1 段落里换行被拒（一拆段，后面读痕全错位）', C.换行被拒, C.换行理由);
    ok('C2 整段清空被拒（段落数少一，同样错位）', C.清空被拒, C.清空理由);
    ok('C3 正常的改动照常通过', C.正常通过, JSON.stringify(C));
    eq('C4 改完段落数一模一样', C.段数后, C.段数前);

    /* ── D 组：铁律③ 四份一起改（阅读模式） ────────────────────────── */
    const D = await page.evaluate(() => {
        const { mi, book } = window._boot('reader');
        const r = rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自禁');
        const dom = document.querySelector('.chat-msg.ai[data-idx="' + mi + '"] .reading-merged p[data-p="' + 2 + '"]');
        return {
            书改了: r.bookChanged,
            会话里的: _rdEditFindLine(_rdEditMsgText(chatMessages[_rdEditOrigMsgIdx(mi)]).text, 2).para,
            书里的: book.chapters[0].body.split('\n')[0],
            眼前的: dom ? dom.textContent : '(没渲染)',
            落盘次数: window._calls.rbSave,
            推云次数: window._calls.push,
            存会话次数: window._calls.saveConv,
            // 第二章一个字都不许动
            另一章: book.chapters[1].body
        };
    });
    ok('D1 书架那本书跟着改了', D.书改了, JSON.stringify(D));
    eq('D2 ①会话消息改了', D.会话里的, '他站在原地，情不自禁地笑了。');
    eq('D3 ②书架的书改了', D.书里的, '他站在原地，情不自禁地笑了。');
    eq('D4 ③眼前的 DOM 改了', D.眼前的, '他站在原地，情不自禁地笑了。');
    ok('D5 ④落盘了（rbSave）', D.落盘次数 === 1, '实际 ' + D.落盘次数);
    ok('D6 ⑤推云了（bkSyncPush）', D.推云次数 === 1, '实际 ' + D.推云次数);
    ok('D7 会话也存了盘（强制标脏，否则同步不出去）', D.存会话次数 >= 1, '实际 ' + D.存会话次数);
    eq('D8 没有殃及别的章节', D.另一章, '另一章的正文。');

    /* ── E 组：共读模式——靠内容反查章号 ───────────────────────────── */
    const E = await page.evaluate(() => {
        const { mi, book } = window._boot('reading');
        const tgt = _rdEditBookTarget(mi);
        const r = rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自禁');
        return {
            认出的章号: tgt ? tgt.idx : null, 怎么认出的: tgt ? tgt.how : null,
            书改了: r.bookChanged,
            书里的: book.chapters[0].body.split('\n')[0],
            会话里的: _rdEditFindLine(_rdEditMsgText(chatMessages[_rdEditOrigMsgIdx(mi)]).text, 2).para,
            // 共读的消息带 [Pn] 前缀，写回后前缀必须还在，否则整章段号解析全乱
            会话原始行: _rdEditMsgText(chatMessages[_rdEditOrigMsgIdx(mi)]).text.split('\n').filter(x => x.trim())[1]
        };
    });
    eq('E1 共读里认出是第 1 章（整章内容精确比对）', E.认出的章号, 0);
    eq('E2 认法是"整章精确匹配"', E.怎么认出的, 'exact');
    ok('E3 共读里书也跟着改了', E.书改了, JSON.stringify(E));
    eq('E4 书里的正文对了', E.书里的, '他站在原地，情不自禁地笑了。');
    eq('E5 会话里的正文对了', E.会话里的, '他站在原地，情不自禁地笑了。');
    eq('E6 ⚠️[Pn] 前缀写回后还在（丢了整章段号全乱）', E.会话原始行, '[P2] 他站在原地，情不自禁地笑了。');

    /* ── F 组：对不上章 → 只改眼前，且必须如实说"书没改" ──────────── */
    const F = await page.evaluate(() => {
        const { mi, book } = window._boot('reading');
        // 把书里的正文换掉，制造"会话和书对不上"（现实里＝她在输入框里手改过、或换过书）
        book.chapters[0].body = '完全不一样的内容。';
        book.chapters[0].title = '完全不一样的标题';
        const tgt = _rdEditBookTarget(mi);
        const r = rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自禁');
        return {
            认不出: tgt === null,
            改成功: r.ok, 书改了: r.bookChanged,
            会话里的: _rdEditFindLine(_rdEditMsgText(chatMessages[_rdEditOrigMsgIdx(mi)]).text, 2).para,
            书没被乱写: book.chapters[0].body,
            推云次数: window._calls.push,
            记录条数: rdEditLogGet('测试书.txt|12345').length
        };
    });
    ok('F1 对不上章时如实认不出（不瞎猜）', F.认不出, JSON.stringify(F));
    ok('F2 眼前这一份照样改成功', F.改成功 && F.会话里的 === '他站在原地，情不自禁地笑了。', JSON.stringify(F));
    ok('F3 书没改（bookChanged=false，调用方据此提示用户）', F.书改了 === false, JSON.stringify(F));
    eq('F4 ⚠️绝不把内容写到别的章上去', F.书没被乱写, '完全不一样的内容。');
    ok('F5 书没改就不推云（免得把没改的书白传一遍）', F.推云次数 === 0, '实际 ' + F.推云次数);
    ok('F6 书没改就不记后悔药（记录挂在书上，无从还原）', F.记录条数 === 0, '实际 ' + F.记录条数);

    /* ── G 组：同段划线跟着挪位置 ─────────────────────────────────── */
    const G = await page.evaluate(() => {
        const { mi } = window._boot('reader');
        const cid = readingMarksConvId();
        const chap = _readerChapOf(mi);
        // 段落原文：「他站在原地，情不自陆地笑了。」 错字在 [5,9)
        const mk = (id, s, e) => ({ id, msgIdx: mi, chap, p: 2, start: s, end: e, color: 'gold', note: '', text: '', preview: '', ts: 1 });
        readingSaveConvHl([
            mk('left', 0, 3),    // 改动左边：不该动
            mk('right', 10, 13), // 改动右边：整体平移
            mk('cover', 4, 12),  // 压在改动上：撑开包住新字
        ]);
        // 把 4 个字改成 6 个字，delta = +2
        rdEditApply(mi, 2, 6, 10, '情不自陆', '情难以自禁');   // 5 个字，delta = +1
        const out = {};
        readingGetConvHl().forEach(h => { out[h.id] = [h.start, h.end, h.text]; });
        return out;
    });
    eq('G1 改动左边的划线纹丝不动', G.left.slice(0, 2), [0, 3]);
    eq('G2 改动右边的划线整体平移（+1）', G.right.slice(0, 2), [11, 14]);
    ok('G3 压在改动上的划线撑开、把新字包住', G.cover[0] === 4 && G.cover[1] >= 10, '实际 ' + JSON.stringify(G.cover));
    eq('G4 划线的文字跟着更新（读痕面板不再显示旧错字）', G.left[2], '他站在');
    ok('G5 平移后的划线文字也对', G.right[2].length === 3, '实际 ' + JSON.stringify(G.right));

    /* ── H 组：后悔药——记一条 + 逐条还原 ─────────────────────────── */
    const H = await page.evaluate(() => {
        const { mi, book } = window._boot('reader');
        rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自禁');
        const fk = rbBookFileKey(book);
        const log1 = rdEditLogGet(fk);
        const rec = log1[0];
        rdEditUndo(fk, rec.id);
        return {
            记了几条: log1.length,
            改前: rec.before, 改后: rec.after, 章号: rec.chap, 段号: rec.p, 标题: rec.title,
            还原后书里的: book.chapters[0].body.split('\n')[0],
            还原后记录数: rdEditLogGet(fk).length,
            身份证: rbBookFileKey(book)
        };
    });
    eq('H1 记了一条改动', H.记了几条, 1);
    eq('H2 记下了改前', H.改前, '情不自陆');
    eq('H3 记下了改后', H.改后, '情不自禁');
    eq('H4 记下了第几章', H.章号, 0);
    eq('H5 记下了第几段', H.段号, 2);
    eq('H6 记下了章标题（面板上给人看的）', H.标题, '第一章 开端');
    eq('H7 ↩️还原后书里回到原样', H.还原后书里的, '他站在原地，情不自陆地笑了。');
    eq('H8 还原后这条记录消失（不会越还原越多）', H.还原后记录数, 0);
    eq('H9 还原也不动身份证', H.身份证, '测试书.txt|12345');

    /* ── I 组：改到一半正文变了 → 拒绝，不许写歪 ─────────────────── */
    const I = await page.evaluate(() => {
        const { mi } = window._boot('reader');
        // 模拟：选中之后、点保存之前，这一段被别处改掉了
        const mt = _rdEditMsgText(chatMessages[_rdEditOrigMsgIdx(mi)]);
        mt.set(mt.text.replace('情不自陆', '完全变了啊'));
        const r = rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自禁');
        return { 被拒: !r.ok, 理由: r.reason, 段落: _rdEditFindLine(_rdEditMsgText(chatMessages[_rdEditOrigMsgIdx(mi)]).text, 2).para };
    });
    ok('I1 原文对不上就拒绝（防止写到错的位置）', I.被拒, I.理由);
    ok('I2 理由说人话', /变过|重新选中/.test(I.理由 || ''), '实际：' + I.理由);
    eq('I3 拒绝之后正文一个字都没被动', I.段落, '他站在原地，完全变了啊地笑了。');

    /* ── J 组：入口 UI——划线小条上的「✏️ 改」 ───────────────────── */
    await page.evaluate(() => { window._boot('reader'); });
    const J1 = await page.evaluate(() => {
        // 手动选中第 2 段里的「情不自陆」，走真实的 selectionchange 那条路
        const p = document.querySelector('.chat-msg.ai .reading-merged p[data-p="2"]');
        // 段落里可能被引号/人名高亮切成多个文本节点，按「段内第几个字」找，别假设 firstChild 是整段
        function at(off) {
            const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, null, false);
            let i = 0, n;
            while ((n = w.nextNode())) {
                if (off <= i + n.nodeValue.length) return { node: n, off: off - i };
                i += n.nodeValue.length;
            }
            return null;
        }
        const a = at(6), b = at(10);
        const r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(b.node, b.off);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        return String(s) === '情不自陆';
    });
    await page.waitForTimeout(400);
    const J = await page.evaluate(() => {
        const bar = document.getElementById('rdHlBar');
        const btn = bar && bar.querySelector('[data-act="edit"]');
        if (btn) btn.click();
        const box = document.getElementById('rdEditBox');
        const ta = box && box.querySelector('.rde-in');
        return {
            有小条: !!bar,
            有改按钮: !!btn, 按钮字样: btn ? btn.textContent.trim() : '',
            出了编辑框: !!box,
            预填的是选中的字: ta ? ta.value : '',
            小条收起了: !document.getElementById('rdHlBar'),
            层级: box ? getComputedStyle(box).zIndex : ''
        };
    });
    ok('J1 选中文字冒出划线小条', J.有小条, JSON.stringify(J));
    ok('J2 小条上有「改」按钮', J.有改按钮, JSON.stringify(J));
    eq('J3 按钮就叫「✏️ 改」', J.按钮字样, '✏️ 改');
    ok('J4 点了出编辑框', J.出了编辑框, JSON.stringify(J));
    eq('J5 编辑框预填的正是选中的那几个字', J.预填的是选中的字, '情不自陆');
    ok('J6 编辑框冒出来时小条收起（不叠在一起）', J.小条收起了, JSON.stringify(J));
    ok('J7 编辑框层级盖过划线小条(4000)', parseInt(J.层级) > 4000, '实际 ' + J.层级);

    // 编辑框里敲回车＝保存，不是换行（铁律②的第一道闸）
    const K = await page.evaluate(async () => {
        const ta = document.querySelector('#rdEditBox .rde-in');
        ta.value = '情不自禁';
        ta.dispatchEvent(new Event('input'));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 100));
        const p = document.querySelector('.chat-msg.ai .reading-merged p[data-p="2"]');
        return {
            框收了: !document.getElementById('rdEditBox'),
            正文: p ? p.textContent : '',
            书里的: rbGetBook('bk_e').chapters[0].body.split('\n')[0]
        };
    });
    ok('K1 回车＝保存（编辑框收起）', K.框收了, JSON.stringify(K));
    eq('K2 回车保存后正文改好了', K.正文, '他站在原地，情不自禁地笑了。');
    eq('K3 书也一起改好了', K.书里的, '他站在原地，情不自禁地笑了。');

    // 粘进来的换行当场转空格（她从别处复制一段带换行的文字时）
    const L = await page.evaluate(() => {
        window._boot('reader');
        rdEditOpen({ msgIdx: chatMessages.length - 1, pNum: 2, start: 6, end: 10, text: '情不自陆' });
        const ta = document.querySelector('#rdEditBox .rde-in');
        ta.value = '情不\n自禁';
        ta.dispatchEvent(new Event('input'));
        const v = ta.value;
        rdEditClose();
        return { 值: v };
    });
    eq('L1 粘进来的换行当场变空格（进不了正文）', L.值, '情不 自禁');

    /* ── M 组：读痕/背景的段号不受影响 ───────────────────────────── */
    const M = await page.evaluate(() => {
        const { mi, book } = window._boot('reader');
        const fk = rbBookFileKey(book);
        // 在第 2 段挂一条问答（背景块和共读问答都存这里，键是 fileKey+章号+段号）
        // 走真实路径：背景块/问答都是 AI 那条消息里的 [Pn] 汐：… ，由 readerPersistQA 落进 reader_qa
        chatMessages[mi].content = '[P2] 汐：背景：某个词\n讲解内容';
        readerPersistQA(mi);
        const before = JSON.stringify(readerQAGet(fk, 0));
        rdEditApply(mi, 2, 6, 10, '情不自陆', '情不自禁');
        const after = readerQAGet(fk, 0);
        return {
            改前: before, 条数: after.length, 段号: after[0] && after[0].p,
            键没变: rbBookFileKey(book) === fk,
            一模一样: JSON.stringify(after) === before
        };
    });
    eq('M1 问答/背景还在（一条不丢）', M.条数, 1);
    eq('M2 段号没变（还钉在第 2 段）', M.段号, 2);
    ok('M3 reader_qa 的键没变', M.键没变, JSON.stringify(M));
    ok('M4 整块问答数据一字未动', M.一模一样, JSON.stringify(M));

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('  ❌ ' + r.name + (r.detail ? ' → ' + r.detail : '')); else console.log('  ✅ ' + r.name); });
    console.log(bad.length ? ('\n❌ ' + bad.length + ' 条没过（共 ' + results.length + ' 条）') : ('\n✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})();
