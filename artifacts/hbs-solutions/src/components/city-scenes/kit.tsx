import type { CSSProperties, ReactNode } from 'react';

// Shared drawing kit for the city scenes. Every scene is four stacked SVG
// layers (depth 1 = sky, 4 = foreground) on a 1600×700 viewBox anchored to the
// bottom edge; CityScene drifts the layers at different speeds for parallax.
// Animation hooks available to scenes (defined in city-scene.css):
//   .cs-twinkle  lights blinking   .cs-glow  slow light breathing
//   .cs-shimmer  water glints      .cs-fountain  fountain plume
// Scenes may add their own classes in their own CSS file (transform/opacity only).

export const VB = '0 0 1600 700';

// Deterministic pseudo-random numbers so the skyline is identical on every render.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export type Block = { x: number; w: number; h: number; cap: number };
export function blocks(seed: number, from: number, to: number, minH: number, maxH: number, minW: number, maxW: number, skip: [number, number][] = []): Block[] {
  const r = rng(seed); const out: Block[] = []; let x = from;
  while (x < to) {
    const w = minW + r() * (maxW - minW);
    if (!skip.some(([a, b]) => x + w > a && x < b)) out.push({ x, w, h: minH + r() * (maxH - minH), cap: r() });
    x += w + r() * 6;
  }
  return out;
}

export function Skyline({ list, ground = 700, fill }: { list: Block[]; ground?: number; fill: string }) {
  return <g fill={fill}>{list.map((b, i) => {
    const top = ground - b.h;
    return <g key={i}>
      <rect x={b.x} y={top} width={b.w} height={b.h} />
      {b.cap > .82 && <rect x={b.x + b.w / 2 - 1} y={top - 22} width={2} height={22} />}
      {b.cap > .6 && b.cap <= .82 && <rect x={b.x + b.w * .2} y={top - 10} width={b.w * .6} height={10} />}
    </g>;
  })}</g>;
}

// Lit windows on a set of blocks. A few twinkle, with staggered delays.
export function Windows({ list, seed, ground = 700, density = .16 }: { list: Block[]; seed: number; ground?: number; density?: number }) {
  const r = rng(seed); const cells: ReactNode[] = [];
  list.forEach((b, bi) => {
    for (let y = ground - b.h + 10; y < ground - 14; y += 14) {
      for (let x = b.x + 5; x < b.x + b.w - 7; x += 10) {
        if (r() > density) continue;
        const tw = r() < .12;
        cells.push(<rect key={`${bi}-${x}-${y}`} x={x} y={y} width={4} height={6} className={tw ? 'cs-twinkle' : undefined} style={tw ? { animationDelay: `${(r() * 6).toFixed(2)}s` } : undefined} />);
      }
    }
  });
  return <g className="cs-windows">{cells}</g>;
}

export function palm(x: number, ground: number, s = 1) {
  const top = ground - 120 * s; const lean = 10 * s;
  const trunk = `M${x - 3 * s} ${ground} Q${x + lean * .3} ${ground - 60 * s} ${x + lean} ${top} L${x + lean + 4 * s} ${top} Q${x + lean * .5 + 4 * s} ${ground - 60 * s} ${x + 4 * s} ${ground} Z`;
  const cx = x + lean + 2 * s; const f = (dx: number, dy: number) => `M${cx} ${top} Q${cx + dx * .5} ${top - 18 * s + dy * .2} ${cx + dx} ${top + dy}`;
  return { trunk, fronds: [f(-48 * s, 22 * s), f(-38 * s, 38 * s), f(-20 * s, 44 * s), f(46 * s, 20 * s), f(36 * s, 38 * s), f(18 * s, 46 * s), f(-4 * s, -6 * s)].join(' ') };
}
export function Palm({ x, ground = 700, s = 1, fill }: { x: number; ground?: number; s?: number; fill: string }) {
  const p = palm(x, ground, s);
  return <g><path d={p.trunk} fill={fill} /><path d={p.fronds} fill="none" stroke={fill} strokeWidth={6 * s} strokeLinecap="round" /></g>;
}

export function ridge(seed: number, base: number, amp: number, step = 40) {
  const r = rng(seed); let d = `M-20 700 L-20 ${base}`;
  for (let x = 0; x <= 1640; x += step) d += ` L${x} ${(base - r() * amp).toFixed(0)}`;
  return d + ' L1640 700 Z';
}

export function Stars({ seed, count = 60 }: { seed: number; count?: number }) {
  const r = rng(seed);
  return <g fill="#f6efe3">{Array.from({ length: count }, (_, i) => {
    const tw = i % 5 === 0;
    return <circle key={i} cx={(r() * 1600).toFixed(0)} cy={(r() * 300).toFixed(0)} r={(r() * 1.3 + .4).toFixed(1)} opacity={(r() * .6 + .2).toFixed(2)} className={tw ? 'cs-twinkle' : undefined} style={tw ? { animationDelay: `${(i % 7) * .8}s` } : undefined} />;
  })}</g>;
}

// `after` is HTML drawn over the layer's SVG and moved with it (the residents'
// speech bubbles, people.tsx <Dialogue/>): the layer becomes a div carrying the
// drift animation, with the SVG and the HTML as its two children, so one
// animation moves both and the bubbles stay on their speakers.
// `strip` is HTML that must not drift (the phone subtitle strip along the
// scene's lower edge): it is a sibling of the layer, inside the scene box.
export function Layer({ depth, children, after, strip }: { depth: 1 | 2 | 3 | 4; children: ReactNode; after?: ReactNode; strip?: ReactNode }) {
  if (!after) return <svg className={`cs-layer cs-layer--${depth}`} viewBox={VB} preserveAspectRatio="xMidYMax slice" aria-hidden="true">{children}</svg>;
  return <>
    <div className={`cs-layer cs-layer--${depth} cs-layer--stage`} aria-hidden="true">
      <svg className="cs-layer-svg" viewBox={VB} preserveAspectRatio="xMidYMax slice">{children}</svg>
      {after}
    </div>
    {strip}
  </>;
}

// Atmosphere between the distant and the near layers: a horizon haze that
// breathes (depth of field: the far city softens into the sky) and a wide,
// slow band of day-light that sweeps across the frame. Two plain gradient
// elements animated on transform/opacity only (city-scene.css), so they stay
// on the compositor at 60 fps; `tint` is the city's own air colour.
export function Atmosphere({ tint, light = '#ffe2b8', height = 46 }: { tint: string; light?: string; height?: number }) {
  return <>
    <div className="cs-haze" style={{ '--haze': tint, '--haze-h': `${height}%` } as CSSProperties} />
    <div className="cs-light" style={{ '--light': light } as CSSProperties} />
  </>;
}

/* Layout note: at desktop widths the viewBox columns 640–850 fall between the
   request card and the headline, and they are the part phones show, so each
   city's signature landmark stands there. Secondary landmarks sit near x≈330. */

export const RIM = { fill: 'none', stroke: '#f0b28a', strokeOpacity: .55, strokeWidth: 1.6 } as const;

