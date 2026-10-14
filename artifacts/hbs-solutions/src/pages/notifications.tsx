import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BellOff, BellRing, CheckCheck, Clock3, Mail, Smartphone, Sparkles, VolumeX } from 'lucide-react';
import {
  getGetNotificationBriefQueryKey, getGetNotificationPreferencesQueryKey, listNotifications,
  useGetNotificationBrief, useGetNotificationPreferences, useSaveNotificationPreferences,
  NotificationKind, type Notification, type NotificationPreferences, type NotificationPreferencesInput,
} from '@workspace/api-client-react';
import { PortalLayout, PageHeading, LoadingBlock, ErrorBlock } from '@/components/portal-ui';
import { Chip, EmptyState, FilterChip, SectionHeader, Surface } from '@/components/portal-kit';
import { PriorityChip } from '@/components/notification-bell';
import { useNotificationFeed } from '@/lib/use-notifications';
import { disablePush, enablePush, isIos, isStandalone, pushState, type PushState } from '@/lib/push';
import { formatNumber, formatRelative } from '@/lib/format';
import './notifications.css';

// The notification centre for both roles: the smart brief (computed inside
// the system from the user's own data), the full list, and the delivery
// preferences. The customer's WhatsApp opt-in stays on /settings.

// Every kind in NotificationKind, labelled in Arabic. Customers see the
// customer kinds, office staff the office kinds (prefix `office.`).
export const kindLabels: Record<NotificationKind, string> = {
  'request.status': 'تحديث حالة الطلب',
  'request.message': 'رسالة من المكتب',
  'request.file': 'مستند جديد في الطلب',
  'request.assigned': 'إسناد الطلب',
  'quote.sent': 'عرض سعر',
  'invoice.issued': 'فاتورة جديدة',
  'invoice.overdue': 'فاتورة متأخرة',
  'reminder.expiring': 'وثيقة تقترب من الانتهاء',
  'registration.decision': 'قرار طلب التسجيل',
  'inquiry.answered': 'رد على استفسارك',
  'inquiry.message': 'رسالة من المكتب في استفسارك',
  'company.invite': 'دعوة إلى منشأة',
  'subscription.started': 'بدء الاشتراك',
  'subscription.invoice': 'فاتورة الاشتراك',
  'subscription.past_due': 'اشتراك متأخر السداد',
  'subscription.cancelled': 'إلغاء الاشتراك',
  'office.request_new': 'طلب جديد',
  'office.registration_new': 'طلب تسجيل جديد',
  'office.inquiry_new': 'استفسار جديد',
  'office.inquiry_message': 'رسالة عميل في استفسار',
  'office.file_new': 'مستند جديد من العميل',
  'office.message_new': 'رسالة جديدة من العميل',
  'office.quote_answered': 'رد العميل على عرض السعر',
  'office.invoice_paid': 'سداد فاتورة',
  'office.whatsapp_unmatched': 'رسالة واتساب من رقم غير معروف',
  'office.whatsapp_message': 'رسالة واتساب من عميل',
};
export const kindsFor = (staff: boolean): NotificationKind[] => Object.values(NotificationKind).filter((kind) => kind.startsWith('office.') === staff);

const PAGE = 30;
export function NotificationsPage() { return <NotificationsCenter/>; }
export function OfficeNotificationsPage() { return <NotificationsCenter staff/>; }

function NotificationsCenter({ staff = false }: { staff?: boolean }) {
  return <PortalLayout staff={staff}>
    <PageHeading eyebrow="مركز الإشعارات" title="الإشعارات" subtitle={staff ? 'ما يحتاج انتباه المكتب الآن، وكل ما وصل من تنبيهات، وطريقة وصولها إليك.' : 'ما يحتاج انتباهك الآن، وكل ما وصلك من تنبيهات، وطريقة وصولها إليك.'}/>
    <div className="notif-center">
      <div className="notif-center-main"><Brief/><Feed/></div>
      <div className="notif-center-side"><Preferences staff={staff}/></div>
    </div>
  </PortalLayout>;
}

// ---- the smart brief --------------------------------------------------------

function Brief() {
  const brief = useGetNotificationBrief({ query: { queryKey: getGetNotificationBriefQueryKey(), refetchInterval: 300_000 } });
  return <Surface tier="panel" as="section" padding="lg" className="notif-brief" aria-labelledby="brief-title">
    <SectionHeader id="brief-title" eyebrow="اليوم" title={<span className="inline-flex items-center gap-2"><Sparkles size={19} className="text-copper" aria-hidden="true"/>الملخص الذكي</span>} action={brief.data ? <span className="text-xs text-subtle">حُدّث {formatRelative(brief.data.generatedAt)}</span> : undefined}/>
    {brief.isLoading ? <LoadingBlock variant="text"/> : brief.isError ? <ErrorBlock retry={() => brief.refetch()}/> : brief.data && <>
      <p className="notif-brief-headline">{brief.data.headline}</p>
      {!brief.data.items.length ? <p className="notif-brief-calm"><BellRing size={16} aria-hidden="true"/>لا شيء يحتاج انتباهك الآن.</p> : <ul className="notif-brief-list">{brief.data.items.map((item, index) => <li key={`${item.kind}-${index}`} className="notif-brief-item">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{item.title}</strong><PriorityChip priority={item.priority}/></div><p className="m-0 mt-0.5 text-xs leading-6 text-quiet">{item.reason}</p></div>
        {item.path && <Link href={item.path} className="btn btn-outline btn-sm">افتح<ArrowLeft size={15} aria-hidden="true"/></Link>}
      </li>)}</ul>}
    </>}
    <p className="muted mt-4 text-xs leading-6">يُحسب هذا الملخص داخل النظام من بياناتك وحدها، دون إرسالها إلى أي خدمة خارجية.</p>
  </Surface>;
}

// ---- the list ----------------------------------------------------------------

function Feed() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const params = unreadOnly ? { unread: true, limit: PAGE } : { limit: PAGE };
  const feed = useNotificationFeed(params);
  // Older pages are fetched by cursor and kept here; the live first page
  // stays in the query cache. Changing the filter drops them.
  const [older, setOlder] = useState<Notification[]>([]);
  const [more, setMore] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  useEffect(() => { setOlder([]); setMore('idle'); }, [unreadOnly]);
  const rows = [...feed.items, ...older.filter((row) => !feed.items.some((live) => live.id === row.id))];
  const exhausted = more === 'done' || (older.length === 0 && feed.items.length < PAGE);
  async function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    setMore('loading');
    try {
      const page = await listNotifications({ ...params, before: last.id });
      setOlder((current) => [...current, ...page.items]);
      setMore(page.items.length < PAGE ? 'done' : 'idle');
    } catch { setMore('error'); }
  }
  const [error, setError] = useState<string | null>(null);
  const read = async (id: number) => { setError(null); try { await feed.markRead(id); setOlder((current) => current.map((row) => row.id === id ? { ...row, readAt: row.readAt ?? new Date().toISOString() } : row)); } catch { setError('تعذّر تعليم الإشعار كمقروء.'); } };
  const readAll = async () => { setError(null); try { await feed.markAllRead(); setOlder((current) => current.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() }))); } catch { setError('تعذّر تعليم الإشعارات كمقروءة.'); } };
  return <section aria-labelledby="feed-title" className="min-w-0">
    <SectionHeader id="feed-title" title={<span className="inline-flex flex-wrap items-center gap-2">كل الإشعارات{feed.unreadCount > 0 && <Chip tone="accent" size="sm" className="nums">{formatNumber(feed.unreadCount)} غير مقروءة</Chip>}</span>} action={<>
      <FilterChip active={unreadOnly} onClick={() => setUnreadOnly((value) => !value)}>غير المقروءة فقط</FilterChip>
      <button type="button" className="btn btn-outline btn-sm" disabled={feed.unreadCount === 0 || feed.marking} onClick={() => void readAll()}><CheckCheck size={16} aria-hidden="true"/>تعليم الكل كمقروء</button>
    </>}/>
    {!feed.live && !feed.isLoading && <p className="muted mb-3 text-xs">التحديث المباشر غير متاح الآن؛ تُحدَّث القائمة كل دقيقة.</p>}
    {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
    {feed.isLoading ? <LoadingBlock variant="table"/> : feed.isError ? <ErrorBlock retry={() => feed.refetch()}/> : !rows.length
      ? <Surface><EmptyState icon={<BellOff size={26} strokeWidth={1.5} aria-hidden="true"/>} title={unreadOnly ? 'لا توجد إشعارات غير مقروءة' : 'لا توجد إشعارات بعد'} text={unreadOnly ? 'قرأت كل شيء.' : 'ستظهر هنا تحديثات طلباتك وفواتيرك ووثائقك فور حدوثها.'}/></Surface>
      : <ul className="notif-feed surface">{rows.map((item) => <li key={item.id} className={`notif-feed-row ${item.readAt ? '' : 'is-unread'}`}>
        <span className="notif-feed-mark" aria-hidden="true"/>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">{!item.readAt && <span className="sr-only">غير مقروء</span>}<strong className="text-sm">{item.title}</strong><PriorityChip priority={item.priority}/><Chip size="sm" tone="outline">{kindLabels[item.kind] ?? item.kind}</Chip></div>
          <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-7 text-quiet">{item.body}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-subtle"><time dateTime={item.createdAt}>{formatRelative(item.createdAt)}</time>{item.count > 1 && <span>{formatNumber(item.count)} أحداث مجمّعة</span>}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.path && <Link href={item.path} className="btn btn-outline btn-sm" onClick={() => { if (!item.readAt) void read(item.id); }}>افتح</Link>}
          {!item.readAt && <button type="button" className="btn btn-outline btn-sm btn-icon" onClick={() => void read(item.id)} aria-label={`تعليم «${item.title}» كمقروء`}><CheckCheck size={16} aria-hidden="true"/></button>}
        </div>
      </li>)}</ul>}
    {rows.length > 0 && !exhausted && <div className="mt-4 text-center">
      {more === 'error' && <p role="alert" className="mb-2 text-sm text-danger">تعذّر تحميل المزيد.</p>}
      <button type="button" className="btn btn-outline" disabled={more === 'loading'} onClick={() => void loadMore()}>{more === 'loading' ? 'جارٍ التحميل…' : 'إشعارات أقدم'}</button>
    </div>}
  </section>;
}

// ---- preferences ---------------------------------------------------------------

const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
type Draft = NotificationPreferencesInput;
const toDraft = (prefs: NotificationPreferences): Draft => ({ emailEnabled: prefs.emailEnabled, pushEnabled: prefs.pushEnabled, quietStart: prefs.quietStart, quietEnd: prefs.quietEnd, digest: prefs.digest, mutedKinds: prefs.mutedKinds });

function Preferences({ staff }: { staff: boolean }) {
  const qc = useQueryClient();
  const prefs = useGetNotificationPreferences({ query: { queryKey: getGetNotificationPreferencesQueryKey() } });
  const save = useSaveNotificationPreferences();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (prefs.data) setDraft(toDraft(prefs.data)); }, [prefs.data]);
  const kinds = kindsFor(staff);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setSaved(false);
    // Quiet hours need both ends; one alone is cleared rather than rejected.
    const quiet = draft.quietStart != null && draft.quietEnd != null;
    const data: Draft = { ...draft, quietStart: quiet ? draft.quietStart : null, quietEnd: quiet ? draft.quietEnd : null, mutedKinds: draft.mutedKinds.filter((kind) => kinds.includes(kind)) };
    try {
      await save.mutateAsync({ data });
      await qc.invalidateQueries({ queryKey: getGetNotificationPreferencesQueryKey() });
      setSaved(true);
    } catch { /* shown below */ }
  }
  const toggleKind = (kind: NotificationKind, muted: boolean) => setDraft((current) => current && ({ ...current, mutedKinds: muted ? [...new Set([...current.mutedKinds, kind])] : current.mutedKinds.filter((value) => value !== kind) }));
  const hourSelect = (label: string, key: 'quietStart' | 'quietEnd') => <label className="form-field flex-1">{label}<select className="form-control" value={draft?.[key] ?? ''} onChange={(event) => setDraft((current) => current && ({ ...current, [key]: event.target.value === '' ? null : Number(event.target.value) }))}><option value="">بدون</option>{hours.map((hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}</select></label>;
  return <section className="notif-prefs" aria-labelledby="prefs-title">
    <SectionHeader id="prefs-title" title="تفضيلات الوصول" description="تظهر كل الإشعارات هنا في البوابة دائمًا. اختر ما يصلك منها بالبريد أو كإشعار فوري على جهازك، ومتى."/>
    {prefs.isLoading ? <LoadingBlock/> : prefs.isError ? <ErrorBlock retry={() => prefs.refetch()}/> : draft && prefs.data && <form onSubmit={submit} className="notif-prefs-form">
      <Surface role="group" aria-labelledby="notif-group-mail" padding="sm" className="notif-group">
        <h3 id="notif-group-mail" className="notif-group-title"><Mail size={15} aria-hidden="true"/>القنوات</h3>
        <label className="notif-option"><input type="checkbox" checked={draft.emailEnabled} onChange={(event) => setDraft({ ...draft, emailEnabled: event.target.checked })}/><span><strong>البريد الإلكتروني</strong><span className="block text-xs leading-6 text-quiet">رسالة لكل تحديث، أو ملخص يومي حسب اختيارك أدناه.</span></span></label>
        <label className="notif-option"><input type="checkbox" checked={draft.pushEnabled} onChange={(event) => setDraft({ ...draft, pushEnabled: event.target.checked })}/><span><strong>إشعارات فورية على الجهاز</strong><span className="block text-xs leading-6 text-quiet">تصل إلى المتصفح أو الجوال حتى والبوابة مغلقة.</span></span></label>
        <PushDevice available={prefs.data.pushAvailable}/>
      </Surface>
      <Surface role="group" aria-labelledby="notif-group-clock3" padding="sm" className="notif-group">
        <h3 id="notif-group-clock3" className="notif-group-title"><Clock3 size={15} aria-hidden="true"/>ساعات الهدوء (بتوقيت الرياض)</h3>
        <p className="muted m-0 mb-3 text-xs leading-6">خلالها تُؤجَّل رسائل البريد والإشعارات الفورية إلى نهايتها، ما عدا العاجل. يمكن أن تمتد بعد منتصف الليل.</p>
        <div className="flex flex-wrap gap-3">{hourSelect('من', 'quietStart')}{hourSelect('إلى', 'quietEnd')}</div>
        <p className="mb-2 mt-4 text-sm font-medium">وتيرة البريد</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="وتيرة البريد">{([['instant', 'فور حدوثه'], ['daily', 'ملخص يومي الساعة 08:00']] as const).map(([value, label]) => <label key={value} className="chip chip-select notif-radio" data-on={draft.digest === value || undefined}><input type="radio" name="digest" className="sr-only" value={value} checked={draft.digest === value} onChange={() => setDraft({ ...draft, digest: value })}/>{label}</label>)}</div>
        <p className="muted m-0 mt-2 text-xs leading-6">العاجل يصل فورًا في الحالتين.</p>
      </Surface>
      <Surface role="group" aria-labelledby="notif-group-volumex" padding="sm" className="notif-group">
        <h3 id="notif-group-volumex" className="notif-group-title"><VolumeX size={15} aria-hidden="true"/>إيقاف أنواع معيّنة</h3>
        <p className="muted m-0 mb-3 text-xs leading-6">النوع الموقوف يبقى في البوابة فقط ولا يُرسل بالبريد أو كإشعار فوري.</p>
        <div className="notif-kinds">{kinds.map((kind) => <label key={kind} className="notif-kind"><input type="checkbox" checked={draft.mutedKinds.includes(kind)} onChange={(event) => toggleKind(kind, event.target.checked)}/>{kindLabels[kind]}</label>)}</div>
      </Surface>
      {save.isError && <p role="alert" className="m-0 text-sm text-danger">تعذّر حفظ التفضيلات. حاول مرة أخرى.</p>}
      {saved && <p role="status" className="m-0 text-sm font-semibold text-ok">حُفظت التفضيلات.</p>}
      <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'جارٍ الحفظ…' : 'حفظ التفضيلات'}</button>
    </form>}
  </section>;
}

// This device's Web Push subscription: separate from the channel switch above,
// because the browser's permission and the server's key each have their own say.
export const pushStateText: Record<PushState, string> = {
  unsupported: 'هذا المتصفح لا يدعم الإشعارات الفورية.',
  unavailable: 'الإشعارات الفورية غير مهيأة على الخادم حاليًا.',
  blocked: 'حظر المتصفح الإشعارات لهذا الموقع. اسمح بها من إعدادات الموقع في المتصفح ثم حاول مرة أخرى.',
  off: 'الإشعارات الفورية غير مفعّلة على هذا الجهاز.',
  on: 'الإشعارات الفورية مفعّلة على هذا الجهاز.',
};
function PushDevice({ available }: { available: boolean }) {
  const [state, setState] = useState<PushState | 'checking'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let on = true; void pushState().then((value) => { if (on) setState(value); }); return () => { on = false; }; }, []);
  const needsHomeScreen = isIos() && !isStandalone();
  async function toggle() {
    setBusy(true); setError(null);
    try { setState(state === 'on' ? await disablePush() : await enablePush()); }
    catch { setError('تعذّر تغيير الإشعارات الفورية على هذا الجهاز. حاول مرة أخرى.'); }
    finally { setBusy(false); }
  }
  const shown: PushState = state === 'checking' ? 'off' : !available && state !== 'unsupported' ? 'unavailable' : state;
  const canToggle = available && (shown === 'off' || shown === 'on') && !needsHomeScreen;
  return <div className="notif-device">
    <div className="flex min-w-0 items-start gap-3"><Smartphone size={20} className="mt-0.5 shrink-0 text-teal-bright" aria-hidden="true"/><div className="min-w-0">
      <strong className="text-sm">هذا الجهاز</strong>
      <p className="m-0 text-xs leading-6 text-quiet" data-push-state={shown}>{state === 'checking' ? 'جارٍ التحقق…' : pushStateText[shown]}</p>
      {needsHomeScreen && shown !== 'unsupported' && <p className="m-0 text-xs leading-6 text-warn">على iPhone وiPad: أضف الموقع إلى الشاشة الرئيسية أولًا، ثم فعّل الإشعارات من هناك.</p>}
      {error && <p role="alert" className="m-0 text-xs text-danger">{error}</p>}
    </div></div>
    {canToggle && <button type="button" className={`btn btn-sm ${shown === 'on' ? 'btn-outline' : 'btn-primary'}`} disabled={busy} onClick={() => void toggle()}>{busy ? (shown === 'on' ? 'جارٍ الإيقاف…' : 'جارٍ التفعيل…') : shown === 'on' ? 'إيقاف على هذا الجهاز' : 'تفعيل على هذا الجهاز'}</button>}
  </div>;
}
