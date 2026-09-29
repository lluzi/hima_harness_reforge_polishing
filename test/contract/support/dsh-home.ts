// Contract-test support: an isolated DeepSeek Harness home, empty or with the Hima profile installed.
// Seam: the booted-Host boundary. Tests observe only what the host prints or answers.
//
// Making the profile is not this file's recipe any more: `packages/desktop/src/hima-home.ts` holds
// the four operations, and the desktop shell prepares the person's real `$DSH_HOME` with the same
// ones. What stays here is what only a test needs — a throwaway home, its environment, and the
// disposal.
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { appendFileSync, realpathSync } from 'node:fs';
import { himaHomeSources, himaProfileDir, prepareHimaHome } from '../../../packages/desktop/src/hima-home.ts';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const dshBin = path.join(repoRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
export const profileTemplateDir = himaHomeSources(repoRoot).profileTemplate;
export const harnessPackageDir = himaHomeSources(repoRoot).harnessPackage;

/** Test-only cost evidence. No paths, command arguments or credentials enter the journal. */
export function recordTestBoot(kind: 'host-process' | 'host-in-process' | 'electron'): void {
  const at = process.env.HIMA_TEST_BOOT_LOG;
  if (at) appendFileSync(at, `${kind}\n`);
}

export interface HimaHome {
  readonly home: string;
  readonly profileDir: string;
  readonly workspace: string;
  readonly env: NodeJS.ProcessEnv;
  dispose(): Promise<void>;
}

/** Where a throwaway home is made. */
export interface HomeShape {
  /**
   * The desktop kit's layout (#63): `<kit>/Data/dsh` for the home and `<kit>/Workspace` beside it,
   * under this checkout's ignored `.hima-tmp/` rather than the platform temp area. dsh's
   * `workspace-write` sandbox lets every session write the platform temp areas, so a home made there
   * cannot show what a person's own home refuses; one made here can.
   */
  readonly desktopShaped?: boolean;
}

/** Every place dsh's `workspace-write` mode lets any session write besides its workspace. */
function temporaryRoots(): string[] {
  return [...new Set(['/tmp', os.tmpdir(), process.env.TMPDIR].filter((at): at is string => !!at).map((at) => {
    try { return realpathSync(at); } catch { return path.resolve(at); }
  }))];
}

/**
 * Where desktop-shaped kits are made: this checkout's ignored `.hima-tmp/`, or — when the checkout
 * itself lies in a temporary area, as a disposable worktree does — the same folder in the user's
 * home. Refuses a place inside any temporary root, because a kit there proves nothing.
 */
async function desktopKitsDir(): Promise<string> {
  const outside = (at: string): boolean => temporaryRoots().every((root) => at !== root && !at.startsWith(root + path.sep));
  const checkout = realpathSync(repoRoot);
  const kits = outside(checkout) ? path.join(checkout, '.hima-tmp') : path.join(realpathSync(os.homedir()), '.hima-tmp');
  if (!outside(kits)) throw new Error(`no place outside the temporary areas for a desktop-shaped home: ${kits}`);
  await mkdir(kits, { recursive: true });
  return kits;
}

/**
 * A throwaway `$DSH_HOME` with nothing in it: what a machine that has never run HimaHarness has.
 *
 * The `profileDir` it names does not exist. Whatever is given this home has to make the profile
 * itself — which is exactly what the desktop shell does, and what its own test proves, through the
 * shell's driver mode, by starting from here.
 *
 * @param shape - where the home is made; the platform temp area by default.
 * @returns the empty home, its environment, and its disposal.
 */
export async function createEmptyHome(shape: HomeShape = {}): Promise<HimaHome> {
  let root: string; let home: string; let workspace: string;
  if (shape.desktopShaped) {
    const kits = await desktopKitsDir();
    root = await realpath(await mkdtemp(path.join(kits, 'desktop-kit-')));
    home = path.join(root, 'Data', 'dsh');
    workspace = path.join(root, 'Workspace');
    await mkdir(home, { recursive: true });
  } else {
    root = home = await mkdtemp(path.join(os.tmpdir(), 'hima-home-'));
    workspace = path.join(home, 'workspace');
  }
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
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

/** Create a throwaway $DSH_HOME holding the `hima` profile, the way an installed consumer would have it. */
export async function createHimaHome(shape: HomeShape = {}): Promise<HimaHome> {
  const empty = await createEmptyHome(shape);
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
