# Office page bridge version 1

This is an additive engine extension. The upstream `craft-web-host` version 1 bridge remains unchanged. The four upstream pinned releases do not supply this extension; a host must report their automation and durable-save support as unavailable.

## Transport and negotiation

The existing app page runs in a same-origin iframe at `index.html?host=parent`. Both peers require `event.source` to equal the expected parent/child window and `event.origin` to equal their own HTTP(S) origin. Never use `*` or a `null` origin. The host receives `<app>:ready`, answers `<app>:host` with `{version:"1",handoff:false}`, and posts:

```js
{type:"wordcraft:office", protocol:"office", version:1,
 sessionId:"random-host-session-token", kind:"hello"}
```

Use the actual app ID for each engine. Every extension message has those same `type`, `protocol`, `version`, and `sessionId` fields. The engine binds the first valid hello's token to that frame lifecycle, then responds:

```js
{type:"wordcraft:office", protocol:"office", version:1,
 sessionId:"random-host-session-token", kind:"ready", revision:0,
 capabilities:{methods:["office.open","office.commands","office.execute",
   "office.inspect","office.render","office.export","office.save","office.close"],
   revisions:true, durableSave:true}}
```

Advertise only implemented methods; `durableSave:true` requires the entire save protocol below. A ready message is final for that frame lifecycle. The engine must not advertise methods merely because controls appear in the GUI. The host falls back to legacy-only capabilities if no extension answers promptly; a later first extension ready may upgrade them.

## Requests and revisions

Host requests carry `kind:"request", id:string, method:string, params:object`. Methods on the wire use `office.*`. Public JavaScript helpers may accept unprefixed names. Engine responses carry `kind:"response", id, ok:true, result` or `ok:false,error:{code,message}`. Both include the authoritative current integer `revision`.

- `office.open({name,bytes,expectedRevision?})` opens bytes in the visible engine's actual document and answers only after parsing/replacing succeeds. Result includes `{sessionId,app,revision,confirmed:true}`. No success before opening finishes.
- `office.commands({query?})`, `office.inspect(params)`, `office.render(params)`, and `office.export({format,...})` query that same document; export returns `{bytes,name,mimeType?,revision}` without altering dirty state.
- `office.execute({command,params,expectedRevision?})` executes on the visible document. The engine checks `expectedRevision` atomically before mutation and answers `STALE_REVISION` on mismatch.
- `office.save({expectedRevision?,saveAs?})` follows the durable-save protocol. It must not answer successfully when bytes have merely been posted to the parent.
- `office.close()` closes the document only; host transport teardown is separate.

Increment revision monotonically for every document change, including human edits, undo/redo, automation, and successful document replacement. Post `kind:"revision",revision,dirty:boolean` after each change. Host synthetic counters cannot substitute. Send `kind:"cancel",id` to cancel a request; an engine unable to cancel before mutation must return the committed revision, never assert that cancellation rolled back edits.

Post the authoritative revision/dirty event before the corresponding successful response. A response that advances beyond the latest state notification makes the host conservatively dirty until authoritative state catches up. Save success follows durable host acknowledgement and settlement of the engine's own dirty state.

## Durable saves

To store a snapshot, post an extension message with `kind:"save",id:string,name:string,bytes:ArrayBuffer,revision:number,saveAs:boolean,requestId?:string`. The save ID is unique for the frame lifecycle. `requestId` correlates an `office.save` request. Human File > Save has no request ID. The engine keeps the document dirty while awaiting acknowledgement.

The host calls `host.writeFileAtomic({sessionId,name,bytes,saveAs,revision,signal})` and awaits its completion. Success posts `kind:"saved",id,revision`; failure posts `kind:"save-failed",id,revision,error:{code,message}`. The host never clears dirty on an older acknowledgement. The engine clears dirty only if the acknowledged snapshot revision still equals the current revision, and answers its pending `office.save` request only after `saved`. A failed write leaves dirty and fails the corresponding request. Duplicate IDs must not write twice. Save operations are serialized in the host to avoid an older write replacing a newer snapshot.

Upstream legacy `<app>:save` with an ID can receive `<app>:saved` only after a durable write, but has no authoritative revisions. Legacy saves without IDs get no acknowledgement and cannot establish durable-save capability. They may be written by the host while it reports that engine cleanliness is unverified.

If a linked `office.save` request is cancelled, times out, or otherwise fails before acknowledgement, the host aborts its storage callback and posts `save-failed` for each accepted linked save ID. A queued linked writer is skipped. An active callback may already have persisted bytes; failure does not claim rollback, and no later `saved` is sent for that ID. A late save event referencing a cancelled or already-settled request is rejected before storage. Request IDs are never reused. Engines must retain dirty state after these failures, and hosts must wait for a non-cooperating old writer to settle before starting later writes that might target the same file.

## Implementation hook

Install the extension in the generated WASM page glue, not a replacement editor. Route commands to the engine's existing live control channel; if `window.<app>.request` exists, normalize its `{ok,result}` / `{ok:false,error}` response. Implement revision and save hooks inside the actual document state owner. Forwarding a method to a nonexistent page API is unsupported. No untrusted document content may select host callbacks or execute JavaScript.

Requests, byte payloads, queues, timeouts, and IDs are bounded by host settings. A runtime document larger than the host's declared limit fails explicitly. Errors contain bounded diagnostics and must not embed document bytes, paths, or secrets. Browser source/origin checks are routing protection; a same-origin editor is trusted host code and is not isolated from its embedding page.
