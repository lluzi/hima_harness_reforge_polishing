// @hima-seam tools direct
// The `hima_*` tool face: what an agent may ask this harness to do, and the JSON it is answered in.
// One reason to change: what an agent can call, and the shape of the answer.
//
// A tool call is a caller like any other: the same table of what a Run's arguments may be refuses
// here the values `/hima run` refuses on a command line, because a value no person could type must
// not be a value a model can. Every tool value is lossless JSON — an absent key, never an undefined
// one — since a key that arrives as `undefined` is a key that did not survive the wire.
//
// The two sentences a tool answers a refusal with are the command face's own (`describePackCheck`,
// `describePrepare`): one unfit pack told two ways by two faces of one harness is two products.
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { VerdictRecord } from './ledger.js';
import { observe, type ObserveRequest, type ObserveResult } from './observe.js';
import { resumeRun, startRun, type FabricDeps, type ResumeResult, type StartRunResult } from './fabric.js';
import { cancelRun, type CancelResult } from './recovery.js';
import { describePackCheck, describePrepare } from './commands.js';
import { allowsRunArgument, badRunArgument, notWaitingToResume, unresumableReason, type RunArgumentName, type StrategyValue } from './run-arguments.js';

/** One tool as `ctx.tools.register` takes it: whatever `defineTool` makes of a definition. */
type ToolDefinition = ReturnType<typeof defineTool>;

/** One numeric argument of a tool call, validated the same way. Absent is absent; wrong is refused. */
function toolNumber(name: RunArgumentName, given: number | undefined): number | undefined {
  if (given === undefined) return undefined;
  if (!allowsRunArgument(name, given)) throw new Error(badRunArgument(name, name, given));
  return given;
}

/**
 * Every entry of a caller-supplied `params` object, validated the way `--param` and the POST body
 * already do: a value that is not a finite number is the caller's mistake, named and returned as an
 * error — never silently dropped, which would leave a rule's declared parameter looking unbound
 * instead of wrong.
 */
function numericParams(raw: Record<string, unknown> | undefined): { params: Record<string, number> } | { error: string } {
  const params: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: `params.${name} must be a finite number; got ${JSON.stringify(value)}` };
    }
    params[name] = value;
  }
  return { params };
}

/**
 * The `strategy` of a `hima_run` call: the knobs to set, by name (#58).
 *
 * A value is a finite number or a non-empty word, because those are the two kinds a pack can declare
 * a knob to be; which knob takes which, and whether the value is one that pack allows, is
 * `startRun`'s to say against its declaration. Refused rather than dropped, exactly as a bad
 * `params` entry is: a knob silently ignored would start a Campaign at a value nobody asked for.
 */
function strategyArgument(raw: unknown): Record<string, StrategyValue> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`strategy must be an object of knob values; got ${JSON.stringify(raw)}`);
  const strategy: Record<string, StrategyValue> = {};
  for (const [name, value] of Object.entries(raw)) {
    const ok = typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value !== '';
    if (!ok) throw new Error(`strategy.${name} must be a finite number or a non-empty string; got ${JSON.stringify(value)}`);
    strategy[name] = value as StrategyValue;
  }
  return strategy;
}

interface VerdictToolValue { outcome: VerdictRecord['outcome']; ruleId: string; ruleVersion: string; recordId: string; cites: string[]; reason?: string; boundParameters?: Record<string, number> }

function verdictToolValue(v: VerdictRecord): VerdictToolValue {
  const head = { outcome: v.outcome, ruleId: v.ruleId, ruleVersion: v.ruleVersion, recordId: v.id, cites: v.cites };
  // An absent key, never an undefined one: a tool value must be lossless JSON.
  const withReason = v.reason === undefined ? head : { ...head, reason: v.reason };
  return v.boundParameters === undefined ? withReason : { ...withReason, boundParameters: v.boundParameters };
}

interface ObserveToolValue { kind: 'observed' | 'refused'; runId: string; recordId: string; contentSha256?: string; bytes?: number; reason?: string; verdicts?: VerdictToolValue[] }

function toolResult(result: ObserveResult): ObserveToolValue {
  const head = { kind: result.kind, runId: result.run.id, recordId: result.record.id };
  return result.kind === 'observed'
    ? { ...head, contentSha256: result.record.contentSha256, bytes: result.record.bytes }
    : { ...head, reason: result.record.reason };
}

interface RunToolValue {
  kind: StartRunResult['kind'];
  runId?: string;
  campaignId?: string;
  status?: string;
  currentNode?: string;
  strategy?: Readonly<Record<string, StrategyValue>>;
  reason?: string;
}

/** What `hima_run` answers with: where the Run got to, or why it could not start. An absent key,
 *  never an undefined one, so a tool value is lossless JSON. */
function runToolValue(result: StartRunResult): RunToolValue {
  if (result.kind === 'unfit') return { kind: 'unfit', reason: describePackCheck(result.check) };
  const head: RunToolValue = { kind: result.kind, runId: result.run.id, campaignId: result.run.campaignId };
  if (result.kind === 'unprepared') return { ...head, reason: describePrepare(result.prepared) };
  const { run } = result;
  const withStatus = run.status === undefined ? head : { ...head, status: run.status };
  const withNode = run.currentNode === undefined ? withStatus : { ...withStatus, currentNode: run.currentNode };
  return run.strategy === undefined ? withNode : { ...withNode, strategy: run.strategy };
}

interface CancelToolValue {
  kind: CancelResult['kind'];
  runId: string;
  status?: string;
  /** The tmux session this cancel stopped, when it stopped one. */
  stoppedSession?: string;
  /** The killed job record, when a stop was observed and recorded. */
  recordId?: string;
  reason?: string;
}

/** What `hima_cancel` answers with: what was stopped, or why nothing was. An absent key, never an
 *  undefined one, so a tool value is lossless JSON. */
function cancelToolValue(result: CancelResult): CancelToolValue {
  const head: CancelToolValue = { kind: result.kind, runId: result.run.id };
  const withStatus = result.run.status === undefined ? head : { ...head, status: result.run.status };
  if (result.kind === 'not-stopped') return { ...withStatus, stoppedSession: result.session, reason: result.reason };
  if (result.kind !== 'cancelled' || !result.stopped) return withStatus;
  return { ...withStatus, stoppedSession: result.stopped.job.session, recordId: result.stopped.id };
}

interface ResumeToolValue {
  kind: ResumeResult['kind'];
  runId: string;
  status?: string;
  currentNode?: string;
  /** The node the Run was re-entered at, on a resume that took. */
  nodeId?: string;
  /** The `resumed` record this action wrote, on a resume that took. */
  recordId?: string;
  /** Why nothing was resumed and nothing written, on the two that do neither. */
  reason?: string;
}

/** What `hima_resume` answers with: where the Run got to, or why it was not resumed. An absent key,
 *  never an undefined one, so a tool value is lossless JSON. */
function resumeToolValue(result: ResumeResult): ResumeToolValue {
  const head: ResumeToolValue = { kind: result.kind, runId: result.run.id };
  const status = result.run.status;
  if (result.kind === 'unresumable') return { ...head, reason: unresumableReason(result.reason) };
  if (result.kind === 'not-waiting') {
    const said = notWaitingToResume(status);
    return status === undefined ? { ...head, reason: said } : { ...head, status, reason: said };
  }
  const withStatus = status === undefined ? head : { ...head, status };
  const withNode = result.run.currentNode === undefined ? withStatus : { ...withStatus, currentNode: result.run.currentNode };
  return { ...withNode, nodeId: result.nodeId, recordId: result.record.id };
}

/**
 * Every `hima_*` tool, built against one host's dependencies.
 *
 * Answered as a list rather than registered here, because registering is the plugin entry's own
 * effect — a tool registration unwinds when the plugin unloads, the way dsh's own plugins do it —
 * and this module has nothing to say about that.
 */
export function himaTools(deps: FabricDeps): ToolDefinition[] {
  return [
    defineTool({
      name: 'hima_observe',
      description: 'Observe one file on a named Site: read it under the site permit, hash it, and append an observation record to the HimaLedger. Refusals are recorded too. With `judge`, HimaJudge then rules on the observation and appends its verdicts.',
      parameters: {
        site: { type: 'string', required: true, description: 'Site name, as in the site file.' },
        path: { type: 'string', required: true, description: 'File path on the site, absolute or relative to its workspace root.' },
        reader: { type: 'string', description: 'Reader id; defaults to raw.' },
        run: { type: 'string', description: 'An existing run id to append this observation to. Omitted, the observation opens a run of its own.' },
        judge: { type: 'array', items: { type: 'string' }, description: 'Rule ids (or id@version) for HimaJudge to rule on this observation. Verdicts are written by the judge, never by this tool.' },
        params: {
          type: 'object',
          additionalProperties: true,
          description: 'Named values for any parameter a rule in `judge` declares, e.g. { "target_period_ns": 2.3 }. Every value must be a finite number; a non-numeric value is rejected, never silently dropped. A declared parameter with no matching entry here leaves that rule UNDETERMINED.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['observed', 'refused'] },
            runId: { type: 'string', required: true },
            recordId: { type: 'string', required: true },
            contentSha256: { type: 'string' },
            bytes: { type: 'integer' },
            reason: { type: 'string' },
            verdicts: {
              type: 'array',
              description: 'One entry per requested rule; absent when no rules were asked for.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  outcome: { type: 'string', required: true, enum: ['PASS', 'FAIL', 'UNDETERMINED'] },
                  ruleId: { type: 'string', required: true },
                  ruleVersion: { type: 'string', required: true },
                  recordId: { type: 'string', required: true },
                  cites: { type: 'array', required: true, items: { type: 'string' } },
                  reason: { type: 'string' },
                  boundParameters: { type: 'object', additionalProperties: true, description: 'The value bound to each parameter this rule declared, when it declared one.' },
                },
              },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args) => {
        // Validated before anything is read: a bad `params` entry must leave no observation and
        // no verdict behind, the same as a malformed `--param` on the command line.
        const parsedParams = numericParams(args.params as Record<string, unknown> | undefined);
        if ('error' in parsedParams) throw new Error(parsedParams.error);
        const result = await observe(deps, args as ObserveRequest);
        const value = toolResult(result);
        if (result.kind === 'observed' && args.judge?.length) {
          value.verdicts = (await deps.judge.evaluate({ runId: result.run.id, ruleIds: args.judge, params: parsedParams.params })).map(verdictToolValue);
        }
        return value;
      },
    }),
    defineTool({
      name: 'hima_run',
      description: 'Start a Campaign of a HimaPack on a named Site toward a Goal, and let HimaFabric execute the pack\'s graph: launch the tool as a Job in the Campaign workspace, read what it produced into the HimaLedger, judge it, choose the next strategy, and end. Answers when the run stops. The verdicts are HimaJudge\'s and the next strategy is the pack\'s chooser: this tool decides neither.',
      parameters: {
        pack: { type: 'string', required: true, description: 'Pack id, as the packs directory holds it.' },
        site: { type: 'string', required: true, description: 'Site name, as in the site file.' },
        goal: {
          type: 'object',
          required: true,
          additionalProperties: true,
          description: 'The Goal as named numbers, e.g. { "target_period_ns": 2.3 }. Every value must be a finite number. Immutable for the run: a new goal is a new campaign.',
        },
        strategy: {
          type: 'object',
          additionalProperties: true,
          description: 'What to set the pack\'s own strategy knobs to for the first generation, by the names its contract declares, e.g. { "<knob>": <value> }. A knob left out takes the default that pack declares; a knob it does not declare, or a value outside the bounds or the list it declares, is refused and no run is started.',
        },
        timeBox: { type: 'number', description: 'The time box in minutes. Omitted, sixty.' },
        retries: { type: 'integer', description: 'The retry allowance per node per generation. Omitted, three.' },
        generations: { type: 'integer', description: "How many generations this campaign's loop may open. Omitted, the pack's own limit, then six." },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['ran', 'unfit', 'unprepared'] },
            runId: { type: 'string' },
            campaignId: { type: 'string' },
            status: { type: 'string' },
            currentNode: { type: 'string' },
            strategy: { type: 'object', additionalProperties: true, description: 'The strategy the run now stands at: the next one to try, or the one that met the goal.' },
            reason: { type: 'string', description: 'Why the run could not start, on an unfit pack or a workspace that is not this campaign\'s.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args) => {
        const goal = numericParams(args.goal as Record<string, unknown> | undefined);
        if ('error' in goal) throw new Error(goal.error);
        // The same checks the command face and the route make, from the same tables: a tool call is
        // a caller like any other, and a time box no person could type must not be one a model can.
        const timeBox = toolNumber('timeBox', args.timeBox);
        const result = await startRun(deps, {
          pack: args.pack,
          site: args.site,
          goal: goal.params,
          strategy: strategyArgument(args.strategy),
          timeBoxMs: timeBox === undefined ? undefined : Math.round(timeBox * 60_000),
          retryAllowance: toolNumber('retries', args.retries),
          generationLimit: toolNumber('generations', args.generations),
        });
        return runToolValue(result);
      },
    }),
    // The resume face as a tool, beside the run face: a waiting Run is cleared the same way from
    // an agent as from the command line.
    defineTool({
      name: 'hima_resume',
      description: 'Clear a waiting HimaHarness run and carry it on: re-enter the node its blocker names with a fresh retry allowance, and let HimaFabric execute the rest of the pack\'s graph. Only a run that is waiting can be resumed; a running or ended run is answered and nothing is written. The resume is recorded in the HimaLedger as a person\'s action.',
      parameters: {
        run: { type: 'string', required: true, description: 'The run id to resume, as /hima status names it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['resumed', 'not-waiting', 'unresumable'] },
            runId: { type: 'string', required: true },
            status: { type: 'string' },
            currentNode: { type: 'string' },
            nodeId: { type: 'string', description: 'The node the run was re-entered at.' },
            recordId: { type: 'string', description: 'The `resumed` record this action wrote.' },
            reason: { type: 'string', description: 'Why nothing was resumed and nothing written.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      // The calling agent's session is who the ledger records; a call arriving without one is
      // the workbench's, as the resume route's is.
      execute: async (args, exec) => resumeToolValue(await resumeRun(deps, { runId: args.run, who: exec.agent === undefined ? 'workbench' : String(exec.agent.id) })),
    }),
    defineTool({
      name: 'hima_cancel',
      description: 'Stop a Run: kill the Job it has open on its Site, wait for the session to be observed gone, and end the Run as cancelled. A Run is not cancelled until the stop is observed, so a kill that does not take answers that nothing was stopped rather than claiming it was. Cancelling a Run that already ended answers with its status and writes nothing.',
      parameters: {
        run: { type: 'string', required: true, description: 'The run id to stop, as /hima run or /hima status names it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: ['cancelled', 'ended', 'not-started', 'not-stopped'] },
            runId: { type: 'string', required: true },
            status: { type: 'string', description: 'The run\'s status now: `cancelled` when this call ended it.' },
            stoppedSession: { type: 'string', description: 'The tmux session that was stopped, or the one still there on `not-stopped`.' },
            recordId: { type: 'string', description: 'The killed job record the observed stop was written as.' },
            reason: { type: 'string', description: 'Why nothing was stopped, when nothing was.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args) => cancelToolValue(await cancelRun(deps, args.run)),
    }),
  ];
}
