// @hima-seam agent wrapped
// @hima-seam tools direct
// Bounded L4: one native conversational Agent, real private local Jobs, no replay or Electron.
// Exported utilities are shared only with the adjacent authoring live check.
import { createHash, randomInt } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { loadPack } from '@hima/harness';
import { bootInProcess, cancelTestAgent, createRootAgent, injectedSkills, sayAsUser, saidByModel, steerAsUser, toolCalls, toolResults, type InProcessHost } from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { digestTrees } from '../test/contract/support/pipeline.ts';
import { tmuxHasSession } from '../test/contract/support/tmux.ts';
import { scanForSecret } from '../test/contract/support/moments.ts';
import { writeLocalSite } from '../test/contract/support/site.ts';
import { installPack, packsDirOf } from '../test/contract/support/pack.ts';
import { prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';

export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
export const within = (candidate: string, root: string): boolean => candidate === root || candidate.startsWith(root + path.sep);
export interface Check { claim: string; passed: boolean; saw: unknown }

/** Real-host evidence and budgets for these two opt-in scripts; no product execution decisions. */
export class LiveCheck {
  readonly startedAt = new Date().toISOString();
  readonly checks: Check[] = [];
  readonly observed: Record<string, unknown> = {};
  readonly agents: Agent[] = [];
  readonly toolSequence: unknown[] = [];
  readonly requestSessions = new Set<string>();
  readonly userMessages: unknown[] = [];
  readonly limits: { timeoutMs: number; maxTurns: number; maxSteps: number };
  readonly out: string;
  readonly key: string;
  readonly temporary: string;
  readonly deadline: number;
  host?: InProcessHost;
  home?: HimaHome;
  steps = 0;
  turns = 0;
  failure?: string;
  hardTimer: NodeJS.Timeout;
  readonly name: string;
  constructor(name: string, defaultTurns: number) {
    this.name = name;
    const args = process.argv.slice(2);
    const help = `usage: node scripts/${name}.ts --out <fresh-directory> [--timeout-ms 600000] [--max-turns ${defaultTurns}] [--max-steps 160]\nRequires DEEPSEEK_API_KEY in the inherited environment; never pass a credential as an argument.\n`;
    if (args.includes('--help') || args.includes('-h')) { process.stdout.write(help); process.exit(0); }
    const options = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      if (!['--out', '--timeout-ms', '--max-turns', '--max-steps'].includes(args[i]!) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(help);
      options.set(args[i]!, args[i + 1]!);
    }
    this.key = process.env.DEEPSEEK_API_KEY ?? '';
    if (!this.key.trim()) { process.stderr.write(`${name}: missing DEEPSEEK_API_KEY; nothing prepared, no Host or model started.\n`); process.exit(2); }
    // Native Host diagnostics share these streams. Scrub the known supplied secret before any
    // library output leaves this process, in addition to scanning retained bytes at finalization.
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        return Reflect.apply(write, stream, [text.split(this.key).join('[REDACTED]'), ...rest]) as boolean;
      }) as typeof stream.write;
    }
    const bounded = (name: string, fallback: number, max: number) => {
      const value = Number(options.get(name) ?? fallback);
      if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`);
      return value;
    };
    this.limits = { timeoutMs: bounded('--timeout-ms', 600_000, 600_000), maxTurns: bounded('--max-turns', defaultTurns, 32), maxSteps: bounded('--max-steps', 160, 200) };
    this.out = path.resolve(options.get('--out') ?? path.join(repoRoot, 'docs/assessment/2026-09-12/pls-19/live-harness', `${name}-${Date.now()}`));
    if (existsSync(this.out)) throw new Error('the evidence directory already exists; use a fresh --out directory');
    mkdirSync(this.out, { recursive: true });
    this.temporary = realpathSync(mkdtempSync('/tmp/hima-l4-'));
    process.env.TMPDIR = this.temporary;
    process.env.TMUX_TMPDIR = this.temporary;
    delete process.env.TMUX;
    delete process.env.SSH_AUTH_SOCK;
    delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
    delete process.env.HIMA_TEST_SILENT_AGENT;
    process.env.DSH_TELEMETRY_DISABLED = '1';
    this.deadline = Date.now() + this.limits.timeoutMs;
    this.observed.sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    this.observed.privateRoot = this.temporary;
    this.observed.node = process.version;
    this.observed.dirtyFiles = execFileSync('git', ['status', '--short'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    this.observed.model = 'native configured DeepSeek adapter; no replay';
    // A stuck provider/disposal cannot make the advertised ten-minute bound unbounded. Snapshot and
    // terminate only this private tmux server. The finally path normally cancels Agents first.
    this.hardTimer = setTimeout(() => {
      this.failure = 'hard deadline exceeded';
      this.stopAgents();
      this.stopJobs();
      this.checkpoint();
      this.emergencyScan();
      process.stderr.write(`${name}: hard deadline; diagnostic checkpoint: ${this.out}\n`);
      process.exit(124);
    }, this.limits.timeoutMs);
  }
  emergencyScan(): void {
    const scan = { files: 0, redacted: [] as string[], unreadable: [] as string[] };
    const walk = (dir: string): void => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { scan.unreadable.push(dir); return; }
      for (const entry of entries) {
        const at = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(at);
        else if (entry.isFile()) {
          try { const bytes = readFileSync(at); scan.files++; if (bytes.includes(Buffer.from(this.key))) { writeFileSync(at, bytes.toString('utf8').split(this.key).join('[REDACTED]')); scan.redacted.push(at); } }
          catch { scan.unreadable.push(at); }
        }
      }
    };
    walk(this.temporary); walk(this.out);
    this.observed.deadlineSecretScan = scan; this.checkpoint();
  }
  clean<T>(value: T): T { return JSON.parse(JSON.stringify(value).split(this.key).join('[REDACTED]')) as T; }
  check(claim: string, passed: boolean, saw: unknown): void { this.checks.push({ claim, passed, saw: this.clean(saw ?? null) }); this.checkpoint(); }
  require(claim: string, passed: boolean, saw: unknown): void { this.check(claim, passed, saw); if (!passed) throw new Error(claim); }
  track(agent: Agent): Agent { if (!this.agents.includes(agent)) this.agents.push(agent); return agent; }
  async say(agent: Agent, text: string): Promise<void> {
    this.admitMessage(agent, 'followup', text);
    await this.wait(sayAsUser(agent, text));
    this.checkpoint();
  }
  steer(agent: Agent, text: string): void { this.admitMessage(agent, 'steer', text); steerAsUser(agent, text); }
  private admitMessage(agent: Agent, delivery: string, text: string): void {
    if (++this.turns > this.limits.maxTurns) throw new Error('user-message turn budget exceeded');
    this.userMessages.push({ at: new Date().toISOString(), session: String(agent.id), source: 'user', delivery, text });
    this.checkpoint();
  }
  async wait<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('live-check deadline reached')), Math.max(1, this.deadline - Date.now() - 5000)); })]); }
    finally { clearTimeout(timer); }
  }
  async until(why: string, ready: () => boolean, maxMs = 120_000): Promise<void> {
    const until = Math.min(this.deadline - 5000, Date.now() + maxMs);
    while (!ready()) { if (Date.now() >= until) throw new Error(`timed out: ${why}`); await new Promise((r) => setTimeout(r, 150)); }
  }
  attach(host: InProcessHost): void {
    this.host = host;
    host.ctx.on('agent/request', async ({ agent }, next) => {
      this.requestSessions.add(String(agent.id));
      if (++this.steps > this.limits.maxSteps) { cancelTestAgent(agent, 'live-check model-step budget exceeded'); throw new Error('model-step budget exceeded'); }
      this.checkpoint();
      return next();
    });
    host.ctx.on('tools/result', (execution, result) => {
      this.toolSequence.push(this.clean({ at: new Date().toISOString(), agent: execution.agent?.id, callId: execution.callId, name: execution.name, args: execution.arguments, result }));
      this.checkpoint();
      return undefined;
    });
  }
  checkpoint(): void {
    try {
      const runs = this.host?.ctx.hima.ledger.runs() ?? [];
      const record = this.clean({ check: this.name, startedAt: this.startedAt, checkpointAt: new Date().toISOString(), limits: this.limits,
        passed: false, status: this.failure ? 'failed' : 'in-progress', failure: this.failure ?? null,
        costs: { hosts: this.host ? 1 : 0, electron: 0, nativeSessionsCreated: this.agents.length, modelSessions: this.requestSessions.size,
          modelRequestSteps: this.steps, apiRequests: 'unmeasured; request steps exclude adapter retries', tokens: 'unmeasured', userMessages: this.turns },
        observed: this.observed, userMessages: this.userMessages, toolSequence: this.toolSequence,
        agents: this.agents.map((agent) => ({ id: agent.id, session: agent.session.id, cwd: agent.session.header.cwd, options: agent.options, skills: injectedSkills(agent), toolCalls: toolCalls(agent), toolResults: toolResults(agent), said: saidByModel(agent) })),
        runs: runs.map((run) => ({ run, records: this.host!.ctx.hima.ledger.records({ runId: run.id }) })), checks: this.checks });
      writeFileSync(path.join(this.out, 'evidence.json'), JSON.stringify(record, null, 2) + '\n');
    } catch { /* Preserve the preceding checkpoint if the Host has already disposed. */ }
  }
  stopAgents(): void { for (const agent of this.agents) cancelTestAgent(agent, 'bounded live check finished'); }
  stopJobs(): void { spawnSync('tmux', ['-S', path.join(this.temporary, `tmux-${process.getuid!()}`, 'default'), 'kill-server'], { stdio: 'ignore', timeout: 2000 }); }
  async finish(): Promise<void> {
    this.stopAgents();
    // Snapshot actual product facts before cleanup changes them. Private Job termination is cleanup,
    // never evidence that an Agent cancel/pause succeeded.
    this.checkpoint();
    this.stopJobs();
    if (this.host) { try { await this.wait(this.host.dispose()); } catch (error) { this.failure ??= String(error); } }
    const scan = await scanForSecret([this.temporary, this.out], this.key);
    this.observed.secretScan = { files: scan.files.length, holding: scan.holding, unreadable: scan.unreadable };
    // Retained diagnostics must be safe even on failures. Exact matching bytes are removed before
    // publication; the original presence still fails the check. No key prefix/length is recorded.
    for (const at of scan.holding) writeFileSync(at, readFileSync(at).toString('utf8').split(this.key).join('[REDACTED]'));
    this.check('retained private home and evidence were scanned', scan.files.length > 0 && scan.unreadable.length === 0 && scan.holding.length === 0, this.observed.secretScan);
    const at = path.join(this.out, 'evidence.json');
    const existing = JSON.parse(readFileSync(at, 'utf8')) as Record<string, unknown>;
    const passed = !this.failure && this.checks.every((c) => c.passed);
    writeFileSync(at, JSON.stringify(this.clean({ ...existing, finishedAt: new Date().toISOString(), passed, status: passed ? 'passed' : 'failed', failure: this.failure ?? null, observed: this.observed, checks: this.checks }), null, 2) + '\n');
    writeFileSync(path.join(this.out, 'README.md'), `# ${this.name}\n\n${passed ? 'PASS' : 'FAIL'} — ${this.failure ?? 'see factual checks in evidence.json'}.\n\nOne headless real Host; no Electron, replay, EDA or hidden research moment. Native model sessions: ${this.requestSessions.size}; request steps: ${this.steps}; API request count and token use unmeasured. Private diagnostic home retained at ${this.temporary}. Private tmux Jobs stopped for cleanup.\n\n${this.checks.map((c) => `- ${c.passed ? 'PASS' : 'FAIL'}: ${c.claim}`).join('\n')}\n`);
    clearTimeout(this.hardTimer);
    process.stdout.write(`${this.name}: ${passed ? 'PASS' : 'FAIL'}; evidence ${this.out}\n`);
    process.exitCode = passed ? 0 : 1;
  }
}

/** Resolve real paths, including symlinks; reads have four declared data roots, writes one Pack. */
export function guardInstalled(check: LiveCheck, host: InProcessHost, readRoots: string[], packFolder: string): void {
  const allowed = readRoots.map((at) => realpathSync(at));
  const pack = realpathSync(packFolder);
  const denied: unknown[] = [];
  check.observed.allowedReadRoots = allowed;
  check.observed.allowedWriteRoot = pack;
  check.observed.deniedTools = denied;
  host.ctx.tools.guard((execution) => {
    const name = execution.name;
    const refuse = (reason: string) => { denied.push({ name, reason }); return reason; };
    if (!['read', 'read_image', 'glob', 'grep', 'write', 'edit', 'skill'].includes(name) && !name.startsWith('hima_')) return refuse('bounded live check permits file inspection, Pack authoring and Hima tools only');
    if (name.startsWith('hima_') || name === 'skill') return undefined;
    const args = execution.arguments as { file_path?: string; path?: string };
    const cwd = execution.agent?.session.header.cwd;
    const requested = args.file_path ?? args.path ?? cwd;
    if (!requested || !cwd) return refuse('a declared path and session workspace are required');
    const candidate = path.resolve(cwd, requested);
    let real: string;
    try { real = realpathSync(candidate); }
    catch {
      if (!['write', 'edit'].includes(name)) return refuse(`cannot resolve read path ${candidate}`);
      let ancestor = candidate;
      const tail: string[] = [];
      while (!existsSync(ancestor)) { if (lstatSync(ancestor, { throwIfNoEntry: false })) return refuse('dangling symlink write refused'); tail.unshift(path.basename(ancestor)); const next = path.dirname(ancestor); if (next === ancestor) return refuse('write parent unresolved'); ancestor = next; }
      real = path.join(realpathSync(ancestor), ...tail);
    }
    const roots = ['write', 'edit'].includes(name) ? [pack] : allowed;
    return roots.some((root) => within(real, root)) ? undefined : refuse(`outside declared ${name} roots: ${candidate}`);
  });
}

export async function numericHome(check: LiveCheck): Promise<{ h: HimaHome; flow: string; bundle: string; numbers: number[]; limit: number }> {
  const h = await createHimaHome(); check.home = h;
  await prepareHimaHome({ home: h.home, bundleMode: 'installed' });
  await installPack(h);
  const bundle = realpathSync(path.join(h.profileDir, 'node_modules/@hima/harness'));
  const flow = path.join(h.home, 'numeric-flow'); mkdirSync(flow);
  const numbers = [39, ...Array.from({ length: 11 }, () => randomInt(1, 40))];
  const limit = randomInt(8, 22);
  writeFileSync(path.join(flow, 'numbers.txt'), numbers.join('\n') + '\n');
  writeFileSync(path.join(flow, 'prepare.sh'), '#!/bin/sh\nset -eu\ncd "$1"\ncp numbers.txt measured.txt\n');
  writeFileSync(path.join(flow, 'README.md'), '# Numeric Golden Flow\n\nRun `sh prepare.sh <flow-directory>` in a private copy. It copies numbers.txt to measured.txt. Both contain one nonnegative integer per line. Analysis must sum only numbers strictly greater than the requested LIMIT. A Workshop writes its own shell script from these actual inputs and the declared analysis knowledge; result.txt contains the integer sum alone. There is no EDA or licence use.\n');
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow], allowedWriteRoots: [h.workspace], allowedWrappers: ['sh'], licences: {}, bindings: { flowRoot: flow, design: 'numeric', workspaceRoot: h.workspace } });
  // Disable title generation only; all business requests still use the native real adapter.
  writeFileSync(homePatchFile(h.home), '- id: session-title-llm\n  disabled: true\n');
  check.observed.installedBundle = bundle;
  check.observed.installedBuildHashes = Object.fromEntries([...(await digestTrees([bundle], path.join(bundle, 'node_modules')))].map(([at, hash]) => [path.relative(bundle, at), hash]));
  check.observed.input = { path: path.join(flow, 'numbers.txt'), sha256: sha256(readFileSync(path.join(flow, 'numbers.txt'))), numbers, limit };
  // The native Host's fallback cwd is private too; installed authoring never starts in checkout.
  process.chdir(h.workspace);
  return { h, flow, bundle, numbers, limit };
}

export function installNumericPack(folder: string): void {
  const files: Record<string, string> = {
    'contract.yml': `id: live-numeric\nversion: '1'\ntitle: Bounded numeric analysis\ninputs:\n  - { name: flowRoot, description: Declared numeric Golden Flow }\n  - { name: design, description: Numeric dataset }\n  - { name: workspaceRoot, description: Private workspace }\noutputs:\n  - { name: measured, path: flow/measured.txt, description: Actual numeric input }\n  - { name: analysis, path: result.txt, reader: numeric-sum, description: Sum above LIMIT }\nenvironment: { wrappers: [sh] }\nworkspace: { copy: [prepare.sh, numbers.txt, README.md] }\ntools:\n  - id: prepare\n    file: tools/prepare.sh\n    description: Copy the actual input in the private flow\n    inputs: [WORKSPACE]\n    argv: [sh, '\${WORKSPACE}/flow/prepare.sh', '\${WORKSPACE}/flow']\nknowledge:\n  - { file: sum.md, purpose: Exact numeric analysis and timing contract }\nworkshops:\n  - id: analyze\n    purpose: Read actual measured values and knowledge; write and run a shell script summing values strictly greater than LIMIT. Sleep 60 seconds in the script before writing result.txt so the engineer can intervene while the Job is active.\n    directory: research/analysis\n    entry: analyze.sh\n    language: shell\n    inputs: [LIMIT]\n    reads: [measured]\n    knowledge: [sum.md]\n    produces: analysis\n    argv: [sh, '\${ENTRY}', '\${WORKSPACE}', '\${LIMIT}']\nrules: [positive-sum]\nstrategy:\n  limit: { type: number, unit: count, min: 0, max: 100, default: 10 }\ngoal:\n  minimum: { type: number, unit: count, min: 0, max: 10000, default: 1 }\nwords:\n  limit: { label: Strict lower cutoff, unit: count }\n  minimum: { label: Minimum acceptable sum, unit: count }\n`,
    'graph.yml': `id: live-numeric\nversion: '1'\nentry: prepare\nnodes:\n  - { id: prepare, kind: act, parameters: { tool: prepare } }\n  - id: analyze\n    kind: act\n    parameters:\n      workshop: analyze\n      arguments: { LIMIT: { from: strategy, name: limit } }\n  - { id: read-analysis, kind: act, parameters: { observes: analysis } }\n  - id: judge\n    kind: judge\n    parameters:\n      rules: [positive-sum]\n      bind: { minimum: { from: goal, name: minimum } }\n  - { id: blocked, kind: wait, parameters: { blocker: hard-blocker } }\nedges:\n  - { from: prepare, to: analyze }\n  - { from: analyze, to: read-analysis }\n  - { from: read-analysis, to: judge }\n`,
    'semantics.yml': 'values:\n  numeric_sum: { unit: count, description: Sum of actual numbers above LIMIT }\n',
    'rules/positive-sum.yml': "id: positive-sum\nversion: '1'\ntitle: Numeric sum meets the requested minimum\nparameter: { name: minimum, unit: count }\nrequires: [{ type: numeric_sum }]\nsubject: { type: numeric_sum }\npredicate: { op: gte, threshold: { parameter: minimum }, unit: count }\n",
    'readers/numeric-sum.yml': "id: numeric-sum\nversion: '1'\nfile: tools/read-sum.sh\nargv: [sh, '${READER}', '${REPORT}', '${OUT}']\nreportKind: numeric-sum\nemits: [numeric_sum]\n",
    'tools/read-sum.sh': '#!/bin/sh\nset -eu\nv=$(cat "$1")\ncase "$v" in ""|*[!0-9]*) exit 3;; esac\nprintf \'{"values":[{"type":"numeric_sum","unit":"count","value":%s}]}\\n\' "$v" > "$2"\n',
    'tools/prepare.sh': '#!/bin/sh\nset -eu\nsh "$WORKSPACE/flow/prepare.sh" "$WORKSPACE/flow"\n',
    'knowledge/sum.md': '# Exact analysis\n\nRead measured.txt: one integer per line. Sum only values strictly greater than LIMIT. Entry argv gives WORKSPACE as $1 and LIMIT as $2. Read $1/flow/measured.txt and write the integer alone to $1/result.txt. The script must sleep 60 seconds before publishing its result, providing a bounded active Job interval for human intervention. Compute from the file; hard-coded sample values do not establish input dependence.\n',
  };
  for (const [name, content] of Object.entries(files)) { const at = path.join(folder, name); mkdirSync(path.dirname(at), { recursive: true }); writeFileSync(at, content); }
}

async function workshop(check: LiveCheck): Promise<void> {
  const { h, flow, bundle, numbers, limit } = await numericHome(check);
  const pack = path.join(packsDirOf(h), 'live-numeric'); installNumericPack(pack);
  loadPack(packsDirOf(h), 'live-numeric');
  check.observed.hostBootAttempts = 1;
  const host = await bootInProcess(h); check.attach(host);
  guardInstalled(check, host, [bundle, packsDirOf(h), flow, h.workspace], pack);
  const agent = check.track(await createRootAgent(host.ctx, h.workspace));
  let startingError: unknown;
  const starting = check.say(agent, `Run the installed live-numeric Pack on local with goal minimum=1, strategy limit=${limit}, generations=1, retries=2, timeBox=8. You are the same execution owner. Use hima_run, hima_context and hima_execute. Begin and work each node, complete only when ready. At analyze use recommend, read the declared measured output and knowledge, write the actual executable through controlled write, then work. The script sleeps 60 seconds as declared; read the knowledge for exact arguments/output. Let the real Job run asynchronously. Inspect its facts; finish your current response while it runs so I can intervene. Do not complete analyze or begin any successor until I explicitly continue. No shell or alternate Agent.`).catch((error: unknown) => { startingError = error; });
  await check.until('real Workshop Job launched', () => host.ctx.hima.ledger.runs().some((run) => host.ctx.hima.ledger.records({ runId: run.id, type: 'job' }).some((r) => r.type === 'job' && r.event === 'launched' && r.job.name === 'workshop-analyze')), 360_000);
  const workshopJobs = () => host.ctx.hima.ledger.runs().flatMap((r) => host.ctx.hima.ledger.records({ runId: r.id, type: 'job' })).filter((r) => r.type === 'job' && r.event === 'launched' && r.job.name === 'workshop-analyze');
  const activeWorkshopJob = workshopJobs().at(-1);
  check.require('the Workshop tmux Job actually exists at intervention', activeWorkshopJob?.type === 'job' && tmuxHasSession(activeWorkshopJob.job.session), activeWorkshopJob);
  const run = host.ctx.hima.ledger.runs().find((r) => r.packId === 'live-numeric')!;
  check.observed.owner = String(agent.id);
  check.observed.runId = run.id;
  const before = host.ctx.hima.executionContext(run.id);
  check.require('intervention was delivered while the Workshop execution was working', before.executions.some((e) => e.nodeId === 'analyze' && e.phase === 'working'), before);
  check.steer(agent, `Pause Run ${run.id} now using hima_execute pause at Run scope. Inspect hima_context, report actual in-flight Job facts, and do not complete analyze or start successors. This is an immediate user intervention, not permission to cancel or continue.`);
  await check.until('same Agent accepted the user pause while the Job was active', () => (host.ctx.hima.ledger.run(run.id)?.control?.paused ?? []).includes('*'), 90_000);
  const paused = host.ctx.hima.executionContext(run.id);
  check.observed.pauseContext = paused;
  check.require('the actual Workshop Job remained active when pause was accepted', activeWorkshopJob?.type === 'job' && tmuxHasSession(activeWorkshopJob.job.session), activeWorkshopJob);
  check.require('pause reached the owner before the Job completed', paused.executions.some((e) => e.nodeId === 'analyze' && e.phase === 'working'), paused.executions);
  await starting;
  if (startingError) throw startingError;
  await check.until('paused Job completed mechanically', () => host.ctx.hima.executionContext(run.id).executions.some((e) => e.nodeId === 'analyze' && e.phase === 'ready'));
  await check.wait(agent.whenIdle());
  const held = host.ctx.hima.executionContext(run.id);
  check.require('finished Job did not admit a successor while paused', held.available.length === 0 && !held.executions.some((e) => e.nodeId === 'read-analysis') && held.run.currentNode === 'analyze', held);
  await check.say(agent, `Explicit authorization: continue Run ${run.id}. Use hima_execute continue, complete the ready analyze execution, then explicitly begin/work/complete its reader and Judge. Read actual context after each change. Continue to the terminal Run status and report actual evidence. Use this same owner and Run.`);
  for (let round = 0; round < 3 && !host.ctx.hima.ledger.run(run.id)?.status?.startsWith('ended-'); round++) {
    await check.say(agent, `Inspect hima_context for Run ${run.id} and finish the authorized remaining reference nodes using current identities and actual ready facts. If something is refused, inspect its reason. Keep the same Run.`);
  }
  const final = host.ctx.hima.executionContext(run.id);
  const records = host.ctx.hima.ledger.records({ runId: run.id });
  const expected = numbers.filter((n) => n > limit).reduce((sum, n) => sum + n, 0);
  const readings = records.filter((r) => r.type === 'observation');
  check.require('real reader measured the variable-input sum', readings.some((r) => r.values.some((v) => v.type === 'numeric_sum' && v.value === expected)), { expected, readings });
  check.require('real Judge produced a PASS verdict', records.some((r) => r.type === 'verdict' && r.outcome === 'PASS'), records.filter((r) => r.type === 'verdict'));
  check.require('Run finished with the original conversational owner', final.run.status?.startsWith('ended-') === true && final.run.control?.owner === String(agent.id), final.run);
  const codes = records.filter((r) => r.type === 'code');
  check.observed.code = codes.map((r) => ({ record: r, content: readFileSync(r.path, 'utf8'), actualSha256: sha256(readFileSync(r.path)) }));
  check.require('code records hash the actual generated files', codes.length > 0 && codes.every((r) => sha256(readFileSync(r.path)) === r.sha256), check.observed.code);
  check.require('same model used all controlled Workshop actions', ['recommend', 'read', 'knowledge', 'write', 'pause', 'continue'].every((action) => toolCalls(agent).some((call) => call.name === 'hima_execute' && call.args.action === action)), toolCalls(agent));
  check.require('no separate research model moment opened', records.every((r) => r.type !== 'session') && check.requestSessions.size === 1, { momentRecords: records.filter((r) => r.type === 'session'), modelSessions: [...check.requestSessions] });
}

export async function runLive(name: string, maxTurns: number, task: (check: LiveCheck) => Promise<void>): Promise<void> {
  const check = new LiveCheck(name, maxTurns);
  try { await check.wait(task(check)); } catch (error) { check.failure = check.clean(error instanceof Error ? error.stack ?? error.message : String(error)); }
  finally { await check.finish(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runLive('live-check-workshop', 16, workshop);
