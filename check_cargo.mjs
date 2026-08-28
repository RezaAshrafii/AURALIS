import fs from 'fs';
const c = fs.readFileSync('native/Cargo.lock', 'utf8');
const m = c.match(/name = "auralis-core"[\r\n]+version = "0\.16\.0"/);
console.log('Match:', !!m);
console.log('Context:', c.substring(c.indexOf('auralis-core')-10, c.indexOf('auralis-core')+50));