// Contract-test support: what tmux itself says about the sessions a test's Jobs run in.
//
// Asked of tmux directly and never through the harness, so a test's own facts about the Site — this
// session is still there, that one is gone — are independent of the code under test. The restart and
// cancel tests need three things of it: whether one session exists, a way to stop one — both to make
// a Job vanish on purpose and to clean up after a test however it ends — and a way to put one back,
// for the one Site state the seam cannot otherwise produce. Ticket #18's tests need a fourth: where
// tmux keeps the socket a test breaks to make a Site unaskable.
import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';

const tmuxTimeoutMs = 15_000;

/** tmux matches a `-t` target by prefix unless told not to; `=` is how it is told, as jobs.ts does. */
const exactly = (session: string): string => `=${session}`;

/** Does this tmux session exist on this machine? */
export function tmuxHasSession(session: string): boolean {
  const probe = spawnSync('tmux', ['has-session', '-t', exactly(session)], { encoding: 'utf8', timeout: tmuxTimeoutMs });
  if (probe.error) throw new Error(`tmux is not runnable on this machine, and the fabric tests need it: ${probe.error.message}`);
  return probe.status === 0;
}

/** Stop one session, whether or not it is there. */
export function killSession(session: string): void {
  spawnSync('tmux', ['kill-session', '-t', exactly(session)], { timeout: tmuxTimeoutMs });
}

/**
 * Start one detached session under a name of the test's choosing, running nothing but a sleep.
 *
 * This is how a test produces the one Site state the booted-Host seam cannot: a launch the Run's own
 * records have already accounted for whose session is nevertheless still there. The harness reaches
 * that state when a `kill-session` does not take within its bounded wait, which needs tmux to ignore
 * a kill and cannot be asked for. What the code under test reads is not how the session got there,
 * only that the Site still has it — so the test puts it back itself and asks the same question a
 * person's second `/hima cancel` asks.
 */
export function startSession(session: string, sleepSeconds: number): void {
  const started = spawnSync('tmux', ['new-session', '-d', '-s', session, 'sleep', String(sleepSeconds)], { encoding: 'utf8', timeout: tmuxTimeoutMs });
  if (started.status !== 0) {
    throw new Error(`could not start tmux session ${session}: ${started.error?.message ?? started.stderr ?? `tmux exited ${String(started.status)}`}`);
  }
}

/**
 * Where tmux puts its socket under a `TMUX_TMPDIR`: `<dir>/tmux-<uid>/default`, with tmux creating
 * the `tmux-<uid>` directory itself the first time a server starts there.
 *
 * Ticket #18's tests break and put back exactly this path — the socket moved away (ENOENT), the
 * directory closed (EACCES) — which is how a Site that cannot be asked is produced on this machine
 * without touching any other tmux running on it. The layout is tmux's, so it is stated here with
 * everything else this suite knows about tmux rather than inside the one test that needs it.
 */
export function tmuxSocketUnder(tmuxTmpdir: string): { readonly dir: string; readonly socket: string } {
  const dir = path.join(tmuxTmpdir, `tmux-${process.getuid!()}`);
  return { dir, socket: path.join(dir, 'default') };
}

/**
 * Where a PATH search would find this verb, or undefined where it would find none: the same walk
 * `execvp` makes, so a test shadowing one of the channel's verbs can pass everything else through to
 * the real thing on this machine.
 *
 * Here with everything else this suite knows about tmux because that is what every caller shadows —
 * ticket #18's tests, which replace the whole PATH and link the other verbs back in, and #29's,
 * which puts one `tmux` in front of the machine's own and passes every command it does not care
 * about through to it.
 *
 * @param verb - the command to look for.
 * @param searchPath - the PATH to search, colon-separated: a caller's *saved* one, since the caller
 *                     is about to replace `process.env.PATH` with something of its own.
 */
export function findOnPath(verb: string, searchPath: string): string | undefined {
  for (const entry of searchPath.split(':')) {
    if (!entry) continue;
    const candidate = path.join(entry, verb);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not this entry's; keep looking, as the PATH search itself does.
    }
  }
  return undefined;
}
