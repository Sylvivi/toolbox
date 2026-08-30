const { chromium } = require('playwright');
const APP='file://'+require('path').resolve('/home/ubuntu/Toolbox','index.html');
const R=[]; const ok=(n,p,d)=>R.push({n,p:!!p,d});
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:390,height:780}});
  const errs=[]; pg.on('pageerror',e=>errs.push(e.message.slice(0,160)));
  await pg.goto(APP); await pg.waitForTimeout(6000);
  const r = await pg.evaluate(async ()=>{
    const out={};
    out.池子 = MOTTO_TAGLINES.length;
    const m = document.querySelector('.motto');
    out.默认开 = mottoMovieOn();
    out.开局不是那句老的 = m.textContent.trim() !== 'Tomorrow is another day.';
    out.开局在池子里 = MOTTO_TAGLINES.some(x=>x[0]===m.textContent.trim());
    out.有出处提示 = /^——《.+》$/.test(m.getAttribute('title')||'');
    out.电影模式下不可编辑 = m.contentEditable === 'false';
    // 三份 .motto 和阅读窄条要同步
    const all=[...document.querySelectorAll('.motto')].map(x=>x.textContent.trim());
    out.三份一致 = new Set(all).size===1 && all.length>=2;
    out.窄条同步 = document.getElementById('readingHintMotto').textContent.trim()===all[0];
    // 点一下换下一句
    const 前=m.textContent.trim(); const 序=[];
    for(let i=0;i<6;i++){ m.click(); 序.push(m.textContent.trim()); }
    out.点了会换 = 序.some(x=>x!==前);
    out.连点不重复 = 序.every((x,i)=> i===0 || x!==序[i-1]);
    out.每次都在池子里 = 序.every(x=>MOTTO_TAGLINES.some(y=>y[0]===x));
    // 长按切回自己那句
    localStorage.setItem('toolbox_motto','我自己写的那句');
    mottoToggleMode();
    out.切回后 = m.textContent.trim();
    out.切回后可编辑 = m.contentEditable === 'true';
    out.切回后点了不变 = (m.click(), m.textContent.trim()==='我自己写的那句');
    out.切回后没有出处 = !m.getAttribute('title');
    mottoToggleMode();
    out.再切回电影 = MOTTO_TAGLINES.some(x=>x[0]===m.textContent.trim());
    return out;
  });
  ok('池子有 200 条以上', r.池子>=200, r.池子);
  ok('默认就是电影模式', r.默认开);
  ok('打开页面直接是一句 tagline', r.开局不是那句老的 && r.开局在池子里);
  ok('鼠标悬停能看到出自哪部片', r.有出处提示);
  ok('电影模式下点不出光标（不可编辑）', r.电影模式下不可编辑);
  ok('三处 .motto 显示一致', r.三份一致);
  ok('阅读窄条跟着同步', r.窄条同步);
  ok('点一下换下一句', r.点了会换);
  ok('连点不会连着出同一句', r.连点不重复, JSON.stringify(r));
  ok('换出来的都在池子里', r.每次都在池子里);
  ok('长按切回自己那句', r.切回后==='我自己写的那句');
  ok('切回后恢复可编辑', r.切回后可编辑);
  ok('切回后点它不再乱换', r.切回后点了不变);
  ok('切回后不再显示出处', r.切回后没有出处);
  ok('再长按能切回电影模式', r.再切回电影);
  ok('全程无 JS 报错', errs.length===0, errs.join(' | '));
  await b.close();
  const bad=R.filter(x=>!x.p);
  R.forEach(x=>console.log((x.p?'✅':'❌')+' '+x.n+(x.d&&!x.p?'  → '+x.d:'')));
  console.log(bad.length?('❌ '+bad.length+' 条失败'):('✅ 全过（'+R.length+' 条）'));
  process.exit(bad.length?1:0);
})();
