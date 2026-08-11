/* 随机划线色「洗牌口袋」的回归（2026-08-11 加）。
 *
 * 用户报：「绿色作为随机颜色出现次数很少，正常吗？而且同一段里，第一个颜色和
 * 第三个颜色往往相同」。两件其实是同一件——老实现是**每次独立乱抽**（只躲开上一次），
 * 数学上：连抽 5 次某一支一次都不出的概率 0.8^5 ≈ 33%；而「只躲相邻」让
 * 第 1 与第 3 相同的概率反升到 1/4。
 *
 * 改成洗牌口袋：5 支笔洗一遍排队，一次发一支，发完再洗下一轮。
 *
 * 钉住的事：
 *  Z1 每 5 连抽（一轮）里五支笔各出现一次 —— 绿色不会再长时间缺席。
 *  Z2 同一轮里不重色 ⇒ 第 1 与第 3 绝不相同。
 *  Z3 跨轮的接缝也不许连号（新一轮的头一支 ≠ 上一轮末尾那支）。
 *  Z4 永远不发 ink（中性色，留给手动挑）。
 *  Z5 口袋里混进已删除的色名时不许发出去（色板改过之后的旧口袋）。
 *
 * 跑法：NODE_PATH=~/.toolbox-test/node_modules node tests/hlbag.test.js
 *   或  bash tests/p.sh hlbag
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
        const pool = RD_HL_COLORS.filter(c => c !== 'ink');
        out.池子 = pool;
        // 真实调用：每抽一支就照创建路径把 last 写回去（rdHlCreate / rdGlMake 都写）
        const draw = n => {
            const seq = [];
            for (let i = 0; i < n; i++) {
                const c = rdHlRandomColor();
                localStorage.setItem('reading_hl_last_color', c);
                seq.push(c);
            }
            return seq;
        };

        // ── Z1/Z2/Z3：连抽 20 次（4 轮） ──
        localStorage.removeItem('reading_hl_bag');
        localStorage.removeItem('reading_hl_last_color');
        const seq = draw(pool.length * 4);
        out.序列 = seq;
        const N = pool.length;
        let roundOk = true, dupInRound = false, seamOk = true;
        for (let r = 0; r * N < seq.length; r++) {
            const round = seq.slice(r * N, r * N + N);
            if (new Set(round).size !== N) { roundOk = false; dupInRound = true; }
            if (r > 0 && round[0] === seq[r * N - 1]) seamOk = false;
        }
        out.Z1_每轮五色齐 = roundOk;
        out.Z2_轮内不重色 = !dupInRound;
        out.Z2_一三不同 = seq.every((c, i) => i < 2 || c !== seq[i - 2] || (i % N) < 2);
        out.Z3_接缝不连号 = seamOk;
        // 绿色在 20 次里必须正好出现 4 次
        out.Z1_绿色次数 = seq.filter(c => c === 'green').length;
        out.Z4_没发过ink = seq.indexOf('ink') < 0;

        // ── Z5：口袋里混进已删掉的色名 ──
        localStorage.setItem('reading_hl_bag', JSON.stringify(['gold', 'nosuchcolor', 'green']));
        localStorage.removeItem('reading_hl_last_color');
        const s2 = draw(6);
        out.Z5_没发死色 = s2.every(c => pool.indexOf(c) >= 0);
        out.Z5_序列 = s2;

        localStorage.removeItem('reading_hl_bag');
        localStorage.removeItem('reading_hl_last_color');
        return out;
    });

    ok('Z0 池子里有绿、且不含 ink', R.池子.indexOf('green') >= 0 && R.池子.indexOf('ink') < 0, R.池子.join('/'));
    ok('Z1 每 5 连抽里五支笔各出现一次', R.Z1_每轮五色齐, R.序列.join(' '));
    ok('Z1 绿色在 20 次里正好 4 次', R.Z1_绿色次数 === 4, '实际 ' + R.Z1_绿色次数 + ' 次');
    ok('Z2 同一轮里不重色（第 1 与第 3 绝不相同）', R.Z2_轮内不重色 && R.Z2_一三不同);
    ok('Z3 跨轮接缝也不连号', R.Z3_接缝不连号);
    ok('Z4 永远不发 ink', R.Z4_没发过ink);
    ok('Z5 旧口袋里的死色不许发出去', R.Z5_没发死色, R.Z5_序列.join(' '));
    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')); });
    console.log(bad ? '\n❌ ' + bad + ' 条没过' : '\n✅ 全过');
    process.exit(bad ? 1 : 0);
})();
