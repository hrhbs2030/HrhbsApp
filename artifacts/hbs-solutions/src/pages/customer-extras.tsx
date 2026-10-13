import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellRing, Building2, CircleHelp, FileClock, MessageCircle, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  getGetPortalSettingsQueryKey, getListRemindersQueryKey,
  useCreateReminder, useDeleteReminder, useGetPortalSettings, useListReminders, useRequestPortalWhatsappVerification, useSavePortalSettings, useUpdateReminder,
  type PortalWhatsappVerification, type Reminder,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock, EmptyBlock } from '@/components/portal-ui';
import { Chip, SectionHeader, Surface } from '@/components/portal-kit';
import './customer-extras.css';
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
      : <Surface padding="none" className="overflow-hidden">{[...list.data].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn)).map(item => <div key={item.id} className="doc-row" data-tone={daysUntil(item.expiresOn) < 0 ? 'danger' : daysUntil(item.expiresOn) <= 30 ? 'warn' : undefined}>
        <span className="doc-icon" aria-hidden="true"><BellRing size={17}/></span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{reminderKindNames[item.kind]}</strong><span className="text-quiet">«{item.label}»</span><ExpiryBadge expiresOn={item.expiresOn}/></div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-subtle"><span>تنتهي في {formatCalendarDate(item.expiresOn)}</span>{item.addedBy === 'office' && item.source === 'manual' && <span>أضافها المكتب</span>}{item.note && <span>{item.note}</span>}</div></div>
        <div className="flex items-center gap-1">
          {daysUntil(item.expiresOn) <= 60 && <Link href="/requests/new" className="btn btn-outline btn-sm">اطلب التجديد</Link>}
          {item.source === 'manual' ? <>
            <button type="button" className="rf-btn" onClick={() => { setError(null); setEditing(item); }} aria-label={`تعديل ${item.label}`}><Pencil size={16}/></button>
            <button type="button" className="rf-btn" onClick={() => setDropping(item)} aria-label={`حذف ${item.label}`}><Trash2 size={16}/></button>
          </> : <Link href="/company" className="btn btn-outline btn-sm">من ملف المنشأة</Link>}
        </div>
      </div>)}</Surface>}
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
  const statusTone = status === 'verified' ? 'ok' : status === 'pending' && !expired ? 'info' : status === 'not_set' ? 'neutral' : 'warn';
  const statusText = status === 'verified' ? 'موثّق' : status === 'pending' && !expired ? 'بانتظار التحقق' : status === 'pending' && expired ? 'انتهت مهلة التحقق' : status === 'unverified' ? 'غير موثّق' : 'لم يُضف رقم';
  return <PortalLayout>
    <PageHeading eyebrow="الإعدادات" title="الإعدادات" subtitle="تصلك رسائل البريد دائمًا عند تحديث طلباتك. اختر إن كنت تريد رسائل واتساب أيضًا، وتحقق من ملكية رقمك." action={<Link href="/notifications" className="btn btn-outline"><Bell size={18} aria-hidden="true"/>مركز الإشعارات وتفضيلاتها</Link>}/>
    <div className="settings">
      <div className="settings-main">
        {settings.isLoading ? <LoadingBlock/> : settings.isError ? <ErrorBlock retry={() => settings.refetch()}/> : settings.data && <form onSubmit={submit} className="settings-form">
          <Surface as="section" aria-labelledby="wa-title" className="settings-card">
            <SectionHeader id="wa-title" as="h2" title={<span className="inline-flex items-center gap-2"><MessageCircle size={18} className="text-ok" aria-hidden="true"/>رسائل واتساب</span>} description="حالة طلباتك والفواتير وتنبيهات انتهاء الوثائق، على رقمك."/>
            {!settings.data.whatsappAvailable && <p className="settings-note">رسائل واتساب غير مفعّلة من المكتب حاليًا. يمكنك حفظ رقمك الآن، وتصلك الرسائل عند تفعيلها.</p>}
            <label className="settings-option"><input type="checkbox" checked={optIn} onChange={e => { setDirty(true); setSaved(false); setOptIn(e.target.checked); }}/><span><strong>أوافق على استلام رسائل واتساب</strong> عن حالة طلباتي والفواتير وتنبيهات انتهاء الوثائق. يمكنني إيقافها في أي وقت.</span></label>
            <label className="form-field mt-4">رقم الجوال لواتساب<input className="form-control text-right" dir="ltr" type="tel" inputMode="tel" placeholder="05XXXXXXXX" value={phone} onChange={e => { setDirty(true); setSaved(false); setPhoneError(null); setChallengeErrorStatus(null); setPhone(e.target.value); }} maxLength={24} aria-invalid={!!phoneError} aria-describedby={phoneError ? 'wa-phone-error' : 'wa-phone-hint'}/>{phoneError ? <span id="wa-phone-error" className="field-error" role="alert">{phoneError}</span> : <span id="wa-phone-hint" className="field-hint">تحمل الرسائل رقم الطلب وحالته فقط. لا يطلب المكتب كلمات المرور أو رموز التحقق.</span>}</label>
          </Surface>
          <Surface as="section" aria-labelledby="whatsapp-verification-title" className="settings-card">
            <SectionHeader id="whatsapp-verification-title" as="h2" title={<span className="inline-flex items-center gap-2"><ShieldCheck size={18} className="text-teal-bright" aria-hidden="true"/>التحقق من ملكية رقم واتساب</span>} action={<Chip tone={statusTone} dot>{statusText}</Chip>}/>
            <div className="settings-verify">
              <p className="m-0">حالة الرقم: <strong>{statusText}</strong></p>
              {status === 'not_set' ? <p className="m-0">لن تُرسل رسائل إلى رقم واتساب حتى تحفظ رقمًا وتتحقق من ملكيته.</p>
                : status !== 'verified' && <p className="m-0 text-danger">الرقم غير موثّق؛ لا يمكنه استقبال رسائل حساسة أو ربط محادثة واتساب بحسابك حتى يثبت صاحبه ملكيته.</p>}
              {!settings.data.whatsappVerificationAvailable && <p className="m-0">إعداد التحقق غير مفعّل لدى المكتب حاليًا؛ لا يمكن طلب تحدٍ الآن.</p>}
              {status === 'pending' && !expired && settings.data.whatsappVerificationExpiresAt && <p className="m-0">تنتهي مهلة التحقق في {new Date(settings.data.whatsappVerificationExpiresAt).toLocaleString('ar-SA')}.</p>}
              {status === 'pending' && expired && <p className="m-0 text-danger">انتهت صلاحية تحدي التحقق. اطلب تحديًا جديدًا لإكمال التحقق.</p>}
              {savedPhone && !savedPhoneMatchesInput && <p className="m-0">احفظ رقم الجوال الحالي أولًا قبل طلب التحقق.</p>}
              <div><button type="button" className="btn btn-outline btn-sm" disabled={!savedPhone || !savedPhoneMatchesInput || !settings.data.whatsappVerificationAvailable || verification.isPending} onClick={requestChallenge}>
                {verification.isPending ? 'جارٍ طلب التحقق…' : status === 'pending' || status === 'unverified' ? 'طلب تحدٍ جديد' : 'طلب تحدي التحقق'}
              </button></div>
              {(verification.isError || challengeErrorStatus !== null) && <p role="alert" className="m-0 text-danger">{((verification.error as { status?: number })?.status ?? challengeErrorStatus) === 503 ? 'خدمة التحقق غير مهيأة لدى المكتب حاليًا.' : ((verification.error as { status?: number })?.status ?? challengeErrorStatus) === 410 ? 'انتهت صلاحية التحدي؛ اطلب تحديًا جديدًا.' : 'تعذّر طلب التحقق. تأكد من حفظ الرقم وحاول مجددًا.'}</p>}
              {localChallenge && <div className="settings-challenge">
                {settings.data.whatsappVerificationStatus === 'verified' || localChallenge.status === 'verified' ? <p role="status" className="m-0 font-bold text-ok">تم توثيق الرقم.</p> : localChallenge.challengeText && <>
                  <p className="m-0">{localChallenge.instructions}</p>
                  <p className="m-0">{challengeExpired ? 'انتهت صلاحية هذه المسودة؛ اطلب تحديًا جديدًا.' : 'المسودة الدقيقة لإرسالها من الرقم الذي تريد توثيقه:'}</p>
                  <pre dir="auto" className="settings-draft">{localChallenge.challengeText}</pre>
                  {localChallenge.expiresAt && <p className="m-0">تنتهي في {new Date(localChallenge.expiresAt).toLocaleString('ar-SA')}.</p>}
                  {challengeExpired ? <p role="alert" className="m-0 text-danger">انتهت صلاحية التحدي.</p> : officeNumber ? <a className="btn btn-primary btn-sm" href={`https://wa.me/${officeNumber}?text=${encodeURIComponent(localChallenge.challengeText)}`} target="_blank" rel="noopener noreferrer">افتح واتساب لمراجعة المسودة وإرسالها</a> : <p role="alert" className="m-0 text-danger">تعذّر إنشاء رابط آمن من رقم واتساب المكتب الوارد من الخدمة.</p>}
                  <p className="m-0 text-xs text-quiet">سيُفتح نص جاهز للمراجعة في واتساب؛ لن تُرسل الرسالة تلقائيًا. راجعها ثم أرسلها بنفسك.</p>
                </>}
              </div>}
            </div>
          </Surface>
          <div className="settings-save">
            <div className="min-w-0 flex-1 text-sm">
              {save.isError && <p role="alert" className="m-0 text-danger">{(save.error as { status?: number })?.status === 409 ? 'تغيّرت حالة التحقق أثناء الحفظ. حدّث الصفحة وحاول مجددًا.' : 'تعذّر حفظ الإعدادات. تحقق من رقم الجوال وحاول مجددًا.'}</p>}
              {saved && <p role="status" className="m-0 font-bold text-ok">تم حفظ الإعدادات.</p>}
              {!saved && !save.isError && <p className="m-0 text-quiet">{dirty ? 'لديك تغييرات غير محفوظة.' : 'يُحفظ الرقم والموافقة معًا.'}</p>}
            </div>
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ'}</button>
          </div>
        </form>}
      </div>
      <aside className="settings-side" aria-label="إعدادات أخرى">
        <Surface padding="sm">
          <h2 className="settings-side-title display">إعدادات أخرى</h2>
          <nav className="settings-links">
            <Link href="/notifications" className="settings-link"><Bell size={17} aria-hidden="true"/><span><strong>الإشعارات وتفضيلاتها</strong><small>البريد والإشعارات الفورية وساعات الهدوء</small></span><ArrowLeft size={15} aria-hidden="true"/></Link>
            <Link href="/company" className="settings-link"><Building2 size={17} aria-hidden="true"/><span><strong>ملف المنشأة</strong><small>البيانات والأعضاء والاشتراك</small></span><ArrowLeft size={15} aria-hidden="true"/></Link>
            <Link href="/documents" className="settings-link"><FileClock size={17} aria-hidden="true"/><span><strong>تنبيهات وثائقي</strong><small>مواعيد التجديد والتذكير بها</small></span><ArrowLeft size={15} aria-hidden="true"/></Link>
            <Link href="/help" className="settings-link"><CircleHelp size={17} aria-hidden="true"/><span><strong>المساعدة</strong><small>أسئلة شائعة وطرق التواصل</small></span><ArrowLeft size={15} aria-hidden="true"/></Link>
          </nav>
        </Surface>
      </aside>
    </div>
  </PortalLayout>;
}
