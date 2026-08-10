/* 选中文字的小条 & 划线颜色（2026-08-10 改的新交互）。
 *
 * 用户定的规则：**刚选中时不给色板、颜色随机；想自己挑颜色，划完再点那条划线**。
 * 她的原话：「刚开始选中的时候，没有那些颜色条，它可能是随机的小注颜色，但是选好之后再点，
 *   就会出现可选颜色，这个时候我可以按我自己的想法去选颜色，这样就即兼顾了随机又兼顾了自定义」。
 *
 * 钉住的几条：
 *  A 组 选中小条：没有色板、有「🖍 划线」和「✍️ 注」
 *  B 组 随机取色：在池子里、不出 ink、不连着同色
 *  C 组 已有划线的小条：色板还在（自定义的入口就靠它）
 *  D 组 ⚠️「划线样式(底色↔下划线)」那颗键不许再出现在选中小条上——它显示的字也是「划线」，
 *       跟真·划线键撞脸，历史上就害用户以为「划线功能坏了」
 *
 * 跑法：node tests/selbar.test.js   或   bash tests/p.sh selbar
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
        // 造一条共读消息 + 一段可选中的正文
        const box = document.createElement('div');
        box.className = 'reading-merged';
        box.style.cssText = 'font-size:14px;line-height:1.6;width:358px';
        box.innerHTML = '<p data-p="1">那年山里落了很大的雪，门前石阶上生满青苔，屋中雾气氤氲。</p>';
        const bub = document.createElement('div'); bub.className = 'chat-bubble'; bub.appendChild(box);
        const msg = document.createElement('div');
        msg.className = 'chat-msg ai __sb'; msg.setAttribute('data-idx', '0'); msg.appendChild(bub);
        document.body.appendChild(msg);
        chatCurrentConvId = 'reader_test_selbar';

        const p = box.querySelector('p[data-p="1"]');
        function selectWord(word) {
            const t = p.firstChild, at = p.textContent.indexOf(word);
            const rg = document.createRange();
            rg.setStart(t, at); rg.setEnd(t, at + word.length);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rg);
            rdHlShowSelBar({ p: p, range: rg, msgIdx: 0, pNum: 1 });
            return document.getElementById('rdHlBar');
        }

        // ── A：选中小条的零件 ──
        {
            const bar = selectWord('氤氲');
            out.A_有小条 = !!bar;
            out.A_没有色板 = bar ? bar.querySelectorAll('.rd-sw').length === 0 : false;
            out.A_有划线键 = !!(bar && bar.querySelector('[data-act="hl"]'));
            out.A_有注键 = !!(bar && bar.querySelector('[data-act="gloss"]'));
            out.A_有改键 = !!(bar && bar.querySelector('[data-act="edit"]'));
            // ⚠️D 组那条：样式键不许留在这条上（跟真·划线键撞脸）
            out.D_没有样式键 = bar ? bar.querySelectorAll('button.rd-style').length === 0 : false;
            out.A_零件数 = bar ? bar.querySelectorAll('button').length : -1;
            rdHlHideBar();
        }

        // ── B：随机取色 ──
        {
            const pool = RD_HL_COLORS.filter(c => c !== 'ink');
            const got = new Set();
            let sawInk = false, sawRepeat = 0, prev = null;
            for (let i = 0; i < 200; i++) {
                const c = rdHlRandomColor();
                got.add(c);
                if (c === 'ink') sawInk = true;
                if (prev && c === prev) sawRepeat++;
                localStorage.setItem('reading_hl_last_color', c);   // 模拟「上一次用的色」
                prev = c;
            }
            out.B_都在池子里 = [...got].every(c => pool.indexOf(c) >= 0);
            out.B_覆盖了整池 = got.size === pool.length;
            out.B_不出墨色 = !sawInk;
            out.B_不连着同色 = sawRepeat === 0;
        }

        // ── C：真的划出来了，且颜色是随机的那支 ──
        {
            const bar = selectWord('青苔');
            bar.querySelector('[data-act="hl"]').click();
            const mk = box.querySelector('mark.rd-hl');
            out.C_划出来了 = !!mk;
            out.C_颜色类 = mk ? (String(mk.className).match(/rd-hl-(\w+)/) || [])[1] : '';
            out.C_颜色合法 = RD_HL_COLORS.indexOf(out.C_颜色类) >= 0;
            // 点已有划线 → 这条小条上**有**色板（自定义颜色的入口）
            rdHlShowEditBar(mk);
            const bar2 = document.getElementById('rdHlBar');
            out.C_编辑条有色板 = bar2 ? bar2.querySelectorAll('.rd-sw').length === RD_HL_COLORS.length : false;
            out.C_编辑条能换色 = !!(bar2 && bar2.querySelector('.rd-sw'));
            // 换成指定颜色，验证自定义那一半确实通
            if (bar2) bar2.querySelector('.rd-sw-green').click();
            const mk2 = box.querySelector('mark.rd-hl');
            out.C_换色生效 = !!(mk2 && String(mk2.className).indexOf('rd-hl-green') >= 0);
            rdHlHideBar();
        }

        /* ── D：⚠️「不连着同色」在**真实路径**上也要成立 ──
           2026-08-10 用户报：「小注的颜色是随机的吗？感觉有点连着，就是同一种颜色可能出现两次」。
           根因：躲开上一次靠的是 reading_hl_last_color 这个键，划线那条路径一直写着，
           而**小注那条路径改成随机取色时漏了写回** → 每次都拿陈旧的值去比，连着注几条必然撞色。
           ⚠️所以这里**不许手动 setItem 去喂**（B 组那样测只能证明函数本身没问题），
             必须走真实的创建流程，让代码自己写回。 */
        {
            try { localStorage.removeItem('reading_hl_last_color'); } catch (e) {}
            const RAW = '那年山里落了很大的雪，门前石阶上生满青苔，屋中雾气氤氲。';
            // ⚠️先复位：C 组留下的 mark 会把段落切成好几个文本节点，selectWord 只认 firstChild
            box.querySelector('p[data-p="1"]').innerHTML = RAW;
            const seq = [];
            for (let i = 0; i < 12; i++) {
                const w = ['青苔', '氤氲', '石阶', '门前'][i % 4];
                const bar = selectWord(w);
                bar.querySelector('[data-act="hl"]').click();
                const mk = [...box.querySelectorAll('mark.rd-hl')].pop();
                seq.push((String(mk.className).match(/rd-hl-(\w+)/) || [])[1]);
                // 清掉这一轮的 mark，下一轮好重新选
                box.querySelector('p[data-p="1"]').innerHTML = RAW;
            }
            out.D_序列 = seq;
            let rep = 0;
            for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) rep++;
            out.D_真实路径不连着重复 = rep === 0;
            // 小注那条路径（rdGlMake）也必须写回这个键——⚠️精确匹配，别只搜键名（注释里提一嘴会假过）
            out.D_小注路径也写回 = rdGlMake.toString().indexOf("setItem('reading_hl_last_color', color)") >= 0;
        }

        document.querySelectorAll('.__sb').forEach(n => n.remove());
        try { localStorage.removeItem('reading_hl_last_color'); } catch (e) {}
        return out;
    });

    ok('A1 选中后弹出了小条', R.A_有小条);
    ok('A2 ⚠️选中小条上没有色板（颜色改成随机了）', R.A_没有色板);
    ok('A3 有「🖍 划线」键', R.A_有划线键, '共 ' + R.A_零件数 + ' 颗键');
    ok('A4 「✍️ 注」还在', R.A_有注键);
    ok('A5 「✏️ 改」还在', R.A_有改键);
    ok('B1 随机色都在池子里', R.B_都在池子里);
    ok('B2 六个色里的五个都抽得到', R.B_覆盖了整池);
    ok('B3 ⚠️不抽到墨色（留给手动挑）', R.B_不出墨色);
    ok('B4 ⚠️不连着抽到同一个色', R.B_不连着同色);
    ok('C1 点「划线」真的划出来了', R.C_划出来了, '颜色=' + R.C_颜色类);
    ok('C2 随机到的颜色合法', R.C_颜色合法);
    ok('C3 ⚠️点已有划线时色板出现（自定义的入口）', R.C_编辑条有色板);
    ok('C4 在那条上换色生效', R.C_换色生效);
    ok('D1 ⚠️「划线样式」键不在选中小条上（跟真·划线键撞脸）', R.D_没有样式键);
    ok('D2 ⚠️连划 12 条，颜色不连着重复（走真实路径，不手动喂 last_color）', R.D_真实路径不连着重复, (R.D_序列 || []).join('→'));
    ok('D3 ⚠️小注那条路径也把颜色写回 last_color', R.D_小注路径也写回);
    ok('E1 无页面报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    let bad = 0;
    results.forEach(r => { if (!r.pass) bad++; console.log('  ' + (r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  — ' + r.detail : '')); });
    console.log(bad ? `\n❌ 选中小条与随机色：${bad}/${results.length} 条失败` : `\n✅ 选中小条与随机色：${results.length} 条全过`);
    process.exit(bad ? 1 : 0);
})();
