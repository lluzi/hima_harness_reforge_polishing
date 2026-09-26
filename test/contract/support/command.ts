// @hima-seam commands direct
// Contract-test support: run one `/hima ...` line through a booted host's real command runtime, on a
// real root agent, and read back what a person would see. Every caller wanted the same three things
// out of it — did it succeed, what did it say, which run did it name — so they are what it returns,
// and `exec.result.kind` is not a chain each test file re-walks.
//
// Nothing is asserted here: a command that fails outright is a `kind: 'error'` outcome carrying the
// reason, so a test can assert on it and the acceptance script can record it as a finding rather
// than aborting a run against the real site.
import { createRootAgent, type InProcessHost } from './boot-inprocess.ts';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-commands';

export interface CommandOutcome {
  readonly kind: 'success' | 'error';
  /** What the command answered, as a person reads it; empty when it answered nothing. */
  readonly text: string;
  /** The run the answer names, when it names one. */
  readonly runId: string | undefined;
}

/** How long one command may take. A local read is quick; a probe on a real Site is not. */
export const localCommandTimeoutMs = 10_000;
export const siteCommandTimeoutMs = 60_000;
/** Native model-backed commands such as /compact may legitimately outlive local file operations. */
export const modelCommandTimeoutMs = 180_000;

/**
 * Execute one command line on a booted in-process host.
 *
 * @param host - the booted host.
 * @param workspace - the cwd the agent runs in.
 * @param line - the whole command line, `/hima observe local reports/x.rpt` and the like.
 * @param timeoutMs - how long to wait for the command to answer.
 * @param on - an agent to run the line on, for a test that cannot afford to make one here. Creating
 *             an agent costs milliseconds, which is nothing next to a Site — except to a test racing
 *             a window inside one launch, which makes its agent before the race and hands it in.
 * @returns the outcome: whether it succeeded, its text, and the run id its text names.
 */
export async function himaCommand(host: InProcessHost, workspace: string, line: string, timeoutMs = localCommandTimeoutMs, on?: Agent): Promise<CommandOutcome> {
  const agent = on ?? (await createRootAgent(host.ctx, workspace));
  const exec = await host.ctx.commands.execute(agent, line, [], AbortSignal.timeout(timeoutMs));
  if (!exec) return { kind: 'error', text: `the command runtime did not resolve "${line}" at all`, runId: undefined };
  const text = exec.result.text ?? '';
  // A record id starts with its run id (`run-…#000001`), so this one pattern finds the run in every
  // answer that names either.
  return { kind: exec.result.kind === 'success' ? 'success' : 'error', text, runId: /run-[0-9a-f-]+/.exec(text)?.[0] };
}
