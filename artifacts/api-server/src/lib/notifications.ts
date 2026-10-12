import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Notification, NotificationKind } from "@workspace/api-zod";
import {
  db, hbsCustomerSettings, hbsNotificationPreferences, hbsNotifications, hbsOfficeStaff,
  type DeliveryOutcome, type HbsNotification,
} from "@workspace/db";
import { logger } from "./logger";
import { getOfficeRoleForUserId } from "./office-access";
import {
  DEFAULT_PREFS, KINDS, coalesced, deliveryPlan, groupKeyFor, prioritize, priorityRank,
  type Audience, type DeliveryPlan, type DeliveryPrefs, type Priority, type PrioritySignals,
} from "./notification-intelligence";
import { emit } from "./notification-stream";
import { mailConfigured, notify, sendMailNow, type Mail } from "./notify";
import { sendPush as defaultSendPush, type PushPayload } from "./web-push";
import { saudiMobile, sendWhatsApp, whatsappConfigured, whatsappText } from "./whatsapp";

// The one dispatch pipeline every notification goes through: the user's
// preferences decide the plan, repeated events on one target fold into one
// row, the row is stored and pushed to open streams, then each channel is
// sent now, held for later (quiet hours / daily digest, sent by
// notification-digest.ts) or skipped. The outcome per channel is kept in
// the row's `delivered` column.
//
// Mail copy comes from the builders in notify.ts: the caller passes the
// Mail (or null when the customer has no address) and the title/body/path
// taken from it, so email, WhatsApp, push and the in-app row all say the
// same thing.

export type PublishInput = {
  kind: NotificationKind;
  title: string;
  body: string;
  path?: string | null;
  // The button the mail carried, reused for the WhatsApp text.
  action?: { label: string; path: string } | null;
  targetType?: string | null;
  targetId?: string | number | null;
  signals?: PrioritySignals;
  // At most one row ever for this key (e.g. one invitation mail per invitee).
  dedupeKey?: string | null;
  // The email for this event; null/undefined means no email goes out.
  mail?: Mail | null;
  // Customers only: also WhatsApp when the customer opted in.
  whatsapp?: boolean;
};

export type OfficePublishInput = PublishInput & {
  // Which staff members get the in-app row; every hbs_office_staff member when omitted.
  recipients?: string[];
};

export type PublishDeps = {
  canReceiveOffice?: (userId: string) => Promise<boolean>;
  now?: () => Date;
  // When given, the email is awaited and its failure rejects the publish
  // (the reminder sweeps need to know). Otherwise it is sent in the background.
  sendMail?: (mail: Mail) => Promise<void>;
  sendPush?: (userId: string, payload: PushPayload) => Promise<DeliveryOutcome>;
  sendWhatsApp?: (userId: string, message: Mail) => Promise<DeliveryOutcome>;
};

export type PublishResult = {
  notification: HbsNotification;
  plan: DeliveryPlan;
  // True when the event was folded into an existing unread row.
  coalesced: boolean;
};

// Events on the same target within this window become one row.
export const COALESCE_WINDOW_MS = 60 * 60_000;

const siteUrl = () => (process.env.PUBLIC_SITE_URL ?? "https://hrhbs.com").replace(/\/$/, "");

export async function loadPrefs(userId: string): Promise<DeliveryPrefs> {
  const [row] = await db.select().from(hbsNotificationPreferences).where(eq(hbsNotificationPreferences.userId, userId)).limit(1);
  if (!row) return DEFAULT_PREFS;
  return {
    emailEnabled: row.emailEnabled, pushEnabled: row.pushEnabled, quietStart: row.quietStart, quietEnd: row.quietEnd,
    digest: row.digest === "daily" ? "daily" : "instant", mutedKinds: row.mutedKinds,
  };
}

export async function unreadCount(userId: string, officeAccess = false): Promise<number> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(hbsNotifications)
    .where(and(eq(hbsNotifications.userId, userId), isNull(hbsNotifications.readAt),
      officeAccess ? undefined : eq(hbsNotifications.audience, "customer")));
  return count;
}

export function toApiNotification(row: HbsNotification): Notification {
  return {
    id: row.id, audience: row.audience as Notification["audience"], kind: row.kind as NotificationKind,
    title: row.title, body: row.body, path: row.path, priority: row.priority as Notification["priority"], count: row.count,
    targetType: row.targetType, targetId: row.targetId, createdAt: row.createdAt, readAt: row.readAt,
  };
}

// Tells the user's open streams about the row and the new badge count.
async function announce(row: HbsNotification): Promise<void> {
  emit(row.userId, { type: "notification", data: toApiNotification(row) });
  emit(row.userId, { type: "unread", data: { count: await unreadCount(row.userId, row.audience === "office") } });
}

// Merges one channel's outcome into the row without touching the others
// (channels finish in any order).
async function settle(id: number, channel: string, outcome: DeliveryOutcome): Promise<void> {
  await db.update(hbsNotifications)
    .set({ delivered: sql`${hbsNotifications.delivered} || ${JSON.stringify({ [channel]: outcome })}::jsonb` })
    .where(eq(hbsNotifications.id, id));
}

// sendMailNow resolves without sending when SMTP is off; an injected sender
// that resolved did send.
function mailOutcome(deps: PublishDeps): DeliveryOutcome {
  return deps.sendMail || mailConfigured() ? "sent" : "skipped";
}

// Existing customer-contact behaviour: the customer's WhatsApp number when
// opted in, plain text inside the 24-hour window, the template otherwise.
async function whatsappCustomer(userId: string, message: Mail): Promise<DeliveryOutcome> {
  if (!whatsappConfigured()) return "skipped";
  const [settings] = await db.select().from(hbsCustomerSettings).where(eq(hbsCustomerSettings.userId, userId)).limit(1);
  const phone = settings?.whatsappOptIn && settings.whatsappVerified && settings.whatsappPhone ? saudiMobile(settings.whatsappPhone) : null;
  if (!phone) return "skipped";
  return (await sendWhatsApp(phone, whatsappText(message, siteUrl()), settings?.lastInboundAt)) ? "sent" : "failed";
}

const higher = (a: Priority, b: Priority): Priority => (priorityRank(a) <= priorityRank(b) ? a : b);

// What this recipient's email channel does: send the mail, only record the
// plan's outcome (the office inbox mail went out once for everyone), or
// nothing at all.
type Channels = { email: "send" | "record" | "off"; whatsapp: boolean };

// The pipeline for one recipient. Returns null when nothing was recorded
// (the dedupe key was seen before).
async function publishTo(userId: string, audience: Audience, input: PublishInput, deps: PublishDeps, channels: Channels): Promise<PublishResult | null> {
  const now = deps.now?.() ?? new Date();
  const prefs = await loadPrefs(userId);
  const priority = prioritize(input.kind, input.signals);
  const plan = deliveryPlan({ kind: input.kind, priority, prefs, now });
  const groupKey = groupKeyFor(input.kind, input.targetType, input.targetId);
  const path = input.path ?? input.action?.path ?? null;
  const dedupeKey = input.dedupeKey ?? null;
  if (dedupeKey) {
    const [seen] = await db.select({ id: hbsNotifications.id }).from(hbsNotifications).where(eq(hbsNotifications.dedupeKey, dedupeKey)).limit(1);
    if (seen) return null;
  }

  // Coalesce: an unread row for the same target from the last hour grows a
  // count instead of a second row. Channels already sent for that row are
  // not sent again; one that failed gets another try.
  const [existing] = await db.select().from(hbsNotifications).where(and(
    eq(hbsNotifications.userId, userId), eq(hbsNotifications.groupKey, groupKey), isNull(hbsNotifications.readAt),
    gt(hbsNotifications.createdAt, new Date(now.getTime() - COALESCE_WINDOW_MS)),
  )).orderBy(desc(hbsNotifications.createdAt), desc(hbsNotifications.id)).limit(1);
  // A unique event needs its own durable key. Coalescing it into another row
  // would lose that key and allow a redelivery to increment/send again.
  if (existing && !dedupeKey) {
    const count = existing.count + 1;
    const copy = coalesced(input.kind, count, { title: input.title, body: input.body });
    const [row] = await db.update(hbsNotifications).set({
      count, title: copy.title, body: copy.body, path: path ?? existing.path, priority: higher(existing.priority as Priority, priority), updatedAt: now,
    }).where(and(eq(hbsNotifications.id, existing.id), isNull(hbsNotifications.readAt), eq(hbsNotifications.count, existing.count))).returning();
    if (row) {
      await announce(row);
      const retry = (channel: string) => existing.delivered[channel] === "failed";
      await dispatch(row, input, plan, deps, { email: channels.email === "send" && retry("email"), push: retry("push"), whatsapp: channels.whatsapp && retry("whatsapp") });
      return { notification: row, plan, coalesced: true };
    }
    // Lost a race with a reader or another server: a new row instead.
  }

  const held = (timing: DeliveryPlan["email"]): DeliveryOutcome | null => (timing === "digest" ? "held" : timing === "skip" ? "skipped" : null);
  const delivered: Record<string, DeliveryOutcome> = {};
  const email = channels.email !== "off" && input.mail ? held(plan.email) : "skipped";
  if (email) delivered.email = email;
  else if (channels.email === "record") delivered.email = mailOutcome(deps);
  const push = held(plan.push);
  if (push) delivered.push = push;
  if (!channels.whatsapp || plan.whatsapp === "skip") delivered.whatsapp = "skipped";
  const [row] = await db.insert(hbsNotifications).values({
    userId, audience, kind: input.kind, title: input.title, body: input.body, path, priority, groupKey, count: 1,
    targetType: input.targetType ?? null, targetId: input.targetId == null ? null : String(input.targetId), dedupeKey,
    deliverAfter: plan.deliverAfter, delivered, createdAt: now, updatedAt: now,
  }).onConflictDoNothing().returning();
  if (!row) return null;
  await announce(row);
  await dispatch(row, input, plan, deps, { email: channels.email === "send", push: true, whatsapp: channels.whatsapp });
  return { notification: row, plan, coalesced: false };
}

// The channels due now. Push and WhatsApp are awaited (bounded, never
// throw); the email settles in the background unless the caller asked to
// wait for it.
async function dispatch(row: HbsNotification, input: PublishInput, plan: DeliveryPlan, deps: PublishDeps, want: { email: boolean; push: boolean; whatsapp: boolean }): Promise<void> {
  const copy: Mail = input.mail ?? { to: "", subject: input.title, heading: input.title, lines: [input.body], ...(input.action ? { action: input.action } : {}) };
  if (want.push && plan.push === "now") {
    let outcome: DeliveryOutcome = "failed";
    try {
      outcome = await (deps.sendPush ?? defaultSendPush)(row.userId, { title: row.title, body: row.body, path: row.path, id: row.id });
    } catch (err) {
      logger.warn({ err, notificationId: row.id }, "Push was not sent");
    }
    await settle(row.id, "push", outcome);
  }
  if (want.email && plan.email === "now" && input.mail) {
    if (deps.sendMail) {
      try {
        await deps.sendMail(input.mail);
      } catch (err) {
        await settle(row.id, "email", "failed");
        throw err;
      }
      await settle(row.id, "email", "sent");
    } else {
      sendMailNow(input.mail)
        .then(() => settle(row.id, "email", mailOutcome(deps)), () => settle(row.id, "email", "failed"))
        .catch(err => logger.warn({ err }, "Email outcome was not recorded"));
    }
  }
  if (want.whatsapp && plan.whatsapp === "now") {
    let outcome: DeliveryOutcome = "failed";
    try {
      outcome = await (deps.sendWhatsApp ?? whatsappCustomer)(row.userId, copy);
    } catch {
      // Logged inside sendWhatsApp; a settings lookup failure only skips WhatsApp.
    }
    await settle(row.id, "whatsapp", outcome);
  }
}

export async function publishCustomer(userId: string, input: PublishInput, deps: PublishDeps = {}): Promise<PublishResult | null> {
  return publishTo(userId, "customer", input, deps, { email: "send", whatsapp: input.whatsapp ?? false });
}

// One row per staff member (each has their own read state and devices),
// and the one office inbox mail as before. A staff member's own email
// channel only matters for held rows: the digest sweep mails them then.
export async function publishOffice(input: OfficePublishInput, deps: PublishDeps = {}): Promise<PublishResult[]> {
  const recipients = input.recipients
    ?? (await db.select({ userId: hbsOfficeStaff.userId }).from(hbsOfficeStaff).orderBy(hbsOfficeStaff.createdAt)).map(row => row.userId);
  if (input.mail) {
    if (deps.sendMail) await deps.sendMail(input.mail); else notify(input.mail);
  }
  const results: PublishResult[] = [];
  for (const userId of recipients) {
    try {
      if (!(await (deps.canReceiveOffice ?? canReceiveOffice)(userId))) continue;
      // The inbox mail already went out above; held rows are mailed by the digest.
      const result = await publishTo(userId, "office", { ...input, mail: input.mail ?? null,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:recipient:${userId}` : null,
      }, deps, { email: "record", whatsapp: false });
      if (result) results.push(result);
    } catch (err) {
      logger.warn({ err, kind: input.kind }, "Office notification was not recorded for a staff member");
    }
  }
  return results;
}

export async function canReceiveOffice(userId: string): Promise<boolean> {
  try { return !!(await getOfficeRoleForUserId(userId)); }
  catch { return false; }
}

// A message to an address with no portal account yet (a company
// invitation): email only, nothing in-app.
export function mailOnly(mail: Mail | null): void {
  notify(mail);
}

export const kindLabel = (kind: NotificationKind): string => KINDS[kind]?.label ?? kind;
