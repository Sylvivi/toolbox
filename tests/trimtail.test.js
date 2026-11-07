/* 「掐尾」别把加粗切成两半（11-07 岚加）。
 *
 * 起因：她截图——「简单说就是：**……外来文明。** 因为……🍄」，句号后面紧跟收尾的 **，
 * rdSplitTail 一刀切在句号后面，开头 ** 留在正文、收尾 ** 跑进尾巴，正文那段加粗不上。
 *
 * 跑法：node tests/trimtail.test.js    或    bash tests/p.sh trimtail
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    const R = await page.evaluate(() => {
        function run(t) { var sp = rdSplitTail(t); return sp ? { body: sp.body, tail: sp.tail, html: renderText(sp.body) } : null; }
        return {
            shot: run('前面一段。\n\n简单说就是：**不是顺着老天爷，而是人自己拿主意。** 因为全靠人工维护，所以多了一种慎重。🍄'),
            whole: run('第一句。**这是收尾总结。**🍄'),
            cross: run('前面。**加粗开头。加粗还在继续。**'),
            plain: run('第一句话。第二句话。最后总结一句。'),
        };
    });
    ok('A1 收尾的 ** 还给正文，正文那段加粗成功', R.shot && /<strong>不是顺着老天爷，而是人自己拿主意<\/strong>/.test(R.shot.html), R.shot && R.shot.html.slice(-80));
    ok('A2 尾巴里不留 **', R.shot && R.shot.tail.indexOf('**') < 0, R.shot && R.shot.tail);
    ok('A3 尾巴照样掐掉（开关的本职没丢）', R.shot && R.shot.tail.indexOf('因为全靠人工维护') === 0, R.shot && R.shot.tail);
    ok('B1 整句加粗的收尾句照常掐、正文不受影响', R.whole && R.whole.body === '第一句。', JSON.stringify(R.whole));
    ok('C1 加粗整个跨过切口时这条不掐', R.cross === null, JSON.stringify(R.cross));
    ok('D1 没加粗的普通回答照旧掐最后一句', R.plain && R.plain.tail === '最后总结一句。', JSON.stringify(R.plain));
    ok('E1 全程无 JS 报错', pageErrs.length === 0, pageErrs.join(' / '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('❌ ' + r.name + (r.detail ? '  →  ' + r.detail : '')); });
    console.log(bad.length ? ('❌ ' + bad.length + ' 条失败（共 ' + results.length + ' 条）') : ('✅ 全过（' + results.length + ' 条）'));
    process.exit(bad.length ? 1 : 0);
})();
