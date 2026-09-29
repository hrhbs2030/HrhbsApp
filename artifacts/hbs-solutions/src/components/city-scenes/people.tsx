import { memo, type ReactNode } from 'react';
import './people.css';

// Residents of the city scenes: small figures in each region's traditional
// dress, standing in pairs and talking about their transactions, plus a few
// passers-by. Drawn in SVG in the foreground layer; moved with CSS
// transform/opacity only (see people.css). Decorative and aria-hidden like
// the rest of the scene.
//
// Dress, by region:
//   Najd (Riyadh)   white thobe, red shemagh with agal; an elder in a bisht
//   Hijaz (Jeddah)  thobe with sideri vest and ghabana turban; white ghutra
//   Jazan           shirt over a striped izar with a flower wreath (عصابة)
//                   or a straw hat; women in the tall straw hat (المظلة)
//   Everywhere      women in the abaya
//
// Local coordinates: feet at y=0, the figure about 66 units tall, facing the
// viewer. `flip` mirrors the figure so a pair can face each other.

export type Kind = 'najdi' | 'najdi-bisht' | 'abaya' | 'hijazi' | 'hijazi-ghabana' | 'janubi-wreath' | 'janubi-hat' | 'janubiya';
export type Pose = 'idle' | 'talk' | 'phone' | 'folder';

type Figure = { kind: Kind; pose?: Pose; x: number; g: number; s?: number; flip?: boolean };
type Line = { who: number; text: string; at: number };
type Walker = Figure & { dur: number; delay: number; dir: 1 | -1 };
export type Crowd = { pools: [number, number, number?][]; people: Figure[]; lines: Line[]; walkers?: Walker[] };

const SKIN = '#7a4f35';
const THOBE = '#d2c9b8';
const EDGE = '#f0b28a';

function Defs({ p }: { p: string }) {
  return (
    <defs>
      <linearGradient id={`${p}-thobe`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e4dccb" /><stop offset=".55" stopColor="#b3aa98" /><stop offset="1" stopColor="#6c6558" /></linearGradient>
      <linearGradient id={`${p}-white`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f3eee3" /><stop offset="1" stopColor="#a39b8c" /></linearGradient>
      <linearGradient id={`${p}-abaya`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2a2629" /><stop offset=".6" stopColor="#141214" /><stop offset="1" stopColor="#070607" /></linearGradient>
      <linearGradient id={`${p}-bisht`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a3020" /><stop offset="1" stopColor="#1a100a" /></linearGradient>
      <linearGradient id={`${p}-gold`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ecc066" /><stop offset="1" stopColor="#9a6a24" /></linearGradient>
      <linearGradient id={`${p}-straw`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e2bd78" /><stop offset="1" stopColor="#9b7440" /></linearGradient>
      {/* Red-and-white shemagh check */}
      <pattern id={`${p}-shemagh`} width="2.2" height="2.2" patternUnits="userSpaceOnUse">
        <rect width="2.2" height="2.2" fill="#b02a30" /><rect width="1.1" height="1.1" fill="#f3e6dc" opacity=".45" />
      </pattern>
      {/* Striped izar of the south */}
      <pattern id={`${p}-izar`} width="4" height="5" patternUnits="userSpaceOnUse">
        <rect width="4" height="5" fill="#2b5c5b" /><rect y="1.2" width="4" height="1" fill="#e5a27b" /><rect y="3.3" width="4" height=".5" fill="#b8453c" />
      </pattern>
      <radialGradient id={`${p}-pool`}><stop offset="0" stopColor="#ffc890" stopOpacity=".34" /><stop offset=".55" stopColor="#ffb070" stopOpacity=".1" /><stop offset="1" stopColor="#ffb070" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${p}-screen`}><stop offset="0" stopColor="#bfeee6" stopOpacity=".8" /><stop offset="1" stopColor="#8fd0c6" stopOpacity="0" /></radialGradient>
    </defs>
  );
}

// ---- parts -----------------------------------------------------------------

const face = <circle cx="0" cy="-55.4" r="5" fill={SKIN} />;
const sandals = <path d="M-5.6 -1.6h4v1.6h-4zM1.6 -1.6h4v1.6h-4z" fill="#1b120d" />;
const shadow = <ellipse cx="0" cy="0" rx="13" ry="2.2" fill="#000" opacity=".5" />;

function Arms({ pose, fill, p }: { pose: Pose; fill: string; p: string }) {
  const left = <g><path d="M-8.6 -45 Q-11.8 -36 -11.2 -26 L-8.8 -26 Q-9.3 -36 -7 -44Z" fill={fill} /><circle cx="-10" cy="-25" r="1.4" fill={SKIN} /></g>;
  if (pose === 'talk') return <>{left}<g className="pp-gesture"><path d="M8.4 -44.6 L11 -35 L15.6 -40.8" fill="none" stroke={THOBE} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="-41.4" r="1.5" fill={SKIN} /></g></>;
  if (pose === 'phone') return <>{left}
    <path d="M8.4 -44.6 L10.8 -35 L5.4 -38.6" fill="none" stroke={THOBE} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="2.4" y="-43" width="3.2" height="5" rx=".6" fill="#0b1a1c" /><rect x="2.9" y="-42.4" width="2.2" height="3.8" fill="#bfeee6" />
    <circle cx="3.6" cy="-47" r="10" fill={`url(#${p}-screen)`} className="cs-glow" /></>;
  if (pose === 'folder') return <>{left}
    <path d="M8.6 -45 Q11.4 -38 11 -31" fill="none" stroke={THOBE} strokeWidth="3" strokeLinecap="round" />
    <g className="pp-folder"><rect x="8.2" y="-33" width="7.4" height="9.6" rx=".8" fill="#f6efe3" /><path d="M8.2 -30.4h7.4" stroke="#e5a27b" strokeWidth="1" /><path d="M9.6 -27.8h4.6M9.6 -26h3.4" stroke="#8a9a96" strokeWidth=".5" /></g></>;
  return <>{left}<g transform="scale(-1 1)">{left}</g></>;
}

function Headgear({ kind, p }: { kind: Kind; p: string }) {
  switch (kind) {
    case 'najdi': case 'najdi-bisht':
      return <g>
        <path d="M-6.2 -57.4 Q-6.6 -62.6 0 -63.3 Q6.6 -62.6 6.2 -57.4 L8.7 -45.6 Q8.9 -44 7 -44.3 L4.8 -50.2 Q0 -48.8 -4.8 -50.2 L-7 -44.3 Q-8.9 -44 -8.7 -45.6Z" fill={`url(#${p}-shemagh)`} />
        <path d="M-1.6 -62.9 L0 -64.8 L1.6 -62.9Z" fill="#b02a30" />
        <ellipse cx="0" cy="-60.5" rx="6.2" ry="1.4" fill="none" stroke="#0b0b0b" strokeWidth="1.25" />
        <ellipse cx="0" cy="-59.2" rx="6.3" ry="1.3" fill="none" stroke="#0b0b0b" strokeWidth="1.05" />
      </g>;
    case 'hijazi':
      return <g>
        <path d="M-6.2 -57.4 Q-6.6 -62.6 0 -63.2 Q6.6 -62.6 6.2 -57.4 L8.9 -44.6 Q9 -43 7 -43.4 L4.8 -50.2 Q0 -48.8 -4.8 -50.2 L-7 -43.4 Q-9 -43 -8.9 -44.6Z" fill={`url(#${p}-white)`} />
        <path d="M-1.4 -62.8 L0 -64.4 L1.4 -62.8Z" fill="#ece6da" />
      </g>;
    case 'hijazi-ghabana':
      return <g>
        <path d="M5.4 -58.4 Q10.4 -55.4 9.4 -47.6 L7.8 -47.6 Q8.4 -53.6 4.6 -56.8Z" fill={`url(#${p}-gold)`} />
        <path d="M-6.8 -56.2 Q-8.2 -65.8 0 -66.3 Q8.2 -65.8 6.8 -56.2 Q0 -58.8 -6.8 -56.2Z" fill={`url(#${p}-gold)`} />
        <path d="M-6.2 -60.2 Q0 -63.6 6.2 -60.2 M-6.7 -57.8 Q0 -61.2 6.7 -57.8 M-4.8 -63.4 Q0 -65.2 4.8 -63.4" fill="none" stroke="#6e4212" strokeWidth=".7" opacity=".7" />
      </g>;
    case 'janubi-wreath':
      return <g>
        <path d="M-5.4 -56.6 Q-6 -61.9 0 -62.2 Q6 -61.9 5.4 -56.6 Q0 -59.2 -5.4 -56.6Z" fill="#1a1210" />
        <ellipse cx="0" cy="-59.6" rx="6.4" ry="1.9" fill="none" stroke="#3f7a3a" strokeWidth="2.2" />
        {[[-5, -58.8, '#f2d25c'], [-2.6, -58, '#f6efe3'], [0, -57.8, '#e56b5d'], [2.6, -58, '#f2d25c'], [5, -58.8, '#f6efe3'], [-3.8, -61, '#e56b5d'], [3.8, -61, '#f2d25c']].map(([x, y, c], i) => <circle key={i} cx={x} cy={y} r=".95" fill={c as string} />)}
      </g>;
    case 'janubi-hat':
      return <g>
        <path d="M-5.4 -56.6 Q-6 -60 0 -60.3 Q6 -60 5.4 -56.6Z" fill="#1a1210" />
        <ellipse cx="0" cy="-59.2" rx="12" ry="2.4" fill="#b88c4c" />
        <path d="M-5.6 -59.4 L0 -68.4 L5.6 -59.4Z" fill={`url(#${p}-straw)`} />
        <path d="M-5.6 -60.6 Q0 -62.2 5.6 -60.6" stroke="#5a3a1c" strokeWidth=".9" fill="none" />
      </g>;
    case 'janubiya':
      return <g>
        <path d="M-6 -53.6 Q-6.6 -62 0 -62.4 Q6.6 -62 6 -53.6 L7.6 -45.6 Q0 -47.2 -7.6 -45.6Z" fill="#121012" />
        <ellipse cx="0" cy="-55" rx="3.3" ry="4" fill={SKIN} />
        <ellipse cx="0" cy="-61" rx="13.4" ry="2.6" fill="#b88c4c" />
        <path d="M-6.2 -61.2 L0 -74 L6.2 -61.2Z" fill={`url(#${p}-straw)`} />
        <path d="M-4.6 -64.6 L4.6 -64.6 M-3 -68.2 L3 -68.2" stroke="#7a5528" strokeWidth=".6" />
      </g>;
    case 'abaya':
      return <g>
        <path d="M-6 -53.6 Q-6.6 -62.4 0 -62.8 Q6.6 -62.4 6 -53.6 L7.6 -45.6 Q0 -47.2 -7.6 -45.6Z" fill="#121012" />
        <ellipse cx="0" cy="-55" rx="3.3" ry="4" fill={SKIN} />
      </g>;
  }
}

function Body({ kind, pose, p }: { kind: Kind; pose: Pose; p: string }) {
  const thobe = <path d="M-7.8 -47 Q-9.6 -46 -10 -43 L-11.2 -2 Q0 .4 11.2 -2 L10 -43 Q9.6 -46 7.8 -47 Q0 -49 -7.8 -47Z" fill={`url(#${p}-thobe)`} />;
  const rim = (d: string) => <path d={d} fill="none" stroke={EDGE} strokeOpacity=".42" strokeWidth=".8" />;
  switch (kind) {
    case 'najdi': case 'hijazi':
      return <>{thobe}<path d="M0 -47V-37" stroke="#8f8676" strokeWidth=".6" />{rim('M10 -43 L11.2 -2')}<Arms pose={pose} fill={`url(#${p}-thobe)`} p={p} /></>;
    case 'najdi-bisht':
      return <>{thobe}
        <Arms pose="idle" fill={`url(#${p}-thobe)`} p={p} />
        <path d="M-7.8 -47.4 Q-12.6 -44.6 -13.6 -38 L-15 -4 Q-9.4 -3 -4.2 -3.6 L-2.4 -44.4Z M7.8 -47.4 Q12.6 -44.6 13.6 -38 L15 -4 Q9.4 -3 4.2 -3.6 L2.4 -44.4Z" fill={`url(#${p}-bisht)`} />
        <path d="M-2.4 -44.4 L-4.2 -3.6 M2.4 -44.4 L4.2 -3.6 M-7.8 -47.4 Q0 -45.4 7.8 -47.4" fill="none" stroke="#d9a64a" strokeWidth=".9" />
        {rim('M13.6 -38 L15 -4')}</>;
    case 'hijazi-ghabana':
      return <>{thobe}
        <Arms pose={pose} fill={`url(#${p}-thobe)`} p={p} />
        <path d="M-7.8 -47 Q-9.4 -44 -9.4 -40 L-9.6 -27 L-1.4 -27 L-1 -46Z M7.8 -47 Q9.4 -44 9.4 -40 L9.6 -27 L1.4 -27 L1 -46Z" fill="#1d4d4f" />
        <path d="M-1 -46 L-1.4 -27 M1 -46 L1.4 -27 M-9.6 -27 H-1.4 M1.4 -27 H9.6" fill="none" stroke="#d9a64a" strokeWidth=".7" />
        {rim('M10 -43 L11.2 -2')}</>;
    case 'janubi-wreath': case 'janubi-hat':
      return <>
        <path d="M-6 -8.4 L-6.4 -1 L-3 -1 L-2.8 -8.4Z M6 -8.4 L6.4 -1 L3 -1 L2.8 -8.4Z" fill="#5c3a26" />
        <path d="M-7.6 -47 Q-9.6 -45.5 -9.9 -42 L-10.3 -25 Q0 -23.6 10.3 -25 L9.9 -42 Q9.6 -45.5 7.6 -47 Q0 -49 -7.6 -47Z" fill={`url(#${p}-white)`} />
        <path d="M-10.4 -26.4 L-11 -8 Q0 -6.6 11 -8 L10.4 -26.4 Q0 -24.8 -10.4 -26.4Z" fill={`url(#${p}-izar)`} />
        <rect x="-10.5" y="-27.6" width="21" height="2.2" rx=".6" fill="#4d3120" />
        <path d="M-7 -26.5h.01M-3.5 -26.5h.01M0 -26.5h.01M3.5 -26.5h.01M7 -26.5h.01" stroke="#d8d2c2" strokeWidth="1" strokeLinecap="round" />
        <Arms pose={pose} fill={`url(#${p}-white)`} p={p} />
        {rim('M10.4 -26.4 L11 -8')}</>;
    case 'janubiya':
      return <>
        <path d="M-7.4 -47 Q-10 -45 -10.4 -40 L-12.2 -1.6 Q0 .4 12.2 -1.6 L10.4 -40 Q10 -45 7.4 -47Z" fill={`url(#${p}-abaya)`} />
        <path d="M-3.8 -46.4 L3.8 -46.4 L3.2 -33 L-3.2 -33Z" fill="#a8403a" />
        <path d="M-2.4 -44 h4.8 M-2.2 -40.6 h4.4 M-2 -37.2 h4" stroke="#e5a27b" strokeWidth=".8" strokeDasharray=".9 .9" />
        <path d="M-12 -5 Q0 -3.2 12 -5" stroke="#c9763f" strokeWidth="1.4" fill="none" />
        <Arms pose={pose} fill="#171417" p={p} />
        {rim('M10.4 -40 L12.2 -1.6')}</>;
    case 'abaya':
      return <>
        <path d="M-7.4 -47 Q-10 -45 -10.4 -40 L-12.6 -1.5 Q0 .6 12.6 -1.5 L10.4 -40 Q10 -45 7.4 -47Z" fill={`url(#${p}-abaya)`} />
        <path d="M0 -46 V-2" stroke="#2c282b" strokeWidth=".6" />
        <Arms pose={pose} fill="#161316" p={p} />
        {rim('M10.4 -40 L12.6 -1.5')}</>;
  }
}

const Person = memo(function Person({ kind, pose = 'idle', x, g, s = 1, flip, p, className }: Figure & { p: string; className?: string }) {
  const kids: ReactNode = <>
    {shadow}{sandals}
    <Body kind={kind} pose={pose} p={p} />
    {(kind !== 'abaya' && kind !== 'janubiya') && face}
    <g className={pose === 'talk' ? 'pp-nod' : undefined}>
      <Headgear kind={kind} p={p} />
      {(kind === 'najdi' || kind === 'najdi-bisht' || kind === 'hijazi') && <>
        <ellipse cx="0" cy="-54.4" rx="3.7" ry="4.6" fill={SKIN} />
        <path d="M-3.5 -52.4 Q0 -47.6 3.5 -52.4 Q3.2 -49.2 0 -48.4 Q-3.2 -49.2 -3.5 -52.4Z" fill="#1b120e" />
      </>}
    </g>
  </>;
  return <g className={className} transform={`translate(${x} ${g}) scale(${flip ? -s : s} ${s})`}>{kids}</g>;
});

// A speech bubble above a speaker. `at` is its start time (seconds) inside
// the 12 s city cycle; people.css shows it for about 2.6 s.
function Say({ x, y, text, at, tail }: { x: number; y: number; text: string; at: number; tail: 'left' | 'right' }) {
  const w = Math.round(text.length * 6.3 + 22);
  const h = 24;
  const tx = tail === 'right' ? x + w / 2 - 16 : x - w / 2 + 16;
  return (
    <g className="pp-say" style={{ animationDelay: `${at}s` }}>
      <rect x={x - w / 2} y={y - h} width={w} height={h} rx="11" fill="#f6efe3" />
      <path d={`M${tx - 5} ${y - 1} L${tx} ${y + 6} L${tx + 5} ${y - 1}Z`} fill="#f6efe3" />
      <text x={x} y={y - 7.6} textAnchor="middle" direction="rtl" className="pp-text">{text}</text>
    </g>
  );
}

export const Residents = memo(function Residents({ id, crowd }: { id: string; crowd: Crowd }) {
  return (
    <g className="pp">
      <Defs p={id} />
      {crowd.pools.map(([x, g, rx = 90], i) => <ellipse key={i} cx={x} cy={g} rx={rx} ry="12" fill={`url(#${id}-pool)`} />)}
      {crowd.walkers?.map((w, i) => (
        <g key={`w${i}`} className={w.dir > 0 ? 'pp-walk pp-walk--r' : 'pp-walk'} style={{ animationDuration: `${w.dur}s`, animationDelay: `${-w.delay}s` }}>
          <g className="pp-bob"><Person {...w} x={w.dir > 0 ? -80 : 1680} flip={w.dir < 0} p={id} /></g>
        </g>
      ))}
      {crowd.people.map((f, i) => <Person key={i} {...f} p={id} />)}
      <g className="pp-lines">{crowd.lines.map((l, i) => {
        // The bubble leans away from the partner, its tail over the speaker's head.
        const f = crowd.people[l.who]; const s = f.s ?? 1;
        const w = Math.round(l.text.length * 6.3 + 22);
        const tail = f.flip ? 'left' : 'right';
        const x = f.flip ? f.x + w / 2 - 20 : f.x - w / 2 + 20;
        return <Say key={i} x={x} y={f.g - 72 * s - 4} text={l.text} at={l.at} tail={tail} />;
      })}</g>
    </g>
  );
});

// ---- per-city casts ----------------------------------------------------------
// Groups stand at x≈430–510 (below the request card) and x≈740–800 (in front of
// the landmark column, clear of the darker text-side veil). Bubbles rise from
// their speaker's head and stay below the hero's text and search field.

export const riyadhCrowd: Crowd = {
  pools: [[470, 692], [770, 694], [1300, 696, 60]],
  people: [
    { kind: 'najdi', pose: 'phone', x: 436, g: 692, s: 1.22 },
    { kind: 'najdi-bisht', pose: 'idle', x: 500, g: 693, s: 1.28, flip: true },
    { kind: 'abaya', pose: 'folder', x: 742, g: 694, s: 1.16 },
    { kind: 'abaya', pose: 'talk', x: 800, g: 695, s: 1.12, flip: true },
  ],
  lines: [
    { who: 0, text: 'وش صار على تجديد الإقامة؟', at: .6 },
    { who: 1, text: 'قيد المراجعة، أتابعه من جوالي', at: 3.2 },
    { who: 2, text: 'المكتب طلب معلومة إضافية', at: 6.2 },
    { who: 3, text: 'ردّي عليهم من صفحة الطلب', at: 8.8 },
  ],
  walkers: [
    { kind: 'najdi', pose: 'folder', x: 0, g: 697, s: 1.08, dur: 70, delay: 20, dir: -1 },
    { kind: 'abaya', pose: 'idle', x: 0, g: 698, s: 1.04, dur: 84, delay: 55, dir: 1 },
  ],
};

export const jeddahCrowd: Crowd = {
  pools: [[468, 690], [770, 694], [720, 690, 60]],
  people: [
    { kind: 'hijazi-ghabana', pose: 'talk', x: 438, g: 690, s: 1.24 },
    { kind: 'hijazi', pose: 'idle', x: 500, g: 691, s: 1.2, flip: true },
    { kind: 'abaya', pose: 'phone', x: 742, g: 694, s: 1.14 },
    { kind: 'hijazi', pose: 'talk', x: 800, g: 695, s: 1.22, flip: true },
  ],
  lines: [
    { who: 0, text: 'إيش صار على نقل الخدمات؟', at: .6 },
    { who: 1, text: 'اكتمل، وصلني التحديث', at: 3.2 },
    { who: 2, text: 'سألت «أم مشعل» عن الخطوات', at: 6.2 },
    { who: 3, text: 'والمكتب يكمّل الباقي', at: 8.8 },
  ],
  walkers: [
    { kind: 'hijazi-ghabana', pose: 'idle', x: 0, g: 692, s: 1.06, dur: 76, delay: 30, dir: 1 },
  ],
};

export const jazanCrowd: Crowd = {
  pools: [[478, 694], [770, 694]],
  people: [
    { kind: 'janubi-wreath', pose: 'talk', x: 446, g: 694, s: 1.24 },
    { kind: 'janubi-hat', pose: 'idle', x: 510, g: 695, s: 1.2, flip: true },
    { kind: 'janubiya', pose: 'folder', x: 742, g: 694, s: 1.14 },
    { kind: 'abaya', pose: 'talk', x: 800, g: 695, s: 1.1, flip: true },
  ],
  lines: [
    { who: 0, text: 'جدّدت رخصة العمل؟', at: .6 },
    { who: 1, text: 'رفعت الطلب وأتابع حالته', at: 3.2 },
    { who: 2, text: 'وصلني رقم مرجعي للطلب', at: 6.2 },
    { who: 3, text: 'كذا تعرفين وين وصل', at: 8.8 },
  ],
  walkers: [
    { kind: 'janubi-hat', pose: 'idle', x: 0, g: 698, s: 1.06, dur: 80, delay: 10, dir: -1 },
  ],
};
