import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion, safeStorage } from '@/lib/motion';
import './intro.css';

// First-visit logo reveal; all animated properties are transforms or opacity.
// The real page renders underneath, and reduced-motion visitors skip the overlay.
const STORAGE_KEY = 'hbs:intro:v2';
const DESKTOP_MS = 4300;
const MOBILE_MS = 3400;
const EXIT_MS = 520;

export function shouldPlayIntro(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('intro');
  if (prefersReducedMotion()) return false;
  if (param === '0') return false;
  if (param === '1' || param === 'hold') return true;
  if (window.location.hash) return false;
  return safeStorage.get(STORAGE_KEY) !== 'done';
}

export function useIntroState() {
  const [playing, setPlaying] = useState(shouldPlayIntro);
  const finish = useCallback(() => {
    safeStorage.set(STORAGE_KEY, 'done');
    setPlaying(false);
  }, []);
  return { playing, finish };
}

export function IntroSequence({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const skipRef = useRef<HTMLButtonElement>(null);

  const leave = useCallback((fast: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (fast) { onDone(); return; }
    setLeaving(true);
    window.setTimeout(onDone, EXIT_MS);
  }, [onDone]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    const hold = new URLSearchParams(window.location.search).get('intro') === 'hold';
    const timer = hold ? undefined : window.setTimeout(() => leave(false), mobile ? MOBILE_MS : DESKTOP_MS);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') leave(true); };
    window.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
    };
  }, [leave]);

  return (
    <>
      <div className={`intro ${leaving ? 'intro--leaving' : ''}`} aria-hidden="true" onClick={() => leave(true)}>
        <div className="intro-grain" />
        <div className="intro-stage">
          <div className="intro-logo">
            <div className="intro-flare">
              <span className="intro-streak" />
              <span className="intro-streak intro-streak--thin" />
              <span className="intro-bloom" />
            </div>
            <div className="intro-mark">
              <svg viewBox="0 0 64 64" width="100%" height="100%">
                <defs>
                  <linearGradient id="intro-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1d5a60" /><stop offset="1" stopColor="#0c2a2d" /></linearGradient>
                  <linearGradient id="intro-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6c49f" /><stop offset="1" stopColor="#d9804f" /></linearGradient>
                  <radialGradient id="intro-sunglow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#f6c49f" stopOpacity=".75" /><stop offset="1" stopColor="#f6c49f" stopOpacity="0" /></radialGradient>
                  <clipPath id="intro-sky"><rect x="0" y="0" width="64" height="35" /></clipPath>
                </defs>
                <rect className="im-bg" width="64" height="64" rx="15" fill="url(#intro-bg)" />
                <rect className="im-edge" x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke="#fff" strokeOpacity=".16" />
                <g clipPath="url(#intro-sky)">
                  <circle className="im-glow" cx="32" cy="35" r="18" fill="url(#intro-sunglow)" />
                  <circle className="im-sun" cx="32" cy="35" r="9.5" fill="url(#intro-sun)" />
                </g>
                <rect className="im-pillar im-pillar--a" x="14" y="15" width="7" height="34" rx="2.5" fill="#f6efe3" />
                <rect className="im-pillar im-pillar--b" x="43" y="15" width="7" height="34" rx="2.5" fill="#f6efe3" />
                <rect className="im-bar" x="14" y="35" width="36" height="4.5" rx="2" fill="#f6efe3" />
              </svg>
              <span className="intro-glint" />
            </div>
            <div className="intro-words">
              <b className="intro-latin" dir="ltr">HBS</b>
              <i className="intro-sep" />
              <span className="intro-ar">حلول الغد</span>
            </div>
            <p className="intro-tagline">من أول طلب، تعرف أين وصلت معاملتك.</p>
          </div>
        </div>
      </div>
      <button ref={skipRef} type="button" className={`intro-skip ${leaving ? 'intro-skip--leaving' : ''}`} onClick={() => leave(true)}>
        تخطَّ المقدمة
      </button>
    </>
  );
}
