// #108 opt-in whole /2 native source-loss qualification. The worker retains
// actual private evidence; the caller only accepts the final bounded receipt.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const admitted = process.env.HIMA_108_NATIVE_RESTORE_ADMIT === '1';
test('actual one-Pi /2 source-loss restore remains held until qualification and explicit post-exit continuation', {
  timeout: 580_000, skip: admitted ? false : 'Requires exact private native restore admission and a serial watched model window',
}, async () => {
  const configFile = process.env.HIMA_108_NATIVE_RESTORE_CONFIG;
  assert.ok(configFile && path.isAbsolute(configFile) && process.env.NODE_TEST_CONTEXT,
    'Use only the exact private config through the canonical test runner');
  const config = JSON.parse(await readFile(configFile, 'utf8')) as { proofRoot: string; expiresAt: string };
  assert.ok(Date.parse(config.expiresAt) > Date.now() + 60_000 && Date.parse(config.expiresAt) <= Date.now() + 600_000);
  const worker = fileURLToPath(new URL('./support/issue108-native-restore-worker.ts', import.meta.url));
  const child = spawn(process.execPath, [worker, '--run-issue108-native-restore', '--config', configFile], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdout!.resume();
  child.stderr!.on('data', bytes => {
    stderr = (stderr + String(bytes)).slice(-8000);
    if (process.env.DEEPSEEK_API_KEY) stderr = stderr.replaceAll(process.env.DEEPSEEK_API_KEY, '[redacted]');
  });
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject); child.once('close', resolve);
    });
    assert.equal(code, 0, 'Exact native restore worker failed; inspect its private retained proof: ' + stderr.slice(-1200));
    const result = JSON.parse(await readFile(path.join(config.proofRoot, 'result.json'), 'utf8')) as {
      result: string; scope: string; backup: string; manifestSha256: string; applicationVersion: string;
    };
    assert.equal(result.result, 'PASS');
    assert.match(result.scope, /actual one-Pi \/2 source loss/);
    assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
    assert.match(result.applicationVersion, /^hima-[a-f0-9]{64}$/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
});
