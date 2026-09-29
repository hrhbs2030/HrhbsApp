import { eq } from "drizzle-orm";
import { db, hbsRegistrationRequests } from "@workspace/db";

// A request's customer-facing reference, e.g. HBS-2026-00041.
export function requestReference(id: number, createdAt: Date): string {
  return `HBS-${createdAt.getUTCFullYear()}-${String(id).padStart(5, "0")}`;
}

// The address the customer registered with, for notifications. Used after
// the response is sent, so a lookup failure only skips the email.
export async function customerEmail(userId: string): Promise<string | null> {
  try {
    const [registration] = await db.select({ email: hbsRegistrationRequests.email })
      .from(hbsRegistrationRequests).where(eq(hbsRegistrationRequests.userId, userId)).limit(1);
    return registration?.email ?? null;
  } catch {
    return null;
  }
}
