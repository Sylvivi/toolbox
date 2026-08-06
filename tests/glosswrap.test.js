/* 手写小注「一行装不下就折两行」的回归测试（2026-08-06 加）。
 *
 * 起因：用户看了 neat-annotations 那个库的多行写法后问「如果允许小注写长点，
 * 可以接受两行左右的话，会很难实现吗，会不会影响之前的那些……我希望大部分情况下是一行，
 * 但是极少数的情况下，为了不截断，可以接受两行，同时显示效果也跟之前得是一样的」。
 * 她当时选的路线原话：「先榨干一行，不够再两行」。
 *
 * 守五件事：
 *   ① ⚠️一行装得下的**一个像素都不许变**——这是她那句「跟之前得是一样的」。
 *   ② 一行真装不下的才折第二行。
 *   ③ ⚠️⚠️折完之后**排位写 left 不许让它再重折**。这是实现时真踩到的坑：
 *      标签是绝对定位的，max-width 之下可用宽 ＝ 容器宽 − left，而 left 是量完之后
 *      才刷上去的 → 量到一行 14px、写完 left 当场变两行 27px，后面「塞不塞得下」
 *      全按错的高度算。所以必须**定死 width**，不能用 max-width。
 *   ④ 折行后盒子要按最长那一行收窄，否则排位那步一点横向避让余地都没有。
 *   ⑤ ⚠️拼音那一半不许被空格断开（`míng xiū / zhàn dào` 比截断还难看）。
 *
 * 跑法：bash tests/p.sh glosswrap
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

/* 造一段正文，把 gl 挂在段落中间的某个词上，跑一遍真实排版。
   段间距设 28px（用户实际用的值，也是滑块最大值）。 */
function boot(glText) {
    document.querySelectorAll('.__gw').forEach(n => n.remove());
    const P1 = '力更强。谁掌握了南北军，谁就控制了整个长安的军事力量，等于捏住了皇权的命脉。';
    const P2 = '于是，丞相就照着张辟疆的建议去跟太后说。果然太后有了反应，这才放心去哭她死去的儿子。';
    const box = document.createElement('div');
    box.className = 'reading-merged';
    box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
    box.innerHTML = '<p data-p="1">' + P1 + '</p><p data-p="2">'
        + P2.replace('去跟太后说', '<mark class="rd-hl rd-hl-sky" data-hlid="w1" data-gl="' + glText + '">去跟太后说</mark>')
        + '</p>';
    const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
    const msg = document.createElement('div');
    msg.className = 'chat-msg ai __gw'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
    document.body.appendChild(msg);
    document.documentElement.style.setProperty('--reading-pspace', '28px');
    box.querySelectorAll('p').forEach((p, i) => { if (i) p.style.marginTop = '28px'; });
    rdGlLayout(bub);
    const lab = box.querySelector('.rd-gl-label');
    return {
        有标签: !!lab,
        宽: lab ? Math.round(lab.offsetWidth) : 0,
        高: lab ? lab.offsetHeight : 0,
        容器宽: Math.round(box.getBoundingClientRect().width),
        定死了width: lab ? !!lab.style.width : false,
        用了maxWidth: lab ? !!lab.style.maxWidth : false,
        拼音行数: lab && lab.querySelector('.rd-gl-py')
            ? lab.querySelector('.rd-gl-py').getClientRects().length : 0,
        有引线: !!box.querySelector('.rd-gl-svg path')
    };
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._boot=' + boot + ';' });

    /* ── A 组：⚠️一行装得下的一个像素都不许变 ────────────────────── */
    const A = await page.evaluate(() => {
        const 短 = window._boot('yīn yūn·雾气弥漫');
        const 典型 = window._boot('zhāng hán·秦朝名将后来投降了项羽这个人');
        return { 短, 典型 };
    });
    eq('短小注还是一行 14px', [A.短.高, A.短.宽], [14, 96]);
    eq('典型小注（意思正好 14 字）还是一行 14px', [A.典型.高, A.典型.宽], [14, 239]);
    /* 这两条是 ① 的正面证据：没走折行分支，就不会去碰 width，样式属性是空的。 */
    ok('一行装得下时压根没碰 width（＝走的还是老路径）',
        !A.短.定死了width && !A.典型.定死了width, JSON.stringify(A));
    ok('两条都画出引线了', A.短.有引线 && A.典型.有引线);

    /* ── B 组：一行真装不下 → 折第二行 ──────────────────────────── */
    const LONG = 'míng xiū zhàn dào·表面上做出要修复栈道的假动作暗地里绕道偷袭陈仓';
    const B = await page.evaluate((t) => window._boot(t), LONG);
    ok('这条确实一行放不下（前提，不然这组测的不是同一件事）', B.宽 <= B.容器宽, JSON.stringify(B));
    eq('折成了两行（27px）', B.高, 27);
    ok('④ 盒子按最长那行收窄了，没有恒等于容器宽', B.宽 < B.容器宽, '标签 ' + B.宽 + ' / 容器 ' + B.容器宽);
    ok('⑤ 拼音没被空格断开，仍是一整行', B.拼音行数 === 1, '拼音占了 ' + B.拼音行数 + ' 行');
    ok('折行的这条也画出引线了', B.有引线);

    /* ── C 组：⚠️⚠️定死 width，写 left 不许重折（实现时真踩到的坑）── */
    const C = await page.evaluate((t) => {
        window._boot(t);
        const lab = document.querySelector('.__gw .rd-gl-label');
        const h1 = lab.offsetHeight, w1 = Math.round(lab.offsetWidth);
        /* 模拟排位把标签推到右边：max-width 写法下可用宽 ＝ 容器宽 − left，
           这一下会当场再折一次；定死 width 则纹丝不动。 */
        lab.style.left = '250px';
        return { 用了maxWidth: !!lab.style.maxWidth, 定死了width: !!lab.style.width,
                 高_写left前: h1, 高_写left后: lab.offsetHeight,
                 宽_写left前: w1, 宽_写left后: Math.round(lab.offsetWidth) };
    }, LONG);
    ok('③ 用的是定死 width，不是 max-width', C.定死了width && !C.用了maxWidth, JSON.stringify(C));
    eq('③ 写完 left 之后高度没变（量到多高就是多高）', C.高_写left后, C.高_写left前);
    eq('③ 写完 left 之后宽度也没变', C.宽_写left后, C.宽_写left前);

    /* ── D 组：额度——「榨干一行」那一半 ────────────────────────── */
    const D = await page.evaluate(() => ({
        MEAN: RD_GL_MEAN, MAX: RD_GL_MAX,
        意思22字没被砍: rdGlClean('zhāng hán·' + '一'.repeat(22)) === 'zhāng hán·' + '一'.repeat(22),
        意思超了才砍: rdGlWidth(rdGlClean('zhāng hán·' + '一'.repeat(40)).split('·')[1]) === RD_GL_MEAN,
        拼音照旧不吃额度: rdGlClean('míng xiū zhàn dào·表面做假动作暗中行事')
                          === 'míng xiū zhàn dào·表面做假动作暗中行事'
    }));
    eq('「意思」的上限提到了 22（原来 16，一行只用掉 67% 就开始砍）', D.MEAN, 22);
    eq('整条兜底提到 44（≈一行半，原来 26＝一行）', D.MAX, 44);
    ok('22 字的意思不再被砍', D.意思22字没被砍);
    ok('真跑飞（40 字）还是按 22 砍住', D.意思超了才砍);
    ok('拼音照旧不吃「意思」的额度（这条老规矩没被碰坏）', D.拼音照旧不吃额度);

    /* ── E 组：用户手写批注的长短分流跟着新门槛走 ──────────────── */
    const E = await page.evaluate(() => {
        const 三十字 = '一'.repeat(30), 五十字 = '一'.repeat(50);
        return {
            三十字走小注: rdGlWidth(三十字) <= RD_GL_MAX,
            五十字走小点: rdGlWidth(五十字) > RD_GL_MAX
        };
    });
    /* ⚠️这是明知故犯的副作用，已跟用户讲过：分流那儿拿不到「这条是 AI 注还是我自己写的」，
       两者同一个 note 字段，所以门槛一提，27~44 当量的手写批注也从 ✎ 变成两行小注。 */
    ok('30 字批注现在写成两行小注（原来收进 ✎）', E.三十字走小注);
    ok('50 字批注仍然收进 ✎ 小点', E.五十字走小点);

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
