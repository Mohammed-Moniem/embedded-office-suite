# Acceptance state

Status: IN_PROGRESS. Full Microsoft/Adobe equivalence and actual corporate-host acceptance have not been established.

| Required result | Current evidence | Remaining requirement |
| --- | --- | --- |
| Pinned source and derivative identity | Independent distribution review matched all 4,722 source blobs/modes and eight input manifests; reviewed Word/Grid patches have exact before/after hashes | New candidate/source freezes require renewed review |
| Native integration | Exact anonymously downloaded macOS ARM64 runtime passed all-four create/edit/save/reopen with packaged SDK, empty PATH and OS network denial; Word/PDF/Deck rendered PNG; Grid passed 35 confinement cases | Other targets and complete behavior |
| Embedded Word | Visible-state bridge, human edits, revisions, acknowledged saves and document ownership passed root browser checks and fresh independent review | Private WebView and full Word behavior/file parity |
| Other editors | Release 1 pages remain legacy; newer Deck/Grid candidates are frozen for independent real-browser review; PDF review found an overlapping-save Close defect under repair | Accept, apply, rebuild and publish the three authoritative page bridges |
| Component quality | Exact public source SDK/helper suites passed Windows Server 2022, macOS ARM64 and Intel CI; scoped integration review4 PASS | New page integration and full artifact review; component tests do not establish equivalence |
| Offline rebuilding | Four native+WASM builds with fresh Cargo homes and OS network denial passed on macOS ARM64; captured vendors/support and three target tool sets exist | Exact public extracted source/input builds on all requested targets; optional language/OCR features |
| Windows and Intel Mac | SDK tests passed on both; native/WASM public-kit build workflows running | Complete engine builds and runtime qualification; Windows Server CI is separate from Windows 11 client acceptance |
| Product/file parity | Acceptance contract recorded | Licensed pinned references, comparative fixtures, implementation and acceptance |
| Private Node/WebView harness | Host-neutral SDKs and qualification fixtures supplied | Run inside the actual private host; its source need not be disclosed |
| Public delivery | Progress release public: all ten archives anonymously downloaded and SHA/size verified; downloaded source/runtime extracted with complete manifests | Future releases require the same qualification; full suite remains incomplete |

Independent reviews exposed defects despite passing regressions: revision dirty ordering, total deadlines, queued-save cancellation, completion reentrancy, executable modes, asset policy and hidden parked Word ownership. Repairs passed the scoped fourth review. Those component results do not close parity, platform or private-host gates.

Public attestations: [anonymous downloads](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/public-download-progress1.json), [exact downloaded runtime](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/public-runtime-progress1-macos-arm64.json), and [three-platform SDK evidence](https://github.com/Mohammed-Moniem/embedded-office-suite/releases/download/v0.1.0-progress.1/public-sdk-three-platform-progress1.json). The release inventory records its original freeze; these later reports add measured results without changing archived bytes.
