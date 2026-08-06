/* 读痕面板「导读」分类的回归测试（2026-07-30 加）。
 *
 * 起因：用户「你能在读痕里的单问、追问、划线里，再加一个导读分类吗，
 * 省得我去搜了，背景不用加」。
 *
 * 守四件事：
 *   ① 导读是**独占**的一类——不再同时出现在单问/追问里，否则筛选等于没筛。
 *   ② 只认真导读，用户自己打的「导读这段讲的是什么」不算。
 *   ③ ⚠️背景**故意不单列**（用户明说「背景不用加」），照旧留在单问/追问里。
 *   ④ 导出时按「这条有几问」判断要不要展开，不能按 type——一条导读后面追问过
 *      好几轮时，按 type 判会静默只导出第一条。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

/* 造一本阅读模式的书，并往 reader_qa 里塞各种类型的条目。
   段号故意分开，一段一类，好数。 */
function bootTrace(list) {
    const paras = [];
    for (let i = 0; i < 40; i++) paras.push('正文段落' + i + '，' + '话'.repeat(60));
    const book = { id: 'bk_t', fileName: '读痕测试.txt', fileSize: 55, chapters: [{ title: '第一章', body: paras.join('\n') }] };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === 'bk_t' ? book : null);
    window.readerBookId = 'bk_t';
    window.readerChapterIdx = 0;
    window.chatReaderMode = true;
    window.chatReadingMode = true;
    window.chatCurrentConvId = 'reader_bk_t';
    const fk = readerBookKey('bk_t');
    const all = readerQAAll();
    all[fk] = { 0: { ts: Date.now(), list: list } };
    localStorage.setItem('reader_qa', JSON.stringify(all));
    localStorage.removeItem('reading_highlights');
    const old = document.querySelector('.rd-trace-modal-mask');
    if (old) old.remove();
    rdTraceShowPanel();
}
// 面板上现在有哪些筛选按钮 / 列表里有几条
function panelState() {
    return {
        chips: [...document.querySelectorAll('.rd-trace-chip')].map(b => b.textContent),
        条数: document.querySelectorAll('.rd-trace-item').length,
        小标: [...document.querySelectorAll('.rd-trace-badge')].map(b => b.textContent)
    };
}
function clickChip(text) {
    const b = [...document.querySelectorAll('.rd-trace-chip')].find(x => x.textContent === text);
    if (b) b.click();
    return !!b;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._bootTrace=' + bootTrace + ';window._panelState=' + panelState + ';window._clickChip=' + clickChip + ';' });

    /* ── A 组：四类各就各位 ─────────────────────────────────────── */
    const A = await page.evaluate(() => {
        window._bootTrace([
            { p: 1, q: '导读：《第一节》', a: '这一节讲……' },                 // 导读
            { p: 5, q: '他为什么这么说？', a: '因为……' },                      // 单问
            { p: 9, q: '这段什么意思？', a: '意思是……' },                      // 追问串（同段两问）
            { p: 9, q: '那后面呢？', a: '后面……' },
            { p: 12, q: '背景：科举制度', a: '科举是……' }                      // 背景（不单列）
        ]);
        const st = window._panelState();
        const out = { chips: st.chips, 全部条数: st.条数, 小标: st.小标 };
        window._clickChip('导读'); out.导读页 = window._panelState().条数;
        window._clickChip('单问'); out.单问页 = window._panelState().条数;
        window._clickChip('追问'); out.追问页 = window._panelState().条数;
        return out;
    });
    /* 顺序 2026-08-06 用户改过：划线提到「全部」后面（她最常翻的是划线，原来在最末一格要划过去），
       导读跟在划线后面，问答两格退到后面。改顺序前先看 rdTraceRenderBody 里的 types 数组。 */
    eq('筛选按钮顺序＝全部/划线/导读/单问/追问', A.chips, ['全部', '划线', '导读', '单问', '追问']);
    eq('全部页四条都在（导读/单问/追问串/背景）', A.全部条数, 4);
    eq('点「导读」只剩那一条', A.导读页, 1);
    /* ⚠️「单问」里必须**没有**导读——分类重叠等于这个筛选没起到筛的作用。
     * 这里的 2 ＝ 用户自己问的那一条 + 背景那一条（背景按用户要求不单列）。 */
    eq('⚠️单问里不再混着导读（背景照旧算单问，用户说背景不用加）', A.单问页, 2);
    eq('追问串还是那一条', A.追问页, 1);
    ok('导读条目带 📖 小标（「全部」视图里也认得出）', A.小标.some(t => /📖 导读/.test(t)), JSON.stringify(A.小标));

    /* ── B 组：⚠️只认真导读 ───────────────────────────────────── */
    const B = await page.evaluate(() => {
        window._bootTrace([
            { p: 1, q: '导读这段讲的是什么？', a: '答' },     // 用户自己打的，不算
            { p: 3, q: '导读一下吧', a: '答' },               // 同上
            { p: 5, q: '导读', a: '答' },                     // 真导读（没小节标题时就长这样）
            { p: 7, q: '导读：《某一节》', a: '答' }          // 真导读
        ]);
        const st = window._panelState();
        window._clickChip('导读');
        return { chips: st.chips, 导读页: window._panelState().条数 };
    });
    eq('只有两条真导读进了这一类', B.导读页, 2);

    /* ── C 组：一条导读都没有时，不摆那个必空的按钮 ────────────── */
    const C = await page.evaluate(() => {
        window._bootTrace([
            { p: 5, q: '他为什么这么说？', a: '答' },
            { p: 9, q: '背景：某某', a: '答' }
        ]);
        return window._panelState().chips;
    });
    eq('没有导读时不出现「导读」按钮（小说常年如此，摆着是噪音）', C, ['全部', '划线', '单问', '追问']);

    /* ── D 组：⚠️背景故意不单列（用户明说「背景不用加」） ────────── */
    const D = await page.evaluate(() => {
        window._bootTrace([
            { p: 3, q: '背景：科举制度', a: '答' },
            { p: 6, q: '背景：门荫制', a: '答' },
            { p: 9, q: '导读：《某节》', a: '答' }
        ]);
        const chips = window._panelState().chips;
        window._clickChip('单问');
        return { chips, 单问页: window._panelState().条数 };
    });
    ok('没有多出「背景」按钮', D.chips.indexOf('背景') < 0, JSON.stringify(D.chips));
    eq('背景照旧留在单问里（两条）', D.单问页, 2);

    /* ── E 组：导读后面追问过几轮 ─────────────────────────────── */
    const E = await page.evaluate(() => {
        window._bootTrace([
            { p: 1, q: '导读：《第一节》', a: '导读正文' },
            { p: 1, q: '那这个概念跟前面那个有什么区别？', a: '区别是……' },
            { p: 1, q: '能举个例子吗？', a: '比如……' }
        ]);
        const st = window._panelState();
        window._clickChip('导读');
        const 导读页 = window._panelState().条数;
        window._clickChip('追问');
        return { 小标: st.小标, 导读页, 追问页: window._panelState().条数 };
    });
    ok('小标写清了后面还追问过几次', E.小标.some(t => /📖 导读 · 追问 ×2/.test(t)), JSON.stringify(E.小标));
    eq('带追问的导读归到「导读」', E.导读页, 1);
    eq('⚠️它不再重复出现在「追问」里（独占）', E.追问页, 0);

    /* ── F 组：⚠️导出别把导读后面的追问丢了 ──────────────────────
     * 老代码按 e.type === 'thread' 判断要不要展开多条。导读独立成类之后，
     * 一条「导读 + 两轮追问」会掉进 else 分支、**只导出第一条**——而且是静默的，
     * 导出的文件看着完全正常，等你需要那几轮追问时才发现没了。 */
    const F = await page.evaluate(() => {
        window._bootTrace([
            { p: 1, q: '导读：《第一节》', a: '导读正文' },
            { p: 1, q: '追问甲？', a: '答甲' },
            { p: 1, q: '追问乙？', a: '答乙' },
            { p: 8, q: '导读', a: '光杆导读' }
        ]);
        // 截住下载，把 markdown 拿出来看
        let md = '';
        const realBlob = window.Blob;
        window.Blob = function (parts) { md = parts.join(''); return new realBlob(parts, { type: 'text/plain' }); };
        const realCreate = URL.createObjectURL;
        URL.createObjectURL = () => 'blob:fake';
        rdTraceExport();
        window.Blob = realBlob; URL.createObjectURL = realCreate;
        return md;
    });
    ok('⚠️导读后面的两轮追问都导出来了（按 type 判会只剩第一条）',
        /追问甲/.test(F) && /追问乙/.test(F) && /答乙/.test(F), F.slice(0, 400));
    ok('导读那条在导出里标了 📖', /📖 导读/.test(F), F.slice(0, 400));
    ok('光杆导读（只有一问）也导出来了', /光杆导读/.test(F), F.slice(0, 400));

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
