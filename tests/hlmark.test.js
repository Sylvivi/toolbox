/* 普通划线的「手绘记号」回归测试（2026-08-13 做）。
 *
 * 功能：选中文字划的线，不再显示死板的色带／text-decoration 下划线，改画 Rough.js 手绘记号。
 * 用户原话：「我看之前的那个样式很不爽了，线很死板，色带也不好看，我希望可以把
 *   rough notation 里的划线和画框应用过去」，随后定死范围：「只选两种，划线和画框」＋「长短不论哈」，
 *   以及「划线的颜色以及是下划线还是画框是随机的，我再次点击的时候可以自己选，就跟小注那边差不多」。
 *
 * 这个文件钉住的是**跟她逐条谈定的那几条**，改回去会立刻毁掉观感：
 *  A 组 普通划线（没写小注的）也要拿到记号，且底色被撤掉
 *  B 组 ⚠️只有 u/b 两种。**绝不许出现 c（圈）/ h（荧光）**——她只要「划线和画框」
 *  C 组 ⚠️长短不论。长句、跨行照样给记号，且长的也可能是方框（别按字数分档，那是小注那套）
 *  D 组 钉死：同一条划线反复重排永远同一种（每次打开都换＝页面在抽风）
 *  E 组 她手选过的（hl.mk）优先于随机，且「底下已有线」也让位给手选
 *  F 组 ⚠️小注的词仍走**老池子**（u/b/c），两套规则别合并——小注那套是 2026-08-10 连调四轮定的
 *  G 组 ⚠️零新增图层：记号一律画在小注那张 .rd-mk-svg 上。为划线另开一层＝重蹈引号手绘线覆辙
 *  H 组 ⚠️不许推开正文：mark 是行内元素，横向 padding 会让整段位移（同 glossmark E 组）
 *
 * 跑法：node tests/hlmark.test.js   或   bash tests/p.sh hlmark
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
        const P2 = '他做什么都踟蹰，像总在门槛上迈不出去，想下山又怕山下的人问起从前那桩事，只好又坐回炉边。';

        /* 造一段带划线的正文，然后调真正的 rdGlLayout。
           marks: [{para, word, id, note?, color?}]，带 note 的＝小注（data-gl），不带的＝普通划线。
           hlRows: 喂给 readingGetConvHl 的划线表（测 hl.mk 手选用）。 */
        function build(marks, hlRows) {
            document.querySelectorAll('.__hlt').forEach(n => n.remove());
            // ⚠️覆盖划线表：rdGlLayout 靠它读 hl.mk。不覆盖的话真实表是空的，测不到手选那条路。
            window.readingGetConvHl = () => (hlRows || marks.map(m => ({ id: m.id, mk: m.mk })));
            const texts = { 1: P1, 2: P2 };
            const html = [1, 2].map(n => {
                let t = texts[n];
                marks.filter(m => m.para === n).forEach(m => {
                    t = t.replace(m.word, '<mark class="rd-hl rd-hl-' + (m.color || 'sky')
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
            msg.className = 'chat-msg ai __hlt'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            document.documentElement.style.setProperty('--reading-pspace', '28px');
            box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
            rdGlLayout(bub);
            return { box, bub };
        }
        const kindOf = el => (String(el.className).match(/rd-mk-([ubch])\b/) || [0, null])[1];
        const markOf = (box, id) => box.querySelector('mark[data-hlid="' + id + '"]');

        /* ── A：普通划线也要有记号，底色要撤掉 ── */
        {
            const { box } = build([{ para: 1, word: '青苔', id: 'a1' }]);
            const m = markOf(box, 'a1');
            out.A_hasMk = !!(m && m.classList.contains('rd-mk'));
            out.A_kind = m ? kindOf(m) : null;
            const cs = m ? getComputedStyle(m) : null;
            // 「取代底色，不叠」——她定的
            out.A_noBg = !!cs && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent');
            out.A_noDeco = !!cs && cs.textDecorationLine === 'none';
            // 记号画在 SVG 上，不是行内背景图
            out.A_svgDrawn = box.querySelectorAll('.rd-mk-svg path').length > 0;
        }

        /* ── B：⚠️只有 u/b。跑一批 id，看池子里到底出现过哪几种 ── */
        {
            const seen = {};
            for (let i = 0; i < 60; i++) {
                const k = rdHlMkKind({ id: 'seed-' + i }, null);
                seen[k] = (seen[k] || 0) + 1;
            }
            out.B_kinds = Object.keys(seen).sort().join(',');
            out.B_noCircle = !seen.c && !seen.h;
            // 两种都得出现，别退化成恒定一种
            out.B_bothUsed = !!seen.u && !!seen.b;
        }

        /* ── C：⚠️长短不论。长句/跨行照样给记号，且长句也能抽到方框 ── */
        {
            const longWord = '想下山又怕山下的人问起从前那桩事';   // 16 字，必然跨行
            const { box } = build([{ para: 2, word: longWord, id: 'c1' }]);
            const m = markOf(box, 'c1');
            out.C_longHasMk = !!(m && m.classList.contains('rd-mk'));
            out.C_longKind = m ? kindOf(m) : null;
            // 跨行时每行各画一次（rdMkDraw 的老规矩），所以路径数应 > 1 段行数对应的量
            out.C_longRects = m ? m.getClientRects().length : 0;
            // 长句能不能抽到方框：直接问纯函数，不受这一条 id 的运气影响
            let longB = 0;
            for (let i = 0; i < 40; i++) if (rdHlMkKind({ id: 'long-' + i }, null) === 'b') longB++;
            out.C_longCanBox = longB > 0;
        }

        /* ── D：钉死。同一条划线重排三次，记号不许变 ── */
        {
            const seq = [];
            for (let i = 0; i < 3; i++) {
                const { box } = build([{ para: 1, word: '氤氲', id: 'd1' }]);
                seq.push(kindOf(markOf(box, 'd1')));
            }
            out.D_stable = seq[0] === seq[1] && seq[1] === seq[2] && !!seq[0];
            out.D_seq = seq.join(',');
        }

        /* ── E：她手选过的优先 ── */
        {
            // 找一个「随机会给 u」的 id，然后手选 b，看是否听话
            let idU = null;
            for (let i = 0; i < 80 && !idU; i++) if (rdHlMkKind({ id: 'e-' + i }, null) === 'u') idU = 'e-' + i;
            out.E_pickedWins = rdHlMkKind({ id: idU, mk: 'b' }, null) === 'b';
            // 反向也要成立
            let idB = null;
            for (let i = 0; i < 80 && !idB; i++) if (rdHlMkKind({ id: 'e-' + i }, null) === 'b') idB = 'e-' + i;
            out.E_pickedWins2 = rdHlMkKind({ id: idB, mk: 'u' }, null) === 'u';
            // 走完整条路：hl.mk 从划线表里读出来并生效
            const { box } = build([{ para: 1, word: '青苔', id: 'e9', mk: 'b' }], [{ id: 'e9', mk: 'b' }]);
            out.E_endToEnd = kindOf(markOf(box, 'e9')) === 'b';
        }

        /* ── F：⚠️小注的词仍走老池子（u/b/c），别跟划线那套合并 ── */
        {
            const seen = {};
            // 小注那套按字数分档：≤4 字只给框/圈，所以两字词跑一批应该出现 c
            for (let i = 0; i < 60; i++) seen[rdMkPick('g-' + i, 2, false)] = 1;
            out.F_glossKeepsCircle = !!seen.c;
            out.F_glossNoU_short = !seen.u;   // ≤4 字不给下划线（短词底下一条短线像笔误）
        }

        /* ── G：⚠️零新增图层。记号必须画在小注那张 .rd-mk-svg 上 ── */
        {
            const { box } = build([
                { para: 1, word: '青苔', id: 'g1' },
                { para: 1, word: '氤氲', id: 'g2', note: 'yīn yūn·雾气弥漫' }
            ]);
            out.G_layers = box.querySelectorAll('.rd-mk-svg').length;      // 该只有 1 张
            out.G_noExtraLayer = box.querySelectorAll('.hl-mk-layer, .hl-mk-svg').length === 0;
            out.G_bothDrawn = box.querySelectorAll('.rd-mk-svg path').length >= 2;
        }

        /* ── I：⚠️长下划线的笔触 ──
           2026-08-13 用户报「划长句感觉下划线有点雷同」，实测证实：Rough.js 的 line 只在
           两端和中点抖，且偏移是绝对值 → 28px 的线抖动占 14.7%，330px 只剩 1.6% ＝ 看着是直线。
           解法：沿线每 ~55px 打一个点。⚠️但**必须一笔连续**——她当场追问「线还是连着的对吗，
           不会拆成一段一段的吧」，而 linearPath 版正是每段各一条独立线、接头错位像断线。 */
        {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            document.body.appendChild(svg);
            const rc = rough.svg(svg);
            const probe = (len) => {
                const els = rdMkDraw(rc, [{ left: 0, right: len, top: 0, bottom: 14 }], 'u', '#000', '#000', 1234, 1.5);
                const d = els[0].querySelector('path').getAttribute('d');
                const ys = (d.match(/-?\d+\.?\d*/g) || []).map(Number).filter((_, i) => i % 2 === 1);
                return { pts: ys.length, moves: (d.match(/M/g) || []).length };
            };
            const short = probe(28), long = probe(330);
            out.I_长线抖点更多 = long.pts > short.pts;
            /* ⚠️⚠️**这条是「不许拆成一段一段」的护栏**：Rough 手绘感靠的是同一笔描两遍，
               所以一条下划线最多 2 个 M。多段 linearPath 会是 12 个 → 当场红。 */
            out.I_长线一笔到底 = long.moves <= 2;
            out.I_短线也一笔到底 = short.moves <= 2;
            out.I_detail = JSON.stringify({ short, long });
            svg.remove();
        }

        /* ── H：⚠️不许推开正文（同 glossmark E 组）。加了记号前后，段落宽高必须一模一样 ── */
        {
            const { box } = build([]);
            const p = box.querySelector('p[data-p="1"]');
            const before = { w: p.getBoundingClientRect().width, h: p.getBoundingClientRect().height };
            const { box: box2 } = build([{ para: 1, word: '青苔', id: 'h1' }]);
            const p2 = box2.querySelector('p[data-p="1"]');
            const after = { w: p2.getBoundingClientRect().width, h: p2.getBoundingClientRect().height };
            out.H_sameW = Math.abs(before.w - after.w) < 0.5;
            out.H_sameH = Math.abs(before.h - after.h) < 0.5;
            out.H_detail = JSON.stringify({ before, after });
        }

        document.querySelectorAll('.__hlt').forEach(n => n.remove());
        return out;
    });

    ok('A1 普通划线拿到 rd-mk', R.A_hasMk);
    ok('A2 记号种类是 u 或 b', R.A_kind === 'u' || R.A_kind === 'b', '实际 ' + R.A_kind);
    ok('A3 底色被撤掉（取代不叠）', R.A_noBg);
    ok('A4 老的 text-decoration 被盖掉', R.A_noDeco);
    ok('A5 记号画在 SVG 上', R.A_svgDrawn);

    ok('B1 ⚠️池子里只有 u/b，没有圈和荧光', R.B_noCircle, '出现过：' + R.B_kinds);
    ok('B2 两种都在用，没退化成一种', R.B_bothUsed, '出现过：' + R.B_kinds);

    ok('C1 ⚠️长句（跨行）照样给记号', R.C_longHasMk);
    ok('C2 长句的记号也是 u/b', R.C_longKind === 'u' || R.C_longKind === 'b', '实际 ' + R.C_longKind);
    ok('C3 ⚠️长短不论：长句也能抽到方框', R.C_longCanBox);
    ok('C4 长句确实跨了行', R.C_longRects > 1, '行片段 ' + R.C_longRects);

    ok('D1 同一条划线反复重排不变形', R.D_stable, R.D_seq);

    ok('E1 手选 b 压过随机的 u', R.E_pickedWins);
    ok('E2 手选 u 压过随机的 b', R.E_pickedWins2);
    ok('E3 hl.mk 从划线表读出来能生效', R.E_endToEnd);

    ok('F1 ⚠️小注仍保留圈（两套规则没被合并）', R.F_glossKeepsCircle);
    ok('F2 ⚠️小注短词仍不给下划线', R.F_glossNoU_short);

    ok('G1 ⚠️只有一张记号层', R.G_layers === 1, '实际 ' + R.G_layers + ' 张');
    ok('G2 ⚠️没有为划线另开图层', R.G_noExtraLayer);
    ok('G3 小注和划线的记号都画上了', R.G_bothDrawn);

    ok('I1 长下划线的抖动点随长度变多', R.I_长线抖点更多, R.I_detail);
    ok('I2 ⚠️长线一笔到底，没拆成一段一段', R.I_长线一笔到底, R.I_detail);
    ok('I3 短线也是一笔到底', R.I_短线也一笔到底, R.I_detail);

    ok('H1 ⚠️没有撑宽段落', R.H_sameW, R.H_detail);
    ok('H2 ⚠️没有撑高段落（翻页对齐靠它）', R.H_sameH, R.H_detail);

    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')));
    console.log('\n' + (results.length - bad.length) + '/' + results.length + ' 通过');
    process.exit(bad.length ? 1 : 0);
})();
