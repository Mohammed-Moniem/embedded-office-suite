# Reconstruct the current WASM progress package

Use Node 22 or later and a system `tar` that reads both TAR/GZIP and ZIP archives (macOS and Windows ship this). No Cargo access or package installation is needed for this reconstruction. Linux requires a ZIP-capable system tar; GNU tar alone cannot read the CI ZIP inputs. macOS ARM64 is the locally measured target. Other targets need their own verification.

From the current complete source distribution, run:

```sh
node scripts/restore-web-source3.mjs --destination /absolute/new-office-source3 --cache /absolute/office-source3-cache
```

Both paths must be canonical. The destination must not exist. The CLI refuses source/input directories, symlink ancestors, destination/cache overlap, damaged cached inputs and existing WASM receipt sidecars. It downloads only fixed public GitHub release assets and pinned public production overlays using native `fetch`. It verifies every fixed size/SHA before extraction, rejects unsafe archive members, links and special files, and checks all restored file identities and POSIX modes. Empty TAR directories are permitted because file manifests omit them. This is not isolation against another hostile process racing the filesystem.

The new working copy combines the complete source3 baseline with the exact current packager, component pins and Windows verifier from public commit `217c69da9c42ab4d248d6bb5efb72a90f8bc73c6`. The separate historical tree under `build/public-qualification/progress3/source` is verification data; the restorer never executes code from that tree. Main's automatic source archive alone does not contain the complete engine trees. The complete source distribution and fixed restoration inputs provide those bytes.

Then change into the new working directory and build the deterministic package:

```sh
node scripts/package-web-progress3.mjs --components build/web-progress3/components.json --qualification build/web-progress3/selected-browser.json --node-qualification build/web-progress3/selected-node.json --guard-qualification build/web-progress3/selected-deck-guard.json --output build/web-progress3/reconstructed.zip
```

The recorded package is 81,469,742 bytes, SHA-256 `99c25048df8b3562b5cfbac86fc463ad9b0682d9fd2b5d8da5c06a1acbe0c5af`; its manifest SHA-256 is `558993c7cdd2b8a242d0e45894462b905a508c83acbe41d06e6d5c765581687b`. Fresh local reconstruction reproduced both hashes using macOS ARM64, Node24.18.0 and zlib1.2.12. ZIP compression can differ between Node distributions even when the Node version and complete payload manifest match; exact container-byte reproduction requires the recorded compression environment. Use the download-only command below to obtain the exact published ZIP. Use `--offline` with the same verified cache to restore another new destination without network requests. The original selected metadata, including historical absolute strings, is preserved byte-for-byte because the packager pins its exact bytes.

To download and verify only the published runtime archive:

```sh
node scripts/restore-web-source3.mjs --mode wasm --destination /absolute/new-office-wasm --cache /absolute/office-source3-cache
```

The exact extraction contains all four editors, their browser and Node SDKs, the host asset handler, notices, provenance and integrity helper. Mount these components in the existing approved Node/WebView host. Host storage and permission callbacks remain the host's responsibility. This is a progress integration package, not a standalone application or Microsoft/Adobe replacement.

The code-anchored [restoration configuration](../config/web-source3-restore-progress3.json) preserves the exact original map and resolves its proposed names to durable existing assets. It covers 22 direct inputs and 10 container/subtree requirements with 5,398 file entries. Existing large CI ZIPs and progress2 assets are reused; no duplicate large uploads are required. The published map is [wasm-source3-public-restore-map.json](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.3/wasm-source3-public-restore-map.json).

Actual public download and own-SDK qualification passed in [run42399772857](https://github.com/Mohammed-Moniem/embedded-office-suite/actions/runs/42399772857), separately from local reconstruction. The [admission record](verification/public-wasm-source3.json) binds the exact run/head/job, original artifact ZIP, five linked reports and hosted source closure. All four actual editors passed persisted host-byte reopen, save failure/retry, stale revisions, ACK/newer-edit ownership and six precise Deck `UNSUPPORTED` refusals using the anonymously downloaded archive's own SDKs. The recorded environment is macOS15 ARM64, Node24.18.0 and Chromium1247. The [durable publication record](verification/public-wasm-source3-durable.json) verifies anonymous readback of the [complete evidence bundle](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.3/wasm-source3-public-qualification-42399772857.tar.gz), so the proof does not depend on Actions artifact retention. No private WebView, Windows11, arbitrary-file fidelity, full product parity or power-loss durability claim is made.
