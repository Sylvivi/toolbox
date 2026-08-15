/* 「输入框下面那行小字 → 点一下换收藏模型」回归测试。
 *
 * 起因：她 2026-08-16 说「我希望那个地方可以点击，然后切换收藏模型，
 * 这样我就不需要点clawd图标去设置里切换了，很省事」。
 *
 * ⚠️这功能有两个一碰就坏的地方，本文件主要就是钉住它们：
 *   ① **失焦时序**：那行小字是「输入框聚焦才显示」的，手指按上去输入框立刻 blur、
 *      小字随之 display:none —— 用 click 绑定必然落空。所以必须 pointerdown，
 *      且 blur 时若弹层开着就不能藏小字。
 *   ② **分组键用网址不用名字**：两个同名中转站会被并成一组，她踩过
 *      「我选的是一个，但实际选中的有可能是另外一个」。
 *
 * 跑法：node tests/favquick.test.js
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

    // 造两个**同名**中转站（同名是关键：这正是分组必须按网址的原因）+ 三个收藏
    await page.evaluate(() => {
        var keys = [
            { id: 'k1', name: '同名站', url: 'https://a.example.com/v1', key: 'sk-a' },
            { id: 'k2', name: '同名站', url: 'https://b.example.com/v1', key: 'sk-b' },
        ];
        localStorage.setItem('toolbox_keys', JSON.stringify(keys));
        // ⚠️chatFavProviderId 查的是**中转站下拉框里的选项**，不是存储——只塞 localStorage
        //   它认不出来，chatPickFavModel 会当成"这个站已经没了"直接返回。
        var sel = document.getElementById('chatProviderSelect');
        sel.innerHTML = '<option value="">选择中转站…</option>'
            + '<option value="k1">同名站</option><option value="k2">同名站</option>';
        // 切站会去拉模型列表（测试环境没网），桩掉；模型的选中是它之后同步做的，不受影响
        window.onChatProviderChange = function () {};
        chatFavModels = [
            { model: 'opus-4-6', url: 'https://a.example.com/v1', providerId: 'k1', providerName: '同名站' },
            { model: 'haiku-4-5', url: 'https://a.example.com/v1', providerId: 'k1', providerName: '同名站' },
            { model: 'sonnet-5', url: 'https://b.example.com/v1', providerId: 'k2', providerName: '同名站' },
        ];
        localStorage.setItem('chat_fav_models', JSON.stringify(chatFavModels));
    });

    /* ===== A 组：弹层内容 ===== */
    const A = await page.evaluate(() => {
        favQuickOpen();
        var pop = document.getElementById('favQuick');
        return {
            shown: pop.classList.contains('show'),
            grps: [].map.call(pop.querySelectorAll('.fq-grp'), e => e.textContent),
            items: [].map.call(pop.querySelectorAll('.fq-item:not(.fq-more)'), e => e.textContent.replace('✓', '')),
            hasMore: !!pop.querySelector('.fq-more'),
        };
    });
    ok('A1 弹层能打开', A.shown);
    // 两个站同名，但网址不同 → 必须是两组，不能并成一组
    ok('A2 同名不同站分成两组（不按名字并组）', A.grps.length === 2, JSON.stringify(A.grps));
    ok('A3 三个收藏都列出来了', A.items.length === 3, JSON.stringify(A.items));
    ok('A4 有「其它模型…」的出口', A.hasMore);

    /* ===== B 组：失焦时序 —— 这功能最容易坏的地方 ===== */
    const B = await page.evaluate(async () => {
        favQuickClose();
        var inp = document.getElementById('chatInput');
        var meta = document.getElementById('chatInputModelMeta');
        inp.focus();
        inp.dispatchEvent(new Event('focus'));
        var afterFocus = meta.style.display;

        // 模拟手指按在小字上：pointerdown（此时浏览器还没派发 blur）
        meta.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        var openedOnPointerdown = document.getElementById('favQuick').classList.contains('show');

        // 紧接着输入框失焦 —— 弹层开着时小字**不能**被藏起来
        inp.blur();
        inp.dispatchEvent(new Event('blur'));
        var metaAfterBlur = meta.style.display;

        return { afterFocus, openedOnPointerdown, metaAfterBlur };
    });
    ok('B1 聚焦输入框时小字出现', B.afterFocus === 'block', B.afterFocus);
    ok('B2 pointerdown 就开弹层（不能等 click，那时小字已经没了）', B.openedOnPointerdown === true);
    ok('B3 弹层开着时失焦不藏小字（藏了弹层锚点就没了）', B.metaAfterBlur === 'block', B.metaAfterBlur);

    /* ===== C 组：点一条就切过去 ===== */
    const C = await page.evaluate(() => {
        chatSelectedModel = '';
        favQuickOpen();
        var pop = document.getElementById('favQuick');
        var target = pop.querySelector('.fq-item:not(.fq-more)');
        var wantModel = target.querySelector('.fq-nm').textContent;
        target.click();
        return {
            wantModel: wantModel,
            selected: chatSelectedModel,
            closed: !pop.classList.contains('show'),
            metaText: document.getElementById('chatInputModelMeta').textContent,
        };
    });
    ok('C1 点一条就换成那个模型', C.selected === C.wantModel, C.selected + ' vs ' + C.wantModel);
    ok('C2 选完弹层自己关掉', C.closed === true);
    ok('C3 小字跟着更新成新模型', C.metaText.indexOf(C.selected) >= 0, C.metaText);

    /* ===== D 组：关闭后恢复原本的规矩 ===== */
    const D = await page.evaluate(() => {
        var meta = document.getElementById('chatInputModelMeta');
        var inp = document.getElementById('chatInput');
        inp.blur();
        favQuickOpen();
        favQuickClose();
        // 输入框不在焦点上 + 弹层已关 → 小字该收起来
        return { meta: meta.style.display, open: document.getElementById('favQuick').classList.contains('show') };
    });
    ok('D1 关掉弹层且输入框没焦点时，小字收起', D.meta === 'none', D.meta);
    ok('D2 关掉后 show 类被移除', D.open === false);

    /* ===== E 组：没有收藏时不能是死路 ===== */
    const E = await page.evaluate(() => {
        chatFavModels = [];
        favQuickOpen();
        var pop = document.getElementById('favQuick');
        return { txt: pop.textContent, hasMore: !!pop.querySelector('.fq-more') };
    });
    ok('E1 没收藏时给提示而不是空弹层', E.txt.indexOf('还没有收藏') >= 0, E.txt.slice(0, 40));
    ok('E2 没收藏时仍留着通往完整列表的出口', E.hasMore === true);

    ok('F1 全程无 JS 报错', pageErrs.length === 0, pageErrs.join(' / '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => { if (!r.pass) console.log('❌ ' + r.name + (r.detail ? '  →  ' + r.detail : '')); });
    console.log(bad.length ? ('❌ ' + bad.length + ' 条失败（共 ' + results.length + ' 条）') : ('✅ 全过（' + results.length + ' 条）'));
    process.exit(bad.length ? 1 : 0);
})();
