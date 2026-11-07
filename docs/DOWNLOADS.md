# Progress 1 downloads

The [prerelease](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/tag/v0.1.0-progress.1) is a measured development milestone, status IN_PROGRESS. Full Office/Acrobat equivalence, private-harness acceptance and all-target exact-release qualification remain incomplete. A draft is not public delivery.

Download the complete [source archive](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-source-progress1.tar.gz) and adjacent checksum. It contains four Rust source trees, licences/notices, accepted Word/Grid changes, Node/browser SDKs, build/verification recipes and per-file MANIFEST.json. GitHub's Git Data import returned tree IDs which subsequent reads could not retrieve. Bootstrap main is not complete source; do not substitute GitHub's automatic bootstrap source ZIP for this asset.

For offline rebuilding transfer the source, all four vendor archives, shared support and the matching platform tools. Keep each adjacent .sha256 file and compare against the published inventory before extraction.

| Input | Download |
| --- | --- |
| Word Cargo sources | [wordcraft](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-build-inputs-vendor-wordcraft.tar.gz) |
| PDF Cargo sources | [pdfcraft](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-build-inputs-vendor-pdfcraft.tar.gz) |
| Deck Cargo sources | [deckcraft](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-build-inputs-vendor-deckcraft.tar.gz) |
| Sheets Cargo sources | [gridcraft](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-build-inputs-vendor-gridcraft.tar.gz) |
| Fonts, language/proofing, OCR models and legal inputs | [support complete3](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-build-inputs-support-complete3.tar.gz) |
| Windows x64 tools | [windows-x64](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-build-inputs-tools-windows-x64.tar.gz) |
| Apple Silicon tools | [macos-arm64](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-build-inputs-tools-macos-arm64.tar.gz) |
| Intel Mac tools | [macos-x64](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-build-inputs-tools-macos-x64.tar.gz) |

Tool sets contain Rust/Cargo 1.95.0, native/wasm32 standard libraries, Trunk 0.22.1, wasm-bindgen 0.2.129, Binaryen 131 and inventoried licences. Cargo packages retain their own licences/checksums, including unused pinned Git patch packages needed for frozen resolution. The offline recipe makes no Cargo registry, Git source, Rustup or Trunk tool download.

Follow the [offline recipe](engines/OFFLINE-BUILD.md) from a fresh source extraction. The existing approved Node runtime, native linker/SDK and OS tar remain prerequisites. No global Rust installation is changed; proprietary system SDKs are not redistributed. Foreign-target tool extraction does not establish execution on that target.

The [macOS ARM64 integration runtime](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/office-integration-macos-arm64.zip) contains four source-built workers, compiled WASM pages, host SDKs and support/legal data. It mounts inside the existing Node/WebView harness, with no desktop launcher. Word supports a reviewed bounded command subset and acknowledged saves. PDF/Deck/Grid page commands, authoritative revisions and acknowledged UI saves remain unavailable in this milestone. Grid native rendering is unsupported. Windows/Intel derived runtime acceptance remains pending.

The [acceptance matrix](verification/ACCEPTANCE.md) records remaining requirements. Archive integrity, successful compilation, synthetic roundtrips and scoped critics do not establish feature/file parity, private-harness operation or production acceptance.
