/* clawd 菜单「显示/隐藏消息按钮」切换后，贴底的人要还贴着底（2026-08-14 加）。
 *
 * 起因：用户报「对话模式下点 clawd 图标那个显示/隐藏，点显示的时候位置不是在最底下，
 *       会因为按键的出现导致界面保持在上面比较高的位置」。
 *
 * 原因：切「显示」会同时让每条消息长高两截——工具栏 26~32px 现身，
 *       且 padding 从隐藏态的 17px 缩回 11px（见 index.html 里 body.chat-tools-hidden 那两条样式）。
 *       原来的 clawdToggleMsgTools 只加了个 class 就完事，scrollTop 不动、scrollHeight 变大，
 *       多出来的那截全堆在下面 → 人被顶到半空。消息越多顶得越高。
 *       反方向（隐藏）内容变矮，浏览器自己会把超出的 scrollTop 夹回底部，本来就没毛病。
 *
 * ⚠️修法是「切换前记住是否贴底，是才滚回去」，不是无条件滚到底。
 *   无条件滚会砸掉阅读/共读模式——那时人停在章节中间，会被一脚踹到章末。
 *   下面第 3 条就是钉这个的，别为了让第 1 条更稳而把条件去掉。
 *
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/msgtoolsscroll.test.js
 *   或  bash tests/p.sh msgtoolsscroll
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

    // 造一屏放不下的假消息。⚠️只强制容器的高度和滚动，不动 .chat-msg 的样式——
    // 消息高度仍旧由页面真实 CSS 决定，测的才是真的那套 padding/工具栏规则。
    await page.evaluate(() => {
        chatView = 'conv';
        chatReadingMode = false; chatTranslateMode = false; chatReaderMode = false;
        document.body.classList.add('chat-plain-user');   // 去气泡态，padding 那两条规则才生效
        const el = document.getElementById('chatMessages');
        // ⚠️默认停在对话列表页，#chatMessages 的某层祖先是 display:none，
        // 不掀开的话整棵子树没有布局、scrollHeight 恒为 0，测了个寂寞。
        // 逐层往上把藏起来的掀开（不猜具体是哪个 id，改版也不会失效）。
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            if (getComputedStyle(p).display === 'none') p.style.display = 'block';
        }
        el.style.cssText = 'display:block;height:400px;overflow-y:auto';
        el.innerHTML = '';
        for (let i = 0; i < 25; i++) {
            const m = document.createElement('div');
            m.className = 'chat-msg ai';
            m.innerHTML = '<div class="chat-bubble">第 ' + i + ' 条消息，随便写点字撑高度。</div>'
                        + '<div class="chat-toolbar"><button>复制</button><button>重生</button></div>';
            el.appendChild(m);
        }
    });

    // ── 1. 贴底时点「显示」，切完还该贴底 ──────────────────────────
    const R1 = await page.evaluate(() => {
        chatSkipNextAutoBottom = false;
        // 先确保是隐藏态，再贴到底
        if (_msgToolsShown) clawdToggleMsgTools();
        const el = document.getElementById('chatMessages');
        el.scrollTop = el.scrollHeight;
        const before = { h: el.scrollHeight, gap: el.scrollHeight - el.scrollTop - el.clientHeight };
        clawdToggleMsgTools();          // ← 切到「显示」
        return { before, shown: _msgToolsShown };
    });
    await page.waitForTimeout(200);      // chatScrollBottom 走的是 requestAnimationFrame
    const A = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        return { h: el.scrollHeight, gap: el.scrollHeight - el.scrollTop - el.clientHeight };
    });

    ok('切「显示」后内容确实变高了（不然这个测试等于没测）', A.h > R1.before.h,
       '切前 ' + R1.before.h + 'px → 切后 ' + A.h + 'px');
    ok('贴底时点「显示」，切完仍贴底', A.gap < 5, '离底 ' + A.gap + 'px');

    // ── 2. 反方向：贴底时点「隐藏」也该还贴底 ──────────────────────
    const B = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        el.scrollTop = el.scrollHeight;
        clawdToggleMsgTools();          // ← 切回「隐藏」
        return { shown: _msgToolsShown };
    });
    await page.waitForTimeout(200);
    const B2 = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        return { gap: el.scrollHeight - el.scrollTop - el.clientHeight };
    });
    ok('贴底时点「隐藏」，切完仍贴底', B2.gap < 5, '离底 ' + B2.gap + 'px');

    // ── 3. ⚠️人在中间看历史时，切换不许把他弹到底 ──────────────────
    //     这一条同时护着阅读/共读模式（那时人就停在章节中间）。
    const C = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        el.scrollTop = 0;               // 拉到最上面看历史
        clawdToggleMsgTools();
        return { top: el.scrollTop };
    });
    await page.waitForTimeout(200);
    const C2 = await page.evaluate(() => {
        const el = document.getElementById('chatMessages');
        return { top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight };
    });
    ok('⚠️人在中间时切换，不会被弹到底部', C2.gap > 100, 'scrollTop=' + C2.top + '，离底 ' + C2.gap + 'px');

    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
