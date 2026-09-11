// The workbench page, photographed (issue #41): one converged Campaign on the stand-in flow, its
// card captured from a real window in the light palette and in the dark one.
//
// A tool, not a test. It exists because the deliverable of a design ticket is a picture a person can
// hold beside the chat's card and say "that is one product" — and because a page nobody has looked
// at is a page nobody has designed. It writes two PNGs and prints their paths; the committed pair
// lives under `docs/validation/` and is linked from the README.
//
// It drives the product the way every step-3 test does and the way an engineer does (D42,
// ADR-0004): the desktop shell in driver mode, on a throwaway home of its own, with the Campaign
// started by filling the workbench's own form and clicking start. Nothing here reaches into the
// bundle's modules, and nothing here touches a Site that is not the stand-in — the flow is generated
// into the isolated home, and the reference site is never asked for anything.
//
// Two windows, one home, one Run: the first shell starts the Campaign and is photographed in the
// light palette, then quits; the second joins the same home (`bootDriver`'s `existing`), opens the
// very same Run, and is photographed in the dark one. So the two pictures are two palettes of one
// page and not two Campaigns that happened to converge alike.
//
// `--pack-variant drill-down` photographs a different card instead (#28): the pack variant whose
// Explore node opens a Loop of its own — the very one `test/contract/drill-down.test.ts` drives — so
// the nested rows under a generation are a picture and not only a description. That is one page and
// one palette, because what it shows is a shape the ledger takes and not a colour it is drawn in.
// `--pack-variant fork-join` is the same for the fork (#29): the variant whose entry node branches
// into two syntheses judged at one join, driven by `test/contract/fork-join.test.ts`, so the branch
// rows and the join's line under the generation that forked them are a picture too. It is
// photographed on a Site declaring two job slots, because a fork on one slot is a fork nobody can
// see running.
//
// Idempotent, and it puts the home back: the home is made under `os.tmpdir()` and disposed however
// this ends, and the two files are overwritten where they already exist.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { bootDriver, waitForKnobs, type BootedDriver } from '../test/contract/support/driver.ts';
import { repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { drillDownPackId, forkJoinPackId, forkLooserNs, installDrillDown, installFork, installOverConstraining, packsDirOf } from '../test/contract/support/pack.ts';

const usage = `usage: node scripts/workbench-screenshot.ts [--site local] [--out <dir>] [--window <w>x<h>]
                                                  [--zoom <factor>] [--pack-variant drill-down|fork-join]

  --site local     the only site this script photographs: the stand-in flow, generated into an
                   isolated home. A reference Site is never asked for anything here.
  --out <dir>      where the PNGs go; the default is docs/validation/.
  --window <w>x<h> the window to photograph through, in the OS's own pixels; the default is 1200
                   page pixels wide at the zoom below, by 900 tall. A capture is the window's own
                   viewport, so this is what decides how much of the card is in the picture — and a
                   display clamps a window to its work area, however tall a window is asked for.
  --zoom <factor>  the page zoom to photograph at, as the window's own View menu sets it. The
                   default is 1, and 0.85 for the fork variant, whose card is taller than the
                   tallest window this Mac's display allows.
  --pack-variant drill-down|fork-join
                   photograph a variant's card instead of the shipped pack's — one picture, in the
                   light palette, of a ledger with a nested Loop's rows in it, or of one with a
                   fork's branch rows and its join in it.`;

const argv = process.argv.slice(2);
const knownOptions = ['--site', '--out', '--window', '--zoom', '--pack-variant'];

function fail(why: string): never {
  console.error(`${why}\n${usage}`);
  process.exit(2);
}

function option(name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} was given no value`);
  return value;
}

for (const word of argv) {
  if (word.startsWith('--') && !knownOptions.includes(word)) fail(`unknown option "${word}"`);
}
const siteName = option('--site') ?? 'local';
if (siteName !== 'local') fail(`unknown site "${siteName}": this script photographs the stand-in site "local" and nothing else`);
const outDir = option('--out') ?? path.join(repoRoot, 'docs/validation');
const packVariant = option('--pack-variant');
const variants = [drillDownPackId, forkJoinPackId];
if (packVariant !== undefined && !variants.includes(packVariant)) {
  fail(`unknown pack variant "${packVariant}": this script photographs ${variants.map((v) => `"${v}"`).join(', ')} and the shipped pack`);
}

/** The date the committed pair is named after, which is the date they were taken. */
const today = new Date().toISOString().slice(0, 10);

/**
 * The page zoom the pictures are taken at, which is what this window's own View menu sets.
 *
 * It is here because a window is bounded by the display it stands on: macOS clamps every window to
 * the work area — 868 px on the Mac these were taken on, so 836 px of page whatever `--window` asks
 * for, and `setContentSize` does not get past it either — and the fork variant's card is taller than
 * that, so at 100 % the join line the ticket is named for falls at the bottom edge. Zooming out is
 * what a person does to see the whole of a long page; the picture is taken the same way, and only
 * for the variant that needs it.
 */
const ZOOM = ((raw: string | undefined): number => {
  if (raw === undefined) return packVariant === forkJoinPackId ? 0.85 : 1;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0.25 || value > 5) fail(`--zoom ${raw} is not a zoom factor between 0.25 and 5`);
  return value;
})(option('--zoom'));

/** How wide the page is shown, in its own pixels: the width every capture is framed at, whatever
 *  zoom it was taken at. 1200, so the content column is shown at its full 1040 px and the page is
 *  not photographed at a width nobody uses. */
const PAGE_WIDTH = 1200;

/**
 * The window the pictures are taken through, in the OS's own pixels.
 *
 * The default width is `PAGE_WIDTH` at the zoom being used, so every capture frames the page at the
 * same 1200 of its own pixels and the zoom changes only how much of it is inside the window. The
 * default height is 900, which is what the whole verdict band, the convergence plot, the generation
 * ledger and the path are laid out to fit inside — a window's frame takes a few of those pixels
 * back, and a display with less room than that takes the rest, which is what the zoom above is for.
 */
const WINDOW = ((raw: string | undefined): { readonly width: number; readonly height: number } => {
  if (raw === undefined) return { width: Math.round(PAGE_WIDTH * ZOOM), height: 900 };
  const found = /^(\d+)x(\d+)$/.exec(raw);
  if (found === null) fail(`--window ${raw} is not a size; it is written as <width>x<height>, as in 1200x900`);
  return { width: Number(found[1]), height: Number(found[2]) };
})(option('--window'));

/** The pack the default picture is of (#54): the shipped pack varied onto `over-constraining-push`,
 *  which is what the suite's own Loop tests drive. The stand-in reports slack the way Design Compiler
 *  does — nothing at all for a period it meets — and the reference pack's `timing-push` reaches no
 *  ending of its own on that (D45), so a picture of a converged card is a picture of this pack. */
const overConstrainingPackId = 'over-constraining-probe';

/** What the form is filled with: the converging Campaign of the contract suite's own Loop tests — a
 *  2.00 ns goal against a flow that closes at 2.20, which misses by 0.20, asks for one step less than
 *  the 2.20 that violation states, and stops learning at 2.15. */
const FORM = {
  'start-pack': overConstrainingPackId,
  'start-site': 'local',
  'start-target': '2.0',
  'start-knob-periodNs': '2.0',
  'start-time-box': '10',
  'start-retries': '2',
} as const;

/**
 * What is started, and what the card is photographed showing.
 *
 * The over-constraining variant converges; the drill-down variant's outer graph runs out of edges
 * once its Loop has converged and the Run ends having not met the Goal, which is what its own
 * contract test asserts. Each is waited for by the words its seal actually carries, so a Campaign
 * that ended some other way is a failure here and not a picture of the wrong thing.
 */
const CAMPAIGN = packVariant === undefined
  ? { pack: overConstrainingPackId, said: 'ended — converged', status: 'ended-converged', shot: 'light' }
  : { pack: packVariant, said: 'ended — goal not met', status: 'ended-goal-not-met', shot: packVariant };

/** What the drill-down variant's own Loop is allowed, which is the shipped pack's own bound and what
 *  the contract test installs it with: enough that it converges on what it learns rather than on a
 *  meter running out. */
const DRILL_DOWN_GENERATIONS = 6;

/** What the fork variant is photographed on: one job slot per branch, so both really run at once and
 *  the picture is of a fork rather than of two syntheses that happened to take turns. */
const FORK_JOB_SLOTS = 2;

/** Install whichever variant is being photographed into the home the shell was booted on, with what
 *  its own contract test installs it with — a picture of a pack the suite does not drive would be a
 *  picture of something nobody tested. */
const installVariant = async (home: HimaHome): Promise<void> => {
  if (packVariant === undefined) await installOverConstraining(packsDirOf(home), CAMPAIGN.pack);
  if (packVariant === drillDownPackId) await installDrillDown(packsDirOf(home), CAMPAIGN.pack, DRILL_DOWN_GENERATIONS);
  if (packVariant === forkJoinPackId) await installFork(packsDirOf(home), CAMPAIGN.pack, forkLooserNs);
};

/** How long the Campaign is given to reach its ending on the stand-in. */
const CONVERGE_MS = 180_000;

/** A skip is not available to a script: a machine that cannot open a window cannot take a picture
 *  of one, and says so rather than writing nothing and exiting zero. */
const noSkip = {
  skip: (reason?: string) => {
    throw new Error(`this machine cannot open a window to photograph: ${reason ?? 'no reason given'}`);
  },
} as unknown as TestContext;

/** One driver answer, or the reason it was refused, said with what was asked for. */
function ok<T>(what: string, answer: { readonly ok: true } & T | { readonly ok: false; readonly error: string }): T {
  if (!answer.ok) throw new Error(`${what}: ${answer.error}`);
  return answer;
}

async function shoot(d: BootedDriver, runId: string, at: string): Promise<void> {
  ok(`open the card of ${runId}`, await d.open(`/hima/?run=${encodeURIComponent(runId)}`));
  // The zoom is set on the page that is about to be photographed, so a picture is never taken at
  // whatever zoom some earlier page was left at.
  if (ZOOM !== 1) {
    const zoomed = await d.request({ op: 'zoom', factor: ZOOM });
    if (!zoomed.ok) throw new Error(`zoom to ${String(ZOOM)}: ${String(zoomed.error)}`);
    // The page says what it now shows, so a picture framed at some other width than the one every
    // capture is framed at is a failure here rather than a surprise in the committed file.
    if (zoomed.innerWidth !== PAGE_WIDTH) {
      throw new Error(`the page shows ${String(zoomed.innerWidth)} of its own pixels across, not ${String(PAGE_WIDTH)} (a --window narrower than the page at this --zoom does this): ${JSON.stringify(zoomed)}`);
    }
  }
  // The card, not the top of the page: what the window is showing is what is photographed, and the
  // wait is what says the page has finished rendering this Run rather than the one before it.
  ok('wait for the card', await d.wait('run-status', CAMPAIGN.said, 30_000));
  const shot = ok('screenshot', await d.screenshot(at));
  console.log(`${shot.path}  ${String(shot.width)}×${String(shot.height)}  ${String(shot.bytes)} bytes  zoom ${String(ZOOM)}`);
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const light = await bootDriver(noSkip, {
    home: 'hima',
    window: WINDOW,
    theme: 'light',
    ...(packVariant === forkJoinPackId ? { parallelJobs: FORK_JOB_SLOTS } : {}),
  });
  if (!light) throw new Error('the shell did not boot');
  let dark: BootedDriver | undefined;
  try {
    // The variant is installed before the page is opened: the start form offers the packs the home
    // held when the host rendered it, and a pack installed afterwards is one nobody could choose.
    await installVariant(light.home);
    ok('open the workbench', await light.open('/hima/'));
    for (const [control, value] of Object.entries({ ...FORM, 'start-pack': CAMPAIGN.pack })) {
      ok(`fill ${control}`, await light.fill(control, value));
      if (control === 'start-pack') await waitForKnobs(light, value);
    }
    ok('click start', await light.click('start'));
    const ended = ok('wait for the campaign to end', await light.wait('run-status', CAMPAIGN.said, CONVERGE_MS));
    if (ended.state.status !== CAMPAIGN.status) {
      throw new Error(`the campaign ended ${String(ended.state.status)} rather than ${CAMPAIGN.status}: ${ended.text}`);
    }

    // The Run's id, off the page's own run list, which is where a person reads it too.
    ok('open the run list', await light.open('/hima/'));
    const listed = ok('read the run list', await light.read('runs'));
    const runId = /run-[0-9a-f-]+/.exec(listed.text)?.[0];
    if (runId === undefined) throw new Error(`the run list names no Run: ${listed.text}`);

    await shoot(light, runId, path.join(outDir, `${today}-workbench-card-${CAMPAIGN.shot}.png`));
    // One picture of a variant: what it shows is a shape the ledger takes, and the palette it is
    // drawn in is the pair above.
    if (packVariant !== undefined) return;

    // The same home, the same Run, the other palette. The first shell goes first: two hosts on one
    // dsh home would be two writers of one session lock.
    ok('quit the first shell', await light.quit());
    await light.exit();
    dark = await bootDriver(noSkip, { existing: light.home, window: WINDOW, theme: 'dark' });
    if (!dark) throw new Error('the second shell did not boot');
    await shoot(dark, runId, path.join(outDir, `${today}-workbench-card-dark.png`));
  } finally {
    if (dark) await dark.dispose();
    await light.dispose();
  }
}

main().catch((err: unknown) => {
  console.error(`workbench-screenshot: ${String(err)}`);
  process.exit(1);
});
