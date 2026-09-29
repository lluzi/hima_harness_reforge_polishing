// @hima-seam agent wrapped
// @hima-seam tools direct
// Report-only native TEST/seal of an already ended Pack test Run (Issue #63), for any Pack. It never
// resumes, executes or creates a Run, Job, child or interactive operation: the Run's own owner is
// resumed and writes TEST.md through /hima-test and seals through /hima-release, and the Run and its
// records are asserted byte-unchanged. The CLI twins (finalize-atcs-native-test.ts) add the live
// check's bounds around this; the L2 Host test drives it on the replay stand-in.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { checkTestRecord, loadPack, packDigestExcludes, packStage, type RunRecord } from '@hima/harness';
import { resumeTestAgent, type InProcessHost } from '../test/contract/support/boot-inprocess.ts';

export interface ReportOnlySeal {
  /** The `$DSH_HOME` the Run's Ledger and installed Pack live in. */
  readonly homeRoot: string;
  readonly runId: string;
  readonly packId: string;
  /** The packs directory of the source tree the tested bytes came from; TEST.md and VERSION.yml land there. */
  readonly sourcePacksDir: string;
  /** The owner's model route for the two stage turns. */
  readonly model: { provider: string; model: string };
  /**
   * The owner's workspace. By default the one its own session was opened in — where a desktop kit
   * keeps it, beside the home — and `<home>/workspace` only for a session that names none.
   */
  readonly workspace?: string;
  /** Say one person's message to the resumed owner and wait for the turn. */
  readonly say: (agent: Agent, text: string) => Promise<void>;
  /** Called once with the resumed owner and its workspace before any turn is said. */
  readonly ready?: (owner: Agent, workspace: string) => void;
}

export interface ReportOnlySealed {
  readonly runId: string;
  readonly status: string;
  readonly packDigest: string;
  readonly recordCount: number;
  readonly workspace: string;
  readonly owner: Agent;
  readonly test: { path: string; sha256: string };
  readonly version: { path: string; sha256: string };
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const ended = (run: RunRecord | undefined): boolean => run?.status?.startsWith('ended-') === true || run?.status === 'cancelled';
/** Tools a report-only seal may never reach: nothing that executes, resumes or creates work. */
export const REPORT_ONLY_REFUSED = ['hima_execute', 'hima_interactive', 'hima_delegate', 'hima_run', 'hima_prepare'];

/** The owner's workspace, resolved: given, else its session's own, else `<home>/workspace`. */
function workspaceOf(o: ReportOnlySeal, owner: Agent): string {
  const at = o.workspace ?? owner.session.header.cwd ?? path.join(o.homeRoot, 'workspace');
  return realpathSync(at);
}

/**
 * Seal an already ended test Run's Pack through the owner's own /hima-test and /hima-release.
 *
 * @param host - a booted in-process host on `o.homeRoot`, reconciled.
 * @param o - what to seal and how to speak to the owner.
 * @returns the facts the seal rests on.
 * @throws when a stage is not reached, or anything about the Run or its records changed.
 */
export async function sealEndedTestRun(host: InProcessHost, o: ReportOnlySeal): Promise<ReportOnlySealed> {
  const installedPackDirectory = path.join(o.homeRoot, 'hima/packs', o.packId);
  const sourcePackDirectory = path.join(o.sourcePacksDir, o.packId);
  host.ctx.tools.guard((execution) => {
    if (['bash', 'terminal'].includes(execution.name)) return 'report-only finalization uses only Hima tools';
    if (execution.name === 'hima_author') return 'report-only finalization does not author the method';
    if (REPORT_ONLY_REFUSED.includes(execution.name))
      return 'Report-only finalization cannot execute, resume or create a Run, Job, child or interactive operation.';
    return undefined;
  });
  const initial = host.ctx.hima.ledger.run(o.runId);
  assert.ok(initial?.control && initial.packId === o.packId, `unknown ${o.packId} Run`);
  assert.ok(initial.purpose === 'test' && ended(initial), 'report-only requires an already ended test Run');
  const source = loadPack(o.sourcePacksDir, o.packId);
  assert.equal(initial.packDigest, source.folder.digest(packDigestExcludes), 'source Pack bytes differ from the tested Run');
  assert.equal(loadPack(path.join(o.homeRoot, 'hima/packs'), o.packId).folder.digest(packDigestExcludes), initial.packDigest);
  // The owner writes TEST.md into the installed Pack, outside its own workspace: a session the App
  // made is fenced to that workspace, so it is resumed with a grant for exactly this one folder.
  const owner = (await resumeTestAgent(host.ctx, initial.control.owner, o.model, { writeFolder: installedPackDirectory })).agent;
  const workspace = workspaceOf(o, owner);
  o.ready?.(owner, workspace);
  const beforeRun = JSON.stringify(initial);
  const before = host.ctx.hima.ledger.records({ runId: o.runId }).map((record) => record.id);
  for (const stage of ['tested', 'released'] as const) {
    const reached = () => {
      const checked = checkTestRecord(loadPack(path.join(o.homeRoot, 'hima/packs'), o.packId), host.ctx.hima.ledger);
      return packStage(installedPackDirectory).stage === stage && checked?.run === o.runId && checked.error === undefined;
    };
    const instruction = stage === 'tested'
      ? `/hima-test Reporting only for the already ended native test Run ${o.runId}. Do not resume the Run or create anything. Read its retained records and write TEST.md through the native test path. Preserve method bytes and report the exact ${initial.status} ending.`
      : `/hima-release ${o.packId}. Seal only the tested method using hima_pack_release; never handwrite VERSION.yml.`;
    for (let attempt = 0; attempt < 3 && !reached(); attempt++) await o.say(owner, instruction);
    if (!reached()) throw new Error(`report-only native pipeline did not reach ${stage} for this exact Run: ${JSON.stringify(packStage(installedPackDirectory))}`);
  }
  assert.equal(JSON.stringify(host.ctx.hima.ledger.run(o.runId)), beforeRun, 'report-only changed the ended Run');
  assert.deepEqual(host.ctx.hima.ledger.records({ runId: o.runId }).map((record) => record.id), before, 'report-only changed Run evidence');
  copyFileSync(path.join(installedPackDirectory, 'TEST.md'), path.join(sourcePackDirectory, 'TEST.md'));
  copyFileSync(path.join(installedPackDirectory, 'VERSION.yml'), path.join(sourcePackDirectory, 'VERSION.yml'));
  const landed = (file: string) => {
    const at = path.join(sourcePackDirectory, file);
    return { path: at, sha256: sha256(readFileSync(at)) };
  };
  return { runId: o.runId, status: String(initial.status), packDigest: String(initial.packDigest), recordCount: before.length,
    workspace, owner, test: landed('TEST.md'), version: landed('VERSION.yml') };
}
