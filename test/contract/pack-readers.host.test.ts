// PLS-20: migrated unchanged assertions to the real Host/local seam.
// Replay is a mechanism stand-in; no Electron, real model or SSH is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import { installPack, installPackReader, packReaderFile, packReaderId, packReaderScript, packsDirOf } from './support/pack.ts';


/** The first twelve characters of a hash, which is how much of it a card shows. */
const shortSha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);


test('a site whose permit will not run the wrapper a reader declares is unfit before a campaign exists, and the check names the wrapper and what the site does allow', async (t) => {
  // The words of `/hima pack check`, which is a chat command and the one thing `bootInProcess` is
  // for. A Permit is the Site owner's and this is the one test here that needs a second one, so the
  // home is made by hand rather than by the driver's own seeding.
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, { sleepSeconds: 0 });
  if (!flow) { await h.dispose(); return; }
  await installPack(h);
  // A Permit that allows `make` and nothing else: the stand-in flow still runs, and the reader's own
  // `sh` does not.
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    allowedWrappers: ['make'],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
  });
  const host = await bootInProcess(h);
  try {
    const pack = await installPackReader(packsDirOf(h), 'pack-reader-unpermitted');
    const checked = await himaCommand(host, h.workspace, `/hima pack check ${pack} --site local`);
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(
      checked.text,
      /reader "count-candidates", named by output "candidates", runs its script with "sh" is not an allowed wrapper of site local \(allowed: make\)/,
      `the refusal names the reader, the wrapper it wanted and what this site allows: ${checked.text}`,
    );
    assert.match(checked.text, /^pack pack-reader-unpermitted@2 on site local: unfit\b/m, `and the pack is unfit: ${checked.text}`);
  } finally {
    await host.dispose();
    await h.dispose();
  }
});


test('`/hima status` names the reader of the run\'s latest reading, in the words both card mounts say it in', async (t) => {
  // The command face and the window must say one thing about one reading (D42's spirit and the
  // card's own rule): a person who reads a Campaign at a terminal and a person watching it in the
  // window are looking at the same observation, and for a pack reader the id and version alone do
  // not identify what ran — a pack folder is plain files a person edits. So the line carries the
  // file and the hash of the bytes that were shipped, in `readerSaid`'s one spelling.
  //
  // Driven through `bootInProcess`, which is what the words of a chat command are for.
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, { sleepSeconds: 0 });
  if (!flow) { await h.dispose(); return; }
  await installPack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
  });
  const host = await bootInProcess(h);
  try {
    const pack = await installPackReader(packsDirOf(h), 'pack-reader-said', {});
    const ran = await himaCommand(host, h.workspace, `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --generations 1`, 300_000);
    for (const line of ran.text.split('\n')) t.diagnostic(line);
    assert.equal(ran.kind, 'success', ran.text);
    const runId = ran.runId!;
    const said = `read by ${packReaderId}@1 · pack script ${packReaderFile} sha256 ${shortSha(packReaderScript)}`;
    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    const reading = status.text.split('\n').find((l) => l.trim().startsWith('latest reading:'));
    assert.ok(reading, `the status carries the run's latest reading: ${status.text}`);
    assert.ok(reading.includes(said), `naming the reader, its file and the hash of the bytes that ran: ${reading}`);
    assert.ok(reading.includes('candidates.json'), `beside the report it is a reading of: ${reading}`);
    // And the run's own answer says it too, because both are `describeRun` and a person must not
    // have to ask twice to be told the same thing.
    assert.ok(ran.text.includes(said), `and so does the run it came from: ${ran.text}`);
  } finally {
    await host.dispose();
    await h.dispose();
  }
});
