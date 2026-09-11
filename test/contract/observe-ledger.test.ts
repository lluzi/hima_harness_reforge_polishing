// @hima-seam tools direct
// Ticket #3: refusals, append-only, durability across a host restart, the tool face, and ledger reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
// Loads the `ctx.hima` declaration merge onto Context.
import type {} from '@hima/harness';
import type {} from '@deepseek-ai/dsh-tools';

test('a read outside the permitted roots is refused before any read, and the refusal is recorded', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const outside = path.join(h.home, 'outside.txt');
  await writeFile(outside, 'secret');
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${outside}`);
    assert.equal(kind, 'error', text);
    assert.match(text, /refused/);
    assert.ok(runId, 'the refusal still belongs to a run');
    const records = host.ctx.hima.ledger.records({ runId });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.type, 'refusal');
    assert.equal(records[0]!.writer, 'shell');
    assert.match(records[0]!.type === 'refusal' ? records[0]!.reason : '', /outside the permitted read roots/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'observation' }).length, 0, 'no observation exists for a refused read');
  } finally { await host.dispose(); await h.dispose(); }
});

test('a symlink that escapes the permitted roots is refused', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const outside = path.join(h.home, 'outside.txt');
  await writeFile(outside, 'secret');
  await mkdir(path.join(h.workspace, 'links'), { recursive: true });
  const { symlink } = await import('node:fs/promises');
  await symlink(outside, path.join(h.workspace, 'links/escape.txt'));
  const host = await bootInProcess(h);
  try {
    const { kind, text } = await himaCommand(host, h.workspace, '/hima observe local links/escape.txt');
    assert.equal(kind, 'error', text);
    assert.match(text, /outside the permitted read roots/);
  } finally { await host.dispose(); await h.dispose(); }
});

test('observing the same file twice into one run appends a second record with a higher sequence and leaves the first unchanged', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    const first = await himaCommand(host, h.workspace, `/hima observe local ${report.rel}`);
    assert.equal(first.kind, 'success', first.text);
    assert.ok(first.runId, 'the first observation created a run');
    // `--run` is what makes a Run span several observations: without it every observe would be its
    // own run and nothing could ever be appended to an earlier one (D36).
    const second = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --run ${first.runId!}`);
    assert.equal(second.kind, 'success', second.text);
    assert.equal(second.runId, first.runId, 'the second observation joined the run it named, rather than opening its own');

    const records = host.ctx.hima.ledger.records({ runId: first.runId! });
    assert.equal(records.length, 2, 'two records in the one run');
    assert.equal(records[0]!.seq, 1);
    assert.equal(records[1]!.seq, 2, 'appended with a higher sequence');
    assert.ok(records[1]!.seq > records[0]!.seq);
    assert.notEqual(records[0]!.id, records[1]!.id, 'a new record, not an overwrite');
    assert.equal(records[0]!.type === 'observation' ? records[0]!.contentSha256 : '', report.sha256);
    assert.equal(records[1]!.type === 'observation' ? records[1]!.contentSha256 : '', report.sha256);
    assert.deepEqual(host.ctx.hima.ledger.record(records[0]!.id), records[0], 'the first record reads back unchanged');
  } finally { await host.dispose(); await h.dispose(); }
});

test('an observe naming a run that does not exist is refused as the caller\'s mistake, and writes nothing', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    const missing = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --run run-does-not-exist`);
    assert.equal(missing.kind, 'error', missing.text);
    assert.match(missing.text, /run-does-not-exist/, 'the message names the run that was asked for');
    assert.equal(host.ctx.hima.ledger.records({ runId: 'run-does-not-exist' }).length, 0, 'nothing was written anywhere');

    // Present but valueless is a usage error, exactly as --reader and --judge are.
    const valueless = await himaCommand(host, h.workspace, `/hima observe local ${report.rel} --run`);
    assert.equal(valueless.kind, 'error', valueless.text);
    assert.match(valueless.text, /usage: \/hima observe/);
    assert.equal(valueless.runId, undefined, 'no run was created for a call that never got past its flags');
  } finally { await host.dispose(); await h.dispose(); }
});

test('records survive a host restart and read back unchanged', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  let runId: string | undefined; let before: unknown;
  const host1 = await bootInProcess(h);
  try {
    ({ runId } = await himaCommand(host1, h.workspace, `/hima observe local ${report.rel}`));
    before = host1.ctx.hima.ledger.records({ runId: runId! });
  } finally { await host1.dispose(); }
  const host2 = await bootInProcess(h);
  try {
    assert.ok(host2.ctx.hima.ledger.run(runId!), 'the run is still there after restart');
    assert.deepEqual(host2.ctx.hima.ledger.records({ runId: runId! }), before);
  } finally { await host2.dispose(); await h.dispose(); }
});

test('the hima_observe tool is listed for the agent and returns the same observation through the tool runtime', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    assert.ok(host.ctx.tools.schemas().some((s) => s.name === 'hima_observe'), 'the tool is registered');
    const result = await host.ctx.tools.execute({
      callId: 'call-hima-observe-1' as never,
      name: 'hima_observe',
      arguments: { site: 'local', path: report.rel },
      agent,
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(result.isError, false, JSON.stringify(result));
    const value = (result as unknown as { value?: { kind: string; runId: string; recordId: string; contentSha256?: string; bytes?: number } }).value;
    assert.ok(value, 'a canonical value is returned');
    assert.equal(value.kind, 'observed');
    assert.equal(value.contentSha256, report.sha256);
    assert.equal(value.bytes, report.bytes);
    const rec = host.ctx.hima.ledger.record(value.recordId);
    assert.equal(rec?.type, 'observation');
    assert.equal(rec?.runId, value.runId);
  } finally { await host.dispose(); await h.dispose(); }
});
