const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve('web-dist');
const server=http.createServer((req,res)=>{let f=path.join(root,decodeURIComponent(req.url.split('?')[0]));if(f.endsWith('/'))f+='index.html';try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}catch{res.writeHead(404);res.end();}});
async function db(page){return page.evaluate(()=>new Promise(r=>{const q=indexedDB.open('star-ledger-next-v1');q.onsuccess=()=>{const g=q.result.transaction('ledger').objectStore('ledger').get('main');g.onsuccess=()=>{q.result.close();r(g.result);};};}));}
const files=process.argv.slice(2);if(files.length!==2)throw Error('Pass local WeChat and Alipay XLSX paths; files are never copied to the repository');
(async()=>{await new Promise(r=>server.listen(4187,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});try{
 for(const order of [[0,1],[1,0]]){
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4187/#import');await page.locator('[data-action=import-file]').waitFor();
 for(const i of order){const before=Object.keys((await db(page)).importWorkspace?.sessions||{}).length,chooser=page.waitForEvent('filechooser');await page.locator('[data-action=import-file]').click();await(await chooser).setFiles(path.resolve(files[i]));await page.waitForFunction(n=>new Promise(r=>{const q=indexedDB.open('star-ledger-next-v1');q.onsuccess=()=>{const g=q.result.transaction('ledger').objectStore('ledger').get('main');g.onsuccess=()=>{const s=g.result;q.result.close();r(Object.keys(s.importWorkspace?.sessions||{}).length>n&&document.querySelectorAll('[data-import-session]').length>n);};};}),before,{timeout:60000});}
 let decisions=0;const counts={};
 for(let tries=0;tries<20;tries++){
 const s=await db(page),entries=Object.entries(s.importWorkspace.attention).flatMap(([sid,items])=>items.map(item=>({sid,item}))),candidate=entries.find(v=>['ACCOUNT','TRANSFER_ENDPOINTS'].includes(v.item.kind));if(!candidate)break;
 const {sid,item}=candidate,record=s.importWorkspace.records[sid].find(r=>r.id===item.externalRecordId);await page.locator(`[data-import-session="${sid}"] [data-v2-attention="${item.id}"]`).click();
 if(item.kind==='ACCOUNT'){
 const form=page.locator('#v2-account-form');await form.waitFor();if(/农业银行/.test(record.facts.channelRaw))await form.locator('[name=name]').fill('工资卡');await form.locator('[type=submit]').click();
 }else{const form=page.locator('#v2-transfer-form');await form.waitFor();await form.locator('[name=account]').selectOption('__new');await form.locator('[name=name]').fill(/花呗/.test(record.facts.targetChannelRaw||'')?'我的花呗':'到账账户');await form.locator('[type=submit]').click();}
 await page.locator('dialog').waitFor({state:'hidden'});decisions++;counts[item.kind]=(counts[item.kind]||0)+1;
 }
 const s=await db(page),{MemoryStore}=await import('../apps/web/src/store.ts'),store=new MemoryStore(s);
 assert.equal(store.entities.filter(e=>e.type==='transactions').length,326);assert.equal(store.entities.filter(e=>e.type==='transaction_links'&&!e.fields.deleted_at).length,28);assert.equal(Object.values(s.importWorkspace.attention).flat().filter(a=>['ACCOUNT','TRANSFER_ENDPOINTS'].includes(a.kind)).length,0);assert.deepEqual(errors,[]);
 const body=await page.locator('main').innerText();assert.equal(/无财务影响|失败跳过|必要问题|可稍后补充/.test(body),false);
 await page.reload();await page.locator('[data-action=import-file]').waitFor();assert.equal((await db(page)).ops.length,s.ops.length);
 await page.goto('http://127.0.0.1:4187/#accounts');await page.locator('.account-card').filter({hasText:'工资卡'}).click();assert.ok((await page.locator('dialog').innerText()).includes('农业银行'));await page.locator('#manage-account-alias').click();await page.locator('#account-alias-form [name=channel]').fill('农业银行储蓄卡 23C2');await page.locator('#account-alias-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#account-alias-form [type=submit]')||!document.querySelector('#account-alias-form [type=submit]').disabled);if(await page.locator('#account-alias-form').count())throw Error('Alias save: '+await page.locator('#toast').innerText());await page.locator('dialog').waitFor({state:'hidden'});const aliased=new MemoryStore(await db(page));assert.ok(aliased.entities.some(e=>e.type==='import_rules'&&JSON.parse(String(e.fields.value||'null'))?.identity?.channelKey==='农业银行储蓄卡 23C2'));
 console.log(JSON.stringify({order:order.map(i=>i===0?'微信':'支付宝'),accountDecisions:decisions,counts,remaining:Object.values(s.importWorkspace.attention).flat().map(a=>a.kind),posted:326,refundsLinked:28,consoleErrors:errors.length}));await ctx.close();
 }
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
