import { Link } from 'wouter';
import { ArrowLeft, CircleHelp } from 'lucide-react';
import { PublicPage } from '@/components/site-chrome';
import '@/pages/public.css';

// Unknown address (the server answers 404 with the SPA shell; the SPA then
// renders this). Same chrome as the other public pages so the visitor can
// navigate on from here instead of hitting a dead end.
export default function NotFound() {
  return (
    <PublicPage intro={<header className="pub-intro"><p className="eyebrow">404</p><h1 className="display">الصفحة غير موجودة</h1><p className="pub-intro-lead">قد يكون الرابط غير صحيح أو تغيّر مكان الصفحة. تصفّح دليل الخدمات أو عد إلى الرئيسية.</p></header>}>
      <div className="site-wrap pub-page">
        <div className="surface pub-empty">
          <CircleHelp size={28} strokeWidth={1.5} aria-hidden="true" />
          <h2 className="display">لم نعثر على هذه الصفحة</h2>
          <p>تأكد من الرابط، أو ابحث عمّا تحتاجه في دليل الخدمات.</p>
          <div className="pub-help-actions">
            <Link href="/services" className="btn btn-primary">دليل الخدمات <ArrowLeft size={17} strokeWidth={1.75} aria-hidden="true" /></Link>
            <Link href="/" className="btn btn-outline">العودة للرئيسية</Link>
          </div>
        </div>
      </div>
    </PublicPage>
  );
}
