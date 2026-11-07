import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, realpath, readFile, mkdir, open, rename, copyFile, chmod, writeFile, rm} from 'node:fs/promises';
import {resolve, dirname, join, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';

export const INPUTS_SHA256 = 'ed02d3ae3917947965e3b1824f97379f1d4e62bf56bf276f63dcc0ad6532fa2e';
export const EXTRACTOR_SHA256 = '3a538dd44e269c91e50494d13cf48fd3e83439b6698b90bbae1de72f511e32c4';
const own = dirname(fileURLToPath(import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function sha256(file) { const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); return h.digest('hex'); }
export function safeRelative(p) {
  assert.equal(typeof p, 'string'); assert(p && !/[\\\x00-\x1f\x7f]/.test(p) && !p.startsWith('/') && !/^[A-Za-z]:/.test(p), 'Unsafe relative path');
  assert(!p.split('/').some(s => ['', '.', '..'].includes(s)), 'Unsafe relative path'); return p;
}
export async function safeAncestors(file, requireFile = false) {
  let found = false;
  for (let p = resolve(file);; p = dirname(p)) {
    try { const s = await lstat(p); assert(!s.isSymbolicLink(), 'Symlink path or ancestor'); if (p === resolve(file) && requireFile) assert(s.isFile(), 'Regular input required'); else assert(s.isDirectory() || p === resolve(file), 'Nondirectory ancestor'); found = true; }
    catch (e) { if (e.code !== 'ENOENT') throw e; assert(!requireFile || p !== resolve(file), 'Missing regular input'); }
    if (dirname(p) === p) break;
  }
  assert(found);
}
async function absent(file) { await safeAncestors(file); try { await lstat(file); } catch (e) { if (e.code === 'ENOENT') return; throw e; } throw Error('Immutable output already exists'); }
export async function matched(file, row, mode = false) {
  await safeAncestors(file, true); const s = await lstat(file);
  assert.equal(s.size, row.bytes, 'Input byte count mismatch: ' + (row.name ?? row.path ?? 'record'));
  assert.equal(await sha256(file), row.sha256, 'Input SHA-256 mismatch: ' + (row.name ?? row.path ?? 'record'));
  if (mode) assert.equal(s.mode & 0o777, row.mode, 'Input file mode mismatch');
}
export async function loadInputs() {
  await safeAncestors(fileURLToPath(import.meta.url), true);
  await safeAncestors(join(own, 'inputs.json'), true);
  await safeAncestors(join(own, 'safe-extract.py'), true);
  assert.equal(await sha256(join(own, 'safe-extract.py')), EXTRACTOR_SHA256, 'Frozen safe extractor changed');
  const b = await readFile(join(own, 'inputs.json')); assert.equal(hash(b), INPUTS_SHA256, 'Frozen publisher authority changed');
  const c = JSON.parse(b); assert.equal(c.repository, 'Mohammed-Moniem/embedded-office-suite'); assert.equal(c.release, 'v0.1.0-progress.3');
  assert.equal(c.artifacts.length, 12); assert.equal(c.captures.length, 6); assert.equal(c.outputs.length, 3);
  assert.equal(new Set(c.artifacts.map(x => x.artifactId)).size, 12);
  for (const row of [...c.code, c.source, c.support, ...c.artifacts, ...c.captures, ...c.outputs, ...c.maps]) {
    assert(Number.isSafeInteger(row.bytes) && row.bytes > 0); assert.match(row.sha256, /^[a-f0-9]{64}$/);
    for (const key of ['path', 'destination', 'restored', 'localCache', 'archiveDestination']) if (row[key]) safeRelative(row[key]);
    if (row.name) assert(/^[A-Za-z0-9_.-]+$/.test(row.name), 'Unsafe release asset name');
  }
  return c;
}
function requestUrl(url, authenticated = false) {
  const u = new URL(url); assert.equal(u.protocol, 'https:'); assert(!u.username && !u.password, 'URL credentials forbidden');
  if (authenticated) assert(['api.github.com', 'uploads.github.com'].includes(u.hostname), 'Credential destination rejected');
  else assert(['github.com', 'api.github.com', 'release-assets.githubusercontent.com'].includes(u.hostname) || u.hostname.endsWith('.blob.core.windows.net') || u.hostname.endsWith('.actions.githubusercontent.com'), 'Download redirect host rejected');
  return u;
}
async function response(url, {token, method = 'GET', body, accept = 'application/vnd.github+json', contentType, contentLength, timeout = 300000} = {}) {
  requestUrl(url, Boolean(token)); const headers = {'User-Agent': 'embedded-office-source3-exact-publisher', Accept: accept, 'Accept-Encoding': 'identity', 'X-GitHub-Api-Version': '2022-11-28'};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (contentType) headers['Content-Type'] = contentType;
  if (contentLength !== undefined) { assert(Number.isSafeInteger(contentLength) && contentLength >= 0, 'Invalid request size'); headers['Content-Length'] = String(contentLength); }
  try { return await fetch(url, {method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeout), ...(body ? {duplex: 'half'} : {})}); }
  catch { throw Error('GitHub transport failed'); }
}
async function bodyResponse(url, options) {
  let r = await response(url, options);
  for (let n = 0; [301, 302, 303, 307, 308].includes(r.status); n++) {
    assert(n < 5, 'Redirect limit'); const location = r.headers.get('location'); assert(location, 'Missing redirect');
    // Signed artifact URLs and credentials are never printed or persisted.
    const target = new URL(location, url).href; requestUrl(target); await r.body?.cancel(); url = target;
    r = await response(target, {accept: 'application/octet-stream'});
  }
  assert.equal(r.status, 200, 'Download HTTP status ' + r.status); return r;
}
async function jsonResponse(url, options = {}) {
  const r = await response(url, options); assert.equal(r.status, 200, 'GitHub API status ' + r.status);
  const b = await r.text(); assert(Buffer.byteLength(b) <= 8 * 1024 * 1024, 'API response bound'); return JSON.parse(b);
}
export async function download(url, file, row, token) {
  await absent(file); await mkdir(dirname(file), {recursive: true}); await safeAncestors(dirname(file));
  const temp = file + '.partial'; await absent(temp); const r = await bodyResponse(url, {token, accept: 'application/octet-stream'});
  const declared = r.headers.get('content-length'); if (declared) assert.equal(Number(declared), row.bytes, 'Download content length mismatch');
  const out = await open(temp, 'wx'); const h = createHash('sha256'); let bytes = 0;
  try {
    for await (const chunk of r.body) { bytes += chunk.length; assert(bytes <= row.bytes, 'Download exceeded exact byte bound'); h.update(chunk); let at = 0; while (at < chunk.length) { const {bytesWritten} = await out.write(chunk, at, chunk.length - at); assert(bytesWritten > 0); at += bytesWritten; } }
    assert.equal(bytes, row.bytes, 'Download truncated'); assert.equal(h.digest('hex'), row.sha256, 'Downloaded SHA-256 mismatch');
    await out.sync(); await out.close(); await absent(file); await rename(temp, file); await matched(file, row);
  } catch (e) { await out.close().catch(() => {}); await rm(temp, {force: true}); throw e; }
}
async function copyVerified(origin, destination, row, mode = false) {
  await matched(origin, row, mode); await absent(destination); await mkdir(dirname(destination), {recursive: true}); await safeAncestors(dirname(destination));
  await copyFile(origin, destination, 1); await chmod(destination, row.mode ?? 0o644); await matched(destination, row, mode);
}
export function uploadDecision(asset, row) {
  if (!asset) return 'create';
  assert.equal(asset.state, 'uploaded', 'Existing release asset is not finalized');
  assert.equal(asset.size, row.bytes, 'Existing release asset size conflict');
  if (asset.digest) assert.equal(asset.digest, 'sha256:' + row.sha256, 'Existing release asset digest conflict');
  return 'verify-and-reuse';
}
export function allOutputsVerified(outputs, verified) {
  assert.equal(verified.length, 3, 'All three native archives must verify before publication');
  for (const row of outputs) assert(verified.some(v => v.name === row.name && v.bytes === row.bytes && v.sha256 === row.sha256), 'Native output acceptance incomplete');
}
async function existingAssets(c, token) {
  const api = 'https://api.github.com/repos/' + c.repository;
  const release = await jsonResponse(api + '/releases/tags/' + c.release, {token});
  assert.equal(release.tag_name, c.release); assert.equal(release.draft, false); assert(Number.isSafeInteger(release.id));
  const assets = [];
  for (let p = 1;; p++) { assert(p <= 20); const batch = await jsonResponse(api + '/releases/' + release.id + '/assets?per_page=100&page=' + p, {token}); assert(Array.isArray(batch)); assets.push(...batch); if (batch.length < 100) break; }
  assert.equal(new Set(assets.map(x => x.name)).size, assets.length, 'Duplicate existing release names'); return {release, assets};
}
export async function publish(c, token, rows, verified, evidence, work) {
  allOutputsVerified(c.outputs, verified);
  const {release, assets} = await existingAssets(c, token); const api = 'https://api.github.com/repos/' + c.repository;
  // Verify every existing asset first. Any conflict prevents every new upload.
  for (const row of rows) {
    const asset = assets.find(a => a.name === row.name); row.decision = uploadDecision(asset, row);
    if (asset) { assert(Number.isSafeInteger(asset.id)); await download(api + '/releases/assets/' + asset.id, join(work, 'existing', row.name), row, token); }
  }
  for (const row of rows) {
    await matched(row.file, row);
    if (row.decision === 'verify-and-reuse') { evidence.push({name: row.name, bytes: row.bytes, sha256: row.sha256, action: 'existing-exact-bytes-reused'}); continue; }
    // A race creates a duplicate-name 422 failure; it never deletes/replaces.
    const u = 'https://uploads.github.com/repos/' + c.repository + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(row.name);
    const r = await response(u, {token, method: 'POST', body: createReadStream(row.file), contentType: 'application/octet-stream', contentLength: row.bytes, timeout: 900000});
    assert.equal(r.status, 201, 'Immutable release upload status ' + r.status); const asset = await r.json();
    assert.equal(asset.name, row.name); assert.equal(asset.state, 'uploaded'); assert.equal(asset.size, row.bytes); assert(Number.isSafeInteger(asset.id));
    await download(api + '/releases/assets/' + asset.id, join(work, 'readback', row.name), row, token);
    evidence.push({name: row.name, bytes: row.bytes, sha256: row.sha256, action: 'uploaded-and-exact-readback-verified'});
  }
}
async function runCommand(command, args, cwd, log) {
  assert(!args.some(x => /(?:^|\/)cargo(?:\.exe)?$/.test(x)), 'No Cargo invocation is permitted');
  await absent(log); await mkdir(dirname(log), {recursive: true}); const out = await open(log, 'wx'); let count = 0;
  const env = {...process.env}; for (const key of Object.keys(env)) if (/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION)/i.test(key)) delete env[key];
  const child = spawn(command, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
  let pending = Promise.resolve(); const capture = b => { count += b.length; if (count > 1024 * 1024) child.kill(); else pending = pending.then(() => out.write(b)); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const timer = setTimeout(() => child.kill(), 1200000);
  try { const code = await new Promise((yes, no) => { child.once('error', () => no(Error('Subprocess failed to start'))); child.once('close', yes); }); await pending; assert(count <= 1024 * 1024, 'Subprocess evidence exceeded bound'); assert.equal(code, 0, 'Reconstruction subprocess failed; inspect bounded log'); }
  finally { clearTimeout(timer); await pending; await out.close(); }
}
export async function reconstruct({checkout, work, cacheRoot, publishAssets = false, local = false}) {
  const c = await loadInputs(); assert.equal(process.versions.node, c.node, 'Use exactly Node ' + c.node); assert.equal(process.platform, 'darwin', 'Reviewed verifier requires macOS bsdtar ZIP support');
  checkout = resolve(checkout); work = resolve(work); await safeAncestors(checkout); await absent(work);
  assert(!checkout.startsWith(work + sep) && work !== checkout, 'Work directory may not contain checkout');
  if (cacheRoot) { cacheRoot = resolve(cacheRoot); await safeAncestors(cacheRoot); assert(!cacheRoot.startsWith(work + sep) && cacheRoot !== work, 'Work directory may not contain cache'); }
  assert(!publishAssets || !local, 'Local replay never publishes');
  const token = publishAssets || !local ? process.env.GITHUB_TOKEN : undefined;
  if (!local) { assert(token, 'GITHUB_TOKEN is required in environment'); assert.equal(process.env.GITHUB_REPOSITORY, c.repository, 'Wrong GitHub repository'); assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Network mode is hosted GitHub Actions only'); }
  for (const row of c.code) await matched(join(checkout, row.path), row, true);
  await mkdir(work, {recursive: true}); const resultFile = join(work, 'RESULT.json');
  const result = {schemaVersion: 1, kind: 'source3-exact-native-cloud-reconstruction', status: 'IN_PROGRESS', localReplay: local, published: false, allThreeNativeArchivesVerifiedBeforePublication: false, inputAuthoritySha256: INPUTS_SHA256, outputs: [], publication: [], limits: c.limits};
  try {
    const downloaded = new Map();
    for (const row of [c.source, c.support, ...c.captures, ...c.artifacts]) {
      const target = join(work, 'downloads', row.name);
      if (local) { assert(cacheRoot, '--cache-root is required for local replay'); await copyVerified(join(cacheRoot, row.localCache), target, row); }
      else {
        const url = row.artifactId ? 'https://api.github.com/repos/' + c.repository + '/actions/artifacts/' + row.artifactId + '/zip' : row.url;
        await download(url, target, row, row.artifactId ? token : undefined);
      }
      downloaded.set(row.name, target);
    }
    const workspace = join(work, 'workspace'); const helper = join(own, 'safe-extract.py');
    const extract = async (kind, row, destination, label) => runCommand('python3', ['-I', helper, kind, downloaded.get(row.name), destination, row.sha256, String(row.bytes), String(row.restoreFileMode ?? 'preserve')], checkout, join(work, 'logs', label + '.log'));
    await extract('tar', c.source, workspace, 'source-workspace');
    const source = join(workspace, c.source.destination);
    await extract('tar', c.source, source, 'source-frozen');
    await extract('tar', c.support, join(workspace, c.support.destination), 'support');
    // Overlay only individually frozen production paths. Never copy whole main.
    for (const row of c.code) { const target = join(workspace, row.path); await safeAncestors(target); await mkdir(dirname(target), {recursive: true}); await matched(join(checkout, row.path), row, true); await copyFile(join(checkout, row.path), target); await chmod(target, row.mode); await matched(target, row, true); }
    await copyVerified(downloaded.get(c.source.name), join(workspace, c.source.archiveDestination), c.source);
    for (const row of c.captures) await copyVerified(downloaded.get(row.name), join(workspace, row.destination), row);
    for (const row of c.artifacts) { await copyVerified(downloaded.get(row.name), join(workspace, row.destination), row); await extract('zip', row, join(workspace, row.restored), row.platform + '-' + row.app); }
    for (const row of c.provenance) { const b = Buffer.from(JSON.stringify(row.records, null, 2) + '\n'); assert.equal(b.length, row.bytes); assert.equal(hash(b), row.sha256); const file = join(workspace, row.path); await absent(file); await mkdir(dirname(file), {recursive: true}); await writeFile(file, b, {flag: 'wx'}); await matched(file, row); }
    // Production code checks every frozen source/support/SDK member and mode.
    for (const row of c.outputs) {
      await mkdir(dirname(join(workspace, row.aggregate)), {recursive: true});
      await runCommand(process.execPath, [row.verifier, '--platform', row.platform, '--source', c.source.destination], workspace, join(work, 'logs', row.platform + '-verify.log'));
      assert.equal(await sha256(join(workspace, row.aggregate)), row.aggregateSha256, 'Exact aggregate mismatch');
      const file = join(work, 'native', row.name);
      await runCommand(process.execPath, [row.packager, '--platform', row.platform, '--report', row.aggregate, '--source', c.source.destination, '--output', file], workspace, join(work, 'logs', row.platform + '-assemble.log'));
      await matched(file, row); result.outputs.push({name: row.name, bytes: row.bytes, sha256: row.sha256});
    }
    allOutputsVerified(c.outputs, result.outputs); result.allThreeNativeArchivesVerifiedBeforePublication = true;
    if (publishAssets) { const rows = [...c.captures, ...c.artifacts].map(row => ({...row, file: downloaded.get(row.name)})); rows.push(...c.outputs.map(row => ({...row, file: join(work, 'native', row.name)})), ...c.maps.map(row => ({...row, file: join(checkout, row.path)}))); await publish(c, token, rows, result.outputs, result.publication, work); result.published = true; }
    result.status = publishAssets ? 'EXACT_NATIVE_AND_RAW_ASSETS_PUBLISHED_READBACK_VERIFIED' : 'EXACT_NATIVE_ARCHIVES_RECONSTRUCTED_PUBLICATION_NOT_RUN';
    return result;
  } catch (error) { result.status = 'FAILED'; result.failure = String(error.message).replace(/https?:\/\/\S+/g, '[redacted-url]').slice(0, 1024); throw error; }
  finally { await writeFile(resultFile, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const {values} = parseArgs({options: {'checkout': {type: 'string', default: '.'}, work: {type: 'string', default: 'build/source3-cloud-publication'}, 'cache-root': {type: 'string'}, local: {type: 'boolean', default: false}, publish: {type: 'boolean', default: false}}});
  try { const r = await reconstruct({checkout: values.checkout, work: values.work, cacheRoot: values['cache-root'], local: values.local, publishAssets: values.publish}); console.log(r.status); }
  catch (error) { console.error(String(error.message).replace(/https?:\/\/\S+/g, '[redacted-url]').slice(0, 1024)); process.exitCode = 1; }
}
