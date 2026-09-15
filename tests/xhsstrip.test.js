/* 小红书分享口令清理：⚠️**她附在链接后面的问题绝不能被吞**。
 *
 * 2026-09-15 她报的：「toolbox 对话模式下识别小红书链接并读取的功能确实不错，
 * 但是我发现我附在后面的问题一般也会被吞噬」。复现出来是——
 * **问题写在同一行就没了，换行写才没事**。
 *
 * 病根：那几条清理规则原来都以 `[^\n]*` 结尾＝「删到行尾」，而口令和她的问题常在同一行。
 *
 * ⚠️别再去调正则的边界。试过「删到第一个句末标点为止」：
 *   对「…打开【小红书】App查看精彩内容！问题」有效，
 *   对「把这段复制好，然后去【小红书】就能看笔记 问题」无效（那句口令没有句末标点）。顾此失彼。
 * 现在的做法是**拿链接当锚点**：链接之前随便删；链接之后只削「紧挨着的那一句」，
 * 且必须找得到句末标点才削，找不到就整段留着——宁可留一句口令，也不能吃掉她的问题。
 *
 * 跑法：node tests/xhsstrip.test.js   或   bash tests/p.sh xhsstrip
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

const SHARES = [
    '59 【环境工程考研836真题解析 - 环硕黛黛 | 小红书 - 你的生活兴趣社区】 😆 aB3xYz 😆 https://www.xiaohongshu.com/a/abc123 复制本条信息，打开【小红书】App查看精彩内容！',
    '把这段复制好，然后去【小红书】就能看笔记 https://xhslink.cn/a/xYz9 ',
    '留住这段口令，去【小红书】瞅瞅笔记~ https://xhslink.cn/a/q1w2 ',
    '这篇笔记在【小红书】等你来读~ https://www.xiaohongshu.com/a/zzz ',
];
const QS = ['这篇讲的方法靠谱吗？', '帮我总结成三条', '这个跟我们学校的情况像吗'];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    await page.goto(APP);
    await page.waitForTimeout(6000);

    const R = await page.evaluate(({ SHARES, QS }) => {
        const out = { cases: [], extra: {} };
        const pick = (s) => { const m = s.match(new RegExp(XHS_URL_RE.source)); return m ? m[0] : ''; };
        SHARES.forEach((share, i) => QS.forEach((q, j) => [' ', '\n', '  '].forEach((sep, k) => {
            const full = share + sep + q;
            const res = xhsStripShareText(full, pick(full));
            out.cases.push({ id: `口令${i + 1}·问题${j + 1}·分隔${k + 1}`, kept: res.indexOf(q) >= 0, noUrl: res.indexOf('http') < 0 });
        })));
        // 她自己写的话里提到「小红书」（没书名号）不能碰
        const plain = '我在小红书上看到一个说法 https://xhslink.cn/a/p9 是真的吗';
        out.extra.没书名号不删 = xhsStripShareText(plain, pick(plain)).indexOf('我在小红书上看到一个说法') >= 0;
        // 问题写在链接**前面**也要留
        const before = '这篇靠谱吗 https://xhslink.cn/a/b8 复制本条信息，打开【小红书】App查看精彩内容！';
        out.extra.写在链接前面也要留 = xhsStripShareText(before, pick(before)).indexOf('这篇靠谱吗') >= 0;
        return out;
    }, { SHARES, QS });

    R.cases.forEach(c => {
        ok(c.id + '：问题要留下', c.kept);
        ok(c.id + '：链接要清掉', c.noUrl);
    });
    Object.keys(R.extra).forEach(k => ok(k, R.extra[k]));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    bad.forEach(r => console.log('  ❌ ' + r.name));
    console.log(bad.length ? `❌ ${bad.length} 条没过（共 ${results.length} 条）`
                           : `✅ 小红书口令清理：${results.length} 条全过`);
    process.exit(bad.length ? 1 : 0);
})();
