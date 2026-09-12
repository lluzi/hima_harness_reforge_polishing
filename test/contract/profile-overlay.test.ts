// Ticket #59: the model stand-in is an overlay on a seeded home, and the product profile is not
// touched by it.
//
// The oracle is dsh's own: `dsh --profile hima --dump-config` prints the composition the host would
// mount, layer by layer, with the file that changed each row named above it. So this suite asks the
// real CLI, as a subprocess, against two homes the product prepared — one given the stand-in and one
// not — and reads the two rows the stand-in is made of out of what dsh itself says it composed.
// `boot.test.ts` asks the same oracle about the Hima rows; this one asks it about the model route.
//
// Why it matters enough to test. A keyless test adapter standing in for the model is the one piece
// of this ticket that could silently stop being an overlay: a row appended to the profile's own
// patch layer would follow the profile, a manifest entry would follow the product, and either would
// be a shipped product that carries its test scaffolding. The overlay this harness writes lives in
// the home's own patch file, names the adapter by an absolute path resolved out of this checkout,
// and leaves `profiles/hima/` byte for byte what `prepareHimaHome` put there — which is what the
// last two tests here read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome, profileTemplateDir, repoRoot, runDsh } from './support/dsh-home.ts';
import { clearReplayOverlay, homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { writeMomentFixture } from './support/moments.ts';

/** The row ids the stand-in is made of: dsh's DeepSeek adapter, and its keyless replay one. */
const DEEPSEEK_ROW = 'llm-deepseek';
const REPLAY_ROW = 'llm-replay';

/**
 * The rows of a `--dump-config` document, by id.
 *
 * Read as text rather than parsed as YAML, for the reason ADR-0001 gives for never depending on this
 * output's byte layout: the document carries `!!js` expressions no ordinary YAML reader accepts, and
 * dsh promises nothing about its shape. A row starts at a line reading `- id: <id>` and runs to the
 * next row or the next layer comment, which is all this suite needs to ask whether a row is there
 * and what it says.
 *
 * @param dump - the CLI's standard output.
 * @returns each row's whole text, keyed by its id; a duplicate id keeps the last, as the loader does.
 */
function rowsOf(dump: string): Map<string, string> {
  const rows = new Map<string, string>();
  let id: string | undefined;
  let lines: string[] = [];
  const close = (): void => { if (id !== undefined) rows.set(id, lines.join('\n')); id = undefined; lines = []; };
  for (const line of dump.split('\n')) {
    const started = /^- id: (.+)$/.exec(line);
    if (started) { close(); id = started[1]!.trim(); lines = [line]; continue; }
    if (line.startsWith('# ') || line.startsWith('- ')) { close(); continue; }
    if (id !== undefined) lines.push(line);
  }
  close();
  return rows;
}

test('dsh --dump-config on a seeded home: the DeepSeek adapter is composed and there is no replay row, until the stand-in overlay is written', async () => {
  const h = await createHimaHome();
  try {
    const before = await runDsh(h, ['--profile', 'hima', '--dump-config'], 120_000);
    assert.equal(before.code, 0, `dsh dumped the composition: ${before.stderr}`);
    const plain = rowsOf(before.stdout);
    assert.ok(plain.has(DEEPSEEK_ROW), `the product profile composes dsh's DeepSeek adapter: ${[...plain.keys()].join(', ')}`);
    assert.ok(!plain.get(DEEPSEEK_ROW)!.includes('disabled: true'), `and composes it enabled: ${plain.get(DEEPSEEK_ROW)!}`);
    assert.ok(!plain.has(REPLAY_ROW), 'and composes no replay adapter at all');

    const fixture = await writeMomentFixture(h, 'one-turn');
    const said = await writeReplayOverlay(h.home, { file: fixture.file, overrideFile: fixture.override });
    assert.ok(said.includes(homePatchFile(h.home)), `the overlay says where it wrote itself: ${said}`);

    const after = await runDsh(h, ['--profile', 'hima', '--dump-config'], 120_000);
    assert.equal(after.code, 0, `dsh dumped the overlaid composition: ${after.stderr}`);
    const overlaid = rowsOf(after.stdout);

    // The DeepSeek adapter is still a row of the composition and is turned off, which is what "in
    // its place" means to the loader: a row config cannot disable a row, only the patch layer can.
    assert.ok(overlaid.get(DEEPSEEK_ROW)?.includes('disabled: true'), `the DeepSeek adapter is disabled: ${overlaid.get(DEEPSEEK_ROW)}`);
    const replay = overlaid.get(REPLAY_ROW);
    assert.ok(replay, `and the replay adapter is composed in its place: ${[...overlaid.keys()].join(', ')}`);
    assert.ok(replay.includes('dsh-llm-replay'), `the row names dsh's keyless replay adapter: ${replay}`);
    assert.ok(replay.includes(fixture.file), `pointed at the scenario's own fixture: ${replay}`);
    assert.ok(replay.includes(fixture.override), `and at its override sidecar: ${replay}`);
    assert.ok(replay.includes('deepseek-v4-flash'), `answering for the model the profile's default names: ${replay}`);
    assert.ok(after.stdout.includes(homePatchFile(h.home)), 'and dsh names the layer that changed it: the home\'s own patch file');

    // And it is an overlay: taken away, the composition is the product's own again.
    const removed = await clearReplayOverlay(h.home);
    assert.ok(removed?.includes(homePatchFile(h.home)), `the overlay says it took itself away: ${String(removed)}`);
    const cleared = rowsOf((await runDsh(h, ['--profile', 'hima', '--dump-config'], 120_000)).stdout);
    assert.ok(!cleared.has(REPLAY_ROW), 'the replay adapter goes when the overlay does');
    assert.ok(!cleared.get(DEEPSEEK_ROW)!.includes('disabled: true'), 'and the DeepSeek adapter comes back');
  } finally {
    await h.dispose();
  }
});

test('the stand-in overlay changes nothing the product ships: the seeded profile is the template, and the template names no replay adapter', async () => {
  const h = await createHimaHome();
  try {
    const fixture = await writeMomentFixture(h, 'one-turn');
    await writeReplayOverlay(h.home, { file: fixture.file, overrideFile: fixture.override });

    // The profile in the home is still the template, byte for byte: the overlay is not in it.
    for (const name of ['cordis.patch.yml', 'package.json']) {
      const seeded = await readFile(path.join(h.profileDir, name), 'utf8');
      const template = await readFile(path.join(profileTemplateDir, name), 'utf8');
      assert.equal(seeded, template, `the seeded profile's ${name} is the template the product ships`);
      assert.ok(!seeded.includes('llm-replay'), `and names no replay adapter: ${name}`);
    }

    // Nor is it in the checkout's own copies, which is where a leak would have to end up to ship.
    for (const name of ['cordis.patch.yml', 'package.json']) {
      const template = await readFile(path.join(repoRoot, 'profiles/hima', name), 'utf8');
      assert.ok(!template.includes('dsh-llm-replay'), `the product profile's ${name} does not depend on the replay adapter`);
    }
    const bundlePatch = await readFile(path.join(repoRoot, 'packages/harness/cordis.patch.yml'), 'utf8');
    assert.ok(!bundlePatch.includes('llm-replay'), 'and neither does the bundle patch');
  } finally {
    await h.dispose();
  }
});

test('taking the stand-in away takes away only the file this shell wrote: a person\'s own patch layer is left alone', async () => {
  const h = await createHimaHome();
  try {
    // `$DSH_HOME/cordis.patch.yml` is dsh's documented place for a person's own tweaks, and every
    // boot of the window — driven or not — passes through the removal. A boot that swept a person's
    // file away because it happened to be in the way would be this shell deleting somebody's
    // configuration for them, once per launch, silently.
    const mine = '# mine, not the harness\'s\n- id: session-title-llm\n  disabled: true\n';
    await writeFile(homePatchFile(h.home), mine);

    const said = await clearReplayOverlay(h.home);
    assert.ok(said?.includes('left'), `the shell says it left the file alone: ${String(said)}`);
    assert.equal(await readFile(homePatchFile(h.home), 'utf8'), mine, 'and the file is exactly as it was');

    // A home with no such file at all is not a thing to report, and not an error either.
    const empty = await createHimaHome();
    try {
      assert.equal(await clearReplayOverlay(empty.home), undefined, 'a home with no patch layer says nothing');
    } finally {
      await empty.dispose();
    }
  } finally {
    await h.dispose();
  }
});
