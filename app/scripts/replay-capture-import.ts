/** K04 offline replay. Private raw responses stay local; no provider or network calls. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {extractCaptureImport} from '../packages/application/capture-import.ts';
export async function replayCaptureImport(truthPath:string,manifestPath:string,outPath:string){
 const truth=JSON.parse(await readFile(truthPath,'utf8')),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/capture/scenarios.json',import.meta.url),'utf8'));
 const cases=new Map<string,string>(truth.cases.map((c:{case:string;number:string})=>[c.case,c.number]));
 const results=[];const seen=new Set<string>();
 for(const entry of manifest.responses){
  const number=cases.get(entry.case),key=entry.case+'/'+entry.mode;
  if(!number||seen.has(key)||!['vision','ocr-text'].includes(entry.mode))throw Error('INVALID_REPLAY_MANIFEST');seen.add(key);
  const bytes=await readFile(resolve(entry.path));if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('FROZEN_RESPONSE_CHANGED');
  const wrapper=JSON.parse(bytes.toString());if(wrapper.case!==entry.case||wrapper.mode!==entry.mode||wrapper.result?.ok!==true)throw Error('INVALID_REPLAY_RESPONSE');
  const expected=fixture.cases.find((c:{id:string})=>c.id===number).expectedEvents.map((e:{kind:string;amountFen:number})=>({kind:e.kind,amountFen:e.amountFen}));
  try{
   // Platform provenance is supplied by the test harness, not scored as model inference.
   const sourceSystem=['09','10','11'].includes(number)?'ALIPAY':'WECHAT';
   const e=extractCaptureImport({raw:wrapper.result.raw,schemaVersion:'experiment-1',promptVersion:'experiment-1',model:'hy-vision-2.0-instruct',contentHash:'frozen-'+number,sourceSystem,profile:'本人',capturedAt:'2026-10-06T00:00:00Z',sessionId:'offline-'+number});
   const observed=e.interpretations.map(i=>({kind:i.eventKind,amountFen:i.amountFen}));
   results.push({case:number,mode:entry.mode,sourceSha256:entry.sha256,accepted:true,pageKind:e.evidence.pageKind,expected,observed,eventAmountMatch:JSON.stringify(expected)===JSON.stringify(observed),unknownStatus:e.interpretations.filter(i=>i.status==='UNKNOWN').length,missingTime:e.records.filter(r=>!r.facts.occurredAt).length,issues:e.issues});
  }catch(error){results.push({case:number,mode:entry.mode,sourceSha256:entry.sha256,accepted:false,error:error instanceof Error?error.message:String(error),expected});}
 }
 if(results.length!==30||truth.cases.some((c:{case:string})=>!seen.has(c.case+'/vision')||!seen.has(c.case+'/ocr-text')))throw Error('INCOMPLETE_REPLAY');
 const report={version:1,scope:'Event/amount interpretation only; supplied platform provenance. No full text, identifier accuracy, live page or accounting acceptance claim.',results};
 await writeFile(outPath,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 for(const mode of ['vision','ocr-text']){const group=results.filter(r=>r.mode===mode);console.log(JSON.stringify({mode,total:group.length,accepted:group.filter(r=>r.accepted).length,eventAmountMatch:group.filter(r=>r.eventAmountMatch).length,rows:group.map(r=>({case:r.case,accepted:r.accepted,eventAmountMatch:r.eventAmountMatch,error:r.error,unknownStatus:r.unknownStatus,missingTime:r.missingTime,issues:r.issues}))}));}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [truth,manifest,out]=process.argv.slice(2);if(!truth||!manifest||!out)throw Error('Usage: node scripts/replay-capture-import.ts PRIVATE_TRUTH PRIVATE_MANIFEST PRIVATE_OUT');
 await replayCaptureImport(truth,manifest,out);
}
