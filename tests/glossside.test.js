/* 段中的词：段尾空白和就近的缝，哪条路短先去哪（2026-10-20 晗）。
 * 她截图「精璞」：词在倒数第三行最左边，末行只写到一半——小注被拉到末行右边的空白里，引线斜着穿过大半段。
 * 她：「这明明应该直接往下呀，为什么要为了指向那边而指向那边呢」「主要是违背了最短路径」。
 * 守两件事：
 *  ① 词在左、段尾空白在右 → 进词正下方那条缝，标签左端离词不远，不碰字；
 *  ② 对照：词就在段尾空白上方（同一行靠右）→ 照旧写进段尾（三改那条别被这次改坏）。
 * ⚠️夹具全是编的字（她说过别抄原文），只照她截图的几何搭。
 * 跑法：bash tests/p.sh glossside
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html')); await page.waitForTimeout(6000);
  const run = (wordAt) => page.evaluate((wordAt) => {
    const F = '山前小路弯弯绕过竹林溪水清清流向远方人们早出晚归日子过得平静安稳'.repeat(20);
    const L = 26, H = 24, W = '甲乙';
    const put = (len, i) => { let s = F.slice(0, len); if (i != null) s = s.slice(0, i) + W + s.slice(i + W.length); return s; };
    const B = put(H + L * 6 + 11, eval(wordAt)(H, L));
    const bH = B.replace(W, '<mark class="rd-hl rd-hl-purple" data-hlid="h0" data-gl="jiǎ yǐ·没打磨过的好东西">' + W + '</mark>');
    const box = document.createElement('div'); box.className = 'reading-merged';
    box.style.cssText = 'font-size:14px;line-height:1.7;width:370px';
    box.innerHTML = '<p data-p="0">' + put(H + L * 2 + 5) + '</p><p data-p="1">' + bH + '</p><p data-p="2">' + put(H + L * 3) + '</p>';
    const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
    const msg = document.createElement('div'); msg.className = 'chat-msg ai __r'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
    document.body.appendChild(msg);
    document.documentElement.style.setProperty('--reading-pspace', '28px');
    rdGlLayout(bub);
    const lab = box.querySelector('.rd-gl-label[data-glid="h0"]');
    const lr = lab.getBoundingClientRect(), wr = box.querySelector('mark').getBoundingClientRect();
    let hit = 0;
    box.querySelectorAll('p').forEach(p => { const rg = document.createRange(); rg.selectNodeContents(p);
      [...rg.getClientRects()].forEach(q => { if (q.width > 1 && lr.left < q.right && q.left < lr.right && lr.top < q.bottom && q.top < lr.bottom) hit++; }); });
    const own = [...box.children].indexOf(box.querySelector('p[data-p="1"]'));
    const r = { gap: lab.getAttribute('data-gl-gap'), own, dx: Math.round(lr.left - wr.left), hit };
    document.querySelectorAll('.__r').forEach(n => n.remove());
    return r;
  }, wordAt);
  const left = await run.call(null, '(H, L) => H + L * 4 + 1');
  const right = await run.call(null, '(H, L) => H + L * 5 + 20');
  const res = [
    ['词在左 → 进自己段落下面那条缝（直下）', String(left.gap) === String(left.own), JSON.stringify(left)],
    ['词在左 → 标签左端离词不到 3 个字', Math.abs(left.dx) <= 42, JSON.stringify(left)],
    ['词在左 → 没碰字', left.hit === 0, JSON.stringify(left)],
    ['对照：词在段尾空白正上方 → 照旧写段尾', String(right.gap).indexOf('tail') === 0, JSON.stringify(right)],
  ];
  let bad = 0;
  res.forEach(([n, ok, d]) => { if (!ok) bad++; console.log((ok ? '✅ ' : '❌ ') + n + '  → ' + d); });
  console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
