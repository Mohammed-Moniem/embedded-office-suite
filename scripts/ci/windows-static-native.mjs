// CANDIDATE: publish alongside windows-static-pe.mjs under scripts/ci after review.
// Build source3 without altering its immutable source helper or full/WASM runs.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createSupervisor } from '../../scripts/ci/progress-supervisor.mjs';
import { verifyFrozenSource } from '../../scripts/ci/verify-frozen-source.mjs';
import { inspectPE } from './windows-static-pe.mjs';

const { values } = parseArgs({ options: { app: { type: 'string' } } });
const app = values.app;
const vendors = { wordcraft: '95a914506a4439e285b669d562ebb113daa53818259572e3025e2e568ae6a382', pdfcraft: '8c5fd6b02020a2309803182c9b34ca5680ea46165de8aa2099b45ca8d7e0f9f3', deckcraft: '762e55795c534cbffade71d7c336fae367e1b8bc3176f7f261526e44ee3b7992', gridcraft: 'e3a5d7e800bdbe90529783db1381225d9c3f9eb1c42f96fcdbe6383c8997dab5' };
assert(Object.hasOwn(vendors, app), 'Choose one of the four native engines');
assert(process.platform === 'win32' && process.arch === 'x64', 'This profile requires x64 Windows');
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const base = join(root, 'build/progress-ci'), source = join(base, 'source');
const sourceCommit = 'e8e4364c20018abb1222c69b7e50839abfe62644';
const sourceManifestSha = '566d2c34f202c0e33e2bd2049fab086642228e781ebc8585a4c431ea472b9daa';
const assets = [
  { name: 'office-source-progress3-r1.tar.gz', sha256: 'ee369702aa8cf550413d000f58ac88d297ede8da01fade5d4ac3c89a1ddc2e6c' },
  { name: `office-build-inputs-vendor-${app}.tar.gz`, sha256: vendors[app] },
  { name: 'office-build-inputs-support-complete3.tar.gz', sha256: 'b044c20cfc2a8f470268065fd44a3f2ab2e0837c09a89856bfbc902377e9595c' },
  { name: 'office-build-inputs-tools-windows-x64-gzip-r1.tar.gz', sha256: '02a82e36f2c9df54908efa3a0aa431fde27e5c776e12cea8464c980217bc0ddd' },
];
const supervisor = createSupervisor(join(base, 'evidence/static-native'));
const flags = '-C target-feature=+crt-static';
const forbidden = /^(?:vcruntime|msvcp|concrt|msvcr).*\.dll$/i;
const profilePath = join(base, 'STATIC-CRT-PROFILE.json');
const profile = { schemaVersion: 1, kind: 'windows-static-crt-native-profile', state: 'IN_PROGRESS', app, platform: 'windows-x64', sourceCommit, sourceManifestSha, assets, buildKind: 'cli', cargoProfile: 'dev', requestedRustflags: flags, cargoEncodedRustflagsCleared: true, targetSpecificRustflagsCleared: true, wasmBuilt: false, admitted: false, actualCompilation: false, nativeQualified: false, importsVerified: false, bootstrapFiles: [], runtimeFiles: [], limits: ['Windows Server 2022 hosted CI is not Windows 11 client acceptance', 'PE normal/delay import inspection does not prove runtime dynamically loaded modules', 'Windows API sets and operating-system DLLs remain OS prerequisites', 'This native profile does not rebuild or qualify WASM', 'Static linkage does not establish redistribution license entitlement', 'No target OS network isolation claim'], error: null };
const rel = path => relative(root, path).replaceAll('\\', '/');
async function hash(path) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
async function record(path) { const info = await lstat(path); assert(info.isFile() && !info.isSymbolicLink(), 'Expected regular artifact'); return { path: rel(path), size: info.size, sha256: await hash(path) }; }
async function saveProfile() { await mkdir(base, { recursive: true }); await writeFile(profilePath, JSON.stringify(profile, null, 2) + '\n'); }
async function verifySource() { return verifyFrozenSource(source, { manifestSha256: sourceManifestSha, sourceCommit, allowBuildOutputs: true }); }
async function inventory(directory) {
  const files = [];
  async function walk(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(path, entry.name), info = await lstat(absolute);
      assert(!info.isSymbolicLink(), 'Runtime contains symbolic link');
      if (info.isDirectory()) await walk(absolute); else { assert(info.isFile(), 'Runtime contains special file'); files.push(await record(absolute)); }
    }
  }
  await walk(directory); return files;
}

try {
  await saveProfile();
  const receiptPath = join(base, 'RESTORED-INPUTS.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal(receipt.platform, 'windows-x64'); assert.equal(receipt.app, app);
  assert.equal(receipt.sourceCommit, sourceCommit); assert.equal(receipt.sourceManifestSha, sourceManifestSha);
  assert.deepEqual(receipt.assets, assets); assert.equal(receipt.restored, true); assert.equal(receipt.compiled, false);
  profile.restoredInputs = await record(receiptPath);
  profile.sourceBefore = await verifySource();
  for (const path of [fileURLToPath(import.meta.url), fileURLToPath(new URL('./windows-static-pe.mjs', import.meta.url)), join(root, 'scripts/ci/progress.mjs'), join(root, 'scripts/ci/progress-supervisor.mjs'), join(root, 'scripts/ci/verify-frozen-source.mjs'), join(root, 'scripts/lib/artifacts.mjs'), join(source, 'scripts/engines/offline-build.mjs'), join(source, 'scripts/verify-engines.mjs')]) profile.bootstrapFiles.push(await record(path));
  const runs = join(source, 'build/engines/offline-builds', app);
  try { assert.equal((await readdir(runs)).length, 0, 'Static profile requires an unused output root'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = { ...process.env, RUSTFLAGS: flags };
  delete env.CARGO_ENCODED_RUSTFLAGS;
  delete env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS;
  profile.buildCommand = { executable: process.execPath, args: [rel(join(source, 'scripts/engines/offline-build.mjs')), app, 'cli'], cwd: rel(source), environment: { RUSTFLAGS: flags, CARGO_ENCODED_RUSTFLAGS: null, CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS: null }, timeoutMs: 7200000 };
  await saveProfile();
  await supervisor.command('compile-native-static-crt', process.execPath, [join(source, 'scripts/engines/offline-build.mjs'), app, 'cli'], { cwd: source, env, timeoutMs: 7200000 });
  const names = await readdir(runs); assert.equal(names.length, 1, 'Expected one isolated static native build');
  const run = join(runs, names[0]), reportPath = join(run, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.app, app); assert.equal(report.platform, 'windows-x64'); assert.equal(report.kind, 'cli'); assert.equal(report.profile, 'dev');
  for (const name of ['passed', 'cargoHomeInitiallyEmpty', 'targetInitiallyEmpty', 'frozen', 'offline', 'actualCompilation']) assert.equal(report[name], true, `Missing real build evidence: ${name}`);
  assert.equal(report.sourceSha256Before, report.sourceSha256After, 'Build changed source');
  assert.equal(report.results.length, 1); const result = report.results[0];
  assert.equal(result.kind, 'cli'); assert.equal(result.exitCode, 0); assert.equal(result.launched, true);
  const worker = join(run, 'runtime/bin', `${app}-cli.exe`);
  assert.equal(resolve(source, result.output), worker, 'Raw build report points outside this worker');
  profile.worker = await record(worker); assert.equal(profile.worker.sha256, result.sha256);
  const pe = await inspectPE(worker); pe.path = rel(worker);
  assert.equal(pe.machine, 'x64'); assert.equal(pe.bits, 64);
  const forbiddenImports = [...pe.imports, ...pe.delayImports].filter(name => forbidden.test(name));
  assert.deepEqual(forbiddenImports, [], 'Native static profile still imports Microsoft VC runtime DLLs');
  profile.pe = pe; profile.importsVerified = true; profile.actualCompilation = true;
  profile.rawBuildReport = await record(reportPath);
  profile.nativeBuildLog = await record(resolve(source, result.log));
  assert.equal(profile.nativeBuildLog.sha256, result.logSha256, 'Raw build log hash differs');
  const qualification = join(run, 'native-qualification.json');
  const qualificationArgs = [join(source, 'scripts/verify-engines.mjs'), '--apps', app, '--runtime-dir', join(run, 'runtime'), '--output', qualification, ...(app === 'gridcraft' ? ['--grid-policy', 'automation-roots'] : [])];
  await saveProfile();
  await supervisor.command('qualify-native-static-crt', process.execPath, qualificationArgs, { cwd: source, timeoutMs: 600000 });
  const qualified = JSON.parse(await readFile(qualification, 'utf8'));
  assert.equal(qualified.target, 'windows-x64'); assert.equal(qualified.passed, true); assert.deepEqual(qualified.scope, [app]); assert.equal(qualified.results.length, 1);
  assert.equal(qualified.results[0].app, app); assert.equal(qualified.results[0].passed, true); assert.equal(qualified.results[0].binarySha256, profile.worker.sha256);
  assert.equal(await hash(worker), profile.worker.sha256, 'Qualification changed worker');
  profile.nativeQualification = await record(qualification); profile.nativeQualified = true;
  profile.runtimeFiles = await inventory(join(run, 'runtime'));
  profile.sourceAfter = await verifySource();
  profile.networkDenial = report.networkDenial;
  profile.state = 'STATIC_NATIVE_CANDIDATE_QUALIFIED';
  await saveProfile();
  await writeFile(join(base, 'PUBLIC-INPUTS.json'), JSON.stringify({ schemaVersion: 1, platform: 'windows-x64', app, sourceCommit, sourceManifestSha, assets, compiled: true, buildKind: 'cli', cargoProfile: 'dev', crtLinkageProfile: 'static-request-and-normal-delay-import-check', nativeQualified: true, wasmBuilt: false, staticCrtProfile: { path: rel(profilePath), sha256: await hash(profilePath) }, networkDenial: report.networkDenial, limits: profile.limits }, null, 2) + '\n');
  supervisor.record('static-native', 'completed', { app, workerSha256: profile.worker.sha256, sourceCommit, admitted: false });
  console.log(`${app}: static CRT native candidate build and qualification passed`);
} catch (error) {
  profile.state = 'BLOCKED'; profile.error = error.message; await saveProfile();
  supervisor.record('static-native', 'failed', { app, error: error.message }); throw error;
}
