/* 阅读进度（reader_pos）跨设备同步的回归测试。
 *
 * 起因：用户 2026-08-09「两边页面都开着的时候，在一边产生了读痕，如果要同步到另一边，
 * 总感觉好像需要触发点什么，有时候碰巧能触发，有时候就怎么也触发不了，刷新也不太能解决」。
 *
 * 病根：`readerSetProgress` 只写 localStorage、**从不调 syncPushData**。`reader_pos` 挂在
 * manifest 里，但只能等别的数据推送时被顺路捎上云——「碰巧能触发」＝她刚好划了线/加了书签，
 * 「怎么也触发不了」＝纯看书没碰别的。拉取那边一直是好的（autoSync 30 秒一轮），
 * 所以刷新也没用：云端根本没有新数据。
 *
 * ⚠️这组钉三件事：
 *   ① 存进度会推云端（别再退回「只写本地」）
 *   ② 防抖要长（看书时滚动停 150ms 就存一次，短防抖会把同步接口打爆）
 *   ③ **切走页面时必须立刻补推**——换设备的那一刻就是这个时机，没有它防抖的债永远还不上
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
    await page.goto(APP);
    await page.waitForTimeout(600);

    // ── A 组：存进度会排一次推送，但不是立刻推 ──────────────────────
    const a = await page.evaluate(() => {
        // 把 syncPushData 换成计数器，并假装云同步已配好（走 cf）
        window._pushCount = 0;
        window.syncPushData = function () { window._pushCount++; };
        window.activeSyncProvider = 'cf';
        localStorage.removeItem('reader_pos');
        readerSetProgress('bk_x', { chapter: 3, p: '12', off: 40 });
        const stored = JSON.parse(localStorage.getItem('reader_pos') || '{}');
        return { pushNow: window._pushCount, keys: Object.keys(stored).length, entry: stored[Object.keys(stored)[0]] };
    });
    eq('A1 进度确实写进了 reader_pos', a.keys, 1);
    ok('A2 存的是章/段/偏移 + 时间戳', a.entry && a.entry.ch === 3 && a.entry.p === '12' && a.entry.ts > 0, JSON.stringify(a.entry));
    eq('A3 存完不立刻推（防抖中）', a.pushNow, 0);

    // ── B 组：防抖——连存多次只推一次，且真的会推出去 ───────────────
    const b1 = await page.evaluate(() => {
        window._pushCount = 0;
        for (let i = 0; i < 12; i++) readerSetProgress('bk_x', { chapter: 3, p: String(i), off: i * 10 });
        return window._pushCount;
    });
    eq('B1 连存 12 次，期间一次都不推', b1, 0);

    // 真等过防抖窗口（8 秒）——这条就是在钉「它到底会不会自己推出去」
    await page.waitForTimeout(8800);
    const b2 = await page.evaluate(() => window._pushCount);
    eq('B2 手停下来之后自动推了，且只推一次', b2, 1);

    // ── C 组：切走页面立刻补推（换设备的关键时机）────────────────────
    const c = await page.evaluate(() => {
        window._pushCount = 0;
        readerSetProgress('bk_x', { chapter: 9, p: '3', off: 0 });
        const before = window._pushCount;
        // 模拟「切到别的标签页 / 手机息屏」
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        const after = window._pushCount;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        return { before, after };
    });
    eq('C1 切走之前还在防抖里（没推）', c.before, 0);
    eq('C2 页面一切走立刻补推', c.after, 1);

    // C3：切走时如果没有欠着的进度，不要白推一次（免得每次切标签页都打一发）
    const c3 = await page.evaluate(() => {
        window._pushCount = 0;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        return window._pushCount;
    });
    eq('C3 没有欠着的进度时，切走不白推', c3, 0);

    // ── D 组：没开云同步就别推 ──────────────────────────────────────
    const d = await page.evaluate(() => {
        window._pushCount = 0;
        window.activeSyncProvider = 'gist';
        readerSetProgress('bk_x', { chapter: 5, p: '1', off: 0 });
        const queued = window._pushCount;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        const flushed = window._pushCount;
        window.activeSyncProvider = 'cf';
        return { queued, flushed };
    });
    eq('D1 没走 CF 时不排推送', d.queued, 0);
    eq('D2 没走 CF 时切走也不推', d.flushed, 0);

    // ── E 组：进度确实进了云端清单，且逐本按时间戳合并 ────────────────
    const e = await page.evaluate(() => {
        localStorage.setItem('reader_pos', JSON.stringify({
            '甲.txt|100': { ch: 2, p: '5', off: 0, ts: 1000 },
            '乙.txt|200': { ch: 7, p: '1', off: 0, ts: 5000 }
        }));
        const m = cfBuildManifest();
        // 模拟云端：甲更新（ts 更大）、乙更旧（ts 更小）
        const cloud = {
            '甲.txt|100': { ch: 8, p: '2', off: 0, ts: 9999 },
            '乙.txt|200': { ch: 1, p: '1', off: 0, ts: 10 }
        };
        const local = JSON.parse(localStorage.getItem('reader_pos'));
        Object.keys(cloud).forEach(function (k) {
            const c = cloud[k], l = local[k];
            if (c && (!l || (c.ts || 0) > (l.ts || 0))) local[k] = c;
        });
        return { inManifest: !!m.readerPos && Object.keys(m.readerPos).length, 甲: local['甲.txt|100'].ch, 乙: local['乙.txt|200'].ch };
    });
    eq('E1 reader_pos 挂在云端清单里', e.inManifest, 2);
    eq('E2 云端更新的那本被采纳', e.甲, 8);
    eq('E3 本地更新的那本不被旧数据盖回去', e.乙, 7);

    await browser.close();

    let fail = 0;
    for (const r of results) {
        if (!r.pass) fail++;
        console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  → ' + r.detail));
    }
    console.log(fail === 0 ? '  全部通过 (' + results.length + ')' : '  ' + fail + ' 条失败');
    process.exit(fail === 0 ? 0 : 1);
})();
