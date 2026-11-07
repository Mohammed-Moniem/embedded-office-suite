import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile, open, mkdir, rm, chmod } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { createDeflateRaw } from 'node:zlib';

export function safeRelative(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-z]:/i.test(path)) throw new Error('Unsafe relative path');
  const segments = path.split('/');
  if (segments.some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe relative path');
  return path;
}
export async function filesIn(root) {
  root = resolve(root);
  const output = [];
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Symbolic links are not distributable entries: ${relative(root, path)}`);
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) output.push({ path: safeRelative(relative(root, path).split(sep).join('/')), absolute: path, size: info.size, mode: info.mode & 0o777 });
      else throw new Error(`Non-regular distribution entry: ${path}`);
    }
  }
  await visit(root);
  return output;
}
export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
export async function createManifest(root, metadata = {}) {
  const files = await filesIn(root);
  if (files.some(f => f.path === 'MANIFEST.json')) throw new Error('Stage already contains MANIFEST.json; do not hash a stale manifest');
  const manifest = { schemaVersion: 1, ...metadata, files: [] };
  for (const file of files) manifest.files.push({ path: file.path, bytes: file.size, mode: file.mode, sha256: await sha256(file.absolute) });
  if (!manifest.files.length) throw new Error('Cannot publish an empty artifact');
  await writeFile(join(root, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
async function checkManifest(root, { expectedKind, expectedPlatform } = {}, verifyModes = true) {
  const manifest = JSON.parse(await readFile(join(root, 'MANIFEST.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid or empty manifest');
  if (expectedKind && manifest.kind !== expectedKind) throw new Error('Artifact kind mismatch');
  if (expectedPlatform && manifest.platform !== expectedPlatform) throw new Error('Artifact platform mismatch');
  const expected = new Set(['MANIFEST.json']);
  for (const file of manifest.files) {
    const path = safeRelative(file.path);
    if (expected.has(path)) throw new Error(`Duplicate manifest entry: ${path}`);
    expected.add(path);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Invalid file metadata: ${path}`);
    const absolute = join(root, path);
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes || await sha256(absolute) !== file.sha256) throw new Error(`Integrity failure: ${path}`);
    // Windows does not expose POSIX executable bits. On POSIX these bits are part
    // of the runnable artifact, so accepting content alone would hide damage.
    if (verifyModes && process.platform !== 'win32' && (info.mode & 0o777) !== file.mode) throw new Error(`Artifact mode mismatch: ${path}`);
  }
  const actual = await filesIn(root);
  for (const file of actual) if (!expected.has(file.path)) throw new Error(`Unlisted artifact entry: ${file.path}`);
  if (actual.length !== expected.size) throw new Error('Artifact file count mismatch');
  return manifest;
}
export async function verifyManifest(root, options) { return checkManifest(root, options); }

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function updateCrc(state, buffer) { for (const byte of buffer) state = crcTable[(state ^ byte) & 255] ^ (state >>> 8); return state >>> 0; }
function u32(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error('Archive requires ZIP64; split this artifact before publishing'); return value; }

// Streaming ZIP with data descriptors. File modes are retained for executable Rust workers.
// ZIP64 is intentionally rejected, so oversized archives cannot be silently corrupted.
export async function writeZip(root, destination) {
  root = resolve(root); destination = resolve(destination);
  if (destination === root || destination.startsWith(root + sep)) throw new Error('Archive output must be outside its input stage');
  const files = await filesIn(root);
  if (!files.length || files.length > 65535) throw new Error('Empty stage or ZIP entry limit exceeded');
  await mkdir(dirname(destination), { recursive: true });
  const temporary = destination + '.partial';
  const output = await open(temporary, 'wx');
  let position = 0;
  const central = [];
  async function emit(buffer) {
    let offset = 0;
    while (offset < buffer.length) { const { bytesWritten } = await output.write(buffer, offset, buffer.length - offset); if (!bytesWritten) throw new Error('Zero-byte archive write'); offset += bytesWritten; }
    position = u32(position + buffer.length);
  }
  try {
    for (const file of files) {
      const name = Buffer.from(file.path, 'utf8');
      if (name.length > 65535) throw new Error('ZIP entry name too long');
      const localOffset = position;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0808, 6); header.writeUInt16LE(8, 8);
      header.writeUInt16LE(0x21, 12); header.writeUInt16LE(name.length, 26);
      await emit(header); await emit(name);
      let crc = 0xffffffff, rawBytes = 0, compressedBytes = 0;
      async function* source() {
        for await (const chunk of createReadStream(file.absolute)) { crc = updateCrc(crc, chunk); rawBytes = u32(rawBytes + chunk.length); yield chunk; }
      }
      for await (const chunk of Readable.from(source()).pipe(createDeflateRaw({ level: 9 }))) { compressedBytes = u32(compressedBytes + chunk.length); await emit(chunk); }
      if (rawBytes !== file.size) throw new Error(`File changed while archiving: ${file.path}`);
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(compressedBytes, 8); descriptor.writeUInt32LE(rawBytes, 12); await emit(descriptor);
      const directory = Buffer.alloc(46);
      directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0808, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(0x21, 14);
      directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressedBytes, 20); directory.writeUInt32LE(rawBytes, 24); directory.writeUInt16LE(name.length, 28);
      directory.writeUInt32LE(((0o100000 | file.mode) * 65536) >>> 0, 38); directory.writeUInt32LE(localOffset, 42);
      central.push(directory, name);
    }
    const centralOffset = position;
    for (const buffer of central) await emit(buffer);
    const centralSize = position - centralOffset;
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralOffset, 16); await emit(end);
    await output.sync(); await output.close();
    const { rename } = await import('node:fs/promises'); await rename(temporary, destination);
    return { path: destination, bytes: position, files: files.length, sha256: await sha256(destination) };
  } catch (error) { await output.close().catch(() => {}); await rm(temporary, { force: true }); throw error; }
}

export async function applyManifestModes(root) {
  // Explicit recovery for extractors that discard POSIX modes. Verify every
  // content hash and path before granting execute permission to any file.
  const manifest = await checkManifest(root, {}, false);
  if (process.platform !== 'win32') for (const file of manifest.files) await chmod(join(root, file.path), file.mode);
  return verifyManifest(root);
}
