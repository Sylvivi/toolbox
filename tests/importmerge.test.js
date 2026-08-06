/* 「导入备份」的合并逻辑回归测试。
 *
 * 起因：2026-08-06 全局体检发现 importAllData（导入备份文件）和 applySyncData（云同步）
 * 里有一段**逐字相同**的合并代码——但云同步那边后来修过两次，导入这边一直没跟上：
 *
 *   ① 云同步有墓碑检查、导入没有 → 点「导入备份」会把你早就删掉的密钥/收藏原样复活，
 *      而且删除记录被抹掉后，复活的条目下次还会被推上云。
 *   ② 云同步会在合并完子条目后把集合的**外层字段**（标题/标签/备注）也跟成新的，
 *      导入这边只合并了 items，集合改过的名字永远停在旧值。
 *
 * 这是「改了这边、没改那边」的典型：两份实现，修一处、另一处静默留旧。
 * 所以本测试钉的不只是行为对不对，更是**两条路径的规矩要一致**。
 *
 * ⚠️以后再改任何一边的合并规矩，两边一起改，然后跑这个测试。
 *
 * 跑法：node tests/importmerge.test.js   或   bash tests/p.sh importmerge
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

// 造一份干净的本地状态：一条普通收藏、一个集合，外加一条“已经被删掉”的收藏（留墓碑）
function boot() {
    setSnipDataSilent([
        { id: 'keep1', type: 'code', title: '本地保留', code: 'a', updatedAt: '2026-08-01T00:00:00Z' },
        {
            id: 'col1', type: 'collection', title: '集合旧名', tag: '旧标签',
            updatedAt: '2026-08-01T00:00:00Z',
            items: [{ id: 'sub_local', title: '本地子条目', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }]
        }
    ]);
    setKeyDataSilent([]);
    // 「deleted1」是用户删掉的那条，墓碑时间 8/03
    setTombstones({ deleted1: '2026-08-03T00:00:00Z' });
    window._toasts = [];
    if (!window._toastHooked) {
        const _o = window.showToast;
        window.showToast = function (m) { window._toasts.push(String(m)); return _o.apply(this, arguments); };
        window._toastHooked = true;
    }
}

// 用一个真的 File 走 importAllData 的完整路径（它内部用 FileReader，所以要等）
async function doImport(payload) {
    const f = new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' });
    importAllData({ target: { files: [f], value: '' } });
    await new Promise(r => setTimeout(r, 500));
    return {
        ids: getSnipData().map(d => d.id),
        col: getSnipData().find(d => d.id === 'col1'),
        toast: (window._toasts[window._toasts.length - 1] || '')
    };
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._boot=' + boot + ';window._doImport=' + doImport + ';' });

    /* ===== A 组：墓碑——删掉的东西不许被备份文件复活 ===== */
    const A = await page.evaluate(async () => {
        window._boot();
        return await window._doImport({
            snippets: [
                { id: 'deleted1', type: 'code', title: '删掉的', code: 'x', updatedAt: '2026-08-02T00:00:00Z' },
                { id: 'fresh1', type: 'code', title: '新的', code: 'y', updatedAt: '2026-08-05T00:00:00Z' }
            ]
        });
    });
    ok('备份里那条早已删除的，不会被导入复活', A.ids.indexOf('deleted1') === -1, '实际 ' + JSON.stringify(A.ids));
    ok('同一份备份里没被删过的照常导入', A.ids.indexOf('fresh1') !== -1);
    ok('本地原有的没被动', A.ids.indexOf('keep1') !== -1);
    ok('跳过的条数要显示出来（否则会被当成导入坏了）', /跳过1条已删除/.test(A.toast), '实际 toast: ' + A.toast);

    /* ===== B 组：墓碑不是一刀切——删了又改回来的（比墓碑新）要放行 ===== */
    const B = await page.evaluate(async () => {
        window._boot();
        return await window._doImport({
            snippets: [{ id: 'deleted1', type: 'code', title: '删了又改回来', code: 'z', updatedAt: '2026-08-04T00:00:00Z' }]
        });
    });
    ok('比墓碑新的条目要放行（删了又改回来的情况）', B.ids.indexOf('deleted1') !== -1, '实际 ' + JSON.stringify(B.ids));
    ok('放行时不该报「跳过」', !/跳过/.test(B.toast), '实际 toast: ' + B.toast);

    /* ===== C 组：集合——子条目合并 + 外层字段也要跟上（这半原来只有云同步有）===== */
    const C = await page.evaluate(async () => {
        window._boot();
        return await window._doImport({
            snippets: [{
                id: 'col1', type: 'collection', title: '集合新名', tag: '新标签',
                updatedAt: '2026-08-05T00:00:00Z',
                items: [{ id: 'sub_remote', title: '备份里的子条目', createdAt: '2026-08-02T00:00:00Z', updatedAt: '2026-08-05T00:00:00Z' }]
            }]
        });
    });
    eq('集合的外层标题跟上了备份里的新值', C.col.title, '集合新名');
    eq('外层标签也跟上了', C.col.tag, '新标签');
    ok('本地那条子条目没被外层覆盖冲掉', (C.col.items || []).some(s => s.id === 'sub_local'), '实际 ' + JSON.stringify((C.col.items || []).map(s => s.id)));
    ok('备份里的子条目也合并进来了', (C.col.items || []).some(s => s.id === 'sub_remote'));

    /* ===== D 组：备份比本地旧时，外层字段不许倒退 ===== */
    const D = await page.evaluate(async () => {
        window._boot();
        return await window._doImport({
            snippets: [{
                id: 'col1', type: 'collection', title: '更旧的名字', tag: '更旧的标签',
                updatedAt: '2026-07-01T00:00:00Z',
                items: [{ id: 'sub_old', title: '旧子条目', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z' }]
            }]
        });
    });
    eq('备份更旧时外层标题保持本地值（不许倒退）', D.col.title, '集合旧名');
    ok('但旧备份里本地没有的子条目仍然补进来（子条目是取并集的）', (D.col.items || []).some(s => s.id === 'sub_old'));

    /* ===== E 组：密钥走的是同一条墓碑规矩 ===== */
    const E = await page.evaluate(async () => {
        window._boot();
        const f = new File([JSON.stringify({
            api_keys: [
                { id: 'deleted1', name: '删掉的密钥', updatedAt: '2026-08-02T00:00:00Z' },
                { id: 'k_new', name: '新密钥', updatedAt: '2026-08-05T00:00:00Z' }
            ]
        })], 'b.json', { type: 'application/json' });
        importAllData({ target: { files: [f], value: '' } });
        await new Promise(r => setTimeout(r, 500));
        return getKeyData().map(d => d.id);
    });
    ok('密钥也遵守墓碑：删掉的不复活', E.indexOf('deleted1') === -1, '实际 ' + JSON.stringify(E));
    ok('没删过的密钥照常导入', E.indexOf('k_new') !== -1);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
