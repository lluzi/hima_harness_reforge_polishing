// @hima-seam tools direct
// PLS-25 L4: the six unchanged v3 Workshops over Site-staged actual mining outputs.
// This finite graph slice makes no full physical-flow or PPA claim and is never released as the Pack.
import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { loadPack, packDigestOf, packStage } from '@hima/harness';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { bootInProcess, createRootAgent } from '../test/contract/support/boot-inprocess.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';
import { guardInstalled, runLive, sha256 } from './live-check-workshop.ts';

const stagedFile = process.env.HIMA_AES_MINING_STAGING;
if (!stagedFile) throw new Error('HIMA_AES_MINING_STAGING must name the verified Site staging receipt');
const staging = JSON.parse(readFileSync(stagedFile, 'utf8')) as { root: string; sha256: string; routes: string[] };
if (!staging.root.startsWith('/data/eda/project/hima_harness/polishing-inputs/') || !/^[a-f0-9]{64}$/.test(staging.sha256)
  || staging.routes.length !== 6 || new Set(staging.routes).size !== 6) throw new Error('invalid mining staging receipt');
const source = path.join(repoRoot, 'packs/aes-tsmc28-dtco');
if (!['compiled', 'tested', 'released'].includes(packStage(source).stage)) throw new Error('v3 method is not compiled');

await runLive('live-check-aes-mining-selection', 15, async check => {
  const home = await createHimaHome(); check.home = home;
  await prepareHimaHome({ home: home.home, bundleMode: 'installed' });
  const id = 'aes-mining-selection-check';
  const folder = path.join(packsDirOf(home), id);
  cpSync(source, folder, { recursive: true });
  const contract = YAML.parse(readFileSync(path.join(folder, 'contract.yml'), 'utf8'));
  const graph = YAML.parse(readFileSync(path.join(folder, 'graph.yml'), 'utf8'));
  contract.id = id;
  contract.goal = { minimum_selected: { type: 'number', unit: 'count', min: 0, max: 2, default: 1 } };
  contract.strategy = { algorithmRevision: contract.strategy.algorithmRevision };
  contract.words = { algorithmRevision: contract.words.algorithmRevision, minimum_selected: { label: 'minimum selected per route', unit: 'count' } };
  contract.rules.push('selection-count-at-least');
  contract.workspace.copy = ['probe.json', 'probe-inputs.json', 'probes', 'mining', 'records', 'artifacts', 'domain', 'stages.py', 'read-stage.py', 'selection-template.py', 'inputs.json'];
  graph.id = id; graph.entry = 'mine-start'; delete graph.loops;
  const kept = new Set(['mine-start', 'merge-join', 'blocked', ...contract.workshops.flatMap((w: { id: string }) => [w.id, 'read-' + w.id])]);
  graph.nodes = graph.nodes.filter((n: { id: string }) => kept.has(n.id));
  graph.nodes.find((n: { id: string }) => n.id === 'merge-join').parameters = {
    rules: ['route-selection-known', 'selection-count-at-least'], bind: { minimum_selected: { from: 'goal', name: 'minimum_selected' } },
  };
  graph.edges = graph.edges.filter((e: { from: string; to: string }) => kept.has(e.from) && kept.has(e.to));
  graph.edges.push(...contract.workshops.map((w: { id: string }) => ({ from: 'mine-start', to: w.id })));
  writeFileSync(path.join(folder, 'contract.yml'), YAML.stringify(contract));
  writeFileSync(path.join(folder, 'graph.yml'), YAML.stringify(graph));
  writeFileSync(path.join(folder, 'rules/selection-count-at-least.yml'), YAML.stringify({
    id: 'selection-count-at-least', version: '1', title: 'Requested finite route selection count',
    parameter: { name: 'minimum_selected', unit: 'count' },
    requires: [{ type: 'selected_count' }], subject: { type: 'selected_count' },
    predicate: { op: 'gte', threshold: { parameter: 'minimum_selected' }, unit: 'count' },
  }));
  loadPack(packsDirOf(home), id); // The full loader catches unused Goal/strategy bindings before a Host/model.
  const sites = path.join(home.home, 'hima/sites'); mkdirSync(sites, { recursive: true });
  const site = YAML.parse(readFileSync(path.join(repoRoot, 'sites/linglong-aes/site.yml'), 'utf8'));
  site.name = 'aes-mining-check'; site.bindings.flowRoot = staging.root;
  site.permit = './aes-mining-check.permit.yml';
  site.capacity.licences = { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 };
  writeFileSync(path.join(sites, 'aes-mining-check.yml'), YAML.stringify(site));
  cpSync(path.join(repoRoot, 'sites/linglong-aes/permit.yml'), path.join(sites, 'aes-mining-check.permit.yml'));
  writeFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');
  check.observed.realEdaRequested = false;
  check.observed.scope = 'Six actual-source Workshop selections and independent readers; SSH/local Python only. No DC, LC, layout, characterization or Innovus Job is requested in this check.';
  check.observed.staging = staging;
  check.observed.sourceMethod = packDigestOf(source);
  check.observed.sliceMethod = packDigestOf(folder);
  check.observed.packFolder = folder;
  process.chdir(home.workspace);
  const host = await bootInProcess(home); check.attach(host);
  const owner = check.track(await createRootAgent(host.ctx, home.workspace));
  guardInstalled(check, host, [folder, realpathSync(path.join(home.profileDir, 'node_modules/@hima/harness')), home.workspace], folder);
  const start = await host.ctx.hima.startRun({ pack: id, site: 'aes-mining-check', goal: { minimum_selected: 1 },
    strategy: { algorithmRevision: 0 }, generationLimit: 1, retryAllowance: 2,
    timeBoxMs: 15 * 60_000, ownerSessionId: String(owner.id) });
  check.require('finite slice admitted', start.kind === 'ran', start);
  if (start.kind !== 'ran') throw new Error('slice not admitted');
  const runId = start.run.id;
  await check.say(owner, [
    'Continue the authorized PLS-25 bounded research Run ' + runId + ' using hima_context and hima_execute. You own every node.',
    'This is an explicitly scoped six-Workshop L4 check, not the complete physical flow. The finite source reports came from actual AES mining. No new EDA, new Run, method edits, release or independent model/Agent is authorized here.',
    'Read the Pack knowledge, declared compact research_ROUTE view and source record through the controlled Workshop interface. The raw report can exceed the chat read cap; your executable must use the complete raw file. Then write and actually execute a self-contained, data-dependent Python selection algorithm for each route.',
    'Use source support, Boolean contract, implementation route and the route objective. Inspect overlaps and tradeoffs where source data permits. Keep exact candidate identities; do not bake ids or scores into code. At most two buildable candidates per route; preserve honest empty results.',
    'The selected.json schema and argv are in each Workshop recommendation and full-mining-method.md. codeSha256 in that file is the source miner hash; your selection code identity is the actual launch CodeRecord. Do not confuse them.',
    'Read selectionTemplate, copy its source as entry.py and implement only choose(candidates, route). Keep main() and the I/O/validation code unchanged. This scaffold writes exactly sourceSha256, selected (ids only), codeSha256 and validates the result. Do not add commentary or extra fields to selected.json, or execute diagnostic-only entries. If a program fails, use a fresh admitted retry within the two-attempt allowance; do not complete it as successful.',
    'Drive the six branches under the existing Site cap. Complete each reader and the join only when available; actual Job completion is evidence. Wait for notifications instead of repeatedly polling. Finish with what was selected and why, exact limits, and any rejected candidate or missing fact.',
    'There is deliberately no full-flow Goal-met decision in this slice. Its ending does not establish physical improvement. Do not create TEST.md or VERSION.yml.',
  ].join('\n'));
  for (let i = 0; i < 3 && !(host.ctx.hima.ledger.run(runId)!.status ?? '').startsWith('ended-'); i++) {
    check.require('no exhausted mandatory node needs a human clearance',
      !host.ctx.hima.executionContext(runId).executions.some(e => e.phase === 'failed' && e.result?.kind === 'blocked'),
      host.ctx.hima.executionContext(runId).executions);
    await check.until('current Workshop Jobs settle', () => !host.ctx.hima.executionContext(runId).executions.some(e => e.phase === 'working'), 60_000);
    await check.say(owner, 'Continue only the existing six-route check from its actual context. Complete remaining authorized work and report the measured selection facts; do not start a second Run.');
  }
  const run = host.ctx.hima.ledger.run(runId)!;
  const records = host.ctx.hima.ledger.records({ runId });
  const code = records.filter(r => r.type === 'code');
  const selected = records.filter(r => r.type === 'observation' && r.reader.reportKind === 'aes-dtco-selection/1');
  check.require('all six selections were independently observed', selected.length === 6, selected);
  const actual = Object.values(run.control!.executions).filter(e => e.intent?.workshop?.entry && e.phase === 'completed');
  check.require('six actual same-owner code launches', actual.length === 6 && actual.every(e => code.some(c =>
    c.path === e.intent!.workshop!.entry.path && c.sha256 === e.intent!.workshop!.entry.sha256 && c.sessionId === String(owner.id))), { actual, code });
  check.require('source method unchanged', packDigestOf(source) === check.observed.sourceMethod && packDigestOf(folder) === check.observed.sliceMethod, { source: packDigestOf(source), slice: packDigestOf(folder) });
  check.require('bounded slice ended without a physical success claim', run.status === 'ended-goal-not-met', run);
  check.require('no hidden research agent', !records.some(r => r.type === 'session'), records.filter(r => r.type === 'session'));
  check.observed.runId = runId;
  check.observed.code = code;
  check.observed.sourceReceiptSha256 = sha256(readFileSync(stagedFile));
  cpSync(folder, path.join(check.out, 'pack'), { recursive: true });
});
