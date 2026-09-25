import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const evidenceAt = args.indexOf('--evidence');
const outAt = args.indexOf('--out');
if (evidenceAt < 0 || outAt < 0 || !args[evidenceAt + 1] || !args[outAt + 1]) {
  throw new Error('usage: node scripts/verify-xtop-hima-arm-evidence.ts --evidence ABSOLUTE_JSON --out ABSOLUTE_JSON');
}
const evidenceFile = realpathSync(args[evidenceAt + 1]!);
const outputFile = path.resolve(args[outAt + 1]!);
assert.ok(path.isAbsolute(evidenceFile) && lstatSync(evidenceFile).isFile() && !lstatSync(evidenceFile).isSymbolicLink(),
  'evidence must be one plain absolute file');
assert.ok(path.isAbsolute(outputFile), 'output must be absolute');
const bytes = readFileSync(evidenceFile);
const evidenceSha256 = createHash('sha256').update(bytes).digest('hex');
const evidence = JSON.parse(bytes.toString('utf8')) as Record<string, any>;
assert.equal(evidence.check, 'live-check-xtop-hima-arm');
assert.equal(evidence.runs?.length, 1, 'exactly one Hima Run is required');
const row = evidence.runs[0];
const run = row.run;
const records = row.records as Record<string, any>[];
assert.equal(run.packId, 'xtop-timing-closure');
assert.equal(run.packDigest, '19207d78dc3b1e9f4fd80f6bd4c21df209f1dfffc5f83fa7afd3ac5c96fd2a92');
assert.equal(run.status, 'ended-budget-exhausted');
assert.equal(run.currentNode, 'next-iteration');
assert.equal(run.generation, 1);
assert.equal(run.meters?.endedBy, 'generation-limit');
assert.equal(run.budget?.generationLimit, 1);
assert.notEqual(run.control?.owner, run.control?.guideSessionId);

const requiredNodes = ['prepare', 'read-preparation', 'export-baseline', 'read-baseline-export', 'extract-baseline',
  'read-baseline-extraction', 'analyze-baseline', 'read-baseline-timing', 'summarize-baseline', 'read-baseline-state',
  'plan-fix', 'read-fix-plan', 'run-xtop-fix', 'read-xtop', 'apply-eco', 'read-innovus', 'extract-after',
  'read-after-extraction', 'analyze-after', 'read-after-timing', 'summarize-after', 'read-after-state',
  'compare-and-retain', 'read-iteration-result', 'evidence-gate', 'read-best-database', 'next-iteration'];
const done = new Set(records.filter((record) => record.type === 'node' && record.state === 'done').map((record) => record.nodeId));
assert.deepEqual(requiredNodes.filter((node) => !done.has(node)), [], 'the reference chain is incomplete');

const result = records.findLast((record) => record.type === 'observation'
  && record.reader?.id === 'xtop-iteration-result');
assert.ok(result, 'the iteration result observation is absent');
const values = new Map(result.values.map((value: Record<string, unknown>) => [value.type, value.value]));
assert.equal(values.get('xtop_iteration_evidence_valid'), 1);
assert.equal(values.get('xtop_setup_wns'), -0.04);
assert.equal(values.get('xtop_setup_tns'), -0.12);
assert.equal(values.get('xtop_setup_violations'), 12);
assert.equal(values.get('xtop_hold_wns'), -0.15);
assert.equal(values.get('xtop_hold_tns'), -8.34);
assert.equal(values.get('xtop_hold_violations'), 196);
assert.equal(values.get('xtop_closure_score'), 217.96);

const verdict = (ruleId: string) => records.findLast((record) => record.type === 'verdict' && record.ruleId === ruleId);
assert.equal(verdict('xtop-iteration-evidence-valid')?.outcome, 'PASS');
assert.equal(verdict('xtop-setup-clean')?.outcome, 'FAIL');
assert.equal(verdict('xtop-hold-clean')?.outcome, 'FAIL');
const best = records.findLast((record) => record.type === 'observation' && record.reader?.id === 'xtop-best-database');
assert.ok(best, 'the adopted best-database observation is absent');

const interactive = records.filter((record) => record.type === 'interactive');
assert.equal(interactive.filter((record) => record.event === 'open-intent').length, 1);
assert.equal(interactive.filter((record) => record.event === 'opened').length, 1);
assert.equal(interactive.find((record) => record.event === 'opened')?.payload?.readiness, 'ready');
assert.ok(interactive.filter((record) => record.event === 'command-completed').length >= 6);
assert.ok(interactive.some((record) => record.event === 'closed'));
const interactiveJobs = records.filter((record) => record.type === 'job' && record.event === 'launched'
  && record.nodeId === 'run-xtop-fix');
assert.equal(interactiveJobs.length, 1);

const executions = Object.values(run.control?.executions ?? {}) as Record<string, any>[];
assert.ok(executions.every((execution) => !['working', 'uncertain'].includes(execution.phase)),
  'the terminal Run retains a working or uncertain execution');
assert.equal(evidence.observed?.secretScan?.holding?.length, 0);
assert.equal(evidence.observed?.secretScan?.unreadable?.length, 0);
assert.ok(evidence.checks?.some((check: Record<string, unknown>) => check.claim === 'the real owner completed the entire one-generation commercial reference chain' && check.passed === true));
assert.match(String(evidence.failure), /one-generation arm stopped honestly/,
  'the source LiveCheck must have failed only on the superseded terminal-state assertion');

const verified = {
  schema: 'hima.xtop-hima-arm-post-verification/1',
  status: 'passed',
  sourceEvidence: { path: evidenceFile, sha256: evidenceSha256 },
  run: { id: run.id, status: run.status, generation: run.generation, endedBy: run.meters.endedBy,
    packDigest: run.packDigest, jobsLaunched: run.meters.jobsLaunched, licenceMs: run.meters.licenceMs },
  result: Object.fromEntries(values),
  verdicts: { evidenceValid: 'PASS', setupClean: 'FAIL', holdClean: 'FAIL' },
  interactive: { jobCount: interactiveJobs.length,
    events: interactive.map((record) => ({ seq: record.seq, event: record.event,
      commandId: record.payload?.commandId })) },
  conclusion: 'INCONCLUSIVE: engineering adoption matches the control result and the evidence chain is complete; precise human-minute savings were not measured.',
};
writeFileSync(outputFile, `${JSON.stringify(verified, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
process.stdout.write(`${JSON.stringify({ status: verified.status, output: outputFile, runId: run.id })}\n`);
