import { memo, type ReactNode } from 'react';
import './people.css';

// Decorative SVG residents in each city's foreground. Coordinates use the
// scene's 1600 × 700 viewBox; each person's feet are at their given y.
export type Kind = 'najdi' | 'najdi-bisht' | 'abaya' | 'hijazi' | 'hijazi-ghabana' | 'janubi-wreath' | 'janubi-hat' | 'janubiya';
export type Pose = 'idle' | 'talk' | 'phone' | 'folder';

export type Figure = { kind: Kind; pose?: Pose; x: number; g: number; s?: number; flip?: boolean };
type Line = { who: number; text: string; at: number };
type Walker = Figure & { dur: number; delay: number; dir: 1 | -1 };
export type Crowd = { pools: [number, number, number?][]; people: Figure[]; lines: Line[]; walkers?: Walker[]; office?: { x: number; g: number; s?: number } };

const SKIN = '#7a4f35';
const THOBE = '#d2c9b8';
const EDGE = '#f0b28a';

export function Defs({ p }: { p: string }) {
  return (
    <defs>
      <linearGradient id={`${p}-thobe`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e4dccb" /><stop offset=".55" stopColor="#b3aa98" /><stop offset="1" stopColor="#6c6558" /></linearGradient>
      <linearGradient id={`${p}-white`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f3eee3" /><stop offset="1" stopColor="#a39b8c" /></linearGradient>
      <linearGradient id={`${p}-abaya`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2a2629" /><stop offset=".6" stopColor="#141214" /><stop offset="1" stopColor="#070607" /></linearGradient>
      <linearGradient id={`${p}-bisht`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a3020" /><stop offset="1" stopColor="#1a100a" /></linearGradient>
      <linearGradient id={`${p}-gold`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ecc066" /><stop offset="1" stopColor="#9a6a24" /></linearGradient>
      <linearGradient id={`${p}-straw`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e2bd78" /><stop offset="1" stopColor="#9b7440" /></linearGradient>
      <pattern id={`${p}-shemagh`} width="2.2" height="2.2" patternUnits="userSpaceOnUse">
        <rect width="2.2" height="2.2" fill="#b02a30" /><rect width="1.1" height="1.1" fill="#f3e6dc" opacity=".45" />
      </pattern>
      <pattern id={`${p}-izar`} width="4" height="5" patternUnits="userSpaceOnUse">
        <rect width="4" height="5" fill="#2b5c5b" /><rect y="1.2" width="4" height="1" fill="#e5a27b" /><rect y="3.3" width="4" height=".5" fill="#b8453c" />
      </pattern>
      <radialGradient id={`${p}-pool`}><stop offset="0" stopColor="#ffc890" stopOpacity=".34" /><stop offset=".55" stopColor="#ffb070" stopOpacity=".1" /><stop offset="1" stopColor="#ffb070" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${p}-skin`} cx=".38" cy=".32" r=".8"><stop offset="0" stopColor="#a8714c" /><stop offset=".65" stopColor="#7a4f35" /><stop offset="1" stopColor="#58382a" /></radialGradient>
      {/* Garment volume: darker at the sides, a soft highlight toward the light. */}
      <linearGradient id={`${p}-volume`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#000" stopOpacity=".34" /><stop offset=".3" stopColor="#000" stopOpacity="0" /><stop offset=".62" stopColor="#fff" stopOpacity=".1" /><stop offset=".86" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".26" /></linearGradient>
      <linearGradient id={`${p}-sheen`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".09" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
      <linearGradient id={`${p}-stone`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#1b2124" /><stop offset=".7" stopColor="#2b3235" /><stop offset="1" stopColor="#3a3431" /></linearGradient>
      <linearGradient id={`${p}-shop`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe1b4" /><stop offset=".7" stopColor="#f2b27a" /><stop offset="1" stopColor="#c47a4a" /></linearGradient>
      <linearGradient id={`${p}-door`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bfeee6" stopOpacity=".75" /><stop offset="1" stopColor="#5b9c95" stopOpacity=".55" /></linearGradient>
      <radialGradient id={`${p}-signglow`}><stop offset="0" stopColor="#e5a27b" stopOpacity=".28" /><stop offset="1" stopColor="#e5a27b" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${p}-screen`}><stop offset="0" stopColor="#bfeee6" stopOpacity=".8" /><stop offset="1" stopColor="#8fd0c6" stopOpacity="0" /></radialGradient>
    </defs>
  );
}

const face = <circle cx="0" cy="-55.4" r="5" fill={SKIN} />;
// Eyes, brows and mouth, drawn over any face (the face shape comes from the
// headgear or the head circle). `pp-blink` closes the eyes briefly.
function Features({ p, beard }: { p: string; beard?: boolean }) {
  return <g>
    <ellipse cx="0" cy="-54.6" rx="3.7" ry="4.6" fill={`url(#${p}-skin)`} />
    <g className="pp-blink"><ellipse cx="-1.45" cy="-55.6" rx=".52" ry=".62" fill="#1a0f0a" /><ellipse cx="1.45" cy="-55.6" rx=".52" ry=".62" fill="#1a0f0a" /></g>
    <path d="M-2.3 -57 Q-1.45 -57.5 -.6 -57.1 M.6 -57.1 Q1.45 -57.5 2.3 -57" stroke="#20130d" strokeWidth=".45" fill="none" strokeLinecap="round" />
    <path d="M0 -55.2 L-.35 -53.6 L.3 -53.5" stroke="#5a3727" strokeWidth=".35" fill="none" />
    {beard
      ? <path d="M-3.5 -52.8 Q-3.2 -49.3 0 -48.3 Q3.2 -49.3 3.5 -52.8 Q2.2 -51.6 1.4 -52.4 Q0 -51.6 -1.4 -52.4 Q-2.2 -51.6 -3.5 -52.8Z M-1.9 -52.7 Q0 -53.5 1.9 -52.7" fill="#1b120e" stroke="#1b120e" strokeWidth=".35" />
      : <path d="M-.9 -52.3 Q0 -51.8 .9 -52.3" stroke="#5a3222" strokeWidth=".4" fill="none" strokeLinecap="round" />}
  </g>;
}
const sandals = <path d="M-5.6 -1.6h4v1.6h-4zM1.6 -1.6h4v1.6h-4z" fill="#1b120d" />;
const shadow = <ellipse cx="0" cy="0" rx="13" ry="2.2" fill="#000" opacity=".5" />;

function Arms({ pose, fill, p }: { pose: Pose; fill: string; p: string }) {
  const left = <g><path d="M-8.6 -45 Q-11.8 -36 -11.2 -26 L-8.8 -26 Q-9.3 -36 -7 -44Z" fill={fill} /><circle cx="-10" cy="-25" r="1.6" fill={`url(#${p}-skin)`} /></g>;
  if (pose === 'talk') return <>{left}<g className="pp-gesture"><path d="M8.4 -44.6 L11 -35 L15.6 -40.8" fill="none" stroke={THOBE} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="-41.4" r="1.7" fill={`url(#${p}-skin)`} /></g></>;
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
        <path d="M-5.6 -56.4 Q-6.6 -51 -7.6 -46 M5.6 -56.4 Q6.6 -51 7.6 -46 M-4 -61.8 Q0 -62.6 4 -61.8" stroke="#6e1418" strokeWidth=".55" fill="none" opacity=".75" />
        <ellipse cx="0" cy="-60.5" rx="6.2" ry="1.4" fill="none" stroke="#0b0b0b" strokeWidth="1.25" />
        <ellipse cx="0" cy="-59.2" rx="6.3" ry="1.3" fill="none" stroke="#0b0b0b" strokeWidth="1.05" />
      </g>;
    case 'hijazi':
      return <g>
        <path d="M-6.2 -57.4 Q-6.6 -62.6 0 -63.2 Q6.6 -62.6 6.2 -57.4 L8.9 -44.6 Q9 -43 7 -43.4 L4.8 -50.2 Q0 -48.8 -4.8 -50.2 L-7 -43.4 Q-9 -43 -8.9 -44.6Z" fill={`url(#${p}-white)`} />
        <path d="M-1.4 -62.8 L0 -64.4 L1.4 -62.8Z" fill="#ece6da" />
        <path d="M-5.6 -56.4 Q-6.8 -50.5 -7.8 -45 M5.6 -56.4 Q6.8 -50.5 7.8 -45" stroke="#9c9484" strokeWidth=".55" fill="none" opacity=".8" />
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
  const thobeShape = "M-7.8 -47 Q-9.6 -46 -10 -43 L-11.2 -2 Q0 .4 11.2 -2 L10 -43 Q9.6 -46 7.8 -47 Q0 -49 -7.8 -47Z";
  const thobe = <g className="pp-breathe">
    <path d={thobeShape} fill={`url(#${p}-thobe)`} />
    <path d={thobeShape} fill={`url(#${p}-volume)`} />
    <path d="M-4.5 -30 Q-5.4 -16 -6.2 -3 M4.2 -26 Q5 -14 5.8 -3" stroke="#6f6758" strokeWidth=".5" fill="none" opacity=".55" />
    <path d="M0 -47.4 V-36.5" stroke="#8f8676" strokeWidth=".7" />
    <circle cx=".9" cy="-44.6" r=".42" fill="#7d7466" /><circle cx=".9" cy="-41.4" r=".42" fill="#7d7466" /><circle cx=".9" cy="-38.2" r=".42" fill="#7d7466" />
    <path d="M-3.6 -47.8 Q0 -46.2 3.6 -47.8" stroke="#8f8676" strokeWidth=".6" fill="none" />
  </g>;
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
        <path d="M-7.6 -47 Q-9.6 -45.5 -9.9 -42 L-10.3 -25 Q0 -23.6 10.3 -25 L9.9 -42 Q9.6 -45.5 7.6 -47 Q0 -49 -7.6 -47Z" fill={`url(#${p}-volume)`} />
        <path d="M-10.4 -26.4 L-11 -8 Q0 -6.6 11 -8 L10.4 -26.4 Q0 -24.8 -10.4 -26.4Z" fill={`url(#${p}-izar)`} />
        <path d="M-10.4 -26.4 L-11 -8 Q0 -6.6 11 -8 L10.4 -26.4 Q0 -24.8 -10.4 -26.4Z" fill={`url(#${p}-volume)`} />
        <rect x="-10.5" y="-27.6" width="21" height="2.2" rx=".6" fill="#4d3120" />
        <path d="M-7 -26.5h.01M-3.5 -26.5h.01M0 -26.5h.01M3.5 -26.5h.01M7 -26.5h.01" stroke="#d8d2c2" strokeWidth="1" strokeLinecap="round" />
        <Arms pose={pose} fill={`url(#${p}-white)`} p={p} />
        {rim('M10.4 -26.4 L11 -8')}</>;
    case 'janubiya':
      return <>
        <path d="M-7.4 -47 Q-10 -45 -10.4 -40 L-12.2 -1.6 Q0 .4 12.2 -1.6 L10.4 -40 Q10 -45 7.4 -47Z" fill={`url(#${p}-abaya)`} />
        <path d="M-7.4 -47 Q-10 -45 -10.4 -40 L-12.2 -1.6 Q0 .4 12.2 -1.6 L10.4 -40 Q10 -45 7.4 -47Z" fill={`url(#${p}-sheen)`} />
        <path d="M-3.8 -46.4 L3.8 -46.4 L3.2 -33 L-3.2 -33Z" fill="#a8403a" />
        <path d="M-2.4 -44 h4.8 M-2.2 -40.6 h4.4 M-2 -37.2 h4" stroke="#e5a27b" strokeWidth=".8" strokeDasharray=".9 .9" />
        <path d="M-12 -5 Q0 -3.2 12 -5" stroke="#c9763f" strokeWidth="1.4" fill="none" />
        <Arms pose={pose} fill="#171417" p={p} />
        {rim('M10.4 -40 L12.2 -1.6')}</>;
    case 'abaya':
      return <>
        <g className="pp-breathe">
          <path d="M-7.4 -47 Q-10 -45 -10.4 -40 L-12.6 -1.5 Q0 .6 12.6 -1.5 L10.4 -40 Q10 -45 7.4 -47Z" fill={`url(#${p}-abaya)`} />
          <path d="M-3 -46 L-4.4 -2 L3.6 -2 L2.2 -46Z" fill={`url(#${p}-sheen)`} />
          <path d="M0 -46 V-2" stroke="#2c282b" strokeWidth=".6" />
          <path d="M-12.4 -3.4 Q0 -1.6 12.4 -3.4" stroke="#8a5a3a" strokeWidth=".7" fill="none" opacity=".8" />
          <path d="M-.9 -46 V-8 M.9 -46 V-8" stroke="#6d4a33" strokeWidth=".35" strokeDasharray=".8 .8" opacity=".8" />
        </g>
        <Arms pose={pose} fill="#161316" p={p} />
        {rim('M10.4 -40 L12.6 -1.5')}</>;
  }
}

export const Person = memo(function Person({ kind, pose = 'idle', x, g, s = 1, flip, p, className }: Figure & { p: string; className?: string }) {
  const kids: ReactNode = <>
    {shadow}{sandals}
    <Body kind={kind} pose={pose} p={p} />
    {(kind !== 'abaya' && kind !== 'janubiya') && face}
    <g className={pose === 'talk' ? 'pp-nod' : undefined}>
      <Headgear kind={kind} p={p} />
      <Features p={p} beard={kind === 'najdi' || kind === 'najdi-bisht' || kind === 'hijazi' || kind === 'hijazi-ghabana' || kind === 'janubi-wreath' || kind === 'janubi-hat'} />
    </g>
  </>;
  return <g className={className} transform={`translate(${x} ${g}) scale(${flip ? -s : s} ${s})`}>{kids}</g>;
});


// The HBS office on each city's street: a lit shopfront between the two
// groups of residents. Local coordinates: centre at x=0, pavement at y=0.
export function Storefront({ p, x, g, s = 1 }: { p: string; x: number; g: number; s?: number }) {
  return (
    <g className="pp-store" transform={`translate(${x} ${g}) scale(${s})`}>
      <ellipse cx="0" cy="2" rx="96" ry="9" fill={`url(#${p}-pool)`} />
      <path d="M-74 0 V-86 H74 V0Z" fill={`url(#${p}-stone)`} />
      <path d="M-78 -86 H78 V-92 H-78Z" fill="#2e3336" />
      <path d="M-78 -92 H78" stroke="#f0b28a" strokeOpacity=".5" strokeWidth=".8" />
      {/* sign */}
      <rect x="-64" y="-82" width="128" height="20" rx="3" fill="#0e2629" />
      <rect x="-64" y="-82" width="128" height="20" rx="3" fill="none" stroke="#e5a27b" strokeWidth=".9" />
      <rect x="-60" y="-78" width="120" height="12" rx="2" fill={`url(#${p}-signglow)`} className="cs-glow" />
      <text x="-26" y="-68.6" textAnchor="middle" className="pp-sign pp-sign--latin" direction="ltr">HBS</text>
      <path d="M-8 -77 V-67" stroke="#e5a27b" strokeWidth=".7" />
      <text x="24" y="-68" textAnchor="middle" direction="rtl" className="pp-sign">حلول الغد</text>
      {/* awning */}
      <path d="M-70 -60 H70 L64 -50 H-64Z" fill="#8d4a30" />
      {[-56, -40, -24, -8, 8, 24, 40, 56].map((ax) => <path key={ax} d={`M${ax - 4} -60 H${ax + 4} L${ax + 3.6} -50 H${ax - 3.6}Z`} fill="#e5a27b" opacity=".55" />)}
      {/* window with a staff member at the desk */}
      <rect x="-66" y="-48" width="78" height="40" rx="1.5" fill={`url(#${p}-shop)`} />
      <g opacity=".9">
        <path d="M-36.5 -26.5 Q-36.5 -19 -38 -15 H-22 Q-23.5 -19 -23.5 -26.5 Q-30 -29 -36.5 -26.5Z" fill="#fbf6ec" stroke="#8a5a3a" strokeWidth=".5" />
        <ellipse cx="-30" cy="-29.8" rx="2.3" ry="2.8" fill="#7a4f35" />
        <path d="M-34.2 -31.5 Q-30 -36.6 -25.8 -31.5 L-24.4 -24 Q-26 -26.4 -27.8 -27.4 L-28 -31.4 H-32 L-32.2 -27.4 Q-34 -26.4 -35.6 -24Z" fill={`url(#${p}-shemagh)`} />
        <path d="M-33.6 -32.2 Q-30 -33.4 -26.4 -32.2" stroke="#0b0b0b" strokeWidth=".9" fill="none" />
        <rect x="-50" y="-15" width="46" height="4" fill="#5b3a28" />
        <rect x="-16" y="-24" width="11" height="8" rx="1" fill="#15393b" /><rect x="-15" y="-23" width="9" height="6" fill="#bfeee6" className="cs-glow" />
        <rect x="-50" y="-19" width="10" height="4" fill="#f6efe3" /><rect x="-49" y="-21" width="9" height="2" fill="#e5a27b" />
      </g>
      <path d="M-27 -48 V-8 M-66 -28 H12" stroke="#2a2019" strokeWidth=".8" opacity=".35" />
      <rect x="-66" y="-48" width="78" height="40" rx="1.5" fill={`url(#${p}-sheen)`} />
      <rect x="-68" y="-9" width="82" height="3" fill="#2e3336" />
      {/* door */}
      <rect x="22" y="-48" width="42" height="48" rx="1.5" fill="#223436" />
      <rect x="25" y="-45" width="17" height="44" fill={`url(#${p}-door)`} /><rect x="44" y="-45" width="17" height="44" fill={`url(#${p}-door)`} />
      <path d="M40 -26 V-19 M46 -26 V-19" stroke="#e5a27b" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="27" y="-40" width="13" height="6" rx="1" fill="#f6efe3" opacity=".85" />
      <path d="M29 -37 H38" stroke="#15393b" strokeWidth=".8" />
      {/* wall lamps */}
      <circle cx="17" cy="-44" r="1.8" fill="#ffd9a8" className="cs-glow" /><circle cx="17" cy="-44" r="7" fill="#ffc890" opacity=".18" />
      <circle cx="68" cy="-44" r="1.8" fill="#ffd9a8" className="cs-glow" /><circle cx="68" cy="-44" r="7" fill="#ffc890" opacity=".18" />
      <path d="M-74 0 V-86" stroke="#000" strokeOpacity=".3" strokeWidth="3" />
      <path d="M74 -86 V0" stroke="#f0b28a" strokeOpacity=".35" strokeWidth="1.2" />
    </g>
  );
}

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
      {crowd.office && <Storefront p={id} {...crowd.office} />}
      {crowd.pools.map(([x, g, rx = 90], i) => <ellipse key={i} cx={x} cy={g} rx={rx} ry="12" fill={`url(#${id}-pool)`} />)}
      {crowd.walkers?.map((w, i) => (
        <g key={`w${i}`} className={w.dir > 0 ? 'pp-walk pp-walk--r' : 'pp-walk'} style={{ animationDuration: `${w.dur}s`, animationDelay: `${-w.delay}s` }}>
          <g className="pp-bob"><Person {...w} x={w.dir > 0 ? -80 : 1680} flip={w.dir < 0} p={id} /></g>
        </g>
      ))}
      {crowd.people.map((f, i) => <Person key={i} {...f} p={id} />)}
      <g className="pp-lines">{crowd.lines.map((l, i) => {
        const f = crowd.people[l.who]; const s = f.s ?? 1;
        const w = Math.round(l.text.length * 6.3 + 22);
        // The scene is center-cropped on desktop. Keep the leftmost bubbles
        // within that crop and point their tails back toward the speaker.
        const preferredLeft = f.flip ? f.x - 20 : f.x - w + 20;
        const left = Math.max(440, preferredLeft);
        const tail = left > preferredLeft || f.flip ? 'left' : 'right';
        const x = left + w / 2;
        return <Say key={i} x={x} y={f.g - 72 * s - 4} text={l.text} at={l.at} tail={tail} />;
      })}</g>
    </g>
  );
});

export const riyadhCrowd: Crowd = {
  pools: [[470, 692], [770, 694], [1300, 696, 60]],
  office: { x: 622, g: 694, s: 1 },
  people: [
    { kind: 'najdi', pose: 'phone', x: 436, g: 692, s: 1.22 },
    { kind: 'najdi-bisht', pose: 'idle', x: 500, g: 693, s: 1.28, flip: true },
    { kind: 'abaya', pose: 'folder', x: 742, g: 694, s: 1.16 },
    { kind: 'abaya', pose: 'talk', x: 800, g: 695, s: 1.12, flip: true },
  ],
  lines: [
    { who: 0, text: 'كيف أبدأ معاملتي؟', at: .6 },
    { who: 1, text: 'سجّل واختر الخدمة من الدليل', at: 3.2 },
    { who: 2, text: 'وبعد ما أرسل الطلب؟', at: 6.2 },
    { who: 3, text: 'يوصلك رقم مرجعي وتتابع حالته', at: 8.8 },
  ],
  walkers: [
    { kind: 'najdi', pose: 'folder', x: 0, g: 697, s: 1.08, dur: 70, delay: 20, dir: -1 },
    { kind: 'abaya', pose: 'idle', x: 0, g: 698, s: 1.04, dur: 84, delay: 55, dir: 1 },
  ],
};

export const jeddahCrowd: Crowd = {
  pools: [[468, 690], [770, 694], [720, 690, 60]],
  office: { x: 622, g: 693, s: 1 },
  people: [
    { kind: 'hijazi-ghabana', pose: 'talk', x: 438, g: 690, s: 1.24 },
    { kind: 'hijazi', pose: 'idle', x: 500, g: 691, s: 1.2, flip: true },
    { kind: 'abaya', pose: 'phone', x: 742, g: 694, s: 1.14 },
    { kind: 'hijazi', pose: 'talk', x: 800, g: 695, s: 1.22, flip: true },
  ],
  lines: [
    { who: 0, text: 'المكتب طلب صورة الإقامة', at: .6 },
    { who: 1, text: 'ارفعها من صفحة الطلب نفسه', at: 3.2 },
    { who: 2, text: 'ويوصلني خبر لو تحدّث؟', at: 6.2 },
    { who: 3, text: 'إيوه، يوصلك بريد بكل تحديث', at: 8.8 },
  ],
  walkers: [
    { kind: 'hijazi-ghabana', pose: 'idle', x: 0, g: 692, s: 1.06, dur: 76, delay: 30, dir: 1 },
  ],
};

export const jazanCrowd: Crowd = {
  pools: [[478, 694], [770, 694]],
  office: { x: 626, g: 695, s: 1 },
  people: [
    { kind: 'janubi-wreath', pose: 'talk', x: 446, g: 694, s: 1.24 },
    { kind: 'janubi-hat', pose: 'idle', x: 510, g: 695, s: 1.2, flip: true },
    { kind: 'janubiya', pose: 'folder', x: 742, g: 694, s: 1.14 },
    { kind: 'abaya', pose: 'talk', x: 800, g: 695, s: 1.1, flip: true },
  ],
  lines: [
    { who: 0, text: 'عندي سؤال عن خطوات الطلب', at: .6 },
    { who: 1, text: 'اسأل «أم مشعل» من حسابك', at: 3.2 },
    { who: 2, text: 'والرد الرسمي من وين؟', at: 6.2 },
    { who: 3, text: 'المكتب يرد عليك في البوابة', at: 8.8 },
  ],
  walkers: [
    { kind: 'janubi-hat', pose: 'idle', x: 0, g: 698, s: 1.06, dur: 80, delay: 10, dir: -1 },
  ],
};