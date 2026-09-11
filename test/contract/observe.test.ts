// Ticket #3: observe a file into a durable ledger under a permit, over a local channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
// Loads the `ctx.hima` declaration merge onto Context.
import type {} from '@hima/harness';

test('/hima observe records one observation with provenance in a durable ledger', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    const { kind, text, runId } = await himaCommand(host, h.workspace, `/hima observe local ${report.rel}`);
    assert.equal(kind, 'success', text);
    assert.ok(runId, 'the run identity is reported');
    assert.match(text, new RegExp(report.sha256), 'the content hash is reported');

    const hima = host.ctx.hima;
    assert.ok(hima, 'the hima service is on the host');
    const run = hima.ledger.run(runId);
    assert.ok(run, 'the run exists in the ledger');
    assert.equal(run.siteId, 'local');
    assert.ok(run.campaignId, 'the run belongs to a campaign');
    const records = hima.ledger.records({ runId });
    assert.equal(records.length, 1);
    const rec = records[0]!;
    assert.equal(rec.type, 'observation');
    assert.equal(rec.writer, 'executor');
    assert.equal(rec.seq, 1);
    assert.equal(rec.siteId, 'local');
    assert.equal(rec.type === 'observation' ? rec.path : '', report.rel);
    assert.equal(rec.type === 'observation' ? rec.contentSha256 : '', report.sha256);
    assert.equal(rec.type === 'observation' ? rec.bytes : 0, report.bytes);
    assert.deepEqual(
      rec.type === 'observation' ? rec.reader : null,
      { id: 'raw', version: '1', reportKind: 'raw', emits: [] },
      'the raw reader declares that it accepts any bytes and emits no semantics',
    );
    assert.ok(Date.parse(rec.at) > 0, 'the record is timestamped');
  } finally {
    await host.dispose();
    await h.dispose();
  }
});
