import {build} from 'esbuild';
await build({entryPoints:['cloudbase/capture-src/shared.ts'],bundle:true,platform:'node',target:'node20',format:'cjs',outfile:'cloudbase/functions/star-ledger-capture/shared.cjs'});
console.log('Capture service shared.cjs ready');
