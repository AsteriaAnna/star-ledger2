import {readdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const assets=readdirSync('web-dist/assets').filter(f=>!f.endsWith('.map')).map(f=>'./assets/'+f);
const files=['./','./index.html','./icon.svg','./manifest.webmanifest',...assets];
const ocr=JSON.parse(readFileSync('web-dist/ocr/manifest.json','utf8'));
const version=createHash('sha256').update(files.join(',')).update(ocr.version).digest('hex').slice(0,12);
writeFileSync('web-dist/sw.js',`const CACHE='star-ledger-next-${version}';const OCR_CACHE='star-ledger-ocr-${ocr.version}';const ROOT=new URL('./',self.location).href;const FILES=${JSON.stringify(files)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('star-ledger-next-')&&k!==CACHE)||(k.startsWith('star-ledger-ocr-')&&k!==OCR_CACHE)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!u.href.startsWith(ROOT))return;if(u.href.startsWith(new URL('./ocr/',ROOT).href)){e.respondWith(caches.open(OCR_CACHE).then(async c=>{const cached=await c.match(e.request);if(cached)return cached;const response=await fetch(e.request);if(response.ok)await c.put(e.request,response.clone());return response;}));return;}if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match(new URL('./index.html',ROOT))));return;}e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});`);
writeFileSync('web-dist/.nojekyll','');
console.log('Offline shell generated:',files.length,'files');

writeFileSync('web-dist/THIRD-PARTY-NOTICES.txt',readFileSync('docs/THIRD-PARTY-NOTICES.txt'));
