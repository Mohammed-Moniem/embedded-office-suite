// Qualification proxy only. The private harness supplies its own approved IPC/storage bridge.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {sha256} from './integrity.mjs';
const {values}=parseArgs({options:{origin:{type:'string'},output:{type:'string'},sdk:{type:'string'},'playwright-module':{type:'string'},'chromium-path':{type:'string'}}});
assert(values.origin&&values.output,'Provide --origin and --output');const origin=new URL(values.origin);assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.protocol,'http:');
const sdk=resolve(values.sdk??'packages/node');const {createOfficeIntegration,OfficeError}=await import(pathToFileURL(resolve(sdk,'index.mjs')));
const {chromium}=await import(values['playwright-module']?pathToFileURL(resolve(values['playwright-module'])).href:'playwright');
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--disable-dev-shm-usage'],...(values['chromium-path']?{executablePath:values['chromium-path']}:{})});
const results=[],external=[];
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 await page.route('**/*',r=>{if(new URL(r.request().url()).hostname==='127.0.0.1')return r.continue();external.push(r.request().url());return r.abort();});
 for(const [app,ext,command,params,query,queryParams] of [
  ['wordcraft','docx','text.insert',{text:'Node facade actual Word marker'},'document.text',{}],
  ['pdfcraft','pdf','document.setInfo',{key:'Title',value:'Node facade actual PDF marker'},null,{}],
  ['deckcraft','pptx','insert.textBox',{text:'Node facade actual Deck marker'},'slide.inspect',{}],
  ['gridcraft','xlsx','cell.set',{cell:'A1',input:'Node facade actual Grid marker'},'cell.get',{cell:'A1'}],
 ]){
  await page.goto(origin.origin+'/__qualification/host?app='+app);await page.waitForFunction(()=>window.conformance?.ready,null,{timeout:120000});
  let seed;
  if(app==='pdfcraft'||app==='gridcraft'){
   const code=await readFile(`test/fixtures/qualify-${app==='pdfcraft'?'pdf':'grid'}-page.mjs`,'utf8');const match=code.match(app==='pdfcraft'?/"(JVBER[^"\s]+)"/:/"(UEsDB[^"\s]+)"/);assert(match,'Synthetic fixture missing');seed=Buffer.from(match[1],'base64');
  }else if(app==='wordcraft')seed=new Uint8Array();
  else{const base64=await page.evaluate(async()=>{const d=await window.conformance.editor.export({format:'pptx'});return btoa(Array.from(new Uint8Array(d.bytes),b=>String.fromCharCode(b)).join(''));});seed=Buffer.from(base64,'base64');}
  const proxy={kind:'browser',async request(method,params={},options={}){
   const input={...params};if(input.bytes instanceof ArrayBuffer||ArrayBuffer.isView(input.bytes)){input.__bytesBase64=Buffer.from(input.bytes instanceof ArrayBuffer?new Uint8Array(input.bytes):new Uint8Array(input.bytes.buffer,input.bytes.byteOffset,input.bytes.byteLength)).toString('base64');delete input.bytes;}
   const response=await page.evaluate(async({method,input,timeoutMs})=>{if(input.__bytesBase64!==undefined){input.bytes=Uint8Array.from(atob(input.__bytesBase64),c=>c.charCodeAt(0)).buffer;delete input.__bytesBase64;}try{const result=await window.conformance.editor.request(method,input,{timeoutMs});if(result?.bytes instanceof ArrayBuffer){const {bytes,...rest}=result;return{ok:true,result:rest,bytesBase64:btoa(Array.from(new Uint8Array(bytes),b=>String.fromCharCode(b)).join(''))};}return{ok:true,result};}catch(error){return{ok:false,code:error.code??'PROXY_ERROR'};}},{method,input,timeoutMs:options.timeoutMs});
   if(!response.ok)throw new OfficeError(response.code,'Qualification browser operation failed');
   return response.bytesBase64===undefined?response.result:{...response.result,bytes:Uint8Array.from(Buffer.from(response.bytesBase64,'base64'))};
  },async close(){await page.evaluate(()=>window.conformance.editor.dispose());}};
  let allowed=false,authorizations=0;
  const office=createOfficeIntegration({host:{authorizeEffect:()=>{authorizations++;return allowed;}},transports:{[app]:proxy}});
  try{
   assert.equal(office.tools.length,9);await assert.rejects(office.callTool('office.unknown',{}),{code:'UNKNOWN_TOOL'});
   const doc=await office.open({app,name:'Node facade.'+ext,bytes:Uint8Array.from(seed)});assert.equal(doc.kind,'browser');
   const caps=await office.capabilities({sessionId:doc.sessionId});assert(caps.capabilities.pageCommands&&caps.capabilities.durableSave&&caps.capabilities.revisions);
   const catalog=await office.callTool('office.commands',{sessionId:doc.sessionId,limit:3});assert(catalog.commands.length>0&&catalog.commands.length<=3);
   await assert.rejects(office.execute({sessionId:doc.sessionId,command,params}),{code:'ACCESS_DENIED'});assert.equal((await office.inspect({sessionId:doc.sessionId})).revision,doc.revision);
   allowed=true;const changed=await office.callTool('office.execute',{sessionId:doc.sessionId,command,params,expectedRevision:doc.revision});assert(changed.revision>doc.revision&&changed.dirty);
   await assert.rejects(office.execute({sessionId:doc.sessionId,command,params,expectedRevision:doc.revision}),{code:'STALE_REVISION'});
   await page.evaluate(()=>{window.__nodeOriginalFetch=window.fetch;window.fetch=function(url,opts){if(String(url).includes('/__qualification/save'))return Promise.reject(Error('Deliberate Node/browser host write failure'));return window.__nodeOriginalFetch.call(this,url,opts);};});
   await assert.rejects(office.save({sessionId:doc.sessionId}),{code:'SAVE_FAILED'});assert((await office.inspect({sessionId:doc.sessionId})).dirty);
   await page.evaluate(()=>{window.fetch=window.__nodeOriginalFetch;});const saved=await office.callTool('office.save',{sessionId:doc.sessionId});assert.equal(saved.dirty,false);
   const persistedReceipt=await page.evaluate(()=>window.conformance.saves.at(-1));assert(persistedReceipt?.app===app&&persistedReceipt.path);const bytes=await readFile(persistedReceipt.path);assert.equal(bytes.length,persistedReceipt.bytes);assert.equal(await sha256(persistedReceipt.path),persistedReceipt.sha256);assert(bytes.length>100);assert.equal(bytes.subarray(0,ext==='pdf'?4:2).toString(),ext==='pdf'?'%PDF':'PK');const exported=await office.callTool('office.export',{sessionId:doc.sessionId,format:ext});assert(Buffer.from(exported.bytesBase64,'base64').length>100);
   const reopened=await page.evaluate(async({base64,name})=>window.conformance.editor.open({name,bytes:Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer}),{base64:bytes.toString('base64'),name:'Reopened persisted.'+ext});assert(reopened.confirmed);
   const inspected=query?await office.execute({sessionId:doc.sessionId,command:query,params:queryParams}):await office.inspect({sessionId:doc.sessionId});assert(JSON.stringify(inspected).includes('Node facade actual'),'Actual file reopen lost marker');
   const frame=page.frames().find(f=>f.url().includes('/office/apps/'+app+'/'));const url=await frame.evaluate(()=>performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.endsWith('.wasm')));
   const servedWasmSha256=await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join(''),url);
   await office.close({sessionId:doc.sessionId});results.push({app,passed:true,actualWasm:true,nodeFacadeAndTools:true,authorizationDeniedWithoutMutation:true,staleRejected:true,failedSaveRemainedDirty:true,retryClean:true,actualOpenEditSaveReopen:true,actualPersistedHostBytesReopened:true,persistedReceipt:{app:persistedReceipt.app,id:persistedReceipt.id,bytes:persistedReceipt.bytes,sha256:persistedReceipt.sha256},servedWasmSha256,authorizations});console.log(app+': real Node facade to WASM passed');
  }finally{await office.dispose();}
 }
}finally{await browser.close();}
assert.deepEqual(external,[]);const report={schemaVersion:1,passed:true,actualNodeFacade:true,actualWasm:true,nodeSdkEntrySha256:await sha256(resolve(sdk,'index.mjs')),results,externalRequests:external,environment:{platform:process.platform,architecture:process.arch,node:process.versions.node},limits:['Explicit qualification proxy; not private harness IPC acceptance','Bounded synthetic documents and commands','Not foreign WebView or product/file parity','Proxy cancellation permutations are not established by this fixture']};await mkdir(dirname(resolve(values.output)),{recursive:true});await writeFile(values.output,JSON.stringify(report,null,2)+'\n');console.log('All-four real Node/WASM conformance passed');
