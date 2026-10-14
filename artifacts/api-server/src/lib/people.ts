import { clerkClient } from "@clerk/express";
import type { HbsInquiry, HbsServiceRequest } from "@workspace/db";

// Display names for "opened by" labels on requests and inquiries that a
// company member or office staff created for the customer. Names come from
// Clerk and are kept briefly so a list does not look each one up again; a
// lookup failure leaves the name unknown (null) without failing the page.

const NAMES_TTL_MS = 5 * 60_000;
const NAMES_MAX = 5_000;
const CLERK_BATCH = 100;
const names = new Map<string, { name: string | null; until: number }>();

type NamedUser = { id: string; firstName?: string | null; lastName?: string | null; username?: string | null };

function nameOf(user: NamedUser): string | null {
  const full = [user.firstName, user.lastName].filter(part => typeof part === "string" && part.trim()).join(" ").trim();
  return full || user.username?.trim() || null;
}

function remember(userId: string, name: string | null) {
  if (names.size >= NAMES_MAX) {
    const now = Date.now();
    for (const [id, entry] of names) if (entry.until <= now) names.delete(id);
    if (names.size >= NAMES_MAX) names.delete(names.keys().next().value!);
  }
  names.set(userId, { name, until: Date.now() + NAMES_TTL_MS });
}

export async function displayNamesOf(userIds: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const now = Date.now();
  const missing: string[] = [];
  for (const id of new Set(userIds)) {
    const cached = names.get(id);
    if (cached && cached.until > now) result.set(id, cached.name);
    else missing.push(id);
  }
  for (let start = 0; start < missing.length; start += CLERK_BATCH) {
    const batch = missing.slice(start, start + CLERK_BATCH);
    try {
      const { data } = await clerkClient.users.getUserList({ userId: batch, limit: batch.length });
      const found = new Map((data as NamedUser[]).map(user => [user.id, nameOf(user)]));
      for (const id of batch) {
        const name = found.get(id) ?? null;
        result.set(id, name);
        remember(id, name);
      }
    } catch {
      // Unknown for now; looked up again next time.
      for (const id of batch) result.set(id, null);
    }
  }
  return result;
}

// Tests forget cached names.
export function forgetDisplayNames() {
  names.clear();
}

export type CreatedBy = { source: "customer" | "member" | "office"; name: string | null };

type Created = Pick<HbsServiceRequest | HbsInquiry, "id" | "createdBy" | "source">;

// The createdBy label for each row someone other than the customer opened.
export async function createdByOf<T extends Created>(rows: T[]): Promise<Map<number, CreatedBy>> {
  const foreign = rows.filter(row => row.source !== "customer" || row.createdBy);
  if (!foreign.length) return new Map();
  const resolved = await displayNamesOf(foreign.flatMap(row => row.createdBy ? [row.createdBy] : []));
  return new Map(foreign.map(row => [row.id, {
    source: row.source === "member" || row.source === "office" ? row.source : "member",
    name: row.createdBy ? resolved.get(row.createdBy) ?? null : null,
  }]));
}
