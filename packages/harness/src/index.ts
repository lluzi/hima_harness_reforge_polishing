// @hima-seam agent wrapped
// @hima-seam plugin-module direct
// @hima-seam commands direct
// @hima-seam tools direct
// @hima-seam skills direct
// @hima-seam storage-domain direct
// HimaHarness core plugin: the bundle's entry row on a DeepSeek Harness host. One reason to change:
// what this bundle contributes to a host and what it hands back.
//
// It opens the ledger, makes HimaJudge the one holder of the verdict-writer capability, mounts the
// Hima namespace where a browser surface is composed, puts the `/hima` command, the `hima_*` tools
// and the pack authoring pipeline's five skills on the host as effects that unwind when the plugin
// unloads, and picks up the Runs the last process left in flight. What those faces say is `commands.ts` and `tools.ts`; what the operations do is
// their own modules. Nothing here decides anything: every method below is one of those operations
// with this host's dependencies handed to it.
//
// It is also the bundle's surface: everything a caller outside `packages/harness/src` imports from
// `@hima/harness` is exported or re-exported here, whichever module it now lives in.
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
// Type-only: these take the `ctx.commands` and `ctx.tools` declaration merges the registrations below
// stand on. What is registered is built in the two face modules, which face those seams themselves.
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-commands';
import { Ledger, ledgerSpec } from './ledger.js';
import { observe, type ObserveRequest, type ObserveResult } from './observe.js';
import { resumeRun, startRun, type FabricDeps, type ResumeResult, type StartRunRequest, type StartRunResult } from './fabric.js';
import { drainExecutionObservers, reconcileExecutionIntents, executionAction, executionContext, type ExecutionActionRequest, type ExecutionActionResult, type ExecutionContext } from './fabric.js';
import { cancelRun, reconcileRuns, type CancelResult, type ReconcileOutcome } from './recovery.js';
import { readExperience, type ReadExperienceResult } from './experience.js';
import { handleHimaCommand, himaCommandDescription } from './commands.js';
import { himaTools } from './tools.js';
import { createJudge, type Judge } from './judge.js';
import { registerHimaRoutes } from './remote.js';
import { checkPack, loadPack, goalDeclarationOf, packWords, runPackWords, installedPacks } from './packs.js';
import { installedSites, loadSite } from './sites.js';
import { momentOnCurrentNode, type MomentOnNode } from './moments.js';
import { installedPackStages } from './packs.js';
import { registerHimaSkills } from './skills.js';
import { openAuthoringSession, registerAuthoringGuard } from './authoring.js';
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
export { loadPack, installedPacks, checkPack, flowDirName, workspaceFileName, packFiles, toolArgv, outputPath, boundInputs, strategyKnobsOf, resolveRule, resolveChooser, packReadersDir, packKnowledgeDir } from './packs.js';
export type { Pack, PackContract, PackGraph, PackNode, PackEdge, PackTool, PackWorkshop, ContractOutput, PackCheck, ChooserCheck, KnowledgeCheck, WorkshopCheck, PackDataAt } from './packs.js';
// The workshop (#62): the act node where the AI writes a script inside its declared directory and the
// fabric runs it. On the surface because the contract suite asserts which three tools a workshop's
// moment reaches and the live check opens one against the real model route.
export { workshopArgv, readersDirName } from './packs.js';
export { WORKSHOP_WRITE_TOOL, WORKSHOP_READ_TOOL, WORKSHOP_KNOWLEDGE_TOOL, WORKSHOP_READ_CAP } from './workshop.js';
// How far up the pack authoring pipeline a folder has come (#63). On the surface because the pack
// check reports it, the `/hima pack check` words print it, and the contract suite holds a folder the
// pipeline authored against the sections the two stages are required to write.
export { packStage, packStageOf, installedPackStages, isUnreadablePackFolder, pipelineFiles, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS } from './packs.js';
export type { PackStage, PackStageName, PackStageOrRefusal, UnreadablePackFolder } from './packs.js';
// The three rungs #64 made real: what the fabric and test records must hold, what a pack folder
// hashes to, the seal a release writes over it, and the release itself. On the surface because the
// contract suite holds an authored folder against the sections its stages are required to write, the
// release verb is reached through the command face and the tool face alike, and the acceptance and
// live-check scripts read a sealed folder back.
export { HIMA_FABRIC_SECTIONS, HIMA_TEST_SECTIONS, checkTestRecord, runNamedByTestRecord, withTestRecord } from './packs.js';
export type { ReleaseDeps, RunLookup, RunRecordSeen, TestRecordCheck, TestRecordRun } from './packs.js';
// The one reading of a pack folder every answer about that folder is derived from (#64), and the two
// things derived from it that a caller outside this bundle asks for: what a Campaign of a folder ran,
// and which of its files a digest leaves out. On the surface because the contract suite holds an
// authored folder's digest to the rule it states itself, and the live check reads one back.
// `heldToOneInode` is on it for one reason, written down where the test that uses it is: it is the
// one rule of that reading no arrangement of the filesystem can stage from a second call of this
// process, so the suite holds the comparison itself rather than a race it cannot win.
export { heldToOneInode, packDigestExcludes, packDigestOf, snapshotPackFolder } from './pack-folder.js';
export type { PackFolderSnapshot } from './pack-folder.js';
// The release (#64): the seal a tested folder is versioned with, the verb that writes one, and the
// check that holds a folder against one. On the surface because the release verb is reached through
// the command face and the tool face alike, and the acceptance and live-check scripts read a sealed
// folder back.
export { exportPackMethod, installPackMethod, loadRunPack, packVersionFile, preservePackMethod, releaseIssue, releasePack } from './release.js';
export type { PackVersionFile, ReleaseResult } from './release.js';
// The pack authoring pipeline's five skills (#63): what the bundle puts on a host, and where their
// bodies and the authoring knowledge they cite live. On the surface because the contract suite holds
// the registered row against them and the live check invokes two of the stages by name.
export { himaSkillProvider, himaSkillsDir, registerHimaSkills, HIMA_SKILLS, HIMA_SKILL_PROVIDER, HIMA_KNOWLEDGE_FILES, HIMA_PACK_ANATOMY_FILE } from './skills.js';
export type { HimaSkillName } from './skills.js';
// The tools the authoring guard holds an authoring session to (#63), and which a Model moment
// refuses by name (D48). Only the classification is on the surface, and only because the contract
// suite holds it against a booted host's own tool list — the rule itself is plugin wiring, registered
// below and reached through no export.
export { FILE_WRITING_TOOLS, SHELL_TOOL, GOVERNED_TOOLS } from './authoring.js';
// Where an id a pack names resolves from (#57): the pack's own folder first, the bundle's second.
// On the surface because the check reports it, the decision record carries it, and the boundary
// between the two is what this bundle's callers need to be able to say.
export { packDataDirs } from './pack-data.js';
export { prepareWorkspace, campaignIdFor, containerNameFor, campaignIdIssue, workspaceFile } from './workspace.js';
export type { PrepareRequest, PrepareResult, WorkspaceFile } from './workspace.js';

// HimaFabric and the choosers an Explore node picks a next strategy with: part of the surface
// because the acceptance script and the contract suite start runs the same way the faces do.
export { versionLine, packStageSaid } from './commands.js';
export { startRun, resumeRun, executionAction, executionContext } from './fabric.js';
export { cancelRun, reconcileRuns } from './recovery.js';
// Model moments (#59): the one generic element a model needs, on the surface because the contract
// suite and the live check both open one, and because the acceptance record names the preset.
export { openMoment, momentOnCurrentNode, closeInterruptedMoments, openMomentsIn, nextMomentAttempt, HIMA_MOMENT_PRESET } from './moments.js';
export type { Moment, MomentDeps, MomentRequest, MomentTurn, MomentOnNode } from './moments.js';
export { MomentTurnError, NoCurrentNodeError } from './errors.js';
export { writeExperience, readExperience } from './experience.js';
export type { WriteExperienceResult, ReadExperienceResult } from './experience.js';
// `attemptOfSession` is exported for the one thing that cannot be shown through a face: which
// attempt a Job belongs to when the host that launched it died before the node record naming its
// session was written. The contract suite asserts that reading at the ledger object (#62).
export { defaultTimeBoxMs, defaultRetryAllowance, attemptOfSession } from './budget.js';
export type { FabricDeps, StartRunRequest, StartRunResult, ResumeResult, ExecutionActionRequest, ExecutionActionResult, ExecutionContext } from './fabric.js';
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
  MomentAnswer,
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
export { hasEnded, runIdPattern, importLegacyLedger } from './ledger.js';
export type { LegacyLedgerImportReceipt } from './ledger.js';
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
  SessionRecord,
  CodeRecord,
  MomentOutcome,
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
  PackDataOrigin,
  RunPurpose,
  RunStatus,
  RunBudget,
  RunStrategy,
  RunMeters,
} from './ledger.js';
// The Job poll's cadence — its two intervals and how long the fast one lasts — on the surface for
// the reason `jobs.ts` states: a test that holds a Site unreadable and asserts the waiter kept asking
// must hold it for longer than one of them, and an interval spelled out again in the test goes stale
// the day this one is tuned (#18). A test that has to act **between** two looks needs the third for
// the same reason: how long it has is which interval the waiter has settled into (#61).
export { jobPollFastForMs, jobPollFastMs, jobPollSlowMs } from './jobs.js';
export { launchJob, reconcileLaunchIntent, jobStatus } from './jobs.js';
export type { LaunchIntent, JobDeps, LaunchRequest, LaunchResult, ReconciledLaunch } from './jobs.js';
export { claimSlotAndLaunch } from './job-cap.js';
export { toolNode, observeNode, resumeNode, buildWorkshopScope, resolveWorkshop, launchWrittenWorkshop, exploreRecommendation } from './node-turns.js';
export type { Driving, ResolvedWorkshop, ExploreRecommendation } from './node-turns.js';
export { writeIntoWorkshop, readForWorkshop, knowledgeForWorkshop } from './workshop.js';
export type { WorkshopScope, WriteAnswer, ReadAnswer, KnowledgeAnswer } from './workshop.js';
export type { JobState, KillOutcome } from './jobs.js';
export type { AnalysisMode, PathScope, SemanticDeclaration, Semantics, SemanticsFile, SemanticValue } from './semantics.js';
// The value types a reading is held to, and the one validator every reader's output passes through
// (#61): on the surface because a pack's own `semantics.yml` decides what a Campaign may measure, and
// a caller composing or checking one needs the same reading of it the harness does.
// And the two shapes a reader's output meets at that one gate (#61): the envelope a pack script
// writes, and one typed value in it. On the surface for one reason, and only since #64: the
// reference file the fabric stage is told to write its readers from shows an example of each, and
// the suite holds that example to these very schemas rather than to a second spelling of them.
export { bundleSemantics, readingDocument, readSemanticsFile, resolveSemantics, semanticsFileName, semanticValue, shippedSemanticsFile, validateReading } from './semantics.js';
// The readers this bundle ships, as declarations: one of the two places a reader can come from since
// #61, and what a pack author composing a contract chooses between.
export { bundledReaders } from './readers.js';
// **The one gate between a reader and HimaLedger** (#61): the function both paths into an
// observation go through, which parses every value, holds it against the semantics in force and
// writes one record — an observation or a refusal, never half of either.
//
// On the surface because it is the *narrow* door onto a wide one that is already there: a caller
// holding `ctx.hima.ledger` can append an observation with no check at all, and a stored record that
// does not match its schema is a ledger the next host cannot open. Nothing about a reading should
// ever be written any other way, and a door nobody can reach is not the one that gets used.
export { appendReading } from './observe.js';
export type { AppendedReading, Reading } from './observe.js';

export interface Config {
  /** Directory holding one `<site>.yml` per Site, each naming its Permit file. */
  sitesDir: string;
  /** Directory holding one directory per installed HimaPack, named by the pack's id. */
  packsDir: string;
}

export default class Hima extends Service {
  static inject = ['storageDomain', 'commands', 'tools', 'skills'];
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
  private notificationsActive = false;
  private readonly factStop = new AbortController();

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'hima');
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(ledgerSpec);
    this.ledger = new Ledger(domain);
    this.ctx.effect(() => { this.notificationsActive = true; return () => { this.notificationsActive = false; }; });
    // The judge takes the ledger's one verdict-writer capability here; nothing else can obtain it.
    this.judge = createJudge(this.ledger, this.config.packsDir);
    this.ctx.effect(() => async () => {
      this.notificationsActive = false;
      this.factStop.abort();
      await drainExecutionObservers(this.ledger);
      await this.reconciled?.catch(() => undefined);
      await domain.close();
    });
    // The HimaGuide face: the Hima namespace, mounted only where a browser surface is composed.
    // A headless host has no web server and no browser session to guard it with, and still works.
    this.ctx.inject(['webServer', 'connection'], (webCtx) => {
      webCtx.effect(
        () => registerHimaRoutes(webCtx, {
          ledger: this.ledger,
          validateSession: (id) => this.ctx.get('agents')?.list().some((agent) => String(agent.id) === id) === true,
          executionContext: (runId) => this.executionContext(runId),
          executionAction: (request) => this.executionAction(request),
          observe: (req) => this.observe(req),
          judge: (runId, ruleIds, params) => this.judge.evaluate({ runId, ruleIds, params }),
          startRun: (req) => this.startRun(req),
          resumeRun: (runId, who) => this.resumeRun(runId, who),
          cancelRun: (runId) => this.cancelRun(runId),
          readExperience: (runId) => this.readExperience(runId),
          // The one operation of this namespace that reaches dsh's agent seam, and the only one
          // that needs the host itself rather than the ledger: a moment is composed out of this
          // context (#59). Handed in like every other operation, so `remote.ts` stays a module a
          // browser bundle can read the types of.
          openMoment: (runId, instructions) => this.openMoment(runId, instructions),
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
          // Historical labels belong to the Run's method identity, even after an installed upgrade.
          runWords: (run) => {
            try { return runPackWords(this.config.packsDir, run); }
            catch { return undefined; }
          },
          startPreparation: (packId, siteName) => {
            let pack;
            try { pack = loadPack(this.config.packsDir, packId); }
            catch (err) {
              return { preparation: { kind: 'pack', message: `Pack owner: repair Pack ${packId} files: ${err instanceof Error ? err.message : String(err)}` } };
            }
            const fields = { goal: goalDeclarationOf(pack), strategy: pack.contract.strategy, words: packWords(pack) };
            if (siteName === undefined) return fields;
            let site;
            try { site = loadSite(this.config.sitesDir, siteName); }
            catch (err) {
              return { ...fields, preparation: { kind: 'site', message: `Site owner: repair configuration for ${siteName}: ${err instanceof Error ? err.message : String(err)}` } };
            }
            // Only local declarations are read. Fabric rechecks them when a Run is actually started.
            return { ...fields, check: checkPack(pack, site) };
          },
          packStages: () => installedPackStages(this.config.packsDir),
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
    for (const tool of himaTools(this.deps(), (request, agent) => openAuthoringSession(this.ctx, this.config.packsDir, request, agent))) this.ctx.effect(() => this.ctx.tools.register(tool));
    // And the pack authoring pipeline's five stages, from the bundle's own skills directory (#63).
    // A person invokes one by typing its name; the model never chooses one for itself, because a
    // stage is a person's decision about their own pack folder.
    this.ctx.effect(() => registerHimaSkills(this.ctx), 'hima: the pack authoring pipeline\'s skills');
    // And the rule those stages are actually held to, rather than told (#63). A session standing in
    // a folder under `packsDir` is an authoring session of that folder: it writes nowhere else and
    // has no shell. Registered on this context, so it applies to every agent, and as an effect, so
    // it unwinds with the plugin. `authoring.ts` says why this is a guard and not a longer skill
    // body, and why dsh's own file sandbox is not this rule.
    this.ctx.effect(() => registerAuthoringGuard(this.ctx, this.config.packsDir), 'hima: the pack authoring guard');
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

  executionContext(runId: string): ExecutionContext { return executionContext(this.deps(), runId); }

  executionAction(request: ExecutionActionRequest): Promise<ExecutionActionResult> { return executionAction(this.deps(), request); }

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

  /**
   * Open one Model moment on the node a Run stands at, ask it one turn, and close it (#59).
   *
   * The one operation here that is handed this host's `ctx` rather than `deps()`: a moment is an
   * isolated dsh session, and composing one takes the context the bundle was applied with. Every
   * other operation is given the ledger and where things are installed, and reaches no host at all.
   */
  openMoment(runId: string, instructions: string): Promise<MomentOnNode> {
    return momentOnCurrentNode({ ledger: this.ledger, ctx: this.ctx }, runId, instructions);
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
      // The host a workshop's Model moment is composed on (#62). The one thing here that is not a
      // file or a record, handed in for the same reason the moment route is handed `openMoment`: a
      // moment is composed out of this context, and every other operation reaches no host at all.
      host: this.ctx,
      stopSignal: this.factStop.signal,
      beforeSlotClaim: (siteName) => reconcileExecutionIntents(this.deps(), siteName),
      log: (line) => this.ctx.logger.info(line),
      notify: (owner, runId, executionId) => {
        if (!this.notificationsActive || (process.env.NODE_TEST_CONTEXT !== undefined && process.env.HIMA_TEST_SILENT_AGENT === '1')) return;
        const agent = this.ctx.get('agents')?.list().find((item) => String(item.id) === owner);
        if (!agent) return;
        agent.followup(createUserMessage({ source: { kind: 'plugin', plugin: 'hima' }, content: [{ type: 'text', text: `Hima recorded new execution facts for Run ${runId}, execution ${executionId}. Read hima_context to inspect the actual Job and evidence. You remain this Run's conversational owner. Respect pause and user instructions; this notification grants no new authority or budget.` }] }));
      },
    };
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    hima: Hima;
  }
}

export { goalFrom, numericValue, strategyFrom, strategyValue, literalArgument } from './run-arguments.js';
export type { GoalDeclaration, GoalParameter } from './run-arguments.js';
export { goalDeclarationOf } from './packs.js';
