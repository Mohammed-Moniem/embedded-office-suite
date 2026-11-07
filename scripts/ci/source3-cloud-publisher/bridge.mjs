import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {Duplex, Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {fixtures, EXPECTED_ENVIRONMENT, EXPECTED_PROBES} from './profile.mjs';
const helper = fileURLToPath(new URL('./system-zlib.py', import.meta.url));
export function cleanEnvironment() { const env = {...process.env}; for (const k of Object.keys(env)) if (/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION)/i.test(k)) delete env[k]; return env; }
export function systemIdentity() {
  const r = spawnSync('/usr/bin/python3', ['-I', helper, '--identity'], {env: cleanEnvironment(), encoding: 'utf8', maxBuffer: 4096, timeout: 10000});
  assert.equal(r.status, 0, 'Admitted macOS system zlib is unavailable'); return JSON.parse(r.stdout);
}
export function systemBuffer(input) {
  assert(Buffer.isBuffer(input) && input.length <= 1024 * 1024, 'Small preflight probe bound');
  const r = spawnSync('/usr/bin/python3', ['-I', helper], {env: cleanEnvironment(), input, maxBuffer: 2 * 1024 * 1024, timeout: 10000});
  assert.equal(r.status, 0, 'System zlib probe failed'); return r.stdout;
}
export function guardEnvironment(observation) {
  for (const k of ['node', 'platform', 'arch']) assert.equal(observation[k], EXPECTED_ENVIRONMENT[k], 'Unadmitted compression ' + k);
  assert.equal(observation.identity.runtimeZlib, EXPECTED_ENVIRONMENT.systemZlib, 'Unadmitted system compressor');
  assert.deepEqual(observation.identity, {library:'/usr/lib/libz.1.dylib',runtimeZlib:'1.2.12',streamBytes:112,level:9,method:8,windowBits:-15,memLevel:8,strategy:0,inputChunk:65536,outputChunk:16384}, 'Unadmitted compressor ABI or options');
  assert.deepEqual(observation.probes, EXPECTED_PROBES, 'System compressor output differs from the measured frozen environment');
}
export function observeSystem() {
  const identity = systemIdentity();
  const probes = fixtures().map(({name, bytes}) => { const out = systemBuffer(bytes); return {name, inputBytes: bytes.length, inputSha256: createHash('sha256').update(bytes).digest('hex'), compressedBytes: out.length, compressedSha256: createHash('sha256').update(out).digest('hex')}; });
  return {node: process.versions.node, platform: process.platform, arch: process.arch, builtinZlib: process.versions.zlib, identity, probes};
}
export function createSystemDeflateRaw(options) {
  assert(options && Object.getPrototypeOf(options) === Object.prototype && Reflect.ownKeys(options).length === 1 && Object.hasOwn(options,'level') && options.level === 9, 'System bridge admits only the frozen createDeflateRaw({level:9}) call');
  const child = spawn('/usr/bin/python3', ['-I', helper], {env: cleanEnvironment(), stdio: ['pipe', 'pipe', 'pipe']});
  let stderrBytes = 0;
  child.stderr.on('data', b => { stderrBytes += b.length; if (stderrBytes > 4096) child.kill(); });
  const complete = new Promise((yes, no) => { child.once('error', () => no(Error('System compressor did not start'))); child.once('close', (code, signal) => code === 0 && stderrBytes === 0 ? yes() : no(Error('System compressor failed closed: exit=' + code + ' signal=' + signal))); });
  // Attach rejection handling immediately; the readable awaits this same promise
  // before ending, so a helper failure cannot appear as a successful EOF.
  complete.catch(() => {});
  const timer = setTimeout(() => child.kill(), 300000);
  complete.finally(() => clearTimeout(timer)).catch(() => {});
  async function* output() { for await (const b of child.stdout) yield b; await complete; }
  const stream = Duplex.from({writable: child.stdin, readable: Readable.from(output())});
  stream.once('close', () => { if (child.exitCode === null) child.kill(); });
  return stream;
}
