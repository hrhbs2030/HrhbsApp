export const OFFICE_PAGE_SIZE = 25;

// A request counts as stalled when it is not completed and nobody has
// updated it for this many days.
export const STALE_AFTER_DAYS = 3;

// ILIKE pattern that matches the text literally, so %, _ and \ typed by
// staff are not treated as wildcards.
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

// Staff often paste a reference like "HBS-2026-00041" or type just "41".
// Returns the request ID it points to, or null when the text is not a
// reference.
export function requestIdFromReference(text: string): number | null {
  const match = text.trim().match(/^(?:HBS-\d{4}-)?0*(\d{1,9})$/i);
  if (!match) return null;
  const id = Number(match[1]);
  return id > 0 ? id : null;
}

export type OfficeCustomer = { fullName: string; email: string } | null;

export function officeCustomer(fullName: string | null, email: string | null): OfficeCustomer {
  return fullName && email ? { fullName, email } : null;
}
