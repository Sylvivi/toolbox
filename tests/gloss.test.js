/* 手写小注（✍️ 注）的回归测试。
 *
 * 功能：读书碰到不会读/不懂的字 → 选中 →「✍️ 注」→ AI 给一句「拼音·意思」，
 * 以手写体挂在**段间距**里、一根手绘引线指回那个字。
 * 用户原话：「有些可能个别的字我不会读，或者我不知道他的意思，
 *             不需要用一整段话来介绍，可能我会选中这个，然后让AI帮我解释一下」。
 *
 * 零新增存储：一条小注 = 一条划线(reading_highlights)的 note 字段，颜色也复用划线那 5 个色。
 *
 * ⚠️这个文件钉住的是几条**做样例时踩过、改回去会立刻复发**的坑：
 *  A 组 翻页不许被污染 —— 小注绝不能挂进 <p>：readingPageDown 靠
 *      `range.selectNodeContents(p).getClientRects()` 逐行量位置对齐，段落里多出
 *      绝对定位元素会被当成"一行"，翻页就歪。而翻页是读小说每分钟都在用的手势。
 *  B 组 引线几何 —— 用户两轮实测定的手感：约 23px、只带一点点斜度。
 *      第一版 13px（戳着像小尾巴）、第二版 44~112px（她原话「为了倾斜而倾斜…很花里胡哨」）都退掉了。
 *      ⚠️引线长度只能靠横向偏移换：小注在 28px 空当里，离正文的垂直距离只有 4~7px。
 *  C 组 防撞按「空当」分组，不是按段落 —— 第 N 段往下 和 第 N+1 段往上落进同一条缝。
 *      第一版只在段落内部比，没撞纯属运气（一左一右）。
 *  D 组 长短分流 —— ≤RD_GL_MAX 字走手写小注，超过的保留原来那个 ✎ 小点，两者互斥。
 *  E 组 引线墨色必须用 style.stroke —— SVG 表现属性优先级最低，setAttribute('stroke')
 *      会被 `.rd-gl-svg path` 那条 CSS 整个盖掉（踩过：属性写进去了、画面一条没变）。
 *
 * 跑法：node tests/gloss.test.js    或    bash tests/p.sh gloss
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
        const P1 = '那年山里落了很大的雪，他独自守着一间破屋，门前石阶上生满青苔，屋中雾气氤氲。';
        const P2 = '他做什么都踟蹰，像总在门槛上迈不出去。想下山，又怕山下的人问起从前那桩事；想留下，柴火却撑不过这个冬天。';
        const P3 = '偶尔有樵夫路过，两人说不上几句便生龃龉，索性各走各的。';

        // 造一条共读消息；marks = [{para, word, note, color}]
        function build(marks) {
            document.querySelectorAll('.__glt').forEach(n => n.remove());
            const texts = { 1: P1, 2: P2, 3: P3 };
            const html = [1, 2, 3].map(n => {
                let t = texts[n];
                marks.filter(m => m.para === n).forEach(m => {
                    t = t.replace(m.word, '<mark class="rd-hl rd-hl-' + (m.color || 'gold')
                        + '" data-hlid="h' + n + m.word + '"'
                        + (m.note ? ' data-gl="' + m.note + '"' : '')
                        + (m.noted ? '' : '') + '>' + m.word + '</mark>');
                });
                return '<p data-p="' + n + '">' + t + '</p>';
            }).join('');
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __glt'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            // 段间距按用户的实际设置（她拉到了最大 28px）
            document.documentElement.style.setProperty('--reading-pspace', '28px');
            box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
            rdGlLayout(bub);
            return { box, bub };
        }
        const lineTops = p => {
            const r = document.createRange(); r.selectNodeContents(p);
            return [...new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)))].sort((a, b) => a - b);
        };
        const leaderOf = (box, id) => {
            const path = box.querySelector('.rd-gl-svg path[data-glid="' + id + '"]');
            if (!path) return null;
            const m = path.getAttribute('d').match(/^M([-\d.]+) ([-\d.]+) Q[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)/);
            return { len: Math.round(Math.hypot(+m[3] - +m[1], +m[4] - +m[2])), path };
        };

        // ── A：翻页量到的「行顶」不许被小注改变 ──
        {
            const a = build([{ para: 1, word: '雾气氤氲' }]);                       // 只有划线
            const topsHl = lineTops(a.box.querySelector('p[data-p="1"]'));
            const b = build([{ para: 1, word: '雾气氤氲', note: 'yīn yūn·雾气弥漫' }]); // 划线+小注
            const p1 = b.box.querySelector('p[data-p="1"]');
            out.A_行顶不变 = JSON.stringify(topsHl) === JSON.stringify(lineTops(p1));
            out.A_小注不在段落里 = !p1.querySelector('.rd-gl-label, .rd-gl-svg');
            out.A_小注挂在容器上 = !!b.box.querySelector(':scope > .rd-gl-layer');
        }

        // ── B：引线约 23px、不塌也不长 ──
        {
            const b = build([{ para: 1, word: '雾气氤氲', note: 'yīn yūn·雾气弥漫' }]);
            const L = leaderOf(b.box, 'h1雾气氤氲');
            out.B_引线长 = L && L.len;
            out.B_不塌 = !!L && L.len >= 18;      // 第一版 13px 会红
            out.B_不过长 = !!L && L.len <= 40;    // 第二版 44~112px 会红
        }

        // ── C：跨段共用同一条缝时不许重叠 ──
        {
            // 第 1 段末尾的往下、第 2 段开头的往上 → 落进同一条 28px 的缝
            const b = build([
                { para: 1, word: '雾气氤氲', note: 'yīn yūn·雾气弥漫' },
                { para: 2, word: '踟蹰', note: 'chí chú·犹豫不前' },
                { para: 3, word: '龃龉', note: 'jǔ yǔ·意见不合' },
                { para: 3, word: '索性', note: 'suǒ xìng·干脆' }
            ]);
            const labs = [...b.box.querySelectorAll('.rd-gl-label')].map(l => l.getBoundingClientRect());
            let ov = 0;
            for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
                const x = labs[i], y = labs[j];
                if (x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom) ov++;
            }
            out.C_标签数 = labs.length;
            out.C_零重叠 = ov === 0;
            // 每条引线都要精确指到自己那个字上
            const bad = [];
            ['h1雾气氤氲', 'h2踟蹰', 'h3龃龉', 'h3索性'].forEach(id => {
                const path = b.box.querySelector('.rd-gl-svg path[data-glid="' + id + '"]');
                const mk = b.box.querySelector('mark[data-hlid="' + id + '"]');
                if (!path || !mk) { bad.push(id + ':缺'); return; }
                const m = path.getAttribute('d').match(/Q[-\d.]+ [-\d.]+ ([-\d.]+) /);
                const svgR = path.ownerSVGElement.getBoundingClientRect();
                const mr = mk.getBoundingClientRect();
                const off = Math.abs(svgR.left + (+m[1]) - (mr.left + mr.width / 2));
                if (off > 2) bad.push(id + ':偏' + Math.round(off));
            });
            out.C_箭头都指对 = bad.length === 0;
            out.C_偏差明细 = bad;
        }

        // ── D：长短分流（RD_GL_MAX 字） ──
        {
            out.D_上限 = typeof RD_GL_MAX === 'number' ? RD_GL_MAX : null;
            const shortNote = '一'.repeat(RD_GL_MAX);            // 全汉字 = 正好 RD_GL_MAX 当量
            const longNote = '一'.repeat(RD_GL_MAX + 1);        // 超一个当量
            // rdGlSync 是所有改 note 的地方的唯一入口，直接考它
            const b = build([{ para: 1, word: '雾气氤氲', note: 'x' }]);
            const mk = b.box.querySelector('mark[data-hlid="h1雾气氤氲"]');
            rdGlSync('h1雾气氤氲', shortNote);
            const sOK = mk.getAttribute('data-gl') === shortNote && !mk.classList.contains('rd-hl-noted');
            rdGlSync('h1雾气氤氲', longNote);
            const lOK = !mk.hasAttribute('data-gl') && mk.classList.contains('rd-hl-noted');
            rdGlSync('h1雾气氤氲', '');
            const eOK = !mk.hasAttribute('data-gl') && !mk.classList.contains('rd-hl-noted');
            out.D_短的走手写 = sOK;
            out.D_长的留铅笔 = lOK;
            out.D_清空都不挂 = eOK;
            out.D_互斥 = sOK && lOK;   // 绝不能同时挂 data-gl 和 rd-hl-noted
        }

        // ── E：墨色跟着划线色，且引线是 style.stroke（不是表现属性） ──
        {
            const b = build([{ para: 1, word: '雾气氤氲', note: 'yīn yūn·雾气弥漫', color: 'rose' }]);
            const lab = b.box.querySelector('.rd-gl-label');
            const path = b.box.querySelector('.rd-gl-svg path');
            out.E_墨色 = getComputedStyle(lab).color;
            out.E_引线实际色 = getComputedStyle(path).stroke;
            out.E_色一致 = out.E_墨色 === out.E_引线实际色;
            out.E_用的是内联style = !!(path.style && path.style.stroke);
            out.E_跟划线色走 = lab.className.indexOf('rd-gl-rose') >= 0;
        }

        // ── F：清理干净，不留孤儿 ──
        {
            const b = build([{ para: 1, word: '雾气氤氲', note: 'yīn yūn·雾气弥漫' }]);
            rdGlLayout(b.bub); rdGlLayout(b.bub);   // 重复排版不该越堆越多
            out.F_重排不叠加 = b.box.querySelectorAll('.rd-gl-layer').length === 1;
            const mk = b.box.querySelector('mark[data-hlid="h1雾气氤氲"]');
            mk.removeAttribute('data-gl');
            rdGlLayout(b.bub);
            out.F_没小注就不留层 = b.box.querySelectorAll('.rd-gl-layer').length === 0;
        }

        // ── G：AI 回复的清洗 ──
        {
            out.G_去引号句号 = rdGlClean('「yīn yūn·雾气弥漫」。') === 'yīn yūn·雾气弥漫';
            out.G_只取第一行 = rdGlClean('yīn yūn·雾气弥漫\n还有别的废话') === 'yīn yūn·雾气弥漫';
            out.G_去前缀 = rdGlClean('拼音：yīn yūn·雾气弥漫') === 'yīn yūn·雾气弥漫';
            out.G_超长截断 = rdGlWidth(rdGlClean('一'.repeat(40))) === RD_GL_MAX;
            out.G_空的还是空 = rdGlClean('') === '' && rdGlClean('\n\n') === '';
            /* ⚠️用户 2026-08-04 截图报的那条：`zhāng hán·秦将，后` 被砍在半句上。
               根因是额度按**字符个数**算，光拼音就吃掉 9 个，意思只剩 4 个字。
               改成按「汉字当量」算（拉丁/空格算半个）之后，同样的话就放得下了。 */
            const REAL = 'zhāng hán·秦朝名将，后降项羽';
            out.G_拼音不吃额度 = rdGlClean(REAL) === REAL;
            out.G_当量算法 = rdGlWidth('zhāng hán') === 4.5 && rdGlWidth('秦将') === 2;
            out.G_截断不留半截标点 = !/[，、；：]$/.test(rdGlCut('秦朝的名将，后来投降了项羽啊', 8));
        }

        /* ── K：用户 2026-08-04 截图报的两条现场问题 ──
           K1 小注压在「汐：背景：故道」那块上面：紧跟段落的 blockquote[data-cp]
              **不吃段间距**、只吃自身 0.4em 上边距，那道缝只有 ≈5.6px 而小注要 21px。
              上下空当必须实测兄弟节点位置，放不下就翻到另一边。
           K2 目标字被人名高亮拆开：rdHlWrapRange 逐文本节点建 mark，
              选中的字跨过 .reading-name 就会拆成多个 mark，只认第一个会让箭头指到词的前半截。 */
        {
            document.querySelectorAll('.__glt').forEach(n => n.remove());
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = '<p data-p="1">经过战国时期就开始的纷争，好不容易秦统一了六国。</p>'
                + '<p data-p="2">当时<span class="reading-name">项羽</span>任命了三个王防守关中，'
                + '<span class="reading-name">雍王</span><span class="reading-name">章邯</span>在毫无防备的情况下战败。</p>'
                + '<blockquote data-cp="2" style="margin:0.4em 0 0;padding:10px">汐：背景：故道</blockquote>';
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __glt'; msg.setAttribute('data-idx','0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });

            const p2 = box.querySelector('p[data-p="2"]');
            const at = p2.textContent.indexOf('雍王章邯');
            rdHlWrapRange(p2, at, at + 4, 'gold', 'zz', false);
            const mks = p2.querySelectorAll('mark[data-hlid="zz"]');
            mks[0].setAttribute('data-gl', 'zhāng hán·秦朝名将，此时为项羽所封的雍王');
            rdGlLayout(bub);

            const lab = box.querySelector('.rd-gl-label');
            const lr = lab.getBoundingClientRect();
            const bq = box.querySelector('blockquote').getBoundingClientRect();
            const path = box.querySelector('.rd-gl-svg path');
            const mm = path.getAttribute('d').match(/Q[-\d.]+ [-\d.]+ ([-\d.]+) /);
            const svgR = path.ownerSVGElement.getBoundingClientRect();
            let L = Infinity, Rr = -Infinity;
            mks.forEach(m => { const r = m.getBoundingClientRect(); L = Math.min(L, r.left); Rr = Math.max(Rr, r.right); });

            out.K_人名把mark拆开了 = mks.length > 1;              // 前提成立才谈得上后面两条
            out.K_没压到背景块 = !(lr.top < bq.bottom && lr.bottom > bq.top);
            out.K_箭头指整词中心 = Math.abs(svgR.left + (+mm[1]) - (L + Rr) / 2) <= 2;
            out.K_长意思没被砍 = rdGlClean('zhāng hán·秦朝名将，此时为项羽所封的雍王')
                                  === 'zhāng hán·秦朝名将，此时为项羽所封的雍王';
            out.K_四字词也不砍 = rdGlClean('míng xiū zhàn dào·表面做假动作暗中行事')
                                  === 'míng xiū zhàn dào·表面做假动作暗中行事';
            out.K_留了余量 = RD_GL_MEAN > 14;   // 提示词要 14，代码得留富余，否则模型多写一字就被砍
            document.querySelectorAll('.__glt').forEach(n => n.remove());
        }

        // ── H：按钮挂上去了 ──
        {
            out.H_有注按钮 = rdHlShowSelBar.toString().indexOf('data-act="gloss"') >= 0;
            out.H_接到rdGlMake = rdHlShowSelBar.toString().indexOf('rdGlMake') >= 0;
            // 「问」那条路一个字没动
            out.H_问还在 = rdHlShowSelBar.toString().indexOf('rdHlAskClawd') >= 0;
        }

        // ── I：重排触发点都接上了（漏一个就会「改完字号线全歪」）──
        {
            out.I_字号 = readingApplyFontScale.toString().indexOf('rdGlRelayout') >= 0;
            out.I_段间距 = readingApplyParaSpace.toString().indexOf('rdGlRelayout') >= 0;
            out.I_字体 = readingApplyFonts.toString().indexOf('rdGlRelayout') >= 0;
        }

        document.querySelectorAll('.__glt').forEach(n => n.remove());
        return out;
    });

    ok('A1 翻页量到的行顶不被小注改变', R.A_行顶不变);
    ok('A2 小注没有挂进 <p> 里', R.A_小注不在段落里);
    ok('A3 小注挂在正文容器上', R.A_小注挂在容器上);
    ok('B1 引线不塌（≥18px）', R.B_不塌, '实测 ' + R.B_引线长 + 'px');
    ok('B2 引线不过长（≤40px）', R.B_不过长, '实测 ' + R.B_引线长 + 'px');
    ok('C1 四条小注全排出来了', R.C_标签数 === 4, '实测 ' + R.C_标签数 + ' 条');
    ok('C2 跨段共用一条缝也零重叠', R.C_零重叠);
    ok('C3 每条引线都精确指到自己的字', R.C_箭头都指对, (R.C_偏差明细 || []).join(' '));
    ok('D1 短批注走手写小注', R.D_短的走手写, '上限 ' + R.D_上限 + ' 字');
    ok('D2 长批注保留 ✎ 小点', R.D_长的留铅笔);
    ok('D3 两者互斥、不同时挂', R.D_互斥);
    ok('D4 清空批注两个都不挂', R.D_清空都不挂);
    ok('E1 引线颜色 = 手写字颜色', R.E_色一致, R.E_墨色 + ' vs ' + R.E_引线实际色);
    ok('E2 用内联 style 刷 stroke（不是表现属性）', R.E_用的是内联style);
    ok('E3 墨色跟着划线色走', R.E_跟划线色走);
    ok('F1 重复排版不叠加图层', R.F_重排不叠加);
    ok('F2 没小注时不留空层', R.F_没小注就不留层);
    ok('G1 清洗：去引号句号', R.G_去引号句号);
    ok('G2 清洗：只取第一行', R.G_只取第一行);
    ok('G3 清洗：去「拼音：」前缀', R.G_去前缀);
    ok('G4 清洗：超长截断到上限', R.G_超长截断);
    ok('G5 清洗：空的还是空', R.G_空的还是空);
    ok('G6 拼音不吃意思的额度（章邯那条）', R.G_拼音不吃额度);
    ok('G7 汉字当量算法正确', R.G_当量算法);
    ok('G8 截断不留半截标点', R.G_截断不留半截标点);
    ok('K1 前提：人名高亮确实把 mark 拆开了', R.K_人名把mark拆开了);
    ok('K2 小注没压到紧跟的背景块上', R.K_没压到背景块);
    ok('K3 箭头指整词中心（不是前半截）', R.K_箭头指整词中心);
    ok('K4 长意思不被砍（章邯那条完整版）', R.K_长意思没被砍);
    ok('K5 四字词的长拼音不挤掉意思', R.K_四字词也不砍);
    ok('K6 代码上限留了余量（>提示词的 14）', R.K_留了余量);
    ok('H1 小条上有「✍️ 注」按钮', R.H_有注按钮);
    ok('H2 按钮接到 rdGlMake', R.H_接到rdGlMake);
    ok('H3 「💬 问」那条路没被动', R.H_问还在);
    ok('I1 改字号会重排', R.I_字号);
    ok('I2 改段间距会重排', R.I_段间距);
    ok('I3 改字体会重排', R.I_字体);
    ok('J1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();

    let fail = 0;
    results.forEach(r => { if (!r.pass) fail++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(fail ? ('\n❌ 手写小注：' + fail + '/' + results.length + ' 条不通过') : ('\n✅ 手写小注：' + results.length + ' 条全过'));
    process.exit(fail ? 1 : 0);
})();
