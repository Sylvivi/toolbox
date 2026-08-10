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

        /* ── X：引线是虚线，但箭头必须实线（2026-08-10 用户要的「把线弄成虚线」）──
           钉住的坑：曲线和箭头原本是**同一条 path**（d 里 `M…Q…` 接着 `M…L…L…`）。
           那样加 stroke-dasharray，箭头两笔总共才 HL=6.5px，会被切成几个孤零零的小点、
           箭头当场消失。所以拆成两条 path，箭头那条 .rd-gl-arrow 单独关掉虚线。
           ⚠️曲线必须是**第一条**：本文件多处按 `.rd-gl-svg path` 取第一个并按 `^M… Q…` 解析。 */
        {
            const b = build([{ para: 1, word: '雾气氤氲', note: 'yīn yūn·雾气弥漫', color: 'rose' }]);
            const ps = [...b.box.querySelectorAll('.rd-gl-svg path')];
            out.X_一条小注两个path = ps.length === 2;
            out.X_曲线在前 = !!(ps[0] && /^M[-\d.]+ [-\d.]+ Q/.test(ps[0].getAttribute('d')));
            out.X_箭头在后 = !!(ps[1] && ps[1].classList.contains('rd-gl-arrow')
                                && /^M[-\d.]+ [-\d.]+ L/.test(ps[1].getAttribute('d')));
            const dashOf = el => (getComputedStyle(el).strokeDasharray || '').replace(/px/g, '');
            out.X_曲线虚线 = ps[0] ? dashOf(ps[0]) : '';
            out.X_曲线是虚的 = /\d/.test(out.X_曲线虚线);
            out.X_箭头实线 = ps[1] ? dashOf(ps[1]) : '';
            out.X_箭头没跟着虚 = !/\d/.test(out.X_箭头实线);
            // 箭头也得跟着墨色走，不然虚线线是彩的、箭头是黑的
            out.X_箭头同色 = !!(ps[1] && getComputedStyle(ps[1]).stroke === getComputedStyle(ps[0]).stroke);
            document.querySelectorAll('.__glt').forEach(n => n.remove());
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
            // ⚠️纯中文（没有「·」）＝整条都是「意思」，按 RD_GL_MEAN 截，不是整行的 RD_GL_MAX。
            //   2026-08-04 加「常见字不写拼音」后改的，别改回 RD_GL_MAX。
            out.G_超长截断 = rdGlWidth(rdGlClean('一'.repeat(40))) === RD_GL_MEAN;
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
            /* ⚠️必须排掉箭头（2026-08-10 改虚线时拆出来的第二条 path）：它的 d 是
               `M… L… L…`，套这条 `^M… Q…` 的正则直接返回 null，取 m[1] 当场抛。 */
            const segs = [...box.querySelectorAll('.rd-gl-svg path:not(.rd-gl-arrow)')].map(pa => {
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

        /* ── Q：常见字不写拼音（用户 2026-08-04：「有时候我只是想让AI解释一下」）──
           ⚠️没有「·」的那一路有两个坑，都在这儿钉住：
           ① 字体：不能掉回标签的兜底字体（那是溪涧），整条都是中文就该走青春；
           ② 长度：不能按整行的 RD_GL_MAX(26) 截，整条就是「意思」，该按 RD_GL_MEAN(16)。 */
        {
            const lab = document.createElement('div');
            lab.className = 'rd-gl-label';
            lab.innerHTML = '<span class="rd-gl-cn">河东河内河南三郡</span>';
            document.body.appendChild(lab);
            const f = el => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
            out.Q_无拼音走中文字体 = f(lab.querySelector('.rd-gl-cn')) === '青春例外你是偏爱';
            lab.remove();
            // 截断：无拼音时按「意思」的额度，不是整行的额度
            const longCn = '这是一句非常非常长的解释一直写下去停不下来';
            out.Q_无拼音按意思额度截 = rdGlWidth(rdGlClean(longCn)) <= RD_GL_MEAN;
            out.Q_有拼音的照旧 = rdGlClean('yīn yūn·雾气弥漫') === 'yīn yūn·雾气弥漫';
            // 提示词里要写清楚两种情况
            out.Q_提示词分了两路 = RD_GL_SYS.indexOf('只写意思，不要拼音') >= 0
                                && RD_GL_SYS.indexOf('生僻字') >= 0;
        }

        /* ── R：紧跟背景块的段落，小注不许被挤扁（用户 2026-08-04：「杯葛显得很挤」）──
           blockquote[data-cp] 只吃 0.4em 上边距，那道缝比标签还窄；
           老代码 min(7,(缝宽-标签高)/2) 会取到下限 2px，小注贴在正文屁股上。
           ⚠️离正文的距离固定 7px、**不随缝宽缩**，宁可压到背景块上——她明确说不介意压。 */
        {
            document.querySelectorAll('.__glt').forEach(n => n.remove());
            const box = document.createElement('div');
            box.className = 'reading-merged'; box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = '<p data-p="1">占位段落。</p>'
                + '<p data-p="2">这就意味着，如果这个时候换太子，必然要面对这个势力可能对他的杯葛或反抗。</p>'
                + '<blockquote data-cp="2" style="margin:0.4em 0 0;padding:10px">汐：背景：商山四皓</blockquote>';
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __glt'; msg.setAttribute('data-idx','0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            /* ⚠️这里必须让**上下两条缝都窄**（2026-08-06 改）。
               下缝紧跟批注框≈5.6px 本来就窄，但上缝是段间距(28px)——而 W 组那条新规矩是
               「只有一边装得下就先试那边」，于是这条小注会被挪进上面那条宽缝，
               R2/R3 量的 `lab.style.top - pBot` 就不再是「往下摆的内缩」，整组假红。
               R 组要守的是**两边都摆不下、只能压进隔壁块时**用多大内缩，所以把上缝也压窄。
               ⚠️必须改 `--reading-pspace` 变量，**行内 `p.style.marginTop` 没用**——
                 CSS 里那条 `.reading-merged p[data-p]{margin-top:var(--reading-pspace)!important}`
                 会把行内样式盖掉（我第一版就是这么改的，白改一轮）。 */
            const _psSave = document.documentElement.style.getPropertyValue('--reading-pspace');
            document.documentElement.style.setProperty('--reading-pspace', '6px');
            const p2 = box.querySelector('p[data-p="2"]');
            const at = p2.textContent.indexOf('杯葛');
            rdHlWrapRange(p2, at, at + 2, 'rose', 'r1', false);
            p2.querySelector('mark[data-hlid="r1"]').setAttribute('data-gl', 'bèi gé·音译自英语boycott，意为抵制');
            rdGlLayout(bub);
            const lab = box.querySelector('.rd-gl-label');
            const pr = p2.getBoundingClientRect();
            const bq = box.querySelector('blockquote').getBoundingClientRect();
            /* ⚠️style.top 是相对**容器**的（小注挂在容器级的图层上），不是相对段落。
               要跟「段落底边在容器里的位置」比，别拿 offsetHeight 直接减（第一版就这么假红的）。 */
            const cr2 = box.getBoundingClientRect();
            const pBot = pr.bottom - cr2.top;
            const inset = parseFloat(lab.style.top) - pBot;
            out.R_下面那道缝很窄 = (bq.top - pr.bottom) < 12;          // 前提成立
            // 宽缝（正常段间距）那一路必须还用小内缩，别被这次改动误伤
            {
                // ⚠️这一小段测的是「宽缝」，而外面为了 R2/R3 把段间距压成了 6px，
                //   必须在这儿单独调回正常宽度，否则它量到的是窄缝、必假红。
                document.documentElement.style.setProperty('--reading-pspace', '28px');
                const b2box = document.createElement('div');
                b2box.className = 'reading-merged'; b2box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
                b2box.innerHTML = '<p data-p="1">第一段占位。</p><p data-p="2">必然要面对这个势力可能对他的杯葛或反抗。</p>';
                const b2bub = document.createElement('div'); b2bub.className = 'chat-bubble'; b2bub.appendChild(b2box);
                const b2msg = document.createElement('div');
                b2msg.className = 'chat-msg ai __glt'; b2msg.setAttribute('data-idx','0'); b2msg.appendChild(b2bub);
                document.body.appendChild(b2msg);
                b2box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
                const q1 = b2box.querySelector('p[data-p="1"]');
                const qa = q1.textContent.indexOf('占位');
                rdHlWrapRange(q1, qa, qa + 2, 'gold', 'r9', false);
                q1.querySelector('mark[data-hlid="r9"]').setAttribute('data-gl', '测试用');
                rdGlLayout(b2bub);
                const l9 = b2box.querySelector('.rd-gl-label');
                const c9 = b2box.getBoundingClientRect();
                const p9 = q1.getBoundingClientRect();
                const in9 = parseFloat(l9.style.top) - (p9.bottom - c9.top);
                out.R_宽缝仍用小内缩 = Math.abs(in9 - RD_GL_INSET) < 1.5;
                document.documentElement.style.setProperty('--reading-pspace', '6px');   // 还给外面那段窄缝场景
            }
            /* 缝装不下时用更大的 RD_GL_INSET_OVER，让小注整个落进隔壁块的留白带里。
               ⚠️别以为「越远越好」：渲过 7/12/16 三版，16px 会直接撞上块里的第一行字。 */
            out.R_没被挤扁 = inset >= 6;                                // 老代码这里会缩到 2
            out.R_窄缝用大内缩 = Math.abs(inset - RD_GL_INSET_OVER) < 1.5;
            out.R_大内缩比小的大 = RD_GL_INSET_OVER > RD_GL_INSET;
            out.R_大内缩没大过头 = RD_GL_INSET_OVER <= 14;              // 再大就撞块里的字了
            // ⚠️用完把段间距还回去，别把这一组的窄缝设置漏给后面的组
            if (_psSave) document.documentElement.style.setProperty('--reading-pspace', _psSave);
            else document.documentElement.style.removeProperty('--reading-pspace');
            document.querySelectorAll('.__glt').forEach(n => n.remove());
        }

        /* ── S：一条缝里只有一条小注时，绝不许另起一行 ──
           用户 2026-08-05 截图：「上面的那个位置又太靠上了」。那条小注宽 256px，
           想放的位置(want＝离目标字 22px)比段落右边界只多出 3px，就被判成「这一行满了」，
           另起一行 → 整条抬高约 28px → 压进上一段正文里。而这条缝**只有它一条**，
           往左让 3px 贴着右边界一放就正好放得下。
           ⚠️判「满」的依据只能是「已经摆好的那条挡住了」，不是「够不够右边界」——
           want 只是手感偏好，本来就该让位。 */
        {
            document.querySelectorAll('.__glt').forEach(n => n.remove());
            const S1 = '力更强。谁掌握了南北军，谁就控制了整个长安的军事力量，等于捏住了皇权的命脉。';
            const S2 = '于是，丞相就照着张辟疆的建议去跟太后说。果然太后有了反应，这才放心去哭她死去的儿子。'
                     + '靠着孝惠皇帝死后的转折变化，这些吕家的男人纷纷进入朝廷，获得了重要的位置和权力。';
            const sbox = document.createElement('div');
            sbox.className = 'reading-merged';
            sbox.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            // 目标字在第 2 段**第一行偏右**：小注首选往上、want 必然伸出右边界
            sbox.innerHTML = '<p data-p="1">' + S1 + '</p><p data-p="2">'
                + S2.replace('去跟太后说', '<mark class="rd-hl rd-hl-sky" data-hlid="s1" data-gl="shà·此处通「喢」，意为杀，杀白马歃血为盟">去跟太后说</mark>')
                + '</p>';
            const sbub = document.createElement('div'); sbub.className = 'chat-bubble'; sbub.appendChild(sbox);
            const smsg = document.createElement('div');
            smsg.className = 'chat-msg ai __glt'; smsg.setAttribute('data-idx', '0'); smsg.appendChild(sbub);
            document.body.appendChild(smsg);
            document.documentElement.style.setProperty('--reading-pspace', '28px');
            sbox.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
            rdGlLayout(sbub);

            const sc = sbox.getBoundingClientRect();
            const sl = sbox.querySelector('.rd-gl-label');
            const sp1 = sbox.querySelector('p[data-p="1"]').getBoundingClientRect();
            const sp2 = sbox.querySelector('p[data-p="2"]').getBoundingClientRect();
            const sTop = parseFloat(sl.style.top);
            out.S_只有一条 = sbox.querySelectorAll('.rd-gl-label').length === 1;
            // 前提：它想放的位置确实伸出了右边界（不然这组测的就不是同一件事）
            out.S_确实放不进想要的位置 = sl.offsetWidth + RD_GL_DX > sp2.width / 2;
            // 落在缝里：标签上边沿不许高过上一段的底
            out.S_没被抬高一行 = sTop >= (sp1.bottom - sc.top) - 1;
            out.S_也没掉出缝 = sTop + sl.offsetHeight <= (sp2.top - sc.top) + 1;
            out.S_内缩 = Math.round((sp2.top - sc.top) - sTop - sl.offsetHeight);
            // 让位之后必须仍在段落宽度内（贴右边界）
            out.S_没伸出右边 = sl.getBoundingClientRect().right <= sp2.right + 1;
            document.querySelectorAll('.__glt').forEach(n => n.remove());
        }

        /* ── T：切主题/切夜间之后，引线的颜色要跟着字色一起变 ──
           引线是 SVG，stroke 由 JS 在排版那一刻刷成**行内样式**（表现属性会被 CSS 盖掉，
           所以只能用 style）。于是切夜间时字色跟着 CSS 走了、线还留在旧颜色。
           这个坑一直都在，只是另外五个色日夜色差小、看不出来；「墨」是黑↔白，一眼露馅
           （2026-08-05 用户报「夜间黑色小注的线没改成合适的颜色，只改了字体色」）。 */
        {
            document.querySelectorAll('.__glt').forEach(n => n.remove());
            var tm = document.createElement('div');
            tm.className = 'chat-msg ai __glt'; tm.setAttribute('data-idx', '0');
            tm.innerHTML = '<div class="chat-bubble"><div class="reading-merged" style="font-size:15px;line-height:1.7;width:320px">'
                + '<p data-p="1" style="margin:8px 0 30px">读到<mark class="rd-hl rd-hl-ink" data-hlid="t1" data-gl="b\u0113i g\u00e9\u00b7\u8054\u5408\u62b5\u5236">杯葛</mark>停了一下。</p>'
                + '<p data-p="2">又过了三年。</p></div></div>';
            document.body.appendChild(tm);
            document.documentElement.style.setProperty('--reading-pspace', '28px');
            rdGlLayout(tm.querySelector('.chat-bubble'));
            var tLab = tm.querySelector('.rd-gl-label'), tPath = tm.querySelector('.rd-gl-svg path');
            out.T_日间线跟字同色 = !!tPath && tPath.style.stroke === getComputedStyle(tLab).color;
            var wasDark = document.body.classList.contains('dark');
            document.body.classList.add('dark');
            // 只加 class＝模拟「CSS 生效了但没人重排」，此刻线**应该**还是旧的（前提成立才说明这条测试有意义）
            out.T_前提_不重排线就不会变 = tPath.style.stroke !== getComputedStyle(tLab).color;
            rdGlLayout(tm.querySelector('.chat-bubble'));
            var tPath2 = tm.querySelector('.rd-gl-svg path'), tLab2 = tm.querySelector('.rd-gl-label');
            out.T_重排后线跟上了 = !!tPath2 && tPath2.style.stroke === getComputedStyle(tLab2).color;
            if (!wasDark) document.body.classList.remove('dark');
            // 主题总开关里挂了重排（漏了的话切夜间线就一直是旧色）
            out.T_切主题会重排小注 = typeof applyTheme === 'function'
                && applyTheme.toString().indexOf('rdGlRelayoutSoon') >= 0;
            document.querySelectorAll('.__glt').forEach(n => n.remove());
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
    ok('X1 一条小注拆成曲线+箭头两个 path', R.X_一条小注两个path);
    ok('X2 曲线在前（解析 d 的地方都靠这个顺序）', R.X_曲线在前);
    ok('X3 箭头在后且是 .rd-gl-arrow', R.X_箭头在后);
    ok('X4 曲线是虚线', R.X_曲线是虚的, 'dasharray=' + R.X_曲线虚线);
    ok('X5 箭头没跟着变虚（虚了就碎成小点）', R.X_箭头没跟着虚, 'dasharray=' + (R.X_箭头实线 || 'none'));
    ok('X6 箭头跟曲线同色', R.X_箭头同色);
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
                    // ⚠️排掉箭头那条：一条小注现在是两个 path（曲线走虚线、箭头实线）
                    引线: box.querySelectorAll('.rd-gl-svg path:not(.rd-gl-arrow)').length };
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
    ok('S1 前提：这条缝里只有一条小注', R.S_只有一条);
    ok('S2 前提：它想放的位置确实伸出了右边界', R.S_确实放不进想要的位置);
    ok('S3 独占一条缝时不许另起一行（不压上一段）', R.S_没被抬高一行);
    ok('S4 也没掉到缝外面去', R.S_也没掉出缝, '内缩 ' + R.S_内缩 + 'px');
    ok('S5 让位之后没伸出段落右边', R.S_没伸出右边);
    ok('R1 前提：紧跟背景块那道缝确实很窄', R.R_下面那道缝很窄);
    ok('R6 宽缝（正常段间距）仍用小内缩，没被误伤', R.R_宽缝仍用小内缩);
    ok('R2 小注没被挤扁（离正文≥6px）', R.R_没被挤扁);
    ok('R3 窄缝时用更大的内缩（落进隔壁块留白带）', R.R_窄缝用大内缩);
    ok('R4 大内缩确实比常规大', R.R_大内缩比小的大);
    ok('R5 大内缩没大到撞上块里的字', R.R_大内缩没大过头);
    ok('Q1 没拼音时整条走中文字体（不掉回溪涧）', R.Q_无拼音走中文字体);
    ok('Q2 没拼音时按「意思」的额度截断', R.Q_无拼音按意思额度截);
    ok('Q3 有拼音的那一路没被改坏', R.Q_有拼音的照旧);
    ok('Q4 提示词里分了「注音/不注音」两路', R.Q_提示词分了两路);
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
    ok('T1 日间：引线跟字同色', R.T_日间线跟字同色);
    ok('T2 前提：不重排的话线不会自己变色', R.T_前提_不重排线就不会变);
    ok('T3 重排后引线跟上了新主题的字色', R.T_重排后线跟上了);
    ok('T4 切主题/切夜间的总开关里挂了小注重排', R.T_切主题会重排小注);

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
    /* ── U：重刷人名高亮时，别把套在里面的划线/小注一起抹掉 ──────────────
       2026-08-05 用户报「先写的小注，标完背景那个词的小注就不见了」。
       标背景收尾会把讲过的词并进名单高亮，而她写小注的正是同一个词 →
       划线 <mark> 被裹进 .reading-name → readingRehighlightNamesInPlace 拆 span 时
       旧写法 replaceChild(createTextNode(textContent)) 把 mark 连同 data-gl 一起压成纯文字。
       症状：划线和小注在页面上一起消失，但存储里数据完好、重开一章又回来（所以像随机发作）。*/
    const U = await page.evaluate(() => {
        const box = document.createElement('div');
        box.className = 'reading-merged __mt';
        box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
        box.innerHTML = '<p data-p="1">门前石阶上生满'
            + '<span class="reading-name"><mark class="rd-hl rd-hl-gold" data-hlid="H1" data-gl="qīng tái·青色的苔藓">青苔</mark></span>'
            + '，屋中雾气氤氲。</p>';
        document.body.appendChild(box);
        readingRehighlightNamesInPlace();
        const p = box.querySelector('p');
        const r = {
            划线还在: !!p.querySelector('mark.rd-hl[data-hlid="H1"]'),
            小注文字还在: !!p.querySelector('mark.rd-hl[data-gl]'),
            正文一字没改: p.textContent === '门前石阶上生满青苔，屋中雾气氤氲。',
            人名span已拆掉: !p.querySelector('.reading-name'),
        };
        box.remove();
        return r;
    });
    ok('U1 拆人名高亮后，套在里面的划线还在（别用 textContent 压平）', U.划线还在);
    ok('U2 划线上的小注(data-gl)也还在', U.小注文字还在);
    ok('U3 正文一个字都没改', U.正文一字没改);
    ok('U4 旧的人名 span 确实拆掉了（没白拆）', U.人名span已拆掉);

    /* ── V：紧挨着的两个词，小注宽度差很多时不许交叉 ────────────────────
       2026-08-05 用户截图（《史记的读法》「…撮名法之要…」）：
         撮   → cuō·撮取、提取           标签宽 89
         名法 → 名家和法家两个学派的合称   标签宽 156
       两个字才差 21px、标签宽度差 34px。老排序键是「字x + 方向偏移 − 标签宽/2」＝标签想放的位置，
       **宽的减得多** → 宽的那条被排到前面 → 先占左边 → 字是左→右、标签却右→左 → 两条引线交叉。
       排序键必须只用「目标字的位置」：标签宽度决定"摆在哪"，不该决定"谁先摆"。*/
    const V = await page.evaluate(() => {
        const TXT = '使人精神专一，动合无形，赡足万物。其为术也，因阴阳之大顺，采儒墨之善，撮名法之要，与时迁移，应物变化。';
        const box = document.createElement('div');
        box.className = 'reading-merged __v';
        box.style.cssText = 'font-size:14px;line-height:1.9;width:358px';
        box.innerHTML = '<p data-p="1">前面一段垫底的正文，让上面也有一条缝可用。</p>'
            + '<p data-p="2">' + TXT.replace('撮名法',
                '<mark class="rd-hl rd-hl-sky" data-hlid="A" data-gl="cuō·撮取、提取">撮</mark>'
              + '<mark class="rd-hl rd-hl-sky" data-hlid="B" data-gl="名家和法家两个学派的合称">名法</mark>') + '</p>'
            + '<p data-p="3">后面一段垫底的正文，让下面也有一条缝可用。</p>';
        const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
        const msg = document.createElement('div');
        msg.className = 'chat-msg ai __v'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
        document.body.appendChild(msg);
        document.documentElement.style.setProperty('--reading-pspace', '28px');
        box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
        rdGlLayout(bub);

        const one = id => {
            const lab = [...box.querySelectorAll('.rd-gl-label')].find(l => l.getAttribute('data-glid') === id);
            const mk = box.querySelector('mark[data-hlid="' + id + '"]');
            if (!lab || !mk) return null;
            const lr = lab.getBoundingClientRect(), mr = mk.getBoundingClientRect();
            return { labX: lr.left + lr.width / 2, top: lr.top, tgtX: mr.left + mr.width / 2 };
        };
        const A = one('A'), B = one('B');
        const r = {
            两条都画出来了: !!(A && B),
            // 同一条缝里才谈得上交叉；换到另一条缝是允许的退路（宁可换缝也不交叉）
            同缝: !!(A && B) && Math.abs(A.top - B.top) < 6,
            交叉: !!(A && B) && Math.abs(A.top - B.top) < 6 && ((A.tgtX < B.tgtX) !== (A.labX < B.labX)),
        };
        msg.remove();
        return r;
    });
    ok('V1 两条小注都画出来了', V.两条都画出来了);
    ok('V2 紧挨着的两个词、小注宽度差很多时引线不交叉（排序键只能用目标字位置）', !V.交叉,
        V.同缝 ? '两条在同一条缝' : '已挪到另一条缝（允许）');

    /* ===== W 组：别压到隔壁块的**字**（2026-08-06，用户截图报）=====
       她的原话：「主要就是想着能不遮挡字就好了」「遮挡背景词的那个块倒是没问题」
       「我也不想因为遮挡而过度压缩它的空间」。
       ⇒ 压到块的留白/背景色可以，压到字不行；而且**不许靠缩小标签或缩短离正文的距离**去换。
       修法＝选边时「装得下」优先于「离得近」：紧跟段落的批注框不吃段间距、那道缝是 0，
       注定压进块里；上面那条缝装得下就先试上面，整条落在空当里、一个字都不压。
       ⚠️这条判定必须写在 lh（标签高度）量出来之后——写在 nearUp 旁边时 lh 还是 undefined，
         `roomUp >= undefined+14` 恒 false，两边都判"装不下"，整条逻辑白写（我踩过）。 */
    async function _wCase(pspace) {
        return page.evaluate((ps) => {
            document.querySelectorAll('.__w').forEach(n => n.remove());
            document.documentElement.style.setProperty('--reading-pspace', ps + 'px');
            const host = document.createElement('div');
            host.className = 'chat-msg ai __w'; host.setAttribute('data-idx', '0');
            host.style.cssText = 'width:373px';
            /* ⚠️必须照抄**真实**的背景块结构：首行是 `<div class="reading-q">` 这个 **block**，
               里面「汐」还是个带色的 span。之前这里图省事写成纯文本 + <br>（inline），
               于是量出来的矩形贴着字、一切正常，把真凶完美掩盖了——真实结构里
               对 block 取 getClientRects() 返回的是**整行满宽的框**，导致代码永远以为
               "右边没地方可躲"。用户连报三次「还是没往右」，就是被这个假场景骗的。 */
            const bq = (w, body) => '<blockquote data-cp="1"><div class="reading-q">' +
                '<span class="reading-q-name">汐</span>：背景：' + w + '</div>' + body + '</blockquote>';
            host.innerHTML = '<div class="reading-merged">' +
                bq('韩司徒', '司徒是先秦时期一个很古老的官职，大致管的是民政这些事，跟管军事的司马并称。') +
                '<p data-p="1">所以，看起来张良会投入韩的阵营，与刘邦越走越远。可是当刘邦带领军队从洛阳南出时，张良又去找了刘邦。因为这个时候韩王的军事行动不太顺利，张良借着老交情去找刘邦帮忙。刘邦也够义气，就带着军队帮韩成打下了十几座城。用这种方式，韩王成得到了落脚的基地<mark class="rd-hl rd-hl-rose" data-hlid="hw" data-gl="yáng zhái·韩国故都，在今河南禹州">阳翟</mark>。也因为这样的交情，张良愿意跟着刘邦一起往南。</p>' +
                bq('阳翟', '阳翟大概在今天河南禹州一带，是个老资格的地方。战国时期它就是韩国的都城。') +
                '</div>';
            document.body.appendChild(host);
            rdGlLayout(host);
            const lab = host.querySelector('.rd-gl-label');
            if (!lab) return { err: '没生成小注' };
            const lb = lab.getBoundingClientRect();
            const para = host.querySelector('p[data-p="1"]');
            const pr = para.getBoundingClientRect();
            /* ⚠️数「压到字」也只能数**文字节点**的矩形，理由同上：对元素整体取 rects 会把
               block 子元素的满宽行框算进来，必假阳（我第一版就被自己这个假阳骗了一轮）。 */
            const textRects = (el) => {
                const out = [], rg = document.createRange();
                const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
                let n;
                while ((n = w.nextNode())) {
                    if (!n.nodeValue || !n.nodeValue.trim()) continue;
                    rg.selectNodeContents(n);
                    [...rg.getClientRects()].forEach(q => { if (q.width > 0 && q.height > 0) out.push(q); });
                }
                return out;
            };
            const hits = (el) => textRects(el).filter(q =>
                Math.min(lb.bottom, q.bottom) - Math.max(lb.top, q.top) > 1 &&
                Math.min(lb.right, q.right) - Math.max(lb.left, q.left) > 1).length;
            let bq2 = 0; host.querySelectorAll('blockquote').forEach(e => { bq2 += hits(e); });
            const r = { 压隔壁块的字: bq2, 压正文的字: hits(para), 在段落上方: lb.bottom <= pr.top,
                        标签宽: +lb.width.toFixed(1), 标签左: +lb.left.toFixed(1) };
            host.remove();
            return r;
        }, pspace);
    }
    const W28 = await _wCase(28);
    const W8 = await _wCase(8);
    ok('W1 段间距 28（用户实际设置）时，一个字都不压', !W28.err && W28.压隔壁块的字 === 0, JSON.stringify(W28));
    ok('W2 ⚠️别把「不压字」做成「一律往上」：躲得开时要保持就近（词在段落下半→往下）',
        !W28.err && !W28.在段落上方, JSON.stringify(W28));
    ok('W3 ⚠️不是靠压缩换的：标签宽度跟窄缝时一模一样', !W28.err && !W8.err && Math.abs(W28.标签宽 - W8.标签宽) < 1,
        '宽缝 ' + W28.标签宽 + ' / 窄缝 ' + W8.标签宽);
    ok('W4 ⚠️也不许压到正文自己的字', !W28.err && W28.压正文的字 === 0, JSON.stringify(W28));
    ok('W5 窄段间距下也不能比以前更糟', !W8.err && W8.压隔壁块的字 <= 2, JSON.stringify(W8));

    ok('J1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();

    let fail = 0;
    results.forEach(r => { if (!r.pass) fail++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(fail ? ('\n❌ 手写小注：' + fail + '/' + results.length + ' 条不通过') : ('\n✅ 手写小注：' + results.length + ' 条全过'));
    process.exit(fail ? 1 : 0);
})();
