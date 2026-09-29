import { useEffect, useId, useRef, useSyncExternalStore } from 'react';

// The single app-wide city scene is shown through transparent page windows:
// the top band and the footer. The scene pauses whenever all windows are out
// of view, and grows behind a visible footer so the skyline stays at screen
// level while the footer scrolls into view.
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

function onVisibility() {
  hidden = document.hidden;
  emit();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0 && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}

/** Current visibility of the scene windows, tab, and active city. */
export function useSceneWindows(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Called by CityScene so the footer can label the scene it reveals. */
export function setSceneCity(index: number) {
  city = index;
  emit();
}

// The footer reports before it enters the viewport, so the scene is expanded
// before it becomes visible. The top window gets a small margin for smooth
// pauses when scrolling between sections.
const MARGIN: Record<SceneEdge, string> = { top: '40px 0px 40px 0px', bottom: '0px 0px 240px 0px' };

/** A transparent marker that fills the positioned page region. */
export function SceneWindow({ edge, className = '' }: { edge: SceneEdge; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    registered.add(id);
    emit();

    if (typeof IntersectionObserver === 'undefined') {
      visible[edge].add(id);
      emit();
      return () => {
        visible[edge].delete(id);
        registered.delete(id);
        emit();
      };
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) visible[edge].add(id);
      else visible[edge].delete(id);
      emit();
    }, { rootMargin: MARGIN[edge] });
    observer.observe(node);
    return () => {
      observer.disconnect();
      visible[edge].delete(id);
      registered.delete(id);
      emit();
    };
  }, [edge, id]);

  return <div ref={ref} className={`scene-window ${className}`} data-edge={edge} aria-hidden="true" />;
}