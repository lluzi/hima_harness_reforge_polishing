// @hima-seam llm-replay direct
// #66 H1, H2a (ATCS-09): what a Pack Agent Team recipe may declare for its Operator, and what the Host
// grants when it materializes that Operator.
//
// - H1: the reviewed-scope mutation cap a recipe may declare reaches 600 (a coordinated manual-ECO
//   batch is tens to hundreds of edits); 601 is still refused at load.
// - H2a: a recipe-materialized Operator gets the Team member's declared `budgetShare` (time,
//   follow-ups, tokens per turn), held only to the lane's unreserved time and the Run's time box. A
//   manually contracted Operator keeps the Host's own 20-minute, one-follow-up, 5000-token default.
//
// The fixture is the timing probe's interactive `synthesize` node with a request-scope Operator: the
// admitted plan carries its own scope, so the Operator is materialized with no Reviewer in front of it.
import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest, loadPack, packDigestExcludes, retainRunMaterial } from '@hima/harness';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { appendReplaySession, type MomentScenarioFixture } from './support/moments.ts';
import { timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const packId = 'recipe-budget';
const MINUTE = 60_000;
/** The share the ATCS-09 Operator declares: about 40 minutes, four follow-ups, 12 000 tokens a turn. */
const operatorShare = { maxElapsedMs: 40 * MINUTE, maxFollowups: 4, maxTokensPerTurn: 12_000 };

const operatorMember = (maxMutations: number) => ({
  id: 'operator', role: 'operator', node: 'synthesize', taskTemplate: 'Operate the session inside the admitted plan\'s scope.',
  inputs: ['qorReport'], allowedTools: ['hima_interactive'], scopePolicy: 'site-qualified-interactive-only',
  budgetShare: operatorShare, dependencyRoles: [], resultSchema: { id: 'fixture-operator/1', required: ['schema'] },
  recipient: 'run-owner', ownerAdoption: 'required', identity: 'one-child-per-role-per-execution', followup: 'reuse-same-child',
  cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
  refusalConditions: ['missing-evidence'],
  reviewedAction: { mode: 'request-scope', planInput: 'qorReport', scopePath: ['scope'], commands: ['size_cell'],
    maxMutations, hostPlanHashArgument: 'planSha256' },
});

/** The timing probe with an interactive `synthesize` node and one request-scope Operator recipe. */
async function writeRecipePack(packsDir: string, wrapper: string, maxMutations: number): Promise<string> {
  await writePackVariant(packsDir, packId, [], [], timingProbePackId);
  const contractFile = path.join(packsDir, packId, 'contract.yml');
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  contract.environment.wrappers = [wrapper];
  contract.workspace.copy.push('interactive-repl.tcl');
  const tool = contract.tools.find((candidate: { id: string }) => candidate.id === 'synth');
  tool.licences = {};
  tool.argv = [wrapper, '${WORKSPACE}/flow/interactive-repl.tcl'];
  tool.interactive = { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', argv: tool.argv, commands: {
    read: ['get_value'], mutate: ['size_cell'], save: ['save_state', 'close_session'],
  }, arguments: {
    get_value: [{ name: 'key', type: 'string' }],
    size_cell: [{ name: 'instance', type: 'string' }, { name: 'master', type: 'string' }, { name: 'planSha256', type: 'string' }],
    save_state: [{ name: 'file', type: 'string' }], close_session: [],
  } };
  contract.agentTeams = [{ id: 'budget-team', version: '1', triggerNode: 'synthesize', members: [operatorMember(maxMutations)] }];
  await writeFile(contractFile, stringify(contract));
  return contractFile;
}

/** The loaded Pack, or a failure naming exactly why it did not load. */
function loads(packsDir: string, label: string): ReturnType<typeof loadPack> {
  try { return loadPack(packsDir, packId); }
  catch (error) { assert.fail(`${label} does not load: ${(error as Error).message}`); }
}

test('H1: a Pack recipe may declare a reviewed-scope cap of 600 mutations; 601 is refused at load', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h } = local;
  t.after(() => h.dispose());
  const packsDir = path.join(h.home, 'hima/packs');
  const wrapper = await realpath('/usr/bin/tclsh');
  const contractFile = await writeRecipePack(packsDir, wrapper, 600);
  const loaded = loads(packsDir, 'a request-scope cap of 600');
  const reviewed = loaded.contract.agentTeams[0]!.members[0]!.reviewedAction;
  assert.equal(reviewed?.mode === 'request-scope' ? reviewed.maxMutations : undefined, 600, 'a request-scope cap of 600 loads');
  // The Reviewer-approved scope mode shares the same bound.
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  const reviewer = { ...operatorMember(600), id: 'reviewer', role: 'reviewer', inputs: ['qorReport'], allowedTools: ['hima_delegation_input'],
    scopePolicy: 'declared-inputs-only', budgetShare: { maxElapsedMs: 30_000, maxFollowups: 1 },
    resultSchema: { id: 'fixture-scope-review/1', required: ['schema', 'planSha256', 'scope'] }, reviewedAction: undefined };
  const scopeTeam = (maxMutations: number) => [{ id: 'budget-team', version: '1', triggerNode: 'synthesize', members: [reviewer,
    { ...operatorMember(maxMutations), dependencyRoles: ['reviewer'], reviewedAction: { mode: 'scope', fromRole: 'reviewer',
      planInput: 'qorReport', commands: ['size_cell'], maxMutations, hostPlanHashArgument: 'planSha256', planHashField: 'planSha256',
      scopeField: 'scope' } }] }];
  await writeFile(contractFile, stringify({ ...contract, agentTeams: scopeTeam(600) }));
  const scoped = loads(packsDir, 'a Reviewer-approved scope cap of 600').contract.agentTeams[0]!.members[1]!.reviewedAction;
  assert.equal(scoped?.mode === 'scope' ? scoped.maxMutations : undefined, 600, 'a Reviewer-approved scope cap of 600 loads');
  for (const [label, agentTeams] of [
    ['a request-scope cap of 601', [{ ...contract.agentTeams[0], members: [operatorMember(601)] }]],
    ['a Reviewer-approved scope cap of 601', scopeTeam(601)],
  ] as const) {
    await writeFile(contractFile, stringify({ ...contract, agentTeams }));
    assert.throws(() => loadPack(packsDir, packId), /maxMutations[\s\S]*(<=600|too big)/i, `${label} does not load`);
  }
});
