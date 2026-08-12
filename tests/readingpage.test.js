/* 阅读模式「点上 20% 往回翻、点下 80% 往下翻」的回归测试。
 *
 * 起因：用户 2026-08-09「之前是点击即下滑，我现在有点希望分上半屏下半屏了，但是下半屏占主要的」。
 * 在这之前**根本没有往回翻这个动作**——点哪儿都是 readingPageDown，看漏一行只能手动滑回去。
 *
 * ⚠️这组守的是三件事，坏了都很隐蔽（用户只会说「怎么翻着翻着少了一段」）：
 *   ① 往回翻**绝不能跳字**：翻回去那一屏的底部，必须还盖着现在屏顶那一行（留一行接头）。
 *      所以判据不是「滚了多少像素」，而是「往下翻一次能不能一个字不差地回到原位」。
 *   ② 分界线按**阅读容器**算、不是 window——容器上头还有顶栏，用 window 会把分界整体抬高。
 *   ③ 到顶了点上面不能有反应（scrollTop 不许变成负数、也不许乱跳）。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 造一屏一屏读得下去的假正文：40 段、每段几行，塞进真正的 #chatMessages 容器。
// 不走导入书籍那套（那是另一组测试的事），这里只要 DOM 结构和真实阅读时一致：
// .reading-merged > p[data-p]，因为翻页函数就是按这个选择器逐行量位置的。
function bootReading() {
    // ⚠️#chatMessages 平时挂在 display:none 的 #chatModalOverlay 里，clientHeight 恒为 0，
    // 按行量位置那套全部退化成 0 —— 不先把浮层显示出来，这组测试会假绿。
    document.getElementById('chatModalOverlay').style.display = 'flex';
    const el = document.getElementById('chatMessages');
    el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'reading-merged';
    for (let i = 0; i < 40; i++) {
        const p = document.createElement('p');
        p.setAttribute('data-p', String(i + 1));
        p.textContent = '第' + (i + 1) + '段。' + '这是一段用来占位的正文文字，长度足够折成好几行，好让按行对齐那套逻辑真的有行可量。'.repeat(2);
        wrap.appendChild(p);
    }
    el.appendChild(wrap);
    // 容器得真的能滚：给个固定高度 + overflow
    el.style.height = '600px';
    el.style.overflowY = 'auto';
    el.scrollTop = 0;
    return { scrollH: el.scrollHeight, clientH: el.clientHeight };
}

// 屏幕最顶上那一行的文字（用「第一个底边露在容器顶下方的段落」+ 它的 data-p 当锚点）
function topAnchor() {
    const el = document.getElementById('chatMessages');
    const ctop = el.getBoundingClientRect().top;
    const ps = el.querySelectorAll('.reading-merged p[data-p]');
    for (const p of ps) {
        if (p.getBoundingClientRect().bottom > ctop + 4) return p.getAttribute('data-p');
    }
    return null;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    await page.goto(APP);
    await page.waitForTimeout(600);

    const boot = await page.evaluate(bootReading);
    ok('A1 假正文能滚（内容比容器高）', boot.scrollH > boot.clientH * 3, JSON.stringify(boot));

    // ── A 组：往回翻本身 ───────────────────────────────────────────
    // 先往下翻两屏，再往回翻一屏，看是不是回到「往下翻一屏」那个位置
    const a = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        el.scrollTop = 0;
        readingPageDown();
        const after1 = el.scrollTop;
        readingPageDown();
        const after2 = el.scrollTop;
        readingPageUp();
        const back = el.scrollTop;
        return { after1, after2, back, clientH: el.clientHeight };
    });
    ok('A2 往下翻确实在动', a.after1 > 0 && a.after2 > a.after1, JSON.stringify(a));
    // 往回翻一屏应该落回 after1 附近（按行对齐，允许一行左右的出入）
    ok('A3 往回翻一屏 ≈ 回到上一屏的位置', Math.abs(a.back - a.after1) <= 40,
        '回到 ' + a.back + ' / 上一屏在 ' + a.after1);
    ok('A4 往回翻没有翻过头（不该回到比上一屏更靠前）', a.back <= a.after1 + 40, JSON.stringify(a));

    // ⚠️最要紧的一条：往回翻不许跳字。
    // 判据＝「下翻→上翻」之后再下翻一次，必须还能到达原来那个位置的下一屏，
    // 也就是这一来一回中间没有任何一段被跨过去。
    const b = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        el.scrollTop = 0;
        readingPageDown(); readingPageDown(); readingPageDown();
        const mark = el.scrollTop;
        readingPageUp();
        const up = el.scrollTop;
        readingPageDown();
        return { mark, up, redown: el.scrollTop };
    });
    ok('A5 上翻再下翻能回到原位（＝中间没跳过内容）', Math.abs(b.redown - b.mark) <= 40,
        '原位 ' + b.mark + ' → 上翻 ' + b.up + ' → 再下翻 ' + b.redown);
    ok('A6 上翻确实往回走了一屏（不是原地不动）', b.mark - b.up > 300, JSON.stringify(b));

    // ── B 组：到顶的边界 ──────────────────────────────────────────
    const c = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        el.scrollTop = 0;
        readingPageUp();
        const atTop = el.scrollTop;
        // 只往下翻半屏那么点，再往回翻：不能滚成负数
        el.scrollTop = 120;
        readingPageUp();
        return { atTop, shallow: el.scrollTop };
    });
    eq('B1 已在顶部时往回翻＝不动', c.atTop, 0);
    ok('B2 只滚了一点点时往回翻不会变负数', c.shallow >= 0, '得到 ' + c.shallow);

    // ── C 组：上 20% / 下 80% 的分界 ─────────────────────────────
    // ⚠️分界要按容器算。测试里故意把容器往下推 100px，模拟顶栏占位；
    // 若实现里写的是 window.innerHeight，这一组就会挂。
    const d = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        const r = el.getBoundingClientRect();
        const probe = (frac) => {
            el.scrollTop = 2000;
            const before = el.scrollTop;
            readingTapPage(r.top + r.height * frac);
            return el.scrollTop - before;
        };
        return {
            ratio: window.READING_TAP_UP_RATIO,
            top10: probe(0.10),   // 上 20% 内 → 往回（负）
            top18: probe(0.18),   // 贴着分界线之上 → 仍往回（负）
            mid25: probe(0.25),   // 已过分界 → 往下（正）
            mid40: probe(0.40),   // 更下面 → 往下（正）
            bottom90: probe(0.90) // 下 2/3 → 往下（正）
        };
    });
    /* ⚠️0.33 → 0.20（2026-08-12 用户：「上屏上滑的区域最好只占20%，不然真的有点容易误触」）。
       往回翻是低频动作、往下翻每分钟都在做，所以这条线宁可靠上。 */
    eq('C1 分界比例是 0.20', d.ratio, 0.20);
    ok('C2 点最上面 10% → 往回翻', d.top10 < 0, '位移 ' + d.top10);
    ok('C3 点 18%（贴着分界线之上）→ 往回翻', d.top18 < 0, '位移 ' + d.top18);
    ok('C4 点 25%（分界线之下）→ 往下翻', d.mid25 > 0, '位移 ' + d.mid25);
    ok('C4b 点 40% → 往下翻（原来这儿是往回翻的）', d.mid40 > 0, '位移 ' + d.mid40);
    ok('C5 点最下面 90% → 往下翻', d.bottom90 > 0, '位移 ' + d.bottom90);

    // C6：容器被顶栏往下推之后，分界线要跟着走。
    // 把容器整体下移 200px，再点「屏幕绝对高度的 20%」——那个位置此时落在容器之上/极靠上，
    // 关键是点容器自身的 40% 仍必须是往下翻。
    const e = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        el.style.marginTop = '200px';
        const r = el.getBoundingClientRect();
        el.scrollTop = 2000;
        const before = el.scrollTop;
        readingTapPage(r.top + r.height * 0.40);
        const d1 = el.scrollTop - before;
        el.scrollTop = 2000;
        const before2 = el.scrollTop;
        /* ⚠️探 10%、别探 20%：分界线本身就是 20%，落在线上按实现是「往下翻」，
           拿它当「线内」测会假红（2026-08-12 把比例从 0.33 收到 0.20 时踩到）。 */
        readingTapPage(r.top + r.height * 0.10);
        const d2 = el.scrollTop - before2;
        el.style.marginTop = '';
        return { d1, d2, top: r.top };
    });
    ok('C6 容器被顶栏推下去后，容器 40% 处仍是往下翻', e.d1 > 0, '位移 ' + e.d1 + '（容器顶 ' + e.top + '）');
    ok('C7 容器被顶栏推下去后，容器 10% 处仍是往回翻', e.d2 < 0, '位移 ' + e.d2);

    await browser.close();

    let fail = 0;
    for (const r of results) {
        if (!r.pass) fail++;
        console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail));
    }
    console.log(fail === 0 ? '  全部通过 (' + results.length + ')' : '  ' + fail + ' 条失败');
    process.exit(fail === 0 ? 0 : 1);
})();
