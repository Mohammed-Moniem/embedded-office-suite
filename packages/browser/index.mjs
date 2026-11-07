const APPS = Object.freeze(['wordcraft', 'pdfcraft', 'deckcraft', 'gridcraft']);
const DEFAULTS = Object.freeze({ timeoutMs: 15000, readyTimeoutMs: 30000, negotiationMs: 100,
  maxDocumentBytes: 32 * 1024 * 1024, maxMessageBytes: 34 * 1024 * 1024,
  maxPendingRequests: 32, maxQueuedSaves: 8, maxSaveIds: 10000 });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const revisionValue = value => Number.isSafeInteger(value) && value >= 0;
const normalize = method => typeof method === 'string' && method.startsWith('office.') ? method : `office.${method}`;

export class OfficeBrowserError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'OfficeBrowserError'; this.code = code; }
}
const failure = (code, message) => new OfficeBrowserError(code, message);

function boundedInteger(value, fallback, name, minimum = 1) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > 1024 * 1024 * 1024) {
    throw failure('INVALID_ARGUMENT', `${name} must be a bounded integer`);
  }
  return result;
}

function measure(value, maximum) {
  let bytes = 0;
  let entries = 0;
  const seen = new Set();
  function visit(part, depth) {
    if (++entries > 100000 || depth > 32) throw failure('MESSAGE_TOO_LARGE', 'Message structure exceeds the limit');
    if (part === null || part === undefined || typeof part === 'boolean' || typeof part === 'number') bytes += 8;
    else if (typeof part === 'string') bytes += part.length * 2;
    else if (part instanceof ArrayBuffer || ArrayBuffer.isView(part)) bytes += part.byteLength;
    else if (typeof Blob !== 'undefined' && part instanceof Blob) bytes += part.size;
    else if (typeof part === 'object') {
      if (seen.has(part)) throw failure('INVALID_MESSAGE', 'Cyclic messages are unsupported');
      seen.add(part);
      for (const key of Object.keys(part)) { bytes += key.length * 2; visit(part[key], depth + 1); }
      seen.delete(part);
    } else throw failure('INVALID_MESSAGE', 'Unsupported message value');
    if (bytes > maximum) throw failure('MESSAGE_TOO_LARGE', 'Message exceeds the byte limit');
  }
  visit(value, 0);
}

function cleanName(name, app) {
  const fallback = { wordcraft: 'Document.docx', pdfcraft: 'Document.pdf', deckcraft: 'Presentation.pptx', gridcraft: 'Workbook.xlsx' }[app];
  if (typeof name !== 'string') return fallback;
  const safe = [...name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim()].slice(0, 255).join('');
  return !safe || safe === '.' || safe === '..' ? fallback : safe;
}

function copyBytes(bytes, maximum) {
  let source;
  if (bytes instanceof ArrayBuffer) source = new Uint8Array(bytes);
  else if (ArrayBuffer.isView(bytes) && bytes.buffer instanceof ArrayBuffer) source = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  else throw failure('INVALID_ARGUMENT', 'bytes must be an ArrayBuffer or a typed array');
  if (source.byteLength > maximum) throw failure('DOCUMENT_TOO_LARGE', 'Document exceeds the configured byte limit');
  return new Uint8Array(source).buffer;
}

function originFor(origin, hostWindow) {
  const expected = hostWindow.location?.origin;
  let resolved;
  try { resolved = new URL(origin ?? expected).origin; } catch { throw failure('INVALID_ORIGIN', 'An explicit HTTP(S) host origin is required'); }
  if (!/^https?:\/\//.test(resolved) || resolved === 'null' || expected !== resolved) {
    throw failure('INVALID_ORIGIN', 'Editor and host must share an HTTP(S) origin');
  }
  return resolved;
}

/** Bind one trusted same-origin engine frame. No filesystem or GUI shell is created. */
export function createPageTransport(options) {
  if (!record(options) || !APPS.includes(options.app)) throw failure('INVALID_ARGUMENT', 'Unknown office app');
  const { app, targetWindow, host = {} } = options;
  if (!record(host)) throw failure('INVALID_ARGUMENT', 'host must be an object');
  const hostWindow = options.hostWindow ?? globalThis.window;
  if (!hostWindow?.addEventListener || !hostWindow?.removeEventListener || !targetWindow?.postMessage || targetWindow === hostWindow) {
    throw failure('INVALID_ARGUMENT', 'A host window and a separate editor window are required');
  }
  const origin = originFor(options.origin, hostWindow);
  const limits = Object.fromEntries(Object.entries(DEFAULTS).map(([name, fallback]) => [name, boundedInteger(options[name], fallback, name, name === 'negotiationMs' ? 0 : 1)]));
  const sessionId = options.sessionId ?? globalThis.crypto?.randomUUID?.();
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) throw failure('INVALID_ARGUMENT', 'A valid random sessionId is required');
  const pending = new Map();
  const seenSaves = new Set();
  const activeWrites = new Set();
  const cancelledRequests = new Map();
  const tombstoneLimit = Math.max(32, Math.min(1024, limits.maxPendingRequests * 2));
  let sequence = 0;
  let closed = false;
  let legacyReady = false;
  let extensionReady = false;
  let settledReady = false;
  let dirty = false;
  let engineDirty = false;
  let revision = null;
  let lastStateRevision = null;
  let unsafeLegacySave = false;
  let pendingDurability = false;
  let lastSaveRevision = -1;
  let fileSupport = false;
  let methods = new Set();
  let revisions = false;
  let durableSave = false;
  let queuedSaves = 0;
  let saveQueue = Promise.resolve();
  let negotiationTimer;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Hosts may wait until after mount to attach their rejection handler.
  ready.catch(() => {});

  const capabilities = () => ({ app, sessionId, protocol: 'office-page-v1', bridgeVersion: legacyReady ? '1' : null,
    ready: settledReady && !closed, pageCommands: extensionReady && methods.size > 0,
    confirmedOpen: methods.has('office.open') && revisions, revisions, durableSave: durableSave && typeof host.writeFileAtomic === 'function',
    legacyPostOpen: legacyReady, fileSupport, methods: [...methods], maxDocumentBytes: limits.maxDocumentBytes });
  const state = () => ({ app, sessionId, revision, dirty, engineDirty, closed, durability: durableSave && typeof host.writeFileAtomic === 'function' ? 'acknowledged' : 'unverified' });
  function report(error) { try { host.onError?.(error); } catch { /* Host observers cannot break transport cleanup. */ } }
  function notifyDirty() { try { host.onDirty?.({ ...state() }); } catch (error) { report(failure('HOST_CALLBACK_FAILED', 'onDirty callback failed')); } }
  function setDirty(value) { const next = value || unsafeLegacySave || pendingDurability; if (next !== dirty) { dirty = next; notifyDirty(); } }
  function envelope(kind, fields = {}) { return { type: `${app}:office`, protocol: 'office', version: 1, sessionId, kind, ...fields }; }
  function send(data, transfer = []) {
    if (closed) throw failure('DISPOSED', 'Editor transport is disposed');
    measure(data, limits.maxMessageBytes);
    try { targetWindow.postMessage(data, origin, transfer); }
    catch { throw failure('SEND_FAILED', 'Could not send a message to the editor'); }
  }
  function finishReady() {
    if (settledReady || closed) return;
    settledReady = true;
    clearTimeout(readyTimer);
    clearTimeout(negotiationTimer);
    resolveReady(capabilities());
  }
  function release(id, error, result) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (error) {
      entry.reject(error);
      if (entry.method === 'office.save') {
        cancelledRequests.set(id, error);
        while (cancelledRequests.size > tombstoneLimit) cancelledRequests.delete(cancelledRequests.keys().next().value);
        for (const operation of entry.saveOperations ?? []) cancelSave(operation, error);
      }
    } else entry.resolve(result);
  }
  function dispose(reason = failure('DISPOSED', 'Editor transport is disposed')) {
    if (closed) return;
    closed = true;
    clearTimeout(readyTimer);
    clearTimeout(negotiationTimer);
    hostWindow.removeEventListener('message', onMessage);
    if (!settledReady) rejectReady(reason);
    for (const id of [...pending.keys()]) release(id, reason);
    for (const controller of activeWrites) controller.abort();
  }
  const readyTimer = setTimeout(() => { const error = failure('READY_TIMEOUT', 'Editor did not become ready'); report(error); dispose(error); }, limits.readyTimeoutMs);

  function parseReady(data) {
    if (extensionReady) throw failure('DUPLICATE_MESSAGE', 'Duplicate engine capability declaration');
    if (!legacyReady || !record(data.capabilities) || !Array.isArray(data.capabilities.methods)
      || data.capabilities.methods.length > 128 || !data.capabilities.methods.every(method => typeof method === 'string' && /^office\.[a-zA-Z][a-zA-Z0-9_.-]{0,80}$/.test(method))
      || new Set(data.capabilities.methods).size !== data.capabilities.methods.length
      || typeof data.capabilities.revisions !== 'boolean' || typeof data.capabilities.durableSave !== 'boolean'
      || !revisionValue(data.revision)) throw failure('INVALID_MESSAGE', 'Invalid engine capability declaration');
    if (data.capabilities.durableSave && (!data.capabilities.revisions || !data.capabilities.methods.includes('office.save'))) {
      throw failure('INVALID_MESSAGE', 'Durable saves require revisions and an implemented save method');
    }
    methods = new Set(data.capabilities.methods);
    revisions = data.capabilities.revisions;
    durableSave = data.capabilities.durableSave;
    revision = revisions ? data.revision : null;
    extensionReady = true;
    finishReady();
  }

  function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(id); }
  function failSave(operation, error) {
    if (closed || operation.failureSent || operation.acknowledged) return;
    operation.failureSent = true;
    if (operation.extended) {
      try { send(envelope('save-failed', { id: operation.id, revision: operation.revision,
        error: { code: error.code, message: error.message } })); } catch (sendError) { report(sendError); }
    }
  }
  function cancelSave(operation, error) {
    if (operation.acknowledged || operation.cancelled) return;
    operation.cancelled = true;
    operation.error = error;
    operation.controller.abort();
    operation.bytes = null;
    pendingDurability = true;
    setDirty(true);
    failSave(operation, error);
  }
  function acceptSave(data, extended) {
    if (extended && (!durableSave || !revisionValue(data.revision) || revision === null || data.revision > revision || !validId(data.id))) {
      throw failure('INVALID_MESSAGE', 'Unnegotiated or invalid revisioned save');
    }
    if (data.id !== undefined && !validId(data.id)) throw failure('INVALID_MESSAGE', 'Invalid save ID');
    if (typeof data.name !== 'string' || (own(data, 'saveAs') && typeof data.saveAs !== 'boolean')) throw failure('INVALID_MESSAGE', 'Invalid save metadata');
    const id = data.id;
    const saveKey = `${extended ? 'office' : 'legacy'}:${id}`;
    if (id !== undefined && seenSaves.has(saveKey)) throw failure('DUPLICATE_MESSAGE', 'Duplicate save ID');
    const requestId = extended ? data.requestId : undefined;
    let linkedRequest;
    if (requestId !== undefined) {
      if (!validId(requestId)) throw failure('INVALID_MESSAGE', 'Invalid linked save request ID');
      const cancelled = cancelledRequests.get(requestId);
      if (cancelled) throw cancelled;
      linkedRequest = pending.get(requestId);
      if (!linkedRequest || linkedRequest.method !== 'office.save') throw failure('INVALID_MESSAGE', 'Save references an unknown or settled request');
    }
    const bytes = copyBytes(data.bytes, limits.maxDocumentBytes);
    if (extended && data.revision < lastSaveRevision) throw failure('STALE_REVISION', 'An older save cannot replace a newer accepted snapshot');
    if (seenSaves.size >= limits.maxSaveIds) throw failure('SAVE_LIMIT', 'Save ID capacity reached; reopen the editor');
    if (queuedSaves >= limits.maxQueuedSaves) throw failure('SAVE_LIMIT', 'Too many queued saves');
    if (id !== undefined) seenSaves.add(saveKey);
    queuedSaves++;
    if (!extended) unsafeLegacySave = true;
    else { pendingDurability = true; lastSaveRevision = data.revision; }
    const controller = new AbortController();
    activeWrites.add(controller);
    const snapshotRevision = extended ? data.revision : null;
    const name = cleanName(data.name, app);
    const operation = { id, extended, requestId, linkedRequest, revision: snapshotRevision, name, saveAs: data.saveAs === true,
      bytes: new Uint8Array(bytes), controller, cancelled: false, failureSent: false, acknowledged: false };
    if (linkedRequest) (linkedRequest.saveOperations ??= new Set()).add(operation);
    // Observers may synchronously abort the request or dispose its tab. Register the writer
    // before notifying them so that lifecycle cleanup already owns this operation.
    setDirty(true);
    const perform = async () => {
      try {
        if (operation.cancelled) return;
        if (requestId !== undefined && pending.get(requestId) !== linkedRequest) {
          cancelSave(operation, cancelledRequests.get(requestId) ?? failure('ABORTED', 'Linked save request has settled'));
          return;
        }
        if (closed || controller.signal.aborted) throw failure('DISPOSED', 'Editor transport is disposed');
        if (typeof host.writeFileAtomic !== 'function') throw failure('HOST_SAVE_UNAVAILABLE', 'Host has no atomic file writer');
        await host.writeFileAtomic({ sessionId, name, bytes: operation.bytes, saveAs: operation.saveAs,
          revision: snapshotRevision, signal: controller.signal });
        if (closed || operation.cancelled || controller.signal.aborted) return;
        if (extended) {
          if (revision === snapshotRevision) {
            unsafeLegacySave = false; pendingDurability = false;
            // Persistence acknowledges bytes; only the engine knows whether this was a save
            // of its source or an exported copy. Preserve its dirty state until it settles.
            setDirty(engineDirty);
          }
          // onDirty is synchronous host code: it may cancel, expire or dispose this request,
          // or deliver a response reentrantly. Only the still-owned operation may commit an
          // acknowledgement after that callback; failure and success are mutually exclusive.
          if (closed || operation.cancelled || operation.failureSent || controller.signal.aborted) return;
          if (requestId !== undefined && pending.get(requestId) !== linkedRequest) {
            cancelSave(operation, cancelledRequests.get(requestId) ?? failure('ABORTED', 'Linked save request has settled'));
            return;
          }
          operation.acknowledged = true;
          if (linkedRequest) linkedRequest.saveAcknowledged = true;
          send(envelope('saved', { id, revision: snapshotRevision }));
        } else if (id !== undefined) send({ type: `${app}:saved`, id });
      } catch (error) {
        if (closed || operation.cancelled) return;
        setDirty(true);
        const saveError = error instanceof OfficeBrowserError ? error : failure('SAVE_FAILED', 'Host could not store the document');
        report(saveError);
        failSave(operation, saveError);
        if (requestId !== undefined) release(requestId, saveError);
      } finally {
        queuedSaves--; activeWrites.delete(controller); operation.bytes = null;
        linkedRequest?.saveOperations?.delete(operation);
      }
    };
    saveQueue = saveQueue.then(perform, perform);
  }

  function handleOffice(data) {
    if (data.protocol !== 'office' || data.version !== 1 || data.sessionId !== sessionId) return;
    if (data.kind === 'ready') { parseReady(data); return; }
    if (!extensionReady) throw failure('INVALID_MESSAGE', 'Engine extension is not negotiated');
    if (data.kind === 'revision') {
      if (!revisions || !revisionValue(data.revision) || data.revision < revision || typeof data.dirty !== 'boolean') throw failure('INVALID_MESSAGE', 'Invalid document revision');
      revision = data.revision; lastStateRevision = revision; engineDirty = data.dirty; setDirty(engineDirty); return;
    }
    if (data.kind === 'save') {
      try { acceptSave(data, true); }
      catch (error) {
        if (error.code !== 'DUPLICATE_MESSAGE' && validId(data.id)) {
          pendingDurability = true; setDirty(true);
          send(envelope('save-failed', { id: data.id, revision: data.revision, error: { code: error.code, message: error.message } }));
          const entry = pending.get(data.requestId);
          if (entry?.method === 'office.save') release(data.requestId, error);
        }
        throw error;
      }
      return;
    }
    if (data.kind === 'response') {
      if (!validId(data.id)) throw failure('INVALID_MESSAGE', 'Invalid request ID');
      const entry = pending.get(data.id);
      if (!entry) return; // Late, cancelled, and duplicate replies have no authority.
      if (typeof data.ok !== 'boolean' || (revisions && (!revisionValue(data.revision) || data.revision < revision))) {
        release(data.id, failure('INVALID_MESSAGE', 'Invalid response envelope')); return;
      }
      if (revisions) {
        // A reply may overtake its dirty notification. Advancing the revision cannot carry
        // forward an older revision's cleanliness, even when an engine reports success.
        if (data.revision > revision && lastStateRevision !== data.revision) { engineDirty = true; setDirty(true); }
        revision = data.revision;
      }
      if (!data.ok) {
        const code = record(data.error) && typeof data.error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(data.error.code) ? data.error.code : 'ENGINE_ERROR';
        release(data.id, failure(code, 'Editor command failed')); return;
      }
      if (entry.method === 'office.save' && !entry.saveAcknowledged) {
        release(data.id, failure('UNCONFIRMED_SAVE', 'Editor reported save success before a durable acknowledgement')); return;
      }
      release(data.id, null, data.result);
    }
  }

  function onMessage(event) {
    if (closed || event.source !== targetWindow || event.origin !== origin || !record(event.data)) return;
    const data = event.data;
    if (typeof data.type !== 'string' || !data.type.startsWith(`${app}:`)) return;
    try {
      measure(data, limits.maxMessageBytes);
      switch (data.type) {
        case `${app}:ready`:
          if (legacyReady) throw failure('DUPLICATE_MESSAGE', 'Duplicate editor ready message');
          if (typeof data.version !== 'string' || data.version.length > 100 || (own(data, 'file') && typeof data.file !== 'boolean')) throw failure('INVALID_MESSAGE', 'Invalid editor ready message');
          legacyReady = true;
          fileSupport = data.file === true;
          send({ type: `${app}:host`, version: '1', handoff: false });
          send(envelope('hello'));
          if (!extensionReady) negotiationTimer = setTimeout(finishReady, limits.negotiationMs);
          break;
        case `${app}:office`: handleOffice(data); break;
        case `${app}:dirty`:
          if (!legacyReady || typeof data.dirty !== 'boolean') throw failure('INVALID_MESSAGE', 'Invalid dirty message');
          // Revisioned engines must report dirty with the authoritative revision.
          if (!revisions) { engineDirty = data.dirty; setDirty(engineDirty); }
          break;
        case `${app}:save`:
          if (!legacyReady) throw failure('INVALID_MESSAGE', 'Save before editor readiness');
          if (durableSave) throw failure('INVALID_MESSAGE', 'Revisioned engine sent an unrevisioned save');
          acceptSave(data, false); break;
        case `${app}:failed`: report(failure('ENGINE_ERROR', 'Editor could not open or save the document')); break;
        case `${app}:handoff`: report(failure('UNSUPPORTED', 'Cross-editor handoff is not configured')); break;
      }
    } catch (error) { report(error instanceof OfficeBrowserError ? error : failure('INVALID_MESSAGE', 'Malformed editor message')); }
  }
  hostWindow.addEventListener('message', onMessage);

  function request(method, params = {}, requestOptions = {}) {
    if (closed) return Promise.reject(failure('DISPOSED', 'Editor transport is disposed'));
    if (typeof method !== 'string') return Promise.reject(failure('INVALID_ARGUMENT', 'A method name is required'));
    const normalized = normalize(method);
    if (!/^office\.[a-zA-Z][a-zA-Z0-9_.-]{0,80}$/.test(normalized) || !record(params) || !record(requestOptions)) {
      return Promise.reject(failure('INVALID_ARGUMENT', 'A method name and object params are required'));
    }
    if (normalized === 'office.capabilities') return Promise.resolve(capabilities());
    if (normalized === 'office.state') return Promise.resolve(state());
    if (pending.size >= limits.maxPendingRequests) return Promise.reject(failure('REQUEST_LIMIT', 'Too many pending editor requests'));
    let timeoutMs;
    try {
      timeoutMs = boundedInteger(requestOptions.timeoutMs, limits.timeoutMs, 'timeoutMs');
      measure(params, limits.maxMessageBytes);
      if (normalized === 'office.open') params = { ...params, name: cleanName(params.name, app), bytes: copyBytes(params.bytes, limits.maxDocumentBytes) };
    }
    catch (error) { return Promise.reject(error); }
    const { signal } = requestOptions;
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean')) return Promise.reject(failure('INVALID_ARGUMENT', 'signal must be an AbortSignal'));
    if (signal?.aborted) return Promise.reject(failure('ABORTED', 'Editor request was cancelled'));
    if (!Number.isSafeInteger(sequence + 1)) return Promise.reject(failure('REQUEST_LIMIT', 'Request ID capacity reached; reopen the editor'));
    const id = `request-${++sequence}`;
    return new Promise((resolve, reject) => {
      const entry = { method: normalized, resolve, reject, signal, sent: false, saveAcknowledged: false };
      const cancel = code => {
        if (!pending.has(id)) return;
        release(id, failure(code, code === 'ABORTED' ? 'Editor request was cancelled; a dispatched edit may have committed' : 'Editor request timed out; a dispatched edit may have committed'));
        if (entry.sent) { try { send(envelope('cancel', { id })); } catch { /* Request still must settle. */ } }
      };
      entry.abort = () => cancel('ABORTED');
      entry.timer = setTimeout(() => cancel('TIMEOUT'), timeoutMs);
      pending.set(id, entry);
      signal?.addEventListener('abort', entry.abort, { once: true });
      ready.then(() => {
        if (!pending.has(id)) return;
        if (!methods.has(normalized)) { release(id, failure('UNSUPPORTED', `${normalized} is not implemented by this editor build`)); return; }
        if (normalized === 'office.save' && !durableSave) { release(id, failure('UNSUPPORTED', 'Editor has no durable-save acknowledgement protocol')); return; }
        if (normalized === 'office.save' && typeof host.writeFileAtomic !== 'function') { release(id, failure('HOST_SAVE_UNAVAILABLE', 'Host has no atomic file writer')); return; }
        if (own(params, 'expectedRevision') && (!revisionValue(params.expectedRevision) || revision === null || params.expectedRevision !== revision)) {
          release(id, failure('STALE_REVISION', 'Document revision does not match')); return;
        }
        try { entry.sent = true; send(envelope('request', { id, method: normalized, params })); }
        catch (error) { release(id, error); }
      }, error => release(id, error));
    });
  }

  async function open(input, requestOptions) {
    if (!record(input)) throw failure('INVALID_ARGUMENT', 'An open payload is required');
    requestOptions ??= {};
    if (!record(requestOptions)) throw failure('INVALID_ARGUMENT', 'Request options must be an object');
    if (requestOptions.signal && (typeof requestOptions.signal.addEventListener !== 'function' || typeof requestOptions.signal.removeEventListener !== 'function' || typeof requestOptions.signal.aborted !== 'boolean')) throw failure('INVALID_ARGUMENT', 'signal must be an AbortSignal');
    const bytes = copyBytes(input.bytes, limits.maxDocumentBytes);
    const timeoutMs = boundedInteger(requestOptions.timeoutMs, limits.timeoutMs, 'timeoutMs');
    const start = Date.now();
    await new Promise((resolve, reject) => {
      const { signal } = requestOptions;
      if (signal?.aborted) { reject(failure('ABORTED', 'Editor open was cancelled')); return; }
      const abort = () => finish(failure('ABORTED', 'Editor open was cancelled'));
      const timer = setTimeout(() => finish(failure('TIMEOUT', 'Editor open timed out waiting for readiness')), timeoutMs);
      function finish(error) { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(); }
      signal?.addEventListener('abort', abort, { once: true });
      ready.then(() => finish(), finish);
    });
    const name = cleanName(input.name, app);
    if (methods.has('office.open')) {
      const params = { name, bytes };
      if (own(input, 'expectedRevision')) params.expectedRevision = input.expectedRevision;
      const result = await request('office.open', params, { ...requestOptions, timeoutMs: Math.max(1, timeoutMs - (Date.now() - start)) });
      if (!record(result) || result.confirmed !== true || result.sessionId !== sessionId || result.app !== app || !revisionValue(result.revision) || result.revision !== revision) {
        throw failure('UNCONFIRMED_OPEN', 'Editor did not confirm opening this document session');
      }
      return result;
    }
    if (own(input, 'expectedRevision')) throw failure('STALE_REVISION', 'Legacy editor has no authoritative revision');
    if (requestOptions?.signal?.aborted) throw failure('ABORTED', 'Editor open was cancelled');
    send({ type: `${app}:open`, name, bytes }, [bytes]);
    return { sessionId, app, revision: null, confirmed: false, delivery: 'posted' };
  }

  return Object.freeze({ kind: 'browser', protocol: 'office-page-v1', app, sessionId, ready, capabilities, state, request, open,
    commands: (params, options) => request('office.commands', params, options),
    execute: (command, params = {}, options = {}) => request('office.execute', { command, params, ...(own(options, 'expectedRevision') ? { expectedRevision: options.expectedRevision } : {}) }, options),
    inspect: (params, options) => request('office.inspect', params, options),
    render: (params, options) => request('office.render', params, options),
    export: (params, options) => request('office.export', params, options),
    save: (params, options) => request('office.save', params, options),
    close: () => dispose(), dispose });
}

/** Mount engine-generated assets inside a caller-provided container. */
export function mountOfficeEditor(options) {
  if (!record(options) || !APPS.includes(options.app) || !options.container?.appendChild) throw failure('INVALID_ARGUMENT', 'A container and a valid app are required');
  const document = options.container.ownerDocument;
  const hostWindow = document?.defaultView;
  if (!hostWindow) throw failure('INVALID_ARGUMENT', 'Container must belong to a live browser document');
  const origin = originFor(undefined, hostWindow);
  let base;
  try { base = new URL(options.assetBaseUrl, document.baseURI); }
  catch { throw failure('INVALID_ARGUMENT', 'A valid assetBaseUrl is required'); }
  if (base.origin !== origin || !/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) throw failure('INVALID_ORIGIN', 'Assets must use a same-origin HTTP(S) base URL without credentials, query, or fragment');
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const source = new URL(`${options.app}/index.html?host=parent`, base).href;
  const frame = document.createElement('iframe');
  frame.title = `${options.app} document editor`;
  frame.setAttribute('data-office-app', options.app);
  frame.setAttribute('referrerpolicy', 'same-origin');
  frame.style.width = '100%'; frame.style.height = '100%'; frame.style.border = '0';
  frame.src = source;
  options.container.appendChild(frame);
  let transport;
  try { transport = createPageTransport({ ...options, hostWindow, targetWindow: frame.contentWindow, origin }); }
  catch (error) { frame.remove(); throw error; }
  let loaded = false;
  let removed = false;
  function onLoad() { if (loaded) transport.dispose(failure('EDITOR_NAVIGATED', 'Editor frame navigated; mount a new session')); loaded = true; }
  function onError() { transport.dispose(failure('LOAD_FAILED', 'Editor page failed to load')); }
  frame.addEventListener('load', onLoad);
  frame.addEventListener('error', onError);
  function dispose() {
    if (removed) return;
    removed = true; transport.dispose(); frame.removeEventListener('load', onLoad); frame.removeEventListener('error', onError); frame.remove();
  }
  return Object.freeze({ ...transport, frame, close: dispose, dispose });
}
