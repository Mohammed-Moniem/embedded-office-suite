export type OfficeApp = 'wordcraft' | 'pdfcraft' | 'deckcraft' | 'gridcraft';
export type OfficeBytes = ArrayBuffer | ArrayBufferView;
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
export interface RevisionOptions extends RequestOptions { expectedRevision?: number }
export interface Capabilities {
  app: OfficeApp; sessionId: string; protocol: 'office-page-v1'; bridgeVersion: '1' | null;
  ready: boolean; pageCommands: boolean; confirmedOpen: boolean; revisions: boolean;
  durableSave: boolean; legacyPostOpen: boolean; fileSupport: boolean; methods: string[]; maxDocumentBytes: number;
}
export interface EditorState {
  app: OfficeApp; sessionId: string; revision: number | null; dirty: boolean; engineDirty: boolean;
  closed: boolean; durability: 'acknowledged' | 'unverified';
}
export interface BrowserHost {
  /** Resolve only after storage durably accepts the snapshot. Reject to keep it dirty. */
  writeFileAtomic?(input: { sessionId: string; name: string; bytes: Uint8Array; saveAs: boolean; revision: number | null; signal: AbortSignal }): Promise<unknown>;
  onDirty?(state: EditorState): void;
  onError?(error: OfficeBrowserError): void;
}
export interface BrowserOptions {
  app: OfficeApp; host?: BrowserHost; timeoutMs?: number; readyTimeoutMs?: number; negotiationMs?: number;
  maxDocumentBytes?: number; maxMessageBytes?: number; maxPendingRequests?: number; maxQueuedSaves?: number; maxSaveIds?: number;
  /** Primarily for tests or host-generated cryptographically random session tokens. */
  sessionId?: string;
}
export interface PageTransportOptions extends BrowserOptions {
  targetWindow: Window; hostWindow?: Window; origin?: string;
}
export interface OpenInput { name?: string; bytes: OfficeBytes; expectedRevision?: number }
export interface PageTransport {
  readonly kind: 'browser'; readonly protocol: 'office-page-v1'; readonly app: OfficeApp; readonly sessionId: string;
  readonly ready: Promise<Capabilities>;
  capabilities(): Capabilities;
  state(): EditorState;
  request<T = unknown>(method: string, params?: Record<string, unknown>, options?: RequestOptions): Promise<T>;
  /** Legacy engines return delivery:'posted', confirmed:false and revision:null. */
  open<T = unknown>(input: OpenInput, options?: RequestOptions): Promise<T>;
  commands<T = unknown>(params?: Record<string, unknown>, options?: RequestOptions): Promise<T>;
  execute<T = unknown>(command: string, params?: Record<string, unknown>, options?: RevisionOptions): Promise<T>;
  inspect<T = unknown>(params?: Record<string, unknown>, options?: RequestOptions): Promise<T>;
  render<T = unknown>(params?: Record<string, unknown>, options?: RequestOptions): Promise<T>;
  export<T = unknown>(params?: Record<string, unknown>, options?: RequestOptions): Promise<T>;
  save<T = unknown>(params?: { expectedRevision?: number; saveAs?: boolean }, options?: RequestOptions): Promise<T>;
  /** Dispose transport; request('office.close') separately to close an engine document. */
  close(): void;
  dispose(reason?: OfficeBrowserError): void;
}
export interface MountOptions extends BrowserOptions { container: HTMLElement; assetBaseUrl: string }
export interface MountedEditor extends PageTransport { readonly frame: HTMLIFrameElement }
export class OfficeBrowserError extends Error { readonly code: string; constructor(code: string, message: string, options?: ErrorOptions) }
export function createPageTransport(options: PageTransportOptions): PageTransport;
export function mountOfficeEditor(options: MountOptions): MountedEditor;
