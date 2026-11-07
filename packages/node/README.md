# Node integration

Dependency-free ESM for an existing Node 22+ desktop host. This package launches headless Rust MCP workers and connects to already embedded browser transports. It contains no GUI shell and installs no runtime.

```js
import {createOfficeIntegration, createFilesystemHost} from './packages/node/index.mjs';

const host = createFilesystemHost({
  readRoots: ['/approved/documents'],
  writeRoots: ['/approved/output'],
  // Classify the entire command and params. Do not use a blanket allow in a production host.
  authorizeEffect: async ({app, command}) => app === 'wordcraft' && command === 'text.insert',
});
const office = createOfficeIntegration({host, binaries: {
  wordcraft: '/bundle/runtime/bin/wordcraft-cli',
}});
try {
  const document = await office.open({app: 'wordcraft', path: '/approved/documents/report.docx'});
  const changed = await office.execute({sessionId: document.sessionId,
    expectedRevision: document.revision, command: 'text.insert', params: {text: 'Reviewed'}});
  await office.save({sessionId: changed.sessionId, expectedRevision: changed.revision,
    path: '/approved/output/report.docx', saveAs: true});
  await office.close({sessionId: changed.sessionId});
} finally { await office.dispose(); }
```

The host supplies native worker paths. `BinaryConfig` also permits explicit argument prefixes and environment variables; use this only for trusted executable wrappers. It cannot replace the adapter's `mcp` mode or scratch-root flags. Never pass secrets in arguments. The runtime bundle layout belongs to the host; `assetBaseUrl` is metadata and does not download missing assets.

The executable [native example](examples/native-smoke.mjs) opens or creates a document, saves through the filesystem host, and closes. It requires the actual app CLI and an existing output directory. For Windows use absolute Windows paths.

## Authority, sessions, and saves

Each native session owns a dedicated child process, a private scratch directory, and one authoritative document. Host read callbacks supply input bytes; Word, PDF, and Deck workers get scratch-only read and write root flags. Export writes to scratch, reads back bytes, then deletes the output. Host destinations never reach engine tools. Command-based file/session replacement and saves are refused; use `open`, `export`, `save`, and `close` on the facade.

The pinned Grid release CLI has no native read/write root flags: its actual `mcp` parser accepts only `connect`, `in`, and `sample`. Grid native launch is therefore disabled by default. For the separately qualified patched worker, select `{command:'/absolute/patched/gridcraft-cli',filesystemPolicy:'automation-roots'}` explicitly. The adapter then supplies both scratch root flags; selecting that policy for a baseline binary fails without an unconfined fallback. See `patches/gridcraft/README.md` for the patch, provenance and actual runtime evidence. A trusted host can instead explicitly configure `filesystemPolicy:'unconfined-host-reviewed'` (or the legacy `allowUnconfinedWorker:true`) only after reviewing that unconfined worker and its permission policy. Capabilities then report `filesystemPolicy:'unconfined-host-reviewed'`; scratch I/O still protects the facade's own paths, but engine commands are not confined. Native root checks remain distinct from an OS or network sandbox, and three-platform patch qualification is still required.

Native revisions are adapter operation revisions, not upstream document-model versions. Successful commands increment them conservatively, including commands that only change selection or view. A failed engine command also invalidates the old revision because upstream failure does not promise rollback. Commands refused before dispatch do not increment. Dirty state belongs to the adapter, so an engine's successful scratch save cannot clear a failed host save. This model applies only to this dedicated worker; it does not track a separate desktop app, another process, or external edits to source files.

All engine commands need `host.authorizeEffect` to return exactly `true`. Path roots alone cannot control printers, local sockets, system certificate stores, downloading, macros, or every future command. The host must classify the full command and parameters and route approved native effects through its existing permission system. A child process and upstream root checks are not an OS or network sandbox. Use your approved process sandbox if stronger isolation is required. Parameters are copied before authorization; caller or callback mutation cannot change the dispatched command.

`host.writeFileAtomic({sessionId,app,path,name,bytes,revision,saveAs,signal})` must resolve only after its durable write succeeds. Rejection leaves the document dirty. Saves serialize per session while engine edits may continue: an acknowledgement for revision 1 does not clear revision 2. The supplied filesystem host writes an exclusive file in the destination directory, syncs that file, then renames it atomically. It preserves the destination on pre-rename failures. It does not claim parent-directory rename persistence through power loss. Directories must already exist. Canonical root checks refuse escapes and writing through a symlink; they do not defend against a hostile concurrent symlink swap by other software. Callback implementations own their own ACLs and storage guarantees.

`close` refuses dirty documents unless `discardChanges:true`; `dispose` terminates workers and discards unsaved scratch documents. Always call it on host teardown. Every facade call starts one lifetime at admission, defaulting to 30 seconds. Its `timeoutMs` includes queue wait, native initialization and tool discovery, authorization, host reads/writes, transport calls, and save/close waits. Host callbacks receive a derived `signal` and the remaining `timeoutMs`, even when the caller supplied no signal. No stage restarts the budget. `dispose({timeoutMs,signal})` and the optional third `callTool(name,args,options)` argument use the same policy.

Cancellation before dispatch prevents that queued action from starting. An abandoned authorizer or reader cannot later dispatch a command/open. Cancellation during a transport call closes the affected transport and invalidates its session; reopen it to continue. Cancellation after a writer or mutation starts rejects with `TIMEOUT` or `CANCELLED` and `details.outcomeUnknown:true`. An uncooperative host writer may still commit: JavaScript cannot force it to roll back. Its late result never clears dirty state, and its actual pending write retains the session's save-order slot until it settles, preventing an older commit from overtaking a newer save. Subsequent queued operations still have their own bounded caller lifetimes. Disposal aborts active signals and closes workers without awaiting an uncooperative host writer. It cannot claim that the host's external commit stopped. A failed disposal remains failed on repeated calls.

The lower-level stdio request deadline also includes initialization; expiry kills its dedicated worker and rejects other waiting requests. An already-aborted call is rejected before admission and leaves the worker available. No automatic retry occurs. A deadline cannot preempt JavaScript that synchronously blocks the host event loop; the next checkpoint rejects it instead of admitting a late success. Raw stderr is discarded unless the low-level transport's optional `onStderr` callback is provided; that callback must protect any private engine diagnostics. Public errors carry stable codes and safe tool/RPC/exit diagnostics; arbitrary engine error text and document bytes are omitted.

## Existing embedded editor

Use the browser package's transport directly; the facade never launches a detached native copy for that document:

```js
import {createOfficeIntegration} from './packages/node/index.mjs';
// editor is returned by mountOfficeEditor in your existing renderer/WebView.
const office = createOfficeIntegration({
  host: {authorizeEffect: async effect => yourPermissionSystem(effect)},
  transports: {wordcraft: editor},
});
const session = await office.open({app: 'wordcraft', name: 'report.docx', bytes});
```

For an IPC boundary, pass a host-controlled proxy implementing `{request(method,params,options),close()}`. Normalized methods are `office.capabilities`, `office.state`, `office.open`, `office.commands`, `office.execute`, `office.inspect`, `office.render`, `office.export`, `office.save`, and `office.close`, as specified by the browser package's `ENGINE-PROTOCOL.md`. Forward bytes through your existing bridge without granting arbitrary renderer filesystem access.

Live sessions require confirmed opening and authoritative integer revisions from the actual WASM state owner, including human edits. Their save calls delegate entirely to the browser bridge, which owns the actual host write and acknowledgement. The facade never invents live revisions or writes the same save twice. Original pinned upstream WASM releases lack that extension: legacy ready/open messages return `UNSUPPORTED` for live automation. Reviewed derivative pages negotiate `office-page-v1` and advertise only their implemented command subsets. Inspect the particular archive's provenance, qualification and runtime capabilities before enabling tools; a compiled page alone is insufficient.

## Command and tool discovery

`office.tools` contains nine bounded `office.*` descriptors. `office.callTool(name,args)` dispatches only those names and refuses unknown arguments. Add them beside existing harness tools; no global tool registry is modified. `commands({sessionId,query,limit})` returns at most 200 catalog entries and reports truncation. Narrow a query to find more. Tool exports use `bytesBase64`; direct SDK exports use `Uint8Array`. The SDK does not evaluate JavaScript from commands or documents.

Native mappings use the exact pinned upstream tool contracts:

| App | Discovery / execute | Open / create / save | Inspect / render |
|---|---|---|---|
| Word | `list_commands(query)` / `execute(command,params)` | `open_document` / `new_document` / `save_document` | `inspect_document` / `render_page` |
| PDF | `command_list(filter)` / `command_run(id,params)` | `doc_open` / `doc_create` / `doc_save` | `doc_inspect` / `render_preview` |
| Deck | `list_commands(filter)` / `run_command(command,params)` | `open_presentation` / `new_presentation` / `save_presentation` | `inspect_document` / `render_slide` |
| Grid | `list_commands(search)` / `execute_command(command,params)` | `open_workbook` / `new_workbook` / `save_workbook` | `inspect_workbook` / unsupported |

The SDK verifies tool discovery at runtime; a missing mapped tool is `UNSUPPORTED`. Pages follow each engine's native indexing (Word/PDF 1-based, Deck slide index 0-based); their parameter documentation remains authoritative. Grid's upstream MCP screenshot needs a desktop app and is not exposed as headless rendering. PDF non-PDF exports and Word multi-page PNG are intentionally not advertised by this adapter until their output collection is qualified. Conversion and feature availability remain bounded by the actual upstream engine.

## Checks

```sh
node --test packages/node/test/stdio.test.mjs packages/node/test/integration.test.mjs packages/node/test/host.test.mjs packages/node/test/lifetime.test.mjs
tsc --noEmit --strict --lib es2022,dom --module nodenext --moduleResolution nodenext packages/node/index.d.ts
```

Tests launch synthetic MCP child processes to exercise actual pipes, framing, process teardown and the adapter's behavior. They do not establish Office compatibility or actual engine correctness. See `VERIFICATION.md` for observed results and remaining qualifications.
