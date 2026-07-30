/* 目录里显示「这一章/这一节已经有导读了」的回归测试（2026-07-30 加）。
 *
 * 起因：用户「如果这一章或者这一节有了导读，能不能也像背景知识一样在目录页上
 * 能够看出来，当然，也得是极简风的那种」。
 *
 * 导读跟背景一样是一条 reader_qa（问题固定长成「导读」或「导读：《小节名》」），
 * 所以目录里数出来不难，难的是三个容易错的地方——这套测试守的就是它们：
 *   ① 导读挂在**小标题那一段**（headP），不是节内正文（startP）。按 startP 起算的话
 *      每一节都数不到，标记永远不出现，而且是**静默**的、肉眼查不出来。
 *   ② 判「是不是导读」不能用 indexOf('导读')===0：用户自己打的「导读这段讲的是什么」
 *      也会中，目录上冒出假标记。
 *   ③ 背景和导读必须在同一趟里数完，别为导读再全书扫一遍（二三百章的书会卡）。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

/* 造一本能展开小节的社科书：正文得够长（≥6000 字）、中文占比够、至少两个小标题，
   否则 rbChapterHasSections 会挡掉，小节行压根不渲染（第一版测试就栽在这）。 */
function bootSocial() {
    function sec(title, n) {
        const out = [title];
        for (let i = 0; i < n; i++) out.push('这是正文段落，讲的是一些道理和例子，' + '论'.repeat(120));
        return out.join('\n');
    }
    // 每节 20 段：三节合计约 8200 字，稳过 rbChapterHasSections 的 6000 字门槛
    //（第一版每节 12 段＝5024 字，卡在门槛下，小节行压根不渲染）
    const body = [sec('什么是从众', 20), sec('从众的经典实验', 20), sec('少数派的影响', 20)].join('\n');
    const book = {
        id: 'bk_g', fileName: '社会性动物.txt', fileSize: 66,
        chapters: [{ title: '第三章 从众', body: body }, { title: '第四章 大众传播', body: body }]
    };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === 'bk_g' ? book : null);
    // 标为社科书（两级目录只在「社科书 + 阅读模式选书」时出现）
    localStorage.setItem('reading_book_kind', JSON.stringify({ '社会性动物.txt|66': 'social' }));
    window.rbActiveBookId = 'bk_g';
    window.rbPickForReader = true;
    document.getElementById('rbChapterSearch').value = '';
    return { fk: readerBookKey('bk_g'), heads: rbSectionRanges(book, 0) };
}

// 直接往 reader_qa 里塞条目（跟真实生成写进去的格式一致）
function putQA(fk, chap, items) {
    const all = readerQAAll();
    all[fk] = all[fk] || {};
    all[fk][chap] = { ts: Date.now(), list: items };
    localStorage.setItem('reader_qa', JSON.stringify(all));
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._bootSocial=' + bootSocial + ';window._putQA=' + putQA + ';' });

    /* ── A 组：小节结构认得出来（后面几组的地基） ─────────────────── */
    const A = await page.evaluate(() => {
        const b = window._bootSocial();
        return { 小节数: b.heads.length, 标题: b.heads.map(h => h.title), 段号: b.heads.map(h => h.p) };
    });
    eq('三个小标题都认出来了', A.小节数, 3);
    eq('小节标题对得上', A.标题, ['什么是从众', '从众的经典实验', '少数派的影响']);

    /* ── B 组：有导读的小节标 📖，没有的照旧显示 P段号 ─────────────── */
    const B = await page.evaluate(() => {
        const { fk, heads } = window._bootSocial();
        // 第 1 节有导读，第 3 节也有；第 2 节没有
        window._putQA(fk, 0, [
            { p: heads[0].p, q: '导读：《什么是从众》', a: '这一节讲……' },
            { p: heads[2].p, q: '导读：《少数派的影响》', a: '这一节讲……' }
        ]);
        rbRenderChapters();
        return [...document.querySelectorAll('#rbChapterList .rb-sec')].map(el => ({
            标题: el.querySelector('.rb-sec-title').textContent,
            右边: el.querySelector('.rb-sec-p').textContent
        }));
    });
    eq('第一节标了 📖', B[0] && B[0].右边, '📖');
    ok('没导读的那一节照旧显示 P段号', /^P\d+$/.test(B[1] ? B[1].右边 : ''), JSON.stringify(B));
    eq('第三节也标了 📖', B[2] && B[2].右边, '📖');

    /* ── C 组：导读 + 背景同时有时，两个都显示得下 ─────────────────
     * 用户选的形态就是「📖 🏛 3 条」并排。 */
    const C = await page.evaluate(() => {
        const { fk, heads } = window._bootSocial();
        window._putQA(fk, 0, [
            { p: heads[0].p, q: '导读：《什么是从众》', a: '导读内容' },
            { p: heads[0].startP + 2, q: '背景：阿希实验', a: '背景内容' },
            { p: heads[0].startP + 4, q: '背景：群体压力', a: '背景内容' },
            { p: heads[1].startP + 1, q: '背景：传播学', a: '背景内容' }
        ]);
        rbRenderChapters();
        const secs = [...document.querySelectorAll('#rbChapterList .rb-sec')].map(el => el.querySelector('.rb-sec-p').textContent);
        const meta = document.querySelector('#rbChapterList .rb-chap-meta').textContent;
        return { secs, meta };
    });
    eq('导读和背景并排显示', C.secs[0], '📖 🏛 2');
    eq('只有背景的那一节只剩图标加数字', C.secs[1], '🏛 1');
    ok('章行 meta 上背景和导读都写了', /🏛 3/.test(C.meta) && /📖/.test(C.meta), C.meta);

    /* ── D 组：⚠️导读挂在小标题那一段，不是节内正文 ─────────────────
     * readingAskOne 的导读分支把 pNum 改写成了 sec.headP，块就插在小标题后面。
     * 数的时候要是从 startP(=headP+1) 起算，每一节的导读都会数不到——
     * 而且是静默的：界面上什么都不显示，看不出是"没做过"还是"数错了"。 */
    const D = await page.evaluate(() => {
        const { fk, heads } = window._bootSocial();
        window._putQA(fk, 0, [{ p: heads[1].p, q: '导读：《从众的经典实验》', a: '内容' }]);
        rbRenderChapters();
        const secs = [...document.querySelectorAll('#rbChapterList .rb-sec')].map(el => el.querySelector('.rb-sec-p').textContent);
        return { 小标题段号: heads[1].p, 节内首段: heads[1].startP, 第二节右边: secs[1] };
    });
    eq('导读确实存在小标题那一段（不是节内首段）', D.小标题段号, D.节内首段 - 1);
    eq('⚠️挂在小标题上的导读也数得到（按 startP 起算这里会变成 P段号）', D.第二节右边, '📖');

    /* ── E 组：⚠️别把用户自己打的问题当成导读 ─────────────────────
     * 松判（indexOf('导读')===0）会让「导读这段讲的是什么」也中，目录冒假标记。 */
    const E = await page.evaluate(() => {
        const { fk, heads } = window._bootSocial();
        window._putQA(fk, 0, [
            { p: heads[0].p, q: '导读这段讲的是什么？', a: '答' },      // 用户自己打的，不算
            { p: heads[1].p, q: '导读一下这节吧', a: '答' },            // 同上
            { p: heads[2].p, q: '导读', a: '答' }                        // 真导读（没小节标题时就长这样）
        ]);
        rbRenderChapters();
        const secs = [...document.querySelectorAll('#rbChapterList .rb-sec')].map(el => el.querySelector('.rb-sec-p').textContent);
        const meta = document.querySelector('#rbChapterList .rb-chap-meta').textContent;
        return { secs, meta };
    });
    ok('「导读这段讲的是什么？」不算导读', /^P\d+$/.test(E.secs[0]), JSON.stringify(E.secs));
    ok('「导读一下这节吧」也不算', /^P\d+$/.test(E.secs[1]), JSON.stringify(E.secs));
    eq('光秃秃的「导读」是真导读（没小节标题时就长这样）', E.secs[2], '📖');
    ok('章行只数了那一条真导读', /📖/.test(E.meta) && !/📖 \d/.test(E.meta), E.meta);

    /* ── F 组：一条导读都没有时，一个字都不多冒 ────────────────── */
    const F = await page.evaluate(() => {
        const { fk } = window._bootSocial();
        window._putQA(fk, 0, [{ p: 5, q: '背景：某某', a: '内容' }]);
        rbRenderChapters();
        return document.querySelector('#rbChapterList .rb-chap-meta').textContent;
    });
    ok('没做过导读的章节不显示 📖（极简：没有就不占地方）', !/📖/.test(F), F);
    ok('背景照旧显示', /🏛 1/.test(F), F);

    /* ── H 组：⚠️章行那串信息要短，因为它直接吃标题的宽度 ──────────
     * .rb-chap-info 是 flex，标题和这串信息**同一行**：标题 flex:1 带省略号、
     * 这串 flex-shrink:0。所以这里每多一个字，标题就少露一个字。用户报的正是这个：
     * 知乎文集标题本身就是全部信息量，加上「已标 N 条 · 已导读 N 节」后只剩八九个字。
     * 「没小节的书导读数永远是 1」那条尤其要守——那个 1 一点信息都不带，纯占地方。 */
    const H = await page.evaluate(() => {
        // 知乎文集那种：长标题、没有任何小标题结构
        const paras = [];
        for (let i = 0; i < 12; i++) paras.push('文章正文段落，' + '话'.repeat(90));
        const book = {
            id: 'bk_z', fileName: '知乎存档.txt', fileSize: 33,
            chapters: [{ title: '【商业经济】教育家 - 为什么，这几年民办教育集体退潮了？', body: paras.join('\n') }]
        };
        window.rbBooks = [book]; window.rbGetBook = () => book;
        localStorage.setItem('reading_book_kind', JSON.stringify({ '知乎存档.txt|33': 'social' }));
        window.rbActiveBookId = 'bk_z'; window.rbPickForReader = true;
        document.getElementById('rbChapterSearch').value = '';
        const fk = readerBookKey('bk_z');
        const all = readerQAAll();
        // 没小标题的章：rbSectionOf 把整章当作一节，导读挂在 P1，所以只可能有 1 条
        all[fk] = { 0: { ts: Date.now(), list: [
            { p: 1, q: '导读', a: '这篇讲的是……' },
            { p: 4, q: '背景：民办教育促进法', a: '内容' },
            { p: 7, q: '背景：双减', a: '内容' },
            { p: 9, q: '背景：VIE 架构', a: '内容' }
        ] } };
        localStorage.setItem('reader_qa', JSON.stringify(all));
        rbRenderChapters();
        const meta = document.querySelector('#rbChapterList .rb-chap-meta').textContent;
        return { meta, 有小节行: document.querySelectorAll('#rbChapterList .rb-sec').length };
    });
    eq('没小标题的章不展开小节（导读整章算一节）', H.有小节行, 0);
    ok('⚠️「已标」「条」「已导读」「节」这些词全去掉了（每个字都在吃标题宽度）',
        !/已标|已导读|条|节/.test(H.meta), H.meta);
    ok('⚠️没小节的书不显示那个恒为 1 的导读数（纯占地方）', !/📖\s*\d/.test(H.meta), H.meta);
    ok('背景条数留着（这个数会变，有用）', /🏛 3/.test(H.meta), H.meta);
    ok('整串信息压到 20 个字符以内（原来 34，标题被砍掉一半）', H.meta.length <= 20, H.meta + ' 共 ' + H.meta.length + ' 字符');

    /* ── G 组：小说（非社科书）不受影响 ───────────────────────────
     * 小说压根没有导读这个功能，目录也不展开小节，这一路必须一字未变。 */
    const G = await page.evaluate(() => {
        const body = [];
        for (let i = 0; i < 40; i++) body.push('小说正文' + '啊'.repeat(200));
        const book = { id: 'bk_n', fileName: '天龙八部.txt', fileSize: 88, chapters: [{ title: '第一回', body: body.join('\n') }] };
        window.rbBooks = [book]; window.rbGetBook = (id) => (id === 'bk_n' ? book : null);
        localStorage.setItem('reading_book_kind', JSON.stringify({}));   // 默认＝小说
        window.rbActiveBookId = 'bk_n'; window.rbPickForReader = true;
        document.getElementById('rbChapterSearch').value = '';
        rbRenderChapters();
        return {
            有小节行: document.querySelectorAll('#rbChapterList .rb-sec').length,
            meta: document.querySelector('#rbChapterList .rb-chap-meta').textContent
        };
    });
    eq('小说目录不展开小节（老行为）', G.有小节行, 0);
    ok('小说章行上不冒导读标记', !/📖/.test(G.meta), G.meta);

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
