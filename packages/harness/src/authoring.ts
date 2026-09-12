// @hima-seam tools direct
// The authoring guard: what an authoring session of a pack folder may do, enforced rather than said
// (#63).
//
// **The class of defect this exists for.** The pack authoring pipeline's five skills are instruction
// text a model follows with real `write`, `edit` and `bash` tools on a person's own machine. Every
// body says "the pack folder is the only place you write". Prose addressed to a model is a
// recommendation: the first review's word for it was containment by prose, and it was right. dsh's
// own file sandbox is real enforcement but it is not this rule — `workspace-write` fences a session
// to its workspace root *plus the platform temp areas*, because that is what the mode promises tools
// that write temporary files, so a Golden Flow, a checkout or a scratch tree that happens to lie
// under `/tmp` is inside the sandbox and outside the pack folder. That gap is not dsh's fault and
// not dsh's to close: it is a rule of *this* product about *its own* authoring sessions.
//
// **Where the rule lives.** `ctx.tools.guard` (dsh's tools seam, direct per ADR-0001): a monotonic
// synchronous check run after every `tools/pre-execute` listener and before the tool body. A
// returned string denies the call, and — this is why it is the right seam — guards have no allow
// result, so no listener registered later can turn a denial back into permission. Registered once,
// globally, as an effect of the bundle, so it unwinds with the plugin.
//
// **The rule.** A session whose working directory lies inside the bundle's packs directory is an
// authoring session of the one pack folder `<packsDir>/<id>` it stands in. In such a session:
//
//   - every file-writing tool's target, resolved against the session's own working directory, must
//     lie inside that pack folder;
//   - `bash` is refused outright. An authoring session has no shell: the Golden Flow is read with
//     `read`, `glob` and `grep`, and a shell is a hole through every path rule above it — one
//     `sh -c 'cat > …'` and the rest of this file is decoration.
//
// **The order it asks in**, because it is what makes the rule cheap and what decides who is touched:
// the tool's name first, the session second. A call of anything but those three is answered
// `undefined` with no path resolved at all — every `read`, `glob`, `grep`, `skill` and `hima_*` call
// in the product is exactly what it was, wherever its session stands. Only for one of the three is
// the session then placed, and one standing anywhere but inside the packs directory is left alone in
// turn: an ordinary chat session and a Campaign's own work write and open shells as they always did.
//
// **Three paths, three resolutions, and they are deliberately not the same one.** The first review
// of the guard found one routine resolving all three, and with it a session whose own directory
// could not be resolved being classified as standing somewhere else — the fail-open this rule exists
// to refuse. Each path is now asked the question that belongs to it:
//
//   - the **packs directory** is resolved as itself. Not being there at all is the one benign
//     failure in this file: no working directory can lie beneath a directory that does not exist, so
//     there is nothing to decide and every session on the host is left alone. Any *other* way of
//     failing to resolve it — a link to nothing, a directory this process may not traverse — means
//     the host can no longer tell an authoring session from an ordinary one, and the governed tools
//     stop in every session until it can.
//   - the **session's working directory** is resolved as itself, and has no benign absence. A
//     session whose own directory this harness cannot resolve to a directory is one it cannot place,
//     and answering "somewhere else" for it would be exactly the fail-open above.
//   - only the **write target** is reconstructed, because the target of a write usually does not
//     exist yet — creating it is the point.
//
// **Which tools are file-writing tools** is read off a real boot rather than remembered:
// `ctx.tools.schemas()` on the composed host lists `read`, `write`, `edit`, `glob`, `grep`, `bash`,
// `skill`, the delegation tools and the four `hima_*`, and the two that take a `file_path` and
// change what is at it are `write` and `edit`. `skills.test.ts` holds that list against the booted
// host, so a dsh release that adds a third fails the suite instead of quietly opening a door.
import { lstatSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolExecution } from '@deepseek-ai/dsh-tools';

/**
 * The tools that change what is at a path, by the `file_path` argument they take.
 *
 * Read off `ctx.tools.schemas()` on a booted host, not from memory, and asserted against one in the
 * contract suite. `read`, `glob` and `grep` are deliberately not here: an authoring session reads
 * the Golden Flow where it lies, and that is the whole point of not copying it.
 */
export const FILE_WRITING_TOOLS = ['write', 'edit'] as const;

/** The tool an authoring session may not call at all, whatever its arguments say. */
export const SHELL_TOOL = 'bash';

/**
 * Every tool this guard has an opinion about. Anything else is none of its business.
 *
 * Exported because it is also the list a Model moment refuses by name (D48): a moment has no shell
 * and no host filesystem, and `openMoment` in `moments.ts` turns a request carrying one of these
 * away before it composes anything. Two rules, read from one list, so that a fourth governed tool
 * arrives in both places at once — and so that the two can never drift into a session this guard
 * would deny and a moment that is promised it can never be denied.
 */
export const GOVERNED_TOOLS = [...FILE_WRITING_TOOLS, SHELL_TOOL] as const;

const governed = new Set<string>(GOVERNED_TOOLS);

/** How far above a write target this will climb looking for something that exists. */
const maxUnresolvedDepth = 16;

/** Is `real` the root itself or somewhere below it? Compared on resolved paths, never on spellings. */
const within = (real: string, root: string): boolean =>
  real === root || real.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** Where one path really is, asked about as itself: no climb, no reconstruction. */
type Strictly =
  /** It resolves, and this is where it is and whether it is a directory. */
  | { readonly kind: 'at'; readonly real: string; readonly directory: boolean }
  /** Nothing is there — and nothing is there *as an absence*, not as a link to nothing. */
  | { readonly kind: 'absent' }
  /** It is not an absence and it did not resolve; this clause says which. */
  | { readonly kind: 'undecided'; readonly why: string };

/**
 * Where one path really is, resolved as itself.
 *
 * The distinction this exists to make is between a path that is *not there* and a path that is there
 * and will not resolve: `realpath` answers `ENOENT` for both, because a symlink pointing at
 * something that does not exist is a path and not an absence. `lstat`, which does not follow the
 * last link, is the one call that tells them apart, and every caller here treats them differently.
 *
 * @param at - an absolute path.
 * @returns where it is, that nothing is there, or why neither could be decided.
 */
function strictly(at: string): Strictly {
  let real: string;
  try {
    real = realpathSync(at);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') return { kind: 'undecided', why: `it cannot be resolved (${code ?? (err as Error).message})` };
    let link;
    try {
      link = lstatSync(at, { throwIfNoEntry: false });
    } catch (other) {
      return { kind: 'undecided', why: `it does not resolve (ENOENT) and cannot be told apart from an absence: ${(other as Error).message}` };
    }
    if (link === undefined) return { kind: 'absent' };
    return { kind: 'undecided', why: 'it is present and does not resolve — a link to something that is not there' };
  }
  let there;
  try {
    there = statSync(real);
  } catch (err) {
    return { kind: 'undecided', why: `it resolves to ${real}, which cannot be read (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})` };
  }
  return { kind: 'at', real, directory: there.isDirectory() };
}

/** Where a write target will actually be, or why that could not be decided. */
type Resolved = { readonly ok: true; readonly at: string } | { readonly ok: false; readonly why: string };

/**
 * Where a write target will actually be, resolved the way `decideWrite` in `shell.ts` resolves one.
 *
 * The target of a write usually does not exist yet, so the deepest ancestor that *does* resolve is
 * resolved instead and the segments below it are kept in order. Every branch fails closed:
 *
 * - an ancestor that will not resolve for any reason but "it is not there" refuses, naming it;
 * - the first segment below the resolved ancestor is asked directly, without following links,
 *   whether anything is there at all — a symlink pointing at something that does not exist fails to
 *   resolve and is still a path, one a write follows to wherever it names, outside this root if that
 *   is where it points;
 * - a climb longer than `maxUnresolvedDepth`, and a path nothing above resolves, refuse.
 *
 * @param candidate - an absolute path whose segments are already plain names: {@link segmentsOf} has
 *                    refused every `.` and `..` before this is called, so nothing here has to decide
 *                    what joining one back on blind would mean.
 * @returns where it will be, or why that could not be decided.
 */
function resolveTarget(candidate: string): Resolved {
  const tail: string[] = [];
  let at = candidate;
  let real: string | undefined;
  for (let depth = 0; depth <= maxUnresolvedDepth; depth += 1) {
    try {
      real = realpathSync(at);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Only "there is nothing here" is a reason to keep climbing. `ENOTDIR` is that same fact said
      // about a path whose ancestor is a file. Everything else — a directory this process may not
      // traverse, a loop of links — is a path that cannot be decided about, and a guard that climbed
      // past it would be deciding about a different path from the one the write will take.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return { ok: false, why: `${at} cannot be resolved (${code ?? (err as Error).message})` };
      }
      const parent = path.dirname(at);
      if (parent === at) return { ok: false, why: `nothing above ${candidate} resolves` };
      tail.unshift(path.basename(at));
      at = parent;
    }
  }
  if (real === undefined) return { ok: false, why: `nothing within ${String(maxUnresolvedDepth)} levels above ${candidate} exists` };
  if (tail.length === 0) return { ok: true, at: real };
  const first = path.join(real, tail[0]!);
  let there;
  try {
    there = lstatSync(first, { throwIfNoEntry: false });
  } catch (err) {
    return { ok: false, why: `cannot tell whether ${first} is there: ${(err as Error).message}` };
  }
  if (there !== undefined) {
    return { ok: false, why: `${first} is present and does not resolve — a link to something that is not there, which a write would follow to wherever it points` };
  }
  return { ok: true, at: path.join(real, ...tail) };
}

/** The plain segments a `file_path` names, or the segment that is a reason to refuse it. */
type Segments = { readonly ok: true; readonly candidate: string } | { readonly ok: false; readonly segment: string };

/**
 * The path a `file_path` names, taken as the tool received it and built out of plain names.
 *
 * **Nothing is normalised before it is judged, and that is the whole of this function.** A `..`
 * beside a symlink names two different files depending on who resolves it: `path.join` and
 * `path.resolve` remove it *lexically*, before anything has looked at the filesystem, while the
 * kernel removes it *after* following each link — and the split runs through Node itself, whose
 * `fs.realpathSync` gives the first answer and whose `fs.realpathSync.native` gives the second. A
 * guard that normalised first would not be deciding about the path the write takes; it would be
 * agreeing with whichever resolver the tool beneath it happens to use, which is a fact about that
 * tool and not a rule. So a `.` or `..` anywhere in the target refuses, named. Nothing an authoring
 * stage writes needs one — a record goes at the top of the pack folder or in a directory below it —
 * and refusing them is what makes "inside the pack folder" one fact rather than two.
 *
 * A relative target is prefixed with the segments of the session's own working directory, which is
 * what dsh's file tools resolve one against, and which the standing has already resolved to a real
 * directory whose own segments are therefore plain names.
 *
 * @param target - the `file_path` exactly as the tool was called with it.
 * @param cwd - the session's working directory, already resolved.
 * @returns the absolute candidate path, or the segment that refused it.
 */
function segmentsOf(target: string, cwd: string): Segments {
  const absolute = path.isAbsolute(target);
  const named = target.split(path.sep);
  for (const segment of named) {
    if (segment === '.' || segment === '..') return { ok: false, segment };
  }
  const below = named.filter((segment) => segment !== '');
  const root = path.parse(absolute ? target : cwd).root;
  const above = absolute ? [] : cwd.split(path.sep).filter((segment) => segment !== '');
  return { ok: true, candidate: path.join(root, ...above, ...below) };
}

/** What one session is, as far as this rule is concerned. */
type Standing =
  /** Not in the packs directory at all: this guard has nothing to say about it. */
  | { readonly kind: 'elsewhere' }
  /** Authoring `folder`, which is `<packsDir>/<id>`, from `cwd`, which is at or below it. */
  | { readonly kind: 'authoring'; readonly folder: string; readonly cwd: string }
  /** In the packs directory and not in one pack folder, or unplaceable: nothing governed may run. */
  | { readonly kind: 'refuse'; readonly why: string };

/**
 * What the session behind one call is standing in.
 *
 * Both paths are resolved before they are compared, never compared as spellings: on this platform
 * the temporary directory every isolated home is made under is itself a symlink, so a packs
 * directory and a session inside it disagree textually while naming the same place. Each is resolved
 * as itself — the file header says why the two answers to "it did not resolve" differ.
 *
 * @param cwd - the session's own working directory, or undefined when it has none.
 * @param packsDir - the bundle's configured packs directory.
 * @returns where the session stands.
 */
function standingOf(cwd: string | undefined, packsDir: string): Standing {
  // A session with no working directory is standing nowhere, so it is standing in no pack folder.
  // dsh's own sandbox falls back to the configured workspace root for exactly this case.
  if (cwd === undefined || cwd === '') return { kind: 'elsewhere' };
  const packs = strictly(path.isAbsolute(packsDir) ? packsDir : path.resolve(packsDir));
  // The one benign failure in this file: a packs directory that is not there holds no pack folder,
  // so no working directory can lie beneath it and there is nothing to tell apart on this host.
  if (packs.kind === 'absent') return { kind: 'elsewhere' };
  if (packs.kind === 'undecided') {
    return { kind: 'refuse', why: `the packs directory ${packsDir} cannot be resolved, so no session on this host can be told apart from a pack authoring session: ${packs.why}` };
  }
  // A packs directory that resolves to something that is not a directory needs no clause of its own:
  // no working directory can resolve to a path beneath a file, so the comparison below answers
  // "somewhere else" for every session on its own.

  // A working directory dsh says is absolute and is not is a header this harness cannot read, and
  // resolving it against this process's own directory would answer for a different session.
  if (!path.isAbsolute(cwd)) {
    return { kind: 'refuse', why: `this session's working directory ${cwd} is not an absolute path, so this session cannot be placed` };
  }
  const here = strictly(cwd);
  if (here.kind !== 'at' || !here.directory) {
    const why = here.kind === 'absent' ? 'it is not there'
      : here.kind === 'undecided' ? here.why
      : `it resolves to ${here.real}, which is not a directory`;
    return { kind: 'refuse', why: `this session's working directory ${cwd} cannot be resolved to a directory, so this session cannot be placed: ${why}` };
  }
  if (!within(here.real, packs.real)) return { kind: 'elsewhere' };
  const below = path.relative(packs.real, here.real);
  // Standing in the packs directory itself: inside the pipeline's own tree and in no one folder, so
  // there is no pack folder to hold a write to. A session that may write into any pack folder is the
  // thing this rule exists to make impossible.
  if (below === '') return { kind: 'refuse', why: `this session stands in the packs directory ${packs.real} itself rather than in one pack folder, and an authoring session writes inside exactly one` };
  return { kind: 'authoring', folder: path.join(packs.real, below.split(path.sep)[0]!), cwd: here.real };
}

/**
 * The reason this call is denied, or `undefined` to leave it exactly as it was.
 *
 * The shape `ctx.tools.guard` takes, and the whole rule in one function so that what is enforced can
 * be read in one place.
 *
 * @param execution - the call, after every extensible pre-execute listener has had its say.
 * @param packsDir - the bundle's configured packs directory.
 * @returns a denial naming the pack folder and the path, or undefined.
 */
function authoringDenial(execution: Readonly<ToolExecution>, packsDir: string): string | undefined {
  // Asked before the session is placed at all: a rule about `write`, `edit` and `bash` has no
  // business resolving two paths on every `read`, `glob` and `hima_observe` in the product.
  if (!governed.has(execution.name)) return undefined;
  const standing = standingOf(execution.agent?.session.header.cwd, packsDir);
  if (standing.kind === 'elsewhere') return undefined;
  // Whatever went wrong above, it is only a reason to stop the calls this rule governs. A session
  // whose place cannot be decided still reads files, still answers questions, and still runs a
  // Campaign; what it does not do is write or open a shell on the strength of a decision nobody
  // could make.
  if (standing.kind === 'refuse') return `${execution.name} is refused: ${standing.why}`;
  const folder = standing.folder;
  if (execution.name === SHELL_TOOL) {
    return `a pack authoring session in ${folder} has no shell: read the Golden Flow where it lies with read, glob and grep, and write only inside the pack folder. "${SHELL_TOOL}" refused.`;
  }
  const args = execution.arguments as { file_path?: unknown } | null | undefined;
  const target = args?.file_path;
  const inside = `a pack authoring session in ${folder} writes only inside the pack folder`;
  if (typeof target !== 'string' || target === '') {
    return `${inside}, and "${execution.name}" named no file_path to hold to it. Refused.`;
  }
  const named = segmentsOf(target, standing.cwd);
  if (!named.ok) {
    return `${inside}, and "${target}" names the segment "${named.segment}". Nothing an authoring stage writes needs one, and a ".." beside a symlink is the one way a path that reads as inside lands outside. Refused.`;
  }
  const resolved = resolveTarget(named.candidate);
  if (!resolved.ok) {
    return `${inside}, and "${target}" could not be resolved to a path: ${resolved.why}. Refused.`;
  }
  if (!within(resolved.at, folder)) {
    return `${inside}, and "${target}" is ${resolved.at}, which is outside it. Refused: read the Golden Flow where it lies and copy no file of it.`;
  }
  return undefined;
}

/**
 * Put the rule on a host, for as long as the bundle is mounted.
 *
 * @param ctx - the context the bundle was applied with; a guard registered on it applies to every
 *              agent, which is what a rule about sessions has to do.
 * @param packsDir - the bundle's configured packs directory.
 * @returns the registry's own disposer, so the caller can hold it as one effect.
 */
export function registerAuthoringGuard(ctx: Context, packsDir: string): () => void {
  return ctx.tools.guard((execution) => authoringDenial(execution, packsDir));
}
