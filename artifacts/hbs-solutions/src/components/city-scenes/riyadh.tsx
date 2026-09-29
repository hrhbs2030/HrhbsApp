import { memo, useMemo } from 'react';
import { Layer, Palm, RIM, Skyline, Stars, Windows, blocks, ridge } from './kit';

/* ---------------- Riyadh: Kingdom Centre, Al Faisaliah, KAFD, Najdi mud houses ---------------- */
export const RiyadhScene = memo(function RiyadhScene() {
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

