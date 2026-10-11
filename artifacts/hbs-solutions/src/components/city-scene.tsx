import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType, type ReactNode } from 'react';
import { useReducedMotion } from '@/lib/motion';
import { setSceneCity, useSceneWindows } from './scene-window';
import { RiyadhScene } from './city-scenes/riyadh';
import './city-scene.css';

// Animated backdrop of three Saudi cities, drawn in SVG and moved with CSS
// only (a slow camera drift with parallax between layers, twinkling windows,
// water and a fountain), crossfading from city to city like a video loop.
//
// - Mounted once at app level, so it keeps playing without a restart as the
//   visitor moves between public pages and the portal.
// - Only the city on screen is in the DOM (each is ~1,300 SVG nodes). The next
//   one mounts a few seconds before its turn so the crossfade has something to
//   fade into, and the previous one leaves once its fade-out has finished.
// - No video file or WebGL; lazy city modules can still fail to load, so the
//   scene has a static gradient fallback independent of the page content.
// - Seen through the page's top band and footer, and paused when neither is in
//   view. The full-height reveal behind the footer keeps the skyline at screen
//   level as the visitor scrolls to the end of the page.
// - Reduced motion: one still frame, no drift, no cycling.

export type CityKey = 'riyadh' | 'jeddah' | 'jazan';
export const cityOrder: CityKey[] = ['riyadh', 'jeddah', 'jazan'];
export const cityInfo: Record<CityKey, { name: string; region: string }> = {
  riyadh: { name: 'الرياض', region: 'منطقة الرياض' },
  jeddah: { name: 'جدة', region: 'منطقة مكة المكرمة' },
  jazan: { name: 'جازان', region: 'منطقة جازان' },
};
const SCENE_MS = 12000;
// Lead time for mounting the next city, and how long the previous one stays
// mounted after the switch (the opacity transition in city-scene.css is 1.8 s).
const PREMOUNT_MS = 3000;
const FADE_MS = 2000;
const RETRY_DELAY_MS = 1000;

export type SceneVariant = 'full' | 'band' | 'portal';

class SceneErrorBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() {
    return this.state.failed ? <div className="cs-static-fallback" /> : this.props.children;
  }
}

type LazyCity = 'jeddah' | 'jazan';
type CityModule = { JeddahScene?: ComponentType; JazanScene?: ComponentType };
const cityImports: Record<LazyCity, () => Promise<CityModule>> = {
  jeddah: () => import('./city-scenes/jeddah'),
  jazan: () => import('./city-scenes/jazan'),
};
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
let retrySerial = 0;
// A failed import() is remembered by the browser's module map, so the same
// URL rejects again at once. Browsers that name the chunk in the error
// (Chrome, Firefox) get it fetched again under a fresh query string; the
// others fall through to the static backdrop and the retry button.
async function importFresh(load: () => Promise<CityModule>, error: unknown): Promise<CityModule> {
  const url = String((error as Error)?.message ?? '').match(/(\S+\.(?:[cm]?js|tsx?))(?:\?\S*)?(?:\s|$)/)?.[1];
  if (!url) return load();
  const separator = url.includes('?') ? '&' : '?';
  return import(/* @vite-ignore */ `${url}${separator}retry=${++retrySerial}`) as Promise<CityModule>;
}
async function loadCity(city: LazyCity): Promise<CityModule> {
  const load = cityImports[city];
  try {
    return await load();
  } catch (error) {
    // One more try after a short pause covers a dropped connection; a second
    // failure reaches the error boundary, whose fallback has the retry button.
    await wait(RETRY_DELAY_MS);
    return importFresh(load, error);
  }
}
function lazyCity(city: LazyCity) {
  return lazy(() => loadCity(city).then((m) => ({ default: (city === 'jeddah' ? m.JeddahScene : m.JazanScene) as ComponentType })));
}

export function CityScene({ routeKey, variant = 'full', showCaption = true }: { routeKey: string; variant?: SceneVariant; showCaption?: boolean }) {
  const reduced = useReducedMotion();
  // Review aid: ?city=jeddah pins one city (no cycling), for design QA.
  const pinned = typeof window !== 'undefined' ? cityOrder.indexOf(new URLSearchParams(window.location.search).get('city') as CityKey) : -1;
  const [index, setIndex] = useState(pinned >= 0 ? pinned : 0);
  // The city mounting ahead of its turn, and the one still fading out.
  const [warm, setWarm] = useState<CityKey | null>(null);
  const [leaving, setLeaving] = useState<CityKey | null>(null);
  const [failed, setFailed] = useState<CityKey[]>([]);
  const [attempts, setAttempts] = useState({ jeddah: 0, jazan: 0 });
  // A new attempt makes a new lazy component, so React asks for the chunk again.
  const Jeddah = useMemo(() => lazyCity('jeddah'), [attempts.jeddah]);
  const Jazan = useMemo(() => lazyCity('jazan'), [attempts.jazan]);
  const previous = useRef(index);
  const firstRoute = useRef(true);
  const windows = useSceneWindows();
  const paused = windows.hidden || (windows.registered && !windows.any);
  const expanded = windows.bottom && variant !== 'full';
  const snap = !windows.top;
  const retry = () => {
    if (!failed.length) return;
    setAttempts((previous) => ({
      jeddah: previous.jeddah + (failed.includes('jeddah') ? 1 : 0),
      jazan: previous.jazan + (failed.includes('jazan') ? 1 : 0),
    }));
    setFailed([]);
  };

  useEffect(() => {
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [failed]);

  useEffect(() => {
    if (pinned >= 0) setIndex(pinned);
  }, [pinned]);

  useEffect(() => setSceneCity(index), [index]);

  // Advance like a video loop, mounting the next city shortly before its turn.
  useEffect(() => {
    if (reduced || paused || pinned >= 0) return;
    const next = cityOrder[(index + 1) % cityOrder.length];
    const prepare = window.setTimeout(() => setWarm(next), SCENE_MS - PREMOUNT_MS);
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % cityOrder.length), SCENE_MS);
    return () => { window.clearTimeout(prepare); window.clearTimeout(timer); };
  }, [index, reduced, paused]);

  // After a switch the previous city stays until its fade-out has finished.
  useEffect(() => {
    if (previous.current === index) return;
    const left = cityOrder[previous.current];
    previous.current = index;
    setWarm(null);
    setLeaving(left);
    const timer = window.setTimeout(() => setLeaving((current) => (current === left ? null : current)), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [index]);

  // Page change: glide to the next city with the same crossfade.
  useEffect(() => {
    if (firstRoute.current) { firstRoute.current = false; return; }
    if (!reduced && pinned < 0) setIndex((i) => (i + 1) % cityOrder.length);
  }, [routeKey, reduced, pinned]);

  const active = cityOrder[index];
  const mounted = cityOrder.filter((key) => key === active || key === warm || key === leaving);
  return (
    <>
    <div className="cs-underlay" data-on={windows.bottom || undefined} aria-hidden="true" />
    <div className={`cs cs--${variant}${expanded ? ' cs--expanded' : ''}${windows.bottom ? ' cs--footer' : ''}${paused || reduced ? ' cs--paused' : ''}`} data-snap={snap || undefined} aria-hidden="true">
      <>
        {mounted.map((key) => (
          <div key={key} className="cs-scene" data-active={key === active} data-city={key}>
            {key === 'riyadh' ? <RiyadhScene /> : (
              <SceneErrorBoundary key={`${key}-${attempts[key]}`} onFailure={() => setFailed((current) => current.includes(key) ? current : [...current, key])}>
                <Suspense fallback={null}>{key === 'jeddah' ? <Jeddah /> : <Jazan />}</Suspense>
              </SceneErrorBoundary>
            )}
          </div>
        ))}
        <div className="cs-grain" />
        <div className="cs-veil" />
        {showCaption && (
          <div className="cs-caption" key={active} style={{ '--scene-ms': `${SCENE_MS}ms` } as CSSProperties}>
            <strong>{cityInfo[active].name}</strong>
            <span>{cityInfo[active].region}</span>
            {!reduced && <i className="cs-progress" />}
          </div>
        )}
      </>
    </div>
    {failed.length > 0 && (
      <button type="button" className="cs-retry" onClick={retry} aria-label="إعادة تحميل مشهد المدينة">
        تعذّر تحميل مشهد المدينة · إعادة المحاولة
      </button>
    )}
    </>
  );
}
