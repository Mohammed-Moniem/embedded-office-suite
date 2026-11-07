import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {chromium}=await import(pathToFileURL(resolve(process.argv[4])).href);
const [origin,output]=process.argv.slice(2);assert(origin&&output);
const browser=await chromium.launch({headless:true,executablePath:process.argv[5],args:['--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const external=[];
try{
 const page=await browser.newPage();await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external.push(route.request().url());return route.abort()});
 await page.goto(origin+'/__qualification/host?app=deckcraft');await page.waitForFunction(()=>window.conformance?.ready,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const require=(v,m)=>{if(!v)throw Error(m)},e=window.conformance.editor;
  const seed=await e.export({format:'pptx'});await e.open({name:'Guard control.pptx',bytes:seed.bytes});
  await e.execute('insert.textBox',{text:'Progress3 unsupported export preserves owned deck'});
  const before=JSON.stringify(await e.execute('slide.inspect')),state=e.state(),receipts=window.conformance.saves.length,rejected=[];
  for(const format of ['ppt','odp','bogus','png','slidecraft','md']){
   let code;try{await e.export({format})}catch(error){code=error.code}
   require(code==='UNSUPPORTED','Expected UNSUPPORTED for '+format+', got '+code);rejected.push({format,code});
   require(JSON.stringify(await e.execute('slide.inspect'))===before,'Unsupported export mutated slide');
   require(e.state().dirty&&e.state().revision===state.revision,'Unsupported export changed source ownership/revision');
   require(window.conformance.saves.length===receipts,'Unsupported export wrote host bytes');
  }
  await e.save();require(!e.state().dirty,'Supported current save failed after refusals');
  const copy=await e.export({format:'pptx'});require(new Uint8Array(copy.bytes)[0]===80,'Supported PPTX signature missing');
  await e.open({name:'Guard reopened.pptx',bytes:copy.bytes});
  require(JSON.stringify(await e.execute('slide.inspect')).includes('Progress3 unsupported export preserves owned deck'),'Supported roundtrip lost marker');
  return{passed:true,actualWasm:true,unsupportedPublicExports:rejected,noMutation:true,noHostWritesForRefusals:true,supportedSaveReopenPreservedMarker:true};
 });
 const frame=page.frames().find(f=>f.url().includes('/office/apps/deckcraft/'));
 const wasmUrl=await frame.evaluate(()=>performance.getEntriesByType('resource').find(x=>x.name.endsWith('.wasm')).name);
 result.servedWasmSha256=await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join(''),wasmUrl);
 assert.deepEqual(external,[]);await writeFile(output,JSON.stringify({schemaVersion:1,app:'deckcraft',...result,externalRequests:external,limits:['Public export refusal may occur in SDK/bridge before engine dispatch','Exact current CI WASM source/ZIP binding and separate Rust guard review establish source provenance','Synthetic local Chromium fixture; not arbitrary PowerPoint or private WebView acceptance']},null,2)+'\n');console.log('Actual current Deck public-format guard preserved source; supported save/reopen passed');
}finally{await browser.close()}
