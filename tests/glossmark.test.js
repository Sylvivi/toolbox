/* 小注那个词的「手绘记号」回归测试（2026-08-10 做）。
 *
 * 功能：写过小注的那个词，不再显示划线的底色，改画一个手绘记号——
 * 四种：u 下划线 / b 方框 / c 圈 / h 荧光（荧光＝原色带的手绘版，浓度不变）。
 * 用户看了 rough-notation 之后要的，原话「下划线，box，circle，highlight我都喜欢哎」，
 * 并自己划定了适用面：「适合在长度比较短的单字或者词语上面」。
 *
 * 这个文件钉住的是**跟她逐条谈定的那几条规则**，改回去会立刻毁掉观感：
 *  A 组 选记号 = 字数定范围 + 范围内钉死的随机（她原话「我想着随机一点呢，要不按字数来定」）
 *  B 组 钉死：同一条小注永远同一个记号（每次打开都换＝页面在抽风）
 *  C 组 跨行降级成下划线（圈是绝对定位伪元素，跨行会裂成两个半圆）
 *  D 组 取代底色、不叠（她定的），且删掉小注要变回底色
 *  E 组 ⚠️不许推开正文：mark 是行内元素，横向 padding 会让整段位移、还带偏小注引线锚点
 *  F 组 开关（默认开，关掉回到原样）
 *
 * 跑法：node tests/glossmark.test.js   或   bash tests/p.sh glossmark
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
        const P1 = '那年山里落了很大的雪，他独自守着一间破屋，门前石阶上生满青苔，屋中雾气氤氲，久久不散。';
        const P2 = '他做什么都踟蹰，像总在门槛上迈不出去，想下山又怕山下的人问起从前那桩事。';

        function build(marks) {
            document.querySelectorAll('.__mkt').forEach(n => n.remove());
            const texts = { 1: P1, 2: P2 };
            const html = [1, 2].map(n => {
                let t = texts[n];
                marks.filter(m => m.para === n).forEach(m => {
                    t = t.replace(m.word, '<mark class="rd-hl rd-hl-' + (m.color || 'gold')
                        + '" data-hlid="' + m.id + '"'
                        + (m.note ? ' data-gl="' + m.note + '"' : '') + '>' + m.word + '</mark>');
                });
                return '<p data-p="' + n + '">' + t + '</p>';
            }).join('');
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __mkt'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            document.documentElement.style.setProperty('--reading-pspace', '28px');
            box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
            rdGlLayout(bub);
            return { box, bub };
        }
        const kindOf = el => (String(el.className).match(/rd-mk-([ubch])\b/) || [0, null])[1];

        // ── A：字数定范围（纯函数直接问，不受随机影响）──
        {
            // 1~4 字：四种都可能出现；5 字往上：只许下划线/荧光
            const shortKinds = new Set(), longKinds = new Set();
            for (let i = 0; i < 400; i++) {
                shortKinds.add(rdMkPick('h' + i, 2, false));
                longKinds.add(rdMkPick('h' + i, 8, false));
            }
            out.A_短词四种都可能 = [...shortKinds].sort().join('') === 'bchu';
            out.A_长词只有线和荧光 = [...longKinds].sort().join('') === 'hu';
            out.A_四字仍是短词 = (() => { const s = new Set(); for (let i = 0; i < 400; i++) s.add(rdMkPick('x' + i, 4, false)); return s.size === 4; })();
            out.A_五字就收窄 = (() => { const s = new Set(); for (let i = 0; i < 400; i++) s.add(rdMkPick('x' + i, 5, false)); return [...s].sort().join('') === 'hu'; })();
            // 别退化成「永远同一种」：随机确实在分布
            const dist = {};
            for (let i = 0; i < 600; i++) { const k = rdMkPick('seed' + i, 2, false); dist[k] = (dist[k] || 0) + 1; }
            out.A_分布 = dist;
            out.A_真的在随机 = Object.keys(dist).length === 4 && Object.values(dist).every(v => v > 60);
        }

        // ── B：钉死的随机——同一个 id 永远同一个记号 ──
        {
            out.B_纯函数稳定 = rdMkPick('abc123', 2, false) === rdMkPick('abc123', 2, false);
            const a = build([{ para: 1, word: '氤氲', id: 'hh1', note: 'yīn yūn·雾气弥漫' }]);
            const k1 = kindOf(a.box.querySelector('mark[data-hlid="hh1"]'));
            rdGlLayout(a.bub);                      // 重排一次（相当于刷新/换字号）
            const k2 = kindOf(a.box.querySelector('mark[data-hlid="hh1"]'));
            const b = build([{ para: 1, word: '氤氲', id: 'hh1', note: 'yīn yūn·雾气弥漫' }]);  // 整个重建（相当于重开一章）
            const k3 = kindOf(b.box.querySelector('mark[data-hlid="hh1"]'));
            out.B_记号 = [k1, k2, k3];
            out.B_重排不变 = k1 === k2;
            out.B_重建不变 = k1 === k3;
            out.B_确实打上了 = !!k1;
        }

        // ── C：跨行的词降级成下划线 ──
        {
            out.C_纯函数跨行降级 = ['c', 'b', 'h', 'u'].every(() => rdMkPick('anything', 2, true) === 'u');
            // 造一个真的跨行：挑一个正好被行尾折断的词
            const a = build([{ para: 1, word: '门前石阶上生满青苔', id: 'hx1', note: 'tái·潮湿处的绿苔' }]);
            const mk = a.box.querySelector('mark[data-hlid="hx1"]');
            const rects = [...mk.getClientRects()].filter(r => r.width > 0);
            out.C_确实跨行了 = rects.length > 1;         // 前提成立才谈得上降级
            out.C_跨行是下划线 = kindOf(mk) === 'u';
        }

        // ── D：取代底色、不叠；删掉小注变回底色 ──
        {
            const a = build([{ para: 1, word: '氤氲', id: 'hd1', note: 'yīn yūn·雾气弥漫' }]);
            const mk = a.box.querySelector('mark[data-hlid="hd1"]');
            const cs = getComputedStyle(mk);
            out.D_没有底色渐变 = !/gradient|rgba?\([^)]*\)\s*(?!.*url)/.test(cs.backgroundColor) || cs.backgroundColor === 'rgba(0, 0, 0, 0)';
            out.D_背景色透明 = cs.backgroundColor === 'rgba(0, 0, 0, 0)';
            out.D_没有柔光 = cs.boxShadow === 'none';
            out.D_有记号图 = !!a.box.querySelector('.rd-mk-svg path');
            // 只划线、不写小注的那种：一切照旧
            const b = build([{ para: 2, word: '踟蹰', id: 'hd2' }]);   // ⚠️「踟蹰」在第 2 段，写成 1 会拿到 null
            const plain = b.box.querySelector('mark[data-hlid="hd2"]');
            out.D_普通划线不受影响 = !plain.classList.contains('rd-mk')
                && getComputedStyle(plain).backgroundColor !== 'rgba(0, 0, 0, 0)';
            // 删掉小注 → 记号要撤干净（rdGlLayout 会在早退前先清）
            const c = build([{ para: 1, word: '氤氲', id: 'hd3', note: 'yīn yūn·雾气弥漫' }]);
            const m3 = c.box.querySelector('mark[data-hlid="hd3"]');
            m3.removeAttribute('data-gl');
            rdGlLayout(c.bub);
            out.D_删掉小注就撤记号 = !m3.classList.contains('rd-mk')
                && getComputedStyle(m3).backgroundColor !== 'rgba(0, 0, 0, 0)';
        }

        /* ── E：⚠️不许推开正文 ──
           mark 是行内元素，横向 padding 会把后面的字全推走（整段位移），
           而且小注的引线锚点是按那个词的位置算的，一位移箭头就指偏。 */
        {
            const before = build([{ para: 2, word: '踟蹰', id: 'he0' }]);          // 只划线
            const p2a = before.box.querySelector('p[data-p="2"]');
            const rowsBefore = [...new Set([...(() => { const r = document.createRange(); r.selectNodeContents(p2a); return r.getClientRects(); })()].filter(x => x.width > 0).map(x => Math.round(x.top)))];
            const wBefore = p2a.getBoundingClientRect().height;

            const after = build([{ para: 2, word: '踟蹰', id: 'he0', note: 'chí chú·犹豫不前' }]); // 划线+小注+记号
            const p2b = after.box.querySelector('p[data-p="2"]');
            const rowsAfter = [...new Set([...(() => { const r = document.createRange(); r.selectNodeContents(p2b); return r.getClientRects(); })()].filter(x => x.width > 0).map(x => Math.round(x.top)))];
            const wAfter = p2b.getBoundingClientRect().height;
            const mk = after.box.querySelector('mark[data-hlid="he0"]');
            const cs = getComputedStyle(mk);
            out.E_记号种类 = kindOf(mk);
            out.E_左右零padding = cs.paddingLeft === '0px' && cs.paddingRight === '0px';
            out.E_行数没变 = rowsBefore.length === rowsAfter.length;
            out.E_行位置没变 = JSON.stringify(rowsBefore) === JSON.stringify(rowsAfter);
            out.E_段落没变高 = Math.abs(wBefore - wAfter) < 0.5;

            /* ⚠️上面那条只测到随机抽中的那一种。四种的画法完全不同（下划线/荧光是背景图，
               框/圈是绝对定位的伪元素），必须**逐种**验一遍，否则改坏一种也照样绿。 */
            const rowsOf = p => { const r = document.createRange(); r.selectNodeContents(p); return [...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top * 10) / 10); };
            const perKind = {};
            ['u', 'b', 'c', 'h'].forEach(k => {
                const t = build([{ para: 2, word: '踟蹰', id: 'hk' + k }]);   // 只划线，当基准
                const p = t.box.querySelector('p[data-p="2"]');
                const base = rowsOf(p), baseH = p.getBoundingClientRect().height;
                const mk2 = t.box.querySelector('mark[data-hlid="hk' + k + '"]');
                mk2.classList.add('rd-mk', 'rd-mk-' + k);                    // 强行套上这一种（只撤底色）
                mk2.getBoundingClientRect();                                  // 逼一次重排
                perKind[k] = JSON.stringify(rowsOf(p)) === JSON.stringify(base)
                          && Math.abs(p.getBoundingClientRect().height - baseH) < 0.5;
            });
            out.E_逐种明细 = perKind;
            out.E_四种都不动版面 = ['u', 'b', 'c', 'h'].every(k => perKind[k]);
        }

        // ── F：开关（默认开、关掉回原样、再开回来）──
        {
            const a = build([{ para: 1, word: '氤氲', id: 'hf1', note: 'yīn yūn·雾气弥漫' }]);
            const mk = a.box.querySelector('mark[data-hlid="hf1"]');
            out.F_默认是开的 = !document.body.classList.contains('rd-mk-off') && mk.classList.contains('rd-mk');
            rdMkSetOn(false);
            out.F_关掉就撤class = !mk.classList.contains('rd-mk');
            out.F_关掉回到底色 = getComputedStyle(mk).backgroundColor !== 'rgba(0, 0, 0, 0)';
            rdMkSetOn(true);
            out.F_再开能补回来 = a.box.querySelector('mark[data-hlid="hf1"]').classList.contains('rd-mk');
            out.F_存了本机 = localStorage.getItem('reading_gl_mark') === '1';
        }

        /* ── G：形状是**真的 Rough.js** 画的，不是自己揉的抖动图 ──
           用户 2026-08-10 看对比图后要求换的（「你这完全没按rough notation来呀」）。
           钉两件事：① 库真的在（内联在页面顶上）；② 线是 Rough 的多遍描边、画在 .rd-mk-svg 上。 */
        {
            out.G_库在 = typeof rough !== 'undefined' && typeof rough.svg === 'function';
            const a = build([{ para: 1, word: '氤氲', id: 'hg1', note: 'yīn yūn·雾气弥漫' }]);
            const svg = a.box.querySelector('.rd-mk-svg');
            out.G_有记号层 = !!svg;
            const paths = svg ? svg.querySelectorAll('path') : [];
            out.G_画了线 = paths.length > 0;
            /* Rough 的招牌：同一个形状**描两遍**（disableMultiStroke 默认 false）。
               ⚠️别去数 <path> 的个数——多遍描边是合并进**同一条 d** 的（好几段 M 开头的子路径），
                 path 元素通常只有一个。数 d 里的 M 才对。 */
            out.G_子路径数 = svg ? (svg.querySelector('path').getAttribute('d') || '').split('M').length - 1 : 0;
            out.G_描了不止一遍 = out.G_子路径数 >= 2;
            out.G_路径不是直的 = svg ? /[cCqQ]/.test(svg.querySelector('path').getAttribute('d') || '') : false;
            // ⚠️记号必须**单独一层**：混进引线那层会被 `.rd-gl-svg > path` 的虚线 CSS 套上
            out.G_没混进引线层 = a.box.querySelectorAll('.rd-gl-svg .rd-mk-svg').length === 0
                              && a.box.querySelectorAll('.rd-mk-svg .rd-gl-svg').length === 0;
            out.G_引线仍是虚的 = (() => {
                const lp = a.box.querySelector('.rd-gl-svg > path');
                return !!lp && /\d/.test(getComputedStyle(lp).strokeDasharray || '');
            })();
            out.G_记号不是虚的 = paths.length ? !/\d/.test((getComputedStyle(paths[0]).strokeDasharray || '').replace(/none/, '')) : false;
        }

        /* ── J：那个词底下已经有别的下划线时，不许再画 rough 的下划线 ──
           用户 2026-08-10 报：「有下划线（来自断句精句这类样式）的情况下，最好不要再用
           rough的下划线，不然有点容易重叠」。三个来源：精句划线/引号划线/名词划线。 */
        {
            out.J_纯函数避开u = (() => {
                const s = new Set();
                for (let i = 0; i < 400; i++) s.add(rdMkPick('j' + i, 2, false, true));
                return !s.has('u') && s.size === 3;
            })();
            out.J_长词只剩荧光 = (() => {
                const s = new Set();
                for (let i = 0; i < 400; i++) s.add(rdMkPick('j' + i, 9, false, true));
                return [...s].join('') === 'h';
            })();
            // 跨行本来一律降级成下划线，但底下已有线时也得让开
            out.J_跨行时也避开 = rdMkPick('anything', 2, true, true) !== 'u';
            // 真场景：精句划线开着，词在精句里
            const b = document.body.classList;
            const hadKs = b.contains('reading-ks-ul');
            b.add('reading-ks-ul');
            const a = build([{ para: 1, word: '氤氲', id: 'hj1', note: 'yīn yūn·雾气弥漫' }]);
            const mk = a.box.querySelector('mark[data-hlid="hj1"]');
            const ks = document.createElement('span');
            ks.className = 'reading-keysent';
            mk.parentNode.insertBefore(ks, mk); ks.appendChild(mk);   // 把词包进精句里
            rdGlLayout(a.bub);
            out.J_识别到了 = rdMkHasUnderline(a.box.querySelector('mark[data-hlid="hj1"]'));
            out.J_真场景不是下划线 = kindOf(a.box.querySelector('mark[data-hlid="hj1"]')) !== 'u';
            if (!hadKs) b.remove('reading-ks-ul');
            // 没有那些下划线时，u 仍然要在池子里（别一刀切）
            out.J_平时还有u = (() => { const s = new Set(); for (let i = 0; i < 400; i++) s.add(rdMkPick('j' + i, 2, false, false)); return s.has('u'); })();
        }

        /* ── K：荧光不许把字弄糊 ──
           用户 2026-08-10 报：「荧光笔似乎是盖在字体上的，像一层纱使它显得有点糊，
           我觉得你可以参考一下之前的那个色带，因为色带盖在上面没有影响字的本色」。
           记号这层画在正文**上面**，所以必须靠正片叠底（夜间滤色）保住字的本色。 */
        {
            let id = null;
            for (let i = 0; i < 5000 && !id; i++) if (rdMkPick('kk' + i, 2, false) === 'h') id = 'kk' + i;
            const a = build([{ para: 1, word: '氤氲', id: id, note: 'yīn yūn·雾气弥漫' }]);
            out.K_拿到荧光 = kindOf(a.box.querySelector('mark[data-hlid="' + id + '"]')) === 'h';
            const g = a.box.querySelector('.rd-mk-svg > g');
            out.K_混合模式 = g ? getComputedStyle(g).mixBlendMode : '(没画出来)';
            out.K_日间正片叠底 = out.K_混合模式 === 'multiply';
            // 夜间要翻成滤色，否则荧光在暗底上被压成黑的
            const hadDark = document.body.classList.contains('dark');
            document.body.classList.add('dark');
            const b = build([{ para: 1, word: '氤氲', id: id, note: 'yīn yūn·雾气弥漫' }]);
            const g2 = b.box.querySelector('.rd-mk-svg > g');
            out.K_夜间混合模式 = g2 ? getComputedStyle(g2).mixBlendMode : '(没画出来)';
            out.K_夜间滤色 = out.K_夜间混合模式 === 'screen';
            if (!hadDark) document.body.classList.remove('dark');
        }

        /* ── I：Rough 每次画都会重新随机，**必须钉死种子** ──
           不钉的话每次重排（换字号/切主题/翻页重渲）同一个圈的歪法都不一样，页面像在抖。 */
        {
            const a = build([{ para: 1, word: '氤氲', id: 'hi1', note: 'yīn yūn·雾气弥漫' }]);
            const d1 = [...a.box.querySelectorAll('.rd-mk-svg path')].map(p => p.getAttribute('d')).join('|');
            rdGlLayout(a.bub);
            const d2 = [...a.box.querySelectorAll('.rd-mk-svg path')].map(p => p.getAttribute('d')).join('|');
            const b = build([{ para: 1, word: '氤氲', id: 'hi1', note: 'yīn yūn·雾气弥漫' }]);
            const d3 = [...b.box.querySelectorAll('.rd-mk-svg path')].map(p => p.getAttribute('d')).join('|');
            out.I_有路径 = d1.length > 20;
            out.I_重排后一模一样 = d1 === d2;
            out.I_重建后一模一样 = d1 === d3;
            // 换一个词（换 id）就该是另一副歪法，别退化成所有记号长得一样
            const c = build([{ para: 1, word: '青苔', id: 'hi2', note: 'tái·潮湿处的绿苔' }]);
            const d4 = [...c.box.querySelectorAll('.rd-mk-svg path')].map(p => p.getAttribute('d')).join('|');
            out.I_换个词就换歪法 = d4 !== d1;
        }

        document.querySelectorAll('.__mkt').forEach(n => n.remove());
        return out;
    });

    ok('A1 短词（≤4字）四种记号都可能出现', R.A_短词四种都可能);
    ok('A2 长词（≥5字）只在下划线/荧光里挑', R.A_长词只有线和荧光);
    ok('A3 四个字仍算短词', R.A_四字仍是短词);
    ok('A4 五个字就收窄', R.A_五字就收窄);
    ok('A5 随机是真的在分布（没退化成一种）', R.A_真的在随机, JSON.stringify(R.A_分布));
    ok('B1 同一个编号永远同一个记号', R.B_纯函数稳定);
    ok('B2 那个词确实被打上了记号', R.B_确实打上了, '记号=' + JSON.stringify(R.B_记号));
    ok('B3 重排（换字号/主题）后不变', R.B_重排不变);
    ok('B4 整章重建（重开一章）后不变', R.B_重建不变);
    ok('C1 跨行一律降级成下划线', R.C_纯函数跨行降级);
    ok('C2 前提：确实造出了跨行的词', R.C_确实跨行了);
    ok('C3 真跨行时拿到的是下划线', R.C_跨行是下划线);
    ok('D1 记号取代底色（背景色透明）', R.D_背景色透明);
    ok('D2 底色那圈柔光也去掉了', R.D_没有柔光);
    ok('D3 记号图挂上了', R.D_有记号图);
    ok('D4 只划线不写小注的：一切照旧', R.D_普通划线不受影响);
    ok('D5 删掉小注 → 记号撤掉、变回底色', R.D_删掉小注就撤记号);
    ok('E1 ⚠️左右 padding 必须为 0（否则整段正文位移）', R.E_左右零padding, '记号=' + R.E_记号种类);
    ok('E2 加了记号后行数没变', R.E_行数没变);
    ok('E3 每一行的位置一个像素都没动', R.E_行位置没变);
    ok('E4 段落没有变高', R.E_段落没变高);
    ok('E5 ⚠️四种记号逐个验：一种都不许动版面', R.E_四种都不动版面, JSON.stringify(R.E_逐种明细));
    ok('F1 默认开', R.F_默认是开的);
    ok('F2 关掉就撤记号', R.F_关掉就撤class);
    ok('F3 关掉回到原来的底色', R.F_关掉回到底色);
    ok('F4 再打开能补回来', R.F_再开能补回来);
    ok('F5 开关存进本机', R.F_存了本机);
    ok('G1 Rough.js 内联进来了', R.G_库在);
    ok('G2 记号画在自己那层 .rd-mk-svg 上', R.G_有记号层);
    ok('G3 真的画出线了', R.G_画了线);
    ok('G4 Rough 招牌：同一形状描了不止一遍', R.G_描了不止一遍, '子路径 ' + R.G_子路径数 + ' 段');
    ok('G5 路径是弯的（不是规规矩矩的直线段）', R.G_路径不是直的);
    ok('G6 ⚠️记号层没跟引线层混在一起', R.G_没混进引线层);
    ok('G7 引线仍是虚线', R.G_引线仍是虚的);
    ok('G8 记号没被引线那条虚线 CSS 套上', R.G_记号不是虚的);
    ok('J1 底下已有下划线时，池子里不再有 u', R.J_纯函数避开u);
    ok('J2 长词遇上已有下划线：只剩荧光', R.J_长词只剩荧光);
    ok('J3 跨行时也避开下划线', R.J_跨行时也避开);
    ok('J4 认得出「词在精句里且精句开了划线」', R.J_识别到了);
    ok('J5 真场景下拿到的不是下划线', R.J_真场景不是下划线);
    ok('J6 平时（没有别的下划线）u 照样在池子里', R.J_平时还有u);
    ok('K1 前提：造出了一个荧光记号', R.K_拿到荧光);
    ok('K2 日间用正片叠底（字不被蒙糊）', R.K_日间正片叠底, R.K_混合模式);
    ok('K3 夜间翻成滤色', R.K_夜间滤色, R.K_夜间混合模式);
    ok('I1 记号确实有路径', R.I_有路径);
    ok('I2 ⚠️重排后歪法一模一样（种子钉死了）', R.I_重排后一模一样);
    ok('I3 ⚠️重开一章后也一模一样', R.I_重建后一模一样);
    ok('I4 换个词就是另一副歪法', R.I_换个词就换歪法);
    ok('H1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 小注手绘记号：${bad}/${results.length} 条失败` : `\n✅ 小注手绘记号：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
