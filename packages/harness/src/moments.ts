// @hima-seam agent wrapped
// @hima-seam agent-presets direct
// @hima-seam system-prompt wrapped
// @hima-seam tools direct
// @hima-seam llm direct
// Model moments: one isolated model session, opened for one purpose at one node of one Generation,
// and closed. One reason to change: what it takes to ask a model one thing and write down that it
// happened.
//
// **This is the only file under `packages/` that reaches dsh's agent seam** (ADR-0001 keeps that
// seam wrapped: `AgentSetup` gained its second parameter, `parentAgent` appeared and `ctx.agent`
// went away between the two tracked versions). The contract suite's own `boot-inprocess.ts` keeps a
// second wrapper of `ctx.agents.create` for the command-word tests, which is test support and not
// the bundle; no other Hima file creates or drives an agent.
//
// What a moment is, and what it is not. It is *not* a chat: nobody is watching it, nothing steers
// it, and it does not outlive the one thing it was opened for. It carries exactly the instructions
// of its purpose as its whole system prompt, exactly the tools the caller hands it and nothing else,
// and it is disposed when the purpose is served. The ledger gets a pair of records — opened, closed
// — so a Campaign whose act node consulted a model can be audited without the session log: which
// purpose, which session, which model, which node and attempt, what the model could reach, and how
// it ended.
//
// Three things make the isolation real, and all three are asserted by the contract suite rather than
// claimed here:
//
//  1. **The preset.** The moment's session is composed from the Hima agent preset `hima-moment`,
//     whose composition mounts no tool at all and a persona that suppresses the deployment identity
//     and dsh's runtime-context snapshots. In the profile this product ships (dsh's web app), the
//     model-facing tools are not in the host composition at all — the web bundle disables every one
//     of them and the `standard` preset mounts them on the agent plane — so a session composed from
//     a preset that mounts none has none.
//  2. **The restriction.** Whatever *is* registered globally — Hima's own four tools are, and a
//     headless composition's shell and filesystem tools would be — is denied for this one session's
//     scope (`ctx.tools.restrict`, which filters what a scope inherits and never what its own layer
//     registers). So the session's tools are the caller's and nothing else, whatever the host around
//     it was composed with.
//  3. **The proof.** What the `opened` record carries is not the caller's list but the list dsh
//     itself reports for that session's scope (`ctx.tools.schemas(agent)`). A record of what we
//     meant to give the model would not be evidence of what it could reach.
//
// The approval policy is set to `never` for the session, and that is a decision rather than a
// default. dsh's approval is one-shot and needs an answerer; in this product the only answerer is a
// browser chat surface, and a moment's session is in no browser tab — so a tool call that asked for
// approval would hang until the turn's own signal cut it off. `never` makes the approval service
// return `rejected` before any answerer is dispatched, which is the fail-closed answer for a session
// with nobody to ask. The sandbox mode is left exactly as the host composed it: a moment reaches no
// filesystem, because a moment has no tool that does.
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { Context } from '@deepseek-ai/cordis';
// Type-only: these take the `ctx.agents` and `ctx.tools` declaration merges the calls below stand on.
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-tools';
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { randomUUID } from 'node:crypto';
import type { Ledger, MomentOutcome } from './ledger.js';
// The two refusals a moment can arrive with, in the leaf every face recognises errors by type from.
import { MomentTurnError, RunStartError } from './errors.js';
// The tool names the pack authoring guard governs, which are also the names no moment may be opened
// with (D48). One list, in the file that states the rule about them; see `openMoment` for why.
import { GOVERNED_TOOLS } from './authoring.js';

/**
 * The Hima agent preset a moment is composed from: the one this bundle ships, which mounts no tool
 * and no identity of its own. `prepareHimaHome` installs it into the home's preset root, beside the
 * profile; the id is the directory's name, which is why it is spelled once, here.
 */
export const HIMA_MOMENT_PRESET = 'hima-moment';

/** The name of the prompt section a moment's instructions are registered as, for whoever reads one. */
const INSTRUCTIONS_SECTION = 'hima:moment';

/**
 * Three dsh services this module reads through `ctx.get` rather than through a declaration merge,
 * because each would otherwise make its package a dependency of this bundle for one method.
 *
 * That is the right trade for exactly these three: `agentPresets` and `approval` are optional in a
 * composition (a headless host has neither), and `systemPrompt` is one of the seams ADR-0001 tracks
 * as volatile — its `persona` config split in two between the tracked versions, and its order
 * constants were renumbered. A minimal interface naming only what is called is the smallest surface
 * a version bump can break.
 */
interface MomentServices {
  /** Compose this agent's scope from one preset; absent in a composition with no roster. */
  readonly agentPresets?: { mount(agentCtx: Context, id: string): Promise<unknown> };
  /** The prompt registry; `complete` makes one section the whole of a scope's system prompt. */
  readonly systemPrompt?: { section(section: { name: string; order: number; text: string; complete?: boolean }): unknown };
  /** dsh's one-shot approval; `never` answers `rejected` without dispatching an answerer. */
  readonly approval?: { setPolicy(agent: Agent, policy: 'ask' | 'never'): unknown };
  /** The profile's default provider and model — what a moment runs on (D9). */
  readonly agentDefaultModel?: { currentSelection(): { provider: string; model: string } };
}

const serviceOn = <K extends keyof MomentServices>(ctx: Context, key: K): MomentServices[K] =>
  ctx.get(key) as MomentServices[K];

/** What a thrown thing says, whatever it turned out to be. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** What every moment operation is given: the ledger it records into, and the host it opens on. */
export interface MomentDeps {
  readonly ledger: Ledger;
  /** The host's own context — the one thing in this harness that can compose an agent. */
  readonly ctx: Context;
}

/** What a caller states when it opens a moment. */
export interface MomentRequest {
  /** The Run this moment belongs to; its Generation is stamped on both records by the ledger. */
  readonly runId: string;
  /** The node of the Run's graph this moment is for. */
  readonly nodeId: string;
  /** Which attempt at that node this moment is, counted from one. */
  readonly attempt: number;
  /** The purpose: the Hima agent preset the session is composed from. */
  readonly preset: string;
  /** The whole of the session's system prompt — the instructions of this purpose and nothing else. */
  readonly instructions: string;
  /** The tools the model may reach, registered into this session's own scope. An empty list is a
   *  session that can only answer. */
  readonly tools: readonly ToolDefinition[];
  /** The directory the session is opened in. The Campaign's workspace, where a caller has one. */
  readonly cwd?: string;
  /**
   * The workshop this moment is being opened for, when it is one (#62): the workshop of the pack's
   * contract, and the one file of it the fabric runs.
   *
   * Carried onto the `opened` record, which is what makes a workshop readable off the ledger alone —
   * which node of the graph opens one, which workshop it is, and what runs are three facts no other
   * record of a Run carries, and a face that resolved them by loading the pack folder would show
   * nothing for a pack since uninstalled or edited. Absent for every other purpose a moment is opened
   * for, and the `/hima/api/runs/<id>/moment` route's own moments carry none.
   */
  /** Fixed identity for durable task producers; absence preserves legacy moments. */
  readonly sessionId?: string;
  /** Cold reconstruction uses the exact persisted session and never creates a new identity. */
  readonly resumeOnly?: boolean;
  /** Every model request, including tool-driven continuation, checks current native admission. */
  readonly beforePrompt?:()=>Promise<void>;
  readonly modelSelection?:{readonly provider:string;readonly model:string};
  readonly workshop?: { readonly id: string; readonly entry: string; readonly entryPath: string };
}

/** What one turn of a moment answered: the assistant's final text, and nothing about how it got there. */
export interface MomentTurn {
  readonly text: string;
}

/**
 * One open model session. `ask` runs one turn; `close` disposes the session and writes the record
 * that says so.
 */
export interface Moment {
  /** dsh's own session id, which is also the agent's: what finds this session's log on this machine. */
  readonly sessionId: string;
  /** Provider route actually selected on the composed agent. */
  readonly provider: string;
  /** The model the session carries, read off the session dsh composed. */
  readonly model: string;
  /** Every tool the session can reach, as dsh reports them for its scope. */
  readonly tools: readonly string[];
  ask(text: string): Promise<MomentTurn>;
  close(outcome: MomentOutcome): Promise<void>;
}

/**
 * Open one isolated model session for one purpose, and write down that it opened.
 *
 * The session is composed inside dsh's own creation transaction (`setup`), so everything that makes
 * it what it is — the preset it joins, the restriction on what it inherits, its whole system prompt,
 * its tools — exists before dsh announces the session or assembles a single prompt. A setup that
 * throws rolls the creation back and nothing is written here either.
 *
 * **A moment has no shell and no host filesystem** (D48), and that is a property of the moment and
 * not of the one route that opens one today. This interface takes the caller's tools on purpose —
 * #62's act node hands it the pack's — so the invariant is enforced here, by name, before anything
 * is composed: a request carrying `write`, `edit` or `bash` is refused outright. The names are the
 * pack authoring guard's own list (`GOVERNED_TOOLS`), read from that one place rather than spelled
 * again here, because the two rules have to mean the same thing: the guard denies those three in an
 * authoring session, and a Model moment — which is promised it can never be denied — must therefore
 * never be handed one. What #62's workshop tools are is the reason this costs the product nothing:
 * they are Hima-named (`hima_*`) and reach a Site through HimaShell under the Permit, so no tool the
 * pipeline plans to give a moment is one of these three.
 *
 * @param deps - the ledger to record into, and the host to compose on.
 * @param request - what this moment is for: where in the Run, what the model is told, what it may reach.
 * @returns the open moment.
 * @throws when a requested tool carries a governed name, when the host composes no agent registry,
 *         or when the preset or the composition refuses.
 */
export async function openMoment(deps: {readonly ledger:{appendSession(runId:string,data:Parameters<Ledger['appendSession']>[1]):Promise<unknown>};readonly ctx:Context}, request: MomentRequest): Promise<Moment> {
  const { ctx, ledger } = deps;
  // Before the registry is even asked for: nothing is composed, nothing is claimed, and nothing is
  // recorded, so a caller that got this wrong leaves no session and no `session` record behind.
  const governed = request.tools.find((tool) => (GOVERNED_TOOLS as readonly string[]).includes(tool.name));
  if (governed) {
    throw new Error(
      `a Model moment has no shell and no host filesystem (D48), so it cannot be opened with the tool "${governed.name}": `
      + `${GOVERNED_TOOLS.join(', ')} are the names the pack authoring guard governs, and a session composed with one of them `
      + 'would be a moment this product both promises never to deny and denies. Nothing was composed and nothing was recorded.',
    );
  }
  const agents = ctx.get('agents');
  if (!agents) throw new Error('this host composes no agent registry, so it can open no model moment');
  // The profile's default route and model (D9), read from the host rather than spelled here: a
  // moment runs on whatever the deployment's model is, and this bundle names no model anywhere.
  const selection = request.modelSelection ?? serviceOn(ctx, 'agentDefaultModel')?.currentSelection();
  if (!selection) throw new Error('this host declares no default model, so it can open no model moment');
  const compose = {
    sessionId: (request.sessionId ?? `session-${randomUUID()}`) as never,
    // `agentPreset` on the session's own metadata, beside the mount below: the mount is what composes
    // this live session, and this is what the session's durable header says it was composed from.
    meta: { agentPreset: request.preset, ...(request.cwd === undefined ? {} : { cwd: request.cwd }) },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: async (agentCtx:Context) => {
      // The purpose's own composition. A host with no roster (a headless one) composes nothing here
      // and the restriction below is what isolates the session on its own.
      await serviceOn(agentCtx, 'agentPresets')?.mount(agentCtx, request.preset);
      // Everything this scope would otherwise inherit, denied by name. Read off the global view
      // rather than listed here, so a tool put on this host by anything at all — Hima's own four,
      // a headless composition's shell and filesystem — is outside a moment without this file
      // being edited. An empty filter is refused by dsh, so a host with no global tool skips it.
      const inherited = ctx.tools.schemas().map((schema) => schema.name);
      if (inherited.length > 0) agentCtx.tools.restrict({ deny: inherited });
      // The instructions are the whole prompt: `complete` restores this one section as the sole
      // prompt after assembly, so no deployment persona, harness orientation or tool guidance
      // reaches a moment. Order is 0 because a complete section has nothing to be ordered against.
      serviceOn(agentCtx, 'systemPrompt')?.section({ name: INSTRUCTIONS_SECTION, order: 0, text: request.instructions, complete: true });
      for (const tool of request.tools) agentCtx.tools.register(tool);
      if(request.beforePrompt) agentCtx.on('agent/request',async(_payload,next)=>{await request.beforePrompt!();return next();});
    },
  };
  const handle:AgentHandle=request.resumeOnly
    ? await agents.resume({resumeSessionId:compose.sessionId,agentOptions:compose.agentOptions,setup:compose.setup})
    : await agents.create(compose);
  const agent = handle.agent;
  // Nobody is watching this session, so nobody can answer it: `never` is refused deterministically
  // before any answerer is dispatched, where `ask` would hang until the turn's signal cut it off.
  serviceOn(ctx, 'approval')?.setPolicy(agent, 'never');
  // What dsh says this session can reach, not what we meant to give it.
  const tools = ctx.tools.schemas(agent).map((schema) => schema.name);
  const provider = agent.options.provider ?? selection.provider;
  const model = agent.options.model ?? selection.model;
  const head = { preset: request.preset, sessionId: String(agent.id), model, nodeId: request.nodeId, attempt: request.attempt };
  // An absent key, never an undefined one, and only on the `opened` record: what a moment was opened
  // for is settled when it is composed (#62).
  const forWorkshop = request.workshop === undefined ? {} : { workshop: request.workshop };
  try {
    await ledger.appendSession(request.runId, { ...head, event: 'opened', tools, ...forWorkshop });
  } catch (err) {
    // A session this ledger will not record is a session nothing can ever close: no `opened` record
    // means no reconciliation will find it, and the caller is about to be handed an exception rather
    // than a moment. So it is disposed here, where it is still in hand.
    await handle.dispose();
    throw err;
  }

  let closed = false;
  /** The close in flight, if one is: what a second caller waits for instead of writing beside it. */
  let closing: Promise<void> | undefined;
  return {
    sessionId: head.sessionId,
    provider,
    model,
    tools,
    async ask(text: string): Promise<MomentTurn> {
      const before = agent.session.deriveMessages().length;
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'hima' } }));
      await agent.whenIdle();
      const answer = agent.session.deriveMessages().slice(before).findLast((message) => message.role === 'assistant');
      if (!answer) throw new MomentTurnError(`the model answered nothing in session ${head.sessionId}: ${whyNothingCame(agent)}`);
      // A provider may return private reasoning beside the user-visible answer. Both block kinds
      // carry a `text` field, so structural duck typing would disclose reasoning through the
      // Model-moment API and would also corrupt strict JSON outputs. Match the canonical visible
      // block tag exactly, as the normal conversation projection does.
      return { text: answer.content.filter((block) => block.type === 'text').map((block) => block.text).join('') };
    },
    async close(outcome: MomentOutcome): Promise<void> {
      // Once, whatever a caller does: a moment closed twice would be two closes for one open, which
      // is the one thing the reconciliation below is written to keep true. Once even if two callers
      // do it at the same time — a close already in flight is *the* close, and a second caller waits
      // for it rather than appending a second record beside it — and this is what says so rather
      // than the flag, which cannot be set until the record is actually on the ledger.
      if (closed) return;
      closing ??= (async () => {
        // The session is disposed first and recorded second, for the reason `appendExperience` is
        // written after both files are on the Site: the record is the claim that the session is
        // over, and a claim written first would survive a host that died between the two.
        //
        // A dispose that throws must not take the record with it. The session is over either way —
        // dsh has been told to end it and this moment will never ask it anything again — so a close
        // that wrote nothing would leave an `opened` with no `closed` that no caller could retry and
        // that the next boot would record `interrupted`: a completed moment remembered as one that
        // was cut off. So the failure is held, the record is written, and the failure is raised
        // afterwards rather than swallowed.
        let disposeFailed: unknown;
        try {
          await handle.dispose();
        } catch (err) {
          disposeFailed = err;
        }
        await ledger.appendSession(request.runId, { ...head, event: 'closed', outcome });
        // Both after the record is on the ledger, and in this order: until it is there, this process
        // still owns an open session and the close has not happened.
        closed = true;
        if (disposeFailed !== undefined) {
          throw new Error(`the model session ${head.sessionId} is recorded ${outcome} but would not dispose: ${messageOf(disposeFailed)}`, { cause: disposeFailed });
        }
      })();
      const mine = closing;
      try {
        await mine;
      } finally {
        // A close that never reached the ledger is one a caller may still try for, so it is
        // forgotten here; a close that did reach it is remembered by the flag instead. Only this
        // caller's own close is forgotten: a second waiter on a failed close must not clear the
        // replacement the first waiter's retry has already started.
        if (!closed && closing === mine) closing = undefined;
      }
    },
  };
}

/**
 * Why a turn produced no assistant message, in dsh's own words.
 *
 * A model call that settles without committing anything model-visible leaves an `assistant/attempt`
 * event carrying the stream it did produce, and a stream that ended in a failure carries that
 * failure's own message — "no API key for provider route", a refused request, a cancelled turn. That
 * text is the whole of what is useful to say about a turn that answered nothing, and it is what the
 * route and the live check put in front of whoever asked.
 *
 * Read through the session object dsh hands out, never off the log file: the on-disk format changed
 * generation twice in the week ADR-0001 measured, and this module is the one place in the bundle
 * that reads a session at all.
 */
function whyNothingCame(agent: Agent): string {
  const events = agent.session.snapshotEvents();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as { type?: unknown; data?: unknown };
    if (event.type !== 'assistant/attempt') continue;
    const stream = (event.data as { stream?: readonly unknown[] } | undefined)?.stream ?? [];
    for (let j = stream.length - 1; j >= 0; j--) {
      const chunk = (stream[j] as { chunk?: { type?: unknown; reason?: { kind?: unknown; failure?: { message?: unknown } } } }).chunk;
      if (chunk?.type !== 'finish') continue;
      const failure = chunk.reason?.failure?.message;
      if (typeof failure === 'string' && failure !== '') return failure;
      return `the model stream finished ${String(chunk.reason?.kind)} without an answer`;
    }
    return 'the model produced no chunk at all';
  }
  return 'the turn ended without the model being asked anything';
}

/** What opening a moment on a Run's current node answered. */
export interface MomentOnNode extends MomentTurn {
  readonly sessionId: string;
  readonly provider: string;
  readonly model: string;
  readonly tools: readonly string[];
  readonly nodeId: string;
  readonly attempt: number;
}

/**
 * The `POST /hima/api/runs/<id>/moment` route for a Run that is not durable. Every current Run belongs
 * to its conversation Agent, and historical Runs never open a second execution Agent, so the answer
 * is always a refusal; nothing is composed or written.
 *
 * @throws RunStartError naming why no moment is opened.
 */
export async function momentOnCurrentNode(deps: MomentDeps, runId: string, _instructions: string): Promise<MomentOnNode> {
  const run = deps.ledger.run(runId);
  if (!run) throw new Error(`unknown run ${runId}`);
  if (run.control !== undefined) {
    throw new RunStartError(`run ${runId} is controlled by its conversation Agent; separate model moments are unavailable in every Run state`);
  }
  throw new RunStartError('standalone historical model moments are unavailable; use the conversation Agent to inspect this Run');
}

/** Read a completed native moment from the persisted session log, including after Host loss. */
export async function readMomentResult(ctx:Context,sessionId:string,cwd:string):Promise<MomentTurn|undefined> {
  const query=ctx.get('sessionQuery' as never) as {readSession(id:string):Promise<{session:{id:unknown;cwd?:string};events:readonly {seq:number;type:string;data?:unknown}[]}>}|undefined;
  if(!query) return undefined;
  let log:Awaited<ReturnType<typeof query.readSession>>;
  try{log=await query.readSession(sessionId);}catch{return undefined;}
  if(String(log.session.id)!==sessionId || log.session.cwd!==cwd) throw new Error('Native moment identity or workspace changed');
  const end=log.events.findLast(event=>event.type==='turn/end');
  const ended=end?.data as {turn?:number;reason?:{kind?:string}}|undefined;
  if(!end || ended?.reason?.kind!=='completed') return undefined;
  const answer=log.events.findLast(event=>event.seq<end.seq && event.type==='assistant/message' && (event.data as {turn?:number})?.turn===ended.turn);
  const data=answer?.data as {interrupted?:boolean;message?:{role?:string;content?:{type:string;text?:string}[]}}|undefined;
  if(data?.interrupted || data?.message?.role!=='assistant') return undefined;
  return {text:(data.message.content??[]).filter(block=>block.type==='text').map(block=>block.text??'').join('')};
}
