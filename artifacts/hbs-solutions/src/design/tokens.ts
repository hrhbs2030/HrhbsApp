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
  lineStrong: '#7d8a83',
  ink: '#173e42',
  teal: '#174b50',
  teal2: '#216067',
  tealBright: '#1d6164',
  tealSoft: '#dfeae7',
  sage: '#eaf0e9',
  sage2: '#dce7dd',
  copper: '#9e4d2d',
  copperLight: '#edb08c',
  copperSoft: '#f4e6db',
  quiet: '#4a605e',
  subtle: '#55685f',
  onDark: '#f6efe3',
  onDark2: '#c2d3ce',
  ok: '#2f6446',
  okSoft: '#e2eee4',
  warn: '#6b5210',
  warnSoft: '#fbf3dc',
  info: '#255a5e',
  infoSoft: '#e2ece8',
  danger: '#a83f2e',
  dangerSoft: '#f9e6df',
  focus: '#9e4d2d',
} as const;

// Categorical series for charts, in order of use: brand first, accent second,
// then calm tones. Every value is a palette token (see the dataviz skill).
export const chartSeries = [color.teal, color.copper, color.tealBright, color.copperLight, color.quiet] as const;

export const font = {
  body: "'IBM Plex Sans Arabic', sans-serif",
  display: "'Readex Pro', 'IBM Plex Sans Arabic', sans-serif",
} as const;

// Type weights, matching --weight-* in index.css: body 400/500, labels 500,
// headings 600. Nothing in the product is 700 (the font request omits it).
export const weight = { regular: 400, medium: 500, semibold: 600 } as const;

// Icon rules, matching --icon-* in index.css: lucide `strokeWidth={icon.stroke}`,
// `size={icon.size}` (24 in tiles and the phone tab bar).
export const icon = { stroke: 1.75, size: 20, sizeLg: 24, onDark: color.onDark2, onLight: color.quiet } as const;

// Radius tiers in px, matching --radius-* in index.css.
export const radius = { chip: 8, control: 10, card: 16, panel: 22, overlay: 24 } as const;

// Motion vocabulary in milliseconds, matching --duration-* in index.css.
export const motion = { press: 120, hover: 200, page: 200, enter: 320, reveal: 640, scene: 900 } as const;

// Layout breakpoints in px: phone (bottom tab bar) ≤ 640, drawer ≤ 1023, sidebar ≥ 1024.
export const breakpoint = { phone: 640, tablet: 1023 } as const;
