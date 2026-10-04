// Actual OCR assets and service worker; no CDN mocks or private screenshot fixtures.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve('web-dist');
const server=http.createServer((req,res)=>{let file=path.join(root,decodeURIComponent(req.url.split('?')[0]));if(file.endsWith('/'))file+='index.html';try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage'],headless:true});
 try{
  const context=await browser.newContext({viewport:{width:480,height:760},timezoneId:'Asia/Shanghai'});
  const drawing=await context.newPage();
  async function image(amount){await drawing.setContent(`<body style="background:white;color:black;padding:32px;font:26px Arial"><h2>Payment</h2><h1 style="font-size:64px">${amount}</h1><p>2026-09-20 12:00:00</p></body>`);return drawing.screenshot();}
  const first=await image('44.00'),second=await image('55.00');await drawing.close();
  const requests=[],errors=[];context.on('request',r=>requests.push(r.url()));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('.hero-value').waitFor();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  async function choose(buffer){const chooser=page.waitForEvent('filechooser');await page.locator('[data-action=capture]').first().click();await(await chooser).setFiles({name:'synthetic-payment.png',mimeType:'image/png',buffer});}
  async function recognize(buffer,amount){const start=Date.now();await choose(buffer);await page.locator('#record-form').waitFor({timeout:90000});assert.equal(await page.locator('#record-form [name=amount]').inputValue(),amount);assert.match(await page.locator('#record-form [name=date]').inputValue(),/2026-09-20/);await page.locator('dialog [data-close]').first().click();return Date.now()-start;}
  const cold=await recognize(first,'44.00');
  const ocrRequests=requests.filter(u=>u.includes('/ocr/'));assert(ocrRequests.length>=4);assert(ocrRequests.every(u=>u.startsWith(origin+'/ocr/')));assert(!requests.some(u=>/jsdelivr|projectnaptha/.test(u)));
  const before=requests.filter(u=>u.includes('/ocr/')).length;
  const warm=await recognize(second,'55.00');assert.equal(requests.filter(u=>u.includes('/ocr/')).length,before);
  const cached=await page.evaluate(async()=>{const names=(await caches.keys()).filter(k=>k.startsWith('star-ledger-ocr-'));return(await Promise.all(names.map(async k=>(await(await caches.open(k)).keys()).map(r=>new URL(r.url).pathname)))).flat();});
  assert(cached.some(u=>u.endsWith('worker.min.js')));assert(cached.some(u=>u.includes('/core/')));assert(cached.some(u=>u.endsWith('chi_sim.traineddata.gz')));assert(cached.some(u=>u.endsWith('eng.traineddata.gz')));
  await context.setOffline(true);await page.reload();await page.locator('[data-action=capture]').first().waitFor();const offline=await recognize(second,'55.00');
  await choose(first);await page.locator('dialog [data-close]').first().click();await recognize(second,'55.00');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',coldMs:cold,warmMs:warm,offlineReloadMs:offline,cachedAssets:cached,checks:['same-origin engine and models','worker reuse','offline page reload and OCR','cancel then retry'],scope:'Synthetic English amount/date; real Chinese payment screenshots and phones not measured'},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
