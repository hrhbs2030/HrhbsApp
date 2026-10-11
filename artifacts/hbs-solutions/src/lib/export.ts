import type { Employee, License, OfficeServiceRequest } from '@workspace/api-client-react';
import { formatCalendarDate, formatDateTime, formatNumber } from '@/lib/format';

// Tables the office and customers take with them: an .xlsx download or a
// print-ready page (which the browser saves as PDF). The row shaping is pure
// so it can be tested without a DOM; only the two entry points touch the
// browser. write-excel-file is loaded on demand, as in the import panel.

export type ExportColumn = { key: string; label: string; type?: 'text' | 'number' | 'date' | 'datetime' };
// Any object works as a row; cells are read by column key.
export type ExportRow = object;

const field = (row: ExportRow, key: string) => (row as Record<string, unknown>)[key];
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// Excel has no time zone: a serial number is read back as written. Timestamps
// are moved to Riyadh time (UTC+3, no daylight saving) so the sheet reads like
// the office screens; calendar dates land on UTC midnight so they never shift.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

// What a cell holds: the column's declared type, or the value's own shape.
export function cellKind(value: unknown, column: ExportColumn): 'empty' | 'text' | 'number' | 'date' | 'datetime' {
  if (value == null || value === '') return 'empty';
  // A declared type wins: a phone or a masked ID stays text even when all digits.
  if (column.type) return column.type;
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return 'datetime';
  if (typeof value === 'string' && CALENDAR_DATE.test(value)) return 'date';
  if (typeof value === 'string' && TIMESTAMP.test(value)) return 'datetime';
  return 'text';
}

export type SheetCell = { value: string | number | Date; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: 'bold'; backgroundColor?: string } | null;

// One spreadsheet cell: numbers and dates keep their type so Excel can sort,
// filter and sum them; everything else is written as text.
export function toSheetCell(value: unknown, column: ExportColumn): SheetCell {
  switch (cellKind(value, column)) {
    case 'empty': return null;
    case 'number': return { value: Number(value), type: Number };
    case 'date': {
      const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
      return { value: new Date(Date.UTC(y, m - 1, d)), type: Date, format: 'yyyy-mm-dd' };
    }
    case 'datetime': {
      const at = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(at.getTime())) return { value: String(value), type: String };
      return { value: new Date(at.getTime() + RIYADH_OFFSET_MS), type: Date, format: 'yyyy-mm-dd hh:mm' };
    }
    default: return { value: String(value), type: String };
  }
}

// Header row plus one row per record, in column order.
export function shapeSheet(columns: ExportColumn[], rows: ExportRow[]): SheetCell[][] {
  const header = columns.map(c => ({ value: c.label, type: String, fontWeight: 'bold' as const, backgroundColor: '#E2ECE8' }));
  return [header, ...rows.map(row => columns.map(c => toSheetCell(field(row, c.key), c)))];
}

// The same value as a person reads it on screen (for the printed table).
export function displayValue(value: unknown, column: ExportColumn): string {
  switch (cellKind(value, column)) {
    case 'empty': return '-';
    case 'number': return formatNumber(Number(value));
    case 'date': return formatCalendarDate(String(value));
    case 'datetime': return formatDateTime(value instanceof Date ? value : String(value));
    default: return String(value);
  }
}

const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// A complete printable document: title, printed-on line, one table. Numbers
// and dates are set left-to-right inside the right-to-left page.
export function tableHtml(title: string, columns: ExportColumn[], rows: ExportRow[], printedAt = new Date()): string {
  const ltr = (c: ExportColumn, v: unknown) => ['number', 'date', 'datetime'].includes(cellKind(v, c)) ? ' dir="ltr"' : '';
  const head = columns.map(c => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.length
    ? rows.map(row => `<tr>${columns.map(c => `<td${ltr(c, field(row, c.key))}>${esc(displayValue(field(row, c.key), c))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" class="muted">لا توجد بيانات.</td></tr>`;
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Tahoma,Arial,sans-serif;margin:32px;color:#173e42}h1{font-size:20px;margin:0 0 4px}.muted{color:#5d706a;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:12.5px}td,th{border:1px solid #d9d4c5;padding:7px 9px;text-align:right;vertical-align:top}th{background:#f6f4ed}td[dir=ltr]{font-variant-numeric:tabular-nums}@media print{body{margin:12mm}}</style></head><body>
<h1>${esc(title)}</h1><div class="muted">طُبع في ${esc(formatDateTime(printedAt))} · ${esc(formatNumber(rows.length))} صفًا</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
<script>window.onload=()=>window.print()</script></body></html>`;
}

// A new tab holding the given document, printed as soon as it loads. The
// browser's print dialog is where "save as PDF" lives. Null when a popup
// blocker refused the tab, so callers can say so.
export function openPrintWindow(html: string): Window | null {
  const win = window.open('', '_blank');
  if (!win) return null;
  win.document.write(html);
  win.document.close();
  return win;
}

// Download `filename`.xlsx with Arabic headers in a right-to-left sheet.
export async function exportRows(filename: string, columns: ExportColumn[], rows: ExportRow[]): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(shapeSheet(columns, rows), {
    sheet: filename.slice(0, 31), rightToLeft: true,
    columns: columns.map(c => ({ width: Math.max(12, Math.min(40, c.label.length + 6)) })),
  }).toFile(`${filename}.xlsx`);
}

export function printTable(title: string, columns: ExportColumn[], rows: ExportRow[]): boolean {
  return openPrintWindow(tableHtml(title, columns, rows)) !== null;
}

// ---- the tables the site exports ---------------------------------------------------
// Row shaping lives here, away from the components, so it can be checked
// without rendering. Lookups (status names, members) are passed in.

export const employeeStatusNames: Record<string, string> = { active: 'على رأس العمل', left: 'غادر المنشأة' };
export const employeeColumns: ExportColumn[] = [
  { key: 'fullName', label: 'الاسم' }, { key: 'nationality', label: 'الجنسية' }, { key: 'occupation', label: 'المهنة' },
  { key: 'idNumber', label: 'رقم الهوية أو الإقامة', type: 'text' },
  { key: 'iqamaExpiresOn', label: 'انتهاء الإقامة', type: 'date' }, { key: 'passportExpiresOn', label: 'انتهاء الجواز', type: 'date' },
  { key: 'workPermitExpiresOn', label: 'انتهاء رخصة العمل', type: 'date' }, { key: 'status', label: 'الحالة' },
];
// The ID number goes out exactly as shown on screen (last four digits); the
// full number is only revealed one employee at a time and audited.
export function employeeRows(employees: Employee[]): ExportRow[] {
  return employees.map(e => ({
    fullName: e.fullName, nationality: e.nationality, occupation: e.occupation, idNumber: e.idNumberMasked,
    iqamaExpiresOn: e.iqamaExpiresOn?.slice(0, 10) ?? null, passportExpiresOn: e.passportExpiresOn?.slice(0, 10) ?? null,
    workPermitExpiresOn: e.workPermitExpiresOn?.slice(0, 10) ?? null, status: employeeStatusNames[e.status] ?? e.status,
  }));
}

export const licenseColumns: ExportColumn[] = [
  { key: 'kind', label: 'النوع' }, { key: 'title', label: 'الاسم أو الوصف' }, { key: 'number', label: 'الرقم', type: 'text' },
  { key: 'issuedOn', label: 'تاريخ الإصدار', type: 'date' }, { key: 'expiresOn', label: 'تاريخ الانتهاء', type: 'date' }, { key: 'notes', label: 'ملاحظات' },
];
export function licenseRows(licenses: License[], kindNames: Record<string, string>): ExportRow[] {
  return licenses.map(l => ({
    kind: kindNames[l.kind] ?? l.kind, title: l.title, number: l.number,
    issuedOn: l.issuedOn?.slice(0, 10) ?? null, expiresOn: l.expiresOn?.slice(0, 10) ?? null, notes: l.notes,
  }));
}

export const requestColumns: ExportColumn[] = [
  { key: 'reference', label: 'الرقم المرجعي', type: 'text' }, { key: 'service', label: 'الخدمة' }, { key: 'category', label: 'المجال' }, { key: 'status', label: 'الحالة' },
  { key: 'customer', label: 'العميل' }, { key: 'contactPhone', label: 'رقم التواصل', type: 'text' },
  { key: 'createdAt', label: 'تاريخ الإرسال', type: 'datetime' }, { key: 'updatedAt', label: 'آخر تحديث', type: 'datetime' },
  { key: 'dueAt', label: 'موعد الإنجاز', type: 'datetime' }, { key: 'assignee', label: 'المسؤول' },
];
export function requestRows(requests: OfficeServiceRequest[], names: { statusNames: Record<string, string>; categoryNames: Record<string, string>; memberName: (userId: string | null | undefined) => string | null }): ExportRow[] {
  return requests.map(r => ({
    reference: r.reference, service: r.service, category: names.categoryNames[r.category] ?? r.category, status: names.statusNames[r.status] ?? r.status,
    customer: r.customer?.fullName ?? null, contactPhone: r.contactPhone, createdAt: r.createdAt, updatedAt: r.updatedAt, dueAt: r.dueAt,
    assignee: names.memberName(r.assignedTo),
  }));
}
