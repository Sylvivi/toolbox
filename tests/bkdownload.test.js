/* 「大书下载」的回归测试：进度 / 超时 / 失败原因。
 *
 * 起因：用户 2026-07-30 报「这种大文件，我的手机同步半天都同步不下来」。
 * 老 bkSyncDownload 就是 `fetch().then(r => r.json())`，三个毛病叠一起，
 * 最难受的不是慢，是**分不清在下、卡死了、还是早就失败了**：
 *   ① 没进度（r.json() 等整包下完才动）② 没超时（手机网络一卡永远挂着）
 *   ③ 失败原因全丢（.catch 里 cb(false) 一个字不留，界面只写「请检查配置或网络」，
 *      而配置好着，白让她去翻设置）
 *
 * 全程假 fetch，不联网、不发真请求、不花额度。
 * 跑法：bash tests/run.sh
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

    const R = await page.evaluate(async () => {
        localStorage.setItem('books_sync_url', 'https://例子/books');
        localStorage.setItem('books_sync_token', 'tok');
        rbBooks = [];
        const BOOK = { fileName: 'X.txt', fileSize: 100, chapters: [{ title: '第一章', body: '正文' }] };
        const enc = new TextEncoder();

        // 造一个假 Response：chunks=按块吐；hang=吐完就挂住（模拟网络卡死）
        function fakeFetch(cfgResp) {
            return function (url, opt) {
                if (cfgResp.ok === false) return Promise.resolve({ ok: false, status: cfgResp.status, headers: { get: () => null } });
                const hdrs = cfgResp.headers || {};
                const get = k => { const kk = k.toLowerCase(); for (const h in hdrs) if (h.toLowerCase() === kk) return hdrs[h]; return null; };
                let i = 0;
                return Promise.resolve({
                    ok: true, status: 200, headers: { get },
                    text: () => Promise.resolve(cfgResp.whole || ''),
                    body: cfgResp.noStream ? null : {
                        getReader: () => ({
                            read: () => new Promise((res, rej) => {
                                if (i < cfgResp.chunks.length) { res({ done: false, value: enc.encode(cfgResp.chunks[i++]) }); return; }
                                if (!cfgResp.hang) { res({ done: true }); return; }
                                // 挂住：只有 abort 才结束（真实世界里就是手机网络卡了）
                                opt.signal.addEventListener('abort', () => rej({ name: 'AbortError' }));
                            })
                        })
                    }
                });
            };
        }
        const payload = JSON.stringify({ ok: true, ts: 111, book: BOOK });
        // ⚠️用「字节数」不是 payload.length：中文一个字符 = 3 个 UTF-8 字节，
        // 而服务端 X-Raw-Length 和流里读到的都是字节。第一版拿字符数当总量，测试自己就错了。
        const payloadBytes = enc.encode(payload).length;
        const realFetch = window.fetch;
        const out = {};
        const run = (respCfg, act) => new Promise(resolve => {
            window.fetch = fakeFetch(respCfg);
            const prog = [];
            const ctl = bkSyncDownload({ _fileKey: 'X.txt|100' },
                (full, err) => resolve({ full: full ? { n: full.chapters.length, ts: full._ts } : false, err, prog }),
                (got, total) => prog.push([got, total]));
            if (act) act(ctl);
        });

        // A 正常流式下载：进度递增、总量取 X-Raw-Length、书拿到手
        let r = await run({ headers: { 'X-Raw-Length': String(payloadBytes), 'Content-Length': '999' },
                            chunks: [payload.slice(0, 20), payload.slice(20)] });
        out.A_book = r.full && r.full.n;
        out.A_ts = r.full && r.full.ts;
        out.A_total = r.prog.length ? r.prog[r.prog.length - 1][1] : -1;
        out.A_lastGot = r.prog.length ? r.prog[r.prog.length - 1][0] : -1;
        out.A_rawLen = payloadBytes;
        out.A_increasing = r.prog.every((p, i) => i === 0 || p[0] >= r.prog[i - 1][0]);

        // B 服务器报错：原因要带状态码
        r = await run({ ok: false, status: 500 });
        out.B_err = r.err;

        // C 用户主动停：说「已停止」，不能说成网络问题
        r = await run({ headers: {}, chunks: ['{'], hang: true }, ctl => setTimeout(() => ctl.abort(), 60));
        out.C_err = r.err;

        // D 卡死：60 秒没新字节 → 自己掐断，且原因要说「没响应」而不是「已停止」
        const save = BK_DL_STALL_MS;
        BK_DL_STALL_MS = 150;
        r = await run({ headers: {}, chunks: ['{'], hang: true });
        out.D_err = r.err;
        BK_DL_STALL_MS = save;

        // E 没有流式 API 的环境：退回一次性读，照样能拿到书（只是没进度）
        r = await run({ noStream: true, whole: payload, headers: {} });
        out.E_book = r.full && r.full.n;

        // F 总量未知时不能显示成 /0，也不能崩
        r = await run({ headers: {}, chunks: [payload] });
        out.F_total = r.prog.length ? r.prog[r.prog.length - 1][1] : -1;
        out.F_book = r.full && r.full.n;

        window.fetch = realFetch;
        return out;
    });

    ok('A 正常下载：拿到书', R.A_book === 1, '实际章数 ' + R.A_book);
    ok('A 记下服务器 ts（别下一轮重下）', R.A_ts === 111, '实际 ' + R.A_ts);
    ok('A 总量取 X-Raw-Length 不取 Content-Length', R.A_total === R.A_rawLen, '实际 ' + R.A_total + ' / 期望 ' + R.A_rawLen);
    ok('A 已下字节数递增到全长', R.A_lastGot === R.A_rawLen && R.A_increasing, '实际 ' + R.A_lastGot);
    ok('B 服务器错：原因带状态码', /500/.test(R.B_err || ''), '实际 "' + R.B_err + '"');
    ok('C 主动停：说「已停止」', R.C_err === '已停止', '实际 "' + R.C_err + '"');
    ok('D 卡死：自己掐断且说「没响应」', /没响应/.test(R.D_err || ''), '实际 "' + R.D_err + '"');
    ok('E 无流式 API：退回一次性读也能成', R.E_book === 1, '实际 ' + R.E_book);
    ok('F 总量未知：total=0、书照样下来', R.F_total === 0 && R.F_book === 1, 'total=' + R.F_total + ' book=' + R.F_book);
    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '  ← ' + (r.detail || ''))); });
    console.log(bad ? `\n❌ ${bad}/${results.length} 条失败` : `\n✅ ${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
