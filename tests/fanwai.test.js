/* 「番外」章节标题识别的回归测试。
 *
 * 起因：用户 2026-07-28 追加番外时把标题写成「番外一、」，切章认不出来——
 * `cn-num-dot` 规则要求**行首第一个字就是中文数字**，前面多了「番外」两字就不匹配，
 * 于是整篇被切成一坨、兜底命名成「前言 / 引言」（她问「它为什么会自己取名叫前言呀？」）。
 * 她书库里 `番外·xxx.txt` 有十几本，所以单列一条 `fanwai` 规则。
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

    /* ===== A 组：她那个文件——每章标题是「番外一、」 ===== */
    const A = await page.evaluate(() => {
        const txt = '番外一、\n\n正文甲甲甲。\n\n番外二、相逢\n\n正文乙乙乙。\n\n番外三、\n\n正文丙丙丙。';
        return rbAutoSplit(txt).map(c => c.title);
    });
    eq('「番外一、」这种自动就能切出来（不再整篇一坨）', A, ['番外一、', '番外二、相逢', '番外三、']);

    /* ===== B 组：番外的几种常见写法 ===== */
    const B = await page.evaluate(() => {
        const re = new RegExp(RB_PRESETS.fanwai);
        const t = s => re.test(s.trim());
        return {
            顿号: t('番外一、'), 带标题: t('番外二 相逢'), 间隔号: t('番外·贾致篇'),
            番外篇: t('番外篇'), 光番外: t('番外'), 冒号: t('番外：后来的事'),
            // 不该认的：正文里以「番外」开头的一整段
            正文段落: t('番外这个词最早是日本漫画用的，后来中文网络小说也开始用它来指正篇之外的补充故事，通常写主角的日常或者配角视角。'),
            中间出现: t('这是番外一、写的'),
            // ⚠️写测试时当场踩到的误判：只卡长度的话这句也会被当成章节名，
            //   于是真标题下面变空、被 filter(body.length>0) 静默丢掉，番外反而整个消失
            短句也以番外开头: t('番外正文甲。'),
            番外的什么什么: t('番外的部分我写完了。')
        };
    });
    ok('「番外一、」认', B.顿号);
    ok('「番外二 相逢」认', B.带标题);
    ok('「番外·贾致篇」认', B.间隔号);
    ok('「番外篇」认', B.番外篇);
    ok('光一个「番外」也认', B.光番外);
    ok('「番外：后来的事」认', B.冒号);
    ok('⚠️正文里以「番外」开头的长段落**不认**（否则正文会被切碎）', !B.正文段落);
    ok('「番外」不在行首的不认', !B.中间出现);
    ok('⚠️「番外正文甲。」这种短句不认（后面必须跟分隔符或序号）', !B.短句也以番外开头);
    ok('「番外的部分我写完了。」不认', !B.番外的什么什么);

    /* ===== C 组：混排——正文用「第X章」、末尾几篇用「番外」=====
       这是最常见的形状。番外只有两三篇，永远赢不了几百章的正文，
       老逻辑（只选一条赢家规则）会把番外整个吞进最后一章。 */
    const C = await page.evaluate(() => {
        let txt = '';
        for (let i = 1; i <= 5; i++) txt += '第' + '一二三四五'[i - 1] + '章 标题\n\n这一章的正文。\n\n';
        txt += '番外一、\n\n他后来又见了她一面。\n\n番外二、\n\n那年的雪下得很大。';
        const chs = rbAutoSplit(txt);
        return { 章名: chs.map(c => c.title), 番外正文进对地方了: (chs[chs.length - 2] || {}).body };
    });
    eq('正文和番外都切出来了（番外没被吞进最后一章）', C.章名,
        ['第一章 标题', '第二章 标题', '第三章 标题', '第四章 标题', '第五章 标题', '番外一、', '番外二、']);
    eq('番外的正文跟着自己的标题走', C.番外正文进对地方了, '他后来又见了她一面。');

    /* ===== D 组：只有一篇番外的文件（追加番外时最常见）=====
       只有 1 处匹配时老逻辑会掉进「空行分隔」，把每个自然段都当成一章。 */
    const D = await page.evaluate(() => {
        const txt = '番外·贾致篇\n\n第一段正文。\n\n第二段正文。\n\n第三段正文。';
        const chs = rbAutoSplit(txt);
        return { 章数: chs.length, 章名: chs.map(c => c.title), 正文段数: (chs[0].body || '').split('\n').filter(x => x.trim()).length };
    });
    eq('只有一篇番外时切成一章（不再每段一章）', D.章数, 1);
    eq('章名就是那行番外标题', D.章名, ['番外·贾致篇']);
    eq('三段正文都在这一章里，一段不丢', D.正文段数, 3);

    /* ===== E 组：没有番外的书，切法一个字都不许变（别改坏老书）===== */
    const E = await page.evaluate(() => {
        const txt = '第一章 起\n\n正文甲。\n\n第二章 承\n\n正文乙。\n\n第三章 转\n\n正文丙。';
        return rbAutoSplit(txt).map(c => c.title);
    });
    eq('不含番外的书照旧按「第X章」切', E, ['第一章 起', '第二章 承', '第三章 转']);

    /* ===== F 组：手动选「番外」这条切法也要能用（预览框里换切法走的是这条路）===== */
    const F = await page.evaluate(() => {
        const txt = '番外一、\n\n甲。\n\n番外二、\n\n乙。';
        return {
            手动切: rbSplitByPattern(txt, RB_PRESETS.fanwai).map(c => c.title),
            下拉里有这一项: !!document.querySelector('#rbPresetSelect option[value="fanwai"]')
        };
    });
    eq('手动选「番外」切法切得对', F.手动切, ['番外一、', '番外二、']);
    ok('目录的「切法」下拉里有「番外」这一项', F.下拉里有这一项);


    /* ===== G 组：光秃秃的「1.」「01.」也要认（2026-07-28 补）=====
       原来 numbered 结尾写死 `.+`（点号后面必须还有字），光秃秃的一行匹配不上，
       《温柔故事》整本被切成一坨、章名兜底成「前言 / 引言」就是这么来的。
       她真实书库里 24 本、871 行是这种写法。 */
    const G = await page.evaluate(() => {
        const re = new RegExp(RB_PRESETS.numbered);
        const t = s => re.test(s.trim());
        const txt = '1.\n\n第一段。\n\n2.\n\n第二段。\n\n3.\n\n第三段。';
        return {
            光秃秃1: t('1.'), 补零01: t('01.'), 顿号1: t('1、'), 带标题: t('1. 相遇'),
            年份不认: t('2015.'), 四位数不认: t('1024.'),
            小数不受影响: t('1.5 万字'),
            切出来: rbAutoSplit(txt).map(c => c.title)
        };
    });
    ok('光秃秃的「1.」认', G.光秃秃1);
    ok('补零的「01.」认', G.补零01);
    ok('「1、」认', G.顿号1);
    ok('「1. 相遇」照旧认', G.带标题);
    ok('⚠️「2015.」这种年份行不认（光秃秃那半截限死 1~3 位数字）', !G.年份不认);
    ok('「1024.」也不认', !G.四位数不认);
    ok('「1.5 万字」照旧认（这条行为没变）', G.小数不受影响);
    eq('整篇「1. 2. 3.」标号的文件能切成 3 章（不再一坨）', G.切出来, ['1.', '2.', '3.']);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
