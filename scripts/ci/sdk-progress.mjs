import {mkdir,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const sourceSha='b069e1a87666791cbbfb2b34601b474d11cb7c465862bce013a9279aab0a5382',base=resolve('build/sdk-progress'),source=join(base,'source');
await mkdir(source,{recursive:true});
const response=await fetch('https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-source-progress1.tar.gz',{signal:AbortSignal.timeout(300000)});
if(!response.ok)throw Error('Public source download unavailable');const bytes=Buffer.from(await response.arrayBuffer());
if(createHash('sha256').update(bytes).digest('hex')!==sourceSha)throw Error('Exact public source hash differs');const archive=join(base,'source.tar.gz');await writeFile(archive,bytes);
async function run(command,args){const child=spawn(command,args,{cwd:source,stdio:'inherit',shell:false,windowsHide:true});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});if(code!==0)throw Error(`SDK qualification failed (${code})`);}
await run('tar',['-xf',archive,'-C',source]);
const {verifyManifest}=await import(pathToFileURL(join(source,'scripts/lib/artifacts.mjs')));const manifest=await verifyManifest(source,{expectedKind:'office-source-progress'});
if(manifest.sourceCommit!=='60e8d44a769b998827f308ceb58f5cba5b6a0e17')throw Error('Unexpected public source freeze');
// Hosted Intel runners exposed contention between independent test-file child
// processes. Preserve all assertions/deadline cases; run those files serially.
async function testsAt(directory){const paths=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())paths.push(...await testsAt(path));else if(entry.isFile()&&entry.name.endsWith('.test.mjs'))paths.push(path);}return paths;}
const tests=(await Promise.all(['test','packages/node/test','packages/browser/test'].map(path=>testsAt(join(source,path))))).flat().sort();if(!tests.length)throw Error('No SDK tests discovered');
await run(process.execPath,['--test','--test-concurrency=1',...tests]);await run(process.execPath,['--test',join(source,'scripts/engines/ranged-download.test.mjs')]);
await writeFile(join(base,'RESULT.json'),JSON.stringify({schemaVersion:1,sourceCommit:manifest.sourceCommit,sourceArchiveSha256:sourceSha,platform:process.platform,architecture:process.arch,node:process.versions.node,sdkAndArchiveTestsPassed:true,rangedDownloadTestsPassed:true,scope:'SDK/helper regressions only; no private harness, engine, Office/Adobe or OS-client acceptance'},null,2)+'\n');
