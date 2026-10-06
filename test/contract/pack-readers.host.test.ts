// PLS-20: migrated unchanged assertions to the real Host/local seam.
// Replay is a mechanism stand-in; no Electron, real model or SSH is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import { installPack, installPackReader, packsDirOf } from './support/pack.ts';


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


