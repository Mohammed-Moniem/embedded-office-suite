import {OfficeError, fail} from './errors.mjs';

/** A single admission-to-completion deadline. Host callbacks must cooperate to stop a commit. */
export function createLifetime({signal, timeoutMs = 30_000} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) fail('INVALID_ARGUMENT', 'timeoutMs must be a positive 32-bit timer duration');
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
    fail('INVALID_ARGUMENT', 'signal must be an AbortSignal');
  const controller = new AbortController(), listeners = new Set();
  const deadline = performance.now() + timeoutMs;
  let error, effectful = false, settled = false, rejectCancelled;
  const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
  cancelled.catch(() => {});
  function cancel(code = 'CANCELLED') {
    if (error || settled) return;
    error = code instanceof OfficeError ? code : new OfficeError(code,
      code === 'TIMEOUT' ? 'Office operation deadline expired' : 'Office operation cancelled', {outcomeUnknown: effectful});
    controller.abort(error);
    for (const listener of listeners) { try { listener(error); } catch {} }
    rejectCancelled(error);
  }
  const externalAbort = () => cancel(signal?.reason instanceof OfficeError ? signal.reason : 'CANCELLED');
  const timer = setTimeout(() => cancel('TIMEOUT'), timeoutMs);
  signal?.addEventListener('abort', externalAbort, {once: true});
  if (signal?.aborted) externalAbort();
  function check() {
    if (!error && performance.now() >= deadline) cancel('TIMEOUT');
    if (error) throw error;
  }
  const lifetime = {
    signal: controller.signal,
    check,
    remaining() { check(); return Math.max(1, Math.ceil(deadline - performance.now())); },
    markEffect() { check(); effectful = true; },
    cancel,
    onAbort(listener) { listeners.add(listener); if (error) listener(error); return () => listeners.delete(listener); },
    async wait(work) {
      check();
      const promise = Promise.resolve().then(() => { check(); return typeof work === 'function' ? work() : work; });
      const result = await Promise.race([promise, cancelled]); check(); return result;
    },
    async run(work) {
      try { return await lifetime.wait(work); }
      finally { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', externalAbort); listeners.clear(); }
    },
  };
  return lifetime;
}
