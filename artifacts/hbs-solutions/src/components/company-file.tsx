import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import { BadgeCheck, Building2, Eye, EyeOff, FileBadge, Pencil, Plus, RefreshCw, Trash2, UsersRound } from 'lucide-react';
import {
  createEmployee, createLicense, createOfficeCustomerEmployee, createOfficeCustomerLicense,
  deleteEmployee, deleteLicense, deleteOfficeCustomerEmployee, deleteOfficeCustomerLicense,
  getEmployeeNumbers, getOfficeCustomerEmployeeNumbers, saveCompany, saveOfficeCustomerCompany,
  updateEmployee, updateLicense, updateOfficeCustomerEmployee, updateOfficeCustomerLicense,
  type Company, type CompanyFile, type CompanyInput, type Employee, type EmployeeInput, type License,
  type LicenseInput, type LicenseKind,
} from '@workspace/api-client-react';
import { ExpiryBadge } from '@/components/reminder-ui';
import { daysUntil, formatCalendarDate, formatNumber } from '@/lib/format';
import './company-file.css';

// The company file, shared by the customer's page and the office's customer
// file. Only the API functions differ; office changes are audited server-side.

export type CompanyApi = {
  saveCompany: (data: CompanyInput) => Promise<unknown>;
  createEmployee: (data: EmployeeInput) => Promise<unknown>;
  updateEmployee: (id: number, data: EmployeeInput) => Promise<unknown>;
  deleteEmployee: (id: number) => Promise<unknown>;
  employeeNumbers: (id: number) => Promise<{ idNumber: string | null; passportNumber: string | null }>;
  createLicense: (data: LicenseInput) => Promise<unknown>;
  updateLicense: (id: number, data: LicenseInput) => Promise<unknown>;
  deleteLicense: (id: number) => Promise<unknown>;
};

export const customerCompanyApi: CompanyApi = {
  saveCompany, createEmployee, updateEmployee, deleteEmployee, employeeNumbers: getEmployeeNumbers,
  createLicense, updateLicense, deleteLicense,
};

export function officeCompanyApi(userId: string): CompanyApi {
  return {
    saveCompany: data => saveOfficeCustomerCompany(userId, data),
    createEmployee: data => createOfficeCustomerEmployee(userId, data),
    updateEmployee: (id, data) => updateOfficeCustomerEmployee(userId, id, data),
    deleteEmployee: id => deleteOfficeCustomerEmployee(userId, id),
    employeeNumbers: id => getOfficeCustomerEmployeeNumbers(userId, id),
    createLicense: data => createOfficeCustomerLicense(userId, data),
    updateLicense: (id, data) => updateOfficeCustomerLicense(userId, id, data),
    deleteLicense: id => deleteOfficeCustomerLicense(userId, id),
  };
}

export const licenseKindNames: Record<LicenseKind, string> = {
  commercial_register: 'السجل التجاري', municipal: 'رخصة البلدية', civil_defense: 'الدفاع المدني',
  chamber: 'الغرفة التجارية', gosi: 'شهادة التأمينات', zakat_vat: 'شهادة الزكاة والضريبة', other: 'ترخيص آخر',
};

// Where a renewal request starts for each document.
export function employeeRenewal(employee: Employee, doc: 'iqama' | 'passport' | 'work_permit') {
  const service = { iqama: 'iqama-renewal', passport: 'passport-info-update', work_permit: 'work-permit' }[doc];
  return `/requests/new?service=${service}&employee=${employee.id}`;
}
export function licenseRenewal(license: License) {
  if (license.kind === 'municipal') return `/requests/new?service=balady-license-renewal&license=${license.id}`;
  return `/requests/new?category=business&name=${encodeURIComponent(`تجديد ${licenseKindNames[license.kind]}`)}&license=${license.id}`;
}

// The soonest dated document of an employee, for sorting and the summary badge.
export function nearestEmployeeExpiry(e: Employee): { doc: 'iqama' | 'passport' | 'work_permit'; date: string } | null {
  const dates = ([['iqama', e.iqamaExpiresOn], ['passport', e.passportExpiresOn], ['work_permit', e.workPermitExpiresOn]] as const)
    .filter(([, date]) => date) as ['iqama' | 'passport' | 'work_permit', string][];
  if (!dates.length) return null;
  const [doc, date] = dates.sort((a, b) => a[1].localeCompare(b[1]))[0];
  return { doc, date };
}

const docNames = { iqama: 'الإقامة', passport: 'الجواز', work_permit: 'رخصة العمل' } as const;
const errorText = (e: unknown) => (e as { status?: number })?.status === 409 ? 'وصل الملف إلى الحد الأقصى.' : 'تحقق من البيانات وحاول مجددًا. رقم الهوية أو الإقامة 10 أرقام يبدأ بـ1 أو 2.';

function Field({ label, children, wide = false, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return <label className={`form-field ${wide ? 'md:col-span-2' : ''}`}>{label}{children}{hint && <small className="muted font-normal">{hint}</small>}</label>;
}
const text = (v: string) => v.trim() || null;

// ---- company ---------------------------------------------------------------------

function CompanyForm({ company, api, onSaved, onCancel }: { company: Company | null; api: CompanyApi; onSaved: () => void; onCancel?: () => void }) {
  const blank = { name: '', crNumber: '', unifiedNumber: '', vatNumber: '', city: '', address: '', activity: '', contactName: '', contactPhone: '', notes: '' };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setV(company ? Object.fromEntries(Object.keys(blank).map(k => [k, (company as unknown as Record<string, unknown>)[k] ?? ''])) as typeof blank : blank), [company?.updatedAt]);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.saveCompany({ name: v.name.trim(), crNumber: text(v.crNumber), unifiedNumber: text(v.unifiedNumber), vatNumber: text(v.vatNumber), city: text(v.city), address: text(v.address), activity: text(v.activity), contactName: text(v.contactName), contactPhone: text(v.contactPhone), notes: text(v.notes) });
      onSaved();
    } catch { setError('تحقق من الاسم والأرقام (أرقام فقط) وحاول مجددًا.'); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
    <Field label="اسم المنشأة" wide><input className="form-control" value={v.name} onChange={set('name')} required minLength={2} maxLength={160}/></Field>
    <Field label="رقم السجل التجاري"><input className="form-control" dir="ltr" inputMode="numeric" value={v.crNumber} onChange={set('crNumber')} maxLength={20}/></Field>
    <Field label="الرقم الموحد (700)"><input className="form-control" dir="ltr" inputMode="numeric" value={v.unifiedNumber} onChange={set('unifiedNumber')} maxLength={20}/></Field>
    <Field label="الرقم الضريبي"><input className="form-control" dir="ltr" inputMode="numeric" value={v.vatNumber} onChange={set('vatNumber')} maxLength={20}/></Field>
    <Field label="المدينة"><input className="form-control" value={v.city} onChange={set('city')} maxLength={80}/></Field>
    <Field label="النشاط" wide><input className="form-control" value={v.activity} onChange={set('activity')} maxLength={200}/></Field>
    <Field label="العنوان" wide><input className="form-control" value={v.address} onChange={set('address')} maxLength={300}/></Field>
    <Field label="اسم المسؤول"><input className="form-control" value={v.contactName} onChange={set('contactName')} maxLength={120}/></Field>
    <Field label="جوال المسؤول"><input className="form-control text-right" dir="ltr" type="tel" value={v.contactPhone} onChange={set('contactPhone')} maxLength={24}/></Field>
    <Field label="ملاحظات" wide><textarea className="form-control !min-h-20" value={v.notes} onChange={set('notes')} maxLength={1000}/></Field>
    {error && <p role="alert" className="text-sm text-danger md:col-span-2">{error}</p>}
    <div className="flex justify-end gap-2 md:col-span-2">{onCancel && <button type="button" className="btn btn-outline" onClick={onCancel}>إلغاء</button>}<button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ بيانات المنشأة'}</button></div>
  </form>;
}

function CompanyCard({ company, api, onChanged }: { company: Company | null; api: CompanyApi; onChanged: () => void }) {
  const [editing, setEditing] = useState(!company);
  useEffect(() => setEditing(!company), [company === null]);
  if (editing) return <section className="surface p-5 sm:p-7"><h2 className="display mb-5 text-lg font-semibold">{company ? 'تعديل بيانات المنشأة' : 'أضف بيانات منشأتك'}</h2>
    <CompanyForm company={company} api={api} onSaved={() => { setEditing(false); onChanged(); }} onCancel={company ? () => setEditing(false) : undefined}/></section>;
  const rows: [string, string | null, boolean?][] = [
    ['السجل التجاري', company!.crNumber, true], ['الرقم الموحد', company!.unifiedNumber, true], ['الرقم الضريبي', company!.vatNumber, true],
    ['المدينة', company!.city], ['النشاط', company!.activity], ['العنوان', company!.address],
    ['المسؤول', company!.contactName], ['جوال المسؤول', company!.contactPhone, true],
  ];
  return <section className="surface overflow-hidden">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-sage px-5 py-5 sm:px-7">
      <div className="flex items-center gap-3"><span className="cf-icon"><Building2 size={22} aria-hidden="true"/></span><div><h2 className="display text-xl font-semibold">{company!.name}</h2><span className="text-xs text-subtle">آخر تحديث {formatCalendarDate(company!.updatedAt)}</span></div></div>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}><Pencil size={15}/>تعديل</button>
    </div>
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-6 sm:px-7 lg:grid-cols-4">{rows.map(([label, value, ltr]) =>
      <div key={label} className={`min-w-0 ${label === 'الرقم الضريبي' || label === 'العنوان' ? 'col-span-2 lg:col-span-1' : ''}`}><dt className="text-xs font-bold text-subtle">{label}</dt><dd className="m-0 mt-1 break-words font-semibold" dir={ltr && value ? 'ltr' : undefined} style={ltr ? { textAlign: 'right' } : undefined}>{value || '-'}</dd></div>)}</dl>
    {company!.notes && <p className="border-t border-line px-5 py-4 text-sm leading-7 text-quiet sm:px-7">{company!.notes}</p>}
  </section>;
}

// ---- employees -------------------------------------------------------------------

type EmployeeDraft = { fullName: string; nationality: string; occupation: string; idNumber: string; passportNumber: string; clearId: boolean; clearPassport: boolean; iqamaExpiresOn: string; passportExpiresOn: string; workPermitExpiresOn: string; phone: string; status: 'active' | 'left'; notes: string };

function EmployeeForm({ employee, api, onDone }: { employee: Employee | null; api: CompanyApi; onDone: (saved: boolean) => void }) {
  const [v, setV] = useState<EmployeeDraft>({
    fullName: employee?.fullName ?? '', nationality: employee?.nationality ?? '', occupation: employee?.occupation ?? '',
    idNumber: '', passportNumber: '', clearId: false, clearPassport: false,
    iqamaExpiresOn: employee?.iqamaExpiresOn?.slice(0, 10) ?? '', passportExpiresOn: employee?.passportExpiresOn?.slice(0, 10) ?? '',
    workPermitExpiresOn: employee?.workPermitExpiresOn?.slice(0, 10) ?? '', phone: employee?.phone ?? '', status: employee?.status ?? 'active', notes: employee?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof EmployeeDraft) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    // A blank number field keeps the stored number; only typed or cleared numbers are sent.
    const data: EmployeeInput = {
      fullName: v.fullName.trim(), nationality: text(v.nationality), occupation: text(v.occupation),
      iqamaExpiresOn: v.iqamaExpiresOn || null, passportExpiresOn: v.passportExpiresOn || null, workPermitExpiresOn: v.workPermitExpiresOn || null,
      phone: text(v.phone), status: v.status, notes: text(v.notes),
      ...(v.idNumber.trim() ? { idNumber: v.idNumber.trim() } : v.clearId ? { idNumber: null } : !employee ? { idNumber: null } : {}),
      ...(v.passportNumber.trim() ? { passportNumber: v.passportNumber.trim() } : v.clearPassport ? { passportNumber: null } : !employee ? { passportNumber: null } : {}),
    };
    try { employee ? await api.updateEmployee(employee.id, data) : await api.createEmployee(data); onDone(true); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="cf-form grid gap-4 md:grid-cols-3">
    <Field label="الاسم الكامل"><input className="form-control" value={v.fullName} onChange={set('fullName')} required minLength={2} maxLength={120}/></Field>
    <Field label="الجنسية"><input className="form-control" value={v.nationality} onChange={set('nationality')} maxLength={60}/></Field>
    <Field label="المهنة"><input className="form-control" value={v.occupation} onChange={set('occupation')} maxLength={100}/></Field>
    <Field label="رقم الهوية أو الإقامة" hint={employee?.idNumberMasked ? `المحفوظ: ${employee.idNumberMasked}. اتركه فارغًا للإبقاء عليه.` : '10 أرقام'}>
      <input className="form-control" dir="ltr" inputMode="numeric" autoComplete="off" value={v.idNumber} onChange={set('idNumber')} maxLength={10} placeholder={employee?.idNumberMasked ?? ''}/>
      {employee?.idNumberMasked && <span className="flex items-center gap-2 text-xs font-normal"><input type="checkbox" checked={v.clearId} onChange={e => setV({ ...v, clearId: e.target.checked })}/>حذف الرقم المحفوظ</span>}
    </Field>
    <Field label="رقم الجواز" hint={employee?.passportNumberMasked ? `المحفوظ: ${employee.passportNumberMasked}` : undefined}>
      <input className="form-control" dir="ltr" autoComplete="off" value={v.passportNumber} onChange={set('passportNumber')} maxLength={20} placeholder={employee?.passportNumberMasked ?? ''}/>
      {employee?.passportNumberMasked && <span className="flex items-center gap-2 text-xs font-normal"><input type="checkbox" checked={v.clearPassport} onChange={e => setV({ ...v, clearPassport: e.target.checked })}/>حذف الرقم المحفوظ</span>}
    </Field>
    <Field label="الجوال"><input className="form-control text-right" dir="ltr" type="tel" value={v.phone} onChange={set('phone')} maxLength={24}/></Field>
    <Field label="انتهاء الإقامة"><input className="form-control" type="date" dir="ltr" value={v.iqamaExpiresOn} onChange={set('iqamaExpiresOn')}/></Field>
    <Field label="انتهاء الجواز"><input className="form-control" type="date" dir="ltr" value={v.passportExpiresOn} onChange={set('passportExpiresOn')}/></Field>
    <Field label="انتهاء رخصة العمل"><input className="form-control" type="date" dir="ltr" value={v.workPermitExpiresOn} onChange={set('workPermitExpiresOn')}/></Field>
    <Field label="الحالة"><select className="form-control" value={v.status} onChange={e => setV({ ...v, status: e.target.value as 'active' | 'left' })}><option value="active">على رأس العمل</option><option value="left">غادر المنشأة</option></select></Field>
    <Field label="ملاحظات" wide><input className="form-control" value={v.notes} onChange={set('notes')} maxLength={500}/></Field>
    <p className="muted text-xs leading-6 md:col-span-3">تصل تنبيهات قبل انتهاء الإقامة والجواز ورخصة العمل للموظفين على رأس العمل. تظهر الأرقام مخفية، وكشفها من المكتب يُسجَّل.</p>
    {error && <p role="alert" className="text-sm text-danger md:col-span-3">{error}</p>}
    <div className="flex justify-end gap-2 md:col-span-3"><button type="button" className="btn btn-outline" onClick={() => onDone(false)} disabled={busy}>إلغاء</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : employee ? 'حفظ التعديل' : 'إضافة الموظف'}</button></div>
  </form>;
}

function Numbers({ employee, api, office }: { employee: Employee; api: CompanyApi; office: boolean }) {
  const [shown, setShown] = useState<{ idNumber: string | null; passportNumber: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!shown) return; const t = setTimeout(() => setShown(null), 30_000); return () => clearTimeout(t); }, [shown]);
  if (!employee.idNumberMasked && !employee.passportNumberMasked) return null;
  async function toggle() {
    if (shown) { setShown(null); return; }
    setBusy(true);
    try { setShown(await api.employeeNumbers(employee.id)); } finally { setBusy(false); }
  }
  return <span className="cf-numbers">
    {employee.idNumberMasked && <span>الهوية <b dir="ltr" className="cf-num">{shown?.idNumber ?? employee.idNumberMasked}</b></span>}
    {employee.passportNumberMasked && <span>الجواز <b dir="ltr" className="cf-num">{shown?.passportNumber ?? employee.passportNumberMasked}</b></span>}
    <button type="button" className="rf-btn" onClick={toggle} disabled={busy} aria-label={shown ? 'إخفاء الأرقام' : 'إظهار الأرقام'} title={office && !shown ? 'يُسجَّل الإظهار في سجل التدقيق' : undefined}>{shown ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
  </span>;
}

function EmployeesSection({ employees, api, office, onChanged }: { employees: Employee[]; api: CompanyApi; office: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [filter, setFilter] = useState<'active' | 'expiring' | 'left'>('active');
  const [search, setSearch] = useState('');
  const shown = employees.filter(e => filter === 'left' ? e.status === 'left' : e.status === 'active')
    .filter(e => filter !== 'expiring' || ((n => n && daysUntil(n.date) <= 60)(nearestEmployeeExpiry(e))))
    .filter(e => !search.trim() || [e.fullName, e.nationality, e.occupation].some(x => x?.includes(search.trim())));
  const counts = { active: employees.filter(e => e.status === 'active').length, expiring: employees.filter(e => e.status === 'active' && ((n => n && daysUntil(n.date) <= 60)(nearestEmployeeExpiry(e)))).length, left: employees.filter(e => e.status === 'left').length };
  async function remove(e: Employee) {
    if (!window.confirm(`حذف «${e.fullName}» من ملف المنشأة؟ تُحذف تنبيهاته أيضًا.`)) return;
    await api.deleteEmployee(e.id); onChanged();
  }
  return <section className="surface overflow-hidden" aria-labelledby="cf-employees">
    <div className="cf-head"><h2 id="cf-employees" className="display text-lg font-semibold"><UsersRound size={19} aria-hidden="true"/>الموظفون</h2>
      {!editing && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Plus size={16}/>إضافة موظف</button>}</div>
    {editing && <div className="border-b border-line bg-paper p-5 sm:p-6"><EmployeeForm key={editing === 'new' ? 'new' : editing.id} employee={editing === 'new' ? null : editing} api={api} onDone={saved => { setEditing(null); if (saved) onChanged(); }}/></div>}
    <div className="cf-tools">
      <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية الموظفين">{([['active', 'على رأس العمل'], ['expiring', 'وثائق تنتهي خلال 60 يومًا'], ['left', 'غادروا']] as const).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`cf-chip ${filter === key ? 'is-on' : ''}`}>{label}<span className="nums">{formatNumber(counts[key])}</span></button>)}</div>
      <input className="form-control cf-search" placeholder="ابحث بالاسم أو الجنسية أو المهنة" value={search} onChange={e => setSearch(e.target.value)} aria-label="بحث في الموظفين"/>
    </div>
    {!shown.length ? <p className="px-6 py-10 text-center text-sm text-subtle">{employees.length ? 'لا يوجد موظفون مطابقون.' : 'لم يُضَف موظفون بعد. أضف موظفيك لتصلك تنبيهات تجديد وثائقهم.'}</p>
      : <ul className="cf-list">{shown.map(e => {
        const docs = ([['iqama', e.iqamaExpiresOn], ['passport', e.passportExpiresOn], ['work_permit', e.workPermitExpiresOn]] as const).filter(([, d]) => d) as ['iqama' | 'passport' | 'work_permit', string][];
        return <li key={e.id} className="cf-row">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><strong>{e.fullName}</strong>{e.occupation && <span className="text-xs text-subtle">{e.occupation}</span>}{e.nationality && <span className="text-xs text-subtle">· {e.nationality}</span>}{e.addedBy === 'office' && <span className="cf-tag">أضافه المكتب</span>}</div>
            <Numbers employee={e} api={api} office={office}/>
            {docs.length > 0 && <div className="cf-docs">{docs.map(([doc, date]) => <span key={doc} className="cf-doc"><span>{docNames[doc]}</span><span className="text-subtle">{formatCalendarDate(date)}</span><ExpiryBadge expiresOn={date}/>
              {!office && e.status === 'active' && daysUntil(date) <= 60 && <Link href={employeeRenewal(e, doc)} className="cf-renew"><RefreshCw size={13}/>طلب تجديد</Link>}</span>)}</div>}
          </div>
          <div className="flex shrink-0 items-start gap-1">
            <button type="button" className="rf-btn" onClick={() => setEditing(e)} aria-label={`تعديل ${e.fullName}`}><Pencil size={16}/></button>
            <button type="button" className="rf-btn" onClick={() => remove(e)} aria-label={`حذف ${e.fullName}`}><Trash2 size={16}/></button>
          </div>
        </li>;
      })}</ul>}
  </section>;
}

// ---- licenses --------------------------------------------------------------------

function LicenseForm({ license, api, onDone }: { license: License | null; api: CompanyApi; onDone: (saved: boolean) => void }) {
  const [v, setV] = useState({ kind: (license?.kind ?? 'commercial_register') as LicenseKind, title: license?.title ?? '', number: license?.number ?? '', issuedOn: license?.issuedOn?.slice(0, 10) ?? '', expiresOn: license?.expiresOn?.slice(0, 10) ?? '', notes: license?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const data: LicenseInput = { kind: v.kind, title: v.title.trim() || licenseKindNames[v.kind], number: text(v.number), issuedOn: v.issuedOn || null, expiresOn: v.expiresOn || null, notes: text(v.notes) };
    try { license ? await api.updateLicense(license.id, data) : await api.createLicense(data); onDone(true); }
    catch (err) { setError((err as { status?: number })?.status === 409 ? 'وصل الملف إلى الحد الأقصى.' : 'تحقق من البيانات: تاريخ الانتهاء بعد تاريخ الإصدار.'); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
    <Field label="النوع"><select className="form-control" value={v.kind} onChange={e => setV({ ...v, kind: e.target.value as LicenseKind })}>{Object.entries(licenseKindNames).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Field>
    <Field label="الاسم أو الوصف"><input className="form-control" value={v.title} onChange={e => setV({ ...v, title: e.target.value })} maxLength={120} placeholder={licenseKindNames[v.kind]}/></Field>
    <Field label="الرقم"><input className="form-control" dir="ltr" value={v.number} onChange={e => setV({ ...v, number: e.target.value })} maxLength={40}/></Field>
    <Field label="تاريخ الإصدار"><input className="form-control" type="date" dir="ltr" value={v.issuedOn} onChange={e => setV({ ...v, issuedOn: e.target.value })}/></Field>
    <Field label="تاريخ الانتهاء"><input className="form-control" type="date" dir="ltr" value={v.expiresOn} onChange={e => setV({ ...v, expiresOn: e.target.value })}/></Field>
    <Field label="ملاحظات"><input className="form-control" value={v.notes} onChange={e => setV({ ...v, notes: e.target.value })} maxLength={500}/></Field>
    {error && <p role="alert" className="text-sm text-danger md:col-span-3">{error}</p>}
    <div className="flex justify-end gap-2 md:col-span-3"><button type="button" className="btn btn-outline" onClick={() => onDone(false)} disabled={busy}>إلغاء</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : license ? 'حفظ التعديل' : 'إضافة الترخيص'}</button></div>
  </form>;
}

function LicensesSection({ licenses, api, office, onChanged }: { licenses: License[]; api: CompanyApi; office: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<License | 'new' | null>(null);
  async function remove(l: License) {
    if (!window.confirm(`حذف «${l.title}»؟`)) return;
    await api.deleteLicense(l.id); onChanged();
  }
  return <section className="surface overflow-hidden" aria-labelledby="cf-licenses">
    <div className="cf-head"><h2 id="cf-licenses" className="display text-lg font-semibold"><FileBadge size={19} aria-hidden="true"/>التراخيص والشهادات</h2>
      {!editing && <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing('new')}><Plus size={16}/>إضافة ترخيص</button>}</div>
    {editing && <div className="border-b border-line bg-paper p-5 sm:p-6"><LicenseForm key={editing === 'new' ? 'new' : editing.id} license={editing === 'new' ? null : editing} api={api} onDone={saved => { setEditing(null); if (saved) onChanged(); }}/></div>}
    {!licenses.length ? <p className="px-6 py-10 text-center text-sm text-subtle">أضف السجل التجاري ورخصة البلدية والشهادات لتتابع تواريخ انتهائها.</p>
      : <ul className="cf-list">{licenses.map(l => <li key={l.id} className="cf-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><BadgeCheck size={16} className="text-teal" aria-hidden="true"/><strong>{l.title}</strong><span className="text-xs text-subtle">{licenseKindNames[l.kind]}</span>{l.addedBy === 'office' && <span className="cf-tag">أضافه المكتب</span>}</div>
          <div className="cf-docs">{l.number && <span className="cf-doc">الرقم <b dir="ltr" className="nums">{l.number}</b></span>}{l.issuedOn && <span className="cf-doc">أُصدر {formatCalendarDate(l.issuedOn)}</span>}
            {l.expiresOn ? <span className="cf-doc">ينتهي {formatCalendarDate(l.expiresOn)}<ExpiryBadge expiresOn={l.expiresOn}/>{!office && daysUntil(l.expiresOn) <= 60 && <Link href={licenseRenewal(l)} className="cf-renew"><RefreshCw size={13}/>طلب تجديد</Link>}</span> : <span className="cf-doc text-subtle">بلا تاريخ انتهاء</span>}</div>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <button type="button" className="rf-btn" onClick={() => setEditing(l)} aria-label={`تعديل ${l.title}`}><Pencil size={16}/></button>
          <button type="button" className="rf-btn" onClick={() => remove(l)} aria-label={`حذف ${l.title}`}><Trash2 size={16}/></button>
        </div>
      </li>)}</ul>}
  </section>;
}

// ---- the whole file ---------------------------------------------------------------

export function CompanyFileView({ file, api, office = false, onChanged }: { file: CompanyFile; api: CompanyApi; office?: boolean; onChanged: () => void }) {
  return <div className="space-y-6">
    <CompanyCard company={file.company} api={api} onChanged={onChanged}/>
    <EmployeesSection employees={file.employees} api={api} office={office} onChanged={onChanged}/>
    <LicensesSection licenses={file.licenses} api={api} office={office} onChanged={onChanged}/>
  </div>;
}
