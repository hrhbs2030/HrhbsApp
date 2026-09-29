import { memo, type ReactNode } from 'react';
import { Layer, blocks, rng, type Block } from './kit';
import './jeddah.css';

/* ---------------- Jeddah: Red Sea sunset, Jeddah Tower, King Fahd Fountain, Al-Balad ----------------
   Painted like a matte: the sun sets into a humid haze over the sea behind the (still unfinished)
   Jeddah Tower; the far city is lighter and bluer; foreground Al-Balad houses are in shadow with
   lit roshan bays. All geometry is generated once at module load from seeded rng (deterministic),
   and dense marks (ripples, glints, windows) are merged into single paths to keep the DOM small. */

const n1 = (v: number) => Math.round(v * 10) / 10;
const box = (x: number, y: number, w: number, h: number) => `M${n1(x)} ${n1(y)}h${n1(w)}v${n1(h)}h${n1(-w)}z`;
const HZ = 524; // horizon / far shore

/* ---------- Sky ---------- */
const SUN = { x: 712, y: 486 };
const clouds: [number, number, number, number, number, 0 | 1][] = [
  [100, 168, 380, 6, .5, 0], [520, 136, 300, 5, .45, 0], [930, 118, 420, 7, .3, 0], [1260, 180, 360, 6, .25, 0],
  [260, 232, 540, 9, .6, 0], [760, 252, 470, 8, .5, 0], [1170, 272, 400, 8, .3, 0],
  [150, 330, 440, 10, .7, 1], [600, 346, 400, 9, .75, 1], [1000, 322, 340, 7, .4, 1], [400, 398, 320, 7, .85, 1],
  [830, 410, 360, 7, .55, 1], [1220, 384, 300, 6, .3, 1], [470, 458, 270, 5, .9, 1], [760, 472, 240, 5, .8, 1], [300, 486, 250, 4, .7, 1],
];
const lens = (x: number, y: number, w: number, h: number) => `M${x} ${y}C${x + w * .3} ${y - h} ${x + w * .7} ${y - h} ${x + w} ${y}C${x + w * .7} ${y + h * .4} ${x + w * .3} ${y + h * .4} ${x} ${y}Z`;
const stars = (() => { const r = rng(71); return Array.from({ length: 34 }, () => [r() * 1600, r() * 190, r() * 1 + .35, r() * .5 + .2] as const); })();

/* ---------- Sea: ripples and the sun's glitter path ---------- */
const sea = (() => {
  const r = rng(73); let lite = ''; let dark = '';
  for (let y = HZ + 2; y < 700; y += 1.6 + (y - HZ) * .07) {
    const d = y - HZ;
    for (let x = -40 + r() * 60; x < 1640; x += 30 + r() * 90 * (1 + d / 90)) {
      const w = (10 + r() * 46) * (1 + d / 70); const h = .5 + d * .011;
      if (r() < .45) lite += box(x, y, w, h); else dark += box(x, y + h, w, h * 1.4);
    }
  }
  return { lite, dark };
})();
const glitter = (() => {
  const r = rng(79); const g = ['', '', ''];
  g[0] += box(SUN.x - 38, HZ + .5, 76, 2.2);
  for (let y = HZ + 3; y < 700; y += 1.1 + (y - HZ) * .05) {
    const d = y - HZ; const hw = 26 + d * .62; const k = Math.min(1, d / 170);
    const count = 2 + Math.floor(r() * (3 + k * 3));
    for (let i = 0; i < count; i++) {
      const cx = SUN.x + (r() + r() - 1) * hw;
      const w = d < 10 ? 34 + r() * 30 : (4 + r() * 26) * (1 - k * .45);
      g[d < 40 ? 0 : d < 100 ? 1 : 2] += box(cx - w / 2, y, w, .7 + d * .011);
    }
  }
  return g;
})();

/* ---------- Far city (layer 2) ---------- */
const farA = blocks(51, 830, 1660, 22, 100, 18, 42);
const farB = blocks(57, 860, 1660, 40, 176, 22, 54, [[986, 1062], [1170, 1266]]);
const cityPath = (list: Block[]) => list.map((b) => {
  const t = HZ - b.h;
  return box(b.x, t, b.w, b.h) + (b.cap > .84 ? box(b.x + b.w / 2 - 1, t - 20, 2, 20) : b.cap > .62 ? box(b.x + b.w * .2, t - 8, b.w * .6, 8) : '');
}).join('');
const cityLights = (list: Block[], seed: number, density: number) => {
  const r = rng(seed); let d = '';
  list.forEach((b) => { for (let y = HZ - b.h + 7; y < HZ - 8; y += 8) for (let x = b.x + 3; x < b.x + b.w - 4; x += 6) if (r() < density) d += box(x, y, 2, 2.6); });
  return d;
};
const farRims = farB.map((b) => `M${n1(b.x + .6)} ${n1(HZ - b.h)}v${n1(b.h * .55)}`).join('');
const farReflect = (() => {
  const r = rng(83); let d = '';
  for (let i = 0; i < 26; i++) {
    const x = 850 + r() * 780; const len = 30 + r() * 70;
    for (let y = HZ + 2; y < HZ + len; y += 2.4 + r() * 2) if (r() > .25) d += box(x + (r() - .5) * 2, y, 1.4 + r() * 2, 1.1);
  }
  return d;
})();
const cranes = [392, 440, 492, 546].map((x, i) => {
  const t = HZ - 44 - (i % 2) * 6;
  return `M${x} ${HZ}L${x + 5} ${t}L${x + 10} ${HZ}M${x + 5} ${t}v-9M${x - 18} ${t + 6}h46M${x + 5} ${t - 9}L${x - 16} ${t + 6}M${x + 5} ${t - 9}L${x + 26} ${t + 6}`;
}).join('');

/* ---------- Jeddah Tower (layer 3) ---------- */
const TX = 760; const TT = 116; const TOP = 94;
const hc = (y: number) => 3.6 + 12.4 * Math.pow(Math.max(0, (y - TOP) / (HZ - TOP)), 1.3);
const half = (y: number, pt: number, amp: number) => (y >= pt ? hc(y) + amp * Math.pow((y - pt) / (HZ - pt), 1.15) + 5 : hc(y));
const L = { pt: 238, amp: 26 }; const R = { pt: 152, amp: 24 };
const side = (pt: number, amp: number) => {
  const p: [number, number][] = [];
  for (let y = HZ; y > pt; y -= 8) p.push([half(y, pt, amp), y]);
  p.push([hc(pt) + 5, pt], [hc(pt - 12), pt - 12]);
  for (let y = pt - 20; y > TT; y -= 12) p.push([hc(y), y]);
  p.push([hc(TT), TT]);
  return p;
};
const sL = side(L.pt, L.amp); const sR = side(R.pt, R.amp);
const faceL = `M${TX} ${HZ}` + sL.map(([h, y]) => `L${n1(TX - h)} ${y}`).join('') + `L${TX} ${TT}Z`;
const faceR = `M${TX} ${HZ}` + sR.map(([h, y]) => `L${n1(TX + h)} ${y}`).join('') + `L${TX} ${TT}Z`;
const rimL = 'M' + sL.map(([h, y]) => `${n1(TX - h)} ${y}`).join('L');
const rimR = 'M' + sR.map(([h, y]) => `${n1(TX + h)} ${y}`).join('L');
const hL = (y: number) => half(y, L.pt, L.amp); const hR = (y: number) => half(y, R.pt, R.amp);
const floors = (() => { let d = ''; for (let y = TT + 3; y < HZ - 2; y += 4.5) d += `M${n1(TX - hL(y) + .8)} ${n1(y)}H${n1(TX + hR(y) - .8)}`; return d; })();
const towerLit = (() => {
  const r = rng(89); let warm = ''; let work = '';
  for (let y = TT + 5; y < HZ - 4; y += 4.5) {
    const k = r() < (y < 200 ? .45 : .2) ? 1 + Math.floor(r() * 2) : 0;
    for (let i = 0; i < k; i++) {
      const a = TX - hL(y) + 2; const b = TX + hR(y) - 2; const x = a + r() * (b - a - 3);
      if (y < 190) work += box(x, y, 1.6, 1.4); else warm += box(x, y, 1.5 + r() * 2.5, 1.5);
    }
  }
  return { warm, work };
})();
const towerReflect = (() => {
  const r = rng(97); let d = ''; let rim = '';
  for (let y = HZ + 1.5; y < 700; y += 1.6 + (y - HZ) * .025) {
    if (r() < .22) continue;
    const src = HZ - (y - HZ) * 1.05; const j = (r() - .5) * (y - HZ) * .09;
    const a = TX - hL(src) + j; const w = hL(src) + hR(src);
    d += box(a, y, w, 1.2 + (y - HZ) * .006);
    if (r() < .5) rim += box(a - 1, y, 2.5, 1);
  }
  return { d, rim };
})();
const craneD = [
  // crane 1: mast, jib to the west, counter-jib, pendants, hook line
  'M754.5 94V50M756.5 94V50M754.5 90L756.5 84L754.5 78L756.5 72L754.5 66L756.5 60L754.5 54',
  'M756 50L756 43M714 53.5H776M714 56H756M756 43L714 53.5M756 43L776 53.5M730 56V74M728 74h4v3h-4z',
  // crane 2: jib to the east
  'M765.5 94V64M767.5 94V64M765.5 90L767.5 84L765.5 78L767.5 72L765.5 66',
  'M766.5 64V58M752 67H806M766.5 69.5H806M766.5 58L806 67M766.5 58L752 67M790 69.5V86M788 86h4v3h-4z',
].join('');

/* ---------- King Fahd Fountain (layer 3) ---------- */
const FX = 332; const FY = 604;
const spray = (() => {
  const r = rng(101);
  return Array.from({ length: 34 }, () => {
    const t = r(); const leftSide = r() < .58; const sgn = leftSide ? -1 : 1;
    const x = FX - 6 + sgn * (6 + t * (leftSide ? 62 : 48)) + (r() - .5) * 14;
    const y = 160 + t * t * 330 + (r() - .5) * 26;
    return { x, y, r: .7 + r() * 1.9, o: .35 + r() * .5, delay: -r() * 7, dur: 4.5 + r() * 4 };
  });
})();
const fountainReflect = (() => { const r = rng(103); let d = ''; for (let y = FY + 3; y < 700; y += 2.4 + r() * 2) if (r() > .2) d += box(FX - 7 + (r() - .5) * 10, y, 6 + r() * 12, 1.2); return d; })();

/* ---------- Al-Balad (layer 4) ---------- */
const WOOD = ['#4a2a1a', '#1d3f33', '#2a4250', '#553f31'];
const houses: [number, number, number][] = [[866, 76, 196], [946, 94, 240], [1044, 72, 178], [1120, 104, 224], [1228, 80, 190], [1312, 98, 252], [1414, 86, 204], [1504, 124, 232]];
const balad = (() => {
  const r = rng(107); const out: ReactNode[] = [];
  houses.forEach(([x, w, h], hi) => {
    const top = 700 - h; const wood = WOOD[hi % 4];
    let courses = ''; for (let y = top + 20; y < 690; y += 24) courses += `M${x} ${y}h${w}`;
    let par = `M${x} ${top}`; for (let px = x; px < x + w - 6; px += 8) par += `L${px + 4} ${top - 7}L${px + 8} ${top}`; par += `L${x + w} ${top}Z`;
    out.push(<g key={`h${hi}`}>
      <rect x={x} y={top} width={w} height={h} fill="url(#jd-stone)" />
      {hi % 3 === 1 && <rect x={x} y={top} width={w} height={h} fill="#000" opacity=".22" />}
      <path d={par} fill="#5b4a41" />
      <path d={courses} stroke="#8a6650" strokeOpacity=".4" strokeWidth="1.3" />
      <path d={`M${x + .8} ${top - 6}V${top + h * .55}M${x} ${top - .5}h${w}`} stroke="#f0ae84" strokeOpacity=".5" strokeWidth="1.4" />
      <path d={`M${x + w / 2 - 9} 700v-26a9 9 0 0 1 18 0v26z`} fill={r() < .5 ? '#2a160c' : '#07090a'} />
    </g>);
    const cols = w > 90 ? [x + w * .14, x + w * .58] : [x + (w - Math.min(34, w * .46)) / 2];
    cols.forEach((bx, ci) => {
      const bw = w > 90 ? w * .3 : Math.min(34, w * .46);
      for (let by = top + 30 + ci * 16; by < 700 - 104; by += 90) {
        const bh = 58 + r() * 10; const lit = r() < .5; const warm = r(); const lh = bh * .64;
        let lat = `M${n1(bx + bw / 2)} ${n1(by)}v${n1(bh)}`;
        for (let lx = bx + 2.4; lx < bx + bw - 1; lx += 2.4) lat += `M${n1(lx)} ${n1(by)}v${n1(lh)}`;
        for (let ly = by + 6; ly < by + lh; ly += 6) lat += `M${n1(bx)} ${n1(ly)}h${n1(bw)}`;
        out.push(<g key={`r${hi}-${ci}-${by}`}>
          {lit && <ellipse cx={bx + bw / 2} cy={by + lh / 2} rx={bw * 1.2} ry={lh} fill="url(#jd-spill)" className={warm > .6 ? 'cs-glow' : undefined} style={warm > .6 ? { animationDelay: `${n1(-warm * 5)}s` } : undefined} />}
          <rect x={bx + 1} y={by + 1} width={bw - 2} height={lh} fill={lit ? (warm > .5 ? '#ffb468' : '#e8925a') : '#140d0a'} opacity={lit ? .7 : 1} />
          <path d={lat} stroke={wood} strokeWidth="1.1" />
          <rect x={bx} y={by + lh} width={bw} height={bh - lh} fill={wood} />
          <path d={box(bx + 3, by + lh + 3, bw / 2 - 5, bh - lh - 6) + box(bx + bw / 2 + 2, by + lh + 3, bw / 2 - 5, bh - lh - 6)} fill="none" stroke="#000" strokeOpacity=".35" />
          <rect x={bx} y={by} width={bw} height={bh} fill="none" stroke={wood} strokeWidth="2.2" />
          <path d={`M${n1(bx - 4)} ${n1(by)}H${n1(bx + bw + 4)}L${n1(bx + bw)} ${n1(by - 8)}H${n1(bx)}Z`} fill={wood} />
          <path d={`M${n1(bx - 4)} ${n1(by)}L${n1(bx)} ${n1(by - 8)}H${n1(bx + bw)}`} fill="none" stroke="#f0ae84" strokeOpacity=".45" />
          <path d={`M${n1(bx)} ${n1(by + bh)}H${n1(bx + bw)}L${n1(bx + bw - 6)} ${n1(by + bh + 10)}H${n1(bx + 6)}Z`} fill={wood} />
        </g>);
      }
    });
  });
  return out;
})();

/* ---------- Corniche (layer 4) ---------- */
const LAMPS = [140, 300, 470, 690, 842];
const rail = (() => { let d = 'M-40 648H868M-40 651H868'; for (let x = -36; x < 868; x += 12) d += `M${x} 648v16`; return d; })();
const PALMS: [number, number][] = [[118, 1.45], [238, 1.1], [886, 1.35]];
// Date palm with feathered fronds: a rib per frond plus drooping leaflets, merged into one path.
const featherPalm = (x: number, g: number, s: number, seed: number) => {
  const r = rng(seed); const top = g - 128 * s; const cx = x + 12 * s; const cy = top;
  const trunk = `M${n1(x - 4 * s)} ${g}Q${n1(x + 3 * s)} ${n1(g - 64 * s)} ${n1(cx - 2.2 * s)} ${n1(cy)}H${n1(cx + 2.2 * s)}Q${n1(x + 7 * s)} ${n1(g - 64 * s)} ${n1(x + 4 * s)} ${g}Z`;
  let rings = ''; for (let t = .08; t < .96; t += .055) { const yy = g - (g - cy) * t; const xx = x + (cx - x) * t * t; rings += `M${n1(xx - 3.4 * s * (1 - t * .4))} ${n1(yy)}h${n1(6.8 * s * (1 - t * .4))}`; }
  let leaves = '';
  [-168, -150, -128, -100, -70, -40, -14, 8, 26, 160, 186].forEach((deg) => {
    const a = (deg * Math.PI) / 180; const len = (40 + r() * 18) * s; const dx = Math.cos(a); const dy = Math.sin(a);
    const tx = cx + dx * len; const ty = cy + dy * len * .55 + len * .5; const kx = cx + dx * len * .55; const ky = cy + dy * len * .6 - 8 * s;
    leaves += `M${n1(cx)} ${n1(cy)}Q${n1(kx)} ${n1(ky)} ${n1(tx)} ${n1(ty)}`;
    for (let t = .14; t < 1; t += .075) {
      const u = 1 - t; const px = u * u * cx + 2 * u * t * kx + t * t * tx; const py = u * u * cy + 2 * u * t * ky + t * t * ty;
      const ll = 13 * s * (1 - t * .55); const side = Math.sign(dx) || 1;
      leaves += `M${n1(px)} ${n1(py)}l${n1(side * ll * .45)} ${n1(ll * .85)}M${n1(px)} ${n1(py)}l${n1(-side * ll * .25)} ${n1(ll * .9)}`;
    }
  });
  return { trunk, rings, leaves };
};
const palms = PALMS.map(([x, s], i) => ({ x, s, ...featherPalm(x, 664, s, 113 + i) }));
const cars = (() => {
  const r = rng(109); let e = ''; let w = '';
  for (let k = -1; k < 3; k++) for (let i = 0; i < 4; i++) {
    const xe = k * 800 + i * 200 + r() * 120; const xw = k * 800 + i * 200 + r() * 120;
    e += box(xe, 682, 2.6, 1.4) + box(xe + 5, 682, 2.6, 1.4); w += box(xw, 688, 2.4, 1.3) + box(xw + 6, 688, 2.4, 1.3);
  }
  return { e, w };
})();

export const JeddahScene = memo(function JeddahScene() {
  return <>
    <Layer depth={1}>
      <defs>
        <linearGradient id="jd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#061618" /><stop offset=".16" stopColor="#0d242a" /><stop offset=".33" stopColor="#22303d" /><stop offset=".47" stopColor="#473a50" />
          <stop offset=".57" stopColor="#7c4758" /><stop offset=".645" stopColor="#b85a55" /><stop offset=".7" stopColor="#e5845a" /><stop offset=".735" stopColor="#f9b677" /><stop offset=".76" stopColor="#ffd49c" />
        </linearGradient>
        <radialGradient id="jd-glow-a"><stop offset="0" stopColor="#ffc27a" stopOpacity=".6" /><stop offset=".35" stopColor="#f08a5a" stopOpacity=".3" /><stop offset=".7" stopColor="#a44a58" stopOpacity=".1" /><stop offset="1" stopColor="#a44a58" stopOpacity="0" /></radialGradient>
        <radialGradient id="jd-glow-b"><stop offset="0" stopColor="#ffe6b4" stopOpacity=".85" /><stop offset=".45" stopColor="#ffb070" stopOpacity=".32" /><stop offset="1" stopColor="#ffb070" stopOpacity="0" /></radialGradient>
        <radialGradient id="jd-sun"><stop offset="0" stopColor="#fffaea" /><stop offset=".65" stopColor="#ffe6b0" /><stop offset="1" stopColor="#ffc47c" /></radialGradient>
        <linearGradient id="jd-cl0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#262a3a" /><stop offset=".6" stopColor="#56405a" /><stop offset="1" stopColor="#c0706a" /></linearGradient>
        <linearGradient id="jd-cl1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5a3e56" /><stop offset=".55" stopColor="#d9805e" /><stop offset="1" stopColor="#ffd09a" /></linearGradient>
        <linearGradient id="jd-ray" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ffd6a0" stopOpacity=".16" /><stop offset="1" stopColor="#ffd6a0" stopOpacity="0" /></linearGradient>
      </defs>
      <rect width="1600" height="700" fill="url(#jd-sky)" />
      <g fill="#f6efe3">{stars.map(([x, y, r, o], i) => <circle key={i} cx={n1(x)} cy={n1(y)} r={n1(r)} opacity={n1(o * (1 - y / 260))} className={i % 6 === 0 ? 'cs-twinkle' : undefined} style={i % 6 === 0 ? { animationDelay: `${i % 5}s` } : undefined} />)}</g>
      <ellipse cx={SUN.x} cy={HZ} rx="1000" ry="340" fill="url(#jd-glow-a)" />
      <g className="jd-ray" fill="url(#jd-ray)">{[[330, 420], [540, 600], [790, 850], [980, 1080]].map(([a, b]) => <path key={a} d={`M${SUN.x} ${SUN.y}L${a} 0H${b}Z`} />)}</g>
      {clouds.map(([x, y, w, h, o, lo], i) => <path key={i} d={lens(x, y, w, h)} fill={lo ? 'url(#jd-cl1)' : 'url(#jd-cl0)'} opacity={o} />)}
      <ellipse cx={SUN.x} cy={HZ - 4} rx="320" ry="120" fill="url(#jd-glow-b)" />
      <ellipse cx={SUN.x} cy={SUN.y} rx="90" ry="70" fill="url(#jd-glow-b)" />
      <ellipse cx={SUN.x} cy={SUN.y} rx="50" ry="44" fill="url(#jd-glow-b)" />
      <ellipse cx={SUN.x} cy={SUN.y} rx="32" ry="28" fill="url(#jd-sun)" />
      <path d={lens(600, 506, 200, 2.5)} fill="#9a4a50" opacity=".55" />
      <path d={lens(640, 497, 130, 1.8)} fill="#b85a55" opacity=".45" />
    </Layer>

    <Layer depth={2}>
      <defs>
        <linearGradient id="jd-sea" x1="0" y1={HZ - 4} x2="0" y2="700" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e5a070" /><stop offset=".05" stopColor="#b06a60" /><stop offset=".2" stopColor="#5c4454" /><stop offset=".45" stopColor="#263540" /><stop offset=".75" stopColor="#102327" /><stop offset="1" stopColor="#081a1c" />
        </linearGradient>
        <radialGradient id="jd-seaglow"><stop offset="0" stopColor="#ffcf8e" stopOpacity=".6" /><stop offset=".5" stopColor="#f09a68" stopOpacity=".2" /><stop offset="1" stopColor="#f09a68" stopOpacity="0" /></radialGradient>
        <linearGradient id="jd-farA" x1="0" y1="400" x2="0" y2={HZ} gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#4c4a5e" /><stop offset="1" stopColor="#a8747a" /></linearGradient>
        <linearGradient id="jd-farB" x1="0" y1="320" x2="0" y2={HZ} gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#1d2733" /><stop offset=".7" stopColor="#3b3a4c" /><stop offset="1" stopColor="#6c5460" /></linearGradient>
        <linearGradient id="jd-haze" x1="0" y1="430" x2="0" y2="548" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f2b48a" stopOpacity="0" /><stop offset=".72" stopColor="#f6bf92" stopOpacity=".42" /><stop offset=".8" stopColor="#ffd8aa" stopOpacity=".5" /><stop offset="1" stopColor="#ffd8aa" stopOpacity="0" /></linearGradient>
      </defs>
      <rect x="-40" y={HZ - 4} width="1680" height={704 - HZ} fill="url(#jd-sea)" />
      <ellipse cx={SUN.x} cy={HZ + 6} rx="420" ry="80" fill="url(#jd-seaglow)" />
      <path d={sea.dark} fill="#07161a" opacity=".32" />
      <path d={sea.lite} fill="#f0bf98" opacity=".13" />
      <path d={glitter[0]} fill="#fff0cc" className="jd-glint" />
      <path d={glitter[1]} fill="#ffcf98" opacity=".8" className="jd-glint jd-glint--b" />
      <path d={glitter[2]} fill="#f2ab80" opacity=".55" className="jd-glint jd-glint--c" />
      {/* Jeddah Islamic Port on the far shore: container cranes, stacks and a ship, lost in haze */}
      <path d={`M360 ${HZ}h310v-4H360z` + box(372, HZ - 10, 18, 6) + box(412, HZ - 12, 26, 8) + box(462, HZ - 9, 22, 5) + box(516, HZ - 11, 20, 7) + box(590, HZ - 9, 64, 6) + box(632, HZ - 17, 12, 8)} fill="#7e5a66" opacity=".75" />
      <path d={cranes} stroke="#7e5a66" strokeOpacity=".8" strokeWidth="1.4" fill="none" />
      {/* Far city north of Al-Balad, bluer and hazier with distance */}
      <path d={`M820 ${HZ}h840v-5H820z` + cityPath(farA)} fill="url(#jd-farA)" opacity=".85" />
      <path d={cityLights(farA, 53, .05)} fill="#ffd6a8" opacity=".35" />
      <path d={cityPath(farB)} fill="url(#jd-farB)" />
      {/* National Commercial Bank tower: triangular prism with its open sky-courts */}
      <path d={`M988 ${HZ}V326H1030L1060 334V${HZ}Z`} fill="url(#jd-farB)" />
      <path d={`M1030 326L1060 334V${HZ}H1030Z`} fill="#121a22" opacity=".6" />
      <path d={box(996, 352, 26, 34) + box(996, 428, 26, 34)} fill="#8a5c66" opacity=".85" />
      {/* Lamar Towers: twin slender towers with pointed crowns */}
      <path d={`M1176 ${HZ}V300L1191 256L1206 300V${HZ}ZM1220 ${HZ}V330L1233 292L1246 330V${HZ}Z`} fill="url(#jd-farB)" />
      <path d={`M1191 256V240M1233 292V280`} stroke="#3b3a4c" strokeWidth="1.5" />
      <path d={cityLights(farB, 59, .11) + cityLights([{ x: 1176, w: 30, h: 220, cap: 0 }, { x: 1220, w: 26, h: 190, cap: 0 }, { x: 988, w: 42, h: 190, cap: 0 }], 61, .12)} fill="#ffcf9a" opacity=".6" />
      <path d={farRims + 'M1176.6 300V420M1220.6 330V430M988.6 326V430'} stroke="#f0a47c" strokeOpacity=".32" strokeWidth="1" />
      <rect x="-40" y="430" width="1680" height="118" fill="url(#jd-haze)" />
      <path d={farReflect} fill="#ffc690" opacity=".22" />
      <g fill="#ff4b3a">{[[1191, 239], [1233, 279], [1009, 322], ...farB.filter((b) => b.h > 150).map((b) => [b.x + b.w / 2, HZ - b.h - (b.cap > .84 ? 21 : 2)])].map(([x, y], i) => <circle key={i} cx={n1(x)} cy={n1(y)} r="1.6" className="jd-blink" style={{ animationDelay: `${(i * .37) % 2.4}s` }} />)}</g>
    </Layer>

    <Layer depth={3}>
      <defs>
        <linearGradient id="jd-tl" x1={TX - 44} y1="0" x2={TX} y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#4a3a48" /><stop offset=".35" stopColor="#262632" /><stop offset="1" stopColor="#171b25" /></linearGradient>
        <linearGradient id="jd-tr" x1={TX} y1="0" x2={TX + 42} y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#0f151c" /><stop offset="1" stopColor="#0a1015" /></linearGradient>
        <linearGradient id="jd-tglass" x1="0" y1={TT} x2="0" y2={HZ} gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#6d7c8a" stopOpacity=".12" /><stop offset=".6" stopColor="#b86a5e" stopOpacity=".1" /><stop offset="1" stopColor="#f0a070" stopOpacity=".28" /></linearGradient>
        <linearGradient id="jd-trefl" x1="0" y1={HZ} x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#0b1116" stopOpacity=".75" /><stop offset="1" stopColor="#0b1116" stopOpacity=".1" /></linearGradient>
        <radialGradient id="jd-bhaze"><stop offset="0" stopColor="#ffcf9e" stopOpacity=".55" /><stop offset="1" stopColor="#ffcf9e" stopOpacity="0" /></radialGradient>
        <radialGradient id="jd-red"><stop offset="0" stopColor="#ff5a44" stopOpacity=".55" /><stop offset="1" stopColor="#ff5a44" stopOpacity="0" /></radialGradient>
        <linearGradient id="jd-soft" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#f6efe3" stopOpacity="0" /><stop offset=".5" stopColor="#fffaf0" stopOpacity=".9" /><stop offset="1" stopColor="#f6efe3" stopOpacity="0" /></linearGradient>
        <radialGradient id="jd-mist"><stop offset="0" stopColor="#f6efe3" stopOpacity=".6" /><stop offset="1" stopColor="#f6efe3" stopOpacity="0" /></radialGradient>
      </defs>
      {/* Jeddah Economic City at the tower's foot */}
      <path d={box(686, HZ - 14, 22, 14) + box(706, HZ - 22, 14, 22) + box(800, HZ - 18, 16, 18) + box(814, HZ - 10, 26, 10) + box(664, HZ - 8, 24, 8)} fill="#2b2a38" />
      {/* Jeddah Tower: three tapering petals; cladding stops short of the top, cranes still at work */}
      <path d={towerReflect.d} fill="url(#jd-trefl)" />
      <path d={towerReflect.rim} fill="#f0a47c" opacity=".22" />
      <path d={faceL} fill="url(#jd-tl)" />
      <path d={faceR} fill="url(#jd-tr)" />
      <path d={faceL} fill="url(#jd-tglass)" />
      <path d={floors} stroke="#8e7a86" strokeOpacity=".09" strokeWidth=".6" />
      <path d={`M${TX} ${HZ}V${TT}`} stroke="#6a5a66" strokeOpacity=".5" strokeWidth=".8" />
      <path d={towerLit.warm} fill="#ffc98f" opacity=".7" />
      <path d={towerLit.work} fill="#f6efe3" opacity=".75" />
      <path d={`M${TX - 5} ${TT}V${TOP}H${TX + 5}V${TT}Z`} fill="#10161d" opacity=".7" />
      <path d={Array.from({ length: 6 }, (_, i) => `M${TX - 5.5} ${TT - i * 4}h11`).join('') + `M${TX - 5} ${TT}V${TOP}M${TX + 5} ${TT}V${TOP}M${TX} ${TT}V${TOP}`} stroke="#b08672" strokeOpacity=".7" strokeWidth=".7" />
      <path d={craneD} stroke="#7c6468" strokeWidth=".9" fill="none" />
      <path d="M714 53.5H756M752 67H766" stroke="#ffc08a" strokeOpacity=".5" strokeWidth=".6" />
      <path d={rimL} stroke="#ffc08a" strokeOpacity=".75" strokeWidth="1.3" fill="none" />
      <path d={rimR} stroke="#e5a27b" strokeOpacity=".28" strokeWidth="1" fill="none" />
      <ellipse cx={TX} cy={HZ - 4} rx="170" ry="28" fill="url(#jd-bhaze)" />
      {[[756, 42.5], [766.5, 57], [714, 53], [TX, TOP - 1]].map(([x, y], i) => <g key={i} className="jd-blink" style={{ animationDelay: `${i * .6}s` }}><circle cx={x} cy={y} r="7" fill="url(#jd-red)" /><circle cx={x} cy={y} r="1.6" fill="#ff5a44" /></g>)}

      {/* King Fahd Fountain: jet, plume and down-wind mist, lit by the low sun */}
      <path d={fountainReflect} fill="#f6efe3" opacity=".22" />
      <ellipse cx={FX + 4} cy={FY - 6} rx="150" ry="40" fill="url(#jd-mist)" className="jd-mist" />
      <g className="cs-fountain">
        <path d={`M311 ${FY}C309 480 312 330 318 220C320 185 323 162 327 150C331 162 335 190 337 230C341 330 346 480 349 ${FY}Z`} fill="url(#jd-soft)" opacity=".85" />
        <path d={`M328 ${FY}C327 450 326 300 326 190L328 156L330 190C331 300 332 450 334 ${FY}Z`} fill="#fffdf6" opacity=".9" />
        <path d={`M334 172C339 240 342 400 346 ${FY - 4}`} stroke="#ffc08a" strokeOpacity=".4" strokeWidth="1.2" fill="none" />
        {[[324, 160, 24, 18, .8], [308, 182, 30, 24, .6], [292, 218, 32, 30, .5], [280, 266, 32, 36, .42], [270, 326, 30, 44, .34], [262, 398, 28, 52, .28], [258, 476, 30, 56, .22], [262, 548, 34, 48, .24], [346, 190, 20, 26, .35], [362, 262, 18, 40, .22], [368, 360, 16, 50, .16]].map(([x, y, rx, ry, o]) => <ellipse key={y} cx={x} cy={y} rx={rx} ry={ry} fill="url(#jd-mist)" opacity={o} />)}
      </g>
      <ellipse cx={FX} cy={FY} rx="64" ry="11" fill="url(#jd-mist)" />
      <g fill="#f6efe3">{spray.map((p, i) => <circle key={i} cx={n1(p.x)} cy={n1(p.y)} r={n1(p.r)} opacity={n1(p.o)} className="jd-spray" style={{ animationDelay: `${n1(p.delay)}s`, animationDuration: `${n1(p.dur)}s` }} />)}</g>

      {/* A dhow under lateen sail, crossing the sun's path */}
      <g className="jd-dhow"><g transform="translate(450 574)"><g className="jd-bob">
        <path d={box(-20, 9, 44, 1.4) + box(-14, 12, 30, 1.2)} fill="#060e10" opacity=".4" />
        <path d="M-24 -1Q-20 6 -10 7H14Q22 5 28 -4L20 0H-16Z" fill="#081012" />
        <path d="M-2 0V-30M-20 -6L18 -44" stroke="#081012" strokeWidth="1.2" />
        <path d="M-19 -7L17 -43L6 -1Z" fill="#0c1519" />
        <path d="M-19 -7L17 -43" stroke="#ffc08a" strokeOpacity=".6" strokeWidth=".8" />
      </g></g></g>
    </Layer>

    <Layer depth={4}>
      <defs>
        <linearGradient id="jd-stone" x1="0" y1="450" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#6a5446" /><stop offset=".45" stopColor="#3a2d26" /><stop offset="1" stopColor="#140f0c" /></linearGradient>
        <radialGradient id="jd-spill"><stop offset="0" stopColor="#ffb064" stopOpacity=".42" /><stop offset="1" stopColor="#ffb064" stopOpacity="0" /></radialGradient>
        <radialGradient id="jd-lamp"><stop offset="0" stopColor="#ffdcaa" stopOpacity=".55" /><stop offset=".4" stopColor="#ffc88a" stopOpacity=".16" /><stop offset="1" stopColor="#ffc88a" stopOpacity="0" /></radialGradient>
      </defs>
      {/* Corniche: promenade, railing, lamps, palms and evening traffic */}
      <rect x="-40" y="664" width="1680" height="40" fill="#081415" />
      <rect x="-40" y="664" width="908" height="1.6" fill="#b07a5e" opacity=".55" />
      <path d={rail} stroke="#0b1a1c" strokeWidth="1.3" />
      <path d="M-40 648H868" stroke="#e8a67e" strokeOpacity=".3" strokeWidth=".8" />
      <path d={cars.e} fill="#fff1d6" className="jd-cars-e" />
      <path d={cars.w} fill="#ff4a3a" opacity=".85" className="jd-cars-w" />
      {palms.map((p) => <g key={p.x}>
        <path d={p.leaves} fill="none" stroke="#040c0d" strokeWidth={1.3 * p.s} strokeLinecap="round" />
        <path d={p.trunk} fill="#050e0f" />
        <path d={p.rings} stroke="#2a2420" strokeWidth=".8" />
        <path d={p.trunk} fill="none" stroke="#e5a27b" strokeOpacity=".22" strokeWidth=".8" />
      </g>)}
      {LAMPS.map((x, i) => <g key={x}>
        <ellipse cx={x} cy="666" rx="34" ry="3.5" fill="#ffc890" opacity=".22" />
        <path d={`M${x - 1.3} 664V592h2.6V664ZM${x - 4} 664h8v-4h-8Z`} fill="#050e0f" />
        <path d={`M${x} 594C${x} 586 ${x - 12} 586 ${x - 12} 592M${x} 594C${x} 586 ${x + 12} 586 ${x + 12} 592`} stroke="#050e0f" strokeWidth="1.8" fill="none" />
        <g className="cs-glow" style={{ animationDelay: `${i * .9}s` }}><circle cx={x - 12} cy="595" r="24" fill="url(#jd-lamp)" /><circle cx={x + 12} cy="595" r="24" fill="url(#jd-lamp)" /></g>
        <path d={box(x - 14, 592, 4, 5) + box(x + 10, 592, 4, 5)} fill="#fff0d0" />
      </g>)}
      {/* Historic Jeddah (Al-Balad): coral-stone houses with roshan bays, and a minaret behind */}
      <path d="M1400 700V470h4v-12h-2l6-8 6 8h-2v12h4V700ZM1404 440h8v-10l-4-14-4 14Z" fill="#1a1411" />
      <path d="M1400 470h16M1402 458h12" stroke="#f0ae84" strokeOpacity=".4" />
      {balad}
    </Layer>
  </>;
});
