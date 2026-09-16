// Contract: the client token sheet keeps the 12 px floor, and the client renders no unicode icon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HIMA_STYLE } from '../../packages/harness/src/client/workbench-style.ts';

const BEGIN = '/* HIMA CLIENT TOKENS BEGIN */';
const END = '/* HIMA CLIENT TOKENS END */';
const clientDir = path.resolve(import.meta.dirname, '../../packages/harness/src/client');
const clientFiles = () => readdirSync(clientDir).filter((name) => /\.tsx?$/.test(name)).map((name) => path.join(clientDir, name));

test('the token sheet states a scale of five steps and nothing below 12 px', () => {
  const begins = HIMA_STYLE.indexOf(BEGIN), ends = HIMA_STYLE.indexOf(END);
  assert.ok(begins >= 0 && ends > begins, 'the sheet opens with one delimited token block');
  const tokens = HIMA_STYLE.slice(begins, ends);
  const steps = Object.fromEntries([...tokens.matchAll(/--hima-fs-([a-z]+):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(steps, { display: 20, title: 16, body: 14, label: 13, eyebrow: 12 });
  for (const [declaration, size] of HIMA_STYLE.matchAll(/font-size:\s*([^;}]+)/g)) {
    assert.match(size!.trim(), /^var\(--hima-fs-[a-z]+\)$/, `every size is a step of the scale: ${declaration}`);
  }
  assert.doesNotMatch(HIMA_STYLE, /\b(9|10|11)px/, 'no size under the floor by any route');
});

test('the client draws icons as inline SVG, never as unicode characters', () => {
  for (const file of clientFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const glyph of ['✓', '◉', '◇', '×', '○', '＋', '→', '↗', '←']) {
      assert.ok(!text.includes(glyph), `${path.basename(file)} uses ${glyph} as an icon`);
    }
  }
});
