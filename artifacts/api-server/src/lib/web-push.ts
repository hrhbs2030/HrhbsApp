import { and, asc, eq, isNotNull, lt, notInArray } from "drizzle-orm";
import webPush, { type PushSubscription, type RequestOptions } from "web-push";
import { db, hbsPushSubscriptions, type DeliveryOutcome } from "@workspace/db";
import { logger } from "./logger";

// Web Push (VAPID) to the browsers and phones a user subscribed from the
// portal. Free: the push services are run by the browser vendors. Off
// unless the three VAPID settings are present (generate a pair once with
// `npx web-push generate-vapid-keys`).
//
// Settings (Replit secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY   the key pair; the public key is handed to the browser
//   VAPID_SUBJECT                         "mailto:hr@hrhbs.com" or the site URL, for the push services

export type PushPayload = { title: string; body: string; path: string | null; id: number };

export type PushDeps = {
  send(subscription: PushSubscription, payload: string, options: RequestOptions): Promise<unknown>;
};

const defaultDeps: PushDeps = {
  send: (subscription, payload, options) => webPush.sendNotification(subscription, payload, options),
};

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

export function publicKey(): string | null {
  return pushConfigured() ? process.env.VAPID_PUBLIC_KEY! : null;
}

// The push services browsers hand out endpoints on. The server only ever
// POSTs to these hosts over https, so a subscription cannot point it at an
// internal address (blind SSRF) or an arbitrary site.
export const PUSH_SERVICE_HOSTS: readonly string[] = [
  "push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com)
  "fcm.googleapis.com", // Chrome, Edge, Brave, Opera, Samsung Internet
  "notify.windows.com", // Edge on Windows (*.notify.windows.com)
  "push.apple.com", // Safari (web.push.apple.com and regional hosts)
];

export function allowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

// Devices per user: the oldest subscription makes room for a new one.
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 5;

// Keeps the user's newest subscriptions only. Returns how many were dropped.
export async function trimPushSubscriptions(userId: string, keep = MAX_PUSH_SUBSCRIPTIONS_PER_USER): Promise<number> {
  const all = await db.select({ endpoint: hbsPushSubscriptions.endpoint }).from(hbsPushSubscriptions)
    .where(eq(hbsPushSubscriptions.userId, userId))
    .orderBy(asc(hbsPushSubscriptions.createdAt), asc(hbsPushSubscriptions.endpoint));
  if (all.length <= keep) return 0;
  const newest = all.slice(all.length - keep).map(row => row.endpoint);
  const removed = await db.delete(hbsPushSubscriptions)
    .where(and(eq(hbsPushSubscriptions.userId, userId), notInArray(hbsPushSubscriptions.endpoint, newest)))
    .returning({ endpoint: hbsPushSubscriptions.endpoint });
  return removed.length;
}

// A day: long enough to reach a phone that is off tonight, short enough
// that stale news is dropped rather than delivered next week.
const TTL_SECONDS = 24 * 60 * 60;
// A push service that does not answer in ten seconds is down for now; the
// rest of the pipeline must not wait behind it.
export const PUSH_TIMEOUT_MS = 10_000;

// Sends to every subscription of the user, all at once. A subscription the
// push service no longer knows (404/410) is deleted; any other failure is
// stamped so the office can see a device that stopped receiving. Returns
// what happened overall: 'skipped' when push is off or the user has no
// (working) device.
export async function sendPush(userId: string, payload: PushPayload, deps: PushDeps = defaultDeps): Promise<DeliveryOutcome> {
  if (!pushConfigured()) return "skipped";
  const subscriptions = await db.select().from(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.userId, userId));
  if (subscriptions.length === 0) return "skipped";
  const body = JSON.stringify(payload);
  const options: RequestOptions = {
    TTL: TTL_SECONDS,
    timeout: PUSH_TIMEOUT_MS,
    vapidDetails: { subject: process.env.VAPID_SUBJECT!, publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
  };
  let sent = 0;
  let failed = 0;
  await Promise.all(subscriptions.map(async subscription => {
    try {
      await deps.send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, body, options);
      sent++;
      await db.update(hbsPushSubscriptions).set({ lastUsedAt: new Date(), failedAt: null })
        .where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint));
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await db.delete(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint));
        return;
      }
      failed++;
      // The endpoint identifies the device; the log keeps only the status.
      logger.warn({ status: status ?? "unknown" }, "Web push failed");
      await db.update(hbsPushSubscriptions).set({ failedAt: new Date() }).where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint));
    }
  }));
  return sent ? "sent" : failed ? "failed" : "skipped";
}

// A device that has not accepted a push for a month is gone (the browser
// was reinstalled, the permission revoked): stop retrying it on every send.
export const FAILED_SUBSCRIPTION_RETENTION_DAYS = 30;

export async function purgeFailedPushSubscriptions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - FAILED_SUBSCRIPTION_RETENTION_DAYS * 86_400_000);
  const removed = await db.delete(hbsPushSubscriptions)
    .where(and(isNotNull(hbsPushSubscriptions.failedAt), lt(hbsPushSubscriptions.failedAt, cutoff)))
    .returning({ endpoint: hbsPushSubscriptions.endpoint });
  return removed.length;
}
