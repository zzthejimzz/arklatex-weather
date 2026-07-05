// fetch with a hard timeout. A plain fetch() can hang forever (dead TCP
// connection, proxy black hole) — and every data source here reschedules its
// next poll in `finally`, so one hung fetch would silently kill that loop for
// good. This is the single most important piece of the 24/7 hardening: with a
// timeout, the worst case is one failed poll, not a dead feed.
const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
