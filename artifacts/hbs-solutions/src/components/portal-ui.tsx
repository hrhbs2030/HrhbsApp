import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { Archive, ArrowLeft, ArrowUpLeft, BarChart3, Bell, BellRing, Building2, Check, ChevronDown, Briefcase, CircleHelp, ClipboardList, Contact, CreditCard, FileClock, History, Home, Inbox, LayoutGrid, LogOut, Menu, MessageCircle, MessageSquare, Package, PanelRightClose, PanelRightOpen, Plus, Search, Settings, Tags, UserRoundCheck, UsersRound, X } from 'lucide-react';
import { getGetPortalMeQueryKey, getListMessageThreadsQueryKey, getListOfficeMessageThreadsQueryKey, useGetPortalMe, useListMessageThreads, useListOfficeMessageThreads, type Inquiry, type ServiceRequest, type ServiceRequestStatus } from '@workspace/api-client-react';
import { daysLabel, formatDate, formatNumber } from '@/lib/format';
import { milestoneIndex, milestoneKeys, milestones, pauses, stageLabel, stageNote } from '@/content/milestones';
import { safeStorage } from '@/lib/motion';
import { ReplyBadge, SubjectChip } from './request-conversation';
import { Logo, LogoMark } from './brand/logo';
import { NotificationBell, NotificationToasts } from './notification-bell';
import { setMessagesUnread, useMessagesUnread } from '@/lib/use-notifications';
import { PrintFrame } from './brand/print';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, EmptyState, PageTransition, SkeletonRows, SkeletonText, SkeletonTiles, openCommandPalette } from './portal-kit';
import { CommandPalette } from './command-palette';
import './portal-ui.css';

// The primitives live in portal-kit.tsx (no Clerk/API imports) and are
// re-exported here, so `import { Tile, DataTable } from '@/components/portal-ui'`
// works. Pages whose tests mock portal-ui should import them from portal-kit.
export * from './portal-kit';

export const categoryNames: Record<string, string> = { passports: 'الجوازات والإقامة', labor: 'الموارد البشرية والعمل', business: 'تأسيس الشركات والتراخيص', other: 'دعم الأعمال' };
// Request stages come from content/milestones.ts (shared with the public site); the rest are inquiry and invoice states.
export const statusNames: Record<string, string> = { ...Object.fromEntries([...milestones, ...Object.values(pauses)].map((s) => [s.key, s.label])), open: 'مفتوح', answered: 'تم الرد', issued: 'غير مسددة', paid: 'مسددة', cancelled: 'ملغاة' };
export const statusOptions: ServiceRequestStatus[] = ['received', 'reviewing', 'waiting_on_customer', 'submitted_to_authority', 'awaiting_payment', 'completed'];
export const dateText = (value: string | null | undefined) => formatDate(value);

export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`inline-flex items-center gap-3 no-underline ${light ? 'text-on-dark' : 'text-teal'}`} aria-label="HBS حلول الغد - الرئيسية">
    <Logo tone={light ? 'light' : 'dark'} size={44} tagline/>
  </Link>;
}
// Status pill for requests, inquiries and invoices: colour from the state, label from statusNames.
export function Status({ value, className = '' }: { value: string; className?: string }) { return <span className={`pill pill-${value} ${className}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{statusNames[value] ?? value}</span>; }
// Page title block: eyebrow + h1 + subtitle, with an action slot and optional back link and meta row (chips).
export function PageHeading({ eyebrow, title, subtitle, action, back, meta }: { eyebrow: string; title: string; subtitle?: string; action?: ReactNode; back?: { href: string; label: string }; meta?: ReactNode }) {
  return <div className="page-head">
    <div className="min-w-0">
      {back && <Link href={back.href} className="page-head-back"><ArrowUpLeft size={16} strokeWidth={ICON} className="rotate-180" aria-hidden="true" />{back.label}</Link>}
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="page-head-title display">{title}</h1>
      {subtitle && <p className="page-head-sub">{subtitle}</p>}
      {meta && <div className="page-head-meta">{meta}</div>}
    </div>
    {action && <div className="page-head-action">{action}</div>}
  </div>;
}
// Loading placeholder for a whole page section; `variant` picks the shape of what is coming.
export function LoadingBlock({ variant = 'card', rows = 5 }: { variant?: 'card' | 'table' | 'tiles' | 'text'; rows?: number }) {
  if (variant === 'tiles') return <div aria-label="جارٍ تحميل البيانات" aria-busy="true"><SkeletonTiles count={4} /></div>;
  if (variant === 'table') return <div className="surface p-5" aria-label="جارٍ تحميل البيانات" aria-busy="true"><SkeletonRows rows={rows} /></div>;
  if (variant === 'text') return <div className="surface p-6" aria-label="جارٍ تحميل البيانات" aria-busy="true"><SkeletonText lines={rows} /></div>;
  return <div className="surface space-y-4 p-6" aria-label="جارٍ تحميل البيانات" aria-busy="true"><div className="skeleton h-6 w-1/3"/><div className="skeleton h-16 w-full"/><div className="skeleton h-16 w-full"/><div className="skeleton h-16 w-3/4"/></div>;
}
// Error state with a retry button; `message` replaces the generic line.
export function ErrorBlock({ retry, message }: { retry: () => void; message?: string }) { return <div className="surface p-10 text-center" role="alert"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger"><CircleHelp size={28} strokeWidth={ICON} aria-hidden="true"/></div><h2 className="display text-xl">تعذّر تحميل البيانات</h2><p className="muted my-3 text-sm">{message ?? 'حدث خطأ مؤقت. حاول مرة أخرى.'}</p><button className="btn btn-outline" onClick={retry}>إعادة المحاولة</button></div>; }
// Empty state in a card: title, text and one action (link or button).
export function EmptyBlock({ title, text, action, href, onAction, icon }: { title: string; text: string; action?: string; href?: string; onAction?: () => void; icon?: ReactNode }) {
  return <div className="surface px-6 py-6"><EmptyState title={title} text={text} action={action} href={href} onAction={onAction} icon={icon ?? <Inbox size={28} strokeWidth={ICON}/>} /></div>;
}
export function RequestRow({ request }: { request: ServiceRequest }) { return <Link href={`/requests/${request.id}`} className="group flex min-h-[64px] items-center justify-between gap-4 border-b border-line px-5 py-4 text-inherit no-underline transition-colors last:border-0 hover:bg-sage/70 sm:px-6">
  <div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-semibold">{request.service}</span><span className="text-xs text-subtle">/ {categoryNames[request.category]}</span></div><div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-subtle"><span dir="ltr" className="nums">{request.reference}</span><span className="whitespace-nowrap">{dateText(request.createdAt)}</span><SubjectChip subject={request.subject}/><ReplyBadge lastMessage={request.lastMessage} status={request.status} viewer="customer"/></div></div>
  <div className="flex shrink-0 items-center gap-3"><Status value={request.status}/><ArrowUpLeft size={18} strokeWidth={ICON} className="hidden text-subtle transition-transform group-hover:-translate-x-1 group-hover:-translate-y-1 sm:block" aria-hidden="true"/></div>
</Link>; }
export function InquiryRow({ inquiry }: { inquiry: Inquiry }) { return <div className="border-b border-line px-5 py-5 last:border-0 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{inquiry.subject}</h3><span className="mt-1 block text-xs text-subtle">{dateText(inquiry.createdAt)}</span></div><Status value={inquiry.status}/></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-quiet">{inquiry.message}</p>{inquiry.answer && <div className="mt-4 rounded-[10px] border-s-[3px] border-teal bg-teal-soft p-4"><div className="mb-1 flex justify-between gap-2 text-xs font-semibold text-teal"><span>رد المكتب</span><span className="font-normal">{dateText(inquiry.answeredAt)}</span></div><p className="whitespace-pre-wrap text-sm leading-7">{inquiry.answer}</p></div>}</div>; }

// The unread count on the sidebar's «الرسائل»: seeded from the thread list
// once per mount, then kept current by `thread` stream events and read
// markers (see use-notifications.ts). Registration-only accounts have no threads.
function useMessagesBadge(staff: boolean, enabled: boolean): number {
  const unread = useMessagesUnread();
  const params = { pageSize: 1 };
  const customer = useListMessageThreads(params, { query: { queryKey: getListMessageThreadsQueryKey(params), enabled: enabled && !staff, staleTime: 60_000 } });
  const office = useListOfficeMessageThreads(params, { query: { queryKey: getListOfficeMessageThreadsQueryKey(params), enabled: enabled && staff, staleTime: 60_000 } });
  const seed = (staff ? office : customer).data?.unreadTotal;
  useEffect(() => { if (typeof seed === 'number') setMessagesUnread(seed); }, [seed]);
  return enabled ? unread : 0;
}
export const badgeText = (count: number) => count > 99 ? '99+' : formatNumber(count);

type NavLink = { href: string; label: string; icon: typeof Home; badge?: number };
export const companyRoleNames: Record<string, string> = { owner: 'مالك', hr: 'موارد بشرية', finance: 'مالية', viewer: 'قراءة' };
const SIDEBAR_KEY = 'hbs.sidebar';
// Lucide stroke mirrors --icon-stroke (index.css): sidebar icons 20 px, tab bar 24 px, topbar 20–22 px.
const ICON = 1.75;
const isActive = (location: string, href: string) => location === href || (href !== '/office' && href !== '/dashboard' && location.startsWith(href + '/'));

// The portal frame: sidebar (collapsible to an icon rail on desktop, a drawer
// on tablets), bottom tab bar on phones, topbar with breadcrumb, search
// affordance, bell and account menu, and a 200 ms page transition.
export function PortalLayout({ children, staff = false, registrationOnly = false }: { children: ReactNode; staff?: boolean; registrationOnly?: boolean }) {
  const [location, navigate] = useLocation();
  const unreadMessages = useMessagesBadge(staff, !registrationOnly); const [menuOpen, setMenuOpen] = useState(false); const { signOut } = useClerk(); const { user } = useUser();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  const [collapsed, setCollapsed] = useState(() => safeStorage.get(SIDEBAR_KEY) === 'rail');
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Shares the cached /portal/me result already loaded by the route guard:
  // the office role for the owner links, the company role and «acting for»
  // for members working in another customer's company.
  const me = useGetPortalMe({ query: { queryKey: getGetPortalMeQueryKey() } });
  const owner = staff && me.data?.officeRole === 'owner';
  const companyRole = !staff ? me.data?.companyRole ?? null : null;
  const actingFor = !staff ? me.data?.actingFor ?? null : null;
  // Viewers and finance members cannot open requests; the CTA would only lead to a 403.
  const canCreate = companyRole === null || companyRole === 'owner' || companyRole === 'hr';
  useEffect(() => setMenuOpen(false), [location]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => { setIsMobile(media.matches); if (!media.matches) setMenuOpen(false); };
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    if (!menuOpen || !isMobile) return;
    const aside = menuRef.current;
    const focusable = () => [...(aside?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])]
      .filter(element => !element.hasAttribute('hidden') && element.offsetParent !== null);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    aside?.querySelector<HTMLButtonElement>('[aria-label="إغلاق القائمة"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      } else if (event.key === 'Tab') {
        const items = focusable();
        if (!items.length) { event.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !aside?.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !aside?.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = originalOverflow;
      if (window.matchMedia('(max-width: 1023px)').matches && menuButtonRef.current?.isConnected) menuButtonRef.current.focus();
    };
  }, [menuOpen, isMobile]);
  const toggleCollapsed = useCallback(() => setCollapsed((value) => { safeStorage.set(SIDEBAR_KEY, value ? 'full' : 'rail'); return !value; }), []);
  const ownerLinks: NavLink[] = owner ? [{ href: '/office/reports', label: 'التقارير', icon: BarChart3 }, { href: '/office/catalog', label: 'الأسعار والمتطلبات', icon: Tags }, { href: '/office/plans', label: 'الباقات', icon: Package }, { href: '/office/subscriptions', label: 'الاشتراكات', icon: CreditCard }, { href: '/office/legacy', label: 'الأرشيف القديم', icon: Archive }, { href: '/office/staff', label: 'فريق المكتب', icon: UsersRound }, { href: '/office/audit', label: 'سجل التدقيق', icon: History }] : [];
  const links: NavLink[] = staff ? [{ href: '/office', label: 'نظرة عامة', icon: Home }, { href: '/office/registrations', label: 'طلبات التسجيل', icon: UserRoundCheck }, { href: '/office/requests', label: 'طلبات العملاء', icon: ClipboardList }, { href: '/office/inquiries', label: 'الاستفسارات', icon: CircleHelp }, { href: '/office/messages', label: 'الرسائل', icon: MessageSquare, badge: unreadMessages }, { href: '/office/customers', label: 'ملفات العملاء', icon: Contact }, { href: '/office/reminders', label: 'وثائق تنتهي قريبًا', icon: FileClock }, { href: '/office/whatsapp', label: 'واتساب الوارد', icon: MessageCircle }, { href: '/office/notifications', label: 'الإشعارات', icon: Bell }, ...ownerLinks] : registrationOnly ? [{ href: '/registration', label: 'طلب التسجيل', icon: UserRoundCheck }] : [{ href: '/dashboard', label: 'نظرة عامة', icon: Home }, { href: '/requests', label: 'طلباتي', icon: ClipboardList }, { href: '/inquiries', label: 'استفساراتي', icon: CircleHelp }, { href: '/messages', label: 'الرسائل', icon: MessageSquare, badge: unreadMessages }, { href: '/company', label: 'ملف المنشأة', icon: Building2 }, { href: '/documents', label: 'تنبيهات وثائقي', icon: BellRing }, { href: '/notifications', label: 'الإشعارات', icon: Bell }, { href: '/settings', label: 'الإعدادات', icon: Settings }];
  // Phone tab bar: four primary destinations, the rest behind «المزيد».
  const primaryHrefs = staff ? ['/office', '/office/requests', '/office/messages', '/office/customers'] : ['/dashboard', '/requests', '/messages', '/company'];
  const tabs = primaryHrefs.map((href) => links.find((link) => link.href === href)).filter((link): link is NavLink => !!link);
  const current = links.find(({ href }) => location === href) ?? links.filter(({ href }) => location.startsWith(href + '/')).sort((a, b) => b.href.length - a.href.length)[0];
  const space = staff ? 'مساحة المكتب' : registrationOnly ? 'بوابة العملاء' : 'مساحتي';
  const accountName = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'حسابي';
  const role = staff ? (owner ? 'مالك المكتب' : 'حساب المكتب') : companyRole && companyRole !== 'owner' ? `عضو منشأة (${companyRoleNames[companyRole]})` : 'حسابك';
  const rail = collapsed && !isMobile;
  const drawer = isMobile && menuOpen;
  return <div className="portal" dir="rtl" data-sidebar={rail ? 'rail' : 'full'}>
    <a className="site-skip" href="#portal-main">تخطَّ إلى المحتوى</a>
    <aside ref={menuRef} id="portal-mobile-nav" aria-label="القائمة الرئيسية" role={drawer ? 'dialog' : undefined} aria-modal={drawer ? true : undefined} aria-hidden={isMobile && !menuOpen ? true : undefined} inert={isMobile && !menuOpen} data-open={menuOpen || undefined} className="portal-side on-night">
      <div className="portal-side-head">
        {rail ? <Link href="/" className="portal-side-mark" aria-label="HBS حلول الغد - الرئيسية"><LogoMark size={36}/></Link> : <Brand light/>}
        <button type="button" className="portal-side-close lg:hidden" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة"><X size={22} strokeWidth={ICON} aria-hidden="true"/></button>
      </div>
      <span id="portal-menu-title" className="portal-side-space">{space}</span>
      <nav className="portal-nav" aria-label={space}>{links.map(({ href, label, icon: Icon, badge }) => {
        const active = isActive(location, href);
        return <Link key={href} href={href} className={`portal-nav-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} data-label={label} aria-label={rail ? (badge ? `${label}، ${badgeText(badge)} غير مقروءة` : label) : undefined}>
          <Icon size={20} strokeWidth={ICON} aria-hidden="true"/><span className="portal-nav-label">{label}</span>
          {badge ? <span className="portal-nav-badge nums" aria-label={`${badgeText(badge)} رسائل غير مقروءة`}>{badgeText(badge)}</span> : null}
        </Link>;
      })}</nav>
      {!staff && !registrationOnly && canCreate && <Link href="/requests/new" className="portal-side-cta" data-label="طلب خدمة جديد" aria-label={rail ? 'طلب خدمة جديد' : undefined}><Plus size={20} strokeWidth={ICON} aria-hidden="true"/><span className="portal-nav-label">طلب خدمة جديد</span></Link>}
      <div className="portal-side-foot">
        <div className="portal-side-user">
          <Avatar name={user?.firstName} tone="dark" size={36}/>
          <div className="portal-nav-label min-w-0"><div className="truncate text-xs font-semibold">{accountName}</div><div className="mt-0.5 text-xs text-on-dark-2">{role}</div></div>
        </div>
        <button type="button" onClick={() => signOut({redirectUrl: import.meta.env.BASE_URL})} className="portal-nav-link portal-side-signout" data-label="تسجيل الخروج" aria-label={rail ? 'تسجيل الخروج' : undefined}><LogOut size={20} strokeWidth={ICON} aria-hidden="true"/><span className="portal-nav-label">تسجيل الخروج</span></button>
        <button type="button" className="portal-side-collapse" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-controls="portal-mobile-nav" aria-label={collapsed ? 'توسيع القائمة' : 'طيّ القائمة'} data-label={collapsed ? 'توسيع القائمة' : 'طيّ القائمة'}>{collapsed ? <PanelRightOpen size={20} strokeWidth={ICON} aria-hidden="true"/> : <PanelRightClose size={20} strokeWidth={ICON} aria-hidden="true"/>}<span className="portal-nav-label">طيّ القائمة</span></button>
      </div>
    </aside>
    {menuOpen && <button onClick={() => setMenuOpen(false)} className="portal-scrim lg:hidden" aria-label="إغلاق القائمة"/>}
    <div className="portal-col">
      <header className="portal-topbar on-night">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button ref={menuButtonRef} type="button" className="portal-topbar-btn lg:hidden" onClick={() => setMenuOpen(true)} aria-label="فتح القائمة" aria-controls="portal-mobile-nav" aria-expanded={menuOpen}><Menu size={22} strokeWidth={ICON} aria-hidden="true"/></button>
          <nav className="portal-crumb" aria-label="مسار الصفحة"><span>{space}</span>{current && <><span aria-hidden="true" className="portal-crumb-sep">/</span><strong aria-current="page">{current.label}</strong></>}</nav>
        </div>
        <span className="portal-topbar-brand lg:hidden" aria-hidden="true"><LogoMark size={28}/><span className="hidden min-[400px]:inline">HBS حلول الغد</span></span>
        {actingFor && <span className="portal-acting" role="status" title={`أنت عضو في منشأة ${actingFor.companyName ?? ''}؛ ما تراه وترسله هنا باسمها.`}><Briefcase size={16} strokeWidth={ICON} aria-hidden="true"/><span className="portal-acting-text">تتصرف باسم منشأة {actingFor.companyName ?? 'العميل'}</span></span>}
        <div className="flex flex-none items-center gap-1.5 sm:gap-2">
          {!registrationOnly && <button type="button" className="portal-search" onClick={openCommandPalette} aria-label="بحث سريع" aria-keyshortcuts="Control+K Meta+K"><Search size={20} strokeWidth={ICON} aria-hidden="true"/><span className="portal-search-label">بحث</span><kbd className="kbd portal-search-kbd" aria-hidden="true">⌘K</kbd></button>}
          <Link href="/help" className="portal-topbar-help hidden lg:inline-flex"><CircleHelp size={18} strokeWidth={ICON} aria-hidden="true"/>المساعدة</Link>
          <NotificationBell staff={staff}/>
          <DropdownMenu dir="rtl" modal={false}>
            <DropdownMenuTrigger asChild><button type="button" className="portal-avatar-btn" aria-label={`حسابي: ${accountName}`}><Avatar name={user?.firstName} tone="dark" size={32}/><ChevronDown size={16} strokeWidth={ICON} className="hidden sm:block" aria-hidden="true"/></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className="portal-menu">
              <DropdownMenuLabel className="portal-menu-head"><span className="block truncate font-semibold">{accountName}</span><span className="block text-xs font-normal text-quiet">{role}</span></DropdownMenuLabel>
              <DropdownMenuSeparator/>
              {!staff && !registrationOnly && <DropdownMenuItem className="portal-menu-item" onSelect={() => navigate('/settings')}><Settings size={18} strokeWidth={ICON} aria-hidden="true"/>الإعدادات</DropdownMenuItem>}
              {!registrationOnly && <DropdownMenuItem className="portal-menu-item" onSelect={() => navigate(staff ? '/office/notifications' : '/notifications')}><Bell size={18} strokeWidth={ICON} aria-hidden="true"/>الإشعارات</DropdownMenuItem>}
              <DropdownMenuItem className="portal-menu-item" onSelect={() => navigate('/help')}><CircleHelp size={18} strokeWidth={ICON} aria-hidden="true"/>المساعدة</DropdownMenuItem>
              <DropdownMenuSeparator/>
              <DropdownMenuItem className="portal-menu-item" onSelect={() => signOut({redirectUrl: import.meta.env.BASE_URL})}><LogOut size={18} strokeWidth={ICON} aria-hidden="true"/>تسجيل الخروج</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <NotificationToasts/>
      {!registrationOnly && <CommandPalette staff={staff}/>}
      <div className="portal-band" aria-hidden="true" />
      <main id="portal-main" tabIndex={-1} className="portal-sheet flex-1"><div className="portal-content">
        <PrintFrame staff={staff} title={location === '/office/audit' ? 'سجل التدقيق' : location.startsWith('/requests/') ? 'تفاصيل الطلب' : current?.label ?? 'بوابة العملاء'}/>
        <PageTransition routeKey={location}>{children}</PageTransition>
      </div></main>
    </div>
    {tabs.length > 1 && <nav className="portal-tabbar" aria-label="التنقل السريع">
      {tabs.map(({ href, label, icon: Icon, badge }) => { const active = isActive(location, href); return <Link key={href} href={href} className={`portal-tab ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} aria-label={badge ? `${label}، ${badgeText(badge)} غير مقروءة` : undefined}><span className="portal-tab-icon"><Icon size={24} strokeWidth={ICON} aria-hidden="true"/>{badge ? <span className="portal-tab-badge nums" aria-hidden="true">{badgeText(badge)}</span> : null}</span><span>{label}</span></Link>; })}
      <button type="button" className={`portal-tab ${menuOpen ? 'is-active' : ''}`} onClick={() => setMenuOpen(true)} aria-controls="portal-mobile-nav" aria-expanded={menuOpen}><span className="portal-tab-icon"><LayoutGrid size={24} strokeWidth={ICON} aria-hidden="true"/></span><span>المزيد</span></button>
    </nav>}
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
  return <span className="chip chip-warn chip-sm">بلا تحديث منذ {daysLabel(days)}</span>;
}

// The request's journey through the four stages. The fill animates in once
// when the page opens; the current stage gets one soft pulse (not a loop).
// Only dates the API really has are shown: sending date and last update.
export function StatusTrack({ status, createdAt, updatedAt }: { status: ServiceRequestStatus; createdAt?: string; updatedAt?: string }) {
  // Waiting on the customer or on payment pauses the request at the review
  // milestone with its own label and note (see content/milestones.ts).
  const current = milestoneIndex(status);
  const done = status === 'completed';
  return <ol className="timeline" aria-label="مراحل الطلب" style={{ ['--tl-progress' as string]: current / (milestoneKeys.length - 1) }}>
    {milestoneKeys.map((step, index) => {
      const state = index < current || (done && index === current) ? 'done' : index === current ? 'current' : 'next';
      return <li key={step} data-state={state} aria-current={index === current ? 'step' : undefined} style={{ ['--i' as string]: index }}>
        <span className="timeline-node" aria-hidden="true">{state === 'done' ? <Check size={13} strokeWidth={3}/> : null}</span>
        <div className="timeline-body">
          <span className="timeline-label">{index === current ? stageLabel(status) : stageLabel(step)}</span>
          {index === current && <span className="timeline-note">{stageNote(status)}</span>}
          {index === 0 && createdAt && <span className="timeline-date">أُرسل في {dateText(createdAt)}</span>}
          {index === current && index > 0 && updatedAt && <span className="timeline-date">آخر تحديث {dateText(updatedAt)}</span>}
        </div>
      </li>;
    })}
  </ol>;
}

// Previous / next pagination with the result count; hidden when there is one page.
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const number = formatNumber;
  return <nav className="pager" aria-label="التنقل بين الصفحات">
    <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابقة</button>
    <span className="pager-info nums">صفحة {number(page)} من {number(pages)}، {number(total)} نتيجة</span>
    <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالية</button>
  </nav>;
}

export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}
