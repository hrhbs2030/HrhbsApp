import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from '@/lib/motion';
import { RiyadhScene } from './city-scenes/riyadh';
import { JeddahScene } from './city-scenes/jeddah';
import { JazanScene } from './city-scenes/jazan';
import './city-scene.css';

// Animated backdrop of three Saudi cities, drawn in SVG and moved with CSS
// only (a slow camera drift with parallax between layers, twinkling windows,
// water and a fountain), crossfading from city to city like a video loop.
//
// - Mounted once at app level for public pages, so it keeps playing without
//   a restart while the visitor moves between pages; a route change moves on
//   to the next city with the same crossfade.
// - No video file or WebGL: nothing to download or fail. ~transform/opacity only.
// - Paused when the tab is hidden or the scene is scrolled out of view.
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

export function CityScene({ routeKey, compact = false, showCaption = true }: { routeKey: string; compact?: boolean; showCaption?: boolean }) {
  const reduced = useReducedMotion();
  // Review aid: ?city=jeddah pins one city (no cycling), for design QA.
  const pinned = typeof window !== 'undefined' ? cityOrder.indexOf(new URLSearchParams(window.location.search).get('city') as CityKey) : -1;
  const [index, setIndex] = useState(pinned >= 0 ? pinned : 0);
  const [paused, setPaused] = useState(false);
  const firstRoute = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

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

  // Pause when the tab is hidden or the scene is scrolled away.
  useEffect(() => {
    const update = () => setPaused(document.hidden || window.scrollY > (rootRef.current?.offsetHeight ?? window.innerHeight) + 40);
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('scroll', update, { passive: true });
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('scroll', update); };
  }, []);

  const active = cityOrder[index];
  return (
    <div ref={rootRef} className={`cs ${compact ? 'cs--compact' : ''} ${paused || reduced ? 'cs--paused' : ''}`} aria-hidden="true">
      {cityOrder.map((key) => (
        <div key={key} className="cs-scene" data-active={key === active} data-city={key}>
          {scenes[key]()}
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
  );
}
