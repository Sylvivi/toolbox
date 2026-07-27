/* 名单（人名/地名高亮）同步的回归测试。
 *
 * 起因：用户发现「设置里名词的名单好像不太会同步」。查下来不是偶发——
 * `reading_names_*` 压根没进 cfBuildManifest，而且它是按**书 id** 存的，
 * 而书 id 是 `bk_<时间戳>_<随机>`、**每台设备导入时各生成一个**，
 * 就算硬同步过去也对不上号。所以改成按 fileKey(`书名|字节数`)存 + 挂进同步。
 *
 * 跑法：bash tests/run.sh
 */
const { chromium } = require('playwright');
const APP = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
const results = [];
function ok(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
function eq(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), '实际 ' + JSON.stringify(got) + ' / 期望 ' + JSON.stringify(want)); }

function boot() {
    const book = { id: 'bk_1753600000_ab12', fileName: '天龙八部.txt', fileSize: 998877, chapters: [{ title: '第一章', body: '正文\n正文二' }] };
    window.rbBooks = [book];
    window.rbGetBook = (id) => (id === book.id ? book : null);
    window.chatReaderMode = true;
    window.readerBookId = book.id;
    window.chatCurrentConvId = 'reader_' + book.id;
    // 清掉所有名单键，每轮从干净状态开始
    Object.keys(localStorage).forEach(k => { if (k.indexOf('reading_names') === 0) localStorage.removeItem(k); });
    return book;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const pageErrs = [];
    page.on('pageerror', e => pageErrs.push(e.message.slice(0, 200)));
    await page.goto(APP);
    await page.waitForTimeout(6000);
    await page.addScriptTag({ content: 'window._boot=' + boot + ';' });

    const A = await page.evaluate(() => {
        const book = window._boot();
        readingSetNames(['乔峰', '段誉', '虚竹']);
        return {
            存的键: Object.keys(localStorage).filter(k => k.indexOf('reading_names_') === 0).sort(),
            读回来: readingGetNames(),
            打包: readingNamesAll(),
            有时间戳: !!readingNamesTs()
        };
    });
    eq('名单按 fileKey 存（不是按每台设备各不相同的书 id）', A.存的键, ['reading_names_ts', 'reading_names_天龙八部.txt|998877']);
    eq('存完读得回来（长名在前，短名不会先吃掉长名一截）', A.读回来, ['乔峰', '段誉', '虚竹']);
    eq('打包给云端的是 {fileKey: 名字表}', A.打包, { '天龙八部.txt|998877': ['乔峰', '段誉', '虚竹'] });
    ok('落盘时打了时间戳（同步靠它比新旧）', A.有时间戳);

    /* 旧数据不能丢：以前按书 id / reader_书id 存的，得自动搬到 fileKey 下 */
    const B = await page.evaluate(() => {
        const book = window._boot();
        localStorage.setItem('reading_names_' + book.id, JSON.stringify(['旧名甲', '旧名乙']));
        localStorage.setItem('reading_names_reader_' + book.id, JSON.stringify(['更旧的名']));
        const got = readingGetNames();
        return {
            读到的: got.slice().sort(),
            旧键还在吗: Object.keys(localStorage).filter(k => k.indexOf('reading_names_bk_') === 0 || k.indexOf('reading_names_reader_') === 0),
            新键: Object.keys(localStorage).filter(k => k.indexOf('reading_names_天龙') === 0)
        };
    });
    eq('旧键里的名单自动搬过来，一个不丢', B.读到的, ['更旧的名', '旧名乙', '旧名甲'].sort());
    eq('搬完把旧键删掉（免得下次又搬一遍）', B.旧键还在吗, []);
    eq('搬到了 fileKey 那个新键下', B.新键, ['reading_names_天龙八部.txt|998877']);

    /* 同步：进得了清单、拉得回来、按时间戳护栏 */
    const C = await page.evaluate(() => {
        const book = window._boot();
        readingSetNames(['乔峰']);
        const mf = cfBuildManifest();
        const out = { 清单里有: !!mf.readerNames, 内容: mf.readerNames, 时间戳: !!mf.readerNamesTs };

        // 云端更新 → 覆盖本地
        readingNamesApplyAll({ '天龙八部.txt|998877': ['慕容复', '王语嫣'] }, '2099-01-01T00:00:00.000Z');
        out.拉云端后 = readingGetNames();

        // 别的设备删掉的名字不许在这台机器复活（整块覆盖，不是只增不删）
        readingNamesApplyAll({ '天龙八部.txt|998877': ['慕容复'] }, '2099-01-02T00:00:00.000Z');
        out.对方删了之后 = readingGetNames();

        // 本地已有更新的时间戳时，旧的云端数据不许倒灌
        localStorage.setItem('reading_names_ts', '2099-06-01T00:00:00.000Z');
        const older = { readerNames: { '天龙八部.txt|998877': ['过期数据'] }, readerNamesTs: '2000-01-01T00:00:00.000Z' };
        if (older.readerNamesTs > readingNamesTs()) readingNamesApplyAll(older.readerNames, older.readerNamesTs);
        out.旧数据倒灌了吗 = readingGetNames();
        return out;
    });
    ok('名单进了同步清单 cfBuildManifest', C.清单里有, JSON.stringify(C));
    eq('清单里带的是 fileKey → 名字表', C.内容, { '天龙八部.txt|998877': ['乔峰'] });
    ok('清单里带了时间戳', C.时间戳);
    eq('拉到云端更新 → 本地跟着变', C.拉云端后, ['慕容复', '王语嫣']);
    eq('别的设备删掉的名字不会在这台机器复活', C.对方删了之后, ['慕容复']);
    eq('本地更新时，云端旧数据不许倒灌覆盖', C.旧数据倒灌了吗, ['慕容复']);

    /* reading_names_on / _ts 前缀一样，绝不能被当成某本书的名单 */
    const D = await page.evaluate(() => {
        window._boot();
        localStorage.setItem('reading_names_on', '1');
        readingSetNames(['乔峰']);
        const packed = readingNamesAll();
        readingNamesApplyAll({ '天龙八部.txt|998877': ['乔峰'] }, '2099-01-01T00:00:00.000Z');
        return { 打包里有开关吗: Object.keys(packed), 覆盖后开关还在吗: localStorage.getItem('reading_names_on') };
    });
    eq('打包时不会把高亮总开关当成一本书的名单', D.打包里有开关吗, ['天龙八部.txt|998877']);
    eq('整块覆盖时不会误删高亮总开关', D.覆盖后开关还在吗, '1');

    /* 没打开过的书也要搬：否则推上云的是一堆对不上号的死键 */
    const E = await page.evaluate(() => {
        const book = window._boot();
        const other = { id: 'bk_1753699999_zz99', fileName: '三体.txt', fileSize: 123456, chapters: [] };
        window.rbBooks = [book, other];
        window.rbGetBook = (id) => [book, other].filter(b => b.id === id)[0] || null;
        // 另一本书的名单还挂在书 id 下，而且这本书从没打开过（readingNamesKey 指的是第一本）
        localStorage.setItem('reading_names_' + other.id, JSON.stringify(['罗辑', '叶文洁']));
        _readingNamesSweep._done = false;
        const packed = readingNamesAll();
        return { 打包结果: packed, 死键还在吗: !!localStorage.getItem('reading_names_' + other.id) };
    });
    eq('没打开过的书，名单也按 fileKey 打包（不会推一堆死键上云）', E.打包结果, { '三体.txt|123456': ['叶文洁', '罗辑'] });
    ok('搬完删掉按书 id 存的旧键', !E.死键还在吗);

    ok('全程没有 JS 报错', pageErrs.length === 0, pageErrs.join(' ｜ '));

    await browser.close();
    const bad = results.filter(r => !r.pass);
    results.forEach(r => console.log((r.pass ? '  ✅ ' : '  ❌ ') + r.name + (r.pass ? '' : '\n        → ' + (r.detail || ''))));
    console.log('\n' + (bad.length ? '❌ ' + bad.length + '/' + results.length + ' 条没过' : '✅ ' + results.length + ' 条全过'));
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error('测试脚本本身炸了：', e); process.exit(2); });
