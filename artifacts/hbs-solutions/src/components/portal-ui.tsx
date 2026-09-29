import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { Archive, ArrowLeft, ArrowUpLeft, Check, CircleHelp, ClipboardList, History, Home, Inbox, LogOut, Menu, Plus, UserRoundCheck, UsersRound, X } from 'lucide-react';
import { getGetPortalMeQueryKey, useGetPortalMe, type Inquiry, type ServiceRequest, type ServiceRequestStatus } from '@workspace/api-client-react';
import { daysLabel, formatDate, formatNumber } from '@/lib/format';
import { Logo, LogoMark } from '@/components/brand/logo';
import { PrintFrame } from '@/components/brand/print';
import { cityInfo, cityOrder } from './city-scene';
import { SceneWindow, useSceneWindows } from './scene-window';
import './portal-ui.css';

export const categoryNames: Record<string, string> = { passports: 'الجوازات', labor: 'العمل', business: 'الأعمال', other: 'خدمات أخرى' };
export const statusNames: Record<string, string> = { received: 'تم الاستلام', reviewing: 'قيد المراجعة', waiting_on_customer: 'بانتظار العميل', completed: 'مكتملة', open: 'مفتوح', answered: 'تم الرد' };
export const statusOptions: ServiceRequestStatus[] = ['received', 'reviewing', 'waiting_on_customer', 'completed'];
export const dateText = (value: string | null | undefined) => formatDate(value);

export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className="inline-flex no-underline" aria-label="HBS حلول الغد - الرئيسية">
    <Logo tone={light ? 'light' : 'dark'} size={42} tagline />
  </Link>;
}
export function Status({ value }: { value: string }) { return <span className={`pill pill-${value}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusNames[value] ?? value}</span>; }
export function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><span className="eyebrow">{eyebrow}</span><h1 className="display mt-2 text-[30px] font-semibold leading-tight sm:text-[38px]">{title}</h1>{subtitle && <p className="muted mt-2 text-[14px]">{subtitle}</p>}</div>{action}</div>;
}
export function LoadingBlock() { return <div className="surface space-y-4 p-6" aria-label="جارٍ تحميل البيانات"><div className="skeleton h-6 w-1/3"/><div className="skeleton h-16 w-full"/><div className="skeleton h-16 w-full"/><div className="skeleton h-16 w-3/4"/></div>; }
export function ErrorBlock({ retry }: { retry: () => void }) { return <div className="surface p-10 text-center"><CircleHelp className="mx-auto mb-4 text-copper" size={32}/><h3 className="display text-xl">تعذّر تحميل البيانات</h3><p className="muted my-3 text-sm">حدث خطأ مؤقت. حاول مرة أخرى.</p><button className="btn btn-outline" onClick={retry}>إعادة المحاولة</button></div>; }
export function EmptyBlock({ title, text, action, href, onAction }: { title: string; text: string; action?: string; href?: string; onAction?: () => void }) { return <div className="surface flex flex-col items-center px-6 py-14 text-center"><div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-sage text-teal-bright"><Inbox size={29} strokeWidth={1.5}/></div><h3 className="display text-xl font-semibold">{title}</h3><p className="muted mt-2 max-w-sm text-sm leading-7">{text}</p>{action && href && <Link href={href} className="btn btn-primary mt-6">{action}<ArrowLeft size={17}/></Link>}{action && !href && onAction && <button type="button" onClick={onAction} className="btn btn-primary mt-6">{action}<ArrowLeft size={17}/></button>}</div>; }
export function RequestRow({ request }: { request: ServiceRequest }) { return <Link href={`/requests/${request.id}`} className="group flex items-center justify-between gap-4 border-b border-line px-5 py-4 text-inherit no-underline transition-colors last:border-0 hover:bg-paper sm:px-6">
  <div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-bold">{request.service}</span><span className="text-xs text-subtle">/ {categoryNames[request.category]}</span></div><div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-subtle"><span dir="ltr" className="nums">{request.reference}</span><span className="whitespace-nowrap">{dateText(request.createdAt)}</span></div></div>
  <div className="flex shrink-0 items-center gap-3"><Status value={request.status}/><ArrowUpLeft size={16} className="hidden text-subtle transition-transform group-hover:-translate-x-1 group-hover:-translate-y-1 sm:block"/></div>
</Link>; }
export function InquiryRow({ inquiry }: { inquiry: Inquiry }) { return <div className="border-b border-line px-5 py-5 last:border-0 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">{inquiry.subject}</h3><span className="mt-1 block text-xs text-subtle">{dateText(inquiry.createdAt)}</span></div><Status value={inquiry.status}/></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-quiet">{inquiry.message}</p>{inquiry.answer && <div className="mt-4 rounded-lg border-r-[3px] border-copper bg-copper-soft p-4"><div className="mb-1 flex justify-between gap-2 text-xs font-bold text-copper"><span>رد المكتب</span><span className="font-normal">{dateText(inquiry.answeredAt)}</span></div><p className="whitespace-pre-wrap text-sm leading-7">{inquiry.answer}</p></div>}</div>; }

export function PortalLayout({ children, staff = false, registrationOnly = false }: { children: ReactNode; staff?: boolean; registrationOnly?: boolean }) {
  const [location] = useLocation(); const [menuOpen, setMenuOpen] = useState(false); const { signOut } = useClerk(); const { user } = useUser();
  // Shares the cached /portal/me result already loaded by the route guard.
  const me = useGetPortalMe({ query: { queryKey: getGetPortalMeQueryKey(), enabled: staff } });
  const owner = staff && me.data?.officeRole === 'owner';
  useEffect(() => setMenuOpen(false), [location]);
  const ownerLinks = owner ? [{ href: '/office/legacy', label: 'الأرشيف القديم', icon: Archive }, { href: '/office/staff', label: 'فريق المكتب', icon: UsersRound }, { href: '/office/audit', label: 'سجل التدقيق', icon: History }] : [];
  const links = staff ? [{ href: '/office', label: 'نظرة عامة', icon: Home }, { href: '/office/registrations', label: 'طلبات التسجيل', icon: UserRoundCheck }, { href: '/office/requests', label: 'طلبات العملاء', icon: ClipboardList }, { href: '/office/inquiries', label: 'الاستفسارات', icon: CircleHelp }, ...ownerLinks] : registrationOnly ? [{ href: '/registration', label: 'طلب التسجيل', icon: UserRoundCheck }] : [{ href: '/registration', label: 'طلب التسجيل', icon: UserRoundCheck }, { href: '/dashboard', label: 'نظرة عامة', icon: Home }, { href: '/requests', label: 'طلباتي', icon: ClipboardList }, { href: '/inquiries', label: 'استفساراتي', icon: CircleHelp }];
  const current = links.find(({ href }) => location === href) ?? links.filter(({ href }) => location.startsWith(href + '/')).sort((a, b) => b.href.length - a.href.length)[0];
  const { city } = useSceneWindows();
  const place = cityInfo[cityOrder[city] ?? 'riyadh'];
  return <div className="relative z-[1] min-h-[100dvh] lg:flex" dir="rtl">
    <aside className={`${menuOpen ? 'translate-x-0' : 'translate-x-full'} fixed inset-y-0 right-0 z-50 flex w-[270px] flex-col bg-ink px-5 py-7 text-on-dark transition-transform duration-300 lg:sticky lg:top-0 lg:h-[100dvh] lg:translate-x-0`}>
      <div className="mb-12 flex items-start justify-between px-2"><Brand light/><button className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة"><X/></button></div>
      <span className="mb-4 px-4 text-xs font-bold text-on-dark-2">{staff ? 'مساحة المكتب' : 'مساحتي'}</span>
      <nav className="space-y-1.5">{links.map(({href,label,icon:Icon}) => <Link key={href} href={href} className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold no-underline transition-colors ${location === href || (href !== '/office' && href !== '/dashboard' && location.startsWith(href + '/')) ? 'bg-copper-light text-ink' : 'text-on-dark-2 hover:bg-sidebar-2'}`}><Icon size={19} strokeWidth={1.8}/>{label}</Link>)}</nav>
      {!staff && !registrationOnly && <Link href="/requests/new" className="mt-7 flex items-center justify-center gap-2 rounded-lg border border-line-dark-2 px-4 py-3 text-sm font-bold text-on-dark no-underline transition-colors hover:bg-sidebar-2"><Plus size={18}/>طلب خدمة جديد</Link>}
      <div className="mt-auto border-t border-line-dark pt-6"><div className="mb-4 flex items-center gap-3 px-2"><div className="grid h-9 w-9 place-items-center rounded-full bg-line-dark text-sm font-bold">{user?.firstName?.slice(0,1) || 'ح'}</div><div className="min-w-0"><div className="truncate text-xs font-semibold">{user?.fullName || user?.primaryEmailAddress?.emailAddress || 'حسابي'}</div><div className="mt-1 text-xs text-on-dark-2">{staff ? (owner ? 'مالك المكتب' : 'حساب المكتب') : 'حساب العميل'}</div></div></div><button onClick={() => signOut({redirectUrl: import.meta.env.BASE_URL})} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-on-dark-2 hover:bg-sidebar-2"><LogOut size={17}/>تسجيل الخروج</button></div>
    </aside>
    {menuOpen && <button onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 bg-night-2/50 lg:hidden" aria-label="إغلاق القائمة"/>}
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="portal-topbar sticky top-0 z-30 flex h-[72px] items-center justify-between gap-4 px-5 text-on-dark sm:px-9 lg:px-12">
        <div className="flex min-w-0 items-center gap-3">
          <button className="rounded-lg border border-line-dark-2 p-2 text-on-dark lg:hidden" onClick={() => setMenuOpen(true)} aria-label="فتح القائمة"><Menu size={21}/></button>
          <p className="portal-crumb"><span>{staff ? 'مساحة المكتب' : 'بوابة العملاء'}</span>{current && <><span aria-hidden="true" className="portal-crumb-sep">/</span><strong>{current.label}</strong></>}</p>
        </div>
        <span className="portal-topbar-brand lg:hidden" aria-hidden="true">HBS حلول الغد</span>
        <Link href="/help" className="portal-topbar-help hidden lg:inline-flex"><CircleHelp size={17} strokeWidth={1.8} aria-hidden="true"/>المساعدة</Link>
      </header>
      <div className="portal-band" aria-hidden="true" />
      <main className="portal-sheet flex-1"><div className="mx-auto max-w-[1130px] px-5 pb-20 pt-9 sm:px-9 sm:pt-12 lg:px-12"><PrintFrame />{children}</div></main>
      <footer className="portal-foot">
        <SceneWindow edge="bottom" />
        <div className="portal-foot-line">
          <LogoMark size={28} className="portal-foot-mark" />
          <small>© {new Date().getFullYear()} HBS حلول الغد</small>
          <span className="portal-foot-city" aria-hidden="true">{place.name} · {place.region}</span>
          <Link href="/help" className="portal-foot-help">المساعدة</Link>
        </div>
      </footer>
    </div>
  </div>;
}

// Matches STALE_AFTER_DAYS on the server (office summary count).
export const STALE_AFTER_DAYS = 3;
export function daysSince(value: string): number { return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000); }
export function isStale(request: { status: ServiceRequestStatus; updatedAt: string }): boolean {
  return request.status !== 'completed' && daysSince(request.updatedAt) >= STALE_AFTER_DAYS;
}
export function StaleBadge({ updatedAt }: { updatedAt: string }) {
  const days = daysSince(updatedAt);
  return <span className="inline-flex items-center whitespace-nowrap rounded-md bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn">بلا تحديث منذ {daysLabel(days)}</span>;
}

const stageNotes: Record<ServiceRequestStatus, string> = {
  received: 'وصل طلبك إلى المكتب وحصل على رقم مرجعي.',
  reviewing: 'يعمل المكتب على طلبك الآن.',
  waiting_on_customer: 'يحتاج المكتب معلومة أو مستندًا منك لإكمال الطلب.',
  completed: 'اكتمل طلبك، ويبقى في سجل طلباتك.',
};

// The request's journey through the four stages. The fill animates in once
// when the page opens; the current stage gets one soft pulse (not a loop).
// Only dates the API really has are shown: sending date and last update.
export function StatusTrack({ status, createdAt, updatedAt }: { status: ServiceRequestStatus; createdAt?: string; updatedAt?: string }) {
  const current = statusOptions.indexOf(status);
  const done = status === 'completed';
  return <ol className="timeline" aria-label="مراحل الطلب" style={{ ['--tl-progress' as string]: current / (statusOptions.length - 1) }}>
    {statusOptions.map((step, index) => {
      const state = index < current || (done && index === current) ? 'done' : index === current ? 'current' : 'next';
      return <li key={step} data-state={state} aria-current={index === current ? 'step' : undefined} style={{ ['--i' as string]: index }}>
        <span className="timeline-node" aria-hidden="true">{state === 'done' ? <Check size={13} strokeWidth={3}/> : null}</span>
        <div className="timeline-body">
          <span className="timeline-label">{statusNames[step]}</span>
          {index === current && <span className="timeline-note">{stageNotes[step]}</span>}
          {index === 0 && createdAt && <span className="timeline-date">أُرسل في {dateText(createdAt)}</span>}
          {index === current && index > 0 && updatedAt && <span className="timeline-date">آخر تحديث {dateText(updatedAt)}</span>}
        </div>
      </li>;
    })}
  </ol>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const number = formatNumber;
  return <nav className="mt-4 flex items-center justify-between gap-3 text-xs" aria-label="التنقل بين الصفحات">
    <button type="button" className="btn btn-outline !min-h-10 !px-4" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابقة</button>
    <span className="muted">صفحة {number(page)} من {number(pages)}، {number(total)} نتيجة</span>
    <button type="button" className="btn btn-outline !min-h-10 !px-4" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالية</button>
  </nav>;
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}
