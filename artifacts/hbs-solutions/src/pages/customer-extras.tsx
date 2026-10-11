import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getGetPortalSettingsQueryKey, getListRemindersQueryKey,
  useCreateReminder, useDeleteReminder, useGetPortalSettings, useListReminders, useSavePortalSettings, useUpdateReminder,
  type Reminder,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock } from '@/components/portal-ui';
import { daysUntil, formatCalendarDate } from '@/lib/format';
import { normalizePhone } from '@/lib/phone';
import { ExpiryBadge, ReminderForm, emptyDraft, reminderKindNames, type Draft } from '@/components/reminder-ui';
import { ConfirmDialog } from '@/components/request-billing';

export function Documents() {
  const qc = useQueryClient();
  const list = useListReminders({ query: { queryKey: getListRemindersQueryKey() } });
  const create = useCreateReminder();
  const update = useUpdateReminder();
  const remove = useDeleteReminder();
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: getListRemindersQueryKey() });
  async function save(draft: Draft) {
    setError(null);
    const data = { kind: draft.kind, label: draft.label, expiresOn: draft.expiresOn, note: draft.note || null };
    try {
      if (editing === 'new') await create.mutateAsync({ data });
      else if (editing) await update.mutateAsync({ id: editing.id, data });
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as { status?: number })?.status === 409 ? 'وصلت إلى الحد الأقصى من التنبيهات (50).' : 'تعذّر الحفظ. تحقق من البيانات وحاول مجددًا.');
    }
  }
  const [dropping, setDropping] = useState<Reminder | null>(null);
  async function drop(item: Reminder) {
    try { await remove.mutateAsync({ id: item.id }); await refresh(); } catch { setError('تعذّر حذف التنبيه.'); }
  }
  const initial = editing && editing !== 'new'
    ? { kind: editing.kind, label: editing.label, expiresOn: editing.expiresOn.slice(0, 10), note: editing.note ?? '' } : emptyDraft;
  return <PortalLayout>
    <PageHeading eyebrow="لا تفوّت موعد تجديد" title="تنبيهات وثائقي" subtitle="نذكّرك قبل انتهاء كل وثيقة بـ30 يومًا ثم 7 أيام ثم يوم واحد. وثائق الموظفين والتراخيص تُضاف من ملف المنشأة، وهنا أي وثيقة أخرى." action={!editing && <button type="button" className="btn btn-primary" onClick={() => { setError(null); setEditing('new'); }}><Plus size={18}/>إضافة وثيقة</button>}/>
    {editing && <div className="surface mb-8 p-5 sm:p-7"><h2 className="display mb-5 text-lg font-semibold">{editing === 'new' ? 'وثيقة جديدة' : 'تعديل الوثيقة'}</h2>
      <ReminderForm key={editing === 'new' ? 'new' : editing.id} initial={initial} busy={create.isPending || update.isPending} error={error} submitLabel="حفظ" onSubmit={save} onCancel={() => setEditing(null)}/></div>}
    {list.isLoading ? <LoadingBlock/> : list.isError ? <ErrorBlock retry={() => list.refetch()}/> : !list.data?.length
      ? <EmptyBlock title="لا توجد وثائق بعد" text="أضف أول وثيقة ليصلك تنبيه بالبريد قبل انتهائها." action="إضافة وثيقة" onAction={() => setEditing('new')}/>
      : <div className="surface overflow-hidden">{list.data.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 last:border-0 sm:px-6">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><BellRing size={16} className="text-copper" aria-hidden="true"/><strong>{reminderKindNames[item.kind]}</strong><span className="text-quiet">«{item.label}»</span><ExpiryBadge expiresOn={item.expiresOn}/></div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-subtle"><span>تنتهي في {formatCalendarDate(item.expiresOn)}</span>{item.addedBy === 'office' && item.source === 'manual' && <span>أضافها المكتب</span>}{item.note && <span>{item.note}</span>}</div></div>
        <div className="flex items-center gap-1">
          {daysUntil(item.expiresOn) <= 60 && <Link href="/requests/new" className="btn btn-outline btn-sm">اطلب التجديد</Link>}
          {item.source === 'manual' ? <>
            <button type="button" className="rf-btn" onClick={() => { setError(null); setEditing(item); }} aria-label={`تعديل ${item.label}`}><Pencil size={16}/></button>
            <button type="button" className="rf-btn" onClick={() => setDropping(item)} aria-label={`حذف ${item.label}`}><Trash2 size={16}/></button>
          </> : <Link href="/company" className="btn btn-outline btn-sm">من ملف المنشأة</Link>}
        </div>
      </div>)}</div>}
    {error && !editing && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    <ConfirmDialog open={!!dropping} onOpenChange={open => { if (!open) setDropping(null); }} title={dropping ? `حذف تنبيه ${reminderKindNames[dropping.kind]} «${dropping.label}»؟` : ''} description="لن يصلك تذكير بهذه الوثيقة بعد الحذف." confirmLabel="حذف" danger onConfirm={() => { if (dropping) void drop(dropping); setDropping(null); }}/>
  </PortalLayout>;
}

export function NotificationSettings() {
  const qc = useQueryClient();
  const settings = useGetPortalSettings({ query: { queryKey: getGetPortalSettingsQueryKey() } });
  const save = useSavePortalSettings();
  const [optIn, setOptIn] = useState(false);
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  useEffect(() => { if (settings.data) { setOptIn(settings.data.whatsappOptIn); setPhone(settings.data.whatsappPhone ?? ''); } }, [settings.data]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaved(false); setPhoneError(null);
    // An empty number clears it; anything typed must normalise (Arabic digits, +966 accepted).
    const whatsappPhone = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !whatsappPhone) { setPhoneError('اكتب رقم جوال صحيحًا (مثال: 05xxxxxxxx)'); return; }
    try {
      await save.mutateAsync({ data: { whatsappOptIn: optIn, whatsappPhone } });
      await qc.invalidateQueries({ queryKey: getGetPortalSettingsQueryKey() });
      setSaved(true);
    } catch { /* shown below */ }
  }
  return <PortalLayout>
    <PageHeading eyebrow="الإعدادات" title="الإشعارات" subtitle="تصلك رسائل البريد دائمًا عند تحديث طلباتك. اختر إن كنت تريد رسائل واتساب أيضًا."/>
    {settings.isLoading ? <LoadingBlock/> : settings.isError ? <ErrorBlock retry={() => settings.refetch()}/> : settings.data && <form onSubmit={submit} className="surface max-w-[640px] space-y-5 p-5 sm:p-7">
      {!settings.data.whatsappAvailable && <p className="rounded-lg bg-sunk p-4 text-sm leading-7 text-quiet">رسائل واتساب غير مفعّلة من المكتب حاليًا. يمكنك حفظ رقمك الآن، وتصلك الرسائل عند تفعيلها.</p>}
      <label className="flex items-start gap-3 text-sm leading-7"><input type="checkbox" className="mt-1.5" checked={optIn} onChange={e => setOptIn(e.target.checked)}/><span><strong>أوافق على استلام رسائل واتساب</strong> عن حالة طلباتي والفواتير وتنبيهات انتهاء الوثائق. يمكنني إيقافها في أي وقت.</span></label>
      <label className="form-field">رقم الجوال لواتساب<input className="form-control text-right" dir="ltr" type="tel" inputMode="tel" placeholder="05XXXXXXXX" value={phone} onChange={e => { setPhoneError(null); setPhone(e.target.value); }} maxLength={24} aria-invalid={!!phoneError} aria-describedby={phoneError ? 'wa-phone-error' : undefined}/>{phoneError && <span id="wa-phone-error" className="field-error" role="alert">{phoneError}</span>}</label>
      <p className="muted text-xs leading-6">تحمل الرسائل رقم الطلب وحالته فقط. لا يطلب المكتب كلمات المرور أو رموز التحقق.</p>
      {save.isError && <p role="alert" className="text-sm text-danger">اكتب رقم جوال سعوديًا صحيحًا (05XXXXXXXX) لتفعيل واتساب.</p>}
      {saved && <p role="status" className="text-sm font-bold text-ok">تم حفظ الإعدادات.</p>}
      <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</button>
    </form>}
  </PortalLayout>;
}
