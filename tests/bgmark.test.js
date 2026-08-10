/* 「背景词」的手绘记号回归测试（2026-08-10 做）。
 *
 * 功能：标背景讲解过的那个词，在正文里被画上一个手绘记号（下划线/方框/圈，Rough.js 画的）。
 * 用户定的范围——**先做成满篇人名，她当场否了**，原话：
 *   「我想我其实并不是要让每个人名都要被渲染成那样，而是在有背景词解释的那个段落，
 *     把那个词儿给他渲染出来就行，不然确实会很花」。
 * 颜色「一词一支笔」：她原话「人名上的颜色是随机变的」，落地成按词钉死的随机色。
 *
 * 钉住的几条：
 *  A 组 只画「被解释的那个词」，别的人名一律不碰（否掉的那版就是满篇人名）
 *  B 组 词是从背景块第一行 `汐：背景：X` 抠出来的，且只认第一行
 *  C 组 同一个词全书同色同款；不同词要真的不一样（哈希分布）
 *  D 组 不动版面（记号全在绝对定位的 SVG 层上）
 *  E 组 开关 + 段落里找不到那个词时安静跳过
 *
 * 跑法：node tests/bgmark.test.js   或   bash tests/p.sh bgmark
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
        const N = s => '<span class="reading-name">' + s + '</span>';
        const bq = (cp, head, body) => '<blockquote data-cp="' + cp + '" data-ci="0" data-bg="1" '
            + 'style="margin:0.4em 0 0.6em;padding:0.5em 12px 0.4em;font-size:0.92em;line-height:1.6">'
            + '<div class="reading-q">' + head + '</div>' + (body || '正文说明。') + '</blockquote>';

        // paras: [{n, html}]，blocks: [{cp, head}]
        function build(paras, blocks) {
            document.querySelectorAll('.__bgt').forEach(n => n.remove());
            let html = '';
            paras.forEach(p => {
                html += '<p data-p="' + p.n + '">' + p.html + '</p>';
                blocks.filter(b => String(b.cp) === String(p.n)).forEach(b => { html += bq(b.cp, b.head); });
            });
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.8;width:358px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __bgt'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            bgMkLayout(bub);
            return { box, bub };
        }
        const P1 = '孙武是齐国人，后来跑到吴国，由' + N('伍子胥') + '引荐给' + N('阖闾') + '，孙武带来一部兵法，让孙武练兵。';   // ⚠️「孙武」故意出现三次
        const P2 = '楚昭王叫公子囊瓦带兵进攻吴国，吴则带兵迎击，在豫章大破楚军，又拿下一座城。';

        // ── A：只画被解释的那个词 ──
        {
            const a = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                            [{ cp: 1, head: '汐：背景：孙武' }, { cp: 2, head: '汐：背景：豫章' }]);
            out.A_画了几个 = a.box.querySelectorAll('.bg-mk-svg > g').length;
            /* ⚠️「孙武」在第 1 段出现三次、「豫章」一次 ＝ 四个记号。
               2026-08-10 用户报：「一段里面居然有多个背景词，相同的背景词哈，居然只划里面的一个」——
               第一版只 indexOf 一次就收工。出现几次画几次。 */
            out.A_每一处都画 = out.A_画了几个 === 4;
            // ⚠️别的人名（伍子胥/阖闾）一个都不许画——那是被否掉的「满篇人名」版
            out.A_没碰别的人名 = a.box.querySelectorAll('.reading-name.rn-mk, .rn-mk-layer').length === 0;
            // 没有背景块时，一层都不该建
            const b = build([{ n: 1, html: P1 }], []);
            out.A_没背景块就不画 = !b.box.querySelector('.bg-mk-layer');
        }

        // ── B：从背景块第一行抠词 ──
        {
            const mk = h => { const d = document.createElement('blockquote'); d.innerHTML = '<div class="reading-q">' + h + '</div>正文里也写了背景：别的东西'; return d; };
            out.B_普通 = bgMkTermOf(mk('汐：背景：孙武'));
            out.B_换了昵称 = bgMkTermOf(mk('小助手：背景：豫章'));       // 「汐」是可改的昵称，不能写死
            out.B_带书名号 = bgMkTermOf(mk('汐：背景：《孙子兵法》'));
            out.B_带标点 = bgMkTermOf(mk('汐：背景：囊瓦。'));
            out.B_不是背景块 = bgMkTermOf(mk('汐：这一段讲了什么'));
            out.B_一整句不要 = bgMkTermOf(mk('汐：背景：这里说的是春秋末年吴楚两国的形势变化'));
            out.B_对了 = out.B_普通 === '孙武' && out.B_换了昵称 === '豫章'
                      && out.B_带书名号 === '孙子兵法' && out.B_带标点 === '囊瓦'
                      && out.B_不是背景块 === '' && out.B_一整句不要 === '';
        }

        // ── C：一词一支笔（同词同色同款，不同词要真不一样）──
        {
            const a = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                            [{ cp: 1, head: '汐：背景：孙武' }, { cp: 2, head: '汐：背景：豫章' }]);
            const gs = [...a.box.querySelectorAll('.bg-mk-svg > g')];
            const colorOf = g => (g.querySelector('path') || {}).getAttribute ? g.querySelector('path').getAttribute('stroke') : '';
            out.C_两个词颜色 = gs.map(colorOf);
            out.C_两个词不同色 = new Set(out.C_两个词颜色).size === 2;
            const d1 = gs.map(g => g.querySelector('path').getAttribute('d')).join('|');
            bgMkLayout(a.bub);      // 重排（换字号/切主题）
            const d2 = [...a.box.querySelectorAll('.bg-mk-svg > g')].map(g => g.querySelector('path').getAttribute('d')).join('|');
            out.C_重排后一模一样 = d1 === d2;
            const b = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                            [{ cp: 1, head: '汐：背景：孙武' }, { cp: 2, head: '汐：背景：豫章' }]);
            const d3 = [...b.box.querySelectorAll('.bg-mk-svg > g')].map(g => g.querySelector('path').getAttribute('d')).join('|');
            out.C_重建后一模一样 = d1 === d3;
            /* ⚠️形状和颜色不许绑死：形状是 seed%3、颜色是 seed%6，共用一个 seed 的话
               （6 是 3 的倍数）六支笔只剩六种固定搭配。实拍过两个词一模一样都是紫圈。 */
            const kinds = new Set(), colors = new Set();
            const words = ['孙武', '豫章', '囊瓦', '阖闾', '伍子胥', '子常', '唐蔡', '楚昭王', '越国', '居巢', '夫概', '司马迁'];
            words.forEach(w => { kinds.add(BG_MK_KINDS[rdMkSeed(w) % BG_MK_KINDS.length]); colors.add(rdMkSeed(w + '·色') % 6); });
            out.C_形状种类 = kinds.size; out.C_颜色种类 = colors.size;
            out.C_分布够散 = kinds.size >= 2 && colors.size >= 5;
            /* ⚠️下划线有**三个字的门槛**（用户 2026-08-10 定：「下划线还是可以保留，
               但是得是三个字及以上」）：短词底下一条短线像笔误。 */
            const short2 = new Set(), long3 = new Set();
            for (let i = 0; i < 300; i++) {
                short2.add(bgMkPick('两字' + (i % 1 ? '' : ''), false, false));   // 恒 2 字
                short2.add(bgMkPick('孙武', false, false));
                long3.add(bgMkPick('伍子胥' + (i % 7 ? '' : ''), false, false));
            }
            for (let i = 0; i < 300; i++) long3.add(bgMkPick('词' + i + '子', false, false));   // 3 字以上
            out.C_两字没有下划线 = !short2.has('u');
            out.C_三字以上有下划线 = long3.has('u');
            out.C_跨行够长走下划线 = bgMkPick('伍子胥', true, false) === 'u';
            out.C_跨行太短走方框 = bgMkPick('孙武', true, false) === 'b';
            out.C_底下有线就避开 = (() => {
                for (let i = 0; i < 200; i++) if (bgMkPick('词' + i + '子', false, true) === 'u') return false;
                return true;
            })();
            // 同一个词的几处：形状/颜色一样，但歪法不能一模一样（否则像复制粘贴）
            const gg = [...a.box.querySelectorAll('.bg-mk-svg > g')].map(g => g.querySelector('path'));
            const sunwu = gg.slice(0, 3);
            out.C_同词同色 = new Set(sunwu.map(p => p.getAttribute('stroke'))).size === 1;
            out.C_同词歪法不同 = new Set(sunwu.map(p => p.getAttribute('d'))).size === 3;
        }

        // ── D：一个像素都不许动版面 ──
        {
            const before = build([{ n: 1, html: P1 }, { n: 2, html: P2 }], []);
            const rowsOf = p => { const r = document.createRange(); r.selectNodeContents(p); return [...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top * 10) / 10); };
            const b1 = rowsOf(before.box.querySelector('p[data-p="1"]'));
            const h1 = before.box.querySelector('p[data-p="1"]').getBoundingClientRect().height;
            const after = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                                [{ cp: 1, head: '汐：背景：孙武' }]);
            const p1 = after.box.querySelector('p[data-p="1"]');
            out.D_画上了 = after.box.querySelectorAll('.bg-mk-svg > g').length === 3;   // 「孙武」在这段出现三次
            out.D_行位置没变 = JSON.stringify(rowsOf(p1)) === JSON.stringify(b1);
            out.D_段落没变高 = Math.abs(p1.getBoundingClientRect().height - h1) < 0.5;
            out.D_层不吃点击 = getComputedStyle(after.box.querySelector('.bg-mk-svg')).pointerEvents === 'none';
        }

        // ── E：开关；段落里没有那个词时安静跳过 ──
        {
            // AI 换了说法，段落里根本没有「兵圣」两个字 → 不画，也不报错
            const a = build([{ n: 1, html: P1 }], [{ cp: 1, head: '汐：背景：兵圣' }]);
            out.E_找不到就不画 = !a.box.querySelector('.bg-mk-layer');
            const b = build([{ n: 1, html: P1 }], [{ cp: 1, head: '汐：背景：孙武' }]);
            out.E_默认是开的 = !document.body.classList.contains('bg-mk-off')
                            && !!b.box.querySelector('.bg-mk-svg > g');
            bgMkSetOn(false);
            out.E_关掉就没了 = !document.querySelector('.bg-mk-layer');
            bgMkSetOn(true);
            out.E_再开能补回来 = !!document.querySelector('.bg-mk-svg > g');
            out.E_存了本机 = localStorage.getItem('reading_bg_mark') === '1';
            // 同一个词讲两次，只画一次（别叠两个圈）
            const c = build([{ n: 1, html: P1 }], [{ cp: 1, head: '汐：背景：孙武' }, { cp: 1, head: '汐：背景：孙武' }]);
            // 同一个词有**两个背景块**时只处理一次（别把同几处各画两遍）
            out.E_同词只画一次 = c.box.querySelectorAll('.bg-mk-svg > g').length === 3;
        }

        /* ── G：日夜两套颜色 ──
           ⚠️⚠️钉的是一个真踩过的坑（2026-08-10）：夜间那套定义在 `body.dark` 上，
             而代码里却用 `getComputedStyle(document.documentElement)` 读——CSS 变量只往**下**继承，
             从 <html> 上读永远只拿到 :root 那套日间色，**切夜间等于没换色**。
             光看代码「两套都写了」完全看不出来，是用户问「有没有对颜色做日夜相适应」才查出来的。 */
        {
            const hadDark = document.body.classList.contains('dark');
            document.body.classList.remove('dark');
            const a = build([{ n: 1, html: P1 }, { n: 2, html: P2 }],
                            [{ cp: 1, head: '汐：背景：孙武' }, { cp: 2, head: '汐：背景：豫章' }]);
            const dayC = [...a.box.querySelectorAll('.bg-mk-svg > g path')].map(p => p.getAttribute('stroke'));
            document.body.classList.add('dark');
            bgMkLayout(a.bub);
            const nightC = [...a.box.querySelectorAll('.bg-mk-svg > g path')].map(p => p.getAttribute('stroke'));
            out.G_日间色 = [...new Set(dayC)];
            out.G_夜间色 = [...new Set(nightC)];
            out.G_切夜间换了色 = JSON.stringify(dayC) !== JSON.stringify(nightC) && nightC.length === dayC.length;
            // 荧光黄两边都是它（用户指定的那支笔，日夜都要是荧光黄）
            out.G_荧光黄两边都在 = out.G_日间色.indexOf('#ffe500') >= 0 && out.G_夜间色.indexOf('#ffe500') >= 0;
            if (!hadDark) document.body.classList.remove('dark');
            bgMkLayout(a.bub);
        }

        document.querySelectorAll('.__bgt').forEach(n => n.remove());
        return out;
    });

    ok('A1 ⚠️同一段里出现几次就画几次（孙武×3 + 豫章×1 = 4）', R.A_每一处都画, '实际 ' + R.A_画了几个 + ' 个');
    ok('A2 ⚠️别的人名一个都没碰（满篇人名那版已被否掉）', R.A_没碰别的人名);
    ok('A3 没有背景块时不建层', R.A_没背景块就不画);
    ok('B1 从背景块第一行抠词（含昵称/书名号/标点/整句）', R.B_对了,
       JSON.stringify([R.B_普通, R.B_换了昵称, R.B_带书名号, R.B_带标点, R.B_不是背景块, R.B_一整句不要]));
    ok('C1 两个不同的词是两支不同的笔', R.C_两个词不同色, JSON.stringify(R.C_两个词颜色));
    ok('C2 重排后一模一样（种子钉死）', R.C_重排后一模一样);
    ok('C3 重开一章后也一模一样', R.C_重建后一模一样);
    ok('C4 ⚠️形状与颜色不绑死、分布够散', R.C_分布够散, '形状 ' + R.C_形状种类 + ' 种 / 颜色 ' + R.C_颜色种类 + ' 种');
    ok('C5a ⚠️两个字的词不给下划线（门槛三个字）', R.C_两字没有下划线);
    ok('C5b 三个字及以上可以抽到下划线', R.C_三字以上有下划线);
    ok('C5c 跨行且够长 → 下划线（每行一条，不裂）', R.C_跨行够长走下划线);
    ok('C5d 跨行但太短 → 方框', R.C_跨行太短走方框);
    ok('C5e 底下已有别的下划线 → 避开', R.C_底下有线就避开);
    ok('C6 同一个词的几处：同一支笔', R.C_同词同色);
    ok('C7 同一个词的几处：歪法各不相同（不是复制粘贴）', R.C_同词歪法不同);
    ok('D1 前提：记号画上了', R.D_画上了);
    ok('D2 每一行的位置一个像素都没动', R.D_行位置没变);
    ok('D3 段落没有变高', R.D_段落没变高);
    ok('D4 记号层不吃点击（不挡划线/翻页）', R.D_层不吃点击);
    ok('E1 段落里找不到那个词 → 安静跳过', R.E_找不到就不画);
    ok('E2 默认开', R.E_默认是开的);
    ok('E3 关掉就没了', R.E_关掉就没了);
    ok('E4 再开能补回来', R.E_再开能补回来);
    ok('E5 开关存进本机', R.E_存了本机);
    ok('E6 同一个词有两个背景块时不重复画', R.E_同词只画一次);
    ok('G1 ⚠️切夜间确实换了另一套颜色（变量要从 body 读，不是 html）', R.G_切夜间换了色,
       '日 ' + JSON.stringify(R.G_日间色) + ' / 夜 ' + JSON.stringify(R.G_夜间色));
    ok('G2 荧光黄这支笔日夜都在', R.G_荧光黄两边都在);
    ok('F1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 背景词记号：${bad}/${results.length} 条失败` : `\n✅ 背景词记号：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
