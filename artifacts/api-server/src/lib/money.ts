// Amounts are integers in halalas (1 riyal = 100 halalas).

// Saudi VAT, 15%. Kept on each invoice, so a later rate change does not
// alter invoices already issued.
export const VAT_RATE_BASIS_POINTS = 1500;

export function vatFor(amountHalalas: number, rateBasisPoints = VAT_RATE_BASIS_POINTS): number {
  return Math.round((amountHalalas * rateBasisPoints) / 10_000);
}

export function riyals(halalas: number): string {
  return `${new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(halalas / 100)} ر.س`;
}

// References carry the year in Riyadh, where the office works: a request
// made on New Year's Eve evening belongs to the year on the office's calendar.
const riyadhYear = (date: Date) => new Intl.DateTimeFormat("en", { timeZone: "Asia/Riyadh", year: "numeric" }).format(date);

export function invoiceReference(id: number, issuedAt: Date): string {
  return `INV-${riyadhYear(issuedAt)}-${String(id).padStart(5, "0")}`;
}

export function requestReference(id: number, createdAt: Date): string {
  return `HBS-${riyadhYear(createdAt)}-${String(id).padStart(5, "0")}`;
}
