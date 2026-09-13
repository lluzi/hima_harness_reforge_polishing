// @hima-seam host in-process
// PLS-14 L4: retain one existing small Linglong report through the real Permit and archive path.
// No model, Job, EDA wrapper, or remote write is requested by this bounded evidence script.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { loadPack } from '@hima/harness';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { bootInProcess, createRootAgent } from '../test/contract/support/boot-inprocess.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const source = '/data/eda/project/hima_harness/polishing-runs/dtco-phases-1789296501383130000/flow/artifacts/compare/run-895f86e48c2b46ed88a12b432028844f/comparison.json';
const expectedSha256 = '2f056da01b925908c1fab767e89a5af8c367acef339a77750ccb563e284bee4b';
const expectedBytes = 500;
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out' || !args[1]) throw new Error('usage: node scripts/live-check-pls14-site-archive.ts --out <fresh-evidence-directory>');
const out = path.resolve(args[1]!);
if (existsSync(out)) throw new Error(`evidence directory already exists: ${out}`);
mkdirSync(out, { recursive: true });
const started = Date.now();
process.env.HIMA_TEST_SILENT_AGENT = '1';
let modelRequests = 0;
const checks: { claim: string; passed: boolean; saw: unknown }[] = [];
const check = (claim: string, passed: boolean, saw: unknown) => {
  checks.push({ claim, passed, saw });
  assert.ok(passed, claim);
};
const write = (name: string, value: unknown) => writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);

const index = JSON.parse(readFileSync(path.join(repoRoot, 'docs/validation/pls-frontier/pls25-physical-site/index.json'), 'utf8')) as { files: { source: string; sha256: string; bytes: number }[] };
const inventory = index.files.find((file) => file.source === source);
check('the selected Site source is the tracked 500-byte compare artifact', inventory?.sha256 === expectedSha256 && inventory.bytes === expectedBytes, inventory ?? null);

const home = await createHimaHome();
let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
try {
  await prepareHimaHome({ home: home.home, bundleMode: 'installed' });
  // The installed profile has its own module instance, which is the one the actual Host uses.
  const installed = await import(pathToFileURL(path.join(home.profileDir, 'node_modules/@hima/harness/lib/index.js')).href) as typeof import('@hima/harness');
  // This Pack is written only into the fresh installed Home. Its deliberately absent workspace
  // input takes startRun through the real no-workspace/cancel/archive branch without a Site write.
  const id = 'pls14-site-archive';
  const pack = path.join(packsDirOf(home), id);
  cpSync(path.join(repoRoot, 'packs/opene902-timing-probe'), pack, { recursive: true });
  const contract = YAML.parse(readFileSync(path.join(pack, 'contract.yml'), 'utf8'));
  const graph = YAML.parse(readFileSync(path.join(pack, 'graph.yml'), 'utf8'));
  Object.assign(contract, {
    id, version: '1', title: 'PLS-14 read-only site archive check',
    inputs: [
      { name: 'flowRoot', description: 'Existing Site flow root used only for the failed read-only preparation probe.' },
      { name: 'workspaceRoot', description: 'The Site Campaign root; no workspace is created in this check.' },
    ],
    outputs: [{ name: 'sourceReport', path: 'incoming/comparison.json', reader: 'raw', description: 'The exact existing Site report.' }],
    environment: { wrappers: [] }, workspace: { copy: ['intentionally-absent-pls14-source'] }, tools: [], rules: [],
    words: { periodNs: { label: 'unused initial period', unit: 'ns' } },
  });
  Object.assign(graph, { id, version: '1', entry: 'observe-source', nodes: [{ id: 'observe-source', kind: 'act', parameters: { observes: 'sourceReport' } }], edges: [] });
  writeFileSync(path.join(pack, 'contract.yml'), YAML.stringify(contract));
  writeFileSync(path.join(pack, 'graph.yml'), YAML.stringify(graph));
  loadPack(packsDirOf(home), id);

  const sites = path.join(home.home, 'hima/sites'); mkdirSync(sites, { recursive: true });
  const site = YAML.parse(readFileSync(path.join(repoRoot, 'sites/linglong-aes/site.yml'), 'utf8'));
  site.name = 'pls14-linglong-archive';
  // Keep the authentic Permit byte-for-byte.  This workspace root is inside a permitted read root
  // but outside its write root, so preparation stops before mkdir/tee can be requested.
  site.workspaceRoot = '/data/eda/project/hima_harness/polishing-inputs';
  site.bindings.workspaceRoot = site.workspaceRoot;
  site.bindings.source = source;
  site.permit = './pls14-linglong-archive.permit.yml';
  writeFileSync(path.join(sites, `${site.name}.yml`), YAML.stringify(site));
  cpSync(path.join(repoRoot, 'sites/linglong-aes/permit.yml'), path.join(sites, site.permit));
  writeFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');

  host = await bootInProcess(home);
  host.ctx.on('agent/request', () => { modelRequests++; throw new Error('this read-only archive check forbids model requests'); });
  const owner = await createRootAgent(host.ctx, home.workspace);
  installed.clearRemoteCommands();
  const startAt = Date.now();
  const opened = await host.ctx.hima.startRun({ pack: id, site: site.name, goal: { target_period_ns: 2.3 }, ownerSessionId: String(owner.id), timeBoxMs: 60_000, retryAllowance: 0, generationLimit: 1 });
  const startMs = Date.now() - startAt;
  const preparationCommands = installed.remoteCommands();
  check('the owned Run stopped at preparation with no workspace and made no Site write', opened.kind === 'unprepared' && opened.run.status === 'waiting' && host.ctx.hima.ledger.records({ runId: opened.run.id, type: 'workspace' }).length === 0 && !preparationCommands.some((command) => ['mkdir', 'tee', 'cp', 'mv', 'rm'].includes(command.argv[0]!)), { kind: opened.kind, run: 'run' in opened ? opened.run : undefined, startMs, preparationCommands });
  if (opened.kind !== 'unprepared') throw new Error(`expected no-workspace Run, got ${opened.kind}`);

  const observeAt = Date.now();
  const observed = await host.ctx.hima.observe({ site: site.name, path: source, run: opened.run.id, reader: 'raw' });
  const observeMs = Date.now() - observeAt;
  check('the governed channel observed the tracked original bytes in the actual owned Run', observed.kind === 'observed' && observed.record.contentSha256 === expectedSha256 && observed.record.bytes === expectedBytes, observed);

  const cancelAt = Date.now();
  const cancelled = await host.ctx.hima.cancelRun(opened.run.id);
  const cancelMs = Date.now() - cancelAt;
  check('the actual Fabric cancellation ended the no-workspace Run', cancelled.kind === 'cancelled' && cancelled.run.status === 'cancelled', cancelled);
  const archiveAt = path.join(pack, 'run-assets', opened.run.id);
  const manifest = JSON.parse(readFileSync(path.join(archiveAt, 'manifest.json'), 'utf8')) as { materials: { path: string; source: string; sha256: string; bytes: number }[] };
  const asset = manifest.materials.find((material) => material.source === `observation:${source}`);
  const local = asset === undefined ? undefined : readFileSync(path.join(archiveAt, asset.path));
  check('the installed Pack archive copied the original observed bytes with the expected SHA-256', asset !== undefined && asset.sha256 === expectedSha256 && asset.bytes === expectedBytes && local !== undefined && sha256(local) === expectedSha256, { archiveAt, manifestSha256: sha256(readFileSync(path.join(archiveAt, 'manifest.json'))), asset, localSha256: local === undefined ? undefined : sha256(local) });

  const commandsBeforeOfflineRead = installed.remoteCommands();
  const offlineAt = Date.now();
  const offline = await installed.readArchivedMaterial({ ledger: host.ctx.hima.ledger, sitesDir: sites, packsDir: packsDirOf(home) }, opened.run.id, asset!.path);
  const offlineMs = Date.now() - offlineAt;
  const commandsAfterOfflineRead = installed.remoteCommands();
  check('the archived material read is local and did not make another SSH request', offline.kind === 'read' && sha256(offline.text) === expectedSha256 && commandsAfterOfflineRead.length === commandsBeforeOfflineRead.length, { offline, remoteCommandsBefore: commandsBeforeOfflineRead.length, remoteCommandsAfter: commandsAfterOfflineRead.length, offlineMs });
  check('no model request or Job was started', modelRequests === 0 && host.ctx.hima.ledger.records({ runId: opened.run.id, type: 'job' }).length === 0, { modelRequests, jobs: host.ctx.hima.ledger.records({ runId: opened.run.id, type: 'job' }).length });
  check('all recorded Site operations remained read-only', !commandsAfterOfflineRead.some(command => ['mkdir', 'tee', 'cp', 'mv', 'rm', 'touch', 'sh', 'bash'].includes(command.argv[0]!)), commandsAfterOfflineRead);

  const evidence = {
    status: 'passed', modelRequests, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), wallTimeMs: Date.now() - started,
    scope: 'One existing 500-byte Linglong compare report was read through Hima Channel and the Site Permit into an actual owned Run, then copied to the isolated installed Pack archive. No model request, EDA wrapper, Job, remote write, or source mutation was requested.',
    source: { path: source, sha256: expectedSha256, bytes: expectedBytes, inventory: 'docs/validation/pls-frontier/pls25-physical-site/index.json' },
    run: { id: opened.run.id, site: site.name, status: cancelled.run.status, owner: String(owner.id), startMs, observeMs, cancelMs },
    archive: { directory: archiveAt, manifestSha256: sha256(readFileSync(path.join(archiveAt, 'manifest.json'))), material: asset, localSha256: sha256(local!), offlineReadMs: offlineMs },
    remote: { commands: commandsAfterOfflineRead, commandCountBeforeOfflineRead: commandsBeforeOfflineRead.length, commandCountAfterOfflineRead: commandsAfterOfflineRead.length, expectedPreparationRefusal: true, remoteWritesRequested: false },
    checks,
  };
  write('evidence.json', evidence);
  writeFileSync(path.join(out, 'README.md'), `# PLS-14 live Site archive evidence\n\nPASS — one actual source report was observed under the Linglong Permit and archived in an isolated installed Pack. The local archived material SHA-256 equals the tracked source SHA-256; the final archived read made no additional SSH request.\n\n- Run: \`${opened.run.id}\`\n- Site: \`${site.name}\`\n- Source: \`${source}\`\n- SHA-256: \`${expectedSha256}\`\n- Archive manifest SHA-256: \`${evidence.archive.manifestSha256}\`\n- Product model calls: 0; EDA Jobs: 0; remote writes: 0.\n`);
} finally {
  if (host) await host.dispose();
  await home.dispose();
}
