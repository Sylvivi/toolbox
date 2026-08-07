/* 精句「着色」按日夜各记一份的回归测试（2026-08-07 加）。
 *
 * 起因：用户「能不能改一个功能，就是夜间模式的时候，精句默认着色，
 * 日间模式的时候精句取消着色」。追问「手动改了要不要记住」时她选了
 * **「按日夜各记一份」**（而不是「模式说了算」）。
 *
 * 守五件事：
 *   ① 默认：夜间开、日间关。
 *   ② 切模式时自动跟着换（applyTheme 末尾要重新读一次）。
 *   ③ ⚠️手动改**只影响当前模式**，另一个模式不受牵连。
 *   ④ ⚠️手动改要**一直记着**——切走再切回来还是改过的样子。
 *      这是她选「各记一份」而非「模式说了算」的全部意义，改成无脑覆盖就等于没听她的。
 *   ⑤ ⚠️只有「着色」分日夜，其余五项（加粗/柔光/波浪/画框/划线）仍共用一份，别顺手拆了。
 *
 * 跑法：bash tests/p.sh kshlmode
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    await page.addScriptTag({ content: `
        // 直接摆弄 dark 类来模拟日夜，再走 readingApplyKeySentStyles 重新读——
        // 跟 applyTheme 里那一步等价，但不必真去切主题（那会连带动一堆别的东西）。
        window.__setDark = function (on) {
            document.body.classList.toggle('dark', !!on);
            readingApplyKeySentStyles();
        };
        window.__hlOn = function () { return document.body.classList.contains('reading-ks-hl'); };
        window.__reset = function () {
            ['reading_ks_hl', 'reading_ks_hl_day', 'reading_ks_hl_night'].forEach(function (k) { localStorage.removeItem(k); });
        };
    ` });

    /* ── A 组：① 默认夜间开、日间关 ─────────────────────────────── */
    const A = await page.evaluate(() => {
        window.__reset();
        window.__setDark(true);  const 夜 = window.__hlOn();
        window.__setDark(false); const 日 = window.__hlOn();
        return { 夜, 日 };
    });
    eq('① 默认：夜间着色开、日间着色关', [A.夜, A.日], [true, false]);

    /* ── B 组：② 切模式自动跟着换（来回切几次都稳） ────────────── */
    const B = await page.evaluate(() => {
        window.__reset();
        const seq = [];
        [true, false, true, false].forEach(function (d) { window.__setDark(d); seq.push(window.__hlOn()); });
        return seq;
    });
    eq('② 来回切模式，着色跟着走', B, [true, false, true, false]);

    /* ── C 组：③ 手动改只影响当前模式 ──────────────────────────── */
    const C = await page.evaluate(() => {
        window.__reset();
        window.__setDark(false);                    // 日间（默认关）
        readingToggleKeySentStyle('hl');            // 手动开
        const 日改后 = window.__hlOn();
        window.__setDark(true);                     // 切到夜间
        const 夜有没有被牵连 = window.__hlOn();       // 应该还是默认的「开」
        return { 日改后, 夜有没有被牵连 };
    });
    eq('③ 日间手动开了之后，日间是开的', C.日改后, true);
    eq('③ 夜间没被牵连（仍是它自己那一份）', C.夜有没有被牵连, true);

    /* ── D 组：③+④ 夜间关掉，日间不受影响，且切回来还记着 ──────── */
    const D = await page.evaluate(() => {
        window.__reset();
        window.__setDark(true);                     // 夜间（默认开）
        readingToggleKeySentStyle('hl');            // 手动关掉
        const 夜改后 = window.__hlOn();
        window.__setDark(false);
        const 日仍是默认关 = window.__hlOn();
        window.__setDark(true);                     // 切回夜间
        const 夜切回来 = window.__hlOn();
        return { 夜改后, 日仍是默认关, 夜切回来 };
    });
    eq('③ 夜间手动关掉后是关的', D.夜改后, false);
    eq('③ 日间没被牵连（还是默认的关）', D.日仍是默认关, false);
    /* ⚠️这条就是「各记一份」和「模式说了算」的分水岭：
       改成切模式无脑覆盖的话，这里会变回 true。 */
    eq('④ ⚠️切走再切回夜间，仍是手动改过的「关」', D.夜切回来, false);

    /* ── E 组：⑤ 其余五项仍共用一份，没被顺手拆掉 ──────────────── */
    const E = await page.evaluate(() => {
        localStorage.removeItem('reading_ks_bold');
        window.__setDark(true);
        readingToggleKeySentStyle('bold');          // 夜间开加粗
        const 夜 = document.body.classList.contains('reading-ks-bold');
        window.__setDark(false);
        const 日 = document.body.classList.contains('reading-ks-bold');
        return { 夜, 日, 有没有多出日夜键: !!(localStorage.getItem('reading_ks_bold_day') || localStorage.getItem('reading_ks_bold_night')) };
    });
    eq('⑤ 加粗仍是日夜共用（夜间开了，日间也是开的）', [E.夜, E.日], [true, true]);
    ok('⑤ 没给加粗多造日夜两份键', !E.有没有多出日夜键, JSON.stringify(E));

    /* ── F 组：⚠️走**真实路径**（setNightMode → applyTheme）也要生效 ──
       上面几组是直接调 readingApplyKeySentStyles 模拟的，快但绕过了真正的入口。
       挂钩要是漏在 applyTheme 里没加，上面全绿、用户点按钮却没反应——这组专防这个。 */
    const F = await page.evaluate(() => {
        window.__reset();
        localStorage.removeItem('reading_ks_bold');
        setNightMode(true);
        const 夜 = { dark: document.body.classList.contains('dark'), hl: window.__hlOn() };
        setNightMode(false);
        const 日 = { dark: document.body.classList.contains('dark'), hl: window.__hlOn() };
        return { 夜, 日 };
    });
    ok('F 前提：setNightMode 真的切了深浅（不然这组没意义）',
        F.夜.dark === true && F.日.dark === false, JSON.stringify(F));
    eq('⚠️走真实入口 setNightMode：夜间着色开、日间着色关', [F.夜.hl, F.日.hl], [true, false]);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) {
        if (r.pass) console.log('  ✅ ' + r.name);
        else { bad++; console.log('  ❌ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
    }
    console.log((bad ? '❌ ' : '✅ ') + (results.length - bad) + '/' + results.length + ' 通过');
    process.exit(bad ? 1 : 0);
})();
