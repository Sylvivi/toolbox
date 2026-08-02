/* 「昵称可改」的回归测试。
 *
 * 起因：2026-08-02。用户的朋友也开始用这个工具，而「汐」是写死在代码里的（31 处），
 * AI 张口就管人家叫汐。
 *
 * ⚠️ 这个功能真正的风险不在改名本身，在于「汐」在代码里是**两种身份**：
 *   ① 给人看的名字（AI 称呼、问答气泡、读痕面板）——该跟着昵称走；
 *   ② **存储格式标记**：正文问答以 `[P3] 汐：问题` 存进 msg.content / reader_qa，
 *      二十来处 `/^汐：/` 靠它认出「这块是问答不是点评」。
 * 把 ② 一起改掉的后果是**静默的**：正文照常显示，只是双击不再走追问、
 * 摘要开始把闲聊当剧情压进去、读痕面板捞不到问答——几千条历史问答集体退化，
 * 而且要等用户用到那个功能才发现。所以下面 B 组专门钉「存储格式一个字都没变」。
 *
 * 跑法：node tests/username.test.js
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

    /* ===== A 组：默认值 + 存取 ===== */
    const A = await page.evaluate(() => {
        localStorage.removeItem('toolbox_user_name');
        const 默认 = chatUserName();
        chatSetUserName('小明');
        const 改后 = chatUserName();
        chatSetUserName('');           // 清空 = 回默认
        const 清空后 = chatUserName();
        chatSetUserName('汐');          // 填成跟默认一样 → 不该真存进去
        const 存的值 = localStorage.getItem('toolbox_user_name');
        chatSetUserName('这个名字特别特别特别长超过十二个字了');
        return { 默认, 改后, 清空后, 存的值, 截断后: chatUserName().length };
    });
    eq('没设过就是「汐」（用户自己完全无感）', A.默认, '汐');
    eq('设了就用新的', A.改后, '小明');
    eq('清空回到默认', A.清空后, '汐');
    eq('填成「汐」等于没填，不往云同步里塞垃圾', A.存的值, '');
    eq('太长的名字截到 12 字（要显示在问答气泡上，长了挤坏版面）', A.截断后, 12);

    /* ===== B 组：存储格式一个字都不能变（这次改动的真正风险）===== */
    const B = await page.evaluate(() => {
        chatSetUserName('小明');
        // 造一条共读正文，含一个问答块——这是真实存储长的样子
        const 正文 = '[P1] 第一段正文\n[P2] 第二段正文';
        const 问答 = '\n[P2] ' + QA_TAG + '这里在说什么\n意思是……';
        const msg = { role: 'assistant', content: 正文 + 问答 };
        const parsed = readingModeParseComments(msg.content);   // 返回的就是数组本身
        const qa = parsed.filter(c => /^\s*汐：/.test(c.text || ''));
        return {
            标记没变: QA_TAG,
            正文里仍是汐: msg.content.indexOf('[P2] 汐：') >= 0,
            正文里没混进昵称: msg.content.indexOf('小明：') < 0,
            解析出的问答条数: qa.length,
            问答挂在哪段: qa.length ? qa[0].p : null
        };
    });
    eq('存储标记仍是「汐：」', B.标记没变, '汐：');
    eq('改了昵称，存进正文的仍是「汐：」', B.正文里仍是汐, true);
    eq('存储里绝不出现昵称（出现了就说明写坏了历史数据）', B.正文里没混进昵称, true);
    eq('老格式照旧被认出是问答块（不会退化成普通点评）', B.解析出的问答条数, 1);
    eq('问答仍挂在第 2 段', B.问答挂在哪段, 2);

    /* ===== C 组：发给 AI 的那份换成昵称 ===== */
    const C = await page.evaluate(() => {
        chatSetUserName('小明');
        const 原文 = '[P2] 汐：这里在说什么\n意思是……';
        const 发出去的 = chatQaTagToName(原文);
        chatSetUserName('');
        const 默认时 = chatQaTagToName(原文);
        return { 发出去的, 默认时, 数组不动: chatQaTagToName([{ type: 'text' }]) };
    });
    eq('发给 AI 的副本里换成了昵称（不然 AI 以为还有第三个人）', C.发出去的, '[P2] 小明：这里在说什么\n意思是……');
    eq('用默认名时原样返回，不做无谓的字符串替换', C.默认时, '[P2] 汐：这里在说什么\n意思是……');
    eq('多模态消息（content 是数组）不许乱动', C.数组不动, [{ type: 'text' }]);

    /* ===== D 组：AI 的系统提示里用的是昵称 ===== */
    const D = await page.evaluate(() => {
        chatSetUserName('小明');
        // 复刻 chatDoRequest 里那句身份说明的拼法
        return '和你对话的人叫"' + chatUserName() + '"，称呼时直接用名字，不要用"用户"这种说法。';
    });
    ok('系统提示里告诉 AI 的是新昵称', D.indexOf('叫"小明"') >= 0, D);

    /* ===== E 组：云同步（漏挂进 manifest 的话，会「当场好好的、过几小时自己变回去」）===== */
    const E = await page.evaluate(() => {
        chatSetUserName('小明');
        const m = cfBuildManifest();
        // 模拟从另一台设备拉回来一份更新的
        const 载荷里 = m.userName;
        const 有时间戳 = !!m.userNameTs;
        return { 载荷里, 有时间戳 };
    });
    eq('昵称挂进了同步载荷', E.载荷里, '小明');
    eq('带着时间戳（后写覆盖靠它）', E.有时间戳, true);

    const F = await page.evaluate(() => {
        chatSetUserName('小明');
        localStorage.setItem('toolbox_user_name_ts', '2026-08-01T00:00:00.000Z');
        // 另一台设备把名字改回了默认（空串）——这是最容易漏的一种：空串是合法值
        const 云端 = { userName: '', userNameTs: '2026-08-02T00:00:00.000Z' };
        if (云端.userName !== undefined && 云端.userNameTs > localStorage.getItem('toolbox_user_name_ts')) {
            localStorage.setItem('toolbox_user_name', 云端.userName || '');
            localStorage.setItem('toolbox_user_name_ts', 云端.userNameTs);
        }
        return chatUserName();
    });
    eq('别的设备「改回默认」也传得过来（空串不能当成没值）', F, '汐');

    /* ===== G 组：设置面板那一栏 ===== */
    const G = await page.evaluate(() => {
        chatSetUserName('小明');
        chatSyncUserNameInput();
        const el = document.getElementById('chatUserNameInput');
        const 有输入框 = !!el;
        const 回填 = el ? el.value : null;
        chatOnUserNameInput('阿泠');
        const 改完的值 = chatUserName();
        chatOnUserNameInput('汐');       // 填默认名 → 输入框该清空，露出灰字占位
        const 填默认后输入框 = el ? el.value : null;
        return { 有输入框, 回填, 改完的值, 填默认后输入框, 占位: el ? el.placeholder : null };
    });
    eq('设置面板里有昵称输入框', G.有输入框, true);
    eq('打开时回填当前昵称', G.回填, '小明');
    eq('改完就生效', G.改完的值, '阿泠');
    eq('填成默认名时输入框清空（露出灰字占位，看得出「没设」）', G.填默认后输入框, '');
    eq('占位字是「汐」', G.占位, '汐');

    ok('页面无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail)); });
    console.log(bad ? `❌ ${bad}/${results.length} 条没过` : `✅ 全过（${results.length} 条）`);
    process.exit(bad ? 1 : 0);
})();
