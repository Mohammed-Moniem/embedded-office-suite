async page=>{
 const assert=(v,m)=>{if(!v)throw Error(m);},denied=[];
 const route=async r=>{if(new URL(r.request().url()).hostname==='127.0.0.1')await r.continue();else{denied.push(r.request().url());await r.abort();}};
 await page.route('**/*',route);
 try{
  await page.goto('http://127.0.0.1:8930/__qualification/host?app=deckcraft');
  await page.waitForFunction(()=>window.conformance?.ready,null,{timeout:90000});
  const first=await page.evaluate(async()=>{
   const assert=(v,m)=>{if(!v)throw Error(m);},e=window.conformance.editor,caps=e.capabilities();
   assert(caps.pageCommands&&caps.durableSave&&caps.confirmedOpen&&caps.revisions,'Live Deck capabilities missing');
   const fixture=await e.export({format:'pptx'});assert(fixture.bytes.byteLength>100,'Actual initial PPTX absent');
   const opened=await e.open({name:'Parent.pptx',bytes:fixture.bytes});assert(opened.confirmed,'PPTX parser did not confirm open');
   const before=e.state().revision;
   await e.execute('insert.textBox',{text:'Actual Deck parent roundtrip marker'},{expectedRevision:before});
   assert(e.state().dirty&&e.state().revision>before,'Deck text edit not authoritative');
   let stale;try{await e.execute('slide.new',{}, {expectedRevision:before});}catch(error){stale=error.code;}assert(stale==='STALE_REVISION','Stale Deck revision admitted');
   assert(JSON.stringify(await e.execute('slide.inspect')).includes('Actual Deck parent roundtrip marker'),'Visible textbox missing');
   await e.execute('edit.undo');assert(!JSON.stringify(await e.execute('slide.inspect')).includes('Actual Deck parent roundtrip marker'),'Real undo failed');
   await e.execute('edit.redo');assert(JSON.stringify(await e.execute('slide.inspect')).includes('Actual Deck parent roundtrip marker'),'Real redo failed');
   const copy=await e.export({format:'pptx'});assert(e.state().dirty&&new Uint8Array(copy.bytes)[0]===80,'Copy cleared source or lost PPTX');
   let replacement;try{await e.open({name:'Refused.pptx',bytes:copy.bytes});}catch(error){replacement=error.code;}assert(replacement==='UNSAVED_CHANGES','Dirty Deck replacement admitted');
   const fetch=window.fetch;window.__deckFetch=fetch;
   window.fetch=function(url,opts){if(String(url).includes('/__qualification/save'))return Promise.reject(Error('Deliberate Deck host write failure'));return fetch.call(this,url,opts);};
   let failed;try{await e.save();}catch(error){failed=error.code;}finally{window.fetch=fetch;}
   assert(failed==='SAVE_FAILED'&&e.state().dirty,'Failed Deck write cleared work');
   await e.save();assert(!e.state().dirty,'Immediate Deck retry failed');
   await e.execute('insert.textBox',{text:'Snapshot before later edit'});
   window.fetch=function(url,opts){if(!String(url).includes('/__qualification/save'))return fetch.call(this,url,opts);return new Promise((resolve,reject)=>{window.__releaseDeckWrite=()=>fetch.call(this,url,opts).then(resolve,reject);});};
   window.__deckPending=e.save();
   return{capabilities:caps,staleRejected:true,realUndoRedo:true,dirtyReplacementRefused:true,copyRetainedDirty:true,failedWriteRetainedDirty:true,immediateRetryClean:true};
  });
  await page.waitForFunction(()=>typeof window.__releaseDeckWrite==='function',{timeout:10000});
  await page.evaluate(async()=>{
   const e=window.conformance.editor;await e.execute('insert.textBox',{text:'Later Deck edit survives older ACK'});
   window.__releaseDeckWrite();await window.__deckPending;window.fetch=window.__deckFetch;
   if(!e.state().dirty)throw Error('Old Deck ACK cleared newer edit');await e.save();
   await e.execute('slide.new',{title:'Human Undo parent probe'});window.__deckBeforeHuman=e.state().revision;
  });
  const frame=page.frames().find(f=>f.url().includes('/office/apps/deckcraft/'));assert(frame,'Real Deck iframe absent');
  await frame.locator('canvas').click();await page.keyboard.press('ControlOrMeta+z');
  await page.waitForFunction(()=>window.conformance.editor.state().revision>window.__deckBeforeHuman,{timeout:10000});
  await page.evaluate(()=>{window.__releaseDeckWrite=null;window.fetch=function(url,opts){if(!String(url).includes('/__qualification/save'))return window.__deckFetch.call(this,url,opts);return new Promise((resolve,reject)=>{window.__releaseDeckWrite=()=>window.__deckFetch.call(this,url,opts).then(resolve,reject);});};});
  await frame.locator('canvas').focus();await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(()=>typeof window.__releaseDeckWrite==='function',{timeout:10000});
  assert((await page.evaluate(()=>window.conformance.editor.state())).dirty,'UI Deck save prematurely clean');
  await page.evaluate(()=>{window.__releaseDeckWrite();window.fetch=window.__deckFetch;});
  await page.waitForFunction(()=>!window.conformance.editor.state().dirty,{timeout:10000});
  const last=await page.evaluate(async()=>{
   const e=window.conformance.editor,copy=await e.export({format:'pptx'});await e.open({name:'Reopened.pptx',bytes:copy.bytes});
   const slide=await e.execute('slide.inspect');if(!JSON.stringify(slide).includes('Actual Deck parent roundtrip marker')||!JSON.stringify(slide).includes('Later Deck edit survives older ACK'))throw Error('PPTX reopen lost actual text');
   return{finalState:e.state(),reopenedSlide:slide,receipts:window.conformance.saves.map(({path,...rest})=>rest)};
  });
  const url=await frame.evaluate(()=>performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.endsWith('.wasm')));
  const servedWasmSha256=await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join(''),url);
  return{schemaVersion:1,app:'deckcraft',passed:true,actualWasm:true,actualOpenEditSaveReopen:true,...first,...last,servedWasmSha256,oldAckPreservedNewerEdit:true,humanUndo:true,humanUiSaveAwaitedAck:true,externalRequestsDenied:denied,limits:['Synthetic PPTX on macOS ARM64 Chromium','Not PowerPoint fidelity or private WebView acceptance']};
 }finally{await page.unroute('**/*',route);}
}
