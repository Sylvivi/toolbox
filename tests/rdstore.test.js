// 阅读数据搬进 IndexedDB ＋ 问答按章推送（2026-09-23 汐）
// 钉三件事：① 老数据从 localStorage 搬过去、不丢；两边都有就合并不覆盖
//          ② localStorage 塞满了，问答照样存得上（这就是这次要防的那个坑）
//          ③ 服务器确认过会合并才传半本；没确认过照旧传整本
const { chromium } = require('playwright');
const APP='file://'+require('path').resolve('/home/ubuntu/Toolbox','index.html');
const R=[]; const ok=(n,p,d)=>R.push({n,p:!!p,d});
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:390,height:780}});
  const errs=[]; pg.on('pageerror',e=>errs.push(e.message.slice(0,160)));
  await pg.goto(APP); await pg.waitForTimeout(4000);

  // ① 模拟「旧版留下的数据」：直接写 localStorage，然后刷新，让开机那一步去搬
  await pg.evaluate(()=>{
    localStorage.setItem('reader_qa', JSON.stringify({ 书A: { '1': { ts: 100, list: [{ q: '旧问1', a: '答' }] }, '2': { ts: 200, list: [{ q: '问2', a: '答' }] } } }));
    localStorage.setItem('reading_highlights', JSON.stringify({ reader_书A: [{ id: 'h1', text: '划线1' }] }));
  });
  await pg.reload(); await pg.waitForTimeout(4000);
  const r1 = await pg.evaluate(()=>({
    qa: JSON.parse(rdLsGet('reader_qa')||'{}'),
    hl: JSON.parse(rdLsGet('reading_highlights')||'{}'),
    lsQa: localStorage.getItem('reader_qa'),
    lsHl: localStorage.getItem('reading_highlights'),
    ready: _rdReady
  }));
  ok('开机后走的是 IndexedDB', r1.ready);
  ok('问答搬过来了、一条没少', r1.qa.书A && r1.qa.书A['1'] && r1.qa.书A['2'], JSON.stringify(r1.qa));
  ok('划线搬过来了', r1.hl.reader_书A && r1.hl.reader_书A.length===1, JSON.stringify(r1.hl));
  ok('搬完 localStorage 那份删掉了（腾地方）', r1.lsQa===null && r1.lsHl===null, r1.lsQa+' / '+r1.lsHl);

  // 旧版页面（被 SW 缓存着）又往 localStorage 写了：有新章、也有某章的旧版本 → 合并，新的不能被旧的盖
  await pg.evaluate(()=>{
    localStorage.setItem('reader_qa', JSON.stringify({ 书A: { '1': { ts: 50, list: [{ q: '更旧的', a: '' }] }, '3': { ts: 300, list: [{ q: '问3', a: '' }] } } }));
    localStorage.setItem('reading_highlights', JSON.stringify({ reader_书A: [{ id: 'h2', text: '划线2' }] }));
  });
  await pg.reload(); await pg.waitForTimeout(4000);
  const r2 = await pg.evaluate(()=>({ qa: JSON.parse(rdLsGet('reader_qa')||'{}'), hl: JSON.parse(rdLsGet('reading_highlights')||'{}') }));
  ok('两边都有时合并：新章加进来', r2.qa.书A['3'], JSON.stringify(r2.qa));
  ok('两边都有时合并：旧版本没盖掉新的', r2.qa.书A['1'].list[0].q==='旧问1', JSON.stringify(r2.qa.书A['1']));
  ok('两边都有时合并：原有的章还在', r2.qa.书A['2']);
  ok('划线取并集（两条都在）', r2.hl.reader_书A && r2.hl.reader_书A.length===2, JSON.stringify(r2.hl));

  // ② 把 localStorage 塞满，再存一条问答 → 刷新后还在
  const r3 = await pg.evaluate(()=>{
    let full=false; const chunk='满'.repeat(500000);
    for (let i=0;i<40;i++){ try{ localStorage.setItem('__junk'+i, chunk); }catch(e){ full=true; break; } }
    const all=readerQAAll(); all.书A['4']={ ts: 400, list:[{ q:'塞满后问的', a:'' }] }; readerQASaveAll(all);
    return { full, toastWarned: _rdWarned };
  });
  ok('（前提）localStorage 确实塞满了', r3.full);
  await pg.waitForTimeout(800);
  await pg.reload(); await pg.waitForTimeout(4000);
  const r4 = await pg.evaluate(()=>{
    const qa=JSON.parse(rdLsGet('reader_qa')||'{}');
    for (let i=0;i<40;i++) localStorage.removeItem('__junk'+i);
    return { has: !!(qa.书A && qa.书A['4']) };
  });
  ok('⚠️localStorage 满了，新问答照样存上、刷新还在', r4.has);
  ok('存得上就不弹「没存上」警告', !r3.toastWarned);

  // ③ 按章推：截住 cfReq 看传了什么
  const r5 = await pg.evaluate(async ()=>{
    const sent=[]; const url='https://sync.example';
    window.cfGetConfig=()=>({ url, token:'t' }); window.activeSyncProvider='cf';
    window.cfReq=(m,k,body)=>{ sent.push({ m, k, chs:Object.keys((body&&body.q)||{}) }); return Promise.resolve({ ok:true, merged:true }); };
    readerQASaveAll({ 书B: { '1': { ts: 100, list:[] }, '2': { ts: 500, list:[] }, '3': { ts: 600, list:[] } } });
    localStorage.removeItem('rqa_srv_merge');
    localStorage.setItem('reader_qa_pushed', JSON.stringify({ 书B: 400 }));
    await cfPushReaderQA();
    const 没确认时 = sent.slice(); sent.length=0;
    // 那一次服务器回了 merged:true → 已记下；再改一章，这回只该传那一章
    const all=readerQAAll(); all.书B['2']={ ts: 700, list:[] }; readerQASaveAll(all);
    await cfPushReaderQA();
    const 确认后 = sent.slice(); sent.length=0;
    // 换了同步地址（比如切回旧的 CF）→ 不算确认过，退回整本
    window.cfGetConfig=()=>({ url:'https://另一个', token:'t' });
    const all2=readerQAAll(); all2.书B['3']={ ts: 800, list:[] }; readerQASaveAll(all2);
    window.cfReq=(m,k,body)=>{ sent.push({ m, k, chs:Object.keys((body&&body.q)||{}) }); return Promise.resolve({ ok:true }); };
    await cfPushReaderQA();
    const 换地址 = sent.slice();
    return { 没确认时, 确认后, 换地址, flag: localStorage.getItem('rqa_srv_merge') };
  });
  ok('服务器没确认过会合并 → 传整本', r5.没确认时.length===1 && r5.没确认时[0].chs.length===3, JSON.stringify(r5.没确认时));
  ok('服务器回过 merged:true 就记下地址', r5.flag==='https://sync.example', r5.flag);
  ok('确认后只传变了的那一章', r5.确认后.length===1 && r5.确认后[0].chs.join()==='2', JSON.stringify(r5.确认后));
  ok('换了同步地址 → 退回整本（防旧服务器被半本覆盖）', r5.换地址.length===1 && r5.换地址[0].chs.length===3, JSON.stringify(r5.换地址));

  ok('全程无 JS 报错', errs.length===0, errs.join(' | '));
  await b.close();
  const bad=R.filter(x=>!x.p);
  R.forEach(x=>console.log((x.p?'✅':'❌')+' '+x.n+(x.d&&!x.p?'  → '+x.d:'')));
  console.log(bad.length?('❌ '+bad.length+' 条失败'):('✅ 全过（'+R.length+' 条）'));
  process.exit(bad.length?1:0);
})();
