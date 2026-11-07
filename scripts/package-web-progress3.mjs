// Additive source3 WASM delivery. Source/CI authority is fixed; parent package review is separate.
import assert from 'node:assert/strict';
import {readFile,mkdir,cp,writeFile,lstat,realpath} from 'node:fs/promises';
import {join,resolve,dirname,basename,sep} from 'node:path';
import {parseArgs} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {filesIn,sha256,safeRelative,createManifest,verifyManifest,writeZip} from './lib/artifacts.mjs';
import {verifyAppliedPage} from './engines/verify-applied-pages.mjs';
import {engineAssetNotices,copyEngineAssetNotices} from './lib/component-legal.mjs';

const {values}=parseArgs({options:{components:{type:'string'},qualification:{type:'string'},'node-qualification':{type:'string'},'guard-qualification':{type:'string'},output:{type:'string'}}});
assert(values.components&&values.qualification&&values['node-qualification']&&values['guard-qualification']&&values.output,'Provide --components, --qualification, --node-qualification, --guard-qualification and --output');
async function regular(path){assert.equal(await realpath(path),resolve(path),'Canonical regular input required');assert((await lstat(path)).isFile(),'Regular input required');}
for(const path of [values.components,values.qualification,values['node-qualification'],values['guard-qualification']])await regular(path);
const captured=new Map();for(const path of [values.components,values.qualification,values['node-qualification'],values['guard-qualification']])captured.set(path,await readFile(path));
const capturedSha=path=>createHash('sha256').update(captured.get(path)).digest('hex');
const components=JSON.parse(captured.get(values.components));
const qualification=JSON.parse(captured.get(values.qualification));
const nodeQualification=JSON.parse(captured.get(values['node-qualification']));
const guardQualification=JSON.parse(captured.get(values['guard-qualification']));
const pinPath='config/web-component-pins-progress3.json';
await regular(pinPath);
const pinBytes=await readFile(pinPath);
const authoritySha256=createHash('sha256').update(pinBytes).digest('hex');
assert.equal(authoritySha256,'2d39da9eaef6c8155a64ecd13238b999addd96a176af4c565556cb41b1504c41','Fixed source3 web authority changed');
const authority=JSON.parse(pinBytes);
assert.equal(authority.schemaVersion,1);assert.equal(authority.kind,'reviewed-web-component-authority');
assert.equal(capturedSha(values.components),authority.componentsSha256,'Caller component descriptions differ from fixed authority');
assert.equal(capturedSha(values.qualification),authority.qualificationSha256,'Browser qualification is not the fixed capture');
assert.equal(capturedSha(values['node-qualification']),authority.nodeQualificationSha256,'Node qualification differs from fixed capture');
assert.equal(capturedSha(values['guard-qualification']),authority.deckGuardQualificationSha256,'Deck guard qualification differs from fixed capture');
assert.equal(authority.source,'e8e4364c20018abb1222c69b7e50839abfe62644');
assert.equal(authority.sourceArchiveSha256,'ee369702aa8cf550413d000f58ac88d297ede8da01fade5d4ac3c89a1ddc2e6c');
assert.equal(authority.sourceManifestSha256,'566d2c34f202c0e33e2bd2049fab086642228e781ebc8585a4c431ea472b9daa');
assert.equal(authority.runId,42386885242);assert.equal(authority.workflowHead,'9674750d5013cd5c44f52044ec1c944b22b416f6');
assert.equal(authority.status,'BUILDER_FROZEN_PENDING_FRESH_INDEPENDENT_REVIEW');
for(const entry of authority.preservedProgress2){await regular(entry.path);assert.equal(await sha256(entry.path),entry.sha256,'Preserved progress2 input changed');}
const globalDestinations=new Set(['actual-browser-qualification.json','actual-node-qualification.json','actual-deck-guard-qualification.json','web-component-authority.json']);
// Preserve the fixed authority's archived reference identity while executing and
// copying the identical public production helper, never code from build/.
const publicVerifier='scripts/ci/verify-windows-engine-results.mjs';
const evidencePath=entry=>entry.path==='build/windows-ci-verifier/verify-windows-engine-results.mjs'?publicVerifier:entry.path;
for(const entry of authority.globalEvidence){safeRelative(entry.destination);assert(!entry.destination.includes('/')&&!globalDestinations.has(entry.destination),'Reserved or duplicate global evidence destination');globalDestinations.add(entry.destination);await regular(evidencePath(entry));assert.equal(await sha256(evidencePath(entry)),entry.sha256,'Source3/CI evidence changed');}
assert.equal(await sha256(publicVerifier),'fb20294a84d6891da39ce5d8500934cf19a69bedda22b127747cc0097f82b89a','Current CI verifier reference changed');
const {verifyEngineDirectory,validateAuthority}=await import('./ci/verify-windows-engine-results.mjs');
const admittedCI=validateAuthority(JSON.parse(await readFile('build/windows-ci-verifier/authority/ci-engine-pins-windows-progress3.json')),
 JSON.parse(await readFile('build/windows-ci-transfer/run.json')),JSON.parse(await readFile('build/windows-ci-transfer/jobs.json')),JSON.parse(await readFile('build/windows-ci-transfer/artifacts.json')));
const apps=['wordcraft','pdfcraft','deckcraft','gridcraft'];
assert.deepEqual(components.map(c=>c.app).sort(),[...apps].sort(),'Exactly four distinct apps required');
assert.deepEqual(authority.components.map(c=>c.app).sort(),[...apps].sort(),'Exactly four trusted component identities required');
const output=resolve(values.output),stagingRoot=resolve('build/web-progress3/staging');
const inside=(base,file)=>file===base||file.startsWith(base+sep);
async function canonicalDirectory(path){
  let ancestor=path;const suffix=[];
  while(true){
    try{const info=await lstat(ancestor);assert(!info.isSymbolicLink()&&info.isDirectory(),'Symlink or non-directory output ancestor');}
    catch(error){if(error.code!=='ENOENT')throw error;suffix.unshift(basename(ancestor));ancestor=dirname(ancestor);continue;}
    let parent=ancestor;while(dirname(parent)!==parent){parent=dirname(parent);const info=await lstat(parent);assert(!info.isSymbolicLink()&&info.isDirectory(),'Symlink or non-directory output ancestor');}
    return join(await realpath(ancestor),...suffix);
  }
}
const canonicalOutput=join(await canonicalDirectory(dirname(output)),basename(output));
const canonicalStage=await canonicalDirectory(stagingRoot);
assert(!inside(canonicalStage,canonicalOutput),'Web output overlaps staging');
for(const input of ['packages','engines','patches','config','docs/verification','build/engines/support-inputs','build/windows-ci-transfer','build/windows-ci-verifier','build/public-qualification/progress3',...components.map(c=>c.web),values.qualification,values.components,values['node-qualification'],values['guard-qualification'],...authority.preservedProgress2.map(x=>x.path)]){
  const protectedRoot=await realpath(resolve(input));
  assert(!inside(protectedRoot,canonicalOutput)&&!inside(protectedRoot,canonicalStage),'Web output overlaps a protected input');
}
for(const suffix of ['', '.partial', '.json', '.sha256']){
  try{await lstat(output+suffix);throw Error('Refusing existing web output or sidecar');}catch(error){if(error.code!=='ENOENT')throw error;}
}
assert.equal(qualification.passed,true);assert.equal(qualification.actualWasm,true);
assert.equal(qualification.externalRuntimeRequests,0);
assert.equal(nodeQualification.passed,true);assert.equal(nodeQualification.actualNodeFacade,true);assert.equal(nodeQualification.actualWasm,true);assert.deepEqual(nodeQualification.externalRequests,[]);
assert.equal(nodeQualification.nodeSdkEntrySha256,authority.sdk.node.find(file=>file.path==='index.mjs').sha256,'Node report used different SDK');
assert.deepEqual(qualification.results.map(x=>x.app).sort(),[...apps].sort());assert.deepEqual(nodeQualification.results.map(x=>x.app).sort(),[...apps].sort());
assert(guardQualification.passed&&guardQualification.actualWasm&&guardQualification.noMutation&&guardQualification.noHostWritesForRefusals&&guardQualification.supportedSaveReopenPreservedMarker,'Actual current Deck guard check missing');assert.deepEqual(guardQualification.externalRequests,[]);
assert.deepEqual(guardQualification.unsupportedPublicExports.map(x=>x.format),['ppt','odp','bogus','png','slidecraft','md']);assert(guardQualification.unsupportedPublicExports.every(x=>typeof x.code==='string'&&x.code),'Missing format refusal');
const sdkSha=await sha256('packages/browser/index.mjs');
assert.equal(qualification.browserSdkSha256,sdkSha,'Browser qualification SDK differs');
assert.equal(sdkSha,authority.browserSdkSha256,'Browser SDK differs from reviewed authority');
const verified=[],webInventories=new Map();
async function inventoryOf(root){const rows=[];for(const file of await filesIn(root))rows.push({path:file.path,bytes:file.size,mode:file.mode,sha256:await sha256(file.absolute)});return rows;}
for(const kind of ['node','browser'])assert.deepEqual((await inventoryOf('packages/'+kind)).filter(file=>!file.path.split('/').some(part=>part==='test'||part==='node_modules')),authority.sdk[kind],'Complete SDK inventory differs from reviewed authority');
assert.equal(await sha256('scripts/lib/asset-handler.mjs'),authority.assetHandlerSha256,'Asset handler changed');
assert.equal(await sha256('scripts/lib/artifacts.mjs'),authority.artifactHelperSha256,'Artifact integrity helper changed');
assert.equal(await sha256('LICENSE'),authority.integrationLicenseSha256,'Integration licence changed');
for(const component of components){
  const trusted=authority.components.find(c=>c.app===component.app);
  for(const key of ['patchSha256','reviewSha256','wasmSha256','indexSha256'])assert.equal(component[key],trusted[key],'Component differs from reviewed authority: '+key);
  const applied=await verifyAppliedPage(component.app);
  assert.equal(applied.sourceSha256,trusted.sourceSha256,'Production source differs from reviewed authority');
  assert.deepEqual(component.sourceIdentity,applied,'Component source provenance changed');
  assert.deepEqual(applied,trusted.sourceIdentity,'Current source/guard review differs from fixed authority');
  assert.equal(component.reviewScope,trusted.reviewScope,'Scoped review description differs');
  assert.deepEqual(component.ci,trusted.ci,'Current CI binding differs');
  await regular(publicVerifier);
  const identity=Object.fromEntries(['app','platform','artifactId','runId','workflowHead','bytes','sha256'].map(key=>[key,trusted.ci[key]]));
  assert.deepEqual(identity,admittedCI.find(x=>x.app===component.app),'Component differs from actual successful API identity');
  const actualCI=await verifyEngineDirectory({app:component.app,source:resolve('build/public-qualification/progress3/source'),directory:resolve('build/windows-ci-transfer/restored',component.app),zip:resolve('build/windows-ci-transfer/downloads',component.app+'.zip'),identity});
  for(const key of ['sourceSha256','lockSha256','reportSha256','artifactZipSha256','nativeQualificationSha256','artifacts'])assert.deepEqual(actualCI[key],trusted.ci[key],'CI ZIP/source/build binding differs: '+key);
  const extra=[];const destinations=new Set(['independent-review.json','source.patch']);
  for(const file of component.evidence??[]){
    safeRelative(file.destination);assert(!destinations.has(file.destination)&&!file.destination.includes('/'),'Reserved or duplicate auxiliary evidence destination');destinations.add(file.destination);
    assert.equal(await realpath(file.path),resolve(file.path),'Auxiliary evidence must use a regular canonical path');assert((await lstat(file.path)).isFile(),'Auxiliary evidence must be a file');
    extra.push({destination:file.destination,sha256:await sha256(file.path)});
  }
  assert.deepEqual(extra,trusted.evidence,'Auxiliary evidence differs from reviewed authority');
  assert.deepEqual((await engineAssetNotices(join('engines',component.app))).map(({absolute,...file})=>file),trusted.assetNotices,'Engine asset notices changed');
  assert.equal(await sha256(component.patch),component.patchSha256,'Source patch changed');
  assert.equal(await sha256(component.review),component.reviewSha256,'Independent review changed');
  const review=JSON.parse(await readFile(component.review,'utf8'));
  assert.equal(review.evidenceAdequate,'YES');assert.equal(review.objectiveGates,'PASS');assert.equal(review.thresholdVerdict,'PASS');
  const files=await filesIn(component.web);
  const inventory=[];
  for(const file of files)inventory.push({path:file.path,bytes:file.size,mode:file.mode,sha256:await sha256(file.absolute)});
  assert.equal(createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),trusted.webInventorySha256,'Complete web inventory differs from reviewed authority');
  webInventories.set(component.app,inventory);
  const wasm=files.filter(file=>file.path.endsWith('_bg.wasm'));
  assert.equal(wasm.length,1,'Exactly one generated WASM required');
  assert.equal(await sha256(wasm[0].absolute),component.wasmSha256,'Compiled WASM changed');
  assert.equal(await sha256(join(component.web,'index.html')),component.indexSha256,'Compiled page changed');
  const result=qualification.results.find(result=>result.app===component.app);
  assert(result?.passed&&result.actualOpenEditSaveReopen,'Actual per-app browser roundtrip missing');
  assert.equal(result.servedWasmSha256,component.wasmSha256);assert.equal(result.patchSha256,component.patchSha256);
  assert(result.capabilities?.pageCommands&&result.capabilities?.durableSave&&result.capabilities?.confirmedOpen&&result.capabilities?.revisions,'Live capabilities absent');
  const nodeResult=nodeQualification.results.find(result=>result.app===component.app);
  for(const key of ['passed','actualWasm','nodeFacadeAndTools','authorizationDeniedWithoutMutation','staleRejected','failedSaveRemainedDirty','retryClean','actualOpenEditSaveReopen'])assert.equal(nodeResult[key],true,'Actual Node/browser operation missing: '+key);
  assert.equal(nodeResult.servedWasmSha256,component.wasmSha256,'Node qualification served a different WASM');
  if(component.app==='deckcraft')assert.equal(guardQualification.servedWasmSha256,component.wasmSha256,'Deck guard check served different WASM');
  assert(component.sourceIdentity&&typeof component.sourceIdentity==='object','Per-component source identity required');
  verified.push({app:component.app,patchSha256:component.patchSha256,reviewSha256:component.reviewSha256,reviewScope:component.reviewScope,wasmSha256:component.wasmSha256,indexSha256:component.indexSha256,sourceIdentity:component.sourceIdentity,ci:component.ci,files:inventory});
}
const supportRoot=resolve('build/engines/support-inputs');
const supportManifestSha256=await sha256(join(supportRoot,'MANIFEST.json'));
assert.equal(supportManifestSha256,'9a213c32fde8cfbe505364a0f5381587b79e34c2ee9648d1d22e4cd9c518e269','Unexpected embedded support authority');
await verifyManifest(supportRoot,{expectedKind:'captured-support-build-inputs'});
const supportLegal=(await filesIn(join(supportRoot,'support'))).filter(file=>/(?:^|\/)(?:OFL(?:\.txt)?|LICEN[CS]E[^/]*|NOTICE[^/]*|ATTRIBUTION[^/]*|office-input-provenance\.json|[^/]*manifest\.txt)$/i.test(file.path));
assert(supportLegal.some(file=>file.path.includes('b076417')&&file.path.endsWith('/OFL.txt'))&&supportLegal.some(file=>file.path.includes('37827adc')&&file.path.endsWith('/OFL.txt')),'Both embedded font pin notices are required');
const stage=join(stagingRoot,randomUUID());await mkdir(stage,{recursive:true});
for(const file of supportLegal){const destination=join(stage,'licences/embedded-support',file.path);await mkdir(dirname(destination),{recursive:true});await cp(file.absolute,destination);assert.equal(await sha256(destination),await sha256(file.absolute));}
for(const component of components){
  await cp(component.web,join(stage,'web',component.app),{recursive:true});
  const copied=[];
  for(const file of await filesIn(join(stage,'web',component.app)))copied.push({path:file.path,bytes:file.size,mode:file.mode,sha256:await sha256(file.absolute)});
  assert.deepEqual(copied,webInventories.get(component.app),'Copied page differs from frozen input');
  const evidence=join(stage,'evidence',component.app);await mkdir(evidence,{recursive:true});
  await cp(component.review,join(evidence,'independent-review.json'));
  await cp(component.patch,join(evidence,'source.patch'));
  for(const file of component.evidence??[])await cp(file.path,join(evidence,file.destination));
  assert.equal(await sha256(join(evidence,'independent-review.json')),component.reviewSha256,'Copied independent review changed');
  assert.equal(await sha256(join(evidence,'source.patch')),component.patchSha256,'Copied source patch changed');
  for(const file of authority.components.find(c=>c.app===component.app).evidence)assert.equal(await sha256(join(evidence,file.destination)),file.sha256,'Copied auxiliary evidence changed');
  const legal=join(stage,'licences',component.app);await mkdir(legal,{recursive:true});
  for(const name of ['LICENSE-MIT','LICENSE-APACHE','NOTICE','ATTRIBUTION.md'])await cp(join('engines',component.app,name),join(legal,name));
  for(const name of ['licenses','ATTRIBUTION.toml','LICENSES.toml'])try{await cp(join('engines',component.app,name),join(legal,name),{recursive:true});}catch(error){if(error.code!=='ENOENT')throw error;}
  assert.deepEqual(await copyEngineAssetNotices(join('engines',component.app),legal),authority.components.find(c=>c.app===component.app).assetNotices,'Copied engine asset notices changed');
}
for(const kind of ['node','browser']){
  await cp(join('packages',kind),join(stage,'sdk',kind),{recursive:true,filter:path=>!path.split(/[\\/]/).some(part=>part==='test'||part==='node_modules')});
  assert.deepEqual(await inventoryOf(join(stage,'sdk',kind)),authority.sdk[kind],'Copied SDK differs from authority');
}
await mkdir(join(stage,'host'),{recursive:true});await cp('scripts/lib/asset-handler.mjs',join(stage,'host/asset-handler.mjs'));
await cp('scripts/lib/artifacts.mjs',join(stage,'host/artifacts.mjs'));assert.equal(await sha256(join(stage,'host/artifacts.mjs')),authority.artifactHelperSha256);
assert.equal(await sha256(join(stage,'host/asset-handler.mjs')),authority.assetHandlerSha256,'Copied asset handler changed');
await mkdir(join(stage,'evidence'),{recursive:true});await cp(values.qualification,join(stage,'evidence/actual-browser-qualification.json'));
await cp(values['node-qualification'],join(stage,'evidence/actual-node-qualification.json'));
await cp(values['guard-qualification'],join(stage,'evidence/actual-deck-guard-qualification.json'));
await cp(pinPath,join(stage,'evidence/web-component-authority.json'));
for(const [name,expected] of [['actual-browser-qualification.json',authority.qualificationSha256],['actual-node-qualification.json',authority.nodeQualificationSha256],['actual-deck-guard-qualification.json',authority.deckGuardQualificationSha256],['web-component-authority.json',createHash('sha256').update(pinBytes).digest('hex')]])assert.equal(await sha256(join(stage,'evidence',name)),expected,'Copied qualification/authority changed');
for(const entry of authority.globalEvidence){await cp(evidencePath(entry),join(stage,'evidence',entry.destination));assert.equal(await sha256(join(stage,'evidence',entry.destination)),entry.sha256,'Copied source3/CI evidence changed');}
await cp('LICENSE',join(stage,'INTEGRATION-LICENSE.txt'));
assert.equal(await sha256(join(stage,'INTEGRATION-LICENSE.txt')),authority.integrationLicenseSha256,'Copied integration licence changed');
const provenance={schemaVersion:1,kind:'source3-wasm-integration-progress',status:'IN_PROGRESS',sourceCommit:authority.source,sourceArchiveSha256:authority.sourceArchiveSha256,sourceManifestSha256:authority.sourceManifestSha256,workflowRunId:authority.runId,workflowHead:authority.workflowHead,browserSdkSha256:sdkSha,components:verified,supportInputManifestSha256:supportManifestSha256,supportLegalFiles:supportLegal.map(file=>file.path),
  nativeWorkersIncluded:false,sourceAndOfflineInputsIncluded:false,sourceDownload:'https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.3/office-source-progress3-r1.tar.gz',qualificationSha256:authority.qualificationSha256,nodeQualificationSha256:authority.nodeQualificationSha256,deckGuardQualificationSha256:authority.deckGuardQualificationSha256,authoritySha256,limits:['Bounded integration command subsets','Historical page reviews and separately accepted current Deck guard source review are not fresh review of this whole archive','Not Microsoft/Adobe product or file parity','Not actual private Node/WebView harness acceptance','Native workers, source archive and offline rebuild inputs are separate','Windows CI Cargo/Trunk offline flags are not OS network-denial proof','Only recorded browser/OS environments were measured']};
await writeFile(join(stage,'PROVENANCE.json'),JSON.stringify(provenance,null,2)+'\n');
await writeFile(join(stage,'README.md'),'# Source3 four-editor WASM integration components\n\nIN_PROGRESS. Use the existing approved Node/WebView desktop host. Mount sdk/browser/index.mjs and host/asset-handler.mjs with webRoot pointing to web/. Each editor exposes only its bounded supported commands. Import sdk/node/index.mjs in the Node host. This archive contains no native CLI worker, source build kit or standalone launcher. Exact source3 Rust code and rebuild inputs are separate GitHub assets; PROVENANCE.json records the verified source URL and hashes.\n\nThe host supplies storage, file grants and effect permissions. A host write must acknowledge only after successful persistence. Verify every MANIFEST.json entry using host/artifacts.mjs verifyManifest before use. Source3 WASM was compiled in the captured successful Windows all-four default-build workflow; actual browser and Node operation evidence is separately recorded on macOS ARM64 Chromium. Windows CI used Cargo/Trunk offline flags, not OS network denial.\n\nSee PROVENANCE.json and evidence/ for source, CI ZIP/API, SDK and scoped review identities. Deck\'s earlier page-bridge review is historical; its current format-guard source has a separate accepted review and current runtime checks. These are not full Office/Adobe equivalence, arbitrary-file fidelity, private WebView acceptance or fresh whole-package independent approval. No proprietary Microsoft/Adobe UI, fonts or example documents are included.\n');
const manifest=await createManifest(stage,{kind:provenance.kind,status:'IN_PROGRESS',qualification:'BOUNDED_BROWSER_COMPONENTS'});
await verifyManifest(stage,{expectedKind:provenance.kind});await mkdir(dirname(output),{recursive:true});
const archive=await writeZip(stage,output);await writeFile(output+'.sha256',`${archive.sha256}  ${basename(output)}\n`);
const result={...archive,kind:provenance.kind,status:'IN_PROGRESS',manifestSha256:await sha256(join(stage,'MANIFEST.json')),files:manifest.files.length,stage};
await writeFile(output+'.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
