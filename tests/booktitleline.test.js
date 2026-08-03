/* 「以《书名》开头的正文段落被当成章节标题」的回归测试。
 *
 * 起因：用户 2026-08-04 报《爱你》「有两个目录不太对，跟须尽欢有关」。目录里躺着两条半截正文：
 *   「《须尽欢》里属于我的那部分算是忙完了，我得了闲，没事就在陈褚身边晃悠，他被我扰的烦不胜烦…」
 *   「《须尽欢》的开机发布会日子就快到了，我感冒一直不好自己也着急…」
 * ——`bracket` 规则的开括号字符类里有 `《`，于是**任何以书名号开头的正文段落**都算章节标题。
 * 书名号跟别的括号不一样：【】〔〕基本只在标题里出现，而《书名》在正文里到处都是。
 *
 * 判据＝书名号收尾之后最多再 20 个字就必须到行尾（整行基本就是个书名）。
 * 全库量过（364 本跑改前/改后）：被挡掉的 123 条全是正文段落（最短 25 字，都是完整句子），
 * 真标题一条没伤。⚠️别改成「所有括号都加长度闸」——试过，《史记的读法》92→17 章当场崩。
 *
 * 跑法：node tests/booktitleline.test.js（或 bash tests/run.sh 跑全套）
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

    /* ===== A 组：bracket 规则认哪些行 ===== */
    const A = await page.evaluate(() => {
        const re = new RegExp(RB_PRESETS.bracket);
        const t = s => re.test(s.trim());
        return {
            // 该认的——整行基本就是个书名/标题
            光书名: t('《无争》'),
            书名带作者: t('《日抛男友》by玖年翡  id5258247'),
            书名带来源: t('《怨夫（完）》 | 夏如浅沫的作品集 | 爱发电'),
            方头括号: t('【无争】（一）天降'),
            圆括号编号: t('（35.1）　　大学篇（上）'),
            半角圆括号: t('(1)'),
            方括号: t('[书院记事]'),
            // 不该认的——正文段落，只是开头顶着个书名号
            须尽欢一: t('《须尽欢》里属于我的那部分算是忙完了，我得了闲，没事就在陈褚身边晃悠，他被我扰的烦不胜烦，索性把接送念念上幼儿园的任务都交给了我。'),
            须尽欢二: t('《须尽欢》的开机发布会日子就快到了，我感冒一直不好自己也着急，捏着鼻子把苦掉舌头的中药喝了。'),
            书评段落: t('《史记》之好看，大家都知道。书中写了那么多精彩的故事，还写了让人一读难忘的人物。'),
            短句也是正文: t('《追月》出乎意料的小爆了，爆的还是饰演男二的谢瑶。'),
            // ⚠️老代码开闭括号是混搭的（（ 可以配 》），顺带修掉的一类误伤
            混搭括号: t('（注：还记得《R医院》第一话里面那个狼人吗？他有名字的，叫阿江。')
        };
    });
    ok('`《无争》` 认（整行就是个书名）', A.光书名);
    ok('`《日抛男友》by玖年翡  id5258247` 认（书名后 16 字，还在 20 以内）', A.书名带作者);
    ok('`《怨夫（完）》 | 夏如浅沫的作品集 | 爱发电` 认', A.书名带来源);
    ok('`【无争】（一）天降` 照旧认（别的括号一字没动）', A.方头括号);
    ok('`（35.1）　　大学篇（上）` 照旧认', A.圆括号编号);
    ok('`(1)` 照旧认', A.半角圆括号);
    ok('`[书院记事]` 照旧认', A.方括号);
    ok('⚠️《须尽欢》那段正文**不认**——用户报的就是它', !A.须尽欢一);
    ok('⚠️《须尽欢》第二段正文也不认', !A.须尽欢二);
    ok('以《史记》开头的一整段书评不认', !A.书评段落);
    ok('`《追月》出乎意料的小爆了…`（25 字，被挡掉的里面最短的）不认', !A.短句也是正文);
    ok('⚠️`（注：还记得《R医院》…`（「（」配「》」的混搭）不认', !A.混搭括号);

    /* ===== B 组：《爱你》那本书的形状——整篇按（数字）分章，中间夹两段以书名号开头的正文 ===== */
    const B = await page.evaluate(() => {
        const txt = [
            '爱你', '(1)', '我回家的时候已经十一点多了，玄关还给我留了灯。',
            '（2）', '念念因为是早产儿，身体算不得十分结实，平时的饮食起居都不得不格外注意。',
            '《须尽欢》里属于我的那部分算是忙完了，我得了闲，没事就在陈褚身边晃悠，他被我扰的烦不胜烦。',
            '（3）', '他瞥我一眼，叹口气，转头去了厨房。',
            '《须尽欢》的开机发布会日子就快到了，我感冒一直不好自己也着急。',
            '（4）', '念念的事，陈褚从来不喜欢假手他人。'
        ].join('\n');
        const chs = rbAutoSplit(txt);
        return { titles: chs.map(c => c.title), n: chs.length };
    });
    eq('两段《须尽欢》正文不再各占一条目录（4 章＋前言，不是 6 章）', B.titles,
        ['前言 / 引言', '(1)', '（2）', '（3）', '（4）']);

    /* ===== C 组：那两段正文得**留在正文里**，不能连字一起丢了 =====
       ⚠️切章末尾那句 filter(c => c.body.length > 0) 会把「标题下面没正文」的章整个丢掉，
       所以「不当标题」和「字还在」是两回事，必须分开验。 */
    const C = await page.evaluate(() => {
        // ⚠️这里必须用**她书里那段完整的原文**，别顺手截短：书名号后不到 20 字的行
        //   照旧算标题（那是为了保住 `《日抛男友》by玖年翡 id…` 这类真标题），截短了测的就不是同一件事。
        const txt = [
            '（2）', '念念因为是早产儿，身体算不得十分结实，平时的饮食起居都不得不格外注意。',
            '《须尽欢》里属于我的那部分算是忙完了，我得了闲，没事就在陈褚身边晃悠，他被我扰的烦不胜烦，索性把接送念念上幼儿园的任务都交给了我。',
            '（3）', '他瞥我一眼，叹口气，转头去了厨房。'
        ].join('\n');
        const chs = rbAutoSplit(txt);
        const all = chs.map(c => c.title + '\n' + c.body).join('\n');
        return { 在正文里: all.indexOf('《须尽欢》里属于我的那部分算是忙完了') >= 0, 归属: (chs.find(c => c.body.indexOf('《须尽欢》') >= 0) || {}).title };
    });
    ok('⚠️那段正文一个字没丢（留在书里）', C.在正文里);
    eq('并进了它本来所属的那一章', C.归属, '（2）');

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
