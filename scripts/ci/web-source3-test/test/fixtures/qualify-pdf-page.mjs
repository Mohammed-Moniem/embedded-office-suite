async page => {
  const assert=(value,message)=>{if(!value)throw Error(message);},denied=[];
  const route=async r=>{if(new URL(r.request().url()).hostname==='127.0.0.1')await r.continue();else{denied.push(r.request().url());await r.abort();}};
  await page.route('**/*',route);
  try {
    await page.goto('http://127.0.0.1:8922/__qualification/host?app=pdfcraft');
    await page.waitForFunction(()=>window.conformance?.ready,{timeout:90000});
    const initial=await page.evaluate(async data=>{
      const assert=(value,message)=>{if(!value)throw Error(message);},e=window.conformance.editor;
      const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer;
      const caps=e.capabilities();assert(caps.pageCommands&&caps.confirmedOpen&&caps.revisions&&caps.durableSave,'Live PDF capabilities absent');assert(!caps.methods.includes('office.render'),'Render falsely advertised');
      const opened=await e.open({name:'Qualification.pdf',bytes});assert(opened.confirmed,'Parser did not confirm PDF');
      const start=e.state().revision;await e.execute('document.setInfo',{key:'Title',value:'PDF real WASM qualification'},{expectedRevision:start});
      assert(e.state().dirty&&e.state().revision>start,'Metadata edit did not advance authoritative revision');
      let stale;try{await e.execute('document.setInfo',{key:'Title',value:'STALE'},{expectedRevision:start});}catch(error){stale=error.code;}assert(stale==='STALE_REVISION','Stale PDF command admitted');
      await e.execute('content.addText',{page:0,text:'Real PDF bridge text',rect:[72,600,500,650],size:12});
      await e.execute('pages.rotate',{pages:[0],degrees:90});assert((await e.inspect()).pages[0].rotation===90,'Rotation did not affect visible PDF');
      await e.execute('edit.undo');assert((await e.inspect()).pages[0].rotation===0,'Real undo failed');
      await e.execute('edit.redo');assert((await e.inspect()).pages[0].rotation===90,'Real redo failed');
      let replacement;try{await e.open({name:'Refused.pdf',bytes:Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer});}catch(error){replacement=error.code;}assert(replacement==='UNSAVED_CHANGES'&&e.state().dirty,'Dirty replacement lost owner');
      const copy=await e.export({format:'pdf'});assert(String.fromCharCode(...new Uint8Array(copy.bytes).slice(0,4))==='%PDF'&&e.state().dirty,'Copy export lost PDF or dirty source');
      const fetch=window.fetch;window.__pdfFetch=fetch;
      window.fetch=async function(url,options){if(String(url).includes('/__qualification/save'))throw Error('Deliberate PDF host write failure');return fetch.call(this,url,options);};
      let failed;try{await e.save({expectedRevision:e.state().revision});}catch(error){failed=error.code;}finally{window.fetch=fetch;}
      assert(failed==='SAVE_FAILED'&&e.state().dirty,'Failed PDF write cleared dirty');
      await e.save({expectedRevision:e.state().revision});assert(!e.state().dirty,'Retry did not acknowledge PDF save');
      await e.execute('document.setInfo',{key:'Author',value:'before pending write'});
      window.fetch=function(url,options){if(!String(url).includes('/__qualification/save'))return fetch.call(this,url,options);return new Promise((resolve,reject)=>{window.__releasePdfWrite=()=>fetch.call(this,url,options).then(resolve,reject);});};
      window.__pendingPdfSave=e.save({expectedRevision:e.state().revision});
      return {capabilities:caps,confirmedOpen:true,realMetadataAndTextEdits:true,realRotateUndoRedo:true,staleRejected:true,dirtyReplacementRefused:true,copyExportPreservedDirty:true,failedSaveRetainedDirty:true,retrySucceeded:true};
    },"JVBERi0xLjcKJeLjz9MKNiAwIG9iago8PC9GaWx0ZXIgL0ZsYXRlRGVjb2RlL0xlbmd0aCA3Nj4+CnN0cmVhbQp4nAFBAL7/QlQgL0YxIDExIFRmIDEzLjc1MCBUTCA3MiA3MDkuMDAwIFRkCihQREYgaG9zdCBmaXh0dXJlKSBUaiBUKgpFVArtDxAJCmVuZHN0cmVhbQplbmRvYmoKNyAwIG9iago8PC9UeXBlIC9PYmpTdG0vTiA1L0ZpcnN0IDI3L0ZpbHRlciAvRmxhdGVEZWNvZGUvTGVuZ3RoIDI1NT4+CnN0cmVhbQp4nF2PT2vDMAzF7/sUOrYnRc6fslECa7oxGIXQDgYrPXiJkxqCPWxntN9+stlg9GIj6en39AgyEJAT5EBUQgFU5lCCKAtYr/Ht+qUAGxnkZEds5ag8CzPY1/VdHOswKVgcriacVdAdnK0PMOhLmJ1aYutsP3fKwaLth8bJISxxZ/utDLy0fRCZqIiyFZHIRfWx/GUmy2SFr7r3cCyi4QkbO5sAdKvixykepLNwp3otN/YCx4zrigSs7sUJ98rb2XV8Pe8+W5bHnzhoylLXTDeBMR6qf/GSSZTjYf4MqYo9wo30KmHwRU3fMbrEJ9PZXpsR8F2bR+P1X4NhP0+sagsKZW5kc3RyZWFtCmVuZG9iago4IDAgb2JqCjw8L1Jvb3QgMSAwIFIvSW5mbyAyIDAgUi9JRCBbPDlCQTBENUFBRDA2MTcxNjRBMUQwNzNCMEQ4QzdEQ0Q5PiA8OUJBMEQ1QUFEMDYxNzE2NEExRDA3M0IwRDhDN0RDRDk+XS9UeXBlIC9YUmVmL1NpemUgOS9XIFsxIDIgMl0vSW5kZXggWzAgOV0vRmlsdGVyIC9GbGF0ZURlY29kZS9EZWNvZGVQYXJtcyA8PC9QcmVkaWN0b3IgMTIvQ29sdW1ucyA1Pj4vTGVuZ3RoIDQwPj4Kc3RyZWFtCnicbcYxDQAgEASw/i2gEk0IJnkQwNI06E6Mqrz72abzvolaXIuwBRIKZW5kc3RyZWFtCmVuZG9iagpzdGFydHhyZWYKNTA5CiUlRU9GCg==");
    await page.waitForFunction(()=>typeof window.__releasePdfWrite==='function',{timeout:10000});
    await page.evaluate(async()=>{
      const e=window.conformance.editor;
      await e.execute('document.setInfo',{key:'Author',value:'newer edit after snapshot'});
      window.__releasePdfWrite();await window.__pendingPdfSave;window.fetch=window.__pdfFetch;
      if(!e.state().dirty||(await e.inspect()).metadata.Author!=='newer edit after snapshot')throw Error('Older ACK cleared or replaced later metadata');
      await e.save({expectedRevision:e.state().revision});if(e.state().dirty)throw Error('Newer snapshot failed');
      await e.execute('pages.rotate',{pages:[0],degrees:90});window.__pdfBeforeHuman=e.state().revision;
    });
    const frame=page.frames().find(f=>f.url().includes('/office/apps/pdfcraft/'));assert(frame,'Real PDF frame absent');
    await frame.locator('canvas').click();await page.keyboard.press('ControlOrMeta+z');
    await page.waitForFunction(()=>window.conformance.editor.state().revision>window.__pdfBeforeHuman,{timeout:10000});
    await page.evaluate(async()=>{
      const e=window.conformance.editor;if((await e.inspect()).pages[0].rotation!==90)throw Error('Human Undo did not alter real page rotation');
      window.__releasePdfWrite=null;
      window.fetch=function(url,options){if(!String(url).includes('/__qualification/save'))return window.__pdfFetch.call(this,url,options);return new Promise((resolve,reject)=>{window.__releasePdfWrite=()=>window.__pdfFetch.call(this,url,options).then(resolve,reject);});};
    });
    await frame.locator('canvas').focus();await page.keyboard.press('ControlOrMeta+s');
    await page.waitForFunction(()=>typeof window.__releasePdfWrite==='function',{timeout:10000});assert((await page.evaluate(()=>window.conformance.editor.state())).dirty,'UI PDF save was prematurely clean');
    await page.evaluate(()=>{window.__releasePdfWrite();window.fetch=window.__pdfFetch;});
    await page.waitForFunction(()=>window.conformance.editor.state().dirty===false,{timeout:10000});
    const final=await page.evaluate(async()=>{
      const e=window.conformance.editor,pdf=await e.export({format:'pdf'});await e.open({name:'Reopened.pdf',bytes:pdf.bytes});const doc=await e.inspect();
      if(doc.metadata.Title!=='PDF real WASM qualification'||doc.metadata.Author!=='newer edit after snapshot'||doc.pages[0].rotation!==90)throw Error('Actual exported PDF reopen lost metadata/rotation');
      return {oldAckPreservedNewerEdit:true,humanUndo:true,humanUiSaveAwaitedAck:true,actualPdfReopenPreservedMetadataRotation:true,finalState:e.state(),receipts:window.conformance.saves.map(({path,...receipt})=>receipt),errors:window.conformance.errors.map(({code})=>({code}))};
    });
    const url=await frame.evaluate(()=>performance.getEntriesByType('resource').map(e=>e.name).find(url=>url.endsWith('.wasm')));
    const servedWasmSha256=await page.evaluate(async url=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch(url)).arrayBuffer()))].map(b=>b.toString(16).padStart(2,'0')).join(''),url);
    const report={schemaVersion:1,app:'pdfcraft',actualWasm:true,...initial,...final,servedWasmSha256,externalRequestsDenied:denied,passed:true,limits:['Synthetic PDF in Chromium on macOS ARM64','Not Acrobat parity, all PDF content fidelity, actual private WebView or physical power-loss durability']};
    await page.evaluate(report=>window.__pdfQualificationReport=report,report);return report;
  } finally {await page.unroute('**/*',route);}
}
