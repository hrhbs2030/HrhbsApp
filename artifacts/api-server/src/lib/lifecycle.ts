// Process lifecycle for the background sweeps: each sweep registers the
// promise of its current run here, so a SIGTERM (src/index.ts) can let the
// runs in flight finish before the pool is closed, and the sweeps stop
// re-arming once shutdown has begun. Nothing here holds the process open.

const inFlight = new Set<Promise<unknown>>();
let stopping = false;

export function shuttingDown(): boolean {
  return stopping;
}

export function beginShutdown(): void {
  stopping = true;
}

// Test hook: a fresh process state.
export function resetLifecycle(): void {
  stopping = false;
  inFlight.clear();
}

export function inFlightCount(): number {
  return inFlight.size;
}

// Runs one sweep and tracks it until it settles. The promise is handed back
// as is: the caller still owns its outcome.
export function trackJob<T>(run: () => Promise<T>): Promise<T> {
  const promise = run();
  inFlight.add(promise);
  promise.then(() => inFlight.delete(promise), () => inFlight.delete(promise));
  return promise;
}

// Waits for the runs in flight, at most `timeoutMs`. Resolves true when
// everything finished, false when the deadline cut the wait short.
export async function drainJobs(timeoutMs: number): Promise<boolean> {
  if (inFlight.size === 0) return true;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); });
  const settled = Promise.allSettled([...inFlight]).then(() => true as const);
  const result = await Promise.race([settled, deadline]);
  if (timer) clearTimeout(timer);
  return result;
}
