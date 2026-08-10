/* 背景块折叠（2026-08-11 用户要的：「插入文中的那个块，能不能折叠起来并且默认折叠呀」）。
 *
 * 规则：
 *  · **只折背景块**（data-bg）——她自己问的问答块不折，那是主动要的答案，收起来碍事。
 *  · **默认折叠**；点标题行展开，再点收起。
 *  · 展开状态只活在内存（`_rdBgOpen`），关掉 app 回到全折叠；但**窗口化重渲会重建 DOM**，
 *    所以那张表得存着，不然滚一下就把展开的又合上了。
 *  · ⚠️只认**标题行**那一行：整块上已经有两套手势——长按＝删除/重新回答、双击＝接着聊这一段。
 *
 * 跑法：node tests/bgfold.test.js   或   bash tests/p.sh bgfold
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

    const R = await page.evaluate(() => {
        const out = {};
        const TXT = '豫让逃进了山里，心中只剩一个念头。\n智伯理解并看重豫让。';
        const AI = '[P1] 汐：背景：士为知己者死 ⟦知己⟧\n这句话在先秦不是文学修辞。\n[P2] 汐：这一段讲了什么\n讲的是知遇之恩。';
        function render() {
            document.querySelectorAll('.__fd').forEach(n => n.remove());
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.innerHTML = readingModeRenderMerged(TXT, AI, 0);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __fd'; msg.setAttribute('data-idx', '0');
            msg.appendChild(box);
            document.body.appendChild(msg);
            return box;
        }
        const bodyOf = bq => bq.querySelector(':scope > div:not(.reading-q)');

        const box = render();
        const bg = box.querySelector('blockquote[data-bg="1"]');
        const qa = box.querySelector('blockquote[data-cp]:not([data-bg])');
        out.A_有背景块和问答块 = !!bg && !!qa;
        out.A_默认折叠 = bg.classList.contains('bg-fold');
        out.A_问答块不折 = !qa.classList.contains('bg-fold');
        out.A_折叠时正文隐藏 = getComputedStyle(bodyOf(bg)).display === 'none';
        out.A_折叠时标题还在 = getComputedStyle(bg.querySelector('.reading-q')).display !== 'none';
        // 折叠不该动 DOM 结构（正文还在，只是不显示）——背景词记号/引线都靠真实文本定位
        out.A_正文节点还在 = !!bodyOf(bg) && bodyOf(bg).textContent.indexOf('先秦') >= 0;

        // 点标题 → 展开
        bg.querySelector('.reading-q').click();
        out.B_点一下展开 = !bg.classList.contains('bg-fold')
                       && getComputedStyle(bodyOf(bg)).display !== 'none';
        // 重渲（窗口化会重建 DOM）→ 仍然展开
        const box2 = render();
        const bg2 = box2.querySelector('blockquote[data-bg="1"]');
        out.B_重渲后仍展开 = !bg2.classList.contains('bg-fold');
        // 再点 → 收起，且这次重渲回到折叠
        bg2.querySelector('.reading-q').click();
        out.B_再点收起 = bg2.classList.contains('bg-fold');
        const box3 = render();
        out.B_收起后重渲仍折叠 = box3.querySelector('blockquote[data-bg="1"]').classList.contains('bg-fold');

        // ⚠️点块里的**正文**不该折叠（那儿是双击追问的地盘）
        const box4 = render();
        const bg4 = box4.querySelector('blockquote[data-bg="1"]');
        bg4.querySelector('.reading-q').click();          // 先展开
        bodyOf(bg4).click();                               // 点正文
        out.C_点正文不收起 = !bg4.classList.contains('bg-fold');
        // 点问答块的标题也不该有折叠行为
        const qa4 = box4.querySelector('blockquote[data-cp]:not([data-bg])');
        qa4.querySelector('.reading-q').click();
        out.C_问答块点了也不折 = !qa4.classList.contains('bg-fold');

        document.querySelectorAll('.__fd').forEach(n => n.remove());
        return out;
    });

    ok('A1 背景块和问答块都渲染出来了', R.A_有背景块和问答块);
    ok('A2 ⚠️背景块默认折叠', R.A_默认折叠);
    ok('A3 ⚠️问答块不折（那是她主动要的答案）', R.A_问答块不折);
    ok('A4 折叠时正文不显示、标题还在', R.A_折叠时正文隐藏 && R.A_折叠时标题还在);
    ok('A5 折叠只是不显示，正文节点仍在（记号/引线靠真实文本定位）', R.A_正文节点还在);
    ok('B1 点标题 → 展开', R.B_点一下展开);
    ok('B2 ⚠️重渲后仍保持展开（窗口化会重建 DOM）', R.B_重渲后仍展开);
    ok('B3 再点 → 收起', R.B_再点收起);
    ok('B4 收起后重渲仍是折叠', R.B_收起后重渲仍折叠);
    ok('C1 ⚠️点块里的正文不会收起（那是双击追问的地盘）', R.C_点正文不收起);
    ok('C2 问答块的标题点了也不折叠', R.C_问答块点了也不折);
    ok('D1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 背景块折叠：${bad}/${results.length} 条失败` : `\n✅ 背景块折叠：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
