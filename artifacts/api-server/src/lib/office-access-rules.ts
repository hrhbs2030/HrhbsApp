export type OfficeRole = "owner" | "staff";

export type ClerkEmailOwner = {
  id: string;
  emailAddresses: { emailAddress: string; verification: { status: string } | null }[];
};

export function verifiedEmailOf(user: ClerkEmailOwner | undefined, email: string): string | null {
  return user?.emailAddresses.find(
    (entry) => entry.emailAddress.toLowerCase() === email.toLowerCase() &&
      entry.verification?.status === "verified",
  )?.emailAddress ?? null;
}

export function officeRoleFor(
  user: ClerkEmailOwner,
  approvedEmail: string,
  memberEmail: string | null,
): OfficeRole | null {
  if (verifiedEmailOf(user, approvedEmail)) return "owner";
  if (memberEmail && verifiedEmailOf(user, memberEmail)) return "staff";
  return null;
}