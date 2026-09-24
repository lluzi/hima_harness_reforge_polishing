// A Site is one file; its Permit is another the site owner edits. Both are plain YAML.
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { SshChannel, discoverSiteFacts, type Channel, type SiteDiscoveryFact } from './channel.js';
import { SiteNotFoundError } from './errors.js';

export type SiteSaveIdentity =
  | { readonly kind: 'new' }
  | { readonly kind: 'existing'; readonly siteSha256: string; readonly permitSha256: string };

/** A reviewed Site changed, or conflicts with the discovery target, before it can be saved.  The
 * Host maps this recoverable caller state to a conflict response rather than an internal failure. */
export class SiteDiscoveryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteDiscoveryConflictError';
  }
}

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

const absolutePosixPath = z.string().regex(/^\//, 'a discovered Site path must be absolute');
const maximumDiscoveryRoots = 64;

/** The small amount of non-secret direction a person may give discovery. It is intentionally not a
 * free-form command, environment, credential, or YAML escape hatch. */
export const siteDiscoveryRequestSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]*$/, 'a Site name starts with a letter and uses letters, digits, ".", "_" or "-"'),
  ssh: sshSchema,
  hints: z.object({
    workspaceRoot: absolutePosixPath.optional(),
    // Rediscovery reuses the Site owner's already-reviewed Permit. Real EDA Sites commonly span
    // PDK, RTL, constraints, tools and several project roots, so the discovery transport must hold
    // that existing profile rather than rejecting it at the old eight-root UI hint ceiling.
    allowedReadRoots: z.array(absolutePosixPath).max(maximumDiscoveryRoots).default([]),
    allowedWriteRoots: z.array(absolutePosixPath).max(maximumDiscoveryRoots).default([]),
    allowedWrappers: z.array(z.string().min(1)).max(16).default([]),
    /** Executable names requested by the selected Pack; discovery never invents vendor tools. */
    toolCommands: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/)).max(32).default([]),
  }).default({ allowedReadRoots: [], allowedWriteRoots: [], allowedWrappers: [], toolCommands: [] }),
});
export type SiteDiscoveryRequest = z.input<typeof siteDiscoveryRequestSchema>;

export const discoveryFactSchema = z.object({
  probe: z.array(z.string()),
  code: z.number().int(),
  stdout: z.string(),
  stderr: z.string().optional(),
});

export const discoverySchema = z.object({
  observedAt: z.string().datetime(),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  facts: z.array(discoveryFactSchema),
  unknowns: z.array(z.string()),
  stale: z.boolean().default(false),
});
export type SiteDiscovery = z.infer<typeof discoverySchema>;

/**
 * What a licence is called. One shape for both the file that declares seats of it and the pack whose
 * tool asks for them, because the two are matched by exact string: one name in a site file and that
 * same name in a run contract are one seat, and nothing else is. Dashes, dots and underscores are
 * allowed because that is how a vendor spells a licence feature, and the Site owner copies it as it
 * is rather than transliterating it into something this harness would rather read.
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
    /** Facts seen during the last bounded profile discovery. They are descriptive, never a Permit. */
    discovery: discoverySchema.optional(),
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
       * node-locked implementation licence — so a tool that holds one can never launch here, and
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
export interface Site extends z.infer<typeof siteSchema> { readonly file: string; readonly permitFile: string; readonly permitSha256: string; readonly permitRules: Permit }

export interface SiteDiscoveryResult {
  readonly site: Omit<z.input<typeof siteSchema>, 'discovery'> & { readonly discovery: SiteDiscovery };
  readonly permit: Permit;
  readonly unknowns: readonly string[];
  readonly conflicts: readonly string[];
}

interface ReviewedSite {
  readonly site: z.infer<typeof siteSchema>;
  readonly identity: Extract<SiteSaveIdentity, { kind: 'existing' }>;
}

const sha256 = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
const discoveryCacheSchema = z.strictObject({
  schema: z.literal('hima-site-discovery-cache/1'),
  siteName: siteDiscoveryRequestSchema.shape.name,
  siteSha256: z.string().regex(/^[a-f0-9]{64}$/),
  permitSha256: z.string().regex(/^[a-f0-9]{64}$/),
  discovery: discoverySchema,
});
type DiscoveryCache = z.infer<typeof discoveryCacheSchema>;
type DiscoveryCacheRead = { readonly kind: 'absent' }
  | { readonly kind: 'read'; readonly value: DiscoveryCache }
  | { readonly kind: 'collision'; readonly reason: string };
const maximumDiscoveryCacheBytes = 2 * 1024 * 1024;

const discoveryCachePath = (sitesDir: string, name: string): string => path.join(sitesDir, `${name}.discovery.json`);

/** Read the reserved derived-observation file without following a leaf symlink.  A malformed,
 * non-regular or differently named file is somebody else's collision, never data to repair. */
function readDiscoveryCache(sitesDir: string, name: string): DiscoveryCacheRead {
  const at = discoveryCachePath(sitesDir, name);
  let fd: number | undefined;
  try {
    fd = openSync(at, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const state = fstatSync(fd);
    if (!state.isFile()) return { kind: 'collision', reason: 'it is not a regular file' };
    if (state.size > maximumDiscoveryCacheBytes) return { kind: 'collision', reason: 'it exceeds the bounded discovery-cache size' };
    const parsed = discoveryCacheSchema.safeParse(JSON.parse(readFileSync(fd, 'utf8')));
    if (!parsed.success || parsed.data.siteName !== name) return { kind: 'collision', reason: 'it is not a Hima discovery cache for this Site' };
    return { kind: 'read', value: parsed.data };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    return { kind: 'collision', reason: (error as Error).message };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function projectedDiscovery(site: z.infer<typeof siteSchema>, identity: Extract<SiteSaveIdentity, { kind: 'existing' }>, cache: DiscoveryCacheRead): SiteDiscovery | undefined {
  if (cache.kind === 'read' && cache.value.siteSha256 === identity.siteSha256 && cache.value.permitSha256 === identity.permitSha256) {
    return cache.value.discovery;
  }
  if (cache.kind !== 'absent' && site.discovery !== undefined) return { ...site.discovery, stale: true };
  return site.discovery;
}

/** A unique same-directory temporary.  Exclusive create plus O_NOFOLLOW means an orphan or symlink
 * at the chosen leaf is never opened.  The UUID is retained only until publication/cleanup. */
function writeExclusiveTemporary(at: string, bytes: string): string {
  const temporary = `${at}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return temporary;
}

function removeOwnedTemporary(temporary: string): void {
  try { unlinkSync(temporary); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

/** Publish a new policy file with hard-link no-clobber semantics.  Once linked, the final inode is
 * never removed by this operation: a partial pair is left explicit rather than risking deletion of
 * administrator bytes after an ambiguous race or process interruption. */
function publishNewPolicyFile(at: string, bytes: string, what: string): void {
  const temporary = writeExclusiveTemporary(at, bytes);
  try {
    try { linkSync(temporary, at); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new SiteDiscoveryConflictError(`${what} appeared while discovery was being saved; existing bytes were preserved`);
      throw error;
    }
  } finally {
    removeOwnedTemporary(temporary);
  }
}

/** Replace only a recognized disposable cache.  An absent destination is published by a no-clobber
 * hard link; a recognized prior cache is atomically replaced.  Policy files are never in this path. */
function publishDiscoveryCache(sitesDir: string, name: string, cache: DiscoveryCache): void {
  const at = discoveryCachePath(sitesDir, name);
  const before = readDiscoveryCache(sitesDir, name);
  if (before.kind === 'collision') throw new SiteDiscoveryConflictError(`discovery cache collision at ${at}: ${before.reason}`);
  const bytes = `${JSON.stringify(cache, null, 2)}\n`;
  const temporary = writeExclusiveTemporary(at, bytes);
  try {
    if (before.kind === 'absent') {
      try { linkSync(temporary, at); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new SiteDiscoveryConflictError(`discovery cache collision at ${at}; existing bytes were preserved`);
        throw error;
      }
    } else {
      const current = readDiscoveryCache(sitesDir, name);
      if (current.kind !== 'read'
        || current.value.siteSha256 !== before.value.siteSha256
        || current.value.permitSha256 !== before.value.permitSha256
        || JSON.stringify(current.value.discovery) !== JSON.stringify(before.value.discovery)) {
        throw new SiteDiscoveryConflictError(`discovery cache changed while ${name} was being saved; existing bytes were preserved`);
      }
      renameSync(temporary, at);
      return;
    }
  } finally {
    removeOwnedTemporary(temporary);
  }
}

function rejectUnknownPolicyKeys(raw: unknown, allowed: readonly string[], what: string): void {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return;
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${what} contains unrecognized policy field(s): ${unknown.join(', ')}`);
}

/** Read the owner-reviewed policy exactly as the save path needs it.  Discovery facts may be
 * replaced, but a rediscovery neither accepts unknown policy fields nor derives policy from probes. */
function reviewedSite(sitesDir: string, name: string): ReviewedSite | undefined {
  const file = path.join(sitesDir, `${name}.yml`);
  let siteBytes: string;
  try {
    siteBytes = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  // Discovery never has authority to discard an owner field it cannot understand.  `loadSite`
  // remains backwards-compatible for reads; save is deliberately stricter because it writes.
  const rawSite = parse(siteBytes);
  rejectUnknownPolicyKeys(rawSite, ['name', 'kind', 'workspaceRoot', 'permit', 'bindings', 'ssh', 'discovery', 'capacity'], 'Site');
  if (rawSite !== null && typeof rawSite === 'object' && !Array.isArray(rawSite)) {
    const policy = rawSite as { capacity?: unknown; ssh?: unknown };
    rejectUnknownPolicyKeys(policy.capacity, ['cores', 'memoryGiB', 'parallelJobs', 'licences'], 'Site capacity');
    rejectUnknownPolicyKeys(policy.ssh, ['destination', 'jumps', 'controlPersistSeconds'], 'Site SSH');
  }
  const site = siteSchema.strict().parse(rawSite);
  if (site.name !== name) {
    throw new SiteNotFoundError(`unknown site "${name}": ${file} is the site file of "${site.name}"; a Site's name is the one its file states`);
  }
  const permitBytes = readFileSync(path.resolve(path.dirname(file), site.permit), 'utf8');
  const rawPermit = parse(permitBytes) ?? {};
  rejectUnknownPolicyKeys(rawPermit, ['allowedReadRoots', 'allowedWriteRoots', 'allowedWrappers', 'forbidden'], 'Permit');
  permitSchema.strict().parse(rawPermit);
  return {
    site,
    identity: { kind: 'existing', siteSha256: sha256(siteBytes), permitSha256: sha256(permitBytes) },
  };
}

/** The byte identities a rediscovery preview must return and a later save must present.  `new`
 * means no Site file existed when previewed; a concurrent create therefore also refuses to save. */
export function siteSaveIdentity(sitesDir: string, name: string): SiteSaveIdentity {
  return reviewedSite(sitesDir, siteDiscoveryRequestSchema.shape.name.parse(name))?.identity ?? { kind: 'new' };
}

function sameSaveIdentity(expected: SiteSaveIdentity, actual: SiteSaveIdentity): boolean {
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === 'new') return true;
  return actual.kind === 'existing'
    && expected.siteSha256 === actual.siteSha256
    && expected.permitSha256 === actual.permitSha256;
}

const discoveryFingerprint = (request: z.infer<typeof siteDiscoveryRequestSchema>): string =>
  createHash('sha256').update(JSON.stringify({ name: request.name, ssh: request.ssh, hints: request.hints })).digest('hex');

const nonSecret = (value: string): string => value
  .replace(/(password|token|secret|private[_ -]?key)\s*[:=]\s*[^\s]+/gi, '$1=[redacted]')
  .slice(0, 16_384);

function unknownsFrom(facts: readonly SiteDiscoveryFact[]): string[] {
  const unknowns: string[] = [];
  const answered = (verb: string, arg?: string) => facts.some((fact) => fact.probe[0] === verb && (arg === undefined || fact.probe[1] === arg) && fact.code === 0);
  if (!answered('uname')) unknowns.push('host operating-system facts were not available');
  if (!answered('tmux')) unknowns.push('tmux availability/version was not available');
  for (const fact of facts.filter((item) => item.probe[0] === 'which' && item.code !== 0)) unknowns.push(`${fact.probe[1]} command was not identified`);
  return unknowns;
}

/** Capacity already observed by the fixed discovery probes. Missing or malformed facts stay at a
 * conservative one; usable facts are bounded into the current product's five-Job Site cap. */
function capacityFrom(facts: readonly SiteDiscoveryFact[]): { cores: number; memoryGiB: number; parallelJobs: number } {
  const textOf = (...probe: string[]): string | undefined => facts.find((fact) =>
    fact.code === 0 && fact.probe.length === probe.length && fact.probe.every((word, at) => word === probe[at]))?.stdout.trim();
  const parsedCores = Number.parseInt(textOf('getconf', '_NPROCESSORS_ONLN') ?? '', 10);
  const cores = Number.isSafeInteger(parsedCores) && parsedCores > 0 ? parsedCores : 1;
  const memTotalKb = /^MemTotal:\s+(\d+)\s+kB$/m.exec(textOf('cat', '--', '/proc/meminfo') ?? '')?.[1];
  const parsedMemoryKb = Number.parseInt(memTotalKb ?? '', 10);
  const memoryGiB = Number.isSafeInteger(parsedMemoryKb) && parsedMemoryKb > 0
    ? Math.max(1, Math.round(parsedMemoryKb / 104857.6) / 10)
    : 1;
  return { cores, memoryGiB, parallelJobs: Math.max(1, Math.min(5, cores)) };
}

/**
 * Learn a draft Site profile through SshChannel's closed probe vocabulary. This is deliberately not
 * a Campaign action: it creates no Run, workspace, Job, or Ledger record.
 *
 * `channelFor` is how the Host swaps in a test-only stand-in Channel (#41 task 4) that answers from
 * a fixed table instead of spawning `ssh`; every caller outside a test leaves it at its default,
 * which is the ordinary `SshChannel` this function has always used.
 */
export async function discoverSshSite(
  input: SiteDiscoveryRequest,
  channelFor: (name: string, ssh: SshTarget) => Channel = (name, ssh) => new SshChannel(name, ssh),
): Promise<SiteDiscoveryResult> {
  const request = siteDiscoveryRequestSchema.parse(input);
  const facts = await discoverSiteFacts(channelFor(request.name, request.ssh), request.hints.toolCommands);
  const unknowns = unknownsFrom(facts);
  const workspaceRoot = request.hints.workspaceRoot ?? '/';
  const conflicts = request.hints.workspaceRoot === undefined
    ? ['workspaceRoot was not supplied; profile is saved with no permitted read/write roots until the Site owner chooses one']
    : [];
  const discovery = discoverySchema.parse({
    observedAt: new Date().toISOString(),
    inputFingerprint: discoveryFingerprint(request),
    facts: facts.map((fact) => ({ ...fact, stdout: nonSecret(fact.stdout), ...(fact.stderr ? { stderr: nonSecret(fact.stderr) } : {}) })),
    unknowns,
    stale: false,
  });
  const permit: Permit = {
    allowedReadRoots: request.hints.allowedReadRoots,
    allowedWriteRoots: request.hints.allowedWriteRoots,
    allowedWrappers: request.hints.allowedWrappers,
    forbidden: ['deletions'],
  };
  const capacity = capacityFrom(facts);
  return {
    site: { name: request.name, kind: 'ssh', workspaceRoot, permit: `./${request.name}.permit.yml`, bindings: {}, ssh: request.ssh,
      discovery, capacity: { ...capacity, licences: {} } },
    permit,
    unknowns,
    conflicts,
  };
}

/** Save a reviewed discovery result through the ordinary Site interface.
 *
 * A first save publishes new Site and Permit policy with no-clobber links.  Rediscovery never writes
 * either policy file: it writes a hash-bound, disposable observation cache that `loadSite` projects
 * only while both policy byte identities still match.  This is deliberately not described as a
 * multi-file transaction; an interrupted first save may leave an explicit orphan Permit, which a
 * later call refuses rather than deleting bytes whose ownership is no longer certain. */
export function saveDiscoveredSite(sitesDir: string, result: SiteDiscoveryResult, expected?: SiteSaveIdentity): Site {
  const name = siteDiscoveryRequestSchema.shape.name.parse(result.site.name);
  const file = path.join(sitesDir, `${name}.yml`);
  const permitFile = path.join(sitesDir, `${name}.permit.yml`);
  mkdirSync(sitesDir, { recursive: true });
  const directory = lstatSync(sitesDir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new SiteDiscoveryConflictError('the Sites directory must be a plain directory');
  const existing = reviewedSite(sitesDir, name);
  const actualIdentity = existing?.identity ?? { kind: 'new' as const };
  if (expected !== undefined && !sameSaveIdentity(expected, actualIdentity)) {
    throw new SiteDiscoveryConflictError(`Site discovery preview is stale for "${name}"; reload the reviewed Site and Permit before saving`);
  }
  if (existing !== undefined && (existing.site.kind !== result.site.kind
    || JSON.stringify(existing.site.ssh) !== JSON.stringify(sshSchema.parse(result.site.ssh)))) {
    throw new SiteDiscoveryConflictError(`Site discovery target conflicts with reviewed Site "${name}"; reload and explicitly review the changed Site identity`);
  }
  const safeDiscovery = {
    ...result.site.discovery,
    facts: result.site.discovery.facts.map((fact) => ({
      ...fact,
      stdout: nonSecret(fact.stdout),
      ...(fact.stderr === undefined ? {} : { stderr: nonSecret(fact.stderr) }),
    })),
  };
  discoverySchema.parse(safeDiscovery);
  const cacheAt = discoveryCachePath(sitesDir, name);
  const cacheBefore = readDiscoveryCache(sitesDir, name);
  if (cacheBefore.kind === 'collision') throw new SiteDiscoveryConflictError(`discovery cache collision at ${cacheAt}: ${cacheBefore.reason}`);

  let expectedPolicyIdentity: Extract<SiteSaveIdentity, { kind: 'existing' }>;
  if (existing === undefined) {
    const { discovery: _derived, ...policy } = result.site;
    const safeSite = siteSchema.parse({ ...policy, permit: `./${name}.permit.yml` });
    const safePermit = permitSchema.parse(result.permit);
    const siteBytes = stringify(safeSite);
    const permitBytes = stringify(safePermit);
    expectedPolicyIdentity = { kind: 'existing', siteSha256: sha256(siteBytes), permitSha256: sha256(permitBytes) };
    publishNewPolicyFile(permitFile, permitBytes, `Permit ${permitFile}`);
    try {
      publishNewPolicyFile(file, siteBytes, `Site ${file}`);
    } catch (error) {
      throw new SiteDiscoveryConflictError(`${(error as Error).message}; the newly published Permit was retained because safe cross-process rollback cannot be established`);
    }
  } else expectedPolicyIdentity = existing.identity;

  const bound = reviewedSite(sitesDir, name);
  if (bound === undefined) throw new SiteDiscoveryConflictError(`Site ${name} was not published`);
  if (!sameSaveIdentity(expectedPolicyIdentity, bound.identity)) {
    throw new SiteDiscoveryConflictError(`Site or Permit policy changed before rediscovery could be published; administrator bytes were left untouched`);
  }
  publishDiscoveryCache(sitesDir, name, { schema: 'hima-site-discovery-cache/1', siteName: name,
    siteSha256: bound.identity.siteSha256, permitSha256: bound.identity.permitSha256, discovery: safeDiscovery });
  const after = reviewedSite(sitesDir, name);
  if (after === undefined || !sameSaveIdentity(bound.identity, after.identity)) {
    throw new SiteDiscoveryConflictError(`Site or Permit policy changed while rediscovery was published; the observation remains stale and administrator bytes were left untouched`);
  }
  return loadSite(sitesDir, name);
}

/** Whether a loaded profile is stale against the current connection input. Facts stay readable; only
 * readiness changes, so an old Campaign can keep its recorded Site identity. */
export function discoveryIsStale(site: Site, input: SiteDiscoveryRequest): boolean {
  if (!site.discovery) return true;
  const request = siteDiscoveryRequestSchema.parse(input);
  return site.discovery.stale || site.discovery.inputFingerprint !== discoveryFingerprint(request);
}

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
  const permitBytes = readFileSync(permitFile, 'utf8');
  const permitRules = permitSchema.parse(parse(permitBytes) ?? {});
  const identity = { kind: 'existing' as const, siteSha256: sha256(raw), permitSha256: sha256(permitBytes) };
  const discovery = projectedDiscovery(site, identity, readDiscoveryCache(sitesDir, name));
  const { discovery: _inlineDiscovery, ...policy } = site;
  return { ...policy, ...(discovery === undefined ? {} : { discovery }), file, permitFile, permitSha256: identity.permitSha256, permitRules };
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
