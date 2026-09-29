import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, Menu, X } from 'lucide-react';
import { Brand } from '@/components/portal-ui';
import { cityInfo, cityOrder } from '@/components/city-scene';
import { SceneWindow, useSceneWindows } from '@/components/scene-window';
import './site-chrome.css';

const ICON = 1.75;

export const siteNavigation = [
  { href: '/services', label: 'الخدمات' },
  { href: '/#how', label: 'كيف تعمل البوابة' },
  { href: '/#assistant', label: 'أم مشعل' },
  { href: '/trust', label: 'الخصوصية والأمان' },
  { href: '/help', label: 'المساعدة' },
];

// Public-site header. `tone="dark"` sits on the night hero; `light` on paper pages.
export function SiteHeader({ tone = 'light' }: { tone?: 'dark' | 'light' }) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  useEffect(() => setOpen(false), [location]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className={`site-header site-header--${tone}`}>
      <div className="site-wrap site-header-inner">
        <Brand light={tone === 'dark'} />
        <nav className="site-nav" aria-label="التنقل الرئيسي">
          {siteNavigation.map((item) => (
            <a key={item.href} href={item.href} aria-current={location === item.href ? 'page' : undefined} onClick={(e) => navigateHash(e, item.href)}>{item.label}</a>
          ))}
        </nav>
        <div className="site-actions">
          <Link href="/sign-in" className="site-text-link">تسجيل الدخول</Link>
          <Link href="/sign-up" className={`btn btn-sm ${tone === 'dark' ? 'btn-light' : 'btn-primary'}`}>طلب التسجيل <ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></Link>
        </div>
        <button type="button" className="site-menu-toggle" aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'} aria-expanded={open} aria-controls="site-mobile-nav" onClick={() => setOpen((v) => !v)}>
          {open ? <X size={21} strokeWidth={ICON} /> : <Menu size={21} strokeWidth={ICON} />}
        </button>
      </div>
      {open && (
        <nav id="site-mobile-nav" className="site-wrap site-mobile-nav" aria-label="التنقل على الهاتف">
          {siteNavigation.map((item) => <a key={item.href} href={item.href} onClick={(e) => { setOpen(false); navigateHash(e, item.href); }}>{item.label}</a>)}
          <Link href="/sign-in">تسجيل الدخول</Link>
          <Link href="/sign-up" className={`btn ${tone === 'dark' ? 'btn-light' : 'btn-primary'}`}>طلب التسجيل <ArrowLeft size={16} strokeWidth={ICON} aria-hidden="true" /></Link>
        </nav>
      )}
    </header>
  );
}

// Plain anchors keep links crawlable; on the landing page, "/#how" scrolls
// in place instead of reloading. Everything else is a normal navigation.
function navigateHash(event: MouseEvent<HTMLAnchorElement>, href: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (href.startsWith('/#')) {
    const onLanding = window.location.pathname === `${base}/` || window.location.pathname === base || window.location.pathname === '/';
    const target = document.getElementById(href.slice(2));
    if (onLanding && target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', href.slice(1));
    }
    return;
  }
  // Same-app route: hand to the router so the SPA does not reload.
  if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) {
    event.preventDefault();
    window.history.pushState(null, '', `${base}${href}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo({ top: 0 });
  }
}

// The page ends on a window onto the city: the paper sheet above lifts away
// (rounded, shadowed) and the fixed scene shows through this transparent
// footer, its skyline on the viewport's bottom edge. A dark veil at the foot
// keeps the links legible; the caption names the city being shown.
export function SiteFooter() {
  const { city } = useSceneWindows();
  const place = cityInfo[cityOrder[city] ?? 'riyadh'];
  return (
    <footer className="site-footer">
      <SceneWindow edge="bottom" />
      <div className="site-footer-veil" aria-hidden="true" />
      <div className="site-wrap site-footer-content">
        <div className="site-footer-main">
          <div className="site-footer-brand"><Brand light /></div>
          <nav className="site-footer-links" aria-label="روابط التذييل">
            <div>
              <h2>البوابة</h2>
              <ul>
                <li><Link href="/sign-up">طلب التسجيل</Link></li>
                <li><Link href="/sign-in">تسجيل الدخول</Link></li>
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
          </nav>
        </div>
        <div className="site-footer-bottom">
          <small>© {new Date().getFullYear()} HBS حلول الغد</small>
          <p className="site-footer-city" aria-hidden="true" key={place.name}>
            <span className="site-footer-city-dot" />
            <strong>{place.name}</strong>
            <span>{place.region}</span>
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
