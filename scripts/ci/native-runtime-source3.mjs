// Additive source3 exact-public target qualification; original source1 driver is preserved.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {createServer,connect} from 'node:net';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

const platform=process.platform==='win32'&&process.arch==='x64'?'windows-x64':process.platform==='darwin'&&['arm64','x64'].includes(process.arch)?'macos-'+process.arch:null;
assert(platform,'Unsupported target');
const inventoryBytes=await readFile('config/native-progress3.json');
assert.equal(createHash('sha256').update(inventoryBytes).digest('hex'),'148e98e0f46b98a1ffe5ee1aa7954b0f5ae2f34b17064e551234e89657f1f7e3','Code-anchored source3 runtime authority mismatch');
const inventory=JSON.parse(inventoryBytes);
assert.equal(inventory.schemaVersion,1);assert.equal(inventory.kind,'exact-public-source3-native-runtime-authority');
assert.equal(inventory.status,'ADMITTED_REVIEWED_ARCHIVES','Reviewed source3 native archives are pending');
assert.equal(inventory.sourceCommit,'e8e4364c20018abb1222c69b7e50839abfe62644');
assert.equal(inventory.sourceArchiveSha256,'ee369702aa8cf550413d000f58ac88d297ede8da01fade5d4ac3c89a1ddc2e6c');
assert.equal(inventory.sourceManifestSha256,'566d2c34f202c0e33e2bd2049fab086642228e781ebc8585a4c431ea472b9daa');
assert.equal(inventory.sdkAuthoritySha256,'1342d1848bf4134be21b5daf4b18f12167731ba2018a5a8afde5718bda47392f');
const matches=inventory.files.filter(file=>file.platform===platform);assert.equal(matches.length,1,'No unique reviewed runtime for this target');
const runtime=matches[0],apps=['wordcraft','pdfcraft','deckcraft','gridcraft'];
assert.equal(runtime.workers?.length,4);assert.deepEqual(runtime.workers.map(x=>x.app).sort(),[...apps].sort());
assert(Number.isSafeInteger(runtime.bytes)&&runtime.bytes>0);assert(/^[a-f0-9]{64}$/.test(runtime.manifestSha256));
assert(Number.isSafeInteger(runtime.manifestFiles)&&runtime.manifestFiles>0);
for(const worker of runtime.workers)assert(/^[a-f0-9]{64}$/.test(worker.sha256));
const base=resolve('build/native-source3-runtime-ci'),source=join(base,'source'),directory=join(base,'runtime');
await mkdir(source,{recursive:true});await mkdir(directory,{recursive:true});
async function run(command,args,cwd=process.cwd()){const child=spawn(command,args,{cwd,stdio:'inherit',shell:false,windowsHide:true});const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});assert.equal(status,0,'Native runtime qualification command failed');}
async function download(name,sha,expectedBytes){
  assert(/^[a-zA-Z0-9._-]+$/.test(name)&&/^[a-f0-9]{64}$/.test(sha));
  const response=await fetch(`https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.3/${name}`,{signal:AbortSignal.timeout(900000)});assert(response.ok);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,expectedBytes,'Public archive size mismatch');assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);
  const path=join(base,name);await writeFile(path,bytes);return path;
}
const sourceArchive=await download('office-source-progress3-r1.tar.gz',inventory.sourceArchiveSha256,39019135);
const tar=process.platform==='win32'?join(process.env.SystemRoot??'C:\\Windows','System32/tar.exe'):'/usr/bin/tar';
await run(tar,['-xf',sourceArchive,'-C',source]);
const {verifyManifest,sha256}=await import(pathToFileURL(join(source,'scripts/lib/artifacts.mjs')));
assert.equal(await sha256(join(source,'MANIFEST.json')),inventory.sourceManifestSha256);
const sourceManifest=await verifyManifest(source,{expectedKind:'office-source-progress'});assert.equal(sourceManifest.sourceCommit,inventory.sourceCommit);assert.equal(sourceManifest.files.length,4889);
const archive=await download(runtime.name,runtime.sha256,runtime.bytes);await run(tar,['-xf',archive,'-C',directory]);
const manifest=await verifyManifest(directory,{expectedKind:'source-derived-integration-progress',expectedPlatform:platform});
assert.equal(await sha256(join(directory,'MANIFEST.json')),runtime.manifestSha256);assert.equal(manifest.files.length,runtime.manifestFiles);
const provenance=JSON.parse(await readFile(join(directory,'PROVENANCE.json'),'utf8'));
assert.equal(provenance.sourceCommit,inventory.sourceCommit);assert.equal(provenance.sourceManifestSha256,inventory.sourceManifestSha256);assert.equal(provenance.sourceArchiveSha256,inventory.sourceArchiveSha256);
assert.equal(provenance.integrationSdkOrigin?.authoritySha256,inventory.sdkAuthoritySha256);
assert.equal(await sha256(join(directory,'evidence/integration-sdk-authority.json')),inventory.sdkAuthoritySha256);
for(const worker of runtime.workers)assert.equal(await sha256(join(directory,'runtime/bin',worker.app+'-cli'+(platform==='windows-x64'?'.exe':''))),worker.sha256);
const output=join(base,'RESULT.json');
let macNetwork=null;
if(process.platform==='darwin'){
  const server=createServer(socket=>socket.destroy());
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  const port=server.address().port;
  try{
    await new Promise((yes,no)=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();yes();});socket.once('error',no);socket.setTimeout(3000,()=>{socket.destroy();no(Error('Positive loopback probe timed out'));});});
    const code="const net=require('node:net');Promise.all([{host:'127.0.0.1',port:Number(process.argv[1])},{host:'1.1.1.1',port:443}].map(target=>new Promise((yes,no)=>{const socket=net.connect(target);socket.once('connect',()=>{socket.destroy();no(Error('Network allowed'));});socket.once('error',error=>{socket.destroy();if(['EPERM','EACCES'].includes(error.code))yes({host:target.host,error:error.code});else no(error);});socket.setTimeout(3000,()=>{socket.destroy();no(Error('Timeout is not permission denial'));});}))).then(rows=>console.log(JSON.stringify(rows))).catch(error=>{console.error(error);process.exitCode=1;});";
    const profile='(version 1) (allow default) (deny network*)';
    const {stdout}=await promisify(execFile)('/usr/bin/sandbox-exec',['-p',profile,process.execPath,'-e',code,String(port)],{timeout:10000,maxBuffer:16384});
    const rows=JSON.parse(stdout);assert.equal(rows.length,2);assert(rows.every(row=>['EPERM','EACCES'].includes(row.error)));
    macNetwork={schemaVersion:1,passed:true,positiveLoopbackConnected:true,nodeLoopbackDenied:true,nodeDirectIpDenied:true,errors:rows,profile,policy:'Same sandbox-exec deny network* profile inherited by the actual verifier and all four workers'};
    await writeFile(output+'.network.json',JSON.stringify(macNetwork,null,2)+'\n');
  }finally{await new Promise(yes=>server.close(yes));}
}
if(process.platform==='darwin')await run(process.execPath,[join(source,'scripts/verify-extracted-runtime.mjs'),'--directory',directory,'--deny-network','--output',output],source);
else await run('pwsh',['-NoProfile','-File',resolve('scripts/ci/windows-runtime-network-source3.ps1'),'-NodePath',process.execPath,'-SourcePath',source,'-RuntimePath',directory,'-OutputPath',output],source);
const result=JSON.parse(await readFile(output,'utf8'));assert(result.passed&&result.native.allFourRequested);assert.equal(result.native.results.length,4);
for(const worker of runtime.workers){const rows=result.native.results.filter(x=>x.app===worker.app);assert.equal(rows.length,1);assert.equal(rows[0].binarySha256,worker.sha256);assert.equal(rows[0].passed,true);}
const network=process.platform==='win32'?JSON.parse((await readFile(output+'.network.json','utf8')).replace(/^\uFEFF/,'')):macNetwork;
if(process.platform==='win32'){
  assert(network.passed&&network.cleanupVerified&&network.positiveControlConnected&&network.nodeDirectIpDenied&&network.workerRulesVerified===4);
  assert(['EPERM','EACCES'].includes(network.nodeError));
  assert.equal(network.rulesRemoved?.length,5);assert.equal(new Set(network.rulesRemoved.map(row=>row.Name)).size,5);
  assert(network.rulesRemoved.every(row=>row.AbsentFromPersistentAndActiveStore===true));
  assert.deepEqual(network.profilesRestored?.map(row=>row.Name).sort(),['Domain','Private','Public']);
  assert(network.profilesRestored.every(row=>row.Restored===true&&['True','False','NotConfigured'].includes(row.PersistentEnabled)&&['True','False','NotConfigured'].includes(row.ActiveEnabled)));
  assert(network.firewallService?.RequiredAlreadyRunning&&network.firewallService.Initial==='Running'&&network.firewallService.Final==='Running'&&network.firewallService.ChangedByWrapper===false);
  const expectedPrograms=[{Path:process.execPath,Sha256:await sha256(process.execPath)},...await Promise.all(runtime.workers.map(async worker=>({Path:join(directory,'runtime/bin',worker.app+'-cli.exe'),Sha256:worker.sha256})))];
  const normalized=rows=>rows.map(row=>({path:resolve(row.Path).toLowerCase(),sha256:row.Sha256}));
  assert.deepEqual(normalized(network.programIdentities??[]),normalized(expectedPrograms));
  assert.deepEqual(network.rulePrograms?.map(path=>resolve(path).toLowerCase()),expectedPrograms.map(row=>resolve(row.Path).toLowerCase()));
}
else assert(network.passed&&network.positiveLoopbackConnected&&network.nodeLoopbackDenied&&network.nodeDirectIpDenied);
await writeFile(join(base,'PUBLIC-ARCHIVE.json'),JSON.stringify({schemaVersion:1,platform,archive:runtime,sourceCommit:sourceManifest.sourceCommit,manifestSha256:await sha256(join(directory,'MANIFEST.json')),manifestFiles:manifest.files.length,exactPublicArchive:true,exactPackagedSdk:true,passed:true,network:network??result.networkPolicy,limits:['CI runner only; Windows Server is not Windows 11 client acceptance','Not browser/private-harness acceptance or Microsoft/Adobe parity']},null,2)+'\n');
console.log('Exact public native archive and packaged SDK passed: '+platform);
