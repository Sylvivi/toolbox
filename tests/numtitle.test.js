/* 「数字《标题》」切章规则的回归测试。
 *
 * 起因：用户 2026-08-04 报《R医院（正）》目录坏——「（本章完）」「（完）」「（待续）」被当成了章节名。
 * 实情是这本书的章节标题是 `数字《标题》` 格式（`1《开章》`、`22《司柏斯·选择》`、`45 《北极冷冻公司》上`），
 * 而这个格式**以前没有任何规则认**，`rbAutoSplit` 打分时它得 0 分，反而让 `bracket` 把
 * 「（本章完）」这类括号行当成了章节标题，134 个真标题全被吞进 17 个大章、单章最重 3.1 万字。
 *
 * 判据两道闸：
 *   ① 数字后面必须（可带空格）直接跟书名号，数字限 1~3 位（防「2015《xxx》」年份行）；
 *   ② 书名号收尾之后最多再 20 个字就必须到行尾（防「1《史记》之好看，大家都知道……」正文行误伤）。
 * 全库量过（370 本跑改前/改后）：只有《R医院（正）》一本命中，134 行全是真标题，零误伤。
 *
 * 跑法：node tests/numtitle.test.js
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

    /* ===== A 组：num-title 规则认哪些行 ===== */
    const A = await page.evaluate(() => {
        const re = new RegExp(RB_PRESETS['num-title']);
        const t = s => re.test(s.trim());
        return {
            // 该认的——数字 + 书名号标题
            基本: t('1《开章》'),
            带尾巴: t('6《司吉》A'),
            数字和书名号间有空格: t('45 《北极冷冻公司》上'),
            书名号内有逗号: t('2《电梯，楼梯》'),
            书名号内有间隔号: t('4《司柏斯·初遇》（上）'),
            尾巴最长那种: t('113《海马男》（零散的一章）'),
            最大章号: t('141《汤》'),
            // 该拒的
            四位数字: t('2015《年鉴》'),
            书名号后是长正文: t('1《史记》之好看，大家都知道。书中写了那么多精彩的故事。'),
            点号编号不掺和: t('1.《相遇》'),
            无数字纯书名: t('《无争》'),
            中文数字不吃这条: t('第一回《开章》'),
            正文段落: t('他拿出1《开章》来说事，翻来覆去地讲。')
        };
    });
    ok('`1《开章》` 认', A.基本);
    ok('`6《司吉》A` 认（书名号后带尾缀）', A.带尾巴);
    ok('`45 《北极冷冻公司》上` 认（数字和《之间有空格）', A.数字和书名号间有空格);
    ok('`2《电梯，楼梯》` 认（书名号内带逗号）', A.书名号内有逗号);
    ok('`4《司柏斯·初遇》（上）` 认（书名号内带间隔号）', A.书名号内有间隔号);
    ok('`113《海马男》（零散的一章）` 认（尾巴最长那种，7 字）', A.尾巴最长那种);
    ok('`141《汤》` 认（最大章号）', A.最大章号);
    ok('⚠️`2015《年鉴》` 不认（4 位数字，限 1~3 位）', !A.四位数字);
    ok('⚠️`1《史记》之好看，大家都知道……` 不认（书名号后超 20 字）', !A.书名号后是长正文);
    ok('⚠️`1.《相遇》` 不认（带点号，那是 numbered 的活）', !A.点号编号不掺和);
    ok('⚠️`《无争》` 不认（没数字，bracket 的活）', !A.无数字纯书名);
    ok('⚠️`第一回《开章》` 不认（中文数字，chinese 的活）', !A.中文数字不吃这条);
    ok('⚠️正文里提到「1《开章》」的句子不认', !A.正文段落);

    /* ===== B 组：整篇重切（模拟 R医院 的结构） ===== */
    const B = await page.evaluate(() => {
        const sample = [
            'RP世界物种书之——R医院短篇系列',
            '',
            '序',
            '这是一个男男生子的系列。',
            '',
            '1《开章》',
            '',
            '“我叫黑雨，以后请多指教。”',
            '灰湖医生把手搭了上去。',
            '',
            '2《电梯，楼梯》',
            '',
            '电梯门合上，上升了两层，就停住了。',
            '',
            '45 《北极冷冻公司》上',
            '',
            '探头在高隆滚圆的肚子上滑动。',
            '晚上，黑雨回到了宿舍。',
            ''
        ].join('\n');
        const chapters = rbAutoSplit(sample);
        return {
            titles: chapters.map(c => c.title),
            bodies: chapters.map(c => c.body),
            count: chapters.length,
            sample: sample
        };
    });
    ok('切出 4 章（前言/引言 + 3 个真实章节）', B.count === 4, '实际 ' + B.count);
    ok('第一章是设定介绍（无标题行，兜底 前言/引言）', B.titles[0] === '前言 / 引言', '实际 ' + B.titles[0]);
    ok('第二章标题 = 1《开章》', B.titles[1] === '1《开章》', '实际 ' + B.titles[1]);
    ok('第三章标题 = 2《电梯，楼梯》', B.titles[2] === '2《电梯，楼梯》', '实际 ' + B.titles[2]);
    ok('第四章标题 = 45 《北极冷冻公司》上（带空格原样保留）', B.titles[3] === '45 《北极冷冻公司》上', '实际 ' + B.titles[3]);
    ok('第一章正文含设定介绍首行', B.bodies[0].includes('RP世界物种书之'));
    ok('第二章正文是开章内容、不含标题行', B.bodies[1].includes('“我叫黑雨') && !B.bodies[1].includes('1《开章》'));
    ok('第四章正文是最后一段、不含标题行', B.bodies[3].includes('回到了宿舍') && !B.bodies[3].includes('北极冷冻公司'));
    // 无损：body0 + title1 + body1 + ... 应还原样本
    let joined = B.bodies[0];
    for (let i = 1; i < B.count; i++) joined += B.titles[i] + B.bodies[i];
    const norm = s => s.replace(/\s+/g, '');
    ok('回拼去空白 == 样本去空白（无损）', norm(joined) === norm(B.sample));
    ok('没有空正文章', B.bodies.every(b => b.trim().length > 0));

    /* ===== C 组：auto 探测表里有这条规则 ===== */
    const C = await page.evaluate(() => {
        // 直接看 rbAutoSplit 源码里有没有 num-title（防止有人只加了 RB_PRESETS、漏了探测表）
        return {
            src: rbAutoSplit.toString(),
            reInPreset: RB_PRESETS['num-title']
        };
    });
    ok('rbAutoSplit 的探测表里有 num-title（只加 preset 不加探测表 = auto 还是认不出）',
        C.src.indexOf("'num-title'") !== -1, '');
    ok('RB_PRESETS 里有 num-title 规则', !!C.reInPreset, '');

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join('; '));

    const failed = results.filter(r => !r.pass);
    console.log(results.map(r => (r.pass ? '✅' : '❌') + ' ' + r.name + (r.pass ? '' : ' —— ' + (r.detail || ''))).join('\n'));
    console.log(failed.length ? `\n❌ ${failed.length} 条失败` : `\n✅ 全过（${results.length} 条）`);
    await browser.close();
    process.exit(failed.length ? 1 : 0);
})();
