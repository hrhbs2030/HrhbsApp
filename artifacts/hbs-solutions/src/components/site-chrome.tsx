import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { hasSessionHint } from '@/lib/session-hint';
import { prefersReducedMotion, useScrolled } from '@/lib/motion';
import { cityInfo, cityOrder } from '@/components/city-scene';
import { SceneWindow } from '@/components/scene-window';
import { ContactList } from '@/components/contact-card';
import { contact } from '@/content/contact';
import './site-chrome.css';

const ICON = 1.75;

// Same mark as portal-ui's Brand, declared here so the public pages do not
// import portal-ui (and with it Clerk).
function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`inline-flex items-center gap-3 no-underline ${light ? 'text-on-dark' : 'text-teal'}`} aria-label="HBS حلول الغد - الرئيسية">
    <Logo tone={light ? 'light' : 'dark'} size={44} tagline/>
  </Link>;
}
// Header auth links without Clerk: a session cookie hint only decides which
// link to show; the portal itself re-checks the session when it opens.
function AuthLinks({ tone, compact = false }: { tone: 'dark' | 'light'; compact?: boolean }) {
  const button = `btn ${compact ? 'btn-sm ' : ''}${tone === 'dark' ? 'btn-light' : 'btn-primary'}`;
  if (hasSessionHint()) return <Link href="/dashboard" className={button}>حسابي <ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></Link>;
  return <>
    <Link href="/sign-in" className={compact ? 'site-text-link' : 'btn btn-ghost-dark'}>تسجيل الدخول</Link>
    <Link href="/sign-up" className={button}>طلب التسجيل <ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></Link>
  </>;
}

// One line under the brand on the public header and the footer: what the
// office does for an establishment, in the three problems' words.
export const siteTagline = 'التزام منشأتك، ومؤشراتها، ومعالجة ملاحظاتها، من حساب واحد';

export const siteNavigation = [
  { href: '/#problems', label: 'مشاكل نحلّها' },
  { href: '/services', label: 'الخدمات' },
  { href: '/#how', label: 'كيف تعمل البوابة' },
  { href: '/#assistant', label: 'أم مشعل' },
  { href: '/trust', label: 'الخصوصية والأمان' },
  { href: '/help', label: 'المساعدة' },
];

// Public-site header. `tone="dark"` floats over the night hero and gains a
// blurred night background once the page scrolls; `light` sits on paper pages.
// The phone menu is a full-screen sheet with a focus trap and body scroll lock.
export function SiteHeader({ tone = 'light' }: { tone?: 'dark' | 'light' }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const scrolled = useScrolled(24);
  const sheet = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    if (!open) return;
    const root = sheet.current;
    const focusable = () => [...(root?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [])];
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root?.querySelector<HTMLButtonElement>('.site-sheet-close')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
      if (event.key !== 'Tab') return;
      const items = focusable(); if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = originalOverflow; if (toggle.current?.isConnected) toggle.current.focus(); };
  }, [open]);

  return (
    <header className={`site-header site-header--${tone} ${tone === 'dark' ? 'on-night' : ''}`} data-scrolled={scrolled || undefined} data-open={open || undefined}>
      <div className="site-wrap site-header-inner">
        <div className="site-brand">
          <Brand light={tone === 'dark'} />
          <p className="site-tagline">{siteTagline}</p>
        </div>
        <nav className="site-nav" aria-label="التنقل الرئيسي">
          {siteNavigation.map((item) => (
            <a key={item.href} href={item.href} aria-current={location === item.href ? 'page' : undefined} onClick={(e) => navigateHash(e, item.href)}>{item.label}</a>
          ))}
        </nav>
        <div className="site-actions"><AuthLinks tone={tone} compact /></div>
        <button ref={toggle} type="button" className="site-menu-toggle" aria-label="فتح القائمة" aria-expanded={open} aria-controls="site-mobile-nav" onClick={() => setOpen(true)}>
          <Menu size={21} strokeWidth={ICON} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <nav ref={sheet} id="site-mobile-nav" className="site-sheet on-night" aria-label="التنقل على الهاتف" role="dialog" aria-modal="true">
          <div className="site-wrap site-sheet-head">
            <Brand light />
            <button type="button" className="site-sheet-close" onClick={() => setOpen(false)} aria-label="إغلاق القائمة"><X size={22} strokeWidth={ICON} aria-hidden="true" /></button>
          </div>
          <div className="site-wrap site-sheet-body">
            <div className="site-sheet-links">
              {siteNavigation.map((item, index) => <a key={item.href} href={item.href} className="site-sheet-link" style={{ animationDelay: `${60 + index * 40}ms` }} aria-current={location === item.href ? 'page' : undefined} onClick={(e) => { setOpen(false); navigateHash(e, item.href); }}>{item.label}<ArrowLeft size={18} strokeWidth={ICON} aria-hidden="true" /></a>)}
            </div>
            <div className="site-sheet-actions"><AuthLinks tone="dark" /></div>
            <p className="site-sheet-tagline">{siteTagline}</p>
          </div>
        </nav>
      )}
    </header>
  );
}

// Scrolls a landing chapter (#problems, #how, …) to just below the sticky
// header. Used by the hash links here and by the landing page on arrival.
export function scrollToChapter(id: string, behavior: ScrollBehavior = 'smooth'): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  const header = document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 0;
  const top = target.getBoundingClientRect().top + window.scrollY - header;
  window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: prefersReducedMotion() ? 'auto' : behavior });
  return true;
}

// Plain anchors keep links crawlable. "/#how" scrolls in place on the landing
// page; from any other page it is a client-side navigation to the landing,
// which then scrolls to the chapter once it has rendered (pages/landing.tsx).
// Everything else is a normal in-app navigation.
function navigateHash(event: MouseEvent<HTMLAnchorElement>, href: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const plainClick = !event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0;
  if (href.startsWith('/#')) {
    const onLanding = window.location.pathname === `${base}/` || window.location.pathname === base || window.location.pathname === '/';
    if (onLanding && document.getElementById(href.slice(2))) {
      event.preventDefault();
      scrollToChapter(href.slice(2));
      history.replaceState(null, '', href.slice(1));
    } else if (!onLanding && plainClick) {
      event.preventDefault();
      window.history.pushState(null, '', `${base}${href}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    return;
  }
  // Same-app route: hand to the router so the SPA does not reload.
  if (plainClick) {
    event.preventDefault();
    window.history.pushState(null, '', `${base}${href}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo({ top: 0 });
  }
}

// The skyline behind the footer rotates through three cities; that line is
// decorative. The office itself is in one city (content/contact.ts), named
// next to its address so the two never contradict each other.
const servedCities = cityOrder.map((key) => cityInfo[key].name).join(' · ');
export function SiteFooter() {
  return (
    <footer className="site-footer on-night">
      <SceneWindow edge="bottom" />
      <div className="site-footer-veil" aria-hidden="true" />
      <div className="site-wrap site-footer-content">
        <div className="site-footer-main">
          <div className="site-footer-brand">
            <Brand light />
            <p className="site-footer-tagline">{siteTagline}. ترسل ما ظهر لك، ويحدد المكتب السبب ويتابع مع الجهة المختصة، وتتابع أنت كل خطوة من صفحة الطلب.</p>
          </div>
          <nav className="site-footer-links" aria-label="روابط التذييل">
            <div>
              <h2>البوابة</h2>
              <ul>
                <li><Link href="/sign-up">طلب التسجيل</Link></li>
                <li><Link href="/sign-in">تسجيل الدخول</Link></li>
                <li><a href="/#problems" onClick={(e) => navigateHash(e, '/#problems')}>مشاكل نحلّها</a></li>
                <li><a href="/#how" onClick={(e) => navigateHash(e, '/#how')}>كيف تعمل البوابة</a></li>
                <li><a href="/#dashboard" onClick={(e) => navigateHash(e, '/#dashboard')}>لوحة العميل</a></li>
                <li><a href="/#assistant" onClick={(e) => navigateHash(e, '/#assistant')}>المساعدة الآلية «أم مشعل»</a></li>
              </ul>
            </div>
            <div>
              <h2>المكتب</h2>
              <ul>
                <li><Link href="/services">دليل الخدمات</Link></li>
                <li><Link href="/trust">الخصوصية والأمان</Link></li>
                <li><Link href="/help">المساعدة</Link></li>
              </ul>
            </div>
            <div className="site-footer-contact">
              <h2>تواصل معنا</h2>
              <ContactList tone="dark" />
              <p className="site-footer-office">مكتبنا في <strong>{contact.city}</strong></p>
            </div>
          </nav>
        </div>
        <div className="site-footer-bottom">
          <div className="site-footer-legal">
            <small>© {new Date().getFullYear()} HBS حلول الغد</small>
            <Link href="/privacy">سياسة الخصوصية</Link>
            <Link href="/terms">شروط الاستخدام</Link>
          </div>
          <p className="site-footer-city">
            <span className="site-footer-city-dot" aria-hidden="true" />
            <span>نتابع التزام المنشآت وملاحظاتها لعملائنا في المملكة: <strong>{servedCities}</strong></span>
          </p>
        </div>
      </div>
    </footer>
  );
}

export function PublicPage({ children, intro }: { children: ReactNode; intro?: ReactNode }) {
  return (
    <div className="site" dir="rtl">
      <a className="site-skip" href="#main">تخطَّ إلى المحتوى</a>
      <SiteHeader tone="dark" />
      <main id="main" tabIndex={-1}>
        <section className="site-band"><div className="site-wrap">{intro}</div></section>
        <div className="site-body">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
