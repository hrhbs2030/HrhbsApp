import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookUser, BriefcaseBusiness, Building2, Camera, Check, Lightbulb, Paperclip, Pencil, Send, Shapes, UsersRound, X } from 'lucide-react';
import { getGetCompanyFileQueryKey, getGetPortalSummaryQueryKey, getListServiceRequestsQueryKey, useCreateServiceRequest, useGetCompanyFile, type ServiceRequestInputCategory } from '@workspace/api-client-react';
import { PortalLayout, PageHeading } from '@/components/portal-ui';
import { categories, categoryById, serviceBySlug, services, type ServiceCategory } from '@/content/services';
import { ServiceOffer } from '@/components/service-offer';
import { ACCEPT_ATTR, CAMERA_ACCEPT, MAX_FILES, RETENTION_NOTE, prepareFiles, sizeText, uploadError, uploadFile } from '@/components/request-files';
import { normalizePhone } from '@/lib/phone';
import './new-request.css';

// Three steps over the existing API contract (category, service,
// description, contactPhone). Nothing new is sent to the server; the
// office's published price and documents for the chosen service are shown.
// Limits mirror ServiceRequestInput in lib/api-spec/openapi.yaml.
const LIMITS = { service: [2, 120], description: [10, 5000], phone: [9, 24] } as const;
const steps = ['الخدمة', 'التفاصيل', 'المراجعة'];
const stepHints = ['ما الذي تحتاجه', 'ما يلزم المكتب معرفته', 'تأكد ثم أرسل'];
const categoryIcons: Record<ServiceCategory, typeof BookUser> = { passports: BookUser, labor: BriefcaseBusiness, business: Building2, other: Shapes };
// Labour and passport services are the ones done for many employees at once
// (iqama renewals, work permits); there the picker takes several employees.
// Mirrors ServiceRequestInput.employeeIds (maxItems 50).
export const BULK_CATEGORIES: ServiceCategory[] = ['labor', 'passports'];
export const MAX_EMPLOYEES = 50;
export const employeesLabel = (n: number) => n === 1 ? 'موظف واحد' : n === 2 ? 'موظفان' : n <= 10 ? `${n} موظفين` : `${n} موظفًا`;
// What the request links to: one employee stays `employeeId` (the office sees
// a single subject); several become `employeeIds`, tracked one by one.
export function employeeLink(ids: number[]): { employeeId?: number; employeeIds?: number[] } {
  const unique = [...new Set(ids)].slice(0, MAX_EMPLOYEES);
  return unique.length === 0 ? {} : unique.length === 1 ? { employeeId: unique[0] } : { employeeIds: unique };
}

const generalGuidance = [
  'ما الذي ظهر لك: نص الملاحظة كما هو، أو المؤشر الذي تغيّر، أو الوثيقة التي تنتهي',
  'اسم المنصة أو الجهة، والتاريخ الذي ظهر فيه ذلك',
  'ما الذي توقف أو تأخر بسببه، إن وجد',
  'اسم الموظف أو الرخصة المعنية',
];

type Errors = Partial<Record<'service' | 'description' | 'contactPhone', string>>;

function validate(step: number, v: { service: string; description: string; contactPhone: string }): Errors {
  const e: Errors = {};
  if (step >= 0) {
    const n = v.service.trim().length;
    if (n < LIMITS.service[0]) e.service = 'اكتب اسم الخدمة المطلوبة (حرفان على الأقل).';
    else if (n > LIMITS.service[1]) e.service = `اسم الخدمة أطول من ${LIMITS.service[1]} حرفًا.`;
  }
  if (step >= 1) {
    const d = v.description.trim().length;
    if (d < LIMITS.description[0]) e.description = 'اكتب تفاصيل أكثر قليلًا (10 أحرف على الأقل) ليفهم المكتب طلبك.';
    else if (d > LIMITS.description[1]) e.description = `التفاصيل أطول من ${LIMITS.description[1]} حرف.`;
    // Arabic digits and spacing are fine; the number is sent in its canonical form.
    if (!normalizePhone(v.contactPhone)) e.contactPhone = 'اكتب رقم جوال صحيحًا (مثال: 05xxxxxxxx)';
  }
  return e;
}

// One field at a time, for inline validation on blur: only its own message.
function fieldError(field: keyof Errors, v: { service: string; description: string; contactPhone: string }): string | undefined {
  return validate(2, v)[field];
}

export function NewRequest() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const mutation = useCreateServiceRequest();
  const query = new URLSearchParams(useSearch());
  const preset = serviceBySlug[query.get('service') ?? ''];
  const presetCategory = (['passports', 'labor', 'business', 'other'] as const).find(c => c === query.get('category'));
  const company = useGetCompanyFile({ query: { queryKey: getGetCompanyFileQueryKey() } });
  // "employee:12" or "license:3": what the request is about, from the company file.
  const [subject, setSubject] = useState(() => query.get('employee') ? `employee:${query.get('employee')}` : query.get('license') ? `license:${query.get('license')}` : '');
  // The bulk picker's choice (labour and passport services), seeded from `?employee=`.
  const [picked, setPicked] = useState<number[]>(() => Number(query.get('employee')) ? [Number(query.get('employee'))] : []);
  const [employeeSearch, setEmployeeSearch] = useState('');

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [category, setCategory] = useState<ServiceRequestInputCategory>(preset?.category ?? presetCategory ?? 'passports');
  const [service, setService] = useState(preset?.name ?? query.get('name')?.slice(0, 120) ?? '');
  const [description, setDescription] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [files, setFiles] = useState<File[]>([]);
  const [fileProblems, setFileProblems] = useState<string[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // Uploaded files keep their reservation, so a retry does not upload them again.
  const uploaded = useRef(new Map<File, number>());
  // Photos shrunk on the device: the size they had before, shown next to the new one.
  const originalSizes = useRef(new Map<File, number>());
  // One id per form: a retried submission returns the same request, never a duplicate.
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const values = { service, description, contactPhone };
  const suggestions = useMemo(() => services.filter((s) => s.category === category), [category]);
  const matched = services.find((s) => s.name === service.trim()) ?? preset;
  // What the office needs to read, for the chosen service or, when the
  // person does not know the service yet, for the three situations that bring
  // most establishments here: a note, an indicator that changed, a document
  // that expires.
  const guidance = matched?.whatToWrite ?? generalGuidance;
  const activeEmployees = company.data?.employees.filter((e) => e.status === 'active') ?? [];
  const bulk = BULK_CATEGORIES.includes(category) && activeEmployees.length > 0;
  // Only employees still in the file count; a stale id from the address bar is dropped.
  const pickedEmployees = activeEmployees.filter((e) => picked.includes(e.id));
  const shownEmployees = activeEmployees.filter((e) => !employeeSearch.trim() || [e.fullName, e.nationality, e.occupation].some((x) => x?.includes(employeeSearch.trim())));
  const subjectOptions = [...activeEmployees, ...(company.data?.licenses ?? [])];
  const subjectLabel = bulk ? (pickedEmployees.length === 1 ? pickedEmployees[0].fullName : pickedEmployees.length > 1 ? `${employeesLabel(pickedEmployees.length)}: ${pickedEmployees.map((e) => e.fullName).join('، ')}` : undefined)
    : subject.startsWith('employee:') ? company.data?.employees.find((e) => `employee:${e.id}` === subject)?.fullName
    : subject.startsWith('license:') ? company.data?.licenses.find((l) => `license:${l.id}` === subject)?.title : undefined;
  function toggleEmployee(id: number, on: boolean) {
    setPicked(on ? (picked.includes(id) || picked.length >= MAX_EMPLOYEES ? picked : [...picked, id]) : picked.filter((x) => x !== id));
  }

  // A field checked as the person leaves it; a fixed field clears its message as they type.
  const check = (field: keyof Errors) => () => setErrors((current) => ({ ...current, [field]: fieldError(field, values) }));
  const clear = (field: keyof Errors) => setErrors((current) => current[field] ? { ...current, [field]: undefined } : current);
  function go(next: number) {
    setDirection(next > step ? 'forward' : 'back');
    setStep(next);
    setErrors({});
    // Move focus to the new step's heading for keyboard and screen-reader users.
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('h2')?.focus());
  }
  function next(event: FormEvent) {
    event.preventDefault();
    const found = validate(step, values);
    if (Object.keys(found).length) {
      setErrors(found);
      const first = Object.keys(found)[0];
      requestAnimationFrame(() => document.getElementById(`field-${first}`)?.focus());
      return;
    }
    if (step < 2) go(step + 1);
    else void submit();
  }
  async function pickFiles(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!picked.length) return;
    setPreparing(true);
    const { files: valid, problems } = await prepareFiles(picked);
    setPreparing(false);
    const room = MAX_FILES - files.length;
    if (valid.length > room) problems.push(`يمكن إرفاق ${MAX_FILES} ملفات كحد أقصى.`);
    const added = valid.slice(0, Math.max(room, 0));
    for (const { file, originalSize } of added) if (originalSize !== null) originalSizes.current.set(file, originalSize);
    setFiles([...files, ...added.map(({ file }) => file)]);
    setFileProblems(problems);
  }
  async function submit() {
    // Files go to private storage first; the request is sent only when all of them are uploaded.
    if (files.length) {
      setUploadingFiles(true);
      const problems: string[] = [];
      for (const file of files) {
        if (uploaded.current.has(file)) continue;
        try { uploaded.current.set(file, await uploadFile('customer', file)); }
        catch (error) { problems.push(uploadError(error, file.name)); }
      }
      setUploadingFiles(false);
      if (problems.length) { setFileProblems([...problems, 'أزِل الملف الذي تعذّر رفعه، أو حاول مرة أخرى.']); return; }
    }
    try {
      const attachmentIds = files.map((file) => uploaded.current.get(file)!).filter(Boolean);
      // A link to an employee or license that is no longer in the file is ignored.
      const [subjectType, subjectId] = !bulk && subjectLabel ? subject.split(':') : [];
      const link = bulk ? employeeLink(pickedEmployees.map((e) => e.id)) : subjectType === 'employee' ? { employeeId: Number(subjectId) } : subjectType === 'license' ? { licenseId: Number(subjectId) } : {};
      const result = await mutation.mutateAsync({ data: { category, service: service.trim(), ...(matched?.slug ? { serviceSlug: matched.slug } : {}), description: description.trim(), contactPhone: normalizePhone(contactPhone) ?? contactPhone.trim(), clientRequestId, ...link, ...(attachmentIds.length ? { attachmentIds } : {}) } });
      await Promise.all([qc.invalidateQueries({ queryKey: getListServiceRequestsQueryKey() }), qc.invalidateQueries({ queryKey: getGetPortalSummaryQueryKey() })]);
      navigate(`/requests/${result.id}?sent=1`);
    } catch { /* error shown below */ }
  }

  return (
    <PortalLayout>
      <div className="nr">
        <Link href="/requests" className="mb-4 inline-flex min-h-11 items-center gap-2 text-xs font-medium text-subtle no-underline hover:text-ink"><ArrowRight size={16} aria-hidden="true" />طلباتي</Link>
        <PageHeading eyebrow="طلباتي" title="طلب خدمة جديد" subtitle="ثلاث خطوات قصيرة، ويتابع المكتب طلبك من لحظة وصوله." />

        <nav className="nr-stepper" aria-label="خطوات الطلب">
          <ol className="nr-steps">
            {steps.map((label, index) => (
              <li key={label} data-state={index < step ? 'done' : index === step ? 'current' : 'next'} aria-current={index === step ? 'step' : undefined}>
                <span className="nr-step-num" aria-hidden="true">{index < step ? <Check size={14} strokeWidth={3} /> : index + 1}</span>
                <span className="nr-step-text"><span className="nr-step-label">{label}</span><span className="nr-step-hint">{stepHints[index]}</span></span>
              </li>
            ))}
          </ol>
          <div className="nr-progress" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} aria-valuetext={`الخطوة ${step + 1} من ${steps.length}`}><span style={{ transform: `scaleX(${(step + 1) / steps.length})` }} /></div>
        </nav>

        <div className="nr-layout">
        <form onSubmit={next} noValidate className="surface nr-form">
          <div ref={panelRef} key={step} className={direction === 'forward' ? 'step-enter' : 'step-enter-back'}>
            {step === 0 && (
              <div>
                <h2 tabIndex={-1} id="cat-title" className="display nr-title">ما مجال الخدمة؟</h2>
                <div className="nr-cats" role="radiogroup" aria-labelledby="cat-title">
                  {categories.map((c) => {
                    const Icon = categoryIcons[c.id];
                    return (
                      <label key={c.id} className="nr-cat" data-checked={category === c.id}>
                        <input type="radio" name="category" value={c.id} checked={category === c.id} onChange={() => setCategory(c.id)} />
                        <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
                        <strong>{c.name}</strong>
                        <span>{c.description}</span>
                      </label>
                    );
                  })}
                </div>
                <label className="form-field mt-7" htmlFor="field-service">اسم الخدمة
                  <input id="field-service" className="form-control" list="service-suggestions" placeholder="اكتب اسم الخدمة، أو ما ظهر لك: ملاحظة، مؤشر، وثيقة تنتهي" value={service} onChange={(e) => { setService(e.target.value); clear('service'); }} onBlur={check('service')} maxLength={LIMITS.service[1]} aria-invalid={!!errors.service} aria-describedby={errors.service ? 'err-service' : 'hint-service'} />
                  <datalist id="service-suggestions">{suggestions.map((s) => <option key={s.slug} value={s.name} />)}</datalist>
                  {errors.service && <span id="err-service" className="field-error" role="alert">{errors.service}</span>}
                </label>
                {suggestions.length > 0 && <div className="nr-suggest" role="group" aria-label={`خدمات ${categoryById[category].name} المقترحة`}>
                  {suggestions.map((s) => <button key={s.slug} type="button" aria-pressed={service.trim() === s.name} onClick={() => { setService(s.name); setErrors({}); }}>{s.name}</button>)}
                </div>}
                <ServiceOffer slug={matched?.slug} compact />
                {!errors.service && <p id="hint-service" className="muted mt-3 text-xs leading-6">لا تعرف اسم الخدمة؟ اكتب ما ظهر لك واسم المنصة، مثل «ملاحظة على ملف الأجور في مُدد»، ويحدد المكتب الخدمة عند المراجعة. أو تصفّح <Link href="/services" className="font-semibold text-teal-bright underline">دليل الخدمات</Link>.</p>}
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 tabIndex={-1} className="display nr-title">تفاصيل الطلب</h2>
                {guidance && (
                  <div className="nr-guide">
                    <strong>{matched?.whatToWrite ? 'اذكر في طلبك:' : 'ليفهم المكتب حالتك، اذكر:'}</strong>
                    <ul>{guidance.map((g) => <li key={g}>{g}</li>)}</ul>
                  </div>
                )}
                {company.isLoading && <p role="status" className="muted mt-4 text-sm">جارٍ تحميل ملف المنشأة لاختيار الموظفين أو التراخيص المعنية…</p>}
                {company.isError && !company.data && <p role="alert" className="mt-4 text-sm text-danger">تعذّر تحميل ملف المنشأة؛ يمكنك متابعة الطلب دون ربط موظف أو ترخيص، أو <button type="button" className="font-semibold underline" onClick={() => company.refetch()}>إعادة المحاولة</button>.</p>}
                <label className="form-field" htmlFor="field-description">ما الذي تحتاجه من المكتب؟
                  <textarea id="field-description" className="form-control" placeholder="اكتب الملاحظة كما تظهر لك، مع التاريخ والجهة. وإن كانت وثيقة تنتهي أو مؤشرًا تغيّر، فاذكر ما تراه ومتى لاحظته." value={description} onChange={(e) => { setDescription(e.target.value); clear('description'); }} onBlur={check('description')} maxLength={LIMITS.description[1]} aria-invalid={!!errors.description} aria-describedby={errors.description ? 'err-description' : 'hint-description'} />
                  {errors.description ? <span id="err-description" className="field-error" role="alert">{errors.description}</span> : <small id="hint-description" className="muted flex justify-between gap-3 font-normal"><span>صورة الملاحظة أو الشاشة تُرفق في «المستندات» أدناه. لا تشارك كلمات مرور المنصات أو رموز التحقق.</span><span className="nums shrink-0" dir="ltr">{description.trim().length}/{LIMITS.description[1]}</span></small>}
                </label>
                {bulk ? <fieldset className="nr-pick" aria-describedby="hint-employees">
                  <legend className="nr-pick-legend"><UsersRound size={16} aria-hidden="true"/>الموظفون المعنيون بالطلب <small>(اختياري)</small><span className="nr-pick-count nums" aria-live="polite">{pickedEmployees.length}/{MAX_EMPLOYEES}</span></legend>
                  <div className="nr-pick-tools">
                    <input className="form-control" placeholder="ابحث بالاسم أو الجنسية أو المهنة" value={employeeSearch} onChange={(e) => setEmployeeSearch(e.target.value)} aria-label="بحث في الموظفين"/>
                    {pickedEmployees.length < Math.min(activeEmployees.length, MAX_EMPLOYEES)
                      ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicked([...new Set([...picked, ...shownEmployees.map((e) => e.id)])].slice(0, MAX_EMPLOYEES))}>تحديد الكل</button>
                      : <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicked([])}>إلغاء التحديد</button>}
                  </div>
                  <ul className="nr-pick-list">{shownEmployees.map((e) => { const on = picked.includes(e.id); return <li key={e.id}>
                    <label className="nr-pick-item" data-checked={on}><input type="checkbox" checked={on} disabled={!on && picked.length >= MAX_EMPLOYEES} onChange={(ev) => toggleEmployee(e.id, ev.target.checked)}/><span className="min-w-0"><strong>{e.fullName}</strong>{(e.occupation || e.nationality) && <small>{[e.occupation, e.nationality].filter(Boolean).join(' · ')}</small>}</span></label>
                  </li>; })}{!shownEmployees.length && <li className="muted px-3 py-4 text-center text-xs">لا يوجد موظفون مطابقون.</li>}</ul>
                  <small id="hint-employees" className="muted font-normal">{picked.length >= MAX_EMPLOYEES ? `الحد الأقصى ${MAX_EMPLOYEES} موظفًا في الطلب الواحد؛ أرسل طلبًا آخر للبقية.` : 'اختر موظفًا واحدًا أو أكثر؛ يتابع المكتب كل موظف على حدة ويظهر الطلب في ملفاتهم.'}</small>
                </fieldset> : subjectOptions.length > 0 && <label className="form-field mt-6" htmlFor="field-subject">يخص موظفًا أو ترخيصًا؟ (اختياري)
                  <select id="field-subject" className="form-control" value={subject} onChange={(e) => setSubject(e.target.value)}>
                    <option value="">لا يخص موظفًا أو ترخيصًا محددًا</option>
                    {activeEmployees.length > 0 && <optgroup label="الموظفون">{activeEmployees.map((e) => <option key={e.id} value={`employee:${e.id}`}>{e.fullName}{e.occupation ? ` · ${e.occupation}` : ''}</option>)}</optgroup>}
                    {company.data!.licenses.length > 0 && <optgroup label="التراخيص">{company.data!.licenses.map((l) => <option key={l.id} value={`license:${l.id}`}>{l.title}</option>)}</optgroup>}
                  </select>
                  <small className="muted font-normal">يظهر الطلب في ملف الموظف أو الترخيص، ويرى المكتب بياناته مباشرة.</small>
                </label>}
                <label className="form-field mt-6" htmlFor="field-contactPhone">رقم للتواصل
                  <input id="field-contactPhone" dir="ltr" className="form-control text-right" type="tel" inputMode="tel" autoComplete="tel" placeholder="05XXXXXXXX" value={contactPhone} onChange={(e) => { setContactPhone(e.target.value); clear('contactPhone'); }} onBlur={check('contactPhone')} maxLength={LIMITS.phone[1]} aria-invalid={!!errors.contactPhone} aria-describedby={errors.contactPhone ? 'err-contactPhone' : undefined} />
                  {errors.contactPhone && <span id="err-contactPhone" className="field-error" role="alert">{errors.contactPhone}</span>}
                </label>
                <div className="nr-files">
                  <div className="nr-files-head">
                    <span className="nr-files-label">المستندات <small>(اختياري)</small><small className="nr-files-hint">صورة الملاحظة كما ظهرت، أو الوثيقة التي تنتهي</small></span>
                    {files.length < MAX_FILES && <span className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => fileInput.current?.click()} disabled={preparing}><Paperclip size={15} aria-hidden="true" />إرفاق ملفات</button>
                      <button type="button" className="btn btn-outline btn-sm rf-camera" onClick={() => cameraInput.current?.click()} disabled={preparing}><Camera size={15} aria-hidden="true" />التقط بالكاميرا</button>
                    </span>}
                    <input ref={fileInput} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={pickFiles} aria-label="اختر مستندات لإرفاقها" />
                    <input ref={cameraInput} type="file" accept={CAMERA_ACCEPT} capture="environment" hidden onChange={pickFiles} aria-label="التقط صورة للمستند" />
                  </div>
                  {files.length > 0 && <ul className="nr-files-list">{files.map((file, index) => <li key={`${index}-${file.name}`}>
                    <span className="nr-file-name">{file.name}</span><small>{sizeText(file.size)}{originalSizes.current.has(file) && ` (ضُغطت من ${sizeText(originalSizes.current.get(file)!)})`}</small>
                    <button type="button" onClick={() => { uploaded.current.delete(file); setFiles(files.filter((_, i) => i !== index)); }} aria-label={`إزالة ${file.name}`}><X size={15} /></button>
                  </li>)}</ul>}
                  {preparing && <p className="muted m-0 text-xs" role="status">جارٍ تجهيز الصور…</p>}
                  {fileProblems.length > 0 && <div role="alert" className="nr-files-errors">{fileProblems.map((p) => <p key={p}>{p}</p>)}</div>}
                  <small className="muted block text-xs leading-6">{RETENTION_NOTE} تُصغَّر الصور الكبيرة تلقائيًا قبل الرفع.</small>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 tabIndex={-1} className="display nr-title">مراجعة الطلب</h2>
                <dl className="nr-review">
                  <div><dt>المجال</dt><dd>{categoryById[category].name}</dd><button type="button" onClick={() => go(0)} aria-label="تعديل المجال"><Pencil size={15} /></button></div>
                  <div><dt>الخدمة</dt><dd>{service.trim()}</dd><button type="button" onClick={() => go(0)} aria-label="تعديل اسم الخدمة"><Pencil size={15} /></button></div>
                  <div className="nr-review-wide"><dt>التفاصيل</dt><dd className="whitespace-pre-wrap">{description.trim()}</dd><button type="button" onClick={() => go(1)} aria-label="تعديل التفاصيل"><Pencil size={15} /></button></div>
                  {subjectLabel && <div className="nr-review-wide"><dt>{bulk && pickedEmployees.length > 1 ? 'الموظفون' : 'يخص'}</dt><dd>{subjectLabel}</dd><button type="button" onClick={() => go(1)} aria-label="تعديل ما يخصه الطلب"><Pencil size={15} /></button></div>}
                  <div><dt>رقم التواصل</dt><dd dir="ltr" className="text-right">{normalizePhone(contactPhone) ?? contactPhone.trim()}</dd><button type="button" onClick={() => go(1)} aria-label="تعديل رقم التواصل"><Pencil size={15} /></button></div>
                  <div className="nr-review-wide"><dt>المستندات</dt><dd>{files.length ? files.map((f) => f.name).join('، ') : 'لا توجد'}</dd><button type="button" onClick={() => go(1)} aria-label="تعديل المستندات"><Pencil size={15} /></button></div>
                </dl>
                <p className="muted mt-5 text-sm leading-7">يراجع المكتب طلبك ويحدد ما يلزم، وتتابع كل خطوة من صفحة الطلب. إن احتاج مستندًا إضافيًا تصبح الحالة «بانتظار العميل» وتجده في قائمة المستندات، وترفعه من الصفحة نفسها.</p>
                {fileProblems.length > 0 && <div role="alert" className="nr-files-errors mt-4">{fileProblems.map((p) => <p key={p}>{p}</p>)}</div>}
                {mutation.isError && <div role="alert" className="mt-5 rounded-lg bg-danger-soft p-4 text-sm text-danger">{(mutation.error as { status?: number } | null)?.status === 400 ? 'تحقق من بيانات الطلب: موظف أو ترخيص مختار لم يعد في ملف المنشأة، أو تجاوز العدد 50 موظفًا.' : 'تعذّر إرسال الطلب. تحقق من اتصالك وحاول مرة أخرى؛ لن يُرسل الطلب مرتين.'}</div>}
              </div>
            )}
          </div>

          <div className="nr-actions">
            {step > 0 ? <button type="button" className="btn btn-outline" onClick={() => go(step - 1)} disabled={mutation.isPending}><ArrowRight size={16} aria-hidden="true" />السابق</button> : <span />}
            <span className="nr-actions-step nums" aria-hidden="true">{step + 1} / {steps.length}</span>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending || uploadingFiles} aria-live="polite">
              {step < 2 ? <>التالي<ArrowLeft size={16} aria-hidden="true" /></> : uploadingFiles ? <><span className="nr-spinner" aria-hidden="true" />جارٍ رفع المستندات…</> : mutation.isPending ? <><span className="nr-spinner" aria-hidden="true" />جارٍ الإرسال…</> : <>إرسال الطلب<Send size={16} aria-hidden="true" /></>}
            </button>
          </div>
        </form>

        <aside className="nr-aside" aria-label="ملخص الطلب">
          <div className="surface nr-summary">
            <h2 className="nr-summary-title display">ملخص الطلب</h2>
            <dl className="nr-summary-list">
              <div><dt>المجال</dt><dd>{categoryById[category].name}</dd></div>
              <div><dt>الخدمة</dt><dd>{service.trim() || <span className="nr-summary-empty">لم تُحدَّد بعد</span>}</dd></div>
              {subjectLabel && <div><dt>{bulk && pickedEmployees.length > 1 ? 'الموظفون' : 'يخص'}</dt><dd>{subjectLabel}</dd></div>}
              {step > 0 && <div><dt>المستندات</dt><dd>{files.length ? `${files.length} ${files.length === 1 ? 'ملف' : 'ملفات'}` : <span className="nr-summary-empty">لا توجد</span>}</dd></div>}
              {step > 0 && <div><dt>رقم التواصل</dt><dd dir="ltr" className="text-right">{normalizePhone(contactPhone) ?? (contactPhone.trim() || '—')}</dd></div>}
            </dl>
          </div>
          <div className="nr-tip"><Lightbulb size={18} aria-hidden="true" /><p>{step === 0 ? 'لا تعرف اسم الخدمة؟ اكتب ما ظهر لك واسم المنصة، ويحدد المكتب الخدمة عند المراجعة.' : step === 1 ? 'كلما كانت التفاصيل أدق، كان رد المكتب أسرع. أرفق صورة الملاحظة إن وُجدت.' : 'راجع البيانات ثم أرسل. تصلك الحالة وكل رسالة من المكتب في صفحة الطلب.'}</p></div>
        </aside>
        </div>
      </div>
    </PortalLayout>
  );
}
