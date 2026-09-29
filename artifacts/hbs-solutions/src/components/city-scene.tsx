import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
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
// - Mounted once at app level for public pages, so it keeps playing without
//   a restart while the visitor moves between pages; a route change moves on
//   to the next city with the same crossfade.
// - No video file or WebGL: nothing to download or fail. ~transform/opacity only.
// - Seen through "windows" (scene-window.tsx): the page's top band and its
//   footer. It plays only while a window is on screen and the tab is shown,
//   and grows to full height while a footer window is visible, so the skyline
//   stands on the viewport's bottom edge behind the footer.
// - Reduced motion: one still frame, no drift, no cycling.

export type CityKey = 'riyadh' | 'jeddah' | 'jazan';
export const cityOrder: CityKey[] = ['riyadh', 'jeddah', 'jazan'];
export const cityInfo: Record<CityKey, { name: string; region: string }> = {
  riyadh: { name: 'الرياض', region: 'منطقة الرياض' },
  jeddah: { name: 'جدة', region: 'منطقة مكة المكرمة' },
  jazan: { name: 'جازان', region: 'منطقة جازان' },
};
const SCENE_MS = 12000;

const scenes: Record<CityKey, () => ReactNode> = { riyadh: () => <RiyadhScene />, jeddah: () => <JeddahScene />, jazan: () => <JazanScene /> };

export type SceneVariant = 'full' | 'band' | 'portal';

export function CityScene({ routeKey, variant = 'full', showCaption = true }: { routeKey: string; variant?: SceneVariant; showCaption?: boolean }) {
  const reduced = useReducedMotion();
  // Review aid: ?city=jeddah pins one city (no cycling), for design QA.
  // Read once: pages may rewrite the query string later (filters, search).
  const [pinned] = useState(() => typeof window !== 'undefined' ? cityOrder.indexOf(new URLSearchParams(window.location.search).get('city') as CityKey) : -1);
  const [index, setIndex] = useState(pinned >= 0 ? pinned : 0);
  const firstRoute = useRef(true);
  const windows = useSceneWindows();
  // Nothing registered yet (first paint): keep playing rather than flash a pause.
  const paused = windows.hidden || (windows.registered && !windows.any);
  // Grow for the footer. When the top band is off screen the change happens
  // behind the paper sheet, so it snaps (no per-frame SVG re-layout); when
  // both windows are visible (a short page) it animates.
  const expanded = windows.bottom && variant !== 'full';
  const snap = !windows.top;

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

  useEffect(() => setSceneCity(index), [index]);

  const active = cityOrder[index];
  return (
    <>
    {/* Night fill under the scene while a footer is on screen, so the gap never
        shows the paper page while the scene grows or shrinks. */}
    <div className="cs-underlay" data-on={windows.bottom || undefined} aria-hidden="true" />
    <div className={`cs cs--${variant}${expanded ? ' cs--expanded' : ''}${windows.bottom ? ' cs--footer' : ''}${paused || reduced ? ' cs--paused' : ''}`} data-snap={snap || undefined} aria-hidden="true">
      {cityOrder.map((key) => (
        <div key={key} className="cs-scene" data-active={key === active} data-city={key}>
          <Suspense fallback={null}>{scenes[key]()}</Suspense>
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
    </div>
    </>
  );
}
