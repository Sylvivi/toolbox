/* 「重复段落」清理的回归测试。
 *
 * 起因：用户 2026-07-28 截图——读一本书，每章开头章节名重复一遍，
 * 每个长段落前面还躺着一条「它自己的前 80 字」。查下来是导书管线弄坏的：
 * `__EMPTY_LINE__` 拆章把每块首行 `substring(0,80)` 当章节名、却没从正文里拿掉，
 * 之后书在「回拼 rawText（title + '\n\n' + body）→ 重新拆分」里转一圈，
 * 那条半截话就被**写死进正文**。比对过原始 txt，源文件是干净的。
 * 波及她书库 86 本 / 2206 处。
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
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* ===== A 组：删半截段（只认「正好 80 字 + 是下一段前缀」这一刀）===== */
    const A = await page.evaluate(() => {
        const long = '甲'.repeat(80) + '乙'.repeat(30);       // 110 字的正常段落
        const half = long.slice(0, 80);                        // 它被截出来的前 80 字
        const r1 = rbCleanDupParas(half + '\n\n' + long);
        // 只有 79 字的前缀：不是那一刀，多半是作者真写的重复，不许删
        const s = '丙'.repeat(79);
        const r2 = rbCleanDupParas(s + '\n\n' + s + '丁');
        // 一模一样的两段（不是「前缀」而是全等）：也不许删，那是复读写法
        const r3 = rbCleanDupParas(long + '\n\n' + long);
        // 连着三段：第一对处理完，完整的那段不该再被当成下一对的短边
        const long2 = '甲'.repeat(80) + '戊'.repeat(50);
        const r4 = rbCleanDupParas(half + '\n\n' + long + '\n\n' + long2);
        return {
            删了几处: r1.n, 剩下的: r1.text.split('\n').filter(x => x.trim()),
            七十九字不删: r2.n, 全等不删: r3.n,
            三段: { n: r4.n, 段数: r4.text.split('\n').filter(x => x.trim()).length }
        };
    });
    eq('80 字的半截段被删掉（完整那段留下）', A.删了几处, 1);
    eq('留下的是完整的那一段、一个字不少', A.剩下的.length + '|' + A.剩下的[0].length, '1|110');
    eq('79 字的前缀不动（不是那一刀，可能是作者真写的）', A.七十九字不删, 0);
    eq('一模一样的两段不动（复读、回声那种写法是有的）', A.全等不删, 0);
    eq('连着几段时不会把完整段当成下一对的短边误删', A.三段, { n: 1, 段数: 2 });

    /* ===== B 组：章节名在正文开头重复一遍 ===== */
    const B = await page.evaluate(() => {
        const r1 = rbStripTitleInBody('第一章', '第一章\n\n正文一\n正文二');
        const r2 = rbStripTitleInBody('第一章', '正文一\n正文二');          // 没重复，别乱动
        const r3 = rbStripTitleInBody('第一章', '第一章还有别的字\n正文');   // 只是开头像，不是同一行
        return { 删了: r1.hit, 剩下: r1.body, 没重复的没动: r2.hit + '|' + r2.body, 只是开头像: r3.hit };
    });
    ok('正文开头跟章节名一模一样的那行被删掉', B.删了);
    eq('删完正文从真正的第一段开始', B.剩下, '正文一\n正文二');
    eq('没重复的书一个字不动', B.没重复的没动, 'false|正文一\n正文二');
    ok('只是「开头像章节名」的段落不许删（那是正文）', !B.只是开头像);

    /* ===== C 组：整本清理 + 数数（菜单靠它决定显不显示「清理」）===== */
    const C = await page.evaluate(() => {
        const long = '甲'.repeat(80) + '乙'.repeat(30);
        const mk = () => ({
            id: 'bk_x', fileName: 'a.txt', fileSize: 1,
            chapters: [
                { title: '1.', body: '1.\n\n' + long.slice(0, 80) + '\n\n' + long },
                { title: '2.', body: '干净的正文' }
            ],
            rawText: '1.\n\n1.\n\n' + long.slice(0, 80) + '\n\n' + long + '\n\n2.\n\n干净的正文'
        });
        const b1 = mk(), c = rbCountDups(b1);
        const b2 = mk(), st = rbFixBookDups(b2);
        return {
            数出来: c,
            数完没改书: b2 !== b1 && b1.chapters[0].body.indexOf('1.\n\n') === 0,
            清完: st,
            第一章: b2.chapters[0].body,
            第二章没动: b2.chapters[1].body,
            rawText清了吗: b2.rawText.indexOf(long.slice(0, 80) + '\n\n' + long) === -1,
            清完再数: rbCountDups(b2).total
        };
    });
    eq('数得出这本书有几处重复（1 处半截段 + 1 章标题重复）', C.数出来, { half: 1, title: 1, total: 2 });
    ok('只数不改书（菜单每次打开都会数一遍）', C.数出来 && C.数完没改书);
    eq('清理删掉的处数对得上', C.清完, { half: 1, title: 1 });
    eq('第一章清完只剩完整正文', C.第一章.split('\n').filter(x => x.trim()).length, 1);
    eq('干净的那一章一个字不动', C.第二章没动, '干净的正文');
    ok('rawText 也一起清了（否则点一下「重新拆分」半截段就长回来）', C.rawText清了吗);
    eq('清完再数就是 0（不会越清越多）', C.清完再数, 0);

    /* ===== D 组：根因——拆章不能再制造重复 ===== */
    const D = await page.evaluate(() => {
        const long = '甲'.repeat(120);                       // 首行本身就是一整段
        // ⚠️__EMPTY_LINE__ 是按**空行**分块的：一块里的几行之间只有单换行
        const byEmpty = rbSplitByPattern('短标题\n正文正文\n\n' + long, '__EMPTY_LINE__');
        return {
            短首行当章节名: byEmpty[0].title,
            并且从正文里拿掉了: byEmpty[0].body,
            长首行不截80字: byEmpty[1].title,
            长首行正文完整: byEmpty[1].body.length,
            块数没少: byEmpty.length
        };
    });
    eq('首行短 → 当章节名', D.短首行当章节名, '短标题');
    eq('当了章节名就从正文里拿掉（阅读时不会显示两遍）', D.并且从正文里拿掉了, '正文正文');
    eq('首行本身是一整段 → 绝不截 80 字当章节名（那正是重复的源头）', D.长首行不截80字, '段落 2');
    eq('这种块的正文一个字不少', D.长首行正文完整, 120);
    eq('拆出来的块数没少（不许因为清理弄丢内容）', D.块数没少, 2);

    /* ===== E 组：回拼 rawText 不能再把章节名塞进正文 ===== */
    const E = await page.evaluate(() => {
        return {
            正文已含标题就不再拼: rbChapRaw({ title: '第一章', body: '第一章\n\n正文' }),
            正常的照旧拼: rbChapRaw({ title: '第一章', body: '正文' }),
            没标题就只有正文: rbChapRaw({ title: '', body: '正文' })
        };
    });
    eq('正文开头已经是章节名了就不再拼一遍（当初就是这一步把重复写死的）', E.正文已含标题就不再拼, '第一章\n\n正文');
    eq('正常的章节照旧「标题＋空行＋正文」', E.正常的照旧拼, '第一章\n\n正文');
    eq('没章节名时只回拼正文', E.没标题就只有正文, '正文');

    /* ===== F 组：清理必须推服务器 =====
       手机才是正本；只改本地的话服务器那份仍是脏的，而且清理不改章数，
       别的设备靠「章数对不上」那条也捡不到，会一直停在脏版本。 */
    const F = await page.evaluate(() => {
        const src = String(rbDedupBook);
        return {
            推服务器: src.indexOf('bkSyncPush(') !== -1,
            存盘: src.indexOf('rbSave()') !== -1,
            作废段落缓存: src.indexOf('_readingMergeCache') !== -1,
            提示重开本章: src.indexOf('重开这一章') !== -1
        };
    });
    ok('清理完会推服务器（不推的话服务器那份永远是脏的）', F.推服务器);
    ok('清理完会存盘', F.存盘);
    ok('清理完作废段落缓存（正文变了）', F.作废段落缓存);
    ok('正在读这本书时提示「重开这一章」（会话里那份是开章时的快照，改书改不到）', F.提示重开本章);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
