// @hima-seam tools direct
// Ticket #3: refusals, append-only, durability across a host restart, the tool face, and ledger reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
// Loads the `ctx.hima` declaration merge onto Context.
import { appendReading, bundleSemantics, validateReading } from '@hima/harness';
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


// ---------------------------------------------------------------------------------------------
// Ticket #61: what may become an observation, and what refuses it before it does
// ---------------------------------------------------------------------------------------------

test('a reader that says it could not read a value and does not say why is refused by the one gate, naming the reader and the type', async () => {
  // `value: null` means the reader looked and could not find the number, and `unknownReason` is the
  // sentence a person and a verdict both read in its place. A reading carrying the first without the
  // second says nothing at all about a value it claims to have read.
  //
  // Asked by the validator and not only by the schema, because of where each of the two paths into
  // an observation meets a schema at all: a pack script's output is parsed out of the JSON it wrote,
  // so a null with no reason there is refused as a document; a reader this bundle ships produces
  // TypeScript objects that meet no schema until the ledger stores them, and a record this ledger
  // cannot parse is one the **next host** cannot open the domain over. So the same defect has to
  // become the same thing on both paths — one sentence naming the reader, written down as a refusal
  // record and blocking the node — and that is what the gate is for.
  const failures = validateReading(
    { id: 'dc-qor-report', emits: ['clock_period'] },
    [{ type: 'clock_period', unit: 'ns', value: null }],
    bundleSemantics().values,
  );
  assert.equal(failures.length, 1, `one sentence, not none: ${JSON.stringify(failures)}`);
  assert.match(failures[0]!, /reader "dc-qor-report" read clock_period as unknown and says nothing about why/, failures[0]!);

  // And a value that says why is no failure at all: the invariant is about silence, not about a
  // reader admitting that a report does not state something.
  assert.deepEqual(
    validateReading(
      { id: 'dc-qor-report', emits: ['clock_period'] },
      [{ type: 'clock_period', unit: 'ns', value: null, unknownReason: 'this report states no clock period' }],
      bundleSemantics().values,
    ),
    [],
  );
});

test('a reader on a record identifies a pack script by its file and the hash of the bytes that ran, or by neither: a record carrying one of the two is not one this ledger can be opened over', async (t) => {
  // The pair is what identifies a pack reader — a pack folder is plain files a person edits, so an
  // id and a version alone say nothing about which bytes produced a number — and `readerSaid` reads
  // *from the pair* on both card mounts, so a record carrying one of the two would be presented as a
  // reader this bundle ships, which is the one thing it is not.
  //
  // Written past the gate on purpose, which is the only way to write one: the fabric builds this
  // block from a script it read and hashed itself. What it demonstrates is why the schema is the
  // place the rule lives — a stored record that does not match its schema is not a bad row, it is a
  // ledger the next host cannot open at all.
  const badReaders: readonly (readonly [string, Record<string, unknown>])[] = [
    ['a script with no hash of the bytes that ran', { file: 'tools/count-candidates.sh' }],
    ['a hash of bytes with no script to name', { sha256: 'a'.repeat(64) }],
    ['a hash that is not 64 lower-case hex digits', { file: 'tools/count-candidates.sh', sha256: 'DEADBEEF' }],
    ['a script above the pack\'s own tools folder', { file: '../elsewhere.sh', sha256: 'a'.repeat(64) }],
  ];
  for (const [what, reader] of badReaders) {
    const h = await createHimaHome();
    await writeLocalSite(h);
    const report = await writeSampleReport(h);
    const host = await bootInProcess(h);
    let runId: string | undefined;
    try {
      const opened = await himaCommand(host, h.workspace, `/hima observe local ${report.rel}`);
      assert.equal(opened.kind, 'success', opened.text);
      runId = opened.runId!;
      await host.ctx.hima.ledger.appendObservation(runId, {
        path: report.rel,
        contentSha256: report.sha256,
        bytes: report.bytes,
        reader: { id: 'count-candidates', version: '1', reportKind: 'standin-candidates', emits: [], ...reader } as never,
        values: [],
      });
    } finally { await host.dispose(); }
    // Whatever comes back is disposed, including the host a ledger that *did* open would hand back:
    // a failed assertion must leave this machine as it found it, and an undisposed host holds the
    // process open long after the test has reported.
    let reopened: InProcessHost | undefined;
    try {
      reopened = await bootInProcess(h);
    } catch (err) {
      t.diagnostic(`refused on reopening (${what}): ${(err as Error).message.split('\n')[0]!}`);
    }
    try {
      assert.equal(reopened, undefined, `${what} is not a record this ledger can be opened over`);
    } finally {
      await reopened?.dispose();
      await h.dispose();
    }
  }
});

test('the whole pair — the script a pack reader is and the hash of the bytes that ran — reads back off the ledger as it was written', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  const hash = 'a'.repeat(64);
  let runId = '';
  try {
    const opened = await himaCommand(host, h.workspace, `/hima observe local ${report.rel}`);
    assert.equal(opened.kind, 'success', opened.text);
    runId = opened.runId!;
    const written = await host.ctx.hima.ledger.appendObservation(runId, {
      path: report.rel,
      contentSha256: report.sha256,
      bytes: report.bytes,
      reader: { id: 'count-candidates', version: '1', reportKind: 'standin-candidates', emits: [], file: 'tools/count-candidates.sh', sha256: hash },
      values: [],
    });
    assert.equal(written.reader.file, 'tools/count-candidates.sh');
    assert.equal(written.reader.sha256, hash);
  } finally { await host.dispose(); }
  // And the host that comes after opens over it, which is the other half of the pair being a shape
  // this ledger keeps rather than one it merely accepts.
  const next = await bootInProcess(h);
  try {
    const kept = next.ctx.hima.ledger.records({ runId, type: 'observation' }).at(-1);
    assert.equal(kept?.type === 'observation' ? kept.reader.sha256 : '', hash, 'the reopened ledger carries the reader whole');
  } finally { await next.dispose(); await h.dispose(); }
});

// ---------------------------------------------------------------------------------------------
// Ticket #61, fix pass 2: the durable boundary a reader's Job is picked up again across
// ---------------------------------------------------------------------------------------------

/** The reader block a launch writes, whole and valid: who read, where the answer goes, what was
 *  read. Built fresh for each case so a case that edits it cannot reach the next one. */
const launchedReadingBlock = (workspace: string): Record<string, unknown> => ({
  reader: {
    id: 'count-candidates',
    version: '1',
    reportKind: 'standin-candidates',
    emits: ['candidate_count'],
    file: 'tools/count-candidates.sh',
    sha256: 'a'.repeat(64),
  },
  out: `${workspace}/hima-readers/count-candidates/read-candidates-g1-a1.json`,
  report: { path: `${workspace}/flow/results/opene902/mine-timing/candidates.json`, contentSha256: 'b'.repeat(64), bytes: 412 },
});

test('what a reader\'s job was launched to read is one nested block on its launch record, parsed whole: a key nothing declares inside it, a block that does not say where the reader writes, and the three spread flat across the record are each a record the next host cannot open the domain over', async (t) => {
  // The record that decides the branch after a restart (#14): a `launched` record carrying this
  // block is a reader's Job and is read back from it, one carrying none is a tool's Job and settles
  // from its exit code. A schema that dropped an unknown key in silence would answer that question
  // over a block a person could no longer be sure of — and the three fields spread flat across a
  // record that accepts any key at all would make "is this a reader's Job?" three questions that can
  // disagree instead of one that cannot. So the block is strict, the record around it is strict, and
  // both are held here the only way a stored shape can be held: what is written past them is a
  // ledger the **next** host cannot open at all.
  const badLaunches: readonly (readonly [string, (workspace: string) => Record<string, unknown>])[] = [
    ['a reading carrying a key nothing declares', (w) => ({ reading: { ...launchedReadingBlock(w), semantics: 'semantics.yml' } })],
    ['a reading that does not say where the reader was told to write', (w) => {
      const { out: _out, ...rest } = launchedReadingBlock(w);
      return { reading: rest };
    }],
    ['the three spread flat across the record instead of nested in one block', (w) => launchedReadingBlock(w)],
  ];
  for (const [what, launch] of badLaunches) {
    const h = await createHimaHome();
    await writeLocalSite(h);
    const report = await writeSampleReport(h);
    const host = await bootInProcess(h);
    try {
      const opened = await himaCommand(host, h.workspace, `/hima observe local ${report.rel}`);
      assert.equal(opened.kind, 'success', opened.text);
      await host.ctx.hima.ledger.appendJob(opened.runId!, {
        event: 'launched',
        job: {
          session: 'hima-reader-fix2',
          pid: 4242,
          workspace: h.workspace,
          name: 'reader-count-candidates',
          startedAt: new Date().toISOString(),
          wire: 'tmux new-session -d -s hima-reader-fix2',
        },
        nodeId: 'read-candidates',
        ...launch(h.workspace),
      } as never);
    } finally { await host.dispose(); }
    // Whatever a ledger that *did* open hands back is disposed **before** anything is asserted: a
    // host left running holds this process open long after the test has reported, and a failed
    // assertion must leave this machine as it found it.
    let opened = false;
    try {
      const reopened = await bootInProcess(h);
      opened = true;
      await reopened.dispose();
    } catch (err) {
      t.diagnostic(`refused on reopening (${what}): ${(err as Error).message.split('\n')[0]!}`);
    }
    await h.dispose();
    assert.equal(opened, false, `${what} is not a record this ledger can be opened over`);
  }
});

test('the one gate refuses a bundled reader\'s value that carries a key nothing declares, in the same words it refuses a pack script\'s, and appends nothing', async () => {
  // **The controller's ruling for this pass, said plainly here**: the shape of a value is parsed in
  // one function that both paths call, and it is proven on one path through the product and on the
  // other at the function. `pack-readers.test.ts` drives a pack script whose output carries an
  // unknown key all the way to a refusal on the card; there is no seam through which a test can hand
  // the product a *bundled* reader that returns a defective value — a bundled reader is code in this
  // bundle, and a test double in place of one would be a test of the double. So the gate itself is
  // called here with what such a reader would return, and the sentence it refuses in is the sentence
  // the other path's record carries.
  //
  // What makes this worth a test at all is where a bundled reader's values otherwise meet a schema:
  // nowhere. A pack script's output is JSON and is parsed; a bundled reader produces TypeScript
  // objects, and a defect in one would be written straight into the ledger — where it is not a bad
  // row but a domain the **next host cannot open at all**.
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    const opened = await himaCommand(host, h.workspace, `/hima observe local ${report.rel}`);
    assert.equal(opened.kind, 'success', opened.text);
    const runId = opened.runId!;
    const before = host.ctx.hima.ledger.records({ runId, type: 'observation' }).length;
    const appended = await appendReading(
      host.ctx.hima.ledger,
      runId,
      {
        path: report.rel,
        contentSha256: report.sha256,
        bytes: report.bytes,
        // A bundled reader as every observation carries one: an id and a version, and neither a file
        // nor a hash, because a reader this bundle ships is not a script in anybody's pack folder.
        reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] },
        values: [{ type: 'clock_period', unit: 'ns', value: 2, units: 'ns' }],
      },
      bundleSemantics().values,
    );
    assert.equal(appended.kind, 'refused', `a value carrying a key nothing declares is refused, not stored: ${JSON.stringify(appended)}`);
    assert.match(
      appended.record.type === 'refusal' ? appended.record.reason : '',
      /reader "dc-qor-report" produced something that is not a value: value 1 \(of type "clock_period"\)/,
      `naming the reader and which value of its output: ${JSON.stringify(appended.record)}`,
    );
    assert.match(appended.record.type === 'refusal' ? appended.record.reason : '', /units/, 'and the key nothing declares');
    assert.equal(
      host.ctx.hima.ledger.records({ runId, type: 'observation' }).length,
      before,
      'and nothing was appended: a reading is refused whole or written whole',
    );
  } finally { await host.dispose(); await h.dispose(); }
});
