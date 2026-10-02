const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve('web-dist'),results=[];
const server=http.createServer((req,res)=>{const url=decodeURIComponent(req.url.split('?')[0]);let f=url.startsWith('/test-fonts/')?path.join(process.cwd(),'node_modules/@fontsource/noto-sans-sc',url.slice(12)):path.join(root,url);if(f.endsWith('/'))f+='index.html';try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}catch{res.writeHead(404);res.end();}});
async function font(page){if(!fs.existsSync('node_modules/@fontsource/noto-sans-sc/chinese-simplified-400.css'))return;await page.addStyleTag({content:fs.readFileSync('node_modules/@fontsource/noto-sans-sc/chinese-simplified-400.css','utf8').replaceAll('./files/','/test-fonts/files/')+'\n:root{font-family:"Noto Sans SC",sans-serif}'});await page.evaluate(()=>document.fonts.ready);}
const ok=s=>{results.push(s);console.log('PASS',s);};
async function db(page){return page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('star-ledger-next-v1');r.onsuccess=()=>{const q=r.result.transaction('ledger').objectStore('ledger').get('main');q.onsuccess=()=>{resolve(q.result);r.result.close();};};}));}
function entities(s,type){const m=new Map();for(const o of s.ops)if(o.entity.type===type){const old=m.get(o.entity.id)||{id:o.entity.id};m.set(o.entity.id,{...old,...o.entity.fields});}return [...m.values()];}
async function upload(page,name,text){
 const before=Object.keys((await db(page)).importWorkspace?.sessions||{});
 const chooser=page.waitForEvent('filechooser');await page.locator('[data-action=import-file]:visible').first().click();
 await(await chooser).setFiles({name,mimeType:'text/csv',buffer:Buffer.from(text)});
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){
  const state=await db(page),session=Object.values(state.importWorkspace?.sessions||{}).find(session=>!before.includes(session.id)&&['COMPLETED','NEEDS_ATTENTION'].includes(session.state)&&state.importWorkspace.outcomes[session.id]?.length===session.sourceCount);
  if(session){await page.locator(`[data-import-session="${session.id}"]`).waitFor();return session.id;}
  await page.waitForTimeout(50);
 }
 throw Error('IMPORT_SESSION_DID_NOT_COMPLETE');
}
async function answerAccount(page,sessionId,channel,name,existing){
 const panel=page.locator(`[data-import-session="${sessionId}"]`);await panel.locator('details').evaluate(e=>e.open=true);
 const state=await db(page),workspace=state.importWorkspace;
 const source=workspace.records[sessionId].find(r=>r.facts.channelRaw===channel);
 const item=workspace.attention[sessionId].find(a=>a.kind==='ACCOUNT'&&a.externalRecordId===source.id);
 await panel.locator(`[data-v2-attention="${item.id}"]`).click();
 if(existing)await page.locator('#v2-account-form [name=account]').selectOption(existing);
 else await page.locator('#v2-account-form [name=name]').fill(name);
 await page.locator('#v2-account-form [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
}
const wh='微信支付账单明细\n交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n';
const ah='支付宝交易记录\n交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号\n';
const wx=wh+'2026-09-20 12:00:00,商户消费,咖啡店,咖啡,支出,20,零钱,支付成功,wx1\n2026-09-20 13:00:00,商户消费,书店,书,支出,30,零钱,支付成功,wx2\n2026-09-20 14:00:00,商户消费,超市,水果,支出,40,农业银行储蓄卡(2372),支付成功,wx3\n';
const ali=ah+'2026-09-21 12:00:00,餐饮美食,商户,午餐,支出,10,农业银行储蓄卡(2372)&红包,交易成功,a1\n2026-09-21 13:00:00,医疗健康,药店,药品,不计收支,15,亲情卡(家人)&闪购红包,交易成功,a2\n2026-09-21 14:00:00,餐饮美食,商户,晚餐,支出,30,花呗,交易成功,a3\n2026-09-21 15:00:00,信用借还,花呗,花呗自动还款,不计收支,30,农业银行储蓄卡(2372),还款成功,a4\n2026-09-22 12:00:00,餐饮美食,商户,退款-午餐,不计收支,2,农业银行储蓄卡(2372),退款成功,a1*REFUND_1\n2026-09-22 13:00:00,餐饮美食,商户,退款-历史订单,不计收支,1,农业银行储蓄卡(2372),退款成功,missing_1\n2026-09-21 16:00:00,信用借还,花呗,花呗自动还款,不计收支,30,,还款失败,a5\n';
(async()=>{await new Promise(r=>server.listen(4173,'127.0.0.1',r));const browser=await chromium.launch({headless:true,args:['--no-sandbox']});let page;try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/New_York'});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4173/#import');await page.locator('[data-action=import-file]').waitFor();
 await page.locator('[data-page=accounts]:visible').first().click();await page.locator('[data-action=account]:visible').first().click();
 await page.locator('#account-form [name=name]').fill('旧卡');await page.locator('#account-form [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 const bank=entities(await db(page),'accounts')[0].id;
 await page.locator('[data-page=import]:visible').first().click();const wxSession=await upload(page,'wx.csv',wx);
 let s=await db(page);assert.equal(entities(s,'transactions').length,3);assert.equal(s.imports.length,0);
 assert.equal(entities(s,'transactions')[0].occurred_at,'2026-09-20T04:00:00.000Z');
 assert.equal(s.importWorkspace.sessions[wxSession].committedCount,3);assert.equal(s.importWorkspace.attention[wxSession].length,3);
 const originalSources=entities(s,'source_records'),originalEffects=entities(s,'consumption_effects');
 await answerAccount(page,wxSession,'零钱','日常零钱');await answerAccount(page,wxSession,'农业银行储蓄卡(2372)','',bank);
 s=await db(page);assert.equal(entities(s,'accounts').length,2);assert.equal(s.importWorkspace.attention[wxSession].length,0);
 assert.deepEqual(entities(s,'source_records'),originalSources);assert.deepEqual(entities(s,'consumption_effects'),originalEffects);
 assert.ok(entities(s,'balance_movements').every(m=>m.account_id));
 ok('Automatic import, Shanghai time, grouped create/bind and unchanged source/consumption');
 const nextSession=await upload(page,'wx-more.csv',wx.replaceAll('wx1','wx4').replaceAll('wx2','wx5').replaceAll('wx3','wx6'));
 s=await db(page);assert.equal(s.importWorkspace.attention[nextSession].length,0);assert.equal(entities(s,'accounts').length,2);assert.equal(entities(s,'transactions').length,6);
 ok('Next import remembers a renamed wallet and the bound bank without asking');
 const aliSession=await upload(page,'ali.csv',ali);s=await db(page);
 assert.equal(s.importWorkspace.sessions[aliSession].committedCount,6);assert.equal(s.importWorkspace.sessions[aliSession].noEffectCount,1);
 const sponsor=entities(s,'transactions').find(t=>t.display_name==='药店');assert.ok(sponsor);
 assert.equal(entities(s,'balance_movements').filter(m=>m.transaction_id===sponsor.id).length,0);
 assert.equal(entities(s,'consumption_effects').find(e=>e.transaction_id===sponsor.id).category_id,'医疗');
 await answerAccount(page,aliSession,'花呗','我的花呗');s=await db(page);
 const huabei=entities(s,'accounts').find(a=>a.name==='我的花呗');assert.equal(huabei.type,'LIABILITY');
 assert.equal(entities(s,'balance_movements').find(m=>m.account_id===huabei.id).amount,3000);
 ok('Sponsor, classification, failed orders and liability binding preserve financial semantics');
 const ops=s.ops.length;await page.reload();await page.locator('[data-action=import-file]').waitFor();
 const repeat=await upload(page,'ali.csv',ali);s=await db(page);assert.equal(s.ops.length,ops);assert.equal(s.importWorkspace.sessions[repeat].skippedDuplicateCount,6);
 assert.equal(s.importWorkspace.sessions[aliSession].committedCount,6);ok('Reload + repeat does not duplicate postings or rewrite earlier session outcomes');
 const split=wh+'2026-09-23 12:00:00,商户消费,组合商户,商品,支出,10,零钱 + 农业银行储蓄卡(2372),支付成功,split1\n';
 const splitSession=await upload(page,'split.csv',split);s=await db(page);
 assert.equal(s.importWorkspace.sessions[splitSession].committedCount,0);assert.equal(s.importWorkspace.attention[splitSession][0].kind,'SPLIT_PAYMENT');
 const evidence=s.importWorkspace.records[splitSession];await page.reload();await page.locator('[data-action=import-file]').waitFor();
 await upload(page,'later.csv',wx.replaceAll('wx1','wx7').replaceAll('wx2','wx8').replaceAll('wx3','wx9'));
 assert.equal(await page.locator(`[data-import-session="${splitSession}"] [data-v2-attention]`).count(),1);
 assert.deepEqual((await db(page)).importWorkspace.records[splitSession],evidence);ok('Blocked split source survives reload and remains accessible after newer imports');
 // A refund arriving after a separately committed original still uses strong relation evidence.
 const refund=ah+'2026-09-24 12:00:00,餐饮美食,商户,退款-午餐,不计收支,1,农业银行储蓄卡(2372),退款成功,a1*REFUND_2\n';
 await upload(page,'refund.csv',refund);assert.ok(entities(await db(page),'transaction_links').length>=1);ok('Strong refund relation to an existing original is automatic');
 const phone=await browser.newContext({viewport:{width:390,height:844}}),mobile=await phone.newPage();await mobile.goto('http://127.0.0.1:4173/#import');await mobile.locator('[data-action=import-file]').waitFor();
 const mobileSession=await upload(mobile,'wx.csv',wx);await answerAccount(mobile,mobileSession,'零钱','我的零钱');
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(entities(await db(mobile),'transactions').length,3);
 await mobile.screenshot({path:'/tmp/star-import-mobile.png',fullPage:true});await page.screenshot({path:'/tmp/star-import-desktop.png',fullPage:true});assert.deepEqual(errors,[]);ok('Mobile auto import and account answer fit viewport');
 const {MemoryStore,fresh}=await import('../apps/web/src/store.ts');const {BusinessAccountingService}=await import('../packages/accounting/business.ts');const {parseRows,csv}=await import('../apps/web/src/importer.ts');const {sourcePayload}=await import('../apps/web/src/import-workflow.ts');
 const legacyText=ah+'2026-09-21 15:00:00,信用借还,花呗,花呗自动还款,不计收支,30,农业银行储蓄卡(2372),还款成功,legacy-repay\n';
 const legacy=new MemoryStore(fresh()),service=new BusinessAccountingService(legacy,legacy.state.device);for(const [id,name,accountType]of [['bank','农业银行储蓄卡(2372)','ASSET'],['huabei','花呗','LIABILITY']])service.execute({kind:'CREATE_ACCOUNT',id,name,accountType,openingBalance:null,openingBalanceAt:'2026-09-01T00:00:00Z'});
 const draft={...parseRows(csv(legacyText))[0],kind:'PURCHASE',parserVersion:2,workflow:'committed',transactionId:'legacy',account:'bank'};
 const rawPayload=JSON.stringify(sourcePayload(draft));service.execute({kind:'PURCHASE',id:'legacy',name:'旧还款',note:'保留备注',amount:3000,payer:'bank',categoryId:'其他',occurredAt:'2026-09-21T07:00:00.000Z',source:{id:'legacy-source',sourceType:'EXCEL',platform:'支付宝',rawPayload}});legacy.state.imports=[{...parseRows(csv(legacyText))[0],workflow:'linked',transactionId:'legacy',account:'bank'}];
 const oldContext=await browser.newContext();const oldPage=await oldContext.newPage();await oldPage.goto('http://127.0.0.1:4173/#import');await oldPage.locator('[data-action=import-file]').waitFor();await oldPage.evaluate(state=>new Promise(resolve=>{const r=indexedDB.open('star-ledger-next-v1');r.onsuccess=()=>{const tx=r.result.transaction('ledger','readwrite');tx.objectStore('ledger').put(state,'main');tx.oncomplete=()=>{r.result.close();resolve();};};}),legacy.state);await oldPage.reload();await oldPage.locator('[data-action=import-file]').waitFor();
 assert.equal(entities(await db(oldPage),'transactions')[0].event_type,'PURCHASE');await oldPage.locator('#import-show').selectOption('linked');await oldPage.locator('[data-source-review]').click();await oldPage.locator('#source-change-form [type=submit]').click();await oldPage.locator('#confirm-form [type=submit]').click();await oldPage.locator('dialog').waitFor({state:'hidden'});
 const corrected=await db(oldPage);assert.equal(entities(corrected,'transactions').length,1);assert.equal(entities(corrected,'transactions')[0].event_type,'REPAYMENT');assert.equal(entities(corrected,'transactions')[0].note,'保留备注');assert.equal(entities(corrected,'consumption_effects')[0].amount,0);assert.equal(entities(corrected,'source_records').find(e=>e.id==='legacy-source').raw_payload,rawPayload);assert.equal(entities(corrected,'balance_movements').filter(e=>e.account_id==='bank').reduce((n,e)=>n+e.amount,0),-3000);ok('Legacy reimport previews and explicitly corrects purchase to repayment without duplicate debit or lost evidence');
 fs.writeFileSync('/tmp/star-import-v09-validation.json',JSON.stringify({results,errors},null,2));
 }catch(e){if(page){console.error('TOAST',await page.locator('#toast').textContent());console.error((await page.locator('main').innerText()).slice(-2000));}throw e;}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
