import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getGetPortalSettingsQueryKey, getListRemindersQueryKey,
  useCreateReminder, useDeleteReminder, useGetPortalSettings, useListReminders, useRequestPortalWhatsappVerification, useSavePortalSettings, useUpdateReminder,
  type PortalWhatsappVerification, type Reminder,
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
  const settings = useGetPortalSettings({ query: { queryKey: getGetPortalSettingsQueryKey(), refetchInterval: 15_000 } });
  const save = useSavePortalSettings();
  const verification = useRequestPortalWhatsappVerification();
  const [optIn, setOptIn] = useState(false);
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [challenge, setChallenge] = useState<PortalWhatsappVerification | null>(null);
  const [challengeErrorStatus, setChallengeErrorStatus] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!settings.data || dirty) return;
    setOptIn(settings.data.whatsappOptIn);
    setPhone(settings.data.whatsappPhone ?? '');
  }, [settings.data, dirty]);
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Date.now()), 15_000);
    (timer as unknown as { unref?: () => void }).unref?.();
    return () => globalThis.clearInterval(timer);
  }, []);
  const savedPhone = settings.data?.whatsappPhone ?? null;
  const savedPhoneMatchesInput = !!savedPhone && normalizePhone(phone) === savedPhone;
  const localChallenge = challenge?.phone === savedPhone && savedPhoneMatchesInput ? challenge : null;
  const status = settings.data?.whatsappVerificationStatus;
  const expiresAt = localChallenge?.expiresAt ?? settings.data?.whatsappVerificationExpiresAt ?? null;
  const expired = !!expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= now;
  const challengeExpired = !!localChallenge?.expiresAt && Date.parse(localChallenge.expiresAt) <= now;
  const officeNumber = localChallenge?.officeWhatsAppNumber
    ? normalizePhone(localChallenge.officeWhatsAppNumber)?.replace(/\D/g, '').replace(/^05/, '9665')
    : null;
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaved(false); setPhoneError(null);
    // An empty number clears it; anything typed must normalise (Arabic digits, +966 accepted).
    const whatsappPhone = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !whatsappPhone) { setPhoneError('اكتب رقم جوال صحيحًا (مثال: 05xxxxxxxx)'); return; }
    try {
      const updated = await save.mutateAsync({ data: { whatsappOptIn: optIn, whatsappPhone } });
      qc.setQueryData(getGetPortalSettingsQueryKey(), updated);
      setOptIn(updated.whatsappOptIn);
      setPhone(updated.whatsappPhone ?? '');
      setDirty(false);
      setChallengeErrorStatus(null);
      if (updated.whatsappPhone !== savedPhone) setChallenge(null);
      await qc.invalidateQueries({ queryKey: getGetPortalSettingsQueryKey() });
      await settings.refetch();
      setSaved(true);
    } catch { /* shown below */ }
  }
  async function requestChallenge() {
    if (!savedPhone || !savedPhoneMatchesInput || !settings.data?.whatsappVerificationAvailable) return;
    setChallenge(null);
    setChallengeErrorStatus(null);
    try {
      const draft = await verification.mutateAsync({ data: { phone: savedPhone } });
      setChallenge(draft);
      await qc.invalidateQueries({ queryKey: getGetPortalSettingsQueryKey() });
      await settings.refetch();
    } catch (error) { setChallengeErrorStatus((error as { status?: number })?.status ?? 0); }
  }
  return <PortalLayout>
    <PageHeading eyebrow="الإعدادات" title="رسائل واتساب" subtitle="تصلك رسائل البريد دائمًا عند تحديث طلباتك. اختر إن كنت تريد رسائل واتساب أيضًا." action={<Link href="/notifications" className="btn btn-outline"><Bell size={18} aria-hidden="true"/>مركز الإشعارات وتفضيلاتها</Link>}/>
    {settings.isLoading ? <LoadingBlock/> : settings.isError ? <ErrorBlock retry={() => settings.refetch()}/> : settings.data && <form onSubmit={submit} className="surface max-w-[640px] space-y-5 p-5 sm:p-7">
      {!settings.data.whatsappAvailable && <p className="rounded-lg bg-sunk p-4 text-sm leading-7 text-quiet">رسائل واتساب غير مفعّلة من المكتب حاليًا. يمكنك حفظ رقمك الآن، وتصلك الرسائل عند تفعيلها.</p>}
      <label className="flex items-start gap-3 text-sm leading-7"><input type="checkbox" className="mt-1.5" checked={optIn} onChange={e => { setDirty(true); setSaved(false); setOptIn(e.target.checked); }}/><span><strong>أوافق على استلام رسائل واتساب</strong> عن حالة طلباتي والفواتير وتنبيهات انتهاء الوثائق. يمكنني إيقافها في أي وقت.</span></label>
      <label className="form-field">رقم الجوال لواتساب<input className="form-control text-right" dir="ltr" type="tel" inputMode="tel" placeholder="05XXXXXXXX" value={phone} onChange={e => { setDirty(true); setSaved(false); setPhoneError(null); setChallengeErrorStatus(null); setPhone(e.target.value); }} maxLength={24} aria-invalid={!!phoneError} aria-describedby={phoneError ? 'wa-phone-error' : undefined}/>{phoneError && <span id="wa-phone-error" className="field-error" role="alert">{phoneError}</span>}</label>
      <section className="rounded-lg border border-line bg-sunk p-4 text-sm leading-7" aria-labelledby="whatsapp-verification-title">
        <h2 id="whatsapp-verification-title" className="font-bold">التحقق من ملكية رقم واتساب</h2>
        <p className="mt-1">حالة الرقم: <strong>{status === 'verified' ? 'موثّق' : status === 'pending' && !expired ? 'بانتظار التحقق' : status === 'pending' && expired ? 'انتهت مهلة التحقق' : status === 'unverified' ? 'غير موثّق' : 'لم يُضف رقم'}</strong></p>
        {status === 'not_set' ? <p className="mt-1">لن تُرسل رسائل إلى رقم واتساب حتى تحفظ رقمًا وتتحقق من ملكيته.</p>
          : status !== 'verified' && <p className="mt-1 text-danger">الرقم غير موثّق؛ لا يمكنه استقبال رسائل حساسة أو ربط محادثة واتساب بحسابك حتى يثبت صاحبه ملكيته.</p>}
        {!settings.data.whatsappVerificationAvailable && <p className="mt-1">إعداد التحقق غير مفعّل لدى المكتب حاليًا؛ لا يمكن طلب تحدٍ الآن.</p>}
        {status === 'pending' && !expired && settings.data.whatsappVerificationExpiresAt && <p className="mt-1">تنتهي مهلة التحقق في {new Date(settings.data.whatsappVerificationExpiresAt).toLocaleString('ar-SA')}.</p>}
        {status === 'pending' && expired && <p className="mt-1 text-danger">انتهت صلاحية تحدي التحقق. اطلب تحديًا جديدًا لإكمال التحقق.</p>}
        {savedPhone && !savedPhoneMatchesInput && <p className="mt-1">احفظ رقم الجوال الحالي أولًا قبل طلب التحقق.</p>}
        <button type="button" className="btn btn-outline btn-sm mt-3" disabled={!savedPhone || !savedPhoneMatchesInput || !settings.data.whatsappVerificationAvailable || verification.isPending} onClick={requestChallenge}>
          {verification.isPending ? 'جارٍ طلب التحقق…' : status === 'pending' || status === 'unverified' ? 'طلب تحدٍ جديد' : 'طلب تحدي التحقق'}
        </button>
        {(verification.isError || challengeErrorStatus !== null) && <p role="alert" className="mt-2 text-danger">{((verification.error as { status?: number })?.status ?? challengeErrorStatus) === 503 ? 'خدمة التحقق غير مهيأة لدى المكتب حاليًا.' : ((verification.error as { status?: number })?.status ?? challengeErrorStatus) === 410 ? 'انتهت صلاحية التحدي؛ اطلب تحديًا جديدًا.' : 'تعذّر طلب التحقق. تأكد من حفظ الرقم وحاول مجددًا.'}</p>}
        {localChallenge && <div className="mt-3 space-y-2 border-t border-line pt-3">
          {settings.data.whatsappVerificationStatus === 'verified' || localChallenge.status === 'verified' ? <p role="status" className="font-bold text-ok">تم توثيق الرقم.</p> : localChallenge.challengeText && <>
            <p>{localChallenge.instructions}</p>
            <p>{challengeExpired ? 'انتهت صلاحية هذه المسودة؛ اطلب تحديًا جديدًا.' : 'المسودة الدقيقة لإرسالها من الرقم الذي تريد توثيقه:'}</p>
            <pre dir="auto" className="whitespace-pre-wrap break-words rounded-md bg-field p-3 font-mono">{localChallenge.challengeText}</pre>
            {localChallenge.expiresAt && <p>تنتهي في {new Date(localChallenge.expiresAt).toLocaleString('ar-SA')}.</p>}
            {challengeExpired ? <p role="alert" className="text-danger">انتهت صلاحية التحدي.</p> : officeNumber ? <a className="btn btn-primary btn-sm" href={`https://wa.me/${officeNumber}?text=${encodeURIComponent(localChallenge.challengeText)}`} target="_blank" rel="noopener noreferrer">افتح واتساب لمراجعة المسودة وإرسالها</a> : <p role="alert" className="text-danger">تعذّر إنشاء رابط آمن من رقم واتساب المكتب الوارد من الخدمة.</p>}
            <p className="text-xs text-quiet">سيُفتح نص جاهز للمراجعة في واتساب؛ لن تُرسل الرسالة تلقائيًا. راجعها ثم أرسلها بنفسك.</p>
          </>}
        </div>}
      </section>
      <p className="muted text-xs leading-6">تحمل الرسائل رقم الطلب وحالته فقط. لا يطلب المكتب كلمات المرور أو رموز التحقق.</p>
      {save.isError && <p role="alert" className="text-sm text-danger">{(save.error as { status?: number })?.status === 409 ? 'تغيّرت حالة التحقق أثناء الحفظ. حدّث الصفحة وحاول مجددًا.' : 'تعذّر حفظ الإعدادات. تحقق من رقم الجوال وحاول مجددًا.'}</p>}
      {saved && <p role="status" className="text-sm font-bold text-ok">تم حفظ الإعدادات.</p>}
      <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</button>
    </form>}
  </PortalLayout>;
}
