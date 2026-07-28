/* 「追加章节（番外）」+「跨设备自动更新」的回归测试。
 *
 * 起因：用户 2026-07-28「添加一些作者新出的番外」＋「我在手机上改完书，电脑上那份旧的怎么办」。
 *
 * ⚠️这两块守的是同一件事：**别把已有章节的序号弄动**。
 * 读痕/划线/问答/背景全按「第几章·第几段」钉位——
 *   · 追加接在最后 → 前面下标一个不动 → 零风险（所以刻意不做"整本换新版"）
 *   · 自动更新只换正文、保住本地 id 和身份证 → 会话关联和读痕都不断
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 一本 3 章的书，正文用「第X章」标题（对应 chinese 切法）
function bootShelf() {
    // ⚠️F/G 组会把 bkSyncRefreshOne 换成假货来数调用次数；H/I 组要用真的，
    // 所以第一次进来先把原件存一份，用之前还回去（测试之间互相污染，第一版就栽在这）
    if (!window._origRefresh) window._origRefresh = window.bkSyncRefreshOne;
    const mk = (n, t) => '第' + n + '章 ' + t + '\n' + '正文内容随便写点什么充数。'.repeat(3);
    const raw = [mk('一', '起'), mk('二', '承'), mk('三', '转')].join('\n\n');
    const book = {
        id: 'bk_a', fileName: '长篇.txt', fileSize: 54321, fileType: 'text',
        preset: 'chinese', rawText: raw,
        chapters: [
            { title: '第一章 起', body: '正文内容随便写点什么充数。' },
            { title: '第二章 承', body: '正文内容随便写点什么充数。' },
            { title: '第三章 转', body: '正文内容随便写点什么充数。' }
        ]
    };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === 'bk_a' ? book : null);
    const calls = { rbSave: 0, push: 0 };
    window.rbSave = () => { calls.rbSave++; };
    window.bkSyncPush = () => { calls.push++; };
    window._calls = calls;
    return book;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._bootShelf=' + bootShelf + ';' });

    /* ── A 组：接到最后，前面一动不动 ──────────────────────────────── */
    const A = await page.evaluate(() => {
        const book = window._bootShelf();
        const before = book.chapters.map(c => c.title);
        const fkBefore = rbBookFileKey(book);
        const raw = '第四章 番外一\n番外的正文内容。\n\n第五章 番外二\n另一段番外的正文。';
        const newCh = rbAppendSplit(raw, 'chinese');
        const r = rbAppendChapters(book, newCh, raw);
        return {
            结果: r,
            接完的标题: book.chapters.map(c => c.title),
            前三章没动: JSON.stringify(book.chapters.slice(0, 3).map(c => c.title)) === JSON.stringify(before),
            身份证: rbBookFileKey(book), 身份证原值: fkBefore,
            fileName: book.fileName, fileSize: book.fileSize,
            rawText尾巴: book.rawText.slice(-10),
            落盘: window._calls.rbSave, 推云: window._calls.push
        };
    });
    ok('A1 接上了 2 章', A.结果 && A.结果.ok && A.结果.added === 2, JSON.stringify(A.结果));
    eq('A2 番外排在最后（第 4、5 章）', A.接完的标题, ['第一章 起', '第二章 承', '第三章 转', '第四章 番外一', '第五章 番外二']);
    ok('A3 ⚠️前三章的序号和标题一个字没动', A.前三章没动, JSON.stringify(A.接完的标题));
    eq('A4 身份证 fileKey 没动', A.身份证, A.身份证原值);
    eq('A5 fileName 没动', A.fileName, '长篇.txt');
    eq('A6 fileSize 没动（⚠️绝不按新内容重算）', A.fileSize, 54321);
    ok('A7 ⚠️rawText 也接上了（否则哪天点「重新拆分」番外就没了）', /另一段番外的正文。$/.test(A.rawText尾巴 + ''), '尾巴：' + A.rawText尾巴);
    ok('A8 落盘了', A.落盘 >= 1, '实际 ' + A.落盘);
    ok('A9 推云了', A.推云 >= 1, '实际 ' + A.推云);

    /* ── B 组：「重新拆分」之后番外还在 ───────────────────────────── */
    const B = await page.evaluate(() => {
        const book = window._bootShelf();
        const raw = '第四章 番外一\n番外的正文内容。';
        rbAppendChapters(book, rbAppendSplit(raw, 'chinese'), raw);
        // 模拟她点了目录里的「重新拆分」：rbReSplit 是拿 rawText 重切整本的
        const re = (book.preset === 'auto') ? rbAutoSplit(book.rawText) : rbSplitByPattern(book.rawText, RB_PRESETS[book.preset]);
        return { 重切后章数: re.length, 重切后标题: re.map(c => c.title) };
    });
    eq('B1 重新拆分后还是 4 章（番外没丢）', B.重切后章数, 4);
    ok('B2 番外那一章还在', B.重切后标题.indexOf('第四章 番外一') >= 0, JSON.stringify(B.重切后标题));

    /* ── C 组：去重/修标题只在新章内部跑，绝不碰已有章节 ──────────── */
    const C = await page.evaluate(() => {
        const book = window._bootShelf();
        const before = JSON.stringify(book.chapters);
        // 故意让新来的第一章跟已有的最后一章同名：整本跑 rbDedupChapters 的话会把它俩并掉
        const raw = '第三章 转\n这是另一篇同名的东西。\n\n第四章 番外\n番外正文。';
        rbAppendChapters(book, rbAppendSplit(raw, 'chinese'), raw);
        return {
            已有章节原封不动: JSON.stringify(book.chapters.slice(0, 3)) === before,
            总章数: book.chapters.length,
            第三章正文: book.chapters[2].body,
            标题: book.chapters.map(c => c.title)
        };
    });
    ok('C1 ⚠️已有的 3 章原封不动（没被同名的新章并掉）', C.已有章节原封不动, JSON.stringify(C.标题));
    eq('C2 同名的新章独立存在，总共 5 章', C.总章数, 5);
    eq('C3 已有第三章的正文没被拼进别的东西', C.第三章正文, '正文内容随便写点什么充数。');

    /* ── D 组：切法可换、预览能重画 ──────────────────────────────── */
    const D = await page.evaluate(() => {
        const raw = '一、番外上\n正文甲。\n\n二、番外下\n正文乙。';
        return {
            中文数字顿号: rbAppendSplit(raw, 'cn-num-dot').map(c => c.title),
            带〇的章号: rbAppendSplit('第一二九章 甲\n正文甲。\n\n第一三〇章 乙\n正文乙。\n\n第一三一章 丙\n正文丙。', 'chinese').map(c => c.title),
            用错切法只有一章: rbAppendSplit(raw, 'chinese').length,
            没标题时: rbAppendSplit('孤零零一段话没有标题', 'chinese').map(c => c.title),
            切出空数组才走兜底: (function () { const o = rbSplitByPattern; window.rbSplitByPattern = () => []; const r = rbAppendSplit('随便', 'chinese').map(c => c.title); window.rbSplitByPattern = o; return r; })()
        };
    });
    eq('D1 中文数字顿号那种番外切得对', D.中文数字顿号, ['一、番外上', '二、番外下']);
    // ⚠️「第一三〇章」的〇：chinese 那条正则原本只有「零」没有「〇」，于是这一章被整个吞进上一章
    // （2026-07-28 截图时逮到，同族 4 条正则一起补的）。旁边 paren-num/cn-num-dot 早就带〇了。
    eq('D1b 「第一三〇章」这种带〇的标题认得出来', D.带〇的章号, ['第一二九章 甲', '第一三〇章 乙', '第一三一章 丙']);
    eq('D2 切法用错时不会崩（整坨当一章）', D.用错切法只有一章, 1);
    eq('D3 认不出标题时整坨当一章（切章器自己叫「前言 / 引言」）', D.没标题时, ['前言 / 引言']);
    eq('D4 万一切出空数组，兜底成「番外」一章而不是崩掉', D.切出空数组才走兜底, ['番外']);

    /* ── E 组：预览弹窗 ──────────────────────────────────────────── */
    const E = await page.evaluate(() => {
        window._bootShelf();
        window._rbAppendTo = 'bk_a';
        rbAppendPreview('第四章 番外一\n正文。\n\n第五章 番外二\n正文。', '番外.txt', 'chinese');
        const mask = document.querySelector('.rb-ap-mask');
        const items = mask ? mask.querySelectorAll('.rb-ap-item') : [];
        return {
            弹出来了: !!mask,
            列了几章: items.length,
            第一条编号: items.length ? items[0].querySelector('.rb-ap-no').textContent : '',
            正文里有安全说明: mask ? /读痕、划线、背景一个都不会动/.test(mask.textContent) : false,
            有切法下拉: !!document.getElementById('rbAppendPreset'),
            有确认键: mask ? /接到最后/.test(mask.textContent) : false
        };
    });
    ok('E1 预览弹窗出来了', E.弹出来了, JSON.stringify(E));
    eq('E2 列出了 2 章', E.列了几章, 2);
    eq('E3 编号从第 4 章起（接在现有 3 章后面）', E.第一条编号, '第 4 章');
    ok('E4 写明了前面的读痕不会动（这是她最担心的事）', E.正文里有安全说明, JSON.stringify(E));
    ok('E5 能换切法', E.有切法下拉, JSON.stringify(E));
    ok('E6 有「接到最后」确认键', E.有确认键, JSON.stringify(E));

    // 换切法 → 预览就地重画
    const E2 = await page.evaluate(() => {
        const sel = document.getElementById('rbAppendPreset');
        sel.value = 'empty-line';
        sel.onchange();
        const mask = document.querySelector('.rb-ap-mask');
        return { 还在: !!mask, 只剩一个弹窗: document.querySelectorAll('.rb-ap-mask').length, 当前切法: document.getElementById('rbAppendPreset').value };
    });
    ok('E7 换切法后弹窗还在', E2.还在, JSON.stringify(E2));
    eq('E8 不会叠出两个弹窗', E2.只剩一个弹窗, 1);
    eq('E9 下拉停在新选的切法上', E2.当前切法, 'empty-line');

    // 点「接到最后」真的接上去
    const E3 = await page.evaluate(() => {
        const sel = document.getElementById('rbAppendPreset');
        sel.value = 'chinese'; sel.onchange();
        rbAppendConfirm();
        const b = rbGetBook('bk_a');
        return { 弹窗收了: !document.querySelector('.rb-ap-mask'), 章数: b.chapters.length, 末章: b.chapters[b.chapters.length - 1].title };
    });
    ok('E10 确认后弹窗收起', E3.弹窗收了, JSON.stringify(E3));
    eq('E11 真的接上去了（3 → 5 章）', E3.章数, 5);
    eq('E12 最后一章是番外二', E3.末章, '第五章 番外二');

    /* ── F 组：跨设备自动更新——首次见面只盖时间戳，不下载 ────────── */
    const F = await page.evaluate(() => {
        const book = window._bootShelf();
        delete book._ts;                     // 老书本来就没有 _ts
        let got = 0;
        window.bkSyncRefreshOne = (b, done) => { got++; if (done) done(); };
        window.bkSyncCfg = () => ({ url: 'https://x', token: 't' });
        bkSyncCheckUpdates({ '长篇.txt|54321': { ts: 999999, fileName: '长篇.txt', fileSize: 54321 } });
        return { 下载次数: got, 记下的ts: book._ts };
    });
    eq('F1 ⚠️首次见面不下载（否则一开书架几百本全重下）', F.下载次数, 0);
    eq('F2 但把服务器的时间戳记下来了', F.记下的ts, 999999);

    /* ── G 组：此后云端更新才触发下载 ───────────────────────────── */
    const G = await page.evaluate(() => {
        const book = window._bootShelf();
        book._ts = 1000;
        const hits = [];
        window.bkSyncRefreshOne = (b, done) => { hits.push(b.id); if (done) done(); };
        window.bkSyncCfg = () => ({ url: 'https://x', token: 't' });
        const key = '长篇.txt|54321';
        bkSyncCheckUpdates({ [key]: { ts: 1000 } });      // 一样新：不动
        const same = hits.length;
        bkSyncCheckUpdates({ [key]: { ts: 500 } });       // 云端更旧：不动（别把新的盖回旧的）
        const older = hits.length;
        bkSyncCheckUpdates({ [key]: { ts: 2000 } });      // 云端更新：拉
        const newer = hits.length;
        bkSyncCheckUpdates({});                            // 服务器没这本：不动
        const missing = hits.length;
        return { same, older, newer, missing };
    });
    eq('G1 时间一样时不下载', G.same, 0);
    eq('G2 ⚠️云端更旧时不下载（不许把新正文盖回旧的）', G.older, 0);
    eq('G3 云端更新时才下载', G.newer, 1);
    eq('G4 服务器没有这本书时不动它', G.missing, 1);

    /* ── H 组：更新只换正文，保住本地 id 和身份证 ───────────────── */
    const H = await page.evaluate(async () => {
        const book = window._bootShelf();
        window.bkSyncRefreshOne = window._origRefresh;   // 还回真件（F/G 换成假货了）
        book._ts = 1;
        const idBefore = book.id, fkBefore = rbBookFileKey(book);
        window.bkSyncCfg = () => ({ url: 'https://x', token: 't' });
        window.fetch = () => Promise.resolve({
            ok: true, json: () => Promise.resolve({
                ts: 7777,
                book: {
                    id: 'bk_别的设备上的id', fileName: '长篇.txt', fileSize: 54321,
                    chapters: [{ title: '第一章 起', body: '改过错字的正文。' },
                               { title: '第二章 承', body: '正文内容随便写点什么充数。' },
                               { title: '第三章 转', body: '正文内容随便写点什么充数。' },
                               { title: '第四章 番外', body: '别的设备加的番外。' }],
                    rawText: '云端的 rawText'
                }
            })
        });
        let toast = '';
        window.showToast = (m) => { toast = m; };
        await new Promise(r => bkSyncRefreshOne(book, r));
        return {
            id: book.id, idBefore,
            身份证: rbBookFileKey(book), fkBefore,
            fileName: book.fileName, fileSize: book.fileSize,
            章数: book.chapters.length,
            第一章: book.chapters[0].body,
            rawText: book.rawText,
            ts: book._ts,
            提示: toast
        };
    });
    eq('H1 ⚠️本地 id 没被云端那个顶掉（会话关联全靠它）', H.id, H.idBefore);
    eq('H2 身份证没动', H.身份证, H.fkBefore);
    eq('H3 fileName 没动', H.fileName, '长篇.txt');
    eq('H4 fileSize 没动', H.fileSize, 54321);
    eq('H5 正文换成云端那份了（3 → 4 章）', H.章数, 4);
    eq('H6 别的设备改的错字拿到了', H.第一章, '改过错字的正文。');
    eq('H7 rawText 也跟着换（重新拆分才不会丢）', H.rawText, '云端的 rawText');
    eq('H8 记下了云端的时间戳（下次不会重复下载）', H.ts, 7777);
    ok('H9 弹了「已更新」并说清章数变化', /已更新/.test(H.提示) && /3 → 4 章/.test(H.提示), '实际：' + H.提示);

    /* ── I 组：正在读这本书时，提示要重开这一章 ─────────────────── */
    const I = await page.evaluate(async () => {
        const book = window._bootShelf();
        window.bkSyncRefreshOne = window._origRefresh;   // 还回真件
        book._ts = 1;
        window.chatReaderMode = true; window.readerBookId = 'bk_a';
        window.bkSyncCfg = () => ({ url: 'https://x', token: 't' });
        window.fetch = () => Promise.resolve({
            ok: true, json: () => Promise.resolve({ ts: 8888, book: { chapters: [{ title: '第一章 起', body: '新的。' }] } })
        });
        let toast = '';
        window.showToast = (m) => { toast = m; };
        await new Promise(r => bkSyncRefreshOne(book, r));
        return { 提示: toast, 缓存清了: window._readingMergeCache && window._readingMergeCache.text === null };
    });
    ok('I1 正在读这本书时提示「重开这一章」', /重开这一章/.test(I.提示), '实际：' + I.提示);
    ok('I2 段落渲染缓存作废（正文变了不能再用旧的）', I.缓存清了, JSON.stringify(I));

    /* ── I2 组：改了书就必须推服务器 ────────────────────────────────
       用户自己问出来的：「我手动分好的，删除后再从服务器下载，下载下来的是分好的吗」——
       查了才发现答案是"不是"：rbSplitOneChapter / rbReSplit 都只 rbSave() 存本地，
       服务器那份还是没拆的，删了重下等于白切一场。这组守住"改书就推"这条规矩。 */
    const S = await page.evaluate(() => {
        const src = {};
        for (const fn of ['rbSplitOneChapter', 'rbReSplit', 'rbAppendChapters', 'rdEditApply']) {
            src[fn] = typeof window[fn] === 'function' ? window[fn].toString() : '';
        }
        return {
            手动分章有推: /bkSyncPush\s*\(/.test(src.rbSplitOneChapter),
            重新拆分有推: /bkSyncPush\s*\(/.test(src.rbReSplit),
            追加章节有推: /bkSyncPush\s*\(/.test(src.rbAppendChapters),
            改错字有推: /bkSyncPush\s*\(/.test(src.rdEditApply),
            都存了盘: ['rbSplitOneChapter', 'rbReSplit', 'rbAppendChapters'].every(f => /rbSave\s*\(/.test(src[f]))
        };
    });
    ok('S1 手动分章会推服务器（否则删了重下白切一场）', S.手动分章有推, JSON.stringify(S));
    ok('S2 重新拆分会推服务器', S.重新拆分有推, JSON.stringify(S));
    ok('S3 追加章节会推服务器', S.追加章节有推, JSON.stringify(S));
    ok('S4 改错字会推服务器', S.改错字有推, JSON.stringify(S));
    ok('S5 这几个改书的地方都会落盘', S.都存了盘, JSON.stringify(S));

    /* ── J 组：入口在书架 ⋯ 菜单里 ──────────────────────────────── */
    const J = await page.evaluate(() => {
        window._bootShelf();
        window.rbIsSocial = () => false;
        const fake = { stopPropagation() {}, preventDefault() {}, currentTarget: { getBoundingClientRect: () => ({ bottom: 100, right: 200 }) } };
        rbBookMenuOpen('bk_a', fake);
        const m = document.getElementById('rbBookMenu');
        const txt = m ? m.textContent : '';
        if (m) m.remove();
        return { 有追加章节: /追加章节/.test(txt), 菜单: txt };
    });
    ok('J1 书架 ⋯ 菜单里有「➕ 追加章节」', J.有追加章节, '菜单：' + J.菜单);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('  ❌ ' + r.name + (r.detail ? ' → ' + r.detail : '')); else console.log('  ✅ ' + r.name); });
    console.log(bad.length ? ('\n❌ ' + bad.length + ' 条没过（共 ' + results.length + ' 条）') : ('\n✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})();
