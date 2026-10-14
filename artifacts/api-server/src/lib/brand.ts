// The theme colours the mail frame needs, copied from the web app's palette
// (artifacts/hbs-solutions/src/index.css, @theme). The API server cannot import
// the Vite app, so these are a guarded copy: tests/brand.test.ts asserts every
// value here equals the same-named --color-* token in that stylesheet. Mail
// clients need inline hex, so renderMail spells these at run time.
export const brand = {
  paper: "#f6f4ed",
  surface: "#fcfaf4",
  ink: "#173e42",
  quiet: "#4a605e",
  subtle: "#55685f",
  line: "#e4e0d4",
  teal: "#174b50",
  tealBright: "#1d6164",
  copper: "#9e4d2d",
  copperLight: "#edb08c",
  copperSoft: "#f4e6db",
  night: "#081a1c",
  onDark: "#f6efe3",
  onDark2: "#c2d3ce",
  warn: "#6b5210",   warnSoft: "#fbf3dc",   warnLine: "#ecd9a4",
  ok: "#2f6446",     okSoft: "#e2eee4",     okLine: "#a9cbb3",
  info: "#255a5e",   infoSoft: "#e2ece8",   infoLine: "#a6c6c2",
  danger: "#a83f2e", dangerSoft: "#f9e6df", dangerLine: "#ecb9a9",
} as const;
