// Mirrors the palette in src/index.css (@theme) for the few places that need
// colour values in JavaScript, such as the Clerk sign-in theme and inline
// SVG charts (sparklines). Pages use the CSS utilities (bg-paper, text-quiet…),
// never these constants.
export const color = {
  night: '#081a1c',
  night2: '#10292c',
  paper: '#f6f4ed',
  surface: '#fcfaf4',
  raised: '#fffdf8',
  field: '#fffcf6',
  sunk: '#f1efe6',
  line: '#e4e0d4',
  lineStrong: '#84918a',
  ink: '#173e42',
  teal: '#174b50',
  teal2: '#216067',
  tealBright: '#1d6164',
  tealSoft: '#dfeae7',
  sage: '#eaf0e9',
  sage2: '#dce7dd',
  copper: '#a3502f',
  copperLight: '#e5a27b',
  copperSoft: '#f4e6db',
  quiet: '#4a605e',
  subtle: '#5d706a',
  onDark: '#f6efe3',
  onDark2: '#b9ccc7',
  ok: '#2f6446',
  okSoft: '#e2eee4',
  warn: '#6b5210',
  warnSoft: '#fbf3dc',
  info: '#255a5e',
  infoSoft: '#e2ece8',
  danger: '#a83f2e',
  dangerSoft: '#f9e6df',
  focus: '#a3502f',
} as const;

// Categorical series for charts, in order of use: brand first, accent second,
// then calm tones. Every value is a palette token (see the dataviz skill).
export const chartSeries = [color.teal, color.copper, color.tealBright, color.copperLight, color.quiet] as const;

export const font = {
  body: "'IBM Plex Sans Arabic', sans-serif",
  display: "'Readex Pro', 'IBM Plex Sans Arabic', sans-serif",
} as const;

// Radius tiers in px, matching --radius-* in index.css.
export const radius = { chip: 8, control: 10, card: 16, panel: 22, overlay: 24 } as const;

// Motion vocabulary in milliseconds, matching --duration-* in index.css.
export const motion = { press: 120, hover: 200, page: 200, enter: 320, reveal: 640, scene: 900 } as const;

// Layout breakpoints in px: phone (bottom tab bar) ≤ 640, drawer ≤ 1023, sidebar ≥ 1024.
export const breakpoint = { phone: 640, tablet: 1023 } as const;
