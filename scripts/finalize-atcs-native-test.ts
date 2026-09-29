// @hima-seam agent wrapped
// @hima-seam tools direct
// Report-only native TEST/seal for an already ended ATCS test Run (Issue #63). Twin of
// `resume-xtop-native-test.ts --report-only`: it never resumes, executes or creates a Run, Job, child
// or interactive operation; the owner writes TEST.md through /hima-test and seals through /hima-release.
import assert from 'node:assert/strict';
import { copyFileSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { checkTestRecord, loadPack, packDigestExcludes, packStage, type RunRecord } from '@hima/harness';
import { bootInProcess, resumeTestAgent } from '../test/contract/support/boot-inprocess.ts';
import { repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { guardInstalled, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';

const NAME = 'finalize-atcs-native-test';
const PACK_ID = 'agentic-timing-closure-system';
const args = process.argv.slice(2);
const take = (flag: string): string => {
  const at = args.indexOf(flag); const value = at < 0 ? undefined : args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing ${flag}`);
  args.splice(at, 2); return value;
};
const homeRoot = realpathSync(take('--home'));
const runId = take('--run-id');
const bindingFile = realpathSync(take('--binding-file'));
assert.ok(lstatSync(bindingFile).isFile() && !lstatSync(bindingFile).isSymbolicLink());
process.argv = [process.argv[0]!, process.argv[1]!, ...args];

const installedPackDirectory = path.join(homeRoot, 'hima/packs', PACK_ID);
const sourcePackDirectory = path.join(repoRoot, 'packs', PACK_ID);
const home: HimaHome = {
  home: homeRoot,
  profileDir: path.join(homeRoot, 'profiles/hima'),
  workspace: path.join(homeRoot, 'workspace'),
  env: { ...process.env, DSH_HOME: homeRoot, DSH_AGENTS_HOME: path.join(homeRoot, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
  dispose: async () => undefined,
};
const ended = (run: RunRecord | undefined): boolean => run?.status?.startsWith('ended-') === true || run?.status === 'cancelled';

await runLive(NAME, 8, async (check: LiveCheck) => {
  const host = await bootInProcess(home); check.attach(host); await host.ctx.hima.reconciled;
  const bundle = realpathSync(path.join(home.profileDir, 'node_modules/@hima/harness'));
  guardInstalled(check, host, [bundle, path.join(homeRoot, 'hima/packs'), home.workspace], installedPackDirectory, check.temporary);
  host.ctx.tools.guard((execution) => {
    if (['bash', 'terminal'].includes(execution.name)) return 'report-only finalization uses only Hima tools';
    if (execution.name === 'hima_author') return 'report-only finalization does not author the method';
    if (['hima_execute', 'hima_interactive', 'hima_delegate', 'hima_run', 'hima_prepare'].includes(execution.name))
      return 'Report-only finalization cannot execute, resume or create a Run, Job, child or interactive operation.';
    return undefined;
  });
  const initial = host.ctx.hima.ledger.run(runId);
  assert.ok(initial?.control && initial.packId === PACK_ID, 'unknown ATCS Run');
  assert.ok(initial.purpose === 'test' && ended(initial), 'report-only requires an already ended ATCS test Run');
  const source = loadPack(path.join(repoRoot, 'packs'), PACK_ID);
  assert.equal(initial.packDigest, source.folder.digest(packDigestExcludes), 'source Pack bytes differ from the tested Run');
  assert.equal(loadPack(path.join(homeRoot, 'hima/packs'), PACK_ID).folder.digest(packDigestExcludes), initial.packDigest);
  const owner = check.trackResumed((await resumeTestAgent(host.ctx, initial.control.owner, { provider: 'deepseek-official', model: 'deepseek-flash' })).agent);
  const beforeRun = JSON.stringify(initial);
  const before = host.ctx.hima.ledger.records({ runId }).map((record) => record.id);
  check.observed.reportOnly = { runId, status: initial.status, recordCount: before.length, ownerId: initial.control.owner,
    bindingFile: { path: bindingFile, sha256: sha256(readFileSync(bindingFile)) } };
  for (const stage of ['tested', 'released'] as const) {
    const reached = () => {
      const checked = checkTestRecord(loadPack(path.join(homeRoot, 'hima/packs'), PACK_ID), host.ctx.hima.ledger);
      return packStage(installedPackDirectory).stage === stage && checked?.run === runId && checked.error === undefined;
    };
    const instruction = stage === 'tested'
      ? `/hima-test Reporting only for the already ended native test Run ${runId}. Do not resume the Run or create anything. Read its retained records and write TEST.md through the native test path. Preserve method bytes and report the exact ${initial.status} ending.`
      : `/hima-release ${PACK_ID}. Seal only the tested method using hima_pack_release; never handwrite VERSION.yml.`;
    for (let attempt = 0; attempt < 3 && !reached(); attempt++) await check.say(owner, instruction);
    check.require(`report-only native pipeline reaches ${stage} for this exact Run`, reached(), packStage(installedPackDirectory));
  }
  assert.equal(JSON.stringify(host.ctx.hima.ledger.run(runId)), beforeRun, 'report-only changed the ended Run');
  assert.deepEqual(host.ctx.hima.ledger.records({ runId }).map((record) => record.id), before, 'report-only changed Run evidence');
  copyFileSync(path.join(installedPackDirectory, 'TEST.md'), path.join(sourcePackDirectory, 'TEST.md'));
  copyFileSync(path.join(installedPackDirectory, 'VERSION.yml'), path.join(sourcePackDirectory, 'VERSION.yml'));
  check.observed.release = { runId, packDigest: initial.packDigest, testSha256: sha256(readFileSync(path.join(sourcePackDirectory, 'TEST.md'))),
    versionSha256: sha256(readFileSync(path.join(sourcePackDirectory, 'VERSION.yml'))) };
});
