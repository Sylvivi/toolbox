/* 收藏模型「明明选了却提示没选」的回归测试。
 *
 * 起因：用户 2026-07-28 在阅读模式下从收藏里选模型——界面显示已经选中那个模型了，
 * 一点「讨论」却弹「请先选择模型」。她自己的描述точ到了病根：
 * 「我选的是一个，但实际选中的有可能是另外一个」。
 *
 * 根因：收藏条目记的是中转站的**内部编号** providerId，而删掉再重新加同一个中转站
 * 编号就变了（空号）；`sel.value = 不存在的编号` 是**静默失败**——下拉框变成空白、
 * 不报错不抛异常。老代码切完不检查，后面照样写 chatSelectedModel、点亮发送键、
 * 把标签改成那个模型 → 界面显示已选好、实际中转站是空的 → 一发请求就说没选模型，
 * 而且提示冤枉了模型，她怎么重选模型都没用。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 两个中转站，各带一个模型。甲站是当前选中的，收藏的那个模型在乙站。
function boot() {
    idbSet('api_manager_data', [
        { id: 'prov_A', name: '甲站', url: 'https://a.example.com', key: 'sk-aaa', models: [{ name: 'gpt-x' }] },
        { id: 'prov_B', name: '乙站', url: 'https://b.example.com', key: 'sk-bbb', models: [{ name: 'claude-y' }] }
    ]);
    populateChatProviders();
    const sel = document.getElementById('chatProviderSelect');
    sel.value = 'prov_A';
    onChatProviderChange();
    window._toasts = [];
    if (!window._toastHooked) { const _o = window.showToast; window.showToast = function (m, s) { window._toasts.push(String(m)); return _o.apply(this, arguments); }; window._toastHooked = true; }
}
// 「点讨论会不会弹没选模型」——照抄 readingAskOne / readingCommentOne 的那道闸
function probe() {
    const sel = document.getElementById('chatProviderSelect');
    const item = getKeyItemById(sel.value);
    return {
        中转站: sel.value || '(空)',
        显示的模型: document.getElementById('chatModelLabel').textContent,
        内部模型: chatSelectedModel,
        有密钥: !!chatSelectedKeyStr,
        弹没选模型: (!item || !chatSelectedModel)
    };
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._boot=' + boot + ';window._probe=' + probe + ';' });

    /* ===== A 组：中转站编号还在（本来就正常的那条路，别改坏了）===== */
    const A = await page.evaluate(async () => {
        window._boot();
        chatPickFavModel({ url: 'https://b.example.com', model: 'claude-y', providerId: 'prov_B', providerName: '乙站' });
        await new Promise(r => setTimeout(r, 300));
        return window._probe();
    });
    eq('编号还在时，中转站正确切到乙站', A.中转站, 'prov_B');
    eq('模型选中了', A.内部模型, 'claude-y');
    ok('密钥也跟着切过来了', A.有密钥);
    ok('点讨论不会弹「没选模型」', !A.弹没选模型);

    /* ===== B 组：编号失效（删掉又重新加了中转站），但网址还在 → 必须按网址找回来 ===== */
    const B = await page.evaluate(async () => {
        window._boot();
        chatPickFavModel({ url: 'https://b.example.com', model: 'claude-y', providerId: 'prov_B_OLD', providerName: '乙站' });
        await new Promise(r => setTimeout(r, 300));
        return window._probe();
    });
    eq('编号是空号时按网址找回中转站（不再变成空白）', B.中转站, 'prov_B');
    eq('模型照样选中', B.内部模型, 'claude-y');
    ok('密钥也拿到了（原来这里是空的，发请求会 401）', B.有密钥);
    ok('⭐点讨论不会再弹「没选模型」（这就是她遇到的那个）', !B.弹没选模型);

    /* ===== C 组：中转站真的没了 → 宁可什么都不做，也不能假装选好了 =====
       假装的代价是她对着一个「显示已选好」的界面反复重选模型，永远修不好。 */
    const C = await page.evaluate(async () => {
        window._boot();
        const before = window._probe();
        chatPickFavModel({ url: 'https://gone.example.com', model: 'ghost-z', providerId: 'prov_GONE', providerName: '已删掉的站' });
        await new Promise(r => setTimeout(r, 300));
        return { before, after: window._probe(), toasts: window._toasts };
    });
    eq('中转站没了就不改选中的模型（不假装选好）', C.after.内部模型, C.before.内部模型);
    ok('也不会把标签改成那个选不了的模型', C.after.显示的模型.indexOf('ghost-z') === -1);
    ok('当场说清楚是哪个中转站没了', C.toasts.some(t => t.indexOf('已删掉的站') !== -1));
    ok('提示里告诉她该怎么办（重新收藏一次）', C.toasts.some(t => t.indexOf('重新收藏') !== -1));

    /* ===== D 组：提示语不许再冤枉模型 ===== */
    const D = await page.evaluate(async () => {
        window._boot();
        const 有中转站 = chatNoModelMsg();
        document.getElementById('chatProviderSelect').value = '';
        const 没中转站 = chatNoModelMsg();
        return { 有中转站, 没中转站 };
    });
    eq('中转站在、只是没选模型 → 照旧说模型', D.有中转站, '请先选择模型');
    ok('中转站没选中 → 提示必须点名中转站（不然她只会一直重选模型）', D.没中转站.indexOf('中转站') !== -1);

    /* ===== E 组：别再赌网速 =====
       选中模型原来包在写死的 setTimeout(…,100) 里等模型列表加载，网慢时会错乱。
       onChatProviderChange 里动 chatSelectedModel/KeyStr 的那几条路全是同步的，不需要等。 */
    const E = await page.evaluate(() => {
        const src = String(chatPickFavModel);
        return {
            没有写死的等待: src.indexOf('setTimeout') === -1,
            切之前先验中转站: src.indexOf('chatFavProviderId') !== -1,
            找不到就直接返回: (function () {
                const i = src.indexOf('if (!wantId)'); if (i < 0) return false;
                const seg = src.slice(i, src.indexOf('return;', i));   // 「验不过」到「返回」之间
                return seg.indexOf('showToast') !== -1;                 // 中间必须有提示，不能闷声不响
            })()
        };
    });
    ok('不再用写死的 100 毫秒赌模型列表加载完了没有', E.没有写死的等待);
    ok('切中转站之前先把编号验一遍', E.切之前先验中转站);
    ok('验不过就提示并停下，不往下走', E.找不到就直接返回);


    /* ===== F 组：中转站掉了要自动找回来（她真正遇到的那个）=====
       她的中转站并没有被删——是「模型和中转站没有一起还原」，模型一直有、中转站一直空。 */
    const F = await page.evaluate(async () => {
        window._boot();
        chatFavModels = [{ url: 'https://b.example.com', model: 'claude-y', providerId: 'prov_B', providerName: '乙站' }];
        chatPickFavModel(chatFavModels[0]);
        await new Promise(r => setTimeout(r, 300));
        // 模拟「中转站被清空、模型还在」这个坏状态
        document.getElementById('chatProviderSelect').value = '';
        const 坏掉时 = window._probe();
        const back = chatEnsureProvider();
        return { 坏掉时, 找回的站: back ? back.id : null, 找回后: window._probe(), toasts: window._toasts };
    });
    ok('先造出坏状态：模型还在、中转站空了（她的症状）', F.坏掉时.中转站 === '(空)' && F.坏掉时.内部模型 === 'claude-y' && F.坏掉时.弹没选模型);
    eq('⭐自动按「这个模型属于哪个站」找回中转站', F.找回的站, 'prov_B');
    eq('找回后模型没被弄丢', F.找回后.内部模型, 'claude-y');
    ok('找回后点讨论不再弹「没选模型」', !F.找回后.弹没选模型);
    ok('找回时告诉她一声', F.toasts.some(t => t.indexOf('已自动切回') !== -1));

    /* ===== G 组：认不出是哪个站就绝不瞎猜（猜错＝请求发去别的站、扣错钱）===== */
    const G = await page.evaluate(async () => {
        window._boot();
        // 两个站都收藏了同名模型 → 无法唯一确定
        chatFavModels = [
            { url: 'https://a.example.com', model: 'same-model', providerId: 'prov_A', providerName: '甲站' },
            { url: 'https://b.example.com', model: 'same-model', providerId: 'prov_B', providerName: '乙站' }
        ];
        chatSelectedModel = 'same-model';
        document.getElementById('chatProviderSelect').value = '';
        localStorage.removeItem('chat_last_provider');
        const back = chatEnsureProvider();
        return { 猜了吗: !!back, 中转站: document.getElementById('chatProviderSelect').value || '(空)' };
    });
    ok('两个站都有同名模型时不瞎猜', !G.猜了吗);
    eq('也不会乱切中转站', G.中转站, '(空)');

    /* ===== H 组：收藏区分组按网址，同名不同站不许混 ===== */
    const H = await page.evaluate(async () => {
        window._boot();
        // 两个**真的同名**的中转站（同一家配了两条、或改名撞了），收藏区自愈会把站名按网址修正回来
        idbSet('api_manager_data', [
            { id: 'prov_A', name: '同名站', url: 'https://a.example.com', key: 'sk-aaa' },
            { id: 'prov_B', name: '同名站', url: 'https://b.example.com', key: 'sk-bbb' }
        ]);
        populateChatProviders();
        chatFavModels = [
            { url: 'https://a.example.com', model: 'gpt-x', providerId: 'prov_A', providerName: '同名站' },
            { url: 'https://b.example.com', model: 'claude-y', providerId: 'prov_B', providerName: '同名站' }
        ];
        _chatFavExpanded = true;
        chatRenderFavSection();
        const box = document.getElementById('chatFavSection');
        // 组标题的那几行（字号 11px 那种）
        const labels = Array.from(box.querySelectorAll('div')).filter(d => /font-size:\s*11px/.test(d.getAttribute('style') || '')).map(d => d.textContent);
        return { 组数: labels.length, 标题: labels };
    });
    eq('两个同名中转站分成两组（不再混排）', H.组数, 2);
    ok('组标题显示的仍是中转站名字、不是网址', H.标题.every(t => t === '同名站'));

    /* ===== I 组：收藏区标题的「当前:」不许瞎猜 ===== */
    const I = await page.evaluate(async () => {
        window._boot();
        chatFavModels = [{ url: 'https://b.example.com', model: 'claude-y', providerId: 'prov_B', providerName: '乙站' }];
        // 当前站是甲站，选中的模型却是乙站那条 → 不该显示「当前:」
        document.getElementById('chatProviderSelect').value = 'prov_A';
        chatSelectedModel = 'claude-y';
        chatUpdateFavHeader();
        const 对不上时 = document.getElementById('chatFavHeaderText').textContent;
        document.getElementById('chatProviderSelect').value = '';
        chatUpdateFavHeader();
        const 没中转站时 = document.getElementById('chatFavHeaderText').textContent;
        return { 对不上时, 没中转站时 };
    });
    ok('站和模型对不上时不显示「当前:」（宁可不显示也不能显示错的）', I.对不上时.indexOf('当前') === -1);
    ok('中转站空了要在标题上看得见', I.没中转站时.indexOf('没选中转站') !== -1);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
