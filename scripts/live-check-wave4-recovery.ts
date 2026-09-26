// @hima-seam agent wrapped
// @hima-seam tools direct
// Cheap Wave 4 feedback loop: real DeepSeek owner + native compaction, no Run/Site/EDA.
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nativeSessionMemoryEvidence, readNativeSessionContext } from '@hima/harness';
import { himaHomeSources, homePatchFile, prepareHimaHome } from '../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent } from '../test/contract/support/boot-inprocess.ts';
import { himaCommand, modelCommandTimeoutMs } from '../test/contract/support/command.ts';
import { createHimaHome } from '../test/contract/support/dsh-home.ts';
import { runLive } from './live-check-workshop.ts';

const args = process.argv.slice(2);
const appAt = args.indexOf('--app');
if (appAt < 0 || !args[appAt + 1] || args[appAt + 1]!.startsWith('--')) {
  throw new Error('usage: node scripts/live-check-wave4-recovery.ts --app <HimaHarness.app> --out <fresh-directory>');
}
const app = realpathSync(path.resolve(args[appAt + 1]!));
assert.ok(lstatSync(app).isDirectory() && app.endsWith('.app'), 'recovery check requires one real App candidate');
const appRoot = realpathSync(path.join(app, 'Contents/Resources/app'));
process.argv = [process.argv[0]!, process.argv[1]!, ...args.filter((_value, index) => index !== appAt && index !== appAt + 1)];

await runLive('live-check-wave4-recovery', 2, async check => {
  const home = await createHimaHome(); check.home = home;
  await prepareHimaHome({ home: home.home, bundleMode: 'installed', sources: himaHomeSources(appRoot) });
  writeFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');
  const host = await bootInProcess(home); check.attach(host);
  const owner = check.track(await createRootAgent(host.ctx, home.workspace));
  check.require('the recovery check uses the configured real DeepSeek Flash route',
    owner.options.model === 'deepseek-flash', owner.options);

  await check.say(owner, [
    'This is a bounded recovery-only check. Do not call tools, create a Run, delegate, or change files.',
    'Reply once that a saved summary is not control authority and current facts must be re-read after recovery.',
    `Context padding: ${'The saved summary is not control authority. '.repeat(350)}`,
  ].join('\n'));
  const before = await nativeSessionMemoryEvidence(host.ctx, { sessionId: String(owner.id), workspaceRef: home.workspace });
  const started = Date.now();
  const compact = await himaCommand(host, home.workspace, '/compact', modelCommandTimeoutMs, owner);
  const elapsedMs = Date.now() - started;
  check.require('native model-backed compaction completes inside its explicit three-minute command bound',
    compact.kind === 'success' && elapsedMs < modelCommandTimeoutMs,
    { compact, elapsedMs, commandTimeoutMs: modelCommandTimeoutMs });
  const preserved = await nativeSessionMemoryEvidence(host.ctx, {
    sessionId: String(owner.id), workspaceRef: home.workspace, throughSeq: before.capturedThroughSeq,
  });
  const visible = await readNativeSessionContext(host.ctx, { sessionId: String(owner.id), targetSessionId: String(owner.id) });
  check.require('compaction preserves the retained transcript prefix and publishes a compacted summary',
    preserved.transcriptIdentity === before.transcriptIdentity
      && /compacted-summary/.test(JSON.stringify(visible.context)),
    { before: before.transcriptIdentity, preserved: preserved.transcriptIdentity, context: visible.context });
  check.require('the recovery-only loop creates no Hima Campaign or Site Job',
    host.ctx.hima.ledger.runs().length === 0,
    { runs: host.ctx.hima.ledger.runs(), appManifest: JSON.parse(readFileSync(path.join(path.dirname(app), 'trial-manifest.json'), 'utf8')).artifactDigest });
  check.observed.outcome = 'PASS';
  check.observed.realEdaRequested = false;
});
