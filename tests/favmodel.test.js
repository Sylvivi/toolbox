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

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
