// Ticket #21: a licence is one of the Site's slots, taken and counted exactly as a Job slot is.
//
// A Site declares how many of each licence it has (`capacity.licences`); a pack's contract declares
// how many of each a Job of one of its tools holds (`tools[].licences`). A launch that would take
// more of a licence than the Site declares waits for one, with the same `waiting-for-slot` record,
// the same run-view flag and the same wake-up the parallel job cap uses — one cap, whose slots are
// the Site's parallel Job count and each of its declared licences. What every Job held is on its
// `launched` record, and what a Run spent is on its meters.
//
// A licence the Site does not declare, or declares none of, is caught before a Campaign exists:
// `/hima pack check` says unfit naming it, and `/hima run` answers the same, because a Run that
// launched such a Job could only wait for a slot that will never come free.
//
// Local site and the stand-in flow only; the reference site is #31. Both seams: the booted host and
// its routes for what a person sees of a Run, and the in-process host for the two command faces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localFabric } from './support/fabric.ts';
import { himaCommand } from './support/command.ts';
import { packsDirOf, writePackVariant } from './support/pack.ts';

/** The line the shipped contract gives its Design Compiler tool, and what a variant makes of it: one
 *  seat of a licence the local site can be told to declare however many of. */
const shippedLicenceLine = '    licences:\n      Design-Compiler: 1';
const variantLicenceLine = '    licences:\n      synopsys: 1';

/** The shipped pack again, holding one `synopsys` seat instead of the Design Compiler one. */
async function writeSynopsysPack(packsDir: string, id: string): Promise<string> {
  const varied = await writePackVariant(packsDir, id, [[shippedLicenceLine, variantLicenceLine]]);
  assert.match(varied, /^ {6}synopsys: 1$/m, 'the shipped contract is the one being varied');
  return varied;
}

test('a site that declares none of a licence can never host a tool that holds it, and says so rather than letting a run wait for ever', async (t) => {
  // The reference site's own Innovus line: an uncounted node-locked tool has no seats to budget, so
  // nothing may be reserved. A Run of a pack that reserved one would sit in `waiting-for-slot` until
  // its time box ran out, which is a slow way of saying what the check can say at once.
  const local = await localFabric(t, { licences: { synopsys: 0 } });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    await writeSynopsysPack(packsDirOf(h), 'reserves-none');
    const checked = await himaCommand(host, h.workspace, '/hima pack check reserves-none --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /^pack reserves-none@2 on site local: unfit\b/, checked.text);
    assert.match(
      checked.text,
      /tool "synth" holds 1 of "synopsys": site local declares 0 of it, so a job of this tool could never launch there/,
      checked.text,
    );
  } finally {
    await dispose();
  }
});

