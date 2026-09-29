import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import { db, hbsOfficeStaff } from "@workspace/db";
import { officeRoleFor, verifiedEmailOf, type ClerkEmailOwner, type OfficeRole } from "./office-access-rules";

export { officeRoleFor, verifiedEmailOf };
export type { OfficeRole } from "./office-access-rules";

export function approvedOfficeEmail(): string | null {
  return process.env.HBS_OFFICE_EMAIL?.trim().toLowerCase() || null;
}

export async function getOfficeRole(req: Request, bootstrap = false): Promise<OfficeRole | null> {
  const approvedEmail = approvedOfficeEmail();
  const userId = getAuth(req).userId;
  if (!approvedEmail || !userId) return null;

  const [member] = await db.select({ email: hbsOfficeStaff.email })
    .from(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, userId)).limit(1);

  if (!member) {
    if (!bootstrap) return null;
    const owner = (await clerkClient.users.getUserList({ emailAddress: [approvedEmail], limit: 10 }))
      .data.find((candidate) => candidate.id === userId);
    if (!owner || !verifiedEmailOf(owner, approvedEmail)) return null;
    await db.insert(hbsOfficeStaff).values({ userId }).onConflictDoNothing();
    return "owner";
  }

  // Check Clerk on every request. A role row without its currently verified
  // email cannot grant access, and deleting the row revokes access immediately.
  const user = await clerkClient.users.getUser(userId);
  return officeRoleFor(user, approvedEmail, member.email);
}

function requireOfficeRole(allowed: OfficeRole[], deniedMessage: string): RequestHandler {
  return async (req, res, next) => {
    if (!getAuth(req).userId) {
      res.status(401).json({ error: "Sign in to continue" });
      return;
    }
    const role = await getOfficeRole(req);
    if (!role || !allowed.includes(role)) {
      res.status(403).json({ error: deniedMessage });
      return;
    }
    next();
  };
}

export const requireOfficeStaff = requireOfficeRole(["owner", "staff"], "Office access required");
export const requireOfficeOwner = requireOfficeRole(["owner"], "Office owner access required");

const CLERK_USER_BATCH = 100;

export async function clerkUsersById(userIds: string[]): Promise<Map<string, ClerkEmailOwner>> {
  const unique = [...new Set(userIds)];
  const users = new Map<string, ClerkEmailOwner>();
  for (let start = 0; start < unique.length; start += CLERK_USER_BATCH) {
    const batch = unique.slice(start, start + CLERK_USER_BATCH);
    const { data } = await clerkClient.users.getUserList({ userId: batch, limit: batch.length });
    for (const user of data) users.set(user.id, user);
  }
  return users;
}