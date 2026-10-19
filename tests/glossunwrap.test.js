/* 一行放得下就别折两行（2026-10-19 晗）。
 * 她截图「旮旯」那条：「为什么会变成两行呢，那一行应该放得下呀」——上缝右边空着一大片，小注却折成两行。
 * 原因：词离下缝更近，① 下缝（紧跟背景块）要放平、第一轮跳过；② 上缝一行本来塞得下，却被「为保持倾斜多跑不值」那道闸挡掉；
 *   ②a 去的还是这条上缝，却折成两行塞进去。修法是排完后 _glUnwrap：原地一行放得下就展开。
 * ⚠️夹具全是编的字（她说过别抄原文），只照她截图的几何搭：上一段一行，本段 11 行、末行写满，第 8 行一个两字词带长注，段后两个背景块。
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/glossunwrap.test.js
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 411, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html')); await page.waitForTimeout(6000);
  const out = await page.evaluate(async () => {
    const F = '山前小路弯弯绕过竹林溪水清清流向远方人们早出晚归日子过得平静安稳'.repeat(30);
    let B = F.slice(0, 239) + '。';
    const i = 20 + 22 * 5 + 16; B = B.slice(0, i) + '角落' + B.slice(i + 2);
    B = B.replace('角落', '<mark class="rd-hl rd-hl-blue" data-hlid="h0" data-gl="gā lá·方言，指角落或偏僻的地方">角落</mark>');
    const box = document.createElement('div'); box.className = 'reading-merged';
    box.style.cssText = 'font-size:17px;line-height:1.7;width:370px';
    box.innerHTML = '<p data-p="0">' + F.slice(0, 69) + '</p><p data-p="1">我问他：编的问题为什么屋里没有人呢</p><p data-p="2">' + B + '</p>'
      + '<blockquote>汐：背景：编的一条</blockquote><blockquote>汐：背景：编的二条</blockquote><p data-p="3">' + F.slice(0, 42) + '</p>';
    const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
    const msg = document.createElement('div'); msg.className = 'chat-msg ai __r'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
    document.body.appendChild(msg);
    // 本段末行补满（她截图里末行是满的，没有行尾空白可用）
    const p2 = box.querySelector('p[data-p="2"]'), h0 = p2.offsetHeight;
    for (let k = 0; k < 40; k++) { p2.insertAdjacentText('beforeend', '安'); if (p2.offsetHeight > h0) { p2.lastChild.nodeValue = p2.lastChild.nodeValue.slice(0, -1); break; } }
    if (document.fonts) await document.fonts.ready;
    document.documentElement.style.setProperty('--reading-pspace', '28px');
    rdGlLayout(bub);
    const lab = box.querySelector('.rd-gl-label[data-glid="h0"]');
    const lr = lab.getBoundingClientRect(), h = lab.offsetHeight, gap = lab.getAttribute('data-gl-gap');
    let hit = 0;
    box.querySelectorAll('p,blockquote').forEach(p => { const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n; const rg = document.createRange();
      while ((n = w.nextNode())) { rg.selectNodeContents(n); [...rg.getClientRects()].forEach(q => { if (q.width > 1 && lr.left < q.right && q.left < lr.right && lr.top < q.bottom && q.top < lr.bottom) hit++; }); } });
    const own = [...box.children].indexOf(p2);
    document.querySelectorAll('.__r').forEach(n => n.remove());
    return { h, gap: +gap, up: own - 1, hit };
  });
  const res = [
    ['落在自己段落的上缝', out.gap === out.up, 'gap=' + out.gap + ' 上缝=' + out.up],
    ['一行（没折成两行）', out.h <= 20, '高 ' + out.h],
    ['一个字都没碰', out.hit === 0, out.hit + ' 处'],
  ];
  let bad = 0;
  res.forEach(([n, ok, d]) => { if (!ok) bad++; console.log((ok ? '✅ ' : '❌ ') + n + '  → ' + d); });
  console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
