/* 小注/记号「只排看得见的那几条」（2026-08-11 加）。
 *
 * 用户报：「页面打开，以及电脑浏览器窗口调整后，会有点卡顿，应该可以不要一次性全量渲染？」——她说得对。
 * 实测（这台服务器 CPU，12 条消息 / 96 条小注 / 24 个背景块）：
 *   整页重排一次 **340ms**，单条只要 **20ms**；而 1280×800 的窗口里当时**只有 1 条消息在视口内**。
 *   339ms 花在看不见的章节上，手机再乘 3~5 倍 —— 「打开卡一下、拖窗口卡一下」就是这么来的。
 * 改完：首屏那一下 **82ms**，滚动时**一帧只补一条**（约 20ms）。
 *
 * 钉住的事：
 *  P1 视口外的消息不当场排，只打 data-gl-pend 的记号。
 *  P2 打了记号的，滚近了会被补上（rdGlFlushPending）。
 *  P3 补排是**分帧**的：一次调用只处理一条，剩下的挂 rAF —— 一次补三条就是 76ms、明显掉帧。
 *  P4 ⚠️安全带：一条都没排、却还欠着账（＝整个面板还藏着、量到的位置全是 0）时要重试，
 *     否则短到不用滚的章节永远等不到补排，症状是「小注一条不显示，滚一下才出来」。
 *  P5 视口里的那条该排的还是照排（别为了快把该画的也省了）。
 *
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/glossperf.test.js
 *   或  bash tests/p.sh glossperf
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    // 造 12 条消息，每条 8 段 8 条小注 + 2 个背景块（跟她那本书的密度接近）
    const build = () => page.evaluate(() => {
        document.querySelectorAll('.__pf').forEach(n => n.remove());
        const filler = '春山如笑水如蓝日暮乡关何处是烟波江上使人愁'.repeat(40);
        const words = ['颠越', '兹邑', '盘庚', '俾无', '石田', '酷吏', '郅都', '宗室'];
        for (let n = 0; n < 12; n++) {
            let html = '';
            for (let p = 0; p < 8; p++) {
                const w = words[p % words.length];
                let t = (w + filler.slice(0, 120))
                    .replace(w, '<mark class="rd-hl rd-hl-sky" data-hlid="m' + n + '_' + p
                        + '" data-gl="pīn yīn·这个词的意思大概是这样子的">' + w + '</mark>');
                html += '<p data-p="' + (p + 1) + '">' + t + '</p>';
                if (p % 4 === 3) {
                    html += '<blockquote data-cp="' + (p + 1) + '" data-bg="1" data-fold="1" data-anchor="' + w + '"'
                        + ' style="margin:0.4em 0 0.6em;padding:0.5em 12px 0.4em">'
                        + '<div class="reading-q">汐：背景：' + w + '</div><div>讲解正文。</div></blockquote>';
                }
            }
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = html;
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __pf'; msg.setAttribute('data-idx', String(n)); msg.appendChild(bub);
            document.body.appendChild(msg);
        }
        return document.querySelectorAll('.chat-msg.ai.__pf').length;
    });

    await build();
    const A = await page.evaluate(() => {
        window.scrollTo(0, 0);
        const t = performance.now();
        rdGlLayoutAll();
        const ms = Math.round(performance.now() - t);
        const bubbles = [...document.querySelectorAll('.chat-msg.ai.__pf .chat-bubble')];
        let vis = 0;
        bubbles.forEach(b => { const r = b.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) vis++; });
        return {
            ms: ms,
            消息数: bubbles.length,
            视口内: vis,
            欠账: document.querySelectorAll('.chat-bubble[data-gl-pend]').length,
            首条画了小注: !!bubbles[0].querySelector('.rd-gl-label'),
            首条画了记号: !!bubbles[0].querySelector('.bg-mk-layer'),
            末条没画: !bubbles[bubbles.length - 1].querySelector('.rd-gl-label'),
        };
    });

    ok('P1 视口外的消息没当场排（只记账）', A.欠账 >= A.消息数 - A.视口内 - 1, '共 ' + A.消息数 + ' 条，视口内 ' + A.视口内 + ' 条，欠账 ' + A.欠账 + ' 条');
    ok('P5 视口内那条照样画了小注和记号', A.首条画了小注 && A.首条画了记号);
    ok('P1 最远那条确实没画', A.末条没画);
    ok('整页重排够快（<150ms；改之前是 340ms）', A.ms < 150, A.ms + 'ms');

    // P3：分帧——一次调用只补一条
    const B = await page.evaluate(() => {
        const before = document.querySelectorAll('.chat-bubble[data-gl-pend]').length;
        document.querySelectorAll('.chat-msg.ai.__pf')[6].scrollIntoView();
        const t = performance.now();
        rdGlFlushPending();                       // 同步这一下只该干一条
        const ms = Math.round(performance.now() - t);
        return { before: before, after: document.querySelectorAll('.chat-bubble[data-gl-pend]').length, ms: ms };
    });
    ok('P3 一次调用只补一条（剩下的挂 rAF）', B.before - B.after === 1, B.before + ' → ' + B.after + '，' + B.ms + 'ms');
    ok('P3 这一下够短（<60ms）', B.ms < 60, B.ms + 'ms');

    // P2：让 rAF 跑几帧，欠账应当继续减少，且滚到的那条已经画上
    await page.waitForTimeout(700);
    const C = await page.evaluate(() => {
        const bubbles = [...document.querySelectorAll('.chat-msg.ai.__pf .chat-bubble')];
        return {
            欠账: document.querySelectorAll('.chat-bubble[data-gl-pend]').length,
            滚到的那条画上了: !!bubbles[6].querySelector('.rd-gl-label'),
        };
    });
    ok('P2 滚过去之后那条被补上了', C.滚到的那条画上了);
    ok('P2 rAF 链子继续把附近的补完（欠账变少）', C.欠账 < B.after, B.after + ' → ' + C.欠账);

    // P4 安全带：面板藏着时一条都排不了 → 必须安排重试，不能就此不管
    const D = await page.evaluate(() => {
        const src = rdGlLayoutAll.toString();
        return {
            有重试: src.indexOf('rdGlRetryLater') > 0,
            进对话补一次: chatSwitchView.toString().indexOf('rdGlRelayoutSoon') > 0,
        };
    });
    ok('P4 一条都没排却还欠着账时会重试', D.有重试);
    ok('P4 进对话时补一次（面板藏着时渲染的那批靠它兜底）', D.进对话补一次);

    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
