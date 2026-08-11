/* clawd 菜单里各按钮的显隐（2026-08-11 加）。
 *
 * 起因：用户截图问「为啥阅读模式下那个下一章还在呀」。
 * 「下一章」**只该给共读模式**（2026-08-10 她分两次要求收窄的）：
 *   · 对话模式——没有书可接；
 *   · 阅读模式（纯看书）——滚到底会自动续章，点它只弹一句提示、纯占位；
 *   · 翻译模式——她说「也没必要」。
 *
 * ⚠️⚠️这个文件真正钉的是那个**反复踩的坑**：`chatReadingMode`（共读）在**阅读模式下也是真的**
 *   （readerOpenChapter 里两个都设），所以任何「只在共读出现」的判断都必须**再带一句
 *   `!chatReaderMode`**，否则阅读模式一直满足它。同一个坑在底栏点击那条上也踩过
 *   （见 readingHintTap / tests/hinttap.test.js）。
 *
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/clawdmenu.test.js
 *   或  bash tests/p.sh clawdmenu
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
        const shown = id => {
            const el = document.getElementById(id);
            return !!el && el.style.display !== 'none';
        };
        // 四种模式各同步一次 UI，看「下一章」在不在
        const set = (reading, translate, reader) => {
            chatView = 'conv';
            chatReadingMode = reading; chatTranslateMode = translate; chatReaderMode = reader;
            readingSyncAutoScrollUI();
        };

        set(true, false, false);   out.共读_有下一章 = shown('clawdNextChapBtn');
        // ⚠️阅读模式：chatReadingMode 也是真的，这就是那个坑
        set(true, false, true);    out.阅读_没有下一章 = !shown('clawdNextChapBtn');
        set(false, true, false);   out.翻译_没有下一章 = !shown('clawdNextChapBtn');
        set(false, false, false);  out.对话_没有下一章 = !shown('clawdNextChapBtn');

        // 顺带钉住同一批里别的几个，免得下次改这段顺手带偏
        set(false, false, false);
        out.对话_有用量 = shown('chatUsageBtn');
        out.对话_没读痕 = !shown('clawdBookmarkBtn');
        set(true, false, true);
        out.阅读_有读痕 = shown('clawdBookmarkBtn');
        out.阅读_没用量 = !shown('chatUsageBtn');

        // 兜底那道闸还在（就算按钮被谁弄出来了，点下去也不会真去接下一章）
        out.兜底闸还在 = clawdNextChapter.toString().indexOf('chatReaderMode') > 0;

        chatView = 'list'; chatReadingMode = false; chatTranslateMode = false; chatReaderMode = false;
        return out;
    });

    ok('共读模式：有「下一章」', R.共读_有下一章);
    ok('⚠️阅读模式：没有「下一章」（chatReadingMode 在这儿也是真的，坑就在这）', R.阅读_没有下一章);
    ok('翻译模式：没有「下一章」', R.翻译_没有下一章);
    ok('对话模式：没有「下一章」', R.对话_没有下一章);
    ok('对话模式：有「用量」、没「读痕」', R.对话_有用量 && R.对话_没读痕);
    ok('阅读模式：有「读痕」、没「用量」', R.阅读_有读痕 && R.阅读_没用量);
    ok('clawdNextChapter 里的兜底闸还在', R.兜底闸还在);
    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
