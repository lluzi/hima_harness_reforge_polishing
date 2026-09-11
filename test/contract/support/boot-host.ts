// Contract-test support: boot the hima profile as a real subprocess and wait until it serves.
//
// The launching itself lives in `packages/desktop/src/host-launch.ts`, which the desktop window's
// main process uses too. Two implementations of "start the hima profile and wait for it" is two
// products: a window that boots the host differently from the way every contract test boots it is a
// window nothing here tests. This file is the test suite's own view of that one act — the shape the
// existing tests already hold, plus the isolated home's environment.
import type { ChildProcess } from 'node:child_process';
import type { HimaHome } from './dsh-home.ts';
import { dshBin } from './dsh-home.ts';
import { HIMA_PROFILE } from '../../../packages/desktop/src/hima-home.ts';
import { freePort as reservePort, launchHimaHost } from '../../../packages/desktop/src/host-launch.ts';

export interface BootedHost {
  readonly child: ChildProcess;
  readonly url: string;
  readonly port: number;
  stdout(): string;
  stderr(): string;
  /** SIGTERM and wait for exit; resolves with the exit code. */
  stop(): Promise<number | null>;
}

export const freePort = reservePort;

/**
 * Boot `dsh --profile hima --host 127.0.0.1 --port <free> --no-open` and resolve once it serves.
 *
 * @param h - the isolated home the host boots from.
 * @param timeoutMs - how long the host has to print its URL and start answering.
 * @returns the booted host.
 */
export async function bootHimaHost(h: HimaHome, timeoutMs = 90_000): Promise<BootedHost> {
  const host = await launchHimaHost({
    dshEntry: dshBin,
    node: process.execPath,
    cwd: h.workspace,
    env: { ...h.env, BROWSER: 'none' },
    profile: HIMA_PROFILE,
    timeoutMs,
  });
  return {
    child: host.child,
    url: host.url,
    port: host.port,
    stdout: host.stdout,
    stderr: host.stderr,
    // Fifteen seconds rather than the shell's four: a contract test asserts this host exited zero,
    // and a clean shutdown that took longer than the grace period would read as a crash.
    stop: () => host.stop(15_000),
  };
}
