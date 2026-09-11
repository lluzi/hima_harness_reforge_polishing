// Contract-test support: an isolated DeepSeek Harness home, empty or with the Hima profile installed.
// Seam: the booted-Host boundary. Tests observe only what the host prints or answers.
//
// Making the profile is not this file's recipe any more: `packages/desktop/src/hima-home.ts` holds
// the four operations, and the desktop shell prepares the person's real `$DSH_HOME` with the same
// ones. What stays here is what only a test needs — a throwaway home, its environment, and the
// disposal.
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { himaHomeSources, himaProfileDir, prepareHimaHome } from '../../../packages/desktop/src/hima-home.ts';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const dshBin = path.join(repoRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
export const profileTemplateDir = himaHomeSources(repoRoot).profileTemplate;
export const harnessPackageDir = himaHomeSources(repoRoot).harnessPackage;

export interface HimaHome {
  readonly home: string;
  readonly profileDir: string;
  readonly workspace: string;
  readonly env: NodeJS.ProcessEnv;
  dispose(): Promise<void>;
}

/**
 * A throwaway `$DSH_HOME` with nothing in it: what a machine that has never run HimaHarness has.
 *
 * The `profileDir` it names does not exist. Whatever is given this home has to make the profile
 * itself — which is exactly what the desktop shell does, and what its own test proves, through the
 * shell's driver mode, by starting from here.
 *
 * @returns the empty home, its environment, and its disposal.
 */
export async function createEmptyHome(): Promise<HimaHome> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hima-home-'));
  const workspace = path.join(home, 'workspace');
  await mkdir(workspace, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_AGENTS_HOME: path.join(home, 'agents'),
    DSH_TELEMETRY_DISABLED: '1',
  };
  return {
    home,
    profileDir: himaProfileDir(home),
    workspace,
    env,
    dispose: () => rm(home, { recursive: true, force: true }),
  };
}

/** Create a throwaway $DSH_HOME holding the `hima` profile, the way an installed consumer would have it. */
export async function createHimaHome(): Promise<HimaHome> {
  const empty = await createEmptyHome();
  const prepared = await prepareHimaHome({ home: empty.home, root: repoRoot });
  return { ...empty, profileDir: prepared.profileDir };
}

export interface DshRun { readonly code: number | null; readonly stdout: string; readonly stderr: string; }

/** Run the real dsh CLI against the isolated home and wait for it to exit. */
export function runDsh(h: HimaHome, args: readonly string[], timeoutMs = 60_000): Promise<DshRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dshBin, ...args], { cwd: h.workspace, env: h.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`dsh ${args.join(' ')} timed out\n${stderr}`)); }, timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
