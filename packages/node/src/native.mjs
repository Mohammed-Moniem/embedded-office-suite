import { mkdtemp, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStdioTransport } from './stdio.mjs';
import { OfficeError, fail, bytes, abort } from './errors.mjs';
import {createLifetime} from './lifetime.mjs';

export const APPS = Object.freeze(['wordcraft', 'pdfcraft', 'deckcraft', 'gridcraft']);
export const FORMATS = Object.freeze({wordcraft: 'docx', pdfcraft: 'pdf', deckcraft: 'pptx', gridcraft: 'xlsx'});
// Verified against each app's pinned crates/mcp/src/tools.rs; PdfCraft uses crates/automation/src/tools.rs.
const mappings = Object.freeze({
  wordcraft: {open: 'open_document', create: 'new_document', createParams: {template: 'blank'}, commands: 'list_commands', query: 'query', execute: 'execute', inspect: 'inspect_document', render: 'render_page', save: 'save_document'},
  pdfcraft: {open: 'doc_open', create: 'doc_create', createParams: {from: 'blank'}, commands: 'command_list', query: 'filter', execute: 'command_run', inspect: 'doc_inspect', render: 'render_preview', save: 'doc_save'},
  deckcraft: {open: 'open_presentation', create: 'new_presentation', createParams: {}, commands: 'list_commands', query: 'filter', execute: 'run_command', inspect: 'inspect_document', render: 'render_slide', save: 'save_presentation'},
  gridcraft: {open: 'open_workbook', create: 'new_workbook', createParams: {}, commands: 'list_commands', query: 'search', execute: 'execute_command', inspect: 'inspect_workbook', render: null, save: 'save_workbook'},
});
const exportsByApp = Object.freeze({wordcraft: ['docx', 'pdf', 'odt', 'rtf', 'html', 'md', 'tex', 'txt'], pdfcraft: ['pdf'], deckcraft: ['pptx', 'deckcraft', 'pdf', 'png', 'jpeg', 'rtf', 'gif', 'outline'], gridcraft: ['xlsx', 'csv', 'tsv', 'json', 'html']});
function unpack(result, tool) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.content)) fail('PROTOCOL_ERROR', 'Invalid MCP tool result', {tool});
  if (result.isError) fail('ENGINE_ERROR', 'Engine tool failed', {tool});
  if (result.structuredContent !== undefined) return result.structuredContent;
  const parts = result.content;
  if (parts.length === 1 && parts[0]?.type === 'text' && typeof parts[0].text === 'string') {
    try { return JSON.parse(parts[0].text); } catch { return {text: parts[0].text}; }
  }
  return {content: parts};
}
/** Dedicated scratch-root worker. Never gives the worker the host's destination paths. */
export async function createNativeSessionTransport({app, binary, timeoutMs, signal, maxFileBytes = 512 * 1024 * 1024, scratchRoot = tmpdir()} = {}) {
  const mapping = mappings[app];
  if (!mapping) fail('INVALID_ARGUMENT', 'Unknown office app');
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1) fail('INVALID_ARGUMENT', 'Invalid worker file limit');
  const config = typeof binary === 'string' ? {command: binary} : binary;
  if (!config || typeof config.command !== 'string' || !isAbsolute(config.command)) fail('INVALID_ARGUMENT', 'Native binary command must be an absolute path');
  if (config.filesystemPolicy !== undefined && !['automation-roots', 'unconfined-host-reviewed'].includes(config.filesystemPolicy))
    fail('INVALID_ARGUMENT', 'Unknown native filesystem policy');
  if (app !== 'gridcraft' && config.filesystemPolicy === 'unconfined-host-reviewed')
    fail('INVALID_ARGUMENT', 'Root enforcement cannot be disabled for this engine');
  const unconfined = app === 'gridcraft' && config.filesystemPolicy !== 'automation-roots';
  if (unconfined && config.filesystemPolicy !== 'unconfined-host-reviewed' && config.allowUnconfinedWorker !== true)
    fail('UNSUPPORTED', 'Baseline GridCraft has no root flags; select a verified patched automation-roots worker or explicit unconfined policy');
  if (config.args && (!Array.isArray(config.args) || config.args.some(x => typeof x !== 'string'))) fail('INVALID_ARGUMENT', 'Binary arguments must be strings');
  if (config.args?.some(x => /^(--connect|--root|--automation-read-root|--automation-write-root)(=|$)/.test(x))) fail('INVALID_ARGUMENT', 'Worker roots and mode are owned by the adapter');
  const life = createLifetime({signal, timeoutMs: timeoutMs ?? config.timeoutMs ?? 30_000});
  return life.run(async () => {
  const allocating = mkdtemp(join(scratchRoot, 'embedded-office-'));
  allocating.then(path => { if (life.signal.aborted) rm(path, {recursive: true, force: true}).catch(() => {}); }, () => {});
  const scratch = await life.wait(allocating);
  let rpc;
  const remove = life.onAbort(() => { if (rpc) rpc.close().then(() => rm(scratch, {recursive: true, force: true})).catch(() => {}); });
  try {
    life.check();
    life.markEffect();
    const rootArgs = unconfined ? [] : ['--automation-read-root', scratch, '--automation-write-root', scratch];
    rpc = createStdioTransport({command: config.command, args: [...(config.args ?? []), 'mcp', ...rootArgs], cwd: scratch, env: config.env, timeoutMs: life.remaining()});
    await life.wait(rpc.ready);
    const listed = await life.wait(() => rpc.request('tools/list', {}, {signal: life.signal, timeoutMs: life.remaining()}));
    if (!Array.isArray(listed?.tools) || listed.tools.some(t => !t || typeof t.name !== 'string')) fail('PROTOCOL_ERROR', 'Invalid MCP tool discovery');
    const tools = new Set(listed.tools.map(t => t.name));
    let opened = false, doc;
    async function call(name, params = {}, options) {
      if (!tools.has(name)) fail('UNSUPPORTED', 'Pinned engine does not advertise the required tool', {tool: name});
      return unpack(await rpc.request('tools/call', {name, arguments: params}, options), name);
    }
    const target = params => app === 'pdfcraft' && doc !== undefined ? {...params, doc} : params;
    const transport = {
      kind: 'native-office', app,
      async request(method, params = {}, options = {}) {
        abort(options.signal);
        if (rpc.closed && method !== 'office.close') fail('TRANSPORT_CLOSED', 'The native worker is closed');
        if (!opened && !['office.capabilities', 'office.open', 'office.close'].includes(method)) fail('SESSION_NOT_FOUND', 'No native document is open');
        switch (method) {
          case 'office.capabilities': return {kind: 'native', dedicated: true, commands: tools.has(mapping.execute), render: Boolean(mapping.render && tools.has(mapping.render)), exportFormats: tools.has(mapping.save) ? [...exportsByApp[app]] : [], filesystemPolicy: unconfined ? 'unconfined-host-reviewed' : 'scratch-root-checks-not-os-sandbox'};
          case 'office.open': {
            if (opened) fail('SESSION_OWNERSHIP', 'Native transport already owns a document');
            let result;
            if (params.bytes !== undefined) {
              const data = bytes(params.bytes);
              if (data.length > maxFileBytes) fail('FILE_TOO_LARGE', 'Input exceeds worker file limit');
              const extension = extname(params.name ?? `document.${FORMATS[app]}`).slice(1).toLowerCase();
              if (!/^[a-z0-9]{1,12}$/.test(extension)) fail('INVALID_ARGUMENT', 'Document needs a valid extension');
              const path = join(scratch, `input.${extension}`);
              await writeFile(path, data, {mode: 0o600, signal: options.signal});
              abort(options.signal);
              result = await call(mapping.open, {path}, options);
            } else result = await call(mapping.create, mapping.createParams, options);
            if (app === 'pdfcraft') { doc = result?.doc; if (!Number.isSafeInteger(doc)) fail('PROTOCOL_ERROR', 'PDF open did not return a document id'); }
            opened = true;
            return {result, confirmed: true};
          }
          case 'office.commands': return call(mapping.commands, target(params.query ? {[mapping.query]: params.query} : {}), options);
          case 'office.execute': {
            // File/session lifecycle commands would replace the authoritative document or bypass host saves.
            if (/^(file\.(?:open|new|save|export|close|rename)|view\.(?:switchWindows|newWindow))/.test(params.command)) fail('HOST_OPERATION_REQUIRED', 'Use the facade file/session methods for this command');
            const a = app === 'pdfcraft' ? {id: params.command, params: target(params.params ?? {})} : {command: params.command, params: params.params ?? {}};
            return call(mapping.execute, a, options);
          }
          case 'office.inspect': return call(mapping.inspect, target({}), options);
          case 'office.render':
            if (!mapping.render) fail('UNSUPPORTED', 'GridCraft MCP has no headless rendering tool');
            return call(mapping.render, target(params), options);
          case 'office.export': {
            const format = params.format ?? FORMATS[app];
            if (!exportsByApp[app].includes(format)) fail('UNSUPPORTED', 'Unsupported or unqualified export format', {format});
            const extension = format === 'outline' ? 'txt' : format;
            const path = join(scratch, `snapshot-${randomUUID()}.${extension}`);
            const name = app === 'deckcraft' && format !== 'pptx' && format !== 'deckcraft' ? 'export' : mapping.save;
            const args = target(app === 'deckcraft' && name === 'export' ? {path, format} : {path});
            try {
              await call(name, args, options);
              const info = await lstat(path);
              if (!info.isFile() || info.isSymbolicLink()) fail('PROTOCOL_ERROR', 'Engine output must be a regular file');
              if (info.size > maxFileBytes) fail('FILE_TOO_LARGE', 'Engine output exceeds worker file limit');
              const output = await readFile(path, {signal: options.signal});
              abort(options.signal);
              if (output.length > maxFileBytes) fail('FILE_TOO_LARGE', 'Engine output exceeds worker file limit');
              return {bytes: new Uint8Array(output), format};
            } finally { await rm(path, {force: true}).catch(() => {}); }
          }
          case 'office.close': await rpc.close(); return {closed: true};
          default: fail('UNSUPPORTED', 'Unknown normalized transport method');
        }
      },
      async close() { await rpc.close(); await rm(scratch, {recursive: true, force: true}); },
    };
    const request = transport.request;
    transport.request = async (method, params = {}, requestOptions = {}) => {
      const requestLife = createLifetime({timeoutMs: config.timeoutMs ?? 30_000, ...requestOptions});
      return requestLife.run(async () => {
        const remove = requestLife.onAbort(() => { transport.close().catch(() => {}); });
        try {
          const stageOptions = {signal: requestLife.signal, get timeoutMs() { return requestLife.remaining(); }};
          if (['office.open', 'office.execute', 'office.save', 'office.export', 'office.close'].includes(method)) requestLife.markEffect();
          return await requestLife.wait(() => request(method, params, stageOptions));
        } finally { remove(); }
      });
    };
    return Object.freeze(transport);
  } catch (error) {
    await rpc?.close().catch(() => {}); await rm(scratch, {recursive: true, force: true}); throw error;
  } finally { remove(); }
  });
}
