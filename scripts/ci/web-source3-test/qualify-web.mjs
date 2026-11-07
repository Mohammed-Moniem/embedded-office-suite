// Developer qualification; Playwright is a test-only prerequisite, never a host runtime dependency.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {sha256} from './integrity.mjs';
const {values}=parseArgs({options:{origin:{type:'string'},output:{type:'string'},'artifact-root':{type:'string'},'browser-sdk':{type:'string'},'playwright-module':{type:'string'},'chromium-path':{type:'string'}}});
assert(values.origin&&values.output,'Provide --origin and --output');
const origin=new URL(values.origin);assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.protocol,'http:');
const module=values['playwright-module']?pathToFileURL(resolve(values['playwright-module'])).href:'playwright';
const {chromium}=await import(module);
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--disable-dev-shm-usage'],...(values['chromium-path']?{executablePath:values['chromium-path']}:{})});
const authority=JSON.parse(await readFile(resolve(values['artifact-root'],'evidence/web-component-authority.json')));
const results=[];
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 for(const [app,name,patch] of [['wordcraft','word','wordcraft'],['pdfcraft','pdf','pdfcraft'],['deckcraft','deck','deckcraft'],['gridcraft','grid','gridcraft-page']]){
  await page.goto(origin.origin+'/__qualification/host?app='+app);
  const code=(await readFile(`test/fixtures/qualify-${name}-page.mjs`,'utf8')).replaceAll(/http:\/\/127\.0\.0\.1:\d+/g,origin.origin);
  const callback=new Function('return ('+code+'\n)')();
  const result=await callback(page);
  assert.equal(result.passed,true);assert.equal(result.actualWasm,true);
  const actualOpenEditSaveReopen=result.actualOpenEditSaveReopen===true||result.docxExportReopenPreservedContent===true||result.actualPdfReopenPreservedMetadataRotation===true;
  assert(actualOpenEditSaveReopen,'Actual document roundtrip missing');
  assert.deepEqual(result.externalRequestsDenied,[],'Unexpected external runtime request');
  results.push({...result,actualOpenEditSaveReopen,patchSha256:authority.components.find(c=>c.app===app).patchSha256});
  console.log(`${app}: exact served WASM browser roundtrip passed`);
 }
}finally{await browser.close();}
const report={schemaVersion:1,kind:'four-editor-browser-qualification',passed:true,actualWasm:true,browserSdkSha256:await sha256(resolve(values['browser-sdk']??'packages/browser/index.mjs')),environment:{platform:process.platform,architecture:process.arch,node:process.versions.node,browser:'Playwright Chromium'},externalRuntimeRequests:0,results,limits:['Synthetic bounded command and lifecycle checks','Not file-format or Microsoft/Adobe product parity','Not private Node/WebView acceptance','Host callback persistence acknowledgement; no power-loss guarantee']};
await mkdir(dirname(resolve(values.output)),{recursive:true});await writeFile(values.output,JSON.stringify(report,null,2)+'\n');
console.log('Four-editor exact WASM browser qualification passed');
