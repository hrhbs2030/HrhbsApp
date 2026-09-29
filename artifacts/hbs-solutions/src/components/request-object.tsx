import { useEffect, useRef, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { prefersReducedMotion } from '@/lib/motion';
import './request-object.css';

// The product's signature object: one request, drawn as a layered document
// that moves through the four real portal stages. Used by the intro, the hero
// and the journey section so the idea reads the same everywhere.

export const stageKeys = ['received', 'reviewing', 'waiting_on_customer', 'completed'] as const;
export const stageLabels = ['تم الاستلام', 'قيد المراجعة', 'بانتظار العميل', 'مكتملة'];

type Props = {
  stage: number;
  reference?: string;
  title?: string;
  category?: string;
  date?: string;
  tilt?: boolean;
  size?: 'hero' | 'compact';
  className?: string;
  caption?: string;
};

export function RequestObject({
  stage,
  reference = 'HBS-2026-00041',
  title = 'تجديد إقامة',
  category = 'الجوازات',
  date = '14 سبتمبر 2026',
  tilt = false,
  size = 'hero',
  className = '',
  caption,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const current = Math.max(0, Math.min(stageKeys.length - 1, stage));

  // Restrained pointer parallax on devices with a fine pointer only.
  useEffect(() => {
    const el = ref.current;
    if (!tilt || !el || prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const x = event.clientX / window.innerWidth - 0.5;
        const y = event.clientY / window.innerHeight - 0.5;
        el.style.setProperty('--ro-px', x.toFixed(3));
        el.style.setProperty('--ro-py', y.toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(frame); };
  }, [tilt]);

  return (
    <figure className={`ro ro--${size} ${className}`} data-stage={stageKeys[current]} aria-label={`مثال لطلب: ${title}، الحالة ${stageLabels[current]}`}>
      <div className="ro-scene" ref={ref} style={{ '--ro-progress': (current + 1) / stageKeys.length } as CSSProperties}>
        <div className="ro-sheet ro-sheet--back" aria-hidden="true" />
        <div className="ro-sheet ro-sheet--mid" aria-hidden="true" />
        <div className="ro-card">
          <div className="ro-head">
            <div>
              <span className="ro-ref" dir="ltr">{reference}</span>
              <p className="ro-title">{title}</p>
            </div>
            <span className="ro-pill" key={current}><span aria-hidden="true" />{stageLabels[current]}</span>
          </div>
          <div className="ro-bar" aria-hidden="true"><span /></div>
          <ol className="ro-track">
            {stageLabels.map((label, index) => (
              <li key={label} data-state={index < current ? 'done' : index === current ? 'current' : 'next'} aria-current={index === current ? 'step' : undefined}>
                <span className="ro-dot" aria-hidden="true">{index < current || (index === current && current === stageKeys.length - 1) ? <Check size={10} strokeWidth={3} /> : null}</span>
                {label}
              </li>
            ))}
          </ol>
          <dl className="ro-meta">
            <div><dt>المجال</dt><dd>{category}</dd></div>
            <div><dt>تاريخ الإرسال</dt><dd>{date}</dd></div>
          </dl>
        </div>
        <div className="ro-glint" aria-hidden="true" />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

// A horizontal rail of the four stages, with the fill following `stage`.
// When `onSelect` is given each station is a real button (keyboard reachable).
export function StageRail({ stage, onSelect, tone = 'dark' }: { stage: number; onSelect?: (index: number) => void; tone?: 'dark' | 'light' }) {
  return (
    <div className={`rail rail--${tone}`} style={{ '--rail-progress': stage / (stageKeys.length - 1) } as CSSProperties}>
      <div className="rail-line" aria-hidden="true"><span /></div>
      <ol className="rail-stations">
        {stageLabels.map((label, index) => {
          const state = index < stage ? 'done' : index === stage ? 'current' : 'next';
          return (
            <li key={label} data-state={state}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(index)} aria-pressed={index === stage}>
                  <span className="rail-node" aria-hidden="true" />{label}
                </button>
              ) : (
                <span className="rail-static"><span className="rail-node" aria-hidden="true" />{label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
