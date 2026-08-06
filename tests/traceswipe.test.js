/* 读痕面板「左右滑切筛选格」的回归测试（2026-08-06 加）。
 *
 * 起因：用户「把读痕里的划线，从最后一位放到全部的后面吧，并且也加滑动手势可以吗，
 * 导读放划线后面」。
 *
 * 守四件事：
 *   ① 左滑＝往后一格、右滑＝往前一格，顺序跟屏幕上那排按钮完全一致。
 *   ② ⚠️到头**不绕回去**——转圈会让人不知道自己滑到哪了。
 *   ③ ⚠️竖着滚不能误切格：这个面板本来就是竖滚的，误触发比"滑不动"贵得多
 *      （同 attachSwipeBack 那条纪律）。
 *   ④ ⚠️离开「划线」那一格要把颜色筛选清掉，跟点按钮的行为保持一致；
 *      不清的话会出现「在单问那一页、却按黄色筛着」这种筛不出东西的死局。
 *
 * 跑法：bash tests/run.sh traceswipe   或   bash tests/p.sh traceswipe
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

/* 造一本书 + 几条问答 + 两条划线，让五格筛选（全部/划线/导读/单问/追问）全都出现。
   ⚠️划线必须真塞进 reading_highlights：没有划线时「划线颜色」那排点不出现，
   ④ 那条断言就无从验起。 */
function bootTrace() {
    const paras = [];
    for (let i = 0; i < 40; i++) paras.push('正文段落' + i + '，' + '话'.repeat(60));
    const book = { id: 'bk_s', fileName: '滑动测试.txt', fileSize: 55, chapters: [{ title: '第一章', body: paras.join('\n') }] };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === 'bk_s' ? book : null);
    window.readerBookId = 'bk_s';
    window.readerChapterIdx = 0;
    window.chatReaderMode = true;
    window.chatReadingMode = true;
    window.chatCurrentConvId = 'reader_bk_s';
    const fk = readerBookKey('bk_s');
    const all = readerQAAll();
    all[fk] = { 0: { ts: Date.now(), list: [
        { p: 1, q: '导读：《第一节》', a: '这一节讲……' },   // 导读
        { p: 5, q: '他为什么这么说？', a: '因为……' },        // 单问
        { p: 9, q: '这段什么意思？', a: '意思是……' },        // 追问串（同段两问）
        { p: 9, q: '那后来呢？', a: '后来……' }
    ] } };
    localStorage.setItem('reader_qa', JSON.stringify(all));
    /* ⚠️划线的键是 readingMarksConvId() 给的**稳定键** `reader_<文件指纹>`，不是 `reader_<bookId>`——
       写成后者会静默存进一个没人读的槽，划线数恒为 0、颜色点那排根本不出现。
       ⚠️颜色只能取 RD_HL_SW 里那六个色名（gold/orange/green/sky/rose/ink），
       写 'yellow' 这种不存在的色名同样点不出来。 */
    localStorage.setItem('reading_highlights', JSON.stringify({
        ['reader_' + fk]: [
            { id: 'h1', msgIdx: 0, chap: 0, p: 2, start: 0, end: 4, color: 'gold', preview: '正文段落2', note: '', ts: Date.now() },
            { id: 'h2', msgIdx: 0, chap: 0, p: 3, start: 0, end: 4, color: 'sky', preview: '正文段落3', note: '', ts: Date.now() }
        ]
    }));
    const old = document.querySelector('.rd-trace-modal-mask');
    if (old) old.remove();
    rdTraceShowPanel();
}
function panelState() {
    const on = document.querySelector('.rd-trace-chip.on');
    return {
        chips: [...document.querySelectorAll('.rd-trace-chip')].map(b => b.textContent),
        当前: on ? on.textContent : null,
        颜色筛选: window._rdTraceColorPeek ? window._rdTraceColorPeek() : null
    };
}
/* 在面板上模拟一次滑动。dx<0 = 左滑。
   ⚠️必须发在 #rdTraceBody 或它的后代上——手势是绑在那个壳上的。 */
function swipe(dx, dy, sel) {
    const el = document.querySelector(sel || '#rdTraceBody');
    const x0 = 200, y0 = 400;
    const mk = (type, x, y, listKey) => {
        const t = { identifier: 1, target: el, clientX: x, clientY: y };
        const ev = new Event(type, { bubbles: true, cancelable: true });
        ev.touches = listKey === 'touches' ? [t] : [];
        ev.changedTouches = [t];
        el.dispatchEvent(ev);
    };
    mk('touchstart', x0, y0, 'touches');
    mk('touchend', x0 + dx, y0 + dy, 'changed');
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content:
        'window._bootTrace=' + bootTrace + ';window._panelState=' + panelState + ';window._swipe=' + swipe + ';'
        + 'window._rdTraceColorPeek=function(){return _rdTraceColor;};' });

    /* ── A 组：左滑一路往后、到头停住 ──────────────────────────── */
    const A = await page.evaluate(() => {
        window._bootTrace();
        const seq = [window._panelState().当前];
        for (let i = 0; i < 6; i++) { window._swipe(-120, 5); seq.push(window._panelState().当前); }
        return { chips: window._panelState().chips, seq };
    });
    eq('五格都在（顺序＝全部/划线/导读/单问/追问）', A.chips, ['全部', '划线', '导读', '单问', '追问']);
    /* 滑 6 次但只有 4 格可走 → 最后两次原地不动，正是 ② 要的"到头停住"。 */
    eq('左滑逐格往后，滑到「追问」就停住不绕回「全部」', A.seq,
        ['全部', '划线', '导读', '单问', '追问', '追问', '追问']);

    /* ── B 组：右滑往回 ─────────────────────────────────────────── */
    const B = await page.evaluate(() => {
        window._bootTrace();
        for (let i = 0; i < 4; i++) window._swipe(-120, 5);   // 先走到最后一格
        const seq = [window._panelState().当前];
        for (let i = 0; i < 6; i++) { window._swipe(120, 5); seq.push(window._panelState().当前); }
        return seq;
    });
    eq('右滑逐格往前，滑到「全部」就停住不绕回「追问」', B,
        ['追问', '单问', '导读', '划线', '全部', '全部', '全部']);

    /* ── C 组：⚠️竖滚不能误切 ──────────────────────────────────── */
    const C = await page.evaluate(() => {
        window._bootTrace();
        const out = {};
        window._swipe(0, -300);   out.纯竖滚 = window._panelState().当前;
        window._swipe(-60, -200); out.斜着滚 = window._panelState().当前;   // 横 60 竖 200，横不到竖的 1.5 倍
        window._swipe(-30, 0);    out.横移太短 = window._panelState().当前;  // 只有 30px，不到 50 的门槛
        window._swipe(-120, 20);  out.够横够直 = window._panelState().当前;  // 这一下才该切
        return out;
    });
    eq('纯竖滚不切格', C.纯竖滚, '全部');
    eq('⚠️斜着滚（横 60 竖 200）不切格——误触发比滑不动贵得多', C.斜着滚, '全部');
    eq('横移不到 50px 不切格', C.横移太短, '全部');
    eq('横够长又够直，这一下才真的切', C.够横够直, '划线');

    /* ── D 组：⚠️在搜索框上滑是在选文字，别抢 ──────────────────── */
    const D = await page.evaluate(() => {
        window._bootTrace();
        window._swipe(-120, 5, '#rdTraceSearch');
        return window._panelState().当前;
    });
    eq('⚠️在搜索框里横滑不切格（那是在选文字）', D, '全部');

    /* ── E 组：⚠️离开「划线」要清掉颜色筛选 ────────────────────── */
    const E = await page.evaluate(() => {
        window._bootTrace();
        window._swipe(-120, 5);                       // → 划线
        document.querySelector('.rd-trace-dot').click();   // 按某个颜色筛
        const 筛着 = window._panelState();
        window._swipe(-120, 5);                       // → 导读，这一下该把颜色清掉
        const 走了 = window._panelState();
        return { 当前1: 筛着.当前, 颜色1: 筛着.颜色筛选, 当前2: 走了.当前, 颜色2: 走了.颜色筛选 };
    });
    eq('滑到「划线」后能按颜色筛', E.当前1, '划线');
    ok('颜色筛选确实生效了', !!E.颜色1, String(E.颜色1));
    eq('滑走之后到了「导读」', E.当前2, '导读');
    eq('⚠️离开划线，颜色筛选被清掉（否则会卡在筛不出东西的死局）', E.颜色2, null);

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
