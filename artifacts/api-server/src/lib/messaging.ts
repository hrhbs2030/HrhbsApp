import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  db, hbsCustomerSettings, hbsInquiries, hbsInquiryMessages, hbsOfficeStaff, hbsRequestMessages, hbsServiceRequests,
  hbsThreadReads, type HbsInquiry, type HbsServiceRequest,
} from "@workspace/db";
import { customerEmail, notifyOffice, type NotifyMeta } from "./customer-contact";
import { logger } from "./logger";
import { requestReference } from "./money";
import { emit, subscriberCount } from "./notification-stream";
import { publishCustomer } from "./notifications";
import {
  customerInquiryMessageMail, customerMessageMail, inquiryAnsweredMail, officeInquiryMessageMail, officeMessageMail, type Mail,
} from "./notify";
import { approvedOfficeEmail } from "./office-access";
import { officeCustomer, type OfficeCustomer } from "./office-search";
import { OFFICE_WHATSAPP_NUMBER, customerWhatsappLink, officeWhatsappLink, saudiMobile, sendWhatsApp, whatsappConfigured } from "./whatsapp";

// Conversations between a customer and the office: one thread per service
// request (hbs_request_messages) and one per inquiry (hbs_inquiry_messages,
// opened by the inquiry's own text). Routes and the WhatsApp webhook record
// messages through recordMessage, and afterMessageRecorded tells the other
// side: a live "thread" event on the notification stream and the usual
// notification pipeline. Read markers (hbs_thread_reads) give unread counts.

export type ThreadType = "request" | "inquiry";
export type ThreadRef = { type: ThreadType; id: number };
export type AuthorRole = "customer" | "office";
export type MessageChannel = "portal" | "whatsapp";
// A customer viewer may act for a company (customerId = the owner whose
// threads they see); read markers stay their own (userId).
export type Viewer = { userId: string; role: AuthorRole; customerId?: string };
const ownerOf = (viewer: Viewer): string | null => (viewer.role === "customer" ? viewer.customerId ?? viewer.userId : null);
export type MessageRow = { id: number; authorId: string; authorRole: string; body: string; channel: string; createdAt: Date };
// For inquiries, whether this office message was the first answer (the
// inquiry's answer column was empty): it is announced as inquiry.answered.
export type RecordedMessage = MessageRow & { firstAnswer: boolean };
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ThreadInfo = {
  type: ThreadType;
  id: number;
  customerUserId: string;
  reference: string;
  title: string;
  status: string;
  createdAt: Date;
  request: HbsServiceRequest | null;
  inquiry: HbsInquiry | null;
};

export const MESSAGES_PER_10_MINUTES = 20;
export const MAX_THREAD_MESSAGES = 500;
const PREVIEW_LENGTH = 120;
// Largest value of a Postgres integer column; larger IDs cannot exist.
const MAX_ID = 2_147_483_647;

export function inquiryReference(id: number): string {
  return `استفسار #${id}`;
}

// The text a customer's WhatsApp message starts with so the webhook can
// file it under the right thread: «طلب HBS-2026-00012: » or «استفسار #7: ».
export function followUpText(info: Pick<ThreadInfo, "type" | "reference">): string {
  return info.type === "request" ? `طلب ${info.reference}: ` : `${info.reference}: `;
}

// The customer's follow-up link: the office number with the reference prefilled.
export function officeFollowUpLink(info: Pick<ThreadInfo, "type" | "reference">) {
  const text = followUpText(info);
  return { link: officeWhatsappLink(text), number: OFFICE_WHATSAPP_NUMBER, text };
}

export function serializeMessage(row: MessageRow) {
  return { id: row.id, authorRole: row.authorRole, body: row.body, channel: row.channel, createdAt: row.createdAt };
}

export function isThreadType(value: unknown): value is ThreadType {
  return value === "request" || value === "inquiry";
}

function threadInfoOf(record: HbsServiceRequest | HbsInquiry, type: ThreadType): ThreadInfo {
  if (type === "request") {
    const request = record as HbsServiceRequest;
    return {
      type, id: request.id, customerUserId: request.userId, reference: requestReference(request.id, request.createdAt),
      title: request.service, status: request.status, createdAt: request.createdAt, request, inquiry: null,
    };
  }
  const inquiry = record as HbsInquiry;
  return {
    type, id: inquiry.id, customerUserId: inquiry.userId, reference: inquiryReference(inquiry.id),
    title: inquiry.subject, status: inquiry.status, createdAt: inquiry.createdAt, request: null, inquiry,
  };
}

// The thread, if the viewer may see it: a customer's own, or any for staff.
// Missing and other-account threads look the same (null).
export async function loadThread(thread: ThreadRef, viewer: Viewer): Promise<ThreadInfo | null> {
  if (!Number.isInteger(thread.id) || thread.id < 1 || thread.id > MAX_ID) return null;
  const owned = ownerOf(viewer);
  if (thread.type === "request") {
    const [record] = await db.select().from(hbsServiceRequests).where(and(
      eq(hbsServiceRequests.id, thread.id), owned ? eq(hbsServiceRequests.userId, owned) : undefined)).limit(1);
    return record ? threadInfoOf(record, "request") : null;
  }
  const [record] = await db.select().from(hbsInquiries).where(and(
    eq(hbsInquiries.id, thread.id), owned ? eq(hbsInquiries.userId, owned) : undefined)).limit(1);
  return record ? threadInfoOf(record, "inquiry") : null;
}

// ---- recording -------------------------------------------------------------------

export async function recordMessage(executor: Executor, input: {
  thread: ThreadRef; authorId: string; authorRole: AuthorRole; body: string; channel?: MessageChannel;
}): Promise<RecordedMessage> {
  const { thread, authorId, authorRole, body, channel = "portal" } = input;
  if (thread.type === "request") {
    const [row] = await executor.insert(hbsRequestMessages).values({ requestId: thread.id, authorId, authorRole, body, channel }).returning();
    return { ...row, firstAnswer: false };
  }
  const [row] = await executor.insert(hbsInquiryMessages).values({ inquiryId: thread.id, authorId, authorRole, body, channel }).returning();
  if (authorRole === "customer") {
    // The customer wrote again: the inquiry needs the office's attention.
    await executor.update(hbsInquiries).set({ status: "open" }).where(eq(hbsInquiries.id, thread.id));
    return { ...row, firstAnswer: false };
  }
  // Older screens read answer/answered_at: the first office message fills
  // them and every office message marks the inquiry answered.
  const [before] = await executor.select({ answer: hbsInquiries.answer }).from(hbsInquiries).where(eq(hbsInquiries.id, thread.id)).limit(1);
  const firstAnswer = before?.answer == null;
  await executor.update(hbsInquiries).set({
    status: "answered",
    ...(firstAnswer ? { answer: body, answeredAt: row.createdAt } : {}),
  }).where(eq(hbsInquiries.id, thread.id));
  return { ...row, firstAnswer };
}

// Messages by one author in a thread during the last ten minutes, for the
// per-thread flood limit (MESSAGES_PER_10_MINUTES).
export async function recentMessagesBy(thread: ThreadRef, authorId: string): Promise<number> {
  const [{ recent }] = thread.type === "request"
    ? await db.select({ recent: sql<number>`count(*)::int` }).from(hbsRequestMessages).where(and(
      eq(hbsRequestMessages.requestId, thread.id), eq(hbsRequestMessages.authorId, authorId),
      sql`${hbsRequestMessages.createdAt} > now() - interval '10 minutes'`))
    : await db.select({ recent: sql<number>`count(*)::int` }).from(hbsInquiryMessages).where(and(
      eq(hbsInquiryMessages.inquiryId, thread.id), eq(hbsInquiryMessages.authorId, authorId),
      sql`${hbsInquiryMessages.createdAt} > now() - interval '10 minutes'`));
  return recent;
}

// The whole conversation, oldest first. An inquiry thread opens with the
// inquiry's own text (id 0) and, for inquiries answered before threads
// existed, the stored answer (id -1); later messages are real rows.
export async function listThreadMessages(info: ThreadInfo): Promise<MessageRow[]> {
  if (info.type === "request") {
    return db.select().from(hbsRequestMessages).where(eq(hbsRequestMessages.requestId, info.id))
      .orderBy(hbsRequestMessages.createdAt, hbsRequestMessages.id).limit(MAX_THREAD_MESSAGES);
  }
  const inquiry = info.inquiry!;
  const rows = await db.select().from(hbsInquiryMessages).where(eq(hbsInquiryMessages.inquiryId, info.id))
    .orderBy(hbsInquiryMessages.createdAt, hbsInquiryMessages.id).limit(MAX_THREAD_MESSAGES);
  const opening: MessageRow = { id: 0, authorId: inquiry.userId, authorRole: "customer", body: inquiry.message, channel: "portal", createdAt: inquiry.createdAt };
  const legacyAnswer: MessageRow[] = inquiry.answer != null && !rows.some(row => row.authorRole === "office")
    ? [{ id: -1, authorId: "", authorRole: "office", body: inquiry.answer, channel: "portal", createdAt: inquiry.answeredAt ?? inquiry.createdAt }]
    : [];
  return [opening, ...legacyAnswer, ...rows];
}

// ---- unread and read markers -----------------------------------------------------

const other = (role: AuthorRole): AuthorRole => (role === "customer" ? "office" : "customer");

// Unread messages across every thread the viewer can see: messages by the
// other side newer than the viewer's read marker (all of them without one).
// An inquiry's opening text counts for staff like any customer message.
export async function unreadTotal(viewer: Viewer): Promise<number> {
  const from = other(viewer.role);
  const owner = ownerOf(viewer);
  const requests = owner ? sql`r.user_id = ${owner}` : sql`true`;
  const inquiries = owner ? sql`i.user_id = ${owner}` : sql`true`;
  const openings = viewer.role === "office"
    ? sql`(select count(*) from hbs_inquiries i
        left join hbs_thread_reads tr on tr.user_id = ${viewer.userId} and tr.thread_type = 'inquiry' and tr.thread_id = i.id
        where i.created_at > coalesce(tr.last_read_at, 'epoch'::timestamptz))`
    : sql`0`;
  const result = await db.execute<{ total: number }>(sql`select ((
      select count(*) from hbs_request_messages m join hbs_service_requests r on r.id = m.request_id
      left join hbs_thread_reads tr on tr.user_id = ${viewer.userId} and tr.thread_type = 'request' and tr.thread_id = r.id
      where ${requests} and m.author_role = ${from} and m.created_at > coalesce(tr.last_read_at, 'epoch'::timestamptz)
    ) + (
      select count(*) from hbs_inquiry_messages m join hbs_inquiries i on i.id = m.inquiry_id
      left join hbs_thread_reads tr on tr.user_id = ${viewer.userId} and tr.thread_type = 'inquiry' and tr.thread_id = i.id
      where ${inquiries} and m.author_role = ${from} and m.created_at > coalesce(tr.last_read_at, 'epoch'::timestamptz)
    ) + ${openings})::int as total`);
  return result.rows[0]?.total ?? 0;
}

// Marks the thread read up to now. Null when the viewer cannot see it.
export async function markRead(viewer: Viewer, thread: ThreadRef): Promise<{ unread: number; unreadTotal: number } | null> {
  const info = await loadThread(thread, viewer);
  if (!info) return null;
  await db.insert(hbsThreadReads).values({ userId: viewer.userId, threadType: thread.type, threadId: thread.id, lastReadAt: new Date() })
    .onConflictDoUpdate({ target: [hbsThreadReads.userId, hbsThreadReads.threadType, hbsThreadReads.threadId], set: { lastReadAt: new Date() } });
  return { unread: 0, unreadTotal: await unreadTotal(viewer) };
}

// ---- the inbox ---------------------------------------------------------------------

export type ThreadListParams = { q?: string; unread?: boolean; type?: ThreadType; page?: number; pageSize?: number };

export type ThreadSummary = {
  type: ThreadType;
  id: number;
  reference: string;
  title: string;
  status: string;
  lastMessage: { authorRole: AuthorRole; preview: string; channel: MessageChannel; createdAt: Date } | null;
  unread: number;
  updatedAt: Date;
  whatsapp: { link: string | null; number: string | null; verified: boolean };
  customer: OfficeCustomer | null;
};

type ThreadRowRaw = {
  type: ThreadType; id: number; customer_user_id: string; reference: string; title: string; status: string;
  last_author_role: AuthorRole | null; last_body: string | null; last_channel: MessageChannel | null; last_at: Date | null;
  updated_at: Date; unread: number; full_name: string | null; email: string | null;
  whatsapp_phone: string | null; whatsapp_verified: boolean | null; whatsapp_opt_in: boolean | null; total: number;
};

// The office can message a customer on WhatsApp only at a number the
// customer verified and opted in with (lib/whatsapp.ts sends there).
function officeSideWhatsapp(settings: { phone: string | null; verified: boolean | null; optIn: boolean | null }) {
  const number = settings.verified && settings.optIn && settings.phone ? saudiMobile(settings.phone) : null;
  return { link: number && settings.phone ? customerWhatsappLink(settings.phone) : null, number, verified: number !== null };
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

// Every thread the viewer can see, most recently active first: requests and
// inquiries side by side, each with its last message, the viewer's unread
// count and the WhatsApp follow-up link for their side.
export async function listThreads(viewer: Viewer, params: ThreadListParams = {}): Promise<{ items: ThreadSummary[]; total: number; unreadTotal: number }> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  const from = other(viewer.role);
  const owner = ownerOf(viewer);
  const owned = (column: string): SQL => (owner ? sql.raw(`${column} = `).append(sql`${owner}`) : sql`true`);
  const reads = (type: ThreadType, idColumn: string) =>
    sql`left join hbs_thread_reads tr on tr.user_id = ${viewer.userId} and tr.thread_type = ${type} and tr.thread_id = ${sql.raw(idColumn)}`;
  const requests = sql`select 'request' as type, r.id, r.user_id as customer_user_id,
      concat('HBS-', extract(year from r.created_at at time zone 'Asia/Riyadh')::int, '-', lpad(r.id::text, 5, '0')) as reference,
      r.service as title, r.status,
      lm.author_role as last_author_role, lm.body as last_body, lm.channel as last_channel, lm.created_at as last_at,
      coalesce(lm.created_at, r.created_at) as updated_at,
      (select count(*)::int from hbs_request_messages m where m.request_id = r.id and m.author_role = ${from}
        and m.created_at > coalesce(tr.last_read_at, 'epoch'::timestamptz)) as unread
    from hbs_service_requests r
    left join lateral (select m.author_role, m.body, m.channel, m.created_at from hbs_request_messages m
      where m.request_id = r.id order by m.created_at desc, m.id desc limit 1) lm on true
    ${reads("request", "r.id")}
    where ${owned("r.user_id")}`;
  // The inquiry's own text is the opening customer message: it is the last
  // message while nobody replied and counts as unread for staff.
  const openingUnread = viewer.role === "office" ? sql`case when i.created_at > coalesce(tr.last_read_at, 'epoch'::timestamptz) then 1 else 0 end` : sql`0`;
  const inquiries = sql`select 'inquiry' as type, i.id, i.user_id as customer_user_id,
      concat('استفسار #', i.id) as reference, i.subject as title, i.status,
      coalesce(lm.author_role, 'customer') as last_author_role, coalesce(lm.body, i.message) as last_body,
      coalesce(lm.channel, 'portal') as last_channel, coalesce(lm.created_at, i.created_at) as last_at,
      coalesce(lm.created_at, i.created_at) as updated_at,
      ((select count(*)::int from hbs_inquiry_messages m where m.inquiry_id = i.id and m.author_role = ${from}
        and m.created_at > coalesce(tr.last_read_at, 'epoch'::timestamptz)) + ${openingUnread}) as unread
    from hbs_inquiries i
    left join lateral (select m.author_role, m.body, m.channel, m.created_at from hbs_inquiry_messages m
      where m.inquiry_id = i.id order by m.created_at desc, m.id desc limit 1) lm on true
    ${reads("inquiry", "i.id")}
    where ${owned("i.user_id")}`;
  const sources = params.type === "request" ? requests : params.type === "inquiry" ? inquiries : sql`${requests} union all ${inquiries}`;
  // Literal substring matching (like the office lists); staff also match the
  // customer's registered name or email.
  const text = params.q?.trim();
  const matches = (column: string) => sql`position(lower(${text}) in lower(coalesce(${sql.raw(column)}, ''))) > 0`;
  const search = text
    ? sql`(${matches("t.reference")} or ${matches("t.title")} or ${matches("t.last_body")}${viewer.role === "office"
      ? sql` or ${matches("c.full_name")} or ${matches("c.email")}` : sql``})`
    : sql`true`;
  const result = await db.execute<ThreadRowRaw>(sql`with t as (${sources})
    select t.*, c.full_name, c.email, s.whatsapp_phone, s.whatsapp_verified, s.whatsapp_opt_in, count(*) over()::int as total
    from t
    left join hbs_registration_requests c on c.user_id = t.customer_user_id
    left join hbs_customer_settings s on s.user_id = t.customer_user_id
    where ${search} and ${params.unread ? sql`t.unread > 0` : sql`true`}
    order by t.updated_at desc, t.id desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`);
  const items = result.rows.map((row): ThreadSummary => ({
    type: row.type,
    id: row.id,
    reference: row.reference,
    title: row.title,
    status: row.status,
    lastMessage: row.last_at && row.last_author_role && row.last_body != null
      ? { authorRole: row.last_author_role, preview: preview(row.last_body), channel: row.last_channel ?? "portal", createdAt: new Date(row.last_at) }
      : null,
    unread: row.unread,
    updatedAt: new Date(row.updated_at),
    whatsapp: viewer.role === "customer"
      ? { ...officeFollowUpLink({ type: row.type, reference: row.reference }), verified: true }
      : officeSideWhatsapp({ phone: row.whatsapp_phone, verified: row.whatsapp_verified, optIn: row.whatsapp_opt_in }),
    customer: viewer.role === "office" ? officeCustomer(row.full_name, row.email) : null,
  }));
  return { items, total: result.rows[0]?.total ?? 0, unreadTotal: await unreadTotal(viewer) };
}

// ---- WhatsApp from the office -------------------------------------------------------

// Injectable for tests; production sends through the Cloud API.
let whatsappSender: typeof sendWhatsApp = sendWhatsApp;
export function setWhatsappSender(sender: typeof sendWhatsApp | null): void {
  whatsappSender = sender ?? sendWhatsApp;
}

export const WHATSAPP_OFF_ERROR = "خدمة واتساب غير مفعّلة على الخادم.";
export const WHATSAPP_UNVERIFIED_ERROR = "لا يملك العميل رقم واتساب موثّقًا ومفعّلًا للمراسلة.";
export const WHATSAPP_SEND_FAILED_ERROR = "تعذّر إرسال الرسالة عبر واتساب. حاول مرة أخرى.";

// Sends an office message to the customer's verified, opted-in number (free
// text inside the customer's 24-hour window, the template otherwise). The
// text starts with the thread's reference so a reply can be routed back.
// 409 when the customer cannot be reached that way, 502 when Meta refused.
export async function sendViaWhatsapp(info: ThreadInfo, body: string): Promise<{ ok: true } | { ok: false; status: 409 | 502; error: string }> {
  if (!whatsappConfigured()) return { ok: false, status: 409, error: WHATSAPP_OFF_ERROR };
  const [settings] = await db.select().from(hbsCustomerSettings).where(eq(hbsCustomerSettings.userId, info.customerUserId)).limit(1);
  const { number } = officeSideWhatsapp({ phone: settings?.whatsappPhone ?? null, verified: settings?.whatsappVerified ?? null, optIn: settings?.whatsappOptIn ?? null });
  if (!number) return { ok: false, status: 409, error: WHATSAPP_UNVERIFIED_ERROR };
  // A template variable allows no line breaks and at most 1024 characters.
  const text = `${followUpText(info)}${body}`.replace(/[\t\r\n]+/g, " ").slice(0, 1024);
  const sent = await whatsappSender(number, text, settings?.lastInboundAt ?? null);
  return sent ? { ok: true } : { ok: false, status: 502, error: WHATSAPP_SEND_FAILED_ERROR };
}

// ---- after a message is saved -------------------------------------------------------

async function assigneeEmail(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [member] = await db.select({ email: hbsOfficeStaff.email }).from(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, userId)).limit(1);
  return member ? member.email ?? approvedOfficeEmail() : null;
}

// Like notifyCustomer (lib/customer-contact.ts), but a message that already
// went out on WhatsApp is not announced there a second time.
async function notifyCustomerMessage(userId: string, build: (to: string | null) => Mail | null, meta: NotifyMeta, whatsapp: boolean): Promise<void> {
  try {
    const email = await customerEmail(userId);
    const mail = build(email);
    const copy = mail ?? build("in-app-only");
    if (!copy) return;
    await publishCustomer(userId, {
      ...meta, title: copy.heading, body: copy.lines.join(" "), path: copy.action?.path ?? null, action: copy.action ?? null, mail, whatsapp,
    });
  } catch (err) {
    logger.warn({ err, kind: meta.kind }, "Customer notification failed");
  }
}

// The live "thread" event for everyone on the other side who is listening,
// each with their own unread total. The WhatsApp webhook and the office's
// WhatsApp reply call this directly; the portal routes through
// afterMessageRecorded. Never throws.
export async function emitThreadEvent(thread: ThreadRef, authorRole: AuthorRole, customerUserId: string): Promise<void> {
  try {
    const fromCustomer = authorRole === "customer";
    const recipients = fromCustomer
      ? (await db.select({ userId: hbsOfficeStaff.userId }).from(hbsOfficeStaff)).map(staff => staff.userId)
      : [customerUserId];
    for (const userId of recipients) {
      if (!subscriberCount(userId)) continue;
      const total = await unreadTotal({ userId, role: fromCustomer ? "office" : "customer" });
      emit(userId, { type: "thread", data: { type: thread.type, id: thread.id, unreadTotal: total } });
    }
  } catch (err) {
    logger.warn({ err, thread }, "Thread event failed");
  }
}

// The live event, then the notification pipeline for the other side. Runs
// after the response; nothing here fails the request that caused it.
export async function afterMessageRecorded(thread: ThreadRef, row: RecordedMessage, opts: { customerUserId: string; info?: ThreadInfo }): Promise<void> {
  try {
    const info = opts.info ?? await loadThread(thread, { userId: opts.customerUserId, role: "office" });
    if (!info) return;
    const fromCustomer = row.authorRole === "customer";
    await emitThreadEvent(thread, fromCustomer ? "customer" : "office", opts.customerUserId);
    const signals = { text: row.body };
    if (info.type === "request") {
      const request = { id: info.id, reference: info.reference, service: info.title };
      const meta = { targetType: "service_request", targetId: info.id, signals };
      if (fromCustomer) {
        const to = await assigneeEmail(info.request?.assignedTo ?? null);
        await notifyOffice(() => officeMessageMail(to, request), { kind: "office.message_new", ...meta });
      } else {
        await notifyCustomerMessage(opts.customerUserId, to => customerMessageMail(to, request), { kind: "request.message", ...meta }, row.channel !== "whatsapp");
      }
      return;
    }
    const meta = { targetType: "inquiry", targetId: info.id, signals };
    if (fromCustomer) {
      await notifyOffice(() => officeInquiryMessageMail(info.id, info.title), { kind: "office.inquiry_message", ...meta });
    } else if (row.firstAnswer) {
      await notifyCustomerMessage(opts.customerUserId, to => inquiryAnsweredMail(to, info.title), { kind: "inquiry.answered", ...meta }, row.channel !== "whatsapp");
    } else {
      await notifyCustomerMessage(opts.customerUserId, to => customerInquiryMessageMail(to, info.id, info.title), { kind: "inquiry.message", ...meta }, row.channel !== "whatsapp");
    }
  } catch (err) {
    logger.warn({ err, thread }, "Message follow-up failed");
  }
}
