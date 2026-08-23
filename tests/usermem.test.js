/* 「蘑菇记得的我」的回归测试。
 *
 * 起因：2026-08-23。她原话「AI 做伴读我很喜欢，但我同时也想让它了解我，
 * 而不是每次都重新开始」。做了一份跨书、跨对话的用户画像，每次请求塞进系统提示词。
 *
 * ⚠️这次改动的真正风险有三个，下面分组钉死：
 *   ① **空的时候必须返回空串**。塞一句「（暂无）」进系统提示词，等于告诉模型
 *      "你本该认识她但是不认识"，它会掉头盘问用户——比没这个功能还烦。
 *   ② **必须进 manifest**。不进就只存在这台设备上，她有三个入口（电脑/手机Chrome/桌面图标），
 *      换一个就"失忆"，那这功能等于没做。
 *   ③ **面板上删得掉**。记忆会记错，删不掉的记忆是负资产。清空输入框＝删，跟 ✕ 等价。
 *
 * 跑法：node tests/usermem.test.js   或   bash tests/p.sh usermem
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* ===== A 组：存取 ===== */
    const A = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        localStorage.removeItem('toolbox_user_memory_ts');
        const 起始 = umLoad().length;
        const id1 = umAdd('不爱看大段心理独白', '阅读口味');
        umAdd('不爱看大段心理独白', '阅读口味');      // 一模一样，不该记两遍
        const 去重后 = umLoad().length;
        umAdd('养了一只猫', '生活');
        const 两条 = umLoad().length;
        umUpdate(id1, '不爱看大段心理独白，会直接跳过');
        const 改后 = umLoad().filter(x => x.id === id1)[0].content;
        umRemove(id1);
        const 删后 = umLoad().length;
        const 删掉的还在吗 = umLoad().some(x => x.id === id1);
        umAdd('x'.repeat(300));
        const 截断后 = umLoad().filter(x => /^x+$/.test(x.content))[0].content.length;
        return { 起始, 去重后, 两条, 改后, 删后, 删掉的还在吗, 截断后 };
    });
    eq('没记过就是空的', A.起始, 0);
    eq('一模一样的内容不记两遍', A.去重后, 1);
    eq('不同内容各记一条', A.两条, 2);
    eq('改得动', A.改后, '不爱看大段心理独白，会直接跳过');
    eq('删得掉（条数少一条）', A.删后, 1);
    eq('删掉的确实没了', A.删掉的还在吗, false);
    eq('单条超长截到 200 字（系统提示词不能被一条撑爆）', A.截断后, 200);

    /* ===== B 组：条数上限 ===== */
    const B = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        for (let i = 0; i < USER_MEM_MAX + 10; i++) umAdd('第' + i + '条');
        const list = umLoad();
        return { 条数: list.length, 最老的: list[0].content, 最新的: list[list.length - 1].content };
    });
    eq('封顶在 USER_MEM_MAX', B.条数, 60);
    eq('满了丢最老的那条', B.最老的, '第10条');
    ok('最新的留着', B.最新的 === '第69条', '实际 ' + B.最新的);

    /* ===== C 组：拼给 AI 的那段文字（① 号风险）===== */
    const C = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        const 空的时候 = umText();
        chatSetUserName('小明');
        umAdd('不爱看大段心理独白', '阅读口味');
        umAdd('养了一只猫');
        const 有内容 = umText();
        chatSetUserName('');
        return {
            空的时候,
            带昵称: 有内容.indexOf('小明') >= 0,
            带内容: 有内容.indexOf('不爱看大段心理独白') >= 0,
            带分类: 有内容.indexOf('[阅读口味]') >= 0,
            没分类的也在: 有内容.indexOf('养了一只猫') >= 0
        };
    });
    eq('⚠️空的时候返回空串，绝不塞「暂无」进系统提示词', C.空的时候, '');
    ok('用的是当前昵称，不写死名字（朋友也在用）', C.带昵称, '实际 ' + C.带昵称);
    ok('记忆内容在里面', C.带内容, '');
    ok('有分类的带上分类', C.带分类, '');
    ok('没分类的也照样列出来', C.没分类的也在, '');

    /* ===== D 组：云同步（② 号风险）===== */
    const D = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        umAdd('测试同步用的一条');
        const m = cfBuildManifest();
        return {
            有这一项: m.userMemory !== undefined,
            条数: (m.userMemory || []).length,
            有时间戳: !!m.userMemoryTs,
            内容对得上: ((m.userMemory || [])[0] || {}).content
        };
    });
    ok('⚠️manifest 里带上了 userMemory（不然换设备就失忆）', D.有这一项, '');
    eq('条数对得上', D.条数, 1);
    ok('带时间戳（同步靠它判谁新）', D.有时间戳, '');
    eq('内容对得上', D.内容对得上, '测试同步用的一条');

    /* ===== E 组：设置面板上的增删改（③ 号风险）===== */
    const E = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        umAdd('第一条');
        umAdd('第二条');
        umAdd('第三条');
        umRenderPanel();
        const box = document.getElementById('chatUserMemList');
        const 渲染出几条 = box.querySelectorAll('input[data-um]').length;
        const 计数文字 = (document.getElementById('chatUserMemCount') || {}).textContent;

        // 点 ✕ 删掉第二条
        const 第二个输入框 = box.querySelectorAll('input[data-um]')[1];
        第二个输入框.parentNode.querySelector('span').click();
        const 删后条数 = umLoad().length;
        const 删掉的是第二条 = !umLoad().some(x => x.content === '第二条');

        // 在输入框里改字 → 失焦保存
        const 头一个 = box.querySelectorAll('input[data-um]')[0];
        头一个.value = '第一条改过了';
        umOnEdit(头一个);
        const 改后内容 = umLoad()[0].content;

        // 清空输入框 = 删掉这条
        const 又一个 = box.querySelectorAll('input[data-um]')[0];
        又一个.value = '   ';
        umOnEdit(又一个);
        const 清空后条数 = umLoad().length;

        // 底下那个「加」
        document.getElementById('chatUserMemInput').value = '手写加进去的';
        umOnAdd();
        const 加完条数 = umLoad().length;
        const 输入框清空了 = document.getElementById('chatUserMemInput').value === '';
        return { 渲染出几条, 计数文字, 删后条数, 删掉的是第二条, 改后内容, 清空后条数, 加完条数, 输入框清空了 };
    });
    eq('三条都渲染出来', E.渲染出几条, 3);
    eq('右上角显示条数', E.计数文字, '3 条');
    eq('点 ✕ 删掉一条', E.删后条数, 2);
    ok('删掉的正是点的那条（不是删错行）', E.删掉的是第二条, '');
    eq('在格子里改字能存下', E.改后内容, '第一条改过了');
    eq('⚠️清空格子＝删掉这条', E.清空后条数, 1);
    eq('底下「加」能加进去', E.加完条数, 2);
    ok('加完输入框自己清空', E.输入框清空了, '');

    /* ===== F 组：空面板的提示语 ===== */
    const F = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        umRenderPanel();
        const box = document.getElementById('chatUserMemList');
        return {
            没有输入框: box.querySelectorAll('input[data-um]').length,
            有提示: box.textContent.indexOf('还没有') >= 0,
            计数是空的: (document.getElementById('chatUserMemCount') || {}).textContent
        };
    });
    eq('一条都没有时不渲染空行', F.没有输入框, 0);
    ok('给一句提示而不是一片空白', F.有提示, '');
    eq('零条时不显示「0 条」', F.计数是空的, '');

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + (r.detail || ''))); });
    console.log(bad === 0 ? ('\n全过（' + results.length + ' 项）') : ('\n❌ ' + bad + '/' + results.length + ' 项没过'));
    process.exit(bad === 0 ? 0 : 1);
})();
