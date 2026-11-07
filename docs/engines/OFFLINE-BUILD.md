# Captured offline build inputs

These commands build only the Rust CLI workers and embedded WASM editors. The recipe has no package-manager installation step, Cargo registry access, Git download, Rustup download or Trunk tool download. Native linking still requires the corporate machine's approved system SDK and linker: Xcode Command Line Tools on macOS, or the MSVC x64 build environment and Windows SDK on Windows. Node.js 24 and the operating system's `tar` utility must already be available. The compiler and standard libraries are restored locally from official Rust distribution components; no global Rust installation is changed.

The captured tool versions are Rust/Cargo 1.95.0, Trunk 0.22.1, wasm-bindgen 0.2.129 and Binaryen/wasm-opt 131. Original component archives retain their notices. Separate licence inputs cover tools whose binary archives omit legal texts. Windows x64, macOS ARM64 and macOS x64 tool bytes are acquired and digest verified. Availability of another target's compiler archive is separate from successfully building or running on that target.

## Restore the files

Use a fresh source extraction and verify each downloaded archive's published SHA-256 before extraction. Each app's vendor snapshot is separate; do not merge snapshots. From the source root, restore:

| Input | Extraction directory | Required contents |
| --- | --- | --- |
| Vendor archive for each app | `build/engines/vendor-inputs/<app>/` | `vendor/`, `offline-config.toml`, `Cargo.lock`, `resolver-helper/`, `MANIFEST.json` |
| Shared support archive | `build/engines/support-inputs/` | `support/`, `SUPPORT-DATA.json`, `SUPPORT-PROVENANCE.json`, `MANIFEST.json` |
| Tool archive for the machine's platform | `build/engines/tool-inputs/<platform>/` | `.toolchains/` with original archives/manifests/legal files, plus `MANIFEST.json`; install the verified inner folder at source-root `.toolchains/` |

Replace `<app>` with `wordcraft`, `pdfcraft`, `deckcraft` or `gridcraft`. Tool restoration preserves the filenames from `toolchain-<platform>-manifest.json`, `build-tools-<platform>-manifest.json`, and `wasm-opt-<platform>-manifest.json`. Also restore `tool-licences-manifest.json` and every file in its `inputs` array. The original archives are the only compiler/tool inputs used. An unrelated `.toolchains` file is never selected by wildcard.

The repository's extractor verifies each archive SHA-256 and complete file manifest, then chooses these directories automatically. It refuses an existing extraction directory. For example:

```text
node scripts/unpack-build-inputs.mjs --archive=/absolute/path/office-build-inputs-vendor-wordcraft.tar.gz
node scripts/unpack-build-inputs.mjs --archive=/absolute/path/office-build-inputs-support-complete3.tar.gz
node scripts/unpack-build-inputs.mjs --archive=/absolute/path/office-build-inputs-tools-windows-x64.tar.gz --install-tools
```

Keep the downloaded adjacent `.sha256` file or supply its trusted digest with `--sha256=<digest>`. Select the matching Mac tool archive on macOS. The tool archive contains an inner `.toolchains/` directory; avoid extracting that archive directly inside `.toolchains/`, which would create an incorrect nested directory.

`portable-tools.mjs` verifies each archive's exact size and SHA-256, extracts it with system `tar`, and copies official Rust component `manifest.in` entries into a unique `.toolchains/portable/<platform>/prepared-<id>/rust-1.95.0`. Each build receives its own immutable compiler files, so parallel setup cannot truncate a running compiler's standard libraries. It also installs the matching build tools beside that compiler. Windows setup uses Node and `tar.exe`; it does not run the Unix component installer or require Bash, npm, Python or Rustup.

## Build

Run these commands from the extracted source root using an approved native linker environment:

```text
node scripts/engines/offline-build.mjs wordcraft all --release
node scripts/engines/offline-build.mjs pdfcraft all --release
node scripts/engines/offline-build.mjs deckcraft all --release
node scripts/engines/offline-build.mjs gridcraft all --release
```

Use `cli` or `wasm` in place of `all` for one output. Omit `--release` for a development build. The recipe creates a new Cargo home and target directory for each invocation, verifies the extracted vendor/support manifests, rejects an engine-lock or source-pin mismatch, rewrites only the vendor source directory, and invokes Cargo and Trunk with `--frozen` and offline flags. It uses the exact pinned font/i18n inputs, requires the promised font set, and installs PDF OCR models beside the compiled CLI. Engine lockfiles and source files must remain unchanged.

Each invocation writes its log files, `report.json`, native `runtime/bin/` and/or complete `web/` output under `build/engines/offline-builds/<app>/<platform>-<id>/`. CLI output is launched with `--version`. WASM compilation is not browser qualification; use the host integration qualifier on the exact output directory. The report records development/release profile, source identity, output hashes and whether OS network denial was established.

On macOS, the following adds an OS sandbox that denies all networking independently of Cargo's flags:

```text
sandbox-exec -f scripts/engines/deny-network.sb node scripts/engines/offline-build.mjs deckcraft all --prove-network-denied
```

The probe requires an actual OS permission error for direct-IP TCP. A timeout is insufficient evidence. On Windows, enforce the corporate machine's approved network-denial method before qualification; the macOS sandbox profile is platform specific.

## Input and qualification limits

The working checkout also supports direct `build/engines/vendor/<app>/` and `build/engines/support/` inputs used during kit assembly. Portable archive paths above take precedence when present, and an invalid portable input fails rather than silently falling back. `node scripts/engines/verify-build-inputs.mjs --prepare-all` checks all three tool sets and installs all three layouts without executing foreign-target binaries. This inventory check does not claim a compiled rebuild.

The support archive must include pinned embedded fonts, Word's embedded language-data and `locales/<locale>/{wordcraft.tsv,common.tsv}` interface catalogs with legal/attribution inputs, and the upstream Latin OCR ONNX pair. `office-required-locales.json` names the exact 36 Word and 35 same-locale common catalogs, with per-file hashes and immutable upstream URLs; its hash is bound by `office-input-provenance.json`. The builder explicitly rejects missing, altered or unexpected Word/common locale catalogs before compiling. Earlier support captures are superseded; `support` and `support-complete` omitted the required UI catalogs. Use `support-complete3`, whose canonical locale inventory and all 71 catalogs are manifest verified, or a later verified replacement. Optional externally downloaded dictionaries, all advertised language packs and Tesseract are additional product features and remain unqualified. A compiled build does not establish Microsoft/Adobe parity or private-harness acceptance. Exact public extracted archives still require target-specific runtime and network-denied qualification.
