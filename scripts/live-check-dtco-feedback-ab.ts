// @hima-seam agent wrapped
// @hima-seam tools direct
// Live-only S07 qualification: two real DeepSeek turns over one frozen DTCO input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { homePatchFile } from '../packages/desktop/src/hima-home.ts';
import {
  bootInProcess,
  createRootAgent,
  saidByModel,
  toolCalls,
} from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { runLive, type LiveCheck } from './live-check-workshop.ts';

const NAME = 'live-check-dtco-feedback-ab';
const KEY_VARIABLE = 'DEEPSEEK_API_KEY';
const EXPECTED_PROVIDER = 'deepseek-official';
const EXPECTED_MODEL = 'deepseek-flash';
const RUNNER = path.join(repoRoot, 'packs/custom-cell-fmax-dtco/flow/ai_research_runner.py');
const PYTHON = '/usr/bin/python3';
const MAX_BRIDGE_BYTES = 32 * 1024 * 1024;

const usage = [
  'usage: node scripts/live-check-dtco-feedback-ab.ts --request <workspace/flow/library-richness/research-context.json> --out <fresh-directory> [--timeout-ms 600000]',
  '',
  'Live-only L4 qualification. Requires DEEPSEEK_API_KEY in the inherited environment.',
  'Runs exactly two native deepseek-flash turns: the same frozen pool/budget/sources first without, then with, the request\'s hash-bound commercial_response.',
  'Rejects replay, runs no commercial EDA, and makes no PPA claim.',
].join('\n');

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}

// Credential refusal precedes path inspection, output creation, Home preparation, Host boot and model work.
const key = process.env[KEY_VARIABLE];
if (key === undefined || key.trim() === '') {
  process.stderr.write(`${NAME}: missing ${KEY_VARIABLE}; nothing read or written, no Host booted, and no model requested.\n`);
  process.exit(2);
}

const options = new Map<string, string>();
for (let index = 0; index < rawArgs.length; index += 2) {
  const name = rawArgs[index];
  const value = rawArgs[index + 1];
  if (!name || !['--request', '--out', '--timeout-ms'].includes(name)
      || !value || value.startsWith('--') || options.has(name)) {
    throw new Error(usage);
  }
  options.set(name, value);
}
const requestArgument = options.get('--request');
const outArgument = options.get('--out');
if (!requestArgument || !outArgument) throw new Error(usage);

const requestPath = realpathSync(path.resolve(requestArgument));
assert.ok(lstatSync(requestPath).isFile() && !lstatSync(requestPath).isSymbolicLink(), 'research request must be one plain file');
assert.equal(path.basename(requestPath), 'research-context.json', 'research request must be named research-context.json');
assert.equal(path.basename(path.dirname(requestPath)), 'library-richness', 'research request must be under flow/library-richness');
assert.equal(path.basename(path.dirname(path.dirname(requestPath))), 'flow', 'research request must be under flow/library-richness');

// LiveCheck owns the remaining common live-only options. Keep this check at exactly two user turns.
process.argv = [
  process.argv[0]!, process.argv[1]!, '--out', outArgument,
  ...(options.has('--timeout-ms') ? ['--timeout-ms', options.get('--timeout-ms')!] : []),
  '--max-turns', '2', '--max-steps', '4',
];

interface PreparedInput {
  readonly requestSha256: string;
  readonly runnerSha256: string;
  readonly frozenInputIdentity: string;
  readonly frozenSources: Record<string, unknown>;
  readonly budget: Record<string, number>;
  readonly candidatePool: { readonly sourceSha256: string; readonly proposalKeys: readonly string[] };
  readonly commercialResponse: { readonly evidenceSha256: string; readonly responseSha256: string; readonly endpointCoverage: string };
  readonly arms: {
    readonly withoutFeedback: Record<string, unknown>;
    readonly withFeedback: Record<string, unknown>;
  };
}

interface ValidatedResult {
  readonly validator: {
    readonly runnerSha256: string;
    readonly functions: readonly string[];
  };
  readonly arms: {
    readonly withoutFeedback: { readonly proposal: Record<string, unknown>; readonly candidateProposals: readonly Record<string, unknown>[]; readonly execution: Record<string, unknown>; readonly selectedProposalKeys: readonly string[] };
    readonly withFeedback: { readonly proposal: Record<string, unknown>; readonly candidateProposals: readonly Record<string, unknown>[]; readonly execution: Record<string, unknown>; readonly selectedProposalKeys: readonly string[] };
  };
  readonly feedbackAb: {
    readonly performed: boolean;
    readonly selectionChanged: boolean;
    readonly selectionEffect: { readonly kind: 'changed' | 'unchanged'; readonly reason: string; readonly addedProposalKeys: readonly string[]; readonly removedProposalKeys: readonly string[] };
    readonly interpretation: string;
  };
  readonly generationFeedback: Record<string, unknown>;
}

const pythonBridge = String.raw`
import copy
import hashlib
import json
from pathlib import Path
import sys

runner_path = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(runner_path.parent))
import ai_research_runner as runner

def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def load_pair(request_path):
    request_path = Path(request_path).resolve()
    request_raw = request_path.read_bytes()
    request = json.loads(request_raw)
    if "candidate_pool" not in request or "commercial_response" not in request:
        raise ValueError("qualification requires one hash-bound candidate_pool and commercial_response")
    evidence_root = request_path.parent
    with_feedback = runner.load_residual_research_context(request, evidence_root=evidence_root)
    without_request = copy.deepcopy(request)
    without_request.pop("commercial_response")
    without_feedback = runner.load_residual_research_context(without_request, evidence_root=evidence_root)
    with_sources = copy.deepcopy(with_feedback["evidence"])
    commercial_source = with_sources.pop("commercial_response")
    if with_sources != without_feedback["evidence"]:
        raise ValueError("non-commercial source identities differ between A/B arms")
    if with_feedback["budgets"] != without_feedback["budgets"]:
        raise ValueError("budgets differ between A/B arms")
    if with_feedback["candidate_pool"] != without_feedback["candidate_pool"]:
        raise ValueError("candidate pool differs between A/B arms")
    if with_feedback["round_id"] != without_feedback["round_id"] or with_feedback["next_residual_question"] != without_feedback["next_residual_question"]:
        raise ValueError("round or residual question differs between A/B arms")
    pool = with_feedback["candidate_pool"]
    if pool.get("count", 0) < 1:
        raise ValueError("qualification requires a non-empty frozen candidate pool")
    commercial = with_feedback.get("commercial_frontier_response")
    if not isinstance(commercial, dict):
        raise ValueError("validated commercial feedback is absent")
    frozen = {
        "schema": request["schema"], "round_id": request["round_id"],
        "evaluation": request["evaluation"], "frontier": request["frontier"],
        "manifest": request["manifest"], "history": request["history"],
        "candidate_pool": request["candidate_pool"], "budgets": request["budgets"],
        "next_residual_question": request["next_residual_question"],
    }
    return request, without_feedback, with_feedback, {
        "requestSha256": sha(request_raw),
        "runnerSha256": sha(runner_path.read_bytes()),
        "frozenInputIdentity": sha(canonical(frozen)),
        "frozenSources": with_sources,
        "budget": with_feedback["budgets"],
        "candidatePool": {
            "sourceSha256": pool["source_sha256"],
            "proposalKeys": [row["proposal_key"] for row in pool["proposals"]],
        },
        "commercialResponse": {
            "evidenceSha256": commercial_source["sha256"],
            "responseSha256": commercial["response_sha256"],
            "endpointCoverage": commercial["endpoint_coverage"],
        },
        "arms": {"withoutFeedback": without_feedback, "withFeedback": with_feedback},
    }

action = sys.argv[1]
payload = json.load(sys.stdin)
request, without_context, with_context, prepared = load_pair(payload["requestPath"])
if action == "prepare":
    print(json.dumps(prepared, sort_keys=True, separators=(",", ":")))
elif action == "validate":
    workspace = Path(payload["requestPath"]).resolve().parent.parent.parent
    registry = runner.load_candidate_pool_registry(workspace)
    def validate_arm(raw, context):
        proposal = runner.validate_residual_research_proposal(raw, context)
        candidates, execution = runner.execute_candidate_program(
            proposal["candidate_program"], context,
            allowed_lenses=[row["name"] for row in proposal["research_lenses"]],
            candidate_registry=registry,
        )
        keys = [row["transformation"]["proposal_key"] for row in candidates]
        return {"proposal": proposal, "candidateProposals": candidates,
                "execution": execution, "selectedProposalKeys": keys}
    before = validate_arm(payload["withoutFeedbackProposal"], without_context)
    after = validate_arm(payload["withFeedbackProposal"], with_context)
    feedback = runner._feedback_ab(
        before["selectedProposalKeys"], after["selectedProposalKeys"],
        after["proposal"]["feedback_interpretation"], before["execution"])
    result = {
        "validator": {
            "runnerSha256": prepared["runnerSha256"],
            "functions": ["load_residual_research_context", "validate_residual_research_proposal",
                          "execute_candidate_program", "_feedback_ab", "_generation_feedback"],
        },
        "arms": {"withoutFeedback": before, "withFeedback": after},
        "feedbackAb": {
            "performed": feedback["performed"],
            "selectionChanged": feedback["selection_changed"],
            "selectionEffect": {
                "kind": feedback["selection_effect"]["kind"],
                "reason": feedback["selection_effect"]["reason"],
                "addedProposalKeys": feedback["selection_effect"]["added_proposal_keys"],
                "removedProposalKeys": feedback["selection_effect"]["removed_proposal_keys"],
            },
            "interpretation": feedback["interpretation"],
        },
        "generationFeedback": runner._generation_feedback(
            with_context, after["candidateProposals"], feedback),
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
else:
    raise ValueError("unknown bridge action")
`;

function callPackRunner<T>(action: 'prepare' | 'validate', payload: Record<string, unknown>): T {
  const environment = { ...process.env };
  delete environment[KEY_VARIABLE];
  const ran = spawnSync(PYTHON, ['-I', '-c', pythonBridge, action, RUNNER], {
    cwd: repoRoot,
    env: environment,
    input: `${JSON.stringify(payload)}\n`,
    encoding: 'utf8',
    maxBuffer: MAX_BRIDGE_BYTES,
    timeout: 30_000,
  });
  if (ran.error) throw ran.error;
  if (ran.status !== 0) throw new Error(`Pack feedback validator failed (${String(ran.status)}): ${ran.stderr.trim()}`);
  return JSON.parse(ran.stdout) as T;
}

function modelPrompt(context: Record<string, unknown>): string {
  return [
    'Return exactly one JSON object and no Markdown or commentary.',
    'You are qualifying one bounded DTCO residual-research decision. Use only the supplied verified context. Do not claim PPA, commercial adoption, causal endpoint improvement, or that EDA ran.',
    'The JSON object must contain exactly: research_lenses, candidate_program, feedback_interpretation, stop_reason.',
    'research_lenses must contain 1..max_research_lenses distinct objects with exactly name, question, evidence_sha256, target_metric_layers. Include onsite-inspiration. Cite only hashes present in context.evidence; when commercial_response is present, onsite-inspiration must cite its sha256.',
    'candidate_program must contain language="python", entrypoint="propose_candidates", and source. Source must define only def propose_candidates(residual, budget), use no imports, comprehensions, while, helpers, recursion, file/process/dynamic code, dict.get, or private attributes, and use only statically bounded range loops. It must return a JSON array no longer than budget["max_candidate_proposals"].',
    'Each returned candidate must contain lens, transformation, rationale. If selecting from the non-empty candidate_pool, transformation must contain one exact proposal_key from candidate_pool.proposals, a positive required_delay_ns, a non-empty target_endpoints string array, and intervention in new-function, sizing, stack-optimization, alternative-topology, physical-fusion. Do not repeat a proposal_key.',
    'feedback_interpretation must state what the available commercial feedback did or did not justify. stop_reason must explain why the finite proposal set is enough for this qualification turn. Empty selection is allowed when evidence cannot justify a demand.',
    'The Pack runner will independently validate the object and execute candidate_program in its restricted interpreter. A validator failure is a failed qualification; do not describe a schema instead of returning it.',
    '',
    'VERIFIED RESIDUAL CONTEXT:',
    JSON.stringify(context),
  ].join('\n');
}

function parseProposal(answer: string): Record<string, unknown> {
  const trimmed = answer.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced?.[1] ?? trimmed;
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('model answer is not one JSON object');
  return parsed as Record<string, unknown>;
}

async function runArm(check: LiveCheck, agent: Agent, context: Record<string, unknown>) {
  const beforeSteps = check.steps;
  await check.say(agent, modelPrompt(context));
  const requestSteps = check.steps - beforeSteps;
  const said = saidByModel(agent);
  const answer = said.at(-1);
  if (!answer) throw new Error(`session ${String(agent.id)} produced no visible answer`);
  const proposal = parseProposal(answer);
  return {
    sessionId: String(agent.id), provider: agent.options.provider, model: agent.options.model,
    requestSteps, toolCalls: toolCalls(agent), responseSha256: sha256(answer), proposal,
  };
}

function markdown(prepared: PreparedInput, validated: ValidatedResult, sessions: readonly { sessionId: string; responseSha256: string }[]): string {
  const effect = validated.feedbackAb.selectionEffect;
  return [
    '# Live check: DTCO frozen-pool feedback A/B',
    '',
    'This record qualifies two real `deepseek-flash` turns against one frozen candidate pool, budget and non-commercial source identity. It does not run commercial EDA and does not claim PPA.',
    '',
    `- Frozen input identity: \`${prepared.frozenInputIdentity}\``,
    `- Candidate pool: \`${prepared.candidatePool.sourceSha256}\` (${prepared.candidatePool.proposalKeys.length} proposals)`,
    `- Commercial feedback evidence: \`${prepared.commercialResponse.evidenceSha256}\``,
    `- Commercial response identity: \`${prepared.commercialResponse.responseSha256}\``,
    `- Pack runner: \`${prepared.runnerSha256}\``,
    `- Native sessions: ${sessions.map((row) => `\`${row.sessionId}\` / \`${row.responseSha256}\``).join(', ')}`,
    '',
    '## Selection result',
    '',
    `- Without feedback: ${JSON.stringify(validated.arms.withoutFeedback.selectedProposalKeys)}`,
    `- With feedback: ${JSON.stringify(validated.arms.withFeedback.selectedProposalKeys)}`,
    `- Effect: **${effect.kind}** — ${effect.reason}`,
    `- Added: ${JSON.stringify(effect.addedProposalKeys)}`,
    `- Removed: ${JSON.stringify(effect.removedProposalKeys)}`,
    `- Model interpretation: ${validated.feedbackAb.interpretation}`,
    '',
    'Both model proposals were checked by the existing Pack context loader, proposal validator and isolated candidate-program runner. A changed selection is not a PPA result; an unchanged selection is retained with the explicit reason above.',
    '',
  ].join('\n');
}

await runLive(NAME, 2, async (check: LiveCheck) => {
  const prepared = callPackRunner<PreparedInput>('prepare', { requestPath });
  check.require('the Pack loader verified one non-empty frozen candidate pool for both arms',
    prepared.candidatePool.proposalKeys.length > 0
      && (prepared.arms.withoutFeedback as { candidate_pool?: unknown }).candidate_pool !== undefined
      && JSON.stringify((prepared.arms.withoutFeedback as { candidate_pool?: unknown }).candidate_pool)
        === JSON.stringify((prepared.arms.withFeedback as { candidate_pool?: unknown }).candidate_pool),
    prepared.candidatePool);
  check.require('both arms retain the same deterministic budget and non-commercial source identity',
    typeof prepared.frozenInputIdentity === 'string' && prepared.frozenInputIdentity.length === 64,
    { identity: prepared.frozenInputIdentity, budget: prepared.budget, sources: prepared.frozenSources });
  check.require('the with-feedback arm carries one validated hash-bound commercial response while the other does not',
    (prepared.arms.withoutFeedback as { commercial_frontier_response?: unknown }).commercial_frontier_response === null
      && (prepared.arms.withFeedback as { commercial_frontier_response?: unknown }).commercial_frontier_response !== null,
    prepared.commercialResponse);

  const home = await createHimaHome();
  check.home = home;
  const patch = '- id: session-title-llm\n  disabled: true\n';
  writeFileSync(homePatchFile(home.home), patch, { mode: 0o600 });
  const profileManifest = readFileSync(path.join(home.profileDir, 'package.json'), 'utf8');
  const profilePatch = readFileSync(path.join(home.profileDir, 'cordis.patch.yml'), 'utf8');
  check.require('the fresh Home contains no replay overlay',
    ![patch, profileManifest, profilePatch].some((text) => text.includes('@deepseek-ai/dsh-llm-replay')
      || text.includes('HimaHarness model stand-in')),
    {
      homePatchSha256: sha256(readFileSync(homePatchFile(home.home))),
      profileManifestSha256: sha256(profileManifest),
      profilePatchSha256: sha256(profilePatch),
    });
  process.chdir(home.workspace);
  const host = await bootInProcess(home);
  check.attach(host);

  const qualificationSessions = new Set<string>();
  host.ctx.tools.guard((execution) => qualificationSessions.has(String(execution.agent?.id))
    ? `${NAME} is a response-only qualification; tools are not authorized in either arm`
    : undefined);

  const withoutAgent = check.track(await createRootAgent(host.ctx, home.workspace));
  const withAgent = check.track(await createRootAgent(host.ctx, home.workspace));
  qualificationSessions.add(String(withoutAgent.id));
  qualificationSessions.add(String(withAgent.id));
  check.require('both native sessions use the real configured DeepSeek-V4.1-Flash route',
    [withoutAgent, withAgent].every((agent) => agent.options.provider === EXPECTED_PROVIDER && agent.options.model === EXPECTED_MODEL),
    [withoutAgent, withAgent].map((agent) => ({ sessionId: String(agent.id), options: agent.options })));

  const without = await runArm(check, withoutAgent, prepared.arms.withoutFeedback);
  const withFeedback = await runArm(check, withAgent, prepared.arms.withFeedback);
  const sessions = [without, withFeedback];
  check.require('each A/B arm completed exactly one real model request step and called no tool',
    sessions.every((arm) => arm.requestSteps === 1 && arm.toolCalls.length === 0)
      && check.requestSessions.size === 2 && check.steps === 2,
    sessions.map(({ sessionId, provider, model, requestSteps, toolCalls: calls }) => ({ sessionId, provider, model, requestSteps, toolCalls: calls })));

  const validated = callPackRunner<ValidatedResult>('validate', {
    requestPath,
    withoutFeedbackProposal: without.proposal,
    withFeedbackProposal: withFeedback.proposal,
  });
  check.require('the existing Pack validator and isolated runner accepted both proposals',
    validated.validator.runnerSha256 === prepared.runnerSha256
      && validated.arms.withoutFeedback.execution.return_code === 0
      && validated.arms.withFeedback.execution.return_code === 0,
    validated.validator);
  check.require('the Pack runner recorded either a concrete selection delta or an explicit unchanged reason',
    validated.feedbackAb.performed === true
      && typeof validated.feedbackAb.selectionChanged === 'boolean'
      && validated.feedbackAb.selectionEffect.reason.trim().length > 0
      && (validated.feedbackAb.selectionChanged
        ? validated.feedbackAb.selectionEffect.kind === 'changed'
        : validated.feedbackAb.selectionEffect.kind === 'unchanged'),
    validated.feedbackAb);

  const result = {
    schema: 'hima.dtco-live-feedback-ab-qualification/1',
    status: 'qualified',
    source: {
      gitSha: check.observed.sourceSha,
      requestPath,
      requestSha256: prepared.requestSha256,
      runnerPath: RUNNER,
      runnerSha256: prepared.runnerSha256,
    },
    frozen: {
      inputIdentity: prepared.frozenInputIdentity,
      sources: prepared.frozenSources,
      budget: prepared.budget,
      candidatePool: prepared.candidatePool,
      commercialResponse: prepared.commercialResponse,
    },
    model: {
      provider: EXPECTED_PROVIDER,
      wireId: EXPECTED_MODEL,
      replayUsed: false,
      arms: sessions.map(({ sessionId, requestSteps, responseSha256 }) => ({ sessionId, requestSteps, responseSha256 })),
    },
    validation: validated,
    claims: {
      realModelTurns: 2,
      commercialEdaExecuted: false,
      ppaClaimed: false,
      selectionDifferenceIsPpaEvidence: false,
    },
  };
  writeFileSync(path.join(check.out, 'feedback-ab.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(path.join(check.out, 'feedback-ab.md'), `${markdown(prepared, validated, sessions)}\n`, { mode: 0o600 });
  check.observed.feedbackAb = {
    json: path.join(check.out, 'feedback-ab.json'), markdown: path.join(check.out, 'feedback-ab.md'),
    inputIdentity: prepared.frozenInputIdentity, selectionEffect: validated.feedbackAb.selectionEffect,
    claims: result.claims,
  };
  check.observed.outcome = validated.feedbackAb.selectionChanged
    ? 'QUALIFIED — commercial feedback changed the frozen-pool selection; no PPA claim'
    : 'QUALIFIED — selection unchanged with an explicit reason; no PPA claim';
});
