import type {Worker} from 'tesseract.js';
let ready:Worker|undefined,starting:Promise<Worker>|undefined,busy=false;
let report:(message:any)=>void=()=>{};
function start(){
 if(ready)return Promise.resolve(ready);
 if(!starting){const base=new URL('./ocr/',document.baseURI).href;const pending=import('tesseract.js').then(({createWorker})=>createWorker(['chi_sim','eng'],1,{workerPath:base+'worker.min.js',corePath:base+'core',langPath:base+'lang',cachePath:'star-ledger-ocr-best-int-v1',logger:message=>report(message)}));starting=pending;pending.then(worker=>{if(starting===pending){ready=worker;starting=undefined;}},()=>{if(starting===pending)starting=undefined;});}
 return starting;
}
/** Reuse the initialized worker; abort destroys it, and the next attempt starts fresh. */
export async function recognizeImage(file:File,signal:AbortSignal,onProgress:(message:any)=>void){
 if(busy)throw Error('OCR_BUSY');busy=true;report=onProgress;let cancelled=signal.aborted,worker:Worker|undefined;
 let rejectAbort:(reason:DOMException)=>void=()=>{};
 const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
 const stop=()=>{cancelled=true;rejectAbort(new DOMException('Cancelled','AbortError'));const old=ready,init=starting;ready=undefined;starting=undefined;if(old)void old.terminate();else if(init)void init.then(w=>w.terminate()).catch(()=>{});};
 signal.addEventListener('abort',stop,{once:true});
 try{if(cancelled)throw new DOMException('Cancelled','AbortError');worker=await Promise.race([start(),aborted]);if(cancelled)throw new DOMException('Cancelled','AbortError');const result=await Promise.race([worker.recognize(file),aborted]);if(cancelled)throw new DOMException('Cancelled','AbortError');return result.data.text;}
 catch(error){if(worker&&ready===worker){ready=undefined;void worker.terminate();}throw error;}
 finally{signal.removeEventListener('abort',stop);report=()=>{};busy=false;}
}
