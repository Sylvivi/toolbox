/* 手写小注「整排往左挤一挤」的回归（2026-08-11 加）。
 *
 * 用户报的现象（截图，《讲给大家的中国历史》里讲酷吏那一章）：一条小注**骑在正文
 * 「而负责解决这个问题的人物，就是酷吏」那行字上**，同一条缝里另一条却好好地待在缝里。
 * 她的原话：「上方小注出现遮挡，为何会如此，不应该分左右吗？」——她的直觉是对的。
 *
 * 根因：摆位是「每条先按自己想要的位置(want)放、后来的只能往右挪」。
 *   先摆的那条按自己的 want 钉在缝的中间，后来那条从它右边起步就伸出右边界 →
 *   判成「这条缝挤不下」→ 换另一条缝也满 → 最后退到「另起一行」，
 *   而另起的行会往上叠 27px 左右（rowOff），正好骑到上一段正文的最后一行上。
 *   可这两条的宽度加起来比一行还窄，**本来是放得下的**，只是没人肯往左让位。
 *
 * 修法（`_glCompact`）：放不下时先试「把这条缝里已摆好的整排等距左移」，腾够了就并排放。
 *   ⚠️整排等距、只往左 ⇒ 左右顺序一点不变 ⇒ 引线不会交叉（那个坑 2026-08-05 修过两次）。
 *   ⚠️挤不动（顶到段落左边界、或挤回去又会压到隔壁块的字）就返回 false，
 *     老的三条退路（贴右边／换缝／另起一行）原样保留，行为跟以前一模一样。
 *
 * 场景是**照着她那张截图复刻**的三条小注：
 *   甲（第 1 段末行中间，宽）→ 中间那条缝；
 *   乙（第 2 段首行偏右）  → 也想要中间那条缝，另一条缝被丙占着；
 *   丙（第 2 段末行）      → 占住第 2 段下面那条缝，逼得乙无路可退。
 *   旧代码：乙被抬起一行、压在第 1 段最后一行字上（实测 y48 压 y49）。
 *   新代码：甲往左让 47px，乙并排落在缝里，零压字。
 *
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/glosspack.test.js
 *   或  bash tests/p.sh glosspack
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
        /* 正文用**定长**填充串拼，好让换行位置可预测：14px 字号下一行 25 个字，
           段落首行缩进 2 字 → 首行 23 个字。词的位置写成「第几行第几个字」。 */
        const filler = '春山如笑水如蓝日暮乡关何处是烟波江上使人愁'.repeat(20);
        const put = (len, list) => {
            let s = filler.slice(0, len);
            list.slice().sort((a, b) => b.i - a.i).forEach(m => { s = s.slice(0, m.i) + m.word + s.slice(m.i + m.word.length); });
            return s;
        };
        const P1 = put(73, [{ i: 23 + 25 + 10, word: '酷吏' }]);                       // 末行第 10 字 → x≈140
        const P2 = put(73, [{ i: 18, word: '郅都' }, { i: 23 + 25 + 12, word: '宗室' }]); // 首行第 18 字 → x≈280

        function build(marks, pspace) {
            document.querySelectorAll('.__gpk').forEach(n => n.remove());
            const texts = { 1: P1, 2: P2 };
            const html = [1, 2].map(n => {
                let t = texts[n];
                marks.filter(m => m.p === n).forEach(m => {
                    t = t.replace(m.w, '<mark class="rd-hl rd-hl-' + (m.c || 'gold')
                        + '" data-hlid="h' + n + m.w + '" data-gl="' + m.n + '">' + m.w + '</mark>');
                });
                return '<p data-p="' + n + '">' + t + '</p>';
            }).join('');
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __gpk'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            // 段间距按用户的实际值 28（她 2026-08-11 亲口确认「我的默认段间距是28」）
            document.documentElement.style.setProperty('--reading-pspace', (pspace || 28) + 'px');
            box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = (pspace || 28) + 'px'; });
            rdGlLayout(bub);
            return box;
        }
        const textRects = p => {
            const r = document.createRange(); r.selectNodeContents(p);
            return [...r.getClientRects()].filter(x => x.width > 1 && x.height > 1);
        };
        const labOf = (box, id) => {
            const l = box.querySelector('.rd-gl-label[data-glid="' + id + '"]');
            return l ? l.getBoundingClientRect() : null;
        };
        const hitsText = (box, lr) => {
            let n = 0;
            box.querySelectorAll('p[data-p]').forEach(p => textRects(p).forEach(t => {
                if (lr.left < t.right && t.left < lr.right && lr.top < t.bottom && t.top < lr.bottom) n++;
            }));
            return n;
        };
        const overlap = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

        // ── Y1~Y3：复刻她那张截图的三条小注 ──
        {
            const box = build([
                { p: 1, w: '酷吏', n: 'kù lì·执法严苛不留情面的那种官员', c: 'gold' },
                { p: 2, w: '郅都', n: 'zhì dū·被免职遣返回家', c: 'blue' },
                { p: 2, w: '宗室', n: 'zōng shì·皇帝的同宗亲族这一大家子人', c: 'pink' }
            ]);
            const A = labOf(box, 'h1酷吏'), B = labOf(box, 'h2郅都'), C = labOf(box, 'h2宗室');
            const pR = box.querySelector('p[data-p="1"]').getBoundingClientRect();
            out.Y_三条都在 = !!A && !!B && !!C;
            out.Y_甲乙总宽 = A && B ? Math.round(A.width + B.width + 8) : null;
            out.Y_行宽 = Math.round(pR.width);
            out.Y_本来装得下 = A && B && (A.width + B.width + 8) <= pR.width + 8;   // +8 容忍旋转外框
            // Y1 谁都不许骑到正文字上（旧代码这里是「乙 压 1 行」）
            out.Y1_甲压字 = A ? hitsText(box, A) : -1;
            out.Y1_乙压字 = B ? hitsText(box, B) : -1;
            out.Y1_丙压字 = C ? hitsText(box, C) : -1;
            // Y1b 甲乙确实并排（竖直重叠、横向错开），而不是一上一下
            out.Y1b_甲乙同一行 = !!A && !!B && A.top < B.bottom && B.top < A.bottom;
            out.Y1b_甲乙不重叠 = !overlap(A, B);
            // Y2 左右顺序仍跟字一致 ⇒ 引线不交叉
            const mA = box.querySelector('mark[data-hlid="h1酷吏"]').getBoundingClientRect();
            const mB = box.querySelector('mark[data-hlid="h2郅都"]').getBoundingClientRect();
            out.Y2_顺序一致 = (mA.left < mB.left) === (A.left < B.left);
            // Y3 挤过之后没人被推出段落左边界
            out.Y3_没出左界 = A.left >= pR.left - 1 && B.left >= pR.left - 1 && C.left >= pR.left - 1;
            out.Y_位置 = [A, B, C].map(r => Math.round(r.left - pR.left) + '~' + Math.round(r.right - pR.left) + ' @' + Math.round(r.top));
        }

        // ── Y4：总宽真的装不下 → 老退路照旧（不许硬挤成重叠、不许推出左边界） ──
        {
            const box = build([
                { p: 1, w: '酷吏', n: 'kù lì·汉代那些执法极其严苛半点不讲情面的官员们', c: 'gold' },
                { p: 2, w: '郅都', n: 'zhì dū·汉景帝时期著名的酷吏后来被免职遣返回家', c: 'blue' }
            ]);
            const A = labOf(box, 'h1酷吏'), B = labOf(box, 'h2郅都');
            const pR = box.querySelector('p[data-p="1"]').getBoundingClientRect();
            out.Y4_确实装不下 = !!A && !!B && (A.width + B.width + 8) > pR.width;
            out.Y4_两条都在 = !!A && !!B;
            out.Y4_不互相叠 = !overlap(A, B);
            out.Y4_没出左界 = !!A && !!B && A.left >= pR.left - 1 && B.left >= pR.left - 1;
        }

        // ── Y5：只有一条时行为一点不变（根本轮不到挤） ──
        {
            const box = build([{ p: 1, w: '酷吏', n: 'kù lì·执法严苛不留情面的官员', c: 'gold' }]);
            const A = labOf(box, 'h1酷吏');
            out.Y5_单条不压字 = !!A && hitsText(box, A) === 0;
        }
        return out;
    });

    ok('Y0 三条小注都排出来了', R.Y_三条都在, JSON.stringify(R.Y_位置));
    ok('Y0 甲乙的总宽本来就装得下（前提）', R.Y_本来装得下, R.Y_甲乙总宽 + ' vs 行宽 ' + R.Y_行宽);
    ok('Y1 甲不压正文', R.Y1_甲压字 === 0, '压了 ' + R.Y1_甲压字 + ' 行');
    ok('Y1 乙不压正文（旧代码在这里被抬起一行、压住上一段末行）', R.Y1_乙压字 === 0, '压了 ' + R.Y1_乙压字 + ' 行');
    ok('Y1 丙不压正文', R.Y1_丙压字 === 0, '压了 ' + R.Y1_丙压字 + ' 行');
    ok('Y1b 甲乙并排在同一行', R.Y1b_甲乙同一行);
    ok('Y1b 甲乙横向不重叠', R.Y1b_甲乙不重叠);
    ok('Y2 左右顺序跟字一致（引线不交叉）', R.Y2_顺序一致);
    ok('Y3 没人被挤出段落左边界', R.Y3_没出左界);
    ok('Y4 真装不下时确实装不下（前提）', R.Y4_确实装不下);
    ok('Y4 装不下时两条也不许叠在一起', R.Y4_不互相叠);
    ok('Y4 装不下时也不许被推出左边界', R.Y4_没出左界);
    ok('Y5 只有一条时不压字', R.Y5_单条不压字);
    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
