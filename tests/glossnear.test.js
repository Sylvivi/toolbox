/* 就近的缝里折两行（2026-10-17）。
 * 她截图「操下如束湿薪」：自己上下两条缝一行都放不下，小注就越过上面一整段跑到更远的缝——「在我看来就是舍近求远」。
 * 修法：往远处跑之前，先在就近两条缝里折两行试一次（_gl_tryWrapNear）。
 * ⚠️夹具全是编的字（她说过别抄原文），只照她截图的几何搭：长段落 8 行，第 3 行中间一个长注（占段尾、折两行），
 *   第 3/4 行之间一个跨行词（就是要测的那条），第 4 行开头一个往上的词（把上缝左半边占了）。
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/glossnear.test.js
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html')); await page.waitForTimeout(6000);
  const out = await page.evaluate(() => {
    const F = '山前小路弯弯绕过竹林溪水清清流向远方人们早出晚归日子过得平静安稳'.repeat(20);
    const L = 26, H = 24;
    const put = (len, list) => { let s = F.slice(0, len); list.forEach(m => { s = s.slice(0, m.i) + m.w + s.slice(m.i + m.w.length); }); return s; };
    const A = put(H + L * 3 + 10, []);
    const B = put(H + L * 6 + 12, [
      { i: H + L * 1 + 9, w: '甲乙丙丁戊' },      // 第3行中间，长注 → 段尾两行
      { i: H + L * 1 + 22, w: '庚辛壬癸子丑' },  // 跨第3、4行
      { i: H + L * 2 + 3, w: '寅卯辰巳' },       // 第4行开头，往上
    ]);
    const C = put(H + L * 2, []);
    const notes = { '甲乙丙丁戊': 'jiǎ yǐ bǐng dīng wù·一定会想办法去欺负压制他的上级官员', '庚辛壬癸子丑': 'gēng xīn rén guǐ zǐ chǒu·管手下像捆湿柴那样紧', '寅卯辰巳': 'yín mǎo chén sì·狡猾奸诈又仗势欺人' };
    let bH = B; Object.keys(notes).forEach((w, k) => { bH = bH.replace(w, '<mark class="rd-hl rd-hl-' + ['purple','purple','rose'][k] + '" data-hlid="h' + k + '" data-gl="' + notes[w] + '">' + w + '</mark>'); });
    const box = document.createElement('div'); box.className = 'reading-merged';
    box.style.cssText = 'font-size:14px;line-height:1.7;width:370px';
    box.innerHTML = '<p data-p="0">' + put(H + L * 2 + 5, []) + '</p><p data-p="1">' + A + '</p><p data-p="2">' + bH + '</p><p data-p="3">' + C + '</p>';
    const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
    const msg = document.createElement('div'); msg.className = 'chat-msg ai __r'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
    document.body.appendChild(msg);
    document.documentElement.style.setProperty('--reading-pspace', '28px');
    rdGlLayout(bub);
        const lab = box.querySelector('.rd-gl-label[data-glid="h1"]');
    const lr = lab.getBoundingClientRect();
    const own = [...box.children].indexOf(box.querySelector('p[data-p="2"]'));
    const gap = +lab.getAttribute('data-gl-gap'), h = lab.offsetHeight;   // ⚠️下面会删掉整条消息，高度得先量
    // 碰没碰到正文的字
    let hit = 0;
    box.querySelectorAll('p').forEach(p => { const rg = document.createRange(); rg.selectNodeContents(p);
      [...rg.getClientRects()].forEach(q => { if (q.width > 1 && lr.left < q.right && q.left < lr.right && lr.top < q.bottom && q.top < lr.bottom) hit++; }); });
    const others = [...box.querySelectorAll('.rd-gl-label')].filter(l => l !== lab).map(l => l.getBoundingClientRect());
    const ov = others.filter(o => lr.left < o.right && o.left < lr.right && lr.top < o.bottom && o.top < lr.bottom).length;
    document.querySelectorAll('.__r').forEach(n => n.remove());
    return { gap, own, up: own - 1, down: own, h, hit, ov };
  });
  const res = [
    ['留在自己段落上下那两条缝里（不越过上一段）', out.gap === out.up || out.gap === out.down, 'gap=' + out.gap + ' 自己的上缝=' + out.up + ' 下缝=' + out.down],
    ['折成了两行（不是三行）', out.h > 20 && out.h <= 30, '高 ' + out.h],
    ['一个字都没碰', out.hit === 0, out.hit + ' 行'],
    ['没压别的小注', out.ov === 0, out.ov + ' 条'],
  ];
  let bad = 0;
  res.forEach(([n, ok, d]) => { if (!ok) bad++; console.log((ok ? '✅ ' : '❌ ') + n + '  → ' + d); });
  console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
