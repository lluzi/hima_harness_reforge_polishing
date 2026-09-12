// L1 checkpoint admission/reader checks. Synthetic evidence is never claimed as model authoring.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { checkpointArguments, inspectCheckpoint, parseParent, probeReader } from '../../scripts/live-check-pipeline-checkpoint.ts';
import { sha256 } from '../../scripts/live-check-workshop.ts';

function fixture() {
  const privateRoot = realpathSync(mkdtempSync('/tmp/hima-l4-'));
  const home = path.join(privateRoot, 'home');
  const folder = path.join(home, 'hima/packs/authored-numeric');
  const bundle = path.join(home, 'profiles/hima/node_modules/@hima/harness');
  mkdirSync(folder, { recursive: true }); mkdirSync(bundle, { recursive: true });
  writeFileSync(path.join(bundle, 'package.json'), '{}\n');
  writeFileSync(path.join(folder, 'INTENT.md'), '# Synthetic parser test\n');
  const parent = {
    check: 'live-check-pipeline', status: 'failed', passed: false,
    costs: { hosts: 1, nativeSessionsCreated: 2, modelSessions: 1, modelRequestSteps: 26, userMessages: 5 },
    observed: {
      privateRoot, sourceSha: '0'.repeat(40), installedBundle: bundle, packFolder: folder,
      installedBuildHashes: { 'package.json': sha256('{}\n') }, authoredFiles: { [path.join(folder, 'INTENT.md')]: sha256('# Synthetic parser test\n') },
      methodBeforeTest: { digest: '0'.repeat(64), intentSha256: '0'.repeat(64), specSha256: '0'.repeat(64) },
      input: { path: path.join(home, 'numeric-flow/numbers.txt'), numbers: [1, 2], limit: 1, sha256: sha256('1\n2\n') },
      approvedBusiness: { facts: 'Synthetic admission evidence, no model proof.', sha256: sha256('Synthetic admission evidence, no model proof.'), goal: { minimum: 1 }, initialStrategy: { limit: 1 }, generationLimit: 1, timeBoxMs: 480_000 },
      allowedReadRoots: [bundle, folder], allowedWriteRoot: folder, deniedTools: [],
    },
    agents: [{ id: 'session-fixture', session: 'session-fixture', cwd: folder, skills: ['hima-grill', 'hima-spec', 'hima-fabric'], toolCalls: [{ name: 'read', args: { file_path: 'INTENT.md' } }] }],
    runs: [] as unknown[],
    checks: [
      'grill waited for author answers before recording intent', 'spec added only SPEC.md', 'Pack stage reached compiled',
      'compiled method preserves the approved Workshop argv and output roots', 'compiled parameter declarations and LIMIT binding preserve the approved contract',
      'actual graph routes the approved success through Explore and fallback through the bounded revisit', 'ordered Judge rules encode numeric validity and the actual Run Goal',
    ].map((claim) => ({ claim, passed: true })).concat([{ claim: 'the authored chooser declares Goal completion and the bounded fallback limit', passed: false }]),
  };
  const at = path.join(privateRoot, 'parent.json');
  writeFileSync(at, JSON.stringify(parent));
  return { privateRoot, folder, bundle, parent, at, dispose: () => rmSync(privateRoot, { recursive: true, force: true }) };
}

test('checkpoint admission refuses an existing Run, additional failure, missing stage, altered contract and split author', () => {
  const f = fixture();
  try {
    assert.equal(parseParent(f.parent).observed.packFolder, f.folder);
    const existing = structuredClone(f.parent); existing.runs.push({ id: 'run-existing' });
    assert.throws(() => parseParent(existing), /no Run/);
    const failed = structuredClone(f.parent); failed.checks[0]!.passed = false;
    assert.throws(() => parseParent(failed), /failures beyond/);
    const incomplete = structuredClone(f.parent); incomplete.checks.splice(2, 1);
    assert.throws(() => parseParent(incomplete), /did not establish/);
    const altered = structuredClone(f.parent); altered.observed.approvedBusiness.facts += ' widened';
    assert.throws(() => parseParent(altered), /business contract hash mismatch/);
    const split = structuredClone(f.parent); split.agents.push(structuredClone(split.agents[0]!));
    assert.throws(() => parseParent(split), /one original three-stage author/);
    const budget = structuredClone(f.parent); budget.observed.approvedBusiness.generationLimit = 2;
    assert.throws(() => parseParent(budget), /approved business differs/);
  } finally { f.dispose(); }
});

test('checkpoint provenance rejects changed installed bytes before any Host or reader execution', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.bundle, 'package.json'), '{"changed":true}\n');
    await assert.rejects(inspectCheckpoint(f.at), /installed bundle hashes changed/);
    assert.equal(readFileSync(path.join(f.folder, 'INTENT.md'), 'utf8'), '# Synthetic parser test\n');
  } finally { f.dispose(); }
});

test('checkpoint provenance rejects changed or extra authored files before any Host or reader execution', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.folder, 'TEST.md'), 'run: made-up\n');
    await assert.rejects(inspectCheckpoint(f.at), /authored file hashes changed/);
  } finally { f.dispose(); }
});

test('reader probes expose whitespace concatenation and do not pass inherited environment to child scripts', () => {
  const f = fixture();
  try {
    const script = path.join(f.privateRoot, 'reader.sh');
    const bytes = '#!/bin/sh\nset -eu\n[ -z "${HIMA_CHECKPOINT_CHILD_SENTINEL+x}" ] || exit 77\n[ -f "$1" ] || exit 1\nn=$(tr -d " \\t\\r\\n" < "$1")\ncase "$n" in ""|*[!0-9]*) exit 1;; esac\nprintf \'{"values":[{"type":"numeric_sum","unit":"count","value":%s}]}\\n\' "$n" > "$2"\n';
    writeFileSync(script, bytes);
    const saved = process.env.HIMA_CHECKPOINT_CHILD_SENTINEL;
    process.env.HIMA_CHECKPOINT_CHILD_SENTINEL = 'non-secret-sentinel';
    try {
      const result = probeReader(script, f.privateRoot);
      assert.equal(result.passed, false);
      assert.equal(result.cases.find((c) => c.name === 'single')?.passed, true);
      for (const name of ['multiple-lines', 'multiple-tokens']) {
        const actual = result.cases.find((c) => c.name === name)!;
        assert.equal(actual.passed, false);
        assert.equal(JSON.parse(actual.document!).values[0].value, 12);
      }
      assert.equal(result.cases.find((c) => c.name === 'missing')?.passed, true);
      assert.equal(result.cases.find((c) => c.name === 'unreadable')?.passed, true);
      assert.equal(readFileSync(script, 'utf8'), bytes);
    } finally { if (saved === undefined) delete process.env.HIMA_CHECKPOINT_CHILD_SENTINEL; else process.env.HIMA_CHECKPOINT_CHILD_SENTINEL = saved; }
  } finally { f.dispose(); }
});

test('checkpoint CLI requires a parent and isolates its opt-in flags from LiveCheck budgets', () => {
  assert.throws(() => checkpointArguments(['--out', 'new']), /--parent/);
  assert.throws(() => checkpointArguments(['--parent', '--out', 'new']), /--parent/);
  assert.deepEqual(checkpointArguments(['--parent', '/tmp/parent.json', '--out', 'new', '--preflight-only']), { parentPath: '/tmp/parent.json', preflight: true, remaining: ['--out', 'new'] });
});
