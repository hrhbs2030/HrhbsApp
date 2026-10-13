import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, PauseCircle } from 'lucide-react';
import { milestoneLabels, milestoneKeys, milestones, pauses, type PauseKey } from '@/content/milestones';
import { prefersReducedMotion } from '@/lib/motion';
import './request-object.css';

// The product's signature object: one request, drawn as a layered document
// that moves through the four real portal milestones (content/milestones.ts).
// A pause («بانتظار العميل») is shown as a badge on the review milestone, not
// as a step. Used by the intro, the hero and the journey section so the idea
// reads the same everywhere. Each milestone change settles the card with a
// short lift-and-land (Web Animations, transform only); the rail's stations
// are magnetic under a fine pointer and spring back when it leaves.

const finePointer = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;

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
  const cardRef = useRef<HTMLDivElement>(null);
  const current = Math.max(0, Math.min(milestones.length - 1, stage));
  const last = current === milestones.length - 1;
  const paused = pause && !last ? pauses[pause] : null;
  const status = paused ? paused.label : milestoneLabels[current];

  // Settle: on every milestone or pause change the card lifts, tips a touch
  // toward the new station and lands. Skipped on first paint and under reduced motion.
  const mounted = useRef(false);
  useEffect(() => {
    const card = cardRef.current;
    if (!mounted.current) { mounted.current = true; return; }
    if (!card || typeof card.animate !== 'function' || prefersReducedMotion()) return;
    const animation = card.animate([
      { transform: 'translateZ(0) translateY(0) rotateZ(0deg)' },
      { transform: 'translateZ(0) translateY(-9px) rotateZ(-.7deg) scale(1.012)', offset: .32 },
      { transform: 'translateZ(0) translateY(2px) rotateZ(.2deg)', offset: .72 },
      { transform: 'translateZ(0) translateY(0) rotateZ(0deg)' },
    ], { duration: 680, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    return () => animation.cancel();
  }, [current, paused?.key]);

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
        <div className="ro-card" ref={cardRef}>
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
  // Magnetic stations: a button follows a fine pointer by up to 5 px (set as
  // CSS variables, transform in request-object.css) and springs back on leave.
  const magnet = {
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'mouse' || !finePointer() || prefersReducedMotion()) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const dx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - .5) * 2));
      const dy = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - .5) * 2));
      event.currentTarget.style.setProperty('--mx', (dx * 5).toFixed(2));
      event.currentTarget.style.setProperty('--my', (dy * 4).toFixed(2));
      event.currentTarget.dataset.magnet = 'on';
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.currentTarget.style.setProperty('--mx', '0');
      event.currentTarget.style.setProperty('--my', '0');
      delete event.currentTarget.dataset.magnet;
    },
  };
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
                <button type="button" onClick={() => onSelect(index)} aria-pressed={index === stage} {...magnet}>
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
