// @hima-seam profile-home direct
// @hima-seam llm-replay direct
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
import { cp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
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

/**
 * Where dsh looks for the presets a person owns, inside a home: the user root its agent-preset
 * roster appends after every configured one. The Hima agent preset a Model moment is composed from
 * is installed here (#59), which is the one place a bundle's own preset can reach the roster without
 * the profile restating dsh's roster configuration — a config a bundle patch would have to copy key
 * for key and keep copying at every dsh bump.
 */
const PRESETS_DIR = '.agent-presets';

/** The preset a Model moment's session is composed from; the id is this directory's name. */
const MOMENT_PRESET = 'hima-moment';

/** dsh's keyless replay adapter, which a driven home mounts in place of the DeepSeek one (#59). */
const REPLAY_PACKAGE = '@deepseek-ai/dsh-llm-replay';

/**
 * The first line of every stand-in overlay this shell writes, and the only thing that makes one
 * removable.
 *
 * The home's patch layer is documented as a *person's* own tweak file. This shell writes one there
 * and takes it away again on the next boot that was given no stand-in — so "take it away" has to
 * mean "take away the one we wrote", and never "take away whatever is there". A file that does not
 * begin with this line is somebody's and is left exactly as it is.
 */
const STANDIN_MARKER = '# HimaHarness model stand-in (driver mode only)';

/** The route and the model the stand-in's catalog must name: the ones the profile's default selects. */
const REPLAY_PROVIDER = 'deepseek-official';
const REPLAY_MODEL = 'deepseek-v4-flash';

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

/** The three things in this checkout a hima home is made out of. */
export interface HimaHomeSources {
  /** `profiles/hima`: the profile manifest and the privacy overlay, copied whole. */
  readonly profileTemplate: string;
  /** `packages/harness`: the built bundle the profile links to. */
  readonly harnessPackage: string;
  /** `packages/harness/presets`: the agent presets the bundle ships, installed into the home. */
  readonly presets: string;
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
    presets: path.join(root, 'packages/harness/presets'),
  };
}

/**
 * Where the agent preset a Model moment is composed from lives inside a home (#59).
 *
 * @param home - the `$DSH_HOME`.
 * @returns the absolute preset directory.
 */
export function momentPresetDir(home: string): string {
  return path.join(path.resolve(home), PRESETS_DIR, MOMENT_PRESET);
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
  /** Relocatable product assets, supplied by an installation rather than a source checkout. */
  readonly sources?: HimaHomeSources;
  /** Copy published bundle assets into the home. Development keeps the existing linked build. */
  readonly bundleMode?: 'linked' | 'installed';
}

/**
 * Put the hima profile in a home, or bring the one that is there up to this checkout.
 *
 * Five operations make a hima home, and this is all five of them:
 *
 * 1. the profile template copied to `$DSH_HOME/profiles/hima`,
 * 2. which carries the profile manifest naming the three bundles dsh should load,
 * 3. and `cordis.patch.yml`, the privacy overlay that turns off the plugin inventory report and
 *    session telemetry,
 * 4. with `@hima/harness` linked into the profile's own `node_modules`, which is where dsh looks for
 *    a bundle that is not installed from a registry — the link a `file:` dependency would leave,
 * 5. and the agent presets the bundle ships copied into `$DSH_HOME/.agent-presets`, where dsh's
 *    roster finds them: `hima-moment`, the composition a Model moment's session is made of (#59).
 *
 * Idempotent, and deliberately asymmetric about what it will overwrite: a profile directory that is
 * already there is left alone, because a person may have edited its patch layer, but the link and
 * the presets are always refreshed, because a link to a checkout that has moved is the failure this
 * exists to prevent, and a preset is this bundle's own code rather than anyone's configuration — a
 * moment composed from last week's copy of it would be a moment nothing in this checkout describes.
 * A profile whose overlay has gone missing is reported, not rewritten.
 *
 * @param req - the home to prepare and the checkout to prepare it from.
 * @returns the home, the profile directory, and what was done.
 * @throws when the checkout has no profile template, or its bundle has not been built.
 */
export async function prepareHimaHome(req: PrepareHimaHomeRequest): Promise<PreparedHimaHome> {
  const sources = req.sources ?? himaHomeSources(req.root);
  if (!existsSync(sources.profileTemplate)) throw new Error(`profile template missing: ${sources.profileTemplate}`);
  // Both halves must be built: the host's client-module registry fails activation loudly when a
  // package declaring `dsh.client` has no bundle, so a stale build would look like a boot failure.
  for (const half of HARNESS_BUNDLES) {
    if (!existsSync(path.join(sources.harnessPackage, half))) {
      throw new Error(`bundle not built: ${sources.harnessPackage}/${half} (run pnpm run build)`);
    }
  }
  if (req.bundleMode === 'installed') {
    for (const asset of ['package.json', 'cordis.patch.yml', 'skills', 'rules', 'choosers', 'presets', 'semantics.yml']) {
      if (!existsSync(path.join(sources.harnessPackage, asset))) throw new Error(`installed bundle asset missing: ${asset}`);
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
  if (req.bundleMode === 'installed') {
    await mkdir(link, { recursive: true });
    for (const item of ['package.json', 'cordis.patch.yml', 'lib', 'skills', 'rules', 'choosers', 'presets', 'semantics.yml']) {
      await cp(path.join(sources.harnessPackage, item), path.join(link, item), { recursive: true });
    }
    // Runtime dependencies remain the dependency installation's responsibility. Link only that
    // package's declared dependencies, never its source, tests, repository or build configuration.
    const manifest = JSON.parse(await readFile(path.join(link, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
    for (const name of new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])) {
      const dependency = path.join(sources.harnessPackage, 'node_modules', name);
      if (!existsSync(dependency)) continue;
      const at = path.join(link, 'node_modules', name);
      await mkdir(path.dirname(at), { recursive: true });
      await symlink(await realpath(dependency), at, 'dir');
    }
    did.push(`installed ${HARNESS_PACKAGE} product assets into ${link}`);
  } else {
    await symlink(sources.harnessPackage, link, 'dir');
    did.push(`linked ${HARNESS_PACKAGE} → ${sources.harnessPackage}`);
  }

  // The bundle's own agent presets, where dsh's roster looks for a person's: copied rather than
  // linked, because discovery reads directories and a link is not one everywhere, and refreshed
  // rather than left, for the reason the doc comment above gives.
  if (existsSync(sources.presets)) {
    const presetDir = momentPresetDir(home);
    await rm(presetDir, { recursive: true, force: true });
    await mkdir(path.dirname(presetDir), { recursive: true });
    await cp(path.join(sources.presets, MOMENT_PRESET), presetDir, { recursive: true });
    did.push(`installed the ${MOMENT_PRESET} agent preset into ${presetDir}`);
  }

  return { home, profileDir, did };
}

/**
 * The keyless model stand-in a driven home is given, when it is given one (#59).
 *
 * `file` is the replay plugin's primary fixture — a session log it derives a script from — and
 * `overrideFile` the sidecar that replaces that derived script outright. Both are the plugin's own
 * vocabulary, passed through rather than renamed, because what they mean is documented there.
 */
export interface ReplayStandIn {
  readonly file: string;
  readonly overrideFile?: string;
  /**
   * Recorded child-session logs, in the order the adapter binds them (#62): the second live session
   * of the host process takes the first of these, the third the second, and so on.
   *
   * A scenario with more than one model session in one host process needs them, because a sidecar —
   * in either of its forms — replaces or patches the *primary* session's script alone (the adapter's
   * README, §Known limitations). The plugin's own vocabulary again, passed through rather than
   * renamed. Absent for every single-session scenario.
   */
  readonly childFiles?: readonly string[];
}

/**
 * Where a driven home's model stand-in is written: the home's own patch layer, which dsh applies
 * after every bundle and after the profile's own.
 *
 * The home's file and not the profile's, deliberately. The profile directory is the product — the
 * manifest, the privacy overlay, the bundle link — and a test that appended rows to it would be a
 * test that changed what it was testing. This file is nobody's but the harness that wrote it, is
 * rewritten whole on every driven boot, and leaves `profiles/hima/` byte for byte what
 * `prepareHimaHome` put there, which is what makes "the product profile is unchanged" a thing a test
 * can assert rather than a thing this comment claims.
 */
export function homePatchFile(home: string): string {
  return path.join(path.resolve(home), PROFILE_PATCH_FILE);
}

/**
 * Put the keyless replay adapter in the DeepSeek adapter's place, for a home a test drives (#59).
 *
 * Two rows: `llm-deepseek` disabled, and `@deepseek-ai/dsh-llm-replay` inserted with the scenario's
 * fixture and a provider catalog carrying the route and model the profile's own default names. The
 * result is a host that runs a real agent — a real session, a real loop, real tools — against a
 * fixed transcript, with no API key anywhere and no request leaving the machine.
 *
 * The row names the package by its **absolute resolved path** rather than by its specifier, which
 * dsh's patch loader accepts for an inserted row and converts to a file URL. A bare specifier would
 * be resolved from the profile directory inside the home, where nothing is installed: a seeded
 * profile holds one link, to the harness bundle, and the replay adapter is a development dependency
 * of this checkout that no product profile has any business declaring. Resolving it here keeps the
 * test-only dependency out of the profile manifest entirely.
 *
 * Written whole each time, so a second boot of the same home replaces the first boot's stand-in
 * rather than stacking a second one on top of it — which is what lets one test hang a moment's first
 * turn, restart the host, and have the next turn answer.
 *
 * @param home - the `$DSH_HOME` to write the overlay into.
 * @param replay - the fixture the stand-in replays.
 * @returns one line saying what was written, for whoever asked to see it.
 * @throws when the replay adapter cannot be resolved from this checkout.
 */
export async function writeReplayOverlay(home: string, replay: ReplayStandIn): Promise<string> {
  const at = createRequire(import.meta.url).resolve(REPLAY_PACKAGE);
  const rows = [
    `${STANDIN_MARKER}: dsh's keyless replay adapter in place of the`,
    '# DeepSeek one, so a driven host runs a real agent against a fixed transcript with no API key.',
    '# Written by the desktop shell on every driven boot, and by nothing else. Not the product.',
    '- id: llm-deepseek',
    '  disabled: true',
    '- insert:',
    '    - id: llm-replay',
    `      name: ${JSON.stringify(at)}`,
    '      config:',
    `        file: ${JSON.stringify(replay.file)}`,
    ...(replay.overrideFile === undefined ? [] : [`        overrideFile: ${JSON.stringify(replay.overrideFile)}`]),
    // A YAML flow sequence on one line, so the overlay stays the row-per-fact file it is; absent
    // altogether for a scenario with one session, which is every scenario before #62.
    ...(replay.childFiles === undefined || replay.childFiles.length === 0
      ? []
      : [`        childFiles: [${replay.childFiles.map((f) => JSON.stringify(f)).join(', ')}]`]),
    '        providers:',
    `          - id: ${REPLAY_PROVIDER}`,
    '            models:',
    `              - id: ${REPLAY_MODEL}`,
    '                contextWindow: 128000',
    '',
  ].join('\n');
  const file = homePatchFile(home);
  await writeFile(file, rows);
  return `wrote the model stand-in overlay into ${file}: ${REPLAY_PACKAGE} replaying ${replay.file}`;
}

/**
 * Take away the stand-in a previous boot left, and nothing else.
 *
 * A boot that was given no stand-in removes the overlay a previous one wrote, so a home is either
 * running against the replay adapter this boot named or against the product's own model route, and
 * never against the one a boot before it happened to leave behind.
 *
 * **Only the file this shell wrote.** `$DSH_HOME/cordis.patch.yml` is dsh's documented place for a
 * person's own tweak layer, and every boot of the window passes through here — so a file that does
 * not begin with {@link STANDIN_MARKER} is somebody's own and is left untouched, with the caller
 * told so. The marker is the whole of the ownership test, which is why it is written first and read
 * back rather than assumed.
 *
 * @param home - the `$DSH_HOME`.
 * @returns one line for whoever asked to see it, or nothing when there was no such file at all.
 */
export async function clearReplayOverlay(home: string): Promise<string | undefined> {
  const file = homePatchFile(home);
  let held;
  try {
    held = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  if (!held.startsWith(STANDIN_MARKER)) {
    return `left ${file} alone: it is not a model stand-in this shell wrote`;
  }
  await rm(file, { force: true });
  return `removed the model stand-in overlay a previous boot left at ${file}`;
}

// Explicit offline operator entry on the existing home module. Importing this module while a
// desktop or test prepares a home does nothing here; an import never starts a Host or model.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = 'usage: node packages/desktop/lib/hima-home.js --import-ledger <offline-v19.json> --home <new-empty-home>';
  const args = process.argv.slice(2);
  try {
    if (args.length !== 4 || args[0] !== '--import-ledger' || args[2] !== '--home' ||
      !args[1] || args[1].startsWith('--') || !args[3] || args[3].startsWith('--')) throw new Error(usage);
    const { importLegacyLedger } = await import('@hima/harness');
    const receipt = await importLegacyLedger({ sourceFile: args[1], home: args[3] });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`hima-home: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
