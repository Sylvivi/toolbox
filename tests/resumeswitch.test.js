/* 小克切书落到章首（10-24 汐修）。
 *
 * 她：「悬浮小克好像不太能记阅读进度，每次点进去都不是在我之前退出来的那个位置」——落在那一章开头。
 * 临时诊断从她手机上抓到的：从 A 书（滚到很下面）切到 B 书时，chatLoadConv 清空重画 → scrollTop 归 0 →
 * 手机上紧接着来一次 scroll 事件，`_goingUp` 拿的还是 A 书的 _readerLastTop（几千 px）→ 判成「往上滑到顶」→
 * readerPrependPrevChapter 在前面补了一章，消息下标整体后移两格 → 本机锚点按 data-idx 找段，找错/找不到 →
 * 落到章首，再被 150ms 后的保存当成新进度存下来。
 * 桌面 chromium 里那次 scroll 事件不一定来，所以这里**手动补发一次**来模拟手机。
 * 守：① 切书后不补上一章；② 回到原来那一段；③ 就算前面被补了章，锚点按章找也能回去。
 * 数据全是编的。跑法：bash tests/p.sh resumeswitch
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
    await page.waitForTimeout(5000);
    const top = () => page.evaluate(() => {
        const el = document.getElementById('chatMessages'); const ctop = el.getBoundingClientRect().top;
        for (const p of el.querySelectorAll('.reading-merged p[data-p]')) if (p.getBoundingClientRect().bottom > ctop + 4) return p.textContent.slice(0, 7);
        return null;
    });
    await page.evaluate(() => {
        const mk = (n, name) => { const chs = []; for (let c = 0; c < n; c++) { const body = []; for (let i = 0; i < 50; i++) body.push(name + (c + 1) + '章' + (i + 1) + '段。编的正文撑长度，看位置能不能回来。'); chs.push({ title: '第' + (c + 1) + '章', body: body.join('\n') }); } return chs; };
        rbBooks = [{ id: 'bA', fileName: '甲书.txt', fileSize: 10, chapters: mk(6, '甲') }, { id: 'bB', fileName: '乙书.txt', fileSize: 20, chapters: mk(6, '乙') }];
        rbSave(); openChatModal();
        // 模拟手机：整屏重画后紧跟一次 scroll 事件（scrollTop 已被清成 0）
        const orig = chatRenderAllMessages;
        window.chatRenderAllMessages = function (w) { orig(w); document.getElementById('chatMessages').scrollTop = 0; setTimeout(function () { document.getElementById('chatMessages').dispatchEvent(new Event('scroll')); }, 0); };
    });
    const scrollTo = async (pn) => { for (let k = 0; k < 300; k++) { const p = await page.evaluate(() => { const el = document.getElementById('chatMessages'); el.scrollTop += 150; const ctop = el.getBoundingClientRect().top; for (const p of el.querySelectorAll('.reading-merged p[data-p]')) if (p.getBoundingClientRect().bottom > ctop + 4) return +p.getAttribute('data-p'); }); await page.waitForTimeout(30); if (p >= pn) break; } await page.waitForTimeout(500); };
    await page.evaluate(() => readerOpenChapter('bB', 2)); await page.waitForTimeout(500); await scrollTo(40);
    const wantB = await top();
    await page.evaluate(() => readerOpenChapter('bA', 3)); await page.waitForTimeout(500); await scrollTo(45);
    const wantA = await top();
    await page.evaluate(() => readerResumeLast('bB')); await page.waitForTimeout(1500);
    const gotB = await top();
    const chsB = await page.evaluate(() => chatMessages.filter(m => m.readerChapter != null).map(m => m.readerChapter).join(','));
    ok('① 切到乙书不在前面补章', chsB.split(',')[0] === '2', '载入的章 ' + chsB);
    ok('② 回到乙书原来那一段', gotB === wantB, '期望 ' + wantB + ' / 实际 ' + gotB);
    await page.evaluate(() => readerResumeLast('bA')); await page.waitForTimeout(1500);
    const gotA = await top();
    ok('② 再切回甲书也回到原段', gotA === wantA, '期望 ' + wantA + ' / 实际 ' + gotA);
    // ③ 前面硬补一章（下标后移两格），锚点仍能按章找回
    const r3 = await page.evaluate(async () => {
        readerPrependPrevChapter(); await new Promise(r => setTimeout(r, 300));
        chatSaveCurrentConv(true);
        const el = document.getElementById('chatMessages'); el.scrollTop = 0;
        return 1;
    });
    // 此时锚点可能已被重存，手动写回一份「旧下标」的锚点模拟：
    await page.evaluate(() => { const k = 'reading_pos_reader_bA'; const a = JSON.parse(localStorage.getItem(k)); a.idx = String((a.idx | 0) - 2); localStorage.setItem(k, JSON.stringify(a)); });
    // 注：上面写回的锚点带着 ch，按章找就不受下标影响
    await page.evaluate(() => readerResumeLast('bB')); await page.waitForTimeout(800);
    await page.evaluate(() => readerResumeLast('bA')); await page.waitForTimeout(1500);
    const gotA3 = await top();
    ok('③ 下标错开两格仍按章回到原段', gotA3 && gotA3.startsWith(wantA.slice(0, 4)), '期望 ' + wantA + ' / 实际 ' + gotA3);
    ok('没有报错', errs.length === 0, errs.join(' | '));
    await browser.close();
    let fail = 0;
    for (const r of results) { console.log((r.pass ? '✅ ' : '❌ ') + r.name + (r.pass ? '' : '  ' + r.detail)); if (!r.pass) fail++; }
    console.log(fail ? '❌ ' + fail + ' 条没过' : '✅ 全过');
    process.exit(fail ? 1 : 0);
})();
