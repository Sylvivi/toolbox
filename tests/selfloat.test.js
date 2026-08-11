/* 选中小条「跟着选区走」的落位——2026-08-11 加。
 *
 * 用户原话：「选中文字的那个小条，可不可以跟着选中走呀，别固定在下面了，但是要注意选中的
 * 同时，浏览器自带的那个复制小条会跟着走，所以要注意避让，不然会被挡住，这就是我一开始
 * 让小条固定的原因」。
 *
 * ⚠️⚠️**这个测试真正要钉住的是「给系统气泡让路」那一档**（B 组）。
 *   系统自带的「复制/分享」气泡不是页面元素——量不到、盖不住、也测不了它，
 *   我们只能预判它的位置（手机浏览器一律优先贴在选区**上方**）并反着躲：
 *     ① 默认放选区**下方**；
 *     ② 下方塞不开才翻到上方，且必须**多空出一整个气泡的高度**跳过去；
 *     ③ 上下都塞不开 → 退回老的底部停靠 .rd-dock（离选区最远，永远不会被挡）。
 *   B 组那条「跟选区之间留够空档」如果被谁改小了，线上表现就是**小条被系统气泡整个盖住**，
 *   而这正是用户当初让它固定在底部的原因。别把它当成"美观参数"随手调。
 *
 * 跑法：node tests/selfloat.test.js   或   bash tests/p.sh selfloat
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
        const VH = window.innerHeight, VW = window.innerWidth;
        chatCurrentConvId = 'reader_test_selfloat';

        /* 造一段正文，用 position:fixed 钉在指定高度——坐标必须可控，
           否则「靠近屏幕底部」这种档次根本没法稳定复现。 */
        function makePara(topPx, text) {
            document.querySelectorAll('.__sf').forEach(n => n.remove());
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = '<p data-p="1">' + text + '</p>';
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __sf';
            msg.setAttribute('data-idx', '0');
            msg.style.cssText = 'position:fixed;left:16px;width:358px;top:' + topPx + 'px;margin:0';
            msg.appendChild(bub);
            document.body.appendChild(msg);
            return box.querySelector('p[data-p="1"]');
        }
        function pick(p, word) {
            const t = p.firstChild;
            const at = word === null ? 0 : p.textContent.indexOf(word);
            const len = word === null ? p.textContent.length : word.length;
            const rg = document.createRange();
            rg.setStart(t, at); rg.setEnd(t, at + len);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
            rdHlShowSelBar({ p: p, range: rg, msgIdx: 0, pNum: 1 });
            const bar = document.getElementById('rdHlBar');
            return { bar: bar, br: bar ? bar.getBoundingClientRect() : null, sr: rg.getBoundingClientRect() };
        }
        const SHORT = '那年山里落了很大的雪，门前石阶上生满青苔，屋中雾气氤氲。';
        /* ⚠️A 组专用的短句：只有一行，且要选的词在**行中间**。
           别拿长句里靠行尾的词去测「横向对着选区中心」——那种位置会被
           「不许超出屏幕」那步夹到边上，中心自然对不上，测出来的是夹边不是没对齐。 */
        const ONELINE = '山中雾气氤氲落雪';
        const LONG = SHORT.repeat(45);   // 够长，能从屏幕上方一路盖过下方（C 组要上下都塞不开）

        // ── A：选区在屏幕中间 → 浮在选区下方 ──
        {
            const p = makePara(300, ONELINE);
            const r = pick(p, '氤氲');
            out.A_有小条 = !!r.bar;
            out.A_是浮动档 = !!(r.bar && r.bar.classList.contains('rd-selfloat'));
            out.A_不是底部停靠 = !!(r.bar && !r.bar.classList.contains('rd-dock'));
            out.A_在选区下方 = !!(r.br && r.br.top >= r.sr.bottom);
            out.A_没盖住选中的字 = !!(r.br && r.br.top >= r.sr.bottom);
            out.A_横向没出界 = !!(r.br && r.br.left >= 7 && r.br.right <= VW - 7);
            // 横向大致对着选区中心（贴边被夹住时不强求，这里选区在中间不会被夹）
            out.A_对着选区中心 = !!(r.br && Math.abs((r.br.left + r.br.right) / 2 - (r.sr.left + r.sr.right) / 2) < 2);
            /* ⚠️呼吸缝是她当天调过的值（10 → 20，原话「略微有点近，可以往下移一些更好，
               留出些空间，也防止点错」）。上下都留窗口：太小＝手指够小条时蹭到正文取消选区，
               太大＝不像从这几个字身上长出来的，而且下方那档余量本来就紧。 */
            out.A_呼吸缝 = r.br ? Math.round(r.br.top - r.sr.bottom) : -1;
            out.A_缝够宽不误触 = out.A_呼吸缝 >= 15;
            out.A_离选区不远 = out.A_呼吸缝 <= 28;
        }

        // ── B：选区贴近屏幕底部 → 翻到上方，且必须给系统气泡留出整整一截 ──
        {
            const p = makePara(VH - 40, SHORT);
            const r = pick(p, '氤氲');
            out.B_是浮动档 = !!(r.bar && r.bar.classList.contains('rd-selfloat'));
            out.B_翻到上方 = !!(r.br && r.br.bottom <= r.sr.top);
            // ⚠️核心断言：小条底边到选区顶边至少留 50px，够系统气泡站进去
            out.B_空档 = r.br ? Math.round(r.sr.top - r.br.bottom) : -1;
            out.B_给气泡留够空档 = out.B_空档 >= 50;
            out.B_没顶出屏幕 = !!(r.br && r.br.top >= 7);
        }

        // ── C：选区又高又满（上下都塞不开）→ 退回底部停靠 ──
        {
            const p = makePara(70, LONG);
            const r = pick(p, null);   // 整段全选，从屏幕上方一路盖到下方
            out.C_选区确实很高 = !!(r.sr && r.sr.top < 104 && r.sr.bottom > VH - 58);
            out.C_退回底部停靠 = !!(r.bar && r.bar.classList.contains('rd-dock'));
            out.C_擦掉了浮动档 = !!(r.bar && !r.bar.classList.contains('rd-selfloat'));
            // 兜底档的位置整个交回 CSS，不能留着上一档写的行内坐标
            out.C_没留行内坐标 = !!(r.bar && !r.bar.style.top && !r.bar.style.left);
        }

        // ── D：底部停靠这条退路本身还在（CSS 没被顺手删掉）──
        {
            const probe = document.createElement('div');
            probe.className = 'rd-hl-bar rd-dock __sf';
            document.body.appendChild(probe);
            const cs = getComputedStyle(probe);
            out.D_停靠样式还在 = cs.position === 'fixed' && cs.bottom !== 'auto' && cs.bottom !== '0px';
        }

        document.querySelectorAll('.__sf').forEach(n => n.remove());
        rdHlHideBar();
        try { window.getSelection().removeAllRanges(); } catch (e) {}
        return out;
    });

    ok('A 选区在屏幕中间：冒出了小条', R.A_有小条);
    ok('A 走的是浮动档（不再固定底部）', R.A_是浮动档 && R.A_不是底部停靠);
    ok('A 浮在选区下方（系统气泡默认占的是上方）', R.A_在选区下方);
    ok('A 没盖住选中的字', R.A_没盖住选中的字);
    ok('A 横向没出屏幕', R.A_横向没出界);
    ok('A 横向对着选区中心', R.A_对着选区中心);
    ok('A 呼吸缝够宽、不容易点错', R.A_缝够宽不误触, '实测 ' + R.A_呼吸缝 + 'px（要 15~28）');
    ok('A 就跟在选区旁边（不是甩到远处）', R.A_离选区不远);
    ok('B 选区贴底时翻到选区上方', R.B_是浮动档 && R.B_翻到上方);
    ok('B ⚠️给系统复制气泡留够了空档', R.B_给气泡留够空档, '实测空档 ' + R.B_空档 + 'px（要 ≥50）');
    ok('B 没被顶出屏幕', R.B_没顶出屏幕);
    ok('C 选区又高又满（前提）', R.C_选区确实很高);
    ok('C 上下都塞不开时退回底部停靠', R.C_退回底部停靠);
    ok('C 退回时擦掉了浮动档', R.C_擦掉了浮动档);
    ok('C 退回时没留下行内坐标', R.C_没留行内坐标);
    ok('D 底部停靠这条退路的样式还在', R.D_停靠样式还在);
    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
