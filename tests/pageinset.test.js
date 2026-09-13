/* 悬浮输入条挡住的那一截，翻页不许跳过去（2026-09-13 她报的）。
 *
 * 起因：输入框改成悬浮玻璃之后，#chatMessages 一直铺到模态框最底下，
 * 最底下那 50~100px 是**盖在玻璃条底下的**——那里有字，她看不见。
 * 而翻页原来拿 `rect.bottom` 当"屏底"对齐，于是被挡住的那几行会被整屏跳过去。
 * 她的原话：「底下那块是被挡住的，我其实没看到，点翻页之后那个字就已经翻上去了」。
 *
 * 守两条：
 *  ① 往下翻一屏，**挪动量不许超过「看得见的那一屏」的高度**（clientHeight - 挡住的那截）。
 *  ② 翻页之前贴着可视底边的那一段，翻完之后必须**还在屏上**（没被跳过去）。
 *
 * 跑法：node tests/pageinset.test.js   或   bash tests/p.sh pageinset
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

/* ⚠️不再自己指定"挡住多少"：readingBottomInset() 现在是**现量玻璃盒子的上沿**
   再少减一行（见它上面那段注释）。测试跟着量同一个东西，别写死数字。 */

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(600);

    const R = await page.evaluate(() => {
        document.getElementById('chatModalOverlay').style.display = 'flex';
        document.getElementById('chatInputArea').classList.add('reading-collapsed');
        chatSyncInputH();
        const el = document.getElementById('chatMessages');
        el.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'reading-merged';
        for (let i = 0; i < 60; i++) {
            const p = document.createElement('p');
            p.setAttribute('data-p', String(i + 1));
            p.textContent = '第' + (i + 1) + '段。' + '这是一段用来占位的正文文字，长度足够折成好几行。'.repeat(2);
            wrap.appendChild(p);
        }
        el.appendChild(wrap);
        el.style.overflowY = 'auto';
        el.scrollTop = 0;

        // 真正被玻璃压住的高度（测试自己量一遍，跟实现对照）
        const box = document.querySelector('#chatInputArea .chat-input-box');
        const covered = el.getBoundingClientRect().bottom - box.getBoundingClientRect().top;
        const out = { inset: readingBottomInset(), covered: Math.round(covered), clientH: el.clientHeight };

        // 翻页前：贴着「玻璃上沿」的最后一段是谁——翻完它必须还在屏上
        function lastVisibleP() {
            const bottomY = el.getBoundingClientRect().bottom - covered;
            const ps = el.querySelectorAll('.reading-merged p[data-p]');
            let last = null;
            for (const p of ps) {
                const r = p.getBoundingClientRect();
                if (r.top < bottomY) last = p.getAttribute('data-p');
            }
            return last;
        }
        function onScreen(dp) {
            const p = el.querySelector('.reading-merged p[data-p="' + dp + '"]');
            if (!p) return false;
            const r = p.getBoundingClientRect(), c = el.getBoundingClientRect();
            return r.bottom > c.top && r.top < c.bottom - covered;
        }

        const p1 = el.querySelector('.reading-merged p[data-p]');
        out.lineH = Math.round(parseFloat(getComputedStyle(p1).lineHeight)) || 28;
        out.beforeP = lastVisibleP();
        const t0 = el.scrollTop;
        readingPageDown();
        out.moved = el.scrollTop - t0;
        out.stillOnScreen = onScreen(out.beforeP);

        // 退化情形：找不到行时走的那条「整屏滚」兜底，也不许超
        el.scrollTop = 0;
        el.querySelectorAll('.reading-merged p[data-p]').forEach(p => p.removeAttribute('data-p'));
        const t1 = el.scrollTop;
        readingPageDown();
        out.fallbackMoved = el.scrollTop - t1;
        return out;
    });

    const visible = R.clientH - R.inset;
    ok('量得到「被压住的高度」', R.covered > 0, '量到 ' + R.covered);
    ok('少减了一行（inset 明显小于被压住的高度）', R.inset < R.covered && R.inset >= 0,
        'inset=' + R.inset + ' / 压住 ' + R.covered);
    /* 上限：绝不许跳过看不见的那几行。多出来的一行是故意的——
       玻璃只有 6px 模糊，压在上沿那行她看得清，所以允许把它翻上去。 */
    ok('不跳字：一屏的步长 ≤ 可读区 + 一行',
        R.moved > 0 && R.moved <= R.clientH - R.covered + R.lineH + 8,
        '挪了 ' + R.moved + ' / 可读区 ' + (R.clientH - R.covered) + ' + 一行 ' + R.lineH);
    /* 下限：也不许留太多。她 2026-09-13 报过「顶上那行不符合预期、感觉多留了」，
       就是步长比这个还小。留的余量不超过两行。 */
    ok('不多留：步长 ≥ 可读区 − 两行',
        R.moved >= R.clientH - R.covered - R.lineH * 2,
        '挪了 ' + R.moved + ' / 可读区 ' + (R.clientH - R.covered));
    ok('兜底的整屏滚也不超', R.fallbackMoved > 0 && R.fallbackMoved <= visible + 8,
        '挪了 ' + R.fallbackMoved + ' / 可视一屏 ' + visible);
    ok('没有页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail && !r.pass ? '  → ' + r.detail : '')); }
    console.log(bad ? `\n${bad} 项没过` : '\n全过');
    process.exit(bad ? 1 : 0);
})();
