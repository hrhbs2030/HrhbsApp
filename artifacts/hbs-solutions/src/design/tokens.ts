// Mirrors the palette in src/index.css (@theme) for the few places that need
// colour values in JavaScript, such as the Clerk sign-in theme. Pages use the
// CSS utilities (bg-paper, text-quiet…), never these constants.
export const color = {
  night: '#081a1c',
  paper: '#f6f4ed',
  surface: '#fcfaf4',
  field: '#fffcf6',
  line: '#e4e0d4',
  lineStrong: '#c9d0c7',
  ink: '#173e42',
  teal: '#174b50',
  copper: '#a3502f',
  quiet: '#4a605e',
  subtle: '#5d706a',
  onDark: '#f6efe3',
  ok: '#2f6446',
  danger: '#a83f2e',
} as const;

export const font = {
  body: "'IBM Plex Sans Arabic', sans-serif",
  display: "'Readex Pro', 'IBM Plex Sans Arabic', sans-serif",
} as const;

// Motion vocabulary in milliseconds, matching --duration-* in index.css.
export const motion = { press: 120, hover: 200, enter: 320, reveal: 640, scene: 900 } as const;
