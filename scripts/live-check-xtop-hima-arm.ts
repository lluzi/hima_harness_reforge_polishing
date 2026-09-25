// @hima-seam agent wrapped
// @hima-seam tools direct
// One authorized J3 arm: a real DeepSeek Campaign owner drives one complete XTop generation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import {
  CAMPAIGN_SCHEMA,
  createInteractiveBindingBridge,
  currentRecordsIn,
  discoverSshSite,
  installPackMethod,
  loadPack,
  packDigestExcludes,
  saveDiscoveredSite,
  writeCampaignFile,
  type JobRecord,
  type NodeRecord,
  type ObservationRecord,
  type RunRecord,
  type VerdictRecord,
} from '@hima/harness';
import { homePatchFile, prepareHimaHome } from '../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { guardInstalled, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';

const NAME = 'live-check-xtop-hima-arm';
const PACK_ID = 'xtop-timing-closure';
const SITE_NAME = 'linglong-swerv28';
const EXPECTED_PROVIDER = 'deepseek-official';
const EXPECTED_MODEL = 'deepseek-flash';
const EXPECTED_VERSION = '1.0.14';
const TIME_BOX_MINUTES = 120;
const sourcePackDirectory = path.join(repoRoot, 'packs', PACK_ID);
const sourceSiteDirectory = path.join(repoRoot, 'sites', SITE_NAME);

const rawArgs = process.argv.slice(2);
const preflightOnly = rawArgs.includes('--preflight-only');
const bindingAt = rawArgs.indexOf('--binding-file');
const bindingArgument = bindingAt < 0 ? undefined : rawArgs[bindingAt + 1];
if (!bindingArgument || bindingArgument.startsWith('--') || rawArgs.filter((arg) => arg === '--binding-file').length !== 1) {
  throw new Error(`usage: node scripts/${NAME}.ts --binding-file <absolute-admin-binding.json> --out <fresh-directory> [--timeout-ms 10800000 --max-turns 40 --max-steps 600]`);
}
process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs.filter((arg, index) => arg !== '--preflight-only'
  && index !== bindingAt && index !== bindingAt + 1)];
const bindingFile = realpathSync(bindingArgument);
assert.ok(path.isAbsolute(bindingFile) && lstatSync(bindingFile).isFile() && !lstatSync(bindingFile).isSymbolicLink(),
  'interactive binding must be one plain absolute administrator file');

const jsonOf = (result: { readonly isError?: boolean; readonly content?: readonly { readonly type: string; readonly text?: string }[] }) => {
  assert.equal(result.isError, false, JSON.stringify(result));
  return JSON.parse(result.content?.find((item) => item.type === 'text')?.text ?? '{}') as Record<string, any>;
};
const terminal = (run: RunRecord | undefined): boolean => run?.status?.startsWith('ended-') === true || run?.status === 'cancelled';
const active = (run: RunRecord): boolean => run.status === 'running'
  || Object.values(run.control?.executions ?? {}).some((execution) => execution.phase === 'working');

await runLive(NAME, 40, async (check: LiveCheck) => {
  const sourcePack = loadPack(path.join(repoRoot, 'packs'), PACK_ID);
  const sourceDigest = sourcePack.folder.digest(packDigestExcludes);
  check.require('the J3 arm uses the currently qualified development Pack',
    sourcePack.contract.version === EXPECTED_VERSION && sourcePack.contract.status === 'development',
    { version: sourcePack.contract.version, status: sourcePack.contract.status, digest: sourceDigest });

  const sitePolicy = parse(readFileSync(path.join(sourceSiteDirectory, 'site.yml'), 'utf8')) as Record<string, any>;
  const permitPolicy = parse(readFileSync(path.join(sourceSiteDirectory, 'permit.yml'), 'utf8')) as Record<string, any>;
  const remoteState = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
    sitePolicy.ssh.destination,
    'printf "mode="; cat /data/eda/env/empyrean-license-mode; printf "clients="; pgrep -af "[i]cexplorer-xtop_exe|[q]ualib_exe" || true'],
  { encoding: 'utf8', timeout: 30_000 });
  check.require('the live Site is in old mode with no conflicting Empyrean client before the Hima arm',
    /^mode=old\nclients=\s*$/s.test(remoteState), remoteState);

  const home = await createHimaHome(); check.home = home;
  await prepareHimaHome({ home: home.home, bundleMode: 'installed' });
  const installedPackDirectory = path.join(packsDirOf(home), PACK_ID);
  const installation = installPackMethod({ from: sourcePackDirectory, to: installedPackDirectory });
  check.require('a fresh Home installed the exact current XTop Pack',
    installation.changed && installation.digest === sourceDigest,
    { changed: installation.changed, installedDigest: installation.digest, sourceDigest });

  const sitesDirectory = path.join(home.home, 'hima/sites');
  const discovery = await discoverSshSite({
    name: SITE_NAME,
    ssh: sitePolicy.ssh,
    hints: {
      workspaceRoot: sitePolicy.workspaceRoot,
      allowedReadRoots: permitPolicy.allowedReadRoots,
      allowedWriteRoots: permitPolicy.allowedWriteRoots,
      allowedWrappers: permitPolicy.allowedWrappers,
      toolCommands: ['python3'],
    },
  });
  check.require('bounded Site discovery completed without unknowns or conflicts',
    discovery.unknowns.length === 0 && discovery.conflicts.length === 0,
    { unknowns: discovery.unknowns, conflicts: discovery.conflicts });
  const site = saveDiscoveredSite(sitesDirectory, {
    ...discovery,
    site: { ...discovery.site, bindings: sitePolicy.bindings, capacity: sitePolicy.capacity },
    permit: permitPolicy as { allowedReadRoots: string[]; allowedWriteRoots: string[];
      allowedWrappers: string[]; forbidden: string[] },
  });
  check.require('the saved Site retains the reviewed XTop bindings, capacity and redlines',
    site.name === SITE_NAME && site.discovery?.stale === false
      && Object.keys(site.bindings).sort().join(',') === Object.keys(sitePolicy.bindings).sort().join(',')
      && site.permitRules.forbidden.includes('deletions'),
    { name: site.name, bindings: Object.keys(site.bindings), capacity: site.capacity,
      forbidden: site.permitRules.forbidden });

  const installedPack = loadPack(packsDirOf(home), PACK_ID);
  const bridge = createInteractiveBindingBridge({ packsDir: packsDirOf(home), sitesDir: sitesDirectory,
    interactiveBindingsFile: bindingFile });
  const preflightRun = { id: 'preflight-run', campaignId: 'preflight-campaign', siteId: SITE_NAME,
    packId: PACK_ID, packDigest: sourceDigest, createdAt: new Date().toISOString(), nextSeq: 1,
    status: 'running', strategy: { strategyRevision: 0 }, generation: 1 };
  const preflightExecution = { id: 'preflight-execution', nodeId: 'run-xtop-fix', kind: 'act', generation: 1,
    attempt: 1, methodDigest: sourceDigest, inputDigest: 'a'.repeat(64), phase: 'ready' };
  const preflightWorkspace = path.posix.join(site.workspaceRoot, 'binding-preflight-not-created');
  const resolved = await bridge.resolve({ pack: installedPack, run: preflightRun as never,
    execution: preflightExecution as never, site, workspace: preflightWorkspace });
  assert.ok(resolved, 'current production binding must resolve before any commercial Campaign starts');
  const verified = await bridge.verifyAdminBinding(resolved.binding);
  check.require('open-time production binding verification is enforced before the Hima arm',
    verified.confinement === 'enforced' && verified.writableRoot === site.workspaceRoot,
    { argv: resolved.argv, verified, bindingSha256: sha256(readFileSync(bindingFile)) });
  if (preflightOnly) {
    check.observed.outcome = 'PASS — no-commercial preflight only; no Host, model or Campaign was started';
    return;
  }

  writeCampaignFile(home.workspace, {
    schema: CAMPAIGN_SCHEMA,
    name: 'swerv28-commercial-chain-j3-hima-arm',
    pack: { id: PACK_ID, version: EXPECTED_VERSION },
    site: { name: SITE_NAME },
    inputs: {},
    goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0 },
    strategy: { strategyRevision: 0 },
    budget: { timeBoxMinutes: TIME_BOX_MINUTES, retries: 1, generations: 1 },
    knowledge: [],
    notes: 'Authorized J3 Hima arm. One complete candidate generation; preserve negative results and stop at the Pack blocker when timing remains open.',
  });
  writeFileSync(homePatchFile(home.home), `- id: session-title-llm\n  disabled: true\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(sitesDirectory)}\n    packsDir: ${JSON.stringify(packsDirOf(home))}\n    knowledgeDir: ${JSON.stringify(path.join(home.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingFile)}\n`);

  process.chdir(home.workspace);
  const host = await bootInProcess(home); check.attach(host);
  const bundle = realpathSync(path.join(home.profileDir, 'node_modules/@hima/harness'));
  guardInstalled(check, host, [bundle, packsDirOf(home), home.workspace], installedPackDirectory, check.temporary);
  host.ctx.tools.guard((execution) => {
    if (['write', 'edit', 'bash', 'terminal'].includes(execution.name)) {
      return 'J3 business work uses only the installed Pack, Hima tools and the qualified interactive binding';
    }
    if (['hima_author', 'hima_pack_release'].includes(execution.name)) return 'the J3 arm executes but does not author or release the method';
    return undefined;
  });

  const guide = check.track(await createRootAgent(host.ctx, home.workspace));
  check.require('the live Guide uses the configured real DeepSeek model',
    guide.options.provider === EXPECTED_PROVIDER && guide.options.model === EXPECTED_MODEL, guide.options);
  const prepared = jsonOf(await host.ctx.tools.execute({ callId: 'j3-hima-prepare' as never,
    name: 'hima_prepare', arguments: { pack: PACK_ID, site: SITE_NAME }, agent: guide,
    signal: AbortSignal.timeout(30_000) }));
  check.require('HimaGuide produced one ready one-generation proposal',
    prepared.ready === true && prepared.pack?.id === PACK_ID && prepared.site?.name === SITE_NAME
      && prepared.budget?.generations?.value === 1 && prepared.unknowns?.length === 0,
    { ready: prepared.ready, pack: prepared.pack, site: prepared.site, budget: prepared.budget,
      unknowns: prepared.unknowns, campaignFile: prepared.campaignFile });
  const started = jsonOf(await host.ctx.tools.execute({ callId: 'j3-hima-confirm' as never,
    name: 'hima_run', arguments: { proposalId: prepared.id, pack: PACK_ID, site: SITE_NAME,
      goal: prepared.goal, strategy: prepared.strategy }, agent: guide, signal: AbortSignal.timeout(30_000) }));
  assert.equal(started.kind, 'ran', JSON.stringify(started));
  const runId = String(started.runId);
  const ownerId = String(started.context.run.control.owner);
  const owner = host.ctx.get('agents')?.get(ownerId as never);
  assert.ok(owner, 'the confirmed Campaign owner session must be live');
  check.track(owner);
  check.require('Guide confirmation created one distinct persistent Campaign owner',
    ownerId !== String(guide.id) && host.ctx.hima.ledger.run(runId)?.control?.guideSessionId === String(guide.id),
    { guide: String(guide.id), owner: ownerId, runId });
  check.observed.realEdaRequested = true;
  check.observed.runId = runId;
  check.observed.guide = String(guide.id);
  check.observed.owner = ownerId;
  check.observed.bindingFile = { path: bindingFile, sha256: sha256(readFileSync(bindingFile)) };

  check.beforeDispose(async () => {
    const run = host.ctx.hima.ledger.run(runId);
    if (run && active(run)) {
      check.observed.cleanup = await host.ctx.hima.cancelRun(runId);
    }
  });

  await check.wait(owner.whenIdle());
  const executionPrompt = [
    `Continue only the already confirmed Run ${runId}. You are its sole Campaign owner; never create another Run or another Agent.`,
    'Use hima_context and hima_execute for every graph action. Begin, work and complete only current authorized nodes; asynchronous commercial Jobs must settle from native facts before completion. Preserve every failure and do not use shell, raw terminal, replay or another method.',
    'At plan-fix, use the Pack workshop: read the current closure state, history and declared knowledge, then author and execute the exact fix-plan entry through controlled Hima workshop operations. For this one-generation qualified Operator surface, choose exactly one high-effort hold-buffer action with finite targets/margins only if the measured baseline supports it; do not copy a plan from another Run.',
    'At run-xtop-fix, begin the node with hima_execute, then use hima_interactive on that exact execution. Open the qualified session; issue typed hima_operator_identity; typed hima_summary setup and hold; read the owner-authored fix plan; issue exactly one typed hima_fix_hold using its effort, hold target and setup margin; issue typed hima_save_candidate; issue typed hima_close; then close/observe the protocol and complete the node only after the process exited and the Pack finalizer produced the XTop stage evidence. Never send raw Tcl.',
    'Continue through Innovus apply, fresh two-corner StarRC, four-scenario PrimeTime, summarize, compare-and-retain and the evidence gate. The fixed Goal is setup and hold WNS >= 0. If timing remains open, follow the graph to blocked and stop truthfully; one generation is the complete authorized study budget. XTop exit or internal estimates are not the business verdict.',
  ].join('\n');
  await check.say(owner, executionPrompt);

  for (let cycle = 0; cycle < 80; cycle += 1) {
    await check.wait(owner.whenIdle());
    const run = host.ctx.hima.ledger.run(runId);
    const context = host.ctx.hima.executionContext(runId);
    if (!run) throw new Error('the Hima arm Run disappeared');
    if (terminal(run) || (run.status === 'waiting' && run.currentNode === 'blocked')) break;
    const failed = context.executions.filter((execution) => !execution.supersededBy
      && ['failed', 'uncertain'].includes(execution.phase));
    if (failed.length > 0) throw new Error(`the Hima arm retained a failed/uncertain execution: ${JSON.stringify(failed)}`);
    const working = context.executions.find((execution) => execution.phase === 'working');
    if (working) {
      if (working.nodeId === 'run-xtop-fix') {
        await check.say(owner, `Run ${runId} is at the qualified interactive execution ${working.id}. Continue its typed hima_interactive sequence from current Host facts, save and close once, then complete only from finalized evidence.`);
      } else {
        await check.until(`commercial execution ${working.id} settles`, () => {
          const latest = host.ctx.hima.executionContext(runId).executions.find((execution) => execution.id === working.id);
          return latest?.phase !== 'working';
        }, Math.max(1, check.deadline - Date.now() - 5_000));
      }
      continue;
    }
    await check.say(owner, `Continue only Run ${runId} from current hima_context. Complete ready facts, then begin/work the next authorized reference node. Preserve negative evidence; at the qualified XTop node use only the typed interactive sequence already specified. Stop at ended status or the declared blocked node.`);
  }

  const finalRun = host.ctx.hima.ledger.run(runId)!;
  const finalContext = host.ctx.hima.executionContext(runId);
  const records = host.ctx.hima.ledger.records({ runId });
  const current = currentRecordsIn(records);
  const completedNodes = new Set(current.filter((record): record is NodeRecord => record.type === 'node' && record.state === 'done').map((record) => record.nodeId));
  const requiredNodes = ['prepare', 'read-preparation', 'export-baseline', 'read-baseline-export', 'extract-baseline',
    'read-baseline-extraction', 'analyze-baseline', 'read-baseline-timing', 'summarize-baseline', 'read-baseline-state',
    'plan-fix', 'read-fix-plan', 'run-xtop-fix', 'read-xtop', 'apply-eco', 'read-innovus', 'extract-after',
    'read-after-extraction', 'analyze-after', 'read-after-timing', 'summarize-after', 'read-after-state',
    'compare-and-retain', 'read-iteration-result', 'evidence-gate'];
  check.require('the real owner completed the entire one-generation commercial reference chain',
    requiredNodes.every((node) => completedNodes.has(node)),
    { missing: requiredNodes.filter((node) => !completedNodes.has(node)), completed: [...completedNodes] });
  check.require('the one-generation arm stopped honestly at the Pack blocker because timing is not closed',
    finalRun.status === 'waiting' && finalRun.currentNode === 'blocked' && finalRun.generation === 1,
    { status: finalRun.status, node: finalRun.currentNode, generation: finalRun.generation });

  const observation = current.findLast((record): record is ObservationRecord => record.type === 'observation'
    && record.reader.id === 'xtop-iteration-result');
  const values = new Map(observation?.values.map((value) => [value.type, value.value]));
  check.require('fresh Hima evidence adopted the same qualified engineering result as the control arm',
    observation !== undefined
      && values.get('xtop_iteration_evidence_valid') === 1
      && values.get('xtop_setup_wns') === -0.04
      && values.get('xtop_hold_wns') === -0.15
      && values.get('xtop_hold_violations') === 196
      && values.get('xtop_closure_score') === 217.96,
    { observation: observation?.id, values: Object.fromEntries(values) });
  const verdicts = current.filter((record): record is VerdictRecord => record.type === 'verdict'
    && ['xtop-iteration-evidence-valid', 'xtop-setup-clean', 'xtop-hold-clean'].includes(record.ruleId));
  check.require('the evidence gate separated valid adoption from unmet setup/hold goals',
    verdicts.some((record) => record.ruleId === 'xtop-iteration-evidence-valid' && record.outcome === 'PASS')
      && verdicts.some((record) => record.ruleId === 'xtop-setup-clean' && record.outcome === 'FAIL')
      && verdicts.some((record) => record.ruleId === 'xtop-hold-clean' && record.outcome === 'FAIL'), verdicts);

  const launched = records.filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
  const interactiveJobs = launched.filter((record) => record.nodeId === 'run-xtop-fix');
  const interactive = records.filter((record) => record.type === 'interactive');
  check.require('one qualified interactive Job retained typed command and normal-close receipts',
    interactiveJobs.length === 1
      && interactive.some((record) => record.event === 'opened')
      && interactive.filter((record) => record.event.includes('command')).length >= 5
      && interactive.some((record) => record.event.includes('closed') || record.event.includes('close')),
    { interactiveJob: interactiveJobs, events: interactive.map((record) => record.event) });
  check.require('the Campaign has no unsettled execution or unaccounted live Job',
    finalContext.executions.every((execution) => execution.phase !== 'working' && execution.phase !== 'uncertain'),
    finalContext.executions);
  check.require('the installed and source Pack identities remained unchanged through the arm',
    loadPack(packsDirOf(home), PACK_ID).folder.digest(packDigestExcludes) === sourceDigest
      && loadPack(path.join(repoRoot, 'packs'), PACK_ID).folder.digest(packDigestExcludes) === sourceDigest,
    { expected: sourceDigest, installed: loadPack(packsDirOf(home), PACK_ID).folder.digest(packDigestExcludes) });

  check.observed.outcome = 'INCONCLUSIVE — engineering result matches control and evidence is complete, but human-minute savings are not measured precisely enough for a positive value claim';
  check.observed.final = { run: finalRun, observation: observation?.id, values: Object.fromEntries(values),
    jobsLaunched: launched.length, interactiveEvents: interactive.map((record) => record.event),
    modelSessions: [...check.requestSessions], modelRequestSteps: check.steps, userMessages: check.turns };
});
