/* 块折叠（2026-08-11 用户要的：「插入文中的那个块，能不能折叠起来并且默认折叠呀」）。
 *
 * 规则：
 *  · **背景块 / 问答块 / 社科导读三种都能折**（`data-fold="1"`），⚠️口径当天扩过一次：
 *    一开始只折背景块，同日她说「问答以及导读也可以折叠的」，并选了「都默认收着」。
 *    判据是**有没有标题行**——三种在存储里都是「汐：…」的问答，所以一条判据全覆盖。
 *  · **AI 自己的点评不给折**（没有标题行，收起来只剩一个空条）。
 *  · **默认折叠**；点标题行展开，再点收起。
 *  · ⚠️**刚问完的那一条例外、默认展开**：她刚点了「问」，答案还要再点一下才看得见等于白问。
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
        const AI = '[P1] 汐：背景：士为知己者死 ⟦知己⟧\n这句话在先秦不是文学修辞。\n'
                 + '[P1] 这一段的节奏压得很稳。\n'
                 + '[P2] 汐：这一段讲了什么\n讲的是知遇之恩。\n'
                 + '[P2] 汐：导读：《士的行为准则》\n这一节讲的是士这个阶层。';
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
        // ⚠️「问答块」要按标题行认，别用 :not([data-bg])——AI 自己的点评也满足那个选择器
        const qa = [...box.querySelectorAll('blockquote[data-fold="1"]:not([data-bg])')]
            .find(b => b.querySelector('.reading-q').textContent.indexOf('这一段讲了什么') >= 0);
        const guide = [...box.querySelectorAll('blockquote[data-fold="1"]')]
            .find(b => (b.querySelector('.reading-q') || {}).textContent.indexOf('导读') >= 0);
        const plain = box.querySelector('blockquote[data-cp]:not([data-fold])');   // AI 自己的点评
        out.A_有背景块和问答块 = !!bg && !!qa;
        out.A_有导读块 = !!guide;
        out.A_有点评块 = !!plain;
        out.A_默认折叠 = bg.classList.contains('bg-fold');
        out.A_问答块也折 = qa.classList.contains('bg-fold');          // ⚠️2026-08-11 改了口径
        out.A_导读块也折 = !!guide && guide.classList.contains('bg-fold');
        out.A_点评块不给折 = !!plain && !plain.hasAttribute('data-fold') && !plain.classList.contains('bg-fold');
        out.A_三种都带fold标 = !!bg.getAttribute('data-fold') && !!qa.getAttribute('data-fold');
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
        // 问答块的标题现在也能折（口径已扩，见文件头）
        const qa4 = [...box4.querySelectorAll('blockquote[data-fold="1"]:not([data-bg])')]
            .find(b => b.querySelector('.reading-q').textContent.indexOf('这一段讲了什么') >= 0);
        const qa4Folded = qa4.classList.contains('bg-fold');
        qa4.querySelector('.reading-q').click();
        out.C_问答块点了会展开 = qa4Folded && !qa4.classList.contains('bg-fold');
        qa4.querySelector('.reading-q').click();
        out.C_问答块再点收起 = qa4.classList.contains('bg-fold');

        /* ── G：⚠️折叠态整块都是热区（2026-08-22 晗加）──
           用户报「点背景块的展开，**经常**会触发下滑翻页」。上面 B/C 组全是直接 `.click()` 标题行，
           所以一直没照到这个洞。病根是**几何**：块自带一圈 padding
           （行内样式左右 12px，折叠时上下压成 0.35em），那圈上 e.target 是 blockquote 本体、
           不是 .reading-q → 旧写法 closest 落空 → 放行 → 冒泡撞上「点段落以外一律翻页」。
           ⚠️尤其**右边**：小三角 ▸ 是唯一的视觉提示、用户就冲它去点，
           而它贴在 .reading-q 右端、紧挨着那 12px，点偏一点就翻页。
           这里用「事件直接派在 blockquote 上」模拟点在 padding 上（e.target 正是块本体）。 */
        {
            const box5 = render();
            const bg5 = box5.querySelector('blockquote[data-bg="1"]');
            /* ⚠️前面 C 组把这个块展开过，而展开状态记在 _rdBgOpen 里、重渲会恢复——
               先收回折叠态再测，否则测的根本不是折叠态。 */
            if (!bg5.classList.contains('bg-fold')) bg5.querySelector('.reading-q').click();
            out.G_前提是折叠的 = bg5.classList.contains('bg-fold');
            /* 冒泡阶段挂个哨兵：折叠 handler 在**捕获**阶段就 stopPropagation 了，
               事件不该走到这儿——走到了就说明它还会接着去撞翻页那套连击计数。 */
            let leaked = 0;
            const spy = () => { leaked++; };
            document.addEventListener('click', spy);
            bg5.click();                       // ← 模拟点在块的 padding 上
            out.G_点padding也展开 = !bg5.classList.contains('bg-fold');
            out.G_没漏去翻页 = leaked === 0;
            /* ⚠️展开之后整块**不再**是热区：正文露出来了，
               那块地归长按（删除/重新回答）和双击（接着聊这一段）管，放宽就撞上了。 */
            bg5.click();
            out.G_展开态点块本体不收起 = !bg5.classList.contains('bg-fold');
            document.removeEventListener('click', spy);
        }

        /* ── E：⚠️折叠的重排只碰**这一条消息**，别再走全量 ──
           2026-08-11 用户报「展开收起的过程中，感觉框框和圈圈的渲染有点跟不上，会有点卡顿」。
           两个原因：① 调的是全量重排（页面上所有章节全量重量一遍）；② 还压了 30ms 延迟才开始画，
           那段时间记号停在旧位置，「跟不上」的观感就是从这儿来的。
           现在：只重排当前 bubble + requestAnimationFrame + 重排前先把记号层藏起来。 */
        {
            const src = rdBgFoldToggle.toString();
            out.E_不走全量重排 = src.indexOf('rdGlLayoutAll') < 0 && src.indexOf('rdGlRelayoutSoon') < 0;
            out.E_只重排本条 = src.indexOf('rdGlLayout(bub)') > 0 && src.indexOf('bgMkLayout(bub)') > 0;
            out.E_用了rAF = src.indexOf('requestAnimationFrame') > 0;
            out.E_先藏后画 = src.indexOf("visibility = 'hidden'") > 0;
        }

        /* ── F：⚠️折叠/展开时，块**上方**那条小注不许动 ──
           2026-08-11 用户报「为什么展开和折叠背景知识块，那个标题附近的小注会跟着动一下」。
           原因：小注压进块里时按「卡在块的第二行之前」定位，而折叠后块里只剩标题一行、没有第二行，
           于是退回固定 12px 那一档 → 位置差几个像素，肉眼看到跳一下。
           修法：量块内文字时**临时把折叠 class 摘掉**，按展开的样子量，量完立刻装回（同一帧，看不见）。
           ⚠️这样算出的位置仍落在折叠后的块内部，不会跑到块外面压到下一段（下面 F3 钉这条）。 */
        {
            document.querySelectorAll('.__fd').forEach(n => n.remove());
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:16px;line-height:1.9;width:358px';
            box.innerHTML = readingModeRenderMerged(
                '智伯死后，豫让逃进了山里，心中只剩一个念头，他要为智伯报仇雪恨，绝不罢休。\n后来豫让改名换姓混进宫里。',
                '[P1] 汐：背景：士为知己者死 ⟦知己⟧\n这句话在先秦不是文学修辞，是士这个阶层真实的行为准则。士是最低一级的贵族。🍄',
                0);
            const p1 = box.querySelector('p[data-p="1"]');
            p1.innerHTML = p1.innerHTML.replace('雪恨',
                '<mark class="rd-hl rd-hl-sky" data-hlid="jf1" data-gl="xuě hèn·洗刷仇恨">雪恨</mark>');
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const m = document.createElement('div');
            m.className = 'chat-msg ai __fd'; m.setAttribute('data-idx', '0'); m.appendChild(bub);
            document.body.appendChild(m);
            const bq2 = box.querySelector('blockquote[data-bg="1"]');
            const pos = () => {
                const lab = box.querySelector('.rd-gl-label');
                if (!lab) return null;
                const r = lab.getBoundingClientRect(), b = box.getBoundingClientRect();
                return Math.round(r.left - b.left) + ',' + Math.round(r.top - b.top);
            };
            rdGlLayout(bub);
            const folded = pos();
            bq2.classList.remove('bg-fold'); rdGlLayout(bub);
            const opened = pos();
            bq2.classList.add('bg-fold'); rdGlLayout(bub);
            const refolded = pos();
            out.F_有小注 = !!folded;
            out.F_折叠展开位置一致 = !!folded && folded === opened;
            out.F_来回切换一致 = folded === refolded;
            out.F_位置 = [folded, opened, refolded];
            // 小注不许跑到块外面去压下一段
            const lab = box.querySelector('.rd-gl-label');
            out.F_没跑到块外 = !!lab && lab.getBoundingClientRect().bottom <= bq2.getBoundingClientRect().bottom + 1;
        }

        document.querySelectorAll('.__fd').forEach(n => n.remove());
        return out;
    });

    ok('A1 背景块和问答块都渲染出来了', R.A_有背景块和问答块);
    ok('A2 ⚠️背景块默认折叠', R.A_默认折叠);
    ok('A3 ⚠️问答块也默认折叠（2026-08-11 口径扩了）', R.A_问答块也折);
    ok('A3b 导读块也默认折叠', R.A_有导读块 && R.A_导读块也折);
    ok('A3c ⚠️AI 点评不给折（没标题行，收起来只剩空条）', R.A_有点评块 && R.A_点评块不给折);
    ok('A3d 能折的块都带 data-fold', R.A_三种都带fold标);
    ok('A4 折叠时正文不显示、标题还在', R.A_折叠时正文隐藏 && R.A_折叠时标题还在);
    ok('A5 折叠只是不显示，正文节点仍在（记号/引线靠真实文本定位）', R.A_正文节点还在);
    ok('B1 点标题 → 展开', R.B_点一下展开);
    ok('B2 ⚠️重渲后仍保持展开（窗口化会重建 DOM）', R.B_重渲后仍展开);
    ok('B3 再点 → 收起', R.B_再点收起);
    ok('B4 收起后重渲仍是折叠', R.B_收起后重渲仍折叠);
    ok('C1 ⚠️点块里的正文不会收起（那是双击追问的地盘）', R.C_点正文不收起);
    ok('C2 问答块点标题也能展开/收起', R.C_问答块点了会展开 && R.C_问答块再点收起);
    ok('G1 前提：新渲染的块是折叠的', R.G_前提是折叠的);
    ok('G2 ⚠️点块的 padding 圈（不是标题行）也能展开——小三角右边那 12px 就是这儿', R.G_点padding也展开);
    ok('G3 ⚠️⚠️这一下不许漏去翻页（2026-08-22 她报的正是「点展开经常翻页」）', R.G_没漏去翻页);
    ok('G4 ⚠️展开态点块本体不收起（那儿归长按/双击，别一并放宽）', R.G_展开态点块本体不收起);
    ok('E1 ⚠️折叠不再触发全量重排（只重排当前这条消息）', R.E_不走全量重排 && R.E_只重排本条);
    ok('E2 ⚠️用 rAF 在下一帧画完，不留「记号停在旧位置」的中间态', R.E_用了rAF);
    ok('E3 重排前先把记号层藏起来（宁可短暂看不见，也别看见错位）', R.E_先藏后画);
    ok('F1 前提：块上方那条小注排出来了', R.F_有小注);
    ok('F2 ⚠️折叠和展开时小注位置一模一样（不跳）', R.F_折叠展开位置一致, JSON.stringify(R.F_位置));
    ok('F3 来回切换也一致', R.F_来回切换一致);
    ok('F4 ⚠️按展开量之后，小注仍落在折叠块内部（没压到下一段）', R.F_没跑到块外);
    ok('D1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 背景块折叠：${bad}/${results.length} 条失败` : `\n✅ 背景块折叠：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
