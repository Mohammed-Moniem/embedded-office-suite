#!/usr/bin/env node
// Download and verify fixed release archives. This module never extracts or executes them.
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {readFile, lstat, realpath, mkdir, open, link, unlink, readdir} from 'node:fs/promises';
import {dirname, resolve, relative, parse, join, isAbsolute, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const CONFIG_SHA256 = '2ba769bd1e1d70e68f63d9b7b88e187409f0d739d2dfc59ccd6337383aaef2b5';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'config/office-kit-downloads-progress3.json');
const PLATFORMS = ['windows-x64', 'macos-arm64', 'macos-x64'];
const TIMEOUT_MS = 6 * 60 * 60_000; // Bounded per archive, including slow approved corporate links.
const SHA = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const maybeStat = async path => { try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const within = (a, b) => { const r = relative(a,b); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };

export async function loadInventory() {
  const bytes = await readFile(CONFIG);
  if (SHA(bytes) !== CONFIG_SHA256) fail('Fixed inventory checksum mismatch');
  const c = JSON.parse(bytes);
  if (c.schemaVersion !== 1 || c.assets.length !== 13) fail('Invalid fixed inventory');
  const names = new Set();
  for (const a of c.assets) {
    if (!/^[a-z0-9][a-z0-9.-]+$/.test(a.name) || names.has(a.name) || !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || !/^[0-9a-f]{64}$/.test(a.sha256)) fail('Invalid fixed asset');
    const u = new URL(a.url);
    if (u.origin !== 'https://github.com' || u.search || u.hash || u.username || u.password || u.pathname !== `/Mohammed-Moniem/embedded-office-suite/releases/download/${a.role === 'tools' || a.role === 'vendor' || a.role === 'support' ? 'v0.1.0-progress.1' : 'v0.1.0-progress.3'}/${a.name}`) fail('Invalid fixed asset URL');
    names.add(a.name);
  }
  return c;
}

export function selectAssets(inventory, {platform='auto', profile='runtime'}={}) {
  if (platform === 'auto') platform = ({'darwin-arm64':'macos-arm64','darwin-x64':'macos-x64','win32-x64':'windows-x64'})[`${process.platform}-${process.arch}`];
  if (!PLATFORMS.includes(platform)) fail('Use --platform windows-x64, macos-arm64 or macos-x64; auto supports only those hosts');
  if (!['runtime','build','all'].includes(profile)) fail('Use --profile runtime, build or all');
  const assets = inventory.assets.filter(a => (!a.platform || a.platform === platform) && (profile === 'all' || (profile === 'runtime' ? ['native','wasm'].includes(a.role) : ['source','vendor','support','tools'].includes(a.role))));
  return {platform,profile,assets,totalBytes:assets.reduce((n,a)=>n+a.bytes,0)};
}

// Check every existing path component, including parents of a new destination.
// Junctions are symbolic links through Node's Windows lstat interface as well.
async function inspectDirectory(path, create=false) {
  const base = parse(path).root;
  let current = base;
  const snapshots = [];
  for (const part of path.slice(base.length).split(sep).filter(Boolean)) {
    current = join(current,part);
    let st = await maybeStat(current);
    if (!st && create) { try { await mkdir(current); } catch (e) { if (e.code !== 'EEXIST') throw e; } st = await lstat(current); }
    if (st) {
      if (!st.isDirectory() || st.isSymbolicLink()) fail('Destination has a non-directory or symbolic-link component');
      const physical = await realpath(current);
      const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
      if (key(physical) !== key(current)) fail('Destination has a filesystem alias or reparse component');
      snapshots.push({path:current,st});
    } else if (!create) break;
  }
  const last = snapshots.at(-1);
  const canonicalParent = last ? await realpath(last.path) : base;
  return {snapshots,canonical:resolve(canonicalParent,last ? relative(last.path,path) : relative(base,path))};
}

async function checkStable(directory) {
  for (const {path,st} of directory.snapshots) {
    const now = await lstat(path);
    if (now.isSymbolicLink() || !now.isDirectory() || !same(st,now)) fail('Destination directory changed during verification');
  }
}

async function safeDestination(destination, create=false) {
  if (typeof destination !== 'string' || !isAbsolute(destination) || destination.includes('\0') || destination !== resolve(destination)) fail('--destination must be an absolute normalized path');
  const d = await inspectDirectory(destination,false);
  const root = await realpath(ROOT);
  if (within(d.canonical,root)) fail('Destination overlaps the source checkout');
  const protectedPaths = ['scripts','config','docs','engines','packages','patches','.git','.toolchains','.unlazy'];
  // Frozen build inputs and other workers' evidence are protected as well.
  try { for (const name of await readdir(join(ROOT,'build'))) if (name !== 'kit-downloader') protectedPaths.push(join('build',name)); } catch (e) { if(e.code !== 'ENOENT') throw e; }
  for (const p of protectedPaths) {
    const target = resolve(root,p);
    if (within(target,d.canonical) || within(d.canonical,target)) fail('Destination overlaps a protected source or build directory');
  }
  await checkStable(d);
  if (!create) return d;
  const made = await inspectDirectory(destination,true);
  if (made.canonical !== d.canonical) fail('Destination canonical path changed');
  await checkStable(made);
  return made;
}

async function verifyExisting(path, asset, directory, signal) {
  signal?.throwIfAborted(); await checkStable(directory);
  const before = await maybeStat(path);
  if (!before) return false;
  if (before.isSymbolicLink() || !before.isFile() || before.size !== asset.bytes) fail(`Existing file has wrong type or size: ${asset.name}`);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const start = await handle.stat();
    if (!same(start,before) || start.size !== asset.bytes) fail(`Existing file changed: ${asset.name}`);
    const hash = createHash('sha256'); let count = 0;
    for await (const chunk of handle.createReadStream({autoClose:false})) {
      signal?.throwIfAborted(); count += chunk.length;
      if (count > asset.bytes) fail(`Existing file grew: ${asset.name}`);
      hash.update(chunk);
    }
    const after = await handle.stat(), named = await lstat(path);
    if (count !== asset.bytes || hash.digest('hex') !== asset.sha256 || !same(start,after) || !same(start,named) || after.size !== start.size || after.mtimeMs !== start.mtimeMs || after.ctimeMs !== start.ctimeMs || named.isSymbolicLink()) fail(`Existing file checksum or identity mismatch: ${asset.name}`);
    await checkStable(directory); return true;
  } finally { await handle.close(); }
}

function allowedHop(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname)) fail('Release redirect is outside approved GitHub hosts');
  return u;
}

async function releaseResponse(asset, signal) {
  let u = allowedHop(asset.url);
  for (let hop=0;hop<=5;hop++) {
    signal.throwIfAborted();
    const response = await fetch(u,{redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Accept-Encoding':'identity'},signal});
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location || hop === 5) fail('Missing or excessive GitHub release redirect');
      u = allowedHop(new URL(location,u)); continue;
    }
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); fail(`GitHub download failed (${response.status}): ${asset.name}`); }
    const length = response.headers.get('content-length');
    if (length !== null && length !== String(asset.bytes)) { await response.body.cancel(); fail(`Download content length mismatch: ${asset.name}`); }
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding !== 'identity') { await response.body.cancel(); fail('Encoded release response rejected'); }
    return response;
  }
}

async function downloadOne(asset, destination, directory, outerSignal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = outerSignal ? AbortSignal.any([timeout,outerSignal]) : timeout;
  const temp = join(destination,`.office-kit-${randomUUID()}.part`);
  let handle, identity;
  try {
    await checkStable(directory); signal.throwIfAborted();
    handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0),0o600);
    identity = await handle.stat();
    const response = await releaseResponse(asset,signal), reader = response.body.getReader();
    let count = 0; const hash = createHash('sha256');
    const abortRead = () => { void reader.cancel().catch(()=>{}); };
    signal.addEventListener('abort',abortRead,{once:true});
    try {
      for (;;) {
        signal.throwIfAborted(); const {done,value} = await reader.read(); signal.throwIfAborted();
        if (done) break;
        if (!(value instanceof Uint8Array)) fail('Download stream must contain bytes');
        count += value.byteLength; if (count > asset.bytes) fail(`Download exceeded pinned size: ${asset.name}`);
        hash.update(value);
        let offset=0;
        while (offset < value.byteLength) { const {bytesWritten}=await handle.write(value,offset,value.byteLength-offset); if(bytesWritten <= 0) fail('Download write made no progress'); offset += bytesWritten; }
      }
      if (count !== asset.bytes || hash.digest('hex') !== asset.sha256) fail(`Download checksum or size mismatch: ${asset.name}`);
    } finally { signal.removeEventListener('abort',abortRead); await reader.cancel().catch(()=>{}); reader.releaseLock(); }
    await handle.sync(); await handle.close(); handle = null;
    signal.throwIfAborted(); await checkStable(directory);
    const named = await lstat(temp);
    if (!same(identity,named) || !named.isFile() || named.isSymbolicLink() || named.size !== asset.bytes) fail('Owned temporary file changed');
    // link() fails if a destination exists; rename() could overwrite a racing writer.
    await link(temp,join(destination,asset.name));
    return {name:asset.name,bytes:asset.bytes,sha256:asset.sha256,status:'downloaded'};
  } finally {
    if (handle) await handle.close();
    if (identity) {
      // Never remove a path another actor substituted for our owned temporary.
      const now = await maybeStat(temp);
      if (now && same(identity,now) && now.isFile() && !now.isSymbolicLink()) await unlink(temp);
    }
  }
}

export async function downloadKit(options) {
  for (const key of Object.keys(options)) if (!['destination','platform','profile','offline','plan','signal'].includes(key)) fail(`Unknown option: ${key}`);
  if (Number(process.versions.node.split('.')[0]) < 22) fail('Node 22 or newer is required');
  for(const key of ['offline','plan']) if(options[key] !== undefined && typeof options[key] !== 'boolean') fail(`Invalid ${key} option`);
  const inventory = await loadInventory(), selected = selectAssets(inventory,options);
  let directory = await safeDestination(options.destination);
  if (options.plan) return {mode:'plan',destination:options.destination,...selected};
  const existing = new Set();
  for (const a of selected.assets) {
    if (await verifyExisting(join(options.destination,a.name),a,directory,options.signal)) existing.add(a.name);
    else if (options.offline) fail(`Offline file missing: ${a.name}`);
  }
  if (existing.size !== selected.assets.length) directory = await safeDestination(options.destination,true);
  const files = [];
  for (const a of selected.assets) {
    options.signal?.throwIfAborted();
    files.push(existing.has(a.name) ? {name:a.name,bytes:a.bytes,sha256:a.sha256,status:'verified-existing'} : await downloadOne(a,options.destination,directory,options.signal));
  }
  return {mode:options.offline?'offline-verified':'download-verified',destination:options.destination,platform:selected.platform,profile:selected.profile,totalBytes:selected.totalBytes,files};
}

export function parseArguments(args) {
  const options={};
  for (let i=0;i<args.length;i++) {
    const arg=args[i];
    if (arg === '--help') { if(args.length !== 1) fail('--help must be used alone'); return {help:true}; }
    const key=({'--destination':'destination','--platform':'platform','--profile':'profile','--offline':'offline','--plan':'plan'})[arg];
    if (!key || Object.hasOwn(options,key)) fail(`Unknown or duplicate option: ${arg}`);
    if (key === 'offline' || key === 'plan') options[key]=true;
    else { const value=args[++i]; if (!value || value.startsWith('--')) fail(`Value required for ${arg}`); options[key]=value; }
  }
  if (!options.destination) fail('--destination is required');
  return options;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  // A pending stream or cleanup promise alone need not keep Node's loop alive.
  const keepAlive = setInterval(()=>{},60_000);
  let interrupted;
  const onSignal = signal => {
    const code = signal === 'SIGINT' ? 130 : 143;
    if (interrupted) process.exit(code); // An explicit second signal forces termination.
    interrupted = signal;
    process.exitCode = code;
    controller.abort(new Error(`Interrupted by ${signal}`));
  };
  const onInterrupt = () => onSignal('SIGINT');
  const onTerminate = () => onSignal('SIGTERM');
  process.on('SIGINT',onInterrupt);
  process.on('SIGTERM',onTerminate);
  try {
    const options=parseArguments(process.argv.slice(2));
    if(options.help) console.log('Usage: node scripts/download-office-kit.mjs --destination ABSOLUTE_PATH [--platform auto|windows-x64|macos-arm64|macos-x64] [--profile runtime|build|all] [--offline] [--plan]\nDownloads fixed GitHub release archives only. No extraction, installation or execution.');
    else {
      const result = await downloadKit({...options,signal:controller.signal});
      controller.signal.throwIfAborted();
      console.log(JSON.stringify(result,null,2));
    }
  } catch (e) {
    console.error(`Office kit: ${interrupted ? `Interrupted by ${interrupted}` : e.message}`);
    process.exitCode = interrupted ? (interrupted === 'SIGINT' ? 130 : 143) : 1;
  } finally {
    clearInterval(keepAlive);
    process.off('SIGINT',onInterrupt);
    process.off('SIGTERM',onTerminate);
  }
}
