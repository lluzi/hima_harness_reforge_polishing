// Ticket #19: a Site's identity is the `name:` its own file states, never the string a caller typed
// or the file name that resolved it. Two files can claim the same `name:` — deliberately, as
// `alias.yml` here does, or by accident of a case-insensitive filesystem reading `LOCAL` as
// `local.yml` — and `loadSite` must refuse rather than let a caller's request run under an identity
// its own file never claimed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeAliasSite, writeLocalSite, writeSampleReport } from './support/site.ts';
import { clearRemoteCommands, remoteCommands } from '@hima/harness';
// Loads the `ctx.hima` declaration merge onto Context.
import type {} from '@hima/harness';

/** Both names the refusal must carry, whatever the face: the one asked for and the one the file states. */
function assertNamesBoth(err: unknown, asked: string, actual: string): true {
  assert.ok(err instanceof Error, `expected an Error, got ${String(err)}`);
  assert.match(err.message, new RegExp(`unknown site "${asked}"`), err.message);
  assert.match(err.message, new RegExp(`is the site file of "${actual}"`), err.message);
  assert.match(err.message, /a Site's name is the one its file states/, err.message);
  return true;
}

test('/hima observe refuses a site file whose name is not the name asked for, naming both, and opens no run', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  await writeAliasSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    await assert.rejects(
      () => himaCommand(host, h.workspace, `/hima observe alias ${report.rel}`),
      (err) => assertNamesBoth(err, 'alias', 'local'),
    );
    const hima = host.ctx.hima;
    assert.ok(hima, 'the hima service is on the host');
    assert.deepEqual(hima.ledger.runs(), [], 'a site the caller did not truly name opens no run');
  } finally {
    await host.dispose();
    await h.dispose();
  }
});

test('/hima job launch refuses a site file whose name is not the name asked for, naming both, and sends nothing to the Site', async () => {
  const h = await createHimaHome();
  await writeLocalSite(h);
  await writeAliasSite(h);
  const host = await bootInProcess(h);
  try {
    clearRemoteCommands();
    const marker = path.join(h.workspace, `marker-${randomUUID()}`);
    await assert.rejects(
      () => himaCommand(host, h.workspace, `/hima job launch alias ${h.workspace} --name aliascase -- sh -c "echo hi > ${marker}"`),
      (err) => assertNamesBoth(err, 'alias', 'local'),
    );
    const hima = host.ctx.hima;
    assert.ok(hima, 'the hima service is on the host');
    assert.deepEqual(hima.ledger.runs(), [], 'a site the caller did not truly name opens no run');
    assert.deepEqual(remoteCommands(), [], 'nothing reached the channel: the refusal happens before the Site is asked anything');
    assert.ok(!existsSync(marker), 'the workspace holds no file the refused command would have written');
  } finally {
    await host.dispose();
    await h.dispose();
  }
});

test('/hima observe LOCAL is refused: the mismatch wording when the file resolved on a case-insensitive filesystem, the plain unknown-site wording when it did not', async () => {
  const h = await createHimaHome();
  const { sitesDir } = await writeLocalSite(h);
  const report = await writeSampleReport(h);
  const host = await bootInProcess(h);
  try {
    // What this filesystem actually does with the case-insensitive read `loadSite` is about to make,
    // asked the same way the ticket's own diagnosis asks it — never assumed from the platform name.
    const resolvesCaseInsensitively = existsSync(path.join(sitesDir, 'LOCAL.yml'));
    await assert.rejects(
      () => himaCommand(host, h.workspace, `/hima observe LOCAL ${report.rel}`),
      (err) => {
        assert.ok(err instanceof Error, `expected an Error, got ${String(err)}`);
        assert.match(err.message, /unknown site "LOCAL"/, err.message);
        if (resolvesCaseInsensitively) {
          assert.match(err.message, /is the site file of "local"/, 'the file resolved, so the refusal names the mismatch');
          assert.match(err.message, /a Site's name is the one its file states/, err.message);
        } else {
          assert.match(err.message, /no site file at/, 'no LOCAL.yml exists on this filesystem, so this is the plain unknown-site refusal');
        }
        return true;
      },
    );
    const hima = host.ctx.hima;
    assert.ok(hima, 'the hima service is on the host');
    assert.deepEqual(hima.ledger.runs(), [], 'a site the caller did not truly name opens no run');
  } finally {
    await host.dispose();
    await h.dispose();
  }
});
