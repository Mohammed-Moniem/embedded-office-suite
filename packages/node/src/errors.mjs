export class OfficeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'OfficeError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const fail = (code, message, details) => { throw new OfficeError(code, message, details); };
export function object(value, name = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ARGUMENT', `${name} must be an object`);
  return value;
}
export function bytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (!(value instanceof Uint8Array)) fail('INVALID_ARGUMENT', 'bytes must be a Uint8Array');
  return Uint8Array.from(value);
}
export function abort(signal) {
  if (signal?.aborted) {
    if (signal.reason instanceof OfficeError) throw signal.reason;
    fail('CANCELLED', 'Operation cancelled');
  }
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('PROTOCOL_ERROR', 'Expected a non-negative integer revision');
  return value;
}
