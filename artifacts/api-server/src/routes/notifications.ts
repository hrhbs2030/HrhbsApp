import { getAuth } from "@clerk/express";
import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, hbsDocumentReminders, hbsInquiries, hbsInvoices, hbsNotificationPreferences, hbsNotifications, hbsPushSubscriptions,
  hbsServiceRequests, hbsSubscriptions, hbsWhatsappInbound, type HbsNotification, type HbsNotificationPreferences,
} from "@workspace/db";
import {
  DeletePushSubscriptionBody, GetNotificationBriefResponse, GetNotificationPreferencesResponse, GetPushKeyResponse,
  ListNotificationsQueryParams, ListNotificationsResponse, MarkAllNotificationsReadResponse, MarkNotificationReadParams,
  MarkNotificationReadResponse, SaveNotificationPreferencesBody, SaveNotificationPreferencesResponse, SavePushSubscriptionBody,
  type Notification,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { REMINDER_AFTER_DAYS } from "../lib/invoice-reminders";
import { invoiceReference, requestReference, riyals } from "../lib/money";
import { buildBrief, DEFAULT_PREFS, riyadhParts, type BriefInput } from "../lib/notification-intelligence";
import { subscribe, emit } from "../lib/notification-stream";
import { canReceiveOffice, unreadCount } from "../lib/notifications";
import { getOfficeRole } from "../lib/office-access";
import { publicKey, pushConfigured } from "../lib/web-push";
import { whatsappConfigured } from "../lib/whatsapp";

// The notification centre: the signed-in user's own rows (customer or office
// staff alike), live updates over SSE, the smart brief, delivery preferences
// and Web Push subscriptions. Rows are written by lib/notifications.ts; this
// file only reads them and flips read_at.
const router: IRouter = Router();

const SIGN_IN = { error: "Sign in to continue" };

function requireUser(req: Request, res: Response): string | null {
  const userId = getAuth(req).userId;
  if (!userId) res.status(401).json(SIGN_IN);
  return userId ?? null;
}

export function notification(row: HbsNotification): Notification {
  return {
    id: row.id, audience: row.audience as Notification["audience"], kind: row.kind as Notification["kind"],
    title: row.title, body: row.body, path: row.path, priority: row.priority as Notification["priority"], count: row.count,
    targetType: row.targetType, targetId: row.targetId, createdAt: row.createdAt, readAt: row.readAt,
  };
}

// ---- list and read state --------------------------------------------------------------

router.get("/notifications", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  // zod's coerce.boolean() turns "false" into true, so the flag is read by hand.
  const unread = req.query.unread === "true" || req.query.unread === "1";
  const query = ListNotificationsQueryParams.safeParse({ ...req.query, unread });
  if (!query.success) { res.status(400).json({ error: "معاملات غير صالحة." }); return; }
  const officeAccess = await canReceiveOffice(userId);
  const [rows, count] = await Promise.all([
    db.select().from(hbsNotifications).where(and(
      eq(hbsNotifications.userId, userId),
      officeAccess ? undefined : eq(hbsNotifications.audience, "customer"),
      unread ? isNull(hbsNotifications.readAt) : undefined,
      query.data.before ? lt(hbsNotifications.id, query.data.before) : undefined,
    )).orderBy(desc(hbsNotifications.createdAt), desc(hbsNotifications.id)).limit(query.data.limit),
    unreadCount(userId, officeAccess),
  ]);
  res.json(ListNotificationsResponse.parse({ items: rows.map(notification), unreadCount: count }));
});

// Other open tabs learn the new badge count through the stream.
async function announceUnread(userId: string) {
  emit(userId, { type: "unread", data: { count: await unreadCount(userId, await canReceiveOffice(userId)) } });
}

router.post("/notifications/:id/read", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "الإشعار غير موجود." }); return; }
  const officeAccess = await canReceiveOffice(userId);
  // Idempotent: a row read earlier keeps its first read time.
  const [row] = await db.update(hbsNotifications).set({ readAt: sql`coalesce(${hbsNotifications.readAt}, now())`, updatedAt: new Date() })
    .where(and(eq(hbsNotifications.id, params.data.id), eq(hbsNotifications.userId, userId),
      officeAccess ? undefined : eq(hbsNotifications.audience, "customer"))).returning();
  if (!row) { res.status(404).json({ error: "الإشعار غير موجود." }); return; }
  res.json(MarkNotificationReadResponse.parse(notification(row)));
  await announceUnread(userId);
});

router.post("/notifications/read-all", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const now = new Date();
  const officeAccess = await canReceiveOffice(userId);
  const updated = await db.update(hbsNotifications).set({ readAt: now, updatedAt: now })
    .where(and(eq(hbsNotifications.userId, userId), isNull(hbsNotifications.readAt),
      officeAccess ? undefined : eq(hbsNotifications.audience, "customer"))).returning({ id: hbsNotifications.id });
  res.json(MarkAllNotificationsReadResponse.parse({ updated: updated.length }));
  if (updated.length) emit(userId, { type: "unread", data: { count: 0 } });
});

// ---- live stream (SSE) ----------------------------------------------------------------

export const HEARTBEAT_MS = 25_000;
export const MAX_STREAMS_PER_USER = 5;
// Open streams per user, oldest first, so a runaway client cannot hold
// more than a handful of connections.
const streams = new Map<string, Response[]>();

export function openStreams(userId: string): number {
  return streams.get(userId)?.length ?? 0;
}

function sseWrite(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

router.get("/notifications/stream", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const hadOfficeAccess = await canReceiveOffice(userId);
  const count = await unreadCount(userId, hadOfficeAccess);
  const expiresAt = getAuth(req).sessionClaims?.exp;
  // The API-wide "no-store" is replaced: proxies must not buffer or cache
  // an event stream, and nginx honours x-accel-buffering.
  res.status(200).set({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();
  const open = streams.get(userId) ?? [];
  while (open.length >= MAX_STREAMS_PER_USER) open.shift()?.end();
  open.push(res);
  streams.set(userId, open);

  sseWrite(res, "unread", { count });
  const streamAccess = async (): Promise<boolean | null> => {
    if (res.destroyed || res.writableEnded) return null;
    if (typeof expiresAt === "number" && expiresAt * 1000 <= Date.now()) { res.end(); return null; }
    const officeAccess = await canReceiveOffice(userId);
    if (hadOfficeAccess && !officeAccess) { sseWrite(res, "access-denied", {}); res.end(); return null; }
    return officeAccess;
  };
  const unsubscribe = subscribe(userId, event => {
    void streamAccess().then(async officeAccess => {
      if (officeAccess === null || res.destroyed || res.writableEnded) return;
      if (event.type === "notification" && typeof event.data === "object" && event.data !== null
        && "audience" in event.data && event.data.audience === "office" && !officeAccess) return;
      sseWrite(res, event.type, event.type === "unread"
        ? { count: await unreadCount(userId, officeAccess) } : event.data);
    }).catch(() => res.end());
  });
  // A comment line keeps idle proxies from closing the connection.
  const heartbeat = setInterval(() => {
    void streamAccess().then(access => {
      if (access !== null && !res.destroyed && !res.writableEnded) res.write(": ping\n\n");
    }).catch(() => res.end());
  }, HEARTBEAT_MS);
  heartbeat.unref();
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    clearInterval(heartbeat);
    unsubscribe();
    const rest = (streams.get(userId) ?? []).filter((other) => other !== res);
    if (rest.length) streams.set(userId, rest); else streams.delete(userId);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
});

// ---- smart brief -------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const REMINDER_HORIZON_DAYS = 30;
const BRIEF_UNREAD_LIMIT = 50;
const BRIEF_ROWS_LIMIT = 20;

// Calendar days from today (Riyadh) to a date column (YYYY-MM-DD); negative when past.
function daysUntil(dateOnly: string, now: Date): number {
  const today = riyadhParts(now);
  const [year, month, day] = dateOnly.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(today.year, today.month - 1, today.day)) / DAY_MS);
}

const dateOnly = (date: Date) => {
  const p = riyadhParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

async function unreadFor(userId: string, officeAccess = false): Promise<Notification[]> {
  const rows = await db.select().from(hbsNotifications)
    .where(and(eq(hbsNotifications.userId, userId), isNull(hbsNotifications.readAt),
      officeAccess ? undefined : eq(hbsNotifications.audience, "customer")))
    .orderBy(desc(hbsNotifications.createdAt), desc(hbsNotifications.id)).limit(BRIEF_UNREAD_LIMIT);
  return rows.map(notification);
}

// An invoice counts as overdue once the first reminder would have gone out.
const overdueCutoff = (now: Date) => new Date(now.getTime() - REMINDER_AFTER_DAYS[0] * DAY_MS);

async function customerBrief(userId: string, now: Date): Promise<BriefInput> {
  const cutoff = overdueCutoff(now);
  const [unread, invoices, reminders, waiting] = await Promise.all([
    unreadFor(userId),
    db.select({
      id: hbsInvoices.id, issuedAt: hbsInvoices.issuedAt, totalHalalas: hbsInvoices.totalHalalas,
      requestId: hbsInvoices.requestId, subscriptionId: hbsInvoices.subscriptionId,
    }).from(hbsInvoices)
      .leftJoin(hbsServiceRequests, eq(hbsServiceRequests.id, hbsInvoices.requestId))
      .leftJoin(hbsSubscriptions, eq(hbsSubscriptions.id, hbsInvoices.subscriptionId))
      .where(and(
        eq(hbsInvoices.status, "issued"), lte(hbsInvoices.issuedAt, cutoff),
        sql`(${hbsServiceRequests.userId} = ${userId} or ${hbsSubscriptions.userId} = ${userId})`,
      )).orderBy(hbsInvoices.issuedAt).limit(BRIEF_ROWS_LIMIT),
    db.select({ id: hbsDocumentReminders.id, label: hbsDocumentReminders.label, expiresOn: hbsDocumentReminders.expiresOn })
      .from(hbsDocumentReminders)
      .where(and(
        eq(hbsDocumentReminders.userId, userId),
        gte(hbsDocumentReminders.expiresOn, dateOnly(new Date(now.getTime() - REMINDER_HORIZON_DAYS * DAY_MS))),
        lte(hbsDocumentReminders.expiresOn, dateOnly(new Date(now.getTime() + REMINDER_HORIZON_DAYS * DAY_MS))),
      )).orderBy(hbsDocumentReminders.expiresOn).limit(BRIEF_ROWS_LIMIT),
    db.select({ id: hbsServiceRequests.id, createdAt: hbsServiceRequests.createdAt, service: hbsServiceRequests.service })
      .from(hbsServiceRequests)
      .where(and(eq(hbsServiceRequests.userId, userId), eq(hbsServiceRequests.status, "waiting_on_customer")))
      .orderBy(desc(hbsServiceRequests.updatedAt)).limit(BRIEF_ROWS_LIMIT),
  ]);
  return {
    audience: "customer", now, unread,
    overdueInvoices: invoices.map((row) => ({
      reference: invoiceReference(row.id, row.issuedAt),
      days: Math.floor((now.getTime() - row.issuedAt.getTime()) / DAY_MS),
      total: riyals(row.totalHalalas),
      path: row.requestId ? `/requests/${row.requestId}` : `/company?tab=subscription&invoice=${row.id}`,
    })),
    expiringReminders: reminders.map((row) => ({ label: row.label, days: daysUntil(row.expiresOn, now), path: "/reminders" })),
    waitingRequests: waiting.map((row) => ({
      reference: requestReference(row.id, row.createdAt), service: row.service, path: `/requests/${row.id}`,
    })),
  };
}

const count = sql<number>`count(*)::int`;

async function officeBrief(userId: string, now: Date): Promise<BriefInput> {
  const [unread, [requests], [inquiries], [whatsapp], [invoices]] = await Promise.all([
    unreadFor(userId, true),
    db.select({ count }).from(hbsServiceRequests)
      .where(and(isNull(hbsServiceRequests.assignedTo), sql`${hbsServiceRequests.status} <> 'completed'`)),
    db.select({ count }).from(hbsInquiries).where(eq(hbsInquiries.status, "open")),
    db.select({ count }).from(hbsWhatsappInbound).where(eq(hbsWhatsappInbound.handled, "unmatched")),
    db.select({ total: sql<number>`coalesce(sum(${hbsInvoices.totalHalalas}), 0)::int` }).from(hbsInvoices)
      .where(and(eq(hbsInvoices.status, "issued"), lte(hbsInvoices.issuedAt, overdueCutoff(now)))),
  ]);
  return {
    audience: "office", now, unread, overdueInvoices: [], expiringReminders: [], waitingRequests: [],
    office: { unassigned: requests.count, openInquiries: inquiries.count, unmatchedWhatsapp: whatsapp.count, overdueTotalHalalas: invoices.total },
  };
}

router.get("/notifications/brief", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const now = new Date();
  const input = (await getOfficeRole(req)) ? await officeBrief(userId, now) : await customerBrief(userId, now);
  res.json(GetNotificationBriefResponse.parse(buildBrief(input)));
});

// ---- preferences -----------------------------------------------------------------------

type PreferenceFields = Pick<HbsNotificationPreferences, "emailEnabled" | "pushEnabled" | "quietStart" | "quietEnd" | "digest" | "mutedKinds">;

function preferences(row: PreferenceFields | undefined) {
  const prefs = row ?? { ...DEFAULT_PREFS, mutedKinds: [] as string[] };
  return {
    emailEnabled: prefs.emailEnabled, pushEnabled: prefs.pushEnabled, quietStart: prefs.quietStart, quietEnd: prefs.quietEnd,
    digest: prefs.digest, mutedKinds: prefs.mutedKinds,
    pushAvailable: pushConfigured(), whatsappAvailable: whatsappConfigured(),
  };
}

async function preferencesOf(userId: string) {
  const [row] = await db.select().from(hbsNotificationPreferences).where(eq(hbsNotificationPreferences.userId, userId)).limit(1);
  return row;
}

router.get("/notifications/preferences", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  res.json(GetNotificationPreferencesResponse.parse(preferences(await preferencesOf(userId))));
});

router.put("/notifications/preferences", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = SaveNotificationPreferencesBody.strict().safeParse(req.body);
  // Quiet hours are a range: one end without the other means nothing.
  if (!body.success || (body.data.quietStart === null) !== (body.data.quietEnd === null)) {
    res.status(400).json({ error: "تحقق من إعدادات الإشعارات: الساعات بين 0 و23 والقنوات صحيحة." }); return;
  }
  const next = { ...body.data, mutedKinds: [...new Set(body.data.mutedKinds)] };
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(hbsNotificationPreferences).where(eq(hbsNotificationPreferences.userId, userId)).limit(1);
    const previous = preferences(before);
    const [saved] = await tx.insert(hbsNotificationPreferences).values({ userId, ...next, updatedAt: new Date() })
      .onConflictDoUpdate({ target: hbsNotificationPreferences.userId, set: { ...next, updatedAt: new Date() } }).returning();
    const changed = (Object.keys(next) as (keyof typeof next)[])
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]));
    if (changed.length) {
      await recordAudit(tx, {
        actorId: userId, action: "notification.preferences", targetType: "user", targetId: userId,
        details: { changed, digest: next.digest, mutedKinds: next.mutedKinds.length },
      });
    }
    return saved;
  });
  res.json(SaveNotificationPreferencesResponse.parse(preferences(row)));
});

// ---- Web Push ----------------------------------------------------------------------------

const PUSH_OFF = { error: "إشعارات المتصفح غير مفعّلة على الخادم." };

router.get("/notifications/push/key", (req, res): void => {
  if (!requireUser(req, res)) return;
  res.json(GetPushKeyResponse.parse({ publicKey: pushConfigured() ? publicKey() : null }));
});

router.put("/notifications/push/subscriptions", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  if (!pushConfigured()) { res.status(503).json(PUSH_OFF); return; }
  const body = SavePushSubscriptionBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "بيانات الاشتراك غير صالحة." }); return; }
  const { endpoint, keys, userAgent } = body.data;
  // A browser profile that signs in as someone else re-registers the same
  // endpoint: it now belongs to the new user and starts clean.
  const values = { userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent?.trim() || null, failedAt: null };
  await db.insert(hbsPushSubscriptions).values({ endpoint, ...values })
    .onConflictDoUpdate({ target: hbsPushSubscriptions.endpoint, set: values });
  res.status(204).end();
});

router.delete("/notifications/push/subscriptions", async (req, res): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;
  const body = DeletePushSubscriptionBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "بيانات الاشتراك غير صالحة." }); return; }
  await db.delete(hbsPushSubscriptions)
    .where(and(eq(hbsPushSubscriptions.endpoint, body.data.endpoint), eq(hbsPushSubscriptions.userId, userId)));
  res.status(204).end();
});

export default router;
