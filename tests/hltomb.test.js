/* 划线/读痕「删除墓碑」回归测试（2026-08-13 做）。
 *
 * 用户报：「划线删除之后为啥还会自己回来呀」。
 * 根因：划线和读痕走**逐会话取并集**同步（_mergeMarksBlobs → _readerMergeMarks），
 * 本地删掉一条、云端那份还在，下一次同步就并回来；而同步是先拉后推，并回来的那条
 * 紧接着又被推上去 → 删除被彻底抹平。不是偶发，是必然。
 *
 * 并集本身不能去掉（它挡的是「另一台设备还没同步就被覆盖」那种真丢数据，
 * 见 docs/云同步.md），所以按那份笔记里写的正解补墓碑。
 *
 * 钉住的事：
 *  A 组 删除会立碑，且碑能剔掉云端并回来的那条（这就是用户报的现象）
 *  B 组 ⚠️只剔「碑上有的」，别的一条都不许动——这是这套东西最危险的地方，
 *       矫枉过正就成了「同步会吃掉别的设备的划线」，比原来的 bug 严重得多
 *  C 组 碑跟着 manifest 走（不同步的话，另一台设备会把删掉的又推回来）
 *  D 组 拉取时墓碑要**先**合并、再合并划线（顺序反了会「闪一下又出现」）
 *  E 组 90 天过期清理；碑只进不退（两台设备各删各的，不能互相抹掉）
 *  F 组 全表清扫：云端还没有那本书的数据时，本地那条也要被碑扫掉
 *
 * 跑法：node tests/hltomb.test.js   或   bash tests/p.sh hltomb
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
        const KEY = 'reader_测试书|1234';
        const hl = (id, txt) => ({ id, msgIdx: 0, chap: 0, p: 1, start: 0, end: 2, color: 'sky', note: '', text: txt || '青苔', preview: txt || '青苔', ts: Date.now() });
        const reset = () => {
            localStorage.removeItem('reading_marks_tombs');
            localStorage.setItem('reading_highlights', JSON.stringify({}));
            localStorage.setItem('reading_bookmarks', JSON.stringify({}));
        };

        /* ── A：删掉的那条，云端并回来时要被剔掉 ── */
        {
            reset();
            localStorage.setItem('reading_highlights', JSON.stringify({ [KEY]: [hl('keep-1'), hl('del-1')] }));
            // 模拟「删除」：从本地移除 + 立碑（rdHlDelete 干的两件事）
            const all = JSON.parse(localStorage.getItem('reading_highlights'));
            all[KEY] = all[KEY].filter(h => h.id !== 'del-1');
            localStorage.setItem('reading_highlights', JSON.stringify(all));
            rdMarksTomb('del-1');
            out.A_立碑了 = !!rdMarksGetTombs()['del-1'];
            // 云端那份还带着 del-1（这正是用户遇到的场景）
            const local = JSON.parse(localStorage.getItem('reading_highlights'));
            const cloud = { [KEY]: [hl('keep-1'), hl('del-1')] };
            _mergeMarksBlobs(local, cloud);
            const ids = local[KEY].map(h => h.id);
            out.A_删的没回来 = ids.indexOf('del-1') < 0;
            out.A_别的还在 = ids.indexOf('keep-1') >= 0;
            out.A_ids = ids.join(',');
        }

        /* ── B：⚠️只剔碑上有的。别的设备新划的线必须原样并进来 ── */
        {
            reset();
            localStorage.setItem('reading_highlights', JSON.stringify({ [KEY]: [hl('mine-1')] }));
            rdMarksTomb('del-2');
            const local = JSON.parse(localStorage.getItem('reading_highlights'));
            // 云端：我这条 + 另一台设备新划的两条 + 一条我删过的
            const cloud = { [KEY]: [hl('mine-1'), hl('other-1'), hl('other-2'), hl('del-2')] };
            _mergeMarksBlobs(local, cloud);
            const ids = local[KEY].map(h => h.id).sort();
            out.B_别人的都在 = ids.indexOf('other-1') >= 0 && ids.indexOf('other-2') >= 0;
            out.B_自己的还在 = ids.indexOf('mine-1') >= 0;
            out.B_只剔了碑上的 = ids.indexOf('del-2') < 0 && ids.length === 3;
            out.B_ids = ids.join(',');
        }

        /* ── C：碑要挂进 manifest，否则另一台设备会把删掉的推回来 ── */
        {
            reset();
            rdMarksTomb('del-3');
            let mf = null;
            try { mf = cfBuildManifest(); } catch (e) { mf = null; }
            out.C_manifest带碑 = !!(mf && mf.marksDeleted && mf.marksDeleted['del-3']);
            out.C_字段名 = mf ? Object.keys(mf).filter(k => /marksDeleted/.test(k)).join(',') : '(建不出来)';
        }

        /* ── E：过期清理 + 只进不退 ── */
        {
            reset();
            const t = {};
            t['old-1'] = Date.now() - 100 * 86400000;   // 100 天前，该清
            t['new-1'] = Date.now() - 10 * 86400000;    // 10 天前，该留
            rdMarksSetTombs(t);
            const after = rdMarksGetTombs();
            out.E_清掉了过期的 = !after['old-1'];
            out.E_留住了新的 = !!after['new-1'];
            // 只进不退：再立一次同 id 的碑，时间应该往新里走，不该丢
            rdMarksTomb('new-1');
            out.E_没丢 = !!rdMarksGetTombs()['new-1'];
        }

        /* ── F：全表清扫（云端没有这本书的数据时也要能剔掉） ── */
        {
            reset();
            localStorage.setItem('reading_highlights', JSON.stringify({ [KEY]: [hl('keep-9'), hl('del-9')] }));
            localStorage.setItem('reading_bookmarks', JSON.stringify({ [KEY]: [hl('bm-keep'), hl('bm-del')] }));
            rdMarksTomb('del-9');
            rdMarksTomb('bm-del');
            const swept = rdMarksSweepTombs();
            const h = JSON.parse(localStorage.getItem('reading_highlights'))[KEY].map(x => x.id);
            const b = JSON.parse(localStorage.getItem('reading_bookmarks'))[KEY].map(x => x.id);
            out.F_扫过了 = swept === true;
            out.F_划线剔干净 = h.indexOf('del-9') < 0 && h.indexOf('keep-9') >= 0;
            out.F_读痕也剔 = b.indexOf('bm-del') < 0 && b.indexOf('bm-keep') >= 0;
            out.F_detail = 'hl=' + h.join(',') + ' bm=' + b.join(',');
            // 没有碑的时候不该乱动
            reset();
            localStorage.setItem('reading_highlights', JSON.stringify({ [KEY]: [hl('a'), hl('b')] }));
            out.F_没碑就不动 = rdMarksSweepTombs() === false
                && JSON.parse(localStorage.getItem('reading_highlights'))[KEY].length === 2;
        }

        /* ── D：删除走完整条路（rdHlDelete），碑要立上 ── */
        {
            reset();
            // rdHlDelete 依赖当前会话键，这里直接覆盖成测试键
            const origConvId = window.readingMarksConvId;
            window.readingMarksConvId = () => KEY;
            localStorage.setItem('reading_highlights', JSON.stringify({ [KEY]: [hl('road-1'), hl('road-2')] }));
            try { rdHlDelete('road-1'); } catch (e) { out.D_err = String(e).slice(0, 80); }
            const left = (JSON.parse(localStorage.getItem('reading_highlights'))[KEY] || []).map(x => x.id);
            out.D_删掉了 = left.indexOf('road-1') < 0 && left.indexOf('road-2') >= 0;
            out.D_立了碑 = !!rdMarksGetTombs()['road-1'];
            window.readingMarksConvId = origConvId;
        }

        reset();
        return out;
    });

    ok('A1 删除会立碑', R.A_立碑了);
    ok('A2 ⚠️云端并回来的那条被剔掉（用户报的现象）', R.A_删的没回来, R.A_ids);
    ok('A3 同会话里别的划线还在', R.A_别的还在, R.A_ids);

    ok('B1 ⚠️别的设备新划的线原样并进来', R.B_别人的都在, R.B_ids);
    ok('B2 自己没删的还在', R.B_自己的还在, R.B_ids);
    ok('B3 ⚠️只剔碑上有的，一条都没多删', R.B_只剔了碑上的, R.B_ids);

    ok('C1 碑挂进了 manifest', R.C_manifest带碑, R.C_字段名);

    ok('E1 90 天前的碑被清掉', R.E_清掉了过期的);
    ok('E2 没过期的碑留着', R.E_留住了新的);
    ok('E3 重复立碑不会丢', R.E_没丢);

    ok('F1 全表清扫真的扫了', R.F_扫过了, R.F_detail);
    ok('F2 划线按碑剔干净、留的没动', R.F_划线剔干净, R.F_detail);
    ok('F3 读痕同样按碑剔', R.F_读痕也剔, R.F_detail);
    ok('F4 ⚠️没有碑时一条都不动', R.F_没碑就不动);

    ok('D1 走完整条删除路径，数据没了', R.D_删掉了, R.D_err || '');
    ok('D2 走完整条删除路径，碑立上了', R.D_立了碑, R.D_err || '');

    ok('无 JS 报错', pageErrs.length === 0, pageErrs.join(' | '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '✅' : '❌') + ' ' + r.name + (r.detail ? '  → ' + r.detail : '')));
    console.log('\n' + (results.length - bad.length) + '/' + results.length + ' 通过');
    process.exit(bad.length ? 1 : 0);
})();
