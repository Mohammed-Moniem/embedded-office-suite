# Embedded Office Suite

**IN_PROGRESS. Full Word/Excel/PowerPoint/Acrobat equivalence has not been achieved.**

Download the complete four-engine Rust source, Node/browser SDKs and offline build assets from the [progress prerelease](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/tag/v0.1.0-progress.1). Start with the [download guide](docs/DOWNLOADS.md), [offline recipe](docs/engines/OFFLINE-BUILD.md), [integration contract](INTEGRATION-CONTRACT.md) and [acceptance matrix](docs/verification/ACCEPTANCE.md).

This branch is the publication/CI bootstrap. The complete source is the explicit `office-source-progress1.tar.gz` release asset, frozen at local commit `60e8d44a769b998827f308ceb58f5cba5b6a0e17`; GitHub's automatic bootstrap source ZIP is not the four-engine source. Git Data tree import failed independent closure checks, so the checked source archive is used for delivery.

The components mount inside an existing Node/WebView desktop harness. No standalone app or launcher is included. The host provides approved Node/WebView, file grants and storage. Rebuilds use the bundled pinned Rust/WASM tools and vendored Cargo sources plus the approved native linker/OS SDK. Private corporate data, credentials and proprietary SDKs are excluded.

Measured macOS ARM64 evidence includes four native/WASM offline builds, real native roundtrips, a reviewed Word page bridge and bounded integration tests. Other targets, remaining page bridges, optional features, private-host conformance and full product/file parity require further acceptance. CI downloads and verifies the exact published archives rather than treating this bootstrap as complete source.
