import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const platform=process.platform==='win32'&&process.arch==='x64'?'windows-x64':process.platform==='darwin'&&['arm64','x64'].includes(process.arch)?'macos-'+process.arch:null;
assert(platform,'Unsupported target');
const inventory=JSON.parse(await readFile('config/native-progress1.json','utf8'));
const runtime=inventory.files.find(file=>file.platform===platform);assert(runtime,'No exact runtime published for this target');
const base=resolve('build/native-runtime-ci'),source=join(base,'source'),directory=join(base,'runtime');
await mkdir(source,{recursive:true});await mkdir(directory,{recursive:true});
async function run(command,args){const child=spawn(command,args,{stdio:'inherit',shell:false,windowsHide:true});const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(status,0,'Native runtime qualification command failed');}
async function download(name,sha){
  assert(/^[a-zA-Z0-9._-]+$/.test(name)&&/^[a-f0-9]{64}$/.test(sha));
  const response=await fetch(`https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/${name}`,{signal:AbortSignal.timeout(300000)});assert(response.ok);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);
  const path=join(base,name);await writeFile(path,bytes);return path;
}
const sourceArchive=await download('office-source-progress1.tar.gz','b069e1a87666791cbbfb2b34601b474d11cb7c465862bce013a9279aab0a5382');
await run('tar',['-xf',sourceArchive,'-C',source]);
const {verifyManifest,sha256}=await import(pathToFileURL(join(source,'scripts/lib/artifacts.mjs')));
const sourceManifest=await verifyManifest(source,{expectedKind:'office-source-progress'});assert.equal(sourceManifest.sourceCommit,'60e8d44a769b998827f308ceb58f5cba5b6a0e17');
const archive=await download(runtime.name,runtime.sha256);await run('tar',['-xf',archive,'-C',directory]);
const manifest=await verifyManifest(directory,{expectedKind:'source-derived-integration-progress',expectedPlatform:platform});
const output=join(base,'RESULT.json');
if(process.platform==='darwin')await run(process.execPath,[join(source,'scripts/verify-extracted-runtime.mjs'),'--directory',directory,'--deny-network','--output',output]);
else await run('pwsh',['-NoProfile','-File',resolve('scripts/ci/windows-runtime-network.ps1'),'-NodePath',process.execPath,'-SourcePath',source,'-RuntimePath',directory,'-OutputPath',output]);
const result=JSON.parse(await readFile(output,'utf8'));assert(result.passed&&result.native.allFourRequested);
const network=process.platform==='win32'?JSON.parse((await readFile(output+'.network.json','utf8')).replace(/^\uFEFF/,'')):null;
if(network)assert(network.passed&&network.positiveControlConnected&&network.nodeDirectIpDenied&&network.workerRulesVerified===4);
await writeFile(join(base,'PUBLIC-ARCHIVE.json'),JSON.stringify({schemaVersion:1,platform,archive:runtime,sourceCommit:sourceManifest.sourceCommit,manifestSha256:await sha256(join(directory,'MANIFEST.json')),manifestFiles:manifest.files.length,exactPublicArchive:true,exactPackagedSdk:true,passed:true,network:network??result.networkPolicy,limits:['CI runner only; Windows Server is not Windows 11 client acceptance','Not browser/private-harness acceptance or Microsoft/Adobe parity']},null,2)+'\n');
console.log('Exact public native archive and packaged SDK passed: '+platform);
