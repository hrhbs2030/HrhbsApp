import { eq } from "drizzle-orm";
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

// A day: long enough to reach a phone that is off tonight, short enough
// that stale news is dropped rather than delivered next week.
const TTL_SECONDS = 24 * 60 * 60;

// Sends to every subscription of the user. A subscription the push service
// no longer knows (404/410) is deleted; any other failure is stamped so the
// office can see a device that stopped receiving. Returns what happened
// overall: 'skipped' when push is off or the user has no (working) device.
export async function sendPush(userId: string, payload: PushPayload, deps: PushDeps = defaultDeps): Promise<DeliveryOutcome> {
  if (!pushConfigured()) return "skipped";
  const subscriptions = await db.select().from(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.userId, userId));
  if (subscriptions.length === 0) return "skipped";
  const body = JSON.stringify(payload);
  const options: RequestOptions = {
    TTL: TTL_SECONDS,
    vapidDetails: { subject: process.env.VAPID_SUBJECT!, publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
  };
  let sent = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    try {
      await deps.send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, body, options);
      sent++;
      await db.update(hbsPushSubscriptions).set({ lastUsedAt: new Date(), failedAt: null })
        .where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint));
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await db.delete(hbsPushSubscriptions).where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint));
        continue;
      }
      failed++;
      // The endpoint identifies the device; the log keeps only the status.
      logger.warn({ status: status ?? "unknown" }, "Web push failed");
      await db.update(hbsPushSubscriptions).set({ failedAt: new Date() }).where(eq(hbsPushSubscriptions.endpoint, subscription.endpoint));
    }
  }
  return sent ? "sent" : failed ? "failed" : "skipped";
}
