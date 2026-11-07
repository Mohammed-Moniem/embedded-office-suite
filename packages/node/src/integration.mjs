import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { APPS, FORMATS, createNativeSessionTransport } from './native.mjs';
import { fail, object, bytes, abort, revision, OfficeError } from './errors.mjs';
import {createLifetime} from './lifetime.mjs';

const LIFE = Symbol('office caller lifetime');

const jsonSchema = properties => ({type: 'object', properties, additionalProperties: false});
const string = {type: 'string'}, integer = {type: 'integer', minimum: 0};
const sessionProperties = {sessionId: string, expectedRevision: integer};
const definitions = [
  ['capabilities', 'Discover configured engines and truthful session capabilities.', {sessionId: string}],
  ['commands', 'Discover commands on an open document; use query to keep results bounded.', {sessionId: string, query: string, limit: {type: 'integer', minimum: 1, maximum: 200}}],
  ['open', 'Open a host-approved path or create a document in a dedicated worker.', {app: {type: 'string', enum: APPS}, path: string, name: string}],
  ['execute', 'Run an engine command on this session, with host effect authorization.', {...sessionProperties, command: string, params: {type: 'object'}}],
  ['inspect', 'Inspect this session document.', {sessionId: string}],
  ['render', 'Render the session document when supported by the engine.', {sessionId: string, page: integer, slide: integer, scale: {type: 'number'}, max_side: integer}],
  ['export', 'Export session bytes as base64. This does not save to host storage.', {...sessionProperties, format: string}],
  ['save', 'Save through the host callback and acknowledge only after durable success.', {...sessionProperties, path: string, name: string, saveAs: {type: 'boolean'}}],
  ['close', 'Close a document. Dirty documents require discardChanges.', {...sessionProperties, discardChanges: {type: 'boolean'}}],
];
export const officeToolDescriptors = Object.freeze(definitions.map(([method, description, properties]) => Object.freeze({
  name: `office.${method}`, description,
  inputSchema: {...jsonSchema(properties), ...(method === 'capabilities' ? {} : {required: method === 'open' ? ['app'] : ['sessionId']})},
})));

/** The facade owns dedicated workers; browser sessions retain their actual WASM revision authority. */
export function createOfficeIntegration({host = {}, transports = {}, binaries = {}, assetBaseUrl} = {}) {
  object(host, 'host'); object(transports, 'transports'); object(binaries, 'binaries');
  const sessions = new Map(), claimed = new WeakSet(), opening = new Set(), operations = new Set();
  let disposed = false, disposal;
  function active() { if (disposed) fail('DISPOSED', 'Office integration has been disposed'); }
  function find(id) {
    active(); const session = sessions.get(id);
    if (!session || session.closed) fail('SESSION_NOT_FOUND', 'Unknown or closed session');
    if (session.invalidated) fail('SESSION_UNAVAILABLE', 'Document transport was invalidated; reopen the document');
    if (session.closing) fail('SESSION_CLOSING', 'Document is closing');
    return session;
  }
  function check(s, expected) {
    if (expected !== undefined && revision(expected) !== s.revision) fail('STALE_REVISION', 'Document revision does not match', {currentRevision: s.revision});
  }
  function enqueue(s, input, fn) {
    const life = input[LIFE];
    const result = s.tail.then(() => {
      life.check();
      if (s.closed || s.invalidated) fail('SESSION_UNAVAILABLE', 'Document transport is unavailable');
      return fn();
    });
    s.tail = result.catch(() => {});
    return life.wait(result);
  }
  const view = s => ({sessionId: s.id, app: s.app, revision: s.revision, dirty: s.dirty, kind: s.native ? 'native' : 'browser', name: s.name});
  const options = input => ({signal: input[LIFE].signal, timeoutMs: input[LIFE].remaining()});
  async function transportCall(s, input, method, params = {}) {
    const life = input[LIFE];
    life.check();
    let dispatched = false;
    const remove = life.onAbort(error => {
      if (!dispatched) return;
      s.invalidated = error;
      s.dirty = true;
      Promise.resolve().then(() => s.transport.close()).catch(() => {});
    });
    try {
      return await life.wait(() => {
        if (['office.open', 'office.execute', 'office.save', 'office.export', 'office.close'].includes(method)) life.markEffect();
        dispatched = true;
        return s.transport.request(method, params, options(input));
      });
    } finally { remove(); }
  }
  async function sync(s, input) {
    if (s.native) return;
    const state = await transportCall(s, input, 'office.state');
    input[LIFE].check();
    if (!state || state.app !== s.app || state.sessionId !== s.remoteId || state.closed) fail('SESSION_OWNERSHIP', 'Live document session ownership changed');
    const current = revision(state.revision);
    if (current < s.revision || typeof state.dirty !== 'boolean') fail('PROTOCOL_ERROR', 'Invalid live document state');
    s.revision = current; s.dirty = state.dirty;
  }
  async function sessionOperation(input, fn) {
    object(input, 'request'); const s = find(input.sessionId);
    return enqueue(s, input, async () => {
      abort(input.signal); await sync(s, input); check(s, input.expectedRevision);
      return fn(s);
    });
  }
  async function requireAuthorization(s, input) {
    // Full engine command catalogs contain socket, printer, credential and path effects. The host owns classification.
    if (typeof host.authorizeEffect !== 'function') fail('AUTHORIZATION_REQUIRED', 'Host authorizeEffect is required for engine commands');
    const allowed = await input[LIFE].wait(() => host.authorizeEffect({kind: 'engine-command', app: s.app, sessionId: s.id, command: input.command, params: JSON.parse(JSON.stringify(input.params ?? {})), ...options(input)}));
    if (allowed !== true) fail('ACCESS_DENIED', 'Host denied this engine command');
  }
  const api = {
    tools: officeToolDescriptors,
    async capabilities(input) {
      const {sessionId} = input;
      active();
      if (!sessionId) return {apps: APPS.map(app => ({app, nativeConfigured: Boolean(binaries[app]), browserConfigured: Boolean(transports[app])})), assetBaseUrl, namespace: 'office', nodeMinimum: 22};
      const s = find(sessionId);
      return enqueue(s, input, async () => { await sync(s, input); return {...view(s), capabilities: await transportCall(s, input, 'office.capabilities')}; });
    },
    async open(input = {}) {
      active(); object(input, 'open');
      if (!APPS.includes(input.app)) fail('INVALID_ARGUMENT', 'Unknown office app');
      if (input.path !== undefined && input.bytes !== undefined) fail('INVALID_ARGUMENT', 'Use either path or bytes');
      const work = (async () => {
        let transport, owned = false;
        try {
          abort(input.signal);
          const configured = input.transport ?? transports[input.app];
          const creating = Promise.resolve().then(() => {
            input[LIFE].check();
            input[LIFE].markEffect();
            return configured ? (typeof configured === 'function' ? configured({app: input.app, signal: input.signal, timeoutMs: input[LIFE].remaining()}) : configured)
              : createNativeSessionTransport({app: input.app, binary: binaries[input.app], ...options(input)});
          });
          creating.then(late => {
            if (input.signal.aborted && late && (typeof late === 'object' || typeof late === 'function') && !claimed.has(late)) {
              claimed.add(late); Promise.resolve().then(() => late.close()).catch(() => {});
            }
          }, () => {});
          transport = await input[LIFE].wait(creating);
          if (!transport || typeof transport.request !== 'function' || typeof transport.close !== 'function') fail('INVALID_ARGUMENT', 'Transport requires request and close methods');
          if (claimed.has(transport)) fail('SESSION_OWNERSHIP', 'A transport may own only one office session');
          claimed.add(transport);
          owned = true;
          const native = transport.kind === 'native-office';
          const provisional = {transport, dirty: true};
          if (!native) {
            if (transport.ready) await input[LIFE].wait(transport.ready);
            const caps = await transportCall(provisional, input, 'office.capabilities');
            if (!caps?.confirmedOpen || !caps?.revisions) fail('UNSUPPORTED', 'Live engine does not support confirmed opening and authoritative revisions');
          }
          let data = input.bytes === undefined ? undefined : bytes(input.bytes);
          if (input.path !== undefined) {
            if (typeof input.path !== 'string' || typeof host.readFile !== 'function') fail('INVALID_ARGUMENT', 'Opening a path requires host.readFile');
            data = bytes(await input[LIFE].wait(() => host.readFile({path: input.path, ...options(input)})));
          }
          const name = input.name ?? (input.path ? basename(input.path) : `Untitled.${FORMATS[input.app]}`);
          if (typeof name !== 'string' || !name || name.length > 1024) fail('INVALID_ARGUMENT', 'Invalid document name');
          if (!native && data === undefined) fail('UNSUPPORTED', 'Live open requires document bytes; create through the editor before attachment');
          const result = await transportCall(provisional, input, 'office.open', {name, ...(data === undefined ? {} : {bytes: native ? data : data.buffer})});
          if (result?.confirmed !== true) fail('UNSUPPORTED', 'Engine did not confirm document opening');
          const s = {id: randomUUID(), app: input.app, name, path: input.path, transport, native, remoteId: result.sessionId,
            revision: native ? 0 : revision(result.revision), dirty: data === undefined, savedRevision: 0,
            tail: Promise.resolve(), saveTail: Promise.resolve(), closed: false, closing: false};
          if (!native) await sync(s, input);
          input[LIFE].check();
          if (disposed) fail('DISPOSED', 'Integration disposed during document opening');
          sessions.set(s.id, s); return view(s);
        } catch (error) { if (owned) Promise.resolve().then(() => transport.close()).catch(() => {}); throw error; }
      })();
      opening.add(work); try { return await work; } finally { opening.delete(work); }
    },
    async commands(input) {
      const limit = input?.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('INVALID_ARGUMENT', 'Command limit must be 1 to 200');
      return sessionOperation(input, async s => {
        const result = await transportCall(s, input, 'office.commands', input.query ? {query: input.query} : {});
        const commands = Array.isArray(result) ? result : result?.commands;
        if (!Array.isArray(commands)) fail('PROTOCOL_ERROR', 'Engine returned an invalid command catalog');
        await sync(s, input);
        return {...view(s), commands: commands.slice(0, limit), total: commands.length, truncated: commands.length > limit};
      });
    },
    async execute(input) {
      if (typeof input?.command !== 'string' || !input.command || input.command.length > 256) fail('INVALID_ARGUMENT', 'A bounded command id is required');
      if (input.params !== undefined) object(input.params, 'params');
      // Bind the authorization decision to the exact command sent, even if the caller later mutates its object.
      try { input = {...input, params: input.params === undefined ? {} : JSON.parse(JSON.stringify(input.params))}; }
      catch { fail('INVALID_ARGUMENT', 'Command parameters must be JSON serializable'); }
      return sessionOperation(input, async s => {
        await requireAuthorization(s, input); abort(input.signal);
        let result;
        try {
          result = await transportCall(s, input, 'office.execute', {command: input.command, params: input.params ?? {}, ...(s.native ? {} : {expectedRevision: s.revision})});
        } catch (error) {
          // Engines do not promise rollback of failed commands. Invalidate old native revisions conservatively.
          if (s.native && !['HOST_OPERATION_REQUIRED', 'UNSUPPORTED', 'INVALID_ARGUMENT'].includes(error.code)) { s.revision++; s.dirty = true; }
          throw error;
        }
        if (s.native) { s.revision++; s.dirty = true; }
        else await sync(s, input);
        return {...view(s), result};
      });
    },
    async inspect(input) {
      return sessionOperation(input, async s => {
        const result = await transportCall(s, input, 'office.inspect');
        await sync(s, input); return {...view(s), result};
      });
    },
    async render(input) {
      return sessionOperation(input, async s => {
        const params = Object.fromEntries(['page', 'slide', 'scale', 'max_side'].filter(k => input[k] !== undefined).map(k => [k, input[k]]));
        const result = await transportCall(s, input, 'office.render', params);
        await sync(s, input); return {...view(s), result};
      });
    },
    async export(input) {
      return sessionOperation(input, async s => {
        const result = await transportCall(s, input, 'office.export', {format: input.format ?? FORMATS[s.app], ...(s.native ? {} : {expectedRevision: s.revision})});
        if (!s.native) { await sync(s, input); revision(result?.revision); }
        return {...view(s), bytes: bytes(result?.bytes), format: result.format ?? input.format ?? FORMATS[s.app],
          ...(typeof result.mimeType === 'string' ? {mimeType: result.mimeType} : {}), revision: s.native ? s.revision : result.revision};
      });
    },
    async save(input) {
      object(input, 'save'); const s = find(input.sessionId);
      const job = s.saveTail.then(async () => {
        input[LIFE].check();
        if (!s.native) return enqueue(s, input, async () => {
          const session = s;
          abort(input.signal); await sync(session, input); check(session, input.expectedRevision);
          const caps = await transportCall(session, input, 'office.capabilities');
          if (!caps?.durableSave) fail('UNSUPPORTED', 'Live engine has no durable-save acknowledgement');
          const result = await transportCall(session, input, 'office.save', {expectedRevision: session.revision, saveAs: Boolean(input.saveAs)});
          await sync(session, input); return {...view(session), result};
        });
        if (typeof host.writeFileAtomic !== 'function') fail('INVALID_ARGUMENT', 'Saving requires host.writeFileAtomic');
        const snapshot = await enqueue(s, input, async () => {
          abort(input.signal); check(s, input.expectedRevision);
          const result = await transportCall(s, input, 'office.export', {format: FORMATS[s.app]});
          return {bytes: bytes(result?.bytes), revision: s.revision};
        });
        abort(input.signal);
        const path = input.path ?? s.path, name = input.name ?? s.name;
        let acknowledgement;
        const life = input[LIFE];
        life.markEffect();
        const remove = life.onAbort(() => { s.dirty = true; });
        try {
          // Retain the actual writer in saveTail, even after its caller times out. Otherwise
          // an uncooperative old writer could overwrite a newer save out of order.
          acknowledgement = await host.writeFileAtomic({sessionId: s.id, app: s.app, path, name, bytes: snapshot.bytes,
            revision: snapshot.revision, saveAs: Boolean(input.saveAs || input.path), ...options(input)});
          life.check();
        } catch (error) {
          life.check();
          throw new OfficeError('SAVE_FAILED', 'Host save failed; the document remains unsaved');
        } finally { remove(); }
        s.savedRevision = snapshot.revision;
        s.dirty = s.revision !== s.savedRevision;
        s.path = acknowledgement?.path ?? path; s.name = name;
        return {...view(s), savedRevision: snapshot.revision, acknowledgement};
      });
      s.saveTail = job.catch(() => {}); return input[LIFE].wait(job);
    },
    async close(input) {
      object(input, 'close'); const s = find(input.sessionId), life = input[LIFE]; s.closing = life;
      const clearClosing = () => { if (s.closing === life) s.closing = false; };
      const removeClosing = life.onAbort(clearClosing);
      try {
        await life.wait(s.saveTail);
        return await enqueue(s, input, async () => {
          await sync(s, input); check(s, input.expectedRevision);
          if (s.dirty && input.discardChanges !== true) fail('UNSAVED_CHANGES', 'Save this document or explicitly discard its changes');
          await transportCall(s, input, 'office.close', {discardChanges: Boolean(input.discardChanges), ...(s.native ? {} : {expectedRevision: s.revision})});
          const remove = life.onAbort(error => { s.invalidated = error; s.dirty = true; });
          try { await life.wait(() => s.transport.close()); }
          finally { remove(); }
          life.check(); s.closed = true; sessions.delete(s.id); return {sessionId: s.id, closed: true};
        });
      } finally { removeClosing(); clearClosing(); }
    },
    async dispose(input) {
      if (disposed) return;
      disposed = true;
      for (const life of operations) if (life !== input[LIFE]) life.cancel(new OfficeError('DISPOSED', 'Office integration disposed', {outcomeUnknown: true}));
      // Never wait for an uncooperative host callback before tearing down workers.
      const results = await Promise.allSettled([...sessions.values()].map(async s => {
        s.closing = true;
        await input[LIFE].wait(() => { input[LIFE].markEffect(); return s.transport.close(); });
        input[LIFE].check(); s.closed = true;
      }));
      sessions.clear();
      const failedCount = results.filter(result => result.status === 'rejected').length;
      if (failedCount) fail('DISPOSE_FAILED', 'Some transport resources could not be closed', {failedCount});
    },
    async callTool(name, input = {}, requestOptions = {}) {
      const definition = officeToolDescriptors.find(t => t.name === name);
      if (!definition) fail('UNKNOWN_TOOL', 'Unknown office tool');
      object(input, 'tool arguments');
      object(requestOptions, 'request options');
      if (Object.keys(requestOptions).some(key => !['signal', 'timeoutMs'].includes(key))) fail('INVALID_ARGUMENT', 'Unknown request option');
      if (Object.keys(input).some(k => !Object.hasOwn(definition.inputSchema.properties, k))) fail('INVALID_ARGUMENT', 'Unknown tool argument');
      const result = await publicApi[name.slice(7)]({...input, ...requestOptions});
      if (result?.bytes instanceof Uint8Array) { const {bytes: output, ...other} = result; return {...other, bytesBase64: Buffer.from(output).toString('base64')}; }
      return result;
    },
  };
  const publicApi = {tools: api.tools, callTool: api.callTool};
  for (const method of Object.keys(api).filter(name => name !== 'tools' && name !== 'callTool')) {
    publicApi[method] = (input = {}) => {
      try {
        if (method === 'dispose' && disposal) return disposal;
        object(input, 'request');
        const life = createLifetime(input), admitted = {...input, signal: life.signal, [LIFE]: life};
        operations.add(life);
        const result = life.run(() => api[method](admitted)).finally(() => operations.delete(life));
        if (method === 'dispose') disposal = result;
        return result;
      } catch (error) { return Promise.reject(error); }
    };
  }
  return Object.freeze(publicApi);
}
