// The LibInsight pages inside Data Insight (ADR-0019). One reason to change: how the Host starts,
// watches and stops the one local LibInsight viewer process the workbench frames.
//
// LibInsight ships its own web app: a stdlib HTTP server that binds 127.0.0.1 only, refuses any
// request whose Host or Origin is not its own port, and serves plain JavaScript/SVG pages over a
// person's derived Library data. The workbench shows those pages in place rather than re-drawing
// them, so this module owns exactly the process: which code, which data folder, which port, and
// whether it is up. It never reads Library data itself and never starts an analysis; the pages it
// frames are the LibInsight app's own, with the authority that app already has over its own folder.
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

/** What the code root says about itself: the packaged copy carries its source commit. */
export interface LibInsightCode { readonly root: string; readonly commit?: string; readonly source?: string }

export type LibInsightViewerStatus =
  | { readonly state: 'unavailable'; readonly reason: string; readonly code?: LibInsightCode; readonly dataFolder?: string }
  | { readonly state: 'stopped'; readonly code: LibInsightCode; readonly dataFolder: string }
  | { readonly state: 'starting'; readonly code: LibInsightCode; readonly dataFolder: string }
  | { readonly state: 'ready'; readonly url: string; readonly code: LibInsightCode; readonly dataFolder: string; readonly kits: readonly string[] }
  | { readonly state: 'failed'; readonly reason: string; readonly code: LibInsightCode; readonly dataFolder: string; readonly log: readonly string[] };

export interface LibInsightViewerOptions {
  /** The LibInsight checkout or packaged copy: it holds `app/server.py` and `libinsight/`. */
  readonly codeRoot?: string;
  /** Where the person's chosen data folder is remembered across Host restarts. */
  readonly settingsFile: string;
  /** The folder used until a person chooses one (it holds LibInsight's `app.json`). */
  readonly defaultDataFolder?: string;
  readonly python?: string;
  /** How long the viewer may take to answer its first page. Large Kits load before it listens. */
  readonly readyTimeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

export interface LibInsightViewer {
  status(): Promise<LibInsightViewerStatus>;
  /** Start the viewer (or keep the running one) on the chosen or remembered data folder. */
  open(request?: { readonly dataFolder?: string; readonly restart?: boolean }): Promise<LibInsightViewerStatus>;
  stop(): Promise<void>;
}

/** The settings a packaged App or a source checkout passes in; unset means "not installed". */
export function libInsightViewerOptions(home: string, env: NodeJS.ProcessEnv = process.env): LibInsightViewerOptions {
  const named = (value: string | undefined) => value?.trim() ? path.resolve(value.trim()) : undefined;
  const codeRoot = named(env.HIMA_LIBINSIGHT_ROOT);
  const defaultDataFolder = named(env.HIMA_LIBINSIGHT_DATA);
  const python = env.HIMA_LIBINSIGHT_PYTHON?.trim();
  return { settingsFile: path.join(home, 'libinsight-viewer.json'), ...(codeRoot ? { codeRoot } : {}),
    ...(defaultDataFolder ? { defaultDataFolder } : {}), ...(python ? { python } : {}) };
}

const LOG_LINES = 40;
const isFile = async (file: string) => (await stat(file).catch(() => undefined))?.isFile() === true;

/** A port nobody holds right now. The viewer binds it a moment later; a lost race is one retry.
 *  The last port is tried first: LibInsight keeps a person's Kit/Variant/Corner in browser storage,
 *  which belongs to its origin, and a new port each start would forget it. */
function freePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => preferred === undefined ? reject(error) : freePort().then(resolve, reject));
    server.listen(preferred ?? 0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no loopback port')));
    });
  });
}

export function createLibInsightViewer(options: LibInsightViewerOptions): LibInsightViewer {
  const env = options.env ?? process.env;
  const readyTimeoutMs = options.readyTimeoutMs ?? 300_000;
  let child: ChildProcess | undefined;
  let running: { readonly url: string; readonly dataFolder: string; readonly kits: readonly string[] } | undefined;
  let failure: { readonly reason: string; readonly dataFolder: string; readonly log: readonly string[] } | undefined;
  let starting: Promise<LibInsightViewerStatus> | undefined;
  let startingFolder: string | undefined;
  // Every start and stop runs one after another on this chain, so two looks at the tab never start
  // two viewers. A stop does not wait in line behind a slow start: it bumps the generation, and the
  // start that sees a newer generation kills the process it launched instead of reporting it.
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work, work); queue = next.catch(() => undefined); return next; };

  const code = async (): Promise<LibInsightCode | string> => {
    const root = options.codeRoot;
    if (root === undefined) return 'LibInsight is not installed in this App (no LibInsight code root is configured).';
    if (!await isFile(path.join(root, 'app', 'server.py'))) return `The LibInsight code root ${root} has no app/server.py.`;
    // The packager writes this beside the copied code; a source checkout has none and says only its path.
    const source = await readFile(path.join(root, 'LIBINSIGHT-SOURCE.json'), 'utf8').then(text => JSON.parse(text) as { commit?: unknown; source?: unknown }).catch(() => undefined);
    return { root, ...(typeof source?.commit === 'string' ? { commit: source.commit } : {}), ...(typeof source?.source === 'string' ? { source: source.source } : {}) };
  };
  const saved = () => readFile(options.settingsFile, 'utf8').then(text => JSON.parse(text) as { dataFolder?: unknown; port?: unknown }).catch(() => undefined);
  const remembered = async (): Promise<string | undefined> => {
    const settings = await saved();
    return typeof settings?.dataFolder === 'string' && settings.dataFolder !== '' ? settings.dataFolder : options.defaultDataFolder;
  };
  const remember = async (change: { readonly dataFolder?: string; readonly port?: number }): Promise<void> => {
    const settings = await saved() ?? {};
    await mkdir(path.dirname(options.settingsFile), { recursive: true });
    await writeFile(options.settingsFile, `${JSON.stringify({ ...settings, ...change }, null, 2)}\n`);
  };
  // LibInsight resolves every Kit path against the folder above its config file, so the data folder
  // is the folder holding `app.json` and the person picks that folder, never a file inside it.
  const dataProblem = async (folder: string): Promise<string | undefined> => {
    if (!path.isAbsolute(folder)) return `Choose an absolute data folder; ${folder} is relative.`;
    const config = path.join(folder, 'app.json');
    if (!await isFile(config)) return `The data folder ${folder} has no app.json. Choose the LibInsight data folder that holds app.json.`;
    const parsed = await readFile(config, 'utf8').then(text => JSON.parse(text) as { kits?: unknown }).catch(() => undefined);
    if (!Array.isArray(parsed?.kits) || parsed.kits.length === 0) return `${config} names no Kit.`;
    return undefined;
  };

  const kill = async (proc: ChildProcess): Promise<void> => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = new Promise<void>(resolve => proc.once('exit', () => resolve()));
    proc.kill('SIGTERM');
    const timer = setTimeout(() => proc.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
  };
  const stopChild = async (): Promise<void> => {
    const current = child;
    child = undefined; running = undefined;
    if (current !== undefined) await kill(current);
  };

  const launch = async (root: LibInsightCode, dataFolder: string, mine: number): Promise<LibInsightViewerStatus> => {
    const superseded = (): LibInsightViewerStatus => ({ state: 'stopped', code: root, dataFolder });
    let log: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const last = (await saved())?.port;
      const port = await freePort(attempt === 0 && Number.isInteger(last) && (last as number) > 1024 && (last as number) < 65536 ? last as number : undefined);
      if (generation !== mine) return superseded();
      log = [];
      // Only what Python needs: the Host's environment carries model credentials, and the viewer is
      // somebody else's code. No bytecode is written, because the packaged copy sits inside a signed App.
      const childEnv: NodeJS.ProcessEnv = { PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME, LANG: env.LANG ?? 'en_US.UTF-8',
        ...(env.TMPDIR ? { TMPDIR: env.TMPDIR } : {}), PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' };
      const proc = spawn(options.python ?? 'python3', [path.join(root.root, 'app', 'server.py'), '--config', path.join(dataFolder, 'app.json'), '--port', String(port)],
        { cwd: root.root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      child = proc;
      // A Host that ends without its own shutdown still takes its viewer with it.
      const killOnExit = () => { proc.kill('SIGTERM'); };
      process.once('exit', killOnExit);
      const keep = (chunk: Buffer) => { log.push(...chunk.toString('utf8').split('\n').filter(line => line.trim() !== '')); if (log.length > LOG_LINES) log = log.slice(-LOG_LINES); };
      proc.stdout?.on('data', keep); proc.stderr?.on('data', keep);
      let exited: string | undefined;
      proc.once('error', error => { exited = error.message; });
      proc.once('exit', (codeValue, signal) => {
        process.off('exit', killOnExit);
        exited ??= `exited with ${signal ?? `code ${String(codeValue)}`}`;
        if (child === proc) { child = undefined; if (running !== undefined) failure = { reason: `The LibInsight viewer stopped: ${exited}.`, dataFolder, log: [...log] }; running = undefined; }
      });
      // The frame is addressed as `localhost`, not `127.0.0.1`: the Host's session cookie belongs to
      // `127.0.0.1` whatever the port, so a frame there would hand it to the viewer on every request.
      // LibInsight answers both names; the readiness probe stays on the address it binds.
      const url = `http://localhost:${port}/`;
      const deadline = Date.now() + readyTimeoutMs;
      while (exited === undefined && Date.now() < deadline) {
        if (generation !== mine) { await kill(proc); return superseded(); }
        const kits = await fetch(`http://127.0.0.1:${port}/api/kits`, { signal: AbortSignal.timeout(2000) })
          .then(async response => response.ok ? (await response.json() as { id?: unknown }[]).map(kit => String(kit.id)) : undefined).catch(() => undefined);
        if (generation !== mine) { await kill(proc); return superseded(); }
        if (kits !== undefined && child === proc) {
          running = { url, dataFolder, kits }; failure = undefined;
          await remember({ port }).catch(() => undefined);
          return { state: 'ready', url, code: root, dataFolder, kits };
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (exited === undefined) {
        await kill(proc);
        if (child === proc) child = undefined;
        failure = { reason: `The LibInsight viewer did not answer within ${Math.round(readyTimeoutMs / 1000)} s.`, dataFolder, log: [...log] };
        return { state: 'failed', code: root, ...failure };
      }
      if (generation !== mine) return superseded();
      if (attempt === 0 && log.some(line => /Address already in use/i.test(line))) continue;
      failure = { reason: `The LibInsight viewer could not start: ${exited}.`, dataFolder, log: [...log] };
      return { state: 'failed', code: root, ...failure };
    }
    failure = { reason: 'No free loopback port could be held for the LibInsight viewer.', dataFolder, log: [...log] };
    return { state: 'failed', code: root, ...failure };
  };

  const status = async (): Promise<LibInsightViewerStatus> => {
    const root = await code();
    const dataFolder = startingFolder ?? running?.dataFolder ?? failure?.dataFolder ?? await remembered();
    if (typeof root === 'string') return { state: 'unavailable', reason: root, ...(dataFolder ? { dataFolder } : {}) };
    if (starting !== undefined && startingFolder !== undefined) return { state: 'starting', code: root, dataFolder: startingFolder };
    if (running !== undefined) return { state: 'ready', url: running.url, code: root, dataFolder: running.dataFolder, kits: running.kits };
    if (failure !== undefined) return { state: 'failed', code: root, ...failure };
    if (dataFolder === undefined) return { state: 'unavailable', reason: 'Choose the LibInsight data folder (the folder that holds app.json).', code: root };
    return { state: 'stopped', code: root, dataFolder };
  };

  const openNow = async (request: { readonly dataFolder?: string; readonly restart?: boolean }, mine: number): Promise<LibInsightViewerStatus> => {
    const root = await code();
    const typed = request.dataFolder?.trim();
    const chosen = typed ? typed : await remembered();
    if (typeof root === 'string') return { state: 'unavailable', reason: root, ...(chosen ? { dataFolder: chosen } : {}) };
    if (chosen === undefined) return { state: 'unavailable', reason: 'Choose the LibInsight data folder (the folder that holds app.json).', code: root };
    const problem = await dataProblem(chosen);
    if (problem !== undefined) return { state: 'unavailable', reason: problem, code: root, dataFolder: chosen };
    const folder = path.normalize(chosen).replace(/(.)[\\/]+$/, '$1');
    if (running !== undefined && running.dataFolder === folder && request.restart !== true) return { state: 'ready', url: running.url, code: root, dataFolder: folder, kits: running.kits };
    if (generation !== mine) return { state: 'stopped', code: root, dataFolder: folder };
    startingFolder = folder;
    try {
      await stopChild();
      if (typed) await remember({ dataFolder: folder });
      return await launch(root, folder, mine);
    } finally { startingFolder = undefined; }
  };

  const open = (request: { readonly dataFolder?: string; readonly restart?: boolean } = {}): Promise<LibInsightViewerStatus> => {
    // A plain look while a start is under way joins it; a new folder or a restart waits its turn.
    if (starting !== undefined && !request.dataFolder?.trim() && request.restart !== true) return starting;
    // The generation is the caller's: a stop issued after this call supersedes it, one before does not.
    const mine = generation;
    const attempt = serial(() => openNow(request, mine));
    starting = attempt;
    void attempt.finally(() => { if (starting === attempt) starting = undefined; }).catch(() => undefined);
    return attempt;
  };

  const stop = async (): Promise<void> => {
    generation += 1;
    const pending = queue;
    await stopChild();
    await pending;
    await stopChild();
  };

  return { status, open, stop };
}
