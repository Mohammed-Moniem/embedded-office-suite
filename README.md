# Embedded Office Suite

Current [progress2 release](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/tag/v0.1.0-progress.2): complete source and reviewed four-editor WASM package are public and pass exact anonymous download plus all-four browser/Node operation checks on macOS ARM64. Exact public native Mac r1 packages pass all-four operations on Apple Silicon and Intel with OS network denial. All four source2 engines also rebuild native and WASM from fresh caches on macOS ARM64 without Cargo network access. Windows and full product/private-host acceptance remain open. Follow the [component downloads](docs/DOWNLOADS.md).

Rust/WASM document engines and a Node integration layer for an **existing private desktop harness**. No standalone GUI, replacement harness, Electron dependency, or host-specific native WebView binding is included.

**Status: IN_PROGRESS.** Full Microsoft 365 desktop and Acrobat Pro local-feature/file-behavior equivalence is the acceptance target. It has not been achieved or verified. The four upstream projects are alpha software. Integration tests, a successful build, or a published archive do not establish full parity.

The engines are based on [WordCraft](https://github.com/storytold/wordcraft), [PdfCraft](https://github.com/storytold/pdfcraft), [DeckCraft](https://github.com/storytold/deckcraft), and [GridCraft](https://github.com/storytold/gridcraft). Exact source commits are recorded in [config/upstreams.json](config/upstreams.json). This is an independent integration, not an official ArtCraft product.

## Contents

- `packages/node`: dependency-free Node adapter, native stdio/MCP transport, session management, and namespaced tool integration.
- `packages/browser`: dependency-free module for mounting WASM editors inside the existing WebView and handling the versioned page bridge.
- `engines`: pinned Rust engine source snapshots, with upstream licences and notices.
- `scripts/engines`: source/runtime acquisition, qualification and offline build tooling.
- `scripts`: distribution verification, host probing and archive assembly.

The host supplies Node, WebView, document access grants, storage, and effect permissions. Runtime assets and native workers are selected explicitly; modules never download a compiler, dependency, font, model, or editor at first launch. Rebuilding may use the approved installed native linker and OS SDK. Rust >=1.95 is required by the pinned engines; exact qualified compiler/tool versions belong in the build manifest.

Read [INTEGRATION-CONTRACT.md](INTEGRATION-CONTRACT.md), [the run record](GAUNTLET-UNLAZY-RUN.md), and the package documentation before integration. Run `node scripts/probe-host.mjs` on a candidate host to record its Node/OS/CPU capabilities without reading corporate documents or credentials. The browser package exposes a complementary WebView probe.

Reviewed Word, PDF, Deck and Sheets page bridges are applied; [APPLIED-PATCHES.json](docs/engines/APPLIED-PATCHES.json) records exact derivative source/patch/review identities separately from upstream pins. All four current pages negotiate bounded real commands, authoritative revisions, confirmed opening and host-acknowledged saves. Actual browser and Node facade checks pass DOCX/PDF/PPTX/XLSX edit/save/reopen on macOS ARM64. Grid native workers support explicit automation roots; these checks are not an OS sandbox. Progress release1 retains three legacy pages, so select each archive by its own provenance rather than assuming later source behavior applies to older bytes.

Use the [download guide](docs/DOWNLOADS.md), [host integration guide](docs/HOST-INTEGRATION.md) and [offline recipe](docs/engines/OFFLINE-BUILD.md). The complete explicit source archive is the distribution authority while GitHub Git Data import remains unresolved; bootstrap main alone does not contain all engine code. Keep the published notice companion with the original progress1 runtime. New repaired packages include original font/icon notices internally. Progress artifacts are not the finished parity suite.

## Verification and limits

`node scripts/run-tests.mjs` runs the repository's test suites without installing packages. `node scripts/verify-engines.mjs` exercises actual acquired CLI workers; absent workers fail rather than skip. More expensive offline and OS qualification is recorded separately. Release notes must identify which exact source/archive and platforms were tested.

The actual private harness remains outside this repository; its conformance gate requires sanitized owner-run results. Following the user's scope amendment, current feature coverage is being compared against official Microsoft/PDF documentation without requiring licensed reference applications. Documentation and repository evidence do not establish full application behavior or file fidelity. No universal claim about historical macOS releases is made; publish the measured OS/WebView compatibility matrix for each release.

Source, runtime, and offline-rebuild bundles are distinct. A runtime-only archive is never presented as the complete offline build kit. Supporting assets and dependencies must be redistributed under their own licence terms; proprietary software, corporate documents, credentials, and restricted vendor SDKs are excluded.
