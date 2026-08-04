/* 「改错字要同步 rawText」的回归测试。
 *
 * 起因：用户 2026-08-04 报「我在正文里手动给章节标题补上漏掉的顿号，目录却不读取，是本来就这样吗？」
 * 目录不自动更新**确实是设计如此**（改错字刻意不重新切章，否则读痕/划线/问答/背景会集体错位），
 * 但查下去发现底下压着一个真 bug：`_rdEditWriteBook` 只写 `chapters`、**一个字都不碰 `rawText`**，
 * 而目录里的「重新拆分」(`rbReSplit`) 是拿 `rawText` 重切整本的。后果不止「改完标题重切还是老样子」，
 * 更重的是——**她平时改的每一个错字，只要哪天点一下「重新拆分」就全部打回原形**。
 * 「追加章节」那条早写了「rawText 必须一起接」，改错字当初漏了同一件事。
 *
 * 修法＝整行精确匹配 + 唯一性；不唯一时用前后相邻的非空段消歧；还是拿不准就放弃并如实告知用户，
 * 绝不瞎猜替换到别的段落上去。⚠️别改成「整本回拼 rawText」——rawText 是正本、chapters 可能残缺
 * （`filter(body.length>0)` 会把标题行下面没正文的章连内容一起静默丢掉）。
 *
 * 跑法：node tests/editraw.test.js
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* ===== A 组：改动要同步进 rawText，且「重新拆分」认得出 ===== */
    const A = await page.evaluate(() => {
        const P = '这里是一大段正文，写得长一点免得被当成标题，随便凑够字数好让切章规则正常工作。';
        // 「二」漏了顿号——就是用户《一聘空空》那本的形状
        const raw = ['一、', P + '甲', '二', P + '乙', '三、', P + '丙'].join('\n\n');
        const book = { id: 'bk_t', fileName: 't.txt', fileSize: 1, rawText: raw, chapters: rbAutoSplit(raw) };
        const before = book.chapters.map(c => c.title);

        // 找到「二」被吞进了哪一章的第几段
        let ci = -1, p = -1;
        book.chapters.forEach((c, i) => {
            const pre = c.title ? c.title + '\n\n' : '';
            let n = 0;
            (pre + (c.body || '')).split('\n').forEach(l => { if (l.trim()) { n++; if (l.trim() === '二') { ci = i; p = n; } } });
        });
        const wrote = _rdEditWriteBook(book, ci, p, '二', '二、');
        return {
            before, wrote, rawOK: _rdEditRawOK,
            rawHas: book.rawText.split('\n').map(l => l.trim()).indexOf('二、') !== -1,
            rawNoOld: book.rawText.split('\n').map(l => l.trim()).indexOf('二') === -1,
            after: rbAutoSplit(book.rawText).map(c => c.title),
            chapHas: (book.chapters[ci].body || '').indexOf('二、') !== -1,
        };
    });
    ok('A1 改之前「二」被吞进正文，目录只有两章', A.before.length === 2, JSON.stringify(A.before));
    ok('A2 改错字本身成功（chapters 里变成「二、」）', A.wrote && A.chapHas, '');
    ok('A3 rawText 跟着改了（这是本次修的 bug）', A.rawOK && A.rawHas, 'rawOK=' + A.rawOK);
    ok('A4 rawText 里的旧写法没了（是替换不是追加）', A.rawNoOld, '');
    ok('A5 再点「重新拆分」能切出三章（用户最初想要的效果）', A.after.length === 3, JSON.stringify(A.after));
    ok('A6 新目录里有「二、」', A.after.indexOf('二、') !== -1, JSON.stringify(A.after));

    /* ===== B 组：改章节标题也要同步 ===== */
    const B = await page.evaluate(() => {
        const P = '正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文正文。';
        const raw = ['第一章 开场', P + '甲', '第二章 收场', P + '乙'].join('\n\n');
        const book = { id: 'b2', fileName: 'b.txt', fileSize: 1, rawText: raw, chapters: rbAutoSplit(raw) };
        const wrote = _rdEditWriteBook(book, 0, 1, '第一章 开场', '第一章 开场白');
        return {
            wrote, rawOK: _rdEditRawOK,
            title: book.chapters[0].title,
            rawHas: book.rawText.indexOf('第一章 开场白') !== -1,
            otherIntact: book.rawText.indexOf('第二章 收场') !== -1 && book.rawText.indexOf(P + '甲') !== -1,
        };
    });
    ok('B1 章节标题改成功', B.wrote && B.title === '第一章 开场白', B.title);
    ok('B2 标题的改动也进了 rawText', B.rawOK && B.rawHas, '');
    ok('B3 没误伤别的行（第二章和正文原样）', B.otherIntact, '');

    /* ===== C 组：拿不准时绝不瞎改（宁可不同步，也不能替换到别的段落上）===== */
    const C = await page.evaluate(() => {
        const DUP = '他没说话。';
        // 同一句话在书里出现两次，且前后相邻段也一模一样 —— 无从分辨是哪一处
        const blk = ['甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲。', DUP, '乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙。'];
        const raw = ['第一章 上', ...blk, '第二章 下', ...blk].join('\n\n');
        const book = { id: 'b3', fileName: 'c.txt', fileSize: 1, rawText: raw, chapters: rbAutoSplit(raw) };
        const rawBefore = book.rawText;
        const wrote = _rdEditWriteBook(book, 0, 3, DUP, '他还是没说话。');
        return {
            wrote, rawOK: _rdEditRawOK,
            chapChanged: (book.chapters[0].body || '').indexOf('他还是没说话。') !== -1,
            rawUntouched: book.rawText === rawBefore,
        };
    });
    ok('C1 认不准是哪一处时，rawText 一个字都不动', C.rawOK === false && C.rawUntouched, 'rawOK=' + C.rawOK);
    ok('C2 但眼前这一章照样改好（不因为同步不了就整个失败）', C.wrote && C.chapChanged, '');

    /* ===== D 组：相邻段能区分时，要改中正确的那一处 ===== */
    const D = await page.evaluate(() => {
        const DUP = '他没说话。';
        const raw = ['第一章 上', '前情甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲。', DUP, '后事甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲。',
            '第二章 下', '前情乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙。', DUP, '后事乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙。'].join('\n\n');
        const book = { id: 'b4', fileName: 'd.txt', fileSize: 1, rawText: raw, chapters: rbAutoSplit(raw) };
        const wrote = _rdEditWriteBook(book, 1, 3, DUP, '他终于开口了。');
        const lines = book.rawText.split('\n').map(l => l.trim()).filter(l => l);
        return {
            wrote, rawOK: _rdEditRawOK,
            // 改的是第二章那一处：新句子应该排在「前情乙」后面，而第一章那处原样保留
            改中第二处: lines[lines.indexOf('前情乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙。') + 1] === '他终于开口了。',
            第一处没动: lines[lines.indexOf('前情甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲。') + 1] === DUP,
        };
    });
    ok('D1 靠相邻段消歧，改中了正确的那一处', D.rawOK && D.改中第二处, '');
    ok('D2 另一处一个字没动（没误伤）', D.第一处没动, '');

    /* ===== E 组：保留行首空白（有的书正文行首带两个全角空格）===== */
    const E = await page.evaluate(() => {
        const P = '　　这是带全角缩进的正文段落，写长一点免得被当成标题，凑够字数。';
        const raw = ['第一章 甲', P, '第二章 乙', '　　另一段正文另一段正文另一段正文另一段正文另一段正文。'].join('\n\n');
        const book = { id: 'b5', fileName: 'e.txt', fileSize: 1, rawText: raw, chapters: rbAutoSplit(raw) };
        const old = P.trim();
        _rdEditWriteBook(book, 0, 2, old, old.replace('缩进', '锁进'));
        const hit = book.rawText.split('\n').filter(l => l.indexOf('锁进') !== -1)[0] || '';
        return { rawOK: _rdEditRawOK, keepsIndent: /^　　/.test(hit), hit: hit.slice(0, 20) };
    });
    ok('E1 改完保留原来的行首全角缩进', E.rawOK && E.keepsIndent, E.hit);

    /* ===== F 组：没有 rawText 的书别报错 ===== */
    const F = await page.evaluate(() => {
        const book = { id: 'b6', fileName: 'f.txt', fileSize: 1, chapters: [{ title: '第一章', body: '一段正文。' }] };
        let threw = '';
        let wrote = false;
        try { wrote = _rdEditWriteBook(book, 0, 2, '一段正文。', '另一段正文。'); } catch (e) { threw = String(e.message); }
        return { threw, wrote, rawOK: _rdEditRawOK, body: book.chapters[0].body };
    });
    ok('F1 书没有 rawText 时不报错、章节照样改好', !F.threw && F.wrote && F.body === '另一段正文。', F.threw);
    ok('F2 并且如实报「没同步」', F.rawOK === false, 'rawOK=' + F.rawOK);

    /* ===== G 组：上层要把「没同步」告诉用户 ===== */
    const G = await page.evaluate(() => ({
        applySrc: rdEditApply.toString(),
        writeSrc: _rdEditWriteBook.toString(),
    }));
    ok('G1 rdEditApply 把 rawSynced 返回出去', G.applySrc.indexOf('rawSynced') !== -1, '');
    ok('G2 _rdEditWriteBook 里调了 _rdEditWriteRaw（别哪天又被删掉）',
        G.writeSrc.indexOf('_rdEditWriteRaw') !== -1, '');

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join('; '));

    const failed = results.filter(r => !r.pass);
    console.log(results.map(r => (r.pass ? '✅' : '❌') + ' ' + r.name + (r.pass ? '' : ' —— ' + (r.detail || ''))).join('\n'));
    console.log(failed.length ? `\n❌ ${failed.length} 条失败` : `\n✅ 全过（${results.length} 条）`);
    await browser.close();
    process.exit(failed.length ? 1 : 0);
})();
