// Preview a Pack's team view (`view.yml`) as a PNG, without the desktop App or a Host.
//
// It builds the Pack's graph through the built library (`loadPack`), folds in a RunView-shaped
// sample (a generic one by default, or `--sample <json>`), bundles `TeamCanvas.tsx` with esbuild,
// and screenshots the page with headless Chrome at the given CSS width. This is the committed form
// of the `.scratch-render/` harness: the one command a Pack author runs to see a `view.yml` at
// side-pane width before shipping it.
//
// Usage:
//   node scripts/preview-team-view.mjs --pack andes-cell-fmax --width 480 --out /tmp/andes.png
//   node scripts/preview-team-view.mjs --pack andes-cell-fmax --sample scripts/preview-team-view/andes-round1-fork.json --out /tmp/fork.png
//
// Options:
//   --pack <id>       Pack id under this worktree's packs/ (one of --pack / --pack-dir required).
//   --pack-dir <dir>  Absolute path to a Pack folder in ANY checkout. It is loaded and validated with
//                     THIS worktree's built loader and renderer, so an author on a main-based branch
//                     can preview a view.yml without merging HUG-DBOS. Schema errors are printed.
//   --width <px>      CSS width of the pane (default 480).
//   --height <px>     CSS height of the pane (default 760).
//   --out <png>       Output PNG path (default: a temp file, path printed).
//   --sample <json>   A RunView-shaped sample ({ run, tasks, observations }); default: a generic one
//                     that marks the stations before the first AI station done, that AI station
//                     working with a live line, and the rest waiting.
//   --dump-dom        Instead of a screenshot, print the measured station/canvas rects as JSON (used
//                     by the contract test). Honours --width.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const HARNESS = join(ROOT, 'packages', 'harness');

function parseArgs(argv) {
  const out = { width: 480, height: 760, dumpDom: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dump-dom') { out.dumpDom = true; continue; }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    i += 1;
    if (key === 'width' || key === 'height') out[key] = Number(value);
    else out[key] = value;
  }
  return out;
}

/** Every `react@*` / `react-dom@*` folder under the pnpm store, so esbuild resolves them without a
 *  hard-coded version. Falls back to the plain node_modules trees. */
function reactNodePaths() {
  const paths = [];
  const store = join(ROOT, 'node_modules', '.pnpm');
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (/^react@/.test(entry) || /^react-dom@/.test(entry)) paths.push(join(store, entry, 'node_modules'));
    }
  }
  paths.push(join(HARNESS, 'node_modules'), join(ROOT, 'node_modules'));
  return paths.filter((path) => existsSync(path));
}

function chromeBinary() {
  const candidates = [
    process.env.HIMA_CHROME, process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

/** A generic sample: the stations before the first AI station done, that station's first AI node
 *  working with a live line, the rest waiting. Derived from the Pack's own view + tools. */
function genericSample(graph, tools) {
  const view = graph.view;
  const aiTools = new Set((tools ?? []).filter((tool) => tool.outsourcing !== undefined).map((tool) => tool.id));
  const aiNodes = new Set(graph.nodes
    .filter((node) => node.kind === 'act' && node.parameters?.tool !== undefined && aiTools.has(node.parameters.tool))
    .map((node) => node.id));
  const nodesOf = (station) => [...station.checklist.flatMap((item) => item.nodes), ...(station.team ?? []).map((m) => m.node)];
  const firstAi = view.stations.findIndex((station) => nodesOf(station).some((id) => aiNodes.has(id)));
  const tasks = [];
  const done = (id) => ({ taskId: id, projection: { state: 'succeeded' }, sourceFactIds: [] });
  view.stations.forEach((station, index) => {
    if (firstAi >= 0 && index >= firstAi) return;
    for (const id of nodesOf(station)) tasks.push(done(id));
  });
  if (firstAi >= 0) {
    const station = view.stations[firstAi];
    const active = nodesOf(station).find((id) => aiNodes.has(id));
    for (const id of nodesOf(station)) {
      if (id === active) {
        tasks.push({ taskId: id, projection: { state: 'running' }, sourceFactIds: [],
          activity: { toolCalls: 3, planDone: 1, planTotal: 4, latest: { kind: 'execute', title: 'analysis.py --scan', at: '2026-10-14T08:00:00Z' } } });
        break;
      }
      tasks.push(done(id));
    }
  }
  return { run: { id: 'run-preview', status: 'running', goal: {} }, observations: [], tasks };
}

const ENTRY = `
import { createRoot } from 'react-dom/client';
import { TeamCanvas } from ${JSON.stringify(join(HARNESS, 'src', 'client', 'TeamCanvas.js'))};
import { HIMA_STYLE } from ${JSON.stringify(join(HARNESS, 'src', 'client', 'workbench-style.js'))};
import data from './data.json';
const style = document.createElement('style'); style.textContent = HIMA_STYLE; document.head.appendChild(style);
createRoot(document.getElementById('root')).render(
  <div className="hima-root" style={{ background: 'var(--hima-paper)', minHeight: '100vh', padding: 0 }}>
    <div className="hima-workbench-body"><div className="hima-campaign" style={{ height: '100vh' }}>
      <TeamCanvas graph={data.graph} tools={data.tools} view={data.view} stale={false} reducedMotion={true} />
    </div></div>
  </div>,
);
// After layout, record each station box against the canvas, for --dump-dom.
function measure() {
  const canvas = document.querySelector('[data-hima-region="campaign-team"]');
  if (!canvas) return;
  const c = canvas.getBoundingClientRect();
  const stations = [...document.querySelectorAll('[data-hima-region^="team-station-"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-hima-region'), left: r.left - c.left, right: r.right - c.left, width: r.width };
  });
  const el = document.createElement('script');
  el.type = 'application/json'; el.id = 'hima-measure';
  el.textContent = JSON.stringify({ canvasWidth: canvas.clientWidth, canvasScrollWidth: canvas.scrollWidth, stations });
  document.body.appendChild(el);
}
requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(measure, 200)));
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pack && !args['pack-dir']) { console.error('one of --pack <id> or --pack-dir <dir> is required'); process.exit(2); }

  const { loadPack } = await import(join(HARNESS, 'lib', 'index.js'));
  // A Pack from any checkout, loaded and validated with THIS worktree's built loader: --pack-dir is
  // the Pack folder itself (split into its parent + name), --pack an id under this worktree's packs/.
  const [packsDir, packId] = args['pack-dir']
    ? [dirname(resolve(args['pack-dir'])), basename(resolve(args['pack-dir']))]
    : [join(ROOT, 'packs'), args.pack];
  let pack;
  try {
    pack = loadPack(packsDir, packId);
  } catch (error) {
    console.error(`Pack "${packId}" failed to load/validate:\n${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const graph = pack.graph;
  const tools = pack.contract.tools;
  if (graph.view === undefined) { console.error(`Pack "${packId}" declares no view.yml (no team view to preview)`); process.exit(2); }

  const view = args.sample ? JSON.parse(readFileSync(resolve(args.sample), 'utf8')) : genericSample(graph, tools);

  const work = mkdtempSync(join(tmpdir(), 'hima-preview-'));
  writeFileSync(join(work, 'data.json'), JSON.stringify({ graph, tools, view }));
  writeFileSync(join(work, 'entry.tsx'), ENTRY);

  const esbuild = await import(join(HARNESS, 'node_modules', 'esbuild', 'lib', 'main.js'));
  const result = await esbuild.build({
    entryPoints: [join(work, 'entry.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic',
    nodePaths: reactNodePaths(), define: { 'process.env.NODE_ENV': '"production"' }, loader: { '.json': 'json' }, logLevel: 'warning',
  });
  const bundle = result.outputFiles[0].text;

  const html = `<!doctype html><html><head><meta charset="utf-8">`
    + `<style>html,body{margin:0;padding:0;width:${args.width}px}#root{width:${args.width}px}</style></head>`
    + `<body><div id="root"></div><script>${bundle}</script></body></html>`;
  const htmlPath = join(work, 'index.html');
  writeFileSync(htmlPath, html);

  const chrome = chromeBinary();
  if (!chrome) { console.error('SKIP: no headless Chrome found (set HIMA_CHROME or CHROME_BIN)'); process.exit(3); }

  if (args.dumpDom) {
    const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', `--window-size=${args.width},${args.height}`,
      '--run-all-compositor-stages-before-draw', '--virtual-time-budget=4000', '--dump-dom', `file://${htmlPath}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const match = /<script[^>]*id="hima-measure"[^>]*>([\s\S]*?)<\/script>/.exec(run.stdout);
    if (!match) { console.error('could not read measurements from the rendered page'); console.error(run.stderr?.slice(0, 2000)); process.exit(1); }
    process.stdout.write(match[1] + '\n');
    return;
  }

  const out = args.out ? resolve(args.out) : join(work, 'preview.png');
  if (args.out) mkdirSync(dirname(out), { recursive: true });
  const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${args.width},${args.height}`, `--screenshot=${out}`, '--run-all-compositor-stages-before-draw', '--virtual-time-budget=4000', `file://${htmlPath}`],
    { encoding: 'utf8' });
  if (!existsSync(out)) { console.error('screenshot failed'); console.error(run.stderr?.slice(0, 2000)); process.exit(1); }
  console.log(out);
}

main().catch((error) => { console.error(error); process.exit(1); });
