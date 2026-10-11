import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  db, hbsCompanies, hbsCompanyEmployees, hbsCompanyLicenses, hbsDocumentReminders,
  type HbsCompany, type HbsCompanyEmployee, type HbsCompanyLicense,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const MAX_EMPLOYEES = 500;
export const MAX_LICENSES = 100;

export const licenseKindLabels: Record<string, string> = {
  commercial_register: "السجل التجاري",
  municipal: "رخصة البلدية",
  civil_defense: "رخصة الدفاع المدني",
  chamber: "عضوية الغرفة التجارية",
  gosi: "شهادة التأمينات",
  zakat_vat: "شهادة الزكاة والضريبة",
  other: "ترخيص",
};

// ---- input checks -------------------------------------------------------------

const clean = (value: string | null | undefined) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text : null;
};

// Saudi national ID (starts with 1) or iqama number (starts with 2): 10 digits.
export function validIdNumber(value: string): boolean {
  return /^[12]\d{9}$/.test(value);
}
export function validPassportNumber(value: string): boolean {
  return /^[A-Z0-9]{5,20}$/.test(value);
}

export function calendarDate(raw: unknown, field = "التاريخ"): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const invalid = new InputError(`${field} غير صحيح؛ اكتبه بالصيغة YYYY-MM-DD بالتقويم الميلادي.`);
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw invalid;
  const date = new Date(`${raw}T00:00:00Z`);
  const year = Number(raw.slice(0, 4));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw || year < 1950 || year > 2100) throw invalid;
  return raw;
}

// The message is shown to the person who entered the data (Arabic).
export class InputError extends Error {
  constructor(message = "تحقق من البيانات.") { super(message); }
}

export function companyValues(body: Record<string, unknown>) {
  const name = clean(body.name as string);
  if (!name || name.length < 2) throw new InputError("اكتب اسم المنشأة.");
  const digits = (v: unknown) => {
    const text = clean(v as string | null)?.replace(/\s/g, "") ?? null;
    if (text && !/^\d{5,20}$/.test(text)) throw new InputError("السجل التجاري والرقم الموحد والرقم الضريبي أرقام فقط.");
    return text;
  };
  return {
    name,
    crNumber: digits(body.crNumber),
    unifiedNumber: digits(body.unifiedNumber),
    vatNumber: digits(body.vatNumber),
    city: clean(body.city as string),
    address: clean(body.address as string),
    activity: clean(body.activity as string),
    contactName: clean(body.contactName as string),
    contactPhone: clean(body.contactPhone as string),
    notes: clean(body.notes as string),
  };
}

// Numbers: omitted keeps the stored value, null clears it.
export function employeeValues(body: Record<string, unknown>) {
  const fullName = clean(body.fullName as string);
  if (!fullName || fullName.length < 2) throw new InputError("اسم الموظف مطلوب.");
  const number = (raw: unknown, check: (v: string) => boolean, message: string) => {
    if (raw === undefined) return undefined;
    const text = clean(raw === null ? null : String(raw))?.replace(/\s/g, "").toUpperCase() ?? null;
    if (text && !check(text)) throw new InputError(message);
    return text;
  };
  const values = {
    fullName,
    nationality: clean(body.nationality as string),
    occupation: clean(body.occupation as string),
    iqamaExpiresOn: calendarDate(body.iqamaExpiresOn, "تاريخ انتهاء الإقامة") ?? null,
    passportExpiresOn: calendarDate(body.passportExpiresOn, "تاريخ انتهاء الجواز") ?? null,
    workPermitExpiresOn: calendarDate(body.workPermitExpiresOn, "تاريخ انتهاء رخصة العمل") ?? null,
    phone: clean(body.phone as string),
    status: body.status === "left" ? "left" as const : "active" as const,
    notes: clean(body.notes as string),
  };
  const idNumber = number(body.idNumber, validIdNumber, "رقم الهوية أو الإقامة 10 أرقام يبدأ بـ1 أو 2.");
  const passportNumber = number(body.passportNumber, validPassportNumber, "رقم الجواز من 5 إلى 20 حرفًا أو رقمًا إنجليزيًا.");
  return {
    ...values,
    ...(idNumber !== undefined ? { idNumber } : {}),
    ...(passportNumber !== undefined ? { passportNumber } : {}),
  };
}

export function licenseValues(body: Record<string, unknown>) {
  const title = clean(body.title as string);
  const kind = typeof body.kind === "string" && body.kind in licenseKindLabels ? body.kind : null;
  if (!kind) throw new InputError("نوع الترخيص غير معروف.");
  if (!title || title.length < 2) throw new InputError("اسم الترخيص مطلوب.");
  const issuedOn = calendarDate(body.issuedOn, "تاريخ الإصدار") ?? null;
  const expiresOn = calendarDate(body.expiresOn, "تاريخ الانتهاء") ?? null;
  if (issuedOn && expiresOn && expiresOn < issuedOn) throw new InputError("تاريخ الانتهاء قبل تاريخ الإصدار.");
  return { kind, title, number: clean(body.number == null ? null : String(body.number)), issuedOn, expiresOn, notes: clean(body.notes as string) };
}

// ---- output ------------------------------------------------------------------

export function mask(value: string | null): string | null {
  if (!value) return null;
  return `•••• ${value.slice(-4)}`;
}

export function company(row: HbsCompany) {
  return {
    name: row.name, crNumber: row.crNumber, unifiedNumber: row.unifiedNumber, vatNumber: row.vatNumber,
    city: row.city, address: row.address, activity: row.activity, contactName: row.contactName,
    contactPhone: row.contactPhone, notes: row.notes, updatedAt: row.updatedAt,
  };
}

export function employee(row: HbsCompanyEmployee) {
  return {
    id: row.id, fullName: row.fullName, nationality: row.nationality, occupation: row.occupation,
    idNumberMasked: mask(row.idNumber), passportNumberMasked: mask(row.passportNumber),
    iqamaExpiresOn: row.iqamaExpiresOn, passportExpiresOn: row.passportExpiresOn,
    workPermitExpiresOn: row.workPermitExpiresOn, phone: row.phone, status: row.status, notes: row.notes,
    addedBy: row.createdBy === row.userId ? "customer" as const : "office" as const,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export function license(row: HbsCompanyLicense) {
  return {
    id: row.id, kind: row.kind, title: row.title, number: row.number, issuedOn: row.issuedOn,
    expiresOn: row.expiresOn, notes: row.notes,
    addedBy: row.createdBy === row.userId ? "customer" as const : "office" as const,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export async function companyFile(userId: string) {
  const [[row], employees, licenses] = await Promise.all([
    db.select().from(hbsCompanies).where(eq(hbsCompanies.userId, userId)).limit(1),
    db.select().from(hbsCompanyEmployees).where(eq(hbsCompanyEmployees.userId, userId))
      .orderBy(hbsCompanyEmployees.status, hbsCompanyEmployees.fullName, hbsCompanyEmployees.id),
    db.select().from(hbsCompanyLicenses).where(eq(hbsCompanyLicenses.userId, userId))
      .orderBy(sql`${hbsCompanyLicenses.expiresOn} asc nulls last`, hbsCompanyLicenses.id),
  ]);
  return {
    company: row ? company(row) : null,
    employees: employees.map(employee),
    licenses: licenses.map(license),
  };
}

// ---- reminders ---------------------------------------------------------------

// Keeps the reminders that come from an employee's dates in step with them:
// one reminder per dated document of an active employee. A changed date
// starts that reminder's schedule again; others keep theirs.
export async function syncEmployeeReminders(tx: Tx, row: HbsCompanyEmployee) {
  const wanted = row.status === "active" ? ([
    ["iqama", row.iqamaExpiresOn],
    ["passport", row.passportExpiresOn],
    ["work_permit", row.workPermitExpiresOn],
  ] as const).filter(([, date]) => date) as [string, string][] : [];
  await tx.delete(hbsDocumentReminders).where(and(
    eq(hbsDocumentReminders.employeeId, row.id),
    wanted.length ? notInArray(hbsDocumentReminders.kind, wanted.map(([kind]) => kind)) : undefined,
  ));
  for (const [kind, expiresOn] of wanted) {
    await tx.insert(hbsDocumentReminders).values({
      userId: row.userId, kind, label: row.fullName, expiresOn, createdBy: row.createdBy, employeeId: row.id,
    }).onConflictDoUpdate({
      target: [hbsDocumentReminders.employeeId, hbsDocumentReminders.kind],
      set: {
        label: row.fullName, expiresOn, updatedAt: new Date(),
        lastReminderDays: sql`case when ${hbsDocumentReminders.expiresOn} = ${expiresOn}::date then ${hbsDocumentReminders.lastReminderDays} else null end`,
      },
    });
  }
}

export async function syncLicenseReminder(tx: Tx, row: HbsCompanyLicense) {
  if (!row.expiresOn) {
    await tx.delete(hbsDocumentReminders).where(eq(hbsDocumentReminders.licenseId, row.id));
    return;
  }
  const kind = row.kind === "commercial_register" ? "commercial_register" : "other";
  const label = row.kind === "commercial_register" || row.kind === "other" ? row.title : `${licenseKindLabels[row.kind]}: ${row.title}`;
  await tx.insert(hbsDocumentReminders).values({
    userId: row.userId, kind, label: label.slice(0, 120), expiresOn: row.expiresOn, createdBy: row.createdBy, licenseId: row.id,
  }).onConflictDoUpdate({
    target: hbsDocumentReminders.licenseId,
    set: {
      kind, label: label.slice(0, 120), expiresOn: row.expiresOn, updatedAt: new Date(),
      lastReminderDays: sql`case when ${hbsDocumentReminders.expiresOn} = ${row.expiresOn}::date then ${hbsDocumentReminders.lastReminderDays} else null end`,
    },
  });
}

// Labels for the employees and licenses requests point to.
export async function subjectLabels(employeeIds: number[], licenseIds: number[]) {
  const [employees, licenses] = await Promise.all([
    employeeIds.length ? db.select({ id: hbsCompanyEmployees.id, name: hbsCompanyEmployees.fullName })
      .from(hbsCompanyEmployees).where(inArray(hbsCompanyEmployees.id, employeeIds)) : [],
    licenseIds.length ? db.select({ id: hbsCompanyLicenses.id, title: hbsCompanyLicenses.title })
      .from(hbsCompanyLicenses).where(inArray(hbsCompanyLicenses.id, licenseIds)) : [],
  ]);
  return {
    employees: new Map(employees.map(e => [e.id, e.name])),
    licenses: new Map(licenses.map(l => [l.id, l.title])),
  };
}

export function subjectOf(
  record: { employeeId: number | null; licenseId: number | null },
  labels: Awaited<ReturnType<typeof subjectLabels>>,
) {
  if (record.employeeId && labels.employees.has(record.employeeId)) {
    return { type: "employee" as const, id: record.employeeId, label: labels.employees.get(record.employeeId)! };
  }
  if (record.licenseId && labels.licenses.has(record.licenseId)) {
    return { type: "license" as const, id: record.licenseId, label: labels.licenses.get(record.licenseId)! };
  }
  return null;
}

