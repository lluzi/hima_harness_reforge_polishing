// Deterministic semantic probe. The model-authored checkpoint is read-only and copied into a
// disposable Host. No Agent/model, Job or Run is created in the original home.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { choose, loadPack, packDigestOf, resolveChooser } from '@hima/harness';
import { createHimaHome } from '../../../../../test/contract/support/dsh-home.ts';
import { bootInProcess } from '../../../../../test/contract/support/boot-inprocess.ts';

const started = performance.now();
const out = path.dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp('/tmp/hima-chooser-');
process.env.TMPDIR = temporary;
process.env.TMUX_TMPDIR = temporary;
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.DSH_TELEMETRY_DISABLED = '1';
const home = await createHimaHome();
const packsDir = path.join(home.home, 'hima/packs');
await mkdir(packsDir, { recursive: true });
await cp(path.join(out, 'model-authored-checkpoint'), path.join(packsDir, 'authored-numeric'), { recursive: true });
const host = await bootInProcess(home);
const results = [];
try {
  await host.ctx.hima.reconciled;
  const pack = loadPack(packsDir, 'authored-numeric');
  const judge = pack.graph.nodes.find((node) => node.kind === 'judge');
  const explore = pack.graph.nodes.find((node) => node.kind === 'explore');
  const { chooser } = resolveChooser(pack, explore.parameters.chooser, 'the reading');
  const explicit = structuredClone(chooser);
  explicit.decide[1].when.goal = 'FAIL';
  const reordered = structuredClone(chooser);
  reordered.decide.reverse();
  const overclaims = structuredClone(chooser);
  delete overclaims.decide[0].when.goal;

  async function evaluate(label, value, minimum) {
    const strategy = { limit: pack.contract.strategy.limit.default };
    const run = await host.ctx.hima.ledger.createRun({ campaignId: `semantic-${label}`, siteId: 'local', packId: pack.id, packDigest: packDigestOf(path.join(packsDir, pack.id)), generation: 1, goal: minimum === undefined ? {} : { minimum }, strategy });
    const bytes = Buffer.from(value === null ? 'unknown\n' : `${value}\n`);
    const at = path.join(home.workspace, `${label}.txt`);
    await writeFile(at, bytes);
    const observation = await host.ctx.hima.ledger.appendObservation(run.id, { path: at, contentSha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      reader: { id: 'semantic-probe', version: '1', reportKind: 'synthetic-numeric-input', emits: ['numeric_sum'] },
      values: [{ type: 'numeric_sum', unit: 'count', value, ...(value === null ? { unknownReason: 'deliberately unknown semantic test input' } : {}) }] });
    const [constraint, goal] = await host.ctx.hima.judge.evaluate({ runId: run.id, ruleIds: judge.parameters.rules, params: minimum === undefined ? {} : { minimum } });
    const input = { knobs: pack.contract.strategy, strategy, bound: explore.parameters.bind, constraint, goal, observation };
    const answers = { label, value, minimum: minimum ?? 'unbound', constraint: constraint.outcome, goal: goal.outcome, original: choose(chooser, input), explicit: choose(explicit, input), reordered: choose(reordered, input), overclaims: choose(overclaims, input) };
    results.push(answers);
    return answers;
  }
  // Independent expected outcomes at the two binding boundaries and on both sides of the Goal.
  for (const [label, value, minimum, expected] of [
    ['zero-bound', 0, 0, 'PASS'], ['below-minimum', 0, 1, 'FAIL'], ['at-minimum', 1, 1, 'PASS'],
    ['above-minimum', 2, 1, 'PASS'], ['below-max-bound', 9999, 10000, 'FAIL'], ['at-max-bound', 10000, 10000, 'PASS'],
  ]) {
    const got = await evaluate(label, value, minimum);
    assert.equal(got.constraint, 'PASS');
    assert.equal(got.goal, expected);
    assert.deepEqual(got.original, got.explicit);
    assert.equal(got.original.ok, true);
    assert.deepEqual(got.original.chosen, expected === 'PASS' ? { goalMet: true } : { strategy: { limit: 0 } });
  }
  const below = results.find((row) => row.label === 'below-minimum');
  assert.deepEqual(below.overclaims.chosen, { goalMet: true }, 'dropping Goal from the first clause incorrectly claims an unmet Goal');
  const at = results.find((row) => row.label === 'at-minimum');
  assert.deepEqual(at.reordered.chosen, { strategy: { limit: 0 } }, 'moving the broad fallback first incorrectly hides Goal completion');
  const unknown = await evaluate('unknown-reading', null, 1);
  assert.equal(unknown.goal, 'UNDETERMINED');
  assert.equal(unknown.original.ok, false);
  assert.equal(unknown.explicit.ok, false);
  const unbound = await evaluate('unbound-goal', 1, undefined);
  assert.equal(unbound.goal, 'UNDETERMINED');
  assert.equal(unbound.original.ok, true);
  assert.equal(unbound.explicit.ok, false, 'the equivalence is intentionally limited to the verified bound, finite numeric Goal domain');
  assert.equal(host.ctx.get('agents').list().length, 0);
  assert.equal(host.ctx.hima.ledger.runs().flatMap((run) => host.ctx.hima.ledger.records({ runId: run.id, type: 'job' })).length, 0);
  await writeFile(path.join(out, 'semantic-results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(`Elapsed: ${((performance.now() - started) / 1000).toFixed(3)}s`);
  console.log('PASS: 6 finite/bound Goal cases agree through actual Judge + choose; 2 ordering/overclaim counterexamples detected; unknown reading refused; unbound Goal demonstrates the excluded non-equivalent domain. 1 private Host, 0 Agents, 0 Jobs.');
} finally {
  await host.dispose(); await home.dispose(); await rm(temporary, { recursive: true, force: true });
}
