/* 选中文字时不许触发「右滑返回」，以及起手区在宽屏上要收窄。
 *
 * 起因：用户 2026-08-14 报「阅读模式下选中文字的时候，会触发右滑退出手势，
 *       主要在 iPad 上多次发生，横屏使用时」。
 *
 * 病根有两条，这个文件一条钉一个：
 *   ① 起手区是 `innerWidth * 0.45` —— 手机上 ≈175px 还算克制，**iPad 横屏宽一千多、
 *      45% 就是五百多像素**，屏幕左边一大半都是触发区。在那儿选字往右拖，
 *      正好满足「右移够 80px、竖向不超 60px」，必然误触发。现在再压一个 160px 的上限。
 *   ② 有选区时不该抢手势：选中一段后拖那两个小圆点调范围，轨迹跟右滑返回一模一样。
 *      touchstart 和 touchmove **两处都要挡**——iPad 上常常是长按选中后手指不抬就接着拖，
 *      起手那一刻还没有选区，只在 touchmove 里才看得到。
 *
 * ⚠️「滑不动」只是烦，「读到一半面板自己关了」是丢上下文，后者贵得多。
 *   所以这几条宁可失之保守，别为了手势灵敏把它们放宽。
 *
 * 跑法：bash tests/p.sh swipeselect
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

(async () => {
    const browser = await chromium.launch();
    // iPad 横屏的尺寸——这个 bug 只在宽屏上冒出来，用手机尺寸测不出来
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    const R = await page.evaluate(() => {
        const out = {};
        const el = document.querySelector('.chat-modal');

        // 装一个假的 onBack：只记录有没有被叫到，不真的关面板
        let fired = 0;
        window._fakeBack = () => { fired++; };
        attachSwipeBack(el, () => true, window._fakeBack);

        const swipe = (x0, y0, x1, y1) => {
            const mk = (type, x, y) => {
                const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
                return new TouchEvent(type, {
                    touches: type === 'touchend' ? [] : [t], targetTouches: [], changedTouches: [t],
                    bubbles: true, cancelable: true,
                });
            };
            el.dispatchEvent(mk('touchstart', x0, y0));
            el.dispatchEvent(mk('touchmove', x1, y1));
            el.dispatchEvent(mk('touchend', x1, y1));
        };

        const clearSel = () => window.getSelection().removeAllRanges();
        const makeSel = () => {
            // 在页面里随便选中一段真实文字
            // ⚠️必须挂在**可见**的地方：.chat-modal 默认是隐藏的，
            //   而 Selection.toString() 对没渲染的文字返回空串——
            //   选区看着建好了、实际读出来是空的，测试会假报「守卫没生效」（踩过）。
            let node = document.getElementById('_seltest');
            if (!node) {
                node = document.createElement('p');
                node.textContent = '这是一段用来模拟用户选中的正文文字';
                node.id = '_seltest';
                node.style.cssText = 'position:fixed;left:20px;top:600px;z-index:99999;background:#fff';
                document.body.appendChild(node);
            }
            const r = document.createRange();
            r.selectNodeContents(node);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(r);
        };

        // ── ① 正常情况：左边缘起手往右划，该触发 ──────────────
        clearSel(); fired = 0;
        swipe(20, 400, 140, 400);
        out.正常能触发 = fired;

        // ── ② iPad 横屏：从 300px 处起手（旧代码算「左半屏」，因为 1180*0.45=531）──
        clearSel(); fired = 0;
        swipe(300, 400, 420, 400);
        out.宽屏中间起手不触发 = fired;

        // ── ③ 已有选区时，即使从左边缘起手也不该触发 ──────────
        makeSel(); fired = 0;
        swipe(20, 400, 140, 400);
        out.有选区不触发 = fired;
        clearSel();

        // ── ④ 起手时没选区、划到一半才出现（iPad 长按选中后接着拖）──
        clearSel(); fired = 0;
        {
            const mk = (type, x, y) => {
                const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
                return new TouchEvent(type, {
                    touches: type === 'touchend' ? [] : [t], targetTouches: [], changedTouches: [t],
                    bubbles: true, cancelable: true,
                });
            };
            el.dispatchEvent(mk('touchstart', 20, 400));   // 起手：没有选区
            makeSel();                                      // 中途选中
            el.dispatchEvent(mk('touchmove', 140, 400));    // 继续右拖
            el.dispatchEvent(mk('touchend', 140, 400));
        }
        out.中途出现选区不触发 = fired;
        clearSel();
        const n = document.getElementById('_seltest'); if (n) n.remove();
        return out;
    });

    ok('左边缘起手仍然能正常右滑返回（别把手势修没了）', R.正常能触发 === 1, '触发 ' + R.正常能触发 + ' 次');
    ok('⚠️宽屏中间起手不再误触发（iPad 横屏那个 bug）', R.宽屏中间起手不触发 === 0, '触发 ' + R.宽屏中间起手不触发 + ' 次');
    ok('⚠️已经选中文字时不触发', R.有选区不触发 === 0, '触发 ' + R.有选区不触发 + ' 次');
    ok('⚠️划到一半才选中也不触发', R.中途出现选区不触发 === 0, '触发 ' + R.中途出现选区不触发 + ' 次');
    ok('无 JS 报错', errs.length === 0, errs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
