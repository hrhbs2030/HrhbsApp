import { and, eq, isNull, or, gt, sql } from "drizzle-orm";
import { db, hbsDocumentReminders } from "@workspace/db";
import { notifyCustomer } from "./customer-contact";
import { logger } from "./logger";
import { reminderMail } from "./notify";

// Reminders go out 30, 7 and 1 day before a document expires, by the date in
// Riyadh. Each reminder row remembers the last one sent, so a restart or a
// second server instance never sends the same reminder twice.
export const REMINDER_DAYS = [30, 7, 1] as const;
const SWEEP_INTERVAL_MS = 60 * 60_000;
const BATCH_SIZE = 100;

export const reminderKindLabels: Record<string, string> = {
  iqama: "الإقامة",
  passport: "الجواز",
  commercial_register: "السجل التجاري",
  work_permit: "رخصة العمل",
  other: "الوثيقة",
};

export const riyadhToday = () => sql`(now() at time zone 'Asia/Riyadh')::date`;

// The reminder due for a document `daysLeft` days from expiry, if any:
// the smallest threshold it has reached. Expired documents get none.
export function dueThreshold(daysLeft: number): number | null {
  if (daysLeft < 0) return null;
  let due: number | null = null;
  for (const days of REMINDER_DAYS) if (daysLeft <= days) due = days;
  return due;
}

function expiresText(date: string): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export async function sendDueReminders(send: typeof notifyCustomer = notifyCustomer): Promise<number> {
  const rows = await db.select({
    id: hbsDocumentReminders.id,
    daysLeft: sql<number>`(${hbsDocumentReminders.expiresOn} - ${riyadhToday()})::int`,
    lastReminderDays: hbsDocumentReminders.lastReminderDays,
  }).from(hbsDocumentReminders)
    .where(sql`${hbsDocumentReminders.expiresOn} between ${riyadhToday()} and ${riyadhToday()} + ${REMINDER_DAYS[0]}::int`)
    .limit(BATCH_SIZE * 5);
  let sent = 0;
  for (const row of rows) {
    const threshold = dueThreshold(row.daysLeft);
    if (threshold === null || (row.lastReminderDays !== null && row.lastReminderDays <= threshold)) continue;
    // Claim the reminder before sending: only one instance wins the update.
    const [claimed] = await db.update(hbsDocumentReminders).set({ lastReminderDays: threshold })
      .where(and(eq(hbsDocumentReminders.id, row.id),
        or(isNull(hbsDocumentReminders.lastReminderDays), gt(hbsDocumentReminders.lastReminderDays, threshold))))
      .returning();
    if (!claimed) continue;
    const kindLabel = reminderKindLabels[claimed.kind] ?? reminderKindLabels.other;
    await send(claimed.userId, to => reminderMail(to, {
      kindLabel, label: claimed.label, expiresText: expiresText(claimed.expiresOn), days: row.daysLeft,
    }));
    sent++;
    if (sent >= BATCH_SIZE) break;
  }
  return sent;
}

export function startDocumentReminders() {
  const schedule = (delay: number) => {
    setTimeout(async () => {
      try {
        const sent = await sendDueReminders();
        if (sent) logger.info({ sent }, "Sent document expiry reminders");
      } catch (err) {
        logger.error({ err }, "Document reminder sweep failed");
      } finally {
        schedule(SWEEP_INTERVAL_MS);
      }
    }, delay).unref();
  };
  schedule(60_000);
}
