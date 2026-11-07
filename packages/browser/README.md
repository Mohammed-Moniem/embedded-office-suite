# Browser embedding SDK

This zero-dependency ESM package mounts the actual generated Craft WASM page in an existing WebView. It creates no desktop app. Serve the editor assets and SDK from the same HTTP(S) origin; opaque `file:` and cross-origin frames are rejected.

```js
import { mountOfficeEditor } from './packages/browser/index.mjs';

const editor = mountOfficeEditor({
  container: document.querySelector('#document-editor'),
  app: 'wordcraft',
  assetBaseUrl: '/office/apps',
  host: {
    // Delegate this to the private harness's existing storage bridge.
    writeFileAtomic: snapshot => existingStorage.writeAtomic(snapshot),
    onDirty: state => existingTabs.setUnsaved(state.sessionId, state.dirty),
    onError: error => existingNotifications.error(error.code),
  },
});
const capabilities = await editor.ready;
const opened = await editor.open({ name: 'Report.docx', bytes: documentBytes });
if (!opened.confirmed) {
  // Legacy delivery only. Do not present this as a confirmed automation session.
  existingNotifications.info('Document sent; this engine has no confirmed-open API.');
}
if (capabilities.methods.includes('office.commands')) {
  const catalog = await editor.commands({ query: 'table' });
}
// When the existing tab is removed:
// editor.dispose();
```

`createPageTransport({app,targetWindow,hostWindow,origin,host})` binds an already-mounted engine frame. It exposes `{request(method,params,{signal,timeoutMs}),close()}` for the Node facade and `kind:'browser'`. Both `execute` and `office.execute` normalize to `office.execute` on the wire. The facade must require a confirmed open and authoritative engine revisions before treating a legacy frame as an automation session.

`request('office.capabilities')` and `request('office.state')` are local capability/state queries. Other methods require explicit engine negotiation and fail with `UNSUPPORTED` when absent. `ready` means the editor can receive messages. It does not imply automation, file-format fidelity, or durable saves. The SDK does not inject a substitute UI or manufacture document revisions.

Pinned upstream releases provide the legacy open/save/dirty protocol. Reviewed derivative builds implement the additional command/revision/durable-save contract in [ENGINE-PROTOCOL.md](./ENGINE-PROTOCOL.md); command coverage is bounded by each actual page's negotiated catalog. Original upstream saves without IDs may clear the engine's dirty flag before host storage finishes. The adapter conservatively keeps its own dirty state after legacy saves and reports durability as `unverified`. Check the selected archive's per-app provenance and acceptance evidence.

Save writes are serialized. The host must implement `writeFileAtomic` using its approved durable/atomic storage policy; an adapter cannot make a callback atomic. An `office.save` result is accepted only after that request produced a matching save event and storage acknowledgement. Newer revisions remain dirty when an older snapshot finishes. A failed save rejects the request and preserves dirty state. File names are reduced to safe display basenames; the renderer never receives arbitrary filesystem access.

Default bounds: 32 MiB documents, 34 MiB messages, 32 pending requests, 8 queued saves, 10,000 unique save IDs per frame, 15-second requests and 30-second readiness. Tune the corresponding options for approved larger documents. Incoming structures are also bounded to depth 32 and 100,000 values. Timeouts and cancellation mean the caller stopped waiting; dispatched edits may already have committed.

A cancelled or timed-out requested save never starts its queued host writer. An active linked writer receives an abort signal immediately, and the engine receives `save-failed`; that save ID cannot later receive `saved`. A writer that ignores cancellation may still persist bytes, so the document remains dirty and later writes stay serialized behind its actual settlement. Cancelling one requested save leaves preceding and following human saves in their original order. Disposal also aborts active writers. Recent rejected request IDs are remembered in a bounded set; evicted or otherwise stale IDs remain invalid and can never start a write.

Messages require exact source, origin, app and session token. Unsupported protocol versions are ignored. Frame navigation after the initial load disposes the transport; explicitly remount a fresh session. Teardown removes listeners, cancels pending calls, aborts host writes, and removes the mounted iframe. Host observer exceptions cannot break lifecycle cleanup. Engine diagnostics are reduced to stable bounded errors so arbitrary document contents are not exposed through logs.

A same-origin editor is trusted code with the embedding origin's privileges. These routing checks do not isolate hostile scripts or create an OS sandbox. The SDK does not expose print, certificate access, pickers, arbitrary native effects, or cross-editor handoff; those capabilities require a separately authorized host integration and must not be silently emulated.

Run `node --test packages/browser/test/*.test.mjs` from the repository root. See [VERIFICATION.md](./VERIFICATION.md) for the evidence boundary.
