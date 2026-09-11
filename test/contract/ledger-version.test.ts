// The HimaLedger's version gate: a ledger stored under an older domain version is refused when the
// host opens it, rather than migrated, or read as though the shapes had not moved.
//
// This is the half of every ledger bump that nothing else in the suite covers. The bump log in
// `packages/harness/src/ledger.ts` argues, entry by entry, that each growth is in the direction a
// version gate exists for — a record or a row an older spec would refuse outright, or worse, read
// while silently dropping a field. That argument is only worth as much as the gate, and the gate is
// dsh's: `defineDomain` states a version, the storage backend rejects a stored unit whose version
// differs, and the domain layer passes that refusal through (`version-mismatch`). What this test
// holds is that the refusal really reaches a person on this machine, through this shell, with the
// ledger this harness actually writes — and that nothing in the harness quietly opens it anyway.
//
// Driven at the one seam (D42, ADR-0004): a shell boots, writes a Campaign, and goes; the version
// stored in its home is put back by one; a second shell boots on that same home and does not come
// up. The only thing reached for behind the seam is the one number, in the one file dsh's own JSON
// backend documents as the unit's identity — no record is rewritten, no table is touched, and the
// number is read back out of the file rather than named here, so a later bump needs no edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bootDriver, type BootedDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { timingProbePackId } from './support/pack.ts';
import type { RunView } from '@hima/harness';

/**
 * The whole-unit document the `json` backend keeps one of per domain, as much of it as this test
 * reads: `<DSH_HOME>/storages/<unit>.json`, holding the unit's name and version beside its tables.
 *
 * Spelled here and nowhere else, because it is the one thing this test knows that a face does not.
 */
interface StoredUnit {
  readonly unit: { name: string; version: number };
  readonly tables: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const storedLedgerAt = (home: string): string => path.join(home, 'storages', 'hima_ledger.json');

test('a HimaLedger stored under an older domain version is refused when the next shell opens it, and that shell says so instead of coming up', async (t) => {
  const first = await bootDriver(t, { home: 'hima' });
  if (!first) return;
  let second: BootedDriver | undefined;
  try {
    const host = await first.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await first.cookie();

    // One Generation, so the ledger this test is about holds a real Campaign — a row, its records
    // and its decision — rather than an empty unit no version could matter to. The `single` layout
    // materializes its file on the first write, so the Run is also what puts the file there at all.
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        pack: timingProbePackId,
        site: 'local',
        goal: { target_period_ns: 2.0 },
        strategy: { periodNs: 2.4 },
        generations: 1,
      }),
      headers: { 'content-type': 'application/json' },
    });
    const text = await started.text();
    assert.equal(started.status, 200, text);
    const view = JSON.parse(text) as RunView;
    assert.equal(view.run.status, 'ended-budget-exhausted', `the one generation it was allowed: ${text}`);

    const quit = await first.quit();
    assert.ok(quit.ok, JSON.stringify(quit));
    await first.exit();
    // Nothing but the driver's own answers came back on that shell's stdout, for the whole of its
    // life (ADR-0004). Asserted here rather than at the end, because the subject below is a shell
    // that never comes up at all, and a stray line from the one that did would have nowhere else to
    // be caught.
    assert.deepEqual(first.unexpectedStdout(), []);

    // The home as it now stands: this harness's own domain, holding the Run that was just written.
    const at = storedLedgerAt(first.home.home);
    const stored = JSON.parse(readFileSync(at, 'utf8')) as StoredUnit;
    assert.equal(stored.unit.name, 'hima_ledger', `the stored unit is this harness's ledger: ${at}`);
    assert.ok(Number.isInteger(stored.unit.version), `stamped with the domain's version: ${JSON.stringify(stored.unit)}`);
    assert.ok(stored.tables.runs?.[view.run.id], `holding the Campaign the first shell ran: ${JSON.stringify(Object.keys(stored.tables.runs ?? {}))}`);

    // What a person has after upgrading the app over a ledger an older build wrote — said the other
    // way round, because a ledger from the future is not a thing this repository can make: the
    // stored version goes back by one and everything else stays exactly as it was written.
    const current = stored.unit.version;
    const older = current - 1;
    stored.unit.version = older;
    writeFileSync(at, `${JSON.stringify(stored, null, 2)}\n`);

    let refusal: string | undefined;
    try {
      second = await bootDriver(t, { existing: first.home });
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err);
    }
    assert.ok(second === undefined, 'no second shell came up on a ledger this build cannot open');
    assert.ok(refusal !== undefined, 'the second boot refused rather than skipping');
    // The words the shell puts in front of a person: on the page in a windowed launch, on stderr
    // here, because a driver run has a console and must never wait on an error shown to nobody.
    assert.match(refusal, /hima-desktop: The hima profile did not start/, refusal);
    // And dsh's own account of why, naming the unit and both versions.
    assert.ok(
      refusal.includes(`unit 'hima_ledger': stored version ${String(older)} != expected ${String(current)}`),
      `the refusal names the ledger and the two versions: ${refusal}`,
    );
    assert.match(refusal, /version-mismatch/, `and the stable code dsh refuses it under: ${refusal}`);

    // Refused, not repaired: the file is left exactly as it was found, so the ledger a person would
    // take to the build that wrote it is still there to take.
    const after = JSON.parse(readFileSync(at, 'utf8')) as StoredUnit;
    assert.equal(after.unit.version, older, 'nothing migrated the stored unit on the way to refusing it');
    assert.ok(after.tables.runs?.[view.run.id], 'and the Campaign it holds is untouched');
  } finally {
    if (second) await second.dispose();
    await first.dispose();
  }
});
