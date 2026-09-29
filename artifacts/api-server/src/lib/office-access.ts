import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import { db, hbsOfficeStaff } from "@workspace/db";

export type OfficeRole = "owner" | "staff";

export type ClerkEmailOwner = {
  emailAddresses: { emailAddress: string; verification: { status: string } | null }[];
};

export function verifiedEmailOf(user: ClerkEmailOwner | undefined, email: string): string | null {
  return user?.emailAddresses.find(
    (entry) => entry.emailAddress.toLowerCase() === email.toLowerCase() &&
      entry.verification?.status === "verified",
  )?.emailAddress ?? null;
}

export function approvedOfficeEmail(): string | null {
  return process.env.HBS_OFFICE_EMAIL?.trim().toLowerCase() || null;
}

// The owner is whoever holds the verified approved address. A staff row with
// an email grants staff access only while that email stays verified on the
// account; rows without an email were created for the owner and grant
// nothing on their own.
export function officeRoleFor(
  user: ClerkEmailOwner,
  approvedEmail: string,
  memberEmail: string | null,
): OfficeRole | null {
  if (verifiedEmailOf(user, approvedEmail)) return "owner";
  if (memberEmail && verifiedEmailOf(user, memberEmail)) return "staff";
  return null;
}

// Clerk results are reused for a minute per user: staff are re-verified at
// most once a minute, and a customer's frequent /portal/me polling does not
// look up the office email each time. The staff row is still checked on every
// request, so deleting it revokes access immediately.
const OFFICE_ACCESS_TTL_MS = 60_000;
const MAX_CACHED_USERS = 10_000;
const verifiedRoles = new Map<string, { role: OfficeRole; until: number }>();
const bootstrapDeniedUntil = new Map<string, number>();

function prune<T>(cache: Map<string, T>, expiry: (value: T) => number): void {
  if (cache.size < MAX_CACHED_USERS) return;
  const now = Date.now();
  for (const [id, value] of cache) {
    if (expiry(value) <= now) cache.delete(id);
  }
  if (cache.size >= MAX_CACHED_USERS) cache.clear();
}

export function forgetOfficeAccess(userId: string): void {
  verifiedRoles.delete(userId);
  bootstrapDeniedUntil.delete(userId);
}

export async function getOfficeRole(req: Request, bootstrap = false): Promise<OfficeRole | null> {
  const approvedEmail = approvedOfficeEmail();
  const userId = getAuth(req).userId;
  if (!approvedEmail || !userId) return null;

  const [member] = await db.select({ email: hbsOfficeStaff.email })
    .from(hbsOfficeStaff).where(eq(hbsOfficeStaff.userId, userId)).limit(1);
  const now = Date.now();

  if (!member) {
    if (!bootstrap || (bootstrapDeniedUntil.get(userId) ?? 0) > now) return null;
    // A normal customer's /portal/me may provision only the verified owner of
    // the approved address. Do not request arbitrary customer IDs from Clerk.
    const owner = (await clerkClient.users.getUserList({ emailAddress: [approvedEmail], limit: 10 }))
      .data.find((candidate) => candidate.id === userId);
    if (!owner || !verifiedEmailOf(owner, approvedEmail)) {
      prune(bootstrapDeniedUntil, (until) => until);
      bootstrapDeniedUntil.set(userId, now + OFFICE_ACCESS_TTL_MS);
      return null;
    }
    await db.insert(hbsOfficeStaff).values({ userId }).onConflictDoNothing();
    bootstrapDeniedUntil.delete(userId);
    prune(verifiedRoles, (entry) => entry.until);
    verifiedRoles.set(userId, { role: "owner", until: now + OFFICE_ACCESS_TTL_MS });
    return "owner";
  }

  const cached = verifiedRoles.get(userId);
  if (cached && cached.until > now) return cached.role;

  const role = officeRoleFor(await clerkClient.users.getUser(userId), approvedEmail, member.email);
  if (!role) {
    verifiedRoles.delete(userId);
    return null;
  }
  prune(verifiedRoles, (entry) => entry.until);
  verifiedRoles.set(userId, { role, until: now + OFFICE_ACCESS_TTL_MS });
  return role;
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

// One Clerk call per 100 accounts. A deleted Clerk account is simply missing.
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
