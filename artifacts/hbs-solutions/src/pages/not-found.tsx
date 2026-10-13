import { Link } from 'wouter';
import { ArrowLeft, CircleHelp } from 'lucide-react';
import { PublicPage, siteNavigation } from '@/components/site-chrome';
import { LogoMark } from '@/components/brand/logo';
import '@/pages/public.css';

// Unknown address (the server answers 404 with the SPA shell; the SPA then
// renders this). Same chrome as the other public pages so the visitor can
// navigate on from here instead of hitting a dead end: a branded "404" tile,
// the two main exits, and the site's own navigation as quick links.
export default function NotFound() {
  return (
    <PublicPage intro={<header className="pub-intro"><p className="eyebrow">404</p><h1 className="display">الصفحة غير موجودة</h1><p className="pub-intro-lead">قد يكون الرابط غير صحيح أو تغيّر مكان الصفحة. تصفّح دليل الخدمات أو عد إلى الرئيسية.</p></header>}>
      <div className="site-wrap pub-page">
        <div className="surface-panel nf">
          <div className="nf-code" aria-hidden="true">
            <LogoMark size={36} />
            <strong>404</strong>
            <span className="nf-code-band" />
          </div>
          <div className="nf-body">
            <h2 className="display"><CircleHelp size={22} strokeWidth={1.75} aria-hidden="true" /> لم نعثر على هذه الصفحة</h2>
            <p>تأكد من الرابط، أو ابحث عمّا تحتاجه في دليل الخدمات.</p>
            <div className="pub-help-actions">
              <Link href="/services" className="btn btn-primary">دليل الخدمات <ArrowLeft size={17} strokeWidth={1.75} aria-hidden="true" /></Link>
              <Link href="/" className="btn btn-outline">العودة للرئيسية</Link>
            </div>
            <ul className="nf-links" aria-label="التنقل الرئيسي">
              {siteNavigation.map((item) => <li key={item.href}><a href={item.href}>{item.label}<ArrowLeft size={14} strokeWidth={1.75} aria-hidden="true" /></a></li>)}
            </ul>
          </div>
        </div>
      </div>
    </PublicPage>
  );
}
