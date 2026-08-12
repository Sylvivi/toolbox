/* 小注摆放「大样本自查」（2026-08-11 加）。
 *
 * 这块反复修了七八轮（遮挡、交叉、舍近求远、并排、折行、压字…），每次都是**用户在手机上
 * 花额度发现的**。所以补这个：**用固定种子随机造 400 页**（段落数/行长/词的位置/注文长短/
 * 段间距/字号/容器宽/有没有背景块全随机），逐页验不变量。种子固定 ⇒ 每次跑的是同一批页面，
 * 数字可以直接对比。
 *
 * 硬断言（这几条一条都不许破）：
 *   A 引线的「字那头」必须真落在那个词的行片段上（箭头指错＝功能坏了）。
 *   B 标签不许跑出正文容器。
 *   C 一条小注都不许丢（有 data-gl 就得有标签）。
 *   D 排版不许抛异常。
 * 阈值断言（允许少量、但不许变差 —— 数字是 2026-08-11 的基线）：
 *   E 两条标签互相压：≤ 3%
 *   F 引线交叉：≤ 1.5%
 *   G 段间距 28（用户的实际设置）下，**一行**的小注压到正文：≤ 10%
 *
 * ⚠️剩下的压字/重叠**几乎全部来自同一个机制**：`_gl_try` 第 ③ 步「两条缝都满了 → 另起一行」。
 *   另起的那行按设计就是往隔壁的字上叠（rowOff）。查的时候直接按标签上的
 *   `data-gl-row="1"` 把它们挑出来，别再一条条猜。
 * ⚠️两行的小注压字率高（28px 下约 38%）是**几何死限、不是 bug**：两行连外框要 41px，
 *   而段间距滑块最大只有 28px（见 docs/阅读排版与小注.md），用户 2026-08-06 明确接受过。
 *
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/glossaudit.test.js
 *   或  bash tests/p.sh glossaudit        （比别的用例慢，约 20 秒）
 */

const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const N = 400;   // ⚠️别调小：小样本下 E/F 那几个千分之几的问题根本抽不到

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 200)));
    await page.goto(APP); await page.waitForTimeout(6000);

    const R = await page.evaluate((N) => {
        const rnd = s => () => (s = (s * 1664525 + 1013904223) >>> 0, s / 4294967296);
        const filler = '春山如笑水如蓝日暮乡关何处是烟波江上使人愁天涯芳草无归路'.repeat(60);
        const WORDS = ['颠越', '兹邑', '盘庚', '俾', '石田', '酷吏', '郅都', '宗室', '缟素', '撮'];
        const bad = [];   // 每条 = {seed, 类型, 明细}
        const 压字按段间距 = {}, 总数按段间距 = {};
        const 压字_单行 = {}, 总数_单行 = {}, 压字_两行 = {}, 总数_两行 = {};
        const 重叠按段间距 = {}, 乱序按段间距 = {}, 交叉按段间距 = {};
        const stat = { 页: 0, 小注: 0, 压字: 0, 交叉: 0, 出界: 0, 重叠: 0, 乱序: 0, 指错: 0, 丢条: 0 };

        for (let t = 0; t < N; t++) {
            const seed = 1000 + t;
            const R = rnd(seed);
            const pick = a => a[Math.floor(R() * a.length)];
            const int = (a, b) => a + Math.floor(R() * (b - a + 1));

            document.querySelectorAll('.__fz').forEach(n => n.remove());
            const fs = pick([13, 14, 15, 16, 17]);
            const width = int(300, 400);
            const pspace = pick([2, 6, 8, 14, 20, 28]);
            const nPara = int(2, 5);
            const wantNotes = [];
            let html = '';
            for (let p = 0; p < nPara; p++) {
                let len = int(20, 160);
                let txt = filler.slice(0, len);
                // 这一段里塞 0~2 个词
                const k = int(0, 2);
                const used = [];
                for (let m = 0; m < k; m++) {
                    const w = pick(WORDS);
                    if (used.indexOf(w) >= 0) continue;
                    used.push(w);
                    const at = int(0, Math.max(0, len - w.length - 1));
                    txt = txt.slice(0, at) + w + txt.slice(at + w.length);
                }
                let ph = txt;
                used.forEach((w, i) => {
                    const id = 'f' + t + '_' + p + '_' + i;
                    const note = 'pīn yīn·' + filler.slice(0, int(2, 22));
                    ph = ph.replace(w, '<mark class="rd-hl rd-hl-' + pick(['sky', 'rose', 'green', 'orange', 'purple'])
                        + '" data-hlid="' + id + '" data-gl="' + note + '">' + w + '</mark>');
                    wantNotes.push(id);
                });
                html += '<p data-p="' + (p + 1) + '">' + ph + '</p>';
                // 随机插背景块（标题长短也随机 —— 短的右边有空地可躲，长的躲不掉）
                if (R() < 0.4) {
                    const title = filler.slice(0, int(4, 26));
                    html += '<blockquote data-cp="' + (p + 1) + '" data-bg="1" data-fold="1"'
                        + ' style="margin:0.4em 0 0.6em;padding:0.5em 12px 0.4em">'
                        + '<div class="reading-q">汐：背景：' + title + '</div><div>' + filler.slice(0, 40) + '</div></blockquote>';
                }
            }
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:' + fs + 'px;line-height:1.6;width:' + width + 'px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __fz'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            document.documentElement.style.setProperty('--reading-pspace', pspace + 'px');
            box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = pspace + 'px'; });
            try { rdGlLayout(bub); } catch (e) { bad.push({ seed, 类型: '抛异常', 明细: e.message }); continue; }

            stat.页++;
            const cr = box.getBoundingClientRect();
            const labs = [...box.querySelectorAll('.rd-gl-label')];
            stat.小注 += labs.length;
            const realNotes = box.querySelectorAll('mark.rd-hl[data-gl]').length;
            if (labs.length !== realNotes) {
                stat.丢条++;
                bad.push({ seed, 类型: '丢条', 明细: labs.length + '/' + realNotes, pspace, fs, width });
            }
            const info = labs.map(l => {
                const id = l.getAttribute('data-glid');
                const r = l.getBoundingClientRect();
                const curve = box.querySelector('.rd-gl-svg path[data-glid="' + id + '"]:not(.rd-gl-arrow)');
                const m = curve && curve.getAttribute('d').match(/^M([-\d.]+) ([-\d.]+) Q[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)/);
                const svgR = curve ? curve.ownerSVGElement.getBoundingClientRect() : null;
                return {
                    id: id,
                    L: r.left - cr.left, Rt: r.right - cr.left, T: r.top - cr.top, B: r.bottom - cr.top,
                    ax: m ? svgR.left + (+m[1]) - cr.left : null,     // 字那头
                    ay: m ? svgR.top + (+m[2]) - cr.top : null,
                    bx: m ? svgR.left + (+m[3]) - cr.left : null,     // 标签那头
                    by: m ? svgR.top + (+m[4]) - cr.top : null,
                    mk: box.querySelector('mark[data-hlid="' + id + '"]'),
                    gap: l.getAttribute('data-gl-gap'), dir: l.getAttribute('data-gl-dir'), row: l.getAttribute('data-gl-row'),
                };
            });

            // ① 引线的「字那头」必须真落在那个词的某个行片段上
            info.forEach(o => {
                if (o.ax == null || !o.mk) return;
                const ok = [...o.mk.getClientRects()].some(q =>
                    o.ax >= q.left - cr.left - 3 && o.ax <= q.right - cr.left + 3);
                if (!ok) { stat.指错++; bad.push({ seed, 类型: '箭头没指到那个词', 明细: o.id }); }
            });
            // ② 标签之间不许重叠
            for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
                const a = info[i], b = info[j];
                if (a.L < b.Rt && b.L < a.Rt && a.T < b.B && b.T < a.B) {
                    stat.重叠++; 重叠按段间距[pspace] = (重叠按段间距[pspace] || 0) + 1;
                    bad.push({ seed, 类型: '两条标签叠在一起', pspace, fs,
                        分支: a.dir + '/row' + a.row + ' × ' + b.dir + '/row' + b.row,
                        同缝: a.gap === b.gap, 明细: a.id + '(y' + Math.round(a.T) + '~' + Math.round(a.B) + ' x' + Math.round(a.L) + '~' + Math.round(a.Rt) + ') × '
                            + b.id + '(y' + Math.round(b.T) + '~' + Math.round(b.B) + ' x' + Math.round(b.L) + '~' + Math.round(b.Rt) + ')' });
                }
            }
            // ③ 同一行（竖直重叠）的两条：标签左右顺序必须跟锚点一致
            for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
                const a = info[i], b = info[j];
                if (a.ax == null || b.ax == null) continue;
                if (!(a.T < b.B && b.T < a.B)) continue;          // 不在同一行，不比
                if (Math.abs(a.ax - b.ax) < 2) continue;
                if ((a.ax - b.ax > 0) !== (a.L - b.L > 0)) {
                    stat.乱序++; 乱序按段间距[pspace] = (乱序按段间距[pspace] || 0) + 1;
                    bad.push({ seed, 类型: '同一行里左右顺序反了', pspace, fs, 明细: a.id + '(字' + Math.round(a.ax) + '→标签' + Math.round(a.L) + ') ' + b.id + '(字' + Math.round(b.ax) + '→标签' + Math.round(b.L) + ')' });
                }
            }
            // ④ 引线两两不交叉（把曲线当线段近似）
            const sd = (P, Q, Z) => Math.sign((Q.x - P.x) * (Z.y - P.y) - (Q.y - P.y) * (Z.x - P.x));
            for (let i = 0; i < info.length; i++) for (let j = i + 1; j < info.length; j++) {
                const a = info[i], b = info[j];
                if (a.ax == null || b.ax == null) continue;
                const A = { x: a.ax, y: a.ay }, B2 = { x: a.bx, y: a.by }, C = { x: b.ax, y: b.ay }, D = { x: b.bx, y: b.by };
                if (sd(A, B2, C) !== sd(A, B2, D) && sd(C, D, A) !== sd(C, D, B2)) {
                    stat.交叉++; 交叉按段间距[pspace] = (交叉按段间距[pspace] || 0) + 1;
                    bad.push({ seed, 类型: '两条引线交叉', pspace, fs,
                        分支: a.dir + '/row' + a.row + '/gap' + a.gap + ' × ' + b.dir + '/row' + b.row + '/gap' + b.gap,
                        明细: a.id + ' × ' + b.id });
                }
            }
            // ⑤ 标签不许跑出正文容器（旋转外框留 8px 余量）
            info.forEach(o => {
                if (o.L < -8 || o.Rt > cr.width + 8) {
                    stat.出界++; bad.push({ seed, 类型: '标签跑出容器', 明细: o.id + ' ' + Math.round(o.L) + '~' + Math.round(o.Rt) + '（容器 ' + Math.round(cr.width) + '）' });
                }
            });
            // ⑥ 压到正文的字（只统计，不算错——几何死限时允许）
            const rects = [];
            box.querySelectorAll('p[data-p]').forEach(p => {
                const rg = document.createRange(); rg.selectNodeContents(p);
                [...rg.getClientRects()].forEach(q => { if (q.width > 1 && q.height > 1) rects.push(q); });
            });
            info.forEach(o => {
                const hit = rects.some(q => o.L < q.right - cr.left && q.left - cr.left < o.Rt
                    && o.T < q.bottom - cr.top && q.top - cr.top < o.B);
                总数按段间距[pspace] = (总数按段间距[pspace] || 0) + 1;
                var 两行 = (o.B - o.T) > (fs * 1.6);      // 标签比一行还高＝折了两行
                var T = 两行 ? 总数_两行 : 总数_单行, P = 两行 ? 压字_两行 : 压字_单行;
                T[pspace] = (T[pspace] || 0) + 1;
                if (hit) {
                    stat.压字++; 压字按段间距[pspace] = (压字按段间距[pspace] || 0) + 1;
                    P[pspace] = (P[pspace] || 0) + 1;
                    if (pspace === 28 && !两行) {
                        // 压到的是哪一行字？跟标签差多少？顺带记下它上下的邻居是什么
                        var q0 = rects.filter(q => o.L < q.right - cr.left && q.left - cr.left < o.Rt
                            && o.T < q.bottom - cr.top && q.top - cr.top < o.B)[0];
                        bad.push({ seed, 类型: '28px下一行的小注压到正文', pspace, fs,
                            分支: 'gap' + o.gap + '/' + o.dir + '/row' + o.row, 明细:
                            o.id + ' 标签y' + Math.round(o.T) + '~' + Math.round(o.B) + ' x' + Math.round(o.L) + '~' + Math.round(o.Rt)
                            + '｜字行y' + Math.round(q0.top - cr.top) + '~' + Math.round(q0.bottom - cr.top)
                            + ' x' + Math.round(q0.left - cr.left) + '~' + Math.round(q0.right - cr.left)
                            + '｜重叠高' + Math.round(Math.min(o.B, q0.bottom - cr.top) - Math.max(o.T, q0.top - cr.top)) + 'px' });
                    }
                }
            });
        }
        document.querySelectorAll('.__fz').forEach(n => n.remove());
        // 每类只留前 6 条明细，别刷屏
        const byType = {};
        bad.forEach(b => { (byType[b.类型] || (byType[b.类型] = [])).push(b); });
        const sample = {};
        Object.keys(byType).forEach(k => { sample[k] = { 条数: byType[k].length, 例子: byType[k].slice(0, 10) }; });
        const 压字率 = {};
        Object.keys(总数按段间距).sort((a,b)=>a-b).forEach(k => {
            压字率[k + 'px'] = '合计 ' + (压字按段间距[k] || 0) + '/' + 总数按段间距[k]
                + '｜一行 ' + (压字_单行[k] || 0) + '/' + (总数_单行[k] || 0)
                + '｜两行 ' + (压字_两行[k] || 0) + '/' + (总数_两行[k] || 0);
        });
        return { stat, 压字率, 重叠按段间距, 乱序按段间距, 交叉按段间距, sample,
                 有远缝: rdGlLayout.toString().indexOf('_gl_tryFar') > 0 };
    }, N);

    const results = [];
    const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
    const s = R.stat, pct = (a, b) => b ? (a * 100 / b).toFixed(1) + '%' : '0%';

    ok('A 箭头都指到了那个词上', s.指错 === 0, s.指错 + ' 条指错');
    ok('B 没有标签跑出容器', s.出界 === 0, s.出界 + ' 条出界');
    ok('C 一条小注都没丢', s.丢条 === 0, s.丢条 + ' 页对不上');
    /* 【诊断】把 28px 一行的压字**按分支**（方向/有没有另起一行）分类打印。
       2026-08-12 加：那次改「缝按字量」时压字一度从 4.2% 涨到 9.5%，
       靠这一行当场看出全是 `down/row0`（就近那条缝的正常摆放压到**自己这段最后一行**），
       从而定位到「标签旋转的补偿量算了一半」。改这块时先看它，别一条条猜。 */
    {
        const 例 = ((R.sample['28px下一行的小注压到正文'] || {}).例子) || [];
        const 分布 = {};
        例.forEach(e => { const k = String(e.分支).replace(/gap-?\d+\//, ''); 分布[k] = (分布[k] || 0) + 1; });
        console.log('\n【诊断】28px 一行压字的分支分布：', JSON.stringify(分布),
                    '共记录', ((R.sample['28px下一行的小注压到正文'] || {}).条数) || 0, '条');
        例.slice(0, 6).forEach(e => console.log('   ·', e.分支, e.明细));
    }
    ok('D 排版没抛异常', !(R.sample['抛异常'] && R.sample['抛异常'].条数), JSON.stringify((R.sample['抛异常'] || {}).例子 || []));
    ok('E 两条标签互相压 ≤3%', s.重叠 <= s.小注 * 0.03, s.重叠 + '/' + s.小注 + ' = ' + pct(s.重叠, s.小注));
    ok('F 引线交叉 ≤1.5%', s.交叉 <= s.小注 * 0.015, s.交叉 + '/' + s.小注 + ' = ' + pct(s.交叉, s.小注));
    const b28 = (R.压字率['28px'] || '').match(/一行 (\d+)\/(\d+)/);
    // ⚠️2026-08-11 用户拍板「宁可引线拉长，也别压字」→ 加了「往外再找一两条整条塞得下的缝」
    //   这一步（_gl_tryFar），这一档从 13/168 降到 7/168。阈值按新基线收到 6%，别再放宽回去。
    ok('G 段间距28下「一行」的小注压正文 ≤6%', b28 && (+b28[1] <= +b28[2] * 0.06), R.压字率['28px']);
    ok('G2 远缝那一步还在（删了这一档会立刻回到 7.7%）', R.有远缝 === true);
    ok('无页面报错', errs.length === 0, errs.slice(0, 3).join(' | '));

    console.log('样本：' + s.页 + ' 页 / ' + s.小注 + ' 条小注');
    Object.keys(R.压字率).forEach(k => console.log('   压字 ' + k + '：' + R.压字率[k]));
    console.log('   另起一行(row1)参与的重叠/交叉：见 data-gl-row 属性');
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    await browser.close();
    process.exit(bad ? 1 : 0);
})();
