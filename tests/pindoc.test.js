/* 常驻资料（2026-09-13 她要的：「有些文件我希望它能够持续存在，钉在对话上下文里面，
 * 而不是随着轮数的增加就不再出现了或者被压缩住了」）。
 *
 * 规则：
 *  · 钉住的东西**不走历史**，每轮单独拼一条 system 发出去 → 不占「最近 N 轮」、不被压缩吃掉。
 *  · 来源两种：收藏里的条目（存**引用**，库里改了自动跟着变）／对话里传的附件（存快照）。
 *  · 入口在小螃蟹菜单，**没钉东西时不露面**；⚠️阅读模式一律不露（她：那边没有输入框）。
 *  · 附件点「常驻」是**挪走**不是复制，否则这一轮会发两遍。
 *
 * 跑法：node tests/pindoc.test.js   或   bash tests/p.sh pindoc
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
        chatPinnedDocs = [];
        chatReaderMode = false;

        // 造一条收藏：一张 collection（两条子条目）
        const snip = { id: 'T1', title: '宋飞剧集表', type: 'collection', items: [
            { id: 's1', title: '第一季', content: 'The Seinfeld Chronicles' },
            { id: 's2', title: '第二季', content: 'The Ex-Girlfriend' }
        ] };
        window.getSnipData = () => [snip];

        // ① 取正文：整张 / 某一条
        out.resolveAll = chatSnipResolve('T1', '').body;
        out.resolveOne = chatSnipResolve('T1', 's2').body;

        // ② 钉一条子条目
        chatTogglePinSnip('T1', 's2');
        out.pinned1 = chatPinnedDocs.length;
        out.isPinned = chatIsPinned('T1', 's2');
        out.notPinnedOther = chatIsPinned('T1', 's1');

        // ③ 引用是活的：改了收藏，带出去的跟着变
        snip.items[1].content = '改过了';
        out.live = chatPinnedResolved()[0].body;

        // ④ 菜单入口：钉了才露、写着份数
        clawdToggleMenu(); clawdCloseMenu();
        const btn = document.getElementById('clawdPinBtn');
        out.btnShown = btn.style.display !== 'none';
        out.btnText = btn.textContent.trim();

        // ⑤ 阅读模式不露
        chatReaderMode = true; chatRenderPinBar();
        out.btnHiddenInReader = btn.style.display === 'none';
        chatReaderMode = false; chatRenderPinBar();

        // ⑥ 再点一下＝取下
        chatTogglePinSnip('T1', 's2');
        out.afterUnpin = chatPinnedDocs.length;
        chatRenderPinBar();
        out.btnGoneWhenEmpty = btn.style.display === 'none';

        // ⑦ 附件「常驻」是挪走不是复制
        chatPendingFiles = [{ name: '临时.md', content: 'hello', size: 5 }];
        chatPinPendingFile(0);
        out.pendingLeft = chatPendingFiles.length;
        out.pinnedFromFile = chatPinnedDocs.length;
        out.fileBody = chatPinnedResolved()[0].body;

        // ⑧ 存 / 读：跟着这个对话走
        chatCurrentConvId = 'chat_pin_test';
        chatMessages = [{ role: 'user', content: '喂', ts: Date.now() }];
        chatSaveCurrentConv();
        const saved = chatGetHistory().filter(c => c.id === 'chat_pin_test')[0];
        out.savedCount = saved && saved.pinnedDocs ? saved.pinnedDocs.length : -1;
        chatPinnedDocs = [];
        chatLoadConv('chat_pin_test');
        out.loadedCount = chatPinnedDocs.length;

        return out;
    });

    ok('整张 collection 带小标题拼起来', /【第一季】/.test(R.resolveAll) && /【第二季】/.test(R.resolveAll), R.resolveAll);
    ok('点某一条只取那一条', R.resolveOne === 'The Ex-Girlfriend', R.resolveOne);
    ok('钉上了', R.pinned1 === 1 && R.isPinned === true && R.notPinnedOther === false, JSON.stringify([R.pinned1, R.isPinned, R.notPinnedOther]));
    ok('引用是活的（收藏改了跟着变）', R.live === '改过了', R.live);
    ok('菜单入口露面且写着份数', R.btnShown && /常驻\s*1/.test(R.btnText), R.btnText);
    ok('阅读模式下不露面', R.btnHiddenInReader === true);
    ok('再点一下取下', R.afterUnpin === 0 && R.btnGoneWhenEmpty === true, JSON.stringify([R.afterUnpin, R.btnGoneWhenEmpty]));
    ok('附件常驻＝挪走不是复制', R.pendingLeft === 0 && R.pinnedFromFile === 1 && R.fileBody === 'hello', JSON.stringify([R.pendingLeft, R.pinnedFromFile, R.fileBody]));
    ok('跟着对话存下来、再打开还在', R.savedCount === 1 && R.loadedCount === 1, JSON.stringify([R.savedCount, R.loadedCount]));
    ok('没有页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail && !r.pass ? '  → ' + r.detail : '')); }
    console.log(bad ? `\n${bad} 项没过` : '\n全过');
    process.exit(bad ? 1 : 0);
})();
