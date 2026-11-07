// CI bootstrap for one exact published progress source/input set. No npm install.
import {readFile,mkdir,rename,readdir,writeFile} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{app:{type:'string'}}});
const vendors={wordcraft:'95a914506a4439e285b669d562ebb113daa53818259572e3025e2e568ae6a382',pdfcraft:'8c5fd6b02020a2309803182c9b34ca5680ea46165de8aa2099b45ca8d7e0f9f3',deckcraft:'762e55795c534cbffade71d7c336fae367e1b8bc3176f7f261526e44ee3b7992',gridcraft:'e3a5d7e800bdbe90529783db1381225d9c3f9eb1c42f96fcdbe6383c8997dab5'};
const tools={'macos-arm64':'973bc9a8fe6562c982aa8e86904f15c275e3bd4545bf171fd07d25792790595d','macos-x64':'6dbdb8dfa4b78166d1e4ca37c152dd85f1a53a98537080cc7696b04225373ed9','windows-x64':'1ee6c953e84ed58580d5dfa65b7c7517a845287f5e5a2c6b68aec87b58d77c9a'};
const app=values.app,platform=process.platform==='darwin'?`macos-${process.arch}`:process.platform==='win32'&&process.arch==='x64'?'windows-x64':null;
if(!Object.hasOwn(vendors,app)||!Object.hasOwn(tools,platform))throw Error('Unsupported qualification app/host');
const base=resolve('build/progress-ci'),downloads=join(base,'downloads'),source=join(base,'source');await mkdir(downloads,{recursive:true});await mkdir(source,{recursive:true});
const sourceName='office-source-progress1.tar.gz',sourceSha='b069e1a87666791cbbfb2b34601b474d11cb7c465862bce013a9279aab0a5382';
const assets=[{name:sourceName,sha256:sourceSha},{name:`office-build-inputs-vendor-${app}.tar.gz`,sha256:vendors[app]},{name:'office-build-inputs-support-complete3.tar.gz',sha256:'b044c20cfc2a8f470268065fd44a3f2ab2e0837c09a89856bfbc902377e9595c'},{name:`office-build-inputs-tools-${platform}.tar.gz`,sha256:tools[platform]}];
async function hash(path){const h=createHash('sha256');for await(const bytes of createReadStream(path))h.update(bytes);return h.digest('hex');}
for(const asset of assets){
  const file=join(downloads,asset.name),response=await fetch(`https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/${asset.name}`,{signal:AbortSignal.timeout(300000)});
  if(!response.ok||!response.body)throw Error(`Cannot download ${asset.name}: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body),createWriteStream(file+'.partial',{flags:'wx'}));
  if(await hash(file+'.partial')!==asset.sha256)throw Error(`Published archive checksum mismatch: ${asset.name}`);
  await rename(file+'.partial',file);console.log(`Verified public download ${asset.name}`);
}
async function run(command,args,cwd){
  const child=spawn(command,args,{cwd,stdio:'inherit',shell:false,windowsHide:true});const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});if(code!==0)throw Error(`Qualification command failed (${code})`);
}
await run('tar',['-xf',join(downloads,sourceName),'-C',source],base);
const {verifyManifest}=await import(pathToFileURL(join(source,'scripts/lib/artifacts.mjs')));
const manifest=await verifyManifest(source,{expectedKind:'office-source-progress'});
if(manifest.sourceCommit!=='60e8d44a769b998827f308ceb58f5cba5b6a0e17')throw Error('Wrong frozen public source commit');
const {unpackBuildArchive}=await import(pathToFileURL(join(source,'scripts/unpack-build-inputs.mjs')));
for(const asset of assets.slice(1)){
  const vendor=asset.name.includes('-vendor-'),support=asset.name.includes('-support-');
  const destination=join(source,'build/engines',vendor?`vendor-inputs/${app}`:support?'support-inputs':`tool-inputs/${platform}`);
  await unpackBuildArchive({archive:join(downloads,asset.name),expectedSha256:asset.sha256,destination,installTools:!vendor&&!support,projectRoot:source});
}
const buildArgs=[join(source,'scripts/engines/offline-build.mjs'),app,'all'];
if(process.platform==='darwin')await run('/usr/bin/sandbox-exec',['-f',join(source,'scripts/engines/deny-network.sb'),process.execPath,...buildArgs,'--prove-network-denied'],source);
else await run(process.execPath,buildArgs,source);
const runs=join(source,'build/engines/offline-builds',app),names=await readdir(runs);if(names.length!==1)throw Error('Expected one isolated build');
const directory=join(runs,names[0]),report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
if(!report.passed||!report.cargoHomeInitiallyEmpty||!report.targetInitiallyEmpty)throw Error('Frozen public source rebuild failed');
const qualifyArgs=[join(source,'scripts/verify-engines.mjs'),'--apps',app,'--runtime-dir',join(directory,'runtime'),'--output',join(directory,'native-qualification.json'),...(app==='gridcraft'?['--grid-policy','automation-roots']:[])];
if(process.platform==='darwin')await run('/usr/bin/sandbox-exec',['-f',join(source,'scripts/engines/deny-network.sb'),process.execPath,...qualifyArgs],source);
else await run(process.execPath,qualifyArgs,source);
await writeFile(join(base,'PUBLIC-INPUTS.json'),JSON.stringify({schemaVersion:1,platform,sourceCommit:manifest.sourceCommit,assets,compiled:true,nativeQualified:true,networkDenial:report.networkDenial,limits:['Hosted CI environment; Windows Server is not Windows 11 client acceptance','WASM compilation is separate from browser/private-WebView acceptance','Not feature/file parity']},null,2)+'\n');
console.log(`Exact public source/input compilation and native qualification passed: ${platform} ${app}`);
