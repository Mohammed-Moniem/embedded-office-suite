// Fixed standalone helper qualification. Downloaded archives are never extracted or executed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,lstat,readdir} from 'node:fs/promises';
import {join,resolve,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {release} from 'node:os';
import {spawn} from 'node:child_process';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const PINS=Object.freeze({
  helper:'e420a223958141ca2fd518f4ba6d5883012df9a1b278e6d6fd7ffef892e7e641',
  config:'2ba769bd1e1d70e68f63d9b7b88e187409f0d739d2dfc59ccd6337383aaef2b5',
});
const NATIVE={
  'macos-arm64':{name:'office-native-source3-r1-macos-arm64.zip',bytes:250377148,sha256:'335d5ab993c01a939feeda8dfd035b856a3281d1fc61f0952d366813638468d2'},
  'macos-x64':{name:'office-native-source3-r1-macos-x64.zip',bytes:254390723,sha256:'a9ad54c1fe26324501e081c9541966771b76f3ed2a4fd35a42910f837ae0074e'},
  'windows-x64':{name:'office-native-windows-x64-progress3-r1.zip',bytes:249300942,sha256:'055a27446f7aab4c6321f41c5a1be69a787384e9352555af964fe129b61f43c0'},
};
const WASM={name:'office-wasm-integration-progress3-r1.zip',bytes:81469742,sha256:'99c25048df8b3562b5cfbac86fc463ad9b0682d9fd2b5d8da5c06a1acbe0c5af'};
const sha=b=>createHash('sha256').update(b).digest('hex');
const missing=async p=>{await assert.rejects(lstat(p),{code:'ENOENT'});};
const expected=platform=>{assert.ok(Object.hasOwn(NATIVE,platform),'Unsupported target');return [NATIVE[platform],WASM];};
const sum=assets=>assets.reduce((n,a)=>n+a.bytes,0);
const hostPlatform=()=>({'darwin-arm64':'macos-arm64','darwin-x64':'macos-x64','win32-x64':'windows-x64'})[`${process.platform}-${process.arch}`];

async function fileIdentity(path,asset) {
  const before=await lstat(path);assert.ok(before.isFile()&&!before.isSymbolicLink(),'Archive must be a regular file');assert.equal(before.size,asset.bytes,'Archive byte size mismatch');
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path)){bytes+=chunk.length;assert.ok(bytes<=asset.bytes,'Archive grew during hashing');hash.update(chunk);}
  const after=await lstat(path);
  assert.equal(bytes,asset.bytes);assert.equal(hash.digest('hex'),asset.sha256,'Independent archive SHA256 mismatch');
  for(const k of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(after[k],before[k],'Archive identity changed during hashing');
  assert.ok(!after.isSymbolicLink());
  return {...asset};
}

function verifyMetadata(result,{platform,destination,mode}) {
  const assets=expected(platform);
  assert.equal(result.mode,mode);assert.equal(result.platform,platform);assert.equal(result.profile,'runtime');assert.equal(result.destination,destination);assert.equal(result.totalBytes,sum(assets));
  const rows=mode==='plan'?result.assets:result.files;
  assert.ok(Array.isArray(rows));assert.equal(rows.length,2);assert.equal(new Set(rows.map(a=>a.name)).size,2,'Duplicate CLI archive receipt');
  for(const a of assets){const row=rows.find(x=>x.name===a.name);assert.ok(row,'CLI receipt omitted expected archive');for(const k of ['bytes','sha256'])assert.equal(row[k],a[k],`CLI ${k} mismatch`);if(mode!=='plan')assert.equal(row.status,mode==='download-verified'?'downloaded':'verified-existing');}
  return assets;
}

export async function verifyRuntimeResult({stdout,platform,destination,mode}) {
  assert.ok(['download-verified','offline-verified'].includes(mode));
  const result=JSON.parse(stdout),assets=verifyMetadata(result,{platform,destination,mode});
  assert.deepEqual((await readdir(destination)).sort(),assets.map(a=>a.name).sort(),'Unexpected runtime directory entries');
  const identities=[];for(const a of assets)identities.push(await fileIdentity(join(destination,a.name),a));
  return {mode,platform,totalBytes:sum(assets),identities};
}

function runChild(args,deadlineMs) {
  return new Promise(resolveResult=>{
    const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
    const child=spawn(process.execPath,args,{cwd:ROOT,env,stdio:['ignore','pipe','pipe'],shell:false});
    let stdout='',stderr='',timedOut=false,outputLimited=false,spawnError,forceTimer,stopping=false;
    const stop=()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');forceTimer=setTimeout(()=>child.kill('SIGKILL'),10_000);};
    const timer=setTimeout(()=>{if(stopping)return;timedOut=true;stop();},deadlineMs);
    const capture=(kind,b)=>{if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)+b.length>512_000){if(!outputLimited){outputLimited=true;stop();}return;}if(kind==='out')stdout+=b;else stderr+=b;};
    child.stdout.on('data',b=>capture('out',b));child.stderr.on('data',b=>capture('err',b));
    child.on('error',e=>{spawnError=e.message;});
    child.on('close',(code,signal)=>{clearTimeout(timer);clearTimeout(forceTimer);resolveResult({code,signal,timedOut,outputLimited,...(spawnError?{spawnError}:{}),stdout,stderr});});
  });
}

export async function qualifyKit() {
  const base=join(ROOT,'build/kit-hosted/actual');await mkdir(base,{recursive:true});
  const runRoot=await mkdtemp(join(base,'run-')),stagesDir=join(runRoot,'stages');await mkdir(stagesDir);
  const report={schemaVersion:1,kind:'fixed-office-kit-standalone-transfer',status:'IN_PROGRESS',scope:'Archive availability and integrity only; no extraction, installation, downloaded-code execution, private-host or Windows11/product acceptance',pins:PINS,environment:{node:process.versions.node,platform:process.platform,arch:process.arch,osRelease:release(),githubActions:process.env.GITHUB_ACTIONS==='true',runId:process.env.GITHUB_RUN_ID??null,head:process.env.GITHUB_SHA??null,runnerOS:process.env.RUNNER_OS??null,runnerArch:process.env.RUNNER_ARCH??null},stages:[]};
  let originalFailure;
  const stage=async(name,args,deadlineMs,{failure=false,stderrIncludes}={})=>{
    report.currentStage=name;
    const result=await runChild(args,deadlineMs),path=join(stagesDir,`${String(report.stages.length+1).padStart(2,'0')}-${name}.json`);
    await writeFile(path,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    report.stages.push({name,path:relative(ROOT,path),sha256:sha(await readFile(path)),code:result.code,signal:result.signal,timedOut:result.timedOut,outputLimited:result.outputLimited});
    assert.equal(result.timedOut,false,`${name}: child stage deadline exceeded`);assert.equal(result.outputLimited,false,`${name}: child stage output exceeded limit`);assert.equal(result.spawnError,undefined,`${name}: spawn failed`);
    assert.equal(result.signal,null,`${name}: child terminated by signal`);assert.equal(result.code,failure?1:0,`${name}: unexpected child exit; original stderr: ${result.stderr}`);
    if(stderrIncludes)assert.ok(result.stderr.includes(stderrIncludes),`${name}: wrong original error: ${result.stderr}`);
    return result;
  };
  try {
    assert.equal(process.versions.node,'24.18.0','Use pinned Node 24.18.0');
    const platform=hostPlatform();expected(platform);report.target=platform;
    if(process.env.OFFICE_KIT_EXPECT_PLATFORM)assert.equal(platform,process.env.OFFICE_KIT_EXPECT_PLATFORM,'Runner architecture does not match matrix');
    const originals={helper:join(ROOT,'scripts/download-office-kit.mjs'),config:join(ROOT,'config/office-kit-downloads-progress3.json')};
    for(const k of Object.keys(originals))assert.equal(sha(await readFile(originals[k])),PINS[k],`Pinned ${k} changed`);
    const config=JSON.parse(await readFile(originals.config));for(const a of expected(platform)){const row=config.assets.find(x=>x.name===a.name);assert.ok(row);for(const k of ['bytes','sha256'])assert.equal(row[k],a[k]);}
    const pair=join(runRoot,'Standalone Office — نقل 文件'),script=join(pair,'scripts/download-office-kit.mjs');
    await mkdir(join(pair,'scripts'),{recursive:true});await mkdir(join(pair,'config'));
    await copyFile(originals.helper,script);await copyFile(originals.config,join(pair,'config/office-kit-downloads-progress3.json'));
    assert.equal(sha(await readFile(script)),PINS.helper);assert.equal(sha(await readFile(join(pair,'config/office-kit-downloads-progress3.json'))),PINS.config);
    assert.deepEqual((await readdir(pair)).sort(),['config','scripts']);await missing(join(pair,'build'));
    report.standalone={path:relative(ROOT,pair),files:['scripts/download-office-kit.mjs','config/office-kit-downloads-progress3.json'],buildAuthoritiesAbsent:true};
    const destination=join(runRoot,'Runtime transfer — بيانات 文件');
    const options=d=>[script,'--destination',d,'--platform',platform,'--profile','runtime'];
    const download=await stage('download-runtime',options(destination),30*60_000);
    report.download=await verifyRuntimeResult({stdout:download.stdout,platform,destination,mode:'download-verified'});
    const poison=join(runRoot,'forbid-fetch.mjs'),audit=join(runRoot,'forbidden-fetch-attempts.log');
    await writeFile(poison,`import {appendFileSync} from 'node:fs';\nglobalThis.fetch=()=>{appendFileSync(${JSON.stringify(audit)},'forbidden fetch attempted\\n');throw new Error('Hosted offline fetch forbidden');};\n`,{flag:'wx'});
    const offlineArgs=args=>['--import',poison,...args];
    const offline=await stage('offline-existing',offlineArgs([...options(destination),'--offline']),5*60_000);
    report.offline=await verifyRuntimeResult({stdout:offline.stdout,platform,destination,mode:'offline-verified'});await missing(audit);
    const planDest=join(runRoot,'Missing plan destination 文件');
    const plan=await stage('plan-readonly',offlineArgs([...options(planDest),'--plan']),30_000);
    verifyMetadata(JSON.parse(plan.stdout),{platform,destination:planDest,mode:'plan'});await missing(planDest);await missing(audit);
    report.plan={missingDestinationUncreated:true,expectedAssets:2,fetchAttempts:0};
    const wrong=join(runRoot,'Wrong existing file — لا تعديل');await mkdir(wrong);
    const wrongPath=join(wrong,expected(platform)[0].name),sentinel=Buffer.from('Preserve this operator file; intentionally wrong archive.\n');await writeFile(wrongPath,sentinel,{flag:'wx'});
    await stage('wrong-existing-preserved',offlineArgs(options(wrong)),30_000,{failure:true,stderrIncludes:`Existing file has wrong type or size: ${expected(platform)[0].name}`});
    assert.deepEqual(await readFile(wrongPath),sentinel);assert.deepEqual(await readdir(wrong),[expected(platform)[0].name]);await missing(audit);
    report.wrongExisting={bytes:sentinel.length,sha256:sha(sentinel),unchanged:true,fetchAttempts:0};
    const missingDest=join(runRoot,'Missing offline destination');
    await stage('offline-missing',offlineArgs([...options(missingDest),'--offline']),30_000,{failure:true,stderrIncludes:`Offline file missing: ${expected(platform)[0].name}`});
    await missing(missingDest);await missing(audit);report.missingOffline={failedWithExpectedError:true,destinationUncreated:true,fetchAttempts:0};
    await missing(join(pair,'build'));report.forbiddenFetchAttempts=0;report.status='PASS';delete report.currentStage;
  } catch(error) {
    originalFailure=error;report.status='FAIL';report.failure={stage:report.currentStage??'input-identity',name:error.name,message:error.message};
  } finally {
    try{await writeFile(join(runRoot,'RESULT.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});}catch(e){console.error(`Could not retain hosted report: ${e.message}`);if(!originalFailure)originalFailure=e;}
  }
  if(originalFailure)throw originalFailure;
  return {report,path:join(runRoot,'RESULT.json')};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{assert.equal(process.argv.length,2,'This fixed qualification driver accepts no arguments');const r=await qualifyKit();console.log(JSON.stringify({status:r.report.status,result:r.path,target:r.report.target}));}
  catch(e){console.error(`Hosted office kit: ${e.message}`);process.exitCode=1;}
}
