import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion, safeStorage } from '@/lib/motion';
import './intro.css';

// First-visit intro: a request enters as layered sheets, passes the four
// stages and settles into the HBS mark, then the page is revealed.
//
// Engineering notes
// - Pure CSS 3D (transform/opacity keyframes). No WebGL: nothing to download,
//   nothing that can fail to load, and the page underneath renders at once.
// - Plays once per browser. Completing or skipping stores the flag; the full
//   sequence never replays on navigation or on later visits.
// - Skipped entirely under prefers-reduced-motion (the hero does a static
//   fade instead). `?intro=1` forces a replay for review; `?intro=0` skips.
// - All text is HTML. The overlay is aria-hidden because the same headline is
//   the page's real <h1>; the Skip button sits outside it and is focusable.

const STORAGE_KEY = 'hbs:intro:v1';
const DESKTOP_MS = 3900;
const MOBILE_MS = 2700;
const EXIT_MS = 520;

export function shouldPlayIntro(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('intro');
  if (param === '0') return false;
  if (param === '1') return true;
  if (prefersReducedMotion()) return false;
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
    setLeaving(true);
    window.setTimeout(onDone, fast ? 260 : EXIT_MS);
  }, [onDone]);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    const timer = window.setTimeout(() => leave(false), mobile ? MOBILE_MS : DESKTOP_MS);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') leave(true); };
    window.addEventListener('keydown', onKey);
    document.documentElement.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = '';
    };
  }, [leave]);

  return (
    <>
      <div className={`intro ${leaving ? 'intro--leaving' : ''}`} aria-hidden="true" onClick={() => leave(true)}>
        <div className="intro-grid" />
        <div className="intro-glow" />
        <div className="intro-stage">
          <div className="intro-doc">
            <span className="intro-sheet intro-sheet--1" />
            <span className="intro-sheet intro-sheet--2" />
            <span className="intro-sheet intro-sheet--3">
              <span className="intro-line intro-line--ref" />
              <span className="intro-line intro-line--title" />
              <span className="intro-bar"><span /></span>
              <span className="intro-dots"><i /><i /><i /><i /></span>
            </span>
          </div>
          <div className="intro-mark">
            <span className="intro-badge">HBS</span>
            <span className="intro-name">حلول الغد</span>
          </div>
          <p className="intro-headline">
            <span>من</span> <span>أول</span> <span>طلب،</span> <span className="intro-accent">تعرف</span> <span className="intro-accent">أين</span> <span className="intro-accent">وصلت</span> <span className="intro-accent">معاملتك.</span>
          </p>
        </div>
      </div>
      <button ref={skipRef} type="button" className={`intro-skip ${leaving ? 'intro-skip--leaving' : ''}`} onClick={() => leave(true)}>
        تخطَّ المقدمة
      </button>
    </>
  );
}
