import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { NotificationKind } from "@workspace/api-zod";
import { db, hbsRegistrationRequests } from "@workspace/db";
import { logger } from "./logger";
import type { PrioritySignals } from "./notification-intelligence";
import { kindLabel, publishCustomer, publishOffice, type PublishInput } from "./notifications";
import { sendMailNow, type Mail } from "./notify";

// The address the customer registered with, for notifications.
// Runs after the response is sent, so a lookup failure only skips the email.
export async function customerEmail(userId: string): Promise<string | null> {
  try {
    const [registration] = await db.select({ email: hbsRegistrationRequests.email })
      .from(hbsRegistrationRequests).where(eq(hbsRegistrationRequests.userId, userId)).limit(1);
    if (registration?.email) return registration.email;
    // Customers from before registration existed: their verified sign-in email.
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
    return primary?.verification?.status === "verified" ? primary.emailAddress : null;
  } catch {
    return null;
  }
}

// What the pipeline needs to know about the event besides its copy.
export type NotifyMeta = {
  kind: NotificationKind;
  targetType?: string | null;
  targetId?: string | number | null;
  signals?: PrioritySignals;
  dedupeKey?: string | null;
};

export type OfficeNotifyMeta = NotifyMeta & {
  // Which staff members get the in-app row; everyone in hbs_office_staff when omitted.
  recipients?: string[];
  // Copy for the in-app row when there is no mail to take it from.
  copy?: { title: string; body: string; path?: string | null };
};

// The mail builders return null without an address. Built once more with a
// placeholder so the in-app row (and WhatsApp) still get the copy.
const PLACEHOLDER_ADDRESS = "in-app-only";

async function customerInput(userId: string, build: (to: string | null) => Mail | null, meta: NotifyMeta): Promise<PublishInput | null> {
  const email = await customerEmail(userId);
  const mail = build(email);
  const copy = mail ?? build(PLACEHOLDER_ADDRESS);
  if (!copy) return null;
  return { ...meta, title: copy.heading, body: copy.lines.join(" "), path: copy.action?.path ?? null, action: copy.action ?? null, mail, whatsapp: true };
}

// In-app, email, push and WhatsApp (when opted in) through the pipeline, in
// the background: nothing here fails the request that caused it.
export async function notifyCustomer(userId: string, build: (to: string | null) => Mail | null, meta: NotifyMeta): Promise<void> {
  try {
    const input = await customerInput(userId, build, meta);
    if (input) await publishCustomer(userId, input);
  } catch (err) {
    logger.warn({ err, kind: meta.kind }, "Customer notification failed");
  }
}

// Like notifyCustomer, but rejects when the email cannot be sent, so a
// reminder sweep can give its claim back and try again later. WhatsApp and
// push are still best effort.
export async function notifyCustomerNow(userId: string, build: (to: string | null) => Mail | null, meta: NotifyMeta, send: typeof sendMailNow = sendMailNow): Promise<void> {
  const input = await customerInput(userId, build, meta);
  if (input) await publishCustomer(userId, input, { sendMail: mail => send(mail) });
}

// The office: one row per staff member and the office inbox mail the
// builder returns (null when no inbox is configured; the row still gets
// the kind's label as copy). Background, like notifyCustomer.
export async function notifyOffice(build: () => Mail | null, meta: OfficeNotifyMeta): Promise<void> {
  try {
    const mail = build();
    const copy = meta.copy ?? (mail ? { title: mail.heading, body: mail.lines.join(" "), path: mail.action?.path ?? null } : null);
    const { copy: _copy, ...rest } = meta;
    await publishOffice({
      ...rest,
      title: copy?.title ?? kindLabel(meta.kind),
      body: copy?.body ?? "",
      path: copy?.path ?? mail?.action?.path ?? null,
      action: mail?.action ?? null,
      mail,
    });
  } catch (err) {
    logger.warn({ err, kind: meta.kind }, "Office notification failed");
  }
}
