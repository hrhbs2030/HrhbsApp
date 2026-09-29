import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookUser, BriefcaseBusiness, Building2, Check, Pencil, Send, Shapes } from 'lucide-react';
import { getGetPortalSummaryQueryKey, getListServiceRequestsQueryKey, useCreateServiceRequest, type ServiceRequestInputCategory } from '@workspace/api-client-react';
import { PortalLayout, PageHeading } from '@/components/portal-ui';
import { categories, categoryById, serviceBySlug, services, type ServiceCategory } from '@/content/services';
import './new-request.css';

// Three steps over the existing API contract (category, service,
// description, contactPhone). Nothing new is sent to the server.
// Limits mirror ServiceRequestInput in lib/api-spec/openapi.yaml.
const LIMITS = { service: [2, 120], description: [10, 5000], phone: [9, 24] } as const;
const steps = ['الخدمة', 'التفاصيل', 'المراجعة'];
const categoryIcons: Record<ServiceCategory, typeof BookUser> = { passports: BookUser, labor: BriefcaseBusiness, business: Building2, other: Shapes };

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
    const phone = v.contactPhone.trim();
    const digits = phone.replace(/\D/g, '').length;
    if (phone.length < LIMITS.phone[0] || digits < 9) e.contactPhone = 'اكتب رقم جوال صحيحًا للتواصل (9 أرقام على الأقل).';
    else if (phone.length > LIMITS.phone[1]) e.contactPhone = 'رقم التواصل أطول من المسموح.';
  }
  return e;
}

export function NewRequest() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const mutation = useCreateServiceRequest();
  const preset = serviceBySlug[new URLSearchParams(useSearch()).get('service') ?? ''];

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [category, setCategory] = useState<ServiceRequestInputCategory>(preset?.category ?? 'passports');
  const [service, setService] = useState(preset?.name ?? '');
  const [description, setDescription] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const panelRef = useRef<HTMLDivElement>(null);

  const values = { service, description, contactPhone };
  const suggestions = useMemo(() => services.filter((s) => s.category === category), [category]);
  const matched = services.find((s) => s.name === service.trim()) ?? preset;
  const guidance = matched?.whatToWrite;

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
  async function submit() {
    try {
      const result = await mutation.mutateAsync({ data: { category, service: service.trim(), description: description.trim(), contactPhone: contactPhone.trim() } });
      await Promise.all([qc.invalidateQueries({ queryKey: getListServiceRequestsQueryKey() }), qc.invalidateQueries({ queryKey: getGetPortalSummaryQueryKey() })]);
      navigate(`/requests/${result.id}?sent=1`);
    } catch { /* error shown below */ }
  }

  return (
    <PortalLayout>
      <div className="nr">
        <Link href="/requests" className="mb-4 inline-flex min-h-11 items-center gap-2 text-xs font-bold text-subtle no-underline hover:text-ink"><ArrowRight size={16} />طلباتي</Link>
        <PageHeading eyebrow="" title="طلب خدمة جديد" />

        <ol className="nr-steps" aria-label="خطوات الطلب">
          {steps.map((label, index) => (
            <li key={label} data-state={index < step ? 'done' : index === step ? 'current' : 'next'} aria-current={index === step ? 'step' : undefined}>
              <span className="nr-step-num" aria-hidden="true">{index < step ? <Check size={14} strokeWidth={3} /> : index + 1}</span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div className="nr-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(step + 1) / steps.length})` }} /></div>

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
                  <input id="field-service" className="form-control" list="service-suggestions" placeholder="اكتب اسم الخدمة أو اختر من المقترحات" value={service} onChange={(e) => setService(e.target.value)} maxLength={LIMITS.service[1]} aria-invalid={!!errors.service} aria-describedby={errors.service ? 'err-service' : 'hint-service'} />
                  <datalist id="service-suggestions">{suggestions.map((s) => <option key={s.slug} value={s.name} />)}</datalist>
                  {errors.service && <span id="err-service" className="field-error" role="alert">{errors.service}</span>}
                </label>
                {suggestions.length > 0 && <div className="nr-suggest" role="group" aria-label={`خدمات ${categoryById[category].name} المقترحة`}>
                  {suggestions.map((s) => <button key={s.slug} type="button" aria-pressed={service.trim() === s.name} onClick={() => { setService(s.name); setErrors({}); }}>{s.name}</button>)}
                </div>}
                {!errors.service && <p id="hint-service" className="muted mt-3 text-xs leading-6">لم تجد خدمتك؟ اكتبها بالاسم الذي تعرفه، أو تصفّح <Link href="/services" className="font-bold text-teal-bright underline">دليل الخدمات</Link>.</p>}
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 tabIndex={-1} className="display nr-title">تفاصيل الطلب</h2>
                {guidance && (
                  <div className="nr-guide">
                    <strong>اذكر في طلبك:</strong>
                    <ul>{guidance.map((g) => <li key={g}>{g}</li>)}</ul>
                  </div>
                )}
                <label className="form-field" htmlFor="field-description">ما الذي تحتاجه من المكتب؟
                  <textarea id="field-description" className="form-control" placeholder="صف المعاملة وما تحتاجه من المكتب" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={LIMITS.description[1]} aria-invalid={!!errors.description} aria-describedby={errors.description ? 'err-description' : 'hint-description'} />
                  {errors.description ? <span id="err-description" className="field-error" role="alert">{errors.description}</span> : <small id="hint-description" className="muted flex justify-between gap-3 font-normal"><span>لا تشارك كلمات مرور المنصات أو رموز التحقق.</span><span className="nums shrink-0" dir="ltr">{description.trim().length}/{LIMITS.description[1]}</span></small>}
                </label>
                <label className="form-field mt-6" htmlFor="field-contactPhone">رقم للتواصل
                  <input id="field-contactPhone" dir="ltr" className="form-control text-right" type="tel" inputMode="tel" autoComplete="tel" placeholder="05XXXXXXXX" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={LIMITS.phone[1]} aria-invalid={!!errors.contactPhone} aria-describedby={errors.contactPhone ? 'err-contactPhone' : undefined} />
                  {errors.contactPhone && <span id="err-contactPhone" className="field-error" role="alert">{errors.contactPhone}</span>}
                </label>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 tabIndex={-1} className="display nr-title">مراجعة الطلب</h2>
                <dl className="nr-review">
                  <div><dt>المجال</dt><dd>{categoryById[category].name}</dd><button type="button" onClick={() => go(0)} aria-label="تعديل المجال"><Pencil size={15} /></button></div>
                  <div><dt>الخدمة</dt><dd>{service.trim()}</dd><button type="button" onClick={() => go(0)} aria-label="تعديل اسم الخدمة"><Pencil size={15} /></button></div>
                  <div className="nr-review-wide"><dt>التفاصيل</dt><dd className="whitespace-pre-wrap">{description.trim()}</dd><button type="button" onClick={() => go(1)} aria-label="تعديل التفاصيل"><Pencil size={15} /></button></div>
                  <div><dt>رقم التواصل</dt><dd dir="ltr" className="text-right">{contactPhone.trim()}</dd><button type="button" onClick={() => go(1)} aria-label="تعديل رقم التواصل"><Pencil size={15} /></button></div>
                </dl>
                <p className="muted mt-5 text-sm leading-7">إرفاق المستندات غير متاح؛ سيطلب المكتب ما يلزم بعد مراجعة الطلب.</p>
                {mutation.isError && <div role="alert" className="mt-5 rounded-lg bg-danger-soft p-4 text-sm text-danger">تعذّر إرسال الطلب. تحقق من اتصالك وحاول مرة أخرى؛ لن يُرسل الطلب مرتين.</div>}
              </div>
            )}
          </div>

          <div className="nr-actions">
            {step > 0 ? <button type="button" className="btn btn-outline" onClick={() => go(step - 1)} disabled={mutation.isPending}><ArrowRight size={16} />السابق</button> : <span />}
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending} aria-live="polite">
              {step < 2 ? <>التالي<ArrowLeft size={16} /></> : mutation.isPending ? <><span className="nr-spinner" aria-hidden="true" />جارٍ الإرسال…</> : <>إرسال الطلب<Send size={16} /></>}
            </button>
          </div>
        </form>
      </div>
    </PortalLayout>
  );
}
