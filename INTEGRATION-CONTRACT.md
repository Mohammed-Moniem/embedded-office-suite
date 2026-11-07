# Embedded Office integration contract, revision 1

Deliverables are embeddable modules and headless Rust CLI workers for an existing private Node/WebView harness. No standalone GUI executable, shell, installer, replacement harness, or modification of Jarvis is part of this project.

## Packages and ownership

- `packages/node/`: zero-runtime-dependency ESM Node adapter. Export `createOfficeIntegration`, `createStdioTransport`, and a filesystem host helper. Node >=22. No native addon or WebView package dependency.
- `packages/browser/`: zero-dependency browser ESM adapter. Export `mountOfficeEditor` and `createPageTransport`. Work in an existing WebView, using a same-origin iframe and the existing host bridge; never open an independent window.
- `engines/<app>/`: pinned Rust sources for wordcraft, pdfcraft, deckcraft, gridcraft. Native CLI workers use their existing MCP JSON-RPC 2.0 stdio services. Existing native GUI source may be needed for shared code but is not built or distributed as a deliverable.
- `config/upstreams.json`: pinned provenance and release asset names, owned by the driver.
- `scripts/engines/`, `docs/engines/`: source/runtime acquisition, build, vendoring, and engine qualification, owned by the engines leaf.
- `scripts/`, root metadata/docs, package assembly, integration tests, and public releases: driver, excluding the engines subtree above.

## Stable application IDs and routing

Application IDs: `wordcraft`, `pdfcraft`, `deckcraft`, `gridcraft`. Source formats: DOCX, PDF, PPTX, XLSX respectively. Neither UI nor agent content is executed as JavaScript in Node. Document-originated native side effects require host authorization.

## Node facade

`createOfficeIntegration({host, transports?, binaries?, assetBaseUrl?})` returns async `capabilities`, `commands`, `open`, `execute`, `inspect`, `render`, `export`, `save`, `close`, and `dispose`, plus namespaced tool descriptors/dispatch (`office.*`). Host callbacks provide file reads, atomic writes, side-effect authorization, logging, and optional native print/certificate hooks. Export explicit TypeScript declarations and package-level examples.

An `open({app, path?, bytes?, name?, transport?})` result identifies `{sessionId, app, revision}`. A live browser transport may be attached to the facade; that session's commands operate on that same WASM session, not a separate CLI copy. Detached native workers own their own sessions. All mutation requests may carry `expectedRevision`; stale requests fail. Tool descriptions are bounded and discover commands rather than expanding all command catalogs into model context. Do not claim filesystem/OS sandboxing from a child process or root checks alone.

The transport contract is `{request(method, params, {signal,timeoutMs}?), close()}`. Adapters normalize each app's actual MCP tool names; inspect the pinned engine sources before final mappings. Stdio is newline-delimited JSON-RPC, logs on stderr, initialize handshake, finite request timeouts, cancellation/teardown, bounded message sizes, no shell interpolation. Browser transport supports method requests and host open/save messages. Error objects use stable codes and preserve diagnostics without leaking document bytes or secrets.

## Browser facade

`mountOfficeEditor({container, app, assetBaseUrl, host, timeoutMs?})` mounts the engine page at `<assetBaseUrl>/<app>/index.html?host=parent` in an iframe and returns `{ready, open, request, execute, commands, inspect, save, export, close, dispose}`. The generated page glue is not a handwritten UI replacement. Check exact event source and origin. Reject duplicate/malformed/oversized messages. Teardown listeners and pending promises. No renderer gets arbitrary filesystem access.

Host callbacks: `writeFileAtomic({sessionId, name, bytes, saveAs, revision, signal})`, optional `onDirty`, `onError`, `authorizeEffect`, `pickOpen`, `pickSave`. Host saves acknowledge only after durable write; write failure or newer edits preserve dirty state. Preserve upstream message version 1 and extend with negotiated, namespaced versioned request/response messages where required. An engine not wired for a capability returns unsupported, never fabricated success. Do not pretend readiness means command support or save durability.

## Runtime distribution

`runtime/<platform>/bin/<app>-cli[.exe]`, where platform is `windows-x64`, `macos-arm64`, or `macos-x64`; shared `web/<app>/index.html` plus its full assets; licensed supporting data and a manifest. Source, runtime, and offline rebuild artifacts are distinct. No first-run Cargo/npm/CDN/font/model download. Existing private harness provides Node and WebView. Probe runtime capabilities and document tested OS ranges; do not claim all historical macOS versions are supported. Approved platform linkers/SDKs remain prerequisites for rebuilding, not running the engine CLIs.

## Full acceptance target

All four embedded editors, native CLI/MCP automation, offline rebuilding, exact downloaded-archive qualification on all three targets, full local desktop feature/file behavior parity with frozen licensed Word/Excel/PowerPoint/Acrobat references, and actual private-harness conformance. Reference applications and private-harness test results are currently unavailable and remain explicit unmet gates. Foundational integration uses measurable threshold gates; product equivalence uses a separate comparative gate once exact licensed versions are retrievable. Passing the integration milestone never satisfies the parity gate.
