// @hima-seam plugin-module direct
// @hima-seam commands direct
// @hima-seam tools direct
// @hima-seam storage-domain direct
// HimaHarness core plugin: the bundle's entry row on a DeepSeek Harness host. One reason to change:
// what this bundle contributes to a host and what it hands back.
//
// It opens the ledger, makes HimaJudge the one holder of the verdict-writer capability, mounts the
// Hima namespace where a browser surface is composed, puts the `/hima` command and the `hima_*` tools
// on the host as effects that unwind when the plugin unloads, and picks up the Runs the last process
// left in flight. What those faces say is `commands.ts` and `tools.ts`; what the operations do is
// their own modules. Nothing here decides anything: every method below is one of those operations
// with this host's dependencies handed to it.
//
// It is also the bundle's surface: everything a caller outside `packages/harness/src` imports from
// `@hima/harness` is exported or re-exported here, whichever module it now lives in.
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
// Type-only: these take the `ctx.commands` and `ctx.tools` declaration merges the registrations below
// stand on. What is registered is built in the two face modules, which face those seams themselves.
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-commands';
import { Ledger, ledgerSpec } from './ledger.js';
import { observe, type ObserveRequest, type ObserveResult } from './observe.js';
import { resumeRun, startRun, type FabricDeps, type ResumeResult, type StartRunRequest, type StartRunResult } from './fabric.js';
import { cancelRun, reconcileRuns, type CancelResult, type ReconcileOutcome } from './recovery.js';
import { readExperience, type ReadExperienceResult } from './experience.js';
import { handleHimaCommand, himaCommandDescription } from './commands.js';
import { himaTools } from './tools.js';
import { createJudge, type Judge } from './judge.js';
import { registerHimaRoutes } from './remote.js';
import { installedPackStrategy, installedPackWords, installedPacks } from './packs.js';
import { installedSites } from './sites.js';
// The audit the routes answer with: the module-level pair every channel in this process records into.
import { clearRemoteCommands, remoteCommands, remoteCommandWindowFilled } from './channel.js';

// The Site-facing pieces are part of the bundle's surface: an operator inspects a Site's warm channel
// and the commands it has run, and the contract suite reads both.
export { channelFor, controlPathFor, remoteCommands, clearRemoteCommands, remoteCommandWindow, remoteCommandWindowFilled, readOnlyProbes, jobPlumbing, workspacePlumbing, quote, LocalChannel, SshChannel } from './channel.js';
export type { Channel, ExecResult, ExecOptions, RemoteCommand } from './channel.js';
export { loadSite, installedSites } from './sites.js';
export type { Site, SshTarget, Permit } from './sites.js';

// A HimaPack is data, and reading it is part of the bundle's surface: an operator inspects a pack
// against a Site before starting a Campaign, and the contract suite reads the same answer.
export { loadPack, installedPacks, checkPack, flowDirName, workspaceFileName, packFiles, toolArgv, outputPath, boundInputs, strategyKnobsOf } from './packs.js';
export type { Pack, PackContract, PackGraph, PackNode, PackEdge, PackTool, ContractOutput, PackCheck, ChooserCheck } from './packs.js';
export { prepareWorkspace, campaignIdFor, containerNameFor, campaignIdIssue, workspaceFile } from './workspace.js';
export type { PrepareRequest, PrepareResult, WorkspaceFile } from './workspace.js';

// HimaFabric and the choosers an Explore node picks a next strategy with: part of the surface
// because the acceptance script and the contract suite start runs the same way the faces do.
export { versionLine } from './commands.js';
export { startRun, resumeRun } from './fabric.js';
export { cancelRun, reconcileRuns } from './recovery.js';
export { writeExperience, readExperience } from './experience.js';
export type { WriteExperienceResult, ReadExperienceResult } from './experience.js';
export { defaultTimeBoxMs, defaultRetryAllowance } from './budget.js';
export type { FabricDeps, StartRunRequest, StartRunResult, ResumeResult } from './fabric.js';
export type { CancelResult, ReconcileOutcome } from './recovery.js';
export { runArguments, allowsRunArgument, badRunArgument, notWaitingToResume, unresumableReason } from './run-arguments.js';
export type { RunArgumentName } from './run-arguments.js';
// What a Strategy's knobs may be, and the one sentence every face refuses a value in (#58): the
// contract suite and the acceptance script hold the window's words against these, exactly as they
// hold a refused period against `badRunArgument`.
export { badStrategyValue, unknownStrategyKnob } from './run-arguments.js';
export type { StrategyDeclaration, StrategyKnob, StrategyValue } from './run-arguments.js';
export { choose, loadChooser, roundNs, shippedChoosersDir } from './choosers.js';
export type { Chooser, ChooserClause, ChooserExpression, ChooserInput, ChooserRead, ChooserResult } from './choosers.js';

// The Hima remote interface's contract belongs to the bundle, not to whoever is talking to it:
// `remote.ts` states these shapes once, the browser module imports them from there, and every other
// caller — the contract tests, the acceptance script — takes them from here rather than retyping
// them by hand, where a drift in the host's answer would go unnoticed until a person read the JSON.
export { HIMA_API_PREFIX, HIMA_WORKBENCH_PATH } from './paths.js';
export type {
  HimaErrorCode,
  HimaErrorBody,
  ObservationView,
  RefusalView,
  Citation,
  VerdictView,
  NodeView,
  JobView,
  BlockerView,
  CancelView,
  DecisionView,
  RunHeadView,
  RunWord,
  RunWords,
  RunView,
  RecordsView,
  RecordView,
  AuditView,
  ObserveBody,
  StartRunBody,
  ExperienceView,
  ExperienceFileView,
  ExperienceAnswer,
} from './remote.js';

// The Campaign's technical report (#30): what it says, and how a face reads one back. On the surface
// because both mounts of the card compose it from a run view, the acceptance script reads a report
// off the Site and holds it against the record, and the contract suite asserts on the machine's file
// — one description of what an experience is, read by all three.
export { experienceReport, endingReason, reportBlocks, EXPERIENCE_SCHEMA, EXPERIENCE_DIR } from './experience-report.js';
export type { ExperienceJson, ExperienceReport, ExperienceEnding, ExperiencePack, ReportBlock } from './experience-report.js';

// The rows `RunView.generations` carries, stated by the module that folds them out of a Run's
// records rather than by the namespace that answers with them.
export type { GenerationView, GenerationVerdictView, GenerationState, GenerationJoinView, LoopView, BranchView, BranchState } from './generations.js';

// The words a drill-down Loop is said in, and what the card's loops region says of them all (#28).
// On the surface because both mounts of the card read them from here and the contract suite asserts
// on them: what a person sees of a nested Loop is said in one place, as every other word of the card
// is.
export { loopSaid, loopOpenedSaid, loopClosedSaid, loopsIn, loopsState, loopOutcomeLabel, LOOP_OPEN, LOOP_NOT_CLOSED } from './card-labels.js';

// The generation ledger's rows in the order both mounts show them, and the line the card says that
// order in (#28b). On the surface for the reason the words above are: the two mounts render from
// this one walk, and a test asserting on the order a person reads asserts on the same list.
export { ledgerRows, LEDGER_ORDER } from './card-labels.js';
export type { LedgerRow, LedgerGenerationRow, LedgerBracketRow, LedgerBranchRow, LedgerJoinRow } from './card-labels.js';

// The words one branch of a fork is said in, what its row shows of it, what the join concluded over
// them all, and what the card's branches region says (#29). On the surface for the reason the Loop's
// are: both mounts of the card read them from here and the contract suite asserts on them.
export { branchSaid, branchJobsSaid, branchLines, branchesIn, branchesState, branchStateLabel, joinSaid, FORK_RULE } from './card-labels.js';

// The Budget's meters as a face shows them: every meter against the bound the Run was started under
// (#27). On the surface because they are read off a run view — the card's own region, `/hima status`,
// and the contract suite, which asserts on what the route answered rather than on a rendering of it.
export { metersState, meterLines, endedByLabel } from './card-labels.js';
export type { MeteredRun } from './card-labels.js';

// What the ledger holds, for a caller reading records back through the namespace. `hasEnded` is the
// one predicate over a Run's status every face shares: what counts as an ending is the ledger's to
// say, not each caller's.
export { hasEnded } from './ledger.js';
export type {
  LedgerRecord,
  ObservationRecord,
  RefusalRecord,
  VerdictRecord,
  JobRecord,
  WorkspaceRecord,
  NodeRecord,
  BlockerRecord,
  ResumedRecord,
  DecisionRecord,
  CancelRecord,
  LoopRecord,
  ExperienceRecord,
  ExperienceFile,
  LoopOutcome,
  RunLoop,
  RunFork,
  RunBranch,
  JobIdentity,
  RunRecord,
  ReaderRef,
  NodeKind,
  NodeState,
  DecisionChoice,
  RunStatus,
  RunBudget,
  RunStrategy,
  RunMeters,
} from './ledger.js';
// The Job poll's two intervals, on the surface for the reason `jobs.ts` states: a test that holds a
// Site unreadable and asserts the waiter kept asking must hold it for longer than one of them, and
// an interval spelled out again in the test goes stale the day this one is tuned (#18).
export { jobPollFastMs, jobPollSlowMs } from './jobs.js';
export type { JobState, KillOutcome } from './jobs.js';
export type { SemanticValue, SemanticValueType, SemanticUnit } from './semantics.js';

export interface Config {
  /** Directory holding one `<site>.yml` per Site, each naming its Permit file. */
  sitesDir: string;
  /** Directory holding one directory per installed HimaPack, named by the pack's id. */
  packsDir: string;
}

export default class Hima extends Service {
  static inject = ['storageDomain', 'commands', 'tools'];
  static Config = z.object({ sitesDir: z.string().required(), packsDir: z.string().required() });

  ledger!: Ledger;
  judge!: Judge;
  /**
   * The reconciliation this host started when it opened the ledger: every Run the last process left
   * in flight, picked up again and carried on. It is a promise rather than an awaited step of
   * initialisation because a Run resumed here waits for a Job that may have an hour of synthesis left
   * in it, and a workbench that would not serve until then is a workbench nobody could cancel from.
   * It never rejects — a Run this machine cannot rebuild is reported, not thrown.
   */
  reconciled!: Promise<ReconcileOutcome[]>;

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'hima');
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(ledgerSpec);
    this.ledger = new Ledger(domain);
    // The judge takes the ledger's one verdict-writer capability here; nothing else can obtain it.
    this.judge = createJudge(this.ledger);
    this.ctx.effect(() => () => domain.close());
    // The HimaGuide face: the Hima namespace, mounted only where a browser surface is composed.
    // A headless host has no web server and no browser session to guard it with, and still works.
    this.ctx.inject(['webServer', 'connection'], (webCtx) => {
      webCtx.effect(
        () => registerHimaRoutes(webCtx, {
          ledger: this.ledger,
          observe: (req) => this.observe(req),
          judge: (runId, ruleIds, params) => this.judge.evaluate({ runId, ruleIds, params }),
          startRun: (req) => this.startRun(req),
          resumeRun: (runId, who) => this.resumeRun(runId, who),
          cancelRun: (runId) => this.cancelRun(runId),
          readExperience: (runId) => this.readExperience(runId),
          // The audit is this process's, so it is read here and not handed in: `remoteCommands` and
          // `clearRemoteCommands` are the module-level pair `channel.ts` keeps, and the drain reads
          // and clears with nothing awaited between the two, so no command can be sent unrecorded in
          // the gap.
          remoteCommandAudit: () => ({ commands: remoteCommands(), windowFilled: remoteCommandWindowFilled() }),
          drainRemoteCommandAudit: () => {
            const answer = { commands: remoteCommands(), windowFilled: remoteCommandWindowFilled() };
            clearRemoteCommands();
            return answer;
          },
          // Read each time the page is rendered rather than once at boot: a pack or a Site installed
          // while the window is open is one the form offers on the next look, and neither directory
          // is big enough for that to be worth caching against a person reloading a page.
          installed: () => ({ packs: installedPacks(this.config.packsDir), sites: installedSites(this.config.sitesDir) }),
          // And what the Run's own pack calls its numbers (#42), read the same way and for the same
          // reason: a pack is a directory, the namespace opens none, and words corrected while a
          // window is open are the words the next render says.
          packWords: (packId) => installedPackWords(this.config.packsDir, packId),
          // And the knobs it declares its Strategy to be made of (#58), read the same way and for
          // the same reason: the start form renders one field per knob, and a declaration corrected
          // while a window is open is the one the next look offers.
          packStrategy: (packId) => installedPackStrategy(this.config.packsDir, packId),
        }),
        'hima: /hima/api routes',
      );
    });
    // Registrations are effects: they unwind when the plugin unloads, the way dsh's own plugins do it.
    // What each face is, and what it answers, is `commands.ts` and `tools.ts`; what this row does is
    // put them on the host and take them off again.
    this.ctx.effect(() =>
      this.ctx.commands.register({
        name: 'hima',
        description: himaCommandDescription,
        handler: (inv) => handleHimaCommand(this.deps(), inv),
      }),
    );
    for (const tool of himaTools(this.deps())) this.ctx.effect(() => this.ctx.tools.register(tool));
    // Last, and deliberately not awaited: every Run the last process left in flight is picked up
    // again from the ledger and carried on. The host serves while that happens — a Run resumed here
    // may have an hour of synthesis still to wait for, and a workbench that would not answer until
    // then is one nobody could cancel from.
    this.reconciled = this.reconcile();
  }

  /** The reconciliation, wrapped so nothing it finds can keep a host from starting. */
  private async reconcile(): Promise<ReconcileOutcome[]> {
    let found: ReconcileOutcome[] = [];
    try {
      found = await reconcileRuns(this.deps());
    } catch (err) {
      // Only a fault outside any single Run reaches here — the ledger itself, or a host disposed
      // while a resumed Run was still being carried on. Logged, never thrown: the next host that
      // starts reconciles the same Runs again from the same records.
      this.ctx.logger.error(err);
    }
    for (const outcome of found) this.ctx.logger.info(`hima: reconciled ${outcome.runId}: ${outcome.detail}`);
    return found;
  }

  // The operations, as the service's own methods: what the routes are given, and what a caller
  // holding `ctx.hima` reaches. Each is the module operation with this host's dependencies handed
  // to it, and none of them decides anything of its own.

  observe(req: ObserveRequest): Promise<ObserveResult> {
    return observe(this.deps(), req);
  }

  startRun(request: StartRunRequest): Promise<StartRunResult> {
    return startRun(this.deps(), request);
  }

  resumeRun(runId: string, who: string): Promise<ResumeResult> {
    return resumeRun(this.deps(), { runId, who });
  }

  cancelRun(runId: string): Promise<CancelResult> {
    return cancelRun(this.deps(), runId);
  }

  /** Read a Campaign's technical report back off its Site, both files held against their hashes. */
  readExperience(runId: string): Promise<ReadExperienceResult> {
    return readExperience(this.deps(), runId);
  }

  /** What every Hima operation is given: this host's ledger and judge, where its Sites and packs
   *  are installed, and the host log. The log is for the one thing HimaFabric has to say that is not
   *  a record: a stretch of polls during which a Site could not be asked (#18). It goes there rather
   *  than to the ledger because it is a fact about a machine, and the same line is what tells an
   *  operator to go and look at it. */
  private deps(): FabricDeps {
    return {
      ledger: this.ledger,
      judge: this.judge,
      sitesDir: this.config.sitesDir,
      packsDir: this.config.packsDir,
      log: (line) => this.ctx.logger.info(line),
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    hima: Hima;
  }
}
