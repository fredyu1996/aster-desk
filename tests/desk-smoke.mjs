// Desk smoke test: opens index.html in a headless browser against a fake Aster API (70 made-up coins),
// enters the desk, opens every agent panel and fails on any page error. Run after python3 build.py:
//   npx playwright install chromium   (once)
//   node tests/desk-smoke.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const N=70, now=Date.now();
const syms=[...Array(N)].map((_,i)=>({s:(['IDOL','AKE','ONE','AIN','PAIR','UAI','DELTA','MAX','LYN','LITE','NIGHT','ZORA','MEW','POPCAT','WIF','BONK','TURBO','GOAT','PNUT','ACT'][i%20])+(i>=20?i:'')+'USDT',i}));
syms.push({s:'BTCUSDT',i:99,top:true},{s:'ASTERUSDT',i:98,top:true},{s:'MSTRUSDT',i:97,stock:true});
const rnd=(i,k)=>{const x=Math.sin(i*12.9898+k*78.233)*43758.5453;return x-Math.floor(x)};
const px=o=>o.top?(o.s==='BTCUSDT'?101000:1.2):0.01+rnd(o.i,1)*3;
const ex={rateLimits:[],symbols:syms.map(o=>({symbol:o.s,status:'TRADING',contractType:'PERPETUAL',quoteAsset:'USDT',baseAsset:o.s.replace('USDT',''),symbolType:o.stock?1:0,underlyingSubType:o.top?['Top']:o.stock?['STOCK']:[],onboardDate:now-86400e3*30}))};
const tick=()=>syms.map(o=>{const p=px(o),pct=(rnd(o.i,2)-0.45)*90;return {symbol:o.s,lastPrice:String(p),priceChangePercent:pct.toFixed(3),openPrice:String(p/(1+pct/100)),highPrice:String(p*1.05),lowPrice:String(p*0.8),quoteVolume:String(2e5+rnd(o.i,3)*2e7),count:1000}});
const prem=()=>syms.map(o=>({symbol:o.s,markPrice:String(px(o)),lastFundingRate:String((rnd(o.i,4)-0.5)*0.003),nextFundingTime:now+3600e3}));
const kl=(o)=>[...Array(96)].map((_,j)=>{const p=px(o)*(1+(j-96)/400*(rnd(o.i,5)-0.5)*4);const qv=1e5+rnd(o.i*j,6)*4e5;const b=rnd(o.i,7);return [now-(96-j)*900e3,String(p*0.99),String(p*1.02),String(p*0.97),String(p),'0',now-(95-j)*900e3,String(qv),10,'0',String(qv*(0.3+b*0.4)),'0']});
// seed OI history: 70 min
const seed={v:1,d:{}};
for(const o of syms){const base=1e6+rnd(o.i,8)*5e7, drift=(rnd(o.i,9)-0.5)*0.4; seed.d[o.s]=[...Array(36)].map((_,j)=>[Math.round((now-(70-j*2)*60e3)/1000), base*(1+drift*j/35), +(px(o)*(1+drift*j/70)).toPrecision(6)]);}
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1500,height:860}});
const errs=[];page.on('pageerror',e=>errs.push('PAGEERR '+e.stack));page.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text())});
await page.addInitScript(s=>localStorage.setItem('awx_oi',s),JSON.stringify(seed));
// a fake sync token (sync stays off) and a fake backtest file on the data repo: the Reviewer's SMC tab must show it read-only
await page.addInitScript(()=>localStorage.setItem('awx_sync',JSON.stringify({repo:'test/data',token:'fake',on:false})));
const btFake={v:1,sum:{t:now,from:now-7*864e5,to:now,days:7,coins:40,runS:300,variants:{base:{n:12,avgR:0.1,win:50,open:0},zone:{n:14,avgR:-0.2,win:40,open:1},noObQ:{n:15,avgR:0.05,win:47,open:0}},
 decisions:[{k:'flow',lab:'Skip when the 1h taker flow is against the trade',bt:{kept:{n:8,avgR:0.3,win:60},dropped:{n:4,avgR:-0.3,win:25}},live:{kept:{n:21,avgR:0.07,win:48},dropped:{n:17,avgR:-0.32,win:29}}},
  {k:'obQ',lab:'OB quality bar',blocked:5,bt:{kept:{n:0,avgR:null,win:null},dropped:{n:3,avgR:0,win:33}},live:{kept:{n:2,avgR:-0.21,win:50},dropped:{n:8,avgR:-0.02,win:38}}}],
 simVsLive:{live:13,matched:2,meanAbsDR:0.6},note:'Backtest: proposal only.'},trades:[]};
const btBig={v:1,sum:{t:now,from:now-7*864e5,to:now,days:7,coins:20,runS:90,variants:{base:{n:6,avgR:0.2,win:50,open:1}},decisions:[],simVsLive:{live:0,matched:0,meanAbsDR:null,why:{}},note:'SMC Big backtest: proposal only.'},trades:[]};
const btYear={v:1,sum:{t:now,from:now-365*864e5,to:now,split:now-120*864e5,days:365,coins:['BTCUSDT','ETHUSDT'],runS:100,snap:{cfg:{minQ:55},adj:{minQ:70}},
 base:{all:{n:20,avgR:0.2,win:60,totR:4,maxDD:2},a:{n:14,avgR:0.1,win:55,totR:1.4,maxDD:2},b:{n:6,avgR:0.43,win:70,totR:2.6,maxDD:1},coin:{BTCUSDT:{n:8,avgR:0.3,win:62,totR:2.4,maxDD:1},ETHUSDT:{n:12,avgR:0.13,win:58,totR:1.6,maxDD:2}},open:0},
 raw:{all:{n:40,avgR:-0.1,win:40,totR:-4,maxDD:6},a:{n:28,avgR:-0.05,win:42,totR:-1.4,maxDD:5},b:{n:12,avgR:null,win:null,totR:0,maxDD:0},coin:{BTCUSDT:{n:20,avgR:-0.1,win:40,totR:-2,maxDD:3},ETHUSDT:{n:20,avgR:-0.1,win:40,totR:-2,maxDD:3}},open:0},
 note:'Backtest — report only, never changes live rules.',fundingNote:'Funding not modelled.'},
 abl:[{k:'cont',lab:'Continuation setups',base:{all:{n:20,avgR:0.2},a:{},b:{}},sw:{all:{n:9,avgR:0.1},a:{},b:{}},dAvg:-0.1,dA:-0.1,dB:0.2,dTot:-2,label:'helpful'},{k:'poi',lab:'POI rule',base:{all:{n:20,avgR:0.2},a:{},b:{}},sw:{all:{n:30,avgR:0.3},a:{},b:{}},dAvg:0.1,dA:0.1,dB:0.1,dTot:2,label:'harmful'}],
 skipped:[{k:'flow',lab:'Taker flow filter',why:'needs data not in the history'}],
 pat:{held:[{f:'wd',v:'Fri',dA:0.8,dB:0.3,inA:{n:22,avgR:0.6},inB:{n:11,avgR:0.1},outA:{n:109,avgR:-0.2},outB:{n:42,avgR:-0.19}}],notHeld:[{f:'hour',v:'late',dA:-0.4,dB:0.6,inA:{n:24,avgR:-0.39},inB:{n:6,avgR:0.46},outA:{n:107,avgR:0},outB:{n:47,avgR:-0.2}}]},
 months:{base:[{m:'2026-01',n:3,avgR:0.5},{m:'2026-02',n:2,avgR:-0.2}],raw:[{m:'2026-01',n:5,avgR:null},{m:'2026-02',n:4,avgR:-0.1}]},exits:{base:[{why:'stop loss hit',n:5,avgR:-1}],raw:[{why:'stop loss hit',n:9,avgR:-1}]},
 trades:[1,2,3].map(i=>({v:'base',s:'BTCUSDT',side:i%2?'S':'L',t0:now-i*864e5,t1:now,tf:'15m',type:'cont',zk:'FVG',q:80,g:'B',reg:'down',R:i-1.5,why:'target hit',f:{hour:'Asia'}}))};
await page.route('https://api.github.com/**',r=>{const u=r.request().url();
 if(u.includes('/git/ref/heads/backtest'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({object:{sha:'bt1'}})});
 if(u.includes('/contents/smc-backtest.json'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(btFake)});
 if(u.includes('/contents/smc-backtest-big.json'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(btBig)});
 if(u.includes('/contents/smc-backtest-year.json'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(btYear)});
 return r.fulfill({status:404,body:'{}'});});
await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
let calls=0;
await page.route('https://fapi.asterdex.com/**',async r=>{calls++;const u=new URL(r.request().url());const p=u.pathname,s=u.searchParams.get('symbol');const o=syms.find(x=>x.s===s);let body;if(s&&!o)return r.fulfill({status:400,body:'{}'});
 if(p.endsWith('exchangeInfo'))body=ex;else if(p.endsWith('fundingInfo'))body=syms.map(o=>({symbol:o.s,fundingIntervalHours:4}));else if(p.endsWith('ticker/24hr'))body=tick();else if(p.endsWith('premiumIndex'))body=prem();
 else if(p.endsWith('openInterest'))body={symbol:s,openInterest:String(seed.d[s].at(-1)[1]*(1+(rnd(o.i,10)-0.4)*0.3)),time:Date.now()};
 else if(p.endsWith('klines'))body=kl(o);else if(p.endsWith('aggTrades'))body=[...Array(1000)].map((_,j)=>({p:String(px(o)),q:String((rnd(o.i,j)**6)*3e5/px(o)),m:j%3===0,T:Date.now()-(1000-j)*1500}));else return r.fulfill({status:404,body:'x'});
 r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});});
await page.routeWebSocket(/fstream\.asterdex\.com/,ws=>{
 let n=0;const iv=setInterval(()=>{n++;try{
  ws.send(JSON.stringify({stream:'!markPrice@arr@1s',data:syms.map(o=>({s:o.s,p:String(px(o)),r:String((rnd(o.i,4)-0.5)*0.003),T:now+3600e3}))}));
 }catch(e){clearInterval(iv)}},1000);
 ws.onMessage(()=>{});
});
await page.goto(new URL('../index.html', import.meta.url).href);
await page.waitForTimeout(6000);
console.log('BOOT', await page.evaluate(()=>document.querySelector('#boot').textContent));
await page.click('#enter', {timeout: 120000, noWaitAfter: true}); await page.waitForTimeout(20000);
const ids = await page.evaluate(() => Object.keys(TABS));
for (const id of ids) { await page.evaluate(i => { openPanel(i); }, id); await page.waitForTimeout(700); for (const [t] of await page.evaluate(i => TABS[i], id)) { await page.evaluate(([i, t]) => { PS.tab[i] = t; setTabs(); renderPanel(); }, [id, t]); await page.waitForTimeout(250); } await page.evaluate(() => closePanel()); }
console.log('panels checked:', ids.join(', '));
// Nov 20 (option A): the Trader, OpenInterest and Flow panels/desks and the gainer/loser board tabs are gone
const gone = await page.evaluate(() => ({ids: [...Object.keys(TABS), ...desks.map(d => d.a.id)].filter(k => ['trader', 'ivy', 'flo'].includes(k)), scout: TABS.scout.map(t => t[0]).join()}));
if (gone.ids.length || gone.scout !== 't,w,set') errs.push('PAGEERR removed panels still present: ' + JSON.stringify(gone));
// SMC Big view: read-only (awx_sm byte-identical across the switch and every visible tab), race wall draws the third line
await page.evaluate(() => { openPanel('smc'); PS.tab.smc = 'acct'; setTabs(); renderPanel(); }); await page.waitForTimeout(500);
const bigRes = await page.evaluate(async () => {
  const before = localStorage.getItem('awx_sm'), tabs = [], errsB = [];
  document.querySelector('[data-smv="sb"]').click();
  tabs.push(...[...document.querySelectorAll('#pTabs [data-tab]')].map(e => e.dataset.tab));
  for (const t of tabs) { try { PS.tab.smc = t; setTabs(); renderPanel(); } catch (e) { errsB.push(t + ': ' + e.message); } }
  const bodyHasBig = /SMC Big/.test(document.querySelector('#pbody').textContent);
  document.querySelector('[data-smv="sm"]').click(); document.querySelector('[data-smv="sb"]').click();
  const same = localStorage.getItem('awx_sm') === before;
  const on0 = SB.on, tgl = document.querySelector('[data-smb="toggle"]');
  tgl.click(); const on1 = JSON.parse(localStorage.getItem('awx_sb') || '{}').on, smSame = localStorage.getItem('awx_sm') === before;
  document.querySelector('[data-smb="toggle"]').click(); const on2 = JSON.parse(localStorage.getItem('awx_sb') || '{}').on;
  const toggleOk = on0 !== on1 && on2 === on0 && smSame && localStorage.getItem('awx_sm') === before;
  const subtitle = document.querySelector('#pTtl small').textContent, wording = /top-10/.test(document.querySelector('#pbody').textContent) && !/same fees, slippage/.test(document.querySelector('#pbody').textContent) && /top-10/.test(subtitle);
  SB.eqs = [[now() - 7200e3, 1000], [now() - 3600e3, 1015]]; drawRace();
  const d = RACE.ctx.getImageData(0, 0, RACE.W, RACE.H).data; let hits = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 0x40 && d[i] < 0x98 && d[i + 1] > 0xc0 && d[i + 2] > 0xe8) hits++;
  document.querySelector('[data-smv="sm"]').click();
  return {tabs, errsB, bodyHasBig, same, hits, toggleOk, wording};
});
console.log('big mode:', JSON.stringify(bigRes));
if (bigRes.errsB.length) errs.push('PAGEERR big-mode tab: ' + bigRes.errsB.join('; '));
if (!bigRes.same) errs.push('PAGEERR awx_sm changed while viewing Big caps');
if (bigRes.tabs.join() !== 'acct,set,log') errs.push('PAGEERR big-mode tabs are ' + bigRes.tabs.join());
if (!bigRes.bodyHasBig) errs.push('PAGEERR big-mode panel does not say SMC Big');
if (!bigRes.toggleOk) errs.push('PAGEERR big-mode toggle must flip awx_sb.on and leave awx_sm untouched');
if (!bigRes.wording) errs.push('PAGEERR big-mode wording still small-cap');
if (bigRes.hits < 30) errs.push('PAGEERR race wall has no SMC Big line/legend (' + bigRes.hits + ' px)');
// SMC BTC/ETH view: read-only like Big caps, its own toggle (awx_se only), race wall draws its line and column
const seRes = await page.evaluate(async () => {
  openPanel('smc'); PS.tab.smc = 'acct'; setTabs(); renderPanel();
  const before = [localStorage.getItem('awx_sm'), localStorage.getItem('awx_sb')], tabs = [], errsE = [];
  document.querySelector('[data-smv="se"]').click();
  tabs.push(...[...document.querySelectorAll('#pTabs [data-tab]')].map(e => e.dataset.tab));
  for (const t of tabs) { try { PS.tab.smc = t; setTabs(); renderPanel(); } catch (e) { errsE.push(t + ': ' + e.message); } }
  PS.tab.smc = 'acct'; setTabs(); renderPanel();
  const body = document.querySelector('#pbody').textContent, label = /SMC BTC\/ETH/.test(body) && /BTC \+ ETH only/.test(body) && /BTC and ETH only/.test(document.querySelector('#pTtl small').textContent);
  const on0 = SE.on; document.querySelector('[data-smb="toggle"]').click(); const on1 = JSON.parse(localStorage.getItem('awx_se') || '{}').on;
  document.querySelector('[data-smb="toggle"]').click(); const on2 = JSON.parse(localStorage.getItem('awx_se') || '{}').on;
  const toggleOk = on0 !== on1 && on2 === on0 && SE.on === on0 && SB.on !== undefined;
  const same = JSON.stringify(before) === JSON.stringify([localStorage.getItem('awx_sm'), localStorage.getItem('awx_sb')]);
  SE.eqs = [[now() - 7200e3, 1000], [now() - 3600e3, 985]]; drawRace();
  const d = RACE.ctx.getImageData(0, 0, RACE.W, RACE.H).data; let hits = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 0xa0 && d[i] < 0xc8 && d[i + 1] > 0x88 && d[i + 1] < 0xb0 && d[i + 2] > 0xe8) hits++;
  SE.eqs = []; document.querySelector('[data-smv="sm"]').click();
  return {tabs, errsE, label, toggleOk, same, hits};
});
console.log('btc/eth mode:', JSON.stringify(seRes));
if (seRes.errsE.length) errs.push('PAGEERR btc/eth-mode tab: ' + seRes.errsE.join('; '));
if (seRes.tabs.join() !== 'acct,set,log') errs.push('PAGEERR btc/eth-mode tabs are ' + seRes.tabs.join());
if (!seRes.label) errs.push('PAGEERR btc/eth-mode panel does not say SMC BTC/ETH');
if (!seRes.toggleOk) errs.push('PAGEERR btc/eth-mode toggle must flip awx_se.on');
if (!seRes.same) errs.push('PAGEERR awx_sm / awx_sb changed in the BTC/ETH view');
if (seRes.hits < 30) errs.push('PAGEERR race wall has no SMC BTC/ETH line/legend (' + seRes.hits + ' px)');
// SMC Pattern tab: shows SP's own account (not SE's), read-only tabs, no write to awx_sm / awx_se
const spRes = await page.evaluate(() => {
  openPanel('smc'); PS.tab.smc = 'acct'; setTabs(); renderPanel();
  const before = [localStorage.getItem('awx_sm'), localStorage.getItem('awx_se')], spPos = SP.pos, sePos = SE.pos;
  const btn = document.querySelector('[data-smv="sp"]'); if (!btn) return {btn: false};
  SP.pos = {ETHUSDT: {side: 'S', b: 'ETH', qty: 1, qty0: 1, entry: 100, stop: 102, stop0: 102, target: 95, rr: 2.5, t: now() - 3600e3, risk: 0.2, realized: 0, fees: 0, funding: 0, tf: '1h', why: 'sp-tab-marker', zoneKind: 'FVG', zone: {lo: 100, hi: 101, kind: 'FVG'}}}; SE.pos = {};
  btn.click(); const tabs = [...document.querySelectorAll('#pTabs [data-tab]')].map(e => e.dataset.tab), body = document.querySelector('#pbody').textContent;
  const out = {btn: true, tabs, label: /SMC Pattern \(v1\.4\)/.test(body), own: /ETH/.test(body) && /sp-tab-marker/.test(body), ttl: /1h pattern trigger/.test(document.querySelector('#pTtl small').textContent), same: JSON.stringify(before) === JSON.stringify([localStorage.getItem('awx_sm'), localStorage.getItem('awx_se')])};
  SP.pos = spPos; SE.pos = sePos; document.querySelector('[data-smv="sm"]').click(); return out;
});
console.log('pattern mode:', JSON.stringify(spRes));
if (!spRes.btn) errs.push('PAGEERR SMC panel has no SMC Pattern tab');
else {
  if (spRes.tabs.join() !== 'acct,set,log') errs.push('PAGEERR pattern-mode tabs are ' + spRes.tabs.join());
  if (!spRes.label || !spRes.ttl) errs.push('PAGEERR pattern-mode panel does not say SMC Pattern');
  if (!spRes.own) errs.push('PAGEERR SMC Pattern tab does not show SP own positions');
  if (!spRes.same) errs.push('PAGEERR awx_sm / awx_se changed in the Pattern view');
}
// SMC Big review path: an SB trade in the Big caps log -> Review chip -> chart + form -> save writes an sb| review; the review wall lists it; no learning change
const sbRev = await page.evaluate(async () => {
  const out = {errs: []}, smBefore = localStorage.getItem('awx_sm'), adjBefore = JSON.stringify([RV.smAdj, RV.smWhy, smRules()]);
  try {
    const s = [...S.meta.keys()][0], t1 = now() - 3600e3;
    SB.log = [{s, b: base(s), side: 'S', t0: t1 - 1800e3, t1, entry: 1, exit: 0.98, qty: 100, notional: 100, pnl: 2, R: 1, fees: 0, funding: 0, why: 'test', exitWhy: 'target', stop0: 1.02, maxR: 1.2, strat: 'smc', tf: '15m', htfBias: 'bear', rr: 2, target: 0.95}];
    openPanel('smc'); PS.tab.smc = 'log'; setTabs(); renderPanel(); document.querySelector('[data-smv="sb"]').click();
    const chip = document.querySelector('[data-sbrev]'); out.chip = !!chip; chip.click();
    await new Promise(r => setTimeout(r, 600));
    out.tab = PS.tab.rev; out.key = RVS.key; out.form = !!document.getElementById('mineForm'); out.canvas = !!document.querySelector('canvas[data-rvchart^="sb|"]');
    out.label = /SMC Big/.test(document.querySelector('#pbody').textContent);
    document.getElementById('mineNote').value = 'should have been a long. poor OB'; document.getElementById('mineNote').dispatchEvent(new Event('input', {bubbles: true}));
    document.querySelector('[data-mine="save"]').click(); await new Promise(r => setTimeout(r, 800));
    const k = Object.keys(RVM).find(k => k.startsWith('sb|')); out.saved = !!k; out.acct = k ? RVM[k].acct : null; out.onlySb = Object.keys(RVM).every(k => k.startsWith('sb|'));
    RWS.hold = false; RWS.i = 0; drawReviewWall(); out.wall = !!RWS.cur && RWS.cur[0] === 'sb';
    out.learnSame = adjBefore === JSON.stringify([RV.smAdj, RV.smWhy, smRules()]) && localStorage.getItem('awx_sm') === smBefore;
  } catch (e) { out.errs.push(e.message); }
  SB.log = []; document.querySelector('[data-smv="sm"]') && document.querySelector('[data-smv="sm"]').click();
  return out;
});
console.log('sb review path:', JSON.stringify(sbRev));
if (sbRev.errs.length) errs.push('PAGEERR sb review: ' + sbRev.errs.join('; '));
if (!(sbRev.chip && sbRev.tab === 'chart' && /^sb|/.test(sbRev.key || '') && sbRev.form && sbRev.canvas && sbRev.label)) errs.push('PAGEERR Big caps log -> review chart/form not reachable');
if (!(sbRev.saved && sbRev.acct === 'sb' && sbRev.onlySb)) errs.push('PAGEERR SB review not saved with sb key/acct');
if (!sbRev.wall) errs.push('PAGEERR review wall does not show the SB trade');
if (!sbRev.learnSame) errs.push('PAGEERR SB review changed SMC learning or awx_sm');
await page.evaluate(() => closePanel());
await page.evaluate(() => { openPanel('rev'); PS.tab.rev = 'smcr'; setTabs(); renderPanel(); }); await page.waitForTimeout(1500); await page.evaluate(() => renderPanel());
const bt = await page.evaluate(() => (document.body.innerText.match(/BACKTEST \(PROPOSAL ONLY, NOT APPLIED\)\s*\n[^\n]*/) || [''])[0]);
console.log('backtest block:', bt.replace(/\s*\n/g, ' | ') || 'MISSING'); if (!bt) errs.push('PAGEERR backtest block missing in Reviewer → SMC review');
const bb = await page.evaluate(() => (document.body.innerText.match(/BIG CAPS · BACKTEST \(PROPOSAL ONLY\)\s*\n[^\n]*/) || [''])[0]);
console.log('big backtest block:', bb.replace(/\s*\n/g, ' | ') || 'MISSING'); if (!bb) errs.push('PAGEERR big-cap backtest block missing in Reviewer → SMC review');
const by = await page.evaluate(async () => {
  const before = [localStorage.getItem('awx_sm'), localStorage.getItem('awx_sb'), JSON.stringify(RV.smAdj)];
  window.dispatchEvent(new KeyboardEvent('keydown', {key: '7'})); await new Promise(r => setTimeout(r, 1500)); renderPanel();
  const out = {open: PS.open, txt: {}};
  for (const t of ['sum', 'pat', 'tr']) { PS.tab.bt = t; setTabs(); renderPanel(); out.txt[t] = document.querySelector('#pbody').innerText; }
  const keep = BTS.year; BTS.year = null; PS.tab.bt = 'sum'; renderPanel(); out.empty = document.querySelector('#pbody').innerText; drawAllScreens(); BTS.year = keep;
  out.same = JSON.stringify(before) === JSON.stringify([localStorage.getItem('awx_sm'), localStorage.getItem('awx_sb'), JSON.stringify(RV.smAdj)]);
  return out; });
if (by.open !== 'bt') errs.push('PAGEERR key 7 does not open the Backtester');
if (!/Backtest — report only, never changes live rules/.test(by.txt.sum) || !/keeps it \(live setting better/.test(by.txt.sum) || !/live setting hurts \(switch better/.test(by.txt.sum) || !/skipped/i.test(by.txt.sum)) errs.push('PAGEERR Backtester summary/ablation missing');
if (!/raw run/i.test(by.txt.pat) || !/did not hold/i.test(by.txt.pat) || !/first 8 months/i.test(by.txt.pat)) errs.push('PAGEERR Backtester patterns missing run label or per-half numbers');
if (by.txt.tr.split(String.fromCharCode(10)).length < 4) errs.push('PAGEERR Backtester trades table empty');
if (!/no year backtest has run yet|Connect Sync/i.test(by.empty)) errs.push('PAGEERR Backtester has no empty-state message');
if (!by.same) errs.push('PAGEERR Backtester changed live state');
await page.evaluate(() => closePanel());
// review chart (Nov 16): timeframes, zoom, pan, OB / FVG / structure drawing, and what the Reviewer reads from the drawings
const ch = await page.evaluate(async () => {
  const out = {errs: []}, w = ms => new Promise(r => setTimeout(r, ms));
  try {
    const s = [...S.meta.keys()][0], t1 = now() - 2 * 3600e3, t0 = t1 - 3 * 3600e3;
    const q = (S.tk.get(s) || {}).last || 1; PT.log.unshift({s, b: base(s), side: 'L', t0, t1, entry: q, exit: q * 0.98, qty: 100, notional: 100, pnl: -2, R: -1, fees: 0, funding: 0, why: 'test', exitWhy: 'stop loss hit', stop0: q * 0.98, maxR: 0.2, strat: 'rev', tpR: 2});
    openPanel('rev'); PS.tab.rev = 'chart'; setTabs(); RVS.acct = 'pt'; RVS.key = tradeKey('pt', PT.log[0]); renderPanel(); await w(1500); renderPanel(); await w(300);
    const cv = () => document.querySelector('canvas[data-rvchart]');
    out.tfChips = document.querySelectorAll('[data-rvtf]').length;
    const v0 = RVV.t1 - RVV.t0; cv().dispatchEvent(new WheelEvent('wheel', {deltaY: -300, clientX: cv().getBoundingClientRect().left + 200, clientY: cv().getBoundingClientRect().top + 100, bubbles: true, cancelable: true})); await w(100);
    out.zoomIn = RVV.t1 - RVV.t0 < v0;
    document.querySelector('[data-rvtf="1h"]').click(); await w(1500); out.tf = RVV.tf;
    document.querySelector('[data-rvtf="15m"]').click(); await w(1500); renderPanel(); await w(200);
    document.querySelector('[data-mine="open"],[data-mineopen]') && document.querySelector('[data-mine="open"],[data-mineopen]').click();
    document.querySelector('[data-plan="on"]').click(); await w(200);
    const m = cv().__map, bar = m.bars[Math.floor(m.bars.length / 3)], r = cv().getBoundingClientRect();
    const at = (t, p) => ({clientX: r.left + m.X(t), clientY: r.top + m.Y(p), bubbles: true, cancelable: true, button: 0, pointerId: 1});
    const click = (t, p) => { cv().dispatchEvent(new PointerEvent('pointerdown', at(t, p))); cv().dispatchEvent(new PointerEvent('pointerup', at(t, p))); };
    document.querySelector('[data-plan-tool="ob"]').click(); await w(100); click(bar[0] + m.ms / 2, (bar[2] + bar[3]) / 2); await w(100);
    document.querySelector('[data-plan-tool="LH"]').click(); await w(100); click(m.bars[3][0] + m.ms / 2, m.bars[3][2]);
    document.querySelector('[data-plan-tool="LL"]').click(); await w(100); click(m.bars[8][0] + m.ms / 2, m.bars[8][3]);
    document.querySelector('[data-plan-tool="LH"]').click(); await w(100); click(m.bars[12][0] + m.ms / 2, m.bars[12][2]); await w(200);
    const P = MD.d && MD.d.plan; out.ob = !!(P && (P.zones || []).some(z => z.kind === 'OB' && z.dir)); out.pts = P ? (P.pts || []).length : 0;
    // the Reviewer's reading of structure drawn against a long
    const pp = planPoints({pts: [{t: t0 - 3 * 3600e3, p: q * 1.1, k: 'LH'}, {t: t0 - 2 * 3600e3, p: q * 0.9, k: 'LL'}, {t: t0 - 3600e3, p: q * 1.05, k: 'LH'}]}, PT.log[0]);
    out.reads = pp.b.includes('htf');
    const pz = planPoints({zones: [{t0: t0 - 3600e3, t1: t0, lo: q * 1.01, hi: q * 1.03, kind: 'OB', dir: 'bear'}]}, PT.log[0]); out.room = pz.b.includes('room');
    renderPanel(); await w(400);
  } catch (e) { out.errs.push(e.message + ' ' + (e.stack || '').split(String.fromCharCode(10))[1]); }
  return out;
});
console.log('review chart:', JSON.stringify(ch));
await page.screenshot({path: '/tmp/review-chart.png'});
if (ch.errs.length) errs.push('PAGEERR review chart: ' + ch.errs.join('; '));
if (!(ch.tfChips === 5 && ch.zoomIn && ch.tf === '1h')) errs.push('PAGEERR review chart timeframe / zoom');
if (!(ch.ob && ch.pts === 3)) errs.push('PAGEERR review chart drawing (OB / swing points)');
if (!(ch.reads && ch.room)) errs.push('PAGEERR Reviewer does not read drawn structure / opposing zone');
await page.evaluate(() => { PT.log.shift(); closePanel(); });
await page.screenshot({path: fileURLToPath(new URL('../desk-smoke.png', import.meta.url))});
// Nov 20: the race wall shows the SMC accounts only (no Trader; SMC Pattern joined Nov 22); the east wall shows SMC Big + SMC BTC/ETH open positions
const wl = await page.evaluate(() => {
  const out = {errs: []}, pos = s => { const e = ptPx(s) || 1, st = e * 1.02; return {side: 'S', b: base(s), qty: 10 / e, qty0: 10 / e, entry: e, stop: st, stop0: st, target: e * 0.95, rr: 2.5, t: now() - 3600e3, risk: 0.2, realized: 0, fees: 0, funding: 0, tf: '15m', why: 'smoke-test position', zoneKind: 'FVG', zone: {lo: e * 1.001, hi: e * 1.008, kind: 'FVG'}}; };
  try {
    SB.pos.ASTERUSDT = pos('ASTERUSDT'); SE.pos.BTCUSDT = pos('BTCUSDT'); SP.pos.ETHUSDT = pos('ETHUSDT');
    drawRace(); out.race = RACE.names;
    drawWall(); out.open = WALL.drawn;
  } catch (e) { out.errs.push(e.message + ' ' + (e.stack || '').split(String.fromCharCode(10))[1]); }
  return out;
});
console.log('walls:', JSON.stringify(wl));
if (wl.errs.length) errs.push('PAGEERR walls: ' + wl.errs.join('; '));
if ((wl.race || []).join() !== 'SMC TRADER,SMC BIG,SMC BTC/ETH,SMC PATTERN' || (wl.race || []).some(n => /^TRADER$/.test(n))) errs.push('PAGEERR race wall must list the 4 SMC accounts (SMC Pattern since Nov 22) and no Trader: ' + JSON.stringify(wl.race));
if (!(wl.open && wl.open.length === 3 && wl.open[0].title === 'SMC BIG · OPEN POSITIONS' && wl.open[1].title === 'SMC BTC/ETH · OPEN POSITIONS' && wl.open[2].title === 'SMC PATTERN · OPEN POSITIONS' && wl.open.every(x => x.shown >= 1))) errs.push('PAGEERR east wall must draw an SMC Big, an SMC BTC/ETH and an SMC Pattern position: ' + JSON.stringify(wl.open));
if (process.env.WALL_SHOTS) {   // optional: canvas dumps + in-room shots aimed at each wall
  const fs = await import('node:fs'), dir = process.env.WALL_SHOTS, save = (f, u) => fs.writeFileSync(dir + '/' + f, Buffer.from(u.split(',')[1], 'base64'));
  const cv = await page.evaluate(() => ({race: RACE.cv.toDataURL('image/png'), wall: WALL.cv.toDataURL('image/png')}));
  save('race-canvas.png', cv.race); save('east-canvas.png', cv.wall);
  await page.evaluate(() => { P.x = RACE_X; P.z = -RZ + 4.6; P.yaw = 0; P.pitch = 0.05; }); await page.waitForTimeout(1500); await page.screenshot({path: dir + '/race-wall-3d.png'});
  await page.evaluate(() => { P.x = RX - 8.5; P.z = WALL_Z; P.yaw = -Math.PI / 2; P.pitch = 0.05; }); await page.waitForTimeout(1500); await page.screenshot({path: dir + '/east-wall-3d.png'});
}
const flat = await page.evaluate(() => { delete SB.pos.ASTERUSDT; delete SE.pos.BTCUSDT; delete SP.pos.ETHUSDT; try { drawWall(); return WALL.drawn.map(x => x.shown).join(); } catch (e) { return 'ERR ' + e.message; } });
if (flat !== '0,0,0') errs.push('PAGEERR east wall flat state: ' + flat);
if (process.env.WALL_SHOTS) { const fs = await import('node:fs'); fs.writeFileSync(process.env.WALL_SHOTS + '/east-canvas-flat.png', Buffer.from((await page.evaluate(() => WALL.cv.toDataURL('image/png'))).split(',')[1], 'base64')); }
const bad = errs.filter(e => /PAGEERR/.test(e));
await browser.close();
if (bad.length) { console.error('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('PASS: no page errors (screenshot: desk-smoke.png)');
process.exit(0);   // Playwright's route/websocket handles can keep Node alive after browser.close() on Windows
