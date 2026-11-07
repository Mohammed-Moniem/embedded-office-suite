// Separate source3 CLI-only static profile, with code-anchored actual API authority.
// Default native plus WASM evidence cannot admit this profile.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, readdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
// Both this candidate and its eventual scripts/ci installation are two levels
// below the repository root. No helper from frozen/public source is executed.
import {sha256, safeRelative, verifyManifest, filesIn} from '../../scripts/lib/artifacts.mjs';

export const APPS = Object.freeze(['wordcraft', 'pdfcraft', 'deckcraft', 'gridcraft']);
export const PLATFORM = 'windows-x64';
export const SOURCE_COMMIT = 'e8e4364c20018abb1222c69b7e50839abfe62644';
export const SOURCE_MANIFEST = '566d2c34f202c0e33e2bd2049fab086642228e781ebc8585a4c431ea472b9daa';
export const SOURCE_ARCHIVE = 'ee369702aa8cf550413d000f58ac88d297ede8da01fade5d4ac3c89a1ddc2e6c';
export const SUPPORT_MANIFEST = '9a213c32fde8cfbe505364a0f5381587b79e34c2ee9648d1d22e4cd9c518e269';
export const IDENTITY_FIELDS = Object.freeze(['app', 'platform', 'artifactId', 'runId', 'workflowHead', 'bytes', 'sha256']);
export const PUBLIC_INPUTS = Object.freeze({
  'office-source-progress3-r1.tar.gz': SOURCE_ARCHIVE,
  'office-build-inputs-support-complete3.tar.gz': 'b044c20cfc2a8f470268065fd44a3f2ab2e0837c09a89856bfbc902377e9595c',
  'office-build-inputs-tools-windows-x64-gzip-r1.tar.gz': '02a82e36f2c9df54908efa3a0aa431fde27e5c776e12cea8464c980217bc0ddd',
  'office-build-inputs-vendor-wordcraft.tar.gz': '95a914506a4439e285b669d562ebb113daa53818259572e3025e2e568ae6a382',
  'office-build-inputs-vendor-pdfcraft.tar.gz': '8c5fd6b02020a2309803182c9b34ca5680ea46165de8aa2099b45ca8d7e0f9f3',
  'office-build-inputs-vendor-deckcraft.tar.gz': '762e55795c534cbffade71d7c336fae367e1b8bc3176f7f261526e44ee3b7992',
  'office-build-inputs-vendor-gridcraft.tar.gz': 'e3a5d7e800bdbe90529783db1381225d9c3f9eb1c42f96fcdbe6383c8997dab5',
});
export const ADMISSION = Object.freeze({
  "status": "ADMITTED_ACTUAL_SUCCESSFUL_CI",
  "runId": 42391943016,
  "workflowHead": "f8b0c730972cf533289646ee29841494446785b7",
  "pinSha256": "23812a0d8ccebc377e6d18c4d68e928cf41873e266ae313b3f341811da78b12e",
  "runCaptureSha256": "d8b1976a63906401778938a76acf8e05173dc53b190344de44753eaa7f910295",
  "jobsCaptureSha256": "22a7b9911f6b4221075b61c702a6c7cd8418e0c15e35e7fb81ff0f6672e8a747",
  "artifactsCaptureSha256": "01bea5bdf0b2fe20869fdcba4dcb53777a663af4a7ab798e46adadb1fea07b36"
});

const PIN_FILE = 'config/ci-engine-pins-windows-progress3.json';
const CAPTURES = 'build/windows-native-progress/static-authority';
const RESTORED = 'build/windows-native-progress';
const ATTESTED_RESTORED = 'build/windows-native-progress';
const OUTPUT = 'build/windows-native-progress/public-static-native-builds-progress3-windows-x64.json';
export const WORKFLOW_FILE = '.github/workflows/windows-static-native.yml';
export const WORKFLOW_SHA256 = '9f93777a40449fa1d6da9d7f9b6de1bc126777d191b6700f59fb4f2ba192a86e';
export const WORKFLOW_CHECKOUT_SHA256 = '708a11915c3853b543585ae7145406271e2393b943ef5057fc9156e0a9af313f';
export const BOOTSTRAP_CANONICAL_FILES = Object.freeze([
  {
    "path": "scripts/ci/windows-static-native.mjs",
    "size": 10370,
    "sha256": "8a548d6824f4fd9a1cd878e8dfa20e808c084c2020e738eeaf03b4070a5ce62e"
  },
  {
    "path": "scripts/ci/windows-static-pe.mjs",
    "size": 4713,
    "sha256": "324fae139448fe6b60a8e52764da831d33149999d0d0fc29adca5e7a73c055a3"
  },
  {
    "path": "scripts/ci/progress.mjs",
    "size": 8202,
    "sha256": "a7c0717a835d4ea816291ffdd127c6c680611ff2931463d310c7fd5eb4fd0416"
  },
  {
    "path": "scripts/ci/progress-supervisor.mjs",
    "size": 3508,
    "sha256": "82a0fc9045ad46d1416259a5ddc44696eadb384c38529256a07a43409c9b16d3"
  },
  {
    "path": "scripts/ci/verify-frozen-source.mjs",
    "size": 2889,
    "sha256": "7383d88ecd0d84b4b9080bbdb4bcefe687fe3c52d34f77cdae5a8445722ba106"
  },
  {
    "path": "scripts/lib/artifacts.mjs",
    "size": 8842,
    "sha256": "652f1d5d5fa68cd96bd5850e4cb5e62a75ed2e68b7b7c4e91359374168c6505a"
  },
  {
    "path": "build/progress-ci/source/scripts/engines/offline-build.mjs",
    "size": 14945,
    "sha256": "ab8969ddd0ed69732c021dd8861845fba36e52c27f95b6149b7e18b83651ce73"
  },
  {
    "path": "build/progress-ci/source/scripts/verify-engines.mjs",
    "size": 6499,
    "sha256": "e41b1c1913b62cb303b2e58069eeb6e1050068a4b96fc40c03f36beaa6e4e46b"
  }
]);
export const BOOTSTRAP_FILES = Object.freeze([
  {
    "path": "scripts/ci/windows-static-native.mjs",
    "size": 10478,
    "sha256": "e5bb07efc021a4bf0d6d2d46904f58d67c7a696aa0793a5cb654481758ee392f"
  },
  {
    "path": "scripts/ci/windows-static-pe.mjs",
    "size": 4787,
    "sha256": "609e7cf26b7dfbeca87bbbf25ebe94d6696010e181b3fd6cefcfbc89061e1b70"
  },
  {
    "path": "scripts/ci/progress.mjs",
    "size": 8297,
    "sha256": "77bfb2b986a8de9162c563d0bd662d318f2f2d327660c1c26c2fbbe96b73159d"
  },
  {
    "path": "scripts/ci/progress-supervisor.mjs",
    "size": 3564,
    "sha256": "01011ea7a29a3a876c6f57f4fe9634211709d2ee07c64422eb66974041682dee"
  },
  {
    "path": "scripts/ci/verify-frozen-source.mjs",
    "size": 2933,
    "sha256": "b6b2cfeb547e0b641e0ff3027c390c7408b326a325dfb48bffe0dac26d045a6f"
  },
  {
    "path": "scripts/lib/artifacts.mjs",
    "size": 8977,
    "sha256": "ae919ff293659ef78e368762b1e4525e74b30b345650479dc3e1c48ee7d0af12"
  },
  {
    "path": "build/progress-ci/source/scripts/engines/offline-build.mjs",
    "size": 14945,
    "sha256": "ab8969ddd0ed69732c021dd8861845fba36e52c27f95b6149b7e18b83651ce73"
  },
  {
    "path": "build/progress-ci/source/scripts/verify-engines.mjs",
    "size": 6499,
    "sha256": "e41b1c1913b62cb303b2e58069eeb6e1050068a4b96fc40c03f36beaa6e4e46b"
  }
]);
export const STATIC_FLAGS = '-C target-feature=+crt-static';
const FORBIDDEN_VC_IMPORT = /^(?:vcruntime|msvcp|concrt|msvcr).*\.dll$/i;
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const normalized = value => { assert.equal(typeof value, 'string'); return value.replaceAll('\\', '/'); };

export function assertAdmission(admission = ADMISSION) {
  assert.equal(admission.status, 'ADMITTED_ACTUAL_SUCCESSFUL_CI', 'Actual successful four-app Windows CI authority is pending');
  assert(Number.isSafeInteger(admission.runId) && admission.runId > 0, 'No reviewed actual Windows CI run is admitted');
  assert.match(admission.workflowHead ?? '', COMMIT, 'No reviewed actual Windows CI head is admitted');
  for (const key of ['pinSha256', 'runCaptureSha256', 'jobsCaptureSha256', 'artifactsCaptureSha256']) assert.match(admission[key] ?? '', SHA, `No reviewed actual ${key}`);
}
export async function regular(file) {
  assert.equal(await realpath(file), resolve(file), `Symlink path is forbidden: ${file}`);
  const info = await lstat(file); assert(info.isFile(), `Expected regular file: ${file}`);
  return info;
}
async function json(file) { await regular(file); return JSON.parse(await readFile(file, 'utf8')); }
async function jsonRecord(file) {
  await regular(file); const bytes = await readFile(file);
  return {value: JSON.parse(bytes.toString('utf8')), sha256: createHash('sha256').update(bytes).digest('hex')};
}
async function matched(file, expected, label) {
  assert.match(expected ?? '', SHA, `Missing ${label} digest`);
  await regular(file); assert.equal(await sha256(file), expected, `${label} digest mismatch`);
}
export async function sourceHash(directory) {
  assert.equal(await realpath(directory), resolve(directory), 'Source directory aliases are forbidden');
  const hash = createHash('sha256');
  async function visit(base) {
    for (const entry of (await readdir(base, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', 'target', 'dist'].includes(entry.name)) continue;
      const file = join(base, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { await regular(file); hash.update(relative(directory, file).replaceAll('\\', '/')); hash.update('\0'); hash.update(await readFile(file)); hash.update('\0'); }
    }
  }
  await visit(directory); return hash.digest('hex');
}
export function safeMember(member) {
  assert.equal(typeof member, 'string');
  assert(!/[\x00-\x1f\x7f<>:"|?*\[\]]/.test(member), 'Unsafe Windows ZIP member');
  safeRelative(member); assert(member.split('/').every(part => !/[. ]$/.test(part)), 'Ambiguous Windows ZIP member');
  assert(member.split('/').every(part => !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Reserved Windows ZIP member');
  return member;
}
export function validateMembers(names) {
  assert(Array.isArray(names) && names.length > 0 && names.length <= 65535, 'Invalid CI ZIP inventory');
  const seen = new Set();
  for (const name of names) {
    const clean = safeMember(name.endsWith('/') ? name.slice(0, -1) : name);
    const key = clean.normalize('NFC').toLowerCase();
    assert(!seen.has(key), `Duplicate or Windows-ambiguous CI ZIP member: ${name}`); seen.add(key);
  }
  return names;
}
async function archiveCommand(args, expectedBytes) {
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe') : '/usr/bin/tar';
  const child = spawn(tar, args, {stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
  const digest = createHash('sha256'); let bytes = 0, stdout = '', stderr = '', over = false;
  const limit = expectedBytes ?? 4 * 1024 * 1024;
  const timer = setTimeout(() => child.kill(), 120000);
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > limit) { over = true; child.kill(); } else if (expectedBytes === undefined) stdout += chunk; else digest.update(chunk); });
  child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr += chunk; });
  let code; try { code = await new Promise((yes, no) => { child.once('error', no); child.once('close', yes); }); } finally { clearTimeout(timer); }
  assert.equal(over, false, 'CI ZIP inspection exceeded its exact byte bound');
  assert.equal(code, 0, `CI ZIP member inspection failed: ${stderr}`);
  return expectedBytes === undefined ? stdout : {bytes, sha256: digest.digest('hex')};
}
export async function verifyZipMember(zip, members, member, file) {
  safeMember(member); assert.equal(members.filter(name => name === member).length, 1, `Missing or duplicate exact CI ZIP member: ${member}`);
  const info = await regular(file), zipped = await archiveCommand(['-xOf', zip, '--', member], info.size);
  assert.equal(zipped.bytes, info.size, `CI ZIP member size mismatch: ${member}`);
  assert.equal(zipped.sha256, await sha256(file), `CI ZIP member digest mismatch: ${member}`);
}
export function inspectPe(bytes) {
  function bounds(offset, length) { assert(Number.isSafeInteger(offset) && offset >= 0 && offset + length <= bytes.length, 'Truncated Windows PE worker'); }
  bounds(0, 64); assert.equal(bytes.subarray(0, 2).toString(), 'MZ', 'Expected a Windows PE worker');
  const pe = bytes.readUInt32LE(0x3c); bounds(pe, 24);
  assert.equal(bytes.readUInt32LE(pe), 0x4550, 'Expected PE signature');
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Expected an x64 PE worker');
  const count = bytes.readUInt16LE(pe + 6), optionalBytes = bytes.readUInt16LE(pe + 20), optional = pe + 24;
  assert(count > 0 && count <= 96, 'Invalid PE section count');
  bounds(optional, optionalBytes); assert(optionalBytes >= 240, 'Missing PE32+ data directories');
  assert.equal(bytes.readUInt16LE(optional), 0x20b, 'Expected PE32+ x64 optional header');
  const directories = bytes.readUInt32LE(optional + 108);
  assert(directories >= 14 && directories <= (optionalBytes - 112) / 8, 'Invalid PE data directory count');
  const sections = [], rvaRanges = [];
  function addRvaRange(start, size) {
    if (!size) return;
    const end = start + size;
    assert(Number.isSafeInteger(end) && end > start && end <= 0x100000000, 'Wrapping PE RVA-backed range');
    rvaRanges.push({start, end});
  }
  // Cover both declared headers and every header byte actually read. Even a
  // missing/undersized SizeOfHeaders cannot hide an overlap with PE metadata.
  const headerBytes = Math.max(bytes.readUInt32LE(optional + 60), optional + optionalBytes + count * 40);
  addRvaRange(0, headerBytes); bounds(0, headerBytes);
  for (let i = 0; i < count; i++) {
    const at = optional + optionalBytes + i * 40; bounds(at, 40);
    const section = {rva: bytes.readUInt32LE(at + 12), size: bytes.readUInt32LE(at + 16), offset: bytes.readUInt32LE(at + 20)};
    bounds(section.offset, section.size); addRvaRange(section.rva, section.size); sections.push(section);
  }
  // Reject all raw-backed RVA ambiguity before consuming any import data,
  // including partial spans, unused overlaps and overlap with header mappings.
  rvaRanges.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < rvaRanges.length; i++) assert(rvaRanges[i].start >= rvaRanges[i - 1].end, 'Overlapping PE RVA-backed ranges (ambiguous mapping)');
  function mappedRange(rva, length = 1) {
    const matches = sections.filter(s => rva >= s.rva && rva - s.rva + length <= s.size);
    assert.equal(matches.length, 1, 'Unmapped or ambiguous PE import RVA');
    const section = matches[0];
    return {offset: section.offset + rva - section.rva, section};
  }
  function offsetOf(rva, length = 1) { return mappedRange(rva, length).offset; }
  function libraryAt(rva) {
    // Retain the unique RVA mapping. Physical raw extents can overlap and must
    // never select a different section to extend this name's allowed boundary.
    const {offset: start, section} = mappedRange(rva);
    const limit = Math.min(section.offset + section.size, start + 513);
    const nullIndex = bytes.subarray(start, limit).indexOf(0);
    assert(nullIndex >= 0, 'Unterminated PE import name');
    const end = start + nullIndex;
    const rawName = bytes.subarray(start, end);
    // Buffer's ASCII decoder clears high bits. Validate the original bytes
    // before decoding so the dependency inventory cannot rename malformed data.
    assert(rawName.every(byte => byte <= 0x7f), 'Non-ASCII PE import library name');
    assert(rawName.every(byte => byte >= 0x41 && byte <= 0x5a || byte >= 0x61 && byte <= 0x7a || byte >= 0x30 && byte <= 0x39 || [0x5f, 0x2e, 0x2b, 0x2d].includes(byte)), 'Unsafe PE import library name bytes');
    const name = rawName.toString('ascii');
    // Winspool.drv is the named Windows printing module; other extensions are
    // rejected. https://learn.microsoft.com/en-us/windows/win32/printdocs/openprinter
    assert(/^[A-Za-z0-9_.+-]+\.dll$/i.test(name) || name.toLowerCase() === 'winspool.drv', 'Unsafe PE import library name');
    return name;
  }
  function imports(index, width, nameOffset, delay = false) {
    const directory = optional + 112 + index * 8, rva = bytes.readUInt32LE(directory), size = bytes.readUInt32LE(directory + 4);
    if (!rva && !size) return {rawNames: [], libraries: []};
    assert(rva && size >= width && size <= 1024 * 1024, 'Invalid PE import directory');
    const result = []; let terminated = false;
    for (let n = 0; (n + 1) * width <= size && n < 4096; n++) {
      const at = offsetOf(rva + n * width, width);
      if (bytes.subarray(at, at + width).every(byte => byte === 0)) { terminated = true; break; }
      if (delay) assert.equal(bytes.readUInt32LE(at), 1, 'Unsupported non-RVA PE delay import');
      result.push(libraryAt(bytes.readUInt32LE(at + nameOffset)));
    }
    assert(terminated, 'Unterminated PE import descriptors');
    // Repeated imports are valid. Validate every descriptor/name first, retain
    // their exact spellings/order, and only then deduplicate dependencies.
    return {rawNames: result, libraries: [...new Set(result.map(name => name.toLowerCase()))].sort()};
  }
  const importsDirect = imports(1, 20, 12), importsDelayed = imports(13, 32, 4, true);
  return {format: 'PE32+', machine: 'x64', direct: importsDirect.libraries, delayed: importsDelayed.libraries, libraries: [...new Set([...importsDirect.libraries, ...importsDelayed.libraries])].sort(), descriptors: {directNames: importsDirect.rawNames, delayedNames: importsDelayed.rawNames, directCount: importsDirect.rawNames.length, delayedCount: importsDelayed.rawNames.length}, hostAvailabilityQualified: false};
}
export function validateAuthority(pins, run, jobsCapture, artifactsCapture, admission = ADMISSION) {
  assertAdmission(admission);
  assert.equal(pins.schemaVersion, 1); assert.equal(pins.kind, 'windows-source3-static-native-ci-authority');
  assert.equal(pins.status, 'ADMITTED_ACTUAL_SUCCESSFUL_CI');
  assert.equal(pins.repository, 'Mohammed-Moniem/embedded-office-suite');
  assert.equal(pins.sourceCommit, SOURCE_COMMIT); assert.equal(pins.sourceManifestSha256, SOURCE_MANIFEST); assert.equal(pins.sourceArchiveSha256, SOURCE_ARCHIVE);
  assert.equal(run.id, admission.runId); assert.equal(run.head_sha, admission.workflowHead);
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
  assert.equal(run.repository?.full_name, pins.repository); assert(Number.isSafeInteger(run.repository?.id) && run.repository.id > 0);
  assert(Number.isSafeInteger(run.head_repository?.id) && run.head_repository.id > 0);
  assert.equal(run.path, '.github/workflows/windows-static-native.yml'); assert.equal(run.event, 'workflow_dispatch');
  assert(Array.isArray(pins.records) && pins.records.length === APPS.length, 'Exactly four admitted records required');
  assert.deepEqual(pins.records.map(x => x.app).sort(), [...APPS].sort(), 'Missing or duplicate authority app');
  assert(Array.isArray(jobsCapture.jobs) && jobsCapture.jobs.length === APPS.length, 'Exactly four actual matrix jobs required');
  assert(Array.isArray(artifactsCapture.artifacts), 'Missing actual artifact API records');
  const artifactIds = new Set(), jobIds = new Set();
  for (const pin of pins.records) {
    assert.deepEqual(Object.keys(pin).sort(), [...IDENTITY_FIELDS].sort(), 'Incomplete CI identity');
    assert.equal(pin.platform, PLATFORM); assert.equal(pin.runId, admission.runId); assert.equal(pin.workflowHead, admission.workflowHead); assert.match(pin.sha256, SHA);
    for (const key of ['artifactId', 'runId', 'bytes']) assert(Number.isSafeInteger(pin[key]) && pin[key] > 0, `Invalid CI identity ${key}`);
    assert(!artifactIds.has(pin.artifactId), 'Duplicate admitted artifact ID'); artifactIds.add(pin.artifactId);
    const jobs = jobsCapture.jobs.filter(x => x.name === `rebuild (${pin.app})`); assert.equal(jobs.length, 1, 'Missing or duplicate matrix job');
    const job = jobs[0]; assert(Number.isSafeInteger(job.id) && job.id > 0); assert(!jobIds.has(job.id), 'Duplicate matrix job ID'); jobIds.add(job.id);
    assert.equal(job.run_id, admission.runId); assert.equal(job.status, 'completed'); assert.equal(job.conclusion, 'success');
    for (const name of ['Restore exact public source3 and three build input archives', 'Build and qualify new native-only static CRT profile']) {
      const steps = job.steps?.filter(x => x.name === name); assert.equal(steps?.length, 1, 'Missing or duplicate qualification step');
      assert.equal(steps[0].status, 'completed'); assert.equal(steps[0].conclusion, 'success', 'Skipped or unsuccessful compilation/qualification');
    }
    const artifacts = artifactsCapture.artifacts.filter(x => x.name === `static-windows-${pin.app}`); assert.equal(artifacts.length, 1, 'Missing or duplicate actual build artifact');
    const artifact = artifacts[0]; assert.equal(artifact.id, pin.artifactId); assert.equal(artifact.size_in_bytes, pin.bytes); assert.equal(artifact.expired, false);
    assert.equal(artifact.digest, `sha256:${pin.sha256}`, 'Actual API archive digest mismatch');
    assert.equal(artifact.workflow_run?.id, admission.runId); assert.equal(artifact.workflow_run?.head_sha, admission.workflowHead);
    assert.equal(artifact.workflow_run?.repository_id, run.repository.id); assert.equal(artifact.workflow_run?.head_repository_id, run.head_repository.id);
  }
  return pins.records;
}
export function validateStaticProfile(profile, {app, runName, inputs, report}) {
  assert.equal(profile.schemaVersion, 1); assert.equal(profile.kind, 'windows-static-crt-native-profile');
  assert.equal(profile.state, 'STATIC_NATIVE_CANDIDATE_QUALIFIED'); assert.equal(profile.error, null);
  assert.equal(profile.app, app); assert.equal(profile.platform, PLATFORM);
  assert.equal(profile.sourceCommit, SOURCE_COMMIT); assert.equal(profile.sourceManifestSha, SOURCE_MANIFEST);
  assert.deepEqual(profile.assets, inputs.assets); assert.equal(profile.buildKind, 'cli'); assert.equal(profile.cargoProfile, 'dev');
  assert.equal(profile.requestedRustflags, STATIC_FLAGS);
  for (const key of ['cargoEncodedRustflagsCleared', 'targetSpecificRustflagsCleared', 'actualCompilation', 'nativeQualified', 'importsVerified']) assert.equal(profile[key], true, `Missing static profile ${key}`);
  for (const key of ['wasmBuilt', 'admitted']) assert.equal(profile[key], false, `Unexpected producer ${key}`);
  assert.deepEqual(profile.bootstrapFiles, BOOTSTRAP_FILES, 'Static producer bootstrap identity differs');
  const sourceProof = {sourceCommit: SOURCE_COMMIT, files: 4889, manifestSha256: SOURCE_MANIFEST, allowedGeneratedRoots: ['build', '.toolchains']};
  assert.deepEqual(profile.sourceBefore, sourceProof); assert.deepEqual(profile.sourceAfter, sourceProof);
  const command = profile.buildCommand;
  assert.equal(typeof command?.executable, 'string'); assert(/^[A-Za-z]:[\\/].*[\\/]node\.exe$/i.test(command.executable), 'Unexpected static bootstrap executable');
  assert.deepEqual(command.args, ['build/progress-ci/source/scripts/engines/offline-build.mjs', app, 'cli']);
  assert.equal(command.cwd, 'build/progress-ci/source'); assert.equal(command.timeoutMs, 7200000);
  assert.deepEqual(command.environment, {RUSTFLAGS: STATIC_FLAGS, CARGO_ENCODED_RUSTFLAGS: null, CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS: null});
  assert.equal(inputs.app, app); assert.equal(inputs.sourceManifestSha, SOURCE_MANIFEST);
  assert.equal(inputs.buildKind, 'cli'); assert.equal(inputs.cargoProfile, 'dev'); assert.equal(inputs.wasmBuilt, false);
  assert.equal(inputs.crtLinkageProfile, 'static-request-and-normal-delay-import-check');
  assert.equal(inputs.staticCrtProfile?.path, 'build/progress-ci/STATIC-CRT-PROFILE.json');
  assert.deepEqual(inputs.limits, profile.limits); assert.deepEqual(profile.networkDenial, report.networkDenial);
  assert.match(runName, /^windows-x64-[A-Za-z0-9_-]+$/);
  return profile;
}
// This reader is separately exported for explicitly synthetic controls. Only
// verifyWindowsStaticResults() may admit actual authority or write an attestation.
export async function verifyStaticEngineDirectory({app, source, directory, zip, identity}) {
  assert(APPS.includes(app));
  assert.equal(identity.app, app); assert.equal(identity.platform, PLATFORM);
  assert.equal((await regular(zip)).size, identity.bytes, `${app}: CI ZIP size mismatch`); await matched(zip, identity.sha256, `${app} CI ZIP`);
  const inventory = await archiveCommand(['-tf', zip]);
  const members = validateMembers(inventory.replace(/(?:\r?\n)+$/, '').split(/\r?\n/));
  const inputsPath = join(directory, 'PUBLIC-INPUTS.json'), inputRecord = await jsonRecord(inputsPath), inputs = inputRecord.value;
  assert.equal(inputs.schemaVersion, 1); assert.equal(inputs.platform, PLATFORM); assert.equal(inputs.sourceCommit, SOURCE_COMMIT);
  assert.equal(inputs.compiled, true); assert.equal(inputs.nativeQualified, true);
  const names = ['office-source-progress3-r1.tar.gz', `office-build-inputs-vendor-${app}.tar.gz`, 'office-build-inputs-support-complete3.tar.gz', 'office-build-inputs-tools-windows-x64-gzip-r1.tar.gz'];
  assert.deepEqual(inputs.assets?.map(x => x.name).sort(), names.sort(), 'Wrong or duplicate public input');
  for (const asset of inputs.assets) assert.equal(asset.sha256, PUBLIC_INPUTS[asset.name], 'Unadmitted public input digest');
  const restoredPath = join(directory, 'RESTORED-INPUTS.json'), restoredRecord = await jsonRecord(restoredPath), restored = restoredRecord.value;
  assert.equal(restored.schemaVersion, 1); assert.equal(restored.platform, PLATFORM); assert.equal(restored.app, app);
  assert.equal(restored.sourceCommit, SOURCE_COMMIT); assert.equal(restored.sourceManifestSha, SOURCE_MANIFEST);
  assert.equal(restored.restored, true); assert.equal(restored.compiled, false); assert.deepEqual(restored.assets, inputs.assets, 'Restored public input evidence differs');
  const runBase = join(directory, 'source/build/engines/offline-builds', app), runs = await readdir(runBase);
  assert.equal(runs.length, 1, 'Expected exactly one isolated build run'); safeMember(runs[0]);
  assert.match(runs[0], /^windows-x64-[A-Za-z0-9_-]+$/, 'Mixed target build run');
  const prefix = `build/engines/offline-builds/${app}/${runs[0]}/`;
  const reportPath = join(runBase, runs[0], 'report.json'), nativePath = join(runBase, runs[0], 'native-qualification.json');
  const reportRecord = await jsonRecord(reportPath), nativeRecord = await jsonRecord(nativePath), report = reportRecord.value, native = nativeRecord.value;
  const profilePath = join(directory, 'STATIC-CRT-PROFILE.json'), profileRecord = await jsonRecord(profilePath), profile = profileRecord.value;
  validateStaticProfile(profile, {app, runName: runs[0], inputs, report});
  assert.equal(inputs.staticCrtProfile.sha256, profileRecord.sha256, 'Public receipt static profile digest differs');
  const readbacks = [[inputsPath, inputRecord.sha256], [restoredPath, restoredRecord.sha256], [reportPath, reportRecord.sha256], [nativePath, nativeRecord.sha256]];
  readbacks.push([profilePath, profileRecord.sha256]);
  assert.equal(report.schemaVersion, 1); assert.equal(report.app, app); assert.equal(report.platform, PLATFORM); assert.equal(report.kind, 'cli'); assert.equal(report.profile, 'dev');
  for (const key of ['passed', 'actualCompilation', 'offline', 'frozen', 'cargoHomeInitiallyEmpty', 'targetInitiallyEmpty']) assert.equal(report[key], true, `${app}: missing ${key}`);
  assert.equal(normalized(report.source), `engines/${app}`); assert.equal(report.supportInputManifestSha256, SUPPORT_MANIFEST); assert.match(report.vendorInputManifestSha256 ?? '', SHA);
  assert.equal(report.sourceSha256Before, report.sourceSha256After); assert.equal(report.sourceSha256After, await sourceHash(join(source, 'engines', app)), 'Different engine source');
  await matched(join(source, 'engines', app, 'Cargo.lock'), report.lockSha256, `${app} frozen lock`);
  assert.deepEqual(report.networkDenial, {established: false, enforcement: 'Cargo and Trunk offline flags only'}, 'Unexpected Windows network evidence; review actual report before changing authority');
  assert.deepEqual(inputs.networkDenial, report.networkDenial, 'Contradictory network evidence');
  await verifyZipMember(zip, members, 'PUBLIC-INPUTS.json', inputsPath);
  await verifyZipMember(zip, members, 'RESTORED-INPUTS.json', restoredPath);
  await verifyZipMember(zip, members, 'STATIC-CRT-PROFILE.json', profilePath);
  await verifyZipMember(zip, members, `source/${prefix}report.json`, reportPath);
  await verifyZipMember(zip, members, `source/${prefix}native-qualification.json`, nativePath);
  assert.equal(report.results?.length, 1, 'Exactly one native CLI build result required');
  const artifacts = []; let workerPe;
  for (const kind of ['cli']) {
    const results = report.results.filter(x => x.kind === kind); assert.equal(results.length, 1, 'Missing or duplicate build kind');
    const result = results[0]; assert.equal(result.exitCode, 0); assert.match(result.sha256 ?? '', SHA);
    const output = safeMember(normalized(result.output));
    assert.equal(output, prefix + (kind === 'cli' ? `runtime/bin/${app}-cli.exe` : 'web'), 'Build output escape or target mismatch');
    assert.equal(safeMember(normalized(result.log)), prefix + (kind === 'cli' ? 'native-build.log' : 'wasm-build.log')); assert.match(result.logSha256 ?? '', SHA);
    const command = safeMember(normalized(result.command)); assert(command.startsWith(`.toolchains/portable/${PLATFORM}/prepared-`), 'Unexpected build tool origin');
    assert(command.endsWith(kind === 'cli' ? '/rust-1.95.0/bin/cargo.exe' : '/tools/bin/trunk.exe'), 'Wrong compile tool');
    if (kind === 'cli') { assert.deepEqual(result.args, ['build', '--frozen', '--offline', '-p', `${app}-cli`]); assert.equal(result.launched, true); }
    else {
      assert.equal(result.args?.length, 6); assert.deepEqual(result.args.slice(0, 5), ['build', '--offline=true', '--frozen=true', '--skip-version-check', '--dist']);
      assert(normalized(result.args[5]).endsWith('/' + output), 'WASM distribution path mismatch');
      assert.equal(result.loadedInBrowser, false); safeMember(result.wasm); assert(!result.wasm.includes('/') && result.wasm.endsWith('.wasm'), 'Unsafe WASM name');
    }
    const suffix = output + (kind === 'wasm' ? '/' + result.wasm : '');
    const file = join(directory, 'source', suffix); await matched(file, result.sha256, `${app} ${kind}`);
    readbacks.push([file, result.sha256]);
    await verifyZipMember(zip, members, `source/${suffix}`, file);
    if (kind === 'cli') {
      workerPe = inspectPe(await readFile(file));
      assert.deepEqual(workerPe.libraries.filter(name => FORBIDDEN_VC_IMPORT.test(name)), [], 'Static worker imports a Microsoft VC runtime DLL');
      assert.equal(profile.pe?.path, `build/progress-ci/source/${suffix}`);
      assert.equal(profile.pe?.size, (await regular(file)).size); assert.equal(profile.pe?.sha256, result.sha256);
      assert.equal(profile.pe?.machine, 'x64'); assert.equal(profile.pe?.machineCode, '0x8664'); assert.equal(profile.pe?.bits, 64);
      assert.deepEqual(profile.pe.imports, [...new Set(workerPe.descriptors.directNames)].sort(), 'Producer direct imports differ from exact descriptor bytes');
      assert.deepEqual(profile.pe.delayImports, [...new Set(workerPe.descriptors.delayedNames)].sort(), 'Producer delay imports differ from exact descriptor bytes');
    }
    else assert.deepEqual((await readFile(file)).subarray(0, 8), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]), 'Expected WASM v1');
    const log = join(directory, 'source', normalized(result.log)); await matched(log, result.logSha256, `${app} ${kind} compile log`); await verifyZipMember(zip, members, `source/${normalized(result.log)}`, log);
    readbacks.push([log, result.logSha256]);
    artifacts.push({kind, path: `${ATTESTED_RESTORED}/ci-engine-results/${PLATFORM}/${app}/source/${suffix}`, sha256: result.sha256});
  }
  assert.equal(native.schemaVersion, 1); assert.equal(native.target, PLATFORM); assert.equal(native.platform, 'win32'); assert.equal(native.architecture, 'x64'); assert.equal(native.actualEngine, true); assert.equal(native.passed, true);
  assert.deepEqual(native.scope, [app]); assert.equal(native.allFourRequested, false); assert.equal(native.results?.length, 1);
  const operation = native.results[0]; assert.equal(operation.app, app); assert.equal(operation.binarySha256, artifacts.find(x => x.kind === 'cli').sha256);
  for (const key of ['passed', 'openEditSaveReopen', 'preservedMarker', 'staleRevisionRejected', 'failedSaveRemainedDirty', 'saveRetrySucceeded', 'unicodeAndSpacePaths']) assert.equal(operation[key], true, `${app}: missing native operation ${key}`);
  assert(Number.isSafeInteger(operation.bytes) && operation.bytes > 100, 'Native saved document evidence is missing');
  assert.equal(operation.rendered, app !== 'gridcraft'); if (app === 'gridcraft') assert.equal(operation.filesystemPolicy, 'scratch-root-checks-not-os-sandbox');
  async function profileFile(record, member, file) {
    assert.deepEqual(Object.keys(record ?? {}).sort(), ['path', 'sha256', 'size']);
    assert.equal(record.path, 'build/progress-ci/' + safeMember(member));
    assert.equal(record.size, (await regular(file)).size); await matched(file, record.sha256, `${app} static profile record`);
    await verifyZipMember(zip, members, member, file); readbacks.push([file, record.sha256]);
  }
  await profileFile(profile.restoredInputs, 'RESTORED-INPUTS.json', restoredPath);
  await profileFile(profile.rawBuildReport, `source/${prefix}report.json`, reportPath);
  await profileFile(profile.nativeQualification, `source/${prefix}native-qualification.json`, nativePath);
  const cliResult = report.results[0], workerMember = `source/${prefix}runtime/bin/${app}-cli.exe`;
  await profileFile(profile.worker, workerMember, join(directory, workerMember));
  assert.equal(profile.worker.sha256, cliResult.sha256);
  await profileFile(profile.nativeBuildLog, `source/${prefix}native-build.log`, join(directory, 'source', prefix, 'native-build.log'));
  assert.equal(profile.nativeBuildLog.sha256, cliResult.logSha256);
  const runtimeRoot = join(runBase, runs[0], 'runtime'), actualRuntime = await filesIn(runtimeRoot);
  assert(Array.isArray(profile.runtimeFiles) && profile.runtimeFiles.length === actualRuntime.length, 'Incomplete static runtime inventory');
  const runtimePrefix = `build/progress-ci/source/${prefix}runtime/`;
  assert.deepEqual(profile.runtimeFiles.map(file => file.path).sort(), actualRuntime.map(file => runtimePrefix + file.path).sort(), 'Static runtime inventory differs');
  assert.equal(new Set(profile.runtimeFiles.map(file => file.path.toLowerCase())).size, profile.runtimeFiles.length, 'Duplicate static runtime record');
  for (const record of profile.runtimeFiles) await profileFile(record, record.path.slice('build/progress-ci/'.length), join(runtimeRoot, record.path.slice(runtimePrefix.length)));
  for (const [file, digest] of readbacks) await matched(file, digest, `${app} evidence after member verification`);
  await matched(zip, identity.sha256, `${app} CI ZIP after member verification`);
  return {...identity, artifactZipSha256: identity.sha256, reportSha256: reportRecord.sha256, nativeQualificationSha256: nativeRecord.sha256, staticProfileSha256: profileRecord.sha256, publicInputsSha256: inputRecord.sha256, restoredInputsSha256: restoredRecord.sha256, nativeBuildLogSha256: cliResult.logSha256, runtimeFiles: profile.runtimeFiles, sourceSha256: report.sourceSha256After, lockSha256: report.lockSha256, networkDenial: report.networkDenial, peImports: workerPe, artifacts};
}
export async function verifyWindowsStaticResults(args = process.argv.slice(2)) {
  const {values} = parseArgs({args, options: {platform: {type: 'string', default: PLATFORM}, source: {type: 'string', default: 'build/public-qualification/progress3/source'}, 'check-only': {type: 'boolean', default: false}}});
  assert.equal(values.platform, PLATFORM, 'This additive verifier admits only Windows x64 source3');
  assertAdmission();
  const source = resolve(values.source);
  async function verifyWorkflowReadback() { await regular(resolve(WORKFLOW_FILE)); assert([WORKFLOW_SHA256, WORKFLOW_CHECKOUT_SHA256].includes(await sha256(resolve(WORKFLOW_FILE))), 'Static workflow is neither exact reviewed LF nor exact Windows CRLF checkout'); }
  await verifyWorkflowReadback();
  const bootstrapReadbacks = BOOTSTRAP_CANONICAL_FILES.filter(row => !row.path.startsWith('build/'));
  async function verifyBootstrapReadbacks() {
    for (const canonical of bootstrapReadbacks) {
      const file = resolve(canonical.path), checkout = BOOTSTRAP_FILES.find(row => row.path === canonical.path), info = await regular(file), digest = await sha256(file);
      assert([canonical, checkout].some(row => row.size === info.size && row.sha256 === digest), 'Local bootstrap is neither exact reviewed LF nor exact fixed Windows CRLF checkout: ' + canonical.path);
    }
  }
  await verifyBootstrapReadbacks();
  const pinsPath = resolve(PIN_FILE), runPath = resolve(CAPTURES, 'run.json'), jobsPath = resolve(CAPTURES, 'jobs.json'), artifactsPath = resolve(CAPTURES, 'artifacts.json');
  const authorityFiles = [[pinsPath, ADMISSION.pinSha256], [runPath, ADMISSION.runCaptureSha256], [jobsPath, ADMISSION.jobsCaptureSha256], [artifactsPath, ADMISSION.artifactsCaptureSha256]];
  for (const [file, digest] of authorityFiles) await matched(file, digest, 'Code-anchored actual CI authority capture');
  const identities = validateAuthority(await json(pinsPath), await json(runPath), await json(jobsPath), await json(artifactsPath));
  await matched(join(source, 'MANIFEST.json'), SOURCE_MANIFEST, 'Exact source3 manifest');
  const manifest = await verifyManifest(source, {expectedKind: 'office-source-progress'});
  assert.equal(manifest.sourceCommit, SOURCE_COMMIT); assert.equal(manifest.files.length, 4889, 'Exact source3 file inventory required');
  const provenancePath = resolve(RESTORED, 'ci-artifact-provenance.json'), provenance = await json(provenancePath), provenanceSha256 = await sha256(provenancePath);
  assert(Array.isArray(provenance) && provenance.length === APPS.length, 'Exactly four CI transfer records required');
  assert.deepEqual(provenance.map(x => x.app).sort(), [...APPS].sort(), 'Missing or duplicate CI transfer app');
  const results = [];
  for (const app of APPS) {
    const pin = identities.find(x => x.app === app), transfer = provenance.find(x => x.app === app);
    for (const key of IDENTITY_FIELDS) assert.equal(transfer[key], pin[key], `${app}: captured transfer ${key} mismatch`);
    results.push(await verifyStaticEngineDirectory({app, source, directory: resolve(RESTORED, 'ci-engine-results', PLATFORM, app), zip: resolve(RESTORED, 'downloads/ci', PLATFORM, app + '.zip'), identity: pin}));
  }
  for (const [file, digest] of authorityFiles) await matched(file, digest, 'Actual CI authority after verification');
  await verifyWorkflowReadback();
  await verifyBootstrapReadbacks();
  await matched(provenancePath, provenanceSha256, 'Transfer provenance after verification');
  await matched(join(source, 'MANIFEST.json'), SOURCE_MANIFEST, 'Exact source3 manifest after verification'); await verifyManifest(source, {expectedKind: 'office-source-progress'});
  const result = {schemaVersion: 1, kind: 'windows-source3-static-native-attestation', buildKind: 'cli', wasmBuilt: false, crtLinkageProfile: 'static-request-and-normal-delay-import-check', bootstrapOrigins: {workflow: {path: WORKFLOW_FILE, sha256: WORKFLOW_SHA256, exactWindowsCheckoutSha256: WORKFLOW_CHECKOUT_SHA256, head: ADMISSION.workflowHead}, canonical: BOOTSTRAP_CANONICAL_FILES, exactWindowsCheckout: BOOTSTRAP_FILES, conversion: 'Exact reviewed LF to CRLF for six checked-out root helpers; two immutable extracted source helpers remain LF'}, sourceCommit: SOURCE_COMMIT, sourceArchiveSha256: SOURCE_ARCHIVE, sourceManifestSha256: SOURCE_MANIFEST, platform: PLATFORM, passed: true, results, limits: ['Exact public progress3 source and inputs only', 'Separate native-only static CRT development profile; optional feature completeness not established', 'Cargo offline flags are not OS network-denial proof', 'No WASM build or browser/private-WebView acceptance in this profile', 'Windows Server is not Windows 11 client acceptance', 'CI worker evidence does not qualify a newly assembled component ZIP', 'PE imports do not establish dynamic module closure or license entitlement', 'No Microsoft/Adobe parity']};
  if (!values['check-only']) await writeFile(resolve(OUTPUT), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  console.log('Exact admitted Windows source3 static-native artifacts and native operations verified for four engines');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await verifyWindowsStaticResults(); } catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
}
