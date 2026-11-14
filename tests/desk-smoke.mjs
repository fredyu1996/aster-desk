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
await page.route('https://api.github.com/**',r=>{const u=r.request().url();
 if(u.includes('/git/ref/heads/backtest'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({object:{sha:'bt1'}})});
 if(u.includes('/contents/smc-backtest.json'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(btFake)});
 if(u.includes('/contents/smc-backtest-big.json'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(btBig)});
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
  if(n%3===0)ws.send(JSON.stringify({stream:'idolusdt@aggTrade',data:{e:'aggTrade',s:'IDOLUSDT',p:'0.03',q:String(4e6+n*1e5),m:n%2===0,T:Date.now()}}));
  if(n%4===0)ws.send(JSON.stringify({stream:'!forceOrder@arr',data:{e:'forceOrder',o:{s:'AKEUSDT',S:'SELL',q:'900000',p:'0.05',ap:'0.05',z:'900000',T:Date.now()}}}));
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
await page.evaluate(() => { openPanel('rev'); PS.tab.rev = 'smcr'; setTabs(); renderPanel(); }); await page.waitForTimeout(1500); await page.evaluate(() => renderPanel());
const bt = await page.evaluate(() => (document.body.innerText.match(/BACKTEST \(PROPOSAL ONLY, NOT APPLIED\)\s*\n[^\n]*/) || [''])[0]);
console.log('backtest block:', bt.replace(/\s*\n/g, ' | ') || 'MISSING'); if (!bt) errs.push('PAGEERR backtest block missing in Reviewer → SMC review');
const bb = await page.evaluate(() => (document.body.innerText.match(/BIG CAPS · BACKTEST \(PROPOSAL ONLY\)\s*\n[^\n]*/) || [''])[0]);
console.log('big backtest block:', bb.replace(/\s*\n/g, ' | ') || 'MISSING'); if (!bb) errs.push('PAGEERR big-cap backtest block missing in Reviewer → SMC review');
await page.evaluate(() => closePanel());
await page.screenshot({path: fileURLToPath(new URL('../desk-smoke.png', import.meta.url))});
const bad = errs.filter(e => /PAGEERR/.test(e));
await browser.close();
if (bad.length) { console.error('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('PASS: no page errors (screenshot: desk-smoke.png)');
process.exit(0);   // Playwright's route/websocket handles can keep Node alive after browser.close() on Windows
