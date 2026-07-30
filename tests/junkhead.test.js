/* EPUB 每章开头那行占位（「未知」）的回归测试（2026-07-30 加）。
 *
 * 起因：用户读《史记的读法》时报「在阅读里面，每一章第二行都有个未知，不知道为啥」。
 * 真相是每章正文开头有两行垃圾：
 *     P1  认识司马迁      ← 阅读器自己拼的章节名（readerChapterPair）
 *     P2  未知            ← EPUB 的元数据占位（作者/标题字段没填）
 *     P3   认识司马迁     ← 正文里又重复一遍的章节名
 * 老的 rbStripTitleInBody 只在「标题正好是正文第一行」时才剥，被 P2 挡住 → 认不出来，
 * 所以「🧹 清理重复段落」对这本书一直是灰的。
 *
 * ⚠️这套测试最重要的一条是 B 组：**不许误删真的上级标题**。
 * 量过用户真实书库：挡在标题前面的行共 111 处，只有 31 处是这种占位，
 * 剩下 80 处是真内容（梁衡那本每章前的「上篇 我的阅读」、欧·亨利那本的篇名）。
 * 所以名单写死几个占位词，绝不能改成「短行就跳过」——那会静默删掉原文。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    page.on('dialog', d => d.accept().catch(() => {}));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* ── A 组：史记的读法那种形状，剥得干净 ─────────────────────── */
    const A = await page.evaluate(() => {
        const r = rbStripTitleInBody('认识司马迁', '未知\n 认识司马迁\n太史公自序里说……\n第二段正文。');
        const r2 = rbStripTitleInBody('如何读史记？', 'bookcover\n如何读史记？\n正文开始。');
        const r3 = rbStripTitleInBody('某章', '未知\n某章\n正文');
        return { hit: r.hit, body: r.body, hit2: r2.hit, body2: r2.body, hit3: r3.hit, body3: r3.body };
    });
    ok('「未知 + 重复的章节名」认出来了', A.hit, JSON.stringify(A));
    eq('两行垃圾一起删掉，正文一个字不动', A.body, '太史公自序里说……\n第二段正文。');
    ok('bookcover 这种占位也认', A.hit2, JSON.stringify(A));
    eq('剥完剩正文', A.body2, '正文开始。');
    ok('标题行前面带空格也认得出（rbHtmlToText 会带出前导空格）', A.hit3 && A.body3 === '正文');

    /* ── B 组：⚠️绝不误删真的上级标题（这是最贵的一条） ──────────
     * 梁衡那本 44 章、欧·亨利那本 15 章都长这个形状，删了就是丢原文。 */
    const B = await page.evaluate(() => {
        const 梁衡 = rbStripTitleInBody('说文章的三层格', '中篇我的写作\n说文章的三层格\n文章有三层……');
        const 欧亨利 = rbStripTitleInBody('汤米和窃贼', '仙人摘豆\n汤米和窃贼\n那天夜里……');
        const 短行 = rbStripTitleInBody('第二章', '一\n第二章\n正文');
        return {
            梁衡hit: 梁衡.hit, 梁衡body: 梁衡.body,
            欧hit: 欧亨利.hit, 短行hit: 短行.hit
        };
    });
    ok('⚠️「中篇我的写作」是真的上级标题，一个字不动', !B.梁衡hit, JSON.stringify(B));
    eq('原文原样返回', B.梁衡body, '中篇我的写作\n说文章的三层格\n文章有三层……');
    ok('⚠️欧·亨利那本的篇名也不动', !B.欧hit, JSON.stringify(B));
    ok('⚠️光是「短行」不构成删除理由（名单写死，不按长度猜）', !B.短行hit, JSON.stringify(B));

    /* ── C 组：老行为一字未变 ───────────────────────────────── */
    const C = await page.evaluate(() => {
        const 老 = rbStripTitleInBody('第一章 开端', '第一章 开端\n正文正文');
        const 不重复 = rbStripTitleInBody('第一章 开端', '正文正文');
        const 空标题 = rbStripTitleInBody('', '未知\n正文');
        return { 老hit: 老.hit, 老body: 老.body, 不hit: 不重复.hit, 不body: 不重复.body, 空hit: 空标题.hit, 空body: 空标题.body };
    });
    ok('标题就在第一行的老情况照常剥', C.老hit && C.老body === '正文正文', JSON.stringify(C));
    ok('正文里没重复标题就不动', !C.不hit && C.不body === '正文正文', JSON.stringify(C));
    ok('没有标题时原样返回（不会把占位行当标题删）', !C.空hit && C.空body === '未知\n正文', JSON.stringify(C));

    /* ── D 组：整本书走一遍「🧹 清理重复段落」 ───────────────────── */
    const D = await page.evaluate(() => {
        const mk = (t) => ({ title: t, body: '未知\n ' + t + '\n' + t + '这一章的正文，讲了很多事情。\n第二段。' });
        const book = {
            id: 'bk_j', fileName: '史记的读法.epub', fileSize: 3528505,
            chapters: [mk('认识司马迁'), mk('李将军列传：国士之风'), mk('权力与命运')],
            rawText: ''
        };
        book.rawText = book.chapters.map(rbChapRaw).join('\n\n');
        window.rbBooks = [book];
        window.rbGetBook = (id) => (id === 'bk_j' ? book : null);
        const before = rbCountDups(book);
        const st = rbFixBookDups(book);
        return {
            数出来: before.total,
            清了: st.half + st.title,
            清后正文: book.chapters[0].body,
            rawText里还有未知: /(^|\n)\s*未知\s*(\n|$)/.test(book.rawText)
        };
    });
    eq('三章都被数出来（数出来才会显示 🧹 那一项）', D.数出来, 3);
    eq('三章都清掉了', D.清了, 3);
    eq('清完只剩正文', D.清后正文, '认识司马迁这一章的正文，讲了很多事情。\n第二段。');
    ok('⚠️rawText 里的占位行也清了（不然点一下「重新拆分」它就长回来）', !D.rawText里还有未知, JSON.stringify(D));

    /* ── E 组：以后新导的 EPUB 别再带进来 ───────────────────────── */
    const E = await page.evaluate(() => {
        // 复刻 rbHandleEpub 里那一步（真跑解析要联网加载 JSZip，这里只验那一行逻辑）
        const title = '认识司马迁';
        const text = '未知\n 认识司马迁\n太史公的成长之路\n他生在龙门……';
        const st = rbStripTitleInBody(title, text);
        return { body: (st.hit ? st.body : text).trim() };
    });
    eq('导进来时就是干净的，不用事后再清一遍', E.body, '太史公的成长之路\n他生在龙门……');

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
