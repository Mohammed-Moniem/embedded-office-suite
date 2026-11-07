import { readFile, realpath, stat, lstat, open, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, relative, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OfficeError, fail, abort, bytes } from './errors.mjs';

function within(root, target) {
  const rel = relative(root, target);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')));
}
/** Root checks are host policy, not an OS sandbox or protection against concurrent symlink swaps. */
export function createFilesystemHost({readRoots = [], writeRoots = [], authorizeEffect, maxFileBytes = 512 * 1024 * 1024} = {}) {
  if (!Array.isArray(readRoots) || !Array.isArray(writeRoots) || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1)
    fail('INVALID_ARGUMENT', 'Invalid filesystem roots or file size limit');
  const roots = Promise.all([readRoots, writeRoots].map(list => Promise.all(list.map(async path => {
    if (typeof path !== 'string') fail('INVALID_ARGUMENT', 'Root must be a path');
    const canonical = await realpath(path);
    if (!(await stat(canonical)).isDirectory()) fail('INVALID_ARGUMENT', 'Root must be an existing directory');
    return {canonical, lexical: resolve(path)};
  }))));
  roots.catch(() => {});
  const authorize = async (path, write) => {
    if (typeof path !== 'string' || !path || path.includes('\0')) fail('INVALID_ARGUMENT', 'A file path is required');
    const allowed = (await roots)[write ? 1 : 0];
    const absolute = resolve(path);
    // Reject by lexical path before touching a location outside the declared grant.
    if (!allowed.some(root => within(root.canonical, absolute) || within(root.lexical, absolute))) fail('ACCESS_DENIED', 'Path is outside the host root grant');
    const parent = await realpath(dirname(absolute));
    const canonical = join(parent, basename(absolute));
    if (!allowed.some(root => within(root.canonical, canonical))) fail('ACCESS_DENIED', 'Path resolves outside the host root grant');
    if (write) {
      try {
        const entry = await lstat(canonical);
        if (entry.isSymbolicLink() || !entry.isFile()) fail('ACCESS_DENIED', 'Save destination must be a regular file');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return canonical;
    }
    const target = await realpath(canonical);
    if (!allowed.some(root => within(root.canonical, target))) fail('ACCESS_DENIED', 'File resolves outside the host read root');
    return target;
  };
  return Object.freeze({
    authorizeEffect,
    async readFile({path, signal} = {}) {
      abort(signal);
      const target = await authorize(path, false), info = await stat(target);
      if (!info.isFile()) fail('ACCESS_DENIED', 'Input must be a regular file');
      if (info.size > maxFileBytes) fail('FILE_TOO_LARGE', 'Input exceeds host file limit');
      const data = await readFile(target, {signal});
      if (data.length > maxFileBytes) fail('FILE_TOO_LARGE', 'Input exceeds host file limit');
      return new Uint8Array(data);
    },
    async writeFileAtomic({path, bytes: input, signal} = {}) {
      abort(signal);
      const data = bytes(input);
      if (data.length > maxFileBytes) fail('FILE_TOO_LARGE', 'Output exceeds host file limit');
      const target = await authorize(path, true);
      const staging = join(dirname(target), `.office-${randomUUID()}.tmp`);
      let file;
      try {
        file = await open(staging, 'wx', 0o600);
        await file.writeFile(data); await file.sync(); await file.close(); file = undefined;
        abort(signal);
        await authorize(target, true);
        await rename(staging, target);
        return {path: target, committed: true};
      } catch (error) {
        if (error instanceof OfficeError) throw error;
        throw new OfficeError('SAVE_FAILED', 'Host could not atomically save the document', {systemCode: error.code});
      } finally {
        if (file) await file.close().catch(() => {});
        await unlink(staging).catch(() => {});
      }
    },
  });
}
