/* 阅读层底下「露出一截首页」那个毛病（2026-09-20 她报的）。
 *
 * 现象：「关掉后台再启动，刚进去那会儿底下会露出一截，能看到主页、收藏、密钥那些，
 * 刷新一下才消失」。
 *
 * 病根：`openChatModal()` 原来一开面板就写死 `height = visualViewport.height`，
 * 而写死的高度会**压过 CSS 里的 `bottom:0`**（top+bottom+height 三者齐全 → bottom 被忽略）。
 * 冷启动那会儿 PWA 还在从「带状态栏」切到全屏，量到的值比最终的矮一截 → 底下露缝。
 *
 * 修法：**没键盘就不写高度**，交回 CSS 的 inset:0——量不到就没得量错。
 *
 * ⚠️这套测试钉三件事：
 *   ① 没键盘时 `style.height` 必须是**空**（不是"等于视口高"，空才是对的）；
 *   ② 键盘顶上来时仍然写死高度（不然输入框会被键盘埋掉，那是它当初存在的理由）；
 *   ③ 冷启动那种「视口比最终值矮」的情形下，照样不写高度。
 *
 * 跑法：node tests/modalheight.test.js   或   bash tests/p.sh modalheight
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
    await page.waitForTimeout(6500);

    const R = await page.evaluate(() => {
        const out = {};
        // CSS 那条兜底还在吗——清掉 height 之后就全靠它铺满屏幕
        out.CSS铺满还在 = (function () {
            for (const sh of document.styleSheets) {
                let rules; try { rules = sh.cssRules; } catch (e) { continue; }
                for (const r of rules || []) {
                    if (r.selectorText === '.modal.chat-modal' && r.style) {
                        return r.style.position === 'fixed' && r.style.top === '0px'
                            && r.style.bottom === '0px';
                    }
                }
            }
            return false;
        })();

        const overlay = document.getElementById('chatModalOverlay');
        const modal = overlay.querySelector('.chat-modal');
        overlay.classList.add('show');

        // 把 visualViewport 换成可控的假货
        let fakeH = 780;
        try {
            Object.defineProperty(window, 'visualViewport', {
                configurable: true,
                get() { return { height: fakeH, offsetTop: 0, addEventListener() {} }; }
            });
        } catch (e) { out.替换失败 = String(e).slice(0, 80); }
        out.假货装上了 = window.visualViewport.height === 780;

        // ① 正常（无键盘）
        fakeH = 780; modal.style.height = '999px';
        chatSyncModalHeight();
        out.无键盘不写高度 = modal.style.height === '';

        // ② 键盘顶上来（视口掉到 45%）
        fakeH = 350;
        chatSyncModalHeight();
        out.键盘弹起写高度 = modal.style.height === '350px';

        // ③ 键盘收回去
        fakeH = 780;
        chatSyncModalHeight();
        out.键盘收回清高度 = modal.style.height === '';

        /* ④ 冷启动：这一趟量到的比"最终"矮一点（状态栏还没让出来）。
           ⚠️关键是**这种情形下也不许写高度**——写了就是她看到的那条缝。 */
        fakeH = 752;                       // 比 780 矮 28px（大约一条状态栏）
        modal.style.height = '';
        chatSyncModalHeight();
        out.冷启动矮一截也不写 = modal.style.height === '';

        // ⑤ 面板没开着的时候别乱动别人的样式
        overlay.classList.remove('show');
        modal.style.height = '123px';
        chatSyncModalHeight();
        out.没开面板不插手 = modal.style.height === '123px';
        modal.style.height = '';
        return out;
    });

    ok('A CSS 里 .modal.chat-modal 仍然是 fixed + top/bottom 0（清掉 height 的兜底）', R.CSS铺满还在);
    ok('B 假 visualViewport 装上了（后面几条才算数）', R.假货装上了, R.替换失败 || '');
    ok('C ⚠️没键盘时不写死高度（这条就是那道缝的修法）', R.无键盘不写高度);
    ok('D 键盘顶上来时照旧写死高度（输入框不能被埋）', R.键盘弹起写高度);
    ok('E 键盘收回去立刻清掉', R.键盘收回清高度);
    ok('F ⚠️冷启动量矮了一截，也不写高度', R.冷启动矮一截也不写);
    ok('G 面板没开着时不插手', R.没开面板不插手);
    ok('H 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 阅读层高度：${bad}/${results.length} 条失败` : `\n✅ 阅读层高度：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
