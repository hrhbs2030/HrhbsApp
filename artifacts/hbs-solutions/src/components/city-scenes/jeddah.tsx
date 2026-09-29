import { memo, useMemo } from 'react';
import { Layer, Palm, RIM, Skyline, Stars, Windows, blocks, ridge } from './kit';

/* ---------------- Jeddah: sea, King Fahd Fountain, Jeddah Tower, Al-Balad houses ---------------- */
export const JeddahScene = memo(function JeddahScene() {
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

