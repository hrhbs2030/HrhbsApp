import { memo, useMemo } from 'react';
import { Layer, Palm, RIM, Skyline, Stars, Windows, blocks, ridge } from './kit';

/* ---------------- Jazan: Fayfa mountains and terraces, Dosariyah fort, Tihama huts, palms ---------------- */
export const JazanScene = memo(function JazanScene() {
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

