// Turns spreadsheet rows (as read from an .xlsx file) into the objects the
// import API expects. Headers are matched by name, in Arabic or English, so
// column order does not matter. Values are only normalised here; the server
// checks every row and reports problems by row number.

export type CellValue = string | number | boolean | Date | null | undefined;
export type ImportKind = 'employees' | 'licenses';

type Column = { key: string; header: string; aliases: string[]; type?: 'date' | 'text' | 'status' | 'kind'; example: string };

export const columns: Record<ImportKind, Column[]> = {
  employees: [
    { key: 'fullName', header: 'الاسم', aliases: ['الاسم الكامل', 'اسم الموظف', 'name', 'full name'], example: 'أحمد محمد علي' },
    { key: 'nationality', header: 'الجنسية', aliases: ['nationality'], example: 'مصر' },
    { key: 'occupation', header: 'المهنة', aliases: ['occupation', 'job', 'profession'], example: 'محاسب' },
    { key: 'idNumber', header: 'رقم الهوية أو الإقامة', aliases: ['رقم الإقامة', 'رقم الهوية', 'الإقامة', 'iqama', 'id number', 'iqama number'], type: 'text', example: '2123456789' },
    { key: 'passportNumber', header: 'رقم الجواز', aliases: ['الجواز', 'passport', 'passport number'], type: 'text', example: 'A1234567' },
    { key: 'iqamaExpiresOn', header: 'انتهاء الإقامة', aliases: ['تاريخ انتهاء الإقامة', 'iqama expiry'], type: 'date', example: '2027-03-15' },
    { key: 'passportExpiresOn', header: 'انتهاء الجواز', aliases: ['تاريخ انتهاء الجواز', 'passport expiry'], type: 'date', example: '2029-01-10' },
    { key: 'workPermitExpiresOn', header: 'انتهاء رخصة العمل', aliases: ['تاريخ انتهاء رخصة العمل', 'رخصة العمل', 'work permit expiry'], type: 'date', example: '2027-03-15' },
    { key: 'phone', header: 'الجوال', aliases: ['رقم الجوال', 'phone', 'mobile'], type: 'text', example: '0551234567' },
    { key: 'status', header: 'الحالة', aliases: ['status'], type: 'status', example: 'على رأس العمل' },
    { key: 'notes', header: 'ملاحظات', aliases: ['notes'], example: '' },
  ],
  licenses: [
    { key: 'kind', header: 'النوع', aliases: ['نوع الترخيص', 'type', 'kind'], type: 'kind', example: 'رخصة البلدية' },
    { key: 'title', header: 'الاسم', aliases: ['الاسم أو الوصف', 'الوصف', 'title', 'name'], example: 'رخصة المحل الرئيسي' },
    { key: 'number', header: 'الرقم', aliases: ['رقم الترخيص', 'number'], type: 'text', example: '43001234' },
    { key: 'issuedOn', header: 'تاريخ الإصدار', aliases: ['الإصدار', 'issued', 'issue date'], type: 'date', example: '2025-04-01' },
    { key: 'expiresOn', header: 'تاريخ الانتهاء', aliases: ['الانتهاء', 'expires', 'expiry date'], type: 'date', example: '2027-04-01' },
    { key: 'notes', header: 'ملاحظات', aliases: ['notes'], example: '' },
  ],
};

const kindNames: Record<string, string> = {
  'السجل التجاري': 'commercial_register', 'سجل تجاري': 'commercial_register', 'رخصة البلدية': 'municipal', 'البلدية': 'municipal', 'بلدي': 'municipal',
  'الدفاع المدني': 'civil_defense', 'الغرفة التجارية': 'chamber', 'الغرفة': 'chamber', 'شهادة التأمينات': 'gosi', 'التأمينات': 'gosi',
  'شهادة الزكاة والضريبة': 'zakat_vat', 'الزكاة والضريبة': 'zakat_vat', 'الزكاة': 'zakat_vat', 'ترخيص آخر': 'other', 'أخرى': 'other', 'آخر': 'other',
};
const kindKeys = new Set(Object.values(kindNames));

const normal = (text: string) => text.replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[_\-:]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
// Eastern Arabic and Persian digits to 0-9.
const latinDigits = (text: string) => text.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0));

const pad = (n: number) => String(n).padStart(2, '0');
// Years outside 1900-2200 (such as Hijri 1448) are not converted.
function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// Excel date cells arrive as Date (UTC midnight) or as serial numbers;
// typed dates as text: 2027-03-15, 2027/3/15, 15/03/2027 or 15-03-2027.
export function toDate(value: CellValue): string | null | CellValue {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = latinDigits(String(value)).trim();
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return iso(+match[1], +match[2], +match[3]) ?? text;
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) return iso(+match[3], +match[2], +match[1]) ?? text;
  // Anything else (a Hijri date, a typo) is sent as written for the server to report.
  return text;
}

function toText(value: CellValue): string | null {
  if (value == null) return null;
  if (value instanceof Date) return toDate(value) as string | null;
  // Numbers typed into cells lose nothing for IDs up to 15 digits.
  const text = latinDigits(typeof value === 'number' ? String(Math.trunc(value) === value ? value.toFixed(0) : value) : String(value)).trim();
  return text || null;
}

export type ParsedSheet = { rows: Record<string, unknown>[]; sheetRows: number[]; missing: string[]; unknown: string[] };

export function sheetToRows(sheet: CellValue[][], kind: ImportKind): ParsedSheet {
  const defs = columns[kind];
  const headerIndex = sheet.findIndex(row => row.some(cell => cell != null && String(cell).trim()));
  const headers = (sheet[headerIndex] ?? []).map(cell => normal(String(cell ?? '')));
  const byIndex = new Map<number, Column>();
  const unknown: string[] = [];
  headers.forEach((header, index) => {
    if (!header) return;
    const def = defs.find(d => [d.header, ...d.aliases].some(name => normal(name) === header));
    if (def && ![...byIndex.values()].includes(def)) byIndex.set(index, def);
    else if (!def) unknown.push(String(sheet[headerIndex][index]));
  });
  const required = kind === 'employees' ? ['fullName'] : ['kind'];
  const missing = required.filter(key => ![...byIndex.values()].some(d => d.key === key)).map(key => defs.find(d => d.key === key)!.header);
  const rows: Record<string, unknown>[] = [];
  const sheetRows: number[] = [];
  sheet.slice(headerIndex + 1).forEach((cells, offset) => {
    if (!cells.some(cell => cell != null && String(cell).trim())) return;
    const row: Record<string, unknown> = {};
    for (const [index, def] of byIndex) {
      const cell = cells[index];
      if (def.type === 'date') row[def.key] = toDate(cell);
      else if (def.type === 'status') row[def.key] = /غادر|left|ترك|منته/i.test(String(cell ?? '')) ? 'left' : 'active';
      else if (def.type === 'kind') {
        const text = String(cell ?? '').trim();
        row[def.key] = kindKeys.has(text) ? text : kindNames[text] ?? Object.entries(kindNames).find(([name]) => normal(name) === normal(text))?.[1] ?? text;
      } else row[def.key] = toText(cell);
    }
    if (kind === 'licenses' && !row.title && typeof row.kind === 'string') {
      row.title = Object.entries(kindNames).find(([, key]) => key === row.kind)?.[0] ?? null;
    }
    rows.push(row);
    sheetRows.push(headerIndex + offset + 2);
  });
  return { rows, sheetRows, missing, unknown };
}
