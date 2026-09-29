// @hima-seam agent wrapped
// @hima-seam tools direct
// Report-only native TEST/seal for an already ended ATCS test Run (Issue #63). Twin of
// `resume-xtop-native-test.ts --report-only`: it never resumes, executes or creates a Run, Job, child
// or interactive operation; the owner writes TEST.md through /hima-test and seals through /hima-release.
// The procedure itself is `sealEndedTestRun` (report-only-seal.ts); this file adds the live check's bounds.
// usage: --home <dsh home> --run-id <run> --binding-file <bindings.json> [--workspace <dir>]
//        [--source-packs <packs dir>] --out <fresh evidence dir> [live-check bounds]
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { bootInProcess } from '../test/contract/support/boot-inprocess.ts';
import { repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { guardInstalled, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';
import { sealEndedTestRun } from './report-only-seal.ts';

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
const optional = (flag: string): string | undefined => (args.includes(flag) ? take(flag) : undefined);
// A desktop kit keeps its workspace beside the home; by default it is the one the owner's own session
// was opened in. The source Pack is this checkout's unless another source tree is named.
const workspace = optional('--workspace');
const sourcePacksDir = realpathSync(optional('--source-packs') ?? path.join(repoRoot, 'packs'));
assert.ok(lstatSync(bindingFile).isFile() && !lstatSync(bindingFile).isSymbolicLink());
process.argv = [process.argv[0]!, process.argv[1]!, ...args];

const installedPackDirectory = path.join(homeRoot, 'hima/packs', PACK_ID);
const home: HimaHome = {
  home: homeRoot,
  profileDir: path.join(homeRoot, 'profiles/hima'),
  workspace: path.join(homeRoot, 'workspace'),
  env: { ...process.env, DSH_HOME: homeRoot, DSH_AGENTS_HOME: path.join(homeRoot, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
  dispose: async () => undefined,
};

await runLive(NAME, 8, async (check: LiveCheck) => {
  const host = await bootInProcess(home); check.attach(host); await host.ctx.hima.reconciled;
  const bundle = realpathSync(path.join(home.profileDir, 'node_modules/@hima/harness'));
  const initial = host.ctx.hima.ledger.run(runId);
  check.observed.reportOnly = { runId, status: initial?.status, recordCount: host.ctx.hima.ledger.records({ runId }).length,
    ownerId: initial?.control?.owner, bindingFile: { path: bindingFile, sha256: sha256(readFileSync(bindingFile)) } };
  const sealed = await sealEndedTestRun(host, {
    homeRoot, runId, packId: PACK_ID, sourcePacksDir, ...(workspace ? { workspace: realpathSync(workspace) } : {}),
    model: { provider: 'deepseek-official', model: 'deepseek-flash' },
    say: (agent, text) => check.say(agent, text),
    factsWritten: (at, facts) => {
      check.observed.facts = { path: at, lines: facts.text.split('\n').length - 1, status: facts.status, code: facts.code.length, refusals: facts.refusals.length };
    },
    ready: (owner, ownerWorkspace) => {
      check.trackResumed(owner);
      check.observed.workspace = ownerWorkspace;
      guardInstalled(check, host, [bundle, path.join(homeRoot, 'hima/packs'), ownerWorkspace], installedPackDirectory, check.temporary);
    },
  });
  check.require('report-only native pipeline reaches released for this exact Run', true, sealed.version);
  check.observed.release = { runId, packDigest: sealed.packDigest, recordCount: sealed.recordCount,
    facts: sealed.facts, test: sealed.test, version: sealed.version };
});
