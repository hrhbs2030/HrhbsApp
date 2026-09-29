import { memo, useMemo } from 'react';
import { Layer, blocks, rng, ridge } from './kit';
import './riyadh.css';
import { Residents, riyadhCrowd } from './people';

/* ---------------- Riyadh at dusk: a matte painting in four depths ----------------
   1 sky (afterglow, stratus, crescent moon, airliner) · 2 far city in desert haze + KAFD
   3 Kingdom Centre (signature, x 680–810), Al Faisaliah (x 330), lit towers
   4 King Fahd Road light trails, Najdi mud-brick houses (at-Turaif style), date palms */

type R = () => number;
const n = (v: number) => Math.round(v * 10) / 10;
const box = (x: number, y: number, w: number, h: number) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
const tri = (x: number, y: number, s = 7) => `M${n(x)} ${n(y + s * .85)}l${s / 2} ${-s * .85}l${s / 2} ${s * .85}z`;

// Lit windows over a facade, split into three tints (warm, pale, cool) — one path each.
function lights(r: R, out: string[], x0: number, x1: number, y0: number, y1: number, sx: number, sy: number, w: number, h: number, p: number) {
  for (let y = y0; y < y1; y += sy) for (let x = x0; x <= x1 - w; x += sx) {
    if (r() > p) continue;
    const t = r(); out[t < .6 ? 0 : t < .86 ? 1 : 2] += box(x, y, w, h);
  }
}
const TINTS = ['#ffcf9c', '#fff1da', '#bfe6ee'];
function Lit({ d, op = 1 }: { d: string[]; op?: number }) {
  return <g opacity={op}>{d.map((s, i) => s && <path key={i} d={s} fill={TINTS[i]} opacity={i === 2 ? .7 : .85} />)}</g>;
}

// Warning light with a painted halo.
const Warn = ({ x, y, d = 0, s = 1 }: { x: number; y: number; d?: number; s?: number }) =>
  <g className="ry-warn" style={{ animationDelay: `${d}s` }}><circle cx={x} cy={y} r={9 * s} fill="url(#ry-red)" /><circle cx={x} cy={y} r={1.8 * s} fill="#ff5a47" /></g>;

// Stratus lens: thin, tapered cloud streak.
const lens = (x: number, y: number, w: number, h: number) =>
  `M${n(x)} ${n(y)}C${n(x + w * .22)} ${n(y - h)} ${n(x + w * .62)} ${n(y - h * 1.15)} ${n(x + w)} ${n(y - h * .1)}C${n(x + w * .68)} ${n(y + h * .4)} ${n(x + w * .3)} ${n(y + h * .35)} ${n(x)} ${n(y)}Z`;

// Date palm: tapered trunk with ring texture; arching fronds with drooping leaflets (one path).
function palm(x: number, s: number, lean: number, g = 700) {
  const h = 128 * s, tx = x + lean * s, ty = g - h, mx = x + lean * s * .2;
  const trunk = `M${n(x - 4.5 * s)} ${g}Q${n(mx - 2 * s)} ${n(g - h * .5)} ${n(tx - 2.4 * s)} ${n(ty)}L${n(tx + 2.4 * s)} ${n(ty)}Q${n(mx + 4 * s)} ${n(g - h * .5)} ${n(x + 4.5 * s)} ${g}Z`;
  const spine = `M${x} ${g}Q${n(mx + 1 * s)} ${n(g - h * .5)} ${n(tx)} ${n(ty)}`;
  let rach = '', leaf = '';
  const fr = (a: number, L: number, droop: number) => {
    const t = a * Math.PI / 180, c = Math.cos(t), si = Math.sin(t);
    const cx = tx + c * L * .55, cy = ty + si * L * .55 - L * .2;
    const ex = tx + c * L, ey = ty + si * L * .5 + droop * L;
    rach += `M${n(tx)} ${n(ty)}Q${n(cx)} ${n(cy)} ${n(ex)} ${n(ey)}`;
    for (let k = .14; k < .99; k += .065) {
      const u = 1 - k, px = u * u * tx + 2 * u * k * cx + k * k * ex, py = u * u * ty + 2 * u * k * cy + k * k * ey;
      const dx = 2 * u * (cx - tx) + 2 * k * (ex - cx), dy = 2 * u * (cy - ty) + 2 * k * (ey - cy), m = Math.hypot(dx, dy) || 1;
      const ll = (10 - 7 * k) * s, ux = dx / m, uy = dy / m;
      // leaflets angle forward and hang down a little
      leaf += `M${n(px)} ${n(py)}l${n((ux * .55 - uy * .8) * ll)} ${n((uy * .55 + ux * .8) * ll + ll * .35)}M${n(px)} ${n(py)}l${n((ux * .55 + uy * .8) * ll)} ${n((uy * .55 - ux * .8) * ll + ll * .35)}`;
    }
  };
  [-168, -150, -133, -116, -100, -84, -68, -50, -32, -14].forEach((a, i) => fr(a, (46 + (i % 3) * 6) * s, .32 * (1 - Math.abs(Math.sin(a * Math.PI / 180))) + .05));
  [-196, -186, 6, 16].forEach((a) => fr(a, 44 * s, .62));
  return { trunk, spine, rach, leaf };
}
function Palm({ x, s = 1, lean = 8 }: { x: number; s?: number; lean?: number }) {
  const p = palm(x, s, lean);
  return <g>
    <ellipse cx={x} cy={700} rx={46 * s} ry={80 * s} fill="url(#ry-up)" opacity=".7" />
    <path d={p.trunk} fill="url(#ry-trunk)" />
    <path d={p.spine} fill="none" stroke="#01090a" strokeWidth={7 * s} strokeDasharray={`${1.4 * s} ${2.6 * s}`} opacity=".55" />
    <path d={p.leaf} fill="none" stroke="#041110" strokeWidth={1.3 * s} strokeLinecap="round" />
    <path d={p.rach} fill="none" stroke="#051312" strokeWidth={1.8 * s} strokeLinecap="round" />
  </g>;
}

// Najdi (at-Turaif) mud-brick houses: stepped merlons, triangular vents, warm-lit windows, buttresses.
type House = [number, number, number];
function najdi(list: House[], r: R) {
  let wall = '', crest = '', vent = '', lit = '', rib = '', edge = '', door = '';
  const glow: [number, number][] = [];
  for (const [x, w, h] of list) {
    const top = 700 - h;
    wall += `M${x} 700V${top}h${w}V700z`;
    edge += `M${x} ${top + .5}h${w}`;
    for (let c = x + 1; c <= x + w - 12; c += 15) crest += `M${c} ${top}h12v-3h-2v-3h-2v-3h-4v3h-2v3h-2z`;
    for (let c = x + 7; c < x + w - 10; c += 12) { const tpath = tri(c, top + 10, 6); if (r() < .16) lit += tpath; else vent += tpath; }
    const rows = h > 95 ? [top + 32, top + 66] : [top + 28];
    for (const wy of rows) for (let c = x + 12 + r() * 8; c < x + w - 14; c += 30 + r() * 14) {
      if (r() < .42) { lit += box(c, wy, 6, 9); glow.push([c + 3, wy + 5]); } else vent += box(c, wy, 6, 9);
    }
    for (let c = x + 26 + r() * 12; c < x + w - 18; c += 40 + r() * 10) rib += box(c, top + 3, 4, h - 3);
    if (w > 100) { const dx = n(x + w * .25 + r() * w * .4); door += box(dx, 674, 13, 26); lit += box(dx + 6, 676, 1.2, 24); glow.push([dx + 6, 692]); }
  }
  return { wall, crest, vent, lit, rib, edge, door, glow };
}
// Diriyah watchtower: tapering, crenellated, pierced with triangles.
function tower(x: number, w: number, h: number, r: R) {
  const top = 700 - h, t = w * .1;
  let d = `M${x} 700L${x + t} ${top}H${x + w - t}L${x + w} 700Z`, crest = '', holes = '', lit = '';
  for (let c = x + t; c <= x + w - t - 11; c += 13) crest += `M${n(c)} ${top}h11v-3h-2v-3h-2v-3h-3v3h-2v3h-2z`;
  for (let y = top + 16; y < 660; y += 30) for (let c = x + t + 5; c < x + w - t - 9; c += 11) { const p = tri(c, y, 6); if (r() < .2) lit += p; else holes += p; }
  d += crest;
  return { d, holes, lit };
}

export const RiyadhScene = memo(function RiyadhScene() {
  const S = useMemo(() => {
    const r = rng(1709);
    // --- sky
    const stars = Array.from({ length: 46 }, () => { const y = Math.pow(r(), 1.7) * 230; return { x: n(r() * 1600), y: n(y), s: n(.4 + r() * 1.1), o: n((1 - y / 250) * (.25 + r() * .55)) }; });
    const bands: [number, number, number, number, number][] = [[118, -40, 760, 0, 60], [172, 120, 1120, 0, 80], [238, -60, 930, 1, 70], [304, 180, 1180, 1, 90], [366, -40, 780, 1, 64], [420, 360, 1020, 1, 84]];
    const clouds = bands.map(([y, a, b, lo, dur]) => ({ lo, dur, lens: Array.from({ length: 7 }, () => { const w = 200 + r() * 380; return { d: lens(a + r() * (b - a - w), y + (r() - .5) * 18, w, 4 + r() * (lo ? 10 : 9)), o: n((lo ? .3 : .18) + r() * (lo ? .5 : .35)) }; }) }));
    // --- far city
    const far = blocks(11, -20, 1640, 24, 118, 14, 40);
    let farD = ''; far.forEach((b) => { const t = n(700 - b.h); farD += `M${n(b.x)} 700V${t}h${n(b.w)}V700z`; if (b.cap > .86) farD += box(b.x + b.w / 2 - .6, t - 14, 1.2, 14); });
    const farL = ['', '', '']; far.forEach((b) => lights(r, farL, b.x + 3, b.x + b.w - 2, 700 - b.h + 6, 694, 6, 8, 2.4, 3, .1));
    const kafdL = ['', '', '']; [[1042, 1064, 480], [1078, 1102, 420], [1117, 1137, 452], [1153, 1196, 372], [1209, 1236, 400], [1251, 1283, 440], [1298, 1322, 466], [1337, 1355, 496], [1383, 1414, 470]].forEach(([a, b, t]) => lights(r, kafdL, a + 3, b - 2, t + 8, 690, 5, 7, 2.4, 2.2, .09));
    // --- mid city (volume: base face + lit face + shadow face + roof rim)
    const mid = blocks(23, -20, 1640, 60, 250, 24, 60).map((b) => {
      const c = b.x + b.w / 2;
      if (c > 640 && c < 850) return { ...b, h: Math.min(b.h, 80) };
      if (c > 265 && c < 400) return { ...b, h: Math.min(b.h, 110) };
      if (c > 850) return { ...b, h: b.h * .78 };
      return b;
    });
    let face = '', litF = '', shade = '', rim = '', ant = '';
    const midL = ['', '', ''], warns: [number, number][] = [];
    mid.forEach((b) => {
      const top = 700 - b.h, left = b.x + b.w / 2 < 470, sw = b.w * .3;
      face += `M${n(b.x)} 700V${n(top)}h${n(b.w)}V700z`;
      if (b.cap > .7 && b.cap <= .86) face += box(b.x + b.w * .18, top - 12, b.w * .64, 12);
      litF += left ? box(b.x + b.w - sw, top, sw, b.h) : box(b.x, top, sw, b.h);
      shade += left ? box(b.x, top, b.w - sw, b.h) : box(b.x + sw, top, b.w - sw, b.h);
      rim += left ? `M${n(b.x + b.w - sw)} ${n(top)}h${n(sw)}v40` : `M${n(b.x)} ${n(top + 40)}v-40h${n(sw)}`;
      if (b.cap > .86 && b.h > 150) { ant += box(b.x + b.w / 2 - .7, top - 26, 1.4, 26); warns.push([b.x + b.w / 2, top - 27]); }
      const office = r() < .3;
      lights(r, midL, b.x + 4, b.x + b.w - 3, top + 8, 690, 6.5, 8.5, 3, 4, office ? .5 : .16);
    });
    // --- Kingdom Centre window grid (clipped to the tower)
    const kcL = ['', '', '']; lights(r, kcL, 682, 808, 300, 690, 5.5, 7, 2.6, 2.6, .12); lights(r, kcL, 709, 723, 130, 300, 5.5, 7, 2.6, 2.6, .12); lights(r, kcL, 767, 781, 130, 300, 5.5, 7, 2.6, 2.6, .12);
    const fsL = ['', '', '']; lights(r, fsL, 292, 370, 360, 690, 5, 7, 2.4, 2.6, .14);
    // --- foreground
    const cars = Array.from({ length: 40 }, (_, i) => {
      const right = i % 2 === 1;
      return { right, y: right ? 627 + (i % 4 > 1 ? 4 : 0) : 640 + (i % 4 > 1 ? 5 : 0), w: n(50 + r() * 90), h: right ? 2 : 2.6, dur: n(7.5 + r() * 5), del: n(r() * 12) };
    });
    const lamps = Array.from({ length: 13 }, (_, i) => -10 + i * 128);
    const back = najdi([[150, 118, 122], [276, 128, 98], [896, 150, 128], [1056, 116, 112], [1370, 150, 118], [1500, 140, 104]], r);
    const front = najdi([[118, 104, 70], [228, 140, 58], [410, 78, 34], [872, 118, 62], [1000, 156, 78], [1180, 70, 40], [1318, 124, 68], [1452, 168, 58]], r);
    const tw1 = tower(960, 34, 186, r), tw2 = tower(200, 30, 160, r);
    return { stars, clouds, farD, farL, kafdL, face, litF, shade, rim, ant, midL, warns, kcL, fsL, cars, lamps, back, front, tw1, tw2 };
  }, []);

  const KC = 'M680 700C690 480 703 262 711 110L722 104Q745 505 768 104L779 110C787 262 800 480 810 700Z';
  const VOID = 'M722 104Q745 505 768 104';
  const FS = 'M288 700L309 350H351L372 700Z';
  const KAFD = 'M1040 700V488L1062 474L1066 700ZM1074 700L1076 430L1100 412L1106 700ZM1114 700V452L1138 446V700ZM1150 700L1152 372L1174 336L1196 360L1198 700ZM1206 700L1208 404L1236 392L1238 700ZM1250 700V440L1270 420L1284 440V700ZM1296 700L1298 468L1322 460L1324 700ZM1336 700V498L1356 490V700ZM1380 700L1382 470L1398 452L1414 470L1416 700Z';

  return <>
    <Layer depth={1}>
      <defs>
        <linearGradient id="ry-sky" x1="0" y1="0" x2="0" y2="700" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#04121a" /><stop offset=".22" stopColor="#0a2530" /><stop offset=".42" stopColor="#1c3a4a" /><stop offset=".57" stopColor="#3c3d58" />
          <stop offset=".69" stopColor="#6e4d62" /><stop offset=".79" stopColor="#b06b5c" /><stop offset=".89" stopColor="#e29466" /><stop offset="1" stopColor="#f6b882" />
        </linearGradient>
        <radialGradient id="ry-after" cx="470" cy="660" r="760" gradientTransform="matrix(1 0 0 .5 0 330)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffd6a6" stopOpacity=".85" /><stop offset=".3" stopColor="#f5a878" stopOpacity=".4" /><stop offset="1" stopColor="#f5a878" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ry-cool" x1="0" y1="0" x2="1600" y2="0" gradientUnits="userSpaceOnUse"><stop offset=".45" stopColor="#061820" stopOpacity="0" /><stop offset="1" stopColor="#061820" stopOpacity=".55" /></linearGradient>
        <linearGradient id="ry-cl0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1c2a3e" stopOpacity=".2" /><stop offset="1" stopColor="#6a5a78" /></linearGradient>
        <linearGradient id="ry-cl1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a3f5c" stopOpacity=".3" /><stop offset=".6" stopColor="#b77a78" /><stop offset="1" stopColor="#f6b88a" /></linearGradient>
        <radialGradient id="ry-moon"><stop offset="0" stopColor="#f6efe3" stopOpacity=".35" /><stop offset="1" stopColor="#f6efe3" stopOpacity="0" /></radialGradient>
        <radialGradient id="ry-red"><stop offset="0" stopColor="#ff4b3a" stopOpacity=".75" /><stop offset=".35" stopColor="#ff4b3a" stopOpacity=".22" /><stop offset="1" stopColor="#ff4b3a" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="700" fill="url(#ry-sky)" />
      <rect width="1600" height="700" fill="url(#ry-after)" />
      <g>{S.stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#f6efe3" opacity={s.o} className={i % 6 === 0 ? 'cs-twinkle' : undefined} style={i % 6 === 0 ? { animationDelay: `${(i % 7) * .7}s` } : undefined} />)}</g>
      {/* young crescent low in the west, lit limb toward the set sun, faint earthshine */}
      <circle cx="520" cy="118" r="46" fill="url(#ry-moon)" />
      <circle cx="520" cy="118" r="10.5" fill="#9fb3bf" opacity=".12" />
      <path transform="translate(520 118) rotate(-40)" d="M0 -10.5A10.5 10.5 0 0 0 0 10.5A6.2 10.5 0 0 1 0 -10.5Z" fill="#f6efe3" opacity=".95" />
      {S.clouds.map((b, i) => <g key={i} className="ry-drift" style={{ animationDuration: `${b.dur}s`, animationDelay: `${-i * 9}s` }}>
        {b.lens.map((l, j) => <path key={j} d={l.d} fill={`url(#ry-cl${b.lo})`} opacity={l.o} />)}
      </g>)}
      <rect width="1600" height="700" fill="url(#ry-cool)" />
      {/* airliner on approach to King Khalid Intl */}
      <g className="ry-plane"><g transform="translate(1700 150)">
        <path d="M-7 0h14" stroke="#0b1c22" strokeWidth="1.6" />
        <circle cx="-4" cy="0" r="1.1" fill="#ff5a47" /><circle cx="4" cy="0" r="1.1" fill="#7dffb0" />
        <g className="ry-strobe"><circle r="8" fill="url(#ry-moon)" /><circle r="1.4" fill="#fff" /></g>
      </g></g>
    </Layer>

    <Layer depth={2}>
      <defs>
        <linearGradient id="ry-far" x1="0" y1="560" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#3b4459" /><stop offset="1" stopColor="#7c5f66" /></linearGradient>
        <linearGradient id="ry-kafd" x1="0" y1="330" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#2f4257" /><stop offset=".6" stopColor="#3d4a5e" /><stop offset="1" stopColor="#6e5a66" /></linearGradient>
        <linearGradient id="ry-kafdsh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0c1a24" stopOpacity="0" /><stop offset="1" stopColor="#0c1a24" stopOpacity=".35" /></linearGradient>
        <linearGradient id="ry-haze" x1="0" y1="460" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#d99a74" stopOpacity="0" /><stop offset=".55" stopColor="#d99a74" stopOpacity=".32" /><stop offset="1" stopColor="#b77a62" stopOpacity=".42" /></linearGradient>
        <pattern id="ry-kfl" width="6" height="5" patternUnits="userSpaceOnUse"><rect width="6" height=".8" fill="#a9d7dc" opacity=".16" /></pattern>
      </defs>
      <path d={ridge(5, 628, 26, 80)} fill="#6a5566" opacity=".45" />
      <path d={S.farD} fill="url(#ry-far)" />
      <Lit d={S.farL} op={.4} />
      <path d={KAFD} fill="url(#ry-kafd)" />
      <path d={KAFD} fill="url(#ry-kfl)" />
      <Lit d={S.kafdL} op={.45} />
      <path d="M1062 474L1066 700M1100 412L1106 700M1174 336L1196 360L1198 700M1236 392L1238 700M1270 420L1284 440M1398 452L1414 470" fill="none" stroke="#0e1d28" strokeWidth="3" opacity=".45" />
      <path d="M1152 372L1174 336L1196 360M1076 430L1100 412M1208 404L1236 392M1250 440L1270 420M1382 470L1398 452" fill="none" stroke="#9fe0dc" strokeWidth="1.2" opacity=".5" className="ry-breathe" />
      <Warn x={1174} y={333} d={.6} s={.8} />
      <rect y="460" width="1600" height="240" fill="url(#ry-haze)" />
    </Layer>

    <Layer depth={3}>
      <defs>
        <linearGradient id="ry-mid" x1="0" y1="440" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#1b353d" /><stop offset="1" stopColor="#0d2227" /></linearGradient>
        <linearGradient id="ry-lit" x1="0" y1="0" x2="1600" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#e5a27b" stopOpacity=".2" /><stop offset=".3" stopColor="#f0b28a" stopOpacity=".34" /><stop offset=".55" stopColor="#c98f7a" stopOpacity=".14" /><stop offset="1" stopColor="#8a8aa0" stopOpacity=".05" /></linearGradient>
        <linearGradient id="ry-dust" x1="0" y1="520" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#d08b62" stopOpacity="0" /><stop offset="1" stopColor="#d08b62" stopOpacity=".32" /></linearGradient>
        <linearGradient id="ry-kcv" x1="0" y1="100" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#7a7b9e" /><stop offset=".3" stopColor="#3f5568" /><stop offset=".7" stopColor="#1d3640" /><stop offset="1" stopColor="#0c2025" /></linearGradient>
        <linearGradient id="ry-kch" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f5c49c" stopOpacity=".6" /><stop offset=".12" stopColor="#f7dcc2" stopOpacity=".32" /><stop offset=".32" stopColor="#ffffff" stopOpacity=".04" />
          <stop offset=".55" stopColor="#031012" stopOpacity=".2" /><stop offset=".85" stopColor="#031012" stopOpacity=".6" /><stop offset="1" stopColor="#031012" stopOpacity=".78" />
        </linearGradient>
        <linearGradient id="ry-refl" x1="0" y1="100" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#e8ecff" stopOpacity=".45" /><stop offset=".45" stopColor="#c9d8ea" stopOpacity=".12" /><stop offset="1" stopColor="#c9d8ea" stopOpacity="0" /></linearGradient>
        <linearGradient id="ry-ledA" x1="0" y1="104" x2="0" y2="305" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#7fd4ff" /><stop offset="1" stopColor="#4a6dff" /></linearGradient>
        <linearGradient id="ry-ledB" x1="0" y1="104" x2="0" y2="305" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#c89bff" /><stop offset="1" stopColor="#7a4dff" /></linearGradient>
        <radialGradient id="ry-voidA" cx="745" cy="190" r="120" gradientTransform="matrix(.42 0 0 1 432.1 0)" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#5f8dff" stopOpacity=".55" /><stop offset="1" stopColor="#5f8dff" stopOpacity="0" /></radialGradient>
        <radialGradient id="ry-voidB" cx="745" cy="190" r="120" gradientTransform="matrix(.42 0 0 1 432.1 0)" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#a978ff" stopOpacity=".55" /><stop offset="1" stopColor="#a978ff" stopOpacity="0" /></radialGradient>
        <linearGradient id="ry-fsv" x1="0" y1="330" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#6a5a58" /><stop offset=".45" stopColor="#33383d" /><stop offset="1" stopColor="#12252a" /></linearGradient>
        <linearGradient id="ry-fsl" x1="0" y1="330" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f3c39a" stopOpacity=".42" /><stop offset="1" stopColor="#e5a27b" stopOpacity=".1" /></linearGradient>
        <radialGradient id="ry-ball" cx=".36" cy=".32" r=".75"><stop offset="0" stopColor="#fff4d6" /><stop offset=".3" stopColor="#ffd08a" /><stop offset=".7" stopColor="#d88a45" /><stop offset="1" stopColor="#6e3c1e" /></radialGradient>
        <radialGradient id="ry-gold"><stop offset="0" stopColor="#ffc983" stopOpacity=".55" /><stop offset=".4" stopColor="#f0a86a" stopOpacity=".18" /><stop offset="1" stopColor="#f0a86a" stopOpacity="0" /></radialGradient>
        <pattern id="ry-floors" width="7" height="5.5" patternUnits="userSpaceOnUse"><rect width="7" height=".7" fill="#b9cad6" opacity=".14" /><rect width=".6" height="5.5" fill="#01080a" opacity=".13" /></pattern>
        <clipPath id="ry-kc"><path d={KC} /></clipPath>
        <clipPath id="ry-fs"><path d={FS} /></clipPath>
      </defs>
      {/* office towers with volume: base, lit face toward the afterglow, shadow face, roof rim */}
      <path d={S.face} fill="url(#ry-mid)" />
      <path d={S.shade} fill="#020b0d" opacity=".32" />
      <path d={S.litF} fill="url(#ry-lit)" />
      <path d={S.rim} fill="none" stroke="#f2c39c" strokeWidth="1" opacity=".3" />
      <path d={S.ant} fill="#0d2227" />
      <Lit d={S.midL} op={.8} />
      {S.warns.map(([x, y], i) => <Warn key={i} x={x} y={y} d={i * .7} s={.8} />)}
      <rect y="520" width="1600" height="180" fill="url(#ry-dust)" />

      {/* Al Faisaliah: four-sided taper, corner ribs converging past the golden globe into the spire */}
      <circle cx="330" cy="318" r="90" fill="url(#ry-gold)" className="ry-breathe" />
      <path d={FS} fill="url(#ry-fsv)" />
      <path d="M288 700L309 350H330V700Z" fill="url(#ry-fsl)" />
      <path d="M330 700V350H351L372 700Z" fill="#020b0d" opacity=".45" />
      <g clipPath="url(#ry-fs)"><rect x="286" y="344" width="90" height="356" fill="url(#ry-floors)" /><Lit d={S.fsL} op={.75} /></g>
      <path d="M288 700L309 350M330 700V350M372 700L351 350" fill="none" stroke="#0b1b1f" strokeWidth="2.4" />
      <path d="M288 700L309 350" fill="none" stroke="#f3c29a" strokeWidth="1" opacity=".55" />
      <circle cx="330" cy="318" r="20" fill="url(#ry-ball)" />
      <path d="M310.5 318a19.5 5.5 0 0 0 39 0M314.5 306a15.5 3.6 0 0 0 31 0M314.5 330a15.5 3.6 0 0 0 31 0M330 298a8 20 0 0 0 0 40" fill="none" stroke="#7a4420" strokeWidth=".7" opacity=".45" />
      <path d="M309 350Q300 312 329 276M351 350Q360 312 331 276M330 350V340" fill="none" stroke="#0b1b1f" strokeWidth="3" />
      <path d="M309 350Q300 312 329 276" fill="none" stroke="#f3c29a" strokeWidth=".9" opacity=".5" />
      <rect x="306" y="346" width="48" height="6" fill="#0b1b1f" /><rect x="308" y="347.5" width="44" height="1.6" fill="#ffd9a8" opacity=".8" />
      <path d="M327.4 280L330 176L332.6 280Z" fill="#0b1b1f" />
      <Warn x={330} y={176} d={1.1} />

      {/* Kingdom Centre: tapering silver tower, parabolic void crossed by the sky bridge, LED edges */}
      <path d="M598 700V646Q745 630 892 646V700Z" fill="#0b1e22" /><path d="M606 650Q745 636 884 650" fill="none" stroke="#ffd9b0" strokeWidth="1.4" opacity=".55" />
      <ellipse cx="745" cy="200" rx="60" ry="120" fill="url(#ry-voidA)" className="ry-led-a" />
      <ellipse cx="745" cy="200" rx="60" ry="120" fill="url(#ry-voidB)" className="ry-led-b" />
      <path d={KC} fill="url(#ry-kcv)" />
      <g clipPath="url(#ry-kc)">
        <rect x="678" y="100" width="134" height="600" fill="url(#ry-floors)" />
        <rect x="694" y="100" width="7" height="600" fill="url(#ry-refl)" /><rect x="708" y="100" width="3" height="600" fill="url(#ry-refl)" /><rect x="772" y="100" width="4" height="600" fill="url(#ry-refl)" opacity=".5" />
        <Lit d={S.kcL} op={.7} />
        <path d={KC} fill="url(#ry-kch)" />
      </g>
      <path d="M680 700C690 480 703 262 711 110L722 104" fill="none" stroke="#f6cda6" strokeWidth="1.3" opacity=".75" />
      <path d="M779 110C787 262 800 480 810 700" fill="none" stroke="#7f8fb8" strokeWidth="1" opacity=".35" />
      <g className="ry-led-a"><path d={VOID} fill="none" stroke="url(#ry-ledA)" strokeWidth="9" opacity=".22" /><path d={VOID} fill="none" stroke="url(#ry-ledA)" strokeWidth="2" /></g>
      <g className="ry-led-b"><path d={VOID} fill="none" stroke="url(#ry-ledB)" strokeWidth="9" opacity=".22" /><path d={VOID} fill="none" stroke="url(#ry-ledB)" strokeWidth="2" /></g>
      <path d="M722.5 123Q745 133 767.5 123V129Q745 139 722.5 129Z" fill="#0e2328" />
      <path d="M723 126.5Q745 136.5 767 126.5" fill="none" stroke="#f4f7ff" strokeWidth="1.5" className="ry-breathe" />
      <Warn x={716} y={105} /><Warn x={774} y={105} d={.3} />
    </Layer>

    <Layer depth={4}>
      <defs>
        <linearGradient id="ry-road" x1="0" y1="620" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#15272a" /><stop offset=".45" stopColor="#0a1719" /><stop offset="1" stopColor="#040d0e" /></linearGradient>
        <linearGradient id="ry-head" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fffdf5" /><stop offset=".12" stopColor="#ffeccc" stopOpacity=".85" /><stop offset="1" stopColor="#ffd9a8" stopOpacity="0" /></linearGradient>
        <linearGradient id="ry-tail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#ff3b2e" stopOpacity="0" /><stop offset=".85" stopColor="#ff4a3a" stopOpacity=".85" /><stop offset="1" stopColor="#ff8a70" /></linearGradient>
        <radialGradient id="ry-lamp"><stop offset="0" stopColor="#ffe2b8" stopOpacity=".9" /><stop offset=".25" stopColor="#ffc98e" stopOpacity=".3" /><stop offset="1" stopColor="#ffc98e" stopOpacity="0" /></radialGradient>
        <radialGradient id="ry-up" cx=".5" cy="1" r=".9"><stop offset="0" stopColor="#ffb070" stopOpacity=".55" /><stop offset=".5" stopColor="#e98f55" stopOpacity=".14" /><stop offset="1" stopColor="#e98f55" stopOpacity="0" /></radialGradient>
        <radialGradient id="ry-win"><stop offset="0" stopColor="#ffbf7a" stopOpacity=".6" /><stop offset="1" stopColor="#ffbf7a" stopOpacity="0" /></radialGradient>
        <linearGradient id="ry-wall" x1="0" y1="570" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#2e1d15" /><stop offset=".6" stopColor="#4a2c1d" /><stop offset="1" stopColor="#6e4027" /></linearGradient>
        <linearGradient id="ry-wall2" x1="0" y1="560" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#1d1411" /><stop offset="1" stopColor="#40271a" /></linearGradient>
        <linearGradient id="ry-trunk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#061212" /><stop offset=".65" stopColor="#1c1612" /><stop offset="1" stopColor="#5a3522" /></linearGradient>
        <linearGradient id="ry-foot" x1="0" y1="664" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#030b0c" stopOpacity="0" /><stop offset="1" stopColor="#030b0c" stopOpacity=".7" /></linearGradient>
      </defs>
      {/* King Fahd Road: barrier, carriageways, long-exposure light trails, sodium lamps */}
      <rect x="-20" y="620" width="1660" height="80" fill="url(#ry-road)" />
      <rect x="-20" y="620" width="1660" height="1.2" fill="#e8b88f" opacity=".45" />
      <path d="M-20 637.5H1640" stroke="#2a3b3c" strokeWidth="1.4" />
      <path d="M-20 648H1640" stroke="#e8d7b8" strokeWidth=".8" strokeDasharray="14 18" opacity=".25" />
      {S.lamps.map((x, i) => <ellipse key={i} cx={x + 14} cy={637} rx="54" ry="8" fill="url(#ry-lamp)" opacity=".55" />)}
      <g>{S.cars.map((c, i) => <rect key={i} className={c.right ? 'ry-car ry-car--r' : 'ry-car'} x={c.right ? -140 : 1640} y={c.y} width={c.w} height={c.h} rx={c.h / 2} fill={c.right ? 'url(#ry-tail)' : 'url(#ry-head)'} style={{ animationDuration: `${c.dur}s`, animationDelay: `${-c.del}s` }} />)}</g>
      <path d={S.lamps.map((x) => `M${x} 622V552q0 -7 8 -7h7v2h-6q-7 0 -7 6V622z`).join('')} fill="#0a1618" />
      {S.lamps.map((x, i) => <g key={i}><circle cx={x + 14} cy={547} r="22" fill="url(#ry-lamp)" /><rect x={x + 10} y={546.5} width="8" height="1.6" fill="#fff0d6" /></g>)}

      {/* Najdi mud-brick quarter, lit from below */}
      <g>
        <path d={S.tw2.d} fill="url(#ry-wall2)" /><path d={S.tw2.holes} fill="#0d0806" /><path d={S.tw2.lit} fill="#ffbf7a" />
        <path d={S.back.wall + S.back.crest} fill="url(#ry-wall2)" />
        <path d={S.back.rib} fill="#000" opacity=".22" />
        <path d={S.back.edge} stroke="#d49a70" strokeWidth="1" opacity=".22" />
        <path d={S.back.vent + S.back.door} fill="#0d0806" />
        <path d={S.back.lit} fill="#ffbf7a" opacity=".9" />
        {S.back.glow.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="13" fill="url(#ry-win)" className={i % 4 === 0 ? 'cs-glow' : undefined} />)}
        <path d={S.tw1.d} fill="url(#ry-wall2)" /><path d={S.tw1.holes} fill="#0d0806" /><path d={S.tw1.lit} fill="#ffbf7a" />
        {[190, 330, 950, 1110, 1420, 1560].map((x, i) => <ellipse key={i} cx={x} cy={700} rx="60" ry="110" fill="url(#ry-up)" />)}
      </g>
      <Palm x={470} s={1.18} lean={-10} /><Palm x={545} s={.92} lean={8} /><Palm x={612} s={1.08} lean={12} />
      <Palm x={858} s={1.02} lean={-8} /><Palm x={1250} s={1.15} lean={6} /><Palm x={1305} s={.86} lean={-6} />
      <g>
        <path d={S.front.wall + S.front.crest} fill="url(#ry-wall)" />
        <path d={S.front.rib} fill="#000" opacity=".2" />
        <path d={S.front.edge} stroke="#e8b089" strokeWidth="1" opacity=".3" />
        <path d={S.front.vent + S.front.door} fill="#140a06" />
        <path d={S.front.lit} fill="#ffc88a" />
        {S.front.glow.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="16" fill="url(#ry-win)" className={i % 3 === 0 ? 'cs-glow' : undefined} />)}
      </g>
      <Palm x={200} s={1.05} lean={10} /><Palm x={1110} s={1.2} lean={-9} />
      <rect x="-20" y="664" width="1660" height="36" fill="url(#ry-foot)" />
      <Residents id="ry-pp" crowd={riyadhCrowd} />
    </Layer>
  </>;
});
