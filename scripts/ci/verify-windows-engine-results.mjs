// Additive source3 Windows verifier with a candidate-local actual API authority.
// The unchanged default native plus WASM CI contract admits only its exact ZIPs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, readdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
// Both this candidate and its eventual scripts/ci installation are two levels
// below the repository root. No helper from frozen/public source is executed.
import {sha256, safeRelative, verifyManifest} from '../../scripts/lib/artifacts.mjs';

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
  status: 'ADMITTED_ACTUAL_SUCCESSFUL_CI',
  runId: 42386885242,
  workflowHead: '9674750d5013cd5c44f52044ec1c944b22b416f6',
  pinSha256: 'e608c6d71cb3fd69f14f8f33846760bf7d1a595a1e52342cffd5835cee7b571d',
  runCaptureSha256: 'c09e4617ddbb01cd30bceb8225f8bffe7c6ff4d31fa1cd392f9e5d33b0febe9d',
  jobsCaptureSha256: '80d3b1f7a6479acb28c8805da4fb471d811d3c6f1ff5a4a854361c50ac0d9d49',
  artifactsCaptureSha256: '2077839ebeb890ddea15df96fd94ba080cde127391a156f262c7ce2fff18fcc6',
});
const PIN_FILE = 'build/windows-ci-verifier/authority/ci-engine-pins-windows-progress3.json';
const CAPTURES = 'build/windows-ci-verifier/authority';
const RESTORED = 'build/windows-ci-verifier/actual-inputs';
const ATTESTED_RESTORED = 'build/windows-native-progress';
const OUTPUT = 'build/windows-ci-verifier/public-engine-builds-progress3-windows-x64.json';
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
  const bounds = (at, size) => assert(Number.isSafeInteger(at) && at >= 0 && at + size <= bytes.length, 'Truncated Windows PE');
  bounds(0, 64); assert.equal(bytes.subarray(0, 2).toString(), 'MZ', 'Expected native Windows PE');
  const pe = bytes.readUInt32LE(0x3c); bounds(pe, 24);
  assert.equal(bytes.readUInt32LE(pe), 0x4550, 'Expected PE signature');
  assert.equal(bytes.readUInt16LE(pe + 4), 0x8664, 'Expected Windows x64 machine');
  const count = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20), optional = pe + 24;
  assert(count > 0 && count <= 96, 'Invalid PE section count'); bounds(optional, optionalSize);
  assert(optionalSize >= 240, 'Missing PE32+ data directories');
  assert.equal(bytes.readUInt16LE(optional), 0x20b, 'Expected PE32+');
  const directories = bytes.readUInt32LE(optional + 108);
  assert(directories >= 14 && directories <= (optionalSize - 112) / 8, 'Invalid PE import directories');
  for (let i = 0; i < count; i++) { const section = optional + optionalSize + i * 40; bounds(section, 40); bounds(bytes.readUInt32LE(section + 20), bytes.readUInt32LE(section + 16)); }
  return {format: 'PE32+', machine: 'x64'};
}
export function validateAuthority(pins, run, jobsCapture, artifactsCapture, admission = ADMISSION) {
  assertAdmission(admission);
  assert.equal(pins.schemaVersion, 1); assert.equal(pins.kind, 'windows-source3-ci-authority');
  assert.equal(pins.status, 'ADMITTED_ACTUAL_SUCCESSFUL_CI');
  assert.equal(pins.repository, 'Mohammed-Moniem/embedded-office-suite');
  assert.equal(pins.sourceCommit, SOURCE_COMMIT); assert.equal(pins.sourceManifestSha256, SOURCE_MANIFEST); assert.equal(pins.sourceArchiveSha256, SOURCE_ARCHIVE);
  assert.equal(run.id, admission.runId); assert.equal(run.head_sha, admission.workflowHead);
  assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success');
  assert.equal(run.repository?.full_name, pins.repository); assert(Number.isSafeInteger(run.repository?.id) && run.repository.id > 0);
  assert(Number.isSafeInteger(run.head_repository?.id) && run.head_repository.id > 0);
  assert.equal(run.path, '.github/workflows/windows-progress.yml'); assert.equal(run.event, 'workflow_dispatch');
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
    for (const name of ['Restore and verify exact public inputs', 'Build native CLI and WASM with frozen source', 'Qualify actual compiled native worker']) {
      const steps = job.steps?.filter(x => x.name === name); assert.equal(steps?.length, 1, 'Missing or duplicate qualification step');
      assert.equal(steps[0].status, 'completed'); assert.equal(steps[0].conclusion, 'success', 'Skipped or unsuccessful compilation/qualification');
    }
    const artifacts = artifactsCapture.artifacts.filter(x => x.name === `priority-windows-${pin.app}`); assert.equal(artifacts.length, 1, 'Missing or duplicate actual build artifact');
    const artifact = artifacts[0]; assert.equal(artifact.id, pin.artifactId); assert.equal(artifact.size_in_bytes, pin.bytes); assert.equal(artifact.expired, false);
    assert.equal(artifact.digest, `sha256:${pin.sha256}`, 'Actual API archive digest mismatch');
    assert.equal(artifact.workflow_run?.id, admission.runId); assert.equal(artifact.workflow_run?.head_sha, admission.workflowHead);
    assert.equal(artifact.workflow_run?.repository_id, run.repository.id); assert.equal(artifact.workflow_run?.head_repository_id, run.head_repository.id);
  }
  return pins.records;
}
// This reader is separately exported for explicitly synthetic controls. Only
// verifyWindowsResults() may admit actual authority or write an attestation.
export async function verifyEngineDirectory({app, source, directory, zip, identity}) {
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
  const readbacks = [[inputsPath, inputRecord.sha256], [restoredPath, restoredRecord.sha256], [reportPath, reportRecord.sha256], [nativePath, nativeRecord.sha256]];
  assert.equal(report.schemaVersion, 1); assert.equal(report.app, app); assert.equal(report.platform, PLATFORM); assert.equal(report.kind, 'all'); assert.equal(report.profile, 'dev');
  for (const key of ['passed', 'actualCompilation', 'offline', 'frozen', 'cargoHomeInitiallyEmpty', 'targetInitiallyEmpty']) assert.equal(report[key], true, `${app}: missing ${key}`);
  assert.equal(normalized(report.source), `engines/${app}`); assert.equal(report.supportInputManifestSha256, SUPPORT_MANIFEST); assert.match(report.vendorInputManifestSha256 ?? '', SHA);
  assert.equal(report.sourceSha256Before, report.sourceSha256After); assert.equal(report.sourceSha256After, await sourceHash(join(source, 'engines', app)), 'Different engine source');
  await matched(join(source, 'engines', app, 'Cargo.lock'), report.lockSha256, `${app} frozen lock`);
  assert.deepEqual(report.networkDenial, {established: false, enforcement: 'Cargo and Trunk offline flags only'}, 'Unexpected Windows network evidence; review actual report before changing authority');
  assert.deepEqual(inputs.networkDenial, report.networkDenial, 'Contradictory network evidence');
  await verifyZipMember(zip, members, 'PUBLIC-INPUTS.json', inputsPath);
  await verifyZipMember(zip, members, 'RESTORED-INPUTS.json', restoredPath);
  await verifyZipMember(zip, members, `source/${prefix}report.json`, reportPath);
  await verifyZipMember(zip, members, `source/${prefix}native-qualification.json`, nativePath);
  assert.equal(report.results?.length, 2, 'Exactly native and WASM build results required');
  const artifacts = [];
  for (const kind of ['cli', 'wasm']) {
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
    if (kind === 'cli') inspectPe(await readFile(file));
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
  for (const [file, digest] of readbacks) await matched(file, digest, `${app} evidence after member verification`);
  await matched(zip, identity.sha256, `${app} CI ZIP after member verification`);
  return {...identity, artifactZipSha256: identity.sha256, reportSha256: reportRecord.sha256, nativeQualificationSha256: nativeRecord.sha256, sourceSha256: report.sourceSha256After, lockSha256: report.lockSha256, networkDenial: report.networkDenial, artifacts};
}
export async function verifyWindowsResults(args = process.argv.slice(2)) {
  const {values} = parseArgs({args, options: {platform: {type: 'string', default: PLATFORM}, source: {type: 'string', default: 'build/public-qualification/progress3/source'}, 'check-only': {type: 'boolean', default: false}}});
  assert.equal(values.platform, PLATFORM, 'This additive verifier admits only Windows x64 source3');
  assertAdmission();
  const source = resolve(values.source);
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
    results.push(await verifyEngineDirectory({app, source, directory: resolve(RESTORED, 'ci-engine-results', PLATFORM, app), zip: resolve(RESTORED, 'downloads/ci', PLATFORM, app + '.zip'), identity: pin}));
  }
  for (const [file, digest] of authorityFiles) await matched(file, digest, 'Actual CI authority after verification');
  await matched(provenancePath, provenanceSha256, 'Transfer provenance after verification');
  await matched(join(source, 'MANIFEST.json'), SOURCE_MANIFEST, 'Exact source3 manifest after verification'); await verifyManifest(source, {expectedKind: 'office-source-progress'});
  const result = {schemaVersion: 1, sourceCommit: SOURCE_COMMIT, sourceArchiveSha256: SOURCE_ARCHIVE, sourceManifestSha256: SOURCE_MANIFEST, platform: PLATFORM, passed: true, results, limits: ['Exact public progress3 source and inputs only', 'Default native CLI and WASM development builds; optional feature completeness not established', 'Cargo and Trunk offline flags are not OS network-denial proof', 'WASM compilation is not browser/private-WebView acceptance', 'Windows Server is not Windows 11 client acceptance', 'CI worker evidence does not qualify a newly assembled component ZIP', 'No Microsoft/Adobe parity']};
  if (!values['check-only']) await writeFile(resolve(OUTPUT), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  console.log('Exact admitted Windows source3 native/WASM artifacts and native operations verified for four engines');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await verifyWindowsResults(); } catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
}
