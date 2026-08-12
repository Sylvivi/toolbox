/* 引号「长短分工」回归测试（2026-08-12 补的）。
 *
 * 为什么补：这套分工一直没有自动化覆盖。2026-08-12 拆「手绘线」时我按
 * 「从这段注释删到那段注释」整块切，把夹在中间、跟手绘线毫无关系的四条 strip 规则
 * 一并带走了，表现是用户报的「长短没有再区分了，波浪线应用于所有引号内」。
 * 纯 CSS 的规则最容易这样悄悄消失——没人调用它，删了也不报错，只能靠测试钉住。
 *
 * 分工规则（body.reading-ls-on）：
 *   着色 → 只落长句(rq-wide)；波浪 → 只落短句；
 *   划线 → 短句被波浪占住时(ls-pd)落长句，没被占住时落短句。
 * 关掉分工(reading-ls-on 不在)：所选样式对所有引号一视同仁。
 *
 * 跑法：node tests/quotesplit.test.js   或   bash tests/p.sh quotesplit
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
        // 一段里放一短一长两句引号；长句靠 rq-wide 标记（正文里由 ≥16 字自动打）
        const box = document.createElement('div');
        box.className = 'reading-merged';
        box.style.cssText = 'font-size:14px;line-height:1.8;width:358px';
        box.innerHTML = '<p data-p="1">他说'
            + '<span class="reading-quote" id="qs">「<span class="reading-quote-inner" id="qsi">不必再提</span>」</span>'
            + '，又说'
            + '<span class="reading-quote rq-wide" id="qw">「<span class="reading-quote-inner" id="qwi">当年那桩事牵连甚广，如今再翻出来怕是谁也担待不起</span>」</span>'
            + '。</p>';
        const msg = document.createElement('div');
        msg.className = 'chat-msg ai __qs'; msg.setAttribute('data-idx', '0');
        const bub = document.createElement('div'); bub.className = 'chat-bubble';
        bub.appendChild(box); msg.appendChild(bub); document.body.appendChild(msg);

        const 短 = () => document.getElementById('qsi');
        const 长 = () => document.getElementById('qwi');
        const 有波浪 = el => getComputedStyle(el).backgroundImage !== 'none';
        const 有划线 = el => getComputedStyle(el).textDecorationLine.indexOf('underline') >= 0;
        const 着色 = el => getComputedStyle(el.closest('.reading-quote')).color;

        // set(样式...)：直接写开关再 apply，绕开 toggle 的「反转」语义
        const set = o => {
            localStorage.setItem('reading_quote_wave', o.wave ? '1' : '0');
            localStorage.setItem('reading_quote_ul', o.ul ? '1' : '0');
            localStorage.setItem('reading_quote_hl', o.hl ? '1' : '0');
            localStorage.setItem('reading_quote_split', o.split ? '1' : '0');
            readingApplyQuoteStyles();
        };

        /* ── A：⚠️分工开着时，波浪只落短句 ──
           这就是 2026-08-12 被误删的那条 strip 规则管的事，用户当天报的就是它没了。 */
        {
            set({ wave: true, split: true });
            out.A_短句有波浪 = 有波浪(短());
            out.A_长句没波浪 = !有波浪(长());
            out.A_分工真的生效 = out.A_短句有波浪 && out.A_长句没波浪;
        }

        // ── B：分工关掉 → 一视同仁，长短都有波浪 ──
        {
            set({ wave: true, split: false });
            out.B_关掉后长短都有 = 有波浪(短()) && 有波浪(长());
        }

        /* ── C：划线的归属 ──
           ① 短句被波浪占住(ls-pd) → 划线移到长句；② 短句没被占住 → 划线落短句。 */
        {
            set({ wave: true, ul: true, split: true });
            out.C_有波浪时划线归长句 = 有划线(长()) && !有划线(短());
            set({ wave: false, ul: true, split: true });
            out.C_没波浪时划线归短句 = 有划线(短()) && !有划线(长());
        }

        // ── D：着色只落长句 ──
        {
            set({ wave: true, hl: true, split: true });
            out.D_长句着色 = 着色(长());
            out.D_短句不着色 = 着色(短());
            out.D_着色只落长句 = out.D_长句着色 !== out.D_短句不着色;
        }

        document.querySelectorAll('.__qs').forEach(n => n.remove());
        set({ wave: true, split: true });
        return out;
    });

    ok('A1 ⚠️⚠️分工开：波浪只落短句、长句要被清掉', R.A_分工真的生效,
       '短句有波浪=' + R.A_短句有波浪 + ' 长句没波浪=' + R.A_长句没波浪);
    ok('B1 分工关：长短一视同仁，都有波浪', R.B_关掉后长短都有);
    ok('C1 短句被波浪占住时，划线归长句', R.C_有波浪时划线归长句);
    ok('C2 短句没被占住时，划线归短句', R.C_没波浪时划线归短句);
    ok('D1 分工开：着色只落长句', R.D_着色只落长句, '长=' + R.D_长句着色 + ' 短=' + R.D_短句不着色);
    ok('Z 页面没报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.detail ? '  — ' + r.detail : '')));
    console.log(bad.length ? ('❌ 引号长短分工：' + bad.length + '/' + results.length + ' 条失败')
                           : ('✅ 引号长短分工：' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})();
