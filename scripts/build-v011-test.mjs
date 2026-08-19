import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=resolve(fileURLToPath(new URL('..', import.meta.url)));
const verify=spawnSync(process.execPath,['scripts/verify.mjs'],{cwd:ROOT,stdio:'inherit'});
if(verify.status!==0) process.exit(verify.status??1);
const out=join(ROOT,'dist','v0.11.1-source-foundation');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
for(const item of ['app','core','apps','packages','docs','tests','server.mjs','VERSION','package.json','package-lock.json']){
  await cp(join(ROOT,item),join(out,item),{recursive:true});
}
await writeFile(join(out,'BUILD-MANIFEST.json'),JSON.stringify({version:(await readFile(join(ROOT,'VERSION'),'utf8')).trim(),class:'SOURCE_FOUNDATION',nativeAudioMilestone:'0.12-source-present-unverified-in-this-environment'},null,2)+'\n');
console.log(`source foundation staged: ${out}`);
