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
            out.D_有记号图 = !!mk.style.getPropertyValue('--mk-img');
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
                mk2.classList.add('rd-mk', 'rd-mk-' + k);                    // 强行套上这一种
                mk2.style.setProperty('--mk-img', rdMkImg(k, '#d9a400', 'rgba(255,207,46,0.55)'));
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

        // ── G：四种图都画得出来，且不同颜色/明暗各生成各的 ──
        {
            const imgs = ['u', 'b', 'c', 'h'].map(k => rdMkImg(k, '#d9a400', 'rgba(255,207,46,0.55)'));
            out.G_四种都有图 = imgs.every(s => s.indexOf('data:image/svg+xml') > 0);
            out.G_四种互不相同 = new Set(imgs).size === 4;
            out.G_都带抖动滤镜 = imgs.every(s => decodeURIComponent(s).indexOf('feDisplacementMap') > 0);
            out.G_荧光用填充色 = decodeURIComponent(imgs[3]).indexOf('rgba(255,207,46,0.55)') > 0;
            out.G_描边用墨色 = decodeURIComponent(imgs[2]).indexOf('#d9a400') > 0;
            out.G_换色是另一张 = rdMkImg('c', '#e85f7f', 'x') !== imgs[2];
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
    ok('G1 四种图都生成得出来', R.G_四种都有图);
    ok('G2 四种图互不相同', R.G_四种互不相同);
    ok('G3 都带手绘抖动滤镜', R.G_都带抖动滤镜);
    ok('G4 荧光用的是原色带那个浓度', R.G_荧光用填充色);
    ok('G5 框/圈用深色描边', R.G_描边用墨色);
    ok('G6 换个划线颜色就是另一张图', R.G_换色是另一张);
    ok('H1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 小注手绘记号：${bad}/${results.length} 条失败` : `\n✅ 小注手绘记号：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
