# Embedded Office Suite

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

## Verification and limits

`node scripts/run-tests.mjs` runs the repository's test suites without installing packages. `node scripts/verify-engines.mjs` exercises actual acquired CLI workers; absent workers fail rather than skip. More expensive offline and OS qualification is recorded separately. Release notes must identify which exact source/archive and platforms were tested.

The actual private harness and licensed Microsoft/Adobe reference applications are not available in this repository. Their required conformance/reference gates remain open until those tests run. No universal claim about historical macOS releases is made; publish the measured OS/WebView compatibility matrix for each release.

Source, runtime, and offline-rebuild bundles are distinct. A runtime-only archive is never presented as the complete offline build kit. Supporting assets and dependencies must be redistributed under their own licence terms; proprietary software, corporate documents, credentials, and restricted vendor SDKs are excluded.
