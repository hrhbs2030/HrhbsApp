import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Package, Plus, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import {
  getListOfficeAuditLogQueryKey, getListOfficeStaffQueryKey, useAddOfficeStaff, useListOfficeAuditLog, useListOfficeStaff, useRemoveOfficeStaff,
  getListOfficePlansQueryKey, getListOfficeSubscriptionsQueryKey, useCreateOfficePlan, useListOfficePlans, useUpdateOfficePlan, useListOfficeSubscriptions, useUpdateOfficeSubscription,
  type AuditLogEntry, type OfficeStaffMember, type OfficeSubscription, type Plan, type PlanInput, type SubscriptionStatus,
} from '@workspace/api-client-react';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, Pager, PortalLayout, dateText } from '@/components/portal-ui';
import { PrintButton } from '@/components/brand/print';
import { ConfirmDialog } from '@/components/request-billing';
import { LOCALE, formatDate, formatMoney, formatNumber, parseRiyals } from '@/lib/format';

function serverMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown } | null)?.data;
  return data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : fallback;
}

export function OfficeStaff() {
  const qc = useQueryClient();
  const staff = useListOfficeStaff({ query: { queryKey: getListOfficeStaffQueryKey() } });
  const add = useAddOfficeStaff();
  const remove = useRemoveOfficeStaff();
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function refresh() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListOfficeStaffQueryKey() }),
      qc.invalidateQueries({ queryKey: getListOfficeAuditLogQueryKey() }),
    ]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const value = email.trim();
    if (!value) return;
    try {
      const member = await add.mutateAsync({ data: { email: value } });
      setEmail('');
      setNotice({ kind: 'ok', text: `أُضيف ${member.email ?? value} إلى فريق المكتب.` });
      await refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: serverMessage(error, 'تعذّر إضافة الموظف. حاول مرة أخرى.') });
    }
  }

  // In-page confirmation (ConfirmDialog) rather than window.confirm: browsers
  // may suppress native dialogs and they ignore the page's direction.
  const [revoking, setRevoking] = useState<OfficeStaffMember | null>(null);
  async function revoke(member: OfficeStaffMember) {
    setRevoking(null);
    setNotice(null);
    setRemovingId(member.userId);
    try {
      await remove.mutateAsync({ userId: member.userId });
      setNotice({ kind: 'ok', text: 'أُزيلت صلاحية المكتب من الحساب.' });
      await refresh();
    } catch (error) {
      setNotice({ kind: 'error', text: serverMessage(error, 'تعذّر إزالة الصلاحية. حاول مرة أخرى.') });
    } finally {
      setRemovingId(null);
    }
  }

  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="فريق المكتب" subtitle="يدير الموظف الطلبات والاستفسارات والتسجيل. الأرشيف والفريق وسجل التدقيق للمالك فقط."/>
    <div className="space-y-6">
      <form onSubmit={submit} className="surface p-5 sm:p-6" aria-labelledby="add-staff-title">
        <h2 id="add-staff-title" className="display mb-4 text-lg font-semibold">إضافة موظف</h2>
        <label htmlFor="staff-email" className="form-field">البريد الإلكتروني للموظف
          <div className="flex flex-col gap-3 sm:flex-row">
            <input id="staff-email" type="email" dir="ltr" className="form-control" placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required/>
            <button className="btn btn-primary shrink-0" type="submit" disabled={add.isPending || !email.trim()}><UserPlus size={17}/>{add.isPending ? 'جارٍ الإضافة…' : 'إضافة موظف'}</button>
          </div>
          <small className="muted font-normal">يجب أن يكون الموظف قد أنشأ حسابًا في البوابة وأكّد هذا البريد. تبقى صلاحيته ما دام البريد مؤكدًا في حسابه.</small>
        </label>
        {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg px-4 py-3 text-sm ${notice.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>{notice.text}</div>}
      </form>
      <section aria-labelledby="staff-list-title">
        <h2 id="staff-list-title" className="display mb-3 text-lg font-semibold">الأعضاء{staff.data?.length ? <span className="nums mr-2 text-sm font-normal text-subtle">({new Intl.NumberFormat(LOCALE).format(staff.data.length)})</span> : null}</h2>
        {staff.isLoading ? <LoadingBlock/> : staff.isError ? <ErrorBlock retry={() => staff.refetch()}/> : !staff.data?.length ? <EmptyBlock title="لا يوجد أعضاء بعد" text="سيظهر حساب المالك هنا بعد أول دخول له."/> :
          <ul className="surface m-0 list-none overflow-hidden p-0">{staff.data.map(member => <li key={member.userId} className="flex flex-col gap-3 border-b border-line px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="min-w-0 truncate font-bold" dir="ltr">{member.email ?? 'بريد المالك غير مؤكد'}</span><span className={`pill ${member.role === 'owner' ? 'bg-teal text-on-dark' : 'bg-info-soft text-info'}`}>{member.role === 'owner' ? 'المالك' : 'موظف'}</span></div><div className="mt-1 text-xs text-subtle">أُضيف في {dateText(member.createdAt)}</div></div>
            {member.role === 'staff' ? <button type="button" onClick={() => setRevoking(member)} disabled={removingId === member.userId} className="btn btn-outline btn-sm !min-h-11 self-start sm:self-auto"><Trash2 size={15}/>{removingId === member.userId ? 'جارٍ الإزالة…' : 'إزالة الصلاحية'}</button> : <span className="flex items-center gap-1.5 text-xs text-subtle"><ShieldCheck size={15}/>مرتبط ببريد المكتب المعتمد</span>}
          </li>)}</ul>}
      </section>
      <ConfirmDialog open={!!revoking} onOpenChange={o => { if (!o) setRevoking(null); }} danger busy={remove.isPending} confirmLabel="إزالة الصلاحية"
        title={`إزالة صلاحية المكتب من ${revoking?.email ?? 'هذا الحساب'}؟`} description="يفقد الحساب الوصول إلى مساحة المكتب فورًا، ويمكن إضافته مجددًا بالبريد." onConfirm={() => revoking && revoke(revoking)}/>
    </div>
  </PortalLayout>;
}

const actionNames: Record<AuditLogEntry['action'], string> = {
  'staff.add': 'إضافة موظف',
  'staff.remove': 'إزالة موظف',
  'service_request.update': 'تحديث طلب خدمة',
  'service_request.quote': 'إرسال عرض سعر',
  'service_request.quote_accept': 'قبول عرض سعر',
  'service_request.quote_decline': 'رفض عرض سعر',
  'service_request.checklist': 'تحديث المستندات المطلوبة',
  'inquiry.answer': 'الرد على استفسار',
  'attachment.upload': 'إرفاق مستند',
  'attachment.download': 'تنزيل مستند',
  'attachment.delete': 'حذف مستند',
  'attachment.purge': 'حذف تلقائي لمستند',
  'registration.approve': 'قبول طلب تسجيل',
  'registration.reject': 'رفض طلب تسجيل',
  'information.review': 'مراجعة معلومة للمساعد',
  'information.publish': 'نشر معلومة للمساعد',
  'information.unpublish': 'سحب معلومة من المساعد',
  'attachment.extract': 'قراءة مستند آليًا',
  'invoice.issue': 'إصدار فاتورة',
  'invoice.mark_paid': 'تسجيل سداد فاتورة',
  'invoice.cancel': 'إلغاء فاتورة',
  'invoice.paid_online': 'سداد إلكتروني لفاتورة',
  'offer.update': 'تحديث سعر ومتطلبات خدمة',
  'reminder.create': 'إضافة تنبيه وثيقة لعميل',
  'company.update': 'تحديث بيانات منشأة عميل',
  'employee.create': 'إضافة موظف لعميل',
  'employee.update': 'تعديل موظف لعميل',
  'employee.delete': 'حذف موظف لعميل',
  'employee.reveal': 'إظهار أرقام هوية موظف',
  'license.create': 'إضافة ترخيص لعميل',
  'license.update': 'تعديل ترخيص لعميل',
  'license.delete': 'حذف ترخيص لعميل',
  'employee.import': 'استيراد موظفين من Excel لعميل',
  'license.import': 'استيراد تراخيص من Excel لعميل',
  'automation.update': 'تعديل التوزيع التلقائي للطلبات',
  'company.member_invite': 'دعوة عضو لمنشأة عميل',
  'company.member_update': 'تعديل عضو في منشأة عميل',
  'company.member_remove': 'إزالة عضو من منشأة عميل',
  'company.member_leave': 'مغادرة عضو لمنشأة عميل',
  'service_request.employee_item': 'تحديث موظف على طلب',
  'plan.create': 'إنشاء باقة',
  'plan.update': 'تعديل باقة',
  'subscription.start': 'بدء اشتراك',
  'subscription.update': 'تعديل اشتراك',
  'service_request.auto_renew': 'طلب تجديد تلقائي ضمن الاشتراك',
  'notification.preferences': 'تعديل تفضيلات الإشعارات',
  'whatsapp.reply': 'رد على رسالة واتساب',
};

function auditSummary(entry: AuditLogEntry): string {
  if (entry.action.startsWith('attachment.')) {
    const name = typeof entry.details.name === 'string' ? `«${entry.details.name}»` : 'مستند';
    return `طلب رقم ${entry.targetId}: ${name}${entry.action === 'attachment.purge' ? ' بعد 90 يومًا من اكتمال الطلب' : ''}`;
  }
  if (entry.action.startsWith('invoice.')) {
    const total = typeof entry.details.total === 'number' ? ` · ${formatMoney(entry.details.total)}` : '';
    return `طلب رقم ${entry.targetId}: فاتورة رقم ${String(entry.details.invoiceId ?? '-')}${total}`;
  }
  if (entry.action === 'reminder.create') return `طلب رقم ${entry.targetId}: تنتهي في ${String(entry.details.expiresOn ?? '-')}`;
  if (entry.targetType === 'customer') {
    if (entry.action.endsWith('.import')) return `ملف عميل: أُضيف ${String(entry.details.created ?? 0)} وحُدّث ${String(entry.details.updated ?? 0)}`;
    const what = typeof entry.details.name === 'string' ? `«${entry.details.name}»` : typeof entry.details.title === 'string' ? `«${entry.details.title}»` : '';
    return `ملف عميل${what ? `: ${what}` : ''}`;
  }
  if (entry.action === 'offer.update') return `خدمة ${entry.targetId}${entry.details.published ? ' (منشورة)' : ''}`;
  if (entry.action === 'service_request.update') return `طلب رقم ${entry.targetId}`;
  if (entry.action === 'service_request.employee_item') return `طلب رقم ${entry.targetId}${typeof entry.details.fullName === 'string' ? `: ${entry.details.fullName}` : ''}${typeof entry.details.itemStatus === 'string' ? ` → ${entry.details.itemStatus}` : ''}`;
  if (entry.action.startsWith('information.')) return typeof entry.details.title === 'string' ? `«${entry.details.title}»` : `معلومة رقم ${entry.targetId}`;
  return typeof entry.details.email === 'string' ? entry.details.email : entry.targetId;
}

export function OfficeAuditLog() {
  const log = useListOfficeAuditLog({ query: { queryKey: getListOfficeAuditLogQueryKey(), refetchInterval: 60_000 } });
  const timeText = (value: string) => new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="سجل التدقيق" subtitle="آخر 200 إجراء في المكتب: الصلاحيات، والطلبات، والمستندات، والتسجيل، ومعلومات المساعد. الأحدث أولًا." action={<PrintButton label="طباعة السجل"/>}/>
    {log.isLoading ? <LoadingBlock/> : log.isError ? <ErrorBlock retry={() => log.refetch()}/> : !log.data?.length ? <EmptyBlock title="لا توجد إجراءات بعد" text="ستظهر هنا إجراءات فريق المكتب فور حدوثها."/> :
      <div className="surface overflow-hidden">
        <div className="hidden border-b border-line bg-sunk px-6 py-3 text-xs font-bold text-subtle lg:grid lg:grid-cols-[140px_minmax(0,1fr)_220px_170px] lg:gap-4" aria-hidden="true"><span>الإجراء</span><span>التفاصيل</span><span>المنفّذ</span><span>الوقت</span></div>
        <ul className="m-0 list-none p-0">{log.data.map(entry => <li key={entry.id} className="grid gap-1.5 border-b border-line px-5 py-4 last:border-0 sm:px-6 lg:grid-cols-[140px_minmax(0,1fr)_220px_170px] lg:items-center lg:gap-4">
          <span className="flex items-center justify-between gap-3 lg:block"><span className="inline-flex w-fit rounded-md bg-copper-soft px-2 py-0.5 text-xs font-bold text-copper">{actionNames[entry.action]}</span><span className="text-xs text-subtle lg:hidden">{timeText(entry.createdAt)}</span></span>
          <span className="min-w-0 text-sm leading-7">{auditSummary(entry)}</span>
          <span className="min-w-0 truncate text-xs text-quiet" dir="ltr" style={{ textAlign: 'right' }}>{entry.actorId === 'system' ? 'النظام' : entry.actorId === 'payment-gateway' ? 'بوابة الدفع' : entry.actorId === 'automation' ? 'أتمتة النظام' : entry.actorEmail ?? entry.actorId}</span>
          <span className="hidden text-xs text-subtle lg:block">{timeText(entry.createdAt)}</span>
        </li>)}</ul>
      </div>}
  </PortalLayout>;
}

// ---- subscription plans (owner) ------------------------------------------------------

// The plan form as typed; amounts in riyals, blanks for "unlimited".
export type PlanForm = { name: string; slug: string; description: string; price: string; employeeCap: string; requestsPerMonth: string; autoRenewals: boolean; active: boolean; sort: string };
export const emptyPlan: PlanForm = { name: '', slug: '', description: '', price: '', employeeCap: '', requestsPerMonth: '', autoRenewals: true, active: true, sort: '0' };
const planForm = (plan: Plan): PlanForm => ({ name: plan.name, slug: plan.slug, description: plan.description, price: String(plan.price / 100), employeeCap: plan.employeeCap == null ? '' : String(plan.employeeCap), requestsPerMonth: plan.requestsPerMonth == null ? '' : String(plan.requestsPerMonth), autoRenewals: plan.autoRenewals, active: plan.active, sort: String(plan.sort) });
const wholeNumber = (text: string) => /^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) : null;
// The API body from the form, or the messages for what blocks it. The checks
// mirror the schema's limits so the person hears the reason before the 400.
export function planInput(form: PlanForm): { data: PlanInput; errors: Record<string, never> } | { data: null; errors: Partial<Record<keyof PlanForm, string>> } {
  const errors: Partial<Record<keyof PlanForm, string>> = {};
  const name = form.name.trim(); const slug = form.slug.trim(); const description = form.description.trim();
  if (name.length < 2 || name.length > 120) errors.name = 'اكتب اسمًا من حرفين إلى 120 حرفًا.';
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) errors.slug = 'المعرّف بأحرف لاتينية صغيرة وأرقام وشرطات فقط (2-60).';
  if (description.length > 2000) errors.description = 'الوصف حتى 2000 حرف.';
  const price = parseRiyals(form.price);
  if (price === null || price > 100_000_000) errors.price = 'اكتب السعر الشهري بالريال (0 للباقة المجانية).';
  const cap = form.employeeCap.trim() ? wholeNumber(form.employeeCap) : null;
  if (form.employeeCap.trim() && (cap === null || cap < 1 || cap > 100_000)) errors.employeeCap = 'حد الموظفين رقم من 1 إلى 100000، أو اتركه فارغًا لغير محدود.';
  const requests = form.requestsPerMonth.trim() ? wholeNumber(form.requestsPerMonth) : null;
  if (form.requestsPerMonth.trim() && (requests === null || requests < 1 || requests > 100_000)) errors.requestsPerMonth = 'عدد الطلبات رقم من 1 إلى 100000، أو اتركه فارغًا لغير محدود.';
  const sort = wholeNumber(form.sort || '0');
  if (sort === null || sort > 1000) errors.sort = 'الترتيب رقم من 0 إلى 1000.';
  if (Object.keys(errors).length) return { data: null, errors };
  return { data: { name, slug, description, price: price!, employeeCap: cap, requestsPerMonth: requests, autoRenewals: form.autoRenewals, active: form.active, sort: sort! }, errors: {} };
}

function PlanEditor({ plan, onSaved, onCancel }: { plan: Plan | null; onSaved: () => Promise<unknown>; onCancel: () => void }) {
  const create = useCreateOfficePlan();
  const update = useUpdateOfficePlan();
  const [form, setForm] = useState<PlanForm>(plan ? planForm(plan) : emptyPlan);
  const [errors, setErrors] = useState<Partial<Record<keyof PlanForm, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => { setForm(plan ? planForm(plan) : emptyPlan); setErrors({}); setFailure(null); }, [plan?.id]);
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => { setForm(f => ({ ...f, [key]: value })); setErrors(({ [key]: _, ...rest }) => rest); };
  const busy = create.isPending || update.isPending;
  const halalas = parseRiyals(form.price);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const checked = planInput(form);
    if (!checked.data) { setErrors(checked.errors); return; }
    setFailure(null);
    try {
      if (plan) await update.mutateAsync({ id: plan.id, data: checked.data }); else await create.mutateAsync({ data: checked.data });
      await onSaved();
    } catch (error) {
      setFailure((error as { status?: number })?.status === 409 ? 'هذا المعرّف مستخدم لباقة أخرى.' : serverMessage(error, 'تعذّر حفظ الباقة. حاول مجددًا.'));
    }
  }
  const field = (key: keyof PlanForm, label: string, input: ReactNode, hint?: string) => <label className="form-field">{label}{input}{errors[key] ? <small role="alert" className="font-normal text-danger">{errors[key]}</small> : hint && <small className="muted font-normal">{hint}</small>}</label>;
  return <form onSubmit={submit} className="surface space-y-4 p-5" aria-labelledby="plan-form-title">
    <h2 id="plan-form-title" className="display text-lg font-semibold">{plan ? `تعديل «${plan.name}»` : 'باقة جديدة'}</h2>
    {field('name', 'اسم الباقة', <input className="form-control" value={form.name} onChange={e => set('name', e.target.value)} maxLength={120} placeholder="مثال: باقة المنشآت الصغيرة"/>)}
    {field('slug', 'المعرّف', <input className="form-control" dir="ltr" value={form.slug} onChange={e => set('slug', e.target.value)} maxLength={60} placeholder="small-business" disabled={!!plan}/>, plan ? 'لا يتغير المعرّف بعد الإنشاء.' : 'يظهر في الروابط؛ أحرف لاتينية صغيرة وأرقام وشرطات.')}
    {field('description', 'الوصف للعميل', <textarea className="form-control !min-h-24" value={form.description} onChange={e => set('description', e.target.value)} maxLength={2000} placeholder="ما تشمله الباقة..."/>)}
    <div className="grid grid-cols-2 gap-3">
      {field('price', 'السعر الشهري قبل الضريبة (ر.س)', <input className="form-control" dir="ltr" inputMode="decimal" value={form.price} onChange={e => set('price', e.target.value)} placeholder="0.00"/>, halalas !== null ? `شامل ضريبة 15%: ${formatMoney(halalas + Math.round(halalas * 0.15))} شهريًا` : undefined)}
      {field('sort', 'الترتيب', <input className="form-control" dir="ltr" inputMode="numeric" value={form.sort} onChange={e => set('sort', e.target.value)}/>, 'الأصغر أولًا في صفحة الباقات.')}
      {field('employeeCap', 'حد الموظفين', <input className="form-control" dir="ltr" inputMode="numeric" value={form.employeeCap} onChange={e => set('employeeCap', e.target.value)} placeholder="غير محدود"/>)}
      {field('requestsPerMonth', 'الطلبات في الشهر', <input className="form-control" dir="ltr" inputMode="numeric" value={form.requestsPerMonth} onChange={e => set('requestsPerMonth', e.target.value)} placeholder="غير محدود"/>)}
    </div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.autoRenewals} onChange={e => set('autoRenewals', e.target.checked)}/>تشمل التجديد التلقائي من تنبيهات انتهاء الوثائق</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)}/>متاحة للاشتراك</label>
    <p className="muted text-xs leading-6">تعديل الباقة لا يغيّر اشتراكات العملاء الحالية؛ الباقة غير المتاحة تختفي عن العملاء الجدد فقط.</p>
    {failure && <p role="alert" className="text-xs text-danger">{failure}</p>}
    <div className="flex gap-2"><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'جارٍ الحفظ…' : plan ? 'حفظ التعديل' : 'إنشاء الباقة'}</button><button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>إلغاء</button></div>
  </form>;
}

export function OfficePlans() {
  const qc = useQueryClient();
  const plans = useListOfficePlans({ query: { queryKey: getListOfficePlansQueryKey() } });
  // null: list only; 'new': the blank form; a plan: editing it.
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sorted = [...(plans.data ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id);
  async function saved() {
    setNotice(editing === 'new' ? 'أُنشئت الباقة.' : 'حُفظت الباقة.');
    setEditing(null);
    await qc.invalidateQueries({ queryKey: getListOfficePlansQueryKey() });
  }
  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="الباقات" subtitle="باقات الاشتراك الشهري التي يختار منها أصحاب المنشآت: السعر، وحد الموظفين، وعدد الطلبات، والتجديد التلقائي." action={editing ? undefined : <button type="button" className="btn btn-primary" onClick={() => { setEditing('new'); setNotice(null); }}><Plus size={17}/>باقة جديدة</button>}/>
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0">
        {notice && <p role="status" className="mb-3 rounded-lg bg-ok-soft px-4 py-3 text-sm text-ok">{notice}</p>}
        {plans.isLoading ? <LoadingBlock/> : plans.isError ? <ErrorBlock retry={() => plans.refetch()}/> : !sorted.length ? <EmptyBlock title="لا توجد باقات بعد" text="أنشئ أول باقة ليراها أصحاب المنشآت في صفحة الاشتراك." action="باقة جديدة" onAction={() => setEditing('new')}/>
          : <ul className="surface m-0 list-none overflow-hidden p-0">{sorted.map(plan => <li key={plan.id} className={`flex flex-col gap-3 border-b border-line px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:px-6 ${editing !== 'new' && editing?.id === plan.id ? 'bg-sage' : ''}`}>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Package size={16} className="text-copper" aria-hidden="true"/><strong>{plan.name}</strong><span className="text-xs text-subtle" dir="ltr">{plan.slug}</span><span className={`pill ${plan.active ? 'pill-completed' : 'pill-cancelled'}`}>{plan.active ? 'متاحة' : 'غير متاحة'}</span></div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-subtle"><span className="nums">{formatMoney(plan.price)} شهريًا قبل الضريبة</span><span>الموظفون: {plan.employeeCap == null ? 'غير محدود' : formatNumber(plan.employeeCap)}</span><span>الطلبات: {plan.requestsPerMonth == null ? 'غير محدود' : `${formatNumber(plan.requestsPerMonth)} شهريًا`}</span>{plan.autoRenewals && <span>تجديد تلقائي</span>}</div></div>
            <button type="button" className="btn btn-outline btn-sm !min-h-11 self-start sm:self-auto" onClick={() => { setEditing(plan); setNotice(null); }}>تعديل</button>
          </li>)}</ul>}
      </div>
      <div className="xl:sticky xl:top-24">{editing && <PlanEditor key={editing === 'new' ? 'new' : editing.id} plan={editing === 'new' ? null : editing} onSaved={saved} onCancel={() => setEditing(null)}/>}</div>
    </div>
  </PortalLayout>;
}

// ---- subscriptions (owner) ---------------------------------------------------------------

export const subscriptionStatusNames: Record<SubscriptionStatus, string> = { active: 'نشط', past_due: 'متأخر السداد', cancelled: 'ملغى' };
// Reuses the request pills' colours: green, amber, grey.
const subscriptionPill: Record<SubscriptionStatus, string> = { active: 'pill-completed', past_due: 'pill-issued', cancelled: 'pill-cancelled' };
const invoiceStatusNames: Record<string, string> = { issued: 'غير مسددة', paid: 'مسددة', cancelled: 'ملغاة' };
const subscriptionFilters: [SubscriptionStatus | '', string][] = [['', 'الكل'], ['active', 'النشطة'], ['past_due', 'متأخرة السداد'], ['cancelled', 'الملغاة']];
const subscriptionsPageSize = 20;

export function OfficeSubscriptions() {
  const qc = useQueryClient();
  const update = useUpdateOfficeSubscription();
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status]);
  const params = { page, pageSize: subscriptionsPageSize, ...(status ? { status } : {}) };
  const list = useListOfficeSubscriptions(params, { query: { queryKey: getListOfficeSubscriptionsQueryKey(params), refetchInterval: 60_000 } });
  const [cancelling, setCancelling] = useState<OfficeSubscription | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  async function change(subscription: OfficeSubscription, data: { status?: 'cancelled'; autoRenewRequests?: boolean }, done: string) {
    setCancelling(null); setBusyId(subscription.id); setNotice(null);
    try {
      await update.mutateAsync({ id: subscription.id, data });
      await qc.invalidateQueries({ queryKey: getListOfficeSubscriptionsQueryKey() });
      setNotice({ kind: 'ok', text: done });
    } catch (error) {
      setNotice({ kind: 'error', text: (error as { status?: number })?.status === 409 ? 'هذا الاشتراك ملغى بالفعل.' : serverMessage(error, 'تعذّر تحديث الاشتراك. حاول مجددًا.') });
    } finally { setBusyId(null); }
  }
  const rows = list.data?.items ?? [];
  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="الاشتراكات" subtitle="اشتراكات المنشآت في الباقات الشهرية: حالتها، وموعد التجديد، وآخر فاتورة. الإلغاء يوقف الفواتير القادمة ولا يلغي الفاتورة الحالية."/>
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="تصفية حسب الحالة">{subscriptionFilters.map(([key, label]) => <button type="button" key={label} onClick={() => setStatus(key)} aria-pressed={status === key} className={`min-h-11 rounded-full border px-4 text-xs font-bold transition-colors ${status === key ? 'border-teal bg-teal text-on-dark' : 'border-line-strong bg-surface text-quiet hover:bg-sage'}`}>{label}</button>)}</div>
    {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-4 py-3 text-sm ${notice.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>{notice.text}</div>}
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.total
      ? <EmptyBlock title={status ? 'لا توجد اشتراكات بهذه الحالة' : 'لا توجد اشتراكات بعد'} text="تظهر هنا اشتراكات المنشآت فور بدئها من صفحة الباقات في البوابة."/>
      : <><div className={`surface overflow-x-auto transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}><table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b border-line bg-paper text-right text-xs text-subtle"><th className="px-4 py-3 font-bold">المنشأة</th><th className="px-4 py-3 font-bold">الباقة</th><th className="px-4 py-3 font-bold">الحالة</th><th className="px-4 py-3 font-bold">التجديد القادم</th><th className="px-4 py-3 font-bold">آخر فاتورة</th><th className="px-4 py-3 font-bold">الإجراءات</th></tr></thead>
        <tbody>{rows.map(s => <tr key={s.id} className="border-b border-line last:border-0">
          <td className="px-4 py-3"><strong>{s.companyName ?? 'منشأة بلا اسم'}</strong><span className="block text-xs text-subtle">{s.customerName ?? s.userId}</span></td>
          <td className="px-4 py-3">{s.plan.name}<span className="block text-xs text-subtle nums">{formatMoney(s.plan.total)} شهريًا</span></td>
          <td className="px-4 py-3"><span className={`pill ${subscriptionPill[s.status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{subscriptionStatusNames[s.status]}</span></td>
          <td className="px-4 py-3">{s.status === 'cancelled' ? <span className="text-subtle">أُلغي في {formatDate(s.cancelledAt)}</span> : formatDate(s.renewsAt)}</td>
          <td className="px-4 py-3">{s.latestInvoice ? <><span className={`pill pill-${s.latestInvoice.status}`}>{invoiceStatusNames[s.latestInvoice.status] ?? s.latestInvoice.status}</span><span className="mt-1 block text-xs text-subtle nums" dir="ltr" style={{ textAlign: 'right' }}>{s.latestInvoice.reference}</span></> : <span className="text-subtle">-</span>}</td>
          <td className="px-4 py-3">{s.status !== 'cancelled' && <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline btn-sm" disabled={busyId === s.id} aria-pressed={s.autoRenewRequests} onClick={() => change(s, { autoRenewRequests: !s.autoRenewRequests }, s.autoRenewRequests ? 'أُوقف فتح طلبات التجديد تلقائيًا.' : 'تُفتح طلبات التجديد تلقائيًا الآن.')}>{s.autoRenewRequests ? 'إيقاف التجديد التلقائي' : 'تفعيل التجديد التلقائي'}</button>
            <button type="button" className="rf-btn rf-btn--danger" disabled={busyId === s.id} onClick={() => setCancelling(s)}>إلغاء الاشتراك</button>
          </div>}</td>
        </tr>)}</tbody></table></div>
      <Pager page={page} pageSize={subscriptionsPageSize} total={list.data.total} onPage={setPage}/></>}
    <ConfirmDialog open={!!cancelling} onOpenChange={o => { if (!o) setCancelling(null); }} danger busy={update.isPending} confirmLabel="إلغاء الاشتراك"
      title={`إلغاء اشتراك ${cancelling?.companyName ?? cancelling?.customerName ?? 'هذه المنشأة'}؟`} description="تتوقف الفواتير الشهرية القادمة وطلبات التجديد التلقائية. لا يمكن التراجع، ويمكن للعميل الاشتراك مجددًا من البوابة."
      onConfirm={() => cancelling && change(cancelling, { status: 'cancelled' }, 'أُلغي الاشتراك.')}/>
  </PortalLayout>;
}
