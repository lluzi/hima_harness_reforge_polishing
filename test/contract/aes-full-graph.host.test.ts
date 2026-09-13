// PLS-25 L2 Host composition. Synthetic artifacts stand only at the Site/tool boundary.
// It does not claim a production AES mine, learned characterization model, or EDA result.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { ExecutionActionRequest } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { createAesDomainFixture } from './support/aes-domain-fixture.ts';
import { installAesFullGraphFixture } from './support/aes-full-graph-fixture.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome, nodeRecords, recordsOf, waitUntil } from './support/fabric.ts';
import { writeLocalSite } from './support/site.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const routes = [
  'timing-criticality', 'timing-context', 'structure-frequency',
  'structure-compaction', 'mapper-compatibility', 'functional-diversity',
] as const;
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

test('one native owner explicitly drives the bounded v3 AES graph through the Host', async (t) => {
  const capture = process.env.HIMA_AES_CAPTURE_OUT ? path.resolve(process.env.HIMA_AES_CAPTURE_OUT) : undefined;
  const { home, fixture } = await (async () => {
    const previousTmpdir = process.env.TMPDIR;
    try {
      // The group runner removes its own temporary root. Retained delivery inputs therefore live
      // outside that root; tmux sockets and boot counters still use the group's existing settings.
      if (capture) process.env.TMPDIR = '/private/tmp';
      const home = await localHome(t, { sleepSeconds: 0, parallelJobs: 1,
        licences: { 'Library-Compiler': 1, 'Design-Compiler': 1, Innovus: 1 } });
      assert.ok(home);
      return { home, fixture: await createAesDomainFixture() };
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmpdir;
    }
  })();
  if (capture) {
    await mkdir(capture, { recursive: false });
    await writeFile(path.join(capture, 'preparation.json'), JSON.stringify({ home: home.h.home, fixture: fixture.workspace }) + '\n');
  }
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  let runId: string | undefined;
  try {
    // Stage the complete current flow so new workspace-copy contracts cannot be hidden by the fixture.
    await cp(path.join(repoRoot, 'packs/aes-tsmc28-dtco/flow'), path.join(fixture.workspace, 'flow'),
      { recursive: true, force: true });
    const selectionTemplate = await readFile(path.join(fixture.workspace, 'flow/selection-template.py'), 'utf8');
    const selectionCode = implementSelection(selectionTemplate);
    const skeleton = String((fixture.inputs.legacy as Record<string, string>).LIBERTY_SKELETON);
    await writeFile(skeleton, `cell (NAND2_X1)\n  pin(A)\n    direction : input;\n  pin(B)\n    direction : input;\n  pin(ZN)\n    direction : output;\n    function : "!(A*B)";\ncell (INV_X1)\n  pin(A)\n    direction : input;\n  pin(ZN)\n    direction : output;\n    function : "!A";\n`);
    // `workspace.copy` stages this test-only mine/characterization boundary and the real downstream adapter.
    await installAesFullGraphFixture(fixture.workspace,
      path.join(repoRoot, 'packs/aes-tsmc28-dtco/flow/stages.py'), String(fixture.inputs.edaWrapper));
    await cp(path.join(repoRoot, 'packs/aes-tsmc28-dtco/tools/read-stage.py'), path.join(fixture.workspace, 'flow/read-stage.py'));
    await writeFile(path.join(fixture.workspace, 'flow/probe.py'), `import argparse,hashlib,json,pathlib\np=argparse.ArgumentParser(); p.add_argument('--workspace'); p.add_argument('--period',type=float); a=p.parse_args()\nw=pathlib.Path(a.workspace); flow=w/'flow'; raw='asked_period_ns\\t'+str(a.period)+'\\nworst_slack_ns\\t0\\ncell_area_um2\\t1\\n'; (flow/'metrics.tsv').write_text(raw)\nnet=flow/'probes'/'synthetic'/'netlist.v'; net.parent.mkdir(parents=True,exist_ok=True); net.write_text('module aes_cipher_top(input a,b,c,d,e,f,output z1,z2);\\nNAND2_X1 U0(.A(a),.B(b),.ZN(n1));\\nNAND2_X1 U1(.A(n1),.B(c),.ZN(z1));\\nNAND2_X1 U2(.A(d),.B(e),.ZN(n2));\\nNAND2_X1 U3(.A(n2),.B(f),.ZN(z2));\\nendmodule\\n')\nidentity={'schema':1,'inputs':{'fixture':'synthetic-probe'},'method':{'fixture':'synthetic-probe'},'tool':{'version':'synthetic'}}; body=json.dumps(identity); (flow/'probe-inputs.json').write_text(body)\n(flow/'probe.json').write_text(json.dumps({'effectiveIdentity':identity,'identity':{'path':'probe-inputs.json','sha256':hashlib.sha256(body.encode()).hexdigest()},'format':'aes-probe/2','toolExit':0,'askedPeriodNs':a.period,'evidence':{'metrics':{'path':'metrics.tsv','sha256':hashlib.sha256(raw.encode()).hexdigest()},'netlist.v':{'path':'probes/synthetic/netlist.v','sha256':hashlib.sha256(net.read_bytes()).hexdigest()}}}))\n`);
    const installedPack = path.join(home.h.home, 'hima/packs/aes-tsmc28-dtco');
    await cp(path.join(repoRoot, 'packs/aes-tsmc28-dtco'), installedPack, { recursive: true });
    await writeLocalSite(home.h, { allowedReadRoots: [home.h.workspace, fixture.workspace], allowedWriteRoots: [home.h.workspace],
      allowedWrappers: ['/usr/bin/python3'], licences: { 'Library-Compiler': 1, 'Design-Compiler': 1, Innovus: 1 },
      bindings: { flowRoot: path.join(fixture.workspace, 'flow'), design: 'aes_cipher_top', workspaceRoot: home.h.workspace } });
    host = await bootInProcess(home.h);
    const native = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: 'aes-tsmc28-dtco', site: 'local', test: true,
      goal: { target_period_ns: 0.5 }, strategy: { periodNs: 0.5, algorithmRevision: 0 },
      generationLimit: 1, retryAllowance: 1, timeBoxMs: 180_000, ownerSessionId: String(native.id) });
    assert.equal(started.kind, 'ran', JSON.stringify(started));
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    let sequence = 0;
    const context = () => host!.ctx.hima.executionContext(runId!);
    const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
      const control = context().run.control!;
      return host!.ctx.hima.executionAction({ runId: runId!, actor: String(native.id), origin: 'agent', action,
        expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `full-graph-${++sequence}`, ...fields });
    };
    const complete = async (nodeId: string) => {
      assert.ok(context().available.includes(nodeId), `${nodeId} is available: ${JSON.stringify(context().available)}`);
      const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', begin.reason);
      const executionId = begin.receipt?.executionId; assert.ok(executionId);
      const worked = await act('work', { executionId }); assert.equal(worked.kind, 'accepted', JSON.stringify({ worked, context: context() }));
      await waitUntil(`${nodeId} settles`, () => context().executions.some(e => e.id === executionId && ['ready', 'failed'].includes(e.phase)), 30_000, 25);
      const settled = context().executions.find(e => e.id === executionId)!;
      if (settled.phase !== 'ready') {
        const log = settled.intent?.job?.workspace && settled.jobSession ? await readFile(path.join(settled.intent.job.workspace, `${settled.jobSession}.log`), 'utf8') : '';
        const blocked = nodeRecords(host!, runId!).findLast(r => r.nodeId === nodeId && r.state === 'blocked');
        assert.fail(`${nodeId} ${settled.phase}: ${log}\n${JSON.stringify({ status: context().run.status, available: context().available,
          intent: settled.intent, result: settled.result, blockedReason: blocked?.reason })}`);
      }
      assert.equal((await act('complete', { nodeId, executionId })).kind, 'accepted');
      return executionId;
    };
    const workshop = async (route: typeof routes[number]) => {
      const nodeId = `select-${route}`;
      assert.ok(context().available.includes(nodeId));
      const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', begin.reason);
      const executionId = begin.receipt?.executionId; assert.ok(executionId);
      const template = await act('read', { executionId, output: 'selectionTemplate' });
      assert.equal(template.kind, 'accepted', template.reason);
      assert.equal((template.data as { text?: string }).text, selectionTemplate, 'the owner copies the complete declared template');
      for (const output of [`research_${route.replaceAll('-', '_')}`, `raw_${route.replaceAll('-', '_')}`, `source_${route.replaceAll('-', '_')}`]) {
        assert.equal((await act('read', { executionId, output })).kind, 'accepted');
      }
      assert.equal((await act('knowledge', { executionId, file: 'full-mining-method.md' })).kind, 'accepted');
      assert.equal((await act('write', { executionId, path: 'entry.py', content: selectionCode })).kind, 'accepted');
      assert.equal((await act('work', { executionId })).kind, 'accepted');
      await waitUntil(`${nodeId} settles`, () => context().executions.some(e => e.id === executionId && ['ready', 'failed'].includes(e.phase)), 30_000, 25);
      const settled = context().executions.find(e => e.id === executionId)!;
      if (settled.phase !== 'ready') {
        const blocked = nodeRecords(host!, runId!).findLast(r => r.nodeId === nodeId && r.state === 'blocked');
        assert.fail(`${nodeId} ${settled.phase}: ${JSON.stringify({ result: settled.result, blockedReason: blocked?.reason })}`);
      }
      assert.equal((await act('complete', { nodeId, executionId })).kind, 'accepted');
      await complete(`read-select-${route}`);
    };

    // Opening `probe` enters the inner loop; its later owner decision closes it.
    await complete('probe');
    assert.ok(context().available.includes('synthesize'));
    assert.ok(!context().executions.some(e => e.nodeId === 'synthesize'), 'Fabric did not auto-start the inner-loop successor');
    // The inner probe loop is real Host work. An owner decision closes it; Fabric starts no successor itself.
    await complete('synthesize'); await complete('read-probe'); await complete('judge');
    const next = await act('begin', { nodeId: 'next-period' }); assert.equal(next.kind, 'accepted', next.reason);
    const nextId = next.receipt?.executionId; assert.ok(nextId);
    assert.equal((await act('work', { executionId: nextId })).kind, 'accepted');
    const cites = recordsOf(host, runId).filter(r => r.type === 'observation' || r.type === 'verdict').map(r => r.id);
    assert.equal((await act('complete', { executionId: nextId, decision: 'goal-met', rationale: 'Synthetic probe evidence meets the declared period only.', cites })).kind, 'accepted');
    await complete('mine-start');
    assert.deepEqual(routes.filter(route => context().available.includes(`mine-${route}`)), [...routes]);
    assert.ok(routes.every(route => !context().executions.some(e => e.nodeId === `mine-${route}`)),
      'Fabric exposes every branch but does not auto-start one');
    for (const [index, route] of routes.entries()) {
      await complete(`mine-${route}`);
      assert.ok(context().available.includes(`select-${route}`));
      assert.ok(!context().executions.some(e => e.nodeId === `select-${route}`), 'Fabric did not auto-start the Workshop');
      await workshop(route);
      if (index < routes.length - 1) assert.ok(!context().available.includes('merge-join'), 'join waits for every route reader');
    }
    assert.ok(context().available.includes('merge-join'), 'the join becomes available after every route reader completes');
    // All route readers have now emitted evidence, so this is the first permitted join.
    await complete('merge-join');
    for (const node of ['merge', 'read-merge', 'generate', 'read-generate', 'layout', 'read-layout', 'characterize', 'read-characterize',
      'compile', 'read-compile', 'foundry-synth', 'read-foundry-synth', 'custom-synth', 'read-custom-synth', 'adoption', 'read-adoption',
      'pnr-foundry', 'read-pnr-foundry', 'pnr-generated', 'read-pnr-generated', 'verify', 'read-verify', 'compare', 'read-compare', 'final-judge']) await complete(node);
    assert.ok(context().available.includes('next-research'));
    assert.ok(!context().executions.some(e => e.nodeId === 'next-research'), 'Fabric did not auto-start the final owner decision');
    const final = await act('begin', { nodeId: 'next-research' }); assert.equal(final.kind, 'accepted', final.reason);
    const finalId = final.receipt?.executionId; assert.ok(finalId); assert.equal((await act('work', { executionId: finalId })).kind, 'accepted');
    const finalCites = recordsOf(host, runId).filter(r => (r.type === 'observation' || r.type === 'verdict')
      && r.generation === 1 && r.loopId === undefined).map(r => r.id);
    const ending = await act('complete', { executionId: finalId, decision: 'goal-met',
      rationale: 'The bounded synthetic fixture satisfies its declared constraints; this is not a real tool or AES PPA claim.', cites: finalCites });
    assert.equal(ending.kind, 'accepted', ending.reason);
    assert.equal(context().run.status, 'ended-goal-met');
    assert.deepEqual(context().available, [], 'the ending launches no further research generation');
    const code = recordsOf(host, runId).filter(r => r.type === 'code');
    assert.equal(code.length, routes.length);
    assert.deepEqual(code.map(r => r.type === 'code' && r.sha256), routes.map(() => createHash('sha256').update(selectionCode).digest('hex')),
      'each launched Workshop CodeRecord identifies the exact bytes supplied by the same owner');
    assert.ok((context().run.meters?.jobsLaunched ?? 0) > routes.length,
      `the Host recorded the bounded local jobs it launched: ${JSON.stringify(context().run.meters)}`);
    // An opt-in delivery checkpoint keeps this same tested home and its Site inputs. It adds no
    // second Run or extra business work; native TEST/release can then audit these original facts.
    if (capture) {
      await writeFile(path.join(capture, 'evidence.json'), JSON.stringify({
        status: 'passed', passed: true, scope: 'L2 complete graph with explicit synthetic external boundaries',
        home: home.h.home, fixture: fixture.workspace, owner: String(native.id),
        agentOptions: native.options, packFolder: installedPack,
        run: context().run, records: recordsOf(host, runId),
        hosts: 1, modelRequests: 0, electron: 0, ssh: 0, realEdaJobs: 0,
      }, null, 2) + '\n');
    }
  } finally {
    if (runId) await host?.ctx.hima.cancelRun(runId);
    await host?.dispose();
    if (!capture) { await fixture.dispose(); await home.h.dispose(); }
  }
});
