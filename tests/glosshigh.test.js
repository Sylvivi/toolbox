/* 「小注不许骑到上一段正文上」的回归测试（2026-08-07 加）。
 *
 * 起因：用户截图报「那条小注位置咋那么高呀」——被注的词在段落倒数第二行，
 * 小注却跑到上一段的正文上、拉一条横穿整段的长斜线。追问时她说：
 * 「可以移到上面，但是上移的位置不应该那么夸张，明明在两段之间就可以」。
 *
 * 根因：_insetToward 的第 ③ 档「退而求其次：只压隔壁块的一行」会把标签**整个往上抬一整行**。
 * 那招是给**背景块**写的（它第一行往往只有十来个字、右边空一大片，抬上去横向一躲就干净），
 * 但它没区分邻居是什么，**邻居是正文段落时行是满宽的、无处可躲**，就成了骑在正文上。
 *
 * ⚠️只在缝装不下时才发作（段间距 < 约 28px）。段间距 28 走第 ① 档，看不出来——
 *   所以这组必须**逐个段间距**跑，只测 28 会假绿。
 *
 * 守三件事：
 *   ① 各档段间距下，小注都不许比「上一段底部」高出一行（22.4px）那么多。
 *   ② 缝够宽时（28px）必须老老实实待在缝里，行为跟以前一样。
 *   ③ ⚠️邻居是**背景块**时，「只压一行」那条退路要照旧生效——那是治「阳翟挡字」的，别误伤。
 *
 * 跑法：bash tests/p.sh glosshigh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

const LINE = 22.4;   // 正文行高：14px × 1.6

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);

    /* 照用户截图搭：长段落 + 被注的词在倒数第二行 + 段后紧跟背景块（下缝≈0，逼它往上走）。 */
    await page.addScriptTag({ content: `
        window.__build = function (spacing, withBg) {
            document.querySelectorAll('.__gh').forEach(function (n) { n.remove(); });
            var P1 = '项羽陨灭后，表面上看起来刘邦独大，可以安稳地当皇帝了。事实上，到了汉成立之后，刘家天下依然不是那么稳固。';
            var P2 = '汉王朝成立后，有一个关键的问题出现了——定都。刘敬劝高祖刘邦，应该跟秦一样，定都关中，但刘邦不太同意这个观点。'
                   + '更重要的是，当时跟随的大臣都是东部的人，这些人一想到要去关中，就觉得离自己家乡好远，纷纷劝刘邦都留在洛阳。'
                   + '他们的分析也算有理有据："洛阳东有成皋，西有崤黾，倍河，向伊洛，其固亦足恃。"';
            var box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = '<p data-p="1">' + P1 + '</p><p data-p="2">'
                + P2.replace('崤黾', '<mark class="rd-hl rd-hl-rose" data-hlid="h1" data-gl="xiáo miǎn·崤山与黾池，洛阳西面险要之地">崤黾</mark>')
                + '</p>' + (withBg ? '<blockquote data-cp="1">汐：背景：刘敬说高祖都关中<br>刘敬这个人挺有意思，他本名叫娄敬，原来就是个普通戍卒——被征发去边疆守边的小兵，公元前202年路过洛阳。</blockquote>' : '');
            var bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            var msg = document.createElement('div');
            msg.className = 'chat-msg ai __gh'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            document.documentElement.style.setProperty('--reading-pspace', spacing + 'px');
            box.querySelectorAll('p').forEach(function (el, i) { if (i) el.style.marginTop = spacing + 'px'; });
            rdGlLayout(bub);
            var cr = box.getBoundingClientRect();
            var lab = box.querySelector('.rd-gl-label');
            if (!lab) return null;
            var lr = lab.getBoundingClientRect();
            var p1 = box.querySelector('p[data-p="1"]').getBoundingClientRect();
            var p2 = box.querySelector('p[data-p="2"]').getBoundingClientRect();
            return {
                标签顶: lr.top - cr.top, 标签底: lr.bottom - cr.top,
                上段底: p1.bottom - cr.top, 本段顶: p2.top - cr.top,
                宽: Math.round(lab.offsetWidth), 高: lab.offsetHeight
            };
        };
    ` });

    /* ── A 组：① 各档段间距都不许骑到上一段正文上 ───────────────── */
    for (const sp of [28, 20, 14, 8]) {
        const r = await page.evaluate((s) => window.__build(s, true), sp);
        if (!r) { ok('段间距 ' + sp + '：排出了小注', false, '没排出来'); continue; }
        const 高出 = r.上段底 - r.标签顶;   // >0 ＝ 戳进上一段
        /* ⚠️阈值取一整行（22.4px）：缝比标签窄时蹭几个像素是几何必然，不算 bug；
           「高出一整行」才是那条 ③ 档退路在作祟。改坏时这里会跳到 32px。 */
        ok('段间距 ' + sp + '：没往上顶掉一整行（实际戳进 ' + Math.round(高出) + 'px）',
            高出 < LINE, '标签顶 ' + Math.round(r.标签顶) + ' / 上段底 ' + Math.round(r.上段底));
    }

    /* ── B 组：② 缝够宽（28）时老老实实待在缝里 ────────────────── */
    {
        const r = await page.evaluate(() => window.__build(28, true));
        /* 标签本体（未旋转）应完整落在缝里。外框带 -2.5° 旋转会往上探几 px，
           所以这里留 6px 容差，只钉「没有整块跑出去」。 */
        ok('② 段间距 28 时标签落在两段之间的缝里',
            r.标签顶 > r.上段底 - 6 && r.标签底 <= r.本段顶 + 1,
            '缝 ' + Math.round(r.上段底) + '~' + Math.round(r.本段顶) + ' / 标签 ' + Math.round(r.标签顶) + '~' + Math.round(r.标签底));
    }

    /* ── C 组：⚠️③ 邻居是背景块时，「只压一行」那条退路要照旧生效 ──
       那条退路是 2026-08-06 治「阳翟挡字」加的，别为了修这次的问题把它误伤了。
       构造：把词放在段落**第一行**，段间距调窄 → 小注只能往下压背景块，
       此时它**应该**能抬到只压背景块第一行（＝允许比 12px 那档更靠上）。 */
    {
        const r = await page.evaluate(() => {
            document.querySelectorAll('.__gh').forEach(n => n.remove());
            const box = document.createElement('div');
            box.className = 'reading-merged';
            box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
            box.innerHTML = '<p data-p="1">读到<mark class="rd-hl rd-hl-ink" data-hlid="c1" data-gl="bēi gé·联合抵制">杯葛</mark>停了一下，后面还有些字凑够一行。</p>'
                + '<blockquote data-cp="1">汐：背景：阳翟<br>阳翟这地方在今天的河南禹州，是战国时韩国的都城，位置相当重要，四通八达。</blockquote>';
            const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
            const msg = document.createElement('div');
            msg.className = 'chat-msg ai __gh'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
            document.body.appendChild(msg);
            document.documentElement.style.setProperty('--reading-pspace', '8px');
            rdGlLayout(bub);
            const lab = box.querySelector('.rd-gl-label');
            const bq = box.querySelector('blockquote');
            if (!lab) return null;
            const cr = box.getBoundingClientRect();
            return { 有小注: true, 标签底: lab.getBoundingClientRect().bottom - cr.top, 背景块顶: bq.getBoundingClientRect().top - cr.top };
        });
        ok('③ 邻居是背景块时小注照常排得出来（那条退路没被误伤）', !!(r && r.有小注),
            r ? JSON.stringify(r) : '没排出小注');
    }

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    for (const r of results) {
        if (r.pass) console.log('  ✅ ' + r.name);
        else { bad++; console.log('  ❌ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
    }
    console.log((bad ? '❌ ' : '✅ ') + (results.length - bad) + '/' + results.length + ' 通过');
    process.exit(bad ? 1 : 0);
})();
