// Explicit, reviewed compressor selection. No hash, permission or source guard is
// altered. The existing packager must still produce the exact accepted ZIP.
import assert from 'node:assert/strict';
import {readFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import zlib from 'node:zlib';
const dependencies = {
  'system-zlib.py': '6954863e2f85f18dc817650fd1a85ccac9a4ef5f0a2215d4bd3551fbb5a8b213',
  'profile.mjs': '78889e84f887f692ac67086d3417197d8300829f1a2fb5c9fc851b5fe6108ece',
  'bridge.mjs': 'fa196f5faa055b63084465a1c76c9e8b0d61f4092407c8acf8b91d912f8b9bce',
};
for (const [name, digest] of Object.entries(dependencies)) {
  const url = new URL('./' + name, import.meta.url), info = await lstat(url);
  assert(info.isFile() && !info.isSymbolicLink(), 'Regular compressor closure file required');
  assert.equal(createHash('sha256').update(await readFile(url)).digest('hex'), digest, 'Compressor closure hash mismatch: ' + name);
}
const {observeSystem, guardEnvironment, createSystemDeflateRaw} = await import('./bridge.mjs');
const observation = observeSystem();
guardEnvironment(observation);
// The builtin namespace update is deliberately visible and confined to the one
// API called by the frozen ZIP helper, with its exact {level:9} option contract.
Object.defineProperty(zlib, 'createDeflateRaw', {value: createSystemDeflateRaw});
syncBuiltinESMExports();
process.stderr.write('EXPLICIT_SYSTEM_ZLIB_BRIDGE_ADMITTED builtin=' + process.versions.zlib + ' system=1.2.12 level=9 raw/window15/mem8/strategy0; exact ZIP gates retained\n');
