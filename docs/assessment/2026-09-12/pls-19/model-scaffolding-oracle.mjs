// Retained deterministic checker probe; run from the repository root. No Host or model.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checkerPath = 'scripts/live-check-workshop.ts';
const before = execFileSync('git', ['show', `59f15f3cfcd778d798055e8adbecc509501ddc40:${checkerPath}`], { encoding: 'utf8' });
const after = readFileSync(checkerPath, 'utf8');
const oracle = (source) => source.slice(source.indexOf('  const launched = records.filter'), source.indexOf("  check.require('same model used all controlled Workshop actions'"));
const execution = (id, generation, phase = 'completed') => {
  const directory = `/fixture/.executions/${id}/research/analysis`;
  return { id, nodeId: 'analyze', generation, phase, jobSession: phase === 'completed' ? `job-${id}` : undefined, workshop: { directory, entryPath: `${directory}/analyze.sh` } };
};
const clean = () => {
  const executions = [{ id: 'prepare', nodeId: 'prepare', generation: 1, phase: 'completed' }, execution('g1', 1), execution('g2', 2)];
  const records = executions.filter((e) => e.nodeId === 'analyze').flatMap((e) => [
    { type: 'job', event: 'launched', generation: e.generation, job: { name: 'workshop-analyze', session: e.jobSession } },
    { type: 'code', path: e.workshop.entryPath, sessionId: 'owner', sha256: sha256('code') },
  ]);
  const run = { generation: 2, createdAt: 'fixed', packDigest: 'method', goal: { minimum: 42 }, budget: { generationLimit: 2, retryAllowance: 2, timeBoxMs: 780000 }, meters: { jobsLaunched: 2, elapsedMs: 100 } };
  return { final: { executions, run }, records, initialRun: { ...structuredClone(run), meters: { jobsLaunched: 1, elapsedMs: 10 } } };
};
const withRetry = () => {
  const fixture = clean();
  const failed = execution('g1-failed', 1, 'failed');
  fixture.final.executions.splice(1, 0, failed);
  fixture.records.push({ type: 'code', path: `${failed.workshop.directory}/research/analysis/analyze.sh`, sessionId: 'owner', sha256: sha256('code') });
  return fixture;
};
const evaluate = (source, fixture) => {
  const results = [];
  const context = {
    ...fixture, host: { ctx: { hima: { ledger: { runs: () => [fixture.final.run] } } } }, agent: { id: 'owner' },
    check: { observed: {}, require: (claim, passed) => results.push({ claim, passed }) },
    sha256, readFileSync: () => 'code', within: (candidate, root) => candidate === root || candidate.startsWith(`${root}/`),
  };
  vm.runInNewContext(oracle(source), context);
  return results.every((r) => r.passed);
};
assert.equal(evaluate(before, clean()), true);
assert.equal(evaluate(before, withRetry()), false, 'old oracle rejects the permitted failed attempt pattern');
assert.equal(evaluate(after, withRetry()), true, 'new oracle retains retry history and accepts completed generation 1 and 2');
const cases = [
  ['clean two generations', true, clean],
  ['permitted failed attempt retained', true, withRetry],
  ['missing completed generation 2', false, () => { const f = clean(); f.final.executions[2].phase = 'failed'; return f; }],
  ['duplicate completion in generation 1', false, () => { const f = clean(); f.final.executions[2].generation = 1; return f; }],
  ['retry budget exceeded', false, () => { const f = withRetry(); f.final.executions.push(execution('third-attempt', 1, 'failed')); return f; }],
  ['completed entry has no code record', false, () => { const f = clean(); f.records = f.records.filter((r) => r.type !== 'code' || !r.path.includes('/g2/')); return f; }],
  ['historical failed code hash changed', false, () => { const f = withRetry(); f.records.at(-1).sha256 = 'incorrect'; return f; }],
  ['historical code belongs to another owner', false, () => { const f = withRetry(); f.records.at(-1).sessionId = 'other'; return f; }],
  ['elapsed time exceeded fixed budget', false, () => { const f = clean(); f.final.run.meters.elapsedMs = 780001; return f; }],
  ['orphan Workshop launch', false, () => { const f = clean(); f.records.push({ type: 'job', event: 'launched', generation: 2, job: { name: 'workshop-analyze', session: 'orphan' } }); f.final.run.meters.jobsLaunched++; return f; }],
];
for (const [label, expected, make] of cases) assert.equal(evaluate(after, make()), expected, label);
const normalizeDescriptions = (source) => {
  const parsed = ts.createSourceFile('tools.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const transformed = ts.transform(parsed, [(context) => {
    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) return ts.factory.updateObjectLiteralExpression(node, node.properties.filter((prop) => !(ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'description')).map((prop) => ts.visitNode(prop, visit)));
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit);
  }]);
  try { return ts.createPrinter().printFile(transformed.transformed[0]); } finally { transformed.dispose(); }
};
const toolsPath = 'packages/harness/src/tools.ts';
assert.equal(normalizeDescriptions(execFileSync('git', ['show', `59f15f3cfcd778d798055e8adbecc509501ddc40:${toolsPath}`], { encoding: 'utf8' })), normalizeDescriptions(readFileSync(toolsPath, 'utf8')), 'tools changes contain descriptions only');
console.log(JSON.stringify({ probe: 'actual checker oracle expressions with synthetic execution/record inputs', oldRetryPattern: 'rejected', cases: cases.map(([name, expected]) => ({ name, expected, passed: true })), toolsDescriptionOnly: true, checkerSha256: sha256(after) }, null, 2));
