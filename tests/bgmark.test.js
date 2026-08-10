/* 「背景词」的手绘记号回归测试（2026-08-10 做）。
 *
 * 功能：标背景讲解过的那个词，在正文里被画上一个手绘记号（下划线/方框/圈，Rough.js 画的）。
 * 用户定的范围——**先做成满篇人名，她当场否了**，原话：
 *   「我想我其实并不是要让每个人名都要被渲染成那样，而是在有背景词解释的那个段落，
 *     把那个词儿给他渲染出来就行，不然确实会很花」。
 * 颜色「一词一支笔」：她原话「人名上的颜色是随机变的」，落地成按词钉死的随机色。
 *
 * 钉住的几条：
 *  A 组 只画「被解释的那个词」，别的人名一律不碰（否掉的那版就是满篇人名）
 *  B 组 词是从背景块第一行 `汐：背景：X` 抠出来的，且只认第一行
 *  C 组 同一个词全书同色同款；不同词要真的不一样（哈希分布）
 *  D 组 不动版面（记号全在绝对定位的 SVG 层上）
 *  E 组 开关 + 段落里找不到那个词时安静跳过
 *
 * 跑法：node tests/bgmark.test.js   或   bash tests/p.sh bgmark
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
        const N = s => '<span class="reading-name">' + s + '</span>';
        const bq = (cp, head, body) => '<blockquote data-cp="' + cp + '" data-ci="0" data-bg="1" '
            + 'style="margin:0.4em 0 0.6em;padding:0.5em 12px 0.4em;font-size:0.92em;line-height:1.6">'
            + '<div class="reading-q">' + head + '</div>' + (body || '正文说明。') + '</blockquote>';

        // paras: [{n, html}]，blocks: [{cp, head}]
        function build(paras, blocks) {
            document.querySelectorAll('.__bgt').forEach(n => n.remove());
            let html = '';
            paras.forEach(p => {
                html += '<p data-p="' + p.n + '">' + p.html + '</p>';
                blocks.filter(b => String(b.cp) === String(p.n)).forEach(b => { html += bq(b.cp, b.head); });
            });
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.8;width:358px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __bgt'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            bgMkLayout(bub);
            return { box, bub };
        }
        const P1 = '孙武是齐国人，后来跑到吴国，由' + N('伍子胥') + '引荐给' + N('阖闾') + '，孙武带来一部兵法，让孙武练兵。';   // ⚠️「孙武」故意出现三次
        const P2 = '楚昭王叫公子囊瓦带兵进攻吴国，吴则带兵迎击，在豫章大破楚军，又拿下一座城。';

        // ── A：只画被解释的那个词 ──
        {
            const a = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                            [{ cp: 1, head: '汐：背景：孙武' }, { cp: 2, head: '汐：背景：豫章' }]);
            out.A_画了几个 = a.box.querySelectorAll('.bg-mk-svg > g').length;
            /* ⚠️「孙武」在第 1 段出现三次、「豫章」一次 ＝ 四个记号。
               2026-08-10 用户报：「一段里面居然有多个背景词，相同的背景词哈，居然只划里面的一个」——
               第一版只 indexOf 一次就收工。出现几次画几次。 */
            out.A_每一处都画 = out.A_画了几个 === 4;
            // ⚠️别的人名（伍子胥/阖闾）一个都不许画——那是被否掉的「满篇人名」版
            out.A_没碰别的人名 = a.box.querySelectorAll('.reading-name.rn-mk, .rn-mk-layer').length === 0;
            // 没有背景块时，一层都不该建
            const b = build([{ n: 1, html: P1 }], []);
            out.A_没背景块就不画 = !b.box.querySelector('.bg-mk-layer');
        }

        // ── B：从背景块第一行抠词 ──
        {
            const mk = h => { const d = document.createElement('blockquote'); d.innerHTML = '<div class="reading-q">' + h + '</div>正文里也写了背景：别的东西'; return d; };
            out.B_普通 = bgMkTermOf(mk('汐：背景：孙武'));
            out.B_换了昵称 = bgMkTermOf(mk('小助手：背景：豫章'));       // 「汐」是可改的昵称，不能写死
            out.B_带书名号 = bgMkTermOf(mk('汐：背景：《孙子兵法》'));
            out.B_带标点 = bgMkTermOf(mk('汐：背景：囊瓦。'));
            out.B_不是背景块 = bgMkTermOf(mk('汐：这一段讲了什么'));
            out.B_一整句不要 = bgMkTermOf(mk('汐：背景：这里说的是春秋末年吴楚两国的形势变化'));
            out.B_对了 = out.B_普通 === '孙武' && out.B_换了昵称 === '豫章'
                      && out.B_带书名号 === '孙子兵法' && out.B_带标点 === '囊瓦'
                      && out.B_不是背景块 === '' && out.B_一整句不要 === '';
        }

        // ── C：一词一支笔（同词同色同款，不同词要真不一样）──
        {
            const a = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                            [{ cp: 1, head: '汐：背景：孙武' }, { cp: 2, head: '汐：背景：豫章' }]);
            const gs = [...a.box.querySelectorAll('.bg-mk-svg > g')];
            const colorOf = g => (g.querySelector('path') || {}).getAttribute ? g.querySelector('path').getAttribute('stroke') : '';
            out.C_两个词颜色 = gs.map(colorOf);
            out.C_两个词不同色 = new Set(out.C_两个词颜色).size === 2;
            const d1 = gs.map(g => g.querySelector('path').getAttribute('d')).join('|');
            bgMkLayout(a.bub);      // 重排（换字号/切主题）
            const d2 = [...a.box.querySelectorAll('.bg-mk-svg > g')].map(g => g.querySelector('path').getAttribute('d')).join('|');
            out.C_重排后一模一样 = d1 === d2;
            const b = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                            [{ cp: 1, head: '汐：背景：孙武' }, { cp: 2, head: '汐：背景：豫章' }]);
            const d3 = [...b.box.querySelectorAll('.bg-mk-svg > g')].map(g => g.querySelector('path').getAttribute('d')).join('|');
            out.C_重建后一模一样 = d1 === d3;
            /* ⚠️形状和颜色不许绑死：形状是 seed%3、颜色是 seed%6，共用一个 seed 的话
               （6 是 3 的倍数）六支笔只剩六种固定搭配。实拍过两个词一模一样都是紫圈。 */
            const kinds = new Set(), colors = new Set();
            const words = ['孙武', '豫章', '囊瓦', '阖闾', '伍子胥', '子常', '唐蔡', '楚昭王', '越国', '居巢', '夫概', '司马迁'];
            words.forEach(w => { kinds.add(BG_MK_KINDS[rdMkSeed(w) % BG_MK_KINDS.length]); colors.add(rdMkSeed(w + '·色') % 5); });   // 5 ＝ 去掉黄之后的池子大小
            out.C_形状种类 = kinds.size; out.C_颜色种类 = colors.size;
            out.C_分布够散 = kinds.size >= 2 && colors.size >= 4;   // 五支笔，12 个词里至少摊到 4 支
            /* ⚠️下划线有**三个字的门槛**（用户 2026-08-10 定：「下划线还是可以保留，
               但是得是三个字及以上」）：短词底下一条短线像笔误。 */
            const short2 = new Set(), long3 = new Set();
            for (let i = 0; i < 300; i++) {
                short2.add(bgMkPick('两字' + (i % 1 ? '' : ''), false, false));   // 恒 2 字
                short2.add(bgMkPick('孙武', false, false));
                long3.add(bgMkPick('伍子胥' + (i % 7 ? '' : ''), false, false));
            }
            for (let i = 0; i < 300; i++) long3.add(bgMkPick('词' + i + '子', false, false));   // 3 字以上
            out.C_两字没有下划线 = !short2.has('u');
            out.C_三字以上有下划线 = long3.has('u');
            out.C_跨行够长走下划线 = bgMkPick('伍子胥', true, false) === 'u';
            out.C_跨行太短走方框 = bgMkPick('孙武', true, false) === 'b';
            out.C_底下有线就避开 = (() => {
                for (let i = 0; i < 200; i++) if (bgMkPick('词' + i + '子', false, true) === 'u') return false;
                return true;
            })();
            // 同一个词的几处：形状/颜色一样，但歪法不能一模一样（否则像复制粘贴）
            const gg = [...a.box.querySelectorAll('.bg-mk-svg > g')].map(g => g.querySelector('path'));
            const sunwu = gg.slice(0, 3);
            out.C_同词同色 = new Set(sunwu.map(p => p.getAttribute('stroke'))).size === 1;
            out.C_同词歪法不同 = new Set(sunwu.map(p => p.getAttribute('d'))).size === 3;
        }

        // ── D：一个像素都不许动版面 ──
        {
            const before = build([{ n: 1, html: P1 }, { n: 2, html: P2 }], []);
            const rowsOf = p => { const r = document.createRange(); r.selectNodeContents(p); return [...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top * 10) / 10); };
            const b1 = rowsOf(before.box.querySelector('p[data-p="1"]'));
            const h1 = before.box.querySelector('p[data-p="1"]').getBoundingClientRect().height;
            const after = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                                [{ cp: 1, head: '汐：背景：孙武' }]);
            const p1 = after.box.querySelector('p[data-p="1"]');
            out.D_画上了 = after.box.querySelectorAll('.bg-mk-svg > g').length === 3;   // 「孙武」在这段出现三次
            out.D_行位置没变 = JSON.stringify(rowsOf(p1)) === JSON.stringify(b1);
            out.D_段落没变高 = Math.abs(p1.getBoundingClientRect().height - h1) < 0.5;
            out.D_层不吃点击 = getComputedStyle(after.box.querySelector('.bg-mk-svg')).pointerEvents === 'none';
        }

        // ── E：开关；段落里没有那个词时安静跳过 ──
        {
            // AI 换了说法，段落里根本没有「兵圣」两个字 → 不画，也不报错
            const a = build([{ n: 1, html: P1 }], [{ cp: 1, head: '汐：背景：兵圣' }]);
            out.E_找不到就不画 = !a.box.querySelector('.bg-mk-layer');
            const b = build([{ n: 1, html: P1 }], [{ cp: 1, head: '汐：背景：孙武' }]);
            out.E_默认是开的 = !document.body.classList.contains('bg-mk-off')
                            && !!b.box.querySelector('.bg-mk-svg > g');
            bgMkSetOn(false);
            out.E_关掉就没了 = !document.querySelector('.bg-mk-layer');
            bgMkSetOn(true);
            out.E_再开能补回来 = !!document.querySelector('.bg-mk-svg > g');
            out.E_存了本机 = localStorage.getItem('reading_bg_mark') === '1';
            // 同一个词讲两次，只画一次（别叠两个圈）
            const c = build([{ n: 1, html: P1 }], [{ cp: 1, head: '汐：背景：孙武' }, { cp: 1, head: '汐：背景：孙武' }]);
            // 同一个词有**两个背景块**时只处理一次（别把同几处各画两遍）
            out.E_同词只画一次 = c.box.querySelectorAll('.bg-mk-svg > g').length === 3;
        }

        /* ── G：日夜两套颜色 ──
           ⚠️⚠️钉的是一个真踩过的坑（2026-08-10）：夜间那套定义在 `body.dark` 上，
             而代码里却用 `getComputedStyle(document.documentElement)` 读——CSS 变量只往**下**继承，
             从 <html> 上读永远只拿到 :root 那套日间色，**切夜间等于没换色**。
             光看代码「两套都写了」完全看不出来，是用户问「有没有对颜色做日夜相适应」才查出来的。 */
        {
            const hadDark = document.body.classList.contains('dark');
            document.body.classList.remove('dark');
            const a = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                            [{ cp: 1, head: '汐：背景：孙武' }, { cp: 2, head: '汐：背景：豫章' }]);
            const dayC = [...a.box.querySelectorAll('.bg-mk-svg > g path')].map(p => p.getAttribute('stroke'));
            document.body.classList.add('dark');
            bgMkLayout(a.bub);
            const nightC = [...a.box.querySelectorAll('.bg-mk-svg > g path')].map(p => p.getAttribute('stroke'));
            out.G_日间色 = [...new Set(dayC)];
            out.G_夜间色 = [...new Set(nightC)];
            out.G_切夜间换了色 = JSON.stringify(dayC) !== JSON.stringify(nightC) && nightC.length === dayC.length;
            /* ⚠️那支黄**已被移出随机池**（2026-08-10 用户：「背景词的随机颜色中，也把那个黄色出现的
               可能去掉吧，因为夜间我主色调是黄色，容易重复」）——夜间主题钉死是蓝金，强调色本身就是金黄。
               ⚠️CSS 变量 --bg-ink-1 和它的加粗设定都留着（想加回来只要把 1 放回 BG_MK_INKS），
                 所以这里查的是「画出来的颜色里没有它」，不是「变量没了」。 */
            out.G_黄不参与随机 = out.G_日间色.indexOf('#eec400') < 0 && out.G_夜间色.indexOf('#ffe500') < 0
                              && getComputedStyle(document.body).getPropertyValue('--bg-ink-1').trim() !== '';
            if (!hadDark) document.body.classList.remove('dark');
            bgMkLayout(a.bub);
        }

        /* ── H：⚠️写小注不许把背景词记号抹掉 ──
           2026-08-10 用户报：「当一个段落里面有画框时，我这个时候进行小注，原本因为背景词而被选出来
           框起来的那一些渲染会消失，我必须退出重进才会重新渲染」。
           根因：背景词那层当时蹭了 `.rd-gl-layer` 这个 class 省 CSS，而小注重排第一步 `rdGlClear`
           删的是**所有** .rd-gl-layer → 连坐删掉，且 rdGlLayout 只会重建小注层。
           现在 .bg-mk-layer 有自己的定位样式。**别再让别的层去蹭 .rd-gl-layer。** */
        {
            const a = build([{ n: 1, html: P1 }], [{ cp: 1, head: '汐：背景：孙武' }]);
            out.H_写之前 = a.box.querySelectorAll('.bg-mk-svg > g').length;
            // 模拟「写了一条小注」：段落里出现带 data-gl 的 mark，然后重排小注层
            const p = a.box.querySelector('p[data-p="1"]');
            p.innerHTML = p.innerHTML.replace('齐国',
                '<mark class="rd-hl rd-hl-gold" data-hlid="hh9" data-gl="qí guó·春秋诸侯国">齐国</mark>');
            rdGlLayout(a.bub);
            out.H_写之后 = a.box.querySelectorAll('.bg-mk-svg > g').length;
            out.H_没被抹掉 = out.H_写之后 === out.H_写之前 && out.H_写之后 > 0;
            out.H_小注层也在 = !!a.box.querySelector('.rd-gl-svg');
            // 两层各自独立：class 不许再有交集
            const bgLayer = a.box.querySelector('.bg-mk-layer');
            out.H_没蹭小注的class = !!bgLayer && !bgLayer.classList.contains('rd-gl-layer');
        }

        /* ── I：题目和正文对不上时，砍词尾最多两个字再找 ──
           2026-08-10 用户实拍报的：背景块题目是「艾陵之战」，而正文里只有「艾陵」两个字，
           于是一个记号都没标。她原话：「原文里面没有出现艾陵之战这四个字，只有艾陵，
           这实际上任务就相当于完成了，但难以标注」。 */
        {
            const F = '吴王夫差跟太宰嚭一起出兵伐齐，大败齐师于艾陵，顺道灭了邹鲁之君。';
            out.I_整词就在 = bgMkMatchTerm(F, '邹鲁');
            out.I_砍之战 = bgMkMatchTerm(F, '艾陵之战');
            out.I_砍之会 = bgMkMatchTerm('后来又搞了黄池那次会盟', '黄池之会');
            // ⚠️最多砍两个字：核心在后面的词宁可不标，也别误标成前面那截
            out.I_核心在后不误标 = bgMkMatchTerm(F, '齐国大夫鲍牧');
            // ⚠️剩下不足两个字就放弃（别标到单字上）
            out.I_不砍到单字 = bgMkMatchTerm('他在城里住了很久', '城中之乱');
            out.I_找不到就空 = bgMkMatchTerm(F, '完全不相干的词');
            out.I_对了 = out.I_整词就在 === '邹鲁' && out.I_砍之战 === '艾陵'
                      && out.I_砍之会 === '黄池' && out.I_核心在后不误标 === ''
                      && out.I_不砍到单字 === '' && out.I_找不到就空 === '';
            // 真场景：题目「艾陵之战」，正文只有「艾陵」→ 该标出来
            const a = build([{ n: 1, html: '吴王夫差出兵伐齐，大败齐师于艾陵，顺道灭了邹鲁之君。' }],
                            [{ cp: 1, head: '汐：背景：艾陵之战' }]);
            out.I_真场景标上了 = a.box.querySelectorAll('.bg-mk-svg > g').length === 1;
            /* ⚠️**治本在提示词里，而且是「一对」**（2026-08-10）：
               ① 第一遍：名字优先照抄原文里的字（这样正文里才定位得到、画得出圈）；
               ② 第二遍：如果那只是简称/局部，开头先点明完整名称再讲——
                  用户明确要求解释仍要引申（「解释的时候是允许在原文上面引申的」），
                  不是退化成「只解释原文那两个字」。
               上面那套砍字只是兜底（管已经标好的老数据、和模型偶尔没照做）。
               这两条断言防的是：以后有人整理提示词时删了其中一条——
               只删①会让记号又标不上，只删②会让讲解退化成解释字面。 */
            out.I_提示词要求照抄原文 = BG_SCAN_INSTRUCTION.indexOf('照抄那几个字') > 0
                                  && BG_SCAN_INSTRUCTION.indexOf('别写「艾陵之战」') > 0;
            /* ⚠️⚠️这条盯的是**当天翻过的车**：第一版把「贴着原文」写进了「名称怎么写」那一节，
               模型当成了筛选标准，用户实测「找出来的基本上都是单个的名词」——
               她之前那些最厚的条目（原文里没有现成词、全靠概括命名）全没了。
               所以提示词里必须同时有「这是起名字的偏好、不是挑不挑的标准」和「绝不要因此放弃」
               这两句话，还得留着那三个正例。少一句都可能让覆盖面再塌一次。 */
            out.I_没把命名当筛选 = BG_SCAN_INSTRUCTION.indexOf('不是挑不挑这条的标准') > 0
                              && BG_SCAN_INSTRUCTION.indexOf('绝不要因为原文里没有现成的词，就放弃这个背景点') > 0
                              && BG_SCAN_INSTRUCTION.indexOf('春秋复仇观念') > 0;
            out.I_讲解要补全称 = BG_EXPLAIN_INSTRUCTION.indexOf('点明完整名称') > 0
                             && BG_EXPLAIN_INSTRUCTION.indexOf('艾陵之战') > 0;
        }

        document.querySelectorAll('.__bgt').forEach(n => n.remove());
        return out;
    });

    ok('A1 ⚠️同一段里出现几次就画几次（孙武×3 + 豫章×1 = 4）', R.A_每一处都画, '实际 ' + R.A_画了几个 + ' 个');
    ok('A2 ⚠️别的人名一个都没碰（满篇人名那版已被否掉）', R.A_没碰别的人名);
    ok('A3 没有背景块时不建层', R.A_没背景块就不画);
    ok('B1 从背景块第一行抠词（含昵称/书名号/标点/整句）', R.B_对了,
       JSON.stringify([R.B_普通, R.B_换了昵称, R.B_带书名号, R.B_带标点, R.B_不是背景块, R.B_一整句不要]));
    ok('C1 两个不同的词是两支不同的笔', R.C_两个词不同色, JSON.stringify(R.C_两个词颜色));
    ok('C2 重排后一模一样（种子钉死）', R.C_重排后一模一样);
    ok('C3 重开一章后也一模一样', R.C_重建后一模一样);
    ok('C4 ⚠️形状与颜色不绑死、分布够散', R.C_分布够散, '形状 ' + R.C_形状种类 + ' 种 / 颜色 ' + R.C_颜色种类 + ' 种');
    ok('C5a ⚠️两个字的词不给下划线（门槛三个字）', R.C_两字没有下划线);
    ok('C5b 三个字及以上可以抽到下划线', R.C_三字以上有下划线);
    ok('C5c 跨行且够长 → 下划线（每行一条，不裂）', R.C_跨行够长走下划线);
    ok('C5d 跨行但太短 → 方框', R.C_跨行太短走方框);
    ok('C5e 底下已有别的下划线 → 避开', R.C_底下有线就避开);
    ok('C6 同一个词的几处：同一支笔', R.C_同词同色);
    ok('C7 同一个词的几处：歪法各不相同（不是复制粘贴）', R.C_同词歪法不同);
    ok('D1 前提：记号画上了', R.D_画上了);
    ok('D2 每一行的位置一个像素都没动', R.D_行位置没变);
    ok('D3 段落没有变高', R.D_段落没变高);
    ok('D4 记号层不吃点击（不挡划线/翻页）', R.D_层不吃点击);
    ok('E1 段落里找不到那个词 → 安静跳过', R.E_找不到就不画);
    ok('E2 默认开', R.E_默认是开的);
    ok('E3 关掉就没了', R.E_关掉就没了);
    ok('E4 再开能补回来', R.E_再开能补回来);
    ok('E5 开关存进本机', R.E_存了本机);
    ok('E6 同一个词有两个背景块时不重复画', R.E_同词只画一次);
    ok('G1 ⚠️切夜间确实换了另一套颜色（变量要从 body 读，不是 html）', R.G_切夜间换了色,
       '日 ' + JSON.stringify(R.G_日间色) + ' / 夜 ' + JSON.stringify(R.G_夜间色));
    ok('G2 ⚠️黄色已移出随机池（变量本身留着备用）', R.G_黄不参与随机);
    ok('H1 ⚠️写小注之后背景词记号还在（别再被 rdGlClear 连坐删掉）', R.H_没被抹掉, R.H_写之前 + ' → ' + R.H_写之后);
    ok('H2 小注自己那层也正常建起来了', R.H_小注层也在);
    ok('H3 ⚠️背景词层没有蹭 .rd-gl-layer 这个 class', R.H_没蹭小注的class);
    ok('I1 ⚠️砍词尾最多两字的回退匹配', R.I_对了,
       JSON.stringify([R.I_整词就在, R.I_砍之战, R.I_砍之会, R.I_核心在后不误标, R.I_不砍到单字, R.I_找不到就空]));
    ok('I2 真场景：题目「艾陵之战」、正文只有「艾陵」→ 标出来了', R.I_真场景标上了);
    ok('I3 ⚠️第一遍：名字尽量照抄原文的字（这样才定位得到）', R.I_提示词要求照抄原文);
    ok('I3b ⚠️⚠️但那只是起名偏好、不是筛选标准（否则长背景会全丢）', R.I_没把命名当筛选);
    ok('I4 ⚠️第二遍：开头补完整名称（解释仍要引申，别退化成解释字面）', R.I_讲解要补全称);
    ok('F1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 背景词记号：${bad}/${results.length} 条失败` : `\n✅ 背景词记号：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
