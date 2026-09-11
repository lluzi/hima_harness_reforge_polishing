// @hima-seam profile-home direct
// Making the DeepSeek Harness home the hima profile boots from.
//
// One module, two callers, for the same reason `host-launch.ts` is one module with two callers: the
// desktop shell's main process prepares the real `$DSH_HOME` before it starts a host, and the
// contract suite's `createHimaHome` prepares a throwaway one before every test. Until this file
// existed the only implementation of the recipe was the test support's, which meant `pnpm run
// desktop` on a machine that had never run the contract suite showed a stack trace in the window and
// the way out of it was to go and read test code.
//
// The dsh seam here is the home's own layout, not a package: dsh puts a profile at
// `$DSH_HOME/profiles/<name>`, resolves `$DSH_HOME` to `~/.dsh` when it is unset or blank, expands a
// leading `~`, and reads the profile's `package.json` (its bundle list) and `cordis.patch.yml` (the
// layer applied after every bundle). Those rules are `@deepseek-ai/dsh-home-paths`' and
// `@deepseek-ai/dsh-app-boot`'s; they are restated here rather than imported so this module keeps no
// compile-time coupling to dsh at all, the same trade `host-launch.ts` makes with the command line.
//
// Nothing in here imports a sibling module. The contract suite loads this file as TypeScript through
// Node's type stripping, which resolves specifiers literally — a `./host-launch.js` import would be a
// file that does not exist in `src/` — so what this module needs, it declares.
import { cp, mkdir, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The profile the workbench is: dsh's own web app plus the Hima bundle, under the privacy overlay. */
export const HIMA_PROFILE = 'hima';

/** Where dsh keeps profiles inside a home. */
const PROFILES_DIR = 'profiles';

/** The profile's own patch layer, applied after every bundle: HimaHarness's privacy overlay. */
const PROFILE_PATCH_FILE = 'cordis.patch.yml';

/** The profile manifest dsh reads its bundle list out of. */
const PROFILE_MANIFEST = 'package.json';

/** The bundle the profile links in, by the name its `dependencies` gives it. */
const HARNESS_PACKAGE = '@hima/harness';

/** Both halves of that bundle, which must be built before a home is worth booting. */
const HARNESS_BUNDLES = ['lib/index.js', 'lib/client.js'];

/** The default home dsh resolves when `$DSH_HOME` says nothing, spelled as dsh spells it. */
const DEFAULT_HOME_DIR = '.dsh';

/**
 * The home dsh will boot from, resolved the way dsh resolves it.
 *
 * `$DSH_HOME` when it is set to something that is not only whitespace — a blank one is treated as
 * unset, so an empty variable never puts the harness home in the current directory — with a leading
 * `~` expanded; otherwise `~/.dsh`. The caller passes the same environment the host will be given, so
 * the home this prepares is the home that host reads.
 *
 * @param env - the environment to read `DSH_HOME` from.
 * @returns the absolute home directory.
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.DSH_HOME;
  const chosen = named !== undefined && named.trim() !== '' ? named : path.join(homedir(), DEFAULT_HOME_DIR);
  if (chosen === '~') return homedir();
  const expanded = chosen.startsWith('~/') || chosen.startsWith('~\\') ? path.join(homedir(), chosen.slice(2)) : chosen;
  return path.resolve(expanded);
}

/**
 * The root of this checkout, from a module that sits exactly one directory under `packages/desktop`
 * whether it is being read as `src/hima-home.ts` or run as `lib/hima-home.js`.
 *
 * This is a development-time answer, which is what `pnpm run desktop` and the contract suite are. A
 * packaged application would carry the profile template and the bundle inside itself; packaging is
 * out of scope (ADR-0003).
 *
 * @returns the absolute repository root.
 */
export function checkoutRoot(): string {
  const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return path.resolve(packageDir, '../..');
}

/** The two things in this checkout a hima home is made out of. */
export interface HimaHomeSources {
  /** `profiles/hima`: the profile manifest and the privacy overlay, copied whole. */
  readonly profileTemplate: string;
  /** `packages/harness`: the built bundle the profile links to. */
  readonly harnessPackage: string;
}

/**
 * Where the profile template and the harness bundle are in a checkout.
 *
 * @param root - the checkout; this one by default.
 * @returns the two source directories.
 */
export function himaHomeSources(root: string = checkoutRoot()): HimaHomeSources {
  return {
    profileTemplate: path.join(root, PROFILES_DIR, HIMA_PROFILE),
    harnessPackage: path.join(root, 'packages/harness'),
  };
}

/**
 * Where the hima profile lives inside a home, whether or not it is there yet.
 *
 * @param home - the `$DSH_HOME`.
 * @returns the absolute profile directory.
 */
export function himaProfileDir(home: string): string {
  return path.join(path.resolve(home), PROFILES_DIR, HIMA_PROFILE);
}

/** A home with the hima profile in it, and what preparing it did. */
export interface PreparedHimaHome {
  readonly home: string;
  readonly profileDir: string;
  /** One line per thing done or found, in order, for whoever asked to see it. */
  readonly did: readonly string[];
}

export interface PrepareHimaHomeRequest {
  /** The `$DSH_HOME` to prepare. Created if it is not there. */
  readonly home: string;
  /** The checkout the template and the bundle come from; this one by default. */
  readonly root?: string;
}

/**
 * Put the hima profile in a home, or bring the one that is there up to this checkout.
 *
 * Four operations make a hima home, and this is all four of them:
 *
 * 1. the profile template copied to `$DSH_HOME/profiles/hima`,
 * 2. which carries the profile manifest naming the three bundles dsh should load,
 * 3. and `cordis.patch.yml`, the privacy overlay that turns off the plugin inventory report and
 *    session telemetry,
 * 4. with `@hima/harness` linked into the profile's own `node_modules`, which is where dsh looks for
 *    a bundle that is not installed from a registry — the link a `file:` dependency would leave.
 *
 * Idempotent, and deliberately asymmetric about what it will overwrite: a profile directory that is
 * already there is left alone, because a person may have edited its patch layer, but the link is
 * always refreshed, because a link to a checkout that has moved is the failure this exists to
 * prevent. A profile whose overlay has gone missing is reported, not rewritten.
 *
 * @param req - the home to prepare and the checkout to prepare it from.
 * @returns the home, the profile directory, and what was done.
 * @throws when the checkout has no profile template, or its bundle has not been built.
 */
export async function prepareHimaHome(req: PrepareHimaHomeRequest): Promise<PreparedHimaHome> {
  const sources = himaHomeSources(req.root);
  if (!existsSync(sources.profileTemplate)) throw new Error(`profile template missing: ${sources.profileTemplate}`);
  // Both halves must be built: the host's client-module registry fails activation loudly when a
  // package declaring `dsh.client` has no bundle, so a stale build would look like a boot failure.
  for (const half of HARNESS_BUNDLES) {
    if (!existsSync(path.join(sources.harnessPackage, half))) {
      throw new Error(`bundle not built: ${sources.harnessPackage}/${half} (run pnpm run build)`);
    }
  }

  const home = path.resolve(req.home);
  const profileDir = himaProfileDir(home);
  const did: string[] = [];

  if (existsSync(profileDir)) {
    did.push(`the ${HIMA_PROFILE} profile is already at ${profileDir}`);
  } else {
    await mkdir(profileDir, { recursive: true });
    await cp(sources.profileTemplate, profileDir, { recursive: true });
    did.push(`copied the ${HIMA_PROFILE} profile template into ${profileDir}`);
    did.push(`  ${PROFILE_MANIFEST}: the bundle list dsh boots`);
    did.push(`  ${PROFILE_PATCH_FILE}: the privacy overlay`);
  }
  if (!existsSync(path.join(profileDir, PROFILE_PATCH_FILE))) {
    did.push(`note: ${path.join(profileDir, PROFILE_PATCH_FILE)} is missing — this profile is running without the privacy overlay`);
  }

  // Out-of-tree bundles live in the profile's node_modules; a symlink is what pnpm would create for a
  // `file:` dependency. Replaced rather than left: the link names an absolute path into a checkout,
  // and a checkout that was moved or rebuilt elsewhere leaves a link pointing at nothing.
  const linkDir = path.join(profileDir, 'node_modules', path.dirname(HARNESS_PACKAGE));
  const link = path.join(profileDir, 'node_modules', HARNESS_PACKAGE);
  await mkdir(linkDir, { recursive: true });
  await rm(link, { recursive: true, force: true });
  await symlink(sources.harnessPackage, link, 'dir');
  did.push(`linked ${HARNESS_PACKAGE} → ${sources.harnessPackage}`);

  return { home, profileDir, did };
}
