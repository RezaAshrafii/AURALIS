import { spawnSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=resolve(fileURLToPath(new URL('..', import.meta.url)));
const required=[
  'server.mjs','VERSION','core/persian-router.mjs','core/answer-schema.mjs','core/turn-policy.mjs','core/speech-engine.mjs','core/vad-state.mjs',
  'app/app-react.js','app/styles.css','apps/web/tsconfig.json','packages/contracts/src/index.ts',
  'native/core/src/audio/wasapi.rs','native/core/src/audio/spool.rs','native/core/src/audio/recovery.rs','native/core/src/asr/mod.rs','native/core/src/vad/mod.rs','native/core/src/storage/migrations/0006_speech_engine.sql'
];
for(const f of required) await access(join(ROOT,f));
const version=(await readFile(join(ROOT,'VERSION'),'utf8')).trim();
const pkg=JSON.parse(await readFile(join(ROOT,'package.json'),'utf8'));
if(pkg.version!==version) throw new Error(`VERSION/package mismatch: ${version} vs ${pkg.version}`);
const server=await readFile(join(ROOT,'server.mjs'),'utf8');
if(!server.includes(version)) throw new Error(`server does not advertise ${version}`);
const commands=[
  ['node',['--check','server.mjs']],
  ['node',['--check','app/app-react.js']],
  ['node',['--check','app/ui-kit.js']],
  ['node',['--check','core/speech-engine.mjs']],
  ['node',['--check','core/vad-state.mjs']],
  ['node',['--test','tests/*.test.mjs']],
  ['tsc',['--project','apps/web/tsconfig.json','--noEmit']],
  ['node',['scripts/build-web.mjs']],
];
for(const [cmd,args] of commands){
  const result=spawnSync(cmd,args,{cwd:ROOT,stdio:'inherit',shell:process.platform==='win32'});
  if(result.status!==0) process.exit(result.status??1);
}
console.log('AURALIS_VERIFY_PASS');
