// A small promise pool: `fn` runs for every item with at most `limit` calls
// in flight at once. Results keep the items' order; a rejection is reported
// in place (like Promise.allSettled) so one slow or failing item never
// stops the others.

export type Settled<T> = PromiseSettledResult<T>;

export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<Settled<R>[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Concurrency limit must be a positive integer");
  const results: Settled<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
