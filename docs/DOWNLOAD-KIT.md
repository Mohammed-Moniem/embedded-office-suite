# Download the Office integration kit

Use an approved **Node 22 or newer** installation on an internet-connected machine that can reach GitHub. The helper uses Node's built-in `fetch`; it needs no npm packages, Cargo access, token or account. GitHub release downloads may redirect to `release-assets.githubusercontent.com` or `objects.githubusercontent.com`, so the corporate allowlist must permit those GitHub hosts too.

Keep [download-office-kit.mjs](../scripts/download-office-kit.mjs) in `scripts/` and its matching [fixed inventory](../config/office-kit-downloads-progress3.json) in the adjacent `config/` directory. The script checks the inventory's hardcoded SHA-256. Use these files from the current complete source delivery or obtain the matching pair from this repository. The immutable source3 engine archive predates this additive helper; it is a build baseline, not the latest delivery of these download tools.

Preview the exact files and required bytes without creating directories or making network requests:

```sh
node scripts/download-office-kit.mjs --destination /Users/you/office-transfer --platform macos-arm64 --profile runtime --plan
```

Download the runtime archives for your target laptop:

```sh
node scripts/download-office-kit.mjs --destination /Users/you/office-transfer --platform macos-arm64
```

Windows PowerShell example, with an absolute destination outside the source checkout:

```powershell
node scripts/download-office-kit.mjs --destination 'C:\OfficeTransfer' --platform windows-x64 --profile runtime
```

The platform choices are `windows-x64`, `macos-arm64` and `macos-x64`. The default `auto` selects the current Windows x64 or macOS ARM64/x64 host; specify the target explicitly when downloading on another machine. Linux auto selection is unsupported, but Linux can download files for an explicit supported target. Destinations must be absolute normalized paths without a trailing separator (except filesystem roots, which overlap protected paths and are rejected).

| Profile | Selected archives per target |
| --- | --- |
| `runtime` (default) | 2: matching native integration ZIP and the current four-editor WASM integration ZIP |
| `build` | 7: complete immutable source3, Word/PDF/Deck/Grid vendor archives, complete3 support and matching platform build tools |
| `all` | 9: runtime and build profiles together |

For a complete transfer with the optional build inputs:

```sh
node scripts/download-office-kit.mjs --destination /Users/you/office-transfer --platform macos-arm64 --profile all
```

After copying the downloaded files to the corporate laptop, run the same helper and inventory there to verify the exact archives without any network use:

```sh
node scripts/download-office-kit.mjs --destination /Users/you/office-transfer --platform macos-arm64 --profile runtime --offline
```

Use the same `--profile` and target used for the transfer. Missing files, wrong sizes or wrong hashes fail with exit code 1. The JSON result lists every successfully verified archive and its SHA-256. `--plan` takes precedence over `--offline` and only previews selection; it does not certify existing files.

The helper downloads and verifies archives only. It never extracts them, installs packages, runs build tools, starts an application or changes your private Node/WebView host. Runtime ZIPs contain the adapters and four native workers or four WASM editors for integration into that host. Follow their included integration documentation after your approved extraction process; no standalone desktop installer or launcher is supplied by this helper. Running the native workers needs the target OS; the WASM editors need a compatible browser/WebView and a host serving their packaged resources.

The optional build tools pin **Rust 1.95.0, Trunk 0.22.1, wasm-bindgen 0.2.129 and Binaryen 131**. Compiling additionally requires the approved target OS SDK/linker, system `tar`, disk space and the documented offline build setup. In particular, Windows uses `office-build-inputs-tools-windows-x64-gzip-r1.tar.gz` (334,223,706 bytes), rather than the older Windows archive containing XZ-compressed inputs. Merely downloading the build profile does not configure a compiler or SDK.

Downloads stream to exclusive temporary files with a six-hour limit per archive, enforce the exact byte count and SHA-256, and publish the completed file without replacing an existing name. Existing selected files are reused only after full verification; a wrong existing file stops the operation and is left untouched. A failed transfer removes its owned temporary file. Already verified downloads remain available for a later retry. There is no partial-download resume, custom URL, configurable pin, automatic credential lookup or automatic replacement. On an offline machine you can verify the archives repeatedly without Cargo or GitHub access.

For an ordinary first Ctrl+C (`SIGINT`) or `SIGTERM` delivered by Node, the CLI aborts the active download, waits for its owned temporary-file cleanup, and exits with code 130 or 143 respectively. A second signal forces termination; `SIGKILL`, power loss or forced process termination can leave a `.office-kit-*.part` file. Such leftovers are never resumed or treated as verified archives. Completed verified archives stay available. Signal behavior was exercised with actual CLI child processes on macOS ARM64; Windows console and process-termination behavior needs separate target validation.

Use a destination controlled by you, with ordinary directories and no concurrent directory renames or other writers. Symbolic links/junctions, non-directory parents, protected source/build paths, existing mismatched files and racing final-file creation are rejected. The helper checks directory identities before writes; Node's portable filesystem APIs do not provide a sandbox against a hostile process changing directories concurrently. It cannot bypass a corporate proxy, certificate policy or GitHub restriction.

All three reviewed native ZIPs and the WASM ZIP are published in [progress.3](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/tag/v0.1.0-progress.3); vendors, support and tool inputs are in [progress.1](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/tag/v0.1.0-progress.1). WASM public-download tests exercised all four packaged editors and their own SDK on a macOS ARM64 hosted Chromium runner. This helper's validation verifies frozen archive bytes locally and tests download handling with controlled responses. Native target/public qualification is tracked separately. These are progress integration components; this guide does not claim Microsoft Office/Adobe parity, Windows 11 acceptance or acceptance of your private desktop host.
