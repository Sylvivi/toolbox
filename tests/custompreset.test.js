/* 「这本书的专用切法」回归测试。
 *
 * 起因：用户 2026-08-04 报「悠哉大王被我改了一下之后，选重新拆分，之前的那个目录又不见了」。
 * 有些书的章节标记**没有任何一条通用规则认得**（这本前半用光秃秃的「01 02 03」分节、
 * 后半用「【三个月】」，还夹着「08表白」「14【四个月】」这种数字带小标题的），只能一本一本
 * 手工定切法。而「重新拆分」原本只认 auto / RB_PRESETS 里那几条——**手工切好的书一点就毁**，
 * 这本 30 章当场掉回 12 章、7 万字又缩成一坨。
 *
 * 修法＝书上存一份 `splitPattern`，下拉框多一项「这本书的专用切法」（只对存了的书露出来）。
 * ⚠️刻意**不往 `rbAutoSplit` 的探测表里加纯数字规则**——那是打分选一条的机制，加进去会影响
 * 全库（epub 的页码就是光秃秃一行数字）。专用切法只存在这一本书身上，auto 一个字都不受影响。
 *
 * 跑法：node tests/custompreset.test.js
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

// 用户那本书的形状：数字分节 + 【…】小节 + 数字带小标题，三种混排
const PAT = '^\\s*(?:\\d{1,3}[^\\n]{0,10}|【[^】\\n]{1,10}】)\\s*$';
const BODY = '这里是一大段正文，写长一点免得被当成标题，随便凑够字数好让切章规则正常工作。';
const RAW = ['罗熏×劳渚', '01', BODY + '甲', '02', BODY + '乙', '08表白', BODY + '丙',
    '【三个月】', BODY + '丁', '14【四个月】', BODY + '戊'].join('\n\n');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* ===== A 组：专用切法本身切得对，而且 auto 确实切不出来（＝这本书真需要它） ===== */
    const A = await page.evaluate(({ RAW, PAT }) => ({
        custom: rbSplitByPattern(RAW, PAT).map(c => c.title),
        auto: rbAutoSplit(RAW).map(c => c.title),
    }), { RAW, PAT });
    ok('A1 专用切法切出全部 5 个标记', A.custom.length === 6 && A.custom.slice(1).join(',') === '01,02,08表白,【三个月】,14【四个月】', JSON.stringify(A.custom));
    // ⚠️判据看「目录内容对不对」，别看章数——auto 掉进「空行分段」兜底时章数反而更多，
    //   全是「段落 N」，一条真标记都没认出来（这正是它不能用的原因）。
    ok('A2 auto 得不到这份目录（所以才需要专用切法）',
        A.auto.slice(1).join(',') !== '01,02,08表白,【三个月】,14【四个月】', JSON.stringify(A.auto));

    /* ===== B 组：点「重新拆分」不会把它打回原形（用户报的就是这一条） ===== */
    const B = await page.evaluate(({ RAW, PAT }) => {
        const b = { id: 'bk_cp', fileName: 'cp.txt', fileSize: 1, rawText: RAW, preset: 'custom', splitPattern: PAT };
        b.chapters = rbSplitByPattern(RAW, PAT);
        rbBooks.unshift(b); rbActiveBookId = b.id;
        const before = b.chapters.length;
        document.getElementById('rbPresetSelect').value = 'custom';
        rbReSplit();
        const after = rbGetBook('bk_cp').chapters.length;
        const titles = rbGetBook('bk_cp').chapters.map(c => c.title);
        rbBooks.shift(); rbActiveBookId = null;
        return { before, after, titles };
    }, { RAW, PAT });
    ok('B1 重新拆分后章数一个不少', B.before === B.after && B.after === 6, JSON.stringify(B));
    ok('B2 目录内容也一字不变', B.titles.slice(1).join(',') === '01,02,08表白,【三个月】,14【四个月】', JSON.stringify(B.titles));

    /* ===== C 组：下拉框只对存了专用切法的书露出这一项 ===== */
    const C = await page.evaluate(({ RAW, PAT }) => {
        const mk = (id, extra) => Object.assign({ id, fileName: id + '.txt', fileSize: 1, rawText: RAW, chapters: rbSplitByPattern(RAW, PAT) }, extra);
        const withPat = mk('bk_c1', { preset: 'custom', splitPattern: PAT });
        const plain = mk('bk_c2', { preset: 'auto' });
        // 坏数据：说自己是 custom，却没存 pattern（比如老版本同步下来的）
        const broken = mk('bk_c3', { preset: 'custom' });
        rbBooks.unshift(withPat, plain, broken);
        const opt = document.getElementById('rbPresetCustomOpt');
        const sel = document.getElementById('rbPresetSelect');
        const read = id => { rbActiveBookId = id; rbOpenBook(id); return { shown: opt.style.display !== 'none', value: sel.value }; };
        const r = { withPat: read('bk_c1'), plain: read('bk_c2'), broken: read('bk_c3') };
        rbBooks.splice(0, 3); rbActiveBookId = null;
        return r;
    }, { RAW, PAT });
    ok('C1 有专用切法的书：选项露出来、下拉框停在它上面', C.withPat.shown && C.withPat.value === 'custom', JSON.stringify(C.withPat));
    ok('C2 普通的书：选项藏起来', !C.plain.shown, JSON.stringify(C.plain));
    ok('C3 说是 custom 却没存 pattern → 退回 auto，不留个选不了的空档', !C.broken.shown && C.broken.value === 'auto', JSON.stringify(C.broken));

    /* ===== D 组：别的书一个都别受影响（auto 的探测表一个字没动） ===== */
    const D = await page.evaluate(() => {
        const P = '这里是一大段正文，写长一点免得被当成标题，随便凑够字数好让切章规则正常工作。';
        // epub 常见的页码：光秃秃一行数字。如果纯数字被加进 auto 探测表，这本就会被切成碎片
        const epub = ['第一章 夜归', P + '甲', '12', P + '乙', '第二章 雪停', P + '丙', '13', P + '丁'].join('\n\n');
        return { titles: rbAutoSplit(epub).map(c => c.title) };
    });
    ok('D1 auto 仍然不认光秃秃的数字行（页码不会把 epub 切碎）',
        D.titles.join(',') === '第一章 夜归,第二章 雪停', JSON.stringify(D.titles));

    /* ===== E 组：源码级——切法要跟着同步下来，否则手机上照样被打回原形 ===== */
    const SRC = require('fs').readFileSync(require('path').resolve(__dirname, '..', 'index.html'), 'utf8');
    const refresh = (SRC.match(/function bkSyncRefreshOne[\s\S]{0,2600}/) || [''])[0];
    ok('E1 bkSyncRefreshOne 会带回 preset', /book\.preset = full\.preset/.test(refresh));
    ok('E2 bkSyncRefreshOne 会带回 splitPattern', /book\.splitPattern = full\.splitPattern/.test(refresh));

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  ← ' + (r.detail || ''))));
    console.log(bad.length ? `\n❌ ${bad.length} 条没过（共 ${results.length} 条）` : `\n✅ 全过（${results.length} 条）`);
    process.exit(bad.length ? 1 : 0);
})();
