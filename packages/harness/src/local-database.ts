// The existing Host owns one private PostgreSQL cluster per Hima Home. No database daemon,
// external credentials or cloud service is required of the person opening the App.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

export const POSTGRES_VERSION = '16.15';
export interface LocalDatabaseConnection {
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}
export interface LocalDatabase {
  readonly identity: string;
  readonly application: LocalDatabaseConnection;
  readonly system: LocalDatabaseConnection;
  /** Consumers close DBOS and all connection pools before stopping the cluster. */
  stop(): Promise<void>;
}
interface Credentials { identity: string; port: number; user: string; password: string; version: string }
interface Owner { pid: number; processIdentity: string; token: string }
interface RuntimeManifest {
  format: 'hima-postgres-runtime/1'; version: string; platform: string;
  source: { sha256: string }; files: Record<string, string>;
}

export function localDatabaseHome(env: NodeJS.ProcessEnv = process.env): string {
  const selected = env.DSH_HOME;
  const named = selected !== undefined && selected.trim() !== '' ? selected : path.join(homedir(), '.dsh');
  return path.resolve(named === '~' ? homedir() : named.startsWith('~/') ? path.join(homedir(), named.slice(2)) : named);
}

/** Headless Hosts and Desktop use the same runtime. HIMA_POSTGRES_RUNTIME names an installed
 * pinned native distribution in source deployments; the packaged App supplies its resource path. */
export function localDatabaseRuntime(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HIMA_POSTGRES_RUNTIME;
  if (explicit?.trim()) return path.resolve(explicit);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../postgres');
}

function problem(message: string): Error { return new Error(`Local PostgreSQL: ${message}`); }
async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) {
    throw problem(`the private directory ${directory} is not owned by this user. Select an owned Hima Home.`);
  }
  await chmod(directory, 0o700);
}
async function privateFile(file: string): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()) || (info.mode & 0o077) !== 0) {
    throw problem(`the private file ${file} has unsafe ownership or permissions. Restore the original private Home.`);
  }
  return readFile(file, 'utf8');
}

/** Never put credentials in argv or child output. libpq receives its password in its environment;
 * initdb receives a private temporary password file. Errors name the operation, without its input. */
async function command(executable: string, argv: string[], options: { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, LC_ALL: 'C' };
    // No ambient libpq service/options can redirect the private cluster's identity query.
    for (const name of ['PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS', 'PGPASSFILE', 'PGHOSTADDR']) delete env[name];
    const child = spawn(executable, argv, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, options.timeoutMs ?? 30_000);
    child.stdout.on('data', value => { out += String(value); });
    child.stderr.on('data', value => { err += String(value); });
    child.once('error', error => { clearTimeout(timer); reject(problem(`${path.basename(executable)} could not run: ${(error as NodeJS.ErrnoException).code ?? 'spawn error'}. Check the installed native runtime.`)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(problem(`${path.basename(executable)} timed out. Its database state is unknown; the Home and PID were retained for identity checking on reopening.`));
      else resolve({ code, out, err });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input);
  });
}

async function processIdentity(pid: number): Promise<string | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  const answer = await command('/bin/ps', ['-p', String(pid), '-o', 'lstart=', '-o', 'command=']);
  return answer.code === 0 && answer.out.trim() ? answer.out.trim() : undefined;
}

async function ownHome(root: string): Promise<() => Promise<void>> {
  const lock = path.join(root, 'host-owner');
  const currentIdentity = await processIdentity(process.pid);
  if (!currentIdentity) throw problem('the current Host process identity could not be verified. No database process was started.');
  const claimant = { pid: process.pid, processIdentity: currentIdentity, token: randomUUID() };
  const stage = path.join(root, `owner-${claimant.token}`);
  await mkdir(stage, { mode: 0o700 });
  await writeFile(path.join(stage, 'owner.json'), JSON.stringify(claimant), { mode: 0o600 });
  const inspect = async (): Promise<Owner> => {
    const owner = JSON.parse(await privateFile(path.join(lock, 'owner.json'))) as Owner;
    if (!owner.token || !owner.processIdentity || !Number.isSafeInteger(owner.pid)) throw problem('the Host owner lock has no valid identity. Preserve the Home and inspect the interrupted startup.');
    if ((await processIdentity(owner.pid)) === owner.processIdentity) throw problem(`this Home is already owned by Host PID ${owner.pid}. Return to the running App or quit it before reopening.`);
    return owner;
  };
  try {
    if (await exists(lock)) {
      await inspect();
      // Reclamation is serialized. A crashed reclamation blocks rather than deleting a fresh lock.
      const reclaim = path.join(root, 'owner-reclaim');
      try { await mkdir(reclaim, { mode: 0o700 }); }
      catch { throw problem('an interrupted Host owner reclamation needs inspection. Preserve the Home; no process was stopped.'); }
      try { await inspect(); await rm(lock, { recursive: true }); }
      finally { await rm(reclaim, { recursive: true }); }
    }
    try { await rename(stage, lock); }
    catch { throw problem('another Host acquired this Home while it was opening. Return to the running App.'); }
  } finally { await rm(stage, { recursive: true, force: true }); }
  return async () => {
    const current = JSON.parse(await privateFile(path.join(lock, 'owner.json'))) as Owner;
    if (current.token !== claimant.token) throw problem('the Host owner changed; its lock was preserved.');
    await rm(lock, { recursive: true });
  };
}

async function portAvailable(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(problem(`loopback port ${port} is occupied. Close its owning App or restore this Home into a separate private Home; no process was stopped.`)));
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(problem('no loopback port was allocated')));
    });
  });
}

/** Verify the postmaster's OS identity before using its PID, then the database's own identity over
 * authenticated loopback. A stale PID is never removed here; pg_ctl/PostgreSQL reconcile their own
 * stale PID only after we establish that no process owns that identity. */
async function postmaster(data: string, postgres: string, port: number): Promise<number | undefined> {
  const file = path.join(data, 'postmaster.pid');
  if (!(await exists(file))) return undefined;
  const lines = (await readFile(file, 'utf8')).split('\n');
  const pid = Number(lines[0]);
  if (!Number.isSafeInteger(pid) || pid <= 1 || lines[1] !== data || Number(lines[3]) !== port) {
    throw problem('the postmaster PID file has a different database identity. Preserve it; no process was stopped.');
  }
  const identity = await processIdentity(pid);
  if (!identity) return undefined;
  if (!identity.includes(`${postgres} -D ${data}`)) throw problem(`PID ${pid} belongs to a different process. Preserve the PID file; no process was stopped.`);
  return pid;
}

export async function startLocalDatabase(options: { readonly home: string; readonly runtimeDirectory?: string; readonly timeoutMs?: number }): Promise<LocalDatabase> {
  if (process.getuid?.() === 0) throw problem('PostgreSQL cannot run as root. Open HimaHarness as an ordinary user.');
  const runtime = await realpath(options.runtimeDirectory ?? localDatabaseRuntime()).catch(() => { throw problem('the native runtime is missing. Install this App\'s pinned PostgreSQL distribution or set HIMA_POSTGRES_RUNTIME.'); });
  const manifest = JSON.parse(await readFile(path.join(runtime, 'postgres-runtime.json'), 'utf8').catch(() => { throw problem('the native runtime manifest is missing. Reinstall the pinned distribution.'); })) as RuntimeManifest;
  if (manifest.format !== 'hima-postgres-runtime/1' || manifest.version !== POSTGRES_VERSION || manifest.platform !== `${process.platform}-${process.arch}`
    || manifest.source?.sha256 !== 'c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed') {
    throw problem('the native runtime is incompatible with this App/platform. Install PostgreSQL 16.15 from this App distribution.');
  }
  if (!manifest.files || !['bin/postgres', 'bin/pg_ctl', 'bin/initdb', 'bin/psql'].every(file => typeof manifest.files[file] === 'string')) throw problem('the runtime manifest has no complete executable inventory. Reinstall the pinned distribution.');
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw problem('the runtime manifest contains an invalid file path. Reinstall the pinned distribution.');
    const file = path.join(runtime, relative);
    const info = await lstat(file).catch(() => { throw problem('an inventoried native runtime file is missing. Reinstall the pinned distribution.'); });
    const actual = info.isSymbolicLink() ? `symlink:${await readlink(file)}` : info.isFile() ? createHash('sha256').update(await readFile(file)).digest('hex') : undefined;
    if (actual !== expected || !(await realpath(file)).startsWith(runtime + path.sep)) throw problem('native runtime bytes or dependency links differ from their pinned manifest. Reinstall the pinned distribution.');
  }
  const bin = (name: string) => path.join(runtime, 'bin', name);
  const version = await command(bin('postgres'), ['--version']);
  if (version.code !== 0 || !version.out.trim().endsWith(` ${POSTGRES_VERSION}`)) throw problem('the installed postgres executable does not match the pinned runtime manifest.');
  const selectedRoot = path.join(path.resolve(options.home), 'hima/database');
  await privateDirectory(selectedRoot);
  const root = await realpath(selectedRoot);
  const release = await ownHome(root);
  const data = path.join(root, 'data');
  const credentialsFile = path.join(root, 'credentials.json');
  const timeoutMs = options.timeoutMs ?? 30_000;
  let retainedOnError = false;
  try {
    let credentials: Credentials;
    if (await exists(credentialsFile)) {
      try { credentials = JSON.parse(await privateFile(credentialsFile)) as Credentials; }
      catch { throw problem('the private credentials are unreadable or unsafe. Restore the original private Home; it was not reinitialized.'); }
      if (credentials.version !== POSTGRES_VERSION || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(credentials.identity)
        || !/^[0-9a-f]{64}$/.test(credentials.password) || credentials.user !== 'hima'
        || !Number.isInteger(credentials.port) || credentials.port < 1024 || credentials.port > 65535) {
        throw problem('the private credential/cluster identity is incomplete or incompatible. Restore the original Home; it was not reinitialized.');
      }
    } else {
      if (await exists(data)) throw problem('the cluster has no private credentials. Restore the original Home; it was not reinitialized.');
      credentials = { identity: randomUUID(), port: await portAvailable(), user: 'hima', password: randomBytes(32).toString('hex'), version: POSTGRES_VERSION };
      await writeFile(credentialsFile, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
    }
    if (!(await exists(data))) {
      const initializing = path.join(root, 'data-initializing');
      if (await exists(initializing)) throw problem('cluster initialization was interrupted. Preserve data-initializing for inspection or restore a clean private Home; it was not treated as a usable database.');
      const passwordFile = path.join(root, 'init-password');
      await writeFile(passwordFile, credentials.password, { mode: 0o600 });
      try {
        const initialized = await command(bin('initdb'), ['-D', initializing, '--username=hima', '--pwfile', passwordFile, '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256'], { timeoutMs });
        if (initialized.code !== 0) throw problem(`initialization failed (exit ${initialized.code}). Check Home permissions and free disk space; the incomplete directory was retained.`);
        await writeFile(path.join(initializing, 'postgresql.conf'), `listen_addresses = '127.0.0.1'\nport = ${credentials.port}\nunix_socket_directories = ''\npassword_encryption = 'scram-sha-256'\nlogging_collector = off\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\n`, { mode: 0o600 });
        await writeFile(path.join(initializing, 'pg_hba.conf'), 'host all all 127.0.0.1/32 scram-sha-256\n', { mode: 0o600 });
        await rename(initializing, data);
      } finally { await rm(passwordFile, { force: true }); }
    }
    await privateDirectory(data);
    if ((await readFile(path.join(data, 'PG_VERSION'), 'utf8')).trim() !== '16') throw problem('the existing cluster has an incompatible PostgreSQL major version. Restore its original App version.');
    const connection = (database: string): LocalDatabaseConnection => ({ host: '127.0.0.1', port: credentials.port, user: credentials.user, password: credentials.password, database });
    const query = async (database: string, input: string): Promise<string> => {
      const result = await command(bin('psql'), ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input, timeoutMs,
        env: { PGHOST: '127.0.0.1', PGPORT: String(credentials.port), PGUSER: credentials.user, PGPASSWORD: credentials.password, PGDATABASE: database, PGCONNECT_TIMEOUT: '3' } });
      if (result.code !== 0) throw problem(`the authenticated database query failed (exit ${result.code}). Check the retained PostgreSQL server log and restore its original Home/runtime.`);
      return result.out.trim();
    };
    const running = await postmaster(data, bin('postgres'), credentials.port);
    if (!running) {
      await portAvailable(credentials.port);
      retainedOnError = true; // Even a timed-out pg_ctl may have launched the owned server.
      const started = await command(bin('pg_ctl'), ['-D', data, '-l', path.join(root, 'server.log'), '-w', '-t', String(Math.max(1, Math.ceil(timeoutMs / 1000))), 'start'], { timeoutMs: timeoutMs + 1000 });
      if (started.code !== 0) throw problem(`startup did not confirm ready (exit ${started.code}). The process/PID and data were retained; reopen to verify the original instance, without restarting it blindly.`);
    }
    const verifiedPid = await postmaster(data, bin('postgres'), credentials.port);
    if (!verifiedPid) throw problem('startup left no verified PostgreSQL process. Inspect server.log; the cluster was preserved.');
    const settings = JSON.parse(await query('postgres', `SELECT json_build_object('data',current_setting('data_directory'),'port',current_setting('port'),'listen',current_setting('listen_addresses'),'user',current_user,'encoding',current_setting('server_encoding'));
`)) as { data: string; port: string; listen: string; user: string; encoding: string };
    if (settings.data !== data || settings.port !== String(credentials.port) || settings.listen !== '127.0.0.1' || settings.user !== credentials.user || settings.encoding !== 'UTF8') throw problem('the responding database has a different cluster/network identity. No process was stopped.');
    const identityExists = await query('postgres', "SELECT to_regclass('public.hima_cluster_identity') IS NOT NULL;\n");
    if (identityExists === 'f') {
      if (running) throw problem('the surviving database has no Hima cluster identity. It was not adopted.');
      await query('postgres', `CREATE TABLE public.hima_cluster_identity (identity uuid PRIMARY KEY); INSERT INTO public.hima_cluster_identity VALUES ('${credentials.identity}');\n`);
    }
    if (await query('postgres', 'SELECT identity FROM public.hima_cluster_identity;\n') !== credentials.identity) throw problem('the responding database identity differs from this Home. It was not adopted.');
    for (const database of ['hima_application', 'hima_dbos_system']) {
      if (await query('postgres', `SELECT count(*) FROM pg_database WHERE datname='${database}';\n`) === '0') await query('postgres', `CREATE DATABASE ${database};\n`);
    }
    retainedOnError = false;
    let stopping: Promise<void> | undefined;
    return {
      identity: credentials.identity, application: connection('hima_application'), system: connection('hima_dbos_system'),
      stop: () => stopping ??= (async () => {
        const pid = await postmaster(data, bin('postgres'), credentials.port);
        if (pid) {
          if (await query('postgres', 'SELECT identity FROM public.hima_cluster_identity;\n') !== credentials.identity) throw problem('stop refused: the responding database identity changed. No process was stopped.');
          const stopped = await command(bin('pg_ctl'), ['-D', data, '-m', 'fast', '-w', '-t', String(Math.max(1, Math.ceil(timeoutMs / 1000))), 'stop'], { timeoutMs: timeoutMs + 1000 });
          if (stopped.code !== 0 || await postmaster(data, bin('postgres'), credentials.port)) throw problem('stop did not confirm the owned database ended. Its PID and owner lock were preserved; inspect the original process before reopening.');
        }
        await release();
      })().catch(error => { stopping = undefined; throw error; }),
    };
  } catch (error) {
    // A retained postmaster needs a stale Host lock for safe takeover when this Host exits. If this
    // process is still alive, the lock correctly prevents a concurrent second writer.
    if (!retainedOnError) await release();
    throw error;
  }
}
