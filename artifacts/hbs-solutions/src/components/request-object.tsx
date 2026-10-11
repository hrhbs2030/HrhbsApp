import { useEffect, useRef, type CSSProperties } from 'react';
import { Check, PauseCircle } from 'lucide-react';
import { milestoneLabels, milestoneKeys, milestones, pauses, type PauseKey } from '@/content/milestones';
import { prefersReducedMotion } from '@/lib/motion';
import './request-object.css';

// The product's signature object: one request, drawn as a layered document
// that moves through the four real portal milestones (content/milestones.ts).
// A pause («بانتظار العميل») is shown as a badge on the review milestone, not
// as a step. Used by the intro, the hero and the journey section so the idea
// reads the same everywhere.

export type StageFrame = { stage: number; pause?: PauseKey | null };

type Props = StageFrame & {
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
  pause = null,
  reference = 'HBS-2026-00041',
  title = 'تأسيس شركة',
  category = 'تأسيس الشركات والتراخيص',
  date = '14 سبتمبر 2026',
  tilt = false,
  size = 'hero',
  className = '',
  caption,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const current = Math.max(0, Math.min(milestones.length - 1, stage));
  const last = current === milestones.length - 1;
  const paused = pause && !last ? pauses[pause] : null;
  const status = paused ? paused.label : milestoneLabels[current];

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
    <figure className={`ro ro--${size} ${className}`} data-stage={paused ? paused.key : milestoneKeys[current]} aria-label={`مثال لطلب: ${title}، الحالة ${status}`}>
      <div className="ro-scene" ref={ref} style={{ '--ro-progress': (current + 1) / milestones.length } as CSSProperties}>
        <div className="ro-sheet ro-sheet--back" aria-hidden="true" />
        <div className="ro-sheet ro-sheet--mid" aria-hidden="true" />
        <div className="ro-card">
          <div className="ro-head">
            <div>
              <span className="ro-ref" dir="ltr">{reference}</span>
              <p className="ro-title">{title}</p>
            </div>
            <span className="ro-pill" key={status}><span aria-hidden="true" />{status}</span>
          </div>
          <div className="ro-bar" aria-hidden="true"><span /></div>
          <ol className="ro-track">
            {milestoneLabels.map((label, index) => (
              <li key={label} data-state={index < current ? 'done' : index === current ? 'current' : 'next'} aria-current={index === current ? 'step' : undefined}>
                <span className="ro-dot" aria-hidden="true">{index < current || (index === current && last) ? <Check size={10} strokeWidth={3} /> : null}</span>
                {label}
                {paused && index === current && <span className="ro-pause" key={paused.key}><PauseCircle size={11} strokeWidth={2.2} aria-hidden="true" />{paused.label}</span>}
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

// A horizontal rail of the four milestones, with the fill following `stage`.
// When `onSelect` is given each station is a real button (keyboard reachable).
// A `pause` marks the current station with the pause label underneath.
export function StageRail({ stage, pause = null, onSelect, tone = 'dark' }: StageFrame & { onSelect?: (index: number) => void; tone?: 'dark' | 'light' }) {
  const paused = pause && stage < milestones.length - 1 ? pauses[pause] : null;
  return (
    <div className={`rail rail--${tone}`} style={{ '--rail-progress': stage / (milestones.length - 1) } as CSSProperties}>
      <div className="rail-line" aria-hidden="true"><span /></div>
      <ol className="rail-stations">
        {milestoneLabels.map((label, index) => {
          const state = index < stage ? 'done' : index === stage ? 'current' : 'next';
          const tag = paused && index === stage ? <small className="rail-pause" key={paused.key}>{paused.label}</small> : null;
          return (
            <li key={label} data-state={state} data-paused={tag ? 'true' : undefined}>
              {onSelect ? (
                <button type="button" onClick={() => onSelect(index)} aria-pressed={index === stage}>
                  <span className="rail-node" aria-hidden="true" />{label}{tag}
                </button>
              ) : (
                <span className="rail-static"><span className="rail-node" aria-hidden="true" />{label}{tag}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
