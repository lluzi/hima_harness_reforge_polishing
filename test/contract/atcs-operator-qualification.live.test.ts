// L4 Site: explicitly selected by scripts/run-contract-tests.mjs live-site (ATCS-09 V, Issue #64 after T05).
//
// The bounded Operator qualification slice the user requires before any successor Campaign: one real
// Operator child (the Home's configured product model) drives one real xtop-operator session on Site
// linglong-atcs28 through the Host, on the slot the Pack's own prepare-workers prepared from the Site's
// postroute_final inputs (the Site binding designStateManifest-postroute-final.json, read in place and
// never written). It proves, from the Ledger, the Operator's native transcript and the slot's own logs:
//   - the Operator reads its exact admitted request through hima_delegation_input before it opens XTop;
//   - open; atcs_point, atcs_paths and atcs_fail_reasons return (reads.jsonl);
//   - at least one admitted mutation, then kept or undone (ops.jsonl);
//   - atcs_export_changes with limitations, and a clean close;
//   - one sealed Contribution for the slot (state/contribution-w01.json, capture-contribution).
//
// Confinement: every write is under atcs-runs/qual-atcs09-<UTC> (the test's own Site copy names it as the
// workspace root; the test's own ssh only creates it and reads files under it). Licence: the Site's
// Empyrean mode must read `old` (the wrapper refuses otherwise) and no other XTop client may run; the Site
// copy grants one XTop seat and the plan activates one slot. Box: the Run's time box is 20 minutes.
//
// What the Pack does is not changed, except in this test's installed copy: the Run's closing reserve,
// the Operator's time share and the six authors' shares are sized for the 20-minute box, and w01's
// Operator template says so. The Pack's flow/ (the wrapper's adapter and flow pins) is byte-identical.
// The plan and the six research requests are deterministic entries (no model): the plan seats the
// hardest blocker cluster from the Pack's own `read-atcs.py seat-clusters`, trimmed to eight targets and
// a two-mutation scope; the parked branches run their no-ops. Only the Operator is a model.
//
// Inputs (never printed): DEEPSEEK_API_KEY in the environment (the Home's native provider), and
// HIMA_QUAL_BINDING_FILE, the administrator's interactive bindings.json whose environment names the
// installed wrapper (v18: verifier c9dca81c...). The test re-stamps that binding for its installed Pack
// digest into its own Home, as the desktop kit does.
//
// Run (only after wrapper v18 is installed and the Permit names it):
//   HIMA_QUAL_BINDING_FILE=<abs bindings.json> DEEPSEEK_API_KEY=... \
//     node scripts/run-contract-tests.mjs live-site --files test/contract/atcs-operator-qualification.live.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import {
  WORKSHOP_ENTRY_SCHEMA, createInteractiveBindingBridge, loadPack, packDigestExcludes, runDelegations,
  type ExecutionActionRequest,
} from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, toolCalls } from './support/boot-inprocess.ts';
import { waitUntil } from './support/fabric.ts';
import { requireLiveSite } from './support/live-site.ts';

requireLiveSite();

const PACK_ID = 'agentic-timing-closure-system';
const SITE_NAME = 'linglong-atcs28';
const SITE_DIR = path.join(repoRoot, 'sites', SITE_NAME);
const RUNS_ROOT = '/data/eda/project/hima_harness/atcs-runs';
const SLOTS = ['w01', 'w02', 'w03', 'w04', 'w05', 'w06'] as const;
const ACTIVE = 'w01';
const BOX_MS = 20 * 60_000;
const OPERATOR_SHARE_MS = 10 * 60_000;
const AUTHOR_SHARE_MS = 2 * 60_000;
const CLOSING_RESERVE_MS = 2 * 60_000;
const TARGETS = 8;
const MAX_MUTATIONS = 2;
const sitePolicy = parse(readFileSync(path.join(SITE_DIR, 'site.yml'), 'utf8')) as Record<string, any>;
const destination: string = sitePolicy.ssh.destination;
const bindingFile = process.env.HIMA_QUAL_BINDING_FILE;

/** The test's own ssh, outside the Harness: BatchMode, so a prompt never hangs the suite. */
function onTheSite(command: string): { status: number | null; stdout: string; stderr: string } {
  const ran = spawnSync('ssh', ['-o', 'ControlPath=none', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
    destination, command], { encoding: 'utf8', timeout: 120_000 });
  return { status: ran.status, stdout: ran.stdout ?? '', stderr: ran.stderr ?? '' };
}
const posixQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

function skipReason(): string | false {
  if (!process.env.DEEPSEEK_API_KEY?.trim()) return 'DEEPSEEK_API_KEY is not in the environment: the Operator is a real model';
  if (!bindingFile || !path.isAbsolute(bindingFile) || !existsSync(bindingFile)) return 'HIMA_QUAL_BINDING_FILE must name the administrator bindings.json';
  const probe = onTheSite('true');
  return probe.status === 0 ? false : `Site ${destination} is not reachable (ssh exited ${probe.status})`;
}

test('ATCS L4 Operator qualification: a real Operator reads its exact request, opens XTop, reads, mutates once, keeps or undoes, exports, closes, and one Contribution is sealed',
  { skip: skipReason(), timeout: BOX_MS + 10 * 60_000 }, async (t) => {
  // --- Site preflight (read-only): licence mode old, and no other XTop client holds a seat. ---
  const licence = onTheSite('printf "mode="; cat /data/eda/env/empyrean-license-mode; printf "clients="; pgrep -af "[i]cexplorer-xtop_exe|[q]ualib_exe" || true');
  assert.match(licence.stdout, /^mode=old\nclients=\s*$/s, `the Site must read selected=old with no other XTop client: ${licence.stdout}${licence.stderr}`);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const qualRoot = `${RUNS_ROOT}/qual-atcs09-${stamp}`;
  const made = onTheSite(`mkdir -- ${posixQuote(qualRoot)}`); // not -p: a fresh root, never an earlier one
  assert.equal(made.status, 0, `could not create ${qualRoot}: ${made.stderr}`);
  t.diagnostic(`qualification root ${qualRoot}`);

  // --- Home: the Pack copy sized for the box, the Site copy rooted at qualRoot, the re-stamped binding. ---
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS = 'ledger'; // authors are answered by this test; the Operator's result is read natively
  const h = await createHimaHome();
  const packsDir = path.join(h.home, 'hima/packs');
  const variant = path.join(packsDir, PACK_ID);
  await cp(path.join(repoRoot, 'packs', PACK_ID), variant, { recursive: true, filter: (src) => !src.includes('__pycache__') });
  const contract = parse(await readFile(path.join(variant, 'contract.yml'), 'utf8')) as any;
  contract.budget.closingReserveMs = CLOSING_RESERVE_MS;
  const team = contract.agentTeams.find((item: any) => item.id === `atcs-worker-${ACTIVE.slice(1)}`);
  const operatorMember = team.members.find((item: any) => item.id === 'operator');
  operatorMember.budgetShare.maxElapsedMs = OPERATOR_SHARE_MS;
  assert.ok(operatorMember.taskTemplate.includes('You have about 40 minutes'));
  operatorMember.taskTemplate = operatorMember.taskTemplate.replace('You have about 40 minutes', `You have about ${OPERATOR_SHARE_MS / 60_000} minutes`);
  await writeFile(path.join(variant, 'contract.yml'), stringify(contract));
  const graph = parse(await readFile(path.join(variant, 'graph.yml'), 'utf8')) as any;
  graph.autopilot.find((item: any) => item.fork !== undefined).author.maxElapsedMs = AUTHOR_SHARE_MS;
  await writeFile(path.join(variant, 'graph.yml'), stringify(graph));
  const flowDigest = (dir: string) => spawnSync('python3', [path.join(dir, 'flow/atcs_cli.py'), 'flow-digest', path.join(dir, 'flow')], { encoding: 'utf8' }).stdout.trim();
  assert.equal(flowDigest(variant), flowDigest(path.join(repoRoot, 'packs', PACK_ID)), 'the installed copy keeps the wrapper-pinned flow');
  const pack = loadPack(packsDir, PACK_ID);
  const digest = pack.folder.digest(packDigestExcludes);

  const sitesDir = path.join(h.home, 'hima/sites'); await mkdir(sitesDir, { recursive: true });
  const site = { ...sitePolicy, workspaceRoot: qualRoot, bindings: { ...sitePolicy.bindings, workspaceRoot: qualRoot },
    capacity: { ...sitePolicy.capacity, licences: { ...sitePolicy.capacity.licences, xtop: 1 } } };
  await writeFile(path.join(sitesDir, `${SITE_NAME}.yml`), stringify(site));
  const permit = parse(readFileSync(path.join(SITE_DIR, 'permit.yml'), 'utf8')) as any;
  await writeFile(path.join(sitesDir, 'permit.yml'), stringify(permit));

  const admin = JSON.parse(readFileSync(bindingFile!, 'utf8'));
  const binding = admin.bindings[0];
  const environment = JSON.parse(readFileSync(binding.environment.file, 'utf8'));
  assert.ok(permit.allowedWrappers.includes(environment.wrapper.path), `the Permit must name the installed wrapper ${environment.wrapper.path}`);
  const pins = onTheSite(`grep -E '^(verifier_sha256|flow_digest|adapter_sha256)=' ${posixQuote(environment.wrapper.path)}`).stdout;
  const pin = (name: string) => new RegExp(`^${name}='?([0-9a-f]{64})'?$`, 'm').exec(pins)?.[1];
  const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(pin('verifier_sha256'), sha(path.join(SITE_DIR, 'verify-worker-startup.py')), 'the installed wrapper pins this checkout\'s verifier');
  assert.equal(pin('adapter_sha256'), sha(path.join(variant, 'flow/atcs_cli.py')), 'the installed wrapper pins this Pack\'s adapter');
  assert.equal(pin('flow_digest'), flowDigest(variant), 'the installed wrapper pins this Pack\'s flow');
  const adminDir = path.join(h.home, 'admin'); await mkdir(adminDir);
  const envFile = path.join(adminDir, 'environment.json');
  await writeFile(envFile, `${JSON.stringify({ ...environment, pack: { ...environment.pack, digest } }, null, 2)}\n`);
  const bindingsFile = path.join(adminDir, 'bindings.json');
  await writeFile(bindingsFile, `${JSON.stringify({ ...admin, bindings: [{ ...binding,
    id: `${binding.id.split(':').slice(0, 2).join(':')}:${digest.slice(0, 16)}`, packDigest: digest,
    environment: { ...binding.environment, file: envFile, sha256: sha(envFile) } }] }, null, 2)}\n`);
  await appendFile(path.join(h.profileDir, 'cordis.patch.yml'), '\n- id: session-title-llm\n  disabled: true\n- id: hima\n  config:\n'
    + `    sitesDir: ${JSON.stringify(sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n`
    + `    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`);

  const host = await bootInProcess(h); let runId: string | undefined;
  t.after(async () => { if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined); await host.dispose(); await h.dispose(); });
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: PACK_ID, site: SITE_NAME, ownerSessionId: actor,
    goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0, max_physical_refreshes: 1 }, strategy: { workerSlots: 1 },
    timeBoxMs: BOX_MS, generationLimit: 1, retryAllowance: 1 } as never);
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  runId = started.run.id; const workspace: string = started.workspace;
  assert.ok(workspace.startsWith(`${qualRoot}/`), `the Run workspace ${workspace} lies under ${qualRoot}`);

  let serial = 0;
  const run = () => host.ctx.hima.ledger.run(runId!)!;
  const control = () => run().control!;
  const context = () => host.ctx.hima.executionContext(runId!);
  const records = () => host.ctx.hima.ledger.records({ runId: runId! });
  const deps = () => (host.ctx.hima as any).deps();
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) =>
    host.ctx.hima.executionAction({ runId: runId!, actor, origin: 'agent', action, expectedEpoch: control().epoch,
      expectedRevision: control().revision, requestId: `qual-${++serial}`, ...fields });
  const failure = () => JSON.stringify({ status: run().status, currentNode: run().currentNode, fork: run().fork, reason: context().reason,
    blocked: records().filter((r) => r.type === 'node' && (r.state === 'blocked' || r.state === 'cancelled')).slice(-4),
    refusal: records().findLast((r) => r.type === 'refusal') }).slice(0, 6000);
  const remoteText = (relative: string) => {
    const file = path.posix.join(workspace, relative);
    assert.ok(file.startsWith(`${qualRoot}/`));
    const read = onTheSite(`cat -- ${posixQuote(file)}`);
    return read.status === 0 ? read.stdout : undefined;
  };

  // --- The Pack's own chain up to the plan runs itself: bind-inputs, baseline, PrimeTime observe. ---
  await waitUntil('the Run reaches plan', () => context().available.includes('plan') || String(run().status).startsWith('ended-'), 12 * 60_000, 500)
    .catch((error) => assert.fail(`${(error as Error).message}: ${failure()}`));
  assert.ok(context().available.includes('plan'), failure());
  // The owner's plan: the hardest blocker cluster the Pack's seat-clusters seats in w01, trimmed to
  // TARGETS checks and a MAX_MUTATIONS scope; w02..w06 parked (workerSlots 1).
  const planEntry = [
    'import json, subprocess, sys', 'from pathlib import Path', 'w = Path(sys.argv[1])',
    'working = json.loads((w / "state/working-state.json").read_text())',
    'out = w / "research/requests/seat-clusters.json"; out.parent.mkdir(parents=True, exist_ok=True)',
    'subprocess.run([sys.executable, str(w / "hima-readers/atcs-readiness/read-atcs.py"), "seat-clusters", str(w), str(out), "1"], check=True)',
    'packages = json.loads(out.read_text())["workPackages"]',
    `a = packages["${ACTIVE}"]; keep = a["targets"][:${TARGETS}]`,
    'ends = [key.split("|", 2)[2] for key in keep]',
    'a["targets"] = keep; a["cluster"] = dict(a["cluster"], checks=keep)',
    'a["targetPins"] = [pin for pin in a.get("targetPins", []) if pin in ends]',
    'a["editDomain"] = dict(a["editDomain"], instances=[i for i in a["editDomain"]["instances"] if any(e == i or e.startswith(i + "/") for e in ends)] or a["editDomain"]["instances"][:4])',
    `a["scope"] = dict(a["scope"], maxMutations=${MAX_MUTATIONS})`,
    'plan = {"candidate": {"workPackages": packages, "reason": "L4 Operator qualification: one seat, the hardest cluster, eight targets"}, "baseState": working, "siteCapabilities": {"pgVerification": False}}',
    '(w / "research/requests/campaign-plan.json").write_text(json.dumps(plan, indent=1) + "\\n")', ''].join('\n');
  const begunPlan = await act('begin', { nodeId: 'plan' }); assert.equal(begunPlan.kind, 'accepted', begunPlan.reason);
  const planId = begunPlan.receipt!.executionId!;
  assert.equal((await act('write', { executionId: planId, path: 'entry.py', content: planEntry })).kind, 'accepted');
  assert.notEqual((await act('work', { executionId: planId })).kind, 'refused');
  await waitUntil('plan settles', () => ['ready', 'failed'].includes(context().executions.find((e) => e.id === planId)?.phase ?? ''), 5 * 60_000, 250);
  assert.equal(context().executions.find((e) => e.id === planId)?.phase, 'ready', failure());
  assert.equal((await act('complete', { nodeId: 'plan', executionId: planId })).kind, 'accepted', failure());

  // --- The fork: six authors, answered from the Ledger with deterministic entries (no model). ---
  const answered = new Set<string>();
  const answer = async (delegationId: string, text: string) => {
    const row = runDelegations(deps(), runId!).find((item) => item.delegationId === delegationId)!;
    await host.ctx.hima.ledger.appendDelegation(runId!, { delegationId, parentSessionId: actor, childSessionId: row.childSessionId,
      requestId: `result-${delegationId}-${++serial}`.slice(0, 160), requestDigest: 'a'.repeat(64), event: 'result-observed', payload: {
        candidate: true, source: 'native-live-session', handoff: {
          outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
          contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
          output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
          unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['deterministic author entry; no model'] },
        } } });
  };
  const research = (slot: string) => [
    'import json, subprocess, sys', 'from pathlib import Path', 'w = Path(sys.argv[1])',
    `package = {k: v for k, v in json.loads((w / "state/workers.json").read_text())["workers"]["${slot}"]["workPackage"].items() if k not in ("schema", "id")}`,
    'request = {"candidate": package, "baseState": json.loads((w / "state/working-state.json").read_text()), "siteCapabilities": {"pgVerification": False}}',
    'if not package.get("parked"): request["sessionPlan"] = []',
    `path = w / "research/requests/worker-request-${slot}.json"`, 'path.write_text(json.dumps(request))',
    'if not package.get("parked"): subprocess.run([sys.executable, str(w / "hima-readers/atcs-readiness/read-atcs.py"), "brief", str(path)], check=True)', ''].join('\n');
  await Promise.all(SLOTS.map(async (slot) => {
    let id = '';
    await waitUntil(`research-worker-${slot.slice(1)}'s author is asked`, () => {
      const row = runDelegations(deps(), runId!).find((item) => item.delegationId.startsWith(`autopilot-author-research-worker-${slot.slice(1)}-`)
        && item.state === 'accepted' && !answered.has(item.delegationId));
      if (row !== undefined) id = row.delegationId;
      return row !== undefined;
    }, 5 * 60_000, 100);
    answered.add(id);
    await answer(id, JSON.stringify({ schema: WORKSHOP_ENTRY_SCHEMA, entry: research(slot) }));
  }));

  // --- The one real Operator: materialized by the Harness from w01's admitted request. ---
  let operator: ReturnType<typeof runDelegations>[number] | undefined;
  await waitUntil('w01\'s Operator is materialized', () => {
    operator = runDelegations(deps(), runId!).find((row) => row.effective.recipe?.teamId === `atcs-worker-${ACTIVE.slice(1)}`
      && row.effective.recipe.memberId === 'operator');
    return operator !== undefined;
  }, 5 * 60_000, 100).catch((error) => assert.fail(`${(error as Error).message}: ${failure()}`));
  const requestBytes = remoteText(`research/requests/worker-request-${ACTIVE}.json`);
  assert.ok(requestBytes, 'the admitted request is on the Site');
  const requestRecord = records().findLast((r) => r.type === 'observation' && (r as any).contentSha256 === createHash('sha256').update(requestBytes!).digest('hex'));
  assert.ok(requestRecord, 'the admitted request is one Reader observation');
  assert.equal(operator!.effective.recipe!.inlinePayload!.planSha256, (requestRecord as any).contentSha256, 'the Operator is bound to the request bytes');
  assert.ok(operator!.contract.task.length <= 64_000 && operator!.contract.task.includes(requestRecord!.id), 'a bounded task naming the request record');
  const operatorId = operator!.childSessionId;
  const delegate = (body: Record<string, unknown>) => host.ctx.hima.delegate({ runId: runId!, actor, expectedEpoch: control().epoch,
    expectedRevision: control().revision, ...body } as never, AbortSignal.timeout(90_000)) as Promise<Record<string, any>>;
  let result: Record<string, any> = { status: 'unavailable' };
  const deadline = Date.now() + OPERATOR_SHARE_MS + 2 * 60_000;
  while (Date.now() < deadline) {
    result = await delegate({ action: 'result', requestId: `qual-result-${++serial}`, delegationId: operator!.delegationId });
    if (['candidate', 'duplicate', 'refused'].includes(result.status)) break;
    const state = runDelegations(deps(), runId!).find((row) => row.delegationId === operator!.delegationId)?.state;
    if (state && ['cancelled', 'expired', 'uncertain'].includes(state)) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  const agent = host.ctx.get('agents')!.get(operatorId as never) as any;
  const calls = agent ? toolCalls(agent) : [];
  t.diagnostic(`Operator result ${result.status}; ${calls.length} tool calls`);
  const commands = calls.filter((call) => call.name === 'hima_interactive').map((call) => (call.args.request as any) ?? {});
  const names = commands.filter((request) => request.action === 'input').map((request) => request.command?.name as string);
  const firstOpen = calls.findIndex((call) => call.name === 'hima_interactive' && (call.args.request as any)?.action === 'open');
  const interactive = records().filter((r) => r.type === 'interactive' && (r as any).executionId === operator!.effective.recipe!.executionId) as any[];
  const slotRoot = JSON.parse(remoteText('state/workers.json') ?? '{"workers":{}}').workers[ACTIVE]?.root as string;
  const jsonl = (relative: string) => (remoteText(path.posix.join(slotRoot, relative)) ?? '').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));

  await t.test('the Operator reads its exact request through bounded hima_delegation_input windows before it opens XTop', () => {
    assert.deepEqual(operator!.effective.tools, ['hima_interactive', 'hima_delegation_input']);
    // Bounded reads are required only for what the brief the task embeds lists in part (run 4: the brief
    // already carried every target, pin and domain instance, and the Operator rightly read nothing more).
    const brief = JSON.parse(requestBytes!).operatorBrief;
    const partial = (listing: { count: number; first: unknown[] } | undefined) => listing !== undefined && listing.count > listing.first.length;
    const needed = [['candidate.targets', brief?.targets], ['candidate.targetPins', brief?.targetPins],
      ['candidate.editDomain.instances', brief?.editDomain?.instances]].filter(([, listing]) => partial(listing as never)).map(([field]) => field as string);
    const reads = calls.map((call, index) => ({ call, index })).filter(({ call }) => call.name === 'hima_delegation_input'
      && call.args.recordId === requestRecord!.id && typeof call.args.path === 'string');
    const before = reads.filter(({ index }) => firstOpen < 0 || index < firstOpen).map(({ call }) => String(call.args.path).replace(/^\//, '').replaceAll('/', '.'));
    t.diagnostic(`fields the brief lists in part: ${JSON.stringify(needed)}; bounded reads before the open: ${JSON.stringify(before)}`);
    for (const field of needed) {
      assert.ok(before.includes(field), `${field} read in bounded windows before the open: ${JSON.stringify(before)}`);
    }
  });
  await t.test('XTop opens through the Host', () => {
    // The Host's own records of the Operator's session: its open-intent and its opened outcome.
    const events = interactive.map((r) => r.event);
    assert.ok(events.includes('open-intent'), `the Operator asked to open: ${JSON.stringify(events)}`);
    assert.ok(events.includes('opened'), JSON.stringify(events));
  });
  await t.test('atcs_point, atcs_paths and atcs_fail_reasons return, logged in reads.jsonl', () => {
    const reads = jsonl('reads.jsonl').map((line) => line.proc);
    for (const proc of ['atcs_point', 'atcs_paths', 'atcs_fail_reasons']) assert.ok(reads.includes(proc), `${proc} in reads.jsonl: ${JSON.stringify(reads)}; sent ${JSON.stringify(names)}`);
  });
  await t.test('one admitted mutation, then kept or undone', () => {
    const ops = jsonl('ops.jsonl');
    const admitted = interactive.filter((r) => r.event === 'input-intent' && r.payload?.scopeMutation === true);
    assert.ok(admitted.length >= 1 && admitted.length <= MAX_MUTATIONS, `admitted mutations ${admitted.length}`);
    const mutation = ops.find((line) => line.cmd !== 'undo');
    assert.ok(mutation, `a mutation line in ops.jsonl: ${JSON.stringify(ops)}`);
    const undo = ops.find((line) => line.cmd === 'undo' && line.undoes === mutation.seq);
    t.diagnostic(`mutation ${mutation.cmd} seq ${mutation.seq}: ${undo ? 'undone' : 'kept'}`);
    assert.equal(mutation.status, 'kept');
  });
  await t.test('export with limitations, then a clean close', () => {
    // atcs_export_changes writes the Operator's limitations to summary.json in the slot root; the seal
    // carries them into the Contribution's limitations.
    const summary = JSON.parse(remoteText(path.posix.join(slotRoot, 'summary.json')) ?? '{}');
    const contribution = JSON.parse(remoteText(`state/contribution-${ACTIVE}.json`) ?? '{}');
    const written = Array.isArray(summary.limitations) ? summary.limitations : [];
    t.diagnostic(`summary.json limitations: ${JSON.stringify(written).slice(0, 600)}`);
    assert.ok(Array.isArray(summary.limitations), `summary.json holds the export's limitations: ${JSON.stringify(summary).slice(0, 400)}`);
    const sealed: string[] = Array.isArray(contribution.limitations) ? contribution.limitations : [];
    assert.ok(written.every((line: unknown) => sealed.some((item) => item.startsWith('operator: ') && String(line).startsWith(item.slice('operator: '.length)))),
      `the sealed Contribution carries them: ${JSON.stringify(contribution.limitations).slice(0, 600)}`);
    assert.ok(interactive.some((r) => r.event === 'closed'), `a closed record: ${JSON.stringify(interactive.map((r) => r.event))}`);
  });
  await t.test('the Operator returns a result and one Contribution is sealed for the slot', async () => {
    assert.ok(['candidate', 'duplicate'].includes(result.status), JSON.stringify(result).slice(0, 2000));
    await waitUntil('capture-worker-01 is done', () => records().some((r) => r.type === 'node' && r.nodeId === `capture-worker-${ACTIVE.slice(1)}` && r.state === 'done'), 5 * 60_000, 500)
      .catch((error) => assert.fail(`${(error as Error).message}: ${failure()}`));
    const contribution = JSON.parse(remoteText(`state/contribution-${ACTIVE}.json`) ?? '{}');
    assert.equal(contribution.schema, 'atcs.contribution/1', JSON.stringify(contribution).slice(0, 1000));
    assert.equal(contribution.taskId, ACTIVE);
  });
  await t.test('every Site write of this Run lies under the qualification root', () => {
    // Every path under the Site's run root that a workspace, Job or interactive record names.
    const named = records().filter((r) => ['workspace', 'job', 'interactive'].includes(r.type))
      .flatMap((record) => [...JSON.stringify(record).matchAll(new RegExp(`${RUNS_ROOT}/[^"'\\s]*`, 'g'))].map((match): [string, string] => [record.id, match[0]]));
    assert.ok(named.length > 0, 'the records name the Run workspace');
    for (const [id, value] of named) assert.ok(value === qualRoot || value.startsWith(`${qualRoot}/`), `${id}: ${value}`);
  });
});
