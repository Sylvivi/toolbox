/* 引号「手绘线」回归测试（2026-08-12 做）。
 *
 * 功能：引号里的话底下画一条 Rough.js 手绘下划线，作为「样式」那行的一档，
 * 跟画框/波浪/柔光并列。用户原话：「把 rough notation 里面的下划线作为样式之一，
 * 加到画框波浪柔光就是长短句里面的那个装饰里去，作为一个选项」。
 *
 * 钉住的几条：
 *  A 组 开了才画、关了要擦干净（它是画出来的，不是改个 class 就完事的 CSS 装饰）
 *  B 组 跟波浪**二选一**（都铺在句底）；顺带钉住画框/柔光已被去掉、别再回来
 *  C 组 长短分工开着时，长句(rq-wide)不画——跟波浪/画框那条 strip 规则一致
 *  D 组 钉死：同一句话重排永远同一条歪线；同一句出现两次歪法要不同（别像复制粘贴）
 *  E 组 ⚠️不许动版面（线全在绝对定位的 SVG 层上）
 *  F 组 ⚠️自己的 layer class，不许蹭 .rd-gl-layer（会被 rdGlClear 连坐删掉）
 *  G 组 ⚠️颜色必须从 body 读（主题/夜间都定义在 body 上，从 <html> 读会永远拿默认色）
 *  H 组 ⚠️没开手绘线时，别把「有引号的消息」判成值得排版（_glWorth 白烧）
 *  I 组 ⚠️性能：必须「先量完再画」，改回边量边画会退回逐句整页重排（用户报过卡）
 *  J 组 ⚠️⚠️图层体量：全章合成一个 path + 只覆盖视口附近（用户报过「clawd 卡十秒」）
 *
 * 跑法：node tests/quoterul.test.js   或   bash tests/p.sh quoterul
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
        const Q = (s, wide) => '<span class="reading-quote' + (wide ? ' rq-wide' : '')
            + '">「<span class="reading-quote-inner">' + s + '</span>」</span>';

        // paras: 每段一串 html
        function build(paras) {
            document.querySelectorAll('.__qult').forEach(n => n.remove());
            const html = paras.map((h, i) => '<p data-p="' + (i + 1) + '">' + h + '</p>').join('');
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.8;width:358px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __qult'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            qUlLayout(bub);
            return { box, bub };
        }
        const P1 = '他放下茶盏，说' + Q('这事我早有耳闻') + '，屋里一时静下来。';
        const P2 = '她摇头，只答' + Q('不必再提') + '，转身出了门。';
        // 长句：留着做长短分工那组
        const PW = '他叹了口气，慢慢说' + Q('当年那桩事牵连甚广，如今再翻出来，怕是谁也担待不起，不如就此揭过', true) + '。';

        const setOn = on => {
            localStorage.setItem('reading_quote_rul', on ? '1' : '0');
            if (on) localStorage.setItem('reading_quote_wave', '0');
            readingApplyQuoteStyles();
        };
        /* ⚠️全章的线合成**一个** <path>（2026-08-12 性能修的），所以「画了几条」不能再数元素个数，
           要数那条 d 里有几个 M ＝ 几笔。一句引号 = 2 笔（Rough 的 doubleLine 来回描两遍）。 */
        const segs = box => {
            const pp = box.querySelector('.q-ul-svg path');
            return pp ? (pp.getAttribute('d').match(/M/g) || []).length : 0;
        };
        const paths = segs;
        const dOf = box => {
            const pp = box.querySelector('.q-ul-svg path');
            return pp ? pp.getAttribute('d') : '';
        };

        // ── A：开了才画、关了要擦干净 ──
        {
            setOn(true);
            const a = build([P1, P2]);
            out.A_开着有线 = paths(a.box) > 0;
            out.A_有身份class = !!a.box.querySelector('.q-ul-layer');
            setOn(false);
            const b = build([P1, P2]);
            out.A_关掉不画 = paths(b.box) === 0 && !b.box.querySelector('.q-ul-layer');
            /* ⚠️关掉那一下必须**擦掉已经画好的**：清理不能挂在「开着」的分支里，
               否则线会一直留在屏幕上（readingApplyQuoteStyles 里那条无条件 qUlClear）。 */
            setOn(true);
            const c = build([P1, P2]);
            const 画过 = paths(c.box) > 0;
            setOn(false);
            out.A_关掉会擦干净 = 画过 && c.box.querySelectorAll('.q-ul-svg path').length === 0;
            setOn(true);
        }

        /* ── B：跟波浪二选一 ──
           ⚠️画框/柔光 2026-08-12 被用户去掉了（「把画框和柔光去掉，不只是样式，精句里的也去掉」），
             「铺句底」这一组现在只剩波浪和手绘线两档，互斥要双向都成立。 */
        {
            const b = document.body.classList;
            // ⚠️toggle 是「反转」不是「打开」：进这一组时手绘线还开着，不先关掉的话第一次 toggle 是在关它
            localStorage.setItem('reading_quote_rul', '0');
            localStorage.setItem('reading_quote_wave', '1'); readingApplyQuoteStyles();
            readingToggleQuoteRul();     // 开手绘线 → 波浪要被顶掉
            out.B_开线关波浪 = b.contains('reading-rul-on') && !b.contains('reading-wave-on');
            readingToggleQuoteWave();    // 反过来：开波浪 → 手绘线要被顶掉
            out.B_开波浪关线 = b.contains('reading-wave-on') && !b.contains('reading-rul-on');
            out.B_画框柔光没了 = typeof window.readingToggleQuoteBox === 'undefined'
                              && typeof window.readingToggleQuoteGlow === 'undefined'
                              && !document.getElementById('chipQuoteBox')
                              && !document.getElementById('chipQuoteGlow')
                              && !document.getElementById('chipKsBox')
                              && !document.getElementById('chipKsGlow');
            setOn(true);
        }

        // ── C：长短分工——长句不画 ──
        {
            localStorage.setItem('reading_quote_split', '0'); setOn(true);
            const a = build([PW]);
            out.C_长短关时长句照画 = paths(a.box) > 0;
            localStorage.setItem('reading_quote_split', '1'); readingApplyQuoteStyles();
            const b = build([PW]);
            out.C_长短开时长句不画 = paths(b.box) === 0;
            const c = build([P1]);       // 短句照画
            out.C_短句照画 = paths(c.box) > 0;
            localStorage.setItem('reading_quote_split', '0'); readingApplyQuoteStyles();
        }

        // ── D：钉死的歪法 ──
        {
            setOn(true);
            const a = build([P1]);
            const d1 = dOf(a.box);
            qUlLayout(a.bub);            // 重排一次（相当于换字号/切主题）
            out.D_重排一模一样 = dOf(a.box) === d1 && d1.length > 0;
            const b = build([P1]);       // 整个重建（相当于重开一章）
            out.D_重建一模一样 = dOf(b.box) === d1;
            // 同一句话在一章里出现两次 → 每一笔的歪法都要不一样，否则像复制粘贴
            const c = build([P1, P1]);
            const ds = dOf(c.box).split('M').filter(x => x.trim());
            out.D_同句两处歪法不同 = ds.length >= 4 && new Set(ds).size === ds.length;
        }

        /* ── E：⚠️不许动版面 ──
           线画在绝对定位的 SVG 层上，开关它不该让任何一个字挪位置。
           （小注那边踩过：行内元素加 padding 会让整段位移、还带偏引线锚点。） */
        {
            setOn(false);
            const a = build([P1, P2]);
            const before = a.box.querySelector('p[data-p="2"]').getBoundingClientRect();
            const h0 = a.box.getBoundingClientRect().height;
            setOn(true); qUlLayout(a.bub);
            const after = a.box.querySelector('p[data-p="2"]').getBoundingClientRect();
            out.E_没推开正文 = Math.abs(before.top - after.top) < 0.5 && Math.abs(before.left - after.left) < 0.5;
            out.E_没撑高容器 = Math.abs(h0 - a.box.getBoundingClientRect().height) < 0.5;
        }

        // ── F：⚠️自己的 class，不许蹭 .rd-gl-layer ──
        {
            setOn(true);
            const a = build([P1]);
            const layer = a.box.querySelector('.q-ul-layer');
            out.F_不蹭引线层 = !!layer && !layer.classList.contains('rd-gl-layer');
            // rdGlClear 删的是 .rd-gl-layer，删完手绘线必须还在
            rdGlClear(a.box);
            out.F_清引线时线还在 = a.box.querySelectorAll('.q-ul-svg path').length > 0;
        }

        /* ── G：⚠️⚠️颜色必须从 document.body 取，不能从 documentElement(<html>) 取 ──
           主题（含夜间那套 `-night`）都是挂在 **body** 上的 class 在定义 --accent，
           而 CSS 变量只往**下**继承：从 <html> 读永远只能拿到 :root 那份默认色，
           表现就是「换了主题/切了夜间，线还是原来的颜色」。
           背景词 2026-08-10 实测踩过一模一样的坑（见 bgMkLayout 里那条⚠️⚠️）。
           ⚠️这里**故意不靠切主题类来测**：那样得写死某个主题的名字和色值，主题一改测试就假红。
             直接在两个层级各钉一个不同的 --accent，看画出来的线跟了谁——要的就是这个因果。 */
        {
            setOn(true);
            const HTML_色 = 'rgb(1, 2, 3)', BODY_色 = 'rgb(9, 8, 7)';
            document.documentElement.style.setProperty('--accent', HTML_色);
            document.body.style.setProperty('--accent', BODY_色);
            out.G_画出来的色 = build([P1]).box.querySelector('.q-ul-svg path').getAttribute('stroke');
            document.documentElement.style.removeProperty('--accent');
            document.body.style.removeProperty('--accent');
            out.G_跟的是body = out.G_画出来的色 === BODY_色;
            // 顺带确认它真的会跟着变（不是写死的常量）
            document.body.style.setProperty('--accent', 'rgb(4, 5, 6)');
            const 换一个 = build([P1]).box.querySelector('.q-ul-svg path').getAttribute('stroke');
            document.body.style.removeProperty('--accent');
            out.G_换色跟得上 = 换一个 === 'rgb(4, 5, 6)' && 换一个 !== out.G_画出来的色;
        }

        /* ── H：⚠️没开手绘线时别白烧 ──
           _glWorth 是懒加载的闸门。如果不带「手绘线开着」这个前提，凡是有「」的消息都会被判为
           值得排版，等于给每条正文都摊上一次逐句量位置。 */
        {
            const a = build([P1, P2]);      // 只有引号，没有小注/背景块
            setOn(false);
            out.H_没开时不值得排 = _glWorth(a.bub) === false;
            setOn(true);
            out.H_开了才值得排 = _glWorth(a.bub) === true;
        }

        /* ── I：⚠️性能护栏——「先量完、再画」不许改回去 ──
           第一版是「建好层 → 边量边往层里加线」：每加一条线就把排版标脏，下一句的
           getClientRects() 又逼浏览器整页重排一遍。40 句对白 ＝ 40 次整页重排，
           实测这台服务器 32ms/条消息，手机乘 3~5 倍，用户当天就报「有点卡」。
           拆成「只读一段 + 离屏画一段 + 最后挂一次」之后同样 40 句降到 3ms 上下。
           ⚠️这里的门槛（15ms）是**回归绊线**、不是精确基准：新写法有四倍余量，
             改回交叉写法必然撞线。跑得慢的机器上略有浮动也不至于假红。 */
        {
            setOn(true);
            const many = [];
            for (let i = 0; i < 40; i++) many.push('他放下茶盏，缓缓说' + Q('这事我早有耳闻，只是不便明说' + i) + '，屋里一时静了下来。');
            const a = build(many);
            out.I_引号数 = a.box.querySelectorAll('.reading-quote-inner').length;
            const ts = [];
            for (let k = 0; k < 5; k++) { const t0 = performance.now(); qUlLayout(a.bub); ts.push(performance.now() - t0); }
            ts.sort((x, y) => x - y);
            out.I_中位耗时 = +ts[2].toFixed(1);
            out.I_没退回逐句重排 = out.I_中位耗时 < 15;
            out.I_带子里画上了 = segs(a.box) > 0;
        }

        /* ── J：⚠️⚠️图层体量护栏——这是「clawd 点下去卡十秒」的根因 ──
           共读模式下**一条消息就是一整章**，正文容器实测 36000px 高。第一版干了两件蠢事：
             ① 一句引号一个 <g><path>，600 句就是 1200 个 SVG 节点塞进正文树；
             ② SVG 跟容器一样高 —— 358×36000 的图层，手机得为它开一块巨大的光栅缓存。
           用户报「clawd 图标点下去要卡十秒才弹菜单，把手绘线换成波浪线就立刻好」——波浪是
           一张小图平铺、零新增图层，对比非常干净。现在：全章合成一个 path，图层只覆盖
           「可见区上下各一屏」，实测 36217px → 979px（2.7%）、1200 节点 → 2 个。 */
        {
            setOn(true);
            const many = [];
            for (let i = 0; i < 300; i++) many.push('他放下茶盏，缓缓说' + Q('这事我早有耳闻，只是不便明说' + i) + '，屋里一时静了下来，谁也没有接话。');
            const a = build(many);
            const svg = a.box.querySelector('.q-ul-svg');
            out.J_容器高 = Math.round(a.box.getBoundingClientRect().height);
            out.J_图层高 = svg ? +svg.getAttribute('height') : 0;
            // 图层不许跟整章一样高：给三屏的宽裕度（当前是上下各一屏＝三屏），仍远小于整章
            out.J_只画视口附近 = out.J_图层高 > 0
                              && out.J_图层高 <= window.innerHeight * 3.2
                              && out.J_图层高 < out.J_容器高 / 2;
            // 全章只许有一个 path（svg + path = 2 个节点）
            out.J_节点数 = a.box.querySelectorAll('.q-ul-layer *').length;
            out.J_合成了一条路径 = out.J_节点数 === 2;
            /* 滚出带子之后要补画。⚠️这条钉的是「补画真的会发生」——不补的话滚下去就是一片空白，
               而空白比卡顿更难发现（看着像功能没开）。 */
            const band0 = a.box.querySelector('.q-ul-layer').getAttribute('data-band');
            window.scrollTo(0, document.body.scrollHeight / 2);
            qUlRefresh();
            const layer1 = a.box.querySelector('.q-ul-layer');
            out.J_滚过去会补画 = !!layer1 && layer1.getAttribute('data-band') !== band0 && segs(a.box) > 0;
            window.scrollTo(0, 0);
        }

        document.querySelectorAll('.__qult').forEach(n => n.remove());
        setOn(false);
        return out;
    });

    ok('A1 开着就画出线', R.A_开着有线);
    ok('A2 层有自己的身份 class', R.A_有身份class);
    ok('A3 关掉不画', R.A_关掉不画);
    ok('A4 ⚠️关掉会把画好的擦干净', R.A_关掉会擦干净);
    ok('B1 开手绘线→波浪被顶掉', R.B_开线关波浪);
    ok('B2 开波浪→手绘线被顶掉', R.B_开波浪关线);
    ok('B3 ⚠️画框/柔光四处入口都没了（引号+精句，用户 2026-08-12 去掉的）', R.B_画框柔光没了);
    ok('C1 长短关时长句照画', R.C_长短关时长句照画);
    ok('C2 长短开时长句不画（装饰让给短句）', R.C_长短开时长句不画);
    ok('C3 长短开时短句照画', R.C_短句照画);
    ok('D1 重排后歪法一模一样', R.D_重排一模一样);
    ok('D2 重建后歪法一模一样', R.D_重建一模一样);
    ok('D3 同一句出现两次，歪法不同', R.D_同句两处歪法不同);
    ok('E1 ⚠️没推开正文', R.E_没推开正文);
    ok('E2 ⚠️没撑高容器', R.E_没撑高容器);
    ok('F1 ⚠️不蹭 .rd-gl-layer', R.F_不蹭引线层);
    ok('F2 ⚠️rdGlClear 删引线层时手绘线还在', R.F_清引线时线还在);
    ok('G1 ⚠️⚠️颜色从 body 取（从 <html> 取会永远拿默认色、切主题不换色）', R.G_跟的是body, '画出来=' + R.G_画出来的色);
    ok('G2 换了强调色，线跟得上', R.G_换色跟得上);
    ok('H1 ⚠️没开手绘线时不判为值得排版', R.H_没开时不值得排);
    ok('H2 开了才判为值得排版', R.H_开了才值得排);
    ok('I1 ⚠️⚠️没退回「边量边画」（40 句应在 15ms 内）', R.I_没退回逐句重排, R.I_引号数 + ' 句 / 中位 ' + R.I_中位耗时 + 'ms');
    ok('I2 快了之后带子里照样画上', R.I_带子里画上了);
    ok('J1 ⚠️⚠️图层只覆盖视口附近，不是整章', R.J_只画视口附近, '容器 ' + R.J_容器高 + 'px / 图层 ' + R.J_图层高 + 'px');
    ok('J2 ⚠️⚠️全章合成一个 path（不是一句一个节点）', R.J_合成了一条路径, 'SVG 节点 ' + R.J_节点数 + ' 个');
    ok('J3 滚出带子会补画上', R.J_滚过去会补画);
    ok('Z 页面没报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.detail ? '  — ' + r.detail : '')));
    console.log(bad.length ? ('❌ 引号手绘线：' + bad.length + '/' + results.length + ' 条失败')
                           : ('✅ 引号手绘线：' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})();
