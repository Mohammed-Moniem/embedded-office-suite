// Anonymous byte readback of durable reconstruction DATA; no runtime acceptance.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const authorityPath='config/public-source3-data-progress3.json';
const bytes=await readFile(authorityPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'),'7e9dcc40bb869bdd3db366dee860a849ca7e17ef25993e9e121da39516a80b9b','Public reconstruction authority changed');
const authority=JSON.parse(bytes);
assert.equal(authority.schemaVersion,1);assert.equal(authority.kind,'source3-public-reconstruction-data-byte-authority');
assert(authority.files.length>0&&authority.files.length<=128);
const seen=new Set();
for(const file of authority.files){
 assert.equal(typeof file.url,'string');const url=new URL(file.url);
 assert.equal(url.origin,'https://github.com');assert(url.pathname.startsWith('/Mohammed-Moniem/embedded-office-suite/releases/download/'));
 assert.equal(url.search,'');assert.equal(url.hash,'');assert(/^[A-Za-z0-9._-]+$/.test(file.name));assert.equal(url.pathname.split('/').at(-1),file.name);
 assert(Number.isSafeInteger(file.bytes)&&file.bytes>0);assert(/^[a-f0-9]{64}$/.test(file.sha256));assert(!seen.has(file.url));seen.add(file.url);
}
if(process.argv.includes('--validate-only')){console.log('Fixed public reconstruction data authority validated: '+authority.files.length);process.exit(0);}
const results=new Array(authority.files.length);let cursor=0;
async function worker(){while(cursor<authority.files.length){const index=cursor++,file=authority.files[index];
 const response=await fetch(file.url,{signal:AbortSignal.timeout(900000)});assert(response.ok,'Public data fetch failed: '+file.name+' HTTP '+response.status);
 const hash=createHash('sha256');let received=0;
 for await(const chunk of response.body){received+=chunk.length;assert(received<=file.bytes,'Public file exceeded authority size: '+file.name);hash.update(chunk);}
 assert.equal(received,file.bytes,'Public file size mismatch: '+file.name);assert.equal(hash.digest('hex'),file.sha256,'Public file digest mismatch: '+file.name);
 results[index]={...file,anonymousDownloadVerified:true};console.log('Anonymous exact data verified: '+file.name);
}}
await Promise.all([worker(),worker()]);
const report={schemaVersion:1,kind:'anonymous-source3-reconstruction-data-readback',authoritySha256:createHash('sha256').update(bytes).digest('hex'),passed:true,anonymousPublicFetch:true,files:results,limits:['Byte availability and identity only; archive source/runtime behavior is separately qualified','No private-host, Windows11 or product parity acceptance']};
await mkdir('build/public-source3-data-ci',{recursive:true});await writeFile('build/public-source3-data-ci/RESULT.json',JSON.stringify(report,null,2)+'\n');
console.log('All public source3 reconstruction data matched exact authority: '+results.length);
