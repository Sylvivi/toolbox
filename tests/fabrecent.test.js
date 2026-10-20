/* 悬浮小克 10-20 改版（晗）：2×2 → 「存小红书 / 最近的对话」两个图标 ＋ 最近读的另外两本书。
 *
 * 她：四格里「只有小红书用得多」；「你说就放一个我不喜欢」；看了方案「我感觉你说的不错」。
 *
 * 守这几件事：
 *  ① 图标只剩两个，存小红书挨着球（贴右边在右）；
 *  ② 书名条按最近读排、**去掉长按会回的那本**、最多两本、服务器占位书不列；
 *  ③ 点书名条＝回到那一本（readerResumeLast 收到那本的 id）；
 *  ④ 「最近的对话」跳过阅读会话（reader_），进最新的那个普通对话；
 *  ⑤ 球拖到最底下时，变高的菜单仍整块在屏幕里；
 *  ⑥ 书名条在时剪贴板那条照样出得来（书名条借了 fab-clip 的样式，判重别误伤）。
 * 数据全是编的。
 *
 * 跑法：bash tests/p.sh fabrecent
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    const R = await page.evaluate(async () => {
        const out = {};
        const fab = document.getElementById('fabWrap');
        const menu = document.getElementById('fabMenu');
        const ch = [{ title: '第一章', body: '编的正文' }];
        rbBooks = [
            { id: 'bA', fileName: '甲书.txt', fileSize: 10, chapters: ch },
            { id: 'bB', fileName: '乙书.txt', fileSize: 20, chapters: ch },
            { id: 'bC', fileName: '丙书（很长很长的一个书名用来看会不会撑破）.txt', fileSize: 30, chapters: ch },
            { id: 'bD', fileName: '丁书.txt', fileSize: 40, chapters: ch },
            { id: 'bE', fileName: '戊书.txt', fileSize: 50, chapters: [], _remote: true, _fileKey: '戊书.txt|50' }
        ];
        const now = Date.now();
        localStorage.setItem('reader_pos', JSON.stringify({
            '甲书.txt|10': { ch: 0, ts: now }, '乙书.txt|20': { ch: 0, ts: now - 1000 },
            '丙书（很长很长的一个书名用来看会不会撑破）.txt|30': { ch: 0, ts: now - 2000 },
            '丁书.txt|40': { ch: 0, ts: now - 3000 }, '戊书.txt|50': { ch: 0, ts: now + 5000 }
        }));
        localStorage.setItem('reader_last_book', 'bA');

        const calls = [];
        window.openChatModal = function () {};
        window.readerResumeLast = function (id) { calls.push(['book', id]); };
        window.chatLoadConv = function (id) { calls.push(['conv', id]); };
        window.chatGetHistory = function () {
            return [{ id: 'reader_bA', updated: now + 9 }, { id: 'c_old', updated: now - 50 }, { id: 'c_new', updated: now - 5 }];
        };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => Promise.resolve('https://xhslink.cn/o/2EuAPkcjjV0') } });

        const ball = document.getElementById('fabBall');
        function tap() {
            ball.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 370, clientY: 400, pointerId: 1 }));
            ball.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 370, clientY: 400, pointerId: 1 }));
        }
        tap();
        await new Promise(r => setTimeout(r, 120));
        out.acts = [...menu.querySelectorAll('.fab-act')].map(b => b.title);
        out.books = [...menu.querySelectorAll('.fab-book')].map(b => b.textContent.trim());
        out.clip = !!menu.querySelector('.fab-clip:not(.fab-book)');
        out.side = fab.getAttribute('data-side');
        const mr = menu.getBoundingClientRect();
        out.inView = mr.top >= 0 && mr.bottom <= innerHeight && mr.left >= 0 && mr.right <= innerWidth;
        out.widest = Math.max(...[...menu.querySelectorAll('.fab-book')].map(b => b.getBoundingClientRect().width));

        menu.querySelectorAll('.fab-book')[1].click();
        await new Promise(r => setTimeout(r, 30));
        tap(); await new Promise(r => setTimeout(r, 60));
        [...menu.querySelectorAll('.fab-act')].find(b => b.title === '最近的对话').click();
        out.calls = calls.slice();

        // ⑤ 拖到最底下再展开
        localStorage.setItem('toolbox_fab_pos', JSON.stringify({ side: 'r', y: 0.97 }));
        return out;
    });
    // 位置是 IIFE 启动时读的，重载一次让它按最底下的位置摆
    await page.reload(); await page.waitForTimeout(6000);
    const R2 = await page.evaluate(async () => {
        const menu = document.getElementById('fabMenu');
        rbBooks = [1, 2, 3].map(i => ({ id: 'x' + i, fileName: '编的书' + i + '.txt', fileSize: i, chapters: [{ title: 't', body: 'b' }] }));
        const pos = {}; rbBooks.forEach((b, i) => { pos[b.fileName + '|' + b.fileSize] = { ch: 0, ts: Date.now() - i }; });
        localStorage.setItem('reader_pos', JSON.stringify(pos));
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => Promise.resolve('一段编的文字') } });
        const ball = document.getElementById('fabBall');
        const y = ball.getBoundingClientRect().top + 10;
        ball.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 370, clientY: y, pointerId: 1 }));
        ball.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 370, clientY: y, pointerId: 1 }));
        await new Promise(r => setTimeout(r, 150));
        const mr = menu.getBoundingClientRect();
        return { n: menu.children.length, top: Math.round(mr.top), bottom: Math.round(mr.bottom), h: innerHeight };
    });

    ok('图标只剩两个、存小红书挨着球（贴右边在右）', JSON.stringify(R.acts) === JSON.stringify(['最近的对话', '存小红书']), JSON.stringify(R.acts));
    ok('书名条：去掉长按那本、去掉占位书、按最近排、最多两本', JSON.stringify(R.books) === JSON.stringify(['乙书', '丙书（很长很长的一个书名用来看会不会撑破）']), JSON.stringify(R.books));
    ok('长书名不撑破（≤176px）', R.widest <= 176.5, R.widest);
    ok('书名条在时剪贴板那条照样出现', R.clip, '');
    ok('点第二本 → 回到丙书', R.calls[0] && R.calls[0][0] === 'book' && R.calls[0][1] === 'bC', JSON.stringify(R.calls));
    ok('最近的对话 → 跳过阅读会话、进最新的普通对话', R.calls[1] && R.calls[1][0] === 'conv' && R.calls[1][1] === 'c_new', JSON.stringify(R.calls));
    ok('菜单在屏幕里', R.inView, '');
    ok('球在最底下时，剪贴板条＋图标＋两本书整块仍在屏幕里', R2.n === 4 && R2.top >= 0 && R2.bottom <= R2.h, JSON.stringify(R2));
    ok('没有页面报错', errs.length === 0, errs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail && !r.pass ? '  → ' + r.detail : '')); }
    console.log(bad ? `\n${bad} 项没过` : '\n全过');
    process.exit(bad ? 1 : 0);
})();
