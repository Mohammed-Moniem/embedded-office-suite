// Exact published source3-r1 with P1 vendor/support and platform tools. Stages preserve failure evidence; no npm install.
import assert from 'node:assert/strict';
import {readFile,mkdir,rename,readdir,writeFile} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parseArgs} from 'node:util';
import {createSupervisor} from './progress-supervisor.mjs';
const {values}=parseArgs({options:{app:{type:'string'},phase:{type:'string',default:'all'}}});
const vendors={wordcraft:'95a914506a4439e285b669d562ebb113daa53818259572e3025e2e568ae6a382',pdfcraft:'8c5fd6b02020a2309803182c9b34ca5680ea46165de8aa2099b45ca8d7e0f9f3',deckcraft:'762e55795c534cbffade71d7c336fae367e1b8bc3176f7f261526e44ee3b7992',gridcraft:'e3a5d7e800bdbe90529783db1381225d9c3f9eb1c42f96fcdbe6383c8997dab5'};
const tools={'macos-arm64':'973bc9a8fe6562c982aa8e86904f15c275e3bd4545bf171fd07d25792790595d','macos-x64':'6dbdb8dfa4b78166d1e4ca37c152dd85f1a53a98537080cc7696b04225373ed9','windows-x64':'02a82e36f2c9df54908efa3a0aa431fde27e5c776e12cea8464c980217bc0ddd'};
const app=values.app,phase=values.phase,platform=process.platform==='darwin'?'macos-'+process.arch:process.platform==='win32'&&process.arch==='x64'?'windows-x64':null;
assert(Object.hasOwn(vendors,app)&&Object.hasOwn(tools,platform),'Unsupported qualification app/host');
assert(['all','restore','build','qualify'].includes(phase),'Unknown qualification phase');
const base=resolve('build/progress-ci'),downloads=join(base,'downloads'),source=join(base,'source');
await mkdir(base,{recursive:true});
const sourceCommit='e8e4364c20018abb1222c69b7e50839abfe62644',sourceManifestSha='566d2c34f202c0e33e2bd2049fab086642228e781ebc8585a4c431ea472b9daa';
const sourceName='office-source-progress3-r1.tar.gz',sourceSha='ee369702aa8cf550413d000f58ac88d297ede8da01fade5d4ac3c89a1ddc2e6c';
const assets=[{name:sourceName,sha256:sourceSha},{name:'office-build-inputs-vendor-'+app+'.tar.gz',sha256:vendors[app]},{name:'office-build-inputs-support-complete3.tar.gz',sha256:'b044c20cfc2a8f470268065fd44a3f2ab2e0837c09a89856bfbc902377e9595c'},{name:'office-build-inputs-tools-'+platform+(platform==='windows-x64'?'-gzip-r1':'')+'.tar.gz',sha256:tools[platform]}];
const supervisor=createSupervisor(join(base,'evidence',phase));
async function hash(path){const h=createHash('sha256');for await(const bytes of createReadStream(path))h.update(bytes);return h.digest('hex');}
const helper=join(base,'frozen-input-helper.mjs');
await writeFile(helper,[
 "import assert from 'node:assert/strict';",
 "import {readFile} from 'node:fs/promises';",
 "import {pathToFileURL} from 'node:url';",
 "import {join} from 'node:path';",
 "const spec=JSON.parse(await readFile(process.argv[2],'utf8'));",
 "if(spec.action==='verify'){",
 " const {verifyFrozenSource}=await import(spec.verifierUrl);",
 " await verifyFrozenSource(spec.source,{manifestSha256:spec.manifestSha256,sourceCommit:spec.sourceCommit,allowBuildOutputs:spec.allowBuildOutputs});",
 " console.log('Exact frozen source manifest verified');",
 "}else{",
 " const {unpackBuildArchive}=await import(pathToFileURL(join(spec.source,'scripts/unpack-build-inputs.mjs')));",
 " console.log(JSON.stringify(await unpackBuildArchive(spec)));",
 "}"
].join('\n')+'\n');
async function frozen(name,spec){
 const file=join(base,name+'-spec.json');await writeFile(file,JSON.stringify({source,...spec},null,2)+'\n');
 await supervisor.command(name,process.execPath,[helper,file],{cwd:source,timeoutMs:600000});
}
async function verifySource(label){
 assert.equal(await hash(join(source,'MANIFEST.json')),sourceManifestSha,'Wrong frozen manifest');
 await frozen('verify-source-'+label,{action:'verify',sourceCommit,manifestSha256:sourceManifestSha,allowBuildOutputs:label!=='restore',verifierUrl:new URL('./verify-frozen-source.mjs',import.meta.url).href});
}
async function restore(){
 await mkdir(downloads,{recursive:true});await mkdir(source,{recursive:true});
 for(const asset of assets)await supervisor.stage('download-'+asset.name.replaceAll('.','-'),async()=>{
  const file=join(downloads,asset.name),signal=AbortSignal.timeout(300000);
  const response=await fetch('https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/'+(asset.name===sourceName?'v0.1.0-progress.3':'v0.1.0-progress.1')+'/'+asset.name,{signal});
  assert(response.ok&&response.body,'Cannot download '+asset.name+': '+response.status);
  await pipeline(Readable.fromWeb(response.body),createWriteStream(file+'.partial',{flags:'wx'}),{signal});
  assert.equal(await hash(file+'.partial'),asset.sha256,'Published archive checksum mismatch');
  await rename(file+'.partial',file);
 });
 await supervisor.command('extract-source','tar',['-xf',join(downloads,sourceName),'-C',source],{cwd:base});
 await verifySource('restore');
 for(const asset of assets.slice(1)){
  const vendor=asset.name.includes('-vendor-'),support=asset.name.includes('-support-');
  const destination=join(source,'build/engines',vendor?'vendor-inputs/'+app:support?'support-inputs':'tool-inputs/'+platform);
  await frozen(vendor?'restore-vendor':support?'restore-support':'restore-tools',{archive:join(downloads,asset.name),expectedSha256:asset.sha256,destination,installTools:!vendor&&!support,projectRoot:source});
 }
 await writeFile(join(base,'RESTORED-INPUTS.json'),JSON.stringify({schemaVersion:1,platform,app,sourceCommit,sourceManifestSha,assets,restored:true,compiled:false},null,2)+'\n');
}
async function restored(){
 const receipt=JSON.parse(await readFile(join(base,'RESTORED-INPUTS.json'),'utf8'));
 assert.equal(receipt.platform,platform);assert.equal(receipt.app,app);assert.equal(receipt.sourceCommit,sourceCommit);
 assert.equal(receipt.sourceManifestSha,sourceManifestSha);assert.deepEqual(receipt.assets,assets);assert.equal(receipt.restored,true);
 await verifySource(phase==='all'?'continuation':phase);
}
async function build(){
 await restored();
 const args=[join(source,'scripts/engines/offline-build.mjs'),app,'all'];
 if(process.platform==='darwin')await supervisor.command('compile-native-and-wasm','/usr/bin/sandbox-exec',['-f',join(source,'scripts/engines/deny-network.sb'),process.execPath,...args,'--prove-network-denied'],{cwd:source,timeoutMs:7200000});
 else await supervisor.command('compile-native-and-wasm',process.execPath,args,{cwd:source,timeoutMs:7200000});
}
async function qualify(){
 if(phase!=='all')await restored();
 const runs=join(source,'build/engines/offline-builds',app),names=await readdir(runs);
 assert.equal(names.length,1,'Expected one isolated build');
 const directory=join(runs,names[0]),report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
 assert(report.passed&&report.cargoHomeInitiallyEmpty&&report.targetInitiallyEmpty,'Frozen public rebuild failed');
 const args=[join(source,'scripts/verify-engines.mjs'),'--apps',app,'--runtime-dir',join(directory,'runtime'),'--output',join(directory,'native-qualification.json'),...(app==='gridcraft'?['--grid-policy','automation-roots']:[])];
 if(process.platform==='darwin')await supervisor.command('native-qualification','/usr/bin/sandbox-exec',['-f',join(source,'scripts/engines/deny-network.sb'),process.execPath,...args],{cwd:source});
 else await supervisor.command('native-qualification',process.execPath,args,{cwd:source});
 await writeFile(join(base,'PUBLIC-INPUTS.json'),JSON.stringify({schemaVersion:1,platform,sourceCommit,assets,compiled:true,nativeQualified:true,networkDenial:report.networkDenial,limits:['Hosted CI environment; Windows Server is not Windows 11 client acceptance','WASM compilation is separate from browser/private-WebView acceptance','Not feature/file parity']},null,2)+'\n');
}
try{
 if(phase==='all'||phase==='restore')await restore();
 if(phase==='all'||phase==='build')await build();
 if(phase==='all'||phase==='qualify')await qualify();
 supervisor.record(phase,'completed',{platform,app,sourceCommit});
}catch(error){supervisor.record(phase,'failed',{platform,app,sourceCommit,error:error.message});throw error;}
