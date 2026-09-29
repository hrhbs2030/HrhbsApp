import { Printer } from 'lucide-react';
import { Logo, LogoMark } from './logo';
import { formatDate } from '@/lib/format';
import './print.css';

export function PrintFrame({ title, staff = false }: { title: string; staff?: boolean }) {
  return <>
    <div className="print-only print-head" aria-hidden="true">
      <Logo size={40}/>
      <div className="print-head-meta"><strong>{title}</strong><span>تاريخ الطباعة: {formatDate(new Date())}</span></div>
    </div>
    <div className="print-only print-watermark" aria-hidden="true"><LogoMark size={360}/></div>
    <div className="print-only print-foot" aria-hidden="true">HBS حلول الغد · {staff ? 'وثيقة داخلية للمكتب' : 'وثيقة صادرة من بوابة العملاء'}</div>
  </>;
}

export function PrintButton({ label = 'طباعة' }: { label?: string }) {
  return <button type="button" className="btn btn-outline no-print" onClick={() => window.print()}>
    <Printer size={17} aria-hidden="true"/>{label}
  </button>;
}