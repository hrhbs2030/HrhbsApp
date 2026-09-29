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

  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="فريق المكتب" subtitle="أضف موظفين بحساباتهم الموجودة أو أزل صلاحيتهم. الموظف يدير الطلبات والاستفسارات والتسجيل، أما الأرشيف وهذه الصفحة وسجل التدقيق فللمالك فقط."/>
    <form onSubmit={submit} className="surface mb-6 p-5 sm:p-6">
      <label htmlFor="staff-email" className="form-field">البريد الإلكتروني للموظف
        <div className="flex flex-col gap-3 sm:flex-row">
          <input id="staff-email" type="email" dir="ltr" className="form-control" placeholder="name@example.com" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required/>
          <button className="btn btn-primary shrink-0" type="submit" disabled={add.isPending || !email.trim()}><UserPlus size={17}/>{add.isPending ? 'جارٍ الإضافة…' : 'إضافة موظف'}</button>
        </div>
      </label>
      <p className="muted mt-3 text-xs leading-6">يجب أن يكون الموظف قد أنشأ حسابًا في البوابة وأكّد هذا البريد. تبقى صلاحيته ما دام البريد مؤكدًا في حسابه.</p>
      {notice && <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg px-4 py-3 text-sm ${notice.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-sage text-ok'}`}>{notice.text}</div>}
    </form>
    {staff.isLoading ? <LoadingBlock/> : staff.isError ? <ErrorBlock retry={() => staff.refetch()}/> : !staff.data?.length ? <EmptyBlock title="لا يوجد أعضاء بعد" text="سيظهر حساب المالك هنا بعد أول دخول له."/> :
      <div className="surface overflow-hidden">{staff.data.map(member => <div key={member.userId} className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4 last:border-0 sm:px-6">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate font-bold" dir="ltr">{member.email ?? 'بريد المالك غير مؤكد'}</span><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${member.role === 'owner' ? 'bg-teal text-on-dark' : 'bg-info-soft text-ok'}`}>{member.role === 'owner' ? 'المالك' : 'موظف'}</span></div><div className="muted mt-1 text-xs">منذ {dateText(member.createdAt)}</div></div>
        {member.role === 'staff' ? <button type="button" onClick={() => revoke(member)} disabled={removingId === member.userId} className="btn btn-outline !min-h-10 !px-4 text-sm"><Trash2 size={15}/>{removingId === member.userId ? 'جارٍ الإزالة…' : 'إزالة الصلاحية'}</button> : <span className="muted flex items-center gap-1.5 text-xs"><ShieldCheck size={15}/>مرتبط ببريد المكتب المعتمد</span>}
      </div>)}</div>}
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
  return <PortalLayout staff><PageHeading eyebrow="إدارة المكتب" title="سجل التدقيق" subtitle="آخر 200 إجراء نفّذه فريق المكتب، الأحدث أولًا."/>
    {log.isLoading ? <LoadingBlock/> : log.isError ? <ErrorBlock retry={() => log.refetch()}/> : !log.data?.length ? <EmptyBlock title="لا توجد إجراءات بعد" text="ستظهر هنا تحديثات الطلبات والردود ومراجعات التسجيل وتغييرات الفريق."/> :
      <div className="surface overflow-hidden">{log.data.map(entry => <div key={entry.id} className="grid gap-1 border-b border-line px-5 py-4 last:border-0 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-6">
        <span className="text-xs font-bold text-copper">{actionNames[entry.action]}</span>
        <span className="min-w-0 text-sm">{auditSummary(entry)}<span className="muted block truncate text-xs" dir="ltr">{entry.actorEmail ?? entry.actorId}</span></span>
        <span className="muted text-xs">{timeText(entry.createdAt)}</span>
      </div>)}</div>}
  </PortalLayout>;
}
