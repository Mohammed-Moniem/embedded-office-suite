// Copy to scripts/ci/web-source3-test/qualify-public.mjs with the sibling bundle.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {restore,loadConfig} from '../../restore-web-source3.mjs';
import {sha256} from './integrity.mjs';
const {values}=parseArgs({options:{'output-root':{type:'string'},'playwright-module':{type:'string'},'chromium-path':{type:'string'}}});
const bundle=dirname(fileURLToPath(import.meta.url));
const outputRoot=resolve(values['output-root']??'build/web-source3-public-ci');await mkdir(outputRoot,{recursive:true});const run=await mkdtemp(join(outputRoot,'run-'));
const config=await loadConfig(),extracted=join(run,'extracted'),cache=join(run,'cache');
const playwrightPath=values['playwright-module']?resolve(values['playwright-module']):fileURLToPath(import.meta.resolve('playwright'));
const {chromium}=await import(pathToFileURL(playwrightPath));const chromiumPath=values['chromium-path']??chromium.executablePath();
let server;
async function child(script,args,limit=240000){
 const processChild=spawn(process.execPath,[join(bundle,script),...args],{cwd:bundle,shell:false,stdio:['ignore','pipe','pipe']});let output='',expired=false;
 processChild.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});processChild.stderr.on('data',chunk=>{output+=chunk;process.stderr.write(chunk);});
 const timer=setTimeout(()=>{expired=true;processChild.kill('SIGKILL');},limit);
 const code=await new Promise((ok,fail)=>{processChild.once('error',fail);processChild.once('close',ok)}).finally(()=>clearTimeout(timer));assert(!expired,'Qualification child timed out');assert.equal(code,0,output.slice(-5000));
}
try{
 const archive=await restore({mode:'wasm',destination:extracted,cache});
 assert.equal(archive.downloadedAssets.length,1);assert.equal(archive.downloadedAssets[0].source,'anonymous-public-download');assert.equal(archive.downloadedAssets[0].authorizationSent,false);
 assert.equal(await sha256(join(cache,config.publicWasm.sha256)),config.publicWasm.sha256);
 await writeFile(join(run,'PUBLIC-ARCHIVE.json'),JSON.stringify({passed:true,anonymousPublicFetch:true,url:config.publicWasm.url,bytes:config.publicWasm.bytes,sha256:config.publicWasm.sha256,manifestSha256:config.publicWasm.manifestSha256,receipt:archive},null,2)+'\n');
 const integrity=await import(pathToFileURL(join(extracted,'host/artifacts.mjs')));await integrity.verifyManifest(extracted,{expectedKind:'source3-wasm-integration-progress'});
 const authority=JSON.parse(await readFile(join(extracted,'evidence/web-component-authority.json')));assert.equal(await sha256(join(extracted,'evidence/web-component-authority.json')),'2d39da9eaef6c8155a64ecd13238b999addd96a176af4c565556cb41b1504c41');
 const origin='http://127.0.0.1:18947';
 server=spawn(process.execPath,[join(bundle,'serve.mjs'),'--root',extracted,'--port','18947','--saved',join(run,'saved')],{cwd:bundle,shell:false,stdio:['ignore','pipe','pipe']});let serverLog='';server.stdout.on('data',chunk=>serverLog+=chunk);server.stderr.on('data',chunk=>serverLog+=chunk);
 for(let attempt=0;attempt<100;attempt++){try{const response=await fetch(origin+'/__qualification/host?app=wordcraft',{signal:AbortSignal.timeout(1000)});if(response.status===200)break;}catch{}await new Promise(ok=>setTimeout(ok,100));if(attempt===99)throw Error('Fixture failed: '+serverLog);}
 const sdk=await fetch(origin+'/office/sdk/index.mjs');assert.equal(sdk.status,200);assert.equal(createHash('sha256').update(Buffer.from(await sdk.arrayBuffer())).digest('hex'),authority.browserSdkSha256);
 const options=['--origin',origin,'--playwright-module',playwrightPath,'--chromium-path',chromiumPath];
 await child('qualify-web.mjs',[...options,'--artifact-root',extracted,'--browser-sdk',join(extracted,'sdk/browser/index.mjs'),'--output',join(run,'browser.json')]);
 await child('qualify-node.mjs',[...options,'--sdk',join(extracted,'sdk/node'),'--output',join(run,'node.json')]);
 await child('qualify-guard.mjs',[origin,join(run,'deck-guard.json'),playwrightPath,chromiumPath]);
 const json=async name=>JSON.parse(await readFile(join(run,name+'.json'))),browser=await json('browser'),node=await json('node'),guard=await json('deck-guard');
 assert(browser.passed&&browser.actualWasm&&node.passed&&node.actualWasm&&node.actualNodeFacade&&guard.passed);assert.equal(browser.externalRuntimeRequests,0);assert.deepEqual(node.externalRequests,[]);assert.deepEqual(guard.externalRequests,[]);
 assert.equal(browser.results.length,4);assert.equal(node.results.length,4);
 for(const component of authority.components){const b=browser.results.find(x=>x.app===component.app),n=node.results.find(x=>x.app===component.app);assert(b?.passed&&b.actualOpenEditSaveReopen);assert.equal(b.servedWasmSha256,component.wasmSha256);assert.deepEqual(b.externalRequestsDenied,[]);for(const key of ['authorizationDeniedWithoutMutation','staleRejected','failedSaveRemainedDirty','retryClean','actualOpenEditSaveReopen','actualPersistedHostBytesReopened'])assert.equal(n[key],true);assert.equal(n.servedWasmSha256,component.wasmSha256);}
 const [word,pdf,deck,grid]=browser.results;
 for(const key of ['failedSaveRemainedDirty','saveRetrySucceeded','oldSavePreservedNewerEdits','uiSaveAwaitedAcknowledgement','pendingWriteReplacementRefused'])assert.equal(word[key],true,'Word '+key);
 for(const key of ['failedSaveRetainedDirty','retrySucceeded','oldAckPreservedNewerEdit','humanUiSaveAwaitedAck'])assert.equal(pdf[key],true,'PDF '+key);
 for(const key of ['failedWriteRetainedDirty','immediateRetryClean','oldAckPreservedNewerEdit','humanUiSaveAwaitedAck'])assert.equal(deck[key],true,'Deck '+key);
 assert.equal(grid.retry.firstError,'SAVE_FAILED');assert.equal(grid.retry.state.dirty,false);assert.equal(grid.oldAckPreservedNewerEdits,true);assert.equal(grid.stale,'STALE_REVISION');
 assert(guard.noMutation&&guard.noHostWritesForRefusals&&guard.supportedSaveReopenPreservedMarker);assert.deepEqual(guard.unsupportedPublicExports.map(x=>x.format),['ppt','odp','bogus','png','slidecraft','md']);assert(guard.unsupportedPublicExports.every(x=>x.code==='UNSUPPORTED'));
 const reports=[];for(const name of ['PUBLIC-ARCHIVE','browser','node','deck-guard'])reports.push({path:name+'.json',sha256:await sha256(join(run,name+'.json'))});
 const result={schemaVersion:1,passed:true,anonymousPublicArchive:true,archiveSha256:config.publicWasm.sha256,ownPackagedBrowserAndNodeSdk:true,actualAllFourWasm:true,actualOpenEditSaveReopen:true,acknowledgementAndNewerEditCases:true,zeroExternalRuntimeRequests:true,deckSixUnsupportedExportsPreserveOwnership:true,reports,environment:{platform:process.platform,architecture:process.arch,node:process.versions.node,chromium:chromiumPath},limits:['Synthetic local Chromium and Node proxy on recorded CI target only','Public export refusals may occur in SDK/bridge before engine dispatch','No private WebView, Windows11, full product/file parity or power-loss durability claim']};
 await writeFile(join(run,'RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log('Exact public source3 own-SDK qualification passed: '+join(run,'RESULT.json'));
}catch(error){await writeFile(join(run,'RESULT.json'),JSON.stringify({schemaVersion:1,passed:false,error:error.message,environment:{platform:process.platform,architecture:process.arch,node:process.versions.node}},null,2)+'\n');throw error;}
finally{if(server){server.kill('SIGTERM');await new Promise(ok=>{const timer=setTimeout(()=>{server.kill('SIGKILL');ok();},5000);server.once('close',()=>{clearTimeout(timer);ok();});});}}
