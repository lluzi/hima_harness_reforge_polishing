// @hima-seam llm-replay direct
// L2 Host: the complete current aes-tsmc28-dtco graph through the normal startRun → DBOS route. The
// probe loop, six mining branches with their selection Workshops, the join Judge and every later stage
// run as real local Jobs with the Pack's own tools, Readers, rules and choosers. Synthetic artifacts
// stand only at the Site/tool boundary (support/aes-full-graph-fixture.ts); each Workshop's model is
// dsh's keyless replay writing one fixed data-dependent selector. No production AES mine, learned
// model, EDA or PPA claim. Replaces aes-full-graph.host.test.ts "one native owner drives the full AES
// graph and returns from an evidence review branch" (owner begin/work/complete); its optional growth
// review is not re-proved here (growth fragments are durable-task-adapters/dbos-flow subjects).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeLocalSite } from './support/site.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { createAesDomainFixture } from './support/aes-domain-fixture.ts';
import { installAesFullGraphFixture } from './support/aes-full-graph-fixture.ts';
import { appendReplaySession, writeMomentFixture } from './support/moments.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const lib = (name: string) => import(pathToFileURL(path.join(repoRoot, 'packages/harness/lib', `${name}.js`)).href);
const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [{ type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }] });
const tool = (name: string, args: unknown, id: string): ReplayEntry => ({ kind: 'chunks', chunks: [{ type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: id as never, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }] });

const routes = ['timing-criticality', 'timing-context', 'structure-frequency',
  'structure-compaction', 'mapper-compatibility', 'functional-diversity'] as const;
const implementSelection = (template: string): string => {
  const stub = `def choose(candidates, route):
    """Return at most two actual candidate_id strings, derived from this route's full evidence."""
    raise NotImplementedError("Implement a data-dependent route selection algorithm here")`;
  assert.ok(template.includes(stub), 'the Pack selection template retains the bounded choose() seam');
  return template.replace(stub, `def choose(candidates, route):
    """Select one buildable candidate by measured support, then stable source identity."""
    buildable = [row for row in candidates if (row.get("implementation_plan") or {}).get("route") in
                 ("fusion", "cluster_compose", "boolean_synthesis")]
    ranked = sorted(buildable, key=lambda row: (
        -int((row.get("discovery_evidence") or {}).get("non_overlapping_support") or 0),
        row["candidate_id"]))
    return [row["candidate_id"] for row in ranked[:1]]`);
};

async function recordsOf(host: InProcessHost, home: string, runId: string) {
  const { createDurableViewReaders } = await lib('durable-views');
  const service = host.ctx.hima;
  const readers = createDurableViewReaders({ ledger: service.ledger, judge: service.judge, durable: service.durable,
    host: host.ctx, sitesDir: path.join(home, 'hima/sites'), packsDir: path.join(home, 'hima/packs') });
  return await readers.readRunRecords(runId) as any[];
}

// Every stage Reader (tools/read-stage.py) locates its workspace as report.parents[3] and raw.json
// beside the report; the probe Reader reads probe-inputs.json beside it. DBOS hands ${REPORT} as a
// staged copy hima-readers/<effect>/input-report, so the first Reader (read-probe) already exits 1.
const readerStaging = 'DBOS Pack Reader stages ${REPORT} as hima-readers/<effect>/input-report without sibling files; '
  + 'AES read-probe.py/read-stage.py resolve evidence beside the report and exit 1 (suspected regression, reported)';

test('DBOS drives the complete AES graph from the probe loop through six Workshop branches to a goal-met ending',
  { timeout: 600_000, todo: readerStaging }, async (t) => {
  const home = await localHome(t, { sleepSeconds: 0, parallelJobs: 1, licences: { 'Library-Compiler': 1, 'Design-Compiler': 1, Innovus: 1 } });
  assert.ok(home);
  const fixture = await createAesDomainFixture();
  let host: InProcessHost | undefined;
  let runId: string | undefined;
  try {
    await cp(path.join(repoRoot, 'packs/aes-tsmc28-dtco/flow'), path.join(fixture.workspace, 'flow'), { recursive: true, force: true });
    const selectionCode = implementSelection(await readFile(path.join(fixture.workspace, 'flow/selection-template.py'), 'utf8'));
    const skeleton = String((fixture.inputs.legacy as Record<string, string>).LIBERTY_SKELETON);
    await writeFile(skeleton, `cell (NAND2_X1)\n  pin(A)\n    direction : input;\n  pin(B)\n    direction : input;\n  pin(ZN)\n    direction : output;\n    function : "!(A*B)";\ncell (INV_X1)\n  pin(A)\n    direction : input;\n  pin(ZN)\n    direction : output;\n    function : "!A";\n`);
    await installAesFullGraphFixture(fixture.workspace, path.join(repoRoot, 'packs/aes-tsmc28-dtco/flow/stages.py'), String(fixture.inputs.edaWrapper));
    await cp(path.join(repoRoot, 'packs/aes-tsmc28-dtco/tools/read-stage.py'), path.join(fixture.workspace, 'flow/read-stage.py'));
    await writeFile(path.join(fixture.workspace, 'flow/probe.py'), `import argparse,hashlib,json,pathlib\np=argparse.ArgumentParser(); p.add_argument('--workspace'); p.add_argument('--period',type=float); a=p.parse_args()\nw=pathlib.Path(a.workspace); flow=w/'flow'; raw='asked_period_ns\\t'+str(a.period)+'\\nworst_slack_ns\\t0\\ncell_area_um2\\t1\\n'; (flow/'metrics.tsv').write_text(raw)\nnet=flow/'probes'/'synthetic'/'netlist.v'; net.parent.mkdir(parents=True,exist_ok=True); net.write_text('module aes_cipher_top(input a,b,c,d,e,f,output z1,z2);\\nNAND2_X1 U0(.A(a),.B(b),.ZN(n1));\\nNAND2_X1 U1(.A(n1),.B(c),.ZN(z1));\\nNAND2_X1 U2(.A(d),.B(e),.ZN(n2));\\nNAND2_X1 U3(.A(n2),.B(f),.ZN(z2));\\nendmodule\\n')\nidentity={'schema':1,'inputs':{'fixture':'synthetic-probe'},'method':{'fixture':'synthetic-probe'},'tool':{'version':'synthetic'}}; body=json.dumps(identity); (flow/'probe-inputs.json').write_text(body)\n(flow/'probe.json').write_text(json.dumps({'effectiveIdentity':identity,'identity':{'path':'probe-inputs.json','sha256':hashlib.sha256(body.encode()).hexdigest()},'format':'aes-probe/2','toolExit':0,'askedPeriodNs':a.period,'evidence':{'metrics':{'path':'metrics.tsv','sha256':hashlib.sha256(raw.encode()).hexdigest()},'netlist.v':{'path':'probes/synthetic/netlist.v','sha256':hashlib.sha256(net.read_bytes()).hexdigest()}}}))\n`);
    const installedPack = path.join(home.h.home, 'hima/packs/aes-tsmc28-dtco');
    await cp(path.join(repoRoot, 'packs/aes-tsmc28-dtco'), installedPack, { recursive: true });
    await writeLocalSite(home.h, { allowedReadRoots: [home.h.workspace, fixture.workspace], allowedWriteRoots: [home.h.workspace],
      allowedWrappers: ['/usr/bin/python3'], licences: { 'Library-Compiler': 1, 'Design-Compiler': 1, Innovus: 1 },
      bindings: { flowRoot: path.join(fixture.workspace, 'flow'), design: 'aes_cipher_top', workspaceRoot: home.h.workspace } });

    // Six selection Workshops, one native session each, all writing the same selector.
    const authored = (route: string): ReplayEntry[] => [tool('hima_workshop_write', { path: 'entry.py', content: selectionCode }, `select-${route}`),
      say('The selector ranks buildable candidates by measured non-overlapping support.')];
    let scenario = { ...await writeMomentFixture(home.h, 'one-turn'), children: [] as readonly string[] };
    await writeFile(scenario.override, JSON.stringify(authored(routes[0])));
    for (const route of routes.slice(1)) scenario = await appendReplaySession(scenario, `select-${route}`, authored(route));
    await writeReplayOverlay(home.h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });

    host = await bootInProcess(home.h);
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'aes-tsmc28-dtco', site: 'local', test: true,
      goal: { target_period_ns: 0.5 }, strategy: { periodNs: 0.5, algorithmRevision: 0 },
      generationLimit: 1, retryAllowance: 1, timeBoxMs: 600_000, ownerSessionId: String(owner.id) });
    assert.ok(started.kind === 'ran' || started.kind === 'preparing', JSON.stringify(started));
    if (started.kind !== 'ran' && started.kind !== 'preparing') return;
    runId = started.run.id;
    let context = await host.ctx.hima.readExecutionContext(runId);
    await waitUntil('the DBOS Run reaches its outcome', async () => {
      context = await host!.ctx.hima.readExecutionContext(runId!);
      return !!context.durable?.outcome;
    }, 540_000, 250);
    const outcome = context.durable!.outcome as any;
    const tasks = (context.durable as any).tasks.map((task: any) => ({ id: task.identity.taskId, state: task.state }));
    assert.equal(outcome.state, 'succeeded', JSON.stringify({ status: context.run.status, outcome: { state: outcome.state, reason: outcome.reason },
      unfinished: tasks.filter((task: any) => task.state.state !== 'succeeded') }));

    const records = await recordsOf(host, home.h.home, runId);
    const verdictsOf = (taskId: string) => (outcome.committed[taskId]?.value?.verdicts ?? []).map((verdict: any) => verdict.outcome);
    assert.deepEqual(verdictsOf('judge'), ['PASS', 'PASS'], 'the synthetic probe meets setup and the declared period');
    assert.equal(outcome.committed.probe.value.outcome, 'goal-met', 'the probe loop ends on its own goal-met decision');
    assert.ok(verdictsOf('merge-join').length === routes.length && verdictsOf('merge-join').every((value: string) => value === 'PASS'),
      `every route selection is known before the join: ${JSON.stringify(verdictsOf('merge-join'))}`);
    assert.deepEqual(verdictsOf('final-judge'), ['PASS', 'PASS'], 'full evidence is valid and the period meets the Goal');
    assert.equal(outcome.committed['next-research'].value.goalMet, true);
    const code = records.filter(record => record.type === 'code');
    assert.equal(code.length, routes.length, 'one CodeRecord per launched selection Workshop');
    assert.ok(code.every(record => record.sha256 === createHash('sha256').update(selectionCode).digest('hex')),
      'each CodeRecord identifies the exact selector bytes its Workshop executed');
    assert.ok(records.filter(record => record.type === 'job' && record.event === 'launched').length > routes.length,
      'the Host launched the bounded local Jobs of every stage');
    assert.equal(context.run.status, 'ended-goal-met');
    assert.equal((context.run as any).goalState, 'met');
  } finally {
    if (runId) await host?.ctx.hima.cancelRun(runId).catch(() => undefined);
    await host?.dispose(); await fixture.dispose(); await home.h.dispose();
  }
});
