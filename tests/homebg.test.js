/* 主页背景（2026-09-16 她要的）：从图片箱那批阅读底图里挑，或者贴一个网图链接。
 *
 * 守四件事：
 *  ① 选一张 → body 挂上 .homebg，背景是「淡遮罩 + 那张图」两层；
 *  ② 选「不用」→ class 和变量都清干净，不留残渣；
 *  ③ 贴链接**要先真的加载一遍再存**——网图大多是死链/防盗链，
 *     imgur 那种图删了还回 200 + 一张 161×81 的占位图，不验她只会看到一片空白；
 *  ④ 图片箱里一张底图都没有时，「贴链接」那个入口仍然在（不然新用户没有任何出路）。
 *
 * 跑法：node tests/homebg.test.js  或  bash tests/p.sh homebg
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
        localStorage.setItem('reading_bg_custom', JSON.stringify([
            { id: 'a', name: '蓝', url: 'https://box.masterofmydomain.top/bg/a.webp' },
            { id: 'b', name: '船夜', url: 'https://box.masterofmydomain.top/bg/b.webp' }
        ]));
        showThemePicker();
        const box = document.getElementById('homeBgList');
        out.格子 = [].map.call(box.querySelectorAll('button'), b => b.textContent.trim());

        homeBgSet('https://example.com/a.jpg');
        const cs = getComputedStyle(document.body);
        out.开 = {
            cls: document.body.classList.contains('homebg'),
            bg: cs.backgroundImage,
        };
        homeBgSet('');
        out.关 = {
            cls: document.body.classList.contains('homebg'),
            varLeft: document.body.style.getPropertyValue('--home-bg-url')
        };

        // ③ 贴链接：拦住 prompt / alert，换掉 Image 来模拟三种结果
        const RealImage = window.Image;
        function fakeImage(w, h, fail) {
            window.Image = function () {
                const o = {};
                Object.defineProperty(o, 'src', { set() {
                    setTimeout(() => {
                        o.naturalWidth = w; o.naturalHeight = h;
                        (fail ? o.onerror : o.onload)();
                    }, 5);
                } });
                return o;
            };
        }
        let alerted = '';
        window.alert = m => { alerted = m; };
        async function tryPaste(url, w, h, fail) {
            window.prompt = () => url;
            alerted = '';
            localStorage.setItem('toolbox_home_bg', '');
            homeBgApply();
            fakeImage(w, h, fail);
            homeBgPrompt();
            await new Promise(r => setTimeout(r, 60));
            return { 存了: localStorage.getItem('toolbox_home_bg') || '', 说了: alerted };
        }
        out.正常图 = await tryPaste('https://x.com/big.png', 1200, 1600, false);
        out.占位图 = await tryPaste('https://i.imgur.com/x.png', 161, 81, false);
        out.打不开 = await tryPaste('https://x.com/dead.png', 0, 0, true);
        out.非http = await (async () => { window.prompt = () => 'ftp://a/b.png'; alerted = '';
            localStorage.setItem('toolbox_home_bg', ''); homeBgPrompt();
            await new Promise(r => setTimeout(r, 30));
            return { 存了: localStorage.getItem('toolbox_home_bg') || '', 说了: alerted }; })();
        window.Image = RealImage;

        // ④ 一张底图都没有时
        localStorage.setItem('reading_bg_custom', '[]');
        renderHomeBgList();
        out.空名单 = [].map.call(box.querySelectorAll('button'), b => b.textContent.trim());
        return out;
    });

    ok('列出「不用」+ 两张底图 + 贴链接',
        R.格子.length === 4 && R.格子[0] === '不用' && R.格子[1] === '蓝' &&
        R.格子[3].indexOf('贴一个图片链接') >= 0, JSON.stringify(R.格子));
    ok('选一张 → 淡遮罩 + 图两层',
        R.开.cls && /linear-gradient/.test(R.开.bg) && /example\.com\/a\.jpg/.test(R.开.bg),
        JSON.stringify(R.开));
    ok('选「不用」→ class 和变量都清干净',
        R.关.cls === false && !R.关.varLeft, JSON.stringify(R.关));
    ok('贴正常图 → 存下来', R.正常图.存了 === 'https://x.com/big.png' && !R.正常图.说了, JSON.stringify(R.正常图));
    ok('贴到占位小图 → 拦住、不存', !R.占位图.存了 && /161×81/.test(R.占位图.说了), JSON.stringify(R.占位图));
    ok('图打不开 → 拦住、不存', !R.打不开.存了 && /打不开/.test(R.打不开.说了), JSON.stringify(R.打不开));
    ok('不是 http 开头 → 拦住、不存', !R.非http.存了 && /http/.test(R.非http.说了), JSON.stringify(R.非http));
    ok('一张底图都没有时，贴链接入口仍在',
        R.空名单.some(t => t.indexOf('贴一个图片链接') >= 0), JSON.stringify(R.空名单));
    ok('没有页面报错', errs.length === 0, errs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) { if (!r.pass) bad++; console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail && !r.pass ? '  → ' + r.detail : '')); }
    console.log(bad ? `\n${bad} 项没过` : '\n全过');
    process.exit(bad ? 1 : 0);
})();
