import { clerkClient } from "@clerk/express";
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db, hbsNotifications, hbsOfficeStaff, type DeliveryOutcome, type HbsNotification } from "@workspace/db";
import { customerEmail } from "./customer-contact";
import { logger } from "./logger";
import { digestMail } from "./notification-intelligence";
import { canReceiveOffice, loadPrefs, toApiNotification } from "./notifications";
import { approvedOfficeEmail } from "./office-access";
import { sendMailNow, type Mail } from "./notify";
import { sendPush as defaultSendPush, type PushPayload } from "./web-push";

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
};

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
    const officeAccess = rows.some(row => row.audience === "office") ? await canReceiveOffice(userId) : false;
    const blocked = rows.filter(row => row.audience === "office" && !officeAccess);
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

// No timer holds the process open.
export function startNotificationJobs() {
  const sweep = (delay: number) => {
    setTimeout(async () => {
      try {
        const outcome = await deliverHeldNotifications();
        if (outcome.users) logger.info(outcome, "Delivered held notifications");
      } catch (err) {
        logger.error({ err }, "Notification digest sweep failed");
      } finally {
        sweep(SWEEP_INTERVAL_MS);
      }
    }, delay).unref();
  };
  const purge = (delay: number) => {
    setTimeout(async () => {
      try {
        const removed = await purgeOldNotifications();
        if (removed) logger.info({ removed }, "Removed read notifications older than 180 days");
      } catch (err) {
        logger.error({ err }, "Notification purge failed");
      } finally {
        purge(PURGE_INTERVAL_MS);
      }
    }, delay).unref();
  };
  sweep(2 * 60_000);
  purge(15 * 60_000);
}
