// A rendered regression: no station box may overflow the team canvas at side-pane or wide width.
// This is the end of the layout chain the pure `team-canvas.test.ts` cannot reach — the grid tracks,
// `min-width:0` and the wrapping/ellipsis of a live line only exist once a browser lays the boxes
// out. It drives the committed preview tool (`scripts/preview-team-view.mjs --dump-dom`), which
// bundles `TeamCanvas.tsx` and measures the boxes in headless Chrome, then asserts every station
// sits within the canvas width. Without headless Chrome it skips with a reason — it never passes
// silently.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = path.join(root, 'scripts', 'preview-team-view.mjs');
const samples = path.join(root, 'scripts', 'preview-team-view');

function chromeBinary(): string | undefined {
  const candidates = [
    process.env.HIMA_CHROME, process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  return candidates.find((p) => existsSync(p));
}

interface Measure { readonly canvasWidth: number; readonly canvasScrollWidth: number; readonly stations: readonly { readonly id: string; readonly left: number; readonly right: number; readonly width: number }[] }

function measure(pack: string, sample: string, width: number): Measure {
  const run = spawnSync(process.execPath, [script, '--pack', pack, '--sample', path.join(samples, sample), '--width', String(width), '--dump-dom'],
    { cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, `preview --dump-dom failed for ${pack} @ ${width}px:\n${run.stderr ?? ''}`);
  return JSON.parse(run.stdout.trim()) as Measure;
}

const chrome = chromeBinary();
const skip = chrome === undefined ? 'no headless Chrome found (set HIMA_CHROME or CHROME_BIN)' : false;

// MAGE keeps the single column; AndesCell is the gridded (rows) view that the layout fix targets.
const cases: { readonly name: string; readonly pack: string; readonly sample: string }[] = [
  { name: 'MAGE (single column)', pack: 'mage-scribe-placement', sample: 'mage-round2.json' },
  { name: 'AndesCell (gridded rows)', pack: 'andes-cell-fmax', sample: 'andes-round1-fork.json' },
];

for (const scene of cases) {
  for (const width of [480, 800]) {
    test(`${scene.name}: no station box overflows the ${String(width)}px canvas`, { skip }, () => {
      const m = measure(scene.pack, scene.sample, width);
      assert.ok(m.stations.length > 0, 'the view rendered at least one station');
      // The canvas never scrolls sideways, and every box sits within it (1px rounding tolerance).
      assert.ok(m.canvasScrollWidth <= m.canvasWidth + 1, `canvas scrolls sideways: scrollWidth ${String(m.canvasScrollWidth)} > clientWidth ${String(m.canvasWidth)}`);
      for (const station of m.stations) {
        assert.ok(station.left >= -1, `${station.id} starts left of the canvas (left ${String(station.left)})`);
        assert.ok(station.right <= m.canvasWidth + 1, `${station.id} overflows the canvas (right ${String(station.right)} > width ${String(m.canvasWidth)})`);
      }
    });
  }
}
