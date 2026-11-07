// Additive source3 Mac assembler. Run from the repository root. Actual authority
// remains closed in the separately reviewed verifier until CI captures exist.
import assert from 'node:assert/strict';
import {cp, mkdir, readFile, writeFile, lstat, realpath, chmod} from 'node:fs/promises';
import {join, resolve, dirname, basename, relative, sep} from 'node:path';
import {parseArgs} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = resolve('.'), ownFile = fileURLToPath(import.meta.url);
assert([join(root, 'build/macos-native-source3'), join(root, 'scripts')].includes(dirname(ownFile)), 'Run the reviewed candidate or installed assembler from the repository root');
const verifierFile = join(dirname(ownFile), dirname(ownFile) === join(root, 'scripts') ? 'ci/verify-macos-engine-results-progress3.mjs' : 'verify-macos-engine-results-progress3.mjs');
const {APPS, PLATFORMS, SOURCE_COMMIT, SOURCE_MANIFEST, SOURCE_ARCHIVE, SUPPORT_MANIFEST, PUBLIC_INPUTS, ADMISSION, CI_PIN_FILE, assertAdmission, regular, verifyMacResults, inspectMachO} = await import(pathToFileURL(verifierFile));
const helperFile = join(root, 'scripts/lib/artifacts.mjs');
const ARTIFACT_HELPER_SHA256 = '652f1d5d5fa68cd96bd5850e4cb5e62a75ed2e68b7b7c4e91359374168c6505a';
const SDK_PIN_FILE = 'config/web-component-pins-progress2.json';
const SDK_PIN_SHA256 = '1342d1848bf4134be21b5daf4b18f12167731ba2018a5a8afde5718bda47392f';
const LEGAL_HELPER_SHA256 = '534fdcf3cdd590b91e66f44df3ffaa008591fb48f2d4fb78c3eb5e8c1460e4ca';
const SOURCE_PUBLIC_PROOF_SHA256 = '6d3042244086f7b8f37c854e6416283b9c964ca74b3253d84654a55655ab92cb';
const SOURCE_CHECKS_SHA256 = '1ab0a131f67364f010556746483eb54bcc885aeef115ec4e6da035ece44427ad';
export const ASSEMBLY_INPUTS = Object.freeze({SDK_PIN_FILE, SDK_PIN_SHA256, LEGAL_HELPER_SHA256, ARTIFACT_HELPER_SHA256, SOURCE_PUBLIC_PROOF_SHA256, SOURCE_CHECKS_SHA256});
async function rawHash(file) { await regular(file); return createHash('sha256').update(await readFile(file)).digest('hex'); }
assert.equal(await rawHash(helperFile), ARTIFACT_HELPER_SHA256, 'Reviewed deterministic ZIP/manifest helper changed');
const {createManifest, verifyManifest, writeZip, sha256, safeRelative, filesIn} = await import(pathToFileURL(helperFile));
async function matched(file, digest, label) { assert.match(digest ?? '', /^[a-f0-9]{64}$/, 'Missing ' + label + ' digest'); await regular(file); assert.equal(await sha256(file), digest, label + ' digest mismatch'); }
async function json(file) { await regular(file); return JSON.parse(await readFile(file, 'utf8')); }
const inside = (base, file) => file === base || file.startsWith(base + sep);

// No directory is created by these checks. Protect lexical and canonical file
// inputs, including the invoked script, and reject symlink output ancestors.
export async function canonicalCandidate(file) {
  let ancestor = resolve(file), suffix = [];
  for (;;) {
    try { const info = await lstat(ancestor); assert(!info.isSymbolicLink(), 'Symlink output ancestor is forbidden: ' + ancestor); assert(info.isDirectory(), 'Output ancestor is not a directory: ' + ancestor); }
    catch (error) { if (error.code !== 'ENOENT') throw error; suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor); continue; }
    for (let parent = dirname(ancestor);; parent = dirname(parent)) {
      const info = await lstat(parent); assert(!info.isSymbolicLink(), 'Symlink output ancestor is forbidden: ' + parent); assert(info.isDirectory(), 'Output ancestor is not a directory: ' + parent);
      if (dirname(parent) === parent) break;
    }
    return join(await realpath(ancestor), ...suffix);
  }
}
export async function checkOutputLocations({output, stagingRoot, readInputs}) {
  const outputs = await Promise.all([output, output + '.partial', output + '.json', output + '.sha256'].map(async file => join(await canonicalCandidate(dirname(file)), basename(file))));
  const stage = await canonicalCandidate(stagingRoot);
  for (const {path, kind} of readInputs) {
    const lexical = join(await canonicalCandidate(dirname(path)), basename(path)); let canonical;
    try { canonical = await realpath(path); const info = await lstat(canonical); assert(kind === 'directory' ? info.isDirectory() : info.isFile(), 'Invalid read input ' + path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; canonical = lexical; }
    for (const protectedPath of new Set([lexical, canonical])) {
      for (const file of outputs) assert(!inside(protectedPath, file) && !inside(file, protectedPath), 'Archive output overlaps a canonical input: ' + path);
      assert(!inside(protectedPath, stage) && !inside(stage, protectedPath), 'Staging root overlaps a canonical input: ' + path);
    }
  }
  for (const file of outputs) assert(!inside(stage, file) && !inside(file, stage), 'Archive output overlaps staging root');
}
async function absent(file) { try { await lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; } throw Error('Refusing existing output: ' + file); }
async function sdkInventory(directory) { return (await filesIn(directory)).filter(file => !file.path.split('/').some(part => ['test', 'node_modules'].includes(part))); }
export async function verifySdk(directory, authority) {
  assert(Array.isArray(authority.sdk?.node) && authority.sdk.node.length === 12, 'Complete reviewed 12-file Node SDK authority is required');
  const actual = await sdkInventory(directory), expected = authority.sdk.node;
  assert.deepEqual(actual.map(x => x.path).sort(), expected.map(x => safeRelative(x.path)).sort(), 'Integration SDK inventory mismatch');
  assert.equal(new Set(expected.map(x => x.path)).size, expected.length, 'Duplicate SDK authority entry');
  for (const row of expected) { const file = actual.find(x => x.path === row.path); assert.equal(file.size, row.bytes); assert.equal(file.mode, row.mode); await matched(file.absolute, row.sha256, 'Integration SDK ' + row.path); }
}
export async function verifyAssemblyInputs(source) {
  const support = join(root, 'build/engines/support-inputs'), sdkRoot = join(root, 'packages/node');
  await matched(join(root, SDK_PIN_FILE), SDK_PIN_SHA256, 'Reviewed integration SDK authority');
  const sdkAuthority = await json(join(root, SDK_PIN_FILE)); assert.equal(sdkAuthority.schemaVersion, 1); assert.equal(sdkAuthority.kind, 'reviewed-web-component-authority');
  await verifySdk(sdkRoot, sdkAuthority);
  await matched(join(source, 'MANIFEST.json'), SOURCE_MANIFEST, 'Frozen source3 manifest');
  const sourceManifest = await verifyManifest(source, {expectedKind: 'office-source-progress'});
  assert.equal(sourceManifest.sourceCommit, SOURCE_COMMIT); assert.equal(sourceManifest.files.length, 4889);
  await matched(join(root, 'build/progress3-release/office-source-progress3-r1.tar.gz'), SOURCE_ARCHIVE, 'Exact public source3 archive');
  await matched(join(root, 'LICENSE'), sdkAuthority.integrationLicenseSha256, 'Integration license');
  assert.equal(await sha256(join(root, 'LICENSE')), await sha256(join(source, 'LICENSE')), 'Current integration license differs from source3');
  await matched(join(support, 'MANIFEST.json'), SUPPORT_MANIFEST, 'Captured support manifest');
  const supportManifest = await verifyManifest(support, {expectedKind: 'captured-support-build-inputs'}); assert.equal(supportManifest.files.length, 303, 'Incomplete support input inventory');
  const publicPath = join(root, 'docs/verification/public-download-source3.json'); await matched(publicPath, SOURCE_PUBLIC_PROOF_SHA256, 'Anonymous source3 download proof');
  const publicProof = await json(publicPath); assert(publicProof.passed && publicProof.anonymousPublicFetch && publicProof.fullSourceGitBlobsAndModesVerified === 4889);
  assert.equal(publicProof.sourceCommit, SOURCE_COMMIT); assert.equal(publicProof.files?.find(x => x.role === 'source')?.manifestSha256, SOURCE_MANIFEST);
  const archive = publicProof.files?.find(x => x.name === 'office-source-progress3-r1.tar.gz'); assert.equal(archive?.sha256, SOURCE_ARCHIVE); assert.equal(archive.anonymousDownloadVerified, true);
  const sourceChecksPath = join(root, 'docs/verification/source3-checks-macos-arm64.json'); await matched(sourceChecksPath, SOURCE_CHECKS_SHA256, 'Reviewed source3 SDK/helper checks');
  const checks = await json(sourceChecksPath); assert.equal(checks.passed, true); assert.equal(checks.sourceCommit, SOURCE_COMMIT); assert.equal(checks.sourceArchiveSha256, SOURCE_ARCHIVE); assert.equal(checks.sourceManifestSha256, SOURCE_MANIFEST); assert.equal(checks.publicDownloadReportSha256, SOURCE_PUBLIC_PROOF_SHA256); assert.equal(checks.exactSourceManifestStillUnchanged, true); assert.equal(checks.counts?.sdk, 106); assert.equal(checks.counts?.portableTools, 22);
  const legalHelper = join(root, 'scripts/lib/component-legal.mjs'); await matched(legalHelper, LEGAL_HELPER_SHA256, 'Asset notice helper');
  const notices = sdkAuthority.components.flatMap(component => component.assetNotices.map(file => ({app: component.app, ...file})));
  assert.equal(notices.length, 11, 'All eleven original asset notices are required');
  for (const notice of notices) { const frozen = sourceManifest.files.find(file => file.path === `engines/${notice.app}/${notice.path}`); assert(frozen, 'Original asset notice absent from frozen source'); for (const field of ['bytes', 'mode', 'sha256']) assert.equal(notice[field], frozen[field]); }
  return {source, support, sdkRoot, sdkAuthority, sourceManifest, supportManifest, publicPath, sourceChecksPath, legalHelper};
}
async function copiedTree(original, destination) {
  const before = await filesIn(original), after = await filesIn(destination); assert.deepEqual(after.map(x => x.path), before.map(x => x.path), 'Copied tree inventory changed');
  for (const file of before) { const copy = after.find(x => x.path === file.path); assert.equal(copy.mode, file.mode); await matched(copy.absolute, await sha256(file.absolute), 'Copied ' + file.path); }
}
export async function assemble(args = process.argv.slice(2)) {
  const {values} = parseArgs({args, options: {platform: {type: 'string'}, report: {type: 'string'}, source: {type: 'string'}, output: {type: 'string'}}});
  const platform = values.platform; assert(PLATFORMS.includes(platform), 'Choose --platform macos-arm64 or macos-x64'); assert(values.report && values.source && values.output, 'Provide --report, --source and --output');
  const source = resolve(values.source), output = resolve(values.output), report = resolve(values.report), stagingRoot = join(root, 'build/macos-native-source3/stages');
  const readInputs = [
    ...[source, 'build/engines/support-inputs', 'build/macos-native-source3/downloads/ci', 'build/macos-native-source3/ci-engine-results', 'build/macos-ci-transfer', 'packages', 'config', 'scripts', 'docs/verification'].map(path => ({path: resolve(path), kind: 'directory'})),
    ...[report, 'LICENSE', 'build/progress3-release/office-source-progress3-r1.tar.gz', 'build/macos-native-source3/ci-artifact-provenance.json', ownFile, verifierFile, join(root, 'build/macos-native-source3/ci-engine-pins-macos-progress3.json')].map(path => ({path: resolve(path), kind: 'file'})),
  ];
  const outputCheck = () => checkOutputLocations({output, stagingRoot, readInputs});
  await outputCheck(); for (const file of [output, output + '.partial', output + '.json', output + '.sha256']) await absent(file);
  assertAdmission();
  const aggregate = await verifyMacResults(['--platform', platform, '--source', source, '--check-only']);
  const attestationSha256 = await sha256(report); assert.deepEqual(await json(report), aggregate, 'Supplied aggregate differs from independently reverified actual CI evidence');
  const inputs = await verifyAssemblyInputs(source), {support, sdkRoot, sdkAuthority, sourceManifest, publicPath, sourceChecksPath, legalHelper} = inputs;
  const {copyEngineAssetNotices} = await import(pathToFileURL(legalHelper));
  const records = [];
  for (const app of APPS) {
    const row = aggregate.results.find(x => x.app === app), directory = join(root, 'build/macos-native-source3/ci-engine-results', platform, app), cli = row.artifacts.find(x => x.kind === 'cli');
    const cliFile = join(root, safeRelative(cli.path)), macho = inspectMachO(await readFile(cliFile), platform); await matched(cliFile, cli.sha256, app + ' worker');
    const prefix = cli.path.slice(0, cli.path.lastIndexOf('/runtime/bin/'));
    records.push({app, row, directory, cliFile, macho, reportFile: join(root, prefix, 'report.json'), nativeFile: join(root, prefix, 'native-qualification.json')});
  }
  await outputCheck(); await matched(report, attestationSha256, 'Aggregate before staging');
  const stage = join(stagingRoot, 'stage-' + platform + '-' + randomUUID()); await mkdir(join(stage, 'runtime/bin'), {recursive: true});
  await cp(sdkRoot, join(stage, 'sdk/node'), {recursive: true, errorOnExist: true, force: false, filter: file => !relative(sdkRoot, file).split(sep).some(part => ['test', 'node_modules'].includes(part))}); await verifySdk(join(stage, 'sdk/node'), sdkAuthority);
  await cp(join(root, 'LICENSE'), join(stage, 'INTEGRATION-LICENSE.txt'));
  await cp(join(support, 'support'), join(stage, 'runtime/support'), {recursive: true, errorOnExist: true, force: false});
  await cp(join(support, 'support/pdfcraft-models'), join(stage, 'runtime/bin/models'), {recursive: true, errorOnExist: true, force: false});
  await mkdir(join(stage, 'evidence'), {recursive: true});
  const evidenceCopies = [[join(source, 'MANIFEST.json'), 'frozen-source-MANIFEST.json', SOURCE_MANIFEST], [join(support, 'MANIFEST.json'), 'support-MANIFEST.json', SUPPORT_MANIFEST], [join(support, 'SUPPORT-PROVENANCE.json'), 'SUPPORT-PROVENANCE.json', await sha256(join(support, 'SUPPORT-PROVENANCE.json'))], [publicPath, 'public-download-source3.json', SOURCE_PUBLIC_PROOF_SHA256], [sourceChecksPath, 'source3-checks-macos-arm64.json', SOURCE_CHECKS_SHA256], [report, 'public-engine-builds.json', attestationSha256], [join(root, 'build/macos-native-source3/ci-artifact-provenance.json'), 'ci-artifact-provenance.json', await sha256(join(root, 'build/macos-native-source3/ci-artifact-provenance.json'))], [join(root, SDK_PIN_FILE), 'integration-sdk-authority.json', SDK_PIN_SHA256], [join(root, CI_PIN_FILE), 'ci-engine-pins-macos-progress3.json', ADMISSION.pinSha256], ...['run', 'jobs', 'artifacts'].map(name => [join(root, 'build/macos-ci-transfer', name + '.json'), 'ci-' + name + '.json', ADMISSION[name === 'run' ? 'runCaptureSha256' : name === 'jobs' ? 'jobsCaptureSha256' : 'artifactsCaptureSha256']])];
  for (const [file, name, digest] of evidenceCopies) { await matched(file, digest, name); await cp(file, join(stage, 'evidence', name)); await matched(join(stage, 'evidence', name), digest, 'Copied ' + name); }
  await writeFile(join(stage, 'evidence/public-build-input-authority.json'), JSON.stringify({schemaVersion: 1, kind: 'code-anchored-public-build-inputs', files: PUBLIC_INPUTS}, null, 2) + '\n');
  const engines = [];
  for (const {app, row, directory, cliFile, macho, reportFile, nativeFile} of records) {
    const worker = join(stage, 'runtime/bin', app + '-cli'); await cp(cliFile, worker); await matched(worker, row.artifacts.find(x => x.kind === 'cli').sha256, app + ' staged worker'); await chmod(worker, 0o755);
    const legal = join(stage, 'licences', app); await mkdir(legal, {recursive: true});
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'ATTRIBUTION.md']) await cp(join(source, 'engines', app, name), join(legal, name));
    for (const name of ['licenses', 'ATTRIBUTION.toml', 'LICENSES.toml']) { try { await lstat(join(source, 'engines', app, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; } await cp(join(source, 'engines', app, name), join(legal, name), {recursive: true}); }
    const assetNotices = await copyEngineAssetNotices(join(source, 'engines', app), legal); assert.deepEqual(assetNotices, sdkAuthority.components.find(x => x.app === app)?.assetNotices);
    const selected = file => ['LICENSE-MIT', 'LICENSE-APACHE', 'NOTICE', 'ATTRIBUTION.md', 'ATTRIBUTION.toml', 'LICENSES.toml'].includes(file) || file.startsWith('licenses/') || assetNotices.some(notice => notice.path === file);
    const expectedLegal = sourceManifest.files.filter(file => file.path.startsWith(`engines/${app}/`) && selected(file.path.slice(`engines/${app}/`.length))).map(file => ({...file, path: file.path.slice(`engines/${app}/`.length)}));
    const actualLegal = await filesIn(legal); assert.deepEqual(actualLegal.map(x => x.path).sort(), expectedLegal.map(x => x.path).sort(), app + ': incomplete legal inventory');
    for (const file of expectedLegal) { await matched(join(legal, file.path), file.sha256, app + ' legal ' + file.path); assert.equal(actualLegal.find(x => x.path === file.path).mode, file.mode); }
    const evidence = join(stage, 'evidence', app); await mkdir(evidence, {recursive: true});
    for (const [file, name, digest] of [[join(directory, 'PUBLIC-INPUTS.json'), 'PUBLIC-INPUTS.json', row.publicInputsSha256], [join(directory, 'RESTORED-INPUTS.json'), 'RESTORED-INPUTS.json', row.restoredInputsSha256], [reportFile, 'offline-build.json', row.reportSha256], [nativeFile, 'native-qualification.json', row.nativeQualificationSha256]]) { await matched(file, digest, app + ' input evidence'); await cp(file, join(evidence, name)); await matched(join(evidence, name), digest, app + ' copied evidence'); }
    const buildReport = await json(reportFile);
    for (const result of buildReport.results) { const log = join(directory, 'source', safeRelative(result.log)); await cp(log, join(evidence, result.kind + '-build.log')); await matched(join(evidence, result.kind + '-build.log'), result.logSha256, app + ' copied log'); }
    engines.push({app, profile: 'dev', nativeSha256: row.artifacts.find(x => x.kind === 'cli').sha256, wasmSha256ValidatedButNotShipped: row.artifacts.find(x => x.kind === 'wasm').sha256, sourceSha256: row.sourceSha256, lockSha256: row.lockSha256, artifactZipSha256: row.artifactZipSha256, reportSha256: row.reportSha256, nativeQualificationSha256: row.nativeQualificationSha256, networkDenial: row.networkDenial, assetNotices, macho});
  }
  assert.equal(engines.flatMap(x => x.assetNotices).length, 11);
  await copiedTree(join(support, 'support'), join(stage, 'runtime/support')); await copiedTree(join(support, 'support/pdfcraft-models'), join(stage, 'runtime/bin/models'));
  await verifySdk(sdkRoot, sdkAuthority); await verifySdk(join(stage, 'sdk/node'), sdkAuthority); await matched(join(stage, 'INTEGRATION-LICENSE.txt'), sdkAuthority.integrationLicenseSha256, 'Copied integration license');
  await verifyAssemblyInputs(source); assert.deepEqual(await verifyMacResults(['--platform', platform, '--source', source, '--check-only']), aggregate, 'CI evidence changed during assembly');
  await matched(report, attestationSha256, 'Aggregate after copying'); for (const [file, name, digest] of evidenceCopies) { await matched(file, digest, name + ' after copying'); await matched(join(stage, 'evidence', name), digest, 'Copied ' + name + ' after copying'); }
  const provenance = {schemaVersion: 1, kind: 'source-derived-integration-progress', revision: 'r1', component: 'native-only', status: 'IN_PROGRESS', platform, sourceCommit: SOURCE_COMMIT, sourceManifestSha256: SOURCE_MANIFEST, sourceArchiveSha256: SOURCE_ARCHIVE, supportInputManifestSha256: SUPPORT_MANIFEST, publicEngineAttestationSha256: attestationSha256, workerOrigin: {source: 'exact public source3-r1 and exact admitted CI ZIP members', sourceCommit: SOURCE_COMMIT, ciAuthoritySha256: ADMISSION.pinSha256}, integrationSdkOrigin: {source: 'current reviewed packages/node; separately code-anchored 12-file authority', authority: 'evidence/integration-sdk-authority.json', authoritySha256: SDK_PIN_SHA256, files: 12}, engines, limits: ['Development native workers only; WASM was validated but is separate delivery', 'Static Mach-O direct-load inventory does not qualify dependency availability on another host', 'CI worker evidence does not qualify this newly assembled ZIP', 'Exact public download and target archive qualification remain required', 'No private-host integration or Microsoft/Adobe parity']};
  await writeFile(join(stage, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
  await writeFile(join(stage, 'MACH-O-LOAD-LIBRARIES.json'), JSON.stringify({schemaVersion: 1, platform, workers: engines.map(({app, nativeSha256, macho}) => ({app, sha256: nativeSha256, ...macho})), targetRuntimeQualified: false}, null, 2) + '\n');
  await writeFile(join(stage, 'README.md'), `# Embedded Office source3 Mac native progress component\n\nStatus: IN_PROGRESS. Target: ${platform}. Four default development workers originate from exact public source3-r1 and admitted CI ZIPs. The separately reviewed Node SDK includes all 12 authority files. OCR models, fonts, language data, engine legal files and all eleven original asset notices are included.\n\nHost Node >=22 is required. Import sdk/node/index.mjs and configure runtime/bin worker paths. Set Grid filesystemPolicy to 'automation-roots'; the included sdk/node/examples/native-smoke.mjs does this. Grid headless render is unsupported. WASM/browser components are separate delivery.\n\nVerify MANIFEST.json hashes and executable modes. Worker and SDK origins are separate in PROVENANCE.json and evidence/. The static Mach-O inventory makes no target library availability claim. CI worker qualification does not qualify this exact assembled ZIP. Extract and qualify the exact ZIP on its matching target before acceptance. This progress component does not establish private-host integration or Microsoft/Adobe parity.\n`);
  const manifest = await createManifest(stage, {kind: provenance.kind, component: 'native-only', status: 'IN_PROGRESS', platform, sourceCommit: SOURCE_COMMIT, qualification: 'CI_NATIVE_EVIDENCE_ONLY_EXACT_ZIP_QUALIFICATION_SEPARATE'}); await verifyManifest(stage, {expectedKind: provenance.kind, expectedPlatform: platform}); assert(!manifest.files.some(x => x.path.startsWith('web/') || x.path.endsWith('.wasm')));
  await outputCheck(); for (const file of [output, output + '.partial', output + '.json', output + '.sha256']) await absent(file);
  const archive = await writeZip(stage, output); await verifyManifest(stage, {expectedKind: provenance.kind, expectedPlatform: platform});
  const result = {...archive, stage, revision: 'r1', kind: manifest.kind, component: 'native-only', status: 'IN_PROGRESS', platform, sourceCommit: SOURCE_COMMIT, sourceManifestSha256: SOURCE_MANIFEST, sourceArchiveSha256: SOURCE_ARCHIVE, supportInputManifestSha256: SUPPORT_MANIFEST, manifestSha256: await sha256(join(stage, 'MANIFEST.json')), manifestFiles: manifest.files.length, workers: engines.map(({app, nativeSha256}) => ({app, sha256: nativeSha256})), assetNotices: engines.map(({app, assetNotices}) => ({app, files: assetNotices})), sdkAuthoritySha256: SDK_PIN_SHA256, integrationSdkFiles: 12, ciPinAuthoritySha256: ADMISSION.pinSha256, ciArtifactBindings: aggregate.results.map(row => ({...Object.fromEntries(['app', 'platform', 'artifactId', 'runId', 'workflowHead', 'bytes', 'sha256'].map(key => [key, row[key]])), streamedMemberIdentityVerified: true})), exactArchiveQualified: false};
  await writeFile(output + '.sha256', archive.sha256 + '  ' + basename(output) + '\n', {flag: 'wx'}); await writeFile(output + '.json', JSON.stringify(result, null, 2) + '\n', {flag: 'wx'}); console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) { try { await assemble(); } catch (error) { console.error(error.stack ?? error); process.exitCode = 1; } }
