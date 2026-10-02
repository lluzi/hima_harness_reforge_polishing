// Opt-in Issue #82 release qualification. It does not rerun timing: a temporary Pack copy changes
// only graph.entry to fix-timing, then current production OpenCode repackages the retained real
// result/checkpoint into a fresh Campaign for current Host materialization and the original Reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { loadPack, packDigestExcludes, type LedgerRecord } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { waitUntil } from './support/fabric.ts';
import { requireLiveSite } from './support/live-site.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { homePatchFile } from '../../packages/desktop/src/hima-home.ts';

requireLiveSite();

const SWITCH = 'HIMA_ISSUE82_RELEASE_LIVE';
const EVIDENCE_VARIABLE = 'HIMA_ISSUE82_RELEASE_EVIDENCE_DIR';
const SITE = 'linglong-atcs28';
const DESTINATION = 'luzi@192.168.50.41';
const PACK = 'agentic-timing-closure-system';
const OLD_WORKSPACE = '/data/eda/project/hima_harness/atcs-runs/agentic-timing-closure-system-20261002-141717-8f70';
const OLD_TASK = `${OLD_WORKSPACE}/.hima-engineering/resident-2095ddfaf07b5653f962c081`;
const OLD_ARTIFACT_ROOT = `${OLD_TASK}/delivery/artifacts/owner-eng-delivery-fix-timing-5`;
const REMOTE_WRAPPER = '/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/resident-engineering-wrapper.py';
const REMOTE_CAPABILITY = '/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-v1.json';
const LOCAL_WRAPPER = path.join(repoRoot, 'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
const LOCAL_CAPABILITY = path.join(repoRoot, 'sites/linglong-atcs28/engineering-capabilities-v1.json');
const pquote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function ssh(command: string, timeout = 120_000): { status: number | null; stdout: Buffer; stderr: string } {
  const result = spawnSync('ssh', ['-o', 'ControlPath=none', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8', DESTINATION, command], { encoding: null, timeout, maxBuffer: 256 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? Buffer.alloc(0), stderr: result.stderr?.toString('utf8') ?? '' };
}

function remoteText(file: string): string {
  const result = ssh(`cat -- ${pquote(file)}`);
  assert.equal(result.status, 0, `cannot read ${file}: ${result.stderr}`);
  return result.stdout.toString('utf8');
}

function probeReason(): string | false {
  if (process.env[SWITCH] !== '1') return `${SWITCH}=1 was not supplied; release qualification was not selected`;
  const base = process.env[EVIDENCE_VARIABLE];
  if (!base || !path.isAbsolute(base)) return `${EVIDENCE_VARIABLE} must be an absolute durable directory`;
  const reached = ssh('true', 20_000);
  return reached.status === 0 ? false : `production Site is unreachable: ssh exited ${String(reached.status)}`;
}

const textOf = (answer: any): string => answer.content.filter((item: any) => item.type === 'text').map((item: any) => item.text).join('');

test('Issue #82 release qualification: native OpenCode repackages retained real artifacts and current Host/original Reader accept them',
  { skip: probeReason(), timeout: 45 * 60_000 }, async (t) => {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const evidenceDir = path.join(process.env[EVIDENCE_VARIABLE]!, `issue82-release-${stamp}`);
  await mkdir(evidenceDir, { recursive: false });

  const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(source.status, 0, source.stderr);
  assert.equal(status.stdout, '', `candidate checkout is dirty:\n${status.stdout}`);
  const expected = { wrapper: sha256(readFileSync(LOCAL_WRAPPER)), capability: sha256(readFileSync(LOCAL_CAPABILITY)) };
  const deployed = ssh(`sha256sum -- ${pquote(REMOTE_WRAPPER)} ${pquote(REMOTE_CAPABILITY)}; `
    + `test -d /home/luzi/.config/opencode; test -f /home/luzi/.local/share/opencode/auth.json; `
    + `/home/luzi/.opencode/bin/opencode --version; pgrep -af '[i]cexplorer-xtop_exe|[q]ualib_exe' || true`);
  assert.equal(deployed.status, 0, deployed.stderr);
  const deployedText = deployed.stdout.toString('utf8');
  assert.match(deployedText, new RegExp(`^${expected.wrapper}  ${REMOTE_WRAPPER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(deployedText, new RegExp(`^${expected.capability}  ${REMOTE_CAPABILITY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(deployedText, /^1\.18\.34$/m);
  assert.doesNotMatch(deployedText, /icexplorer-xtop_exe|qualib_exe/);

  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  const home = await createHimaHome();
  const packsDir = path.join(home.home, 'hima/packs');
  const sitesDir = path.join(home.home, 'hima/sites');
  const installed = path.join(packsDir, PACK);
  await mkdir(packsDir, { recursive: true });
  await mkdir(sitesDir, { recursive: true });
  await cp(path.join(repoRoot, 'packs', PACK), installed, { recursive: true, filter: (at) => !at.includes('__pycache__') });
  const graphPath = path.join(installed, 'graph.yml');
  const graph = parse(await readFile(graphPath, 'utf8')) as any;
  assert.equal(graph.version, '0.3.1');
  graph.entry = 'fix-timing';
  graph.autopilot = [];
  await writeFile(graphPath, stringify(graph));
  await cp(path.join(repoRoot, 'sites', SITE, 'site.yml'), path.join(sitesDir, `${SITE}.yml`));
  await cp(path.join(repoRoot, 'sites', SITE, 'permit.yml'), path.join(sitesDir, 'permit.yml'));
  await appendFile(homePatchFile(home.home), QUIET_TITLE_ROW);
  await appendFile(homePatchFile(home.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(home.home, 'hima/knowledge/current'))}\n`);

  const releasedPack = loadPack(path.join(repoRoot, 'packs'), PACK);
  const qualificationPack = loadPack(packsDir, PACK);
  const evidence: Record<string, unknown> = {
    schema: 'hima.issue82-release-qualification/1', sourceCommit: source.stdout.trim(), startedAt: new Date().toISOString(),
    deployed: { expected, probe: deployedText.trim().split('\n') },
    pack: { releasedVersion: releasedPack.contract.version, releasedDigest: releasedPack.folder.digest(packDigestExcludes),
      qualificationDigest: qualificationPack.folder.digest(packDigestExcludes), overlay: 'graph.entry=fix-timing; autopilot=[] only' },
    retainedSource: { workspace: OLD_WORKSPACE, task: OLD_TASK, artifactRoot: OLD_ARTIFACT_ROOT },
  };
  const host = await bootInProcess(home);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.workspace);
    const started = await host.ctx.hima.startRun({ pack: PACK, site: SITE, ownerSessionId: String(owner.id),
      goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0 }, strategy: { nativeReportPaths: 10000 },
      timeBoxMs: 30 * 60_000, generationLimit: 1, retryAllowance: 1 } as never);
    assert.equal(started.kind, 'ran', JSON.stringify(started));
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const workspace = started.workspace;
    evidence.run = { runId, workspace, campaignId: started.run.campaignId, methodDigest: started.run.packDigest };

    const seed = ssh(`set -eu; new=${pquote(workspace)}; old=${pquote(OLD_WORKSPACE)}; src=${pquote(OLD_ARTIFACT_ROOT)}; `
      + `mkdir -p -- "$new/state" "$new/retained-source"; `
      + `cp -- "$old/state/baseline.json" "$old/state/common-stage.json" "$old/state/xtop-context.json" "$old/state/autofix-reference.json" "$new/state/"; `
      + `(cd "$old" && cp --parents -- research/observe/common-r1/residual-analysis/hold.rpt research/observe/common-r1/residual-analysis/setup.rpt research/control/autofix-reference/best/hold.rpt research/control/autofix-reference/best/setup.rpt "$new"); `
      + `cp -a -- "$src/." "$new/retained-source/"; `
      + `test "$(find "$new/retained-source/engineering/checkpoints/final-workspace" -type f | wc -l)" -eq 60; `
      + `sha256sum -- "$new/retained-source/state/engineering-result.json"`);
    assert.equal(seed.status, 0, seed.stderr);
    evidence.seed = seed.stdout.toString('utf8').trim();

    let serial = 0;
    const controlled = () => host.ctx.hima.ledger.run(runId!)!.control!;
    const call = async (args: Record<string, unknown>) => {
      const answer = await host.ctx.tools.execute({ callId: `release-qualification-${++serial}` as never,
        name: 'hima_execute', arguments: args, agent: owner, signal: AbortSignal.timeout(180_000) });
      assert.equal(answer.isError, false, textOf(answer));
      return JSON.parse(textOf(answer));
    };
    const execute = (requestId: string, action: string, extra: Record<string, unknown>) => call({ run: runId,
      action, requestId, expectedEpoch: controlled().epoch, expectedRevision: controlled().revision, ...extra });
    const begun = await execute('qualify-begin', 'begin', { nodeId: 'fix-timing' });
    assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
    const executionId = begun.receipt.executionId as string;
    const goal = [
      'Release qualification only: do not run XTop and do not alter retained-source.',
      'Read retained-source/state/engineering-result.json and the supplied task identity. Use normal shell/Python tools to read /data/eda/project/hima_harness/atcs-inputs/nativeTimingContext-v1.json.',
      'Write engineering/qualification/initial.txt containing RELEASE_QUALIFICATION_INITIAL and the native-context schema/id. Do not write resident-delivery.json yet. End this turn ready for one follow-up.',
    ].join(' ');
    const context = 'The next message will ask you to copy the retained real engineering tree, rebind only the result task identity, recompute its canonical id with flow/atcs/core.py, and produce the normal delivery candidate. This is packaging/integration, not new timing work.';
    const startedTask = await execute('qualify-start', 'engineering', { executionId,
      engineering: { operation: 'start', goal, context } });
    assert.ok(startedTask.data, `resident start returned no data: ${JSON.stringify(startedTask)}`);
    assert.equal(startedTask.data.status, 'started', JSON.stringify(startedTask));
    const taskId = startedTask.data.taskId as string;
    const taskDir = path.posix.join(workspace, '.hima-engineering', taskId);
    await waitUntil('native qualification initial turn', () => {
      try { return JSON.parse(remoteText(path.posix.join(taskDir, 'state.json'))).phase === 'waiting'; } catch { return false; }
    }, 10 * 60_000, 1_000);
    const initial = remoteText(path.posix.join(taskDir, 'workspace/engineering/qualification/initial.txt'));
    assert.match(initial, /RELEASE_QUALIFICATION_INITIAL/);

    const followup = [
      'Now complete the same release qualification without running XTop.',
      'Write engineering/qualification/followup.txt containing RELEASE_QUALIFICATION_FOLLOWUP.',
      'Copy retained-source/engineering to the private workspace preserving every relative file and byte.',
      'Rebuild result.json from retained-source/state/engineering-result.json by changing only taskId/runId/executionId/nodeId to the current task identity and recomputing schema/id with the current flow/atcs/core.py.',
      'Verify all referenced hashes. Write resident-delivery.json as hima-resident-engineering-candidate/1 outcome completed with exactly one result artifact result.json and every regular file under engineering as support, each with its actual sha256. State that this is retained-artifact integration, not new engineering effect.',
    ].join(' ');
    const message = await execute('qualify-followup', 'engineering', { executionId,
      engineering: { operation: 'message', message: followup } });
    assert.equal(message.data.status, 'accepted', JSON.stringify(message));
    await waitUntil('native qualification delivery candidate', () => {
      try { return JSON.parse(remoteText(path.posix.join(taskDir, 'state.json'))).detail?.completedRequestId === 'qualify-followup'
        && JSON.parse(remoteText(path.posix.join(taskDir, 'workspace/resident-delivery.json'))).schema === 'hima-resident-engineering-candidate/1'; }
      catch { return false; }
    }, 15 * 60_000, 1_000);

    const delivery = await execute('qualify-delivery', 'engineering', { executionId, engineering: { operation: 'delivery' } });
    assert.equal(delivery.data.status, 'verified', JSON.stringify(delivery));
    const result = JSON.parse(remoteText(path.posix.join(workspace, 'state/engineering-result.json')));
    assert.deepEqual(result.task, { taskId, runId, executionId, nodeId: 'fix-timing' });
    assert.equal(result.measurements.after.hold.violations, 0);
    assert.equal(result.measurements.after.setup.violations, 18);
    assert.equal(remoteText(path.posix.join(workspace, 'engineering/qualification/initial.txt')), initial);
    assert.match(remoteText(path.posix.join(workspace, 'engineering/qualification/followup.txt')), /RELEASE_QUALIFICATION_FOLLOWUP/);
    const checkpoint = ssh(`set -eu; test "$(find ${pquote(path.posix.join(workspace, 'engineering/checkpoints/final-workspace'))} -type f | wc -l)" -eq 60; `
      + `sha256sum -- ${pquote(path.posix.join(workspace, 'engineering/eco/final_netlist_eco.txt'))} ${pquote(path.posix.join(workspace, 'engineering/raw/after-hold.rpt'))}`);
    assert.equal(checkpoint.status, 0, checkpoint.stderr);

    const observations = host.ctx.hima.ledger.records({ runId, type: 'observation' }) as any[];
    const reading = observations.findLast((record) => record.reader?.id === 'atcs-engineering-result');
    assert.ok(reading, 'original ATCS engineering Reader produced no observation');
    assert.ok(reading.values.some((value: any) => value.type === 'tc_engineering_effect_vs_autofix' && value.value === 1));
    const release = await execute('qualify-release', 'engineering', { executionId, engineering: { operation: 'release' } });
    assert.equal(release.data.status, 'released', JSON.stringify(release));
    const owned = JSON.parse(remoteText(path.posix.join(taskDir, 'native/owned.json')));
    assert.equal(owned.quiescent, true);
    const noEda = ssh("pgrep -af '[i]cexplorer-xtop_exe|[q]ualib_exe' || true");
    assert.equal(noEda.status, 0, noEda.stderr);
    assert.equal(noEda.stdout.toString('utf8').trim(), '', 'qualification must not start XTop or QuaLib');

    evidence.finishedAt = new Date().toISOString();
    evidence.task = { taskId, executionId, sessionId: startedTask.data.state?.sessionId, initial, followup:
      remoteText(path.posix.join(workspace, 'engineering/qualification/followup.txt')), delivery: delivery.data, release: release.data, owned };
    evidence.result = { id: result.id, inputIdentity: result.inputIdentity, measurements: result.measurements,
      bestEffort: result.bestEffort, stopReason: result.stopReason };
    evidence.reader = reading;
    evidence.checkpoint = checkpoint.stdout.toString('utf8').trim().split('\n');
    evidence.ledger = host.ctx.hima.ledger.records({ runId }) as LedgerRecord[];
    await writeFile(path.join(evidenceDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    await writeFile(path.join(evidenceDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(path.join(evidenceDir, 'delivery-manifest.json'), remoteText(path.posix.join(taskDir, 'delivery/manifest.json')));
    t.diagnostic(`release qualification evidence: ${evidenceDir}`);
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined);
    await host.dispose().catch(() => undefined);
    await home.dispose().catch(() => undefined);
  }
});
