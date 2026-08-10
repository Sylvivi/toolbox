/* 🎲 随机主题：不参与随机的皮肤名单（2026-08-10 加）。
 *
 * 用户原话：「可以不要随机到霞玫主题吗」。
 * ⚠️只是**不给随机摇到**——手动在主题小窗里照样能选。
 *
 * 跑法：node tests/themerandom.test.js   或   bash tests/p.sh themerandom
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
        out.名单 = THEME_RANDOM_SKIP.slice();
        out.霞玫在名单里 = THEME_RANDOM_SKIP.indexOf('rose') >= 0;
        // 摇很多次，霞玫一次都不许出现
        const got = new Set();
        for (let i = 0; i < 400; i++) got.add(THEMES[themeRandomRoll()].id);
        out.摇到的 = [...got].sort();
        out.没摇到霞玫 = !got.has('rose');
        out.别的都摇得到 = THEMES.filter(t => THEME_RANDOM_SKIP.indexOf(t.id) < 0).every(t => got.has(t.id));
        // ⚠️连着两次不许同一个（原有规则，别被名单改坏）
        let repeat = 0, prev = null;
        for (let i = 0; i < 300; i++) { const id = THEMES[themeRandomRoll()].id; if (id === prev) repeat++; prev = id; }
        out.不连着重复 = repeat === 0;
        // 上次正停在名单里的皮肤上 → 立刻重摇，不用等下次开机
        localStorage.setItem('toolbox_theme_last', 'rose');
        const idx = themeRandomIdx();
        out.停在霞玫会立刻换掉 = THEMES[idx].id !== 'rose';
        // 手动选霞玫仍然可以（名单只管随机）
        out.手动仍可选 = THEMES.some(t => t.id === 'rose');
        return out;
    });

    ok('A 名单里有霞玫', R.霞玫在名单里, JSON.stringify(R.名单));
    ok('B 摇 400 次一次都没摇到霞玫', R.没摇到霞玫, '摇到过：' + R.摇到的.join('/'));
    ok('C 其余皮肤都还摇得到', R.别的都摇得到);
    ok('D ⚠️连着两次不重复（原有规则没被改坏）', R.不连着重复);
    ok('E 上次正停在霞玫上 → 立刻换掉，不用等下次开机', R.停在霞玫会立刻换掉);
    ok('F 霞玫仍在皮肤表里（手动照样能选）', R.手动仍可选);
    ok('G 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 随机主题名单：${bad}/${results.length} 条失败` : `\n✅ 随机主题名单：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
