export type App = 'wordcraft' | 'pdfcraft' | 'deckcraft' | 'gridcraft';
export type RequestOptions = {signal?: AbortSignal; timeoutMs?: number};
export type RevisionRequest = RequestOptions & {sessionId: string; expectedRevision?: number};
export type Session = {sessionId: string; app: App; revision: number; dirty: boolean; kind: 'native' | 'browser'; name: string};
export class OfficeError extends Error { readonly code: string; readonly details?: Record<string, unknown>; constructor(code: string, message: string, details?: Record<string, unknown>); }
export interface Transport {
  readonly kind?: string;
  readonly ready?: Promise<unknown>;
  request(method: string, params?: Record<string, unknown>, options?: RequestOptions): Promise<any>;
  close(): Promise<void> | void;
}
export interface StdioTransport extends Transport {readonly ready: Promise<{protocolVersion: string; capabilities: Record<string, unknown>; serverInfo?: unknown}>; readonly closed: boolean;}
export interface BinaryConfig {command: string; args?: string[]; env?: Record<string, string | undefined>; timeoutMs?: number; allowUnconfinedWorker?: boolean; filesystemPolicy?: 'automation-roots' | 'unconfined-host-reviewed';}
export type SaveRequest = RequestOptions & {sessionId: string; app?: App; path?: string; name: string; bytes: Uint8Array; revision: number; saveAs: boolean};
export interface Host {
  readFile?(request: RequestOptions & {path: string}): Promise<Uint8Array>;
  writeFileAtomic?(request: SaveRequest): Promise<void | {path?: string; committed?: boolean; [key: string]: unknown}>;
  authorizeEffect?(effect: RequestOptions & {kind: 'engine-command'; app: App; sessionId: string; command: string; params: Record<string, unknown>}): boolean | Promise<boolean>;
}
export interface ToolDescriptor {readonly name: string; readonly description: string; readonly inputSchema: Record<string, unknown>;}
export interface Integration {
  readonly tools: readonly ToolDescriptor[];
  capabilities(input?: RequestOptions & {sessionId?: string}): Promise<Record<string, any>>;
  open(input: RequestOptions & {app: App; path?: string; bytes?: Uint8Array | ArrayBuffer; name?: string; transport?: Transport}): Promise<Session>;
  commands(input: RequestOptions & {sessionId: string; query?: string; limit?: number}): Promise<Session & {commands: unknown[]; total: number; truncated: boolean}>;
  execute(input: RevisionRequest & {command: string; params?: Record<string, unknown>}): Promise<Session & {result: unknown}>;
  inspect(input: RequestOptions & {sessionId: string}): Promise<Session & {result: unknown}>;
  render(input: RequestOptions & {sessionId: string; page?: number; slide?: number; scale?: number; max_side?: number}): Promise<Session & {result: unknown}>;
  export(input: RevisionRequest & {format?: string}): Promise<Session & {bytes: Uint8Array; format?: string; mimeType?: string}>;
  save(input: RevisionRequest & {path?: string; name?: string; saveAs?: boolean}): Promise<Session & {savedRevision?: number; acknowledgement?: unknown; result?: unknown}>;
  close(input: RevisionRequest & {discardChanges?: boolean}): Promise<{sessionId: string; closed: true}>;
  callTool(name: string, input?: Record<string, unknown>, options?: RequestOptions): Promise<any>;
  dispose(options?: RequestOptions): Promise<void>;
}
export const APPS: readonly App[];
export const FORMATS: Readonly<Record<App, string>>;
export const officeToolDescriptors: readonly ToolDescriptor[];
export function createStdioTransport(options: BinaryConfig & {cwd?: string; maxMessageBytes?: number; maxPending?: number; killTimeoutMs?: number; onStderr?: (text: string) => void}): StdioTransport;
export function createNativeSessionTransport(options: {app: App; binary: string | BinaryConfig; timeoutMs?: number; signal?: AbortSignal; maxFileBytes?: number; scratchRoot?: string}): Promise<Transport>;
export function createFilesystemHost(options?: {readRoots?: string[]; writeRoots?: string[]; maxFileBytes?: number; authorizeEffect?: Host['authorizeEffect']}): Readonly<Host>;
export function createOfficeIntegration(options?: {host?: Host; transports?: Partial<Record<App, Transport | ((context: {app: App; signal?: AbortSignal; timeoutMs?: number}) => Transport | Promise<Transport>)>>; binaries?: Partial<Record<App, string | BinaryConfig>>; assetBaseUrl?: string}): Readonly<Integration>;
