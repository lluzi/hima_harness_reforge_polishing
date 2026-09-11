// HimaShell: the permit decides what the agent may touch on a Site, and it fails closed.
import path from 'node:path';
import { pathsOf, type Site } from './sites.js';

export type ReadDecision = { readonly ok: true; readonly absPath: string } | { readonly ok: false; readonly reason: string };

/** What the decision needs from a HimaChannel: resolve a path where the file actually lives, which for
 *  a remote Site means on that Site, read-only. Rejects when the path does not resolve. */
export interface PathResolver {
  realpath(absPath: string): Promise<string>;
  /**
   * Is there nothing at all at this path — no file, no directory, and no symlink, however broken?
   * Asked without following a link, because a link that resolves nowhere is still something there,
   * and a write to it lands at whatever it names. Rejects when the answer cannot be had: a decision
   * that cannot tell must not read as "nothing there".
   */
  absent(absPath: string): Promise<boolean>;
}

const within = (real: string, root: string, p: path.PlatformPath): boolean =>
  real === root || real.startsWith(root.endsWith(p.sep) ? root : root + p.sep);

/** May `requested` (absolute, or relative to the site's workspace) be read under this site's permit?
 *  Symlinks are resolved first, on the machine that holds them. */
export async function decideRead(site: Site, requested: string, on: PathResolver): Promise<ReadDecision> {
  const p = pathsOf(site);
  const candidate = p.isAbsolute(requested) ? requested : p.join(site.workspaceRoot, requested);
  let real: string;
  try {
    real = await on.realpath(candidate);
  } catch (err) {
    return { ok: false, reason: `cannot resolve ${candidate}: ${(err as Error).message}` };
  }
  for (const root of site.permitRules.allowedReadRoots) {
    let realRoot: string;
    try { realRoot = await on.realpath(root); } catch { continue; }
    if (within(real, realRoot, p)) return { ok: true, absPath: real };
  }
  return { ok: false, reason: `path outside the permitted read roots of site ${site.name}: ${requested}` };
}

/**
 * A launch the permit allowed, resolved to where the Job will actually run, or a refusal naming what
 * was refused. `refused` is the path or the wrapper the decision was about, so the refusal record
 * says which of the two the permit stopped.
 */
export type LaunchDecision =
  | { readonly ok: true; readonly workspace: string }
  | { readonly ok: false; readonly refused: string; readonly reason: string };

/**
 * May this site's permit run `argv` in `workspace`? Two questions, in this order: is `argv[0]` one of
 * the permit's allowed wrappers, and does `workspace` resolve inside one of its allowed write roots.
 *
 * The wrapper is asked first because it needs nothing from the Site: a command the permit will not
 * run is refused without asking the Site anything at all. The workspace is then resolved where it
 * lives, on the Site for a remote one, exactly as `decideRead` resolves a path to read — a symlink
 * out of a write root is not a way around the permit.
 *
 * Fails closed throughout: an unresolvable workspace, an empty argv, an empty wrapper list, and an
 * empty write-root list are all refusals.
 */
export async function decideLaunch(site: Site, workspace: string, argv: readonly string[], on: PathResolver): Promise<LaunchDecision> {
  const p = pathsOf(site);
  const wrapper = argv[0];
  if (wrapper === undefined || wrapper === '') {
    return { ok: false, refused: '', reason: `no command to launch on site ${site.name}` };
  }
  if (!permitsWrapper(site, wrapper)) {
    return { ok: false, refused: wrapper, reason: refusedWrapper(site, wrapper) };
  }
  const candidate = p.isAbsolute(workspace) ? workspace : p.join(site.workspaceRoot, workspace);
  let real: string;
  try {
    real = await on.realpath(candidate);
  } catch (err) {
    return { ok: false, refused: workspace, reason: `cannot resolve ${candidate}: ${(err as Error).message}` };
  }
  for (const root of site.permitRules.allowedWriteRoots) {
    let realRoot: string;
    try { realRoot = await on.realpath(root); } catch { continue; }
    if (within(real, realRoot, p)) return { ok: true, workspace: real };
  }
  return { ok: false, refused: workspace, reason: `workspace outside the permitted write roots of site ${site.name}: ${workspace}` };
}

/**
 * Does this Site's Permit allow `wrapper` as the first word of a command? Either spelling satisfies
 * it: the full path the permit listed, or the bare name it listed. A wrapper listed by full path
 * (`/usr/local/bin/eda`) therefore cannot be satisfied by some other `eda` earlier on the Site's
 * PATH, which is why the site owner lists it that way.
 *
 * Asked of a live launch by `decideLaunch`, and of a pack's declared tools by `/hima pack check`
 * long before one runs — the same question, so a check that says a pack fits cannot disagree with
 * the decision that later refuses it.
 */
export function permitsWrapper(site: Site, wrapper: string): boolean {
  const wrappers = site.permitRules.allowedWrappers;
  return wrappers.includes(wrapper) || wrappers.includes(pathsOf(site).basename(wrapper));
}

/** Why a wrapper was refused, naming what the Site does allow. One sentence, both callers. */
export function refusedWrapper(site: Site, wrapper: string): string {
  const wrappers = site.permitRules.allowedWrappers;
  return `"${wrapper}" is not an allowed wrapper of site ${site.name} (allowed: ${wrappers.length > 0 ? wrappers.join(', ') : 'none'})`;
}

/**
 * A path the permit allows the harness to write, resolved to where it will actually be, or a refusal
 * naming what was refused. `exists` says whether the target was already there when the decision was
 * made — the caller has just paid for that answer, and creating something over the top of a path
 * that is already occupied is a different act from creating it.
 */
export type WriteDecision =
  | { readonly ok: true; readonly absPath: string; readonly exists: boolean }
  | { readonly ok: false; readonly refused: string; readonly reason: string };

/** How far above a target this will climb looking for something that exists. A path deeper than this
 *  below every existing directory is not a workspace anyone meant to create. */
const maxUnresolvedDepth = 16;

/**
 * May the harness create or write `target` on this Site?
 *
 * Where `decideLaunch` governs a Job's *command*, this governs the harness's own writes: the
 * directories a Campaign workspace is made of, the flow copied into it, the `workspace.json` that
 * says what was prepared. Every one of those goes through here before a single command is sent, and
 * a refusal means nothing was sent at all.
 *
 * The target usually does not exist yet — creating it is the point — so the deepest ancestor that
 * *does* resolve is resolved instead, and containment is tested on that. What is below it has to be
 * nothing at all, and "does not resolve" is not the same fact as "is not there": a symlink pointing
 * at something that does not exist fails to resolve and is still a path, one that `cp -R` writes
 * straight through, at the link's target, outside this root if that is where it points. So the first
 * segment below the resolved ancestor is asked directly whether anything is there, links included,
 * and anything present refuses the write. Only the first: nothing exists below a path that does not.
 * Once a segment really exists, this same decision resolves it for real, so an existing target is
 * never trusted to be where its name suggests.
 *
 * Every branch fails closed: an ancestor that will not resolve, a `.` or `..` in the unresolved tail,
 * a first tail segment that is there or cannot be asked about, an empty write-root list, and a climb
 * longer than `maxUnresolvedDepth` are all refusals.
 */
export async function decideWrite(site: Site, target: string, on: PathResolver): Promise<WriteDecision> {
  const p = pathsOf(site);
  const candidate = p.isAbsolute(target) ? target : p.join(site.workspaceRoot, target);
  // Climb to the deepest ancestor that resolves, keeping the segments below it in order.
  const tail: string[] = [];
  let at = candidate;
  let real: string | undefined;
  for (let depth = 0; depth <= maxUnresolvedDepth; depth += 1) {
    try {
      real = await on.realpath(at);
      break;
    } catch {
      const parent = p.dirname(at);
      // `dirname` of a root is the root itself: nothing above resolves, so there is nothing to allow.
      if (parent === at) return { ok: false, refused: target, reason: `cannot resolve any parent of ${candidate} on site ${site.name}` };
      const segment = p.basename(at);
      // A `.` or `..` below an unresolved ancestor would be joined back on blind, which is exactly
      // the climb out of a write root this decision exists to stop.
      if (segment === '' || segment === '.' || segment === '..') {
        return { ok: false, refused: target, reason: `${candidate} names "${segment}" below a path that does not exist on site ${site.name}` };
      }
      tail.unshift(segment);
      at = parent;
    }
  }
  if (real === undefined) {
    return { ok: false, refused: target, reason: `nothing within ${maxUnresolvedDepth} levels above ${candidate} exists on site ${site.name}` };
  }
  for (const root of site.permitRules.allowedWriteRoots) {
    let realRoot: string;
    try { realRoot = await on.realpath(root); } catch { continue; }
    if (!within(real, realRoot, p)) continue;
    // Nothing was climbed over, so what resolved is the target itself: it is already there.
    if (tail.length === 0) return { ok: true, absPath: real, exists: true };
    // Asked only once containment holds, so a path this Site's Permit does not allow is refused
    // without the Site being asked anything about it beyond the resolution the climb already needed.
    const first = p.join(real, tail[0]!);
    let nothingThere: boolean;
    try {
      nothingThere = await on.absent(first);
    } catch (err) {
      return { ok: false, refused: target, reason: `cannot tell whether ${first} is there on site ${site.name}: ${(err as Error).message}` };
    }
    if (!nothingThere) {
      return {
        ok: false,
        refused: target,
        reason: `${first} is present but not resolvable on site ${site.name}: a symlink to something that is not there, or the like, which a write would follow to wherever it points`,
      };
    }
    return { ok: true, absPath: p.join(real, ...tail), exists: false };
  }
  return { ok: false, refused: target, reason: `path outside the permitted write roots of site ${site.name}: ${target}` };
}
