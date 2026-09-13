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

const INSET = 90;   // 假装悬浮输入条有这么高

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(600);

    const R = await page.evaluate((INSET) => {
        document.getElementById('chatModalOverlay').style.display = 'flex';
        document.documentElement.style.setProperty('--chat-ih', INSET + 'px');
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
        el.style.height = '600px';
        el.style.overflowY = 'auto';
        el.scrollTop = 0;

        const out = { inset: readingBottomInset(), clientH: el.clientHeight };

        // 翻页前：贴着「看得见的底边」的最后一段是谁
        function lastVisibleP() {
            const bottomY = el.getBoundingClientRect().bottom - INSET;
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
            return r.bottom > c.top && r.top < c.bottom - INSET;
        }

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
    }, INSET);

    const visible = R.clientH - INSET;
    ok('读得到挡住的高度', R.inset === INSET, '量到 ' + R.inset);
    ok('往下翻一屏 ≤ 看得见的那一屏', R.moved > 0 && R.moved <= visible + 8,
        '挪了 ' + R.moved + ' / 可视一屏 ' + visible);
    ok('翻页前贴着底边的那段，翻完还在屏上', R.stillOnScreen === true, '第 ' + R.beforeP + ' 段');
    ok('兜底的整屏滚也不超', R.fallbackMoved > 0 && R.fallbackMoved <= visible + 8,
        '挪了 ' + R.fallbackMoved + ' / 可视一屏 ' + visible);
    ok('没有页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail && !r.pass ? '  → ' + r.detail : '')); }
    console.log(bad ? `\n${bad} 项没过` : '\n全过');
    process.exit(bad ? 1 : 0);
})();
