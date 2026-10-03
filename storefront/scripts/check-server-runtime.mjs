import {mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const out=mkdtempSync(join(root,'.server-runtime-'));
try {
  execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'--project',join(root,'tsconfig.server.json'),'--outDir',out],{cwd:root,stdio:'inherit'});
  execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(join(out,'api/[...path].js')).href)});`],{cwd:root,stdio:'inherit'});
  console.log('Compiled server entry point loads in native Node ESM.');
} finally {
  rmSync(out,{recursive:true,force:true});
}
