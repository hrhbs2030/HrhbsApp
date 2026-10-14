import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, CreditCard, FileText, History, Package, Plus, ReceiptText, ShieldCheck, Sparkles, Trash2, UserPlus, UserRound, UsersRound, Building2, MessageCircle, Settings2 } from 'lucide-react';
import {
  getListOfficeAuditLogQueryKey, getListOfficeStaffQueryKey, useAddOfficeStaff, useListOfficeAuditLog, useListOfficeStaff, useRemoveOfficeStaff,
  getListOfficePlansQueryKey, getListOfficeSubscriptionsQueryKey, useCreateOfficePlan, useListOfficePlans, useUpdateOfficePlan, useListOfficeSubscriptions, useUpdateOfficeSubscription,
  type AuditLogEntry, type OfficeStaffMember, type OfficeSubscription, type Plan, type PlanInput, type SubscriptionStatus,
} from '@workspace/api-client-react';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, Pager, PortalLayout, dateText } from '@/components/portal-ui';
import { Chip, DataTable, FilterChip, SectionHeader, Toolbar, type DataColumn } from '@/components/portal-kit';
import { PrintButton } from '@/components/brand/print';
import { ConfirmDialog } from '@/components/request-billing';
import { LOCALE, formatDate, formatMoney, formatNumber, parseRiyals } from '@/lib/format';
import './office.css';

function serverMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown } | null)?.data;
  return data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : fallback;
}

function Notice({ notice }: { notice: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!notice) return null;
  return <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`ad-notice ${notice.kind === 'error' ? 'is-error' : 'is-ok'}`}>{notice.text}</div>;
}

// ---- staff (owner) ---------------------------------------------------------------------

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
  const columns: DataColumn<OfficeStaffMember>[] = [
    { key: 'member', header: 'العضو', primary: true, cell: member => <span className="ad-member"><strong dir="ltr">{member.email ?? 'بريد المالك غير مؤكد'}</strong><small>أُضيف في {dateText(member.createdAt)}</small></span> },
    { key: 'role', header: 'الدور', cell: member => member.role === 'owner' ? <Chip tone="teal" icon={<ShieldCheck size={13} aria-hidden="true"/>}>المالك</Chip> : <Chip tone="info">موظف</Chip> },
    { key: 'actions', header: <span className="sr-only">الإجراءات</span>, label: 'الإجراءات', align: 'end', width: '1%', cell: member => <div className="ad-actions">{member.role === 'staff'
      ? <button type="button" onClick={() => setRevoking(member)} disabled={removingId === member.userId} className="btn btn-outline btn-sm" data-loading={removingId === member.userId || undefined}><Trash2 size={15} aria-hidden="true"/>{removingId === member.userId ? 'جارٍ الإزالة…' : 'إزالة الصلاحية'}</button>
      : <span className="inline-flex items-center gap-1.5 text-xs text-subtle"><ShieldCheck size={15} aria-hidden="true"/>مرتبط ببريد المكتب المعتمد</span>}</div> },
  ];

  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="فريق المكتب" subtitle="يدير الموظف الطلبات والاستفسارات والتسجيل. الأرشيف والفريق وسجل التدقيق للمالك فقط."/>
    <div className="space-y-6">
      <form onSubmit={submit} className="surface p-5 sm:p-6" aria-labelledby="add-staff-title">
        <SectionHeader id="add-staff-title" title="إضافة موظف" description="يجب أن يكون الموظف قد أنشأ حسابًا في البوابة وأكّد هذا البريد. تبقى صلاحيته ما دام البريد مؤكدًا في حسابه." />
        <label htmlFor="staff-email" className="form-field">البريد الإلكتروني للموظف
          <div className="ad-form-row">
            <input id="staff-email" type="email" dir="ltr" className="form-control" placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required/>
            <button className="btn btn-primary shrink-0" type="submit" disabled={add.isPending || !email.trim()} data-loading={add.isPending || undefined}><UserPlus size={17} aria-hidden="true"/>{add.isPending ? 'جارٍ الإضافة…' : 'إضافة موظف'}</button>
          </div>
        </label>
        <div className="mt-4"><Notice notice={notice}/></div>
      </form>
      <section aria-labelledby="staff-list-title">
        <SectionHeader id="staff-list-title" title="الأعضاء" count={staff.data?.length ? new Intl.NumberFormat(LOCALE).format(staff.data.length) : undefined} />
        {staff.isLoading ? <LoadingBlock variant="table"/> : staff.isError ? <ErrorBlock retry={() => staff.refetch()}/> : !staff.data?.length ? <EmptyBlock title="لا يوجد أعضاء بعد" text="سيظهر حساب المالك هنا بعد أول دخول له."/> :
          <DataTable columns={columns} rows={staff.data} rowKey={member => member.userId} caption="أعضاء فريق المكتب" stickyHeader={false} />}
      </section>
      <ConfirmDialog open={!!revoking} onOpenChange={o => { if (!o) setRevoking(null); }} danger busy={remove.isPending} confirmLabel="إزالة الصلاحية"
        title={`إزالة صلاحية المكتب من ${revoking?.email ?? 'هذا الحساب'}؟`} description="يفقد الحساب الوصول إلى مساحة المكتب فورًا، ويمكن إضافته مجددًا بالبريد." onConfirm={() => revoking && revoke(revoking)}/>
    </div>
  </PortalLayout>;
}

// ---- audit log (owner) ----------------------------------------------------------------

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
  'service_request.create_for_customer': 'فتح طلب باسم العميل من المكتب',
};

// Action families for the timeline filter, by the prefix of the action key.
type AuditGroup = 'requests' | 'documents' | 'billing' | 'customers' | 'team' | 'plans' | 'other';
const auditGroups: [AuditGroup | '', string][] = [['', 'الكل'], ['requests', 'الطلبات'], ['documents', 'المستندات'], ['billing', 'الفواتير والعروض'], ['customers', 'ملفات العملاء'], ['team', 'الفريق والتسجيل'], ['plans', 'الباقات والاشتراكات'], ['other', 'أخرى']];
export function auditGroupOf(action: string): AuditGroup {
  if (action.startsWith('attachment.') || action === 'reminder.create' || action === 'service_request.checklist') return 'documents';
  if (action.startsWith('invoice.') || action.startsWith('service_request.quote')) return 'billing';
  if (action.startsWith('service_request.') || action.startsWith('inquiry.') || action === 'whatsapp.reply' || action === 'automation.update') return 'requests';
  if (action.startsWith('company.') || action.startsWith('employee.') || action.startsWith('license.')) return 'customers';
  if (action.startsWith('staff.') || action.startsWith('registration.')) return 'team';
  if (action.startsWith('plan.') || action.startsWith('subscription.')) return 'plans';
  return 'other';
}
const groupIcon: Record<AuditGroup, typeof History> = { requests: FileText, documents: FileText, billing: ReceiptText, customers: Building2, team: UsersRound, plans: Package, other: Settings2 };
const groupTone: Partial<Record<AuditGroup, string>> = { billing: 'is-accent', team: 'is-ok' };

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
const actorName = (entry: AuditLogEntry) => entry.actorId === 'system' ? 'النظام' : entry.actorId === 'payment-gateway' ? 'بوابة الدفع' : entry.actorId === 'automation' ? 'أتمتة النظام' : entry.actorEmail ?? entry.actorId;
const actorIcon = (entry: AuditLogEntry) => entry.actorId === 'system' || entry.actorId === 'automation' ? Bot : entry.actorId === 'payment-gateway' ? CreditCard : UserRound;

export function OfficeAuditLog() {
  const log = useListOfficeAuditLog({ query: { queryKey: getListOfficeAuditLogQueryKey(), refetchInterval: 60_000 } });
  const [group, setGroup] = useState<AuditGroup | ''>('');
  const [actor, setActor] = useState('');
  const [search, setSearch] = useState('');
  const timeText = (value: string) => new Intl.DateTimeFormat(LOCALE, { timeStyle: 'short' }).format(new Date(value));
  const dayText = (value: string) => new Intl.DateTimeFormat(LOCALE, { dateStyle: 'full' }).format(new Date(value));
  const actors = useMemo(() => [...new Map((log.data ?? []).map(e => [e.actorId, actorName(e)])).entries()], [log.data]);
  const needle = search.trim().toLowerCase();
  const shown = (log.data ?? []).filter(e => (!group || auditGroupOf(e.action) === group) && (!actor || e.actorId === actor)
    && (!needle || `${actionNames[e.action] ?? e.action} ${auditSummary(e)} ${actorName(e)} ${e.targetId}`.toLowerCase().includes(needle)));
  // Group by calendar day, newest first (the API already orders newest first).
  const days: { day: string; entries: AuditLogEntry[] }[] = [];
  for (const entry of shown) {
    const day = new Date(entry.createdAt).toDateString();
    const last = days[days.length - 1];
    if (last && last.day === day) last.entries.push(entry); else days.push({ day, entries: [entry] });
  }
  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="سجل التدقيق" subtitle="آخر 200 إجراء في المكتب: الصلاحيات، والطلبات، والمستندات، والتسجيل، ومعلومات المساعد. الأحدث أولًا." action={<PrintButton label="طباعة السجل"/>}/>
    {log.isLoading ? <LoadingBlock variant="table"/> : log.isError ? <ErrorBlock retry={() => log.refetch()}/> : !log.data?.length ? <EmptyBlock title="لا توجد إجراءات بعد" text="ستظهر هنا إجراءات فريق المكتب فور حدوثها."/> : <>
      <Toolbar search={{ value: search, onChange: setSearch, label: 'بحث في السجل', placeholder: 'إجراء، طلب، بريد…' }}
        filters={<>
          <div className="flex flex-wrap gap-2" role="group" aria-label="نوع الإجراء">{auditGroups.map(([key, label]) => <FilterChip key={label} active={group === key} onClick={() => setGroup(key)}>{label}</FilterChip>)}</div>
          <label className="rq-toolbar-select"><span className="sr-only">المنفّذ</span><select className="form-control" value={actor} onChange={e => setActor(e.target.value)}><option value="">كل المنفّذين</option>{actors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        </>} />
      <p className="au-hint"><span className="nums">{formatNumber(shown.length)}</span> من <span className="nums">{formatNumber(log.data.length)}</span> إجراء</p>
      {days.length ? days.map(({ day, entries }) => <section key={day} className="au-day" aria-label={dayText(entries[0].createdAt)}>
        <div className="au-day-head">{dayText(entries[0].createdAt)}</div>
        <ol className="au-list">{entries.map(entry => { const g = auditGroupOf(entry.action); const Icon = groupIcon[g]; const Actor = actorIcon(entry); return <li key={entry.id} className="au-item">
          <span className={`au-dot ${groupTone[g] ?? ''}`} aria-hidden="true"><Icon size={16}/></span>
          <div className="au-body">
            <div className="au-body-top"><span className="au-action">{actionNames[entry.action] ?? entry.action}</span><span className="au-actor"><Actor size={12} aria-hidden="true"/><span className="actor-id">{actorName(entry)}</span></span><time className="au-time nums" dateTime={entry.createdAt}>{timeText(entry.createdAt)}</time></div>
            <p className="au-summary">{auditSummary(entry)}</p>
          </div>
        </li>; })}</ol>
      </section>) : <EmptyBlock title="لا توجد إجراءات مطابقة" text="جرّب تصفية أخرى أو امسح البحث."/>}
    </>}
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
      setFailure((error as { status?: number })?.status === 409 ? 'هذا المعرّف مستخدم لباقة أخرى.' : serverMessage(error, 'تعذّر حفظ الباقة. حاول مرة أخرى.'));
    }
  }
  const field = (key: keyof PlanForm, label: string, input: ReactNode, hint?: string) => <label className="form-field">{label}{input}{errors[key] ? <small role="alert" className="font-normal text-danger">{errors[key]}</small> : hint && <small className="muted font-normal">{hint}</small>}</label>;
  return <form onSubmit={submit} className="surface ad-plan-form" aria-labelledby="plan-form-title">
    <SectionHeader id="plan-form-title" title={plan ? `تعديل «${plan.name}»` : 'باقة جديدة'} className="!mb-0" />
    {field('name', 'اسم الباقة', <input className="form-control" value={form.name} onChange={e => set('name', e.target.value)} maxLength={120} placeholder="مثال: باقة المنشآت الصغيرة"/>)}
    {field('slug', 'المعرّف', <input className="form-control" dir="ltr" value={form.slug} onChange={e => set('slug', e.target.value)} maxLength={60} placeholder="small-business" disabled={!!plan}/>, plan ? 'لا يتغير المعرّف بعد الإنشاء.' : 'يظهر في الروابط؛ أحرف لاتينية صغيرة وأرقام وشرطات.')}
    {field('description', 'الوصف للعميل', <textarea className="form-control !min-h-24" value={form.description} onChange={e => set('description', e.target.value)} maxLength={2000} placeholder="ما تشمله الباقة..."/>)}
    <div className="grid-2">
      {field('price', 'السعر الشهري قبل الضريبة (ر.س)', <input className="form-control" dir="ltr" inputMode="decimal" value={form.price} onChange={e => set('price', e.target.value)} placeholder="0.00"/>, halalas !== null ? `شامل ضريبة 15%: ${formatMoney(halalas + Math.round(halalas * 0.15))} شهريًا` : undefined)}
      {field('sort', 'الترتيب', <input className="form-control" dir="ltr" inputMode="numeric" value={form.sort} onChange={e => set('sort', e.target.value)}/>, 'الأصغر أولًا في صفحة الباقات.')}
      {field('employeeCap', 'حد الموظفين', <input className="form-control" dir="ltr" inputMode="numeric" value={form.employeeCap} onChange={e => set('employeeCap', e.target.value)} placeholder="غير محدود"/>)}
      {field('requestsPerMonth', 'الطلبات في الشهر', <input className="form-control" dir="ltr" inputMode="numeric" value={form.requestsPerMonth} onChange={e => set('requestsPerMonth', e.target.value)} placeholder="غير محدود"/>)}
    </div>
    <label className="ad-check"><input type="checkbox" checked={form.autoRenewals} onChange={e => set('autoRenewals', e.target.checked)}/>تشمل التجديد التلقائي من تنبيهات انتهاء الوثائق</label>
    <label className="ad-check"><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)}/>متاحة للاشتراك</label>
    <p className="muted text-xs leading-6">تعديل الباقة لا يغيّر اشتراكات العملاء الحالية؛ الباقة غير المتاحة تختفي عن العملاء الجدد فقط.</p>
    {failure && <p role="alert" className="text-xs text-danger">{failure}</p>}
    <div className="flex gap-2"><button type="submit" className="btn btn-primary" disabled={busy} data-loading={busy || undefined}>{busy ? 'جارٍ الحفظ…' : plan ? 'حفظ التعديل' : 'إنشاء الباقة'}</button><button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>إلغاء</button></div>
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
  const columns: DataColumn<Plan>[] = [
    { key: 'name', header: 'الباقة', primary: true, cell: plan => <span className="ad-member"><strong className="inline-flex items-center gap-2"><Package size={15} className="text-copper" aria-hidden="true"/>{plan.name}</strong><small dir="ltr" className="nums">{plan.slug}</small></span> },
    { key: 'price', header: 'السعر الشهري', nums: true, cell: plan => <><span className="block">{formatMoney(plan.price)} شهريًا</span><span className="block text-xs text-subtle"> قبل الضريبة</span></> },
    { key: 'employees', header: 'الموظفون', hideBelow: 'md', nums: true, cell: plan => plan.employeeCap == null ? 'غير محدود' : formatNumber(plan.employeeCap) },
    { key: 'requests', header: 'الطلبات شهريًا', hideBelow: 'md', nums: true, cell: plan => plan.requestsPerMonth == null ? 'غير محدود' : formatNumber(plan.requestsPerMonth) },
    { key: 'renew', header: 'تجديد تلقائي', hideBelow: 'lg', cell: plan => plan.autoRenewals ? <Chip tone="ok" size="sm" icon={<Sparkles size={12} aria-hidden="true"/>}>مشمول</Chip> : <span className="text-subtle">—</span> },
    { key: 'active', header: 'الحالة', cell: plan => <Chip tone={plan.active ? 'ok' : 'neutral'} size="sm" dot>{plan.active ? 'متاحة' : 'غير متاحة'}</Chip> },
    { key: 'actions', header: <span className="sr-only">الإجراءات</span>, label: 'الإجراءات', align: 'end', width: '1%', cell: plan => <div className="ad-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => { setEditing(plan); setNotice(null); }}>تعديل</button></div> },
  ];
  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="الباقات" subtitle="باقات الاشتراك الشهري التي يختار منها أصحاب المنشآت: السعر، وحد الموظفين، وعدد الطلبات، والتجديد التلقائي." action={editing ? undefined : <button type="button" className="btn btn-primary" onClick={() => { setEditing('new'); setNotice(null); }}><Plus size={17} aria-hidden="true"/>باقة جديدة</button>}/>
    <div className="ad-plan-grid">
      <div className="min-w-0">
        {notice && <p role="status" className="ad-notice is-ok">{notice}</p>}
        {plans.isLoading ? <LoadingBlock variant="table"/> : plans.isError ? <ErrorBlock retry={() => plans.refetch()}/> : !sorted.length ? <EmptyBlock title="لا توجد باقات بعد" text="أنشئ أول باقة ليراها أصحاب المنشآت في صفحة الاشتراك." action="باقة جديدة" onAction={() => setEditing('new')}/>
          : <DataTable columns={columns} rows={sorted} rowKey={plan => plan.id} caption="الباقات" rowSelected={plan => editing !== 'new' && editing?.id === plan.id} stickyHeader={false} />}
      </div>
      <div className="ad-plan-editor">{editing && <PlanEditor key={editing === 'new' ? 'new' : editing.id} plan={editing === 'new' ? null : editing} onSaved={saved} onCancel={() => setEditing(null)}/>}</div>
    </div>
  </PortalLayout>;
}

// ---- subscriptions (owner) ---------------------------------------------------------------

export const subscriptionStatusNames: Record<SubscriptionStatus, string> = { active: 'نشط', past_due: 'متأخر السداد', cancelled: 'ملغى' };
const subscriptionTone: Record<SubscriptionStatus, 'ok' | 'warn' | 'neutral'> = { active: 'ok', past_due: 'warn', cancelled: 'neutral' };
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
      setNotice({ kind: 'error', text: (error as { status?: number })?.status === 409 ? 'هذا الاشتراك ملغى بالفعل.' : serverMessage(error, 'تعذّر تحديث الاشتراك. حاول مرة أخرى.') });
    } finally { setBusyId(null); }
  }
  const rows = list.data?.items ?? [];
  const columns: DataColumn<OfficeSubscription>[] = [
    { key: 'company', header: 'المنشأة', primary: true, cell: s => <span className="ad-member"><strong>{s.companyName ?? 'منشأة بلا اسم'}</strong><small>{s.customerName ?? s.userId}</small></span> },
    { key: 'plan', header: 'الباقة', cell: s => <><span className="block">{s.plan.name}</span><span className="block text-xs text-subtle nums">{formatMoney(s.plan.total)} شهريًا</span></> },
    { key: 'status', header: 'الحالة', cell: s => <Chip tone={subscriptionTone[s.status]} dot size="sm">{subscriptionStatusNames[s.status]}</Chip> },
    { key: 'renews', header: 'التجديد القادم', hideBelow: 'md', nums: true, cell: s => s.status === 'cancelled' ? <span className="text-subtle">أُلغي في {formatDate(s.cancelledAt)}</span> : formatDate(s.renewsAt) },
    { key: 'invoice', header: 'آخر فاتورة', hideBelow: 'lg', cell: s => s.latestInvoice ? <><span className={`pill pill-${s.latestInvoice.status}`}>{invoiceStatusNames[s.latestInvoice.status] ?? s.latestInvoice.status}</span><span className="mt-1 block text-xs text-subtle nums" dir="ltr">{s.latestInvoice.reference}</span></> : <span className="text-subtle">-</span> },
    { key: 'actions', header: <span className="sr-only">الإجراءات</span>, label: 'الإجراءات', align: 'end', width: '1%', cell: s => s.status !== 'cancelled' ? <div className="ad-actions">
      <button type="button" className="btn btn-outline btn-sm" disabled={busyId === s.id} aria-pressed={s.autoRenewRequests} onClick={() => change(s, { autoRenewRequests: !s.autoRenewRequests }, s.autoRenewRequests ? 'أُوقف فتح طلبات التجديد تلقائيًا.' : 'تُفتح طلبات التجديد تلقائيًا الآن.')}>{s.autoRenewRequests ? 'إيقاف التجديد التلقائي' : 'تفعيل التجديد التلقائي'}</button>
      <button type="button" className="btn btn-ghost btn-sm text-danger" disabled={busyId === s.id} onClick={() => setCancelling(s)}>إلغاء الاشتراك</button>
    </div> : <span className="text-xs text-subtle">—</span> },
  ];
  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="الاشتراكات" subtitle="اشتراكات المنشآت في الباقات الشهرية: حالتها، وموعد التجديد، وآخر فاتورة. الإلغاء يوقف الفواتير القادمة ولا يلغي الفاتورة الحالية."/>
    <div className="ad-filters" role="group" aria-label="تصفية حسب الحالة">{subscriptionFilters.map(([key, label]) => <FilterChip key={label} active={status === key} onClick={() => setStatus(key)}>{label}</FilterChip>)}</div>
    <Notice notice={notice}/>
    {list.isLoading ? <LoadingBlock variant="table"/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.total
      ? <EmptyBlock title={status ? 'لا توجد اشتراكات بهذه الحالة' : 'لا توجد اشتراكات بعد'} text="تظهر هنا اشتراكات المنشآت فور بدئها من صفحة الباقات في البوابة."/>
      : <><div className={`transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}><DataTable columns={columns} rows={rows} rowKey={s => s.id} caption="الاشتراكات" rowTone={s => s.status === 'past_due' ? 'warn' : undefined} stickyHeader={false} /></div>
      <Pager page={page} pageSize={subscriptionsPageSize} total={list.data.total} onPage={setPage}/></>}
    <ConfirmDialog open={!!cancelling} onOpenChange={o => { if (!o) setCancelling(null); }} danger busy={update.isPending} confirmLabel="إلغاء الاشتراك"
      title={`إلغاء اشتراك ${cancelling?.companyName ?? cancelling?.customerName ?? 'هذه المنشأة'}؟`} description="تتوقف الفواتير الشهرية القادمة وطلبات التجديد التلقائية. لا يمكن التراجع، ويمكن للعميل الاشتراك مجددًا من البوابة."
      onConfirm={() => cancelling && change(cancelling, { status: 'cancelled' }, 'أُلغي الاشتراك.')}/>
  </PortalLayout>;
}
