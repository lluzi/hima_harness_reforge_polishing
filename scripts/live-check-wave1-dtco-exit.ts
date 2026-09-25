// @hima-seam agent wrapped
// @hima-seam tools direct
// Wave 1 lane A: one continuous Fabric Run through compile/read-compile/foundry-synth/read-foundry-synth.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  discoverSshSite, installPackMethod, loadSite, packDigestOf, saveDiscoveredSite,
  type ExecutionActionRequest, type JobRecord, type LedgerRecord, type ObservationRecord, type Permit,
} from '@hima/harness';
import { homePatchFile } from '../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent } from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { waitUntil } from '../test/contract/support/fabric.ts';

const args = process.argv.slice(2); const outAt = args.indexOf('--out');
if (outAt < 0 || !args[outAt + 1] || args.length !== 2) throw new Error('usage: node scripts/live-check-wave1-dtco-exit.ts --out <fresh-directory>');
const out = path.resolve(args[outAt + 1]!); if (existsSync(out)) throw new Error('evidence directory already exists'); mkdirSync(out, { recursive: true });
const sha = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
const destination = 'luzi@192.168.50.41';
const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ControlPath=none', destination];
const remote = (command: string, timeout = 60_000): string => execFileSync('ssh', [...sshArgs, command], { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
const processState = (): string => remote("/usr/local/bin/empyrean-license status; ps -eo pid,args | grep -E '(icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell)' | grep -v grep | grep -v '<defunct>' || true").trim();
const before = processState(); assert.match(before, /selected=new old=inactive new=active/); assert.doesNotMatch(before, /icexplorer-xtop_exe|qualib_exe/);

const stamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14);
const remoteRoot = `/data/eda/project/hima_harness/wave1-dtco-exit-${stamp}`;
remote(`test ! -e '${remoteRoot}' && mkdir -p '${remoteRoot}'`);
const permit: Permit = {
  allowedReadRoots: ['/data/eda/project', '/data/eda/software', '/data/eda/env', '/usr/local/bin', '/usr/bin'],
  allowedWriteRoots: [remoteRoot], allowedWrappers: ['/usr/bin/python3', '/usr/local/bin/eda'], forbidden: ['deletions'],
};
const foundryLib = '/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Front_End/timing_power_noise/NLDM/tcbn28hpcplusbwp40p140_180a/tcbn28hpcplusbwp40p140tt0p9v25c.lib';
const basePhysicalInputs = '/data/eda/project/hima_harness/issue52-dc-qualification-20260924/physical-inputs.json';
const physicalInputs = `${remoteRoot}/physical-inputs.json`;
const toolStack = '/data/eda/project/hima_harness/site_inputs/xspace_cell_aes_tsmc28/tool-stack.json';
const foundryCdl = '/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/digital/Back_End/spice/tcbn28hpcplusbwp40p140_110a/tcbn28hpcplusbwp40p140_110a.spi';
const foundryCdlSha256 = remote(`sha256sum -- '${foundryCdl}'`).trim().split(/\s+/)[0]!;
remote(`python3 -c 'import json; source=${JSON.stringify(basePhysicalInputs)}; target=${JSON.stringify(physicalInputs)}; value=json.load(open(source)); value["FOUNDRY_CDL_VERSION"]="tsmc28-hpcplus-110a"; value["FOUNDRY_CDL_SHA256"]=${JSON.stringify(foundryCdlSha256)}; open(target,"x").write(json.dumps(value,sort_keys=True,indent=2)+"\\n")'`);
const sourceHashesBefore = remote(`sha256sum -- '${foundryLib}' '${physicalInputs}' '${toolStack}'`).trim();

const home = await createHimaHome();
let host: Awaited<ReturnType<typeof bootInProcess>> | undefined; let runId: string | undefined;
let ownerId: string | undefined; let workspace: string | undefined; let failure: string | undefined;
const progress: unknown[] = [];
const checkpoint = (status: 'in-progress' | 'failed' | 'passed', extra: Record<string, unknown> = {}) => writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify({
  schema: 'hima.wave1-dtco-exit/1', recordedAt: new Date().toISOString(), status, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  pack: { id: 'custom-cell-fmax-dtco', digest: packDigestOf(path.join(repoRoot, 'packs/custom-cell-fmax-dtco')) },
  site: { remoteRoot, foundryLib, physicalInputs, toolStack }, environmentBefore: before, runId, ownerId, workspace, progress,
  ...(host && runId ? { run: host.ctx.hima.ledger.run(runId), records: host.ctx.hima.ledger.records({ runId }) } : {}),
  ...(failure === undefined ? {} : { failure }), ...extra,
}, null, 2)}\n`);
checkpoint('in-progress');

try {
  const packSource = path.join(repoRoot, 'packs/custom-cell-fmax-dtco');
  const installed = path.join(packsDirOf(home), 'custom-cell-fmax-dtco'); installPackMethod({ from: packSource, to: installed });
  appendFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');
  const sitesDir = path.join(home.home, 'hima/sites');
  const discovery = await discoverSshSite({ name: 'wave1-dtco-exit', ssh: { destination, jumps: [], controlPersistSeconds: 60 }, hints: {
    workspaceRoot: remoteRoot, allowedReadRoots: permit.allowedReadRoots, allowedWriteRoots: permit.allowedWriteRoots,
    allowedWrappers: permit.allowedWrappers, toolCommands: ['python3', 'eda'],
  } });
  assert.deepEqual(discovery.unknowns, []); assert.deepEqual(discovery.conflicts, []);
  saveDiscoveredSite(sitesDir, { ...discovery, permit, site: { ...discovery.site, workspaceRoot: remoteRoot,
    bindings: {
      designRoot: '/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes',
      rtlGlob: '/data/eda/project/celluzi/OpenROAD-flow-scripts/flow/designs/src/aes/*.v', designTop: 'aes_cipher_top',
      constraints: '/data/eda/project/celluzi/commercial/aes_tsmc28/scripts/constraint_tsmc28.sdc',
      foundryLibrary: foundryLib, physicalInputs, toolStack, workspaceRoot: remoteRoot,
    },
    capacity: { ...discovery.site.capacity, parallelJobs: 1,
      licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 } },
  } });
  const site = loadSite(sitesDir, 'wave1-dtco-exit');
  host = await bootInProcess(home); const owner = await createRootAgent(host.ctx, home.workspace); ownerId = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: 'custom-cell-fmax-dtco', site: site.name,
    goal: { target_period_ns: 0.5, target_fmax_improvement_pct: 5 },
    strategy: { periodNs: 0.5, algorithmRevision: 0, floorplanUtilization: 0.25 }, ownerSessionId: ownerId,
    timeBoxMs: 2 * 60 * 60_000, generationLimit: 1, retryAllowance: 1 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('DTCO qualification Run did not start');
  runId = started.run.id; workspace = started.workspace; checkpoint('in-progress');
  let sequence = 0;
  const context = () => host!.ctx.hima.executionContext(runId!);
  const records = (): LedgerRecord[] => host!.ctx.hima.ledger.records({ runId: runId! });
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
    const control = context().run.control!;
    return host!.ctx.hima.executionAction({ runId: runId!, actor: ownerId!, origin: 'agent', action,
      expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `wave1-dtco-${++sequence}`, ...fields });
  };
  const complete = async (nodeId: string, timeoutMs = 20 * 60_000) => {
    assert.ok(context().available.includes(nodeId), `${nodeId} is not available: ${JSON.stringify({ available: context().available, reason: context().reason, run: context().run })}`);
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', begin.reason); const executionId = begin.receipt?.executionId; assert.ok(executionId);
    const work = await act('work', { executionId }); assert.equal(work.kind, 'accepted', work.reason);
    await waitUntil(`${nodeId} settles`, () => context().executions.some((entry) => entry.id === executionId && ['ready', 'failed'].includes(entry.phase)), timeoutMs, 500);
    const settled = context().executions.find((entry) => entry.id === executionId)!;
    if (settled.phase !== 'ready') {
      const log = await act('read', { executionId, output: '@job-log' });
      throw new Error(`${nodeId} failed: ${JSON.stringify({ settled, log: log.data, reason: log.reason })}`);
    }
    const done = await act('complete', { nodeId, executionId }); assert.equal(done.kind, 'accepted', done.reason);
    progress.push({ nodeId, executionId, at: new Date().toISOString() }); checkpoint('in-progress');
    process.stdout.write(`${nodeId}: PASS\n`);
  };

  await complete('bind-inputs'); await complete('evaluation-baseline'); await complete('read-evaluation-baseline');
  const routes = ['timing-criticality', 'timing-context', 'structure-frequency', 'structure-compaction', 'mapper-compatibility', 'functional-diversity'];
  for (const route of routes) { await complete(`mine-${route}`); await complete(`select-${route}`); }
  await complete('merge-join'); await complete('function-local-evaluation'); await complete('read-function-local-evaluation'); await complete('function-local-gate');

  assert.ok(context().available.includes('research-candidates'));
  const researchBegin = await act('begin', { nodeId: 'research-candidates' }); assert.equal(researchBegin.kind, 'accepted', researchBegin.reason);
  const researchId = researchBegin.receipt?.executionId; assert.ok(researchId);
  const templateResult = await act('read', { executionId: researchId, output: 'researchTemplate' });
  assert.equal(templateResult.kind, 'accepted', templateResult.reason);
  const template = (templateResult.data as { text?: string }).text; assert.ok(template);
  for (const output of ['record_evaluation_baseline', 'record_function_local_evaluation',
    ...routes.flatMap(route => [`raw_${route.replaceAll('-', '_')}`, `source_${route.replaceAll('-', '_')}`, `research_${route.replaceAll('-', '_')}`])]) {
    const read = await act('read', { executionId: researchId, output }); assert.equal(read.kind, 'accepted', `${output}: ${read.reason}`);
  }
  for (const file of ['full-mining-method.md', 'library-richness-evaluation.md', 'active-frontier-v5.md']) {
    const read = await act('knowledge', { executionId: researchId, file }); assert.equal(read.kind, 'accepted', `${file}: ${read.reason}`);
  }
  const implementation = `def residual_research(context):
    evidence = residual_evidence_sha256(context)
    question = context["next_residual_question"]
    lenses = [
        {"name": "timing-criticality", "question": "Which measured timing rows best address " + question, "evidence_sha256": evidence, "target_metric_layers": ["F1", "F3"]},
        {"name": "timing-context", "question": "Which repeated endpoint families support a shared Cell?", "evidence_sha256": evidence, "target_metric_layers": ["F1", "F2"]},
        {"name": "structure-frequency", "question": "Which repeated structures have non-overlapping support?", "evidence_sha256": evidence, "target_metric_layers": ["F1"]},
        {"name": "structure-compaction", "question": "Which buildable rows remove the most local logic?", "evidence_sha256": evidence, "target_metric_layers": ["F0", "F1"]},
        {"name": "mapper-compatibility", "question": "Which interfaces remain feasible for the mapper?", "evidence_sha256": evidence, "target_metric_layers": ["F0", "F2"]},
        {"name": "functional-diversity", "question": "Which functions add distinct bounded coverage?", "evidence_sha256": evidence, "target_metric_layers": ["F0", "F1"]},
        {"name": "onsite-inspiration", "question": "What cross-route selection is the cheapest discriminating E0 check?", "evidence_sha256": evidence, "target_metric_layers": ["F0", "F1", "F2", "F3"]},
    ]
    source = "def propose_candidates(residual, budget):\\n    pool = residual[\\\"candidate_pool\\\"][\\\"proposals\\\"]\\n    output = []\\n    limit = budget[\\\"max_candidate_proposals\\\"]\\n    for index in range(128):\\n        if index >= len(pool):\\n            break\\n        if len(output) >= limit:\\n            break\\n        row = pool[index]\\n        key = row[\\\"proposal_key\\\"]\\n        if isinstance(key, str) and key:\\n            output.append({\\\"lens\\\": \\\"functional-diversity\\\", \\\"transformation\\\": {\\\"proposal_key\\\": key, \\\"required_delay_ns\\\": 0.035, \\\"target_endpoints\\\": [\\\"wave1-dc-qualification\\\"], \\\"intervention\\\": \\\"new-function\\\"}, \\\"rationale\\\": \\\"selected from the current hash-bound candidate pool for one bounded E0 check\\\"})\\n    return output\\n"
    return {"research_lenses": lenses, "candidate_program": {"language": "python", "entrypoint": "propose_candidates", "source": source},
            "feedback_interpretation": "No commercial response is used before this Wave 1 DC qualification; downstream Readers decide acceptance.",
            "stop_reason": "One bounded candidate program fills only the current proposal budget and makes no PPA claim."}
`;
  const code = template.replace(/def residual_research\(context\):[\s\S]*?\n\ndef research\(candidates, context\):/, `${implementation}\n\ndef research(candidates, context):`);
  assert.notEqual(code, template); assert.equal((await act('write', { executionId: researchId, path: 'entry.py', content: code })).kind, 'accepted');
  assert.equal((await act('work', { executionId: researchId })).kind, 'accepted');
  await waitUntil('research-candidates settles', () => context().executions.some(entry => entry.id === researchId && ['ready', 'failed'].includes(entry.phase)), 10 * 60_000, 500);
  const researchSettled = context().executions.find(entry => entry.id === researchId)!;
  if (researchSettled.phase !== 'ready') throw new Error(`research-candidates failed: ${JSON.stringify(researchSettled)}`);
  assert.equal((await act('complete', { nodeId: 'research-candidates', executionId: researchId })).kind, 'accepted');
  progress.push({ nodeId: 'research-candidates', executionId: researchId, codeSha256: sha(code), at: new Date().toISOString() }); checkpoint('in-progress');
  process.stdout.write('research-candidates: PASS\n');

  for (const node of ['read-research-selection', 'merge', 'read-merge', 'generate', 'read-generate', 'layout', 'read-layout',
    'characterize', 'read-characterize', 'calibration-gate', 'design-mapping-timing-evaluation', 'read-design-mapping-timing-evaluation',
    'portfolio-gate', 'freeze-cumulative-library', 'read-cumulative-library', 'compile', 'read-compile', 'foundry-synth', 'read-foundry-synth']) await complete(node);

  const all = records(); const jobs = all.filter((record): record is JobRecord => record.type === 'job');
  const launched = (nodeId: string) => jobs.find(record => record.event === 'launched' && record.nodeId === nodeId);
  const finished = (job: JobRecord | undefined) => job && jobs.find(record => record.event === 'finished' && record.job.session === job.job.session);
  const compileJob = launched('compile'); const foundryJob = launched('foundry-synth');
  assert.ok(compileJob && foundryJob); assert.equal(finished(compileJob)?.exitCode, 0); assert.equal(finished(foundryJob)?.exitCode, 0);
  const observations = all.filter((record): record is ObservationRecord => record.type === 'observation');
  const compileReading = observations.findLast(record => record.reader.id === 'read-compile');
  const foundryReading = observations.findLast(record => record.reader.id === 'read-foundry-synth');
  assert.ok(compileReading && foundryReading);
  const netlist = remote(`python3 - <<'PY'\nimport json\np='${workspace}/flow/records/foundry-synth.json'\nd=json.load(open(p)); a=next(x for x in d['artifacts'] if x['role']=='synthesis_netlist'); print(a['path']); print(a['bytes']); print(a['sha256'])\nPY`).trim().split('\n');
  assert.ok(Number(netlist[1]) > 0);
  const db1 = Number(remote(`python3 - <<'PY'\nimport json,re,pathlib\np=pathlib.Path('${workspace}/flow/records/foundry-synth.json'); d=json.load(open(p)); rel=d['executions'][0]['log']['path']; text=(p.parents[2]/rel).read_text(errors='replace'); print(len(re.findall(r'Error: File is not a DB file\\. \\(DB-1\\)', text)))\nPY`).trim());
  assert.equal(db1, 0);
  const sourceHashesAfter = remote(`sha256sum -- '${foundryLib}' '${physicalInputs}' '${toolStack}'`).trim(); assert.equal(sourceHashesAfter, sourceHashesBefore);
  const after = processState(); assert.match(after, /selected=new old=inactive new=active/); assert.doesNotMatch(after, /icexplorer-xtop_exe|qualib_exe|dc_shell|lc_shell/);
  checkpoint('passed', { jobs, compileReading, foundryReading, netlist: { path: netlist[0], bytes: Number(netlist[1]), sha256: netlist[2] }, db1Count: db1,
    sourceHashesBefore: sourceHashesBefore.split('\n'), sourceHashesAfter: sourceHashesAfter.split('\n'), environmentAfter: after,
    claims: { issue44: 'PASS', scope: 'continuous Fabric compile/read-compile/foundry-synth/read-foundry-synth only; no PPA or signoff claim' } });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', runId, workspace, evidence: path.join(out, 'evidence.json') }, null, 2)}\n`);
} catch (error) {
  failure = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error); checkpoint('failed'); throw error;
} finally {
  if (host && runId && !host.ctx.hima.ledger.run(runId)?.status?.startsWith('ended-')) await host.ctx.hima.cancelRun(runId);
  await host?.dispose(); await home.dispose();
}
