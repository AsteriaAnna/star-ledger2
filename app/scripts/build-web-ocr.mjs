import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='web-dist/ocr',files=[];
function copy(source,target){mkdirSync(`${root}/${target.split('/').slice(0,-1).join('/')}`,{recursive:true});copyFileSync(source,`${root}/${target}`);const content=readFileSync(source);files.push({path:target,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')});}
copy('node_modules/tesseract.js/dist/worker.min.js','worker.min.js');
for(const name of ['tesseract-core','tesseract-core-simd','tesseract-core-lstm','tesseract-core-simd-lstm'])for(const suffix of ['.wasm.js','.wasm'])copy(`node_modules/tesseract.js-core/${name}${suffix}`,`core/${name}${suffix}`);
for(const lang of ['chi_sim','eng'])copy(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,`lang/${lang}.traineddata.gz`);
const version=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,12);
writeFileSync(`${root}/manifest.json`,JSON.stringify({version,engine:'6.0.1',core:'6.1.2',languages:'1.0.0/4.0.0_best_int',files},null,2));
console.log('Same-origin OCR assets:',files.length,'files,',Math.round(files.reduce((sum,f)=>sum+f.bytes,0)/1024/1024),'MiB; downloaded on use');
