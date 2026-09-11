// Step-1 acceptance run (issue #8): the whole trust chain against the real opene902 reports on the
// reference site, from a booted DeepSeek Harness host, compared to the site's handoff metrics, and
// re-read after a host restart. Writes docs/validation/<date>-step1-acceptance.{md,json}.
// Read-only on the site: the channel's audit lists every remote command and it is included in the record.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { bootInProcess } from '../test/contract/support/boot-inprocess.ts';
import { himaCommand } from '../test/contract/support/command.ts';
import { installReferenceSite } from '../test/contract/support/site.ts';
import { bootHimaHost } from '../test/contract/support/boot-host.ts';
import { api as himaApi, openSession, postObserve } from '../test/contract/support/hima-api.ts';
import { remoteCommands } from '@hima/harness';
// The run view is the bundle's contract, read here exactly as the browser module reads it.
import type { RunView } from '@hima/harness';

const SITE = 'linglong';
const RPT = '/data/eda/project/design_zoo/pr/opene902/foundation/RPT';
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'test/fixtures/opene902.manifest.json'), 'utf8'));
const hostVersion = JSON.parse(readFileSync(path.join(repoRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version as string;
const date = new Date().toLocaleDateString('en-CA'); // local calendar date, YYYY-MM-DD
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x);

try {
  execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'luzi@192.168.50.41', 'true'], { stdio: 'ignore' });
} catch {
  console.error('reference site unreachable (LAN only); acceptance not run');
  process.exit(2);
}

// `timingRun` is the in-process section's shape: the setup summary opens one Run and the hold summary
// is appended to it with `--run`, so a single Run holds both readings and all three rules are judged
// against it at once — a Run spanning several observations, which is what a fabric Loop needs (D36).
// `judge`/`expectOutcomes` are the workbench section's shape, which stays one Run per observation:
// that is what a browser caller does today, and both shapes must keep working.
const steps = [
  { name: 'setup summary', file: `${RPT}/postroute.summary.gz`, reader: 'innovus-timing-summary', timingRun: 'open', judge: 'setup-wns-all-nonnegative,setup-wns-reg2reg-nonnegative', expectOutcomes: { 'setup-wns-all-nonnegative': 'FAIL', 'setup-wns-reg2reg-nonnegative': 'PASS' } },
  { name: 'hold summary', file: `${RPT}/postroute_hold.summary.gz`, reader: 'innovus-timing-summary', timingRun: 'join', judge: 'hold-wns-all-nonnegative', expectOutcomes: { 'hold-wns-all-nonnegative': 'PASS' } },
  { name: 'DRC report', file: `${RPT}/verify_drc.postroute.rpt`, reader: 'innovus-verify-drc', timingRun: 'own', judge: '', expectOutcomes: {} },
] as const;

/** The three shipped rules, judged together against the one Run that holds both timing summaries. */
const timingRules = 'setup-wns-all-nonnegative,setup-wns-reg2reg-nonnegative,hold-wns-all-nonnegative';
const expectJudgement: Record<string, { outcome: string; citesStep: string }> = {
  'setup-wns-all-nonnegative': { outcome: 'FAIL', citesStep: 'setup summary' },
  'setup-wns-reg2reg-nonnegative': { outcome: 'PASS', citesStep: 'setup summary' },
  'hold-wns-all-nonnegative': { outcome: 'PASS', citesStep: 'hold summary' },
};
const expectValues: Record<string, number> = {
  'setup_wns|setup|all': manifest.handoffMetrics.setup_wns_all_ns,
  'setup_wns|setup|reg2reg': manifest.handoffMetrics.setup_wns_r2r_ns,
  'setup_tns|setup|all': manifest.handoffMetrics.setup_tns_ns,
  'hold_wns|hold|all': manifest.handoffMetrics.hold_wns_ns,
  'placement_density||': manifest.handoffMetrics.density_pct,
  'drc_violation_count||': manifest.handoffMetrics.drc,
};

const h = await createHimaHome();
await installReferenceSite(h);
const findings: string[] = [];
const record: Record<string, unknown> = { date, dshVersion: hostVersion, site: SITE, steps: [] as unknown[] };

let host = await bootInProcess(h);
const runIds: string[] = [];
/** The Run both timing summaries are observed into, and the observation id each step produced. */
let timingRunId: string | undefined;
const observationOfStep = new Map<string, string>();
for (const s of steps) {
  if (s.timingRun === 'join' && !timingRunId) { findings.push(`${s.name}: no timing run to join; the setup summary did not open one`); continue; }
  const into = s.timingRun === 'join' ? ` --run ${timingRunId!}` : '';
  const line = `/hima observe ${SITE} ${s.file} --reader ${s.reader}${into}`;
  const { kind, text, runId } = await himaCommand(host, h.workspace, line, 120_000);
  if (kind !== 'success' || !runId) { findings.push(`${s.name}: command failed: ${text}`); continue; }
  if (s.timingRun === 'join' && runId !== timingRunId) findings.push(`${s.name}: --run ${timingRunId!} was answered with run ${runId}`);
  if (s.timingRun === 'open') timingRunId = runId;
  if (!runIds.includes(runId)) runIds.push(runId);
  const obs = host.ctx.hima.ledger.records({ runId, type: 'observation' });
  // This step's own observation is the one it just appended: the last record of its run.
  const o = obs[obs.length - 1];
  const stepRec: Record<string, unknown> = { name: s.name, command: line, runId, observation: o };
  if (!o || o.type !== 'observation') { findings.push(`${s.name}: no observation`); (record.steps as unknown[]).push(stepRec); continue; }
  observationOfStep.set(s.name, o.id);
  const expectedHash = manifest.files[path.basename(s.file)];
  if (o.contentSha256 !== expectedHash) findings.push(`${s.name}: content hash ${o.contentSha256} differs from local copy ${expectedHash}`);
  for (const v of o.values as { type: string; mode?: string; scope?: string; value: number | null; unit: string }[]) {
    const key = `${v.type}|${v.mode ?? ''}|${v.scope ?? ''}`;
    if (key in expectValues && v.value !== expectValues[key]) findings.push(`${s.name}: ${key} read ${v.value} ${v.unit}, handoff says ${expectValues[key]}`);
  }
  (record.steps as unknown[]).push(stepRec);
}

// One judgement over the one Run that now holds both timing summaries: three rules, three verdicts,
// each citing whichever of the two observations carried the value it needed.
let judgementCommand = '';
let judgementVerdicts: unknown[] = [];
if (!timingRunId) findings.push('no timing run was opened; the three rules were not judged');
else {
  judgementCommand = `/hima judge ${timingRunId} --rules ${timingRules}`;
  const judged = await himaCommand(host, h.workspace, judgementCommand, 120_000);
  if (judged.kind !== 'success') findings.push(`judgement: command failed: ${judged.text}`);
  judgementVerdicts = host.ctx.hima.ledger.records({ runId: timingRunId, type: 'verdict' });
  const seq = host.ctx.hima.ledger.records({ runId: timingRunId }).map((r) => r.seq);
  if (seq.join(',') !== [...seq].sort((a, b) => a - b).join(',')) findings.push('judgement: the run\'s records are not in sequence order');
  for (const [rule, want] of Object.entries(expectJudgement)) {
    const vv = judgementVerdicts.find((x) => (x as { ruleId?: string }).ruleId === rule) as { outcome?: string; cites?: string[] } | undefined;
    const cited = observationOfStep.get(want.citesStep);
    if (!vv) findings.push(`judgement: no verdict for ${rule}`);
    else if (vv.outcome !== want.outcome) findings.push(`judgement: ${rule} was ${vv.outcome}, expected ${want.outcome}`);
    else if (!cited || !vv.cites?.includes(cited)) findings.push(`judgement: ${rule} does not cite the ${want.citesStep} observation ${cited ?? '(none)'}`);
  }
}
record.judgement = { runId: timingRunId ?? null, command: judgementCommand, verdicts: judgementVerdicts };
const before = runIds.map((id) => ({ run: host.ctx.hima.ledger.run(id), records: host.ctx.hima.ledger.records({ runId: id }) }));
await host.dispose();

host = await bootInProcess(h);
const after = runIds.map((id) => ({ run: host.ctx.hima.ledger.run(id), records: host.ctx.hima.ledger.records({ runId: id }) }));
const restartOk = canonical(before) === canonical(after);
if (!restartOk) findings.push('records changed across a host restart');
await host.dispose();
await h.dispose();


// ---- Workbench: the same chain through the real web profile and the Hima namespace (#7) ----
const wbHome = await createHimaHome();
await installReferenceSite(wbHome);
let web = await bootHimaHost(wbHome);
let cookie = await openSession(web);
const api = (target: string, init: RequestInit = {}) => himaApi(web, cookie, target, init);
const wbSteps: { name: string; runId: string; verdicts: RunView['verdicts']; observationHash?: string }[] = [];
for (const s of steps) {
  const res = await postObserve(web, cookie, { site: SITE, path: s.file, reader: s.reader, ...(s.judge ? { judge: s.judge.split(',') } : {}) });
  if (res.status !== 200) { findings.push(`workbench ${s.name}: POST observe answered ${res.status}: ${await res.text()}`); continue; }
  const view = (await res.json()) as RunView;
  const o = view.observations[0];
  wbSteps.push({ name: s.name, runId: view.run.id, verdicts: view.verdicts, observationHash: o?.contentSha256 });
  if (!o) findings.push(`workbench ${s.name}: no observation in the run view`);
  else if (o.contentSha256 !== manifest.files[path.basename(s.file)]) findings.push(`workbench ${s.name}: hash ${o.contentSha256} differs from local copy`);
  for (const [rule, outcome] of Object.entries(s.expectOutcomes)) {
    const v = view.verdicts.find((x) => x.ruleId === rule);
    if (!v) findings.push(`workbench ${s.name}: no verdict for ${rule}`);
    else if (v.outcome !== outcome) findings.push(`workbench ${s.name}: ${rule} was ${v.outcome}, expected ${outcome}`);
    else if (!o || !v.cites.some((c) => c.recordId === o.recordId)) findings.push(`workbench ${s.name}: ${rule} does not cite the observation`);
  }
}
// The Hima browser module is discovered by the host and served in the loader envelope.
const indexHtml = await (await api('/')).text();
const bootMatch = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/.exec(indexHtml);
let bundleUrl = ''; let bundleStatus = 0; let bundleEnvelope = false;
if (!bootMatch) findings.push('workbench: no __DSH_BOOT__ payload in the served index');
else {
  const bootText = bootMatch[1]!;
  const urlMatch = /"(\/plugins\/[^"]*hima[^"]*)"/.exec(bootText) ?? /"(\/plugins\/[^"]+)"/.exec(bootText);
  if (!urlMatch) findings.push('workbench: no Hima client module in the boot payload');
  else {
    bundleUrl = urlMatch[1]!;
    const b = await api(bundleUrl); bundleStatus = b.status;
    const src = await b.text(); bundleEnvelope = /window\.__ModuleLoader__\.load\(\{/.test(src) && src.includes('@hima/harness');
    if (b.status !== 200 || !bundleEnvelope) findings.push(`workbench: client bundle ${bundleUrl} answered ${b.status}, envelope=${bundleEnvelope}`);
  }
}
const viewsBefore = await Promise.all(wbSteps.map(async (w) => (await api(`/hima/api/runs/${w.runId}`)).json()));
const stopCode = await web.stop();
if (stopCode !== 0) findings.push(`workbench host exited ${stopCode} on SIGTERM`);
web = await bootHimaHost(wbHome); cookie = await openSession(web);
const viewsAfter = await Promise.all(wbSteps.map(async (w) => (await api(`/hima/api/runs/${w.runId}`)).json()));
const wbRestartOk = canonical(viewsBefore) === canonical(viewsAfter);
if (!wbRestartOk) findings.push('workbench: run views changed across a host restart');
await web.stop(); await wbHome.dispose();
record.workbench = { steps: wbSteps, clientBundle: { url: bundleUrl, status: bundleStatus, envelope: bundleEnvelope }, restartReadBackUnchanged: wbRestartOk };

const remote = remoteCommands().map((c) => c.wire);
record.remoteCommands = remote;
record.restartReadBackUnchanged = restartOk;
record.findings = findings;
record.handoffMetrics = manifest.handoffMetrics;

const outDir = path.join(repoRoot, 'docs/validation'); mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `${date}-step1-acceptance.json`), JSON.stringify(record, null, 2) + '\n');
const md = [
  `# Step-1 acceptance run, ${date}`, '',
  `Site: \`${SITE}\` (luzi@192.168.50.41, LAN). DeepSeek Harness ${hostVersion}. Host booted in-process from the hima profile with every entry active; commands executed against a real agent, no model involved.`, '',
  '## Steps', '',
  ...(record.steps as { name: string; command: string; runId: string; observation?: { id?: string; contentSha256?: string; bytes?: number; values?: unknown[] } }[]).flatMap((s) => [
    `### ${s.name}`, '', '```', s.command, '```', '',
    `Run \`${s.runId}\`; observation \`${s.observation?.id ?? 'none'}\`, sha256 \`${s.observation?.contentSha256 ?? 'none'}\` (${s.observation?.bytes ?? 0} bytes).`, '',
    'Typed values:', '', ...((s.observation?.values ?? []) as { type: string; mode?: string; scope?: string; value: number | null; unit: string; unknownReason?: string }[]).map((v) => `- ${v.type}${v.mode ? ` (${v.mode}` + (v.scope ? `, ${v.scope})` : ')') : ''}: ${v.value === null ? `unknown — ${v.unknownReason}` : `${v.value} ${v.unit}`}`), '',
  ]),
  '## Judgement over the one run holding both timing summaries', '',
  'The setup summary opened the run; the hold summary was appended to it with `--run`, so all three shipped rules are judged against one run, each verdict citing whichever observation carried the value it needed.', '',
  '```', judgementCommand || 'not run', '```', '',
  ...(judgementVerdicts as { ruleId: string; ruleVersion: string; outcome: string; cites: string[] }[]).map((v) => `- ${v.ruleId}@${v.ruleVersion}: **${v.outcome}**, cites ${v.cites.join(', ')}`), '',
  '## Comparison with the site handoff metrics', '',
  `Handoff row for opene902: ${JSON.stringify(manifest.handoffMetrics)}.`, '',
  findings.length ? ['Findings (recorded, nothing relaxed):', '', ...findings.map((f) => `- ${f}`)].join('\n') : 'Every typed value that the handoff table records matches it exactly, and every verdict has its expected outcome and cites its observation.', '',
  `## Restart`, '', restartOk ? 'After disposing the host and booting it again on the same home, every run and record read back unchanged.' : 'Records DIFFERED after restart (see findings).', '',
  '## Workbench (real web profile, Hima namespace)', '',
  ...wbSteps.flatMap((w) => [`- ${w.name}: run \`${w.runId}\`, observation sha256 \`${w.observationHash ?? 'none'}\`` + (w.verdicts.length ? ': ' + w.verdicts.map((v) => `${v.ruleId}@${v.ruleVersion} **${v.outcome}** (cites ${v.cites.map((c) => c.recordId).join(', ')})`).join('; ') : '')]),
  '', `Client module served at \`${bundleUrl || 'not found'}\` with status ${bundleStatus}, loader envelope ${bundleEnvelope ? 'present' : 'absent'}.`, '',
  wbRestartOk ? 'After stopping the web host and booting it again on the same home, every run view read back unchanged.' : 'Run views DIFFERED after restart (see findings).', '',
  '## Remote commands run on the site (all read-only)', '', ...remote.map((w) => `- \`${w}\``), '',
].join('\n');
writeFileSync(path.join(outDir, `${date}-step1-acceptance.md`), md);
console.log(findings.length ? `ACCEPTANCE RUN COMPLETED WITH FINDINGS:\n- ${findings.join('\n- ')}` : 'ACCEPTANCE RUN CLEAN');
console.log(`record: docs/validation/${date}-step1-acceptance.md`);
