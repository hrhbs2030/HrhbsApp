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

export function invoiceReference(id: number, issuedAt: Date): string {
  return `INV-${issuedAt.getUTCFullYear()}-${String(id).padStart(5, "0")}`;
}

export function requestReference(id: number, createdAt: Date): string {
  return `HBS-${createdAt.getUTCFullYear()}-${String(id).padStart(5, "0")}`;
}
