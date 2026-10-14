import assert from "node:assert/strict";
import test from "node:test";
import { mapWithConcurrency } from "../src/lib/concurrency";
import { beginShutdown, drainJobs, inFlightCount, resetLifecycle, shuttingDown, trackJob } from "../src/lib/lifecycle";
import { allowedPushEndpoint, MAX_PUSH_SUBSCRIPTIONS_PER_USER, PUSH_SERVICE_HOSTS, PUSH_TIMEOUT_MS } from "../src/lib/web-push";

// Pure helpers behind the API hardening: the push endpoint allow-list, the
// fan-out pool and the shutdown bookkeeping. No database, no network.

test("push endpoints must be https on a browser vendor's push service", () => {
  for (const endpoint of [
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://fcm.googleapis.com/fcm/send/abc:APA91b",
    "https://wns2-bl2p.notify.windows.com/w/?token=abc",
    "https://web.push.apple.com/QFx0bQ",
    "https://FCM.googleapis.com/fcm/send/upper-case-host",
  ]) assert.equal(allowedPushEndpoint(endpoint), true, endpoint);
  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/plain-http",
    "https://10.0.0.5:5432/",
    "https://localhost/push",
    "https://push.example.invalid/sub/1",
    "https://fcm.googleapis.com.evil.invalid/fcm/send/abc",
    "https://evilfcm.googleapis.com/fcm/send/abc",
    "https://user:pw@fcm.googleapis.com/fcm/send/abc",
    "not a url",
    "",
  ]) assert.equal(allowedPushEndpoint(endpoint), false, endpoint);
  assert.ok(PUSH_SERVICE_HOSTS.includes("push.apple.com") && PUSH_SERVICE_HOSTS.includes("notify.windows.com"));
  assert.equal(MAX_PUSH_SUBSCRIPTIONS_PER_USER, 5);
  assert.equal(PUSH_TIMEOUT_MS, 10_000);
});

test("mapWithConcurrency keeps at most `limit` calls in flight, in order, and reports rejections in place", async () => {
  let running = 0;
  let peak = 0;
  const items = Array.from({ length: 11 }, (_, i) => i);
  const results = await mapWithConcurrency(items, 4, async (item) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5 + (item % 3) * 5));
    running--;
    if (item === 6) throw new Error("six failed");
    return item * 2;
  });
  assert.equal(peak, 4, "never more than four at once");
  assert.ok(peak > 1, "and actually parallel");
  assert.equal(results.length, 11);
  results.forEach((result, index) => {
    if (index === 6) {
      assert.equal(result.status, "rejected");
      assert.match(String((result as PromiseRejectedResult).reason), /six failed/);
    } else {
      assert.deepEqual(result, { status: "fulfilled", value: index * 2 });
    }
  });
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  await assert.rejects(mapWithConcurrency([1], 0, async () => 1), RangeError);
});

test("tracked jobs are waited for on shutdown, within the grace period", async () => {
  resetLifecycle();
  assert.equal(shuttingDown(), false);
  assert.equal(await drainJobs(50), true, "nothing in flight drains at once");
  let finishQuick!: () => void;
  const quick = trackJob(() => new Promise<string>((resolve) => { finishQuick = () => resolve("done"); }));
  const failing = trackJob(() => Promise.reject(new Error("sweep failed")));
  failing.catch(() => {});
  assert.equal(inFlightCount(), 2);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(inFlightCount(), 1, "a rejected job leaves the set");
  beginShutdown();
  assert.equal(shuttingDown(), true);
  const drained = drainJobs(5_000);
  finishQuick();
  assert.equal(await quick, "done", "the job's own result is untouched");
  assert.equal(await drained, true);
  assert.equal(inFlightCount(), 0);
  // A job that outlives the grace period does not hold the shutdown.
  let finishSlow!: () => void;
  const slow = trackJob(() => new Promise<void>((resolve) => { finishSlow = resolve; }));
  assert.equal(await drainJobs(30), false);
  finishSlow();
  await slow;
  resetLifecycle();
});
