import { memo, type ReactNode } from 'react';
import './people.css';

// Decorative SVG residents in each city's foreground. Coordinates use the
// scene's 1600 × 700 viewBox; each person's feet are at their given y.
export type Kind = 'najdi' | 'najdi-bisht' | 'abaya' | 'hijazi' | 'hijazi-ghabana' | 'janubi-wreath' | 'janubi-hat' | 'janubiya';
export type Pose = 'idle' | 'talk' | 'phone' | 'folder';

// `look` picks a face (skin tone, beard, head tilt) so neighbours differ.
export type Figure = { kind: Kind; pose?: Pose; x: number; g: number; s?: number; flip?: boolean; look?: number };
type Line = { who: number; text: string; at: number };
type Walker = Figure & { dur: number; delay: number; dir: 1 | -1 };
export type Crowd = { pools: [number, number, number?][]; people: Figure[]; lines: Line[]; walkers?: Walker[]; office?: { x: number; g: number; s?: number } };

const EDGE = '#f0b28a';
// Skin tones within the Saudi range, light to deep: [highlight, base, shade].
const TONES = [['#d9a77e', '#b98159', '#8c5c3e'], ['#c48f66', '#a06a47', '#74482f'], ['#ae7651', '#8a5a3c', '#5f3c28'], ['#946145', '#734a32', '#4c3021']] as const;
// A face for each resident, so a group never looks cloned.
type Beard = 'full' | 'trim' | 'goatee' | 'moustache';
type Look = { tone: number; beard: Beard; grey?: boolean; tilt: number };
const LOOKS: Look[] = [
  { tone: 1, beard: 'full', tilt: -3 },
  { tone: 0, beard: 'trim', grey: true, tilt: 2 },
  { tone: 2, beard: 'goatee', tilt: 3 },
  { tone: 1, beard: 'moustache', tilt: -2 },
  { tone: 3, beard: 'full', tilt: 1 },
  { tone: 0, beard: 'goatee', tilt: -3 },
];
const SLEEVE = { thobe: '#cfc6b4', white: '#e4ded2', abaya: '#1f1b1f' } as const;

export function Defs({ p }: { p: string }) {
  return (
    <defs>
      <linearGradient id={`${p}-thobe`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ebe4d4" /><stop offset=".55" stopColor="#bab19f" /><stop offset="1" stopColor="#6c6558" /></linearGradient>
      <linearGradient id={`${p}-white`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6f2e9" /><stop offset="1" stopColor="#a39b8c" /></linearGradient>
      <linearGradient id={`${p}-abaya`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2e2a2e" /><stop offset=".6" stopColor="#161416" /><stop offset="1" stopColor="#080708" /></linearGradient>
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
      {/* Faces are lit from the shopfront: warm highlight up-front, shade at the jaw. */}
      {TONES.map(([hi, base, shade], i) => (
        <radialGradient key={i} id={`${p}-skin${i}`} cx=".42" cy=".36" r=".75"><stop offset="0" stopColor={hi} /><stop offset=".62" stopColor={base} /><stop offset="1" stopColor={shade} /></radialGradient>
      ))}
      {/* Garment volume: darker at the sides, a soft highlight toward the light. */}
      <linearGradient id={`${p}-volume`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#000" stopOpacity=".34" /><stop offset=".3" stopColor="#000" stopOpacity="0" /><stop offset=".62" stopColor="#fff" stopOpacity=".1" /><stop offset=".86" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".26" /></linearGradient>
      <linearGradient id={`${p}-sheen`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".09" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
      <linearGradient id={`${p}-stone`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#1b2124" /><stop offset=".7" stopColor="#2b3235" /><stop offset="1" stopColor="#3a3431" /></linearGradient>
      <linearGradient id={`${p}-shop`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe1b4" /><stop offset=".7" stopColor="#f2b27a" /><stop offset="1" stopColor="#c47a4a" /></linearGradient>
      <linearGradient id={`${p}-door`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bfeee6" stopOpacity=".75" /><stop offset="1" stopColor="#5b9c95" stopOpacity=".55" /></linearGradient>
      <radialGradient id={`${p}-signglow`}><stop offset="0" stopColor="#e5a27b" stopOpacity=".28" /><stop offset="1" stopColor="#e5a27b" stopOpacity="0" /></radialGradient>
      {/* Warm spill from the office over the street, so residents read against the dark ground. */}
      <radialGradient id={`${p}-wash`} cy=".7"><stop offset="0" stopColor="#ffb87a" stopOpacity=".2" /><stop offset=".5" stopColor="#e98f55" stopOpacity=".07" /><stop offset="1" stopColor="#e98f55" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${p}-screen`}><stop offset="0" stopColor="#bfeee6" stopOpacity=".8" /><stop offset="1" stopColor="#8fd0c6" stopOpacity="0" /></radialGradient>
    </defs>
  );
}

const isWoman = (kind: Kind) => kind === 'abaya' || kind === 'janubiya';

// The face, drawn between the back of the headgear (drapes, hair) and its
// front (cap, iqal, hat brim), which frames it. Shapes are sized to read at
// the ~18px head height the street shows on desktop: eyes with whites and a
// catchlight, a strong brow line, a smile and a per-person beard.
function Face({ p, look, kind, talking }: { p: string; look: Look; kind: Kind; talking: boolean }) {
  const woman = isWoman(kind);
  const skin = `url(#${p}-skin${look.tone})`;
  const shade = TONES[look.tone][2];
  const hair = look.grey ? '#8d8780' : '#1b120e';
  const eye = (x: number) => <g key={x}>
    <ellipse cx={x} cy="-55.2" rx="1" ry=".72" fill="#f8f2e8" />
    <circle cx={x + .08} cy="-55.15" r=".56" fill="#24150e" />
    <circle cx={x + .3} cy="-55.4" r=".18" fill="#fff" />
  </g>;
  return <g>
    {!woman && <path d="M-1.5 -51 V-47.2 H1.5 V-51Z" fill={shade} />}
    <ellipse cx="0" cy={woman ? -54.7 : -54.5} rx={woman ? 3.6 : 3.95} ry={woman ? 4.4 : 4.75} fill={skin} />
    <ellipse cx="-2.45" cy="-53.1" rx="1" ry=".7" fill="#e3786a" opacity=".32" />
    <ellipse cx="2.45" cy="-53.1" rx="1" ry=".7" fill="#e3786a" opacity=".32" />
    <g className="pp-blink">{eye(-1.55)}{eye(1.55)}</g>
    {woman
      // Kohl: a dark upper lid with a small flick, and fine arched brows.
      ? <path d="M-2.75 -55.7 Q-1.55 -56.4 -.45 -55.75 L-.3 -55.95 M2.75 -55.7 Q1.55 -56.4 .45 -55.75 L.3 -55.95 M-2.7 -55.7 L-3.2 -56.05 M2.7 -55.7 L3.2 -56.05" stroke="#140c08" strokeWidth=".42" fill="none" strokeLinecap="round" />
      : <path d="M-2.6 -55.65 Q-1.55 -56.2 -.5 -55.7 M2.6 -55.65 Q1.55 -56.2 .5 -55.7" stroke="#2a1910" strokeWidth=".3" fill="none" />}
    <path d={woman ? 'M-2.6 -57.25 Q-1.6 -58.05 -.6 -57.6 M.6 -57.6 Q1.6 -58.05 2.6 -57.25' : 'M-2.85 -56.95 Q-1.7 -57.85 -.45 -57.25 M.45 -57.25 Q1.7 -57.85 2.85 -56.95'}
      stroke={look.grey && !woman ? '#6e6760' : '#1d120c'} strokeWidth={woman ? '.34' : '.72'} fill="none" strokeLinecap="round" />
    <path d="M.15 -55.3 Q.95 -53.5 .1 -53.05 Q-.35 -53 -.6 -53.3" stroke={shade} strokeWidth=".4" fill="none" strokeLinecap="round" />
    {talking
      ? <g><path d="M-1.35 -51.95 Q0 -51.45 1.35 -51.95 Q0 -49.85 -1.35 -51.95Z" fill="#5a1f18" /><path d="M-1.05 -51.82 Q0 -51.45 1.05 -51.82 L.85 -51.35 Q0 -51.15 -.85 -51.35Z" fill="#f8f2e8" /></g>
      : <path d="M-1.3 -51.85 Q0 -50.75 1.3 -51.85" stroke="#6b2a20" strokeWidth=".48" fill="none" strokeLinecap="round" />}
    {woman && <path d="M-.9 -51.95 Q0 -51.6 .9 -51.95" stroke="#9c4a3c" strokeWidth=".25" fill="none" opacity=".7" />}
    {!woman && <Beard style={look.beard} color={hair} />}
  </g>;
}

function Beard({ style, color }: { style: Beard; color: string }) {
  const moustache = <path d="M-2.1 -52.15 Q-1.1 -53.15 0 -52.6 Q1.1 -53.15 2.1 -52.15 Q1.1 -52.05 0 -52.35 Q-1.1 -52.05 -2.1 -52.15Z" fill={color} />;
  // Jaw band with an opening around the mouth; `trim` is the same cut, kept short.
  const full = 'M-3.95 -55.2 L-3.85 -52.6 Q-3.3 -48.6 0 -47.9 Q3.3 -48.6 3.85 -52.6 L3.95 -55.2 Q3.4 -53.1 2.5 -52.3 Q1.6 -50.1 0 -50.1 Q-1.6 -50.1 -2.5 -52.3 Q-3.4 -53.1 -3.95 -55.2Z';
  const trim = 'M-3.95 -54.6 L-3.8 -52.4 Q-3.2 -49.6 0 -49.1 Q3.2 -49.6 3.8 -52.4 L3.95 -54.6 Q3.4 -52.8 2.5 -52.1 Q1.6 -50.3 0 -50.3 Q-1.6 -50.3 -2.5 -52.1 Q-3.4 -52.8 -3.95 -54.6Z';
  switch (style) {
    case 'full': return <g><path d={full} fill={color} />{moustache}</g>;
    case 'trim': return <g><path d={trim} fill={color} opacity=".85" />{moustache}</g>;
    case 'goatee': return <g><path d="M-1.5 -50.75 Q0 -50.2 1.5 -50.75 L1.2 -48.75 Q0 -48.05 -1.2 -48.75Z" fill={color} />{moustache}</g>;
    case 'moustache': return moustache;
  }
}

const sandals = <path d="M-5.6 -1.6h4v1.6h-4zM1.6 -1.6h4v1.6h-4z" fill="#1b120d" />;
const shadow = <ellipse cx="0" cy="0" rx="13" ry="2.2" fill="#000" opacity=".5" />;

// A hand: palm plus a thumb nub, so it reads as a hand and not a ball.
const hand = (x: number, y: number, skin: string, r = 1.7) => <g><circle cx={x} cy={y} r={r} fill={skin} /><circle cx={x - r * .7} cy={y - r * .55} r={r * .5} fill={skin} /></g>;

function Arms({ pose, fill, sleeve, skin, p }: { pose: Pose; fill: string; sleeve: string; skin: string; p: string }) {
  const left = <g><path d="M-8.6 -45 Q-11.8 -36 -11.2 -26 L-8.8 -26 Q-9.3 -36 -7 -44Z" fill={fill} />{hand(-10, -25, skin)}</g>;
  if (pose === 'talk') return <>{left}<g className="pp-gesture"><path d="M8.4 -44.6 L11 -35 L15.6 -40.8" fill="none" stroke={sleeve} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />{hand(16.1, -41.6, skin, 1.8)}</g></>;
  if (pose === 'phone') return <>{left}
    <path d="M8.4 -44.6 L10.8 -35 L5.4 -38.6" fill="none" stroke={sleeve} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="2.4" y="-43" width="3.2" height="5" rx=".6" fill="#0b1a1c" /><rect x="2.9" y="-42.4" width="2.2" height="3.8" fill="#bfeee6" />
    {hand(4.6, -38.4, skin, 1.5)}
    <circle cx="3.6" cy="-47" r="10" fill={`url(#${p}-screen)`} className="cs-glow" /></>;
  if (pose === 'folder') return <>{left}
    <path d="M8.6 -45 Q11.4 -38 11 -31" fill="none" stroke={sleeve} strokeWidth="3" strokeLinecap="round" />
    <g className="pp-folder"><rect x="8.2" y="-33" width="7.4" height="9.6" rx=".8" fill="#f6efe3" /><path d="M8.2 -30.4h7.4" stroke="#e5a27b" strokeWidth="1" /><path d="M9.6 -27.8h4.6M9.6 -26h3.4" stroke="#8a9a96" strokeWidth=".5" />{hand(11, -31.6, skin, 1.5)}</g></>;
  return <>{left}<g transform="scale(-1 1)">{left}</g></>;
}

// Headgear in two layers around the face: `back` hangs behind it, `front`
// sits over the forehead and frames it.
function Headgear({ kind, p, layer }: { kind: Kind; p: string; layer: 'back' | 'front' }) {
  const cap = 'M-5.3 -56.6 Q-5.8 -62.6 0 -63.1 Q5.8 -62.6 5.3 -56.6 Q0 -59.3 -5.3 -56.6Z';
  const veil = 'M-6 -53.6 Q-6.6 -62.4 0 -62.8 Q6.6 -62.4 6 -53.6 L7.8 -45.4 Q0 -47.4 -7.8 -45.4Z';
  // The scarf tucked close around a woman's face.
  const rim = <path d="M-3.75 -54.6 Q-3.9 -59.5 0 -59.6 Q3.9 -59.5 3.75 -54.6 Q3.6 -50.2 0 -50 Q-3.6 -50.2 -3.75 -54.6Z" fill="none" stroke="#141114" strokeWidth=".95" />;
  const back = layer === 'back';
  switch (kind) {
    case 'najdi': case 'najdi-bisht':
      return back
        ? <path d="M-6.2 -57.4 Q-6.6 -62.6 0 -63.3 Q6.6 -62.6 6.2 -57.4 L8.7 -45.6 Q8.9 -44 7 -44.3 L4.6 -50 Q4.3 -53 4.1 -56 L-4.1 -56 Q-4.3 -53 -4.6 -50 L-7 -44.3 Q-8.9 -44 -8.7 -45.6Z" fill={`url(#${p}-shemagh)`} />
        : <g>
          <path d={cap} fill={`url(#${p}-shemagh)`} />
          <path d="M-1.6 -62.9 L0 -64.8 L1.6 -62.9Z" fill="#b02a30" />
          <path d="M-5.3 -56.6 Q0 -59.3 5.3 -56.6" stroke="#f3e6dc" strokeWidth=".5" fill="none" opacity=".7" />
          <path d="M-5.9 -56 Q-6.8 -51 -7.8 -46 M5.9 -56 Q6.8 -51 7.8 -46" stroke="#6e1418" strokeWidth=".55" fill="none" opacity=".75" />
          <ellipse cx="0" cy="-60.6" rx="6.2" ry="1.4" fill="none" stroke="#0b0b0b" strokeWidth="1.25" />
          <ellipse cx="0" cy="-59.3" rx="6.3" ry="1.3" fill="none" stroke="#0b0b0b" strokeWidth="1.05" />
        </g>;
    case 'hijazi':
      return back
        ? <path d="M-6.2 -57.4 Q-6.6 -62.6 0 -63.2 Q6.6 -62.6 6.2 -57.4 L8.9 -44.6 Q9 -43 7 -43.4 L4.6 -50 Q4.3 -53 4.1 -56 L-4.1 -56 Q-4.3 -53 -4.6 -50 L-7 -43.4 Q-9 -43 -8.9 -44.6Z" fill={`url(#${p}-white)`} />
        : <g>
          <path d={cap} fill={`url(#${p}-white)`} />
          <path d="M-1.4 -62.8 L0 -64.4 L1.4 -62.8Z" fill="#ece6da" />
          <path d="M-5.9 -56 Q-6.9 -50.5 -7.9 -45 M5.9 -56 Q6.9 -50.5 7.9 -45 M-5.3 -56.6 Q0 -59.3 5.3 -56.6" stroke="#9c9484" strokeWidth=".55" fill="none" opacity=".8" />
        </g>;
    case 'hijazi-ghabana':
      return back
        ? <path d="M5.4 -58.4 Q10.4 -55.4 9.4 -47.6 L7.8 -47.6 Q8.4 -53.6 4.6 -56.8Z" fill={`url(#${p}-gold)`} />
        : <g>
          <path d="M-6.8 -56.2 Q-8.2 -65.8 0 -66.3 Q8.2 -65.8 6.8 -56.2 Q0 -58.8 -6.8 -56.2Z" fill={`url(#${p}-gold)`} />
          <path d="M-6.2 -60.2 Q0 -63.6 6.2 -60.2 M-6.7 -57.8 Q0 -61.2 6.7 -57.8 M-4.8 -63.4 Q0 -65.2 4.8 -63.4" fill="none" stroke="#6e4212" strokeWidth=".7" opacity=".7" />
        </g>;
    case 'janubi-wreath': case 'janubi-hat':
      // Shoulder-length curls behind, the traditional southern look.
      if (back) return <path d="M-4.6 -59 Q-6.6 -55 -6.2 -49.6 Q-5.4 -47.2 -3.6 -48.4 L3.6 -48.4 Q5.4 -47.2 6.2 -49.6 Q6.6 -55 4.6 -59Z" fill="#1a1210" />;
      return kind === 'janubi-wreath'
        ? <g>
          <path d="M-4.6 -56.4 Q-5.9 -62 0 -62.3 Q5.9 -62 4.6 -56.4 Q2.6 -58.4 0 -58.3 Q-2.6 -58.4 -4.6 -56.4Z" fill="#1a1210" />
          <ellipse cx="0" cy="-59.8" rx="6.4" ry="1.9" fill="none" stroke="#3f7a3a" strokeWidth="2.2" />
          {[[-5, -59, '#f2d25c'], [-2.6, -58.2, '#f6efe3'], [0, -58, '#e56b5d'], [2.6, -58.2, '#f2d25c'], [5, -59, '#f6efe3'], [-3.8, -61.2, '#e56b5d'], [3.8, -61.2, '#f2d25c']].map(([x, y, c], i) => <circle key={i} cx={x} cy={y} r=".95" fill={c as string} />)}
        </g>
        : <g>
          <path d="M-4.6 -56.4 Q-5.9 -60.4 0 -60.6 Q5.9 -60.4 4.6 -56.4 Q2.6 -58.2 0 -58.1 Q-2.6 -58.2 -4.6 -56.4Z" fill="#1a1210" />
          <ellipse cx="0" cy="-59.4" rx="12" ry="2.4" fill="#b88c4c" />
          <path d="M-5.6 -59.6 L0 -68.6 L5.6 -59.6Z" fill={`url(#${p}-straw)`} />
          <path d="M-5.6 -60.8 Q0 -62.4 5.6 -60.8" stroke="#5a3a1c" strokeWidth=".9" fill="none" />
        </g>;
    case 'janubiya':
      return back
        ? <path d={veil} fill="#121012" />
        : <g>
          {rim}
          <ellipse cx="0" cy="-61" rx="13.4" ry="2.6" fill="#b88c4c" />
          <path d="M-6.2 -61.2 L0 -74 L6.2 -61.2Z" fill={`url(#${p}-straw)`} />
          <path d="M-4.6 -64.6 L4.6 -64.6 M-3 -68.2 L3 -68.2" stroke="#7a5528" strokeWidth=".6" />
        </g>;
    case 'abaya':
      return back
        ? <path d={veil} fill="#121012" />
        : <g>{rim}<path d="M-3.9 -56.4 Q-4.2 -60.6 0 -60.7 Q4.2 -60.6 3.9 -56.4 Q2 -58.9 0 -58.9 Q-2 -58.9 -3.9 -56.4Z" fill="#141114" /></g>;
  }
}

function Body({ kind, pose, p, skin }: { kind: Kind; pose: Pose; p: string; skin: string }) {
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
      return <>{thobe}{rim('M10 -43 L11.2 -2')}<Arms pose={pose} fill={`url(#${p}-thobe)`} sleeve={SLEEVE.thobe} skin={skin} p={p} /></>;
    case 'najdi-bisht':
      return <>{thobe}
        <Arms pose="idle" fill={`url(#${p}-thobe)`} sleeve={SLEEVE.thobe} skin={skin} p={p} />
        <path d="M-7.8 -47.4 Q-12.6 -44.6 -13.6 -38 L-15 -4 Q-9.4 -3 -4.2 -3.6 L-2.4 -44.4Z M7.8 -47.4 Q12.6 -44.6 13.6 -38 L15 -4 Q9.4 -3 4.2 -3.6 L2.4 -44.4Z" fill={`url(#${p}-bisht)`} />
        <path d="M-2.4 -44.4 L-4.2 -3.6 M2.4 -44.4 L4.2 -3.6 M-7.8 -47.4 Q0 -45.4 7.8 -47.4" fill="none" stroke="#d9a64a" strokeWidth=".9" />
        {rim('M13.6 -38 L15 -4')}</>;
    case 'hijazi-ghabana':
      return <>{thobe}
        <Arms pose={pose} fill={`url(#${p}-thobe)`} sleeve={SLEEVE.thobe} skin={skin} p={p} />
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
        <Arms pose={pose} fill={`url(#${p}-white)`} sleeve={SLEEVE.white} skin={skin} p={p} />
        {rim('M10.4 -26.4 L11 -8')}</>;
    case 'janubiya':
      return <>
        <path d="M-7.4 -47 Q-10 -45 -10.4 -40 L-12.2 -1.6 Q0 .4 12.2 -1.6 L10.4 -40 Q10 -45 7.4 -47Z" fill={`url(#${p}-abaya)`} />
        <path d="M-7.4 -47 Q-10 -45 -10.4 -40 L-12.2 -1.6 Q0 .4 12.2 -1.6 L10.4 -40 Q10 -45 7.4 -47Z" fill={`url(#${p}-sheen)`} />
        <path d="M-3.8 -46.4 L3.8 -46.4 L3.2 -33 L-3.2 -33Z" fill="#a8403a" />
        <path d="M-2.4 -44 h4.8 M-2.2 -40.6 h4.4 M-2 -37.2 h4" stroke="#e5a27b" strokeWidth=".8" strokeDasharray=".9 .9" />
        <path d="M-12 -5 Q0 -3.2 12 -5" stroke="#c9763f" strokeWidth="1.4" fill="none" />
        <Arms pose={pose} fill="#171417" sleeve={SLEEVE.abaya} skin={skin} p={p} />
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
        <Arms pose={pose} fill="#161316" sleeve={SLEEVE.abaya} skin={skin} p={p} />
        {rim('M10.4 -40 L12.6 -1.5')}</>;
  }
}

// Heads are drawn a little larger than life (scaled about the neck) so faces
// stay legible at street scale, the way illustrated characters usually are.
const HEAD = 'translate(0 -48) scale(1.16) translate(0 48)';

export const Person = memo(function Person({ kind, pose = 'idle', x, g, s = 1, flip, look = 0, p, className }: Figure & { p: string; className?: string }) {
  const face = LOOKS[look % LOOKS.length];
  const skin = `url(#${p}-skin${face.tone})`;
  const kids: ReactNode = <>
    {shadow}{sandals}
    <Body kind={kind} pose={pose} p={p} skin={skin} />
    <g transform={`${HEAD} rotate(${face.tilt} 0 -50)`}>
      <g className={pose === 'talk' ? 'pp-nod' : undefined}>
        <Headgear kind={kind} p={p} layer="back" />
        <Face p={p} look={face} kind={kind} talking={pose === 'talk'} />
        <Headgear kind={kind} p={p} layer="front" />
      </g>
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
        <ellipse cx="-30" cy="-29.8" rx="2.3" ry="2.8" fill="#8a5a3c" />
        <path d="M-31 -30.2h.01M-29 -30.2h.01" stroke="#1d120c" strokeWidth=".7" strokeLinecap="round" />
        <path d="M-32.1 -29.4 Q-31.6 -27.2 -30 -27 Q-28.4 -27.2 -27.9 -29.4 Q-28.8 -28.4 -30 -28.6 Q-31.2 -28.4 -32.1 -29.4Z" fill="#1d120c" />
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
      {crowd.office && <ellipse cx={crowd.office.x} cy={crowd.office.g - 40} rx="330" ry="78" fill={`url(#${id}-wash)`} />}
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
    { kind: 'najdi', pose: 'phone', x: 436, g: 692, s: 1.22, look: 0 },
    { kind: 'najdi-bisht', pose: 'idle', x: 500, g: 693, s: 1.28, look: 1, flip: true },
    { kind: 'abaya', pose: 'folder', x: 742, g: 694, s: 1.16, look: 2 },
    { kind: 'abaya', pose: 'talk', x: 800, g: 695, s: 1.12, look: 5, flip: true },
  ],
  lines: [
    // Compliance: dates that expire, and the reminders that come before them.
    { who: 0, text: 'إقامات ورخص تنتهي كل شهر', at: .6 },
    { who: 1, text: 'ملف المنشأة يذكّرك قبلها', at: 3.2 },
    { who: 2, text: 'جاني تنبيه قبل انتهاء الرخصة', at: 6.2 },
    { who: 3, text: 'جدّدها من حسابك وتابع حالتها', at: 8.8 },
  ],
  walkers: [
    { kind: 'najdi', pose: 'folder', x: 0, g: 697, s: 1.08, look: 4, dur: 70, delay: 20, dir: -1 },
    { kind: 'abaya', pose: 'idle', x: 0, g: 698, s: 1.04, look: 3, dur: 84, delay: 55, dir: 1 },
  ],
};

export const jeddahCrowd: Crowd = {
  pools: [[468, 690], [770, 694], [720, 690, 60]],
  office: { x: 622, g: 693, s: 1 },
  people: [
    { kind: 'hijazi-ghabana', pose: 'talk', x: 438, g: 690, s: 1.24, look: 2 },
    { kind: 'hijazi', pose: 'idle', x: 500, g: 691, s: 1.2, look: 3, flip: true },
    { kind: 'abaya', pose: 'phone', x: 742, g: 694, s: 1.14, look: 1 },
    { kind: 'hijazi', pose: 'talk', x: 800, g: 695, s: 1.22, look: 4, flip: true },
  ],
  lines: [
    // The indicator: it changed, the office explains why in the request chat.
    { who: 0, text: 'المؤشر تغيّر ولا أعرف السبب', at: .6 },
    { who: 1, text: 'أرسل ما يظهر لك في قوى', at: 3.2 },
    { who: 2, text: 'ومين يشرح لي سبب التغيير؟', at: 6.2 },
    { who: 3, text: 'المكتب يكتبه في محادثة الطلب', at: 8.8 },
  ],
  walkers: [
    { kind: 'hijazi-ghabana', pose: 'idle', x: 0, g: 692, s: 1.06, look: 0, dur: 76, delay: 30, dir: 1 },
  ],
};

export const jazanCrowd: Crowd = {
  pools: [[478, 694], [770, 694]],
  office: { x: 626, g: 695, s: 1 },
  people: [
    { kind: 'janubi-wreath', pose: 'talk', x: 446, g: 694, s: 1.24, look: 4 },
    { kind: 'janubi-hat', pose: 'idle', x: 510, g: 695, s: 1.2, look: 2, flip: true },
    { kind: 'janubiya', pose: 'folder', x: 742, g: 694, s: 1.14, look: 3 },
    { kind: 'abaya', pose: 'talk', x: 800, g: 695, s: 1.1, look: 0, flip: true },
  ],
  lines: [
    // Observations: a note on the wage file, followed up until it closes.
    { who: 0, text: 'ظهرت ملاحظة على ملف الأجور', at: .6 },
    { who: 1, text: 'أرسلها كما وصلتك من حسابك', at: 3.2 },
    { who: 2, text: 'ومين يتابعها مع الجهة؟', at: 6.2 },
    { who: 3, text: 'المكتب، حتى تُغلق الملاحظة', at: 8.8 },
  ],
  walkers: [
    { kind: 'janubi-hat', pose: 'idle', x: 0, g: 698, s: 1.06, look: 5, dur: 80, delay: 10, dir: -1 },
  ],
};