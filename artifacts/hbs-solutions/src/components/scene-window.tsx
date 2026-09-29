import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

// Windows onto the single app-wide city scene.
//
// The scene is one fixed element behind every page (see city-scene.tsx). A
// page shows it through transparent "windows": the dark band at the top of a
// page and the footer at its end. Each window is a <SceneWindow> placed inside
// the transparent area; it reports whether it is on screen, and the scene
// reacts: it plays only while some window is visible (and the tab is shown),
// and while a bottom window is visible it grows to full height so its skyline
// sits on the viewport's bottom edge, under the footer.

export type SceneEdge = 'top' | 'bottom';

type Snapshot = { top: boolean; bottom: boolean; any: boolean; registered: boolean; hidden: boolean; city: number };

const visible = { top: new Set<string>(), bottom: new Set<string>() };
const registered = new Set<string>();
let hidden = typeof document !== 'undefined' ? document.hidden : false;
let city = 0;
let snapshot: Snapshot = compute();
const listeners = new Set<() => void>();

function compute(): Snapshot {
  const top = visible.top.size > 0;
  const bottom = visible.bottom.size > 0;
  return { top, bottom, any: top || bottom, registered: registered.size > 0, hidden, city };
}
function emit() {
  const next = compute();
  if (next.top === snapshot.top && next.bottom === snapshot.bottom && next.registered === snapshot.registered && next.hidden === snapshot.hidden && next.city === snapshot.city) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  if (listeners.size === 0 && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
function onVisibility() { hidden = document.hidden; emit(); }

/** Live state of the windows: which edges are on screen, tab visibility, current city index. */
export function useSceneWindows(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Called by the scene so footers can caption the city they reveal. */
export function setSceneCity(index: number) { city = index; emit(); }

// How early a window counts as visible. The bottom one reports before it
// scrolls in, so the scene has already grown by the time the footer appears.
const MARGIN: Record<SceneEdge, string> = { top: '40px 0px 40px 0px', bottom: '0px 0px 240px 0px' };

/**
 * A transparent, aria-hidden marker filling its positioned parent (inset: 0)
 * unless given a class that sizes it otherwise.
 */
export function SceneWindow({ edge, className = '' }: { edge: SceneEdge; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    registered.add(id); emit();
    if (typeof IntersectionObserver === 'undefined') { visible[edge].add(id); emit(); return () => { visible[edge].delete(id); registered.delete(id); emit(); }; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) visible[edge].add(id); else visible[edge].delete(id);
      emit();
    }, { rootMargin: MARGIN[edge] });
    observer.observe(node);
    return () => { observer.disconnect(); visible[edge].delete(id); registered.delete(id); emit(); };
  }, [edge, id]);
  return <div ref={ref} className={`scene-window ${className}`} data-edge={edge} aria-hidden="true" />;
}
