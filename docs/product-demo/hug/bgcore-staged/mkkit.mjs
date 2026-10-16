// Fresh kit for the staged bgcore take on app-rc3 (HUG-DBOS d95c55ff, aiX UI). No Site, no real model:
// DEEPSEEK_BASE_URL points at stage.mjs's stand-in. Never reuses a kit.  usage: node mkkit.mjs <name> [cdpPort]
import { mkdir, appendFile, writeFile, symlink, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const R = '/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp';
const app = `${R}/hug-release/app-rc3/HimaHarness.app`;
const name = process.argv[2]; const cdp = process.argv[3] ?? '9334';
const kit = path.join(R, 'bgcore-rec/kits', name);
try { await access(kit); throw new Error(`kit exists: ${kit}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const resource = path.join(app, 'Contents/Resources/app');
const home = path.join(kit, 'Data/dsh');
for (const d of ['Data/electron', 'recordings', 'evidence']) await mkdir(path.join(kit, d), { recursive: true });
await symlink(app, path.join(kit, 'HimaHarness.app'));
const { prepareHimaHome, homePatchFile } = await import(pathToFileURL(path.join(resource, 'lib/hima-home.js')).href);
await prepareHimaHome({ home, root: resource });
const sites = path.join(home, 'hima/sites'); await mkdir(sites, { recursive: true });
await appendFile(homePatchFile(home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(sites)}\n    packsDir: ${JSON.stringify(path.join(home, 'hima/packs'))}\n    knowledgeDir: ${JSON.stringify(path.join(home, 'hima/knowledge/current'))}\n`);
await appendFile(path.join(home, 'settings.yaml'), '\nui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\nui-chat:\n  transcriptView: normal\nui-theme:\n  preference: light\n');
const { installPackMethod } = await import(pathToFileURL(path.join(resource, 'node_modules/@hima/harness/lib/release.js')).href);
try { installPackMethod({ from: `${R}/bgcore-rec/stage/packs/bgcore-frontend`, to: path.join(home, 'hima/packs/bgcore-frontend') }); console.log('pack installed'); } catch (e) { console.log('pack install skipped:', e.message.slice(0, 200)); }
await writeFile(path.join(kit, 'Data/electron/window-state.json'), JSON.stringify({ width: 1280, height: 800, x: -1280, y: 134 }));
await writeFile(path.join(kit, 'Launch.command'), `#!/bin/zsh
set -euo pipefail
kit_dir="\${0:A:h}"
export DEEPSEEK_API_KEY=staged-replay
export DEEPSEEK_BASE_URL=http://127.0.0.1:\${MOCK_PORT:-18431}
export HIMA_USER_DATA="$kit_dir/Data/electron"
export DSH_HOME="$kit_dir/Data/dsh"
export DSH_AGENTS_HOME="$DSH_HOME/agents"
export HIMA_WORKSPACE=/Users/Shared/bgcore-demo
export DSH_TELEMETRY_DISABLED=1
export HIMA_BUNDLED_PACKS=""
unset ELECTRON_RUN_AS_NODE NODE_TEST_CONTEXT HIMA_TEST_LEGACY_AUTO_DRIVE HIMA_TEST_SILENT_AGENT HIMA_RESIDENT_TESTING
exec "$kit_dir/HimaHarness.app/Contents/MacOS/HimaHarness" --remote-debugging-port=${cdp} > "$kit_dir/Data/native-app.log" 2>&1
`, { mode: 0o755 });
console.log(kit);
