import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import { Archive, ArrowLeft, ArrowUpLeft, CircleHelp, ClipboardList, History, Home, Inbox, LogOut, Menu, Plus, UserRoundCheck, UsersRound, X } from 'lucide-react';
import { getGetPortalMeQueryKey, useGetPortalMe, type Inquiry, type ServiceRequest, type ServiceRequestStatus } from '@workspace/api-client-react';

export const categoryNames: Record<string, string> = { passports: 'الجوازات', labor: 'العمل', business: 'الأعمال', other: 'خدمات أخرى' };
export const statusNames: Record<string, string> = { received: 'تم الاستلام', reviewing: 'قيد المراجعة', waiting_on_customer: 'بانتظار العميل', completed: 'مكتملة', open: 'مفتوح', answered: 'تم الرد' };
export const statusOptions: ServiceRequestStatus[] = ['received', 'reviewing', 'waiting_on_customer', 'completed'];
export const dateText = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value)) : '—';

export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`inline-flex items-center gap-3 no-underline ${light ? 'text-[#f7f0e4]' : 'text-[#174b50]'}`} aria-label="HBS حلول الغد - الرئيسية">
    <span className={`grid h-11 w-11 place-items-center rounded-[11px] font-bold text-[12px] tracking-[-.06em] ${light ? 'bg-[#e6a782] text-[#174b50]' : 'bg-[#174b50] text-[#f6efe3]'}`}>HBS</span>
    <span className="flex flex-col leading-[1.15]"><strong className="display text-[18px]">حلول الغد</strong><small className="mt-1 text-[10px] font-semibold tracking-[.06em] opacity-60">خدمات المكتب الإلكترونية</small></span>
  </Link>;
}
export function Status({ value }: { value: string }) { return <span className={`pill pill-${value}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusNames[value] ?? value}</span>; }
export function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><span className="eyebrow">{eyebrow}</span><h1 className="display mt-2 text-[30px] font-semibold leading-tight sm:text-[38px]">{title}</h1>{subtitle && <p className="muted mt-2 text-[14px]">{subtitle}</p>}</div>{action}</div>;
}
export function LoadingBlock() { return <div className="surface space-y-4 p-6" aria-label="جارٍ تحميل البيانات"><div className="skeleton h-6 w-1/3"/><div className="skeleton h-16 w-full"/><div className="skeleton h-16 w-full"/><div className="skeleton h-16 w-3/4"/></div>; }
export function ErrorBlock({ retry }: { retry: () => void }) { return <div className="surface p-10 text-center"><CircleHelp className="mx-auto mb-4 text-[#bc704a]" size={32}/><h3 className="display text-xl">تعذّر تحميل البيانات</h3><p className="muted my-3 text-sm">حدث خطأ مؤقت. حاول مرة أخرى.</p><button className="btn btn-outline" onClick={retry}>إعادة المحاولة</button></div>; }
export function EmptyBlock({ title, text, action, href }: { title: string; text: string; action?: string; href?: string }) { return <div className="surface flex flex-col items-center px-6 py-14 text-center"><div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[#e8eee8] text-[#216067]"><Inbox size={29} strokeWidth={1.5}/></div><h3 className="display text-xl font-semibold">{title}</h3><p className="muted mt-2 max-w-sm text-sm leading-7">{text}</p>{action && href && <Link href={href} className="btn btn-primary mt-6">{action}<ArrowLeft size={17}/></Link>}</div>; }
export function RequestRow({ request }: { request: ServiceRequest }) { return <Link href={`/requests/${request.id}`} className="group flex items-center justify-between gap-4 border-b border-[#e9e5da] px-5 py-4 text-inherit no-underline transition-colors last:border-0 hover:bg-[#f7f5ed] sm:px-6">
  <div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-bold">{request.service}</span><span className="text-xs text-[#8c9b94]">/ {categoryNames[request.category]}</span></div><div className="flex gap-3 text-xs text-[#718079]"><span dir="ltr">{request.reference}</span><span>{dateText(request.createdAt)}</span></div></div>
  <div className="flex shrink-0 items-center gap-3"><Status value={request.status}/><ArrowUpLeft size={16} className="hidden text-[#809189] transition-transform group-hover:-translate-x-1 group-hover:-translate-y-1 sm:block"/></div>
</Link>; }
export function InquiryRow({ inquiry }: { inquiry: Inquiry }) { return <div className="border-b border-[#e9e5da] px-5 py-5 last:border-0 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">{inquiry.subject}</h3><span className="mt-1 block text-xs text-[#718079]">{dateText(inquiry.createdAt)}</span></div><Status value={inquiry.status}/></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[#566b67]">{inquiry.message}</p>{inquiry.answer && <div className="mt-4 rounded-lg border-r-[3px] border-[#c8724a] bg-[#f7f1e8] p-4"><div className="mb-1 flex justify-between gap-2 text-xs font-bold text-[#ac613d]"><span>رد المكتب</span><span className="font-normal">{dateText(inquiry.answeredAt)}</span></div><p className="whitespace-pre-wrap text-sm leading-7">{inquiry.answer}</p></div>}</div>; }

export function PortalLayout({ children, staff = false, registrationOnly = false }: { children: ReactNode; staff?: boolean; registrationOnly?: boolean }) {
  const [location] = useLocation(); const [menuOpen, setMenuOpen] = useState(false); const { signOut } = useClerk(); const { user } = useUser();
  // Shares the cached /portal/me result already loaded by the route guard.
  const me = useGetPortalMe({ query: { queryKey: getGetPortalMeQueryKey(), enabled: staff } });
  const owner = staff && me.data?.officeRole === 'owner';
  useEffect(() => setMenuOpen(false), [location]);
  const ownerLinks = owner ? [{ href: '/office/legacy', label: 'الأرشيف القديم', icon: Archive }, { href: '/office/staff', label: 'فريق المكتب', icon: UsersRound }, { href: '/office/audit', label: 'سجل التدقيق', icon: History }] : [];
  const links = staff ? [{ href: '/office', label: 'نظرة عامة', icon: Home }, { href: '/office/registrations', label: 'طلبات التسجيل', icon: UserRoundCheck }, { href: '/office/requests', label: 'طلبات العملاء', icon: ClipboardList }, { href: '/office/inquiries', label: 'الاستفسارات', icon: CircleHelp }, ...ownerLinks] : registrationOnly ? [{ href: '/registration', label: 'طلب التسجيل', icon: UserRoundCheck }] : [{ href: '/registration', label: 'طلب التسجيل', icon: UserRoundCheck }, { href: '/dashboard', label: 'نظرة عامة', icon: Home }, { href: '/requests', label: 'طلباتي', icon: ClipboardList }, { href: '/inquiries', label: 'استفساراتي', icon: CircleHelp }];
  return <div className="min-h-[100dvh] bg-[#f6f4ed] lg:flex" dir="rtl">
    <aside className={`${menuOpen ? 'translate-x-0' : 'translate-x-full'} fixed inset-y-0 right-0 z-50 flex w-[270px] flex-col bg-[#173e42] px-5 py-7 text-[#f7f1e4] transition-transform duration-300 lg:sticky lg:top-0 lg:h-[100dvh] lg:translate-x-0`}>
      <div className="mb-12 flex items-start justify-between px-2"><Brand light/><button className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة"><X/></button></div>
      <span className="mb-4 px-4 text-[11px] font-bold tracking-widest text-[#9ab2ad]">{staff ? 'مساحة المكتب' : 'مساحتي'}</span>
      <nav className="space-y-1.5">{links.map(({href,label,icon:Icon}) => <Link key={href} href={href} className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold no-underline transition-colors ${location === href || (href !== '/office' && href !== '/dashboard' && location.startsWith(href + '/')) ? 'bg-[#e5a27b] text-[#173e42]' : 'text-[#c7d8d2] hover:bg-[#245257]'}`}><Icon size={19} strokeWidth={1.8}/>{label}</Link>)}</nav>
      {!staff && !registrationOnly && <Link href="/requests/new" className="mt-7 flex items-center justify-center gap-2 rounded-lg border border-[#709590] px-4 py-3 text-sm font-bold text-[#fbf5eb] no-underline transition-colors hover:bg-[#245257]"><Plus size={18}/>طلب خدمة جديد</Link>}
      <div className="mt-auto border-t border-[#376064] pt-6"><div className="mb-4 flex items-center gap-3 px-2"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#396267] text-sm font-bold">{user?.firstName?.slice(0,1) || 'ح'}</div><div className="min-w-0"><div className="truncate text-xs font-semibold">{user?.fullName || user?.primaryEmailAddress?.emailAddress || 'حسابي'}</div><div className="mt-1 text-[11px] text-[#a3c0ba]">{staff ? (owner ? 'مالك المكتب' : 'حساب المكتب') : 'حساب العميل'}</div></div></div><button onClick={() => signOut({redirectUrl: import.meta.env.BASE_URL})} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#c7d8d2] hover:bg-[#245257]"><LogOut size={17}/>تسجيل الخروج</button></div>
    </aside>
    {menuOpen && <button onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 bg-[#102c2f]/50 lg:hidden" aria-label="إغلاق القائمة"/>}
    <div className="min-w-0 flex-1"><header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#e6e3d8] bg-[#f6f4ed]/95 px-5 backdrop-blur sm:px-9 lg:px-12"><div className="flex items-center gap-3"><button className="rounded-lg border border-[#d9dfd6] p-2 lg:hidden" onClick={() => setMenuOpen(true)} aria-label="فتح القائمة"><Menu size={21}/></button><span className="hidden text-xs font-bold text-[#8b9890] sm:inline">{staff ? 'إدارة المعاملات' : 'بوابة العملاء'}</span></div><span className="text-xs text-[#70827a]">HBS / حلول الغد</span></header><main className="mx-auto max-w-[1130px] px-5 pb-20 pt-9 sm:px-9 sm:pt-12 lg:px-12">{children}</main></div>
  </div>;
}
