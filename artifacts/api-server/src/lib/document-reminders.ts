import { and, desc, eq, isNull, or, gt, sql } from "drizzle-orm";
import {
  db, hbsCompanies, hbsDocumentReminders, hbsRegistrationRequests, hbsRequestEmployees, hbsServiceRequests,
  type HbsDocumentReminder, type HbsServiceRequest,
} from "@workspace/db";
import { recordAudit } from "./audit";
import { AUTOMATION_ACTOR, applyAssignmentRule } from "./automations";
import { checklistForService } from "./checklist";
import { notifyCustomerNow, notifyOffice } from "./customer-contact";
import { logger } from "./logger";
import { requestReference } from "./money";
import { officeNewRequestMail, reminderMail, type Mail } from "./notify";
import { SUBSCRIPTION_AUDIT, autoRenewalCovered } from "./subscriptions";

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

// ---- automatic renewal requests -------------------------------------------------

// The service a subscribed company's expiring employee document is renewed
// through: the same mapping the customer's "request renewal" link uses
// (artifacts/hbs-solutions/src/pages/customer.tsx). Licenses are not covered.
export const AUTO_RENEWAL_SERVICES: Record<string, { slug: string; category: string; service: string }> = {
  iqama: { slug: "iqama-renewal", category: "passports", service: "تجديد الإقامة" },
  passport: { slug: "passport-info-update", category: "passports", service: "تحديث بيانات الجواز" },
  work_permit: { slug: "work-permit", category: "labor", service: "إصدار أو تجديد رخصة العمل" },
};
export const AUTO_RENEWAL_DESCRIPTION = "تجديد تلقائي ضمن الاشتراك";

// One request per reminder and expiry date, whatever the sweep does later.
export const autoRenewalClientRequestId = (reminder: Pick<HbsDocumentReminder, "id" | "expiresOn">) =>
  `auto-renew:${reminder.id}:${reminder.expiresOn}`;

// The number the office calls back on: the registration, else the company
// file, else the customer's latest request.
async function contactPhoneOf(userId: string): Promise<string | null> {
  const [registration] = await db.select({ phone: hbsRegistrationRequests.contactPhone }).from(hbsRegistrationRequests)
    .where(eq(hbsRegistrationRequests.userId, userId)).limit(1);
  if (registration?.phone) return registration.phone;
  const [company] = await db.select({ phone: hbsCompanies.contactPhone }).from(hbsCompanies).where(eq(hbsCompanies.userId, userId)).limit(1);
  if (company?.phone) return company.phone;
  const [request] = await db.select({ phone: hbsServiceRequests.contactPhone }).from(hbsServiceRequests)
    .where(eq(hbsServiceRequests.userId, userId)).orderBy(desc(hbsServiceRequests.createdAt), desc(hbsServiceRequests.id)).limit(1);
  return request?.phone ?? null;
}

// Opens the renewal request for an employee document whose reminder just
// fired, when the company's subscription covers it. Returns the request
// created, or null when nothing was (not covered, not an employee document,
// or already opened for this expiry).
export async function openAutoRenewalRequest(reminder: HbsDocumentReminder): Promise<HbsServiceRequest | null> {
  const target = AUTO_RENEWAL_SERVICES[reminder.kind];
  if (!target || !reminder.employeeId) return null;
  if (!(await autoRenewalCovered(reminder.userId))) return null;
  const contactPhone = await contactPhoneOf(reminder.userId);
  if (!contactPhone) {
    logger.warn({ reminderId: reminder.id }, "No contact phone on file; automatic renewal request not opened");
    return null;
  }
  const employeeId = reminder.employeeId;
  const kindLabel = reminderKindLabels[reminder.kind] ?? reminderKindLabels.other;
  const created = await db.transaction(async tx => {
    const [row] = await tx.insert(hbsServiceRequests).values({
      userId: reminder.userId, category: target.category, service: target.service,
      description: `${AUTO_RENEWAL_DESCRIPTION}: ${kindLabel} «${reminder.label}» تنتهي في ${expiresText(reminder.expiresOn)}.`,
      contactPhone, clientRequestId: autoRenewalClientRequestId(reminder), employeeId,
      documentChecklist: await checklistForService(tx, target.slug, target.service),
    }).onConflictDoNothing({ target: [hbsServiceRequests.userId, hbsServiceRequests.clientRequestId] }).returning();
    if (!row) return null;
    await tx.insert(hbsRequestEmployees).values({ requestId: row.id, employeeId });
    await recordAudit(tx, {
      actorId: AUTOMATION_ACTOR, action: SUBSCRIPTION_AUDIT.autoRenew, targetType: "service_request", targetId: row.id,
      details: { reminderId: reminder.id, kind: reminder.kind, employeeId, expiresOn: reminder.expiresOn, userId: reminder.userId },
    });
    return applyAssignmentRule(tx, row);
  });
  if (created) {
    void notifyOffice(() => officeNewRequestMail({
      id: created.id, reference: requestReference(created.id, created.createdAt), service: created.service, category: created.category,
    }), { kind: "office.request_new", targetType: "service_request", targetId: created.id });
  }
  return created;
}

// The reminder email, telling the customer the request is already open
// when it is.
export function withAutoRenewal(mail: Mail | null, request: HbsServiceRequest | null): Mail | null {
  if (!mail || !request) return mail;
  return {
    ...mail,
    lines: [mail.lines[0], `فتح المكتب طلب التجديد تلقائيًا ضمن اشتراكك (${requestReference(request.id, request.createdAt)})، وستصلك تحديثاته من صفحة الطلب.`],
    action: { label: "افتح طلب التجديد", path: `/requests/${request.id}` },
  };
}

export async function sendDueReminders(send: typeof notifyCustomerNow = notifyCustomerNow): Promise<number> {
  const rows = await db.select({
    id: hbsDocumentReminders.id,
    daysLeft: sql<number>`(${hbsDocumentReminders.expiresOn} - ${riyadhToday()})::int`,
    lastReminderDays: hbsDocumentReminders.lastReminderDays,
  }).from(hbsDocumentReminders)
    // Only rows whose next reminder is due, soonest first, so a large file
    // cannot keep already-reminded rows at the front of every sweep.
    .where(sql`${hbsDocumentReminders.expiresOn} between ${riyadhToday()} and ${riyadhToday()} + ${REMINDER_DAYS[0]}::int
      and (${hbsDocumentReminders.lastReminderDays} is null or ${hbsDocumentReminders.lastReminderDays} > case
        when ${hbsDocumentReminders.expiresOn} - ${riyadhToday()} <= 1 then 1
        when ${hbsDocumentReminders.expiresOn} - ${riyadhToday()} <= 7 then 7 else 30 end)`)
    .orderBy(hbsDocumentReminders.expiresOn, hbsDocumentReminders.id)
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
    // The first reminder for this expiry (normally the 30-day one) opens the
    // renewal request for subscribed companies; a failure there must not
    // stop the reminder itself.
    let autoRequest: HbsServiceRequest | null = null;
    if (row.lastReminderDays === null) {
      try {
        autoRequest = await openAutoRenewalRequest(claimed);
      } catch (err) {
        logger.error({ err, reminderId: claimed.id }, "Automatic renewal request failed");
      }
    }
    try {
      await send(claimed.userId, to => withAutoRenewal(reminderMail(to, {
        kindLabel, label: claimed.label, expiresText: expiresText(claimed.expiresOn), days: row.daysLeft,
      }), autoRequest), { kind: "reminder.expiring", targetType: "document_reminder", targetId: claimed.id, signals: { daysLeft: row.daysLeft } });
    } catch (err) {
      // Not sent: give the claim back so the next sweep tries again, unless
      // another instance has already moved the reminder on since.
      await db.update(hbsDocumentReminders).set({ lastReminderDays: row.lastReminderDays })
        .where(and(eq(hbsDocumentReminders.id, claimed.id), eq(hbsDocumentReminders.lastReminderDays, threshold)));
      logger.warn({ err, reminderId: claimed.id }, "Document reminder was not sent; it will be retried");
      continue;
    }
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
