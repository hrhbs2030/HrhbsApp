import { createElement, useCallback, useEffect, useRef, useState, type CSSProperties, type ElementType, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Tracks the reduced-motion setting live, so turning it on mid-visit stops motion.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

// Adds `is-visible` to every `.reveal` inside the root once it scrolls into
// view. Without IntersectionObserver or with reduced motion everything is shown.
export function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.reveal'));
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      targets.forEach((t) => t.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    targets.forEach((t) => observer.observe(t));
    // Content is only hidden once the observer is in place, so nothing stays
    // invisible if scripts or IntersectionObserver fail.
    root.classList.add('reveal-ready');
    return () => { observer.disconnect(); root.classList.remove('reveal-ready'); };
  }, []);
  return ref;
}

// Returns the index of the chapter currently crossing the middle of the viewport.
export function useActiveChapter(count: number) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const index = refs.current.indexOf(entry.target as HTMLElement);
          if (index >= 0) setActive(index);
        }
      }
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    refs.current.slice(0, count).forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [count]);
  const register = (index: number) => (el: HTMLElement | null) => { refs.current[index] = el; };
  return { active, register };
}

// Session-safe storage: private windows and blocked storage must never break the page.
export const safeStorage = {
  get(key: string): string | null {
    try { return window.localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  },
};

// `[ref, inView]` for one element. `once` (default) stops observing after the
// first entry; without IntersectionObserver or with reduced motion it is true at once.
export function useInView<T extends HTMLElement = HTMLElement>(options: { rootMargin?: string; threshold?: number; once?: boolean } = {}): [RefObject<T | null>, boolean] {
  const { rootMargin = '0px 0px -10% 0px', threshold = 0.1, once = true } = options;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) { setInView(true); return; }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { setInView(true); if (once) observer.unobserve(entry.target); }
        else if (!once) setInView(false);
      }
    }, { rootMargin, threshold });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, threshold, once]);
  return [ref, inView];
}

// Press feedback for custom controls (cards, tiles, list rows): spread the
// returned props and style `[data-pressed="true"]`. Pointer and keyboard
// (Space/Enter) both count, so keyboard users get the same settle animation.
export function usePressable<T extends HTMLElement = HTMLElement>() {
  const [pressed, setPressed] = useState(false);
  const release = useCallback(() => setPressed(false), []);
  return {
    pressed,
    pressProps: {
      'data-pressed': pressed ? 'true' : undefined,
      onPointerDown: (event: ReactPointerEvent<T>) => { if (event.button === 0 || event.pointerType !== 'mouse') setPressed(true); },
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
      onKeyDown: (event: ReactKeyboardEvent<T>) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) setPressed(true); },
      onKeyUp: release,
      onBlur: release,
    },
  };
}

// Inline style for the nth item of a staggered list: `style={stagger(index)}`.
// Works with `.reveal` (transition) and `.rise`/`.page-enter` (animation).
export function stagger(index: number, step = 70, base = 0): CSSProperties {
  const delay = `${base + index * step}ms`;
  return { transitionDelay: delay, animationDelay: delay };
}

// Per-item delays for a whole list: `const delays = staggerList(items.length)`.
export function staggerList(count: number, step = 70, base = 0): CSSProperties[] {
  return Array.from({ length: count }, (_, index) => stagger(index, step, base));
}

// True once the window has scrolled past `threshold` px; used by sticky
// headers that gain a blurred background. Passive listener, rAF-coalesced.
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(() => typeof window !== 'undefined' && window.scrollY > threshold);
  useEffect(() => {
    let frame = 0;
    const read = () => { frame = 0; setScrolled(window.scrollY > threshold); };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, [threshold]);
  return scrolled;
}

export type RevealProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  // Delay in ms before the element rises (for staggering siblings by hand).
  delay?: number;
  // Only animate the first time it enters (default true).
  once?: boolean;
  children?: ReactNode;
};
// Rises into view when scrolled to: `<Reveal as="li" delay={index * 70}>…</Reveal>`.
// Self-contained (no parent `useRevealOnScroll` needed); reduced motion shows it at once.
export function Reveal({ as = 'div', delay = 0, once = true, className = '', style, children, ...rest }: RevealProps) {
  const [ref, inView] = useInView<HTMLElement>({ once });
  const reduced = useReducedMotion();
  const visible = inView || reduced;
  return createElement(as, {
    ref,
    className: `${className} reveal reveal-self${visible ? ' is-visible' : ''}`.trim(),
    style: delay ? { ...style, transitionDelay: `${delay}ms` } : style,
    ...rest,
  }, children);
}
