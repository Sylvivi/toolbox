/* 引线交叉：跨行的词「排队用错了那一头的锚点」（2026-08-11 加）。
 *
 * 用户截图（红箭头标了两条）：「线条形成了交叉，不是说不能交叉，但是为什么本身在左边的词，
 * 小注会放到右边，而在右边的词，小注会在左边呢」。
 *
 * 根因：摆位是「按排队顺序从左往右占位」，排队键取的是**目标字的位置**——可这个位置
 *   **跨行的词有两个**：往上锚第一行片段、往下锚最后一行片段，两头差着整整一行宽
 *   （「兹邑」的兹在行末 x≈343、邑在下一行开头 x≈0）。
 *   老代码排队键写的是 `nearUp ? tx : txDown`，`nearUp` 只是"哪边更近"；
 *   而**真正会用哪边是 `prefUp`**——上面那条「一边会压字就走另一边」的规则会把方向翻过来
 *   （段落后面紧跟一个背景块、块的首行又占满整行时必然发生，这在她的书里天天见）。
 *   于是：实际摆到上面(锚 343)、排队却按下面那头(锚 0)当最左边先摆 →
 *   标签在最左、字在最右；隔壁那条正好相反 → 两条线叉在一起。
 *
 * ⚠️别跟 2026-08-04 那次「缟素舍近求远」搞混：那次修的是 `wantUp/wantDown`（**摆在哪儿**），
 *   这次是**排队顺序**，两码事，所以那次的测试(V 组)一条都不会红。
 *
 * 还有一条兜底（`_fixCrossing`）：首选缝满了退到另一条缝时，排队序仍是按首选那侧算的，
 * 可能插错位置 —— 所以最后再按锚点校一遍同一行的左右顺序，乱了就就地重排。
 *
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/glosscross.test.js
 *   或  bash tests/p.sh glosscross
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
        /* 正文用定长填充串拼，好让换行位置可预测：14px 下一行 25 字、段落首行缩进 2 字。
           P1 排五行：跨行词「兹邑」骑在第 4 行末 + 第 5 行头，「颠越」在第 5 行靠左。
           P1 后面紧跟一个**标题行占满整行**的背景块 → 往下必然压字 → 两条小注都被推到上面那条缝。 */
        const filler = '春山如笑水如蓝日暮乡关何处是烟波江上使人愁'.repeat(20);
        const put = (len, list) => {
            let s = filler.slice(0, len);
            list.slice().sort((a, b) => b.i - a.i).forEach(m => { s = s.slice(0, m.i) + m.word + s.slice(m.i + m.word.length); });
            return s;
        };
        const L = 25, H = 23;
        const P0 = put(H, []);
        const P1 = put(H + L * 4 + 10, [
            { i: H + L * 3 + 24, word: '兹邑' },     // 第 4 行末字 + 第 5 行首字 → 跨行
            { i: H + L * 4 + 4, word: '颠越' },      // 第 5 行靠左
        ]);
        const BG = '<blockquote data-cp="2" data-bg="1" data-fold="1" style="margin:0.4em 0 0.6em;padding:0.5em 12px 0.4em">'
                 + '<div class="reading-q">汐：背景：这是一条很长很长的标题让它正好占满整整一行不给小注留任何横向的空地</div>'
                 + '<div>块里的正文。</div></blockquote>';

        function build() {
            document.querySelectorAll('.__gx').forEach(n => n.remove());
            const texts = [P0, P1];
            const marks = [
                { p: 2, w: '颠越', n: 'diān yuè·有人颠覆秩序心怀不敬', c: 'sky' },
                { p: 2, w: '兹邑', n: 'zī yì·在这块土地上蔓延繁衍', c: 'orange' },
            ];
            const html = texts.map((t, i) => {
                marks.filter(m => m.p === i + 1).forEach(m => {
                    t = t.replace(m.w, '<mark class="rd-hl rd-hl-' + m.c + '" data-hlid="h' + m.w + '" data-gl="' + m.n + '">' + m.w + '</mark>');
                });
                return '<p data-p="' + (i + 1) + '">' + t + '</p>';
            }).join('') + BG;
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __gx'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            document.documentElement.style.setProperty('--reading-pspace', '28px');
            box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
            rdGlLayout(bub);
            return box;
        }

        const box = build();
        const cr = box.getBoundingClientRect();
        // 引线：`M 字端 Q … 标签端`（箭头指小注，所以起点是字、终点是标签）
        const segs = [...box.querySelectorAll('.rd-gl-svg path:not(.rd-gl-arrow)')].map(p => {
            const m = p.getAttribute('d').match(/^M([-\d.]+) ([-\d.]+) Q[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)/);
            return { id: p.getAttribute('data-glid'), x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
        });
        out.前提_两条都有引线 = segs.length === 2;
        const a = segs.find(s => s.id === 'h兹邑'), b = segs.find(s => s.id === 'h颠越');
        /* 「兹邑」是**跨行**的词，规则是：标签往上摆就锚第一行片段(行末、靠右)，
           往下摆就锚最后一行片段(行首、靠左)。
           ⚠️2026-08-12 改成钉这条**规则**，别再写死「兹邑一定锚在右边」——
             那是把当时的选边结论当成了前提。选边（prefUp）会随排版改动而变，
             这次「每条缝各判各的放平」就把它翻成了朝下，前提当场假红，
             而真正要守的四条（顺序一致/不交叉/不重叠/没出界）全是好的。 */
        const _lab兹邑 = box.querySelector('.rd-gl-label[data-glid="h兹邑"]');
        const _dir = _lab兹邑 ? _lab兹邑.getAttribute('data-gl-dir') : null;
        const _frags = [...box.querySelectorAll('mark[data-hlid="h兹邑"]')]
            .flatMap(m => [...m.getClientRects()]).filter(r => r.width > 1);
        const _mid = r => r.left + r.width / 2 - cr.left;
        const _want = _frags.length ? _mid(_dir === 'up' ? _frags[0] : _frags[_frags.length - 1]) : null;
        out.前提_跨行锚点跟方向一致 = !!a && _want !== null && Math.abs(a.x1 - _want) < 6;
        out.前提_明细 = '方向=' + _dir + ' 片段数=' + _frags.length
            + ' 锚x=' + (a ? Math.round(a.x1) : '-') + ' 应为' + (_want === null ? '-' : Math.round(_want));
        out.前提_两条同一行 = !!a && !!b && Math.abs(a.y2 - b.y2) < 6;
        // 核心：字在左边的，标签也该在左边
        out.顺序一致 = !!a && !!b && ((a.x1 - b.x1) > 0) === ((a.x2 - b.x2) > 0);
        // 线段真的没交叉（几何判定，跟顺序那条互为印证）
        const sd = (P, Q, Rr) => Math.sign((Q.x - P.x) * (Rr.y - P.y) - (Q.y - P.y) * (Rr.x - P.x));
        const cross = (p, q) => {
            const A = { x: p.x1, y: p.y1 }, B = { x: p.x2, y: p.y2 }, C = { x: q.x1, y: q.y1 }, D = { x: q.x2, y: q.y2 };
            return sd(A, B, C) !== sd(A, B, D) && sd(C, D, A) !== sd(C, D, B);
        };
        out.没交叉 = !!a && !!b && !cross(a, b);
        out.明细 = segs.map(s => s.id + ' 字x' + Math.round(s.x1) + '→标签x' + Math.round(s.x2));

        // 两条标签本身也不许叠在一起（重排兜底不能把它们摞了）
        const labs = [...box.querySelectorAll('.rd-gl-label')].map(l => l.getBoundingClientRect());
        out.标签不重叠 = labs.length === 2
            && (labs[0].right <= labs[1].left + 0.5 || labs[1].right <= labs[0].left + 0.5);
        // 也不许被挤出段落
        const pR = box.querySelector('p[data-p="2"]').getBoundingClientRect();
        out.没出边界 = labs.every(r => r.left >= pR.left - 6 && r.right <= pR.right + 6);

        // 排队键必须跟着 prefUp 走（写回 nearUp 会直接复发）
        out.排队键跟prefUp = rdGlLayout.toString().indexOf('want: (prefUp ? tx : txDown)') > 0;
        out.有兜底重排 = rdGlLayout.toString().indexOf('_fixCrossing') > 0;

        document.querySelectorAll('.__gx').forEach(n => n.remove());
        return out;
    });

    ok('前提：两条小注都排出来了、落在同一行', R.前提_两条都有引线 && R.前提_两条同一行);
    ok('前提：跨行的词，锚点跟它标签的方向一致', R.前提_跨行锚点跟方向一致, R.前提_明细);
    ok('⚠️字在左的标签也在左（左右顺序一致）', R.顺序一致, JSON.stringify(R.明细));
    ok('⚠️两条引线不交叉', R.没交叉);
    ok('两条标签不重叠', R.标签不重叠);
    ok('标签没被挤出段落', R.没出边界);
    ok('排队键跟着 prefUp 走（写回 nearUp 会当场复发）', R.排队键跟prefUp);
    ok('留了「顺序乱了就就地重排」的兜底', R.有兜底重排);
    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
