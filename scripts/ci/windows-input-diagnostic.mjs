// Diagnostic only: restore exact public P1 inputs using their frozen helpers.
// No engine compilation, runtime acceptance, dependency install, or security changes.
import {createReadStream,createWriteStream,appendFileSync,writeFileSync,renameSync,mkdirSync,existsSync} from 'node:fs';
import {mkdir,readFile,rename,writeFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {platform,release,arch} from 'node:os';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';

const ROOT=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const BASE=join(ROOT,'build/windows-input-diagnostic');
const EVIDENCE=join(BASE,'evidence');
const SOURCE=join(BASE,'source');
const RELEASE='https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/';
const SOURCE_COMMIT='60e8d44a769b998827f308ceb58f5cba5b6a0e17';
const SOURCE_MANIFEST='a5272fd9b84e920567e3817fbe545c84acbc077538346bdfbed937d0cf2f1309';
const INPUTS=Object.freeze({
  source:{name:'office-source-progress1.tar.gz',sha256:'b069e1a87666791cbbfb2b34601b474d11cb7c465862bce013a9279aab0a5382'},
  vendor:{name:'office-build-inputs-vendor-gridcraft.tar.gz',sha256:'e3a5d7e800bdbe90529783db1381225d9c3f9eb1c42f96fcdbe6383c8997dab5'},
  support:{name:'office-build-inputs-support-complete3.tar.gz',sha256:'b044c20cfc2a8f470268065fd44a3f2ab2e0837c09a89856bfbc902377e9595c'},
  tools:{name:'office-build-inputs-tools-windows-x64.tar.gz',sha256:'1ee6c953e84ed58580d5dfa65b7c7517a845287f5e5a2c6b68aec87b58d77c9a'}
});
const PHASES=['environment','source','vendor','support','tools'];
const PHASE_LIMIT_MS=8*60*1000;
const COMMAND_LIMIT_MS=6*60*1000;

function atomicJSON(path,value){
  writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n');
  renameSync(path+'.tmp',path);
}
function phaseContext(phase,directory=EVIDENCE,limit=PHASE_LIMIT_MS){
  mkdirSync(directory,{recursive:true});
  const path=join(directory,phase+'.json');
  if(existsSync(path))throw Error(`Refusing to overwrite diagnostic evidence: ${path}`);
  const controller=new AbortController(),started=Date.now();
  const state={schemaVersion:1,phase,status:'running',startedAt:new Date().toISOString(),limitMs:limit,
    githubRunId:process.env.GITHUB_RUN_ID??null,githubRunAttempt:process.env.GITHUB_RUN_ATTEMPT??null,
    diagnosticOnly:true,compilationAttempted:false,checkpoints:[]};
  function checkpoint(operation,status,details={}){
    const event={at:new Date().toISOString(),elapsedMs:Date.now()-started,operation,status,...details};
    if(operation!=='phase')state.currentOperation=operation;
    state.checkpoints.push(event);
    appendFileSync(join(directory,phase+'.events.jsonl'),JSON.stringify(event)+'\n');
    atomicJSON(path,state);console.log(JSON.stringify({phase,...event}));
  }
  checkpoint('phase','started');
  const deadline=setTimeout(()=>{
    checkpoint('deadline','failed',{reason:'Phase exceeded its eight-minute diagnostic budget'});
    controller.abort(Error('Phase diagnostic deadline exceeded'));
  },limit);
  const heartbeat=setInterval(()=>checkpoint(state.currentOperation,'heartbeat'),15000);
  return {phase,directory,signal:controller.signal,checkpoint,
    async stage(name,work){
      controller.signal.throwIfAborted();checkpoint(name,'started');
      try{const result=await work();controller.signal.throwIfAborted();checkpoint(name,'succeeded',result??{});return result;}
      catch(error){checkpoint(name,'failed',{error:String(error.message??error)});throw error;}
    },
    finish(error){
      clearTimeout(deadline);clearInterval(heartbeat);
      state.status=error?'failed':'succeeded';state.completedAt=new Date().toISOString();
      checkpoint('phase',state.status,error?{error:String(error.message??error)}:{});
    }
  };
}

async function digest(path,signal){
  const hash=createHash('sha256');
  for await(const bytes of createReadStream(path,{signal}))hash.update(bytes);
  return hash.digest('hex');
}
async function verifyDigest(path,expected,signal){
  const actual=await digest(path,signal);
  if(actual!==expected)throw Error(`Pinned checksum mismatch for ${path}: ${actual}`);
  return {sha256:actual};
}

// Keep the supervisor alive while a frozen helper blocks in spawnSync or hashes
// thousands of files. Only this supervisor's own child tree can be terminated.
async function runCommand(ctx,label,command,args,cwd,{timeoutMs=COMMAND_LIMIT_MS,allowFailure=false}={}){
  ctx.signal.throwIfAborted();
  const log=join(ctx.directory,`${ctx.phase}-${label}.log`);
  const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
  ctx.checkpoint(label,'child-started',{command,args,cwd,pid:child.pid??null,timeoutMs});
  let output='',failure,killRequested=false,streamFailure;
  const stream=createWriteStream(log,{flags:'wx'});
  stream.on('error',error=>{streamFailure=error;child.kill('SIGKILL');});
  const record=chunk=>{
    stream.write(chunk);process.stdout.write(chunk);
    if(output.length<256*1024)output+=chunk.toString('utf8').slice(0,256*1024-output.length);
  };
  child.stdout.on('data',record);child.stderr.on('data',record);
  const terminate=reason=>{
    if(killRequested)return;killRequested=true;failure=reason;
    ctx.checkpoint(label,'termination-requested',{pid:child.pid??null,reason:reason.message});
    if(process.platform==='win32'&&child.pid){
      const killer=spawn(join(process.env.SystemRoot??'C:\\Windows','System32/taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',shell:false,windowsHide:true});
      killer.on('error',()=>child.kill('SIGKILL'));
      killer.on('close',code=>{if(code!==0)child.kill('SIGKILL');});
    }else child.kill('SIGKILL');
  };
  const onAbort=()=>terminate(ctx.signal.reason??Error('Phase aborted'));
  ctx.signal.addEventListener('abort',onAbort,{once:true});
  if(ctx.signal.aborted)onAbort();
  const timer=setTimeout(()=>terminate(Error(`Command timed out after ${timeoutMs} ms`)),timeoutMs);
  let result;
  try{
    result=await new Promise(resolve=>{
      child.once('error',error=>{failure=error;});
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
  }finally{
    clearTimeout(timer);ctx.signal.removeEventListener('abort',onAbort);
    if(!stream.destroyed)await new Promise(resolve=>{stream.once('error',resolve);stream.end(resolve);});
  }
  if(streamFailure)failure=streamFailure;
  ctx.checkpoint(label,failure||result.code!==0?'child-failed':'child-succeeded',{
    code:result.code,signal:result.signal,log,error:failure?.message??null
  });
  if(failure)throw failure;
  if(result.code!==0&&!allowFailure)throw Error(`${label} exited ${result.code}`);
  return {...result,output};
}

async function download(ctx,key){
  const asset=INPUTS[key],directory=join(BASE,'downloads'),file=join(directory,asset.name);
  await mkdir(directory,{recursive:true});
  if(existsSync(file)||existsSync(file+'.partial'))throw Error('Fresh diagnostic downloads required');
  await ctx.stage('download',async()=>{
    const signal=AbortSignal.any([ctx.signal,AbortSignal.timeout(180000)]);
    const response=await fetch(RELEASE+asset.name,{signal});
    if(!response.ok||!response.body)throw Error(`Cannot download ${asset.name}: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body),createWriteStream(file+'.partial',{flags:'wx'}),{signal});
    return {asset:asset.name};
  });
  await ctx.stage('verify-download-sha256',()=>verifyDigest(file+'.partial',asset.sha256,ctx.signal));
  await rename(file+'.partial',file);
  return file;
}

// This instrumentation delegates every actual tar call, argument and option
// unchanged to the frozen helper. It only records entry/return, never alters
// archive/source bytes, suppresses validation, or changes tar selection.
const DRIVER=String.raw`
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {appendFileSync,writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const spec=JSON.parse(await readFile(process.argv[2],'utf8'));
function event(operation,status,details={}){
  const record={at:new Date().toISOString(),operation,status,...details};
  appendFileSync(spec.events,JSON.stringify(record)+'\n');
  writeFileSync(spec.state,JSON.stringify(record,null,2)+'\n');
  console.log(JSON.stringify(record));
}
const original=childProcess.spawnSync;
childProcess.spawnSync=function(command,args,options){
  const start=Date.now();event('frozen-helper-tar','started',{command,args,cwd:process.cwd()});
  try{
    const result=original(command,args,options);
    event('frozen-helper-tar',result.status===0?'succeeded':'failed',{
      command,args,statusCode:result.status,signal:result.signal,elapsedMs:Date.now()-start,
      stdoutBytes:Buffer.byteLength(result.stdout??''),stderrBytes:Buffer.byteLength(result.stderr??''),
      error:result.error?.message??null
    });
    return result;
  }catch(error){event('frozen-helper-tar','failed',{error:error.message});throw error;}
};
syncBuiltinESMExports();
try{
  event('frozen-helper','started',{phase:spec.phase,cwd:process.cwd()});
  if(spec.phase==='source'){
    const {verifyManifest}=await import(pathToFileURL(join(spec.source,'scripts/lib/artifacts.mjs')));
    const manifest=await verifyManifest(spec.source,{expectedKind:'office-source-progress'});
    if(manifest.sourceCommit!==spec.sourceCommit)throw Error('Wrong frozen source commit');
    event('frozen-source-verification','succeeded',{sourceCommit:manifest.sourceCommit,files:manifest.files.length});
  }else{
    const {unpackBuildArchive}=await import(pathToFileURL(join(spec.source,'scripts/unpack-build-inputs.mjs')));
    const result=await unpackBuildArchive({archive:spec.archive,expectedSha256:spec.sha256,
      destination:spec.destination,installTools:spec.phase==='tools',projectRoot:spec.source});
    event('frozen-input-restore','succeeded',result);
  }
  event('frozen-helper','succeeded',{phase:spec.phase});
}catch(error){event('frozen-helper','failed',{phase:spec.phase,error:error.message});throw error;}
`;

async function frozenHelper(ctx,spec){
  const driver=join(BASE,'frozen-driver.mjs'),specFile=join(ctx.directory,ctx.phase+'-spec.json');
  await writeFile(driver,DRIVER);
  await writeFile(specFile,JSON.stringify({...spec,phase:ctx.phase,source:SOURCE,sourceCommit:SOURCE_COMMIT,
    events:join(ctx.directory,ctx.phase+'-frozen.events.jsonl'),state:join(ctx.directory,ctx.phase+'-frozen-state.json')},null,2)+'\n');
  await runCommand(ctx,'frozen-helper',process.execPath,[driver,specFile],SOURCE);
}

async function environment(ctx){
  await ctx.stage('platform',async()=>{
    const details={node:process.version,execPath:process.execPath,platform:platform(),release:release(),arch:arch(),
      cwd:process.cwd(),sourcePath:SOURCE,sourcePathLength:SOURCE.length,path:process.env.PATH??'',
      limits:['Read-only environment inventory','No security, registry, firewall or Defender changes','Diagnostic only; no engine build/runtime acceptance']};
    atomicJSON(join(ctx.directory,'environment-inventory.json'),details);
    return details;
  });
  const root=process.env.SystemRoot??'C:\\Windows';
  await ctx.stage('tar-resolution',async()=>{
    const where=await runCommand(ctx,'where-tar',join(root,'System32/where.exe'),['tar'],ROOT,{timeoutMs:30000});
    const paths=where.output.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    const selected=paths[0];if(!selected)throw Error('where.exe reported no PATH tar');
    const systemTar=join(root,'System32/tar.exe');
    const actual=await runCommand(ctx,'path-tar-version','tar',['--version'],ROOT,{timeoutMs:30000});
    const system=await runCommand(ctx,'system-tar-version',systemTar,['--version'],ROOT,{timeoutMs:30000});
    const comparison={pathCandidates:paths,selectedPath:selected,pathVersion:actual.output,
      systemTar,systemVersion:system.output,pathSelectsSystemTar:selected.toLowerCase().replaceAll('/','\\')===systemTar.toLowerCase().replaceAll('/','\\')};
    atomicJSON(join(ctx.directory,'tar-comparison.json'),comparison);
    return comparison;
  });
  await ctx.stage('read-only-long-path-policy',async()=>{
    const result=await runCommand(ctx,'long-path-policy',join(root,'System32/reg.exe'),
      ['query','HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem','/v','LongPathsEnabled'],ROOT,{timeoutMs:30000,allowFailure:true});
    return {queryExitCode:result.code,output:result.output,policyChanged:false};
  });
}

async function restore(ctx){
  const archive=await download(ctx,ctx.phase);
  if(ctx.phase==='source'){
    if(existsSync(SOURCE))throw Error('Source diagnostic directory already exists');
    await mkdir(SOURCE,{recursive:true});
    await ctx.stage('extract-source-with-path-tar',async()=>{
      const result=await runCommand(ctx,'source-tar','tar',['-xf',archive,'-C',SOURCE],BASE);
      return {code:result.code};
    });
    await ctx.stage('verify-source-manifest-sha256',()=>verifyDigest(join(SOURCE,'MANIFEST.json'),SOURCE_MANIFEST,ctx.signal));
    await ctx.stage('verify-frozen-source',async()=>{await frozenHelper(ctx,{});});
  }else{
    const sourceState=JSON.parse(await readFile(join(EVIDENCE,'source.json'),'utf8'));
    if(sourceState.status!=='succeeded')throw Error('Frozen source phase did not succeed');
    // Recheck the pinned manifest before loading the frozen source helper.
    await ctx.stage('recheck-source-manifest-sha256',()=>verifyDigest(join(SOURCE,'MANIFEST.json'),SOURCE_MANIFEST,ctx.signal));
    const destination=join(SOURCE,'build/engines',ctx.phase==='vendor'?'vendor-inputs/gridcraft':ctx.phase==='support'?'support-inputs':'tool-inputs/windows-x64');
    await ctx.stage('restore-with-frozen-helper',async()=>{
      await frozenHelper(ctx,{archive,sha256:INPUTS[ctx.phase].sha256,destination});
      return {destination,toolsInstalled:ctx.phase==='tools'};
    });
  }
}

async function summary(){
  mkdirSync(EVIDENCE,{recursive:true});
  const phases=[];
  for(const phase of PHASES){
    try{const state=JSON.parse(await readFile(join(EVIDENCE,phase+'.json'),'utf8'));phases.push({phase,status:state.status,completedAt:state.completedAt??null,currentOperation:state.currentOperation});}
    catch(error){if(error.code!=='ENOENT')throw error;phases.push({phase,status:'missing-or-skipped'});}
  }
  const passed=phases.every(phase=>phase.status==='succeeded');
  const result={schemaVersion:1,createdAt:new Date().toISOString(),passed,phases,assets:INPUTS,
    sourceCommit:SOURCE_COMMIT,sourceManifestSha256:SOURCE_MANIFEST,diagnosticOnly:true,
    compilationAttempted:false,nativeRuntimeAcceptance:false,
    limits:['Windows Server 2022 input restore diagnosis only','Grid vendor is one representative public vendor archive','No engine build, Windows 11, browser, private WebView or feature/file parity acceptance']};
  atomicJSON(join(EVIDENCE,'SUMMARY.json'),result);console.log(JSON.stringify(result,null,2));
  if(!passed)throw Error('Input diagnostic incomplete or failed; inspect per-phase evidence');
}

async function selfTest(){
  const directory=await mkdtemp(join(BASE,'self-test-'));
  const ctx=phaseContext('supervisor',directory,10000);
  let failure;
  try{
    const fixture=join(directory,'fixture.txt');await writeFile(fixture,'pinned input fixture\n');
    const expected=createHash('sha256').update('pinned input fixture\n').digest('hex');
    await verifyDigest(fixture,expected,ctx.signal);
    await assert.rejects(()=>verifyDigest(fixture,'0'.repeat(64),ctx.signal),/Pinned checksum mismatch/);
    const ok=await runCommand(ctx,'success',process.execPath,['-e','console.log("supervisor fixture success")'],directory,{timeoutMs:2000});
    assert.match(ok.output,/supervisor fixture success/);
    await assert.rejects(()=>runCommand(ctx,'failure',process.execPath,['-e','process.exit(7)'],directory,{timeoutMs:2000}),/exited 7/);
    await assert.rejects(()=>runCommand(ctx,'timeout',process.execPath,['-e','setInterval(()=>{},1000)'],directory,{timeoutMs:100}),/timed out/);
    const records=(await readFile(join(directory,'supervisor.events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert(records.some(record=>record.operation==='timeout'&&record.status==='child-started'));
    assert(records.some(record=>record.operation==='timeout'&&record.status==='termination-requested'));
    assert(records.some(record=>record.operation==='failure'&&record.status==='child-failed'&&record.code===7));
    await writeFile(join(directory,'driver.mjs'),DRIVER);
    await runCommand(ctx,'driver-syntax',process.execPath,['--check',join(directory,'driver.mjs')],directory,{timeoutMs:2000});
    // Exercise the instrumentation against the real local unpack helper and a
    // tiny generated archive. This is supervisor coverage, not public P1 proof.
    const fixtureSource=join(directory,'archive-source');await mkdir(fixtureSource);
    await writeFile(join(fixtureSource,'input.txt'),'exact diagnostic fixture\n');
    const {createManifest}=await import('../lib/artifacts.mjs');
    await createManifest(fixtureSource,{kind:'captured-vendor-build-inputs',app:'gridcraft'});
    const archive=join(directory,'fixture.tar.gz');
    await runCommand(ctx,'fixture-tar','tar',['-czf',archive,'-C',fixtureSource,'.'],directory,{timeoutMs:2000});
    const specFile=join(directory,'fixture-spec.json'),events=join(directory,'fixture-frozen.events.jsonl');
    await writeFile(specFile,JSON.stringify({phase:'vendor',source:ROOT,archive,
      sha256:await digest(archive,ctx.signal),destination:join(directory,'unpacked'),
      events,state:join(directory,'fixture-frozen-state.json')}));
    await runCommand(ctx,'driver-fixture',process.execPath,[join(directory,'driver.mjs'),specFile],ROOT,{timeoutMs:3000});
    assert.equal(await readFile(join(directory,'unpacked/input.txt'),'utf8'),'exact diagnostic fixture\n');
    const traces=(await readFile(events,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(traces.filter(event=>event.operation==='frozen-helper-tar'&&event.status==='started').length,4);
    assert.equal(traces.filter(event=>event.operation==='frozen-helper-tar'&&event.status==='succeeded').length,4);
    assert(traces.some(event=>event.operation==='frozen-input-restore'&&event.status==='succeeded'&&event.verified===true));
    assert.equal(PHASES.length,5);assert.equal(Object.keys(INPUTS).length,4);
  }catch(error){failure=error;throw error;}finally{ctx.finish(failure);}
  assert.equal(JSON.parse(await readFile(join(directory,'supervisor.json'),'utf8')).status,'succeeded');
  console.log('Windows input diagnostic local supervisor checks passed');
}

async function main(){
  const {values}=parseArgs({options:{phase:{type:'string'},'self-test':{type:'boolean',default:false}}});
  await mkdir(BASE,{recursive:true});
  if(values['self-test'])return selfTest();
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Live diagnostic requires Windows x64; use --self-test for local supervisor checks');
  if(values.phase==='summary')return summary();
  if(!PHASES.includes(values.phase))throw Error(`Choose --phase ${PHASES.join('|')}|summary`);
  const ctx=phaseContext(values.phase);let failure;
  try{if(values.phase==='environment')await environment(ctx);else await restore(ctx);}
  catch(error){failure=error;throw error;}finally{ctx.finish(failure);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{await main();}catch(error){console.error(error.stack??error);process.exitCode=1;}
}
