async (page) => {
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const denied=[];const route=async route=>{const host=new URL(route.request().url()).hostname;if(host==='127.0.0.1'||host==='localhost')await route.continue();else{denied.push(route.request().url());await route.abort('blockedbyclient');}};
  await page.route('**/*',route);
  try{
    const origin=new URL(page.url()).origin==='http://127.0.0.1:8921'?'http://127.0.0.1:8921':'http://127.0.0.1:8920';
    await page.goto(origin+'/__qualification/host?app=wordcraft');
    await page.waitForFunction(()=>window.conformance?.ready,{timeout:30000});
    const report=await page.evaluate(async()=>{
      const assert=(condition,message)=>{if(!condition)throw Error(message);};
      const e=window.conformance.editor,marker='Word real WASM qualification 2026';
      const capabilities=e.capabilities();assert(capabilities.pageCommands&&capabilities.revisions&&capabilities.confirmedOpen&&capabilities.durableSave,'Required real bridge capabilities absent');
      assert(!capabilities.methods.includes('office.render'),'Unimplemented render must remain unadvertised');
      const opened=await e.open({name:'Qualification.docx',bytes:new ArrayBuffer(0)});assert(opened.confirmed,'Actual parser did not confirm open');
      const original=e.state().revision;await e.execute('text.insert',{text:marker},{expectedRevision:original});
      assert(e.state().revision>original&&e.state().dirty,'Edit must advance authoritative revision and stay dirty');
      assert(JSON.stringify(await e.inspect()).includes(marker),'Inspect must see edited document');
      let dirtyOpen;try{await e.open({name:'MustNotReplace.docx',bytes:new ArrayBuffer(0)});}catch(error){dirtyOpen=error.code;}
      assert(dirtyOpen==='UNSAVED_CHANGES'&&e.state().dirty&&JSON.stringify(await e.inspect()).includes(marker),'Host open replaced or hid the dirty document');
      let stale;try{await e.execute('text.insert',{text:'STALE'},{expectedRevision:original});}catch(error){stale=error.code;}
      assert(stale==='STALE_REVISION','Stale edit accepted');
      const originalFetch=window.fetch;window.__qualificationFetch=originalFetch;
      window.fetch=async function(url,options){if(String(url).includes('/__qualification/save'))throw Error('Deliberate storage failure');return originalFetch.call(this,url,options);};
      let failed;try{await e.save({expectedRevision:e.state().revision});}catch(error){failed=error.code;}finally{window.fetch=originalFetch;}
      assert(failed==='SAVE_FAILED'&&e.state().dirty,'Failed save cleared dirty or succeeded');
      const saved=await e.save({expectedRevision:e.state().revision});assert(saved.saved&&!e.state().dirty,'Retry did not settle the real engine clean');
      await e.execute('text.insert',{text:' Before delayed save'},{expectedRevision:e.state().revision});
      const snapshot=e.state().revision;
      window.fetch=function(url,options){if(!String(url).includes('/__qualification/save'))return originalFetch.call(this,url,options);return new Promise((resolve,reject)=>{window.__releaseQualificationSave=()=>originalFetch.call(this,url,options).then(resolve,reject);});};
      window.__qualificationPendingSave=e.save({expectedRevision:snapshot}).then(result=>{window.__qualificationSaveResult=result;return result;});
      return {schemaVersion:2,app:'wordcraft',actualWasm:true,capabilities,confirmedOpen:true,programmaticEdit:true,dirtyReplacementRefused:true,staleRevisionRejected:true,failedSaveRemainedDirty:true,saveRetrySucceeded:true,pendingSnapshot:snapshot,marker};
    });
    await page.waitForFunction(()=>typeof window.__releaseQualificationSave==='function',{timeout:10000});
    const beforeUi=await page.evaluate(()=>window.conformance.editor.state());assert(beforeUi.dirty,'Pending host write must remain dirty');
    const pendingOpen=await page.evaluate(async()=>{try{await window.conformance.editor.open({name:'PendingReplacement.docx',bytes:new ArrayBuffer(0)});return 'accepted';}catch(error){return error.code;}});
    assert(pendingOpen==='UNSAVED_CHANGES','Open during an unacknowledged write must be refused');
    const frame=page.frames().find(frame=>frame.url().includes('/office/apps/wordcraft/'));
    assert(frame,'Real WASM frame absent');await frame.locator('canvas').click();await page.keyboard.press('ControlOrMeta+End');await page.keyboard.type(' Human keyboard evidence',{delay:8});
    await page.waitForFunction(revision=>window.conformance.editor.state().revision>revision,report.pendingSnapshot,{timeout:10000});
    const concurrent=await page.evaluate(async()=>{
      const e=window.conformance.editor;window.__releaseQualificationSave();
      const older=await window.__qualificationPendingSave;window.fetch=window.__qualificationFetch;
      if(!e.state().dirty||older.savedRevision>=e.state().revision)throw Error('Older host save cleared newer human edits');
      const text=JSON.stringify(await e.inspect());if(!text.includes('Human keyboard evidence'))throw Error('Human keyboard edit absent from real document');
      const saved=await e.save({expectedRevision:e.state().revision});if(!saved.saved||e.state().dirty)throw Error('Newer snapshot did not settle clean');
      await e.execute('text.insert',{text:' UI save evidence'},{expectedRevision:e.state().revision});
      window.__releaseQualificationSave=null;
      window.fetch=function(url,options){if(!String(url).includes('/__qualification/save'))return window.__qualificationFetch.call(this,url,options);return new Promise((resolve,reject)=>{window.__releaseQualificationSave=()=>window.__qualificationFetch.call(this,url,options).then(resolve,reject);});};
      return {humanUiEdit:true,oldSavePreservedNewerEdits:true,revision:e.state().revision};
    });
    await frame.locator('canvas').focus();await page.keyboard.press('ControlOrMeta+s');
    await page.waitForFunction(()=>typeof window.__releaseQualificationSave==='function',{timeout:10000});
    assert((await page.evaluate(()=>window.conformance.editor.state())).dirty,'UI save must wait for host acknowledgement');
    await page.evaluate(()=>{window.__releaseQualificationSave();window.fetch=window.__qualificationFetch;});
    await page.waitForFunction(()=>window.conformance.editor.state().dirty===false,{timeout:10000});
    const final=await page.evaluate(async()=>{
      const e=window.conformance.editor;
      await e.execute('text.insert',{text:' Unsaved export stays dirty'},{expectedRevision:e.state().revision});
      const pdf=await e.export({format:'pdf'});const data=new Uint8Array(pdf.bytes);
      if(String.fromCharCode(...data.slice(0,4))!=='%PDF'||!e.state().dirty)throw Error('PDF copy export corrupted format or cleared source dirty state');
      const docx=await e.export({format:'docx'});if(!(docx.bytes instanceof ArrayBuffer))throw Error('Export did not return real bytes');
      let dirtyOpen;try{await e.open({name:'ExportMustNotReplace.docx',bytes:docx.bytes});}catch(error){dirtyOpen=error.code;}
      if(dirtyOpen!=='UNSAVED_CHANGES'||!e.state().dirty)throw Error('Copy export allowed dirty replacement');
      await e.save({expectedRevision:e.state().revision});if(e.state().dirty)throw Error('Save before replacement failed');
      const opened=await e.open({name:'Roundtrip.docx',bytes:docx.bytes});if(!opened.confirmed)throw Error('Reopen not confirmed');
      const content=JSON.stringify(await e.inspect());for(const text of ['Word real WASM qualification 2026','Human keyboard evidence','UI save evidence','Unsaved export stays dirty'])if(!content.includes(text))throw Error('Export/reopen lost '+text);
      return {uiSaveAwaitedAcknowledgement:true,pendingWriteReplacementRefused:true,pdfExport:true,copyExportPreservedDirty:true,docxExportReopenPreservedContent:true,finalState:e.state(),receipts:window.conformance.saves.map(({path,...receipt})=>receipt),errors:window.conformance.errors.map(error=>({code:error.code}))};
    });
    const engineResource=await frame.evaluate(()=>performance.getEntriesByType('resource').map(entry=>entry.name).find(url=>url.endsWith('.wasm')));
    assert(engineResource,'Loaded WASM resource was not observed');
    const servedWasmSha256=await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join(''),engineResource);
    const result={...report,...concurrent,...final,servedWasmSha256,externalRequestsDenied:denied,passed:true,limits:['Chromium on macOS ARM64; not private WebView acceptance','Development WASM profile, optimization separate','Host callback acknowledgement semantics; no power-loss durability claim','Not full Microsoft Word parity']};
    await page.evaluate(result=>{window.__wordQualificationReport=result;},result);
    return result;
  }finally{await page.unroute('**/*',route);}
}
