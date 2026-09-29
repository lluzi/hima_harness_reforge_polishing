// @hima-seam agent wrapped
// @hima-seam tools direct
// Report-only native TEST/seal of an already ended Pack test Run (Issue #63), for any Pack. It never
// resumes, executes or creates a Run, Job, child or interactive operation: the Run's own owner is
// resumed and writes TEST.md through /hima-test and seals through /hima-release, and the Run and its
// records are asserted byte-unchanged. The three facts the harness holds TEST.md against (the ending,
// every code sha256, every refusal id) are read from the Ledger into a line-based file in the owner's
// workspace, because a large Run's hima_status answer is one line longer than any `read` shows. The CLI twins (finalize-atcs-native-test.ts) add the live
// check's bounds around this; the L2 Host test drives it on the replay stand-in.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
  /** Called with the facts file once it is written, before any turn is said. */
  readonly factsWritten?: (at: string, facts: TestRecordFacts) => void;
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
  readonly facts: { path: string; lines: number; code: number; refusals: number };
  readonly test: { path: string; sha256: string };
  readonly version: { path: string; sha256: string };
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const ended = (run: RunRecord | undefined): boolean => run?.status?.startsWith('ended-') === true || run?.status === 'cancelled';
/**
 * What the person says about the grant, in the stage message itself. A resumed owner remembers every
 * earlier denial in its own history — on the live kit it had been told twice that no approval channel
 * exists, and it rightly would not retry a denied write — so the seal says, as a person in the App
 * would, that the answer is now there and for which folder.
 */
const GRANT_SAID = (folder: string): string =>
  `Approval is now available in this session for writes into the installed Pack folder ${folder} and nowhere else: if the sandbox denies the TEST.md write, retry that same write once with sandbox_permissions "danger-full-access" and a one-sentence justification, and it will be approved.`;

/** Tools a report-only seal may never reach: nothing that executes, resumes or creates work. */
export const REPORT_ONLY_REFUSED = ['hima_execute', 'hima_interactive', 'hima_delegate', 'hima_run', 'hima_prepare'];

/** What checkTestRecord holds a test record's three bound sections against, read from the Run's records. */
export interface TestRecordFacts {
  readonly status: string;
  readonly code: readonly { id: string; needle: string; path?: string; nodeId?: string; attempt?: number }[];
  readonly refusals: readonly { id: string; reason: string }[];
  /** The facts file's text: line-based, one id per line, so the owner's `read` reads all of it. */
  readonly text: string;
}

/** One line of a reason, bounded well under `read`'s line cap. */
const oneLine = (text: string, max = 400): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/**
 * The facts `checkTestRecord` will demand of this Run's TEST.md, taken from the Ledger exactly as it
 * takes them: the `status:` line, every `code` record's sha256 (its id when it has none), and every
 * `refusal` record's id. A Run of hundreds of records answers `hima_status` in one line longer than
 * any `read` shows, so these are handed to the owner as a file it can read, never written for it.
 */
export function testRecordFacts(ledger: InProcessHost['ctx']['hima']['ledger'], runId: string): TestRecordFacts {
  const run = ledger.run(runId);
  assert.ok(run?.status, `unknown Run ${runId}`);
  const records = ledger.records({ runId });
  const code = records.filter((r) => r.type === 'code').map((r) => {
    const c = r as { id: string; sha256?: string; path?: string; nodeId?: string; attempt?: number };
    return { id: c.id, needle: c.sha256 ?? c.id, path: c.path, nodeId: c.nodeId, attempt: c.attempt };
  });
  const refusals = records.filter((r) => r.type === 'refusal').map((r) => ({ id: r.id, reason: String((r as { reason?: unknown }).reason ?? '') }));
  const text = [
    `# Test record facts for run ${runId}`,
    '',
    'These facts come from this Run\'s own HimaLedger records, read by the report-only seal. They are the',
    'three things the harness holds TEST.md against. Copy each line below verbatim into its section of',
    'TEST.md; never invent, drop or reword an id, a hash or the status line.',
    '',
    '## Ending',
    '',
    `status: ${run.status}`,
    '',
    `## Code (${code.length} records)`,
    '',
    ...(code.length ? code.map((c) => `- ${c.needle} ${c.path ?? ''} (record ${c.id}${c.nodeId ? `, node ${c.nodeId}` : ''}${c.attempt ? `, attempt ${c.attempt}` : ''})`) : ['none']),
    '',
    `## Refusals (${refusals.length} records)`,
    '',
    ...(refusals.length ? refusals.map((r) => `- ${r.id}: ${oneLine(r.reason)}`) : ['none']),
    '',
  ].join('\n');
  return { status: run.status, code, refusals, text };
}

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
  const beforeRecords = JSON.stringify(host.ctx.hima.ledger.records({ runId: o.runId }));
  const before = host.ctx.hima.ledger.records({ runId: o.runId }).map((record) => record.id);
  // The facts the record is held against, as a line-based file in the owner's own workspace.
  const facts = testRecordFacts(host.ctx.hima.ledger, o.runId);
  const factsPath = path.join(workspace, 'seal', 'test-record-facts.md');
  mkdirSync(path.dirname(factsPath), { recursive: true });
  writeFileSync(factsPath, facts.text);
  o.factsWritten?.(factsPath, facts);
  for (const stage of ['tested', 'released'] as const) {
    const reached = () => {
      const checked = checkTestRecord(loadPack(path.join(o.homeRoot, 'hima/packs'), o.packId), host.ctx.hima.ledger);
      return packStage(installedPackDirectory).stage === stage && checked?.run === o.runId && checked.error === undefined;
    };
    const instruction = stage === 'tested'
      ? `/hima-test Reporting only for the already ended native test Run ${o.runId}. Do not resume the Run or create anything. Read the file ${factsPath} with read (it is line-based): it lists, from this Run's own Ledger records, the exact status line, every code record's sha256 and every refusal record's id with its reason (${facts.code.length} code, ${facts.refusals.length} refusals). Copy those lines verbatim into the Ending, Code and Refusals sections; take the other sections from hima_status ${o.runId} and the Pack's INTENT.md and SPEC.md as /hima-test says, and never invent an id. Write TEST.md through the native test path, replacing any TEST.md already in the installed Pack folder entirely (read that TEST.md first: a file is overwritten only after it has been read). Preserve method bytes and report the exact ${initial.status} ending. ${GRANT_SAID(installedPackDirectory)}`
      : `/hima-release ${o.packId}. Seal only the tested method using hima_pack_release; never handwrite VERSION.yml.`;
    for (let attempt = 0; attempt < 3 && !reached(); attempt++) await o.say(owner, instruction);
    if (!reached()) throw new Error(`report-only native pipeline did not reach ${stage} for this exact Run: ${JSON.stringify(packStage(installedPackDirectory))}`);
  }
  assert.equal(JSON.stringify(host.ctx.hima.ledger.run(o.runId)), beforeRun, 'report-only changed the ended Run');
  assert.deepEqual(host.ctx.hima.ledger.records({ runId: o.runId }).map((record) => record.id), before, 'report-only changed Run evidence');
  assert.equal(JSON.stringify(host.ctx.hima.ledger.records({ runId: o.runId })), beforeRecords, 'report-only changed a Run record');
  const finalCheck = checkTestRecord(loadPack(path.join(o.homeRoot, 'hima/packs'), o.packId), host.ctx.hima.ledger);
  assert.ok(finalCheck?.run === o.runId && finalCheck.error === undefined, `the sealed test record does not hold: ${finalCheck?.error}`);
  copyFileSync(path.join(installedPackDirectory, 'TEST.md'), path.join(sourcePackDirectory, 'TEST.md'));
  copyFileSync(path.join(installedPackDirectory, 'VERSION.yml'), path.join(sourcePackDirectory, 'VERSION.yml'));
  const landed = (file: string) => {
    const at = path.join(sourcePackDirectory, file);
    return { path: at, sha256: sha256(readFileSync(at)) };
  };
  return { runId: o.runId, status: String(initial.status), packDigest: String(initial.packDigest), recordCount: before.length,
    workspace, owner, facts: { path: factsPath, lines: facts.text.split('\n').length - 1, code: facts.code.length, refusals: facts.refusals.length },
    test: landed('TEST.md'), version: landed('VERSION.yml') };
}
