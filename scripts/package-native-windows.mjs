// Separate Windows-only source3 assembler. Missing actual CI authority fails closed.
import assert from 'node:assert/strict';
import {cp, mkdir, readFile, writeFile, readdir, lstat, realpath, chmod} from 'node:fs/promises';
import {join, resolve, dirname, basename, relative, sep} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createManifest, verifyManifest, writeZip, sha256, safeRelative, filesIn} from './lib/artifacts.mjs';

const APPS = ['wordcraft', 'pdfcraft', 'deckcraft', 'gridcraft'];
const SOURCE_COMMIT = 'e8e4364c20018abb1222c69b7e50839abfe62644';
const SOURCE_MANIFEST = '566d2c34f202c0e33e2bd2049fab086642228e781ebc8585a4c431ea472b9daa';
const SOURCE_ARCHIVE = 'ee369702aa8cf550413d000f58ac88d297ede8da01fade5d4ac3c89a1ddc2e6c';
const SOURCE_ARCHIVE_FILE = 'build/progress3-release/office-source-progress3-r1.tar.gz';
const SOURCE_PUBLIC_PROOF_SHA256 = '6d3042244086f7b8f37c854e6416283b9c964ca74b3253d84654a55655ab92cb';
const SOURCE_CHECKS_SHA256 = '1ab0a131f67364f010556746483eb54bcc885aeef115ec4e6da035ece44427ad';
const SUPPORT_MANIFEST = '9a213c32fde8cfbe505364a0f5381587b79e34c2ee9648d1d22e4cd9c518e269';
// Extending this authority requires an explicitly reviewed pin/code update.
// Equality among caller-editable reports, ZIPs and captures cannot admit builds.
const CI_PIN_FILE = 'config/ci-engine-pins-windows-progress3.json';
const CI_PIN_SHA256 = '23812a0d8ccebc377e6d18c4d68e928cf41873e266ae313b3f341811da78b12e';
const STATIC_VERIFIER_FILE = 'scripts/ci/verify-windows-static-results.mjs';
const STATIC_VERIFIER_SHA256 = '19fc1fc58a0f02623ad9d7e7815e44c7f18a4e6d7ef4a58b1664297ec1c855f5';
// One successful static retry run and all four exact API/ZIP identities are
// admitted. Caller-authored captures cannot change these fixed code anchors.
const ACCEPTED_CI_RUN = 42391943016;
const ACCEPTED_CI_HEAD = 'f8b0c730972cf533289646ee29841494446785b7';
const SDK_PIN_FILE = 'config/web-component-pins-progress2.json';
const SDK_PIN_SHA256 = '1342d1848bf4134be21b5daf4b18f12167731ba2018a5a8afde5718bda47392f';
const LEGAL_HELPER_SHA256 = '534fdcf3cdd590b91e66f44df3ffaa008591fb48f2d4fb78c3eb5e8c1460e4ca';
const CI_IDENTITY_FIELDS = ['app', 'platform', 'artifactId', 'runId', 'workflowHead', 'bytes', 'sha256'];
const PUBLIC_INPUTS = Object.freeze({
  'office-source-progress3-r1.tar.gz': SOURCE_ARCHIVE,
  'office-build-inputs-support-complete3.tar.gz': 'b044c20cfc2a8f470268065fd44a3f2ab2e0837c09a89856bfbc902377e9595c',
  'office-build-inputs-tools-windows-x64-gzip-r1.tar.gz': '02a82e36f2c9df54908efa3a0aa431fde27e5c776e12cea8464c980217bc0ddd',
  'office-build-inputs-vendor-wordcraft.tar.gz': '95a914506a4439e285b669d562ebb113daa53818259572e3025e2e568ae6a382',
  'office-build-inputs-vendor-pdfcraft.tar.gz': '8c5fd6b02020a2309803182c9b34ca5680ea46165de8aa2099b45ca8d7e0f9f3',
  'office-build-inputs-vendor-deckcraft.tar.gz': '762e55795c534cbffade71d7c336fae367e1b8bc3176f7f261526e44ee3b7992',
  'office-build-inputs-vendor-gridcraft.tar.gz': 'e3a5d7e800bdbe90529783db1381225d9c3f9eb1c42f96fcdbe6383c8997dab5',
});
// Read both ordinary and delay-load imports directly from the admitted bytes.
// This inventory does not assert that an untested Windows host supplies them.
export function inspectWindowsPe(bytes) {
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
export async function assemble(args = process.argv.slice(2)) {
const {values} = parseArgs({args, options: {platform: {type: 'string'}, report: {type: 'string'}, source: {type: 'string'}, output: {type: 'string'}}});
const platform = values.platform;
assert.equal(platform, 'windows-x64', 'Windows assembler requires --platform windows-x64');
assert(values.report && values.source && values.output, 'Provide --report, --source and --output');
const root = resolve('.'), source = resolve(values.source), support = resolve('build/engines/support-inputs'), output = resolve(values.output);
const inside = (base, file) => file === base || file.startsWith(base + sep);
// Inspect all existing ancestors without creating them. An output alias must
// never become a write into an input tree after the input's final verification.
async function canonicalCandidate(file) {
  let ancestor = file, suffix = [];
  while (true) {
    try {
      const info = await lstat(ancestor);
      assert(!info.isSymbolicLink(), `Symlink output ancestor is forbidden: ${ancestor}`);
      assert(info.isDirectory(), `Output ancestor is not a directory: ${ancestor}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor); continue;
    }
    // Even an existing directory can have a symlink farther up its path.
    let parent = ancestor;
    while (dirname(parent) !== parent) {
      parent = dirname(parent);
      const info = await lstat(parent);
      assert(!info.isSymbolicLink(), `Symlink output ancestor is forbidden: ${parent}`);
      assert(info.isDirectory(), `Output ancestor is not a directory: ${parent}`);
    }
    return join(await realpath(ancestor), ...suffix);
  }
}
const stagingRoot = resolve('build/windows-native-progress/stages');
const readInputs = [
  ...[source, support, resolve('build/windows-native-progress/ci-engine-results'), resolve('build/windows-native-progress/downloads/ci'), resolve('build/windows-native-progress/static-authority'), resolve('.github'), resolve('packages'), resolve('config'), resolve('scripts'), resolve('docs/verification'), dirname(fileURLToPath(import.meta.url))].map(path => ({path, kind: 'directory'})),
  ...[resolve(values.report), resolve('LICENSE'), resolve(SOURCE_ARCHIVE_FILE), resolve('build/windows-native-progress/ci-artifact-provenance.json')].map(path => ({path, kind: 'file'})),
];
async function canonicalReadInput({path, kind}) {
  // Reserve lexical locations even when a known input tree is absent. Also
  // protect the real target of an existing input alias, including file inputs.
  const lexical = join(await canonicalCandidate(dirname(path)), basename(path));
  let canonical;
  try {
    canonical = await realpath(path);
    const info = await lstat(canonical);
    assert(kind === 'directory' ? info.isDirectory() : info.isFile(), `Invalid read input ${kind}: ${path}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; canonical = lexical; }
  return [...new Set([lexical, canonical])];
}
async function checkOutputRoots() {
  const canonicalOutputs = await Promise.all([output, output + '.partial', output + '.json', output + '.sha256'].map(async file => join(await canonicalCandidate(dirname(file)), basename(file))));
  const canonicalStage = await canonicalCandidate(stagingRoot);
  for (const input of readInputs) for (const protectedRoot of await canonicalReadInput(input)) {
    for (const canonicalOutput of canonicalOutputs) assert(!inside(protectedRoot, canonicalOutput), `Archive output overlaps a canonical input: ${input.path}`);
    assert(!inside(protectedRoot, canonicalStage), `Staging root overlaps a canonical input: ${input.path}`);
  }
}
await checkOutputRoots();
async function absent(file) {
  try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error(`Refusing existing output: ${file}`);
}
for (const file of [output, output + '.partial', output + '.json', output + '.sha256']) await absent(file);
async function regular(file) {
  assert.equal(await realpath(file), resolve(file), `Symlink path is forbidden: ${file}`);
  assert((await lstat(file)).isFile(), `Expected regular file: ${file}`);
  return file;
}
async function json(file) { return JSON.parse(await readFile(await regular(file), 'utf8')); }
async function matched(file, expected, label) {
  assert.match(expected ?? '', /^[a-f0-9]{64}$/, `Missing ${label} hash`);
  assert.equal(await sha256(await regular(file)), expected, `${label} hash mismatch`);
}
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe') : '/usr/bin/tar';
async function archiveCommand(args, hashOnly = false) {
  const child = spawn(tar, args, {stdio: ['ignore', 'pipe', 'pipe']});
  const hash = createHash('sha256'); let bytes = 0, stdout = '', stderr = '';
  const timer = setTimeout(() => child.kill(), 120000);
  child.stdout.on('data', chunk => { bytes += chunk.length; if (hashOnly) hash.update(chunk); else if (bytes <= 4 * 1024 * 1024) stdout += chunk; else child.kill(); });
  child.stderr.on('data', chunk => { if (stderr.length < 65536) stderr += chunk; });
  let code;
  try { code = await new Promise((yes, no) => { child.once('error', no); child.once('close', yes); }); }
  finally { clearTimeout(timer); }
  assert.equal(code, 0, `CI ZIP member inspection failed: ${stderr}`);
  if (!hashOnly) assert(bytes <= 4 * 1024 * 1024, 'CI ZIP member inventory is too large');
  return hashOnly ? {bytes, sha256: hash.digest('hex')} : stdout;
}
async function memberMatches(zip, members, member, file) {
  safeRelative(member); assert(!/[\r\n*?\[]/.test(member), 'Unsafe CI ZIP member pattern');
  assert.equal(members.filter(name => name === member).length, 1, `Missing or duplicate CI ZIP member: ${member}`);
  const zipped = await archiveCommand(['-xOf', zip, '--', member], true);
  assert.equal(zipped.bytes, (await lstat(await regular(file))).size, `CI ZIP member size mismatch: ${member}`);
  assert.equal(zipped.sha256, await sha256(file), `CI ZIP member hash mismatch: ${member}`);
}
const attestationPath = resolve(values.report), attestation = await json(attestationPath);
assert.equal(attestation.schemaVersion, 1);
assert.equal(attestation.platform, platform, 'Mixed target attestation');
assert.equal(attestation.sourceCommit, SOURCE_COMMIT, 'Stale source commit');
assert.equal(attestation.sourceArchiveSha256, SOURCE_ARCHIVE, 'Stale source archive');
assert.equal(attestation.sourceManifestSha256, SOURCE_MANIFEST, 'Stale source manifest');
assert.equal(attestation.passed, true, 'Unsuccessful public engine attestation');
assert.equal(attestation.results?.length, APPS.length, 'Exactly four engine records are required');
assert.deepEqual([...attestation.results.map(x => x.app)].sort(), [...APPS].sort(), 'Missing or duplicate engine record');
await matched(resolve(CI_PIN_FILE), CI_PIN_SHA256, 'Code-anchored CI authority pin file');
const ciPins = await json(resolve(CI_PIN_FILE));
assert.equal(ciPins.schemaVersion, 1, 'Invalid CI pin schema');
assert.equal(ciPins.kind, 'windows-source3-static-native-ci-authority', 'Wrong CI authority kind');
assert.equal(ciPins.status, 'ADMITTED_ACTUAL_SUCCESSFUL_CI', 'Actual successful Windows CI authority is pending');
assert(Number.isSafeInteger(ACCEPTED_CI_RUN) && ACCEPTED_CI_RUN > 0 && /^[a-f0-9]{40}$/.test(ACCEPTED_CI_HEAD ?? ''), 'No reviewed actual Windows CI run/head is admitted');
assert.equal(ciPins.repository, 'Mohammed-Moniem/embedded-office-suite', 'Wrong CI pin repository');
assert.equal(ciPins.sourceCommit, SOURCE_COMMIT, 'Wrong CI pin source commit');
assert.equal(ciPins.sourceManifestSha256, SOURCE_MANIFEST, 'Wrong CI pin source manifest');
assert.equal(ciPins.sourceArchiveSha256, SOURCE_ARCHIVE, 'Wrong CI pin source archive');
assert(Array.isArray(ciPins.records) && ciPins.records.length === APPS.length, 'Exactly four Windows CI authority records are required');
const pinIdentities = new Set();
for (const pin of ciPins.records) {
  assert.deepEqual(Object.keys(pin).sort(), [...CI_IDENTITY_FIELDS].sort(), 'Incomplete CI authority record');
  assert(APPS.includes(pin.app) && pin.platform === 'windows-x64', 'Unknown Windows CI authority app/target');
  for (const key of ['artifactId', 'runId', 'bytes']) assert(Number.isSafeInteger(pin[key]) && pin[key] > 0, `Invalid CI authority ${key}`);
  assert.match(pin.workflowHead, /^[a-f0-9]{40}$/); assert.match(pin.sha256, /^[a-f0-9]{64}$/);
  assert.equal(pin.runId, ACCEPTED_CI_RUN, 'Unadmitted CI run'); assert.equal(pin.workflowHead, ACCEPTED_CI_HEAD, 'Unadmitted CI workflow head');
  const identity = `${pin.platform}/${pin.app}`; assert(!pinIdentities.has(identity), 'Duplicate CI authority association'); pinIdentities.add(identity);
}
await matched(resolve(SDK_PIN_FILE), SDK_PIN_SHA256, 'Code-anchored integration SDK authority');
const sdkAuthority = await json(resolve(SDK_PIN_FILE));
assert.equal(sdkAuthority.schemaVersion, 1); assert.equal(sdkAuthority.kind, 'reviewed-web-component-authority');
const sdkRoot = resolve('packages/node');
async function sdkInventory(directory) {
  return (await filesIn(directory)).filter(file => !file.path.split('/').some(part => ['test', 'node_modules'].includes(part)));
}
async function verifySdk(directory) {
  assert(Array.isArray(sdkAuthority.sdk?.node) && sdkAuthority.sdk.node.length === 12, 'Complete reviewed 12-file Node SDK authority is required');
  const actual = await sdkInventory(directory), expected = sdkAuthority.sdk.node;
  assert.deepEqual(actual.map(x => x.path).sort(), expected.map(x => safeRelative(x.path)).sort(), 'Integration SDK inventory mismatch');
  assert.equal(new Set(expected.map(x => x.path)).size, expected.length, 'Duplicate SDK authority entry');
  for (const row of expected) {
    const file = actual.find(x => x.path === row.path);
    assert.equal(file.size, row.bytes, `Integration SDK size mismatch: ${row.path}`);
    assert.equal(file.mode, row.mode, `Integration SDK mode mismatch: ${row.path}`);
    await matched(file.absolute, row.sha256, `Integration SDK ${row.path}`);
  }
}
await verifySdk(sdkRoot);
const legalHelperUrl = new URL('./lib/component-legal.mjs', import.meta.url);
await matched(fileURLToPath(legalHelperUrl), LEGAL_HELPER_SHA256, 'Reviewed asset notice helper');
const {copyEngineAssetNotices} = await import(legalHelperUrl.href);

await matched(join(source, 'MANIFEST.json'), SOURCE_MANIFEST, 'Frozen source manifest');
const sourceManifest = await verifyManifest(source, {expectedKind: 'office-source-progress'});
assert.equal(sourceManifest.sourceCommit, SOURCE_COMMIT);
assert.equal(sourceManifest.files.length, 4889, 'Incomplete exact source3 manifest');
await matched(resolve(SOURCE_ARCHIVE_FILE), SOURCE_ARCHIVE, 'Exact public source3 archive');
await matched(resolve('LICENSE'), sdkAuthority.integrationLicenseSha256, 'Current integration license');
assert.equal(await sha256(resolve('LICENSE')), await sha256(join(source, 'LICENSE')), 'Current and frozen integration licenses differ');
await matched(join(support, 'MANIFEST.json'), SUPPORT_MANIFEST, 'Captured support manifest');
const supportManifest = await verifyManifest(support, {expectedKind: 'captured-support-build-inputs'});
const publicPath = resolve('docs/verification/public-download-source3.json');
await matched(publicPath, SOURCE_PUBLIC_PROOF_SHA256, 'Reviewed anonymous source3 download proof');
const publicProof = await json(publicPath);
assert(publicProof.passed && publicProof.anonymousPublicFetch && publicProof.fullSourceGitBlobsAndModesVerified === 4889, 'Public source3 download attestation is incomplete');
assert.equal(publicProof.sourceCommit, SOURCE_COMMIT);
assert.equal(publicProof.files?.find(x => x.role === 'source')?.manifestSha256, SOURCE_MANIFEST);
const publicAssets = new Map(publicProof.files.map(x => [x.name, x]));
assert.equal(publicAssets.get('office-source-progress3-r1.tar.gz')?.sha256, SOURCE_ARCHIVE);
assert.equal(publicAssets.get('office-source-progress3-r1.tar.gz')?.anonymousDownloadVerified, true);
const sourceChecksPath = resolve('docs/verification/source3-checks-macos-arm64.json');
await matched(sourceChecksPath, SOURCE_CHECKS_SHA256, 'Reviewed source3 SDK/helper checks');
const sourceChecks = await json(sourceChecksPath);
assert.equal(sourceChecks.passed, true); assert.equal(sourceChecks.sourceCommit, SOURCE_COMMIT);
assert.equal(sourceChecks.sourceArchiveSha256, SOURCE_ARCHIVE); assert.equal(sourceChecks.sourceManifestSha256, SOURCE_MANIFEST);
assert.equal(sourceChecks.publicDownloadReportSha256, SOURCE_PUBLIC_PROOF_SHA256);
assert.equal(sourceChecks.exactSourceManifestStillUnchanged, true);
assert.equal(sourceChecks.counts?.sdk, 106); assert.equal(sourceChecks.counts?.portableTools, 22);
const ciProvenancePath = resolve('build/windows-native-progress/ci-artifact-provenance.json');
const ciProvenanceSha256 = await sha256(await regular(ciProvenancePath));
const ciProvenance = await json(ciProvenancePath);
assert(Array.isArray(ciProvenance) && ciProvenance.length === APPS.length, 'Exactly four captured Windows CI artifact provenance records are required');

async function sourceHash(directory) {
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
const attestationSha256 = await sha256(attestationPath);
await matched(resolve(STATIC_VERIFIER_FILE), STATIC_VERIFIER_SHA256, 'Reviewed public static-native verifier');
const {verifyWindowsStaticResults, ADMISSION: staticAdmission} = await import(pathToFileURL(resolve(STATIC_VERIFIER_FILE)).href);
const verified = await verifyWindowsStaticResults(['--check-only', '--source', source]);
assert.deepEqual(attestation, verified, 'Static aggregate differs from recomputed actual ZIP evidence');
const records = [];
for (const app of APPS) {
  const aggregate = verified.results.find(row => row.app === app), pin = ciPins.records.find(row => row.app === app);
  const association = ciProvenance.find(row => row.app === app);
  for (const key of CI_IDENTITY_FIELDS) assert.equal(association?.[key], pin[key], app + ': static transfer identity differs');
  const directory = join(root, 'build/windows-native-progress/ci-engine-results', platform, app);
  const runBase = join(directory, 'source/build/engines/offline-builds', app), runs = await readdir(runBase);
  assert.equal(runs.length, 1); safeRelative(runs[0]);
  const run = join(runBase, runs[0]), reportPath = join(run, 'report.json'), nativePath = join(run, 'native-qualification.json');
  const report = await json(reportPath), inputsPath = join(directory, 'PUBLIC-INPUTS.json');
  const profilePath = join(directory, 'STATIC-CRT-PROFILE.json'), restoredPath = join(directory, 'RESTORED-INPUTS.json'), logPath = join(run, 'native-build.log');
  const worker = join(run, 'runtime/bin', app + '-cli.exe');
  assert.equal(aggregate.artifacts.length, 1); assert.equal(aggregate.artifacts[0].kind, 'cli');
  const peImports = inspectWindowsPe(await readFile(worker));
  assert.deepEqual(peImports, aggregate.peImports);
  assert.deepEqual(peImports.libraries.filter(name => /^(?:vcruntime|msvcp|concrt|msvcr).*\.dll$/i.test(name)), [], 'Static worker has a VC runtime import');
  records.push({app, aggregate, association, pin, zip: resolve('build/windows-native-progress/downloads/ci', platform, app + '.zip'), inputsPath, inputsSha256: aggregate.publicInputsSha256, reportPath, nativePath, profilePath, restoredPath, logPath, report, artifacts: {cli: {file: worker, sha256: aggregate.artifacts[0].sha256, peImports}}});
}

// Every input has passed before assembly starts. Only the copied, hash-verified
// POSIX workers regain execute permission lost by GitHub artifact extraction.
await checkOutputRoots();
await matched(resolve(CI_PIN_FILE), CI_PIN_SHA256, 'CI authority pin file before staging');
const stage = join(stagingRoot, `stage-${platform}-${randomUUID()}`);
await mkdir(join(stage, 'runtime/bin'), {recursive: true});
const provenance = {schemaVersion: 1, kind: 'source-derived-integration-progress', revision: 'r1', component: 'native-static-crt-only', status: 'IN_PROGRESS', platform, sourceCommit: SOURCE_COMMIT, sourceManifestSha256: SOURCE_MANIFEST, sourceArchiveSha256: SOURCE_ARCHIVE, supportInputManifestSha256: SUPPORT_MANIFEST, publicEngineAttestationSha256: await sha256(attestationPath), workerOrigin: {profile: 'separate native-only static CRT', requestedRustflags: '-C target-feature=+crt-static', source: 'exact public source3-r1', sourceCommit: SOURCE_COMMIT, sourceManifestSha256: SOURCE_MANIFEST, ciAuthoritySha256: CI_PIN_SHA256}, integrationSdkOrigin: {source: 'current reviewed packages/node; separate code-anchored 12-file SDK authority', authority: 'evidence/integration-sdk-authority.json', authoritySha256: SDK_PIN_SHA256, inventory: 'sdk.node', files: sdkAuthority.sdk.node.length}, integrationLicenseOrigin: {source: 'current root LICENSE', sha256: sdkAuthority.integrationLicenseSha256, equalsFrozenSource3License: true}, assetNoticeHelperSha256: LEGAL_HELPER_SHA256, staticVerifierSha256: STATIC_VERIFIER_SHA256, bootstrapOrigins: verified.bootstrapOrigins, engines: [], limits: ['Separate CLI-only static CRT profile; no WASM evidence is required or admitted', 'Cargo offline flags are not target OS network-denial proof', 'Normal/delay imports exclude VC runtime DLLs; dynamic module closure and license entitlement remain separate', 'Development profile; exact ZIP target qualification and public download qualification remain required', 'Windows Server evidence does not establish Windows 11 acceptance', 'Not private-host integration or Microsoft/Adobe parity']};
await cp(sdkRoot, join(stage, 'sdk/node'), {recursive: true, errorOnExist: true, force: false, filter: file => !relative(sdkRoot, file).split(sep).some(part => ['test', 'node_modules'].includes(part))});
await verifySdk(join(stage, 'sdk/node'));
await cp(resolve('LICENSE'), join(stage, 'INTEGRATION-LICENSE.txt'));
await cp(join(support, 'support'), join(stage, 'runtime/support'), {recursive: true, errorOnExist: true, force: false});
await cp(join(support, 'support/pdfcraft-models'), join(stage, 'runtime/bin/models'), {recursive: true, errorOnExist: true, force: false});
await mkdir(join(stage, 'evidence'), {recursive: true});
await cp(join(source, 'MANIFEST.json'), join(stage, 'evidence/frozen-source-MANIFEST.json'));
await cp(join(support, 'MANIFEST.json'), join(stage, 'evidence/support-MANIFEST.json'));
await cp(join(support, 'SUPPORT-PROVENANCE.json'), join(stage, 'evidence/SUPPORT-PROVENANCE.json'));
await cp(publicPath, join(stage, 'evidence/public-download-source3.json'));
await cp(sourceChecksPath, join(stage, 'evidence/source3-checks-macos-arm64.json'));
await writeFile(join(stage, 'evidence/public-build-input-authority.json'), JSON.stringify({schemaVersion: 1, kind: 'code-anchored-public-build-inputs', files: PUBLIC_INPUTS}, null, 2) + '\n');
await cp(attestationPath, join(stage, 'evidence/public-engine-builds.json'));
await cp(resolve(SDK_PIN_FILE), join(stage, 'evidence/integration-sdk-authority.json'));
await cp(resolve(CI_PIN_FILE), join(stage, 'evidence/ci-engine-pins-windows-progress3.json'));
await cp(ciProvenancePath, join(stage, 'evidence/static-transfer-provenance.json'));
await matched(join(stage, 'evidence/static-transfer-provenance.json'), ciProvenanceSha256, 'Copied exact static transfer provenance');
await writeFile(join(stage, 'evidence/static-bootstrap-origins.json'), JSON.stringify(verified.bootstrapOrigins, null, 2) + '\n');
for (const [name, expected] of [['run', staticAdmission.runCaptureSha256], ['jobs', staticAdmission.jobsCaptureSha256], ['artifacts', staticAdmission.artifactsCaptureSha256]]) {
  const file = resolve('build/windows-native-progress/static-authority', name + '.json');
  await matched(file, expected, `Static CI ${name} authority`);
  await cp(file, join(stage, 'evidence/static-CI-' + name + '.json'));
  await matched(join(stage, 'evidence/static-CI-' + name + '.json'), expected, `Copied static CI ${name} authority`);
}
async function copyWindowsCiFile(file, destination) {
  await cp(file, destination, {errorOnExist: true, force: false});
  // GitHub CI ZIP regular files may restore as0666. Canonicalize only these
  // new stage copies; source, SDK and support modes retain their own authority.
  await chmod(destination, 0o644);
  assert.equal((await lstat(destination)).mode & 0o777, 0o644, 'Noncanonical copied Windows CI mode');
}
for (const {app, aggregate, inputsPath, inputsSha256, reportPath, nativePath, profilePath, restoredPath, logPath, report, artifacts} of records) {
  const worker = join(stage, 'runtime/bin', `${app}-cli${platform === 'windows-x64' ? '.exe' : ''}`);
  await copyWindowsCiFile(artifacts.cli.file, worker); await matched(worker, artifacts.cli.sha256, `${app} staged worker`);
  const legal = join(stage, 'licences', app); await mkdir(legal, {recursive: true});
  for (const name of ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'ATTRIBUTION.md']) await cp(join(source, 'engines', app, name), join(legal, name));
  for (const name of ['licenses', 'ATTRIBUTION.toml', 'LICENSES.toml']) {
    try { await lstat(join(source, 'engines', app, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await cp(join(source, 'engines', app, name), join(legal, name), {recursive: true});
  }
  const assetNotices = await copyEngineAssetNotices(join(source, 'engines', app), legal);
  for (const notice of assetNotices) {
    const frozen = sourceManifest.files.find(file => file.path === `engines/${app}/${notice.path}`);
    assert(frozen, `Unlisted original asset notice: ${app}/${notice.path}`);
    assert.deepEqual(notice, {path: notice.path, bytes: frozen.bytes, mode: frozen.mode, sha256: frozen.sha256}, `Asset notice differs from frozen source: ${app}/${notice.path}`);
  }
  assert.deepEqual(assetNotices, sdkAuthority.components.find(component => component.app === app)?.assetNotices, `${app}: original notice authority differs`);
  const evidence = join(stage, 'evidence', app); await mkdir(evidence, {recursive: true});
  for (const [file, name] of [[inputsPath, 'PUBLIC-INPUTS.json'], [reportPath, 'offline-build.json'], [nativePath, 'native-qualification.json'], [profilePath, 'STATIC-CRT-PROFILE.json'], [restoredPath, 'RESTORED-INPUTS.json'], [logPath, 'native-build.log']]) await copyWindowsCiFile(file, join(evidence, name));
  await matched(join(evidence, 'offline-build.json'), aggregate.reportSha256, `${app} copied build evidence`);
  await matched(join(evidence, 'native-qualification.json'), aggregate.nativeQualificationSha256, `${app} copied native evidence`);
  await matched(join(evidence, 'STATIC-CRT-PROFILE.json'), aggregate.staticProfileSha256, `${app} copied static profile`);
  await matched(join(evidence, 'RESTORED-INPUTS.json'), aggregate.restoredInputsSha256, `${app} copied restored receipt`);
  await matched(join(evidence, 'native-build.log'), aggregate.nativeBuildLogSha256, `${app} copied native build log`);
  await matched(inputsPath, inputsSha256, `${app} input evidence after copy`);
  await matched(join(evidence, 'PUBLIC-INPUTS.json'), inputsSha256, `${app} copied input evidence`);
  await matched(records.find(record => record.app === app).zip, aggregate.artifactZipSha256, `${app} CI ZIP after copying`);
  provenance.engines.push({app, profile: report.profile, peImports: artifacts.cli.peImports, nativeSha256: artifacts.cli.sha256, staticProfileSha256: aggregate.staticProfileSha256, nativeBuildLogSha256: aggregate.nativeBuildLogSha256, crtLinkageProfile: 'static-request-and-normal-delay-import-check', sourceSha256: report.sourceSha256After, lockSha256: report.lockSha256, artifactZipSha256FromPublicAttestation: aggregate.artifactZipSha256, buildReportSha256: aggregate.reportSha256, nativeQualificationSha256: aggregate.nativeQualificationSha256, evidence: `evidence/${app}/`, networkDenial: report.networkDenial, assetNotices});
}
assert.equal(provenance.engines.flatMap(engine => engine.assetNotices).length, 11, 'All eleven original font/icon notices are required');
await writeFile(join(stage, 'PE-IMPORTS.json'), JSON.stringify({schemaVersion: 1, platform, exactWorkers: provenance.engines.map(({app, nativeSha256, peImports}) => ({app, sha256: nativeSha256, ...peImports})), scope: 'Static ordinary and delay-load import descriptors only; runtime resolution must be tested on the exact Windows archive', targetRuntimeQualified: false}, null, 2) + '\n');
// Recheck copied trees against the verified inputs to catch an input change
// during copying. This also guarantees all SDK files, support and legal data.
async function copiedTree(original, destination) {
  const before = await filesIn(original), after = await filesIn(destination);
  assert.deepEqual(after.map(x => x.path), before.map(x => x.path), 'Copied tree inventory changed');
  for (const file of before) await matched(join(destination, file.path), await sha256(file.absolute), `Copied ${file.path}`);
}
await verifySdk(sdkRoot); await verifySdk(join(stage, 'sdk/node'));
await matched(resolve(SDK_PIN_FILE), SDK_PIN_SHA256, 'SDK authority after copy');
await matched(fileURLToPath(legalHelperUrl), LEGAL_HELPER_SHA256, 'Asset notice helper after copy');
await matched(publicPath, SOURCE_PUBLIC_PROOF_SHA256, 'Source3 public proof after copy');
await matched(sourceChecksPath, SOURCE_CHECKS_SHA256, 'Source3 checks after copy');
await matched(join(stage, 'evidence/public-download-source3.json'), SOURCE_PUBLIC_PROOF_SHA256, 'Copied source3 public proof');
await matched(join(stage, 'evidence/source3-checks-macos-arm64.json'), SOURCE_CHECKS_SHA256, 'Copied source3 checks');
await matched(join(stage, 'evidence/integration-sdk-authority.json'), SDK_PIN_SHA256, 'Copied SDK authority');
await matched(join(stage, 'evidence/ci-engine-pins-windows-progress3.json'), CI_PIN_SHA256, 'Copied CI authority');
await matched(ciProvenancePath, ciProvenanceSha256, 'Static transfer provenance after copy');
await matched(join(stage, 'evidence/frozen-source-MANIFEST.json'), SOURCE_MANIFEST, 'Copied source3 manifest');
await matched(join(stage, 'evidence/support-MANIFEST.json'), SUPPORT_MANIFEST, 'Copied support manifest');
await matched(join(stage, 'INTEGRATION-LICENSE.txt'), sdkAuthority.integrationLicenseSha256, 'Copied integration license');
await copiedTree(join(support, 'support'), join(stage, 'runtime/support'));
await copiedTree(join(support, 'support/pdfcraft-models'), join(stage, 'runtime/bin/models'));
for (const {app} of records) {
  const legal = join(stage, 'licences', app), assetNotices = provenance.engines.find(engine => engine.app === app).assetNotices;
  const selected = file => ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'ATTRIBUTION.md', 'ATTRIBUTION.toml', 'LICENSES.toml'].includes(file) || file.startsWith('licenses/') || assetNotices.some(notice => notice.path === file);
  const expected = sourceManifest.files.filter(file => file.path.startsWith(`engines/${app}/`) && selected(file.path.slice(`engines/${app}/`.length))).map(file => ({...file, path: file.path.slice(`engines/${app}/`.length)}));
  const copied = await filesIn(legal);
  assert.deepEqual(copied.map(file => file.path).sort(), expected.map(file => file.path).sort(), `${app}: incomplete legal inventory`);
  for (const file of expected) { await matched(join(legal, file.path), file.sha256, `${app} legal ${file.path}`); assert.equal(copied.find(item => item.path === file.path).mode, file.mode, `${app}: changed legal mode`); }
}
await matched(join(stage, 'evidence/SUPPORT-PROVENANCE.json'), await sha256(join(support, 'SUPPORT-PROVENANCE.json')), 'Copied support provenance');
await matched(attestationPath, attestationSha256, 'Engine attestation after copy');
await matched(join(stage, 'evidence/public-engine-builds.json'), attestationSha256, 'Copied engine attestation');
await matched(join(source, 'MANIFEST.json'), SOURCE_MANIFEST, 'Frozen source manifest after copy');
await matched(join(support, 'MANIFEST.json'), SUPPORT_MANIFEST, 'Support manifest after copy');
await verifyManifest(source, {expectedKind: 'office-source-progress'});
await verifyManifest(support, {expectedKind: 'captured-support-build-inputs'});
assert.equal(supportManifest.files.length, (await json(join(stage, 'evidence/support-MANIFEST.json'))).files.length);
await writeFile(join(stage, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
await writeFile(join(stage, 'README.md'), `# Embedded Office native worker progress component r1\n\nStatus: IN_PROGRESS. Target: ${platform}. Workers originate from the exact public source3-r1 and separate admitted native-only static CRT CI ZIPs. The producer scopes +crt-static to CLI builds and clears encoded and target-specific overrides; no WASM is built or admitted by this profile. Normal/delay imports exclude VC runtime DLLs; Windows OS DLLs remain prerequisites, and dynamic module closure and license entitlement remain separate qualification. The integration SDK comes from the separately code-anchored current reviewed Node SDK inventory, including later documentation and native example fixes. The worker and SDK authorities remain distinct. OCR models, fonts, language data, all original engine font/icon asset notices and their legal data are included.\n\nExisting Node >=22 is supplied by the host. Import sdk/node/index.mjs and configure worker paths under runtime/bin. Configure Grid with filesystemPolicy: 'automation-roots'. The documented sdk/node/examples/native-smoke.mjs example selects that Grid policy and supports each of the four workers. The host controls file grants, side-effect approval and atomic storage. Grid headless render is unsupported.\n\nThis ZIP contains native workers only. WASM pages, the browser SDK and browser/private-WebView qualification are separate component delivery. No standalone GUI, Node runtime or Cargo toolchain is included. The host supplies Node and Windows OS prerequisites. Exact target dependency closure remains separately qualified.\n\nVerify MANIFEST.json hashes and modes before use. PROVENANCE.json distinguishes worker and integration SDK origins; evidence/ contains their separate authorities. CI native evidence does not qualify this newly assembled ZIP until that exact ZIP is extracted and tested on its target. Foreign archives remain unqualified until exact target tests pass. Windows Server CI does not establish Windows 11 acceptance. This progress component does not establish private-host integration, complete offline rebuild coverage or Microsoft/Adobe parity.\n`);
const manifest = await createManifest(stage, {kind: provenance.kind, component: provenance.component, status: 'IN_PROGRESS', platform, sourceCommit: SOURCE_COMMIT, qualification: 'CI_NATIVE_EVIDENCE_ONLY_EXACT_ZIP_QUALIFICATION_SEPARATE'});
await verifyManifest(stage, {expectedKind: provenance.kind, expectedPlatform: platform});
assert(!manifest.files.some(x => x.path.startsWith('web/') || x.path.endsWith('.wasm')), 'Native component unexpectedly includes WASM');
for (const file of [output, output + '.partial', output + '.json', output + '.sha256']) await absent(file);
await checkOutputRoots();
await matched(resolve(CI_PIN_FILE), CI_PIN_SHA256, 'CI authority pin file before archive output');
const archive = await writeZip(stage, output);
await verifyManifest(stage, {expectedKind: provenance.kind, expectedPlatform: platform});
const result = {...archive, stage, revision: 'r1', kind: manifest.kind, component: manifest.component, status: manifest.status, platform, sourceCommit: SOURCE_COMMIT, sourceManifestSha256: SOURCE_MANIFEST, supportInputManifestSha256: SUPPORT_MANIFEST, manifestSha256: await sha256(join(stage, 'MANIFEST.json')), manifestFiles: manifest.files.length, workers: provenance.engines.map(({app, nativeSha256}) => ({app, sha256: nativeSha256})), assetNotices: provenance.engines.map(({app, assetNotices}) => ({app, files: assetNotices})), sdkAuthoritySha256: SDK_PIN_SHA256, integrationSdkFiles: sdkAuthority.sdk.node.length, ciPinAuthoritySha256: CI_PIN_SHA256, staticVerifierSha256: STATIC_VERIFIER_SHA256, transferProvenanceSha256: ciProvenanceSha256, ciArtifactBindings: records.map(({pin}) => ({...pin, streamedMemberIdentityVerified: true})), exactArchiveQualified: false};
await mkdir(dirname(output), {recursive: true});
await writeFile(output + '.sha256', `${archive.sha256}  ${basename(output)}\n`, {flag: 'wx'});
await writeFile(output + '.json', JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify(result, null, 2));

}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await assemble(); } catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
}
