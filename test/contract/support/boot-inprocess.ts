// @hima-seam app-boot direct
// @hima-seam agent wrapped
// Contract-test support: boot the hima profile in-process exactly the way the dsh launcher does,
// minus the web app layer, so tests can execute commands against a real agent without a browser.
// app-boot is documented-public and used directly — loadProfile, loadOptionalPatches,
// healProfilesModuleFallback, boot, assertEntriesActivated. Agent creation is the seam ADR-0001
// keeps wrapped, so `createRootAgent` and `sayAsUser` below are the one place any test reaches it:
// no test file calls `agents.create`, `agent.followup` or `createUserMessage` itself.
import { writeFileSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { boot, loadProfile, loadOptionalPatches, healProfilesModuleFallback, assertEntriesActivated } from '@deepseek-ai/dsh-app-boot';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { HimaHome } from './dsh-home.ts';
import { recordTestBoot, repoRoot } from './dsh-home.ts';
import { homePatchFile } from '../../../packages/desktop/src/hima-home.ts';

const BIN_NAME = 'dsh';
// The launcher anchors on its own realpath; pnpm's isolated layout exposes sibling dsh packages only from there.
const INSTALL_ANCHOR = realpathSync(path.join(repoRoot, 'node_modules/@deepseek-ai/dsh/package.json'));
const ROOT_CONFIG = '# dsh profile root — an empty entry list; the tree is composed as patches.\n[]\n';

export interface InProcessHost {
  readonly ctx: Context;
  dispose(): Promise<void>;
}

/** Boot dsh-base + the Hima bundle + the profile's privacy overlay in this process; rejects unless every entry activates. */
export async function bootInProcess(h: HimaHome, { withWebApp = false } = {}): Promise<InProcessHost> {
  recordTestBoot('host-in-process');
  // dsh resolves its home from the process environment (dshHomePath); an in-process host must see the isolated one.
  const saved = { DSH_HOME: process.env.DSH_HOME, DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME, DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED };
  process.env.DSH_HOME = h.env.DSH_HOME;
  process.env.DSH_AGENTS_HOME = h.env.DSH_AGENTS_HOME;
  process.env.DSH_TELEMETRY_DISABLED = '1';
  const restoreEnv = () => {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };
  const profile = loadProfile(BIN_NAME, 'hima', INSTALL_ANCHOR, h.home, { userLayer: true });
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile, home: h.home });
  const rootConfig = path.join(profile.dir, 'cordis.yml');
  writeFileSync(rootConfig, ROOT_CONFIG);
  const layers = profile.layers.filter((l) => withWebApp || l.packageName !== '@deepseek-ai/dsh-web-app');
  // The launcher's own order, all four layers of it: the bundles, then the profile's own patch file,
  // then the home's. `loadProfile`'s `userLayer` is the *profile's* `cordis.patch.yml` — the privacy
  // overlay — and the home's `$DSH_HOME/cordis.patch.yml` is a fifth file dsh's CLI loads itself
  // (`loadOptionalPatches(name, homePatchPath())` in its `composeProfile`), outranking the profile's
  // because it is the machine's own preference layer. Loading it here is what makes this boot the
  // launcher's composition rather than a subset of it — and it is the layer the desktop shell writes
  // the keyless model stand-in into (#59), so without it no in-process host can be driven keylessly.
  const patches = structuredClone([
    ...layers.flatMap((l) => l.patches),
    ...profile.patches,
    ...loadOptionalPatches(BIN_NAME, homePatchFile(h.home)) ?? [],
  ]);
  let ctx: Context;
  try {
    ctx = await boot(BIN_NAME, rootConfig, patches);
    await assertEntriesActivated(ctx, BIN_NAME);
  } catch (err) { restoreEnv(); throw err; }
  return { ctx, dispose: async () => { try { await ctx.fiber.dispose(); } finally { restoreEnv(); } } };
}

/** Create one root agent the way dsh's own headless bundle does; no model request is made until a turn runs. */
export async function createRootAgent(ctx: Context, cwd: string): Promise<Agent> {
  const agents = ctx.get('agents');
  const defaultModel = ctx.get('agentDefaultModel');
  if (!agents || !defaultModel) throw new Error('agents/agentDefaultModel services missing');
  const selection = defaultModel.currentSelection();
  const { agent } = await agents.create({
    sessionId: `session-${randomUUID()}` as never,
    meta: { cwd },
    agentOptions: { provider: selection.provider, model: selection.model },
  });
  await agent.whenIdle();
  return agent;
}

/**
 * Say one thing to an agent the way a person says it in the window's chat, and wait for the turn.
 *
 * The one place any test makes a user message. `createUserMessage` and `agent.followup` are the
 * wrapped agent seam (ADR-0001), and the message's `source.kind` is load-bearing beyond identity:
 * dsh scans the *claimed user messages* of a step for a `/name` gesture and injects that skill's
 * body, and its predicate is `message.source.kind === 'user'` (`@deepseek-ai/dsh-tool-skill`,
 * `invokedSkillNames`). A message sent under any other source is one no gesture can be read out of,
 * so a test that invented its own source would be testing a path a person cannot reach.
 *
 * @param agent - the agent to say it to.
 * @param text - what a person typed, `/hima-grill …` and the like.
 * @returns when the turn the message opened has reached quiescence.
 */
export async function sayAsUser(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
  await agent.whenIdle();
}

/** Deliver a real user's interruption at the next Agent step, without queuing behind the turn. */
export function steerAsUser(agent: Agent, text: string): void {
  agent.steer(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
}

/** Stop only this test-owned Agent when its live-check budget expires. */
export function cancelTestAgent(agent: Agent, reason: string): void {
  agent.cancel({ kind: 'hook', reason });
}

/**
 * The skills a session's own messages say were injected into it, in the order they were injected.
 *
 * Read off the live session's derived history rather than off the log file on disk: the log is
 * dsh's own storage format and a test that parsed it would be asserting on a file format instead of
 * on what the model was given. A user-explicit skill invocation rides an injected message whose
 * source is dsh's `skill-invocation` (`@deepseek-ai/dsh-skill`), and that source carries the name —
 * so this reads the fact dsh publishes rather than searching the body's text for a title.
 *
 * @param agent - the agent whose session to read.
 * @returns each injected skill's name, in session order; repeats kept, because a skill injected
 *          twice is two injections and a test may be about exactly that.
 */
export function injectedSkills(agent: Agent): string[] {
  const names: string[] = [];
  for (const message of agent.session.deriveMessages()) {
    const source: { kind: string; name?: unknown } = message.source;
    if (source.kind !== 'skill-invocation') continue;
    if (typeof source.name !== 'string') throw new Error(`a skill-invocation message carries no name: ${JSON.stringify(source)}`);
    names.push(source.name);
  }
  return names;
}

/**
 * Every tool the model called in this session, in order, with the arguments it called them with.
 *
 * Read off the session's derived history for the reason {@link injectedSkills} is: the log file is
 * dsh's own storage format, and what a test is asking about here is what the model asked the host to
 * do. The arguments come back parsed, because a raw JSON string is the model's spelling and a test
 * comparing spellings would fail the day a transcript is re-recorded with different whitespace.
 *
 * @param agent - the agent whose session to read.
 * @returns each call's tool name and parsed arguments, in session order.
 */
export function toolCalls(agent: Agent): { name: string; args: Record<string, unknown> }[] {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  for (const message of agent.session.deriveMessages()) {
    for (const block of message.content) {
      if (block.type !== 'tool-call') continue;
      calls.push({ name: block.name, args: JSON.parse(block.arguments) as Record<string, unknown> });
    }
  }
  return calls;
}

/**
 * What the model said in this session, in order: the visible text of each assistant message.
 *
 * Tool calls and reasoning are not in it — this is what a person reads in the chat, which is what a
 * check asking "did the stage ask, or did it act?" is asking about.
 *
 * @param agent - the agent whose session to read.
 * @returns each assistant message's text, joined per message, in session order.
 */
export function saidByModel(agent: Agent): string[] {
  const said: string[] = [];
  for (const message of agent.session.deriveMessages()) {
    if (message.role !== 'assistant') continue;
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    if (text !== '') said.push(text);
  }
  return said;
}

/**
 * What every tool this session ran answered, in order: whether it failed, and what it said.
 *
 * A denial is an *answer*, not an absence — dsh's tool runtime hands the model a failed result and
 * the turn goes on — so a test asking whether the sandbox refused a write has to read the result
 * rather than infer it from the file not being there. Both facts matter and this is the first of them.
 *
 * @param agent - the agent whose session to read.
 * @returns each result's failure flag and text, in session order.
 */
export function toolResults(agent: Agent): { failed: boolean; text: string }[] {
  const results: { failed: boolean; text: string }[] = [];
  for (const message of agent.session.deriveMessages()) {
    for (const block of message.content) {
      if (block.type !== 'tool-result') continue;
      results.push({
        failed: block.isError === true,
        text: block.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
      });
    }
  }
  return results;
}

/** Hold the native resumed handle through a bounded continuation; the caller owns disposal. */
export async function resumeTestAgent(ctx: Context, sessionId: string) {
  const agents = ctx.get('agents');
  if (!agents) throw new Error('agents service missing');
  return agents.resume({ resumeSessionId: sessionId as never });
}

/**
 * Reopen one **persisted** session by id and read it, through dsh's own agent registry.
 *
 * The one way a test can read a session that is over. A Model moment lives inside one turn of the
 * fabric and is disposed when that turn ends (#59), so by the time a Run has finished there is no
 * live `Agent` left to ask — and what a test of #62 wants to know about a moment (what its
 * instructions said, what its tools answered) is in the session's own durable log and nowhere else.
 *
 * `ctx.agents.resume` is dsh's own door onto that log: it opens the persisted session, reconstructs
 * the live `Session` from its events and publishes an agent on it, so `deriveMessages()` answers for
 * a session that ended in another process exactly as it answers for a live one. The alternative —
 * parsing `$DSH_HOME`'s session files — would be a test asserting on dsh's storage format, which is
 * the seam ADR-0001 keeps wrapped and the one that moved generation twice in a week.
 *
 * The resumed agent is disposed whatever the reader does, and nothing is ever asked of the model: no
 * turn is started, so no replay entry is consumed and no request is made.
 *
 * @param ctx - a booted host's context; it must be the one whose home holds the session.
 * @param sessionId - dsh's own session id, as the ledger's `session` records carry it.
 * @param read - what to take off the reopened session.
 * @returns whatever the reader answered.
 */
export async function readPersistedSession<T>(ctx: Context, sessionId: string, read: (agent: Agent) => T): Promise<T> {
  const handle = await resumeTestAgent(ctx, sessionId);
  try {
    return read(handle.agent);
  } finally {
    await handle.dispose();
  }
}

/**
 * The whole of the system prompt a session was composed with, as its own log records it.
 *
 * The rendered system prompt is a durable surface event (`system/message`, surface node 0), so it is
 * derived history like every other message and is read here the way {@link saidByModel} reads the
 * assistant's words — off `deriveMessages()`, never off the file. The *latest* system message, because
 * a route that updates the prompt in history appends later ones and the last is what was in force.
 *
 * @param agent - the agent whose session to read; a resumed one answers as a live one does.
 * @returns the prompt's text, or undefined for a session that never reached a model call.
 */
export function systemPromptOf(agent: Agent): string | undefined {
  const system = agent.session.deriveMessages().findLast((message) => message.role === 'system');
  if (system === undefined) return undefined;
  return system.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

/**
 * The **host log** this host has written, line by line, in the order it wrote them.
 *
 * The operator's channel, and the one the harness keeps for what is not a record: a stretch of polls
 * during which a Site could not be asked (#18), and a byte a workshop landed that the ledger would
 * not take (#62). `FabricDeps.log` is `ctx.logger.info` on a booted host (`index.ts`), and cordis's
 * logger service keeps its last thousand messages in a buffer of its own — so this reads what the
 * host published rather than capturing a callback the test handed in, which would prove only that
 * the test's own function ran.
 *
 * Each message is rendered as its arguments joined by a space, which is what one `logger.info(line)`
 * call makes of one line; no exporter is registered and nothing is consumed, so calling this twice
 * answers the same thing.
 *
 * @param host - the booted in-process host.
 * @returns the lines, oldest first.
 */
export function hostLog(host: InProcessHost): string[] {
  return host.ctx.logger.buffer.map((message) => message.args.map((arg: unknown) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
}

/**
 * Make this host's **host log** throw on one line, so a test can drive what the harness does when the
 * operator's channel is the thing that fails.
 *
 * cordis's logger fans a message out to its registered exporters and guards none of them, so an
 * exporter that throws is a `ctx.logger.info(…)` that throws — which is exactly what `FabricDeps.log`
 * is on a booted host. That is the real shape of the failure: a disk-backed exporter with no space
 * left, a transport that rejects. Narrowed to the one line by `marker` because the exporters are the
 * service's and shared: a sink that threw on everything would break dsh's own logging around the
 * test rather than the call the test is about.
 *
 * The built-in buffer exporter is registered first and is not disturbed, so {@link hostLog} still
 * carries the line: what this seam breaks is the *call*, not the record of it.
 *
 * @param host - the booted in-process host, disposed as usual (the exporter goes with its fiber).
 * @param marker - the substring of the line to throw on.
 * @param thrown - the message the throw carries, for the test to look for wherever it is reported.
 */
export function breakHostLogOn(host: InProcessHost, marker: string, thrown: string): void {
  const logger = host.ctx.logger as unknown as {
    exporter(sink: { colors: false; export(message: { args: unknown[] }): void }): unknown;
  };
  logger.exporter({
    colors: false,
    export: (message) => {
      if (message.args.some((arg) => typeof arg === 'string' && arg.includes(marker))) throw new Error(thrown);
    },
  });
}
