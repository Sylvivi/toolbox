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
        umAdd('x'.repeat(1500));
        const 截断后 = umLoad().filter(x => /^x+$/.test(x.content))[0].content.length;
        return { 起始, 去重后, 两条, 改后, 删后, 删掉的还在吗, 截断后 };
    });
    eq('没记过就是空的', A.起始, 0);
    eq('一模一样的内容不记两遍', A.去重后, 1);
    eq('不同内容各记一条', A.两条, 2);
    eq('改得动', A.改后, '不爱看大段心理独白，会直接跳过');
    eq('删得掉（条数少一条）', A.删后, 1);
    eq('删掉的确实没了', A.删掉的还在吗, false);
    // ⚠️2026-08-23 晚从 200 提到 1000：硬上限只当保险丝，别再拿它去「逼条目写短」——
    //   她粘档案时被静默截掉一半，那次教训见 Q 组注释。
    eq('单条超长截到 1000 字（保险丝，防一条把提示词撑爆）', A.截断后, 1000);

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

    /* ===== E 组：面板上的增删改（③ 号风险）=====
       ⚠️2026-08-23 这块 HTML 从设置页挪进了「📋 摘要」弹窗的「我」标签（她不喜欢原来那个入口）。
       弹窗要有书才开得起来，所以测试里直接把 umPaneHtml() 挂进 body 再验——
       验的是「这块 HTML + umRenderPanel」这一对，跟它挂在哪个弹窗里无关。 */
    const E = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        var host = document.getElementById('umTestHost');
        if (!host) { host = document.createElement('div'); host.id = 'umTestHost'; document.body.appendChild(host); }
        host.innerHTML = umPaneHtml();
        umAdd('第一条');
        umAdd('第二条');
        umAdd('第三条');
        umRenderPanel();
        const box = document.getElementById('chatUserMemList');
        const 渲染出几条 = box.querySelectorAll('textarea[data-um]').length;
        const 计数文字 = (document.getElementById('chatUserMemCount') || {}).textContent;

        // 点 ✕ 删掉第二条
        const 第二个输入框 = box.querySelectorAll('textarea[data-um]')[1];
        第二个输入框.parentNode.querySelector('span[title="忘掉这条"]').click();
        const 删后条数 = umLoad().length;
        const 删掉的是第二条 = !umLoad().some(x => x.content === '第二条');

        // 在输入框里改字 → 失焦保存
        const 头一个 = box.querySelectorAll('textarea[data-um]')[0];
        头一个.value = '第一条改过了';
        umOnEdit(头一个);
        const 改后内容 = umLoad()[0].content;

        // 清空输入框 = 删掉这条
        const 又一个 = box.querySelectorAll('textarea[data-um]')[0];
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
        document.getElementById('umTestHost').innerHTML = umPaneHtml();
        umRenderPanel();
        const box = document.getElementById('chatUserMemList');
        return {
            没有输入框: box.querySelectorAll('textarea[data-um]').length,
            有提示: box.textContent.indexOf('还没有') >= 0,
            计数是空的: (document.getElementById('chatUserMemCount') || {}).textContent
        };
    });
    eq('一条都没有时不渲染空行', F.没有输入框, 0);
    ok('给一句提示而不是一片空白', F.有提示, '');
    eq('零条时不显示「0 条」', F.计数是空的, '');

    /* ===== G 组：入口挂对了地方 ===== */
    const G = await page.evaluate(() => {
        const h = umPaneHtml();
        return {
            带列表容器: h.indexOf('id="chatUserMemList"') >= 0,
            添加框能多行: h.indexOf('<textarea id="chatUserMemInput"') >= 0,
            带计数: h.indexOf('id="chatUserMemCount"') >= 0,
            带输入框: h.indexOf('id="chatUserMemInput"') >= 0,
            // 两个摘要弹窗都得把「我」推进 panes，否则某个模式下点不到
            阅读模式弹窗里有: readerShowSummaryModal.toString().indexOf("umPaneHtml()") >= 0,
            对话模式弹窗里有: chatShowSummaryModal.toString().indexOf("umPaneHtml()") >= 0,
            // 她要求排第一（2026-08-23）：unshift 不是 push
            两边都排第一: /unshift\(\{\s*key:\s*'usermem'/.test(readerShowSummaryModal.toString())
                       && /unshift\(\{\s*key:\s*'usermem'/.test(chatShowSummaryModal.toString()),
            // ⚠️旧入口必须拆干净，否则同一组 id 在页面上出现两次、umRenderPanel 只认头一个
            设置页那块已拆: !document.getElementById('chatUserMemRow')
        };
    });
    ok('这块 HTML 自带列表容器', G.带列表容器, '');
    ok('添加框是多行的（她可能整段粘档案）', G.添加框能多行, '');
    ok('自带条数', G.带计数, '');
    ok('自带输入框', G.带输入框, '');
    ok('阅读模式的「摘要」弹窗里有「我」这一页', G.阅读模式弹窗里有, '');
    ok('普通对话的「摘要」弹窗里也有', G.对话模式弹窗里有, '');
    ok('⚠️「我」排在第一个 Tab（她要求的）', G.两边都排第一, '');
    ok('⚠️设置页那个旧入口已拆干净（同组 id 不能有两份）', G.设置页那块已拆, '');

    /* ===== H 组：让蘑菇自己动手记（2026-08-23 第二步）=====
       ⚠️这一半走的是「旁路」：主对话不带 tools，回答完之后另起一次小请求。
       所以这里**把 fetch 换成假的**，验的是「拿到 tool_calls 之后做对了什么」，不打真接口。 */
    const H = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_user_memory');
        localStorage.setItem('toolbox_user_memory_auto', '1');
        const conn = { baseUrl: 'https://fake', apiKey: 'k', model: 'm' };
        const 真fetch = window.fetch;
        let 打了几次 = 0, 送出去的 = null;
        const 假回 = (calls) => {
            window.fetch = async (u, o) => {
                打了几次++;
                送出去的 = JSON.parse(o.body);
                return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: calls } }] }) };
            };
        };
        const 调用 = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });

        // ① 正常记一条
        假回([调用('remember', { content: '她讨厌一上来就交代身世的开头', tag: '阅读口味' })]);
        await umMaybeReview('我最烦那种开头就报身世的', '哈哈我也是', conn);
        const 记了 = umLoad().map(x => x.content);
        const 带了工具 = !!(送出去的 && 送出去的.tools && 送出去的.tools.length === 3);
        const 工具名 = (送出去的.tools || []).map(t => t.function.name);
        const 没开流 = 送出去的.stream === undefined;
        const 提示词里有她的话 = 送出去的.messages[1].content.indexOf('我最烦那种开头就报身世的') >= 0;
        const 提示词带了现有记忆 = 送出去的.messages[0].content.indexOf('你现在记着这些') >= 0;

        // ② 改一条
        const id = umLoad()[0].id;
        假回([调用('update_memory', { id, content: '她其实不介意身世，介意的是写得干巴' })]);
        await umMaybeReview('想想也不全是，写得好我也看', '嗯', conn);
        const 改后 = umLoad()[0].content;

        // ③ 忘掉
        假回([调用('forget', { id })]);
        await umMaybeReview('刚那条不算数', '好', conn);
        const 忘后条数 = umLoad().length;

        // ④ 线路不支持工具：只回文字、没有 tool_calls → 什么都别做，也别报错
        umAdd('底线：这条不能被动');
        window.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '嗯嗯' } }] }) });
        await umMaybeReview('随便说点什么', '嗯嗯', conn);
        const 不支持时条数 = umLoad().length;

        // ⑤ 坏 JSON 参数不炸
        假回([{ function: { name: 'remember', arguments: '{坏掉的' } }]);
        await umMaybeReview('再说一句', '嗯', conn);
        const 坏参数后条数 = umLoad().length;

        // ⑥ 开关关掉 → 一次都不打
        const 关前 = 打了几次;
        localStorage.setItem('toolbox_user_memory_auto', '0');
        假回([调用('remember', { content: '不该被记进来' })]);
        await umMaybeReview('说点什么', '嗯', conn);
        const 关掉后打的次数 = 打了几次 - 关前;
        localStorage.setItem('toolbox_user_memory_auto', '1');

        // ⑦ 用户没说话（空）→ 不打；正文那么长也不打
        const 关前2 = 打了几次;
        await umMaybeReview('', '嗯', conn);
        await umMaybeReview('正'.repeat(5000), '嗯', conn);
        const 空和超长打的次数 = 打了几次 - 关前2;

        // ⑧ 接口挂了不影响任何东西
        window.fetch = async () => { throw new Error('断网'); };
        let 抛了 = false;
        try { await umMaybeReview('还在吗', '在', conn); } catch (e) { 抛了 = true; }

        window.fetch = 真fetch;
        return { 记了, 带了工具, 工具名, 没开流, 提示词里有她的话, 提示词带了现有记忆,
                 改后, 忘后条数, 不支持时条数, 坏参数后条数, 关掉后打的次数, 空和超长打的次数, 抛了 };
    });
    eq('remember 真的记进去了', H.记了, ['她讨厌一上来就交代身世的开头']);
    ok('请求里带了三个工具', H.带了工具, '实际 ' + JSON.stringify(H.工具名));
    eq('⚠️工具名必须是纯英文（中文名有的中转站直接报参数错）', H.工具名, ['remember', 'update_memory', 'forget']);
    ok('旁路这次不开流（非流式好解析）', H.没开流, '');
    ok('把她刚说的话送过去了', H.提示词里有她的话, '');
    ok('把现有记忆一起送过去（不然它没法改、没法忘）', H.提示词带了现有记忆, '');
    eq('update_memory 改得动', H.改后, '她其实不介意身世，介意的是写得干巴');
    eq('forget 忘得掉', H.忘后条数, 0);
    eq('⚠️线路不支持工具时静默作罢，不动已有记忆', H.不支持时条数, 1);
    eq('坏 JSON 参数不炸也不乱记', H.坏参数后条数, 1);
    eq('⚠️开关关掉就一次都不打（她的钱）', H.关掉后打的次数, 0);
    eq('⚠️她没说话 / 发的是整章正文，都不打', H.空和超长打的次数, 0);
    ok('接口挂了不往外抛（绝不能影响正在读书的人）', H.抛了 === false, '');

    /* ===== I 组：聊天里那行小字 ===== */
    const I = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        const id = umAdd('待会儿要撤销的');
        const c = document.getElementById('chatMessages');
        const 原有 = c ? c.children.length : -1;
        umShowToolLine([{ icon: '🍄', text: '记住了：待会儿要撤销的', undo: id }]);
        const 多了一行 = c.children.length - 原有;
        const 文字 = c.lastChild.textContent;
        c.lastChild.querySelector('[data-umundo]').click();
        const 撤销后条数 = umLoad().length;
        // ⚠️不能写进 chatMessages：写了会跟着进上下文和摘要
        const 没混进消息历史 = !chatMessages.some(m => (m.content || '').indexOf('记住了：待会儿要撤销的') >= 0);
        c.lastChild.remove();
        return { 多了一行, 有内容: 文字.indexOf('待会儿要撤销的') >= 0, 有撤销: 文字.indexOf('撤销') >= 0, 撤销后条数, 没混进消息历史 };
    });
    eq('聊天里冒出一行', I.多了一行, 1);
    ok('那行写着记了什么', I.有内容, '');
    ok('带「撤销」', I.有撤销, '');
    eq('点撤销真的删掉了', I.撤销后条数, 0);
    ok('⚠️这行不写进消息历史（否则会跟着进上下文和摘要）', I.没混进消息历史, '');

    /* ===== J 组：谁记的 + 新增/改动标记 + 防冗长（2026-08-23 她追加的三条）===== */
    const J = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_user_memory');
        localStorage.setItem('toolbox_user_memory_auto', '1');
        const conn = { baseUrl: 'https://fake', apiKey: 'k', model: 'm' };
        const 真fetch = window.fetch;
        let 送出去的 = null;
        const 假回 = (calls) => {
            window.fetch = async (u, o) => {
                送出去的 = JSON.parse(o.body);
                return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: calls } }] }) };
            };
        };
        const 调用 = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });

        // 手动加的 = 我；工具记的 = 蘑菇
        const 我的id = umAdd('我自己写的一条', '', 'me');
        假回([调用('remember', { content: '蘑菇记的一条' })]);
        await umMaybeReview('说点什么', '嗯', conn);
        const by = {};
        umLoad().forEach(x => { by[x.content] = x.by; });

        // 送给模型的清单里，她亲手写的要标出来（不然蘑菇会去改她的话）
        const 清单 = 送出去的.messages[0].content;
        const 标了她写的 = 清单.indexOf('【她亲手写的】我自己写的一条') >= 0;
        const 蘑菇那条没标 = 清单.indexOf('【她亲手写的】蘑菇记的一条') < 0;
        const 提示词交代了别动 = 清单.indexOf('一个字都别动') >= 0;

        // 新增/改动标记
        const 新的都带标 = umLoad().every(x => x._chg === 'new');
        umUpdate(我的id, '改过之后的内容');
        const 新的改了还是新的 = umLoad().filter(x => x.id === 我的id)[0]._chg;
        // 标记清掉之后（＝她已经看过）再改，才该变成「改过」
        const 清 = umLoad(); 清.forEach(x => delete x._chg); umSaveList(清, true);
        umUpdate(我的id, '看过之后又改了一次');
        const 改的标记 = umLoad().filter(x => x.id === 我的id)[0]._chg;

        // ⚠️一轮最多采纳 2 条新记的
        localStorage.removeItem('toolbox_user_memory');
        假回([调用('remember', { content: 'A' }), 调用('remember', { content: 'B' }),
              调用('remember', { content: 'C' }), 调用('remember', { content: 'D' })]);
        await umMaybeReview('叭叭叭说了一大堆', '嗯', conn);
        const 一轮记了几条 = umLoad().length;

        // 改和忘不受这个闸限制（它俩是在瘦身）
        const ids = umLoad().map(x => x.id);
        假回([调用('forget', { id: ids[0] }), 调用('forget', { id: ids[1] })]);
        await umMaybeReview('那两条都不算', '好', conn);
        const 忘完剩几条 = umLoad().length;

        window.fetch = 真fetch;
        return { by, 标了她写的, 蘑菇那条没标, 提示词交代了别动, 新的都带标, 新的改了还是新的, 改的标记, 一轮记了几条, 忘完剩几条 };
    });
    eq('自己加的记成「我」', J.by['我自己写的一条'], 'me');
    eq('蘑菇记的记成「蘑菇」', J.by['蘑菇记的一条'], 'mushroom');
    ok('⚠️送给模型的清单里标出「她亲手写的」', J.标了她写的, '');
    ok('蘑菇自己记的不加那个标', J.蘑菇那条没标, '');
    ok('⚠️提示词交代了别动她亲手写的（不然它会去改她的话）', J.提示词交代了别动, '');
    ok('新记的都带「新增」标记', J.新的都带标, '');
    eq('刚记下的被改，仍算「新增」（她还没看过，不该降级成黄点）', J.新的改了还是新的, 'new');
    eq('她看过之后再改，才变成「改过」', J.改的标记, 'upd');
    eq('⚠️一轮最多采纳 2 条新记的（防冗长）', J.一轮记了几条, 2);
    eq('但「忘掉」不受这个闸限制（那是在瘦身）', J.忘完剩几条, 0);

    /* ===== K 组：圆点看过就清 ===== */
    const K = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_user_memory');
        umAdd('看一眼就该清标记的', '', 'me');
        document.getElementById('umTestHost').innerHTML = umPaneHtml();
        umRenderPanel();
        const 画出来有点 = !!document.querySelector('#chatUserMemList span[title="新记的"]');
        const 图标 = document.querySelector('#chatUserMemList span[title="蘑菇自己记的"]');
        await new Promise(r => setTimeout(r, 1600));
        const 清掉了 = umLoad().every(x => !x._chg);
        const 圆点还在屏幕上 = !!document.querySelector('#chatUserMemList span[title="新记的"]');
        return { 画出来有点, 我写的没蘑菇图标: !图标, 清掉了, 圆点还在屏幕上 };
    });
    ok('新记的那条前面画了绿点', K.画出来有点, '');
    ok('自己写的不挂 🍄（留白就是区分）', K.我写的没蘑菇图标, '');
    ok('⚠️看过之后标记清掉了（下次打开就干净）', K.清掉了, '');
    ok('⚠️但这次屏幕上的圆点没被抹掉（清标记时不重画）', K.圆点还在屏幕上, '');

    /* ===== L 组：「整理一下」（2026-08-23，她撞上「记成五条近义的」之后加的）=====
       ⚠️最要命的一条：**她亲手写的绝不能被合并掉**。她那两条男生子声明是原话粘进去的。 */
    const L = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_user_memory');
        window.umConn = () => ({ baseUrl: 'https://fake', apiKey: 'k', model: 'm' });  // 测试页没选中转站
        const 真fetch = window.fetch;
        let 送出去的 = null;
        const 假回 = (text) => {
            window.fetch = async (u, o) => {
                送出去的 = JSON.parse(o.body);
                return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) };
            };
        };
        // 造场景：她自己写 2 条，蘑菇记 5 条近义的
        umAdd('【我读的题材】男生子设定，天经地义', '', 'me');
        umAdd('直接自然代入，别强调它少见', '', 'me');
        ['隐忍感', '孕期自卑', '女主不卑微', '别落在感动上', '偏爱酸涩'].forEach(t => umAdd('她喜欢' + t + '这一挂的', '', 'mushroom'));
        const 整理前 = umLoad().length;

        假回('- 她偏爱男生子文里的隐忍和酸涩：孕期自卑、女主不卑微、结局别落在感动上\n- 另一条不相干的');
        await umTidy(null);

        const 清单 = 送出去的.messages[0].content;
        const 送了蘑菇那五条 = ['隐忍感', '孕期自卑', '女主不卑微'].every(t => 清单.indexOf('她喜欢' + t) >= 0);
        const 说明了她的别动 = 清单.indexOf('不归你管、也不要动') >= 0;

        // 预览阶段：还没落地
        const 预览时没变 = umLoad().length === 整理前;
        const 预览里有新内容 = document.getElementById('chatUserMemList').textContent.indexOf('隐忍和酸涩') >= 0;

        umTidyApply();
        const 后 = umLoad();
        return {
            整理前,
            送了蘑菇那五条, 说明了她的别动, 预览时没变, 预览里有新内容,
            整理后条数: 后.length,
            她的还在: 后.filter(x => x.by !== 'mushroom').map(x => x.content),
            蘑菇的: 后.filter(x => x.by === 'mushroom').map(x => x.content),
            新的都带标: 后.filter(x => x.by === 'mushroom').every(x => x._chg === 'new'),
            _真fetch: (window.fetch = 真fetch, true)
        };
    });
    eq('场景造对了（她 2 条 + 蘑菇 5 条）', L.整理前, 7);
    ok('把蘑菇记的那几条送去合并', L.送了蘑菇那五条, '');
    ok('⚠️明确交代她亲手写的不许动', L.说明了她的别动, '');
    ok('⚠️预览阶段一个字都还没改（她点头才落地）', L.预览时没变, '');
    ok('预览里看得到合并后的内容', L.预览里有新内容, '');
    eq('落地后：她的 2 条 + 合并出的 2 条', L.整理后条数, 4);
    eq('⚠️她亲手写的原封不动', L.她的还在, ['【我读的题材】男生子设定，天经地义', '直接自然代入，别强调它少见']);
    eq('蘑菇那 5 条合成了 2 条', L.蘑菇的.length, 2);
    ok('合并后的内容对得上', L.蘑菇的[0].indexOf('隐忍和酸涩') >= 0, '实际 ' + L.蘑菇的[0]);
    ok('新换上来的带「新增」标记，好认', L.新的都带标, '');

    /* ===== M 组：整理的边界 ===== */
    const M = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_user_memory');
        window.umConn = () => ({ baseUrl: 'https://fake', apiKey: 'k', model: 'm' });
        const 真fetch = window.fetch;
        let 打了 = 0;
        window.fetch = async () => { 打了++; return { ok: true, json: async () => ({ choices: [{ message: { content: '- 甲' } }] }) }; };
        // 蘑菇记的不到 3 条：不值得整理，别白花钱
        umAdd('就一条', '', 'mushroom');
        await umTidy(null);
        const 太少时打了 = 打了;

        // 它回了一堆废话、一条都读不出来 → 不能把记忆清空
        ['甲','乙','丙'].forEach(t => umAdd(t + '的事', '', 'mushroom'));
        window.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '好的！' } }] }) });
        await umTidy(null);
        const 读不懂时条数 = umLoad().length;

        // 接口挂了也不能动数据
        window.fetch = async () => { throw new Error('断网'); };
        let 抛了 = false;
        try { await umTidy(null); } catch (e) { 抛了 = true; }
        const 挂了之后条数 = umLoad().length;
        window.fetch = 真fetch;
        return { 太少时打了, 读不懂时条数, 挂了之后条数, 抛了 };
    });
    eq('蘑菇记的不到 3 条就不整理（别白花钱）', M.太少时打了, 0);
    eq('⚠️它回了废话读不出条目时，记忆一条不动', M.读不懂时条数, 4);
    eq('⚠️接口挂了记忆也一条不动', M.挂了之后条数, 4);
    ok('整理失败不往外抛', M.抛了 === false, '');

    /* ===== N 组：跟着书走的那一半（2026-08-23 晚）=====
       她的场景：读《故事的解剖》时跟 AI 约好「拿摄政王当小白鼠套理论」，
       换个段落提问就丢了。⚠️最要命的一条：**换书之后别的书的约定绝不能漏进来**。 */
    const N = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_user_memory');
        // 桩掉「当前是哪本书」，测试页没真开书
        let 当前书 = { fileName: '故事的解剖.epub', fileSize: 111 };
        window.rbCurBook = () => 当前书;
        window.rbCurBookName = () => (当前书 ? 当前书.fileName.replace(/\.epub$/, '') : '');

        umAdd('她不爱看大段心理独白', '', 'me', 'me');
        umAdd('说好拿摄政王当小白鼠来套书里的理论', '', 'mushroom', 'book');
        const 甲书条数 = umLoadBook().length;
        const 甲书注入 = umText();

        // 换一本书
        当前书 = { fileName: '呼啸山庄.epub', fileSize: 222 };
        const 乙书条数 = umLoadBook().length;
        const 乙书注入 = umText();
        umAdd('这本按第三幕结构聊', '', 'mushroom', 'book');

        // 回到第一本
        当前书 = { fileName: '故事的解剖.epub', fileSize: 111 };
        const 回来还在 = umLoadBook().map(x => x.content);
        const 回来注入 = umText();

        // 没在读书时，scope=book 要退回全局，不能凭空造一条挂在空书上
        当前书 = null;
        const id空 = umAdd('没开书时记的', '', 'mushroom', 'book');
        const 空书那条 = umLoad().filter(x => x.id === id空)[0];

        return {
            甲书条数, 乙书条数,
            甲书带了摄政王: 甲书注入.indexOf('摄政王') >= 0,
            甲书带了关于我: 甲书注入.indexOf('大段心理独白') >= 0,
            乙书没带摄政王: 乙书注入.indexOf('摄政王') < 0,
            乙书仍带关于我: 乙书注入.indexOf('大段心理独白') >= 0,
            乙书没带甲书标题: 乙书注入.indexOf('故事的解剖') < 0,
            回来还在, 回来带书名: 回来注入.indexOf('故事的解剖') >= 0,
            空书退回全局: (空书那条 || {}).book === ''
        };
    });
    eq('这本书记了 1 条', N.甲书条数, 1);
    ok('读这本书时带上了这本书的约定', N.甲书带了摄政王, '');
    ok('同时也带着「关于我」那些', N.甲书带了关于我, '');
    eq('换一本书，那本还没有约定', N.乙书条数, 0);
    ok('⚠️换书之后上一本的约定一个字都没漏过来', N.乙书没带摄政王, '');
    ok('⚠️连上一本的书名都没漏', N.乙书没带甲书标题, '');
    ok('「关于我」那些换书照样带着', N.乙书仍带关于我, '');
    eq('⚠️换回来，原来的约定还在（换书只是不注入，不是删掉）', N.回来还在, ['说好拿摄政王当小白鼠来套书里的理论']);
    ok('注入时点明是哪本书', N.回来带书名, '');
    ok('⚠️没在读书时 scope=book 退回全局，不挂到空书上', N.空书退回全局, '');

    /* ===== O 组：工具带 scope + 整理不碰书里的约定 ===== */
    const O = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_user_memory');
        window.rbCurBook = () => ({ fileName: '故事的解剖.epub', fileSize: 111 });
        window.rbCurBookName = () => '故事的解剖';
        window.umConn = () => ({ baseUrl: 'https://fake', apiKey: 'k', model: 'm' });
        const 真fetch = window.fetch;
        const 调用 = (name, args) => ({ function: { name, arguments: JSON.stringify(args) } });
        let 送出去的 = null;

        // 工具说明里得有 scope，而且写清了判据
        const t = umTools()[0].function;
        const 有scope = !!(t.parameters.properties.scope);
        const 判据在说明里 = (t.parameters.properties.scope.description || '').indexOf('换一本书之后这话还成立吗') >= 0;

        window.fetch = async (u, o) => {
            送出去的 = JSON.parse(o.body);
            return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [
                调用('remember', { content: '拿摄政王当例子', scope: 'book' }),
                调用('remember', { content: '她熬夜看书', scope: 'me' })
            ] } }] }) };
        };
        await umMaybeReview('我们就拿摄政王当小白鼠吧，我一般熬夜看', '好', conn0 = { baseUrl: 'https://fake', apiKey: 'k', model: 'm' });
        const 分对了 = { 书: umLoadBook().map(x => x.content), 我: umLoadMine().map(x => x.content) };
        const 清单分组了 = 送出去的.messages[0].content.indexOf('〔读《故事的解剖》时说好的〕') >= 0;

        // 整理：只动「关于我」里蘑菇记的，书上的约定不许碰
        ['甲','乙','丙'].forEach(t2 => umAdd('她喜欢' + t2, '', 'mushroom', 'me'));
        window.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '- 她喜欢甲乙丙' } }] }) });
        await umTidy(null);
        umTidyApply();
        const 整理后 = { 书: umLoadBook().map(x => x.content), 我: umLoadMine().map(x => x.content) };
        window.fetch = 真fetch;
        return { 有scope, 判据在说明里, 分对了, 清单分组了, 整理后 };
    });
    ok('工具带了 scope 参数', O.有scope, '');
    ok('说明里写了那把尺子（换本书还成立吗）', O.判据在说明里, '');
    eq('scope=book 的记到书上', O.分对了.书, ['拿摄政王当例子']);
    eq('scope=me 的记到「关于我」', O.分对了.我, ['她熬夜看书']);
    ok('送给模型的清单按两组分开列', O.清单分组了, '');
    eq('⚠️整理不碰书里的约定', O.整理后.书, ['拿摄政王当例子']);
    // ⚠️整理是「整组替换」：模型这次只吐了一条，那「关于我」里蘑菇记的就全被这一条顶掉了
    //（包括「她熬夜看书」）。这不是 bug，正是为什么落地前一定要她看预览。
    eq('「关于我」里蘑菇记的整组被合并结果顶替', O.整理后.我, ['她喜欢甲乙丙']);

    /* ===== P 组：档案型记忆（2026-08-23 晚，她原话「我想把人物档案加进去空间不够了」）=====
       起因是她和蘑菇在《故事的解剖》里共创的「专属小白鼠档案」：摄政王萧濯 / 长公主李昭 /
       核心张力 / 当前任务，**分行分字段、会持续增补、明显超过 200 字**。 */
    const P = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        window.rbCurBook = () => ({ fileName: '故事的解剖.epub', fileSize: 111 });
        window.rbCurBookName = () => '故事的解剖';

        const 档案 = [
            '【专属小白鼠档案】',
            '男主：摄政王萧濯（怀胎四月，死要面子强装冷酷，朝服暗褶放宽三寸）',
            '女主：长公主李昭（政敌，敏锐腹黑，已经抓住了他的小辫子）',
            '核心张力：大权在握的威严预期 vs 揣着崽处处受制的现实落差',
            '当前任务：作为"陪练"，验证本书后续的"渐进式困境""危机""高潮"'
        ].join('\n');

        const 书id = umAdd(档案, '', 'mushroom', 'book');
        const 存下的 = umLoad().filter(x => x.id === 书id)[0];

        const 我id = umAdd('我'.repeat(1500), '', 'me', 'me');
        const 我的长度 = umLoad().filter(x => x.id === 我id)[0].content.length;
        const 长档案id = umAdd('书'.repeat(1500), '', 'mushroom', 'book');
        const 书的长度 = umLoad().filter(x => x.id === 长档案id)[0].content.length;

        umUpdate(书id, 档案 + '\n腹中胎儿系女主亲生，目前是一笔极其危险的糊涂账。' + '后续设定'.repeat(60));
        const 补全后 = umLoad().filter(x => x.id === 书id)[0].content;

        const 注入 = umText();
        document.getElementById('umTestHost').innerHTML = umPaneHtml();
        umRenderPanel();
        const ta = document.querySelector('#chatUserMemList textarea[data-um="' + 书id + '"]');

        return {
            换行没被吃掉: 存下的.content.indexOf('\n女主：长公主李昭') >= 0,
            档案长度: 存下的.content.length,
            我的长度, 书的长度,
            补全后有胎儿: 补全后.indexOf('腹中胎儿系女主亲生') >= 0,
            补全后长度: 补全后.length,
            注入里是整块: 注入.indexOf('核心张力：大权在握') >= 0,
            注入没被加列表符: 注入.indexOf('- 【专属小白鼠档案】') < 0,
            面板里是多行框: !!ta && ta.tagName === 'TEXTAREA',
            面板里内容完整: !!ta && ta.value.indexOf('腹中胎儿系女主亲生') >= 0
        };
    });
    ok('⚠️档案里的换行一个都没被吃掉', P.换行没被吃掉, '');
    ok('档案超过 200 字也存得下', P.档案长度 > 100, '实际 ' + P.档案长度 + ' 字');
    eq('⚠️两组都是 1000 字（原来「关于我」是 200，静默截断害她丢过半份档案）', P.我的长度, 1000);
    eq('「这本书」那组也是 1000 字', P.书的长度, 1000);
    ok('⚠️后续设定用「改」补进同一条（档案不该散成好几条）', P.补全后有胎儿, '');
    ok('⚠️补全后没有被截到 200（改的时候也按这条自己的上限算）', P.补全后长度 > 300, '实际 ' + P.补全后长度);
    ok('注入时档案是整块给的', P.注入里是整块, '');
    ok('⚠️注入时没给档案套「- 」列表符（会把结构压塌）', P.注入没被加列表符, '');
    ok('面板里用的是能装多行的框', P.面板里是多行框, '');
    ok('面板里看得到完整档案', P.面板里内容完整, '');

    const P2 = await page.evaluate(() => {
        const sp = umReviewSystemPrompt();
        return {
            讲了档案: sp.indexOf('可以写长、可以分行分条') >= 0,
            讲了别散开: sp.indexOf('别另起一条') >= 0,
            讲了她说记就记全: sp.indexOf('原样记全') >= 0
        };
    });
    ok('提示词讲了档案可以写长', P2.讲了档案, '');
    ok('提示词讲了后续设定要补进同一条', P2.讲了别散开, '');
    ok('⚠️提示词讲了「她说记就原样记全，别压缩」', P2.讲了她说记就记全, '');

    /* ===== Q 组：记错组能挪回来 + 截断要吭声（2026-08-23 晚补）=====
       起因：那份小白鼠档案落进了「关于我」那组，被 200 字**静默**截在"揣着死"上，
       她是看截图才发现的；而且当时**没有任何办法把它挪到书那边**，只能删了重粘——
       可存下的那份已经缺了一半，原文都找不回来。 */
    const Q = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        window.rbCurBook = () => ({ fileName: '故事的解剖.epub', fileSize: 111 });
        window.rbCurBookName = () => '故事的解剖';

        const id = umAdd('【专属小白鼠档案】\n男主：摄政王萧濯', '', 'me', 'me');
        const 一开始在我这组 = umLoadMine().some(x => x.id === id);

        umMove(id);
        const 挪完在书那组 = umLoadBook().some(x => x.id === id);
        const 挪完不在我这组 = !umLoadMine().some(x => x.id === id);
        const 挪完带改过标记 = umLoad().filter(x => x.id === id)[0]._chg === 'upd';
        const 内容没变 = umLoad().filter(x => x.id === id)[0].content.indexOf('摄政王萧濯') >= 0;

        umMove(id);   // 再点一次挪回来
        const 挪得回来 = umLoadMine().some(x => x.id === id);

        // 面板上那两个小按钮
        document.getElementById('umTestHost').innerHTML = umPaneHtml();
        umRenderPanel();
        const row = document.querySelector('#chatUserMemList textarea[data-um="' + id + '"]').parentNode;
        const 有挪按钮 = row.textContent.indexOf('→书') >= 0;
        const 有删按钮 = !!row.querySelector('span[title="忘掉这条"]');
        // ⚠️平时藏起来，点进那一行才浮出（她说「占位置、容易按错」）
        const 有操作容器 = !!row.querySelector('.um-act');
        const 平时是藏着的 = getComputedStyle(row.querySelector('.um-act')).display === 'none';
        row.querySelector('textarea').focus();
        const 点进去就出来 = getComputedStyle(row.querySelector('.um-act')).display !== 'none';
        // ⚠️按钮必须挡住焦点转移，否则按下去 focus-within 失效、按钮消失、click 触发不了
        const 挡了焦点转移 = typeof row.querySelector('span[title="忘掉这条"]').onmousedown === 'function';
        row.querySelector('textarea').blur();

        // 没开书时不给挪（挪无处可去），也别报错
        window.rbCurBook = () => null;
        window.rbCurBookName = () => '';
        const 挪失败 = umMove(id) === false;
        const 还在原地 = umLoadMine().some(x => x.id === id);
        return { 一开始在我这组, 挪完在书那组, 挪完不在我这组, 挪完带改过标记, 内容没变,
                 挪得回来, 有挪按钮, 有删按钮, 有操作容器, 平时是藏着的, 点进去就出来, 挡了焦点转移,
                 挪失败, 还在原地 };
    });
    ok('一开始记在「关于我」', Q.一开始在我这组, '');
    ok('⚠️点一下能挪进这本书', Q.挪完在书那组, '');
    ok('挪走之后就不在「关于我」了', Q.挪完不在我这组, '');
    ok('挪完打「改过」标记（黄点，好认）', Q.挪完带改过标记, '');
    ok('⚠️挪的时候内容一个字都没动', Q.内容没变, '');
    ok('再点一次能挪回来', Q.挪得回来, '');
    ok('面板每行有「→书」', Q.有挪按钮, '');
    ok('面板每行有「✕」', Q.有删按钮, '');
    ok('两个记号收在一个容器里', Q.有操作容器, '');
    ok('⚠️平时藏着（她说占位置、容易按错）', Q.平时是藏着的, '');
    ok('⚠️点进那一行才浮出来', Q.点进去就出来, '');
    ok('⚠️按钮挡住了焦点转移（不挡就会「点了没反应」）', Q.挡了焦点转移, '');
    ok('没开书时挪不动（挪无处可去），也不报错', Q.挪失败 && Q.还在原地, '');

    /* ===== R 组：长条目默认只露几行（2026-08-23 深夜）=====
       她原话「不要全部展示，可以显示少数行，然后点了才展开全部」
       ＋「毕竟这个是给 ai 看的，我只是偶尔查阅，不需要全部显示，也会降低查看效率」。
       起因：那份小白鼠档案七八行，一条就把整个面板占满，别的条目全被挤没了。 */
    const R = await page.evaluate(async () => {
        localStorage.removeItem('toolbox_user_memory');
        window.rbCurBook = () => null;
        window.rbCurBookName = () => '';
        const 长的 = Array.from({ length: 12 }, (_, i) => '第' + (i + 1) + '行内容').join('\n');
        const 短的 = '就一行';
        const 长id = umAdd(长的, '', 'me', 'me');
        const 短id = umAdd(短的, '', 'me', 'me');
        document.getElementById('umTestHost').innerHTML = umPaneHtml();
        umRenderPanel();
        await new Promise(r => setTimeout(r, 60));
        const 长框 = document.querySelector('#chatUserMemList textarea[data-um="' + 长id + '"]');
        const 短框 = document.querySelector('#chatUserMemList textarea[data-um="' + 短id + '"]');
        const 收起高 = parseFloat(长框.style.height);
        const 短框高 = parseFloat(短框.style.height);

        长框.focus();
        await new Promise(r => setTimeout(r, 60));
        const 展开高 = parseFloat(长框.style.height);
        长框.blur();
        umGrow(长框);
        await new Promise(r => setTimeout(r, 60));
        const 收回去 = parseFloat(长框.style.height);

        // 内容一个字都没丢，只是没露出来
        const 内容完整 = umLoad().filter(x => x.id === 长id)[0].content.split('\n').length === 12;
        return { 收起高, 短框高, 展开高, 收回去, 内容完整, 折几行: UM_FOLD_LINES };
    });
    eq('默认露 3 行', R.折几行, 3);
    ok('⚠️十二行的条目收起时只占三行左右', R.收起高 < R.展开高 / 2, '收起 ' + R.收起高 + ' / 展开 ' + R.展开高);
    ok('点进去展开全高', R.展开高 > R.收起高, '');
    ok('移开焦点又收回去', Math.abs(R.收回去 - R.收起高) < 2, '收回 ' + R.收回去);
    ok('本来就短的条目不受影响（不会被撑成三行）', R.短框高 < R.收起高, '短 ' + R.短框高 + ' / 长 ' + R.收起高);
    ok('⚠️收起只是不显示，内容一个字没丢', R.内容完整, '');

    /* ===== S 组：「整理一下」按钮的位置和出现时机（2026-08-23 深夜）=====
       她问「那个整理一下的功能要去掉还是优化以适应现状」。结论是保留但挪位置：
       原来杵在面板最顶上、看着像管所有条目，实际只管「关于我」这一组。 */
    const S = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_memory');
        window.rbCurBook = () => null;
        window.rbCurBookName = () => '';
        const host = document.getElementById('umTestHost');

        // 这组里蘑菇记的不到 3 条 → 按钮不该出现
        umAdd('她自己写的', '', 'me', 'me');
        umAdd('蘑菇记的一条', '', 'mushroom', 'me');
        host.innerHTML = umPaneHtml();
        umRenderPanel();
        const 少的时候不出现 = document.getElementById('chatUserMemList').textContent.indexOf('整理一下') < 0;
        const 顶上没有了 = umPaneHtml().indexOf('整理一下') < 0;

        // 够 3 条 → 出现，而且紧挨着「关于我」
        umAdd('蘑菇记的二条', '', 'mushroom', 'me');
        umAdd('蘑菇记的三条', '', 'mushroom', 'me');
        umRenderPanel();
        const box = document.getElementById('chatUserMemList');
        const 够了才出现 = box.textContent.indexOf('整理一下') >= 0;
        const 挨着关于我 = box.textContent.indexOf('关于我') < box.textContent.indexOf('整理一下');
        return { 少的时候不出现, 顶上没有了, 够了才出现, 挨着关于我 };
    });
    ok('⚠️不到 3 条时按钮不出现（别白占地方）', S.少的时候不出现, '');
    ok('⚠️面板顶上那个已经撤了（它只管一组，别摆得像管全部）', S.顶上没有了, '');
    ok('够 3 条就出现', S.够了才出现, '');
    ok('紧挨着「关于我」那行小标题', S.挨着关于我, '');

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + (r.detail || ''))); });
    console.log(bad === 0 ? ('\n全过（' + results.length + ' 项）') : ('\n❌ ' + bad + '/' + results.length + ' 项没过'));
    process.exit(bad === 0 ? 0 : 1);
})();
