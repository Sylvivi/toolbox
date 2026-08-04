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

        /* ── L：目标词**跨行折断**时箭头指对（用户 2026-08-04 报「缟素的箭头没指对」）──
           「诸侯皆缟 / 素。」这种折行的词，哪怕只有一个 mark，
           getBoundingClientRect() 返回的也是罩住两行的大框，中心落在两行之间的空白里。
           实测旧算法偏 161px（正好指到半行开外的地方），必须按 getClientRects() 的行片段锚。 */
        {
            const TXT = '使者告诸侯曰：“天下共立义帝，北面事之。今项羽放杀义帝于江南，大逆无道。寡人亲为发丧，诸侯皆缟素。悉发关内兵，收三河土，南浮江汉以下。”';
            let hit = null;
            for (let w = 300; w <= 400 && !hit; w += 2) {
                document.querySelectorAll('.__glt').forEach(n => n.remove());
                const box = document.createElement('div');
                box.className = 'reading-merged'; box.style.cssText = 'font-size:14px;line-height:1.6;width:' + w + 'px';
                box.innerHTML = '<p data-p="1">占位段落，给上面留出空当。</p><p data-p="2">' + TXT + '</p>';
                const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
                const msg = document.createElement('div');
                msg.className = 'chat-msg ai __glt'; msg.setAttribute('data-idx','0'); msg.appendChild(bub);
                document.body.appendChild(msg);
                box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
                const p2 = box.querySelector('p[data-p="2"]');
                const at = p2.textContent.indexOf('缟素');
                rdHlWrapRange(p2, at, at + 2, 'rose', 'gs', false);
                const mk = p2.querySelector('mark[data-hlid="gs"]');
                if ([...mk.getClientRects()].filter(r => r.width > 0).length === 2) hit = { box, bub, mk };
            }
            out.L_造出了折行 = !!hit;
            if (hit) {
                hit.mk.setAttribute('data-gl', 'gǎo sù·穿白色丧服');
                const rects = [...hit.mk.getClientRects()].filter(r => r.width > 0);
                const bb = hit.mk.getBoundingClientRect();
                rdGlLayout(hit.bub);
                const lab = hit.box.querySelector('.rd-gl-label'), lr = lab.getBoundingClientRect();
                const path = hit.box.querySelector('.rd-gl-svg path');
                const mm = path.getAttribute('d').match(/Q[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)/);
                const svgR = path.ownerSVGElement.getBoundingClientRect();
                const ax = svgR.left + (+mm[1]), ay = svgR.top + (+mm[2]);
                const up = lr.bottom <= rects[0].top;
                const t = up ? rects[0] : rects[rects.length - 1];
                const good = t.left + t.width / 2;
                out.L_箭头偏差 = Math.round(Math.abs(ax - good));
                out.L_指对了 = out.L_箭头偏差 <= 2;
                out.L_旧算法偏差 = Math.round(Math.abs((bb.left + bb.width / 2) - good));
                out.L_确实是个真bug = out.L_旧算法偏差 > 20;   // 旧算法真的会偏，不是白测
                out.L_落在目标那一行 = Math.abs(ay - (t.top + t.height / 2)) < 20;
            }
            document.querySelectorAll('.__glt').forEach(n => n.remove());
        }

        /* ── M：「退出重进后手写体全不见了」（用户 2026-08-04 报，我一度误判成数据丢失）──
           排版靠 getBoundingClientRect()，而重进时消息未必已经排好版（窗口化分批渲染、
           花字体还在从 IndexedDB 异步加载、容器可能瞬时 0 宽）。老代码量到 0 宽就 continue，
           一条不画且悄无声息，之后再没东西回来重排 → 永远不出现。
           现在量不到会排队重试。⚠️别把 rdGlRetryLater 那几处 continue 改回裸 continue。 */
        {
            // ⚠️用 __glm 而不是 __glt：evaluate 末尾那句统一清理会把 __glt 全删掉，
            //   而 M 组要活到 1200ms 的重试跑完之后才查得到。
            document.querySelectorAll('.__glt, .__glm').forEach(n => n.remove());
            const box = document.createElement('div');
            box.className = 'reading-merged'; box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = '<p data-p="1">占位段落。</p><p data-p="2">汉王闻之，袒而大哭，诸侯皆缟素。</p>';
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __glm'; msg.setAttribute('data-idx','0'); msg.appendChild(bub);
            msg.style.display = 'none';            // ← 排版那一刻还看不见
            document.body.appendChild(msg);
            box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
            const p2 = box.querySelector('p[data-p="2"]');
            const at = p2.textContent.indexOf('缟素');
            rdHlWrapRange(p2, at, at + 2, 'rose', 'gs', false);
            p2.querySelector('mark[data-hlid="gs"]').setAttribute('data-gl', 'gǎo sù·穿白色丧服');
            try { rdGlLayout(bub); } catch (e) {}
            out.M_看不见时确实画不出 = box.querySelectorAll('.rd-gl-label').length === 0;
            _rdGlRetry = 0; rdGlRelayoutSoon(80);
            msg.style.display = '';                // 现在才可见
            window.__mBox = box;                   // 交给外面等一会儿再查
        }

        /* ── N：三条小注挤在一条缝里（用户 2026-08-04 截图：前两条直接叠在一起）──
           那三条合计约 412px 而正文只有 358px，物理上排不下一行。
           ⚠️用户明确否掉了「把缝撑高」的做法：「我担心会影响到行号什么的，
              其实可以让缟素的那个从下往上画呀」——撑高＝改段落 margin＝真实重排。
           所以改成**在上下两条缝之间分流**，排版一个像素都不动。 */
        {
            document.querySelectorAll('.__glt').forEach(n => n.remove());   // ⚠️别清 __glm，那是 M 组的
            document.documentElement.style.setProperty('--reading-pspace', '28px');
            const box = document.createElement('div');
            box.className = 'reading-merged'; box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML =
                '<blockquote data-cp="1" style="margin:0.4em 0 0;padding:10px">汐：背景：董公遮说</blockquote>' +
                '<p data-p="2">汉王闻之，袒而大哭。遂为义帝发丧，临三日。发使者告诸侯曰：“天下共立义帝，北面事之。寡人亲为发丧，诸侯皆缟素。”</p>' +
                '<blockquote data-cp="2" style="margin:0.4em 0 0;padding:10px">汐：背景：三河</blockquote>';
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __glt'; msg.setAttribute('data-idx','0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            const p2 = box.querySelector('p[data-p="2"]');
            const before = getComputedStyle(p2).marginTop;
            [['袒','tǎn·脱去上衣露肩膀','n1','gold'],
             ['义帝','yì dì·楚怀王熊心，被项羽尊为义帝','n2','sky'],
             ['缟素','gǎo sù·穿白色丧服','n3','green']].forEach(([w, note, id, c]) => {
                const at = p2.textContent.indexOf(w);
                rdHlWrapRange(p2, at, at + w.length, c, id, false);
                const mk = p2.querySelector('mark[data-hlid="' + id + '"]');
                if (mk) mk.setAttribute('data-gl', note);
            });
            rdGlLayout(bub);
            const labs = [...box.querySelectorAll('.rd-gl-label')];
            const rs = labs.map(l => l.getBoundingClientRect());
            let ov = 0;
            for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
                const a = rs[i], c = rs[j];
                if (a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom) ov++;
            }
            const pr = p2.getBoundingClientRect();
            out.N_三条都在 = labs.length === 3;
            out.N_零重叠 = ov === 0;
            out.N_确实放不下一行 = rs.reduce((s, r) => s + r.width, 0) > pr.width;   // 前提成立才谈得上分流
            // ⚠️用**中心点**判在上还是在下：标签带 rotate，外框会比视觉位置向外胀几像素，
            //   拿 top/bottom 硬判会把明明在下面的那条判成"段落内部"（第一版就这么假红的）。
            const midOf = r => r.top + r.height / 2;
            out.N_分到了上下两边 = rs.some(r => midOf(r) < pr.top) && rs.some(r => midOf(r) > pr.bottom);
            out.N_没动段落间距 = getComputedStyle(p2).marginTop === before;
            out.N_没设行内间距变量 = !p2.style.getPropertyValue('--reading-pspace');
            document.querySelectorAll('.__glt').forEach(n => n.remove());
        }

        /* ── O：引线不许交叉（用户 2026-08-04：「那个缟素舍近求远，导致两条线都交叉了」）──
           根因：「想放哪儿」只按**第一行片段**算了一份，可小注实际是往下走的、该锚最后一行。
           跨行的词（缟在行尾最右／素在行首最左）于是标签摆最右、箭头指最左，
           一条线横穿整段，顺带把旁边那条也叉了。现在 wantUp/wantDown 各算一份。 */
        {
            document.querySelectorAll('.__glt').forEach(n => n.remove());
            document.documentElement.style.setProperty('--reading-pspace', '28px');
            const box = document.createElement('div');
            box.className = 'reading-merged'; box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML =
                '<blockquote data-cp="1" style="margin:0.4em 0 0;padding:10px">汐：背景：董公遮说</blockquote>' +
                '<p data-p="2">汉王闻之，袒而大哭。遂为义帝发丧，临三日。发使者告诸侯曰：“天下共立义帝，北面事之。今项羽放杀义帝于江南，大逆无道。寡人亲为发丧，诸侯皆缟素。悉发关内兵，收三河土。”</p>' +
                '<blockquote data-cp="2" style="margin:0.4em 0 0;padding:10px">汐：背景：三河</blockquote>';
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __glt'; msg.setAttribute('data-idx','0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            const p2 = box.querySelector('p[data-p="2"]');
            [['袒','tǎn·脱去上衣露肩膀','o1'],['义帝','yì dì·楚怀王熊心，被项羽尊为义帝','o2'],['缟素','gǎo sù·穿白色丧服','o3']]
                .forEach(([w, note, id]) => {
                    const at = p2.textContent.indexOf(w);
                    rdHlWrapRange(p2, at, at + w.length, 'gold', id, false);
                    const mk = p2.querySelector('mark[data-hlid="' + id + '"]');
                    if (mk) mk.setAttribute('data-gl', note);
                });
            rdGlLayout(bub);
            const segs = [...box.querySelectorAll('.rd-gl-svg path')].map(pa => {
                const m = pa.getAttribute('d').match(/^M([-\d.]+) ([-\d.]+) Q[-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+)/);
                return { id: pa.getAttribute('data-glid'), x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] };
            });
            const sd = (P, Q, Rr) => Math.sign((Q.x - P.x) * (Rr.y - P.y) - (Q.y - P.y) * (Rr.x - P.x));
            const cross = (a, c) => {
                const A = {x:a.x1,y:a.y1}, B = {x:a.x2,y:a.y2}, C = {x:c.x1,y:c.y1}, D = {x:c.x2,y:c.y2};
                return sd(A,B,C) !== sd(A,B,D) && sd(C,D,A) !== sd(C,D,B);
            };
            let n = 0;
            for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (cross(segs[i], segs[j])) n++;
            out.O_三条都有引线 = segs.length === 3;
            out.O_零交叉 = n === 0;
            // 舍近求远会拉出一条横穿整段的长线；正常的都在 100px 以内
            out.O_没有异常长的线 = segs.every(s => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 130);
            document.querySelectorAll('.__glt').forEach(n2 => n2.remove());
        }

        /* ── P：拼音和中文用两种花体（用户 2026-08-04 要求，她中文更喜欢「青春」）──
           ⚠️不能靠「青春优先、溪涧兜底」的逐字回退：青春**有** a~z，只缺 ā ǎ ē ě 等 17 个，
           那样 shēng 会变成 sh(青春)+ē(溪涧)+ng(青春)，一个词三种笔迹。必须按「·」切开。 */
        {
            const lab = document.createElement('div');
            lab.className = 'rd-gl-label';
            const t = 'gǎo sù·穿白色丧服', d = t.indexOf('·');
            lab.innerHTML = '<span class="rd-gl-py">' + t.slice(0, d) + '</span>·<span class="rd-gl-cn">' + t.slice(d + 1) + '</span>';
            document.body.appendChild(lab);
            const f = el => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
            const py = lab.querySelector('.rd-gl-py'), cn = lab.querySelector('.rd-gl-cn');
            out.P_拼音用溪涧 = f(py) === '溪涧山雪璞玉浑金';
            out.P_中文用青春 = f(cn) === '青春例外你是偏爱';
            out.P_两半不同字体 = f(py) !== f(cn);
            // 中文那半要有回退（青春只到 GB2312，缺字得接得住）
            out.P_中文有回退 = getComputedStyle(cn).fontFamily.indexOf('溪涧') >= 0;
            out.P_文字没丢 = lab.textContent === t;
            lab.remove();
        }

        // ── H：按钮挂上去了 ──
        {
            out.H_有注按钮 = rdHlShowSelBar.toString().indexOf('data-act="gloss"') >= 0;
            out.H_接到rdGlMake = rdHlShowSelBar.toString().indexOf('rdGlMake') >= 0;
            /* 「💬 问」2026-08-04 从**选中小条**上撤了（用户：「我几乎不用」），
               但点已有划线的那条小条上仍然保留 —— 两边别搞混。 */
            // ⚠️查 data-act="ask" 这个按钮标记，别查函数名或 emoji ——
            //   toString() 连注释一起返回，注释里提一嘴就会假红（第一版就这么红的）。
            out.H_选中条上没有问 = rdHlShowSelBar.toString().indexOf('data-act="ask"') < 0;
            // 两条小条上都撤了（用户 2026-08-04 两次要求），函数本体也一并删了
            out.H_已有划线上也没问 = rdHlShowEditBar.toString().indexOf('data-act="ask"') < 0;
            out.H_函数已删干净 = typeof window.rdHlAskClawd === 'undefined';
            out.H_注按钮还在 = rdHlShowSelBar.toString().indexOf('data-act=\"gloss\"') >= 0;
            /* 顺序是用户 2026-08-04 亲自定的：色板 → ✍️注 → 划线样式 → ✏️改。
               她先试过「注放最前」，说不对，要在色板后面。按源码里三段的先后位置钉住。 */
            const _src = rdHlShowSelBar.toString();
            const _iSw = _src.indexOf('rdHlSwatchHtml(');
            const _iGl = _src.indexOf('data-act="gloss"');
            const _iSt = _src.indexOf('rdHlStyleBtnHtml(');
            out.H_注在色板后 = _iSw < _iGl;
            out.H_注在划线前 = _iGl < _iSt;
            // 已有划线的小条上也要有「✍️ 重注」——否则想重注只能先删划线再重选（用户真踩了）
            out.H_重注按钮 = rdHlShowEditBar.toString().indexOf("data-act=\"gloss\"") >= 0;
            out.H_重注接到rdGlRedo = rdHlShowEditBar.toString().indexOf('rdGlRedo') >= 0;
            // 新建和重注必须共用同一条 AI 调用路径，别复制两份
            out.H_共用一条路 = rdGlMake.toString().indexOf('rdGlFetch') >= 0
                             && rdGlRedo.toString().indexOf('rdGlFetch') >= 0;
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
    ok('L1 造出了跨行折断的词', R.L_造出了折行);
    ok('L2 跨行时箭头仍精确指对', R.L_指对了, '偏差 ' + R.L_箭头偏差 + 'px');
    ok('L3 箭头落在离小注最近的那一行', R.L_落在目标那一行);
    ok('L4 前提：旧算法确实会指飞', R.L_确实是个真bug, '旧算法偏 ' + R.L_旧算法偏差 + 'px');
    // M 组要等重试跑完才查得到（重试是 setTimeout 排的）
    await page.waitForTimeout(1200);
    const M = await page.evaluate(() => {
        const box = window.__mBox;
        const r = { 小注: box.querySelectorAll('.rd-gl-label').length,
                    引线: box.querySelectorAll('.rd-gl-svg path').length };
        document.querySelectorAll('.__glt, .__glm').forEach(n => n.remove());
        return r;
    });
    ok('M1 看不见时确实画不出来（前提成立）', R.M_看不见时确实画不出);
    ok('M2 可见后自动补回小注', M.小注 === 1, '实测 ' + M.小注 + ' 条');
    ok('M3 引线也补回来了', M.引线 === 1);
    ok('K1 前提：人名高亮确实把 mark 拆开了', R.K_人名把mark拆开了);
    ok('K2 小注没压到紧跟的背景块上', R.K_没压到背景块);
    ok('K3 箭头指整词中心（不是前半截）', R.K_箭头指整词中心);
    ok('K4 长意思不被砍（章邯那条完整版）', R.K_长意思没被砍);
    ok('K5 四字词的长拼音不挤掉意思', R.K_四字词也不砍);
    ok('K6 代码上限留了余量（>提示词的 14）', R.K_留了余量);
    ok('P1 拼音用溪涧山雪（声调齐全）', R.P_拼音用溪涧);
    ok('P2 中文用青春例外（她偏爱的）', R.P_中文用青春);
    ok('P3 两半确实是不同字体', R.P_两半不同字体);
    ok('P4 中文那半有缺字回退', R.P_中文有回退);
    ok('P5 拆开后文字一个不少', R.P_文字没丢);
    ok('O1 三条引线都画出来了', R.O_三条都有引线);
    ok('O2 引线之间零交叉', R.O_零交叉);
    ok('O3 没有舍近求远拉出的长线', R.O_没有异常长的线);
    ok('N1 三条小注都排出来了', R.N_三条都在);
    ok('N2 挤在一起时零重叠', R.N_零重叠);
    ok('N3 前提：它们确实一行放不下', R.N_确实放不下一行);
    ok('N4 自动分流到上下两条缝', R.N_分到了上下两边);
    ok('N5 没有把段间距撑高（用户明确否掉）', R.N_没动段落间距);
    ok('N6 没给段落写行内 --reading-pspace', R.N_没设行内间距变量);
    ok('H1 小条上有「✍️ 注」按钮', R.H_有注按钮);
    ok('H2 按钮接到 rdGlMake', R.H_接到rdGlMake);
    ok('H3a 选中小条上已经没有「💬 问」', R.H_选中条上没有问);
    ok('H3b 点已有划线时也没有「💬 问」了', R.H_已有划线上也没问);
    ok('H3d 死函数已删干净', R.H_函数已删干净);
    ok('H3c 撤「问」没误删「✍️ 注」', R.H_注按钮还在);
    ok('H3e 「✍️ 注」排在色板后面', R.H_注在色板后);
    ok('H3f 「✍️ 注」排在「划线」前面', R.H_注在划线前);
    ok('H4 已有划线上有「✍️ 重注」', R.H_重注按钮);
    ok('H5 重注接到 rdGlRedo', R.H_重注接到rdGlRedo);
    ok('H6 新建与重注共用同一条 AI 路径', R.H_共用一条路);
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
