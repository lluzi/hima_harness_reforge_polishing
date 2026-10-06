// PLS-20: migrated unchanged assertions to the real Host/local seam.
// Replay is a mechanism stand-in; no Electron, real model or SSH is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { installPack, installWorkshopPack, packReaderId, packsDirOf, workshopDirectory, workshopEntry, workshopGraph, workshopId, type WorkshopVariation } from './support/pack.ts';


test('a workshop declaration this harness will not run is refused before a campaign exists, naming the field', async (t) => {
  const home = await createHimaHome();
  const flow = await writeStandinFlow(t, home);
  if (!flow) { await home.dispose(); return; }
  await installPack(home);
  await writeLocalSite(home, {
    allowedReadRoots: [home.workspace, flow.root],
    allowedWriteRoots: [home.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: home.workspace },
  });
  const h = await bootInProcess(home);
  try {
    const packsDir = packsDirOf(home);
    const good = await installWorkshopPack(packsDir, 'workshop-check-ok');
    const said = await himaCommand(h, home.workspace, `/hima pack check ${good} --site local`);
    assert.ok(
      said.text.includes(`${workshopId} — sh, writes ${workshopDirectory}/${workshopEntry}, produces candidates (read by ${packReaderId})`),
      `pack check prints the workshops line: ${said.text}`,
    );
    assert.ok(said.text.includes('workshops:'), `under its own heading: ${said.text}`);

    // Every way a declaration can be one no campaign of this pack could run, each refused with the
    // field it is wrong about in the sentence.
    const refusals: readonly (readonly [string, WorkshopVariation, RegExp])[] = [
      ['workshop-check-no-reader', { produces: 'synthesisLog' }, /produces "synthesisLog", which declares no reader/],
      ['workshop-check-wrapper', { argv: ['bash', '${ENTRY}'] }, /runs "bash", which environment\.wrappers does not declare/],
      ['workshop-check-climb', { directory: '../out' }, /the directory .{0,2}\.\.\/out.{0,2} names .{0,2}\.\..{0,2}, which is not a plain path segment/],
      ['workshop-check-flow', { directory: 'flow' }, /names the directory .{0,2}flow.{0,2}, and .{0,2}flow.{0,2} is the campaign workspace's own/],
      // The other directory the workspace anatomy owns: a workshop put there would have the model
      // writing over the scripts this pack's own readers are shipped as.
      ['workshop-check-readers', { directory: 'hima-readers' }, /names the directory .{0,2}hima-readers.{0,2}, and .{0,2}hima-readers.{0,2} is the campaign workspace's own/],
      ['workshop-check-knowledge', { knowledge: ['nowhere.md'] }, /knowledge file "nowhere\.md", which/],
      // A wrapper the contract *does* declare and the Site's own Permit refuses. Nothing at load can
      // catch this one — the contract is consistent with itself — so it is the case that says the
      // check really asks the Permit rather than only re-reading the contract.
      ['workshop-check-permit', { wrappers: ['tclsh'], argv: ['tclsh', '${ENTRY}'] }, /workshop "mine": "tclsh" is not an allowed wrapper of site local/],
      // A seat of a licence this Site does not declare: a job of this workshop could never launch
      // there, and saying so before a campaign exists is the whole of what the check is for.
      ['workshop-check-licence', { licences: { 'Some-Licence': 1 } }, /workshop "mine" holds 1 of "Some-Licence": site local does not declare it/],
      // The wrapper is a literal word or it is nothing: `checkPack` reads `argv[0]` as it stands and
      // the launch runs the word it substituted, so a placeholder there would be two different words.
      ['workshop-check-placeholder', { argv: ['${ENTRY}', '${WORKSPACE}'] }, /the first word of a workshop's argv is the wrapper itself/],
      // And a placeholder *inside* the first word is the same fault: the check judges `runner-${ENTRY}`
      // and the launch runs `runner-/…/miner.sh`, which are two different wrappers.
      ['workshop-check-wrapper-inside', { argv: ['runner-${ENTRY}', '${ENTRY}'] }, /the first word of a workshop's argv is the wrapper itself/],
      // **The command line is the wrapper, then the entry as its first operand, then the rest.** A
      // declaration that never names `${ENTRY}` launches something else while the launch record says
      // the entry's own hash is what ran; one that names it twice runs it as its own argument; and
      // one that names it anywhere but second hands the wrapper some other word to act on first,
      // which is the shape `sh -c '<program>' <entry>` has — an inline program the ledger holds no
      // record of, with the verified file as its `$0`. Position is what refuses that shape, and a
      // count alone cannot: the last of these passes the count.
      ['workshop-check-no-entry', { argv: ['sh', '-c', 'exit 0'] }, /a workshop's command line is the wrapper, then the entry as its first operand \(argv\[1\] is exactly \$\{ENTRY\}\), then the rest/],
      ['workshop-check-entry-twice', { argv: ['sh', '${ENTRY}', '${ENTRY}'] }, /a workshop's command line is the wrapper, then the entry as its first operand \(argv\[1\] is exactly \$\{ENTRY\}\), then the rest/],
      ['workshop-check-entry-late', { argv: ['sh', '${WORKSPACE}', '${ENTRY}'] }, /a workshop's command line is the wrapper, then the entry as its first operand \(argv\[1\] is exactly \$\{ENTRY\}\), then the rest/],
      ['workshop-check-entry-inline', { argv: ['sh', '-c', 'exit 0', '${ENTRY}'] }, /a workshop's command line is the wrapper, then the entry as its first operand \(argv\[1\] is exactly \$\{ENTRY\}\), then the rest/],
      // **A name the harness binds itself, declared as this workshop's own.** `inputs` are the names
      // the *node* supplies, and a declaration listing one of the six the harness computes is a pack
      // asking for a value it will never be given — or, worse, asking to be given one instead of the
      // harness's, which is what the node-argument rule below refuses from the other side.
      // (A schema issue rather than a loader sentence, so the check prints it as the JSON zod made:
      // the quotes around the name come back escaped, and the pattern allows either spelling.)
      ['workshop-check-input-reserved', { inputs: ['WORKSHOP'] }, /declares the input \\?"WORKSHOP\\?", which the harness binds itself for a workshop/],
      // And the same class from the node's side: an argument bound at the act node under one of the
      // six. Left to run, `ENTRY: '-c'` would make `sh ${ENTRY} …` launch as `sh -c …` — an inline
      // program — while the launch record still carried the verified entry's path and hash.
      [
        'workshop-check-node-binds-entry',
        { graph: (id: string) => workshopGraph(id).replace(`      workshop: ${workshopId}`, `      workshop: ${workshopId}\n      arguments:\n        ENTRY: '-c'`) },
        /node "mine" binds "ENTRY", which the harness binds itself for a workshop/,
      ],
    ];
    for (const [id, vary, expected] of refusals) {
      await installWorkshopPack(packsDir, id, vary);
      const answer = await himaCommand(h, home.workspace, `/hima pack check ${id} --site local`);
      assert.match(answer.text, expected, `pack ${id} is refused naming the field: ${answer.text}`);
    }
  } finally {
    await h.dispose();
    await home.dispose();
  }
});


