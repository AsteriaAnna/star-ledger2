import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,cpSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';

const app=process.cwd(),repo=resolve(app,'..');
const release=JSON.parse(readFileSync(join(app,'docs/development-preview.json'),'utf8'));
if(!/^[a-f0-9]{40}$/.test(release.sourceCommit)||!/^m5-\d{8}$/.test(release.slug))throw Error('INVALID_PREVIEW_RELEASE');
const temporary=mkdtempSync(join(tmpdir(),'star-ledger-preview-'));
try{
 try{execFileSync('git',['cat-file','-e',`${release.sourceCommit}^{commit}`],{cwd:repo,stdio:'pipe'});}
 catch{execFileSync('git',['fetch','--no-tags','--depth=1','origin',release.sourceCommit],{cwd:repo,stdio:'inherit'});}
 const archive=execFileSync('git',['archive',release.sourceCommit,'app'],{cwd:repo,maxBuffer:32*1024*1024});
 execFileSync('tar',['-x','-C',temporary],{input:archive});
 const source=join(temporary,'app');
 if(readFileSync(join(source,'package-lock.json'),'utf8')!==readFileSync(join(app,'package-lock.json'),'utf8'))throw Error('PREVIEW_DEPENDENCIES_CHANGED');
 symlinkSync(join(app,'node_modules'),join(source,'node_modules'),'dir');
 const dbName=`star-ledger-preview-${release.slug}`,cachePrefix=`star-ledger-preview-${release.slug}-`;
 const store=join(source,'apps/web/src/store.ts'),storeText=readFileSync(store,'utf8');
 if(storeText.split("'star-ledger-next-v1'").length!==2)throw Error('PREVIEW_STORAGE_BOUNDARY_CHANGED');
 writeFileSync(store,storeText.replace("'star-ledger-next-v1'",JSON.stringify(dbName)));
 const sw=join(source,'scripts/build-web-sw.mjs'),swText=readFileSync(sw,'utf8');
 if(!swText.includes('star-ledger-next-'))throw Error('PREVIEW_CACHE_BOUNDARY_CHANGED');
 writeFileSync(sw,swText.replaceAll('star-ledger-next-',cachePrefix));
 execFileSync(process.execPath,[join(app,'node_modules/vite/bin/vite.js'),'build','--config','apps/web/vite.config.ts'],{cwd:source,stdio:'inherit'});
 const index=join(source,'web-dist/index.html');
 const notice=`<aside id="development-preview" style="position:relative;z-index:2;padding:10px 20px;background:#203c32;color:#e2f1e9;font:14px/1.6 system-ui;text-align:center">开发预览 · ${release.date} · ${release.sourceCommit.slice(0,7)} · 独立体验账本　<a href="#settings" style="color:#c7e9b3">设置中可体验演示账本</a></aside>`;
 writeFileSync(index,readFileSync(index,'utf8').replace('<title>星账 · 个人账本</title>','<title>星账 · M5 开发预览</title>').replace('<body>','<body>'+notice));
 execFileSync(process.execPath,['scripts/build-web-sw.mjs'],{cwd:source,stdio:'inherit'});
 const output=join(app,'web-dist/preview',release.slug);mkdirSync(output,{recursive:true});cpSync(join(source,'web-dist'),output,{recursive:true});
 writeFileSync(join(output,'version.json'),JSON.stringify({...release,storage:dbName,cachePrefix},null,2));
 if(!existsSync(join(output,'index.html'))||readFileSync(join(output,'sw.js'),'utf8').includes('star-ledger-next-'))throw Error('PREVIEW_OUTPUT_INVALID');
 console.log(`Development preview: /preview/${release.slug}/ (${release.sourceCommit.slice(0,7)})`);
}finally{rmSync(temporary,{recursive:true,force:true});}
