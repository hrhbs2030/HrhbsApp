import type { HbsCompanyEmployee, HbsCompanyLicense } from "@workspace/db";
import {
  createEmployeeBodyFullNameMax, createEmployeeBodyIdNumberMax, createEmployeeBodyNationalityMax,
  createEmployeeBodyNotesMax, createEmployeeBodyOccupationMax, createEmployeeBodyPassportNumberMax,
  createEmployeeBodyPhoneMax, createLicenseBodyNotesMax, createLicenseBodyNumberMax, createLicenseBodyTitleMax,
} from "@workspace/api-zod";
import { InputError, employeeValues, licenseValues } from "./company";

// Planning a spreadsheet import: every row is checked and matched against
// the stored file before anything is written, so a file with one bad row
// saves nothing and lists every problem with its row number.

export type Problem = { row: number; message: string };
type EmployeeValues = ReturnType<typeof employeeValues>;
type LicenseValues = ReturnType<typeof licenseValues>;
export type Planned<V> = { create: V[]; update: { id: number; values: Partial<V> }[]; problems: Problem[] };

const blank = (value: unknown) => value === undefined || value === null || (typeof value === "string" && !value.trim());
const nameKey = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

// Only cells that hold something replace stored values: an empty cell keeps
// what the file already has.
function filled<V extends object>(values: V, raw: Record<string, unknown>, always: (keyof V)[]): Partial<V> {
  return Object.fromEntries(Object.entries(values).filter(([key]) =>
    always.includes(key as keyof V) || !blank(raw[key]))) as Partial<V>;
}

// Imported rows skip the request schemas, so the same length limits as the
// forms are applied here, cell by cell.
type Limits = Record<string, { max: number; label: string }>;
const employeeLimits: Limits = {
  fullName: { max: createEmployeeBodyFullNameMax, label: "الاسم" },
  nationality: { max: createEmployeeBodyNationalityMax, label: "الجنسية" },
  occupation: { max: createEmployeeBodyOccupationMax, label: "المهنة" },
  idNumber: { max: createEmployeeBodyIdNumberMax, label: "رقم الهوية" },
  passportNumber: { max: createEmployeeBodyPassportNumberMax, label: "رقم الجواز" },
  phone: { max: createEmployeeBodyPhoneMax, label: "الجوال" },
  notes: { max: createEmployeeBodyNotesMax, label: "الملاحظات" },
};
const licenseLimits: Limits = {
  title: { max: createLicenseBodyTitleMax, label: "اسم الترخيص" },
  number: { max: createLicenseBodyNumberMax, label: "الرقم" },
  notes: { max: createLicenseBodyNotesMax, label: "الملاحظات" },
};
// Dates, status and kind are short by nature; anything longer is not a value.
const OTHER_CELL_MAX = 40;

function cellsTooLong(raw: Record<string, unknown>, limits: Limits): string | null {
  for (const [key, value] of Object.entries(raw)) {
    const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
    const limit = limits[key];
    if (text.length > (limit?.max ?? OTHER_CELL_MAX)) return `${limit?.label ?? "إحدى الخانات"} أطول من المسموح.`;
  }
  return null;
}

function check<V>(make: () => V, row: number, problems: Problem[], raw?: Record<string, unknown>, limits?: Limits): V | null {
  const tooLong = raw && limits ? cellsTooLong(raw, limits) : null;
  if (tooLong) { problems.push({ row, message: tooLong }); return null; }
  try { return make(); } catch (error) {
    problems.push({ row, message: error instanceof InputError ? error.message : "تحقق من بيانات الصف." });
    return null;
  }
}

export function planEmployees(rows: Record<string, unknown>[], existing: HbsCompanyEmployee[]): Planned<EmployeeValues> {
  const plan: Planned<EmployeeValues> = { create: [], update: [], problems: [] };
  const byId = new Map(existing.filter(e => e.idNumber).map(e => [e.idNumber!, e]));
  const byName = new Map<string, HbsCompanyEmployee[]>();
  for (const e of existing) byName.set(nameKey(e.fullName), [...(byName.get(nameKey(e.fullName)) ?? []), e]);
  const seenIds = new Map<string, number>();
  const touched = new Map<number, number>();
  rows.forEach((raw, index) => {
    const row = index + 1;
    // Status comes from the file only when given; imports default to active.
    const values = check(() => employeeValues({ ...raw, status: raw.status ?? "active" }), row, plan.problems, raw, employeeLimits);
    if (!values) return;
    const idNumber = "idNumber" in values ? values.idNumber : null;
    if (idNumber) {
      const first = seenIds.get(idNumber);
      if (first) { plan.problems.push({ row, message: `رقم الهوية مكرر في الملف (الصف ${first}).` }); return; }
      seenIds.set(idNumber, row);
    }
    const sameName = byName.get(nameKey(values.fullName)) ?? [];
    const match = (idNumber && byId.get(idNumber)) || (sameName.length === 1 && (!idNumber || !sameName[0].idNumber) ? sameName[0] : undefined);
    if (!match) { plan.create.push(values); return; }
    const earlier = touched.get(match.id);
    if (earlier) { plan.problems.push({ row, message: `الصف يطابق الموظف نفسه في الصف ${earlier}.` }); return; }
    touched.set(match.id, row);
    plan.update.push({ id: match.id, values: filled(values, raw, ["fullName"]) });
  });
  return plan;
}

export function planLicenses(rows: Record<string, unknown>[], existing: HbsCompanyLicense[]): Planned<LicenseValues> {
  const plan: Planned<LicenseValues> = { create: [], update: [], problems: [] };
  const key = (kind: string, number: string | null, title: string) => number ? `${kind}#${number}` : `${kind}@${nameKey(title)}`;
  const stored = new Map(existing.map(l => [key(l.kind, l.number, l.title), l]));
  const seen = new Map<string, number>();
  rows.forEach((raw, index) => {
    const row = index + 1;
    const values = check(() => licenseValues(raw), row, plan.problems, raw, licenseLimits);
    if (!values) return;
    const k = key(values.kind, values.number, values.title);
    const first = seen.get(k);
    if (first) { plan.problems.push({ row, message: `الترخيص مكرر في الملف (الصف ${first}).` }); return; }
    seen.set(k, row);
    const match = stored.get(k);
    if (match) plan.update.push({ id: match.id, values: filled(values, raw, ["kind", "title"]) });
    else plan.create.push(values);
  });
  return plan;
}
