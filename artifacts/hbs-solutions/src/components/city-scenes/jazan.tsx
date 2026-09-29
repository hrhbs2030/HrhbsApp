import { memo, type ReactNode } from 'react';
import { Layer, blocks, rng } from './kit';
import './jazan.css';

/* ---------------- Jazan by moonlight: Fayfa ranges with coffee terraces and hill villages,
   the floodlit Dosariyah fort over the city and the Red Sea bay, Tihama huts and palms ---------------- */

type P = [number, number];
const n1 = (v: number) => Math.round(v * 10) / 10;
const MOON: P = [520, 108];

// Midpoint-displacement ridgeline through hand-placed control points.
function fractal(seed: number, ctrl: P[], levels = 5, rough = .34): P[] {
  const r = rng(seed); let pts = ctrl;
  for (let l = 0; l < levels; l++) {
    const out: P[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const len = Math.hypot(bx - ax, by - ay);
      out.push([(ax + bx) / 2 + (r() - .5) * (bx - ax) * .2, (ay + by) / 2 + (r() - .5) * len * rough], pts[i]);
    }
    pts = out;
  }
  return pts;
}
const line = (pts: P[]) => 'M' + pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join(' L');
const shape = (pts: P[], floor = 700) => `${line(pts)} L${n1(pts[pts.length - 1][0])} ${floor} L${n1(pts[0][0])} ${floor} Z`;
function yAt(pts: P[], x: number) {
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; return ay + (by - ay) * ((x - ax) / (bx - ax || 1)); }
  return pts[pts.length - 1][1];
}
// Ridge segments facing the moon, for a cool rim light.
function rimPath(pts: P[]) {
  let d = ''; let open = false;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const lit = (ax + bx) / 2 < MOON[0] ? by > ay : by < ay;
    if (lit) { d += open ? ` L${n1(bx)} ${n1(by)}` : ` M${n1(ax)} ${n1(ay)} L${n1(bx)} ${n1(by)}`; open = true; } else open = false;
  }
  return d;
}
// Moonlit flank below each peak, on the side facing the moon.
function flanks(ctrl: P[], pts: P[]) {
  const out: string[] = [];
  for (let i = 1; i < ctrl.length - 1; i++) {
    const [px, py] = ctrl[i]; if (!(py < ctrl[i - 1][1] && py < ctrl[i + 1][1])) continue;
    const v = ctrl[px < MOON[0] ? i + 1 : i - 1]; const [vx, vy] = v;
    const seg = pts.filter(([x]) => (x - px) * (x - vx) <= 0).sort((a, b) => Math.abs(a[0] - px) - Math.abs(b[0] - px));
    const drop = vy - py;
    out.push(`${line(seg)} L${n1(vx)} ${n1(vy + 30)} L${n1(px + (vx - px) * .12)} ${n1(py + drop * 1.4 + 40)} Z`);
  }
  return out.join(' ');
}

/* ---------- sky ---------- */
function starField() {
  const r = rng(91); const out: ReactNode[] = [];
  for (let i = 0; i < 200; i++) {
    const x = r() * 1600, y = Math.pow(r(), 1.8) * 440, rad = r() * .9 + .3, o = r();
    if (Math.hypot(x - MOON[0], y - MOON[1]) < 95) continue;
    const op = (.25 + o * .7) * (1 - y / 520);
    out.push(<circle key={i} cx={n1(x)} cy={n1(y)} r={n1(rad)} opacity={n1(op * 100) / 100} className={i % 9 === 0 ? 'cs-twinkle' : undefined} style={i % 9 === 0 ? { animationDelay: `${(i % 11) * .6}s` } : undefined} />);
  }
  // Milky Way dust along a diagonal band
  for (let i = 0; i < 70; i++) {
    const t = r(), g = (r() + r() + r() - 1.5) * 60;
    out.push(<circle key={`m${i}`} cx={n1(40 + t * 900 + g * .5)} cy={n1(360 - t * 420 + g)} r={n1(r() * .6 + .25)} opacity={n1(r() * 50 + 20) / 100} />);
  }
  return out;
}
function cloudBank(seed: number, cx: number, cy: number, w: number, n: number, fill: string, op: number) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => <ellipse key={i} cx={n1(cx + (r() - .5) * w)} cy={n1(cy + (r() - .5) * 14)} rx={n1(50 + r() * 90)} ry={n1(5 + r() * 11)} fill={fill} opacity={n1((op * (.6 + r() * .4)) * 100) / 100} />);
}

/* ---------- mountains ---------- */
const C1: P[] = [[-20, 470], [90, 420], [200, 392], [330, 418], [450, 448], [560, 472], [680, 496], [780, 488], [900, 432], [1010, 372], [1130, 342], [1250, 378], [1380, 330], [1500, 360], [1640, 392]];
const C2: P[] = [[-20, 520], [100, 476], [230, 446], [350, 478], [470, 526], [600, 560], [720, 574], [850, 540], [960, 476], [1080, 438], [1200, 468], [1330, 426], [1460, 458], [1640, 444]];
const C3: P[] = [[-20, 566], [80, 508], [190, 452], [292, 430], [388, 466], [476, 540], [560, 598], [700, 604], [860, 602], [960, 556], [1060, 506], [1170, 486], [1290, 516], [1400, 474], [1520, 502], [1640, 486]];
const R1 = fractal(11, C1, 5, .3), R2 = fractal(23, C2, 5, .34), R3 = fractal(37, C3, 5, .38);
const R3s = fractal(37, C3, 2, .38);

// Coffee/qat terraces: contour strata following the smoothed slope, flattening lower down.
function terraces(xa: number, xb: number, n: number) {
  const r = rng(53); const lit: string[] = [], dark: string[] = [];
  for (let k = 1; k <= n; k++) {
    const off = k * 6.2; const t = Math.min(.75, k / n);
    let x = xa + r() * 20;
    while (x < xb) {
      const len = 26 + r() * 70; const pts: P[] = [];
      for (let xx = x; xx <= Math.min(xb, x + len); xx += 8) pts.push([xx, yAt(R3s, xx) * (1 - t) + (yAt(R3s, xa) + 40) * t + off + (r() - .5) * 1.4]);
      if (pts.length > 1) { lit.push(line(pts)); dark.push(line(pts.map(([px, py]) => [px, py + 1.8] as P))); }
      x += len + 4 + r() * 16;
    }
  }
  return { lit: lit.join(' '), dark: dark.join(' ') };
}
const TER = terraces(60, 470, 22);
const TER2 = terraces(1000, 1250, 12);

// Stone houses perched on ridges (Fayfa), with warm windows.
function village(seed: number, pts: P[], cx: number, spread: number, n: number, depth: number, dim = 1) {
  const r = rng(seed); const houses: ReactNode[] = []; const lights: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const x = cx + (r() - .5) * spread, w = 3.5 + r() * 4.5, h = 3 + r() * 3.5, y = yAt(pts, x) + 2 + r() * depth;
    houses.push(<g key={i}><rect x={n1(x)} y={n1(y - h)} width={n1(w)} height={n1(h)} fill="#1d3a40" /><rect x={n1(x)} y={n1(y - h)} width={n1(w * .45)} height={n1(h)} fill="#4b6b6b" opacity=".45" /></g>);
    if (r() < .62) {
      const tw = r() < .3;
      lights.push(<rect key={i} x={n1(x + 1 + r() * (w - 2.5))} y={n1(y - h + 1.8)} width="1.2" height="1.5" fill="#ffcf94" opacity={dim} className={tw ? 'cs-twinkle' : undefined} style={tw ? { animationDelay: `${n1(r() * 5)}s` } : undefined} />);
    }
  }
  return <g>{houses}{lights}</g>;
}
function distantLights(seed: number, pts: P[], xa: number, xb: number, n: number, depth: number) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => { const x = xa + r() * (xb - xa); return <circle key={i} cx={n1(x)} cy={n1(yAt(pts, x) + 6 + r() * depth)} r={n1(.6 + r() * .6)} fill="#ffd6a0" opacity={n1(40 + r() * 50) / 100} className={i % 4 === 0 ? 'cs-twinkle' : undefined} style={i % 4 === 0 ? { animationDelay: `${n1(r() * 6)}s` } : undefined} />; });
}
function mist(seed: number, y: number, n: number, cls: string) {
  const r = rng(seed);
  return <g className={cls}>{Array.from({ length: n }, (_, i) => <ellipse key={i} cx={n1(r() * 1600)} cy={n1(y + (r() - .5) * 16)} rx={n1(160 + r() * 220)} ry={n1(10 + r() * 14)} fill="url(#jz-mist)" />)}</g>;
}

/* ---------- Dosariyah fort ---------- */
function stoneCourses(x0: number, x1: number, y0: number, y1: number, seed: number, sag = 0) {
  const r = rng(seed); let h = '', v = '';
  for (let y = y0 + 5; y < y1 - 1; y += 5.2) {
    h += ` M${n1(x0)} ${n1(y)} Q${n1((x0 + x1) / 2)} ${n1(y + sag)} ${n1(x1)} ${n1(y)}`;
    for (let x = x0 + r() * 8; x < x1 - 3; x += 7 + r() * 9) v += ` M${n1(x)} ${n1(y)} v5.2`;
  }
  return <path d={h + v} fill="none" stroke="#2a1c14" strokeOpacity=".28" strokeWidth=".6" />;
}
function merlons(x0: number, x1: number, top: number, h = 6, w = 5, gap = 3.6) {
  let d = ''; for (let x = x0; x + w <= x1 + .1; x += w + gap) d += ` M${n1(x)} ${top + h} v${-h + 1.5} l${w / 2} -1.5 l${w / 2} 1.5 v${h - 1.5} Z`;
  return d;
}
function Tower({ cx, r, top, base, shade = false }: { cx: number; r: number; top: number; base: number; shade?: boolean }) {
  return <g>
    <rect x={cx - r} y={top + 12} width={r * 2} height={base - top - 12} fill={shade ? 'url(#jz-towerS)' : 'url(#jz-tower)'} />
    <rect x={cx - r - 2} y={top + 6} width={r * 2 + 4} height="7" fill={shade ? '#3a2f2b' : 'url(#jz-tower)'} />
    <path d={merlons(cx - r - 2, cx + r + 2, top, 6, 4.4, 3)} fill={shade ? '#332925' : '#9c7658'} />
    <rect x={cx - r} y={top + 12} width={r * 2} height={base - top - 12} fill="url(#jz-topshade)" />
    {!shade && <>{stoneCourses(cx - r, cx + r, top + 13, base, cx, 1.4)}<rect x={cx - 1} y={top + 26} width="2" height="9" fill="#24160f" /><rect x={cx - 1} y={top + 50} width="2" height="9" fill="#24160f" /></>}
  </g>;
}
function Fort() {
  const B = 551;
  return <g>
    {/* receding right side, in shadow */}
    <Tower cx={834} r={8} top={462} base={B - 6} shade />
    <path d={`M806 480 L830 475 L830 ${B - 5} L806 ${B}Z`} fill="url(#jz-side)" />
    <path d={merlons(808, 828, 468, 6, 4, 3)} fill="#2e2522" />
    {/* front curtain wall */}
    <rect x="676" y="480" width="130" height={B - 480} fill="url(#jz-wall)" />
    <path d={merlons(682, 800, 473, 7, 5, 3.6)} fill="#8d6a50" />
    <rect x="676" y="478" width="130" height="3" fill="#6e5442" />
    {stoneCourses(690, 792, 481, B, 7)}
    <rect x="676" y="480" width="130" height={B - 480} fill="url(#jz-topshade)" />
    {/* gate and windows */}
    <path d="M731 551 V530 Q741 515 751 530 V551 Z" fill="#c69669" />
    <path d="M734 551 V531 Q741 520 748 531 V551 Z" fill="url(#jz-gate)" />
    <path d="M703 512 v-7 q3 -4 6 0 v7 Z M773 512 v-7 q3 -4 6 0 v7 Z" fill="#ffc88f" opacity=".75" className="cs-glow" />
    <rect x="720" y="494" width="2" height="7" fill="#2a1a12" /><rect x="760" y="494" width="2" height="7" fill="#2a1a12" />
    <Tower cx={676} r={16} top={452} base={B + 1} />
    <Tower cx={806} r={16} top={454} base={B + 1} />
    {/* floodlight wash and pools */}
    <ellipse cx="741" cy="540" rx="120" ry="34" fill="url(#jz-flood)" opacity=".55" />
    {[684, 741, 800].map((x) => <ellipse key={x} cx={x} cy={B + 2} rx="26" ry="6" fill="url(#jz-flood)" />)}
    {/* cool moon rim on the moon-facing edges */}
    <path d="M660.5 548 V466 M692 478 H700" stroke="#cfe6e4" strokeOpacity=".35" strokeWidth="1.1" fill="none" />
  </g>;
}
const hillPts = fractal(71, [[520, 700], [560, 664], [612, 636], [650, 596], [676, 566], [700, 552], [790, 551], [846, 560], [884, 594], [936, 630], [990, 662], [1030, 700]], 4, .12);
const stairs: P[] = [[616, 662], [688, 628], [652, 603], [716, 574], [741, 553]];
function lampsAlong(pts: P[], step: number) {
  const out: P[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i]; const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}

/* ---------- city at the foot of the hill ---------- */
const cityL = blocks(61, 420, 640, 10, 34, 8, 22);
const cityC = blocks(63, 640, 890, 5, 16, 8, 20);
const cityR = blocks(67, 890, 1440, 10, 40, 9, 24);
function cityWindows(list: ReturnType<typeof blocks>, seed: number, ground: number) {
  const r = rng(seed); const out: ReactNode[] = [];
  list.forEach((b, bi) => {
    for (let y = ground - b.h + 3; y < ground - 3; y += 4.5) for (let x = b.x + 2; x < b.x + b.w - 2.5; x += 4) {
      if (r() > .2) continue; const tw = r() < .08;
      out.push(<rect key={`${bi}-${n1(x)}-${n1(y)}`} x={n1(x)} y={n1(y)} width="1.6" height="1.8" fill={r() < .18 ? '#d9ecf0' : '#ffcf96'} className={tw ? 'cs-twinkle' : undefined} style={tw ? { animationDelay: `${n1(r() * 6)}s` } : undefined} />);
    }
  });
  return out;
}
function streetLights(seed: number, xa: number, xb: number, y: number, step: number, dy = 0) {
  const r = rng(seed);
  return Array.from({ length: Math.floor((xb - xa) / step) }, (_, i) => <circle key={i} cx={n1(xa + i * step + r() * 3)} cy={n1(y + dy * i + (r() - .5) * 1.5)} r="1" />);
}

/* ---------- foreground: Tihama huts, palms, banana, mango ---------- */
function Hut({ x, g, s, seed }: { x: number; g: number; s: number; seed: number }) {
  const r = rng(seed); const ex = 38 * s, ey = g - 42 * s, ax = x + (r() - .5) * 3 * s, ay = g - 122 * s;
  let eave = `M${n1(x - ex)} ${n1(ey)}`; for (let k = 1; k <= 14; k++) eave += ` L${n1(x - ex + (2 * ex * k) / 14)} ${n1(ey + (k % 2 ? 3.5 : 0) * s + Math.sin(k / 14 * Math.PI) * 4 * s)}`;
  const roof = `M${n1(ax)} ${n1(ay)} Q${n1(x - ex * .45)} ${n1(ey - 44 * s)} ${n1(x - ex)} ${n1(ey)} ${eave.slice(eave.indexOf('L'))} Q${n1(x + ex * .45)} ${n1(ey - 44 * s)} ${n1(ax)} ${n1(ay)} Z`;
  let straw = ''; for (let k = 1; k < 16; k++) { const t = k / 16; const bx = x - ex + 2 * ex * t; straw += ` M${n1(ax + (bx - ax) * .12)} ${n1(ay + (ey - ay) * .12)} Q${n1(ax + (bx - ax) * .55 + (t - .5) * -10 * s)} ${n1(ay + (ey - ay) * .5)} ${n1(bx)} ${n1(ey + Math.sin(t * Math.PI) * 4 * s)}`; }
  let rings = ''; for (const t of [.34, .58, .8]) { const hw = ex * (t * .95), yy = ay + (ey - ay) * t; rings += ` M${n1(x - hw)} ${n1(yy)} Q${n1(x)} ${n1(yy + 6 * s * t)} ${n1(x + hw)} ${n1(yy)}`; }
  let sticks = ''; for (let k = 1; k < 9; k++) sticks += ` M${n1(x - 27 * s + k * 6 * s)} ${n1(ey + 4 * s)} V${g}`;
  return <g>
    <ellipse cx={x} cy={g - 2} rx={60 * s} ry={7 * s} fill="url(#jz-door)" opacity=".7" />
    <path d={`M${n1(x - 28 * s)} ${g} L${n1(x - 26 * s)} ${n1(ey + 2 * s)} L${n1(x + 26 * s)} ${n1(ey + 2 * s)} L${n1(x + 28 * s)} ${g} Z`} fill="url(#jz-hutwall)" />
    <path d={sticks} stroke="#020707" strokeOpacity=".7" strokeWidth={s} />
    <path d={`M${n1(x - 7 * s)} ${g} V${n1(g - 22 * s)} Q${x} ${n1(g - 30 * s)} ${n1(x + 7 * s)} ${n1(g - 22 * s)} V${g} Z`} fill="url(#jz-doorway)" className="cs-glow" style={{ animationDelay: `${n1(r() * 3)}s` }} />
    <path d={roof} fill="#0b1b1c" />
    <path d={straw} fill="none" stroke="#314c49" strokeOpacity=".55" strokeWidth={.8 * s} />
    <path d={rings} fill="none" stroke="#5d756d" strokeOpacity=".5" strokeWidth={1.4 * s} />
    <path d={`M${n1(ax)} ${n1(ay)} Q${n1(x - ex * .45)} ${n1(ey - 44 * s)} ${n1(x - ex)} ${n1(ey)}`} fill="none" stroke="#a9c8c2" strokeOpacity=".35" strokeWidth={1.2 * s} />
    <path d={`M${n1(ax)} ${n1(ay + 2)} V${n1(ay - 9 * s)}`} stroke="#0b1b1c" strokeWidth={1.6 * s} /><circle cx={n1(ax)} cy={n1(ay - 10 * s)} r={n1(2 * s)} fill="#0b1b1c" />
  </g>;
}
function DatePalm({ x, g, s, lean, seed, fill = '#030b0c' }: { x: number; g: number; s: number; lean: number; seed: number; fill?: string }) {
  const r = rng(seed); const H = (150 + r() * 40) * s; const tx = x + lean * s, ty = g - H;
  const trunk = `M${n1(x - 6 * s)} ${g} Q${n1(x + lean * .2 * s)} ${n1(g - H * .5)} ${n1(tx - 3.5 * s)} ${n1(ty)} L${n1(tx + 3.5 * s)} ${n1(ty)} Q${n1(x + lean * .2 * s + 8 * s)} ${n1(g - H * .5)} ${n1(x + 6 * s)} ${g} Z`;
  let scars = ''; for (let k = 1; k < 26; k++) { const t = k / 26, cx2 = x + (tx - x) * t * t * .9 + lean * .1 * s * t, cy2 = g - H * t; scars += ` M${n1(cx2 - (6 - 2.5 * t) * s)} ${n1(cy2)} l${n1((12 - 5 * t) * s)} ${n1(-1.5 * s)}`; }
  const fronds: string[] = [];
  const nF = 15;
  for (let i = 0; i < nF; i++) {
    const a = -Math.PI + (i / (nF - 1)) * Math.PI + (r() - .5) * .25; const L = (58 + r() * 26) * s;
    const dx = Math.cos(a), dy = Math.sin(a); const droop = (1 - Math.abs(dy)) * L * .55 + L * .12;
    const c: P = [tx + dx * L * .55, ty + dy * L * .55 - 10 * s], e: P = [tx + dx * L, ty + dy * L * .6 + droop];
    let d = `M${n1(tx)} ${n1(ty)} Q${n1(c[0])} ${n1(c[1])} ${n1(e[0])} ${n1(e[1])}`;
    for (let k = 2; k < 13; k++) {
      const t = k / 13, it = 1 - t; const px = it * it * tx + 2 * it * t * c[0] + t * t * e[0], py = it * it * ty + 2 * it * t * c[1] + t * t * e[1];
      const tgx = 2 * it * (c[0] - tx) + 2 * t * (e[0] - c[0]), tgy = 2 * it * (c[1] - ty) + 2 * t * (e[1] - c[1]); const tl = Math.hypot(tgx, tgy) || 1;
      const ux = tgx / tl, uy = tgy / tl; const ll = (11 - 7 * t) * s;
      d += ` M${n1(px)} ${n1(py)} l${n1((ux * .8 - uy * .55) * ll)} ${n1((uy * .8 + ux * .55) * ll + 2.5 * s)} M${n1(px)} ${n1(py)} l${n1((ux * .8 + uy * .55) * ll)} ${n1((uy * .8 - ux * .55) * ll + 2.5 * s)}`;
    }
    fronds.push(d);
  }
  return <g>
    <path d={trunk} fill={fill} />
    <path d={scars} stroke="#1d3433" strokeOpacity=".7" strokeWidth={1.1 * s} />
    <path d={fronds.join(' ')} fill="none" stroke={fill} strokeWidth={1.25 * s} strokeLinecap="round" />
    <path d={`M${n1(tx - 8 * s)} ${n1(ty + 4 * s)} q-3 ${n1(9 * s)} -2 ${n1(15 * s)} M${n1(tx + 6 * s)} ${n1(ty + 4 * s)} q4 ${n1(8 * s)} 3 ${n1(14 * s)}`} stroke="#1a110b" strokeWidth={3 * s} strokeLinecap="round" />
  </g>;
}
function Banana({ x, g, s, seed }: { x: number; g: number; s: number; seed: number }) {
  const r = rng(seed); const leaves: string[] = [];
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * .42 + (r() - .5) * .2, L = (46 + r() * 22) * s; const bx = x, by = g - 34 * s;
    const ex = bx + Math.cos(a) * L, ey = by + Math.sin(a) * L * .7 + Math.abs(i - 3) * 9 * s; const nx = -Math.sin(a) * 13 * s, ny = Math.cos(a) * 7 * s;
    leaves.push(`M${n1(bx)} ${n1(by)} Q${n1((bx + ex) / 2 + nx)} ${n1((by + ey) / 2 + ny - 8 * s)} ${n1(ex)} ${n1(ey)} Q${n1((bx + ex) / 2 - nx)} ${n1((by + ey) / 2 - ny - 4 * s)} ${n1(bx)} ${n1(by)} Z`);
  }
  return <g fill="#051314"><path d={`M${n1(x - 4 * s)} ${g} L${n1(x - 2 * s)} ${n1(g - 36 * s)} L${n1(x + 2 * s)} ${n1(g - 36 * s)} L${n1(x + 4 * s)} ${g} Z`} /><path d={leaves.join(' ')} /></g>;
}
function Mango({ x, g, s, seed }: { x: number; g: number; s: number; seed: number }) {
  const r = rng(seed); const dark: ReactNode[] = [], lit: ReactNode[] = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()); const cx = x + Math.cos(a) * d * 58 * s, cy = g - 92 * s + Math.sin(a) * d * 34 * s, rad = (14 + r() * 12) * s;
    dark.push(<circle key={i} cx={n1(cx)} cy={n1(cy)} r={n1(rad)} />);
    if (Math.cos(a) < .1 && Math.sin(a) < .3) lit.push(<circle key={i} cx={n1(cx - 2 * s)} cy={n1(cy - 2 * s)} r={n1(rad * .8)} />);
  }
  return <g><path d={`M${n1(x - 5 * s)} ${g} L${n1(x - 3 * s)} ${n1(g - 70 * s)} L${n1(x + 3 * s)} ${n1(g - 70 * s)} L${n1(x + 5 * s)} ${g} Z`} fill="#041011" /><g fill="#1a3433" opacity=".9">{lit}</g><g fill="#041011" transform={`translate(${n1(2 * s)} ${n1(2 * s)})`}>{dark}</g></g>;
}
function groundEdge(seed: number) {
  const r = rng(seed); let d = 'M-20 700 L-20 690';
  for (let x = -20; x <= 1640; x += 6) {
    const base = x < 560 ? 690 - (x + 20) * .01 : x < 900 ? 684 - (x - 560) * .045 : 668 + Math.sin(x / 90) * 3;
    d += ` L${x} ${n1(base - (r() < .3 ? r() * 9 : r() * 2))}`;
  }
  return d + ' L1640 700 Z';
}
function fireflies() {
  const r = rng(97);
  return Array.from({ length: 12 }, (_, i) => <g key={i} className="jz-fly" style={{ animationDelay: `${n1(r() * 8)}s`, animationDuration: `${n1(7 + r() * 5)}s` }}>
    <circle cx={n1(900 + r() * 520)} cy={n1(600 + r() * 70)} r="1.3" fill="#ffe7a8" />
  </g>);
}

export const JazanScene = memo(function JazanScene() {
  return <>
    <Layer depth={1}>
      <defs>
        <linearGradient id="jz-sky" x1="0" y1="0" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#040d15" /><stop offset=".28" stopColor="#0a1e2a" /><stop offset=".52" stopColor="#123441" /><stop offset=".7" stopColor="#1e4c56" /><stop offset=".84" stopColor="#35656a" /><stop offset="1" stopColor="#4d7773" /></linearGradient>
        <radialGradient id="jz-halo"><stop offset="0" stopColor="#e9f1ea" stopOpacity=".5" /><stop offset=".25" stopColor="#bcd6d3" stopOpacity=".2" /><stop offset="1" stopColor="#8fb3b3" stopOpacity="0" /></radialGradient>
        <radialGradient id="jz-moon" cx=".42" cy=".4" r=".62"><stop offset="0" stopColor="#fffaf0" /><stop offset=".7" stopColor="#f1e9d6" /><stop offset="1" stopColor="#d7ccb4" /></radialGradient>
        <radialGradient id="jz-cloud" fy=".3"><stop offset="0" stopColor="#8aa3a6" stopOpacity=".55" /><stop offset=".6" stopColor="#4c6c72" stopOpacity=".25" /><stop offset="1" stopColor="#2f4f57" stopOpacity="0" /></radialGradient>
        <radialGradient id="jz-cloudlit" fy=".2"><stop offset="0" stopColor="#f3efe2" stopOpacity=".75" /><stop offset=".45" stopColor="#a9c0bd" stopOpacity=".32" /><stop offset="1" stopColor="#5b7c80" stopOpacity="0" /></radialGradient>
        <radialGradient id="jz-mw"><stop offset="0" stopColor="#c9d6dc" stopOpacity=".13" /><stop offset="1" stopColor="#c9d6dc" stopOpacity="0" /></radialGradient>
        <radialGradient id="jz-warm"><stop offset="0" stopColor="#e5a27b" stopOpacity=".38" /><stop offset="1" stopColor="#e5a27b" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1600" height="700" fill="url(#jz-sky)" />
      <ellipse cx="470" cy="160" rx="560" ry="70" fill="url(#jz-mw)" transform="rotate(-25 470 160)" />
      <g fill="#f6efe3">{starField()}</g>
      <g className="jz-cloud">
        {cloudBank(3, 1250, 90, 520, 9, 'url(#jz-cloud)', .5)}
        {cloudBank(5, 220, 270, 420, 8, 'url(#jz-cloud)', .6)}
        {cloudBank(8, 1150, 300, 700, 10, 'url(#jz-cloud)', .55)}
      </g>
      <circle cx={MOON[0]} cy={MOON[1]} r="330" fill="url(#jz-halo)" opacity=".55" />
      <circle cx={MOON[0]} cy={MOON[1]} r="95" fill="url(#jz-halo)" />
      <circle cx={MOON[0]} cy={MOON[1]} r="17" fill="url(#jz-moon)" />
      <g fill="#a8a08e" opacity=".18"><ellipse cx="514" cy="103" rx="5" ry="3.5" /><ellipse cx="523" cy="111" rx="4" ry="3" /><circle cx="512" cy="113" r="2.2" /><ellipse cx="527" cy="100" rx="2.5" ry="2" /></g>
      <g className="jz-cloud">{cloudBank(13, 560, 134, 300, 9, 'url(#jz-cloudlit)', .9)}{cloudBank(17, 700, 176, 360, 7, 'url(#jz-cloudlit)', .5)}</g>
      <ellipse cx="720" cy="640" rx="720" ry="130" fill="url(#jz-warm)" />
    </Layer>
    <Layer depth={2}>
      <defs>
        <linearGradient id="jz-r1" x1="0" y1="320" x2="0" y2="620" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#2a4f5a" /><stop offset="1" stopColor="#3d6868" /></linearGradient>
        <linearGradient id="jz-r2" x1="0" y1="420" x2="0" y2="640" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#163640" /><stop offset="1" stopColor="#264a4c" /></linearGradient>
        <linearGradient id="jz-r3" x1="0" y1="430" x2="0" y2="640" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#0c232a" /><stop offset="1" stopColor="#15373a" /></linearGradient>
        <linearGradient id="jz-lit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a8cfc9" stopOpacity=".26" /><stop offset=".45" stopColor="#a8cfc9" stopOpacity=".06" /><stop offset=".8" stopColor="#a8cfc9" stopOpacity="0" /></linearGradient>
        <radialGradient id="jz-mist"><stop offset="0" stopColor="#b8dcd6" stopOpacity=".22" /><stop offset="1" stopColor="#b8dcd6" stopOpacity="0" /></radialGradient>
        <linearGradient id="jz-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fbab5" stopOpacity="0" /><stop offset=".7" stopColor="#8fbab5" stopOpacity=".15" /><stop offset="1" stopColor="#8fbab5" stopOpacity="0" /></linearGradient>
        <linearGradient id="jz-ter" x1="60" y1="0" x2="470" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#8fc4a6" stopOpacity="0" /><stop offset=".3" stopColor="#8fc4a6" stopOpacity=".4" /><stop offset=".8" stopColor="#8fc4a6" stopOpacity=".32" /><stop offset="1" stopColor="#8fc4a6" stopOpacity="0" /></linearGradient>
        <linearGradient id="jz-ter2" x1="1000" y1="0" x2="1250" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#8fc4a6" stopOpacity="0" /><stop offset=".5" stopColor="#8fc4a6" stopOpacity=".2" /><stop offset="1" stopColor="#8fc4a6" stopOpacity="0" /></linearGradient>
        <linearGradient id="jz-sea" x1="0" y1="598" x2="0" y2="664" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#3b6a70" /><stop offset=".25" stopColor="#1f444b" /><stop offset="1" stopColor="#0a2127" /></linearGradient>
        <radialGradient id="jz-seaglow"><stop offset="0" stopColor="#e6efe6" stopOpacity=".3" /><stop offset="1" stopColor="#e6efe6" stopOpacity="0" /></radialGradient>
        <clipPath id="jz-r3clip"><path d={shape(R3)} /></clipPath>
      </defs>
      <path d={shape(R1)} fill="url(#jz-r1)" />
            <path d={rimPath(R1)} fill="none" stroke="#cfe6e0" strokeOpacity=".25" strokeWidth="1" />
      <rect x="-20" y="440" width="1680" height="130" fill="url(#jz-haze)" />
      {mist(29, 520, 8, 'jz-mist')}
      <path d={shape(R2)} fill="url(#jz-r2)" />
      <path d={flanks(C2, R2)} fill="url(#jz-lit)" opacity=".45" />
      <path d={rimPath(R2)} fill="none" stroke="#cfe6e0" strokeOpacity=".3" strokeWidth="1" />
      <g>{distantLights(41, R2, 60, 1560, 26, 40)}</g>
      <rect x="-20" y="500" width="1680" height="110" fill="url(#jz-haze)" />
      {mist(31, 556, 9, 'jz-mist jz-mist--b')}
      <path d={shape(R3)} fill="url(#jz-r3)" />
      <path d={flanks(C3, R3)} fill="url(#jz-lit)" opacity=".7" />
      <g clipPath="url(#jz-r3clip)">
        <path d={TER.dark} fill="none" stroke="#06161a" strokeOpacity=".55" strokeWidth="1" />
        <path d={TER.lit} fill="none" stroke="url(#jz-ter)" strokeWidth=".9" />
        <path d={TER2.dark} fill="none" stroke="#06161a" strokeOpacity=".5" strokeWidth="1" />
        <path d={TER2.lit} fill="none" stroke="url(#jz-ter2)" strokeWidth="1" />
      </g>
      <path d={rimPath(R3)} fill="none" stroke="#d6ece6" strokeOpacity=".4" strokeWidth="1.2" />
      {village(43, R3, 292, 80, 16, 26)}
      {village(47, R3, 196, 60, 9, 30)}
      {village(49, R3, 1170, 90, 12, 24, .7)}
      {village(59, R3, 1400, 70, 9, 22, .6)}
      {/* hilltop mast with a slow aviation light */}
      <path d={`M${292} ${n1(yAt(R3, 292) - 2)} V${n1(yAt(R3, 292) - 36)}`} stroke="#0a1d22" strokeWidth="1.4" />
      <circle cx="292" cy={n1(yAt(R3, 292) - 37)} r="1.8" fill="#ff5a4a" className="jz-blink" />
      <circle cx="292" cy={n1(yAt(R3, 292) - 37)} r="6" fill="#ff5a4a" opacity=".25" className="jz-blink" />
      <rect x="-20" y="560" width="1680" height="70" fill="url(#jz-haze)" />
      {mist(37, 594, 8, 'jz-mist')}
      {/* the bay */}
      <rect x="-20" y="598" width="780" height="102" fill="url(#jz-sea)" />
      <path d="M-20 598 L760 598" stroke="#9cc3bd" strokeOpacity=".35" strokeWidth=".8" />
      <g fill="#ffd6a0">{Array.from({ length: 16 }, (_, i) => <g key={i}><circle cx={10 + i * 38 + (i % 3) * 7} cy={596.5} r=".9" /><rect x={9.5 + i * 38 + (i % 3) * 7} y="599" width=".8" height={3 + (i % 4) * 2} opacity=".15" /></g>)}</g>
      <ellipse cx={MOON[0]} cy="630" rx="60" ry="34" fill="url(#jz-seaglow)" />
      <g fill="#f3ecdc">{Array.from({ length: 16 }, (_, i) => { const r = rng(300 + i); const w = 3 + i * 1.8 * (.5 + r()); return <rect key={i} className="jz-glint" style={{ animationDelay: `${n1(r() * 2.6)}s` }} x={n1(MOON[0] - w / 2 + (r() - .5) * (8 + i * 2))} y={n1(602 + i * 3.8 + r() * 2)} width={n1(w)} height=".8" rx=".4" opacity=".7" />; })}</g>
      <g fill="#9cc3bd" opacity=".1" className="cs-shimmer cs-shimmer--slow">{Array.from({ length: 12 }, (_, i) => <rect key={i} x={(i * 173) % 700} y={608 + (i % 6) * 9} width={14 + (i % 4) * 9} height=".7" />)}</g>
    </Layer>
    <Layer depth={3}>
      <defs>
        <radialGradient id="jz-fhalo"><stop offset="0" stopColor="#f0b28a" stopOpacity=".34" /><stop offset=".5" stopColor="#e5a27b" stopOpacity=".1" /><stop offset="1" stopColor="#e5a27b" stopOpacity="0" /></radialGradient>
        <radialGradient id="jz-hill" cx="745" cy="556" r="260" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#6b4e3c" /><stop offset=".22" stopColor="#3a302b" /><stop offset=".6" stopColor="#152c2f" /><stop offset="1" stopColor="#0b2124" /></radialGradient>
        <linearGradient id="jz-wall" x1="0" y1="460" x2="0" y2="552" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#6b5444" /><stop offset=".5" stopColor="#a88061" /><stop offset="1" stopColor="#e2b58a" /></linearGradient>
        <linearGradient id="jz-tower" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5a463a" /><stop offset=".3" stopColor="#d6aa80" /><stop offset=".55" stopColor="#bb9069" /><stop offset="1" stopColor="#4a3a31" /></linearGradient>
        <linearGradient id="jz-towerS" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4a3c34" /><stop offset=".4" stopColor="#5a4a3f" /><stop offset="1" stopColor="#2c2522" /></linearGradient>
        <linearGradient id="jz-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2e2623" /><stop offset="1" stopColor="#5a4637" /></linearGradient>
        <linearGradient id="jz-topshade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1a1e" stopOpacity=".55" /><stop offset=".6" stopColor="#0b1a1e" stopOpacity=".08" /><stop offset="1" stopColor="#0b1a1e" stopOpacity="0" /></linearGradient>
        <radialGradient id="jz-gate" cy=".85" r=".9"><stop offset="0" stopColor="#ffe2b8" /><stop offset=".5" stopColor="#d78c52" /><stop offset="1" stopColor="#3a1e10" /></radialGradient>
        <radialGradient id="jz-flood"><stop offset="0" stopColor="#ffd9ae" stopOpacity=".7" /><stop offset="1" stopColor="#ffd9ae" stopOpacity="0" /></radialGradient>
        <linearGradient id="jz-land" x1="0" y1="640" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#0d2629" /><stop offset="1" stopColor="#061517" /></linearGradient>
      </defs>
      <ellipse cx="745" cy="640" rx="620" ry="80" fill="url(#jz-fhalo)" />
      <circle cx="745" cy="515" r="200" fill="url(#jz-fhalo)" />
      <path d={shape(hillPts)} fill="url(#jz-hill)" />
      <path d={line(hillPts.filter(([x]) => x < 745))} fill="none" stroke="#bcd8d2" strokeOpacity=".22" strokeWidth="1" />
      <path d={line(stairs)} fill="none" stroke="#d8a67c" strokeOpacity=".3" strokeWidth="1.4" />
      <g fill="#ffdcaa">{lampsAlong(stairs, 13).map(([x, y], i) => <g key={i}><circle cx={n1(x)} cy={n1(y - 2)} r=".8" /><circle cx={n1(x)} cy={n1(y - 2)} r="2.6" opacity=".14" /></g>)}</g>
      <Fort />
      {/* minarets */}
      <g fill="#0c2428"><path d="M560 660 V606 l2 -4 l2 4 V660 Z M556 612 h12 v3 h-12 Z M558 598 l4 -14 l4 14 Z" /><path d="M1020 660 V596 l2.5 -5 l2.5 5 V660 Z M1016 604 h13 v3 h-13 Z M1018 590 l4.5 -15 l4.5 15 Z" /></g>
      <rect x="557" y="611" width="10" height="1" fill="#9fe0c2" opacity=".7" className="cs-glow" /><rect x="1017" y="603" width="11" height="1" fill="#9fe0c2" opacity=".5" />
      <g fill="#0c2428">{[...cityL, ...cityC, ...cityR].map((b, i) => <rect key={i} x={n1(b.x)} y={n1(660 - b.h)} width={n1(b.w)} height={n1(b.h)} />)}</g>
      <g fill="#355a5b" opacity=".6">{[...cityL, ...cityC, ...cityR].map((b, i) => <rect key={i} x={n1(b.x)} y={n1(660 - b.h)} width={n1(b.w)} height="1" />)}</g>
      <g>{cityWindows(cityL, 71, 660)}{cityWindows(cityC, 73, 660)}{cityWindows(cityR, 79, 660)}</g>
      <path d="M-20 664 L420 662 L900 660 L1640 660 L1640 700 L-20 700 Z" fill="url(#jz-land)" />
      <path d="M-20 664 L420 662" stroke="#8fb5ae" strokeOpacity=".3" strokeWidth="1" />
      <g fill="#ffd2a0" className="cs-glow">{streetLights(83, 430, 1440, 663, 9)}</g>
      <g fill="#ffd2a0" opacity=".8">{streetLights(89, 640, 900, 672, 12, .6)}</g>
      {/* corniche lamps */}
      <g>{Array.from({ length: 12 }, (_, i) => { const x = 14 + i * 36; return <g key={i}><rect x={x} y="652" width="1.2" height="12" fill="#081c1f" /><circle cx={x + .6} cy="651.5" r="1.4" fill="#ffe0b4" /><ellipse cx={x + .6} cy="664" rx="10" ry="1.8" fill="#ffd2a0" opacity=".14" /><circle cx={x + .6} cy="651.5" r="4" fill="#ffd2a0" opacity=".1" /></g>; })}</g>
    </Layer>
    <Layer depth={4}>
      <defs>
        <radialGradient id="jz-door"><stop offset="0" stopColor="#ffbf85" stopOpacity=".45" /><stop offset="1" stopColor="#ffbf85" stopOpacity="0" /></radialGradient>
        <linearGradient id="jz-doorway" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ffe1b4" /><stop offset="1" stopColor="#d9854d" /></linearGradient>
        <linearGradient id="jz-hutwall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#10272a" /><stop offset=".5" stopColor="#0a1a1c" /><stop offset="1" stopColor="#040d0e" /></linearGradient>
        <linearGradient id="jz-fg" x1="0" y1="660" x2="0" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#061314" /><stop offset="1" stopColor="#020808" /></linearGradient>
      </defs>
      <DatePalm x={236} g={704} s={1.25} lean={-18} seed={5} />
      <DatePalm x={318} g={706} s={.95} lean={14} seed={6} />
      <DatePalm x={1060} g={700} s={1.1} lean={-10} seed={8} fill="#041011" />
      <DatePalm x={1392} g={700} s={1.3} lean={12} seed={9} fill="#041011" />
      <Mango x={1270} g={690} s={1} seed={4} />
      <path d={groundEdge(7)} fill="url(#jz-fg)" />
      <Banana x={628} g={700} s={1.1} seed={3} />
      <Banana x={372} g={704} s={.9} seed={12} />
      <Hut x={912} g={694} s={.92} seed={21} />
      <Hut x={1165} g={690} s={1.12} seed={22} />
      <Hut x={1320} g={694} s={.86} seed={23} />
      <Hut x={1500} g={692} s={1.04} seed={24} />
      <Banana x={1230} g={700} s={.9} seed={31} />
      <g>{fireflies()}</g>
    </Layer>
  </>;
});
