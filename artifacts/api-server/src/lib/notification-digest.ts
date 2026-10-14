import { clerkClient } from "@clerk/express";
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db, hbsNotifications, hbsOfficeStaff, type DeliveryOutcome, type HbsNotification } from "@workspace/db";
import { customerEmail } from "./customer-contact";
import { shuttingDown, trackJob } from "./lifecycle";
import { logger } from "./logger";
import { digestMail } from "./notification-intelligence";
import { loadPrefs, toApiNotification } from "./notifications";
import { approvedOfficeEmail, getOfficeRoleForUserId } from "./office-access";
import { sendMailNow, type Mail } from "./notify";
import { purgeFailedPushSubscriptions, sendPush as defaultSendPush, type PushPayload } from "./web-push";

// Rows the pipeline held (quiet hours, daily digest) are sent here: every
// ten minutes the due rows are claimed per user with a conditional update,
// so two servers never send the same digest twice, then one digest mail
// goes to the user and a push for each row that was held for push.

const SWEEP_INTERVAL_MS = 10 * 60_000;
const PURGE_INTERVAL_MS = 24 * 60 * 60_000;
const BATCH_SIZE = 500;
export const NOTIFICATION_RETENTION_DAYS = 180;

export type DigestDeps = {
  sendMail: (mail: Mail) => Promise<void>;
  sendPush: (userId: string, payload: PushPayload) => Promise<DeliveryOutcome>;
  emailFor: (userId: string, audience: string) => Promise<string | null>;
  // Whether the staff member may still receive office rows. Throws when
  // that cannot be known right now (Clerk unreachable); false means revoked.
  officeAccess?: (userId: string) => Promise<boolean>;
};

// Held office rows whose staff check failed (Clerk down, network) are left
// for the next sweep rather than dropped as "revoked". After this many
// sweeps in a row the rows are given up on, so an account Clerk no longer
// knows cannot keep its rows pending forever.
export const OFFICE_ACCESS_MAX_RETRIES = 3;
const officeAccessFailures = new Map<string, number>();

export function resetOfficeAccessRetries(): void {
  officeAccessFailures.clear();
}

// "yes", "revoked", or "unknown" (left for the next sweep).
async function officeAccessFor(userId: string, deps: DigestDeps): Promise<"yes" | "revoked" | "unknown"> {
  const check = deps.officeAccess ?? (async (id: string) => !!(await getOfficeRoleForUserId(id)));
  try {
    const allowed = await check(userId);
    officeAccessFailures.delete(userId);
    return allowed ? "yes" : "revoked";
  } catch (err) {
    const failures = (officeAccessFailures.get(userId) ?? 0) + 1;
    if (failures >= OFFICE_ACCESS_MAX_RETRIES) {
      officeAccessFailures.delete(userId);
      logger.warn({ err, userId, failures }, "Staff check kept failing; held office notifications are skipped");
      return "revoked";
    }
    officeAccessFailures.set(userId, failures);
    // Once: the first failed sweep says so, the retries stay quiet.
    if (failures === 1) logger.warn({ err, userId }, "Staff check failed; held office notifications wait for the next sweep");
    return "unknown";
  }
}

// A staff member's address: their staff email, the owner's approved email
// for the owner row, else their verified sign-in email.
async function staffEmailOf(userId: string): Promise<string | null> {
  const [member] = await db.select({ email: hbsOfficeStaff.email }).from(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, userId)).limit(1);
  if (member?.email) return member.email;
  if (member) return approvedOfficeEmail();
  try {
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
    return primary?.verification?.status === "verified" ? primary.emailAddress : null;
  } catch {
    return null;
  }
}

export const digestDeps: DigestDeps = {
  sendMail: mail => sendMailNow(mail),
  sendPush: defaultSendPush,
  emailFor: (userId, audience) => (audience === "office" ? staffEmailOf(userId) : customerEmail(userId)),
};

export type DigestOutcome = { users: number; mails: number; pushes: number };

export async function deliverHeldNotifications(now = new Date(), deps: DigestDeps = digestDeps): Promise<DigestOutcome> {
  const outcome: DigestOutcome = { users: 0, mails: 0, pushes: 0 };
  const due = await db.select().from(hbsNotifications)
    .where(and(isNotNull(hbsNotifications.deliverAfter), lte(hbsNotifications.deliverAfter, now), isNull(hbsNotifications.digestedAt)))
    .orderBy(asc(hbsNotifications.userId), asc(hbsNotifications.id)).limit(BATCH_SIZE);
  const byUser = new Map<string, HbsNotification[]>();
  for (const row of due) {
    const list = byUser.get(row.userId);
    if (list) list.push(row); else byUser.set(row.userId, [row]);
  }
  for (const [userId, rows] of byUser) {
    const access = rows.some(row => row.audience === "office") ? await officeAccessFor(userId, deps) : "revoked";
    // Unknown: the office rows stay held and unclaimed; customer rows go on.
    const officeAccess = access === "yes";
    const blocked = access === "revoked" ? rows.filter(row => row.audience === "office") : [];
    if (blocked.length) {
      await db.update(hbsNotifications).set({
        digestedAt: now,
        delivered: sql`${hbsNotifications.delivered} || '{"email":"skipped","push":"skipped","whatsapp":"skipped"}'::jsonb`,
      }).where(and(inArray(hbsNotifications.id, blocked.map(row => row.id)), isNull(hbsNotifications.digestedAt)));
    }
    const allowedIds = rows.filter(row => row.audience !== "office" || officeAccess).map(row => row.id);
    if (!allowedIds.length) continue;
    const prefs = await loadPrefs(userId);
    // Claim before sending: only one instance wins the update.
    const claimed = await db.update(hbsNotifications).set({ digestedAt: now })
      .where(and(inArray(hbsNotifications.id, allowedIds), isNull(hbsNotifications.digestedAt))).returning();
    if (claimed.length === 0) continue;
    outcome.users++;
    for (const row of claimed) {
      if (row.delivered.push !== "held") continue;
      if (!prefs.pushEnabled || prefs.mutedKinds.includes(row.kind)) { await settle([row.id], "push", "skipped"); continue; }
      let result: DeliveryOutcome = "failed";
      try {
        result = await deps.sendPush(userId, { title: row.title, body: row.body, path: row.path, id: row.id });
      } catch (err) {
        logger.warn({ err, notificationId: row.id }, "Held push was not sent");
      }
      if (result === "sent") outcome.pushes++;
      await settle([row.id], "push", result);
    }
    const mailRows = claimed.filter(row => row.delivered.email === "held");
    if (mailRows.length === 0) continue;
    const ids = mailRows.map(row => row.id);
    const muted = mailRows.filter(row => prefs.mutedKinds.includes(row.kind));
    if (muted.length) await settle(muted.map(row => row.id), "email", "skipped");
    const enabledMailRows = mailRows.filter(row => !prefs.mutedKinds.includes(row.kind));
    if (!prefs.emailEnabled || !enabledMailRows.length) { await settle(ids, "email", "skipped"); continue; }
    const to = await deps.emailFor(userId, enabledMailRows[0].audience);
    if (!to) { await settle(ids, "email", "skipped"); continue; }
    try {
      await deps.sendMail(digestMail(to, enabledMailRows.map(toApiNotification)));
      await settle(enabledMailRows.map(row => row.id), "email", "sent");
      outcome.mails++;
    } catch (err) {
      // Not sent: give the claim back so the next sweep tries again. The
      // pushes above are settled and will not repeat.
      await db.update(hbsNotifications).set({ digestedAt: null }).where(and(inArray(hbsNotifications.id, ids), eq(hbsNotifications.digestedAt, now)));
      logger.warn({ err, userId }, "Digest mail was not sent; it will be retried");
    }
  }
  return outcome;
}

async function settle(ids: number[], channel: string, result: DeliveryOutcome): Promise<void> {
  await db.update(hbsNotifications)
    .set({ delivered: sql`${hbsNotifications.delivered} || ${JSON.stringify({ [channel]: result })}::jsonb` })
    .where(inArray(hbsNotifications.id, ids));
}

// Read rows older than six months are of no use to anyone.
export async function purgeOldNotifications(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000);
  const removed = await db.delete(hbsNotifications)
    .where(and(isNotNull(hbsNotifications.readAt), lt(hbsNotifications.createdAt, cutoff)))
    .returning({ id: hbsNotifications.id });
  return removed.length;
}

// No timer holds the process open, and nothing re-arms once shutdown began.
export function startNotificationJobs() {
  const sweep = (delay: number) => {
    setTimeout(async () => {
      if (shuttingDown()) return;
      try {
        const outcome = await trackJob(() => deliverHeldNotifications());
        if (outcome.users) logger.info(outcome, "Delivered held notifications");
      } catch (err) {
        logger.error({ err }, "Notification digest sweep failed");
      } finally {
        if (!shuttingDown()) sweep(SWEEP_INTERVAL_MS);
      }
    }, delay).unref();
  };
  const purge = (delay: number) => {
    setTimeout(async () => {
      if (shuttingDown()) return;
      try {
        await trackJob(async () => {
          const removed = await purgeOldNotifications();
          if (removed) logger.info({ removed }, "Removed read notifications older than 180 days");
          const devices = await purgeFailedPushSubscriptions();
          if (devices) logger.info({ removed: devices }, "Removed push subscriptions that kept failing for 30 days");
        });
      } catch (err) {
        logger.error({ err }, "Notification purge failed");
      } finally {
        if (!shuttingDown()) purge(PURGE_INTERVAL_MS);
      }
    }, delay).unref();
  };
  sweep(2 * 60_000);
  purge(15 * 60_000);
}
