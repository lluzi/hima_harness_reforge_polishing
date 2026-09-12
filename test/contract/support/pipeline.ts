// Contract-test support for the pack authoring pipeline (#63): the keyless stand-in one stage runs
// under, the pack folder a stage is run in, and the digest that says nothing outside it was written.
//
// Three things a pipeline test needs that no other suite does.
//
// The first is a stand-in a *chat* session can run under. The moment suite's stand-in answers one
// isolated session with one call; a stage is a person's own message to the root agent, and the root
// agent's session has a second consumer of the model route — dsh generates a session title from the
// first human message with a model call of its own on that same session. Replay's cursor is per
// session and advances at invocation time, so that call eats one recorded entry, and because it is
// deferred it eats a different one from run to run. `replayStage` therefore turns that one row off
// in the home's own patch layer, beside the stand-in the product wrote there, so the only model
// calls on the session are the stage's own.
//
// The second is the pack folder. A stage's session runs *in* the pack folder — that is what makes
// the pack folder the only place dsh's workspace-write sandbox lets it write — so a test has to make
// one before it boots.
//
// The third is the digest. "Nothing outside the pack folder was written, and the Golden Flow was
// read where it lies rather than copied" is a claim about every file that was not the record the
// stage wrote, so it is answered by reading all of them before and after rather than by spot checks.
import { createHash } from 'node:crypto';
import { mkdir, appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot, type HimaHome } from './dsh-home.ts';
import { homePatchFile, writeReplayOverlay } from '../../../packages/desktop/src/hima-home.ts';

/** The one placeholder this support resolves: where the Golden Flow lies. */
const flowPlaceholder = /\{\{fromRequest:the flow is at [^}]*\}\}/g;
/** Any placeholder at all, so one this support cannot resolve fails loud rather than reading as a path. */
const anyPlaceholder = /\{\{fromRequest:[^}]*\}\}/;

/** Where the committed transcripts are, in the checkout. */
const scenariosDir = path.join(repoRoot, 'test/fixtures/pipeline');

/** The pack folder the pipeline tests author, under the bundle's own `packsDir`. */
export const authoredPackId = 'authored-probe';

/**
 * The row that keeps a chat session's model calls to the scenario's own.
 *
 * `$DSH_HOME/cordis.patch.yml` is dsh's documented layer for a machine's own tweaks, and turning
 * this row off in it is the same gesture `profile-overlay.test.ts` shows a person making. It is
 * appended after the stand-in rather than mixed into them, because the stand-in is the product's own
 * file (`writeReplayOverlay`) and this is the test's: the marker line the product writes first is
 * what owns the file, and appending leaves that ownership exactly as it was.
 */
export const QUIET_TITLE_ROW = [
  '',
  '# The contract suite\'s own row, appended after the stand-in above (#63): dsh generates a session',
  '# title from the first human message with a model call of its own, on the same session. Replay\'s',
  '# cursor is per session, so that call would consume one of the scenario\'s recorded entries — and',
  '# it is deferred, so which one would differ from run to run.',
  '- id: session-title-llm',
  '  disabled: true',
  '',
].join('\n');

/**
 * What the author answers the grill stage's three questions with, as a second message of their own,
 * and how they settle the one place their words and the Golden Flow disagree.
 *
 * Here rather than in one test file because two files send them now: `skills.test.ts`, whose subject
 * is the grill stage itself, and `pipeline-stages.test.ts`, which runs the whole pipeline through in
 * one session. Two copies of what a person said would be two authors, and the day one is corrected
 * the two runs would be authoring different packs.
 */
export const GRILL_ANSWERS = [
  'Answers, in order.',
  '1. The clock period, pushed down a step at a time, measured by the setup slack in ns the verification report states against the period asked for.',
  '2. It ends when the achievable period is stated and confirmed, or at an ending this pack declares in its own words.',
  '3. Whether a reported slack of zero is margin or the absence of margin.',
  'One thing I should say: I have been treating a pass as proof that the period is achievable.',
].join('\n');

/** The author's own resolution of that disagreement, which is the third message a person sends. */
export const GRILL_RESOLUTION = 'Take the flow\'s reading: a pass states no margin, so the method asks one step tighter than the period believed possible and reads the violation, and the achievable period is asked + |violation|.';

/** One committed scenario, as a boot is given it. */
export interface StageFixture {
  /** The replay plugin's primary fixture: the projected session log. */
  readonly file: string;
  /** The override sidecar: the bare `ReplayEntry[]` that is the whole transcript. */
  readonly override: string;
}

/**
 * Put one committed stage transcript in front of a home, ready for the next boot to replay it.
 *
 * Pointed at rather than copied, unlike a moment scenario: nothing in these files names a path
 * inside the home, because the one path a transcript cannot know — where the Golden Flow lies — is
 * read out of the live request by the plugin's own `{{fromRequest:…}}` placeholder.
 *
 * @param h - the test's home; the stand-in is written into its own patch layer.
 * @param scenario - the directory name under `test/fixtures/pipeline`.
 * @returns the two paths the boot was given.
 */
export async function replayStage(h: HimaHome, scenario: string): Promise<StageFixture> {
  const file = path.join(scenariosDir, scenario, 'session.jsonl');
  const override = path.join(scenariosDir, scenario, 'replay.override.json');
  await writeReplayOverlay(h.home, { file, overrideFile: override });
  await appendFile(homePatchFile(h.home), QUIET_TITLE_ROW);
  return { file, override };
}

/**
 * Several committed transcripts played back as **one** session, in order (#64).
 *
 * The whole pipeline is one thing a person does — grill, spec, fabric, test, release, in one chat,
 * in one folder — and the only way to replay it as one is to hand the adapter one script: replay's
 * cursor is per session and does not go back to the start, so five sidecars would need five boots
 * and five sessions, which is the one arrangement that cannot show the pipeline as a person runs it.
 *
 * The concatenation is written into the home rather than committed, because it holds nothing the
 * five committed files do not: the day one of them is re-recorded, this is the same five in the same
 * order with no second copy to correct.
 *
 * @param h - the test's home; the stand-in is written into its own patch layer.
 * @param scenarios - the directory names under `test/fixtures/pipeline`, in the order they are played.
 * @returns the two paths the boot was given.
 * @throws when a scenario's sidecar is not an array of entries, which means it was re-recorded into
 *         a shape this concatenation cannot join.
 */
export async function replayStages(h: HimaHome, scenarios: readonly string[]): Promise<StageFixture> {
  const first = scenarios[0];
  if (first === undefined) throw new Error('replayStages was given no scenario to play');
  const entries: unknown[] = [];
  for (const scenario of scenarios) {
    const at = path.join(scenariosDir, scenario, 'replay.override.json');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(at, 'utf8'));
    } catch (err) {
      // Naming the file, because five sidecars are being joined and `JSON.parse`'s own message says
      // only where in some string it stopped: which of the five is malformed is the whole answer.
      throw new Error(`${at} is not JSON, so it cannot be one stage of a session: ${(err as Error).message}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`${at} is not an array of replay entries, so it cannot be one stage of a session`);
    entries.push(...parsed);
  }
  const override = path.join(h.home, 'hima-pipeline-stages.override.json');
  await writeFile(override, JSON.stringify(entries));
  const file = path.join(scenariosDir, first, 'session.jsonl');
  await writeReplayOverlay(h.home, { file, overrideFile: override });
  await appendFile(homePatchFile(h.home), QUIET_TITLE_ROW);
  return { file, override };
}

/**
 * The pack folder a stage is run in: the session's working directory, under the bundle's `packsDir`.
 *
 * Made empty. What is in it afterwards is what the stage wrote, which is the whole subject.
 *
 * @param h - the test's home.
 * @param id - the folder's name, which is also the pack id `/hima pack check` asks about.
 * @returns the absolute folder.
 */
export async function authoredPackFolder(h: HimaHome, id: string = authoredPackId): Promise<string> {
  const dir = path.join(h.home, 'hima/packs', id);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Every file under these roots and what is in it, by absolute path, skipping one subtree.
 *
 * Read rather than stat'ed: a file rewritten with the same length and mtime would pass a stat
 * comparison and is exactly what this exists to catch. Fails loud on anything it cannot read — these
 * are the test's own trees, and a digest that quietly skipped a file would be a digest that agreed
 * with itself about nothing.
 *
 * @param roots - the directories to walk; a root that is not there contributes nothing.
 * @param except - the one subtree left out, which is the pack folder the stage is allowed to write.
 * @returns each file's SHA-256, keyed by absolute path.
 */
export async function digestTrees(roots: readonly string[], except: string): Promise<Map<string, string>> {
  const digests = new Map<string, string>();
  const skip = path.resolve(except);
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const at = path.join(dir, entry.name);
      if (at === skip || at.startsWith(`${skip}${path.sep}`)) continue;
      if (entry.isDirectory()) { await walk(at); continue; }
      if (!entry.isFile()) continue;
      digests.set(at, createHash('sha256').update(await readFile(at)).digest('hex'));
    }
  };
  for (const root of roots) await walk(path.resolve(root));
  return digests;
}

/** What a digest comparison says: every path that gained, lost or changed content. */
export function changedBetween(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [at, digest] of before) {
    const now = after.get(at);
    if (now === undefined) changed.push(`${at} (gone)`);
    else if (now !== digest) changed.push(`${at} (rewritten)`);
  }
  for (const at of after.keys()) if (!before.has(at)) changed.push(`${at} (new)`);
  return changed.sort();
}

/** The `##` sections one Markdown record holds, in the order they appear. */
export function sectionsOf(markdown: string): string[] {
  return [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
}

/**
 * The pack intent record the committed `grill` transcript writes, with the Golden Flow's real path
 * put where the transcript's placeholder is.
 *
 * The live check needs an intent record to run the spec stage on, and there is exactly one right
 * place for it to come from: the transcript the contract suite runs the grill stage against. Written
 * out a second time here, it would be a second record — and the day somebody corrected one of them,
 * the keyless run and the live run would be authoring from different intent.
 *
 * @param scenario - the scenario whose transcript holds the write; `grill`.
 * @param flowRoot - where the Golden Flow lies, which the placeholder is resolved to.
 * @returns the record's whole text.
 * @throws when the transcript holds no such write, which means it was re-recorded into a different
 *         shape and this helper is reading a file that no longer says what it thinks.
 */
export async function committedRecord(scenario: string, file: string, flowRoot: string): Promise<string> {
  const at = path.join(scenariosDir, scenario, 'replay.override.json');
  const entries = JSON.parse(await readFile(at, 'utf8')) as { chunks?: { block?: { type?: string; name?: string; arguments?: string } }[] }[];
  for (const entry of entries) {
    for (const chunk of entry.chunks ?? []) {
      if (chunk.block?.type !== 'tool-call' || chunk.block.name !== 'write' || chunk.block.arguments === undefined) continue;
      // Resolved *before* the arguments are parsed, and that order is the whole of this helper's
      // difficulty. A transcript's arguments are a JSON string carrying an unresolved
      // `{{fromRequest:the flow is at (\S+)}}` — and `\S` is not an escape JSON knows, so parsing
      // first throws. The replay plugin substitutes into the same string for the same reason.
      const resolved = chunk.block.arguments.replaceAll(flowPlaceholder, flowRoot);
      const left = anyPlaceholder.exec(resolved);
      if (left !== null) {
        throw new Error(`${at} holds the placeholder ${left[0]} in a write, which this helper cannot resolve: it resolves the Golden Flow's path and nothing else`);
      }
      const args = JSON.parse(resolved) as { file_path?: string; content?: string };
      if (args.file_path !== file || args.content === undefined) continue;
      return args.content;
    }
  }
  throw new Error(`${at} holds no write of ${file}: the transcript was re-recorded into another shape`);
}
