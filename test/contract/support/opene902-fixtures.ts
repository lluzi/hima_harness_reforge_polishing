// Contract-test support: resolve a local copy of a real opene902 report named in the manifest,
// verifying its SHA-256 first. Vendor content never enters this repository (see the manifest's
// `note`): the copies live under the manifest's `localCopyDir`, outside the repo.
//
// A missing or hash-mismatched copy FAILS the test that asked for it, naming the reason. It used to
// skip, which is the same failure wearing a green coat: the checked hash is the whole point of the
// fixture (#4, story 27), and a suite that quietly stops checking real reports proves nothing. The
// one escape hatch is `HIMA_FIXTURES_OPTIONAL=1`, for a machine that has never had the copies; with
// it set, and only then, an unresolvable fixture skips its test instead.
import type { TestContext } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedReportCopy } from '../../../packages/desktop/src/local-site.ts';

const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/opene902.manifest.json');

/** Set to `1` to make an unresolvable fixture skip its test rather than fail it. */
export const FIXTURES_OPTIONAL_ENV = 'HIMA_FIXTURES_OPTIONAL';

/**
 * The verified local path of one opene902 fixture, for a test that cannot do its job without it.
 *
 * @param t - the test context, used only to skip under the documented escape hatch.
 * @param name - the file name as the manifest lists it.
 * @returns the absolute path; `undefined` only when `HIMA_FIXTURES_OPTIONAL=1` made this a skip.
 * @throws when the copy is missing or its SHA-256 does not match and the escape hatch is not set.
 */
/**
 * Does this machine hold a verified copy of one opene902 fixture?
 *
 * For a test whose subject is what the harness *said* it used rather than what it read: the shell
 * copies the real report where the manifest's checked copy is here and a written one where it is
 * not, and a test that accepted either line would pass whichever it said. Asks the same manifest and
 * the same hash `requireOpene902Fixture` does; what it does not carry is that one's fail-or-skip
 * policy, because a machine with no copy is not a failure here — it is the other branch.
 *
 * @param name - the file name as the manifest lists it.
 * @returns whether the copy is there and its SHA-256 matches.
 */
export const opene902FixtureHere = async (name: string): Promise<boolean> => (await verifiedReportCopy(manifestPath, name)).ok;

export async function requireOpene902Fixture(t: TestContext, name: string): Promise<string | undefined> {
  // The manifest read and the hash check are `local-site.ts`'s, which `pnpm run desktop --site
  // local` seeds a developer's home with; what stays here is the fail-or-skip policy.
  const resolution = await verifiedReportCopy(manifestPath, name);
  if (resolution.ok) return resolution.path;
  if (process.env[FIXTURES_OPTIONAL_ENV] === '1') {
    t.skip(`${resolution.reason} (${FIXTURES_OPTIONAL_ENV}=1)`);
    return undefined;
  }
  throw new Error(`${resolution.reason}\nSet ${FIXTURES_OPTIONAL_ENV}=1 to skip the tests that need it instead.`);
}
