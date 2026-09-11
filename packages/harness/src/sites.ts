// A Site is one file; its Permit is another the site owner edits. Both are plain YAML.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { SiteNotFoundError } from './errors.js';

export const permitSchema = z.object({
  allowedReadRoots: z.array(z.string()).default([]),
  allowedWriteRoots: z.array(z.string()).default([]),
  allowedWrappers: z.array(z.string()).default([]),
  forbidden: z.array(z.string()).default([]),
});
export type Permit = z.infer<typeof permitSchema>;

/** `user@host`, optionally with a `:port` suffix. Anchored end to end and limited to the characters
 *  a hostname or username can hold, so nothing shaped like an ssh option (`-oProxyCommand=...`), a
 *  `-J` chain separator (a bare comma), or a second shell argument can ever reach the ssh argv through
 *  a site file. Bracketed IPv6 (`[::1]`) is not supported yet — such a destination is refused. */
const sshTargetPattern = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?::[0-9]{1,5})?$/;
const sshTarget = (what: string) =>
  z
    .string()
    .min(1)
    .regex(sshTargetPattern, `${what} must look like user@host or user@host:port (letters, digits, '.', '_', '-' only; bracketed IPv6 not supported yet)`)
    .refine(
      (value) => {
        const port = /:([0-9]{1,5})$/.exec(value)?.[1];
        return port === undefined || (Number(port) >= 1 && Number(port) <= 65535);
      },
      { error: `${what} port must be between 1 and 65535` },
    );

/** Where a Site of kind ssh is and how HimaChannel gets there. No credential: the harness uses the
 *  owner's own OpenSSH client, keys, and agent. */
export const sshSchema = z.object({
  /** user@host, optionally with a :port suffix. */
  destination: sshTarget('destination'),
  /** Bastions to pass through, in order, exactly as ssh -J takes them. A single-hop site lists none.
   *  Each entry is a single user@host[:port]; a comma inside one entry would be read by ssh as an
   *  extra hop appended to the chain, so it is refused here rather than trusted to -J. */
  jumps: z.array(sshTarget('each jumps entry')).default([]),
  /** How long the warm control connection outlives the last operation. */
  controlPersistSeconds: z.number().int().positive().default(60),
});
export type SshTarget = z.infer<typeof sshSchema>;

/**
 * What a licence is called. One shape for both the file that declares seats of it and the pack whose
 * tool asks for them, because the two are matched by exact string: `Design-Compiler` in a site file
 * and `Design-Compiler` in a run contract are one seat, and nothing else is. Dashes and dots are
 * allowed because that is how the tools are actually named (`Design-Compiler`, `Innovus_Impl_System`).
 */
export const licenceName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, 'a licence name is a letter followed by letters, digits, ".", "_" or "-"');

export const siteSchema = z
  .object({
    name: z.string(),
    kind: z.enum(['local', 'ssh']),
    workspaceRoot: z.string(),
    permit: z.string(),
    /**
     * What this Site binds for the inputs a HimaPack's run contract names: the flow root, the design,
     * the workspace root. A pack moves to another Site by editing this map, never the pack — which is
     * what makes a pack portable rather than a copy per Site.
     *
     * The keys are not constrained to any one pack's inputs, because a Site may host several packs
     * and knows about none of them; `/hima pack check` is where a pack's inputs are held against what
     * a Site actually bound, and an input with no binding is an error naming it, never a default.
     */
    bindings: z.record(z.string(), z.string()).default({}),
    ssh: sshSchema.optional(),
    capacity: z.object({
      cores: z.number().int().positive(),
      memoryGiB: z.number().positive(),
      parallelJobs: z.number().int().positive(),
      /**
       * How many seats of each licence this Site reserves for the harness: one of the Budget's
       * meters (CONTEXT.md, *Budget*), counted across every Run of the Site exactly as
       * `parallelJobs` is, because a licence is the Site's and not a Campaign's.
       *
       * A count of **0** is a licence the Site owner reserves nothing of — the reference site's
       * node-locked Innovus line — so a tool that holds one can never launch here, and
       * `/hima pack check` says so rather than letting a Run wait for a seat that will never come
       * free. A licence **absent** from the map is one this Site does not declare at all, which is
       * the same refusal said the other way: a Site cannot be held to a count it never stated.
       */
      licences: z.record(licenceName, z.number().int().nonnegative()).default({}),
    }),
  })
  .refine((s) => s.kind !== 'ssh' || s.ssh !== undefined, {
    error: 'a site of kind ssh needs an ssh section naming its destination',
    path: ['ssh'],
  });
export interface Site extends z.infer<typeof siteSchema> { readonly file: string; readonly permitFile: string; readonly permitRules: Permit }

/** How paths on this Site are spelled. A remote Site's are POSIX whatever this machine is, so every
 *  decision, every workspace path, and every command argument is joined the Site's own way and not
 *  the harness machine's. */
export const pathsOf = (site: Site): path.PlatformPath => (site.kind === 'local' ? path : path.posix);

// Re-exported so a caller of `loadSite` finds the error it can throw right beside it.
export { SiteNotFoundError };

/**
 * Load `<sitesDir>/<name>.yml` and the permit it names. Throws when either is missing or invalid:
 * fail closed. Also throws `SiteNotFoundError` when the file's own `name:` is not `name` — a Site's
 * identity is the one its file states, never the string that resolved it (#19).
 */
export function loadSite(sitesDir: string, name: string): Site {
  const file = path.join(sitesDir, `${name}.yml`);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new SiteNotFoundError(`unknown site "${name}": no site file at ${file}`);
    throw err;
  }
  const site = siteSchema.parse(parse(raw));
  // A Site's identity is the `name:` its own file states, and nothing else — not the string a caller
  // typed, not the file name that resolved it. On this Mac's case-insensitive filesystem `LOCAL`
  // resolves to `local.yml`; refusing here, before the permit is even read, is what keeps every cap,
  // chain and record that keys on `site.name` agreeing with a caller who asked for `LOCAL` (#19).
  if (site.name !== name) {
    throw new SiteNotFoundError(`unknown site "${name}": ${file} is the site file of "${site.name}"; a Site's name is the one its file states`);
  }
  const permitFile = path.resolve(path.dirname(file), site.permit);
  const permitRules = permitSchema.parse(parse(readFileSync(permitFile, 'utf8')) ?? {});
  return { ...site, file, permitFile, permitRules };
}

/**
 * Every Site installed here, by name, in the order a person reads a list: what the workbench's start
 * form offers, so nobody has to know a Site's name by heart to start a Campaign (#26).
 *
 * The name is the file's own, not the file name — a Site's identity is what its own `name:` states
 * (#19), and offering the file name would offer a Site that `loadSite` then refuses. A file this
 * module cannot read or parse is passed over rather than raising: a form that would not render
 * because one Site file beside the others is broken is a worse answer than a shorter list, and
 * starting a Run on that Site still says exactly what is wrong with it. A permit is not read at all,
 * for the same reason `installedPacks` does not load a pack: the form offers a name to choose.
 *
 * @param sitesDir - the directory holding one `<site>.yml` per Site.
 * @returns the Site names, sorted; empty when there is no such directory at all.
 */
export function installedSites(sitesDir: string): string[] {
  let files: string[];
  try {
    files = readdirSync(sitesDir);
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const file of files) {
    // `<name>.permit.yml` sits beside `<name>.yml` and is not a Site; `.yml` alone would take it.
    if (!file.endsWith('.yml') || file.endsWith('.permit.yml')) continue;
    try {
      const parsed: unknown = parse(readFileSync(path.join(sitesDir, file), 'utf8'));
      const name = (parsed as { name?: unknown } | null)?.name;
      // Only a Site whose own name resolves back to this very file: `loadSite` refuses any other,
      // so offering one would be offering something that cannot be started.
      if (typeof name === 'string' && `${name}.yml` === file) names.push(name);
    } catch {
      // Unreadable or not YAML: not a Site this form can offer, and not this list's to report on.
    }
  }
  return names.sort();
}
