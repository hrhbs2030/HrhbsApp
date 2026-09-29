import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useReducedMotion } from '@/lib/motion';
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
const VB = '0 0 1600 700';

// Deterministic pseudo-random numbers so the skyline is identical on every render.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

type Block = { x: number; w: number; h: number; cap: number };
function blocks(seed: number, from: number, to: number, minH: number, maxH: number, minW: number, maxW: number, skip: [number, number][] = []): Block[] {
  const r = rng(seed); const out: Block[] = []; let x = from;
  while (x < to) {
    const w = minW + r() * (maxW - minW);
    if (!skip.some(([a, b]) => x + w > a && x < b)) out.push({ x, w, h: minH + r() * (maxH - minH), cap: r() });
    x += w + r() * 6;
  }
  return out;
}

function Skyline({ list, ground = 700, fill }: { list: Block[]; ground?: number; fill: string }) {
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
function Windows({ list, seed, ground = 700, density = .16 }: { list: Block[]; seed: number; ground?: number; density?: number }) {
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

function palm(x: number, ground: number, s = 1) {
  const top = ground - 120 * s; const lean = 10 * s;
  const trunk = `M${x - 3 * s} ${ground} Q${x + lean * .3} ${ground - 60 * s} ${x + lean} ${top} L${x + lean + 4 * s} ${top} Q${x + lean * .5 + 4 * s} ${ground - 60 * s} ${x + 4 * s} ${ground} Z`;
  const cx = x + lean + 2 * s; const f = (dx: number, dy: number) => `M${cx} ${top} Q${cx + dx * .5} ${top - 18 * s + dy * .2} ${cx + dx} ${top + dy}`;
  return { trunk, fronds: [f(-48 * s, 22 * s), f(-38 * s, 38 * s), f(-20 * s, 44 * s), f(46 * s, 20 * s), f(36 * s, 38 * s), f(18 * s, 46 * s), f(-4 * s, -6 * s)].join(' ') };
}
function Palm({ x, ground = 700, s = 1, fill }: { x: number; ground?: number; s?: number; fill: string }) {
  const p = palm(x, ground, s);
  return <g><path d={p.trunk} fill={fill} /><path d={p.fronds} fill="none" stroke={fill} strokeWidth={6 * s} strokeLinecap="round" /></g>;
}

function ridge(seed: number, base: number, amp: number, step = 40) {
  const r = rng(seed); let d = `M-20 700 L-20 ${base}`;
  for (let x = 0; x <= 1640; x += step) d += ` L${x} ${(base - r() * amp).toFixed(0)}`;
  return d + ' L1640 700 Z';
}

function Stars({ seed, count = 60 }: { seed: number; count?: number }) {
  const r = rng(seed);
  return <g fill="#f6efe3">{Array.from({ length: count }, (_, i) => {
    const tw = i % 5 === 0;
    return <circle key={i} cx={(r() * 1600).toFixed(0)} cy={(r() * 300).toFixed(0)} r={(r() * 1.3 + .4).toFixed(1)} opacity={(r() * .6 + .2).toFixed(2)} className={tw ? 'cs-twinkle' : undefined} style={tw ? { animationDelay: `${(i % 7) * .8}s` } : undefined} />;
  })}</g>;
}

function Layer({ depth, children }: { depth: 1 | 2 | 3 | 4; children: ReactNode }) {
  return <svg className={`cs-layer cs-layer--${depth}`} viewBox={VB} preserveAspectRatio="xMidYMax slice" aria-hidden="true">{children}</svg>;
}

/* Layout note: at desktop widths the viewBox columns 640–850 fall between the
   request card and the headline, and they are the part phones show, so each
   city's signature landmark stands there. Secondary landmarks sit near x≈330. */

const RIM = { fill: 'none', stroke: '#f0b28a', strokeOpacity: .55, strokeWidth: 1.6 } as const;

/* ---------------- Riyadh: Kingdom Centre, Al Faisaliah, KAFD, Najdi mud houses ---------------- */
const RiyadhScene = memo(function RiyadhScene() {
  const far = useMemo(() => blocks(11, -20, 1640, 40, 140, 26, 60), []);
  const mid = useMemo(() => blocks(23, -20, 1640, 70, 220, 30, 64, [[670, 810], [280, 380], [1110, 1300]]), []);
  return <>
    <Layer depth={1}>
      <defs>
        <linearGradient id="ry-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#071a1d" /><stop offset=".42" stopColor="#15454b" /><stop offset=".72" stopColor="#8c4b2d" /><stop offset="1" stopColor="#f2ad80" /></linearGradient>
        <radialGradient id="ry-glow" cx=".47" cy="1" r=".55"><stop offset="0" stopColor="#ffc9a3" stopOpacity=".7" /><stop offset="1" stopColor="#ffc9a3" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="700" fill="url(#ry-sky)" />
      <rect y="250" width="1600" height="450" fill="url(#ry-glow)" />
      <Stars seed={3} count={50} />
      <circle cx="560" cy="120" r="20" fill="#f6efe3" opacity=".9" /><circle cx="569" cy="114" r="18" fill="#0d2a2d" />
    </Layer>
    <Layer depth={2}><Skyline list={far} fill="#1d4146" /><Windows list={far} seed={5} density={.08} /></Layer>
    <Layer depth={3}>
      <Skyline list={mid} fill="#0b2326" />
      <Windows list={mid} seed={7} density={.2} />
      {/* Kingdom Centre: tapered tower, parabolic opening, sky bridge */}
      <path fillRule="evenodd" fill="#07191b" d="M684 700 C696 470 706 290 714 140 L766 140 C774 290 784 470 796 700 Z M723 140 Q740 390 757 140 Z" />
      <path {...RIM} d="M714 140 C706 290 696 470 684 700 M766 140 C774 290 784 470 796 700 M723 140 Q740 390 757 140" />
      <rect x="717" y="188" width="46" height="8" fill="#07191b" />
      <rect x="719" y="190" width="42" height="3" fill="#ffd2b0" className="cs-glow" />
      <g fill="#f3c79a" opacity=".65">{Array.from({ length: 16 }, (_, i) => <rect key={i} x={i % 2 ? 750 : 722} y={300 + i * 24} width="6" height="3" />)}</g>
      {/* Al Faisaliah: four-sided taper, golden globe, spire */}
      <path fill="#07191b" d="M294 700 L320 300 L330 200 L340 300 L366 700 Z" />
      <path {...RIM} d="M294 700 L320 300 L330 200 L340 300 L366 700" />
      <circle cx="330" cy="262" r="18" fill="#f0b28a" className="cs-glow" />
      <circle cx="330" cy="262" r="34" fill="#f0b28a" opacity=".15" />
      <rect x="329" y="136" width="2" height="66" fill="#07191b" />
      {/* KAFD cluster */}
      <path fill="#0a2225" d="M1130 700 L1136 250 L1176 220 L1180 700 Z M1196 700 L1196 320 L1228 300 L1236 330 L1236 700 Z M1250 700 L1256 360 L1284 344 L1290 700 Z" />
      <path d="M1136 250 L1176 220" stroke="#8fd0c6" strokeOpacity=".6" strokeWidth="2" />
    </Layer>
    <Layer depth={4}>
      {/* Najdi mud houses with crenellated parapets and triangle windows */}
      <g fill="#04100f">
        {[[-20, 150, 96], [120, 130, 74], [880, 120, 80], [1000, 150, 110], [1340, 140, 90], [1470, 170, 72]].map(([x, w, h], i) => {
          const top = 700 - h; let crest = '';
          for (let cx = x; cx < x + w - 4; cx += 14) crest += `M${cx} ${top} l7 -12 l7 12 Z`;
          return <g key={i}><rect x={x} y={top} width={w} height={h} /><path d={crest} /></g>;
        })}
      </g>
      <g fill="#ffcfa8" opacity=".7">{[[30, 646], [70, 646], [160, 660], [920, 660], [1040, 630], [1090, 630], [1380, 650], [1520, 666]].map(([x, y], i) => <path key={i} d={`M${x} ${y} l6 -10 l6 10 Z`} className={i % 3 === 0 ? 'cs-twinkle' : undefined} />)}</g>
      <Palm x={560} s={1.15} fill="#030c0c" /><Palm x={615} s={.85} fill="#030c0c" /><Palm x={1250} s={1} fill="#030c0c" />
    </Layer>
  </>;
});

/* ---------------- Jeddah: sea, King Fahd Fountain, Jeddah Tower, Al-Balad houses ---------------- */
const JeddahScene = memo(function JeddahScene() {
  const far = useMemo(() => blocks(41, 830, 1640, 50, 180, 24, 54), []);
  const west = useMemo(() => blocks(47, 440, 700, 30, 110, 22, 46), []);
  return <>
    <Layer depth={1}>
      <defs>
        <linearGradient id="jd-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0a1f24" /><stop offset=".4" stopColor="#35303e" /><stop offset=".68" stopColor="#c0643e" /><stop offset=".78" stopColor="#f6ba90" /></linearGradient>
        <linearGradient id="jd-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2d4f55" /><stop offset="1" stopColor="#061618" /></linearGradient>
        <radialGradient id="jd-sun" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#ffe3cc" /><stop offset=".6" stopColor="#ffc59d" /><stop offset="1" stopColor="#ffc59d" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="700" fill="url(#jd-sky)" />
      <circle cx="760" cy="512" r="150" fill="url(#jd-sun)" opacity=".55" />
      <circle cx="760" cy="512" r="70" fill="#ffd9bd" />
      <rect y="522" width="1600" height="178" fill="url(#jd-sea)" />
      <g className="cs-shimmer" fill="#ffc9a3">{Array.from({ length: 14 }, (_, i) => <rect key={i} x={700 - i * 4 + (i % 3) * 14} y={534 + i * 11} width={120 - i * 5} height="2.5" rx="1" opacity={.85 - i * .05} />)}</g>
    </Layer>
    <Layer depth={2}>
      <Skyline list={far} ground={524} fill="#1b2e35" />
      <Windows list={far} seed={43} ground={524} density={.12} />
      <Skyline list={west} ground={524} fill="#22343b" />
      {/* Jeddah Tower: tall three-winged taper, silhouetted against the sun */}
      <path fill="#101f25" d="M730 524 L754 150 L760 50 L766 150 L790 524 Z" />
      <path {...RIM} d="M760 50 L754 150 L730 524 M760 50 L766 150 L790 524" />
      <circle cx="760" cy="56" r="3" fill="#ff8f6b" className="cs-twinkle" />
    </Layer>
    <Layer depth={3}>
      {/* King Fahd Fountain rising from the sea */}
      <g className="cs-fountain">
        <path d="M326 532 C323 400 327 250 330 130 C333 250 337 400 334 532 Z" fill="#f6efe3" opacity=".9" />
        <path d="M330 130 C312 152 296 196 288 242 M330 130 C348 152 364 196 372 242 M330 170 C318 190 310 220 306 250 M330 170 C342 190 350 220 354 250" stroke="#f6efe3" strokeOpacity=".4" strokeWidth="3" fill="none" strokeLinecap="round" />
        <ellipse cx="330" cy="532" rx="46" ry="6" fill="#f6efe3" opacity=".4" />
      </g>
      <g className="cs-shimmer cs-shimmer--slow" fill="#9fd0c6" opacity=".4">{Array.from({ length: 12 }, (_, i) => <rect key={i} x={(i * 137) % 1500} y={562 + (i % 5) * 24} width="70" height="2" rx="1" />)}</g>
    </Layer>
    <Layer depth={4}>
      {/* Al-Balad coral-stone houses with wooden roshan bays */}
      <g fill="#061416">
        {[[880, 70, 170], [956, 62, 220], [1024, 84, 160], [1114, 66, 200], [1186, 80, 176], [1272, 90, 150]].map(([x, w, h], i) => <rect key={i} x={x} y={700 - h} width={w} height={h} />)}
      </g>
      <g fill="#4a2c1d" stroke="#e0a078" strokeOpacity=".6" strokeWidth="1">
        {[[892, 580], [966, 540], [966, 616], [1036, 600], [1124, 560], [1198, 590], [1286, 610]].map(([x, y], i) => <g key={i}><rect x={x} y={y} width="36" height="46" /><path d={`M${x + 9} ${y} v46 M${x + 18} ${y} v46 M${x + 27} ${y} v46 M${x} ${y + 15} h36 M${x} ${y + 30} h36`} /></g>)}
      </g>
      <g>{[90, 190, 290, 390, 490, 590, 690].map((x) => <g key={x}><rect x={x} y={612} width="3" height="88" fill="#051112" /><circle cx={x + 1.5} cy={610} r="4" fill="#ffd2b0" className="cs-glow" /><circle cx={x + 1.5} cy={610} r="12" fill="#ffd2b0" opacity=".15" /></g>)}</g>
      <rect y="690" width="1600" height="10" fill="#051112" />
    </Layer>
  </>;
});

/* ---------------- Jazan: Fayfa mountains and terraces, Dosariyah fort, Tihama huts, palms ---------------- */
const JazanScene = memo(function JazanScene() {
  return <>
    <Layer depth={1}>
      <defs>
        <linearGradient id="jz-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#06121b" /><stop offset=".55" stopColor="#173c46" /><stop offset=".85" stopColor="#4d7d77" /><stop offset="1" stopColor="#c99a78" /></linearGradient>
        <linearGradient id="jz-fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bfe3dc" stopOpacity="0" /><stop offset="1" stopColor="#bfe3dc" stopOpacity=".22" /></linearGradient>
      </defs>
      <rect width="1600" height="700" fill="url(#jz-sky)" />
      <Stars seed={9} count={110} />
      <circle cx="560" cy="130" r="26" fill="#f6efe3" opacity=".95" />
      <circle cx="560" cy="130" r="80" fill="#f6efe3" opacity=".07" />
    </Layer>
    <Layer depth={2}>
      <path d={ridge(17, 400, 200, 60)} fill="#1f4a50" />
      <rect y="300" width="1600" height="400" fill="url(#jz-fog)" />
    </Layer>
    <Layer depth={3}>
      <path d={ridge(29, 500, 150, 50)} fill="#0f2a2f" />
      {/* Terraces on the Fayfa slopes */}
      <g fill="none" stroke="#9fd0c6" strokeOpacity=".22" strokeWidth="2">{Array.from({ length: 9 }, (_, i) => <path key={i} d={`M${250 + i * 6} ${500 + i * 16} Q${440} ${470 + i * 18} ${620 - i * 8} ${508 + i * 16}`} />)}</g>
      {/* Dosariyah fort on its hill */}
      <g transform="translate(764 700) scale(1.55) translate(-764 -700)">
      <path d="M640 700 Q760 510 890 700 Z" fill="#0a2024" />
      <g fill="#0a2024">
        <rect x="712" y="520" width="104" height="62" /><rect x="700" y="494" width="26" height="88" /><rect x="802" y="494" width="26" height="88" />
        <path d="M700 494 l4 -8 l4 8 l4 -8 l4 8 l4 -8 l4 8 l2 0 Z M802 494 l4 -8 l4 8 l4 -8 l4 8 l4 -8 l4 8 l2 0 Z M712 520 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l6 -8 l6 8 l8 0 Z" />
      </g>
      <path {...RIM} d="M700 582 L700 494 L726 494 L726 520 L802 520 L802 494 L828 494 L828 582" />
      <rect x="756" y="548" width="16" height="34" fill="#ffd2b0" className="cs-glow" />
      <rect x="708" y="510" width="8" height="10" fill="#ffd2b0" opacity=".7" /><rect x="810" y="510" width="8" height="10" fill="#ffd2b0" opacity=".7" className="cs-twinkle" />
      </g>
    </Layer>
    <Layer depth={4}>
      {/* Tihama huts (al-ishash) with conical thatched roofs */}
      <g fill="#051213">
        {[[300, 1], [410, .8], [1000, 1.05], [1120, .85], [1260, 1]].map(([x, sc], i) => (
          <g key={i}><rect x={x - 30 * sc} y={700 - 60 * sc} width={60 * sc} height={60 * sc} /><path d={`M${x - 40 * sc} ${700 - 58 * sc} Q${x} ${700 - 150 * sc} ${x + 40 * sc} ${700 - 58 * sc} Z`} /></g>
        ))}
      </g>
      <g fill="#ffd2b0" opacity=".65">{[[300, 1], [1000, 1.05], [1260, 1]].map(([x, sc], i) => <rect key={i} x={x - 6 * sc} y={700 - 34 * sc} width={12 * sc} height={20 * sc} className="cs-glow" />)}</g>
      <Palm x={520} s={1.15} fill="#030c0c" /><Palm x={590} s={.9} fill="#030c0c" /><Palm x={900} s={1.05} fill="#030c0c" /><Palm x={1400} s={1.1} fill="#030c0c" />
    </Layer>
  </>;
});

const scenes: Record<CityKey, () => ReactNode> = { riyadh: () => <RiyadhScene />, jeddah: () => <JeddahScene />, jazan: () => <JazanScene /> };

export function CityScene({ routeKey, compact = false, showCaption = true }: { routeKey: string; compact?: boolean; showCaption?: boolean }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const firstRoute = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Advance like a video loop.
  useEffect(() => {
    if (reduced || paused) return;
    const timer = window.setTimeout(() => setIndex((i) => (i + 1) % cityOrder.length), SCENE_MS);
    return () => window.clearTimeout(timer);
  }, [index, reduced, paused]);

  // Page change: glide to the next city with the same crossfade.
  useEffect(() => {
    if (firstRoute.current) { firstRoute.current = false; return; }
    if (!reduced) setIndex((i) => (i + 1) % cityOrder.length);
  }, [routeKey, reduced]);

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
