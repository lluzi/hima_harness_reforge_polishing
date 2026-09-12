// @hima-seam skills direct
// The pack authoring pipeline's five skills, carried on the host by one provider (#63).
//
// A HimaPack is authored by a person being carried through five stages — grill, spec, fabric, test,
// release — and each stage is a skill: instruction text a person invokes by typing its name, which
// the model then follows with its own read and write tools in the pack folder. That is the whole
// mechanism; dsh has no stage machine and needs none.
//
// **Why a programmatic provider and not a directory of files.** dsh's filesystem provider discovers
// skills under a person's own roots — their project, their home — which is exactly where a bundle's
// own skills must not be: they would be a thing installed into somebody's home that this bundle can
// no longer correct, and a person editing one would be editing the product. A provider registered
// from the bundle keeps the bodies inside the package, resolved from this module's own location, and
// takes them away again when the plugin unloads. It is the pattern dsh itself ships for a packaged
// skill (`@deepseek-ai/dsh-skill-badge`), and ADR-0001 records the skills seam as direct: it did not
// move between the tracked dsh versions.
//
// **Why the model may not choose one.** Every candidate is `userInvocable` and not `modelInvocable`.
// A stage is a person's decision — a pack author says "now spec it", and the cost of the model
// deciding that for itself is a pack folder rewritten by a stage nobody asked for. The consequence
// is deliberate: these five never appear in the model-facing skill catalog at all, and the only way
// into one is a person typing its name.
//
// **The bodies are read from disk on every load**, as the badge does: `ctx.skills.get` is called
// once per invocation, and a body edited in a checkout is the body the next invocation follows.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillDefinition, type SkillProvider } from '@deepseek-ai/dsh-skill';
import type { Context } from '@deepseek-ai/cordis';

/** The provider these five are registered under, which is also what `/hima pack check` names. */
export const HIMA_SKILL_PROVIDER = 'hima';

/** The pipeline's five stages, in the order a pack author is carried through them (CONTEXT.md). */
export const HIMA_SKILLS = ['hima-grill', 'hima-spec', 'hima-fabric', 'hima-test', 'hima-release'] as const;

/** One stage's name. */
export type HimaSkillName = (typeof HIMA_SKILLS)[number];

/**
 * The authoring knowledge the grill and spec stages read and cite, as file names.
 *
 * These are the *pipeline's* knowledge, not a pack's: what any pack author has to know to author
 * well, whichever business the pack is for. A HimaPack's own Knowledge files are a different thing
 * entirely (CONTEXT.md) — domain knowledge for one business, written into the pack folder by the
 * fabric stage and named by its contract — and nothing here is ever copied into one.
 */
export const HIMA_KNOWLEDGE_FILES = [
  'over-constrain-and-read-the-violation.md',
  'end-honestly-in-more-than-one-way.md',
  'assert-the-checker-options.md',
  'one-checker-per-session.md',
  'attribute-by-database-relation.md',
  'what-a-golden-flow-is.md',
] as const;

/**
 * The **seventh** reference file beside those six, and the fabric stage's alone: the skeleton of
 * every file kind a pack folder holds (#64).
 *
 * Not one of `HIMA_KNOWLEDGE_FILES`, deliberately. Those six are read in full and cited by three
 * stages, and they are knowledge about *method* — how a method is shaped, what a Golden Flow is.
 * This one is knowledge about *files*: which keys a contract holds, how a graph's edges are spelled,
 * what the smallest valid rule, chooser and reader declaration look like. The grill and spec stages
 * write no such file and have no use for it; the fabric stage cannot do its work without it, because
 * the pack installed beside the folder is one whole example and not a list of what every kind of
 * file may hold.
 */
export const HIMA_PACK_ANATOMY_FILE = 'pack-anatomy.md';

/** What each stage says of itself in the catalog: one sentence, in this domain's own vocabulary. */
const DESCRIPTIONS: Readonly<Record<HimaSkillName, string>> = {
  'hima-grill': 'Interview a pack author about the business a HimaPack is for, read the Golden Flow where it lies, settle every place the author\'s words and the flow disagree, and write the pack intent record into the pack folder.',
  'hima-spec': 'Turn the pack intent record into the pack spec: the goal template, constraints, run contract, semantics, judge rules, choosers, endings, workshops and knowledge, in the pack\'s own words.',
  'hima-fabric': 'Compile the pack spec into a HimaPack a Campaign can run: its contract, its graph, its semantics file, and the rules, choosers, reader scripts and knowledge they name — refusing a spec that contradicts itself, naming the line.',
  'hima-test': 'Run the compiled pack on a real Site as a campaign marked a test run, and write the test record from what that run recorded, without which a pack is not releasable.',
  'hima-release': 'Make a tested pack a version somebody can install: seal the files it is made of with the hashes this harness computed, and the test record it rests on.',
};

/**
 * The directory the five bodies and their knowledge sit in, inside the installed bundle.
 *
 * Resolved from this module's own location rather than from a configured path, because it is part of
 * the package: `packages/harness/skills/` in a checkout, `skills/` beside `lib/` in an install.
 * `package.json`'s `files` carries it, so an install has it.
 *
 * It is also what every candidate declares as its `resourceBase`, which is how a body's relative
 * `knowledge/<file>.md` resolves for the model: dsh tells the session the base directory and the
 * model resolves against it.
 *
 * @returns the absolute skills directory.
 */
export function himaSkillsDir(): string {
  return fileURLToPath(new URL('../skills/', import.meta.url));
}

/** Where one stage's instruction body is. */
const bodyFile = (name: HimaSkillName): string => path.join(himaSkillsDir(), name, 'SKILL.md');

/** The candidate list, computed once: five bundled skills a person may invoke and the model may not. */
const candidates: readonly SkillCandidate[] = HIMA_SKILLS.map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  invocation: { modelInvocable: false, userInvocable: true },
  provider: HIMA_SKILL_PROVIDER,
  source: 'bundled' as const,
  resourceBase: { kind: 'directory' as const, path: himaSkillsDir() },
  rank: BUNDLED_SKILL_RANK,
  locator: name,
  path: bodyFile(name),
}));

/** The candidate one name belongs to, or undefined when this provider does not own that name. */
const candidateNamed = (name: string): SkillCandidate | undefined => candidates.find((c) => c.name === name);

/**
 * The provider, as `ctx.skills.registerProvider` borrows it.
 *
 * `get` **fails closed**: a body this bundle ships and cannot read is a broken installation, not a
 * skill that has stopped existing, and the difference matters — `undefined` means "no longer
 * loadable" to the registry, which would quietly turn `/hima-grill` into a message that did nothing
 * at all. So a missing or unreadable body throws, naming the file, and the person sees it.
 *
 * The one thing that does answer `undefined` is a name this provider never listed, which is the
 * registry asking a question about somebody else's skill.
 */
export function himaSkillProvider(): SkillProvider {
  return {
    name: HIMA_SKILL_PROVIDER,
    list: () => Promise.resolve(candidates),
    async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
      const mine = candidateNamed(candidate.name);
      if (mine === undefined) return undefined;
      const at = bodyFile(mine.name as HimaSkillName);
      let content: string;
      try {
        content = await readFile(at, 'utf8');
      } catch (err) {
        throw new Error(`the ${HIMA_SKILL_PROVIDER} skill "${mine.name}" has no readable body at ${at}: ${(err as Error).message}`);
      }
      return {
        name: mine.name,
        description: mine.description,
        invocation: mine.invocation,
        provider: mine.provider,
        source: mine.source,
        resourceBase: mine.resourceBase!,
        path: at,
        content,
      };
    },
  };
}

/**
 * Put the five stages on a host, for as long as the bundle is mounted.
 *
 * @param ctx - the context the bundle was applied with; its `skills` registry takes the provider.
 * @returns the registry's own disposer, so the caller can hold it as one effect.
 */
export function registerHimaSkills(ctx: Context): () => void {
  return ctx.skills.registerProvider(() => himaSkillProvider());
}
