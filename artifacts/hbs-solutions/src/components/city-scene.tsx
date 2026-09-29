import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from '@/lib/motion';
import { setSceneCity, useSceneWindows } from './scene-window';
import { RiyadhScene } from './city-scenes/riyadh';
// Riyadh paints first; the other two cities load right after, off the critical path.
const JeddahScene = lazy(() => import('./city-scenes/jeddah').then((m) => ({ default: m.JeddahScene })));
const JazanScene = lazy(() => import('./city-scenes/jazan').then((m) => ({ default: m.JazanScene })));
import './city-scene.css';

// Animated backdrop of three Saudi cities, drawn in SVG and moved with CSS
// only (a slow camera drift with parallax between layers, twinkling windows,
// water and a fountain), crossfading from city to city like a video loop.
//
// - Mounted once at app level, so it keeps playing without a restart as the
//   visitor moves between public pages and the portal.
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

export type SceneVariant = 'full' | 'band' | 'portal';

class SceneErrorBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() {
    return this.state.failed ? <div className="cs-static-fallback" /> : this.props.children;
  }
}

// Keep the import paths static so Vite can emit real chunks. Distinct URLs
// bypass the browser module map's cached failure for an earlier fetch.
const jeddahRetry = [
  () => import('./city-scenes/jeddah?retry=1'),
  () => import('./city-scenes/jeddah?retry=2'),
  () => import('./city-scenes/jeddah?retry=3'),
  () => import('./city-scenes/jeddah?retry=4'),
  () => import('./city-scenes/jeddah?retry=5'),
  () => import('./city-scenes/jeddah?retry=6'),
];
const jazanRetry = [
  () => import('./city-scenes/jazan?retry=1'),
  () => import('./city-scenes/jazan?retry=2'),
  () => import('./city-scenes/jazan?retry=3'),
  () => import('./city-scenes/jazan?retry=4'),
  () => import('./city-scenes/jazan?retry=5'),
  () => import('./city-scenes/jazan?retry=6'),
];

function retryableCity(city: 'jeddah' | 'jazan', attempt: number) {
  if (attempt === 0) return city === 'jeddah' ? JeddahScene : JazanScene;
  if (city === 'jeddah') return lazy(() => jeddahRetry[Math.min(attempt, jeddahRetry.length) - 1]().then((m) => ({ default: m.JeddahScene })));
  return lazy(() => jazanRetry[Math.min(attempt, jazanRetry.length) - 1]().then((m) => ({ default: m.JazanScene })));
}

export function CityScene({ routeKey, variant = 'full', showCaption = true }: { routeKey: string; variant?: SceneVariant; showCaption?: boolean }) {
  const reduced = useReducedMotion();
  // Review aid: ?city=jeddah pins one city (no cycling), for design QA.
  const pinned = typeof window !== 'undefined' ? cityOrder.indexOf(new URLSearchParams(window.location.search).get('city') as CityKey) : -1;
  const [index, setIndex] = useState(pinned >= 0 ? pinned : 0);
  const [failed, setFailed] = useState<CityKey[]>([]);
  const [attempts, setAttempts] = useState({ jeddah: 0, jazan: 0 });
  const Jeddah = useMemo(() => retryableCity('jeddah', attempts.jeddah), [attempts.jeddah]);
  const Jazan = useMemo(() => retryableCity('jazan', attempts.jazan), [attempts.jazan]);
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

  // Advance like a video loop.
  useEffect(() => {
    if (reduced || paused || pinned >= 0) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % cityOrder.length), SCENE_MS);
    return () => window.clearTimeout(timer);
  }, [index, reduced, paused]);

  // Page change: glide to the next city with the same crossfade.
  useEffect(() => {
    if (firstRoute.current) { firstRoute.current = false; return; }
    if (!reduced && pinned < 0) setIndex((i) => (i + 1) % cityOrder.length);
  }, [routeKey, reduced, pinned]);

  const active = cityOrder[index];
  return (
    <>
    <div className="cs-underlay" data-on={windows.bottom || undefined} aria-hidden="true" />
    <div className={`cs cs--${variant}${expanded ? ' cs--expanded' : ''}${windows.bottom ? ' cs--footer' : ''}${paused || reduced ? ' cs--paused' : ''}`} data-snap={snap || undefined} aria-hidden="true">
      <>
        {cityOrder.map((key) => (
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