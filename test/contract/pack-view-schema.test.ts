// A0 Pack-format schema (packs.ts): the display `label`/`about` on nodes and autopilot segments,
// `contract.results`/`reports`, and the unified `view.yml` — station `row`, top-level `hidden`,
// derived-vs-declared edges, and a metric that reads either a node's output or a Reader's value.
// Loaded through `loadPack`, so every case is what a person actually gets when the pack is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { loadPack } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const mageId = 'mage-scribe-placement';
const andesId = 'andes-cell-fmax';
const andesRef = 'demo/andes-openc910';

// A MAGE copy with `view.yml` replaced by `view`; returns the temp packs dir and a cleanup.
function mageWithView(view: unknown): { packsDir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pack-view-mage-'));
  cpSync(path.join(repoRoot, 'packs', mageId), path.join(dir, mageId), { recursive: true });
  writeFileSync(path.join(dir, mageId, 'view.yml'), stringify(view));
  return { packsDir: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// The AndesCell Pack from the pre-DBOS demo, materialised into a temp dir (never committed here).
// With `view` null the Pack's own inline `graph.yml` view is left in place; with a `view` object the
// inline view is moved into `view.yml`, exactly as the port does.
function andesPack(view: unknown | null): { packsDir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pack-view-andes-'));
  execFileSync('bash', ['-c', `git -C ${repoRoot} archive ${andesRef} packs/${andesId} | tar -x -C ${dir}`]);
  const packsDir = path.join(dir, 'packs');
  if (view !== null) {
    const graphPath = path.join(packsDir, andesId, 'graph.yml');
    const graph = parse(readFileSync(graphPath, 'utf8')) as Record<string, unknown>;
    delete graph.view;
    writeFileSync(graphPath, stringify(graph));
    writeFileSync(path.join(packsDir, andesId, 'view.yml'), stringify(view));
  }
  return { packsDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// A MAGE view that places all ten nodes across four stations, checklist XOR team. Loosely typed so
// each case can set `row` or rewrite a `checklist` without fighting the station union.
type Station = Record<string, unknown>;
const mageTeam = [
  { node: 'review-litho-pie', label: 'Litho' }, { node: 'review-metrology', label: 'Metrology' },
  { node: 'review-alignment', label: 'Alignment' }, { node: 'review-wat', label: 'WAT' },
];
const mageStations = (extra: Station = {}): Station[] => [
  { id: 'case', label: 'Case', checklist: [{ label: 'prep', nodes: ['prepare-case', 'measure-incumbent'] }], ...extra },
  { id: 'engineer', label: 'Engineer', checklist: [{ label: 'place', nodes: ['engineer-place'] }] },
  { id: 'reviews', label: 'Reviews', team: mageTeam },
  { id: 'decide', label: 'Decide', checklist: [{ label: 'decide', nodes: ['decide-round', 'evaluate-placement', 'deliver'] }] },
];

test('the real MAGE Pack loads, and its view parses', () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), mageId);
  assert.ok(pack.graph.view);
  assert.equal(pack.graph.view.deriveEdges, false);
});

test('pass: a strip-style view with rows, a hidden node and derived edges loads', () => {
  // Rows 0,1,1,2 (one row shared by two stations); `deliver` is hidden instead of placed; no `edges`
  // key, so edges are derived from the graph.
  const stations = mageStations({ row: 0 });
  stations[1]!.row = 1; stations[2]!.row = 1; stations[3]!.row = 2;
  stations[3]!.checklist = [{ label: 'decide', nodes: ['decide-round', 'evaluate-placement'] }];
  const { packsDir, cleanup } = mageWithView({ stations, hidden: ['deliver'] });
  try {
    const pack = loadPack(packsDir, mageId);
    const view = pack.graph.view!;
    assert.equal(view.deriveEdges, true);
    assert.deepEqual(view.stations.map((s) => s.row), [0, 1, 1, 2]);
    assert.deepEqual(view.hidden, ['deliver']);
  } finally { cleanup(); }
});

test('pass: a Reader metric on the AndesCell view loads, and node/segment labels come through', () => {
  const view = {
    stations: parse(stringify(demoAndesView())).stations,
    hidden: ['blocked'],
    metrics: [{ label: 'best', reader: 'andes-round', type: 'timing_gain_pct', unit: '%', digits: 2, pick: 'best', better: 'higher', goal: 'target_timing_gain_pct' }],
  };
  const { packsDir, cleanup } = andesPack(view);
  try {
    const pack = loadPack(packsDir, andesId);
    const metric = pack.graph.view!.metrics[0]!;
    assert.equal(metric.kind, 'reader');
    assert.equal(pack.graph.view!.deriveEdges, true);
    // Display `label`/`about` on a node and on an autopilot segment survived the load.
    assert.equal(pack.graph.nodes.find((n) => n.id === 'bind-inputs')!.label, 'Check tools and design');
    const segment = pack.graph.autopilot.find((a) => 'from' in a) as { label?: string };
    assert.equal(segment.label, 'Reference build and timing');
    // The contract's Results and Reports declarations loaded too.
    assert.equal(pack.contract.reports?.dir, 'reports');
    assert.ok(pack.contract.results?.headline);
  } finally { cleanup(); }
});

test('refuse: the AndesCell inline graph.yml `view:` is rejected; view.yml is the one declaration', () => {
  const { packsDir, cleanup } = andesPack(null);
  try { assert.throws(() => loadPack(packsDir, andesId), /unrecognized_keys[\s\S]*"view"/); }
  finally { cleanup(); }
});

test('refuse: a station with both a checklist and a team, naming view.yml', () => {
  const stations = mageStations();
  (stations[0] as Record<string, unknown>).team = [{ node: 'prepare-case', label: 'x' }];
  const { packsDir, cleanup } = mageWithView({ stations });
  try { assert.throws(() => loadPack(packsDir, mageId), /view\.yml station "case" is drawn as a checklist or as a team/); }
  finally { cleanup(); }
});

test('refuse: three stations sharing one row, naming view.yml', () => {
  const stations = mageStations({ row: 0 });
  stations[1]!.row = 0; stations[2]!.row = 0; stations[3]!.row = 1;
  const { packsDir, cleanup } = mageWithView({ stations });
  try { assert.throws(() => loadPack(packsDir, mageId), /view\.yml row 0 holds more than two stations/); }
  finally { cleanup(); }
});

test('refuse: a node placed in two stations, naming view.yml', () => {
  const stations = mageStations();
  (stations[1]!.checklist as { label: string; nodes: string[] }[])[0]!.nodes.push('prepare-case');
  const { packsDir, cleanup } = mageWithView({ stations });
  try { assert.throws(() => loadPack(packsDir, mageId), /view\.yml node "prepare-case" is in .* and in .*; every node is drawn in one place/); }
  finally { cleanup(); }
});

test('refuse: when hidden is declared, a node left in no station, naming view.yml', () => {
  // `measure-incumbent` is hidden; `deliver` is left off entirely. With `hidden` declared, coverage
  // holds, so the forgotten `deliver` is the fault — not the hidden node.
  const stations = mageStations();
  stations[0]!.checklist = [{ label: 'prep', nodes: ['prepare-case'] }];
  stations[3]!.checklist = [{ label: 'decide', nodes: ['decide-round', 'evaluate-placement'] }];
  const { packsDir, cleanup } = mageWithView({ stations, hidden: ['measure-incumbent'] });
  try { assert.throws(() => loadPack(packsDir, mageId), /view\.yml node "deliver" is in no station and not hidden/); }
  finally { cleanup(); }
});

test('refuse: a metric naming a reader no contract output declares, naming view.yml', () => {
  const view = { stations: demoAndesView().stations, hidden: ['blocked'],
    metrics: [{ label: 'best', reader: 'no-such-reader', type: 'timing_gain_pct' }] };
  const { packsDir, cleanup } = andesPack(view);
  try { assert.throws(() => loadPack(packsDir, andesId), /view\.yml metric "best" reads reader "no-such-reader", which no contract\.yml output declares/); }
  finally { cleanup(); }
});

test('refuse: a metric naming a value type the reader does not emit, naming view.yml', () => {
  const view = { stations: demoAndesView().stations, hidden: ['blocked'],
    metrics: [{ label: 'best', reader: 'andes-round', type: 'cell_area' }] };
  const { packsDir, cleanup } = andesPack(view);
  try { assert.throws(() => loadPack(packsDir, andesId), /view\.yml metric "best" reads "cell_area" from reader "andes-round", which that reader does not emit/); }
  finally { cleanup(); }
});

// The demo's own inline view object (stations + hidden), read from the archived graph.yml once.
let demoView: { stations: unknown[] } | undefined;
function demoAndesView(): { stations: unknown[] } {
  if (demoView) return demoView;
  const text = execFileSync('git', ['-C', repoRoot, 'show', `${andesRef}:packs/${andesId}/graph.yml`], { encoding: 'utf8' });
  demoView = (parse(text) as { view: { stations: unknown[] } }).view;
  return demoView;
}
