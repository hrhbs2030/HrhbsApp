// Run with: pnpm --filter @workspace/hbs-solutions test:tokens
// Locks src/design/tokens.ts (the JS mirror used by the Clerk theme and charts)
// to the brand `@theme` block in src/index.css: every --color-* and --radius-*
// token must exist in both, under its camelCase name, with the same value.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { color, radius } from '../src/design/tokens';

const css = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8');

// The brand block is the first `@theme {` (not `@theme inline`, whose entries
// are shadcn aliases onto the brand tokens and carry no value of their own).
function brandBlock(): string {
  const start = css.search(/^@theme \{/m);
  assert.ok(start >= 0, 'index.css has a brand @theme block');
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

function declarations(block: string, prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+):\\s*([^;]+);`, 'g'))) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

test('every --color-* token in index.css is mirrored in tokens.ts with the same value', () => {
  const colors = declarations(brandBlock(), 'color');
  assert.ok(colors.size >= 50, `parsed ${colors.size} colour tokens`);
  const mirror: Record<string, string> = color;
  const missing: string[] = [];
  const wrong: string[] = [];
  for (const [name, value] of colors) {
    const key = camel(name);
    if (!(key in mirror)) missing.push(`${name} → color.${key}`);
    else if (mirror[key] !== value) wrong.push(`color.${key}: css ${value} ≠ ts ${mirror[key]}`);
  }
  assert.deepEqual(missing, [], 'tokens.ts is missing colour tokens');
  assert.deepEqual(wrong, [], 'tokens.ts values drift from index.css');
  // No stale entries either: every JS colour comes from CSS.
  const stale = Object.keys(mirror).filter((key) => ![...colors.keys()].some((name) => camel(name) === key));
  assert.deepEqual(stale, [], 'tokens.ts has colours that index.css no longer defines');
});

test('every --radius-* tier in index.css is mirrored in tokens.ts, in px', () => {
  const radii = declarations(brandBlock(), 'radius');
  const mirror: Record<string, number> = radius;
  for (const [name, value] of radii) {
    assert.match(value, /^\d+px$/, `--radius-${name} is a px value`);
    assert.equal(mirror[camel(name)], Number.parseInt(value, 10), `radius.${camel(name)} mirrors --radius-${name}`);
  }
  // The sheet corner shrinks on phones through a :root override; tokens.ts carries both.
  const phone = css.match(/@media \(max-width: 767px\) \{ :root \{ --radius-sheet: (\d+)px; \}/);
  assert.ok(phone, 'index.css overrides --radius-sheet at ≤ 767px');
  assert.equal(radius.sheetPhone, Number.parseInt(phone[1], 10));
});

test('shadcn names are aliases onto brand tokens (no HSL triplets)', () => {
  assert.doesNotMatch(css, /hsl\(var\(/, 'no hsl(var(--x)) wrappers remain');
  const inline = css.slice(css.indexOf('@theme inline {'), css.indexOf('\n}', css.indexOf('@theme inline {')));
  for (const [, name, value] of inline.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)) {
    assert.match(value, /^var\(--color-[a-z0-9-]+\)$/, `--color-${name} aliases a brand token`);
    const target = value.slice('var(--color-'.length, -1);
    assert.ok(camel(target) in color, `--color-${name} points at an existing token (${target})`);
  }
  assert.match(css, /--radius: 10px;/, 'shadcn --radius is the control radius');
});
