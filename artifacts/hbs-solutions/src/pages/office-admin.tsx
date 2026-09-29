import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { getListOfficeAuditLogQueryKey, getListOfficeStaffQueryKey, useAddOfficeStaff, useListOfficeAuditLog, useListOfficeStaff, useRemoveOfficeStaff, type AuditLogEntry, type OfficeStaffMember } from '@workspace/api-client-react';
import { EmptyBlock, ErrorBlock, LoadingBlock, PageHeading, PortalLayout, dateText, statusNames } from '@/components/portal-ui';
import { LOCALE } from '@/lib/format';

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

  async function revoke(member: OfficeStaffMember) {
    if (!window.confirm(`إزالة صلاحية المكتب من ${member.email ?? 'هذا الحساب'}؟`)) return;
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

  return <PortalLayout staff><PageHeading eyebrow="" title="فريق المكتب" subtitle="يدير الموظف الطلبات والاستفسارات والتسجيل. الأرشيف والفريق وسجل التدقيق للمالك فقط."/>
    <div className="space-y-6">
      <form onSubmit={submit} className="surface p-5 sm:p-6" aria-labelledby="add-staff-title">
        <h2 id="add-staff-title" className="display mb-4 text-lg font-semibold">إضافة موظف</h2>
        <label htmlFor="staff-email" className="form-field">البريد الإلكتروني
          <div className="flex flex-col gap-3 sm:flex-row">
            <input id="staff-email" type="email" dir="ltr" className="form-control" placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required/>
            <button className="btn btn-primary shrink-0" type="submit" disabled={add.isPending || !email.trim()}><UserPlus size={17}/>{add.isPending ? 'جارٍ الإضافة…' : 'إضافة'}</button>
          </div>
          <small className="muted font-normal">يُشترط أن يملك الموظف حسابًا في البوابة بهذا البريد بعد تأكيده.</small>
        </label>
        {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg px-4 py-3 text-sm ${notice.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-ok-soft text-ok'}`}>{notice.text}</div>}
      </form>
      <section aria-labelledby="staff-list-title">
        <h2 id="staff-list-title" className="display mb-3 text-lg font-semibold">الأعضاء{staff.data?.length ? <span className="nums mr-2 text-sm font-normal text-subtle">({new Intl.NumberFormat(LOCALE).format(staff.data.length)})</span> : null}</h2>
        {staff.isLoading ? <LoadingBlock/> : staff.isError ? <ErrorBlock retry={() => staff.refetch()}/> : !staff.data?.length ? <EmptyBlock title="لا يوجد أعضاء بعد" text="يظهر حساب المالك هنا بعد أول دخول له."/> :
          <ul className="surface m-0 list-none overflow-hidden p-0">{staff.data.map(member => <li key={member.userId} className="flex flex-col gap-3 border-b border-line px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="min-w-0 truncate font-bold" dir="ltr">{member.email ?? 'بريد المالك غير مؤكد'}</span><span className={`pill ${member.role === 'owner' ? 'bg-teal text-on-dark' : 'bg-info-soft text-info'}`}>{member.role === 'owner' ? 'المالك' : 'موظف'}</span></div><div className="mt-1 text-xs text-subtle">أُضيف في {dateText(member.createdAt)}</div></div>
            {member.role === 'staff' ? <button type="button" onClick={() => revoke(member)} disabled={removingId === member.userId} className="btn btn-outline btn-sm !min-h-11 self-start sm:self-auto"><Trash2 size={15}/>{removingId === member.userId ? 'جارٍ الإزالة…' : 'إزالة الصلاحية'}</button> : <span className="flex items-center gap-1.5 text-xs text-subtle"><ShieldCheck size={15}/>مرتبط ببريد المكتب المعتمد</span>}
          </li>)}</ul>}
      </section>
    </div>
  </PortalLayout>;
}

const actionNames: Record<AuditLogEntry['action'], string> = {
  'service_request.update': 'تحديث طلب',
  'inquiry.answer': 'رد على استفسار',
  'registration.review': 'مراجعة تسجيل',
  'legacy.import': 'استيراد أرشيف',
  'staff.add': 'إضافة موظف',
  'staff.remove': 'إزالة موظف',
};

function auditSummary(entry: AuditLogEntry): string {
  const d = entry.details as Record<string, unknown>;
  const text = (value: unknown) => typeof value === 'string' ? statusNames[value] ?? value : '';
  switch (entry.action) {
    case 'service_request.update': {
      const statusPart = d.fromStatus === d.toStatus ? `الحالة ${text(d.toStatus)}` : `من ${text(d.fromStatus)} إلى ${text(d.toStatus)}`;
      return `طلب رقم ${entry.targetId}: ${statusPart}${d.noteChanged ? '، مع تعديل ملاحظة المكتب' : ''}`;
    }
    case 'inquiry.answer': return `استفسار رقم ${entry.targetId}${d.edited ? ' (تعديل رد سابق)' : ''}`;
    case 'registration.review': return `طلب تسجيل رقم ${entry.targetId}: ${d.status === 'approved' ? 'موافقة' : 'رفض'}${typeof d.reason === 'string' ? `، السبب: ${d.reason}` : ''}`;
    case 'legacy.import': return `دفعة رقم ${entry.targetId}`;
    case 'staff.add':
    case 'staff.remove': return typeof d.email === 'string' ? d.email : entry.targetId;
  }
}

export function OfficeAuditLog() {
  const log = useListOfficeAuditLog({ query: { queryKey: getListOfficeAuditLogQueryKey(), refetchInterval: 60_000 } });
  const timeText = (value: string) => new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <PortalLayout staff><PageHeading eyebrow="" title="سجل التدقيق" subtitle="آخر 200 إجراء لفريق المكتب، الأحدث أولًا."/>
    {log.isLoading ? <LoadingBlock/> : log.isError ? <ErrorBlock retry={() => log.refetch()}/> : !log.data?.length ? <EmptyBlock title="لا توجد إجراءات بعد" text="تظهر هنا تحديثات الطلبات والردود ومراجعات التسجيل وتغييرات الفريق."/> :
      <div className="surface overflow-hidden">
        <div className="hidden border-b border-line bg-sunk px-6 py-3 text-xs font-bold text-subtle lg:grid lg:grid-cols-[140px_minmax(0,1fr)_220px_170px] lg:gap-4" aria-hidden="true"><span>الإجراء</span><span>التفاصيل</span><span>المنفّذ</span><span>الوقت</span></div>
        <ul className="m-0 list-none p-0">{log.data.map(entry => <li key={entry.id} className="grid gap-1.5 border-b border-line px-5 py-4 last:border-0 sm:px-6 lg:grid-cols-[140px_minmax(0,1fr)_220px_170px] lg:items-center lg:gap-4">
          <span className="flex items-center justify-between gap-3 lg:block"><span className="inline-flex w-fit rounded-md bg-copper-soft px-2 py-0.5 text-xs font-bold text-copper">{actionNames[entry.action]}</span><span className="text-xs text-subtle lg:hidden">{timeText(entry.createdAt)}</span></span>
          <span className="min-w-0 text-sm leading-7">{auditSummary(entry)}</span>
          <span className="min-w-0 truncate text-xs text-quiet" dir="ltr" style={{ textAlign: 'right' }}>{entry.actorEmail ?? entry.actorId}</span>
          <span className="hidden text-xs text-subtle lg:block">{timeText(entry.createdAt)}</span>
        </li>)}</ul>
      </div>}
  </PortalLayout>;
}
