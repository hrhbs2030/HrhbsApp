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
