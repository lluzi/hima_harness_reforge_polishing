// L1 contract for the opt-in L4 entry. No model, Host, replay, SSH or EDA is started here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from './support/dsh-home.ts';

const script = path.join(repoRoot, 'scripts/live-check-dtco-feedback-ab.ts');

function keylessEnvironment(bootLog: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HIMA_TEST_BOOT_LOG: bootLog };
  delete env.DEEPSEEK_API_KEY;
  return env;
}

test('DTCO feedback A/B live check advertises the bounded live-only contract without a credential', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feedback-ab-help-'));
  try {
    const help = spawnSync(process.execPath, [script, '--help'], {
      cwd: repoRoot,
      env: keylessEnvironment(path.join(root, 'boots.txt')),
      encoding: 'utf8',
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Live-only L4 qualification/);
    assert.match(help.stdout, /exactly two native deepseek-flash turns/);
    assert.match(help.stdout, /same frozen pool\/budget\/sources/);
    assert.match(help.stdout, /Rejects replay, runs no commercial EDA, and makes no PPA claim/);
    assert.ok(!existsSync(path.join(root, 'boots.txt')), 'help must not boot a Host');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DTCO feedback A/B live check refuses a missing key before reads, writes, boot or model work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'feedback-ab-keyless-'));
  try {
    const out = path.join(root, 'must-not-exist');
    const bootLog = path.join(root, 'boots.txt');
    const ran = spawnSync(process.execPath, [script,
      '--request', path.join(root, 'also-must-not-exist', 'research-context.json'),
      '--out', out,
    ], {
      cwd: repoRoot,
      env: keylessEnvironment(bootLog),
      encoding: 'utf8',
    });
    assert.equal(ran.status, 2, `${ran.stdout}\n${ran.stderr}`);
    assert.match(ran.stderr, /missing DEEPSEEK_API_KEY; nothing read or written, no Host booted, and no model requested/);
    assert.equal(ran.stdout, '');
    assert.ok(!existsSync(out), 'the evidence directory must not be created without a key');
    assert.ok(!existsSync(bootLog), 'the Host boot journal must remain absent without a key');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DTCO feedback A/B live check delegates truth checks to the existing Pack runner', async () => {
  const source = await readFile(script, 'utf8');
  for (const symbol of [
    'load_residual_research_context',
    'validate_residual_research_proposal',
    'execute_candidate_program',
    '_feedback_ab',
    '_generation_feedback',
  ]) {
    assert.match(source, new RegExp(`runner\\.${symbol.replace(/^_/, '\\_')}`), symbol);
  }
  assert.match(source, /delete environment\[KEY_VARIABLE\]/, 'the Pack validator subprocess does not inherit the model credential');
  assert.match(source, /commercialEdaExecuted: false/);
  assert.match(source, /ppaClaimed: false/);
  assert.doesNotMatch(source, /writeReplayOverlay|dsh-llm-replay.*import/);
});
