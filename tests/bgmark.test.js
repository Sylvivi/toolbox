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
        const bq = (cp, head, body, anchor) => '<blockquote data-cp="' + cp + '" data-ci="0" data-bg="1" '
            + (anchor ? 'data-anchor="' + anchor + '" ' : '')
            + 'style="margin:0.4em 0 0.6em;padding:0.5em 12px 0.4em;font-size:0.92em;line-height:1.6">'
            + '<div class="reading-q">' + head + '</div>' + (body || '正文说明。') + '</blockquote>';

        // paras: [{n, html}]，blocks: [{cp, head}]
        function build(paras, blocks) {
            document.querySelectorAll('.__bgt').forEach(n => n.remove());
            let html = '';
            paras.forEach(p => {
                html += '<p data-p="' + p.n + '">' + p.html + '</p>';
                blocks.filter(b => String(b.cp) === String(p.n)).forEach(b => { html += bq(b.cp, b.head, null, b.anchor); });
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
            /* ⚠️选记号的规则表在 index.html 的 rdMkPick 上面，**背景词和小注共用同一条**
               （bgMkPick 直接委托过去）。2026-08-10 用户连调四轮定稿：
                 底下有线 → 框/圈；没线时 ≤4 字 → 框/圈，≥5 字 → 下划线/框/圈。
               ⚠️**方框和圈完全同等地位**，别再单独给圈加限制。 */
            const bgMany = (w, noU) => {
                const set = new Set();
                for (let i = 0; i < 200; i++) set.add(bgMkPick(w + i, noU));
                return [...set].sort().join('');
            };
            /* ⚠️别用 bgMany 造四字词——它会把序号拼在后面，'四字词组0' 就变成五个字，
               而五字正好跨过下划线的门槛，测出来必然带 u（第一版就这么假红的）。
               这里用「词N甲M」凑**恒定四个字**。 */
            const four = new Set();
            for (let i = 0; i < 200; i++) four.add(bgMkPick('词' + (i % 10) + '甲' + (i % 7), false));
            out.C_四字以内不给下划线 = !four.has('u') && four.size === 2
                                  && bgMkPick('孙武', false) !== 'u'
                                  && bgMkPick('伍子胥', false) !== 'u';
            out.C_五字以上三种都有 = bgMany('吴楚边境桑女争', false) === 'bcu';
            out.C_底下有线给框或圈 = bgMany('孙武', true) === 'bc'
                                 && bgMany('吴楚边境桑女争', true) === 'bc';
            out.C_圈处处都在 = four.has('c') && bgMany('吴楚边境桑女争', false).includes('c')
                            && bgMany('孙武', true).includes('c');
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
            /* ⚠️第一遍要**同时**给出发点和题目（三列）。出发点是原文里逐字有的字，拿来画圈。 */
            out.I_提示词要出发点 = BG_SCAN_INSTRUCTION.indexOf('原文出发点') > 0
                              && BG_SCAN_INSTRUCTION.indexOf('原文里逐字出现过的') > 0
                              && BG_SCAN_INSTRUCTION.indexOf('P12|桑叶|吴楚边境桑女争桑') > 0;
            /* ⚠️⚠️这条盯的是**当天翻过的车**：第一版把「贴着原文」写进了「名称怎么写」那一节，
               模型当成了筛选标准，用户实测「找出来的基本上都是单个的名词」——
               她之前那些最厚的条目（原文里没有现成词、全靠概括命名）全没了。
               所以提示词里必须同时有「这是起名字的偏好、不是挑不挑的标准」和「绝不要因此放弃」
               这两句话，还得留着那三个正例。少一句都可能让覆盖面再塌一次。 */
            out.I_题目不许改窄 = BG_SCAN_INSTRUCTION.indexOf('不要为了迁就出发点把题目改窄') > 0
                             && BG_SCAN_INSTRUCTION.indexOf('春秋复仇观念') > 0
                             && BG_SCAN_INSTRUCTION.indexOf('留空即可，别硬编') > 0;
            /* ⚠️第二遍**不需要**「开头补全称」那条了：三列之后题目本身就是完整的
               （「艾陵之战」「吴楚边境桑女争桑」），讲解直接拿题目讲即可。
               那条是上一版方案（题目＝原文的字）的残留，留着会让每条都画蛇添足加个开场白，
               2026-08-10 当天撤掉。这条断言盯着它别被人又加回来。 */
            out.I_讲解没有多余开场白要求 = BG_EXPLAIN_INSTRUCTION.indexOf('点明完整名称') < 0;
        }

        /* ── J：原文出发点（题目引申、圈画在原文的字上）──
           2026-08-10 用户点破的：「即便是讲背景，那他也是有出发点的，而那个出发点肯定是在文章里面，
           像争桑叶那个桑叶就是出发点，所以那个就可以标起来，而不是说就不标了」。
           所以清单是三列「P段号|出发点|题目」，出发点渲染到 blockquote 的 data-anchor 上，画圈用它。 */
        {
            // 解析三列
            const a1 = _rdBgParseLine('P12|桑叶|吴楚边境桑女争桑');
            const a2 = _rdBgParseLine('P23||春秋复仇观念');       // ⚠️找不到出发点，中间那格空着
            const a3 = _rdBgParseLine('P7|共济会');               // 老的两列格式照旧
            out.J_三列 = a1 && a1.anchor === '桑叶' && a1.term === '吴楚边境桑女争桑';
            out.J_空格子不留竖线 = a2 && a2.anchor === '' && a2.term === '春秋复仇观念';
            out.J_两列照旧 = a3 && a3.term === '共济会' && !a3.anchor;
            // 标题行的 ⟦⟧ 标记：拆得出、且显示时要剥掉
            const sp = _rdBgSplitQ('背景：吴楚边境桑女争桑 ⟦桑叶⟧');
            out.J_拆得出 = sp.text === '背景：吴楚边境桑女争桑' && sp.anchor === '桑叶';
            out.J_没标记也不炸 = _rdBgSplitQ('背景：共济会').text === '背景：共济会';
            // 真场景：题目是概括的、正文里根本没有，靠出发点画圈
            const P = '织布的核心在于丝，而生产丝的核心是养蚕，蚕需要桑叶才能生长，两国的女子为了抢夺桑叶起了争执。';
            const withAnchor = build([{ n: 1, html: P }],
                [{ cp: 1, head: '汐：背景：吴楚边境桑女争桑', anchor: '桑叶' }]);
            out.J_靠出发点画上了 = withAnchor.box.querySelectorAll('.bg-mk-svg > g').length === 2;   // 「桑叶」出现两次
            // 没有出发点时，题目在正文里找不到 → 照旧不画（不硬编、不误标）
            const noAnchor = build([{ n: 1, html: P }],
                [{ cp: 1, head: '汐：背景：吴楚边境桑女争桑' }]);
            out.J_没出发点就不画 = !noAnchor.box.querySelector('.bg-mk-layer');
            // 出发点优先于题目：两者都能匹配时用出发点
            const both = build([{ n: 1, html: '孙武带来一部兵法，讲的是用兵之道。' }],
                [{ cp: 1, head: '汐：背景：孙武', anchor: '兵法' }]);
            const d = both.box.querySelector('.bg-mk-svg > g');
            out.J_出发点优先 = !!d && both.box.querySelectorAll('.bg-mk-svg > g').length === 1;
        }

        /* ── K：⚠️「底下有线」要按**那个词自己的位置**判，不是拿整个段落去判 ──
           2026-08-10 修的真 bug：原来传的是 <p>，而「词在精句里」是往上找祖先的——
           段落是精句的**爹**不是儿子，所以永远找不到，背景词这边等于从来没避让过底下的线。
           用户问「底下有线的定义是什么样的？」时才发现。 */
        {
            const b = document.body.classList;
            const had = b.contains('reading-ks-ul');
            b.add('reading-ks-ul');
            // 「桑叶」包在精句里 → 底下有线 → 不许给下划线
            const inKs = build([{ n: 1, html: '两国的女子为了抢夺<span class="reading-keysent"><span class="reading-keysent-inner">桑叶起了争执</span></span>，一路闹大。' }],
                               [{ cp: 1, head: '汐：背景：吴楚边境桑女争桑', anchor: '桑叶起了争执' }]);
            const g1 = inKs.box.querySelector('.bg-mk-svg > g');
            out.K_精句里画上了 = !!g1;
            // d 以 M…L…（直线）开头且只有两段 ＝ 下划线；框/圈都是弯的（带 C/Q）
            const d1 = g1 ? g1.querySelector('path').getAttribute('d') : '';
            out.K_精句里不是下划线 = /[cCqQ]/.test(d1);
            // 同一个词不在精句里时，五字以上照样可能给下划线（这条只验「判断确实按位置走」）
            out.K_判断按位置走 = (() => {
                const p = inKs.box.querySelector('p[data-p="1"]');
                const inner = p.querySelector('.reading-keysent-inner');
                return rdMkHasUnderline(inner) === true && rdMkHasUnderline(p) === false;
            })();
            if (!had) b.remove('reading-ks-ul');
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
    ok('C5a ⚠️四字及以内不给下划线（框/圈）', R.C_四字以内不给下划线);
    ok('C5b 五字及以上：下划线/方框/圈 三选一', R.C_五字以上三种都有);
    ok('C5c ⚠️底下已有线（含波浪）→ 框或圈，不看字数', R.C_底下有线给框或圈);
    ok('C5d ⚠️⚠️圈在每一档里都在场（别再单独给圈加限制）', R.C_圈处处都在);
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
    ok('I3 ⚠️第一遍要给「原文出发点」（三列，出发点用来画圈）', R.I_提示词要出发点);
    ok('I3b ⚠️⚠️题目照旧该怎么起怎么起，不许为迁就出发点改窄', R.I_题目不许改窄);
    ok('I4 ⚠️第二遍不再要求「开头补全称」（三列之后题目本就完整，别加回来）', R.I_讲解没有多余开场白要求);
    ok('J1 清单三列：出发点+题目都解析得出', R.J_三列);
    ok('J2 ⚠️找不到出发点时中间那格空着，别把竖线留进题目', R.J_空格子不留竖线);
    ok('J3 老的两列格式照旧认', R.J_两列照旧);
    ok('J4 标题行的 ⟦出发点⟧ 拆得出（显示时会剥掉）', R.J_拆得出);
    ok('J5 没有标记的标题行不受影响', R.J_没标记也不炸);
    ok('J6 ⚠️题目是概括的、正文里没有 → 靠出发点把圈画上', R.J_靠出发点画上了);
    ok('J7 没有出发点又找不到题目 → 照旧不画（不硬编不误标）', R.J_没出发点就不画);
    ok('J8 出发点优先于题目', R.J_出发点优先);
    ok('K1 精句里的背景词照样画得出记号', R.K_精句里画上了);
    ok('K2 ⚠️精句「划线」开着时不给下划线（画的是框或圈）', R.K_精句里不是下划线);
    ok('K3 ⚠️「底下有线」按词自己的位置判、不是拿段落判', R.K_判断按位置走);
    ok('F1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 背景词记号：${bad}/${results.length} 条失败` : `\n✅ 背景词记号：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
