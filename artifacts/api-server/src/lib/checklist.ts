import { and, eq, ne, sql } from "drizzle-orm";
import { db, hbsRequestAttachments, hbsServiceOffers, hbsServiceRequests, type HbsRequestAttachment } from "@workspace/db";
import { resumeAfterCustomerReply } from "./automations";

// The documents a request needs, as a list the customer ticks off by linking
// an uploaded file to each item. Items are keyed so the office can relabel
// or reorder them without losing which file answers which item.

export type ChecklistItem = { key: string; label: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const MAX_CHECKLIST_ITEMS = 20;
export const CHECKLIST_KEY = /^[a-z0-9_-]{1,40}$/;

// Keys are d1..dn for items copied from the offer and for new office items;
// an item that keeps its key keeps its linked file. Keys of items just
// removed are reserved so a new item never inherits the old item's file.
export function checklistItems(items: { key?: string | null; label: string }[], reserved: string[] = []): ChecklistItem[] {
  const used = new Set([...reserved, ...items.flatMap(item => item.key ? [item.key] : [])]);
  let next = 1;
  return items.flatMap(item => {
    const label = item.label.trim().replace(/\s+/g, " ").slice(0, 120);
    if (!label) return [];
    let key = item.key ?? "";
    if (!key) {
      while (used.has(`d${next}`)) next++;
      key = `d${next++}`;
      used.add(key);
    }
    return [{ key, label }];
  });
}

// The published offer for the service, by catalogue slug when the form sent
// one, else by the service text itself (older clients send only the name).
export async function checklistForService(tx: Tx, serviceSlug: string | null | undefined, service: string): Promise<ChecklistItem[]> {
  const slug = serviceSlug ?? service;
  const [offer] = await tx.select({ requiredDocuments: hbsServiceOffers.requiredDocuments }).from(hbsServiceOffers)
    .where(and(eq(hbsServiceOffers.slug, slug), eq(hbsServiceOffers.published, true))).limit(1);
  return offer ? checklistItems(offer.requiredDocuments.map(label => ({ label }))) : [];
}

// What each item is answered by, for the request's response.
export function checklistOf(items: ChecklistItem[], attachments: Pick<HbsRequestAttachment, "id" | "name" | "checklistKey">[]) {
  return items.map(item => {
    const file = attachments.find(a => a.checklistKey === item.key) ?? null;
    return { key: item.key, label: item.label, attachmentId: file?.id ?? null, attachmentName: file?.name ?? null };
  });
}

// One file per item: linking a file to an item unlinks whatever held it.
// The caller holds the request row locked.
export async function linkChecklist(tx: Tx, requestId: number, attachmentId: number, key: string | null) {
  if (key) {
    await tx.update(hbsRequestAttachments).set({ checklistKey: null })
      .where(and(eq(hbsRequestAttachments.requestId, requestId), eq(hbsRequestAttachments.checklistKey, key), ne(hbsRequestAttachments.id, attachmentId)));
  }
  await tx.update(hbsRequestAttachments).set({ checklistKey: key })
    .where(and(eq(hbsRequestAttachments.id, attachmentId), eq(hbsRequestAttachments.requestId, requestId)));
}

// Every item answered while the office waits on the customer: back to review,
// like a message would. Nothing to do with an empty checklist. The request id
// is table-qualified: an unqualified "id" inside the attachments subquery
// would bind to the attachment's own id.
export async function resumeIfChecklistComplete(requestId: number) {
  const [row] = await db.select({
    complete: sql<boolean>`${hbsServiceRequests.status} = 'waiting_on_customer'
      and jsonb_array_length(${hbsServiceRequests.documentChecklist}) > 0
      and not exists (select 1 from jsonb_array_elements(${hbsServiceRequests.documentChecklist}) item
        where not exists (select 1 from ${hbsRequestAttachments} a
          where a.request_id = ${hbsServiceRequests}.id and a.checklist_key = item->>'key'))`,
  }).from(hbsServiceRequests).where(eq(hbsServiceRequests.id, requestId)).limit(1);
  return row?.complete ? resumeAfterCustomerReply(requestId, "checklist_complete") : null;
}
