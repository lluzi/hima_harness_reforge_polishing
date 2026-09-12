// Contract-test support: the stand-in flow the local Site binds as its `flowRoot`.
//
// Generating it is not this file's recipe any more: `packages/desktop/src/local-site.ts` holds the
// makefile and its pieces, and `pnpm run desktop --site local` seeds a developer's home with the same
// ones. What stays here is what only a test needs — the isolated home the flow is generated into.
//
// Every generation's report is the stand-in's own arithmetic over the period it was asked for
// (#25); only the two and a half minutes of Design Compiler are missing.
import path from 'node:path';
import type { TestContext } from 'node:test';
import type { HimaHome } from './dsh-home.ts';
import { writeStandinFlow as generateStandinFlow } from '../../../packages/desktop/src/local-site.ts';

export interface StandinFlow {
  /** The flow root a site file binds as `flowRoot`. */
  readonly root: string;
  readonly design: string;
  /** The clock period this flow closes at, in ns: a generation's setup slack is `min(0, period − this)`. */
  readonly achievableNs: number;
  /** Where the counter that makes `synth` fail lives, inside the tree the contract copies. */
  readonly failFile: string;
}

export interface StandinOptions {
  readonly design?: string;
  /** How many seconds `synth` sleeps before it produces anything. Default 3. */
  readonly sleepSeconds?: number;
  /** How many attempts fail with exit 3 before one succeeds. Default 0. */
  readonly failures?: number;
  /** How many attempts fail first per `RESULT_TAG`: a tagged tool has a counter of its own (#29). */
  readonly failuresByTag?: Readonly<Record<string, number>>;
  /** What this flow closes at, in ns. Default 2.20 — what `local-site.ts` generates. */
  readonly achievableNs?: number;
  /**
   * A symlink the `synth` stage plants at the Campaign workspace root before it writes anything:
   * `<name>` pointing at `<to>`, relative to that root.
   *
   * For the one test that needs the workspace to have been rearranged **by a Job of the Campaign's
   * own** — which is the way a link really gets into a workspace, a script the model wrote having
   * made one — rather than by the test reaching in during a window it has to win a race for.
   */
  readonly plantsLink?: { readonly name: string; readonly to: string };
}

/**
 * Generate the stand-in flow under the isolated home and return where it is.
 *
 * @param t - the test context. Nothing here skips any more: the stand-in computes its own qor report
 *            from the period it was asked for (#25), so no verified fixture has to be resolved
 *            before a flow can be written, and the answer is never absent. The parameter and the
 *            optional answer are kept exactly as they were because every fabric suite branches on
 *            them, and narrowing the shape would edit a hundred step-1 and step-2 tests to make them
 *            say what they already say.
 * @param h - the isolated home the flow is generated into.
 * @param opts - the design, how long `synth` sleeps, how many attempts fail first, and what the flow
 *               closes at.
 * @returns the flow root and what is in it.
 */
export async function writeStandinFlow(t: TestContext, h: HimaHome, opts: StandinOptions = {}): Promise<StandinFlow | undefined> {
  const flow = await generateStandinFlow({
    root: path.join(h.home, 'standin-flow'),
    design: opts.design,
    sleepSeconds: opts.sleepSeconds,
    failures: opts.failures,
    failuresByTag: opts.failuresByTag,
    achievableNs: opts.achievableNs,
    plantsLink: opts.plantsLink,
  });
  return { root: flow.root, design: flow.design, achievableNs: flow.achievableNs, failFile: flow.failFile };
}
