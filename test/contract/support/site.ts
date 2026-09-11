// Contract-test support: write a local Site and its Permit into the isolated home, and a sample report.
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { HimaHome } from './dsh-home.ts';
import { repoRoot } from './dsh-home.ts';
import { writeLocalSite as writeLocalSiteFiles } from '../../../packages/desktop/src/local-site.ts';

export interface LocalSite { readonly name: string; readonly sitesDir: string; readonly permitPath: string; }

/**
 * The local Site and its Permit, written into the isolated home. The files themselves are
 * `packages/desktop/src/local-site.ts`'s — the same writer `pnpm run desktop --site local` seeds a
 * developer's home with — so what a test proves on the local Site is what a developer runs against.
 *
 * `bindings` are what a HimaPack's run contract asks this Site for — the flow root, the design, the
 * workspace root. `parallelJobs` is the Site's declared job cap, one by default because that is what
 * the reference Site declares; a test whose subject is two Runs holding a Job at the same moment
 * says so here. `licences` is what the Site declares seats of, one Design Compiler seat per job slot
 * by default so that the shipped pack fits and the licence binds no tighter than the cap; a test
 * whose subject is a licence says what this Site has.
 */
export async function writeLocalSite(
  h: HimaHome,
  opts: {
    allowedReadRoots?: string[];
    allowedWriteRoots?: string[];
    allowedWrappers?: string[];
    bindings?: Record<string, string>;
    parallelJobs?: number;
    licences?: Record<string, number>;
  } = {},
): Promise<LocalSite> {
  const site = await writeLocalSiteFiles({
    sitesDir: path.join(h.home, 'hima/sites'),
    workspaceRoot: h.workspace,
    allowedReadRoots: opts.allowedReadRoots,
    allowedWriteRoots: opts.allowedWriteRoots,
    allowedWrappers: opts.allowedWrappers,
    bindings: opts.bindings,
    parallelJobs: opts.parallelJobs,
    licences: opts.licences,
  });
  return { name: site.name, sitesDir: site.sitesDir, permitPath: site.permitPath };
}

/**
 * A second site file, `alias.yml`, whose own `name:` is `local` — the shape a caller sees on this
 * Mac's case-insensitive filesystem, where `LOCAL` resolves to `local.yml`, and the shape any two
 * files sharing a `name:` produce on any filesystem. It points at the local site's own permit, so a
 * `loadSite` that skipped the name check would carry on exactly as `local` does — the mismatch is
 * the only thing left to catch it (#19). Call `writeLocalSite` first so that permit exists.
 */
export async function writeAliasSite(h: HimaHome): Promise<{ readonly name: string; readonly sitesDir: string }> {
  const sitesDir = path.join(h.home, 'hima/sites');
  await mkdir(sitesDir, { recursive: true });
  await writeFile(path.join(sitesDir, 'alias.yml'), [
    'name: local',
    'kind: local',
    `workspaceRoot: ${h.workspace}`,
    'permit: ./local.permit.yml',
    'capacity:',
    '  cores: 8',
    '  memoryGiB: 16',
    '  parallelJobs: 1',
    '  licences: {}',
    '',
  ].join('\n'));
  return { name: 'alias', sitesDir };
}

/**
 * A site whose declared permit path is a directory, not a file: a misconfiguration a site owner
 * made ahead of any request, never something the caller of an API request could have gotten right.
 * Reading it throws `EISDIR` from inside `loadSite`, well past the point where a site name is
 * merely unknown — the fixture this test suite uses to reach a genuinely internal fault.
 */
export async function writeSiteWithDirPermit(h: HimaHome, name = 'misconfigured'): Promise<{ name: string; sitesDir: string }> {
  const sitesDir = path.join(h.home, 'hima/sites');
  await mkdir(sitesDir, { recursive: true });
  const permitDir = path.join(sitesDir, `${name}.permit.yml`);
  await mkdir(permitDir, { recursive: true });
  await writeFile(path.join(sitesDir, `${name}.yml`), [
    `name: ${name}`,
    'kind: local',
    `workspaceRoot: ${h.workspace}`,
    `permit: ./${name}.permit.yml`,
    'capacity:',
    '  cores: 8',
    '  memoryGiB: 16',
    '  parallelJobs: 1',
    '  licences: {}',
    '',
  ].join('\n'));
  return { name, sitesDir };
}

/** Write a sample report under the workspace and return its declared path and hash. */
export async function writeSampleReport(h: HimaHome, rel = 'reports/sample.rpt', content = 'Setup views included:\n  WNS -0.073\n'): Promise<{ rel: string; sha256: string; bytes: number }> {
  const abs = path.join(h.workspace, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  return { rel, sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content) };
}

/** The committed reference-site template: the real `linglong` site file and its permit. */
export const referenceSiteDir = path.join(repoRoot, 'sites/linglong');

/** Install that template into the isolated home the way a customer's CAD would: the site file under
 *  its site name, the permit beside it under the name the site file gives. The files are copied
 *  byte-for-byte, so the tests exercise what the repository ships. */
export async function installReferenceSite(h: HimaHome): Promise<{ name: string; sitesDir: string }> {
  const sitesDir = path.join(h.home, 'hima/sites');
  await mkdir(sitesDir, { recursive: true });
  await cp(path.join(referenceSiteDir, 'site.yml'), path.join(sitesDir, 'linglong.yml'));
  await cp(path.join(referenceSiteDir, 'permit.yml'), path.join(sitesDir, 'permit.yml'));
  return { name: 'linglong', sitesDir };
}

/**
 * The installed reference site file again under a new name, with one thing about it changed: a
 * hostile destination, a smuggled jump chain, a different ControlPersist. Varying the committed file
 * rather than writing a fresh one is what makes such a test mean anything — the file under test is
 * the one the repository ships, differing only where the test says it differs.
 *
 * @param sitesDir - the installed sites directory, from `installReferenceSite`.
 * @param name - the new site's name, and its file name.
 * @param replacements - literal `[from, to]` substitutions applied to the reference file's text.
 * @returns the text written, so the caller can assert its variation is really in it.
 */
export async function writeReferenceSiteVariant(
  sitesDir: string,
  name: string,
  replacements: readonly (readonly [string, string])[],
): Promise<string> {
  let text = await readFile(path.join(sitesDir, 'linglong.yml'), 'utf8');
  for (const [from, to] of [['name: linglong', `name: ${name}`] as const, ...replacements]) {
    if (!text.includes(from)) throw new Error(`the reference site file holds no "${from}" to vary`);
    text = text.replace(from, to);
  }
  await writeFile(path.join(sitesDir, `${name}.yml`), text);
  return text;
}
