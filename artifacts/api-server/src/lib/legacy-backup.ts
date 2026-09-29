import { createHash } from "node:crypto";
import { z } from "zod";

const date = z.string().refine(value => !Number.isNaN(Date.parse(value)));
const text = z.string();
const recordId = z.string().min(1);
const amounts = z.object({
  serviceFee: z.number().finite(), governmentFee: z.number().finite(),
  expenses: z.number().finite(), discount: z.number().finite(), received: z.number().finite(),
});
const client = z.object({
  id: recordId, name: text, phone: text, email: text, notes: text, createdAt: date,
}).passthrough();
const transaction = z.object({
  id: recordId, code: text, section: z.enum(["passports", "labor", "other"]),
  service: text, clientId: text, clientName: text, phone: text, reference: text,
  description: text, status: z.enum(["pending", "in_progress", "waiting_on_client", "completed", "cancelled"]),
  priority: z.enum(["normal", "urgent"]), receivedAt: date, dueAt: date,
  nextFollowUpAt: date, amounts, missingDocuments: text, createdAt: date, updatedAt: date,
  period: text.optional(), duration: text.optional(), receiptDate: text.optional(), notes: text.optional(),
}).passthrough();
const task = z.object({
  id: recordId, transactionId: text, title: text, isCompleted: z.boolean(), dueAt: date, createdAt: date,
}).passthrough();
const note = z.object({
  id: recordId, title: text, content: text, clientId: text.optional(), createdAt: date, updatedAt: date,
}).passthrough();
const backupSchema = z.object({
  format: z.literal("abu-mishal-transactions-backup"),
  version: z.literal(1),
  exportedAt: date,
  data: z.object({
    clients: z.array(client),
    transactions: z.array(transaction),
    tasks: z.array(task),
    notes: z.array(note).optional(),
  }),
});

export type LegacyKind = "clients" | "transactions" | "tasks" | "notes";
export const legacyKinds: LegacyKind[] = ["clients", "transactions", "tasks", "notes"];

export function inspectLegacyBackup(contents: string) {
  let raw: unknown;
  try { raw = JSON.parse(contents); }
  catch { throw new Error("الملف ليس JSON صالحًا."); }
  if (raw && typeof raw === "object" && "format" in raw &&
      raw.format === "abu-mishal-transactions-encrypted-backup") {
    throw new Error("هذه نسخة مشفرة. صدّر نسخة عادية من التطبيق القديم محليًا دون إدخال كلمة المرور في الموقع.");
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) throw new Error("النسخة تالفة أو ليست من إصدار abu-mishal-transactions-backup v1.");
  const backup = parsed.data;
  const records = { ...backup.data, notes: backup.data.notes ?? [] };
  for (const kind of legacyKinds) {
    const ids = records[kind].map(item => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`معرّفات مكررة في ${kind}.`);
  }
  const clients = new Set(records.clients.map(item => item.id));
  const transactions = new Set(records.transactions.map(item => item.id));
  if (records.transactions.some(item => item.clientId && !clients.has(item.clientId)))
    throw new Error("معاملة مرتبطة بمعرّف عميل غير موجود في النسخة.");
  if (records.tasks.some(item => item.transactionId && !transactions.has(item.transactionId)))
    throw new Error("مهمة مرتبطة بمعرّف معاملة غير موجود في النسخة.");
  if (records.notes.some(item => item.clientId && !clients.has(item.clientId)))
    throw new Error("ملاحظة مرتبطة بمعرّف عميل غير موجود في النسخة.");

  const digest = createHash("sha256").update(contents, "utf8").digest("hex");
  const counts = Object.fromEntries(legacyKinds.map(kind => [kind, records[kind].length])) as Record<LegacyKind, number>;
  const ids = Object.fromEntries(legacyKinds.map(kind => [kind, records[kind].map(item => item.id).sort()])) as Record<LegacyKind, string[]>;
  return { exportedAt: backup.exportedAt, digest, counts, ids, records };
}