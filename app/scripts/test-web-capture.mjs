/** Real Chromium UI + IndexedDB + capture handler; only identity, PG and model transport are synthetic. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import * as shared from '../cloudbase/capture-src/shared.ts';
const require=createRequire(import.meta.url),{createHandler}=require('../cloudbase/functions/star-ledger-capture/handler.cjs');
const uid='synthetic-browser-s1',tasks=new Map(),results=new Map();
let modelCalls=0,scenario='normal',releaseModel;
const repo={
 async create(task){if(tasks.has(task.id))return false;tasks.set(task.id,structuredClone(task));return true;},
 async get(scope,id){const t=tasks.get(id);return t&&t.userId===scope.userId&&t.ledgerId===scope.ledgerId?structuredClone(t):null;},
 async replace(scope,id,version,next){const t=tasks.get(id);if(!t||t.userId!==scope.userId||t.ledgerId!==scope.ledgerId||t.version!==version)return false;tasks.set(id,structuredClone(next));return true;},
 async publish(scope,id,version,next,evidence){if(!await this.replace(scope,id,version,next))return false;results.set(evidence.id,structuredClone(evidence));return true;},
 async result(_scope,_id,resultId){return structuredClone(results.get(resultId)??null);}
};
const handler=createHandler({repo,shared,getUid:async()=>uid,key:'synthetic-only',allowedUids:new Set([uid]),fetchImpl:async()=>{
 modelCalls++;const mode=scenario;
 if(mode==='hold')await new Promise(resolve=>{releaseModel=resolve;});
 const raw=JSON.stringify({evidence:{platform:'微信',displayAmount:'10.00',status:'支付成功',merchant:'合成咖啡店',paymentMethod:'微信零钱',fields:[],identifiers:[{role:'交易单号',value:'SYNTHETIC-'+mode,visible:true}],times:[],moneyLines:[{role:'支出',amount:mode==='missing'?null:'10.00',time:mode==='missing'?null:'2026-10-06 12:00:00',status:'支付成功'}],uncertain:[]},candidates:[]});
 return {ok:true,json:async()=>({choices:[{message:{content:raw},finish_reason:'stop'}],usage:{total_tokens:42}})};
}});
const fixture=`
export const cloudbaseConfig={env:'synthetic',region:'ap-shanghai'};
export const cloudIdentityStorageKey='star-ledger:cloudbase-identity';
export const localCloudIdentity=()=>JSON.parse(localStorage.getItem(cloudIdentityStorageKey)||'null');
export const rememberCloudIdentity=value=>value?localStorage.setItem(cloudIdentityStorageKey,JSON.stringify(value)):localStorage.removeItem(cloudIdentityStorageKey);
export const cloudbaseSession=async()=>({uid:'${uid}',username:'合成测试账号'});
export const cloudbaseSignIn=cloudbaseSession;
export const cloudbaseSignOut=async()=>{};
export const cloudbaseClient=async()=>({callFunction:async({name,data})=>{if(name!=='star-ledger-capture')throw Error('UNEXPECTED_TEST_NETWORK');return {result:await fetch('/__capture_fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}).then(r=>r.json())};}});
`;
const server=await createServer({configFile:false,root:'apps/web',server:{host:'127.0.0.1',port:0},plugins:[{
 name:'capture-browser-fixture',enforce:'pre',
 resolveId(id,importer){if(id==='./cloudbase.ts'&&importer?.includes('/apps/web/src/'))return '\0capture-browser-fixture';},
 load(id){if(id==='\0capture-browser-fixture')return fixture;},
 configureServer(server){server.middlewares.use('/__capture_fixture',(req,res)=>{let text='';req.on('data',chunk=>{text+=chunk;});req.on('end',()=>{void handler(JSON.parse(text)).then(result=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(result));}).catch(error=>{res.statusCode=500;res.end(JSON.stringify({error:error.message}));});});});}
}]});
let browser;
const log=s=>console.log('PASS',s);
async function state(page){return page.evaluate(uid=>new Promise((resolve,reject)=>{const open=indexedDB.open('star-ledger-next-v1');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,r=db.transaction('ledger').objectStore('ledger').get('cloudbase:'+encodeURIComponent(uid));r.onsuccess=()=>{resolve(r.result);db.close();};};}),uid);}
async function waitJob(page,expected){await page.waitForFunction(({uid,expected})=>new Promise(resolve=>{const r=indexedDB.open('star-ledger-next-v1');r.onsuccess=()=>{const db=r.result,q=db.transaction('ledger').objectStore('ledger').get('cloudbase:'+encodeURIComponent(uid));q.onsuccess=()=>{resolve(Object.values(q.result?.captureJobs??{}).some(j=>j.state===expected));db.close();};};}),{uid,expected},{timeout:20000});}
async function select(page,suffix){await page.locator('[data-action=capture]:visible').first().click();await page.locator('#capture-select').waitFor();
 // A tiny synthetic PNG, no personal image or real model request.
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pAAAAABJRU5ErkJggg==','base64');
 await page.locator('#capture-select [name=image]').setInputFiles({name:`synthetic-${suffix}.png`,mimeType:'image/png',buffer:Buffer.concat([png,Buffer.from(suffix)])});
 await page.locator('#capture-select [type=submit]').click();await page.locator('#capture-select').waitFor({state:'detached'});
}
try{
 await server.listen();const address=server.httpServer.address(),base=`http://127.0.0.1:${address.port}`;
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>route.abort());
 await page.goto(base);await page.locator('[data-action=capture]:visible').first().waitFor();
 await select(page,'normal');await waitJob(page,'COMPLETED');await page.locator('[data-capture-job] [data-detail]').first().waitFor();
 let current=await state(page),job=Object.values(current.captureJobs)[0];assert.equal(job.summary.created,1);assert.equal(job.image,undefined);assert.equal(modelCalls,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);log('390px screenshot upload → handler → shared import → IndexedDB receipt');
 await page.locator('[data-capture-job] [data-detail]').first().click();await page.locator('#detail-form [name=category]').selectOption('学习');await page.locator('#detail-form [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.reload();await page.locator('[data-capture-job] [data-detail]').first().click();assert.equal(await page.locator('#detail-form [name=category]').inputValue(),'学习');await page.locator('[data-close]').click();log('edit classification and reload preserve the user change');
 await select(page,'normal');await page.locator('[data-capture-job] [data-detail]').first().waitFor();current=await state(page);assert.equal(Object.keys(current.captureJobs).length,1);assert.equal(modelCalls,1);log('same image does not call model or create a second job');
 scenario='missing';await select(page,'missing');await waitJob(page,'NEEDS_INPUT');await page.locator('[data-capture-supplement]').click();await page.locator('#capture-supplement input[inputmode=decimal]').fill('10.00');await page.locator('#capture-supplement input[type=datetime-local]').fill('2026-10-06T12:00');await page.locator('#capture-supplement [type=submit]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.waitForFunction(uid=>new Promise(resolve=>{const r=indexedDB.open('star-ledger-next-v1');r.onsuccess=()=>{const db=r.result,q=db.transaction('ledger').objectStore('ledger').get('cloudbase:'+uid);q.onsuccess=()=>{resolve(Object.values(q.result.captureJobs).filter(j=>j.state==='COMPLETED').length===2);db.close();};};}),uid);assert.equal(modelCalls,2);log('missing amount/date can be supplied through the actual page without another model call');
 scenario='hold';await select(page,'cancel');await page.waitForFunction(()=>document.querySelector('[data-capture-job]')?.textContent.includes('正在识别'));
 const deadline=Date.now()+5000;while(!releaseModel&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(typeof releaseModel,'function');
 page.once('dialog',dialog=>dialog.accept());await page.locator('[data-capture-job]').first().locator('[data-capture-abandon]').click();await waitJob(page,'CANCELLED');releaseModel();
 await page.waitForTimeout(300);current=await state(page);assert.equal(Object.values(current.captureJobs).filter(j=>j.state==='COMPLETED').length,2);assert.equal([...results.values()].length,2);log('cancelled request cannot commit its late response');
 assert.deepEqual(errors,[]);log('no browser runtime errors');
}finally{releaseModel?.();await browser?.close();await server.close();}
