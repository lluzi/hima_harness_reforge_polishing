// The Campaign file: one human-readable draft of what a Campaign will be prepared and started with,
// living in the session workspace at `hima/campaign.yml`. It is the unified configuration surface
// (#41 task 3) — the person and HimaGuide both read and edit it, Preparation accepts it as overrides
// over the Pack's own defaults and the Site's own bindings, and the start route can confirm straight
// from it. It creates nothing on its own: the Ledger's proposal id remains the only confirmed fact,
// and this file is a draft a workspace holds beside it (Q63, ADR-0009 — the UI never bypasses the
// Site Permit, and neither does this file: every overridden input still passes through `checkPack`
// and `boundInputs` against the Site's own Permit-checked bindings).
//
// One reason to change: what a person may declare in this file, and how a declared field turns into
// a `PreparationOverrides` a Pack's own Preparation accepts. Reading it, writing it and turning it
// into overrides are one file because all three are read together everywhere this file is used: a
// route that read it one way and wrote it another would drift, and a caller of `overridesOf` who did
// not also parse the same schema could compute overrides no file on disk actually says.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

/** Where this file lives inside a session workspace, relative to its root. */
export const CAMPAIGN_FILE_RELATIVE = 'hima/campaign.yml';

/** This file's own format identity, carried as its first field so a reader never has to guess. */
export const CAMPAIGN_SCHEMA = 'hima-campaign/1';

export const campaignFileSchema = z.strictObject({
  schema: z.literal(CAMPAIGN_SCHEMA),
  name: z.string().trim().min(1).max(120).optional(),
  pack: z.strictObject({ id: z.string().min(1), version: z.string().min(1).optional() }).optional(),
  site: z.union([
    z.strictObject({ name: z.string().min(1) }),
    z.strictObject({
      ssh: z.strictObject({ destination: z.string().min(1), jumps: z.array(z.string().min(1)).default([]) }),
      hints: z.strictObject({
        workspaceRoot: z.string().optional(),
        allowedReadRoots: z.array(z.string()).default([]),
        allowedWriteRoots: z.array(z.string()).default([]),
        allowedWrappers: z.array(z.string()).default([]),
        toolCommands: z.array(z.string()).default([]),
      }).default({ allowedReadRoots: [], allowedWriteRoots: [], allowedWrappers: [], toolCommands: [] }),
    }),
  ]).optional(),
  inputs: z.record(z.string(), z.string()).default({}),
  goal: z.record(z.string(), z.number()).default({}),
  strategy: z.record(z.string(), z.union([z.number(), z.string().min(1)])).default({}),
  budget: z.strictObject({
    timeBoxMinutes: z.number().positive().optional(),
    retries: z.number().int().nonnegative().optional(),
    generations: z.number().int().positive().optional(),
  }).default({}),
  knowledge: z.array(z.string()).default([]),
  notes: z.string().default(''),
});

export type CampaignFile = z.infer<typeof campaignFileSchema>;

/** What a fresh workspace has before anyone has written anything: the schema line and nothing else,
 *  every collection empty. What `GET /hima/api/campaign` answers when no file exists yet, so a
 *  caller always has one shape to render whether or not a person has started editing. */
export function emptyCampaignFile(): CampaignFile {
  return campaignFileSchema.parse({ schema: CAMPAIGN_SCHEMA });
}

/** One sentence naming the field a document failed on, never the zod issue tree: the person reading
 *  this is not this file's author, and a stack of paths is not a sentence. */
function oneSentence(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'the Campaign file does not hold a readable document.';
  const field = issue.path.length > 0 ? issue.path.map(String).join('.') : 'the document';
  return `the Campaign file's "${field}" ${issue.message.toLowerCase().replace(/\.$/, '')}.`;
}

/** Parse a Campaign file's text. Throws one sentence naming the field on any schema error. */
export function parseCampaignFile(text: string): CampaignFile {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new Error(`the Campaign file is not readable YAML: ${(err as Error).message}`);
  }
  const result = campaignFileSchema.safeParse(raw ?? { schema: CAMPAIGN_SCHEMA });
  if (!result.success) throw new Error(oneSentence(result.error));
  return result.data;
}

/** Serialize a Campaign file back to YAML, keys in schema order, with the leading comment every
 *  written copy of this file carries — the one sentence saying who edits it and why a person who
 *  opens it in a plain editor should not be surprised to see it change under HimaGuide's own hand. */
export function serializeCampaignFile(file: CampaignFile): string {
  const ordered: Record<string, unknown> = { schema: file.schema };
  if (file.name !== undefined) ordered.name = file.name;
  if (file.pack !== undefined) ordered.pack = file.pack;
  if (file.site !== undefined) ordered.site = file.site;
  ordered.inputs = file.inputs;
  ordered.goal = file.goal;
  ordered.strategy = file.strategy;
  ordered.budget = file.budget;
  ordered.knowledge = file.knowledge;
  ordered.notes = file.notes;
  return `# HimaHarness Campaign — edited by the person and by HimaGuide\n${stringifyYaml(ordered)}`;
}

/** Read the file out of a session workspace, or `undefined` when nothing is there yet. Any other
 *  filesystem fault propagates: a workspace this process cannot read is not "no file". */
export function readCampaignFile(workspace: string):
  { readonly file: CampaignFile; readonly text: string; readonly mtimeMs: number } | undefined {
  const full = path.join(workspace, CAMPAIGN_FILE_RELATIVE);
  let text: string;
  let mtimeMs: number;
  try {
    text = readFileSync(full, 'utf8');
    mtimeMs = statSync(full).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  return { file: parseCampaignFile(text), text, mtimeMs };
}

/** Write the file into a session workspace: `mkdir -p hima/`, then an atomic rename so a reader
 *  never observes a half-written document. */
export function writeCampaignFile(workspace: string, file: CampaignFile): { readonly text: string; readonly mtimeMs: number } {
  const validated = campaignFileSchema.parse(file);
  const text = serializeCampaignFile(validated);
  const dir = path.join(workspace, 'hima');
  mkdirSync(dir, { recursive: true });
  const full = path.join(dir, 'campaign.yml');
  const tmp = path.join(dir, `.campaign.yml.tmp-${randomUUID()}`);
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, full);
  return { text, mtimeMs: statSync(full).mtimeMs };
}

/** What Preparation accepts from a Campaign file: a Goal with no defaults filled in, Strategy knobs
 *  overlaid on the Pack's own, Site input bindings overlaid on the Site's own, and Budget overrides.
 *  Every field mirrors the file exactly — an absent Goal parameter here is absent, never a default a
 *  caller invented, because a Goal is never filled from a default (#41 task 3). */
export interface PreparationOverrides {
  readonly goal?: Readonly<Record<string, number>>;
  readonly strategy?: Readonly<Record<string, number | string>>;
  readonly inputs?: Readonly<Record<string, string>>;
  readonly budget?: CampaignFile['budget'];
}

/** The overrides a Campaign file states, read straight off its own fields. */
export const overridesOf = (file: CampaignFile): PreparationOverrides => ({
  goal: file.goal,
  strategy: file.strategy,
  inputs: file.inputs,
  budget: file.budget,
});

/** Every dotted path whose value differs between two Campaign files, e.g. `['goal.clock_period',
 *  'inputs.design']` — what a person or HimaGuide changed, for an edit summary that names the field
 *  rather than dumping the whole document. Object fields recurse; anything else (a string, a number,
 *  an array, `undefined`) is compared by its JSON identity and named whole. */
export function changedFields(before: CampaignFile, after: CampaignFile): string[] {
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const changed: string[] = [];
  const walk = (a: unknown, b: unknown, prefix: string): void => {
    if (isPlainObject(a) && isPlainObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk(a[key], b[key], prefix === '' ? key : `${prefix}.${key}`);
      }
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(prefix);
  };
  walk(before, after, '');
  return changed;
}
