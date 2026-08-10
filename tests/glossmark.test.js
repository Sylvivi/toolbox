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

        /* ── A：选记号的规则表（纯函数直接问，不受随机影响）──
           表在 index.html 的 rdMkPick 上面，2026-08-10 用户连调三轮定的：
             底下有线 → 框/圈（跨行只给框）；没线时 ≤4 字 → 框/圈，≥5 字 → 下划线/框。
           三条道理：① 有线优先于一切字数规则；② 四字及以内不给下划线（像笔误）；
                     ③ 五字及以上不给圈（大扁椭圆），但下划线照给。 */
        {
            const many = (len, multi, noU) => {
                const s = new Set();
                for (let i = 0; i < 400; i++) s.add(rdMkPick('a' + i, len, multi, noU));
                return [...s].sort().join('');
            };
            out.A_短词 = many(2, false, false);          // 期望 bc
            out.A_四字 = many(4, false, false);          // 期望 bc
            out.A_五字 = many(5, false, false);          // 期望 bu
            out.A_长词 = many(9, false, false);          // 期望 bu
            out.A_短词不给下划线 = out.A_短词 === 'bc' && out.A_四字 === 'bc';
            out.A_长词不给圈但给下划线 = out.A_五字 === 'bu' && out.A_长词 === 'bu';
            out.A_有线时框或圈 = many(2, false, true) === 'bc' && many(9, false, true) === 'bc';
            out.A_有线且跨行只给框 = many(9, true, true) === 'b';
            out.A_跨行短词给框 = many(3, true, false) === 'b';
            out.A_跨行长词给下划线 = many(9, true, false) === 'u';
            out.A_没有荧光了 = !(out.A_短词 + out.A_五字).includes('h');
            // 别退化成「永远同一种」：随机确实在分布
            const dist = {};
            for (let i = 0; i < 600; i++) { const k = rdMkPick('seed' + i, 2, false, false); dist[k] = (dist[k] || 0) + 1; }
            out.A_分布 = dist;
            out.A_真的在随机 = Object.keys(dist).length === 2 && Object.values(dist).every(v => v > 200);
            out.A_分布够匀 = Object.values(dist).every(v => v > 600 / 2 * 0.75 && v < 600 / 2 * 1.25);
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
            /* ⚠️跨行时圈一定会裂成两个半圆，所以只可能是下划线或方框：
               长词给下划线（每行一条），短词给方框（每行一个，四字以内不给下划线）。 */
            out.C_跨行长词给下划线 = rdMkPick('anything', 9, true, false) === 'u';
            out.C_跨行短词给方框 = rdMkPick('anything', 3, true, false) === 'b';
            out.C_跨行绝不给圈 = (() => {
                for (let i = 0; i < 300; i++) {
                    for (const len of [1, 3, 6, 12]) if (rdMkPick('c' + i, len, true, false) === 'c') return false;
                }
                return true;
            })();
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
            /* ⚠️底下有线时**一律方框**（2026-08-10 用户定：「优先让波浪线跟下划线要分开，
               这个时候用方框可能更好一些的，就不看字数什么的了」）。 */
            out.J_有线就不给下划线 = (() => {
                for (const len of [1, 2, 4, 6, 12]) {
                    for (let i = 0; i < 60; i++) if (rdMkPick('j' + i, len, false, true) === 'u') return false;
                }
                return true;
            })();
            // 跨行 + 底下有线：仍是方框（每行画一个，不裂）
            out.J_跨行有线只给框 = rdMkPick('j', 6, true, true) === 'b' && rdMkPick('j2', 2, true, true) === 'b';
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
            /* ⚠️**波浪也算「字底下有线」**（2026-08-10 用户问的：「6个字，但是有波浪线的情况下，
               不应该再用下划线吧？」）。第一版漏了它——只按 text-decoration 那种下划线去想的。
               6 个字只剩下划线可用，波浪不算的话就会画一条压在波浪上。 */
            b.remove('reading-ks-ul'); b.add('reading-ks-wave');
            const wv = a.box.querySelector('mark[data-hlid="hj1"]');
            out.J_波浪也算 = rdMkHasUnderline(wv);
            out.J_六字遇波浪不给线 = rdMkPick('x', 6, false, rdMkHasUnderline(wv)) !== 'u';
            b.remove('reading-ks-wave');
            out.J_没开波浪就不算 = !rdMkHasUnderline(wv);
            out.J_真场景不是下划线 = kindOf(a.box.querySelector('mark[data-hlid="hj1"]')) !== 'u';
            if (!hadKs) b.remove('reading-ks-ul');
            // 没有那些下划线时，u 仍然要在池子里（别一刀切）
            // ⚠️用**长词**验：四字以内本来就不给下划线，拿 2 字来验会假红
            out.J_平时还有u = (() => { const s = new Set(); for (let i = 0; i < 400; i++) s.add(rdMkPick('j' + i, 6, false, false)); return s.has('u'); })();
        }

        /* ── K：荧光不许把字弄糊 ──
           用户 2026-08-10 报：「荧光笔似乎是盖在字体上的，像一层纱使它显得有点糊，
           我觉得你可以参考一下之前的那个色带，因为色带盖在上面没有影响字的本色」。
           记号这层画在正文**上面**，所以必须靠正片叠底（夜间滤色）保住字的本色。 */
        /* ⚠️荧光已被用户去掉，不再会被 rdMkPick 抽中；但**画法留着**（万一哪天加回来）。
           所以这里直接调 rdMkDraw 验它的混合模式还在——不然下次加回来又会把字蒙糊一遍。 */
        {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            document.body.appendChild(svg);
            const rc = rough.svg(svg);
            const rects = [{ left: 10, right: 60, top: 10, bottom: 30 }];
            const g = rdMkDraw(rc, rects, 'h', '#d9a400', 'rgba(255,207,46,0.55)', 7)[0];
            svg.appendChild(g);
            out.K_混合模式 = getComputedStyle(g).mixBlendMode;
            out.K_日间正片叠底 = out.K_混合模式 === 'multiply';
            const hadDark = document.body.classList.contains('dark');
            document.body.classList.add('dark');
            const g2 = rdMkDraw(rc, rects, 'h', '#ffcf2e', 'rgba(255,207,46,0.46)', 7)[0];
            svg.appendChild(g2);
            out.K_夜间混合模式 = getComputedStyle(g2).mixBlendMode;
            out.K_夜间滤色 = out.K_夜间混合模式 === 'screen';
            if (!hadDark) document.body.classList.remove('dark');
            svg.remove();
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

        /* ── L：压在「背景词」上的小注 → 退回色带 ──
           2026-08-10 用户提：「如果这个词作为背景词被渲染，并且又被标上了小注，哪怕是其中的个别字眼，
           可否此时小注也用色带？不然两个圈叠在一起不好看」。
           按**字符区间相交**判（不是矩形相交），所以「只沾到其中一个字」也算。 */
        {
            const bq = cp => '<blockquote data-cp="' + cp + '" data-ci="0" data-bg="1" '
                + 'style="margin:0.4em 0 0.6em;padding:0.5em 12px"><div class="reading-q">汐：背景：雾气氤氲</div>说明。</blockquote>';
            function mk1(word, withBq) {
                document.querySelectorAll('.__mkt').forEach(n => n.remove());
                const box = document.createElement('div');
                box.className = 'reading-merged';
                box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
                const t = P1.replace(word, '<mark class="rd-hl rd-hl-gold" data-hlid="hl9" data-gl="注文">' + word + '</mark>');
                box.innerHTML = '<p data-p="1">' + t + '</p>' + (withBq ? bq(1) : '');
                const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
                const msg = document.createElement('div');
                msg.className = 'chat-msg ai __mkt'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
                document.body.appendChild(msg);
                rdGlLayout(bub);
                const m = box.querySelector('mark.rd-hl');
                return { 有记号: m.classList.contains('rd-mk'),
                         有色带: getComputedStyle(m).backgroundColor !== 'rgba(0, 0, 0, 0)' };
            }
            // 背景词是「雾气氤氲」——小注整词压上去
            const whole = mk1('雾气氤氲', true);
            out.L_整词压上_退色带 = !whole.有记号 && whole.有色带;
            // 只注其中两个字（「氤氲」⊂「雾气氤氲」）也算压上
            const part = mk1('氤氲', true);
            out.L_只沾几个字_也退色带 = !part.有记号 && part.有色带;
            // 同一段但没碰到背景词的别处 → 照常画记号
            const away = mk1('青苔', true);
            out.L_没碰到的照常画 = away.有记号 && !away.有色带;
            // 段落里压根没有背景块 → 照常画记号（别误伤）
            const nobq = mk1('雾气氤氲', false);
            out.L_没背景块照常画 = nobq.有记号 && !nobq.有色带;
            // 背景词记号被关掉时不必避让（那边压根没画东西）
            document.body.classList.add('bg-mk-off');
            const off = mk1('雾气氤氲', true);
            out.L_关了记号就不避让 = off.有记号 && !off.有色带;
            document.body.classList.remove('bg-mk-off');
        }

        document.querySelectorAll('.__mkt').forEach(n => n.remove());
        return out;
    });

    ok('A1 ⚠️四字及以内不给下划线（只给框/圈）', R.A_短词不给下划线, '2字=' + R.A_短词 + ' 4字=' + R.A_四字);
    ok('A2 ⚠️五字及以上不给圈、但下划线照给', R.A_长词不给圈但给下划线, '5字=' + R.A_五字 + ' 9字=' + R.A_长词);
    ok('A3 ⚠️底下有线时：框或圈都行，不看字数', R.A_有线时框或圈);
    ok('A4 ⚠️底下有线且跨行：只给框（圈会裂）', R.A_有线且跨行只给框);
    ok('A5 跨行短词给框、跨行长词给下划线', R.A_跨行短词给框 && R.A_跨行长词给下划线);
    ok('A6 荧光已去掉，不再出现', R.A_没有荧光了);
    ok('A7 随机是真的在分布', R.A_真的在随机, JSON.stringify(R.A_分布));
    ok('A8 ⚠️分布够匀（rdMkSeed 那步雪崩混合别删）', R.A_分布够匀, JSON.stringify(R.A_分布));
    ok('B1 同一个编号永远同一个记号', R.B_纯函数稳定);
    ok('B2 那个词确实被打上了记号', R.B_确实打上了, '记号=' + JSON.stringify(R.B_记号));
    ok('B3 重排（换字号/主题）后不变', R.B_重排不变);
    ok('B4 整章重建（重开一章）后不变', R.B_重建不变);
    ok('C1a 跨行长词 → 下划线（每行一条）', R.C_跨行长词给下划线);
    ok('C1b 跨行短词 → 方框（每行一个）', R.C_跨行短词给方框);
    ok('C1c ⚠️跨行绝不给圈（会裂成两个半圆）', R.C_跨行绝不给圈);
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
    ok('J1 ⚠️底下有线时不给下划线（1/2/4/6/12 字都验过）', R.J_有线就不给下划线);
    ok('J2 跨行 + 底下有线 → 只给方框（每行一个，不裂）', R.J_跨行有线只给框);
    ok('J3 跨行时也避开下划线', R.J_跨行时也避开);
    ok('J4 认得出「词在精句里且精句开了划线」', R.J_识别到了);
    ok('J5 真场景下拿到的不是下划线', R.J_真场景不是下划线);
    ok('J6 没有线时，五字以上的词照样抽得到下划线', R.J_平时还有u);
    ok('J7 ⚠️波浪也算「字底下有线」', R.J_波浪也算);
    ok('J8 ⚠️6 个字 + 波浪 → 框或圈，不再压一条下划线上去', R.J_六字遇波浪不给线);
    ok('J9 没开波浪时不误判', R.J_没开波浪就不算);
    ok('K2 荧光的画法还在，且日间是正片叠底（字不被蒙糊）', R.K_日间正片叠底, R.K_混合模式);
    ok('K3 夜间翻成滤色', R.K_夜间滤色, R.K_夜间混合模式);
    ok('I1 记号确实有路径', R.I_有路径);
    ok('I2 ⚠️重排后歪法一模一样（种子钉死了）', R.I_重排后一模一样);
    ok('I3 ⚠️重开一章后也一模一样', R.I_重建后一模一样);
    ok('I4 换个词就是另一副歪法', R.I_换个词就换歪法);
    ok('L1 ⚠️小注整词压在背景词上 → 退回色带', R.L_整词压上_退色带);
    ok('L2 ⚠️只沾到其中几个字 → 也退回色带', R.L_只沾几个字_也退色带);
    ok('L3 同段落里没碰到背景词的 → 照常画记号', R.L_没碰到的照常画);
    ok('L4 段落没有背景块 → 照常画记号（别误伤）', R.L_没背景块照常画);
    ok('L5 背景词记号关掉时不必避让', R.L_关了记号就不避让);
    ok('H1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 小注手绘记号：${bad}/${results.length} 条失败` : `\n✅ 小注手绘记号：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
