import { Printer } from 'lucide-react';
import { Logo, LogoMark } from './logo';
import { formatDate } from '@/lib/format';
import './print.css';

// Branded print frame for reports. Invisible on screen; when a portal or
// office page is printed or saved as PDF it adds the logo header, the page
// title and print date, a centred logo watermark on every page and a footer.
export function PrintFrame({ title }: { title?: string }) {
  const heading = title ?? (typeof document !== 'undefined' ? document.title.split('|')[0].trim() : '');
  return (
    <>
      <div className="print-only print-head" aria-hidden="true">
        <Logo size={40} />
        <div className="print-head-meta">
          <strong>{heading}</strong>
          <span>تاريخ الطباعة: {formatDate(new Date())}</span>
        </div>
      </div>
      <div className="print-only print-watermark" aria-hidden="true"><LogoMark size={360} /></div>
      <div className="print-only print-foot" aria-hidden="true">HBS حلول الغد · وثيقة صادرة من بوابة العملاء · hrhbs.com</div>
    </>
  );
}

export function PrintButton({ label = 'طباعة' }: { label?: string }) {
  return (
    <button type="button" className="btn btn-outline no-print" onClick={() => window.print()}>
      <Printer size={17} aria-hidden="true" />{label}
    </button>
  );
}
