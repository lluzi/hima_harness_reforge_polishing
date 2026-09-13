// @hima-seam tools direct
// Opt-in bounded V4 Flash author / execution checks using the installed product Host.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { loadPack, packDigestOf, packStage } from '@hima/harness';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { bootInProcess, createRootAgent } from '../test/contract/support/boot-inprocess.ts';
import { installPack, packsDirOf } from '../test/contract/support/pack.ts';
import { prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';
import { guardInstalled, runLive, sha256 } from './live-check-workshop.ts';

const id = 'aes-tsmc28-dtco';
const phase = process.env.HIMA_AES_PHASE ?? 'author';
if (!['author', 'execute'].includes(phase)) throw new Error('HIMA_AES_PHASE must be author or execute');
const stagingFile = process.env.HIMA_AES_STAGING;
if (!stagingFile) throw new Error('HIMA_AES_STAGING must name the verified Site staging receipt');
const staging = JSON.parse(readFileSync(stagingFile, 'utf8')) as { root: string; files: Record<string, string> };

await runLive('live-check-aes-probe', 12, async (check) => {
  const h = await createHimaHome(); check.home = h;
  await prepareHimaHome({ home: h.home, bundleMode: 'installed' });
  await installPack(h);
  const bundle = realpathSync(path.join(h.profileDir, 'node_modules/@hima/harness'));
  const golden = path.join(h.home, 'aes-golden');
  cpSync(path.join(repoRoot, 'packs', id, 'flow'), golden, { recursive: true });
  const workspaceRoot = '/data/eda/project/hima_harness/polishing-runs';
  const sites = path.join(h.home, 'hima/sites'); mkdirSync(sites, { recursive: true });
  writeFileSync(path.join(sites, 'linglong-aes.yml'), stringify({
    name: 'linglong-aes', kind: 'ssh', workspaceRoot, permit: './linglong-aes.permit.yml',
    bindings: { flowRoot: staging.root, design: 'aes_cipher_top', workspaceRoot },
    ssh: { destination: 'luzi@192.168.50.41', jumps: [], controlPersistSeconds: 60 },
    capacity: { cores: 8, memoryGiB: 16, parallelJobs: 1, licences: { 'Design-Compiler': 1 } },
  }));
  writeFileSync(path.join(sites, 'linglong-aes.permit.yml'), stringify({
    allowedReadRoots: ['/data/eda/project'], allowedWriteRoots: [workspaceRoot],
    allowedWrappers: ['/usr/bin/python3', '/usr/local/bin/eda'],
    forbidden: ['services', 'licence-servers', 'network-settings', 'deletions', 'repository-downloads'],
  }));
  writeFileSync(homePatchFile(h.home), '- id: session-title-llm\n  disabled: true\n');
  process.chdir(h.workspace);
  const folder = path.join(packsDirOf(h), id);
  if (phase === 'execute') cpSync(path.join(repoRoot, 'packs', id), folder, { recursive: true });
  const host = await bootInProcess(h); check.attach(host);
  const chat = check.track(await createRootAgent(host.ctx, h.workspace));
  const opened = await host.ctx.tools.execute({ name: 'hima_author', arguments: { pack: id, create: phase === 'author' }, agent: chat, callId: 'aes-author-open' as never, signal: AbortSignal.timeout(20_000) });
  if (opened.isError) throw new Error('native hima_author refused: ' + JSON.stringify(opened));
  const sessionId = (opened as unknown as { value: { sessionId: string } }).value.sessionId;
  const author = check.track(host.ctx.agents.get(sessionId as never)!);
  if (phase === 'author') cpSync(golden, path.join(folder, 'flow'), { recursive: true });
  guardInstalled(check, host, [bundle, packsDirOf(h), golden, h.workspace], folder);
  check.observed.phase = phase;
  check.observed.realEdaRequested = phase === 'execute';
  check.observed.packFolder = folder;
  check.observed.staging = staging;
  check.observed.owner = String(author.id);
  check.observed.resources = { maxSynthesisJobs: 2, parallelJobs: 1, coresPerJob: 8, toolDeadlineSeconds: 600, model: 'deepseek-v4-flash' };

  if (phase === 'author') {
    const facts = `Author a foundry-only AES Fmax probe, Pack ${id} version 1. The approved Golden Flow is ${golden}; read README.md, probe.py, synth.tcl and read-probe.py there. Keep these reference files and the existing flow/ copy unchanged. They are method source already supplied by the author, not files you generated.
The Site is linglong-aes. It binds a separately staged flowRoot, design=aes_cipher_top and workspaceRoot; no customer paths or credentials belong in this Pack. Copy exactly probe.py,synth.tcl,read-probe.py,inputs.json from flowRoot. inputs.json is Site-private and must not be authored or added to the Pack.
One tool runs /usr/bin/python3 \${WORKSPACE}/flow/probe.py --workspace \${WORKSPACE} --period \${PERIOD_NS}, with inputs WORKSPACE,PERIOD_NS, one Design-Compiler licence. Tool wrapper and reader wrapper are /usr/bin/python3. The human-facing tool file documents/implements the same command. The reader script is an exact copy of Golden Flow read-probe.py in tools/ and argv is /usr/bin/python3 \${READER} \${REPORT} \${OUT}. Output probe at flow/probe.json uses that reader. Also declare timingManifest at flow/probe.json (unparsed), for evidence access. It names immutable timing reports/netlists with hashes for subsequent analysis.
Reader emits existing clock_period (ns), setup_wns (ns,mode setup,scope all), cell_area (um2); don't invent renamed semantics. Goal target_period_ns numeric ns bounds0.1..5 default0.5; strategy periodNs numeric ns bounds0.1..5 default0.35 precision3. Use actual schema for precision; consult installed anatomy and reference opene902 Pack.
Graph synthesize(tool)→read-probe(observes probe)→judge(rules setup-wns-all-nonnegative then clock-period-at-most, bind target_period_ns from Goal)→next-period(explore)→synthesize(revisit); both Judge PASS and FAIL go to next-period. Include one hard-blocker wait. Copy/reference the opene902 over-constraining-push chooser with stepNs=0.01; convergence read period, band0.005, generations1,generationLimit2. Only both actual current verdicts PASS allow explicit goal-met. Convergence/ended-budget is an honest negative or incomplete result, never performance success. No Workshop in this initial probe version; PLS09 adds AI-written analysis later. Domain knowledge explains zero slack, actual versus estimated period, matching conditions, report hashes, constraints, and finite timing/netlist samples.
Use the five-stage authoring workflow. All business questions above are answered. First write INTENT.md via /hima-grill, then SPEC.md via /hima-spec, then compile via /hima-fabric. For this phase do NOT run any Campaign or release. No shell, external Agent, network command or alternate model. Native tools and ordinary scoped file tools only. Existing approved command/reader scripts are authorized within the private Campaign; no further approval is needed for copying their exact behavior. If the specification has a concrete inconsistency, identify it. No invented outputs.`;
    check.observed.approvedBusiness = { text: facts, sha256: sha256(facts) };
    await check.say(author, '/hima-grill\n' + facts);
    check.require('author recorded intent', existsSync(path.join(folder, 'INTENT.md')), packStage(folder));
    if (packStage(folder).stage === 'intent') await check.say(author, '/hima-spec Compile the confirmed intent into SPEC.md only. Golden Flow is already readable. No Site jobs in this author phase.');
    check.require('author recorded specification', ['specified', 'compiled'].includes(packStage(folder).stage), packStage(folder));
    if (packStage(folder).stage !== 'compiled') await check.say(author, '/hima-fabric Compile SPEC.md into the Pack. Check the schema and approved behavior using hima_pack_check on linglong-aes. Finish FABRIC.md. Do not run or release.');
    for (let i = 0; i < 2 && packStage(folder).stage !== 'compiled'; i++) {
      await check.say(author, 'Finish compilation using the actual check feedback. Preserve approved business semantics and the existing flow/ source bytes; exact reader/tool copying is authorized. Do not start a Run.');
    }
    check.require('authored Pack compiled', packStage(folder).stage === 'compiled', packStage(folder));
    const pack = loadPack(packsDirOf(h), id);
    check.require('probe method has no hidden research or automatic driver', pack.contract.workshops.length === 0 && pack.graph.nodes.some(n => n.kind === 'explore'), pack.graph);
    check.require('author phase launched no Site jobs', host.ctx.hima.ledger.runs().length === 0, host.ctx.hima.ledger.runs());
  } else {
    check.observed.methodBeforeTest = packDigestOf(folder);
    await check.say(author, `/hima-test Test ${id} on linglong-aes with Goal target_period_ns=0.5, strategy periodNs=0.35, generations=2, retries=1, timeBox=12. This authoring conversation owns and executes every node through hima_run and hima_execute. No automatic driver or other Agent. Use actual current facts and references, complete only ready nodes, explicitly decide at Explore. Max two DC synthesis jobs, each tool has a600-second deadline. While a Job runs, finish the response to allow progress notifications; do not busy-poll. Retain failed and negative results. When the Run ends write TEST.md from hima_status with exact standalone run/status lines; preserve all method bytes. Do not claim closed Fmax for a failing constraint or an estimated period.`);
    for (let i = 0; i < 5 && !existsSync(path.join(folder, 'TEST.md')); i++) {
      // Only request a fresh model turn after a real job settles or a ready node awaits action.
      await check.until('job or node facts ready for the owner', () => {
        const r = host.ctx.hima.ledger.runs().find(r => r.packId === id);
        if (!r) return true;
        return !host.ctx.hima.executionContext(r.id).executions.some(e => e.phase === 'working');
      }, 620_000);
      await check.say(author, 'Continue the already authorized Run from its actual context. Do not create another Run. If it ended, write TEST.md from recorded facts with standalone run/status lines. Preserve method files.');
    }
    check.require('actual test record exists', existsSync(path.join(folder, 'TEST.md')), packStage(folder));
    check.require('test preserved method digest', packDigestOf(folder) === check.observed.methodBeforeTest, packDigestOf(folder));
    const runs = host.ctx.hima.ledger.runs().filter(r => r.packId === id);
    check.require('exactly one native owned test Run', runs.length === 1 && runs[0]?.control?.owner === String(author.id), runs);
    const rows = host.ctx.hima.ledger.records({ runId: runs[0]!.id });
    check.require('actual probe produced an observation', rows.some(r => r.type === 'observation'), rows.filter(r => r.type === 'observation'));
    await check.say(author, '/hima-release Release this tested method through the native release tool; no manual VERSION.yml, no method changes. Preserve any negative or budget ending honestly.');
    check.require('native release sealed the method', packStage(folder).stage === 'released', packStage(folder));
  }
  check.observed.methodDigest = packDigestOf(folder);
  cpSync(folder, path.join(check.out, 'pack'), { recursive: true });
});
