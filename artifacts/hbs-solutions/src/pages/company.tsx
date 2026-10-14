import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BadgeCheck, Building2, CalendarClock, CreditCard, LogOut, Mail, MailPlus, MessageCircle, MessageSquare, Phone, Plus, ReceiptText, Repeat, Search, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import {
  getGetCompanyFileQueryKey, getGetCompanyMembershipQueryKey, getGetCompanySubscriptionQueryKey, getGetOfficeCustomerFileQueryKey, getGetPortalMeQueryKey, getGetPortalSummaryQueryKey,
  getListCompanyInvoicesQueryKey, getListCompanyMembersQueryKey, getListOfficeCustomerMembersQueryKey, getListOfficeCustomersQueryKey, getListOfficeMessageThreadsQueryKey, getListOfficeRegistrationsQueryKey, getListOfficeSubscriptionsQueryKey, getListPlansQueryKey,
  useCreateOfficeServiceRequest, useGetCompanyFile, useGetCompanyMembership, useGetCompanySubscription, useGetOfficeCustomerFile, useGetPortalMe, useInviteCompanyMember, useLeaveCompanyMembership, useListCompanyInvoices,
  useListCompanyMembers, useListOfficeCustomerMembers, useListOfficeCustomers, useListOfficeMessageThreads, useListOfficeRegistrations, useListOfficeSubscriptions, useListPlans, useRemoveCompanyMember, useStartCompanySubscription, useUpdateCompanyMember, useUpdateCompanySubscription,
  type CompanyMember, type CompanyMemberInviteInputRole, type CompanyRole, type OfficeCustomerFile, type OfficeServiceRequest, type OfficeServiceRequestInput, type OfficeServiceRequestInputCategory, type Plan, type Subscription, type SubscriptionStatus,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock, Status, dateText, useDebouncedValue } from '@/components/portal-ui';
import { Avatar, Chip, DialogFrame, type ChipTone } from '@/components/portal-kit';
import { CompanyFileView, customerCompanyApi, officeCompanyApi } from '@/components/company-file';
import { ConfirmDialog, InvoiceRow, PayInvoiceButton, useRefreshReturnedInvoice } from '@/components/request-billing';
import { ExpiryBadge, reminderKindNames } from '@/components/reminder-ui';
import { SubjectChip } from '@/components/request-conversation';
import { plansCopy } from '@/content/site';
import { formatCalendarDate, formatDate, formatMoney, formatNumber } from '@/lib/format';
import { normalizePhone } from '@/lib/phone';
import './company.css';

// ---- roles -------------------------------------------------------------------------

export const roleNames: Record<CompanyRole, string> = { owner: 'مالك', hr: 'موارد بشرية', finance: 'مالية', viewer: 'قراءة' };
// One line per role in the invite form, so the owner knows what each one opens.
export const roleHints: Record<CompanyMemberInviteInputRole, string> = {
  hr: 'يدير الموظفين والتراخيص ويرسل طلبات الخدمة.',
  finance: 'يرى الاشتراك والفواتير ويسددها، دون تعديل الموظفين.',
  viewer: 'يطّلع على ملف المنشأة فقط.',
};
const inviteRoles = Object.keys(roleHints) as CompanyMemberInviteInputRole[];
// Which sections each role opens. The API enforces the same matrix; hiding
// controls here only spares the person a request that would fail.
export const canSeeMembers = (role: CompanyRole) => role === 'owner';
export const canSeeSubscription = (role: CompanyRole) => role === 'owner' || role === 'finance';

const companyTabs = [['file', 'المنشأة والموظفون'], ['members', 'أعضاء المنشأة'], ['subscription', 'الاشتراك والفواتير']] as const;
type CompanyTab = (typeof companyTabs)[number][0];
function handleTabKeyDown<Key extends string>(event: KeyboardEvent<HTMLButtonElement>, index: number, tabs: readonly (readonly [Key, string])[], select: (key: Key) => void) {
  let next = index;
  if (event.key === 'ArrowLeft') next = (index + 1) % tabs.length;
  else if (event.key === 'ArrowRight') next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  select(tabs[next][0]);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}

export function CompanyPage() {
  const qc = useQueryClient();
  const search = new URLSearchParams(useSearch());
  // Back from the payment page of a subscription invoice: `/company?invoice=N`.
  const returnedInvoiceId = Number(search.get('invoice')) || null;
  const membership = useGetCompanyMembership({ query: { queryKey: getGetCompanyMembershipQueryKey(), retry: false } });
  // Until the membership answers (or when it cannot), the person is shown their
  // own file as its owner; the API refuses anything a member may not do.
  const role: CompanyRole = membership.data?.role ?? 'owner';
  const tabs = companyTabs.filter(([key]) => key === 'file' || (key === 'members' && canSeeMembers(role)) || (key === 'subscription' && canSeeSubscription(role)));
  const [chosen, setTab] = useState<CompanyTab>(() => (companyTabs.map(([k]) => k) as string[]).includes(search.get('tab') ?? '') ? search.get('tab') as CompanyTab : returnedInvoiceId ? 'subscription' : 'file');
  const tab = tabs.some(([key]) => key === chosen) ? chosen : 'file';
  const file = useGetCompanyFile({ query: { queryKey: getGetCompanyFileQueryKey() } });
  const leave = useLeaveCompanyMembership();
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  // Leaving ends the member's access at once: the membership is forgotten and
  // the page reloads so the shell routes the person like any other visitor.
  async function leaveCompany() {
    setLeaving(false); setLeaveError(null);
    try {
      await leave.mutateAsync();
      await qc.invalidateQueries({ queryKey: getGetCompanyMembershipQueryKey() });
      window.location.reload();
    } catch { setLeaveError('تعذّرت مغادرة المنشأة. حاول مرة أخرى.'); }
  }
  return <PortalLayout>
    <PageHeading eyebrow="منشأتي" title={membership.data?.companyName && role !== 'owner' ? membership.data.companyName : 'ملف المنشأة'} subtitle="بيانات المنشأة وموظفوها وتراخيصها في مكان واحد. يطّلع عليها المكتب ليخدمك أسرع، وتصلك تنبيهات قبل انتهاء أي وثيقة."/>
    {role !== 'owner' && <p className="cp-role" role="status"><ShieldCheck size={16} aria-hidden="true"/>أنت عضو بصلاحية: <strong>{roleNames[role]}</strong>
      <button type="button" className="btn btn-outline btn-sm ms-auto !text-danger" disabled={leave.isPending} onClick={() => setLeaving(true)}><LogOut size={14} aria-hidden="true"/>مغادرة المنشأة</button></p>}
    {leaveError && <p role="alert" className="mb-4 text-sm text-danger">{leaveError}</p>}
    {role !== 'owner' && <ConfirmDialog open={leaving} onOpenChange={o => { if (!o) setLeaving(false); }} danger busy={leave.isPending} confirmLabel="مغادرة"
      title={`مغادرة ${membership.data?.companyName ?? 'المنشأة'}؟`} description="تفقد الوصول إلى ملف المنشأة فورًا، ولا يمكنك العودة إلا بدعوة جديدة من مالكها." onConfirm={() => void leaveCompany()}/>}
     {tabs.length > 1 && <div className="cp-tabs" role="tablist" aria-label="أقسام المنشأة">{tabs.map(([key, label], index) => { const Icon = key === 'file' ? Building2 : key === 'members' ? UsersRound : CreditCard; return <button key={key} id={`company-tab-${key}`} role="tab" aria-controls={`company-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} type="button" onClick={() => setTab(key)} onKeyDown={e => handleTabKeyDown<CompanyTab>(e, index, tabs as readonly (readonly [CompanyTab, string])[], setTab)} className="cp-tab"><Icon size={16} aria-hidden="true"/>{label}</button>; })}</div>}
    <div id={`company-panel-${tab}`} role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `company-tab-${tab}` : undefined} tabIndex={tabs.length > 1 ? 0 : undefined} className="cp-panel">
      {tab === 'file' && (file.isLoading ? <LoadingBlock/> : file.isError ? <ErrorBlock retry={() => file.refetch()}/> : file.data &&
        <CompanyFileView file={file.data} api={customerCompanyApi} role={role} onChanged={() => qc.invalidateQueries({ queryKey: getGetCompanyFileQueryKey() })}/>)}
      {tab === 'members' && <MembersSection/>}
      {tab === 'subscription' && <SubscriptionSection returnedInvoiceId={returnedInvoiceId}/>}
    </div>
  </PortalLayout>;
}

// ---- members -----------------------------------------------------------------------

const memberError = (e: unknown, action: 'invite' | 'update' | 'remove') => {
  const status = (e as { status?: number })?.status;
  if (status === 403) return 'هذا الإجراء لمالك المنشأة فقط.';
  if (action === 'invite') return status === 409 ? 'هذا البريد مدعو مسبقًا، أو وصلت المنشأة إلى الحد الأقصى (10 أعضاء).' : status === 400 ? 'اكتب بريدًا إلكترونيًا صحيحًا.' : 'تعذّر إرسال الدعوة. حاول مرة أخرى.';
  return action === 'update' ? 'تعذّر تغيير الصلاحية.' : 'تعذّر إزالة العضو.';
};

export function MembersSection() {
  const qc = useQueryClient();
  const key = getListCompanyMembersQueryKey();
  const list = useListCompanyMembers({ query: { queryKey: key } });
  const invite = useInviteCompanyMember();
  const update = useUpdateCompanyMember();
  const remove = useRemoveCompanyMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CompanyMemberInviteInputRole>('hr');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CompanyMember | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    try { await invite.mutateAsync({ data: { email: email.trim(), role } }); setEmail(''); await refresh(); }
    catch (err) { setError(memberError(err, 'invite')); }
  }
  async function changeRole(member: CompanyMember, next: CompanyMemberInviteInputRole) {
    setError(null);
    try { await update.mutateAsync({ id: member.id, data: { role: next } }); } catch (err) { setError(memberError(err, 'update')); }
    await refresh();
  }
  async function drop(member: CompanyMember) {
    setRemoving(null); setError(null);
    try { await remove.mutateAsync({ id: member.id }); } catch (err) { setError(memberError(err, 'remove')); }
    await refresh();
  }
  // The owner row comes first whatever the server's order.
  const members = [...(list.data ?? [])].sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'));
  return <section className="surface overflow-hidden" aria-labelledby="cp-members">
    <div className="cf-head"><h2 id="cp-members" className="display text-lg font-semibold"><UsersRound size={19} aria-hidden="true"/>أعضاء المنشأة</h2><span className="text-xs text-subtle">حتى 10 أعضاء</span></div>
    <form onSubmit={submit} className="cp-invite" aria-label="دعوة عضو">
      <label className="form-field">البريد الإلكتروني<input className="form-control" dir="ltr" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="name@company.com"/></label>
      <label className="form-field">الصلاحية<select className="form-control" value={role} onChange={e => setRole(e.target.value as CompanyMemberInviteInputRole)}>{inviteRoles.map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select><small className="muted font-normal">{roleHints[role]}</small></label>
      <button type="submit" className="btn btn-primary" disabled={invite.isPending || !email.trim()}><MailPlus size={16}/>{invite.isPending ? 'جارٍ الإرسال…' : 'دعوة'}</button>
      <p className="muted m-0 text-xs leading-6 sm:col-span-3">يدخل العضو بالبريد نفسه بعد الدعوة، ويرى من ملف المنشأة ما تسمح به صلاحيته.</p>
    </form>
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !members.length ? <p className="px-6 py-10 text-center text-sm text-subtle">لا يوجد أعضاء بعد. ادعُ زميلًا بالبريد ليرى من ملف المنشأة ما تسمح به صلاحيته.</p>
      : <ul className="cf-list">{members.map(m => <li key={m.id} className="cf-row items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><strong dir="ltr" className="cp-email">{m.email}</strong><span className={`cp-role-tag is-${m.role}`}>{roleNames[m.role]}</span>
            {m.role !== 'owner' && (m.acceptedAt ? <span className="cp-state is-accepted"><BadgeCheck size={13} aria-hidden="true"/>انضم {formatDate(m.acceptedAt)}</span> : <span className="cp-state is-pending"><Mail size={13} aria-hidden="true"/>بانتظار القبول</span>)}</div>
          {m.role !== 'owner' && <span className="block text-xs text-subtle">دُعي {formatDate(m.invitedAt)}</span>}
        </div>
        {m.role !== 'owner' && <div className="flex shrink-0 items-center gap-1">
          <label className="sr-only" htmlFor={`cp-role-${m.id}`}>صلاحية {m.email}</label>
          <select id={`cp-role-${m.id}`} className="form-control cp-role-select" value={m.role} disabled={update.isPending} onChange={e => changeRole(m, e.target.value as CompanyMemberInviteInputRole)}>{inviteRoles.map(r => <option key={r} value={r}>{roleNames[r]}</option>)}</select>
          <button type="button" className="rf-btn" onClick={() => setRemoving(m)} aria-label={`إزالة ${m.email}`} disabled={remove.isPending}><Trash2 size={16}/></button>
        </div>}
      </li>)}</ul>}
    {error && <p role="alert" className="px-6 pb-5 text-sm text-danger">{error}</p>}
    <ConfirmDialog open={!!removing} onOpenChange={o => { if (!o) setRemoving(null); }} danger confirmLabel={removing?.acceptedAt ? 'إزالة' : 'سحب الدعوة'}
      title={removing?.acceptedAt ? `إزالة ${removing.email} من المنشأة؟` : `سحب دعوة ${removing?.email ?? ''}؟`} description="يفقد الوصول إلى ملف المنشأة فورًا، ويمكنك دعوته مجددًا لاحقًا." onConfirm={() => removing && drop(removing)}/>
  </section>;
}

// ---- subscription -------------------------------------------------------------------

export const subscriptionStatusNames: Record<SubscriptionStatus, string> = { active: 'نشط', past_due: 'متأخر السداد', cancelled: 'ملغى' };
const subscriptionPill: Record<SubscriptionStatus, string> = { active: 'paid', past_due: 'issued', cancelled: 'cancelled' };
const capText = (n: number | null, unit: string) => n === null ? `${unit} بلا حد` : `${formatNumber(n)} ${unit}`;
const subscriptionError = (e: unknown) => {
  const status = (e as { status?: number })?.status;
  return status === 409 ? 'لديك اشتراك نشط بالفعل.' : status === 404 ? 'الباقة لم تعد متاحة، أو لا يوجد اشتراك نشط.' : status === 403 ? 'هذا الإجراء لمالك المنشأة فقط.' : 'تعذّر تنفيذ الطلب. حاول بعد قليل.';
};

// The first invoice is issued the moment the subscription starts, so the
// plan, the monthly total and the renewal date are confirmed first.
export function subscriptionSummary(plan: Plan, now: Date = new Date()): { total: string; renewsOn: string } {
  const renews = new Date(now); renews.setMonth(renews.getMonth() + 1);
  return { total: formatMoney(plan.total), renewsOn: formatDate(renews) };
}
function PlanCard({ plan, busy, onSubscribe }: { plan: Plan; busy: boolean; onSubscribe: () => void }) {
  return <li className="cp-plan">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="display m-0 text-lg font-semibold">{plan.name}</h3>{plan.autoRenewals && <span className="cf-tag" title={plansCopy.autoRenewalsHint}><Repeat size={11} aria-hidden="true"/> {plansCopy.autoRenewals}</span>}</div>
    {plan.description && <p className="m-0 text-sm leading-7 text-quiet">{plan.description}</p>}
    <div className="cp-price"><strong className="display nums text-2xl">{formatMoney(plan.price)}</strong><span className="text-xs text-subtle">شهريًا قبل الضريبة · {formatMoney(plan.total)} شاملة الضريبة ({formatMoney(plan.vat)})</span></div>
    <ul className="cp-plan-facts"><li>{capText(plan.employeeCap, 'موظف')}</li><li>{capText(plan.requestsPerMonth, 'طلب')} شهريًا</li></ul>
    <button type="button" className="btn btn-primary" disabled={busy} onClick={onSubscribe}>{busy ? 'جارٍ الاشتراك…' : 'اشترك'}</button>
  </li>;
}

export function SubscriptionSection({ returnedInvoiceId }: { returnedInvoiceId: number | null }) {
  const qc = useQueryClient();
  const subKey = getGetCompanySubscriptionQueryKey();
  const invoicesKey = getListCompanyInvoicesQueryKey();
  const current = useGetCompanySubscription({ query: { queryKey: subKey } });
  const invoices = useListCompanyInvoices({ query: { queryKey: invoicesKey } });
  const sub: Subscription | null | undefined = current.data?.subscription;
  // Plans are only needed when there is nothing to show instead.
  const plans = useListPlans({ query: { queryKey: getListPlansQueryKey(), enabled: !!current.data && !sub } });
  const start = useStartCompanySubscription();
  const update = useUpdateCompanySubscription();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [choosing, setChoosing] = useState<Plan | null>(null);
  // The subscription, its invoices and the dashboard's unpaid count all move together.
  const refresh = () => Promise.all([subKey, invoicesKey, getGetPortalSummaryQueryKey()].map(queryKey => qc.invalidateQueries({ queryKey })));
  const checking = useRefreshReturnedInvoice(returnedInvoiceId, refresh);
  async function run(action: () => Promise<unknown>) {
    setError(null);
    try { await action(); await refresh(); } catch (e) { setError(subscriptionError(e)); await refresh(); }
  }
  const subscriptionInvoices = invoices.data?.filter(i => i.subscriptionId !== null) ?? [];
  return <div className="space-y-6">
    <section className="surface overflow-hidden" aria-labelledby="cp-subscription" id="subscription">
      <div className="cf-head"><h2 id="cp-subscription" className="display text-lg font-semibold"><CalendarClock size={19} aria-hidden="true"/>{sub ? 'اشتراكك' : plansCopy.title}</h2>{sub && <span className={`pill pill-${subscriptionPill[sub.status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{subscriptionStatusNames[sub.status]}</span>}</div>
      {current.isLoading ? <LoadingBlock/> : current.isError ? <ErrorBlock retry={() => current.refetch()}/> : sub ? <div className="p-5 sm:p-6">
        <div className="cp-sub-head"><div><span className="eyebrow">الباقة</span><strong className="display block text-xl font-semibold">{sub.plan.name}</strong><span className="text-xs text-subtle">{formatMoney(sub.plan.total)} شهريًا شاملة الضريبة</span></div>
          <dl className="cp-sub-facts"><div><dt>{sub.status === 'cancelled' ? 'ينتهي في' : 'التجديد القادم'}</dt><dd>{formatDate(sub.renewsAt)}</dd></div><div><dt>بدأ في</dt><dd>{formatDate(sub.startsAt)}</dd></div><div><dt>الموظفون</dt><dd>{capText(sub.plan.employeeCap, 'موظف')}</dd></div><div><dt>الطلبات</dt><dd>{capText(sub.plan.requestsPerMonth, 'طلب')} شهريًا</dd></div></dl></div>
        {sub.status === 'past_due' && <p role="alert" className="mt-4 rounded-lg border border-warn-line bg-warn-soft px-4 py-3 text-sm leading-7 text-warn">فاتورة الاشتراك الأخيرة غير مسددة. سدّدها أدناه ليستمر الاشتراك.</p>}
        <label className="cp-toggle"><input type="checkbox" checked={sub.autoRenewRequests} disabled={update.isPending || sub.status === 'cancelled' || !sub.plan.autoRenewals} onChange={e => run(() => update.mutateAsync({ data: { autoRenewRequests: e.target.checked } }))}/>
          <span><strong className="block">{plansCopy.autoRenewalsToggle}</strong><span className="text-xs leading-6 text-quiet">{sub.plan.autoRenewals ? plansCopy.autoRenewalsHint : 'هذه الباقة لا تشمل التجديد التلقائي.'}</span></span></label>
        {sub.latestInvoice && <div className="mt-5"><h3 className="rf-title mb-2"><ReceiptText size={15} aria-hidden="true"/>آخر فاتورة</h3>
          <ul className="rb-list"><InvoiceRow invoice={sub.latestInvoice}><PayInvoiceButton invoice={sub.latestInvoice} onChanged={refresh}/></InvoiceRow></ul>
          {checking && <p role="status" className="rb-note mt-2">جارٍ التحقق من الدفع…</p>}
          {sub.latestInvoice.status === 'issued' && !sub.latestInvoice.canPayOnline && <p className="rb-note mt-2">للسداد تواصل مع المكتب، ويظهر السداد هنا عند تسجيله.</p>}</div>}
        {sub.status !== 'cancelled' && <div className="mt-5 flex justify-end"><button type="button" className="btn btn-outline btn-sm !text-danger" disabled={update.isPending} onClick={() => setCancelling(true)}>إلغاء الاشتراك</button></div>}
      </div> : <div className="p-5 sm:p-6">
        <p className="m-0 mb-5 text-sm leading-7 text-quiet">{plansCopy.intro}</p>
        {plans.isLoading ? <LoadingBlock/> : plans.isError ? <ErrorBlock retry={() => plans.refetch()}/> : !plans.data?.filter(p => p.active).length
          ? <EmptyBlock title={plansCopy.empty} text={plansCopy.emptyText}/>
          : <ul className="cp-plans">{plans.data.filter(p => p.active).sort((a, b) => a.sort - b.sort).map(p => <PlanCard key={p.id} plan={p} busy={start.isPending} onSubscribe={() => { setError(null); setChoosing(p); }}/>)}</ul>}
      </div>}
      {error && <p role="alert" className="px-6 pb-5 text-sm text-danger">{error}</p>}
      <ConfirmDialog open={!!choosing} onOpenChange={o => { if (!o) setChoosing(null); }} busy={start.isPending} confirmLabel="تأكيد الاشتراك"
        title={choosing ? `الاشتراك في ${choosing.name}؟` : ''}
        description={choosing ? `${subscriptionSummary(choosing).total} شهريًا شاملة الضريبة. تصدر الفاتورة الأولى الآن وتصلك بالبريد، ويتجدد الاشتراك في ${subscriptionSummary(choosing).renewsOn}. يمكنك الإلغاء في أي وقت دون فواتير جديدة.` : undefined}
        onConfirm={() => { const p = choosing; setChoosing(null); if (p) void run(() => start.mutateAsync({ data: { planId: p.id, autoRenewRequests: p.autoRenewals } })); }}/>
      <ConfirmDialog open={cancelling} onOpenChange={o => { if (!o) setCancelling(false); }} danger busy={update.isPending} confirmLabel="إلغاء الاشتراك"
        title={plansCopy.cancelTitle} description={plansCopy.cancelText} onConfirm={() => { setCancelling(false); void run(() => update.mutateAsync({ data: { cancel: true } })); }}/>
    </section>
    <section className="surface overflow-hidden" aria-labelledby="cp-invoices">
      <div className="cf-head"><h2 id="cp-invoices" className="display text-lg font-semibold"><ReceiptText size={19} aria-hidden="true"/>فواتير الاشتراك</h2></div>
      {invoices.isLoading ? <LoadingBlock/> : invoices.isError ? <ErrorBlock retry={() => invoices.refetch()}/> : !subscriptionInvoices.length ? <p className="px-6 py-10 text-center text-sm text-subtle">لا توجد فواتير اشتراك بعد.</p>
        : <ul className="rb-list cp-invoices">{subscriptionInvoices.map(invoice => <InvoiceRow key={invoice.id} invoice={invoice}><PayInvoiceButton invoice={invoice} onChanged={refresh}/></InvoiceRow>)}</ul>}
    </section>
  </div>;
}

export function OfficeCustomers() {
  const [search, setSearch] = useState('');
  const typed = useDebouncedValue(search.trim());
  // A phone typed with Arabic digits or +966 is searched in its stored form.
  const q = normalizePhone(typed) ?? typed;
  const params = q ? { q } : {};
  const list = useListOfficeCustomers(params, { query: { queryKey: getListOfficeCustomersQueryKey(params) } });
  return <PortalLayout staff>
    <PageHeading eyebrow="العملاء" title="ملفات العملاء" subtitle="كل عميل في صفحة واحدة: المنشأة والموظفون والتراخيص والطلبات والوثائق التي تقترب من الانتهاء."/>
    <label className="relative mb-4 block max-w-xl"><span className="sr-only">بحث</span><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle" size={17}/><input className="form-control !pr-10" placeholder="اسم العميل أو المنشأة أو البريد أو الجوال" value={search} onChange={e => setSearch(e.target.value)} maxLength={120}/></label>
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.length
      ? <EmptyBlock title={q ? 'لا يوجد عملاء مطابقون' : 'لا يوجد عملاء بعد'} text="يظهر هنا كل عميل وافق المكتب على تسجيله أو أرسل طلبًا."/>
      : <div className="surface overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-line bg-paper text-right text-xs text-subtle"><th className="px-5 py-3 font-medium">العميل</th><th className="px-5 py-3 font-medium">المنشأة</th><th className="px-5 py-3 font-medium">موظفون</th><th className="px-5 py-3 font-medium">طلبات نشطة</th><th className="px-5 py-3 font-medium">وثائق تنتهي خلال 60 يومًا</th><th className="px-5 py-3 font-medium">آخر نشاط</th><th/></tr></thead>
        <tbody>{list.data.map(c => <tr key={c.userId} className="border-b border-line last:border-0 hover:bg-paper">
          <td className="px-5 py-3"><Link href={`/office/customers/${encodeURIComponent(c.userId)}`} className="font-semibold text-inherit no-underline hover:underline">{c.customer?.fullName ?? 'عميل سابق للتسجيل'}</Link>{c.customer && <span className="block text-xs text-subtle" dir="ltr" style={{ textAlign: 'right' }}>{c.customer.email}</span>}</td>
          <td className="px-5 py-3">{c.companyName ?? <span className="text-subtle">-</span>}</td>
          <td className="nums px-5 py-3 text-right">{formatNumber(c.employees)}</td>
          <td className="nums px-5 py-3 text-right">{formatNumber(c.activeRequests)}</td>
          <td className={`nums px-5 py-3 text-right ${c.expiringSoon ? 'font-semibold text-warn' : ''}`}>{formatNumber(c.expiringSoon)}</td>
          <td className="px-5 py-3 text-xs text-subtle">{dateText(c.lastActivityAt)}</td>
          <td className="px-3 py-3"><Link href={`/office/customers/${encodeURIComponent(c.userId)}`} className="rf-btn" aria-label={`فتح ملف ${c.customer?.fullName ?? c.userId}`}><ArrowLeft size={16}/></Link></td>
        </tr>)}</tbody></table></div>}
  </PortalLayout>;
}

const fileTabs = [['file', 'المنشأة والموظفون'], ['requests', 'الطلبات'], ['reminders', 'الوثائق والتنبيهات'], ['members', 'الأعضاء']] as const;
type FileTab = (typeof fileTabs)[number][0];
const registrationChip: Record<string, { tone: ChipTone; label: string }> = { approved: { tone: 'ok', label: 'تسجيل معتمد' }, pending: { tone: 'warn', label: 'تسجيل بانتظار المراجعة' }, rejected: { tone: 'danger', label: 'تسجيل مرفوض' } };
const openRequestStatuses = new Set(['received', 'reviewing', 'waiting_on_customer', 'submitted_to_authority', 'awaiting_payment']);

// The customer in one glance: who they are, where their registration,
// subscription, payments, members and conversations stand, and the quick
// actions the office takes most (a request on their behalf, the messages,
// WhatsApp). Everything comes from endpoints that already exist; the
// subscription is owner-only on the API and simply absent for staff.
export function OfficeCustomerFilePage() {
  const { userId: raw } = useParams<{ userId: string }>();
  const userId = decodeURIComponent(raw ?? '');
  const qc = useQueryClient();
  const [tab, setTab] = useState<FileTab>('file');
  const [intake, setIntake] = useState(false);
  const file = useGetOfficeCustomerFile(userId, { query: { queryKey: getGetOfficeCustomerFileQueryKey(userId), enabled: !!userId } });
  const refresh = () => qc.invalidateQueries({ queryKey: getGetOfficeCustomerFileQueryKey(userId) });
  const d = file.data;
  const me = useGetPortalMe({ query: { queryKey: getGetPortalMeQueryKey(), staleTime: 300_000 } });
  const owner = me.data?.officeRole === 'owner';
  const members = useListOfficeCustomerMembers(userId, { query: { queryKey: getListOfficeCustomerMembersQueryKey(userId), enabled: !!d, retry: false } });
  const registrations = useListOfficeRegistrations({ query: { queryKey: getListOfficeRegistrationsQueryKey(), enabled: !!d?.customer, staleTime: 60_000 } });
  // Staff see the customer's threads with their WhatsApp state; the owner-only subscriptions list is matched by the customer's user ID.
  const threadParams = { q: d?.customer?.fullName ?? '', pageSize: 50 };
  const threads = useListOfficeMessageThreads(threadParams, { query: { queryKey: getListOfficeMessageThreadsQueryKey(threadParams), enabled: !!d?.customer, staleTime: 60_000 } });
  const subscriptions = useListOfficeSubscriptions({ pageSize: 100 }, { query: { queryKey: getListOfficeSubscriptionsQueryKey({ pageSize: 100 }), enabled: !!d && owner, retry: false, staleTime: 60_000 } });
  const registration = d?.customer ? registrations.data?.find(r => r.email === d.customer?.email) : undefined;
  const customerThreads = (threads.data?.items ?? []).filter(t => t.customer?.email === d?.customer?.email);
  const unreadThreads = customerThreads.filter(t => t.unread > 0).length;
  const whatsapp = customerThreads.find(t => t.whatsapp.number)?.whatsapp ?? null;
  const subscription = subscriptions.data?.items.find(s => s.userId === userId) ?? null;
  const awaitingPayment = d ? d.requests.filter(r => r.status === 'awaiting_payment').length : 0;
  const activeRequests = d ? d.requests.filter(r => openRequestStatuses.has(r.status)).length : 0;
  const title = d?.company?.name ?? d?.customer?.fullName ?? 'عميل';
  const messagesHref = `/office/messages?q=${encodeURIComponent(d?.customer?.fullName ?? '')}`;
  return <PortalLayout staff>
    <Link href="/office/customers" className="mb-4 inline-flex min-h-11 items-center gap-2 text-xs font-medium text-subtle no-underline hover:text-ink"><ArrowRight size={16}/>ملفات العملاء</Link>
    {file.isLoading ? <LoadingBlock/> : file.error?.status === 404 ? <EmptyBlock title="العميل غير موجود" text="تحقق من الرابط أو ابحث في ملفات العملاء."/> : file.isError ? <ErrorBlock retry={() => file.refetch()}/> : d && <>
      <header className="surface ocf-head" data-testid="customer-file-head">
        <div className="ocf-who">
          <Avatar name={title} size={56} className="ocf-avatar"/>
          <div className="min-w-0">
            <span className="eyebrow">ملف عميل</span>
            <h1 className="display ocf-title">{title}</h1>
            <div className="ocf-contact">{d.customer && d.company?.name && <span>{d.customer.fullName}</span>}{d.customer && <span className="inline-flex items-center gap-1" dir="ltr"><Mail size={12} aria-hidden="true"/>{d.customer.email}</span>}{d.contactPhone && <a className="inline-flex items-center gap-1 text-inherit" dir="ltr" href={`tel:${d.contactPhone}`}><Phone size={12} aria-hidden="true"/>{d.contactPhone}</a>}</div>
            <div className="ocf-chips">
              {registration ? <Chip tone={registrationChip[registration.status]?.tone ?? 'neutral'} dot size="sm">{registrationChip[registration.status]?.label ?? registration.status}</Chip> : d.customer ? <Chip tone="neutral" size="sm">بلا طلب تسجيل</Chip> : <Chip tone="neutral" size="sm">عميل سابق للتسجيل</Chip>}
              {whatsapp && <Chip tone={whatsapp.verified ? 'ok' : 'warn'} dot size="sm" icon={<MessageCircle size={12} aria-hidden="true"/>}>{whatsapp.verified ? 'واتساب موثّق' : 'واتساب غير موثّق'}</Chip>}
              {subscription && <Chip tone={subscription.status === 'active' ? 'ok' : subscription.status === 'past_due' ? 'warn' : 'neutral'} dot size="sm" icon={<CalendarClock size={12} aria-hidden="true"/>}>{subscription.plan.name} · {subscriptionStatusNames[subscription.status]}{subscription.status !== 'cancelled' && ` · يتجدد ${formatDate(subscription.renewsAt)}`}</Chip>}
              {owner && subscriptions.data && !subscription && <Chip tone="neutral" size="sm">بلا اشتراك</Chip>}
            </div>
          </div>
        </div>
        <div className="ocf-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setIntake(true)} data-testid="button-office-intake"><Plus size={16} aria-hidden="true"/>إنشاء طلب للعميل</button>
          <Link href={messagesHref} className="btn btn-outline btn-sm"><MessageSquare size={16} aria-hidden="true"/>الرسائل{unreadThreads > 0 && <span className="nums"> ({formatNumber(unreadThreads)})</span>}</Link>
          {whatsapp?.verified && whatsapp.link && <a className="btn btn-outline btn-sm" href={whatsapp.link} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} aria-hidden="true"/>واتساب</a>}
        </div>
        <ul className="ocf-stats" aria-label="أرقام العميل">
          {([
            ['موظفون', formatNumber(d.employees.filter(e => e.status === 'active').length), undefined],
            ['تراخيص', formatNumber(d.licenses.length), undefined],
            ['طلبات نشطة', formatNumber(activeRequests), activeRequests ? 'requests' : undefined],
            ['بانتظار السداد', formatNumber(awaitingPayment), awaitingPayment ? 'requests' : undefined],
            ['أعضاء المنشأة', members.data ? formatNumber(members.data.length) : '—', members.data ? 'members' : undefined],
            ['محادثات غير مقروءة', threads.data ? formatNumber(unreadThreads) : '—', undefined],
          ] as const).map(([label, value, target]) => <li key={label} className="ocf-stat">{target ? <button type="button" className="ocf-stat-btn" onClick={() => setTab(target)} aria-label={`${label}: ${value}، افتح`}><span className="ocf-stat-num display nums">{value}</span><span className="ocf-stat-lbl">{label}</span></button> : <><span className="ocf-stat-num display nums">{value}</span><span className="ocf-stat-lbl">{label}</span></>}</li>)}
        </ul>
      </header>
      <div className="cp-tabs" role="tablist" aria-label="أقسام ملف العميل">{fileTabs.map(([key, label], index) => <button key={key} id={`office-customer-tab-${key}`} role="tab" aria-controls={`office-customer-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} type="button" onClick={() => setTab(key)} onKeyDown={e => handleTabKeyDown<FileTab>(e, index, fileTabs, setTab)} className="cp-tab">{label}</button>)}</div>
      <div id={`office-customer-panel-${tab}`} role="tabpanel" aria-labelledby={`office-customer-tab-${tab}`} tabIndex={0} className="cp-panel">
        {tab === 'file' && <CompanyFileView file={d} api={officeCompanyApi(userId)} office onChanged={refresh}/>}
        {tab === 'requests' && (d.requests.length ? <div className="surface overflow-hidden">{d.requests.map(r => <Link key={r.id} href={`/office/requests/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 text-inherit no-underline last:border-0 hover:bg-paper">
          <div className="min-w-0"><div className="font-semibold">{r.service}</div><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle"><span dir="ltr" className="nums">{r.reference}</span><span>{dateText(r.createdAt)}</span><SubjectChip subject={r.subject}/></div></div><Status value={r.status}/>
        </Link>)}</div> : <EmptyBlock title="لا توجد طلبات" text="لم يرسل هذا العميل طلبات بعد. يمكنك إنشاء طلب باسمه من أعلى الصفحة." action="إنشاء طلب للعميل" onAction={() => setIntake(true)}/>)}
        {tab === 'reminders' && (d.reminders.length ? <div className="surface overflow-hidden">{d.reminders.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 last:border-0">
          <div><strong>{reminderKindNames[r.kind]}</strong> <span className="text-quiet">«{r.label}»</span><span className="block text-xs text-subtle">تنتهي في {formatCalendarDate(r.expiresOn)}{r.source !== 'manual' ? ' · من ملف المنشأة' : ''}</span></div><ExpiryBadge expiresOn={r.expiresOn}/>
        </div>)}</div> : <EmptyBlock title="لا توجد وثائق مؤرخة" text="أضف تواريخ انتهاء الموظفين والتراخيص لتظهر هنا."/>)}
        {tab === 'members' && <OfficeMembersList query={members}/>}
      </div>
      <OfficeIntakeDialog open={intake} onOpenChange={setIntake} userId={userId} file={d} onCreated={() => { setIntake(false); void refresh(); setTab('requests'); }}/>
    </>}
  </PortalLayout>;
}

// The company's members with their roles, as the owner sees them on /company;
// read-only for the office (invitations stay with the owner).
function OfficeMembersList({ query }: { query: { data?: CompanyMember[]; isLoading: boolean; isError: boolean; refetch: () => unknown } }) {
  if (query.isLoading) return <LoadingBlock/>;
  if (query.isError) return <ErrorBlock retry={() => query.refetch()}/>;
  const members = [...(query.data ?? [])].sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner'));
  if (!members.length) return <EmptyBlock title="لا يوجد أعضاء بعد" text="لم يدعُ مالك المنشأة أحدًا إلى ملفها."/>;
  return <section className="surface overflow-hidden" aria-labelledby="ocf-members">
    <div className="cf-head"><h2 id="ocf-members" className="display text-lg font-semibold"><UsersRound size={19} aria-hidden="true"/>أعضاء المنشأة</h2><span className="text-xs text-subtle">{formatNumber(members.length)} من 10</span></div>
    <ul className="cf-list">{members.map(m => <li key={`${m.id}-${m.email}`} className="cf-row items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><strong dir="ltr" className="cp-email">{m.email}</strong><span className={`cp-role-tag is-${m.role}`}>{roleNames[m.role]}</span>
          {m.role !== 'owner' && (m.acceptedAt ? <span className="cp-state is-accepted"><BadgeCheck size={13} aria-hidden="true"/>انضم {formatDate(m.acceptedAt)}</span> : <span className="cp-state is-pending"><Mail size={13} aria-hidden="true"/>بانتظار القبول</span>)}</div>
        {m.role !== 'owner' && <span className="block text-xs text-subtle">دُعي {formatDate(m.invitedAt)}</span>}
      </div>
    </li>)}</ul>
  </section>;
}

// Walk-in, phone and e-mail intake: the office opens the request on the
// customer's behalf. The customer's registration phone is the default
// contact; an employee or licence from their file can be the subject.
const intakeCategories: [OfficeServiceRequestInputCategory, string][] = [['passports', 'الجوازات والإقامة'], ['labor', 'الموارد البشرية والعمل'], ['business', 'تأسيس الشركات والتراخيص'], ['other', 'دعم الأعمال']];
export function intakeError(e: unknown): string {
  const status = (e as { status?: number })?.status;
  if (status === 400) return 'تحقق من البيانات: اسم الخدمة ووصف لا يقل عن 10 أحرف ورقم جوال سعودي.';
  if (status === 403) return 'ليست لديك صلاحية إنشاء طلبات باسم العملاء.';
  if (status === 404) return 'العميل غير موجود أو لم يُعتمد تسجيله بعد.';
  return 'تعذّر إنشاء الطلب. حاول مرة أخرى.';
}
export function OfficeIntakeDialog({ open, onOpenChange, userId, file, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; userId: string; file: OfficeCustomerFile; onCreated: (created: OfficeServiceRequest) => void }) {
  return <DialogFrame open={open} onOpenChange={onOpenChange} title={`إنشاء طلب للعميل: ${file.company?.name ?? file.customer?.fullName ?? 'عميل'}`} description="يُسجّل الطلب باسم العميل ويُبلَّغ به بالبريد، ويظهر في طلباته وفي لوحة المكتب كأي طلب آخر، مع الإشارة إلى أن المكتب أنشأه.">
    {open && <OfficeIntakeForm userId={userId} file={file} onCreated={onCreated} onCancel={() => onOpenChange(false)}/>}
  </DialogFrame>;
}
export function OfficeIntakeForm({ userId, file, onCreated, onCancel }: { userId: string; file: OfficeCustomerFile; onCreated: (created: OfficeServiceRequest) => void; onCancel: () => void }) {
  const create = useCreateOfficeServiceRequest();
  const [category, setCategory] = useState<OfficeServiceRequestInputCategory>('labor');
  const [service, setService] = useState('');
  const [description, setDescription] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const employees = file.employees.filter(e => e.status === 'active');
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    const phone = contactPhone.trim() ? normalizePhone(contactPhone) : null;
    if (contactPhone.trim() && !phone) { setError('اكتب رقم جوال صحيحًا (مثال: 05xxxxxxxx) أو اتركه فارغًا ليُستخدم رقم تسجيل العميل.'); return; }
    const [type, id] = subject.split(':');
    const data: OfficeServiceRequestInput = { category, service: service.trim(), description: description.trim(), ...(phone ? { contactPhone: phone } : {}), subject: type === 'employee' || type === 'license' ? { type, id: Number(id) } : null };
    try { const created = await create.mutateAsync({ userId, data }); onCreated(created); }
    catch (err) { setError(intakeError(err)); }
  }
  return <form id="office-intake-form" onSubmit={submit} className="grid gap-4" aria-label="طلب جديد باسم العميل">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="form-field">مجال الخدمة<select className="form-control" value={category} onChange={e => setCategory(e.target.value as OfficeServiceRequestInputCategory)}>{intakeCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="form-field">اسم الخدمة<input className="form-control" value={service} onChange={e => setService(e.target.value)} required minLength={1} maxLength={200} placeholder="مثال: تجديد إقامة"/></label>
    </div>
    <label className="form-field">وصف الطلب<textarea className="form-control !min-h-28" value={description} onChange={e => setDescription(e.target.value)} required minLength={10} maxLength={5000} placeholder="ما طلبه العميل بالتفصيل، كما وصل عبر الهاتف أو في المكتب."/></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="form-field">رقم التواصل (اختياري)<input className="form-control" dir="ltr" type="tel" inputMode="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} maxLength={24} placeholder={file.contactPhone ?? '05XXXXXXXX'}/><small className="field-hint">يُستخدم رقم تسجيل العميل إن تُرك فارغًا.</small></label>
      <label className="form-field">يخص (اختياري)<select className="form-control" value={subject} onChange={e => setSubject(e.target.value)}><option value="">بلا ربط</option>{employees.length > 0 && <optgroup label="الموظفون">{employees.map(e => <option key={`e${e.id}`} value={`employee:${e.id}`}>{e.fullName}</option>)}</optgroup>}{file.licenses.length > 0 && <optgroup label="التراخيص">{file.licenses.map(l => <option key={`l${l.id}`} value={`license:${l.id}`}>{l.title}</option>)}</optgroup>}</select></label>
    </div>
    {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4"><button type="button" className="btn btn-outline" onClick={onCancel} disabled={create.isPending}>إلغاء</button><button type="submit" className="btn btn-primary" disabled={create.isPending}>{create.isPending ? 'جارٍ الإنشاء…' : 'إنشاء الطلب'}</button></div>
  </form>;
}
