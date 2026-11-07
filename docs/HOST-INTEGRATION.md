# Add the components to the existing desktop host

Use the reviewed WASM component archive for visible editing and the matching native archive for headless workers. Extract each into its own directory and verify its complete MANIFEST.json. Source, native workers, WASM pages and offline rebuild inputs have separate identities; consult each archive's PROVENANCE.json. The qualification fixture is a developer test, not a desktop application.

Mount the packaged handler in the Node application's existing HTTP request handler:

```js
import {join} from 'node:path';
import {createAssetHandler} from '/absolute/wasm-bundle/host/asset-handler.mjs';

const handleOfficeAssets=createAssetHandler({
  webRoot:join(wasmBundle,'web'),
  browserPackageRoot:join(wasmBundle,'sdk/browser'),
});
// Inside the existing async request handler:
if(await handleOfficeAssets(req,res))return;
```

In the existing renderer, use the served module and the existing tab container:

```js
import {mountOfficeEditor} from '/office/sdk/index.mjs';
const editor=mountOfficeEditor({
  container:existingEditorElement,
  app:'wordcraft', // pdfcraft, deckcraft or gridcraft
  assetBaseUrl:'/office/apps',
  host:{
    writeFileAtomic:snapshot=>approvedStorageBridge.writeAtomic(snapshot),
    onDirty:state=>existingTab.setDirty(state.dirty),
    onError:error=>existingNotifications.show(error.code),
  },
});
await editor.ready;
// Wait for the live page declaration before using command/durable-save APIs.
const required=['office.open','office.commands','office.execute','office.inspect',
  'office.export','office.save','office.close'];
const deadline=performance.now()+90_000;
for(;;){
  const caps=editor.capabilities();
  if(caps.ready&&caps.pageCommands&&caps.confirmedOpen&&caps.revisions&&
    caps.durableSave&&required.every(method=>caps.methods.includes(method)))break;
  if(editor.state().closed)throw Error('Editor closed during initialization');
  if(performance.now()>=deadline)throw Error('Live editor capabilities unavailable');
  await new Promise(resolve=>setTimeout(resolve,25));
}
await editor.open({name:approvedDisplayName,bytes:approvedDocumentBytes});
```

The initial `ready` promise may describe legacy messaging support after the SDK's compatibility window. A compiled page can announce its live capabilities later. The bounded check above uses the actual page declaration before enabling document tools; a timeout must remain an initialization failure. Delayed, absent and incomplete declarations are exercised by the source3 qualification fixture.

The renderer and iframe must share the same HTTP(S) origin; opaque file URLs do not qualify. Serve the exact generated files and preserve the handler's WASM MIME and script policy. A storage callback must resolve only after the approved destination accepts the bytes, reject on failure, and honor its signal. The host owns path grants, Save As destination selection, effect permissions and IPC. Do not grant arbitrary renderer filesystem access.

For machine tools, import sdk/node/index.mjs in the Node process. Create one createOfficeIntegration with host.authorizeEffect and either the matching runtime/bin workers or host-controlled live transport proxies. Add its nine office.tools descriptors beside the existing tools; route calls to office.callTool(name,args,options). The proxy contract is request(method,params,options) plus close(); preserve binary bytes, stable error codes and cancellation through the private IPC. Live tools must control the same mounted editor as human edits. See the packaged Node README and browser ENGINE-PROTOCOL.md for exact contracts.

Configure the derived Sheets worker with filesystemPolicy:'automation-roots'. No implicit unconfined fallback is enabled. Native workers and UI pages own separate documents unless the host explicitly uses a live transport; choose the intended document owner for each tool session.

Before removing a tab, request office.close and handle UNSAVED_CHANGES or UNCOMMITTED_DRAFT through the existing save/discard flow. Calling editor.close() or editor.dispose() tears down the transport and iframe; it is not a save confirmation. Call office.dispose() during Node host teardown.

The developer checks scripts/qualify-web-components.mjs and scripts/qualify-node-web.mjs use actual compiled pages, synthetic files and explicit storage/proxy fixtures. Run them against the exact extracted bundle with its own sdk/browser directory served and its own sdk/node directory selected. Playwright/Chromium are developer test prerequisites, not runtime dependencies. Their passing results do not establish private-host IPC, corporate Windows 11, full file fidelity or Microsoft/Adobe feature parity. The host source can remain private; its owner can run the same contract and provide sanitized results.
