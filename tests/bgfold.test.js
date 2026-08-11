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
        /* 再点 → 收起。⚠️2026-08-11 加了展开/收起动画之后**时序变了**：
           收起方向的 `bg-fold` 要等动画跑完（180ms）才落地——因为一加上去正文就
           `display:none` 当场消失，看到的会是「字先没、再看着空盒子塌下去」。
           所以这里只能验「立刻进入了收起中」，class 真正落地由下面 G 组异步验。
           `|| bg-fold` 那半边是给不做动画的退路留的（减少动效/老浏览器会直接落地）。 */
        bg2.querySelector('.reading-q').click();
        out.B_再点收起 = bg2.classList.contains('bg-folding-close') || bg2.classList.contains('bg-fold');
        // 状态表要**立刻**改（动画中途被打断/重渲时不能丢），下面 B4 的重渲就是靠它
        out.B_再点箭头已翻 = getComputedStyle(bg2.querySelector('.reading-q'), '::after').content.indexOf('▸') >= 0;
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
            /* ⚠️2026-08-11 第三轮改口径：**不许再把记号层藏起来**。
               用户原话「动画我挺喜欢的，但为何要让小注的渲染消失一会呢，如果这个问题
               没办法解决，我宁愿你回退到之前的版本」。现在改成动画期间跟着一起平移。 */
            out.E_不再藏记号层 = src.indexOf("visibility = 'hidden'") < 0;
            out.E_改成跟着平移 = src.indexOf('translateY') > 0 && src.indexOf('_rdBgFoldMovers') > 0;
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
    /* ── G：展开/收起动画的时序（2026-08-11 加动画后新增）──
     * 用户原话「折叠起来的背景块这些，展开和收起时，总有点卡顿，就是不太跟手」，
     * 并澄清是**动作本身**、不是圈圈渲染跟不上。根因是 display:none 没有中间态。
     * ⚠️这一组必须**异步等**：收起方向的 bg-fold 故意推迟到动画结束才落地
     *   （立刻加上正文就当场消失，成了「字先没、再看着空盒子塌下去」）。
     */
    const G = await page.evaluate(async () => {
        const out = {};
        const wait = ms => new Promise(r => setTimeout(r, ms));
        document.querySelectorAll('.__fg').forEach(n => n.remove());
        /* ⚠️必须换一个消息号 + 清空 _rdBgOpen：那张表的 key 带 msgIdx，
           前面 R 组用的也是 0 号消息、还点开过，残留的展开状态会串过来，
           于是这里的块一上来就是展开的、整组时序全反（踩过一次，别去掉）。 */
        try { Object.keys(_rdBgOpen).forEach(k => delete _rdBgOpen[k]); } catch (e) {}
        const box = document.createElement('div');
        box.className = 'reading-merged';
        box.style.cssText = 'font-size:16px;line-height:1.9;width:358px';
        box.innerHTML = readingModeRenderMerged(
            '豫让逃进了山里，心中只剩一个念头。\n后来豫让改名换姓混进宫里，只为报仇雪恨。\n他吞炭漆身，形貌大变，连妻子都认不出他来了。', 
            '[P1] 汐：背景：士为知己者死 ⟦知己⟧\n这句话在先秦不是文学修辞，是士这个阶层真实的行为准则，写下来要占好几行才够高。', 0);
        /* ⚠️给**块下方**那一段挂一条小注：这一组的重点就是「动画期间它得跟着块一起走、
           而且不许消失」。挂在块上方的话平移量恒为 0，什么都验不出来。 */
        const p2 = box.querySelector('p[data-p="2"]');
        p2.innerHTML = p2.innerHTML.replace('雪恨',
            '<mark class="rd-hl rd-hl-sky" data-hlid="fg1" data-gl="xuě hèn·洗刷仇恨">雪恨</mark>');
        // ⚠️必须套一层 .chat-bubble：挑「要跟着走的元素」是从 bubble 往下找的
        const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
        const msg = document.createElement('div');
        msg.className = 'chat-msg ai __fg'; msg.setAttribute('data-idx', '7');   // ⚠️别用 0，见上面
        msg.appendChild(bub); document.body.appendChild(msg);
        rdGlLayout(bub);
        const bq = box.querySelector('blockquote[data-bg="1"]');
        const title = bq.querySelector('.reading-q');
        const H = () => Math.round(bq.getBoundingClientRect().height);
        /* ⚠️别在某个固定时刻取一次样去判「是不是渐变」：缓动是重前置的
           （cubic-bezier(0.32,0.72,0,1)），60ms 时已经跑完 98%，取样点稍晚就测成"一帧到位"。
           改成整段连续取样，只要**存在**一个严格落在两端之间的中间态就算数。 */
        /* ⚠️终值必须「等动画真的停了」再量，别赌固定时长：上面那个取样循环每帧都在
           读布局，会跟动画抢帧，导致固定等待之后量到的还是中间态（踩过：量出 105，
           而直接量真实展开态是 118）。 */
        const 等动画停 = async (el) => {
            try { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))); } catch (e) {}
            await new Promise(r => requestAnimationFrame(r));
        };
        const 取样 = async (ms) => {
            const xs = [];
            const t0 = Date.now();
            while (Date.now() - t0 < ms) { xs.push(H()); await new Promise(r => requestAnimationFrame(r)); }
            return xs;
        };

        /* ⚠️盯「真正被判定要跟随的那批元素」，别盯某一个标签：小注排到哪条缝里是排版
           算法定的，它完全可能把标签甩到块**上方**去（实测就见过 y=-4，在分界线之上），
           那种情况下标签本来就不该跟着走，盯它只会测出假失败。
           这里挑出来的既有小注标签、也有引线和手绘记号的 svg 笔画。 */
        const 跟随 = _rdBgFoldMovers(bub, bq);
        out.G_跟随元素数 = 跟随.length;
        // ── 展开：class 立刻摘掉（正文要一开始就在，靠 overflow 裁着露出来）──
        const h折叠 = H();
        title.click();
        out.G_展开时class立刻摘掉 = !bq.classList.contains('bg-fold');
        out.G_展开中在动画里 = bq.classList.contains('bg-folding');
        /* ── ⚠️核心：动画期间小注不许消失，而且要跟着块一起往下走 ──
           （2026-08-11 用户否掉了「藏一会儿」的做法） */
        const 标签 = () => box.querySelector('.rd-gl-label');
        const 层可见 = () => [...box.querySelectorAll('.rd-gl-layer, .bg-mk-layer')]
            .every(l => getComputedStyle(l).visibility !== 'hidden');
        out.G_动画中层没被藏 = 层可见();
        out.G_动画中标签还在 = !!标签() && getComputedStyle(标签()).visibility !== 'hidden';
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => requestAnimationFrame(r));
        const 位移 = 跟随.map(el => parseFloat((String(el.style.transform)
            .match(/translateY\(([-\d.]+)px\)/) || [0, 0])[1]) || 0);
        out.G_标签跟着走了 = 跟随.length > 0 && 位移.every(d => d > 1);
        out.G_位移量 = 位移.join('/');
        const 展开样本 = await 取样(200);
        await 等动画停(bq);
        const h展开 = H();
        out.G_展开是渐变的 = 展开样本.some(h => h > h折叠 + 1 && h < h展开 - 1);
        out.G_展开高度 = [h折叠, h展开, 展开样本.slice(0, 8).join('/')];
        out.G_展开后擦干净 = !bq.classList.contains('bg-folding') && !bq.style.height;
        // 停稳之后平移必须擦掉（否则会永远歪着那么多）
        out.G_停稳后擦掉平移 = 跟随.every(el => !el.style.transform);
        out.G_停稳后层还是可见的 = 层可见();

        // ── 收起：正文要留到动画结束，但箭头和状态立刻翻 ──
        title.click();
        out.G_收起时正文还看得见 = getComputedStyle(bq.querySelector(':scope > div:not(.reading-q)')).display !== 'none';
        out.G_收起时class还没落地 = !bq.classList.contains('bg-fold');
        out.G_收起时箭头已翻 = bq.classList.contains('bg-folding-close');
        const 收起样本 = await 取样(200);
        await 等动画停(bq);
        const h收完 = H();
        out.G_收起落地了 = bq.classList.contains('bg-fold');
        out.G_收起是渐变的 = 收起样本.some(h => h < h展开 - 1 && h > h收完 + 1);
        out.G_收起高度 = [h展开, h收完, 收起样本.slice(0, 8).join('/')];
        out.G_收起后擦干净 = !bq.classList.contains('bg-folding') && !bq.classList.contains('bg-folding-close')
                          && !bq.style.height && !bq.style.paddingTop;

        // ── 连点：动画跑一半再点，不许卡在中间态 ──
        title.click(); await wait(50); title.click();
        await wait(400);
        out.G_连点后不卡中间态 = !bq.classList.contains('bg-folding') && !bq.style.height;

        document.querySelectorAll('.__fg').forEach(n => n.remove());
        return out;
    });

    ok('B1 点标题 → 展开', R.B_点一下展开);
    ok('B2 ⚠️重渲后仍保持展开（窗口化会重建 DOM）', R.B_重渲后仍展开);
    ok('B3 再点 → 立刻进入收起（class 落地推迟到动画结束，见 G 组）', R.B_再点收起);
    ok('B3b 收起时箭头立刻翻过来，不慢半拍', R.B_再点箭头已翻);
    ok('B4 收起后重渲仍是折叠', R.B_收起后重渲仍折叠);
    ok('C1 ⚠️点块里的正文不会收起（那是双击追问的地盘）', R.C_点正文不收起);
    ok('C2 问答块点标题也能展开/收起', R.C_问答块点了会展开 && R.C_问答块再点收起);
    ok('E1 ⚠️折叠不再触发全量重排（只重排当前这条消息）', R.E_不走全量重排 && R.E_只重排本条);
    ok('E2 ⚠️用 rAF 在下一帧画完，不留「记号停在旧位置」的中间态', R.E_用了rAF);
    ok('E3 ⚠️不再把记号层藏起来（她明确否掉了「消失一会」）', R.E_不再藏记号层);
    ok('E3b 改成动画期间跟着一起平移', R.E_改成跟着平移);
    ok('F1 前提：块上方那条小注排出来了', R.F_有小注);
    ok('F2 ⚠️折叠和展开时小注位置一模一样（不跳）', R.F_折叠展开位置一致, JSON.stringify(R.F_位置));
    ok('F3 来回切换也一致', R.F_来回切换一致);
    ok('F4 ⚠️按展开量之后，小注仍落在折叠块内部（没压到下一段）', R.F_没跑到块外);
    ok('G1 展开：class 立刻摘掉、进入动画', G.G_展开时class立刻摘掉 && G.G_展开中在动画里);
    ok('G2 ⚠️展开是渐变的，不是一帧跳到位', G.G_展开是渐变的, '高度 ' + JSON.stringify(G.G_展开高度));
    ok('G3 展开完把行内样式擦干净', G.G_展开后擦干净);
    ok('G3b ⚠️动画期间小注层没有被藏起来', G.G_动画中层没被藏 && G.G_动画中标签还在);
    ok('G3c ⚠️块下方的小注跟着块一起走', G.G_标签跟着走了,
       '位移 ' + G.G_位移量 + ' | 跟随元素 ' + G.G_跟随元素数 + ' 个');
    ok('G3d 停稳后把平移擦掉、层仍可见', G.G_停稳后擦掉平移 && G.G_停稳后层还是可见的);
    ok('G4 ⚠️收起时正文还看得见（否则成了「字先没、空盒子再塌」）', G.G_收起时正文还看得见);
    ok('G5 ⚠️收起的 bg-fold 推迟到动画结束才落地', G.G_收起时class还没落地);
    ok('G6 收起时箭头立刻翻，不等动画', G.G_收起时箭头已翻);
    ok('G7 ⚠️收起是渐变的', G.G_收起是渐变的, '高度 ' + JSON.stringify(G.G_收起高度));
    ok('G8 收起最终落地成折叠态', G.G_收起落地了);
    ok('G9 收起完把动画用的 class 和行内样式都擦干净', G.G_收起后擦干净);
    ok('G10 ⚠️动画跑一半再点一下，不会卡在中间态', G.G_连点后不卡中间态);
    ok('D1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 背景块折叠：${bad}/${results.length} 条失败` : `\n✅ 背景块折叠：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
