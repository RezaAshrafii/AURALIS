import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCitationBenchmark } from '../core/citation-benchmark.mjs';
import { buildQueryPlan, rankCandidates } from '../core/rag-engine.mjs';

const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture=JSON.parse(await readFile(resolve(ROOT,'test-data/V014_CITATION_BENCHMARK.json'),'utf8'));
const citation=runCitationBenchmark(fixture.cases,fixture.thresholds);

const retrievalPlan=buildQueryPlan('تفاوت واریانس و انحراف معیار');
const retrieval=rankCandidates([
  {chunk_id:'weak',document_id:'a',title:'آمار',text_raw:'تعریف واریانس',ftsRank:0},
  {chunk_id:'strong',document_id:'b',title:'پراکندگی',text_raw:'تفاوت واریانس و انحراف معیار به واحد اندازه‌گیری مربوط است',ftsRank:4}
],retrievalPlan,{limit:2,maxPerDocument:1});
const retrievalPassed=retrieval[0]?.chunk_id==='strong';

const report={schemaVersion:1,citation,retrieval:{passed:retrievalPassed,topChunkId:retrieval[0]?.chunk_id||null}};
console.log(JSON.stringify(report,null,2));
if(!citation.passed || !retrievalPassed) process.exit(1);
console.log('AURALIS_V014_BENCHMARK_PASS');
