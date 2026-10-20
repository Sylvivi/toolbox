/* 选中小条的「解」键（2026-10-20 晗；她定的名字，做的是围绕选中的字讲一条背景）。
 * 她：「导读那个键按了之后选的那个背景有时候不一定能解释到我想要解释的那个内容」；
 *     又补：选中的只是出发点，题目可以更概括（跟全章找背景一样）。
 * 守：① 定题那一步认得「P3|出发点|题目」，出发点不在段里就退回她选的字；
 *     ② 模型乱回/挂了 → 退回她选的字原样讲（不让她白点）；
 *     ③ 同一段讲过同一个词（题目或出发点）就不再花钱；
 *     ④ 小条上真有「背景」这颗键，就在「注」后面。
 * 数据全是编的，不发真请求。跑法：bash tests/p.sh bgword
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html')); await page.waitForTimeout(6000);
  const R = await page.evaluate(async () => {
    const out = {};
    const b = { fileName: '编的书.txt' };
    const lines = ['第一段编的字。', '第二段编的字。', '秋收刚过，上头派人来清点田亩，说是要一条鞭，往后并在一处交。'];
    const M = { model: 'x', baseUrl: '', apiKey: '' };
    const fake = reply => { window._rdBgTimed = async () => { if (reply instanceof Error) throw reply; return reply; }; };
    fake('P3|一条鞭|一条鞭法');
    out.ok = await _rdBgPickOne(b, lines, 3, '说是要一条鞭', M, M);
    fake('P3|鞭子|一条鞭法');
    out.badAnchor = await _rdBgPickOne(b, lines, 3, '一条鞭', M, M);
    fake('我觉得这里讲的是赋税改革。');
    out.junk = await _rdBgPickOne(b, lines, 3, '一条鞭', M, M);
    // ③ 讲过的不再花钱：桩掉 readerMarkBg 看有没有被叫
    const calls = [];
    window.readerMarkBg = function () { calls.push([].slice.call(arguments)); };
    window.readerBookId = 'bk1';
    window.rbGetBook = () => ({ id: 'bk1', fileName: '编的书.txt', fileSize: 1, chapters: [{ title: 't', body: 'b' }] });
    window.readerBookKey = () => '编的书.txt|1';
    window.readerBgOfChap = () => [{ p: 3, q: '背景：一条鞭法 ⟦一条鞭⟧' }];
    chatMessages = [{ readerChapter: 0 }];
    readingBgWord({ msgIdx: 0, pNum: 3, text: '一条鞭' });     // 出发点撞上
    readingBgWord({ msgIdx: 0, pNum: 3, text: '一条鞭法' });   // 题目撞上
    readingBgWord({ msgIdx: 0, pNum: 2, text: '一条鞭' });     // 别的段 → 照讲
    out.calls = calls;
    // ④ 小条
    out.barHasBg = /data-act="gloss">注<\/button>[\s\S]{0,200}data-act="bg">解</.test(rdHlShowSelBar.toString());
    return out;
  });
  const res = [
    ['定题：认得出发点和概括的题目', R.ok && R.ok.term === '一条鞭法' && R.ok.anchor === '一条鞭', JSON.stringify(R.ok)],
    ['出发点不在段里 → 用她选的字', R.badAnchor && R.badAnchor.anchor === '一条鞭' && R.badAnchor.term === '一条鞭法', JSON.stringify(R.badAnchor)],
    ['模型没按格式回 → 返回空（外面退回原样讲）', R.junk === null, JSON.stringify(R.junk)],
    ['同一段讲过（题目或出发点）不再讲，别的段照讲', R.calls.length === 1 && R.calls[0][3] === 2 && R.calls[0][4] === '一条鞭', JSON.stringify(R.calls)],
    ['小条上「解」紧挨着「注」', R.barHasBg, ''],
    ['没有页面报错', errs.length === 0, errs.join(' | ')],
  ];
  let bad = 0;
  res.forEach(([n, ok, d]) => { if (!ok) bad++; console.log((ok ? '✅ ' : '❌ ') + n + (ok ? '' : '  → ' + d)); });
  console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
  await browser.close(); process.exit(bad ? 1 : 0);
})();
