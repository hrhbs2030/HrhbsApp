// One way to write numbers and dates across the product: Arabic month names,
// Gregorian calendar, Western digits (0-9) as on Saudi government platforms.
// Change LOCALE here to switch the whole interface, e.g. 'en-GB' for English.
export const LOCALE = 'ar-u-ca-gregory-nu-latn';

const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const numberFormat = new Intl.NumberFormat(LOCALE);
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateFormat.format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormat.format(date);
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

// Arabic plural for "day": 1 يوم، 2 يومان، 3-10 أيام، 11+ يومًا.
export function daysLabel(days: number): string {
  if (days === 1) return 'يوم واحد';
  if (days === 2) return 'يومان';
  if (days >= 3 && days <= 10) return `${formatNumber(days)} أيام`;
  return `${formatNumber(days)} يومًا`;
}

const moneyFormat = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Amounts from the API are integers in halalas.
export function formatMoney(halalas: number): string {
  return `${moneyFormat.format(halalas / 100)} ر.س`;
}

// A calendar date from the API (YYYY-MM-DD), shown without timezone shifts.
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '-';
  return formatDate(new Date(`${value.slice(0, 10)}T12:00:00`));
}

// Today's date (YYYY-MM-DD) in Riyadh, where the office works and where expiry
// dates are meant. A traveller's or a mis-set device clock must not shift
// "expires today" by a day. en-CA formats as YYYY-MM-DD.
const riyadhDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
export function riyadhToday(): string {
  return riyadhDate.format(new Date(Date.now()));
}

// Whole days from today (Riyadh) to a YYYY-MM-DD date; negative when past.
// Both dates are placed on the UTC axis so the difference is exact days.
export function daysUntil(value: string): number {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = riyadhToday().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

// Riyals typed by a person ("150", "150.5", "١٥٠٫٥", "1,500") to halalas.
// Null when the text is not a plain amount.
export function parseRiyals(text: string): number | null {
  const latin = text.trim().replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫]/g, '.').replace(/[,،\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(latin)) return null;
  return Math.round(Number(latin) * 100);
}
