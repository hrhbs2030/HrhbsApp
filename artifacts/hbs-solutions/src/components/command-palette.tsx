import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { useLocation } from 'wouter';
import { Archive, BarChart3, Bell, BellRing, Building2, CircleHelp, ClipboardList, Contact, CornerDownLeft, CreditCard, FileClock, History, Home, MessageCircle, MessageSquare, Package, Plus, Settings, Tags, UserRoundCheck, UsersRound } from 'lucide-react';
import {
  getListInquiriesQueryKey, getListOfficeCustomersQueryKey, getListOfficeServiceRequestsQueryKey, getListServiceRequestsQueryKey,
  useListInquiries, useListOfficeCustomers, useListOfficeServiceRequests, useListServiceRequests,
} from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useCommandPalette } from '@/components/portal-kit';
import { milestones, pauses } from '@/content/milestones';
import { formatNumber } from '@/lib/format';
import './command-palette.css';

// The ⌘K / Ctrl+K palette, mounted once by PortalLayout for every signed-in
// page. Staff jump to a request by its reference, to a customer by name or to
// a page; customers search their own requests and inquiries and jump to a
// page. The data hooks run only while the palette is open, so no page makes
// an extra request until someone opens it.

type Page = { href: string; label: string; icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>; keywords?: string };
export const officePages: Page[] = [
  { href: '/office', label: 'نظرة عامة', icon: Home, keywords: 'overview home' },
  { href: '/office/requests', label: 'طلبات العملاء', icon: ClipboardList, keywords: 'requests inbox' },
  { href: '/office/inquiries', label: 'استفسارات العملاء', icon: CircleHelp, keywords: 'inquiries' },
  { href: '/office/messages', label: 'الرسائل', icon: MessageSquare, keywords: 'messages' },
  { href: '/office/customers', label: 'ملفات العملاء', icon: Contact, keywords: 'customers' },
  { href: '/office/registrations', label: 'طلبات التسجيل', icon: UserRoundCheck, keywords: 'registrations' },
  { href: '/office/reminders', label: 'وثائق تنتهي قريبًا', icon: FileClock, keywords: 'reminders documents' },
  { href: '/office/whatsapp', label: 'واتساب الوارد', icon: MessageCircle, keywords: 'whatsapp' },
  { href: '/office/notifications', label: 'الإشعارات', icon: Bell, keywords: 'notifications' },
  { href: '/office/reports', label: 'التقارير', icon: BarChart3, keywords: 'reports' },
  { href: '/office/catalog', label: 'الأسعار والمتطلبات', icon: Tags, keywords: 'catalog prices' },
  { href: '/office/plans', label: 'الباقات', icon: Package, keywords: 'plans' },
  { href: '/office/subscriptions', label: 'الاشتراكات', icon: CreditCard, keywords: 'subscriptions' },
  { href: '/office/staff', label: 'فريق المكتب', icon: UsersRound, keywords: 'staff team' },
  { href: '/office/audit', label: 'سجل التدقيق', icon: History, keywords: 'audit log' },
  { href: '/office/legacy', label: 'الأرشيف القديم', icon: Archive, keywords: 'legacy archive' },
];
export const customerPages: Page[] = [
  { href: '/dashboard', label: 'نظرة عامة', icon: Home, keywords: 'overview home dashboard' },
  { href: '/requests/new', label: 'طلب خدمة جديد', icon: Plus, keywords: 'new request' },
  { href: '/requests', label: 'طلباتي', icon: ClipboardList, keywords: 'requests' },
  { href: '/inquiries', label: 'استفساراتي', icon: CircleHelp, keywords: 'inquiries' },
  { href: '/messages', label: 'الرسائل', icon: MessageSquare, keywords: 'messages inbox' },
  { href: '/company', label: 'ملف المنشأة', icon: Building2, keywords: 'company employees licenses' },
  { href: '/company?tab=subscription', label: 'الاشتراك والفواتير', icon: CreditCard, keywords: 'subscription invoices' },
  { href: '/documents', label: 'تنبيهات وثائقي', icon: BellRing, keywords: 'documents reminders' },
  { href: '/notifications', label: 'الإشعارات', icon: Bell, keywords: 'notifications' },
  { href: '/settings', label: 'الإعدادات', icon: Settings, keywords: 'settings whatsapp' },
  { href: '/help', label: 'المساعدة', icon: CircleHelp, keywords: 'help faq' },
];

export const normalize = (text: string) => text.toLowerCase().replace(/[ً-ْ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
// Pages whose label or keywords contain every word of the query.
export function matchPages(query: string, pages: Page[] = officePages): Page[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return pages;
  return pages.filter(page => { const hay = normalize(`${page.label} ${page.keywords ?? ''}`); return words.every(word => hay.includes(word)); });
}
// Rows (requests, inquiries) whose searchable fields contain every word of the query.
export function matchRows<T>(query: string, rows: T[], fields: (row: T) => (string | null | undefined)[], limit = 6): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return rows.filter(row => { const hay = normalize(fields(row).filter(Boolean).join(' ')); return words.every(word => hay.includes(word)); }).slice(0, limit);
}

function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return debounced;
}

export function CommandPalette({ staff = false }: { staff?: boolean }) {
  const [open, setOpen] = useState(false);
  const onOpen = useCallback(() => setOpen(true), []);
  useCommandPalette(onOpen);
  const description = staff ? 'اكتب رقمًا مرجعيًا أو اسم عميل أو اسم صفحة، ثم اختر بالأسهم واضغط Enter.' : 'اكتب اسم خدمة أو رقمًا مرجعيًا أو اسم صفحة، ثم اختر بالأسهم واضغط Enter.';
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent dir="rtl" className="kit-dialog ocp" aria-describedby={undefined}>
      <DialogTitle className="sr-only">البحث السريع والتنقل</DialogTitle>
      <DialogDescription className="sr-only">{description}</DialogDescription>
      {open && (staff ? <OfficeBody onClose={() => setOpen(false)} /> : <CustomerBody onClose={() => setOpen(false)} />)}
    </DialogContent>
  </Dialog>;
}
function PageItems({ pages, go }: { pages: Page[]; go: (href: string) => void }) {
  if (!pages.length) return null;
  return <CommandGroup heading="الصفحات" className="ocp-group">{pages.map(page => { const Icon = page.icon; return <CommandItem key={page.href} value={`page-${page.href}`} className="ocp-item" onSelect={() => go(page.href)}>
    <span className="ocp-item-icon"><Icon size={15} aria-hidden="true" /></span>
    <span className="ocp-item-main"><span className="ocp-item-title">{page.label}</span></span>
  </CommandItem>; })}</CommandGroup>;
}
function Foot() {
  return <div className="ocp-foot" aria-hidden="true"><span><kbd className="kbd">↑↓</kbd> تنقّل</span><span><kbd className="kbd"><CornerDownLeft size={11} /></kbd> فتح</span><span><kbd className="kbd">Esc</kbd> إغلاق</span></div>;
}

function OfficeBody({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const searching = q.length >= 2;
  const requestParams = { page: 1, pageSize: 6, q };
  const requests = useListOfficeServiceRequests(requestParams, { query: { queryKey: getListOfficeServiceRequestsQueryKey(requestParams), enabled: searching, staleTime: 30_000 } });
  const customerParams = { q };
  const customers = useListOfficeCustomers(customerParams, { query: { queryKey: getListOfficeCustomersQueryKey(customerParams), enabled: searching, staleTime: 30_000 } });
  const pages = matchPages(query, officePages);
  const go = (href: string) => { onClose(); navigate(href); };
  const requestRows = requests.data?.items ?? [];
  const customerRows = (customers.data ?? []).slice(0, 6);
  const loading = searching && (requests.isFetching || customers.isFetching) && !requestRows.length && !customerRows.length;
  const nothing = !pages.length && !requestRows.length && !customerRows.length && !loading;
  return <Command shouldFilter={false} loop label="البحث السريع">
    <CommandInput value={query} onValueChange={setQuery} placeholder="رقم مرجعي، اسم عميل، أو صفحة…" className="ocp-input" autoFocus />
    <CommandList className="ocp-list">
      {loading && <div className="ocp-empty" aria-live="polite">جارٍ البحث…</div>}
      {nothing && <CommandEmpty className="ocp-empty">لا توجد نتائج مطابقة.</CommandEmpty>}
      {requestRows.length > 0 && <CommandGroup heading="الطلبات" className="ocp-group">{requestRows.map(r => <CommandItem key={`r${r.id}`} value={`request-${r.id}`} className="ocp-item" onSelect={() => go(`/office/requests/${r.id}`)}>
        <span className="ocp-item-icon"><ClipboardList size={15} aria-hidden="true" /></span>
        <span className="ocp-item-main"><span className="ocp-item-title">{r.service}</span><span className="ocp-item-sub"><span dir="ltr" className="nums">{r.reference}</span>{r.customer ? ` · ${r.customer.fullName}` : ''}</span></span>
        <span className={`pill pill-${r.status} ocp-item-side`}>{statusShort[r.status] ?? r.status}</span>
      </CommandItem>)}</CommandGroup>}
      {customerRows.length > 0 && <CommandGroup heading="العملاء" className="ocp-group">{customerRows.map(c => <CommandItem key={`c${c.userId}`} value={`customer-${c.userId}`} className="ocp-item" onSelect={() => go(`/office/customers/${encodeURIComponent(c.userId)}`)}>
        <span className="ocp-item-icon"><Contact size={15} aria-hidden="true" /></span>
        <span className="ocp-item-main"><span className="ocp-item-title">{c.customer?.fullName ?? c.companyName ?? 'عميل'}</span><span className="ocp-item-sub">{[c.companyName, c.activeRequests ? `${formatNumber(c.activeRequests)} طلبات نشطة` : null].filter(Boolean).join(' · ') || 'ملف عميل'}</span></span>
      </CommandItem>)}</CommandGroup>}
      <PageItems pages={pages} go={go} />
    </CommandList>
    <Foot />
  </Command>;
}

// The customer's own requests and inquiries are short lists the pages already
// cache; they are filtered here rather than searched on the server.
function CustomerBody({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const searching = q.length >= 2;
  const requests = useListServiceRequests({ query: { queryKey: getListServiceRequestsQueryKey(), enabled: searching, staleTime: 30_000 } });
  const inquiries = useListInquiries({ query: { queryKey: getListInquiriesQueryKey(), enabled: searching, staleTime: 30_000 } });
  const pages = matchPages(query, customerPages);
  const go = (href: string) => { onClose(); navigate(href); };
  const requestRows = searching ? matchRows(q, requests.data ?? [], r => [r.service, r.reference, r.description, r.subject?.label]) : [];
  const inquiryRows = searching ? matchRows(q, inquiries.data ?? [], i => [i.subject, i.message, i.linkedServiceRequestReference], 4) : [];
  const loading = searching && (requests.isFetching || inquiries.isFetching) && !requestRows.length && !inquiryRows.length;
  const nothing = !pages.length && !requestRows.length && !inquiryRows.length && !loading;
  return <Command shouldFilter={false} loop label="البحث السريع">
    <CommandInput value={query} onValueChange={setQuery} placeholder="اسم خدمة، رقم مرجعي، أو صفحة…" className="ocp-input" autoFocus />
    <CommandList className="ocp-list">
      {loading && <div className="ocp-empty" aria-live="polite">جارٍ البحث…</div>}
      {nothing && <CommandEmpty className="ocp-empty">لا توجد نتائج مطابقة.</CommandEmpty>}
      {requestRows.length > 0 && <CommandGroup heading="طلباتي" className="ocp-group">{requestRows.map(r => <CommandItem key={`r${r.id}`} value={`request-${r.id}`} className="ocp-item" onSelect={() => go(`/requests/${r.id}`)}>
        <span className="ocp-item-icon"><ClipboardList size={15} aria-hidden="true" /></span>
        <span className="ocp-item-main"><span className="ocp-item-title">{r.service}</span><span className="ocp-item-sub"><span dir="ltr" className="nums">{r.reference}</span>{r.subject ? ` · ${r.subject.label}` : ''}</span></span>
        <span className={`pill pill-${r.status} ocp-item-side`}>{statusShort[r.status] ?? r.status}</span>
      </CommandItem>)}</CommandGroup>}
      {inquiryRows.length > 0 && <CommandGroup heading="استفساراتي" className="ocp-group">{inquiryRows.map(i => <CommandItem key={`i${i.id}`} value={`inquiry-${i.id}`} className="ocp-item" onSelect={() => go(`/inquiries/${i.id}`)}>
        <span className="ocp-item-icon"><CircleHelp size={15} aria-hidden="true" /></span>
        <span className="ocp-item-main"><span className="ocp-item-title">{i.subject}</span><span className="ocp-item-sub">{i.linkedServiceRequestReference ? <span dir="ltr" className="nums">{i.linkedServiceRequestReference}</span> : 'استفسار عام'}</span></span>
        <span className={`pill pill-${i.status} ocp-item-side`}>{i.status === 'answered' ? 'تم الرد' : 'مفتوح'}</span>
      </CommandItem>)}</CommandGroup>}
      <PageItems pages={pages} go={go} />
    </CommandList>
    <Foot />
  </Command>;
}

// Stage labels as the status pills show them (content/milestones.ts).
const statusShort: Record<string, string> = Object.fromEntries([...milestones, ...Object.values(pauses)].map(s => [s.key, s.label]));

export default CommandPalette;
