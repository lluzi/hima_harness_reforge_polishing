// @hima-seam llm-replay direct
// Contract-test support for Model moments (#59): the model's side of one, and the scan that proves
// no key was written.
//
// Two things a moment test needs that no other suite does. The first is a replay scenario put where
// the host can read it: the fixtures are committed under `test/fixtures/moments/` and one of them
// names a ready file, which has to be a path inside the test's own throwaway home — so a scenario is
// copied into the home and the token substituted on the way. The second is the scan: a test that
// claims the harness wrote no key anywhere has to look at every file the harness wrote.
import { appendFile, readdir, readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { repoRoot, type HimaHome } from './dsh-home.ts';
import { homePatchFile, writeReplayOverlay } from '../../../packages/desktop/src/hima-home.ts';
import { QUIET_TITLE_ROW } from './pipeline.ts';

/** Where the committed scenarios are, in the checkout. */
const scenariosDir = path.join(repoRoot, 'test/fixtures/moments');

/** Where the committed workshop scenarios are (#62), which are the ones with more than one session
 *  in them. */
const workshopScenariosDir = path.join(repoRoot, 'test/fixtures/workshop');

/** One scenario, as a driven boot is given it. */
export interface MomentFixture {
  /** The replay plugin's primary fixture: the projected session log. */
  readonly file: string;
  /** The override sidecar: the bare `ReplayEntry[]` that is the whole transcript. */
  readonly override: string;
  /** The file the hanging entry writes before it waits, for a scenario that hangs. */
  readonly readyFile: string;
}

/**
 * Put one committed scenario inside a test's own home, ready for a driven boot to replay.
 *
 * Copied rather than pointed at, for one reason: `hang-then-answer` names a ready file, and a ready
 * file has to be somewhere this test can watch and this test's disposal takes away. The `{{readyFile}}`
 * token in the committed sidecar is substituted here; every other byte is the file as committed.
 *
 * @param home - the test's home, which the copy lives inside and goes away with.
 * @param scenario - the directory name under `test/fixtures/moments`.
 * @param sidecar - which override to use; the second one is what a restarted host replays.
 * @returns the two paths a boot is given, and the ready file the scenario names.
 */
export async function writeMomentFixture(home: HimaHome, scenario: string, sidecar = 'replay.override.json'): Promise<MomentFixture> {
  const into = path.join(home.home, 'moment-fixtures', scenario);
  await mkdir(into, { recursive: true });
  const readyFile = path.join(into, 'ready');
  const file = path.join(into, 'session.jsonl');
  const override = path.join(into, sidecar);
  await writeFile(file, await readFile(path.join(scenariosDir, scenario, 'session.jsonl'), 'utf8'));
  const script = await readFile(path.join(scenariosDir, scenario, sidecar), 'utf8');
  await writeFile(override, script.replaceAll('{{readyFile}}', readyFile));
  return { file, override, readyFile };
}

// ---------------------------------------------------------------------------------------------
// Several moments in one host process (#62): the primary sidecar, and a child session log per
// moment after it
// ---------------------------------------------------------------------------------------------

/**
 * The Session format generation a child log is written in.
 *
 * Hard-coded because nothing in the packages this workspace depends on exposes it: the replay
 * adapter's own parser reads it off `@deepseek-ai/dsh-session-format-catalog`, which is a transitive
 * package and not one this repository installs. It is not a claim taken on trust — every log written
 * below has its own text parsed through the adapter's own `parseSessionLog` and `deriveReplayScript`
 * and held against the entries it was built from, so a dsh that moves the generation on fails here,
 * at the line that wrote the file, rather than inside a booted host.
 */
const SESSION_FORMAT_VERSION = 3;

/** What one scenario with several model sessions in it is, once it is inside the test's home. */
export interface MomentScenarioFixture extends MomentFixture {
  /**
   * The child session logs, in the order replay binds them: the second live session of the host
   * process takes the first of these, the third the second, and so on (the adapter's README,
   * §Nested agents). Empty for a scenario with one session in it.
   */
  readonly children: readonly string[];
}

/**
 * Put one committed scenario inside a test's home, with a child session log per model session after
 * the first (#62).
 *
 * **Why a child log and not a second sidecar.** The replay adapter binds a live session to a
 * recorded script by first-call order, and a sidecar — in either of its forms — replaces or patches
 * *the primary session's* script and nothing else (its README, §Known limitations: "replacement and
 * patch forms affect only the primary session, and child scripts still derive from their logs"). A
 * scenario whose subject is three attempts at one node is three sessions in one host process, so the
 * second and third have to arrive as recorded logs.
 *
 * **What a child log is.** A physical Session header, then one model call per row group: `turn/start`,
 * `step/start`, an **`assistant/attempt`** carrying that call's chunks as its embedded stream,
 * `step/end`, `turn/end`. `deriveReplayScript` reads one entry from every `assistant/message` *and*
 * every `assistant/attempt`, and an attempt is the event dsh records for "one model attempt that
 * committed no surface message" — which is exactly what a synthesized row is. An `assistant/message`
 * would be the other choice and is a worse one: the format's own invariants require it to carry an
 * identified message with a model source, and a tool call in one requires the matching `tool/call`
 * and `tool/result` rows beside it or the log is refused (`step/end leaves unresolved tool call`), so
 * a transcript of three tool calls would have to invent three tool results nobody produced.
 *
 * Only `chunks` entries can be a log: a `throw` before any chunk and a `hang` are the two the
 * adapter's own documentation says a durable settlement cannot express, which is what the sidecar is
 * for. One in a child position is refused here, naming the file.
 *
 * @param home - the test's home, which the copy lives inside and goes away with.
 * @param scenario - the directory name under `test/fixtures/workshop`.
 * @param from - the committed scenarios directory; the workshop ones by default.
 * @returns the primary pair, the child logs in bind order, and the ready file the scenario names.
 */
export async function writeMomentScenario(home: HimaHome, scenario: string, from: string = workshopScenariosDir): Promise<MomentScenarioFixture> {
  const into = path.join(home.home, 'moment-fixtures', scenario);
  await mkdir(into, { recursive: true });
  const readyFile = path.join(into, 'ready');
  const resolve = (text: string): string => text.replaceAll('{{readyFile}}', readyFile);

  const file = path.join(into, 'session.jsonl');
  await writeFile(file, await readFile(path.join(from, scenario, 'session.jsonl'), 'utf8'));
  const override = path.join(into, 'replay.override.json');
  await writeFile(override, resolve(await readFile(path.join(from, scenario, 'replay.override.json'), 'utf8')));

  // The later sessions, numbered from one, each read as far as the numbering goes: a scenario with
  // three sessions holds `session.1.override.json` and `session.2.override.json`, and a gap is the
  // end of the list rather than a file quietly skipped.
  const children: string[] = [];
  for (let n = 1; ; n += 1) {
    const at = path.join(from, scenario, `session.${String(n)}.override.json`);
    let text: string;
    try {
      text = await readFile(at, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw err;
    }
    const entries = JSON.parse(resolve(text)) as ReplayEntry[];
    const child = path.join(into, `session.${String(n)}.jsonl`);
    await writeFile(child, childSessionLog(`${scenario}-${String(n)}`, n, entries, at));
    children.push(child);
  }
  return { file, override, readyFile, children };
}

/**
 * One recorded child session log holding exactly these model calls.
 *
 * The text is put through the adapter's own parser and derivation before it is written: what this
 * function promises is that the script the adapter derives from these bytes is the script the caller
 * asked for, and the only honest way to promise that is to ask the adapter. The parse is of the text
 * in hand rather than of the file on disk — the bytes are the same bytes, and checking them before
 * the write is what makes a refusal name the committed source rather than a file it just made.
 *
 * @param id - the recorded session id, which is diagnostic only: a live session's id is fresh.
 * @param createdAt - the ordering key; every child sorts after the primary's own zero.
 * @param entries - the model calls, in call order.
 * @param source - the committed file these came from, for a refusal to name.
 */
function childSessionLog(id: string, createdAt: number, entries: readonly ReplayEntry[], source: string): string {
  const rows: unknown[] = [{
    version: SESSION_FORMAT_VERSION,
    type: 'session',
    id: `session-hima-${id}`,
    createdAt,
    cwd: '{{cwd}}',
    delegationDepth: 0,
    isSeeded: false,
  }];
  entries.forEach((entry, index) => {
    if (entry.kind !== 'chunks') {
      throw new Error(
        `${source} holds a "${entry.kind}" entry at call ${String(index)}, and a child session is a recorded log: `
        + 'a throw before any chunk and a hang are the two the replay adapter documents as unreconstructable from a durable settlement, '
        + 'and a sidecar expressing either of them applies to the primary session alone',
      );
    }
    const turn = index + 1;
    rows.push({ type: 'turn/start', data: { turn } });
    rows.push({ type: 'step/start', data: { turn, step: 1 } });
    // The raw-chunk form of a compact stream record, one per chunk, so no delta boundary is joined
    // and the expansion is the chunk list exactly as written.
    rows.push({ type: 'assistant/attempt', data: { turn, step: 1, stream: entry.chunks.map((chunk) => ({ type: 'chunk', time: 0, chunk })) } });
    rows.push({ type: 'step/end', data: { turn, step: 1 } });
    rows.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } });
  });
  const text = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const derived = deriveReplayScript(parseSessionLog(text));
  const asked = entries.map((e) => JSON.stringify(e));
  const got = derived.map((e) => JSON.stringify(e));
  if (asked.length !== got.length || asked.some((e, i) => e !== got[i])) {
    throw new Error(`the child session log built from ${source} does not derive the calls it was built from:\n  asked ${asked.join('\n  asked ')}\n  got   ${got.join('\n  got   ')}`);
  }
  return text;
}

/** One file the scan looked inside, and where it is. */
export interface ScannedFile {
  readonly path: string;
  readonly bytes: number;
}

/** One path the scan could not read — a file, or a directory it could not open — and what stopped it. */
export interface UnreadablePath {
  readonly path: string;
  /** The error's own message, so a record says why rather than only that. */
  readonly error: string;
}

/** What a scan of a home found: how much it read, and every file holding what it was looking for. */
export interface HomeScan {
  /** Every readable file under the roots, in the order they were walked. */
  readonly files: readonly ScannedFile[];
  /** Those of them whose bytes contain the needle, by path. */
  readonly holding: readonly string[];
  /** Every `.credentials.yaml` and `.env` found under the roots, by path. */
  readonly credentialFiles: readonly string[];
  /**
   * Every path the walk could not read: a file whose bytes would not come, a directory that would
   * not open, an entry whose metadata would not answer — each with why.
   *
   * An empty `holding` is a claim about bytes; it is worth nothing over a file nobody looked inside,
   * and worth still less over a directory nobody opened. A caller asserting "no file holds the key"
   * asserts this is empty in the same breath.
   */
  readonly unreadable: readonly UnreadablePath[];
}

/** Files dsh's own credentials story writes, which this harness must never be the author of. */
const CREDENTIAL_NAMES = new Set(['.credentials.yaml', '.credentials.yml', '.env']);

/**
 * Look inside every file under these roots for one string.
 *
 * What it is for: a DeepSeek key reaches this product through dsh's own doors — the launching
 * environment, dsh's credentials file, an env file — and through none of this harness's. The only
 * way to say that and mean it is to put a key in the environment of a real run and then read every
 * byte the run left behind. So this reads files rather than sampling them, and it reports what it
 * read as well as what it found: a scan that walked nothing would otherwise prove nothing, and a
 * test asserting on an empty `holding` would pass against a directory that was never there.
 *
 * Binary files are read as bytes and searched as bytes, so a key inside a database or an archive is
 * found too.
 *
 * **Every read that fails is reported.** A regular file this cannot read is a hole in the evidence of
 * exactly the size of that file: it holds bytes, the scan never saw them, and an empty `holding`
 * would go on reading as "no file holds the key". A *directory* this cannot open is a hole the size
 * of everything beneath it. A metadata read that fails is a hole of unknown size, because what could
 * not be answered is what kind of thing is there at all. So each of the three is reported in
 * `unreadable` with the error's message and the path, and the callers — `moment.test.ts` and the two
 * live checks — hold that list empty beside `holding`.
 *
 * **The one thing passed over is a link pointing at nothing.** `stat` follows the link, so an
 * `ENOENT` from it — for an entry `readdir` enumerated as a symbolic link — is the only failure here
 * that says something definite: there is no file at the other end, and a path with no file at the
 * other end holds no bytes for a key to be in. An `ENOENT` for an entry that was *not* a link is a
 * file that went away between the enumeration and the look, which is a hole and not an answer, and
 * goes in `unreadable` like every other `stat` failure — a permission, an I/O error, a loop — that
 * leaves the scan unable to say what is there. (A socket or a device answers `stat` and is passed
 * over by the `isFile` test below, which is a decision about what was found rather than a failure
 * to look.)
 *
 * `walk` reaches `readdir` only for a path `stat` has already answered for — an entry the walk found
 * to be a directory, or a root found to be there — so a failure there is never a dangling link. It is
 * a directory this process may not open (or a root that is not a directory at all), and what is
 * behind it is exactly the evidence a scan of a home is for.
 *
 * @param roots - the directories to walk; a root that does not exist contributes nothing.
 * @param needle - the string no file may hold.
 * @returns what was read, what could not be read, what holds the needle, and every credential-shaped
 *          file found.
 */
export async function scanForSecret(roots: readonly string[], needle: string): Promise<HomeScan> {
  const files: ScannedFile[] = [];
  const holding: string[] = [];
  const credentialFiles: string[] = [];
  const unreadable: UnreadablePath[] = [];
  const seen = new Set<string>();
  const bytes = Buffer.from(needle, 'utf8');
  const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));
  const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Everything under it is now unread and unaccounted for, which is precisely what `unreadable`
      // is for. Never absence: this is only ever called on a directory already found to be there.
      unreadable.push({ path: dir, error: why(err) });
      return;
    }
    for (const entry of entries) {
      const at = path.join(dir, entry.name);
      // A link is followed by what it points at, never walked as itself: a home holds a link to this
      // checkout, and walking that would scan the repository rather than the home.
      let kind;
      try {
        kind = await stat(at);
      } catch (err) {
        // The one skip: a link with nothing at the other end holds no bytes. Anything else that
        // stopped the metadata read — including a plain entry that vanished between the enumeration
        // and this look — leaves this unable to say what is here, and is reported.
        if (!(isMissing(err) && entry.isSymbolicLink())) unreadable.push({ path: at, error: why(err) });
        continue;
      }
      if (kind.isDirectory()) {
        if (entry.isSymbolicLink()) continue;
        await walk(at);
        continue;
      }
      if (!kind.isFile() || seen.has(at)) continue;
      seen.add(at);
      if (CREDENTIAL_NAMES.has(entry.name)) credentialFiles.push(at);
      let content;
      try {
        content = await readFile(at);
      } catch (err) {
        unreadable.push({ path: at, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      files.push({ path: at, bytes: content.byteLength });
      if (content.includes(bytes)) holding.push(at);
    }
  };

  for (const root of roots) {
    // A root is the one place absence is benign, and it is asked here rather than inside `walk` so
    // that the walk itself has no absent case at all: the callers name directories a run may or may
    // not have made — a window's user-data directory exists only once a window has run — and a place
    // that was never created holds no bytes. Any other way of failing to reach a root is a read this
    // could not make, and is reported with the rest.
    try {
      await stat(root);
    } catch (err) {
      if (!isMissing(err)) unreadable.push({ path: root, error: why(err) });
      continue;
    }
    await walk(root);
  }
  return { files, holding, credentialFiles, unreadable };
}

/**
 * The same scenario, put in front of an **in-process** host rather than a driven window (#62).
 *
 * A driven boot is handed the stand-in on its command line (`bootDriver`'s `model.replay`); an
 * in-process boot has no command line, and reads the home's own `cordis.patch.yml` layer — which is
 * the very file the desktop shell writes the stand-in into. So this writes it there, with the child
 * logs a multi-moment scenario needs, exactly as the shell would.
 *
 * The quiet-title row goes on afterwards for the reason it goes on in `replayStage`: dsh titles a
 * session from its first human message with a model call of its own, and replay's cursor is per
 * session, so that call would eat one of the scenario's recorded entries.
 *
 * @param h - the test's home, which the scenario is copied into and the overlay written to.
 * @param scenario - the directory name under `test/fixtures/workshop`.
 * @returns the primary pair, the child logs in bind order, and the ready file the scenario names.
 */
export async function replayMomentScenario(h: HimaHome, scenario: string): Promise<MomentScenarioFixture> {
  const fixture = await writeMomentScenario(h, scenario);
  await writeReplayOverlay(h.home, {
    file: fixture.file,
    overrideFile: fixture.override,
    ...(fixture.children.length === 0 ? {} : { childFiles: [...fixture.children] }),
  });
  await appendFile(homePatchFile(h.home), QUIET_TITLE_ROW);
  return fixture;
}
