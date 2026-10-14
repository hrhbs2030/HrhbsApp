import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { brand } from "../src/lib/brand";

// src/lib/brand.ts is a copy of the web palette; this keeps it in step with
// the @theme block in artifacts/hbs-solutions/src/index.css.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const stylesheet = readFileSync(resolve(repoRoot, "artifacts/hbs-solutions/src/index.css"), "utf8");

// brand key → CSS custom property: tealBright → --color-teal-bright, onDark2 → --color-on-dark-2.
const tokenName = (key: string) => `--color-${key.replace(/([A-Z])/g, "-$1").replace(/(\d+)/g, "-$1").toLowerCase()}`;

const cssToken = (name: string): string | undefined => {
  const match = stylesheet.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\b`));
  return match?.[1]?.toLowerCase();
};

test("every brand colour equals the same-named --color-* token in the web stylesheet", () => {
  for (const [key, value] of Object.entries(brand)) {
    const name = tokenName(key);
    const token = cssToken(name);
    assert.ok(token, `${name} is not defined as a hex colour in src/index.css`);
    assert.equal(value.toLowerCase(), token, `brand.${key} (${value}) differs from ${name} (${token})`);
  }
});

test("brand values are six-digit hex", () => {
  for (const [key, value] of Object.entries(brand)) {
    assert.match(value, /^#[0-9a-f]{6}$/, `brand.${key}`);
  }
});
