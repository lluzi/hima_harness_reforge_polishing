// @hima-seam llm-replay direct
// Retained load-only legacy declaration fixture; never starts a Run.
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { repoRoot } from './dsh-home.ts';
export const packId = 'branch-autopilot';
const branches = [
  { id: 'a', workshop: 'plan-a', read: 'read-plan-a', operate: 'operate-a', capture: 'capture-a', output: 'planA', problems: 'planAProblems', team: 'team-a', toMaster: 'BUF2' },
  { id: 'b', workshop: 'plan-b', read: 'read-plan-b', operate: 'operate-b', capture: 'capture-b', output: 'planB', problems: 'planBProblems', team: 'team-b', toMaster: 'BUF4' },
] as const;
type Branch = (typeof branches)[number];

interface Fixture {
  /** The branch child's share when it authors a Workshop entry. */
  readonly authorMs: number;
  /** The Operator's follow-ups: one repair when the member allows it. */
  readonly operatorFollowups: number;
  /** An extra graph edit, for the load-refusal cases. */
  readonly graphEdit?: (graph: Record<string, any>) => void;
  /**
   * Native children (#66 H2b): the autopilot reads each child's own completed turn, and every live
   * model session replays this script. Absent, children are played through the Ledger.
   */
  readonly native?: readonly ReplayEntry[];
  /** The Operator member's declared share (60 s when absent). */
  readonly operatorMs?: number;
  /** The Site's job lanes (2 when absent); a Run's delegation time is its time box on each lane. */
  readonly lanes?: number;
}
export const defaults: Fixture = { authorMs: 30_000, operatorFollowups: 1 };

const teamOf = (branch: Branch, fixture: Fixture) => ({ id: branch.team, version: '1', triggerNode: branch.operate, members: [
  // Advisory only: optional, never materialized by the autopilot, and nothing depends on it.
  { id: 'reviewer', role: 'reviewer', optional: true, node: branch.operate, taskTemplate: `Advise branch ${branch.id}'s Operator.`,
    inputs: [branch.output], allowedTools: ['hima_delegation_input'], scopePolicy: 'declared-inputs-only',
    budgetShare: { maxElapsedMs: 30_000, maxFollowups: 0 }, dependencyRoles: [],
    resultSchema: { id: 'fixture-advice/1', required: ['schema'] }, recipient: 'run-owner', ownerAdoption: 'candidate-only',
    identity: 'one-child-per-role-per-execution', followup: 'forbidden', cancellation: 'request-stop-preserve-unknown',
    terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'], refusalConditions: ['missing-evidence'] },
  { id: 'operator', role: 'operator', node: branch.operate, taskTemplate: `Operate branch ${branch.id}'s session inside the plan's scope.`,
    inputs: [branch.output], allowedTools: ['hima_interactive'], scopePolicy: 'site-qualified-interactive-only',
    budgetShare: { maxElapsedMs: fixture.operatorMs ?? 60_000, maxFollowups: fixture.operatorFollowups }, dependencyRoles: [],
    resultSchema: { id: 'fixture-operator/1', required: ['schema', 'planSha256'] }, recipient: 'run-owner', ownerAdoption: 'required',
    identity: 'one-child-per-role-per-execution', followup: fixture.operatorFollowups === 0 ? 'forbidden' : 'reuse-same-child',
    cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
    refusalConditions: ['missing-evidence'], taskInputs: [{ input: branch.output }],
    reviewedAction: { mode: 'request-scope', planInput: branch.output, scopePath: ['scope'], commands: ['atcs_size_cell'],
      maxMutations: 5, hostPlanHashArgument: 'planSha256' } },
] });

export async function writePack(packsDir: string, tclsh: string, fixture: Fixture): Promise<string> {
  const dir = path.join(packsDir, packId);
  for (const sub of ['flow', 'readers', 'rules', 'tools']) await mkdir(path.join(dir, sub), { recursive: true });
  const repl = ['${WORKSPACE}/flow/atcs-repl.tcl', '${WORKSPACE}/research/branch-${SLOT}'];
  const contract = {
    id: packId, version: '1', title: 'Two self-driving interactive Team branches joined at one judge',
    inputs: [
      { name: 'flowRoot', description: 'Unused legacy flow root' },
      { name: 'design', description: 'Unused legacy design' },
      { name: 'workspaceRoot', description: 'Campaign workspaces' },
    ],
    outputs: [
      { name: 'seed', path: 'flow/seed.txt', description: 'What the fork source reads' },
      ...branches.flatMap((branch) => [
        { name: branch.output, path: `research/branch-${branch.id}/plan.json`, reader: 'plan-file', description: `Branch ${branch.id} plan` },
        { name: branch.problems, path: `research/branch-${branch.id}/plan.problems.txt`, description: `Branch ${branch.id} plan problems` },
      ]),
    ],
    environment: { wrappers: ['sh', tclsh] },
    workspace: { source: 'pack', copy: ['seed.txt', 'atcs-repl.tcl', 'capture.sh'] },
    workshops: branches.map((branch) => ({
      id: branch.workshop, purpose: `Write branch ${branch.id}'s one-action plan with its scope.`,
      directory: `research/branch-${branch.id}`, entry: 'entry.sh', language: 'sh', produces: branch.output,
      reads: [branch.problems], revision: { refusedWhen: 'plan_problem_count', problems: branch.problems },
      argv: ['sh', '${ENTRY}', '${WORKSHOP}', '${WORKSPACE}'],
    })),
    tools: [
      { id: 'operator', file: 'flow/atcs-repl.tcl', description: 'One branch slot of the synthetic interactive REPL.',
        inputs: ['WORKSPACE', 'SLOT'], licences: { xtop: 1 }, argv: [tclsh, ...repl],
        interactive: { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', argv: [tclsh, ...repl],
          commands: { read: ['atcs_query_paths'], mutate: ['atcs_size_cell'], save: ['atcs_dump_cells', 'atcs_export_changes'], close: ['atcs_close'] },
          arguments: {
            atcs_query_paths: [],
            atcs_size_cell: [{ name: 'instance', type: 'string' }, { name: 'toMaster', type: 'string' }, { name: 'planSha256', type: 'string' }],
            atcs_dump_cells: [{ name: 'path', type: 'string' }], atcs_export_changes: [], atcs_close: [],
          } } },
      { id: 'capture', file: 'flow/capture.sh', description: 'Seal one branch slot\'s operation log.',
        inputs: ['WORKSPACE', 'SLOT'], argv: ['sh', '${WORKSPACE}/flow/capture.sh', '${WORKSPACE}/research/branch-${SLOT}'] },
    ],
    agentTeams: branches.map((branch) => teamOf(branch, fixture)),
    rules: ['plan-has-action'],
    strategy: { width: { type: 'number', unit: 'count', min: 1, max: 4, default: 2 } },
    words: { width: { label: 'fork width', unit: 'count' } },
  };
  const graph: Record<string, any> = {
    id: packId, version: '1', entry: 'start',
    nodes: [
      { id: 'start', kind: 'act', parameters: { observes: 'seed' } },
      ...branches.flatMap((branch) => [
        { id: branch.workshop, kind: 'act', parameters: { workshop: branch.workshop } },
        { id: branch.read, kind: 'act', parameters: { observes: branch.output } },
        { id: branch.operate, kind: 'act', parameters: { tool: 'operator', arguments: { SLOT: branch.id } } },
        { id: branch.capture, kind: 'act', parameters: { tool: 'capture', arguments: { SLOT: branch.id } } },
      ]),
      { id: 'judge', kind: 'judge', parameters: { rules: ['plan-has-action'] } },
      { id: 'finish', kind: 'act', parameters: { observes: 'seed' } },
    ],
    edges: [
      ...branches.flatMap((branch) => [
        { from: 'start', to: branch.workshop },
        { from: branch.workshop, to: branch.read },
        { from: branch.read, to: branch.operate },
        { from: branch.operate, to: branch.capture },
        { from: branch.capture, to: 'judge' },
      ]),
      { from: 'judge', to: 'finish', outcome: 'PASS' }, { from: 'judge', to: 'finish', outcome: 'FAIL' },
      { from: 'judge', to: 'finish', outcome: 'UNDETERMINED' },
    ],
    autopilot: [{ fork: 'start', revisions: 1, author: { maxElapsedMs: fixture.authorMs, maxFollowups: 3 } }],
  };
  fixture.graphEdit?.(graph);
  const values = {
    plan_action_count: { unit: 'count', description: 'Actions in one branch plan' },
    plan_problem_count: { unit: 'count', description: 'Problems the Reader counted in one branch plan' },
  };
  await writeFile(path.join(dir, 'contract.yml'), stringify(contract));
  await writeFile(path.join(dir, 'graph.yml'), stringify(graph));
  await writeFile(path.join(dir, 'semantics.yml'), stringify({ values }));
  await writeFile(path.join(dir, 'PACK.md'), '# Self-driving fork of interactive Team branches (test fixture)\n');
  await writeFile(path.join(dir, 'readers/plan-file.yml'), stringify({ id: 'plan-file', version: '1', file: 'tools/read-plan.sh',
    argv: ['sh', '${READER}', '${REPORT}', '${OUT}'], reportKind: 'fix-plan', emits: ['plan_action_count', 'plan_problem_count'] }));
  await writeFile(path.join(dir, 'rules/plan-has-action.yml'), stringify({ id: 'plan-has-action', version: '1',
    title: 'The branch plan names at least one action', requires: [{ type: 'plan_action_count' }],
    subject: { type: 'plan_action_count' }, predicate: { op: 'gte', threshold: 1, unit: 'count' } }));
  // The Reader counts one problem for a plan with no action, and writes its itemized refusal beside it.
  await writeFile(path.join(dir, 'tools/read-plan.sh'), [
    '#!/bin/sh', 'set -eu', 'count=$(grep -o \'"instance"\' "$1" | wc -l | tr -d " ")',
    'problems=0; [ "$count" -gt 0 ] || problems=1',
    'if [ "$problems" -gt 0 ]; then printf \'1 problem\\n- actions: name at least one action with an instance\\n\' > "${1%.json}.problems.txt";',
    'else printf \'0 problems\\n\' > "${1%.json}.problems.txt"; fi',
    'printf \'{"values":[{"type":"plan_action_count","unit":"count","value":%s},{"type":"plan_problem_count","unit":"count","value":%s}]}\\n\' "$count" "$problems" > "$2"', '',
  ].join('\n'));
  await writeFile(path.join(dir, 'flow/seed.txt'), 'two branches\n');
  await writeFile(path.join(dir, 'flow/capture.sh'), '#!/bin/sh\nset -eu\ncp "$1/ops.jsonl" "$1/captured.jsonl"\n');
  await cp(path.join(repoRoot, 'test/fixtures/interactive-job/atcs-repl.tcl'), path.join(dir, 'flow/atcs-repl.tcl'));
  return dir;
}
