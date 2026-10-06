#!/usr/bin/env node
/** R03/C02 E02: offline inventory only. No provider calls or accounting writes. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const compact=value=>String(value??'').replace(/\s+/gu,'');
function timeValue(value){
 const m=String(value??'').match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?[ T]?(\d{1,2}):(\d{2})(?::(\d{2}))?/u);
 return m?m.slice(1).map((x,i)=>x===undefined?'':i===0?x:x.padStart(2,'0')).join('|'):null;
}
export function auditResponse(raw,truth){
 let parsed;try{parsed=JSON.parse(raw);}catch{return {strictJson:false,fields:null,identifiers:null};}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {strictJson:false,fields:null,identifiers:null};
 const e=parsed.evidence;
 if(!e||typeof e!=='object'||Array.isArray(e))return {strictJson:true,evidenceShape:false,fields:null,identifiers:null};
 // Search ONLY evidence, never candidates: an inferred candidate is not a read fact.
 const text=compact(JSON.stringify(e));
 const tokens=new Set((JSON.stringify(e).match(/[A-Za-z0-9]{12,}/gu)||[]));
 const fieldValues=Array.isArray(e.fields)?e.fields:[];
 const times=Array.isArray(e.times)?e.times:[];
 const aliases={title:['title'],amount:['displayAmount'],principal:['提现金额'],fee:['服务费'],status:['status'],history:['history']};
 const fields=truth.visibleFields.map(f=>{
  const isTime=f.role.includes('时间');
  const values=fieldValues.filter(v=>v?.label===f.role||aliases[f.role]?.includes(v?.label)).map(v=>v.value);
  for(const name of aliases[f.role]||[])if(name in e)values.push(e[name]);
  values.push(...times.filter(v=>v?.role===f.role).map(v=>v.value));
  const same=v=>isTime?timeValue(v)!==null&&timeValue(v)===timeValue(f.value):compact(v)===compact(f.value);
  return {role:f.role,valueFoundSomewhere:isTime?times.some(v=>same(v?.value))||fieldValues.some(v=>same(v?.value)):text.includes(compact(f.value)),exactNamedField:values.some(same)};
 });
 const identifiers=truth.identifiers.map(f=>({role:f.role,exactToken:tokens.has(f.value)}));
 return {strictJson:true,evidenceShape:true,fields,identifiers,candidateCount:Array.isArray(parsed.candidates)?parsed.candidates.length:null};
}
export async function runAudit({truthPath,manifestPath,outPath}){
 const truthBytes=await readFile(truthPath);const truth=JSON.parse(truthBytes);
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 if(!Array.isArray(truth.cases)||truth.cases.length!==15||new Set(truth.cases.map(c=>c.case)).size!==15)throw Error('INVALID_TRUTH_CASES');
 const index=new Map(truth.cases.map(c=>[c.case,c]));const seen=new Set();const results=[];
 for(const entry of manifest.responses){
  const key=`${entry.case}/${entry.mode}`;if(seen.has(key)||!index.has(entry.case)||!['vision','ocr-text'].includes(entry.mode))throw Error('INVALID_MANIFEST_CASE');seen.add(key);
  const bytes=await readFile(resolve(entry.path));if(digest(bytes)!==entry.sha256)throw Error('FROZEN_RESPONSE_CHANGED');
  const wrapper=JSON.parse(bytes);if(wrapper.case!==entry.case||wrapper.mode!==entry.mode||wrapper.result?.ok!==true)throw Error('MANIFEST_RESPONSE_MISMATCH');
  results.push({case:index.get(entry.case).number,mode:entry.mode,sourceSha256:entry.sha256,...auditResponse(wrapper.result.raw,index.get(entry.case))});
 }
 if(results.length!==30||truth.cases.some(c=>!seen.has(`${c.case}/vision`)||!seen.has(`${c.case}/ocr-text`)))throw Error('INCOMPLETE_RESPONSE_PAIRS');
 const report={version:1,truthSha256:digest(truthBytes),meaning:'Observed coverage, not overall accuracy. Exact named field does not validate money/event semantics; invalid JSON is unscored, not repaired.',results};
 await writeFile(outPath,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 for(const mode of ['vision','ocr-text']){
  const rows=results.filter(r=>r.mode===mode);const ids=rows.flatMap(r=>r.identifiers||[]);const fields=rows.flatMap(r=>r.fields||[]);
  console.log(JSON.stringify({mode,responses:rows.length,strictJson:rows.filter(r=>r.strictJson).length,identifierExactToken:ids.filter(i=>i.exactToken).length,identifierScored:ids.length,identifierAnnotated:truth.cases.reduce((n,c)=>n+c.identifiers.length,0),namedFieldExact:fields.filter(f=>f.exactNamedField).length,fieldScored:fields.length,fieldAnnotated:truth.cases.reduce((n,c)=>n+c.visibleFields.length,0)}));
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [truthPath,manifestPath,outPath]=process.argv.slice(2);
 if(!truthPath||!manifestPath||!outPath){console.error('Usage: node scripts/audit-capture-evidence.mjs PRIVATE_TRUTH PRIVATE_MANIFEST PRIVATE_OUT (run from app parent)');process.exitCode=1;}
 else runAudit({truthPath,manifestPath,outPath}).catch(e=>{console.error(e.message);process.exitCode=1;});
}
