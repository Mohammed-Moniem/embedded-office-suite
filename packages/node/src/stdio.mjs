import { spawn } from 'node:child_process';
import { OfficeError, fail, abort } from './errors.mjs';

const versions = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);
/** A timeout/cancellation kills the dedicated worker: its last operation may have run. */
export function createStdioTransport({command, args = ['mcp'], cwd, env, timeoutMs = 30_000,
  maxMessageBytes = 16 * 1024 * 1024, maxPending = 32, killTimeoutMs = 1_000, onStderr} = {}) {
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(x => typeof x !== 'string'))
    fail('INVALID_ARGUMENT', 'A command and string argument array are required');
  for (const [name, value] of Object.entries({timeoutMs, maxMessageBytes, maxPending, killTimeoutMs}))
    if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_ARGUMENT', `${name} must be a positive integer`);
  const child = spawn(command, args, {cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let closed = false, sequence = 0, buffer = Buffer.alloc(0), death, killTimer;
  const pending = new Map();
  let resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  function clean(entry) { clearTimeout(entry.timer); entry.signal?.removeEventListener('abort', entry.cancel); }
  function stop(error = new OfficeError('TRANSPORT_CLOSED', 'Worker transport closed')) {
    if (closed) return;
    closed = true; death = error;
    for (const entry of pending.values()) { clean(entry); entry.reject(error); }
    pending.clear(); buffer = Buffer.alloc(0);
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    child.kill();
    killTimer = setTimeout(() => { child.kill('SIGKILL'); }, killTimeoutMs);
    killTimer.unref();
  }
  child.on('error', () => stop(new OfficeError('SPAWN_FAILED', 'Unable to start the configured worker')));
  child.on('close', (code, signal) => {
    clearTimeout(killTimer);
    stop(new OfficeError('WORKER_EXITED', 'Worker exited', {exitCode: code, signal}));
    clearTimeout(killTimer); resolveExit();
  });
  child.stdin.on('error', () => stop(new OfficeError('TRANSPORT_CLOSED', 'Worker input closed')));
  child.stdout.on('error', () => stop(new OfficeError('TRANSPORT_CLOSED', 'Worker output failed')));
  child.stdout.on('end', () => { if (!closed) stop(new OfficeError('TRANSPORT_CLOSED', 'Worker output closed')); });
  child.stderr.on('data', data => { if (onStderr) { try { onStderr(data.subarray(0, 4096).toString('utf8')); } catch {} } });
  function send(message) {
    if (closed) throw death;
    let line;
    try { line = JSON.stringify(message) + '\n'; } catch { fail('INVALID_ARGUMENT', 'Request must be JSON serializable'); }
    if (Buffer.byteLength(line) > maxMessageBytes) fail('MESSAGE_TOO_LARGE', 'Request exceeds the configured frame limit');
    child.stdin.write(line);
  }
  child.stdout.on('data', chunk => {
    if (closed) return;
    buffer = Buffer.concat([buffer, chunk]);
    let boundary;
    while ((boundary = buffer.indexOf(10)) >= 0) {
      if (boundary + 1 > maxMessageBytes) { stop(new OfficeError('MESSAGE_TOO_LARGE', 'Worker response exceeds frame limit')); return; }
      const frame = buffer.subarray(0, boundary); buffer = buffer.subarray(boundary + 1);
      let message;
      try { message = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(frame)); }
      catch { stop(new OfficeError('PROTOCOL_ERROR', 'Worker sent invalid JSON or UTF-8')); return; }
      if (!message || Array.isArray(message) || message.jsonrpc !== '2.0') {
        stop(new OfficeError('PROTOCOL_ERROR', 'Worker sent an invalid JSON-RPC envelope')); return;
      }
      if (!Object.hasOwn(message, 'id')) {
        if (typeof message.method !== 'string' || Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) {
          stop(new OfficeError('PROTOCOL_ERROR', 'Worker sent an invalid notification')); return;
        }
        continue;
      }
      const entry = pending.get(message.id);
      const hasResult = Object.hasOwn(message, 'result'), hasError = Object.hasOwn(message, 'error');
      if (!entry || Object.hasOwn(message, 'method') || hasResult === hasError ||
        (hasError && (!message.error || !Number.isInteger(message.error.code) || typeof message.error.message !== 'string'))) {
        stop(new OfficeError('PROTOCOL_ERROR', 'Worker sent an uncorrelated or malformed response')); return;
      }
      pending.delete(message.id); clean(entry);
      if (hasError) entry.reject(new OfficeError('RPC_ERROR', 'Worker rejected the request', {rpcCode: message.error.code, method: entry.method}));
      else entry.resolve(message.result);
    }
    if (buffer.length >= maxMessageBytes) stop(new OfficeError('MESSAGE_TOO_LARGE', 'Worker sent an oversized unterminated frame'));
  });
  function rawRequest(method, params = {}, {signal, timeoutMs: limit = timeoutMs} = {}) {
    try { abort(signal); if (closed) throw death;
      if (typeof method !== 'string' || !method || !Number.isSafeInteger(limit) || limit < 1) fail('INVALID_ARGUMENT', 'Invalid method or timeout');
      if (pending.size >= maxPending) fail('BUSY', 'Worker request queue is full');
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const cancel = () => {
        try { send({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: id, reason: 'Client cancelled'}}); } catch {}
        stop(new OfficeError('CANCELLED', 'Worker terminated after cancellation; the operation may have run', {outcomeUnknown: true}));
      };
      const timer = setTimeout(() => stop(new OfficeError('TIMEOUT', 'Worker terminated after timeout; the operation may have run', {outcomeUnknown: true})), limit);
      const entry = {resolve, reject, method, timer, signal, cancel};
      pending.set(id, entry); signal?.addEventListener('abort', cancel, {once: true});
      try { send({jsonrpc: '2.0', id, method, params}); }
      catch (error) { pending.delete(id); clean(entry); reject(error); }
    });
  }
  const ready = rawRequest('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'embedded-office-node', version: '0.1.0'},
  }).then(result => {
    if (!result || !versions.has(result.protocolVersion) || !result.capabilities || typeof result.capabilities !== 'object') {
      const error = new OfficeError('PROTOCOL_ERROR', 'Worker negotiated an unsupported MCP protocol'); stop(error); throw error;
    }
    send({jsonrpc: '2.0', method: 'notifications/initialized'});
    return {protocolVersion: result.protocolVersion, capabilities: result.capabilities, serverInfo: result.serverInfo};
  });
  ready.catch(() => {});
  async function request(method, params, options = {}) {
    const {signal, timeoutMs: limit = timeoutMs} = options;
    abort(signal);
    if (closed) throw death;
    if (typeof method !== 'string' || !method || !Number.isSafeInteger(limit) || limit < 1)
      fail('INVALID_ARGUMENT', 'Invalid method or timeout');
    const deadline = performance.now() + limit;
    // A caller's lifetime begins here, including a still-pending initialize handshake.
    // Expiry kills this dedicated worker and invalidates every other pending request.
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve();
      };
      const cancel = () => {
        const error = new OfficeError('CANCELLED', 'Worker terminated after cancellation; the operation may have run', {outcomeUnknown: true});
        stop(error); finish(error);
      };
      const timer = setTimeout(() => {
        const error = new OfficeError('TIMEOUT', 'Worker terminated after timeout; the operation may have run', {outcomeUnknown: true});
        stop(error); finish(error);
      }, limit);
      signal?.addEventListener('abort', cancel, {once: true});
      ready.then(() => finish(), error => finish(error));
      if (signal?.aborted) cancel();
    });
    abort(signal);
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) {
      const error = new OfficeError('TIMEOUT', 'Worker terminated after timeout; the operation may have run', {outcomeUnknown: true});
      stop(error); throw error;
    }
    return rawRequest(method, params, {...options, timeoutMs: remaining});
  }
  return Object.freeze({
    kind: 'mcp-stdio', ready,
    request,
    async close() { stop(); await exited; },
    get closed() { return closed; },
  });
}
