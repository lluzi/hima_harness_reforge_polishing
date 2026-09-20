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
import { createUserMessage, type MessageId } from '@deepseek-ai/dsh-llm';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
// Type-only: these take the `ctx.commands` and `ctx.tools` declaration merges the registrations below
// stand on. What is registered is built in the two face modules, which face those seams themselves.
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-commands';
import { hasEnded, Ledger, ledgerSpec } from './ledger.js';
import { observe, type ObserveRequest, type ObserveResult } from './observe.js';
import { convergeOf, newCampaignProposalId, resumeRun, startRun, type FabricDeps, type ResumeResult, type StartRunRequest, type StartRunResult } from './fabric.js';
import { defaultGenerationLimit, defaultRetryAllowance, defaultTimeBoxMs } from './budget.js';
import { drainExecutionObservers, reconcileExecutionIntents, executionAction, executionContext, type ExecutionActionRequest, type ExecutionActionResult, type ExecutionContext } from './fabric.js';
import { cancelRun, reconcileRuns, type CancelResult, type ReconcileOutcome } from './recovery.js';
import { readExperience, readMaterial, readRunAssets, readArchivedMaterial, type ReadExperienceResult, type ReadMaterialResult } from './experience.js';
import { handleHimaCommand, himaCommandDescription, versionLine } from './commands.js';
import { agentWorkspaceOf, himaTools } from './tools.js';
import { createJudge, type Judge } from './judge.js';
import { registerHimaRoutes, BadRequest, type LogTailView, type SiteDiscoverBody, type SiteHeadView } from './remote.js';
import { previewPackTransfer, applyPackTransfer } from './release.js';
import { packId as validPackId } from './pack-folder.js';
import { checkPack, loadPack, goalDeclarationOf, packWords, runPackWords, installedPacks, packOverview } from './packs.js';
import { strategyValue, strategyFrom, allowsRunArgument, badRunArgument, allowsTimeBoxMs, timeBoxMsBounds } from './run-arguments.js';
import { discoverSshSite, installedSites, loadSite, saveDiscoveredSite, siteDiscoveryRequestSchema, type Site, type SiteDiscoveryResult, type SshTarget } from './sites.js';
import { SshChannel, type Channel } from './channel.js';
import { nodeLogTail } from './jobs.js';
import { SiteUnreadableError } from './errors.js';
import { momentOnCurrentNode, type MomentOnNode } from './moments.js';
import { installedPackStages } from './packs.js';
import { registerHimaSkills } from './skills.js';
import { openAuthoringSession, registerAuthoringGuard } from './authoring.js';
import { campaignKnowledgeScope, currentKnowledgeDocumentCount } from './workshop.js';
// The audit the routes answer with: the module-level pair every channel in this process records into.
import { clearRemoteCommands, remoteCommands, remoteCommandWindowFilled } from './channel.js';
import type { PreparationView } from './workbench.js';
import {
  CampaignFileError, emptyCampaignFile, overridesOf, parseCampaignFile, readCampaignFile, serializeCampaignFile, writeCampaignFile,
  type CampaignFileReadResult, type CampaignFileWriteResult, type PreparationOverrides,
} from './campaign-file.js';

// The Site-facing pieces are part of the bundle's surface: an operator inspects a Site's warm channel
// and the commands it has run, and the contract suite reads both.
export { channelFor, controlPathFor, remoteCommands, clearRemoteCommands, remoteCommandWindow, remoteCommandWindowFilled, readOnlyProbes, siteDiscoveryProbes, discoverSiteFacts, jobPlumbing, workspacePlumbing, quote, LocalChannel, SshChannel } from './channel.js';
export type { Channel, ExecResult, ExecOptions, RemoteCommand, SiteDiscoveryFact } from './channel.js';
export { loadSite, installedSites, discoverSshSite, saveDiscoveredSite, discoveryIsStale } from './sites.js';
export type { Site, SshTarget, Permit, SiteDiscovery, SiteDiscoveryRequest, SiteDiscoveryResult } from './sites.js';

// A HimaPack is data, and reading it is part of the bundle's surface: an operator inspects a pack
// against a Site before starting a Campaign, and the contract suite reads the same answer.
export { loadPack, installedPacks, checkPack, packOverview, packKnowledgeManifestOf, packKnowledgeManifest, normalizePackAuthorStatus, harnessVersion, flowDirName, workspaceFileName, packFiles, toolArgv, outputPath, boundInputs, strategyKnobsOf, resolveRule, resolveChooser, packReadersDir, packKnowledgeDir, growthProposal, validateGrowthGraph, withGrowthGraphs, runGraphsOf } from './packs.js';
export type { Pack, PackContract, PackGraph, PackNode, PackEdge, PackTool, PackWorkshop, PackKnowledgeManifest, ContractOutput, PackCheck, PackOverview, PackAuthorStatus, ChooserCheck, KnowledgeCheck, WorkshopCheck, PackDataAt, GrowthProposal, GrowthGraph, GrowthGraphValidation } from './packs.js';
// The workshop (#62): the act node where the AI writes a script inside its declared directory and the
// fabric runs it. On the surface because the contract suite asserts which three tools a workshop's
// moment reaches and the live check opens one against the real model route.
export { workshopArgv, readersDirName } from './packs.js';
export { WORKSHOP_WRITE_TOOL, WORKSHOP_READ_TOOL, WORKSHOP_KNOWLEDGE_TOOL, WORKSHOP_READ_CAP, KNOWLEDGE_INDEX_SCHEMA, KNOWLEDGE_CHUNK_CHARS, KNOWLEDGE_SEARCH_LIMIT, KNOWLEDGE_SNIPPET_CHARS, KNOWLEDGE_READ_CAP, indexKnowledgeDocument, importCurrentKnowledge, listCurrentKnowledge, clearCurrentKnowledge, searchKnowledgeIndexes, searchCurrentKnowledge, readCurrentKnowledge, searchPackKnowledge, readPackKnowledge, recordDocumentKnowledgeRead } from './workshop.js';
export type { KnowledgeDocumentIdentity, KnowledgeDocumentChunk, KnowledgeDocumentIndex, KnowledgeSearchHit, KnowledgeSearchCandidate } from './workshop.js';
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
export { heldToOneInode, packDigestExcludes, packDigestOf, packTransferReceiptFile, snapshotPackFolder } from './pack-folder.js';
export type { PackFolderSnapshot } from './pack-folder.js';
// The release (#64): the seal a tested folder is versioned with, the verb that writes one, and the
// check that holds a folder against one. On the surface because the release verb is reached through
// the command face and the tool face alike, and the acceptance and live-check scripts read a sealed
// folder back.
export { exportPackMethod, installPackMethod, recoverPackMethod, previewPackTransfer, applyPackTransfer, loadRunPack, packMigrationReceipt, readPackMigrationReceipt, verifiedPackRelocation, packVersionFile, preservePackMethod, releaseIssue, releasePack } from './release.js';
export type { PackMigrationReceipt, PackTransferRequest, PackTransferReview } from './release.js';
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
export { prepareWorkspace, campaignIdFor, containerNameFor, campaignIdIssue, workspaceFile, applyWorkspaceRevision, materializeWorkshopRevision } from './workspace.js';
export type { PrepareRequest, PrepareResult, WorkspaceFile, WorkspaceRevisionChange, WorkspaceRevisionAsset } from './workspace.js';

// HimaFabric and the choosers an Explore node picks a next strategy with: part of the surface
// because the acceptance script and the contract suite start runs the same way the faces do.
export { versionLine, packStageSaid } from './commands.js';
export { startRun, resumeRun, executionAction, executionContext, revisionImpactOf, authenticCampaignProposalId } from './fabric.js';
export { cancelRun, reconcileRuns } from './recovery.js';
// Model moments (#59): the one generic element a model needs, on the surface because the contract
// suite and the live check both open one, and because the acceptance record names the preset.
export { openMoment, momentOnCurrentNode, closeInterruptedMoments, openMomentsIn, nextMomentAttempt, HIMA_MOMENT_PRESET } from './moments.js';
export type { Moment, MomentDeps, MomentRequest, MomentTurn, MomentOnNode } from './moments.js';
export { MomentTurnError, NoCurrentNodeError, SiteUnreadableError } from './errors.js';
export { writeExperience, readExperience, readMaterial, writeRunAssets, readRunAssets, readArchivedMaterial, listRunKnowledge, readRunKnowledge, HISTORY_SUMMARY_CAP, HISTORY_READ_CAP } from './experience.js';
export type { WriteExperienceResult, ReadExperienceResult, WriteRunAssetsResult, ReadRunAssetsResult, ReadArchivedMaterialResult, RunKnowledgeCandidate, RunKnowledgeList, ReadRunKnowledgeResult } from './experience.js';
export { RUN_ASSET_MANIFEST_SCHEMA } from './experience-report.js';
export type { RunAssetManifest, ExperienceAsset } from './experience-report.js';
// `attemptOfSession` is exported for the one thing that cannot be shown through a face: which
// attempt a Job belongs to when the host that launched it died before the node record naming its
// session was written. The contract suite asserts that reading at the ledger object (#62).
export { defaultTimeBoxMs, defaultRetryAllowance, defaultAttemptLimit, attemptOfSession, budgetStandingAt, budgetStanding, experimentBudgetSpentAt, experimentBudgetSpent, attemptLimitSpent, researchWriteTotals, reserveResearchWrite } from './budget.js';
export type { BudgetPhase, BudgetStanding, ResearchWriteRequest, ResearchWriteAdmission } from './budget.js';
export type { FabricDeps, StartRunRequest, StartRunResult, ResumeResult, ExecutionActionRequest, ExecutionActionResult, ExecutionContext, RevisionProposal } from './fabric.js';
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
export { HIMA_API_PREFIX, HIMA_WORKBENCH_PATH, HIMA_CAMPAIGN_FILE_PATH, HIMA_SITES_PATH } from './paths.js';
export { pickOwnedRun, isOwner, recordEndedSeenAt } from './run-ownership.js';
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
  CampaignFileView,
  SiteHeadView,
  SiteDiscoverBody,
  LogTailView,
} from './remote.js';

// The Campaign's technical report (#30): what it says, and how a face reads one back. On the surface
// because both mounts of the card compose it from a run view, the acceptance script reads a report
// off the Site and holds it against the record, and the contract suite asserts on the machine's file
// — one description of what an experience is, read by all three.
export { experienceReport, endingReason, reportBlocks, EXPERIENCE_SCHEMA, EXPERIENCE_DIR } from './experience-report.js';
export type { ExperienceJson, ExperienceReport, ExperienceEnding, ExperiencePack, ReportBlock } from './experience-report.js';

// The rows `RunView.generations` carries, stated by the module that folds them out of a Run's
// records rather than by the namespace that answers with them.
export type { GenerationView, GenerationVerdictView, GenerationState, GenerationJoinView, LoopView, BranchView, BranchState, GrowthBranchView, RevisionHistoryView } from './generations.js';

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
export { packAuthorStatusLabel, packOntologyLabel } from './card-labels.js';

// The Campaign tab's own words (#41 task 5): the Goal roundel while a Run is open, its seal once one
// has ended, and a node's own caption. On the surface for the reason every other word of the card is:
// `scene.ts` reads `nodeCaption` off here rather than saying a node's second line twice, and the
// contract suite asserts on the same three functions the canvas actually renders from.
export { goalSaid, sealSaid, nodeCaption, jobFolded, absentSaid } from './card-labels.js';

// The node card's own pure layout and tab-set facts (#41 task 6): on the surface so its L1 tests
// (`test/contract/canvas-layout.test.ts`) can assert on the same functions `client/NodeCard.tsx`
// renders from, without pulling React/JSX into the host bundle to do it.
export { cardPosition, TABS_BY_KIND, NODE_CARD_WIDTH, NODE_CARD_HEIGHT } from './node-card-layout.js';
export type { NodeCardTabKey } from './node-card-layout.js';

// What the ledger holds, for a caller reading records back through the namespace. `hasEnded` is the
// one predicate over a Run's status every face shares: what counts as an ending is the ledger's to
// say, not each caller's.
export { hasEnded, runIdPattern, importLegacyLedger, revisionRecordsIn, recordValidityOf, currentRecordsIn, retainedRecordMaterial } from './ledger.js';
export type { LegacyLedgerImportReceipt, RecordValidity, RetainedRecordMaterial } from './ledger.js';
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
  ResearchWriteRecord,
  GrowthRecord,
  RevisionRecord,
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
export { launchJob, reconcileLaunchIntent, jobStatus, nodeLogTail, nodeLogTailMaxLines } from './jobs.js';
export type { LaunchIntent, JobDeps, LaunchRequest, LaunchResult, ReconciledLaunch, NodeLogTailResult } from './jobs.js';
export { claimSlotAndLaunch } from './job-cap.js';
export { toolNode, observeNode, resumeNode, buildWorkshopScope, resolveWorkshop, launchWrittenWorkshop, exploreRecommendation } from './node-turns.js';
export type { Driving, ResolvedWorkshop, ExploreRecommendation } from './node-turns.js';
export { writeIntoWorkshop, readForWorkshop, knowledgeForWorkshop, captureWorkshopInputs } from './workshop.js';
export type { WorkshopScope, WriteAnswer, ReadAnswer, KnowledgeAnswer, CapturedWorkshopInput } from './workshop.js';
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
  /** Hima-owned local root for user-selected current documents and rebuildable indexes. */
  knowledgeDir: string;
}

/** Stable product knowledge for ordinary HimaGuide conversations.
 *
 * This is intentionally short. It gives the root DSH Agent enough product vocabulary to answer a
 * first-use question without searching the checkout; live installation facts are contributed by
 * {@link himaRuntimeContext} separately so this text never becomes a second inventory.
 */
export const HIMA_PRODUCT_CONTEXT = [
  'You are HimaGuide inside HimaHarness. HimaHarness keeps DeepSeek Harness\' general-purpose chat and coding abilities, and adds governed chip-design Campaigns.',
  'A Campaign is the business task the user wants completed. One persistent Run records its execution. A HimaPack is a transparent, installable method capability: it declares purpose, required inputs and outputs, tools, knowledge, reference graph, limits and evidence rules; it must not be treated as one fixed design replay.',
  'A Site describes a reachable execution environment and its permit. HimaGuide helps inspect a Pack, discover a Site and prepare the required inputs before asking for one concrete Campaign confirmation.',
  'The visible Campaign Agent owns execution decisions. HimaFabric constrains the allowed graph, budget, dependencies, jobs, evidence and recovery; it does not replace the Agent with a hidden automatic executor.',
  'When current Hima context offers independent branch nodes, admit their licence-free Jobs up to the Site job cap before waiting; licence seats still bound commercial EDA. Never duplicate a node already working.',
  'Answer product identity and installed-inventory questions from this context and the current Hima inventory below. Do not search source code, the filesystem or the web for those answers. Never claim readiness, a measured result or an installed item that the current inventory does not state.',
].join('\n');

/** The small, current snapshot that accompanies ordinary root-Agent turns. No local path, YAML,
 * Run id or customer material is exposed. Read afresh for every prompt assembly. */
export function himaRuntimeContext(ledger: Ledger, packsDir: string, sitesDir: string): string {
  const packs = installedPacks(packsDir);
  const sites = installedSites(sitesDir);
  const active = ledger.runs().filter((run) => !hasEnded(run.status)).slice(-5);
  const packLine = packs.length === 0
    ? 'Installed HimaPacks: none. Offer to install or inspect a Pack before preparing a Campaign.'
    : `Installed HimaPacks: ${packs.map((id) => {
      try {
        const overview = packOverview(loadPack(packsDir, id));
        return `${id}${overview.status === undefined ? '' : ` (${overview.status.raw})`}`;
      } catch {
        return `${id} (unreadable; do not claim ready)`;
      }
    }).join(', ')}.`;
  const siteLine = sites.length === 0
    ? 'Saved Sites: none. Offer to discover a Site from the user\'s SSH identity and available hints.'
    : `Saved Sites: ${sites.join(', ')}.`;
  const campaignLine = active.length === 0
    ? 'Active Campaigns: none.'
    : `Active Campaigns: ${active.map((run) => `${run.packId ?? 'unknown Pack'} on ${run.siteId} is ${run.status ?? 'preparing'}${run.currentNode === undefined ? '' : ` at ${run.currentNode}`}`).join('; ')}.`;
  return [`HimaHarness: ${versionLine()}.`, packLine, siteLine, campaignLine].join('\n');
}

/**
 * `SiteHeadView.readiness`, and the one rule `Hima.preparation`'s own site readiness calls this to
 * compute too, so the two answers cannot disagree: `local` is always ready; an `ssh` Site with no
 * saved discovery needs one; otherwise ready or stale by the saved `discovery.stale` flag alone.
 *
 * `stale` here is exactly the stored flag — nothing else. It is not a comparison against the
 * connection input a caller has in hand right now: `discoveryIsStale` (`sites.ts`) does that
 * comparison, but it needs the original discovery request (destination, jumps, hints) to compare
 * against, and a Site file does not retain that request — only its own `discovery.stale` bit, which
 * a save from a request that fails the same comparison already sets. A changed connection input a
 * caller has not yet re-discovered against is therefore not detected by this function or by
 * `GET /hima/api/sites`; only a `discoverSshSite` call that recomputes and compares can see it.
 */
function siteHeadReadiness(site: Site): SiteHeadView['readiness'] {
  if (site.kind === 'local') return 'ready';
  if (site.discovery === undefined) return 'needs-discovery';
  return site.discovery.stale ? 'stale' : 'ready';
}

/** A loaded Site as `GET /hima/api/sites` and `hima_site` answer it (#41 task 4). */
function siteHeadViewOf(site: Site): SiteHeadView {
  return {
    name: site.name, kind: site.kind, readiness: siteHeadReadiness(site), capacity: site.capacity,
    ...(site.discovery === undefined ? {} : { observedAt: site.discovery.observedAt }),
  };
}

/**
 * The stand-in Channel Site discovery uses when `HIMA_TEST_DISCOVERY_STANDIN` names a JSON table of
 * `{ "<the exact argv, space-joined>": { "code": 0, "stdout": "…", "stderr": "…" } }` (#41 task 4).
 * Test-only, exactly like `HIMA_TEST_SILENT_AGENT`: gated on `NODE_TEST_CONTEXT` so a production Host
 * never reads it, and it never spawns anything — every probe not named in the table answers as a
 * command that ran and found nothing (`code: 1`, empty output), the same shape a missing tool or an
 * absent file already answers with, so an incomplete table still produces an ordinary discovery
 * rather than a thrown fault.
 *
 * A table entry may instead be `{ "fail": "<message>" }` (#41 task 4 review, minor 4): the one way a
 * test expresses "the Site could not be asked at all", answered as `SiteUnreadableError` — the same
 * fault a real dropped connection or a hung ssh raises (#18). The distinguished key `"connect"`
 * checks before any probe's own argv key, so a single entry stands for the whole channel refusing to
 * answer, the way a real connection failure would before any command even reached the Site; naming
 * one ordinary probe's own key instead fails only that one probe, for a narrower case.
 *
 * @returns a `channelFor` for `discoverSshSite`, or undefined to keep its own `SshChannel` default.
 */
function testDiscoveryChannelFor(): ((name: string, ssh: SshTarget) => Channel) | undefined {
  if (process.env.NODE_TEST_CONTEXT === undefined || !process.env.HIMA_TEST_DISCOVERY_STANDIN) return undefined;
  type StandinEntry = { readonly code: number; readonly stdout: string; readonly stderr?: string } | { readonly fail: string };
  const table = JSON.parse(readFileSync(process.env.HIMA_TEST_DISCOVERY_STANDIN, 'utf8')) as Readonly<Record<string, StandinEntry>>;
  return (name) => ({
    siteName: name,
    readFile: () => { throw new Error('the Site discovery stand-in answers exec only; it reads no file'); },
    realpath: (p: string) => Promise.resolve(p),
    absent: () => Promise.resolve(true),
    exec: (argv: readonly string[]) => {
      const connect = table.connect;
      if (connect !== undefined && 'fail' in connect) return Promise.reject(new SiteUnreadableError(name, connect.fail));
      const answer = table[argv.join(' ')] ?? { code: 1, stdout: '' };
      if ('fail' in answer) return Promise.reject(new SiteUnreadableError(name, answer.fail));
      return Promise.resolve({ code: answer.code, stdout: Buffer.from(answer.stdout), stderr: answer.stderr ?? '' });
    },
  });
}

export default class Hima extends Service {
  static inject = ['storageDomain', 'commands', 'tools', 'skills', 'systemPrompt'];
  static Config = z.object({ sitesDir: z.string().required(), packsDir: z.string().required(), knowledgeDir: z.string().required() });

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
  /** One ordinary execution-fact wake-up per owner/Run while it is still pending in dsh's inbox.
   *  The ledger remains the fact authority; replacing this hint loses no execution evidence and
   *  prevents a fast Run from producing more durable turns than its Agent can consume. */
  private readonly pendingProgressNotifications = new Map<string, MessageId>();
  private readonly factStop = new AbortController();
  /** Browser-only Site drafts awaiting the same person's explicit Save. The reviewed result stays
   *  on the Host, so saving cannot silently rerun probes and persist facts the person never saw. */
  private readonly siteDiscoveryReviews = new Map<string, { readonly owner: string; readonly name: string; readonly result: SiteDiscoveryResult }>();

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'hima');
  }

  async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(ledgerSpec);
    this.ledger = new Ledger(domain);
    // Product identity is a prompt contribution rather than a document the Agent has to discover.
    // The dynamic inventory is recomputed at assembly time, so installs and Campaign changes are
    // visible on the next step without restarting the Host or scanning the checkout.
    this.ctx.effect(() => this.ctx.systemPrompt.section({
      name: 'hima:product',
      order: this.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 10,
      text: HIMA_PRODUCT_CONTEXT,
    }), 'hima: product identity');
    this.ctx.effect(() => this.ctx.systemPrompt.context({
      name: 'hima:inventory',
      order: this.ctx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION') + 10,
      text: () => himaRuntimeContext(this.ledger, this.config.packsDir, this.config.sitesDir),
    }), 'hima: current product inventory');
    this.ctx.effect(() => { this.notificationsActive = true; return () => { this.notificationsActive = false; }; });
    // The judge takes the ledger's one verdict-writer capability here; nothing else can obtain it.
    this.judge = createJudge(this.ledger, this.config.packsDir);
    this.ctx.effect(() => async () => {
      this.notificationsActive = false;
      this.pendingProgressNotifications.clear();
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
          sessionWorkspace: (id) => this.sessionWorkspace(id),
          readCampaignFile: (id) => this.readCampaignFileOf(id),
          writeCampaignFile: (id, file, expectedMtimeMs) => this.writeCampaignFileOf(id, file, expectedMtimeMs),
          sites: () => this.sites(),
          discoverSite: ({ sessionId, ...request }) => this.discoverSite(request, sessionId),
          jobLogTail: (runId, nodeId, lines) => this.jobLogTail(runId, nodeId, lines),
          packTransfer: (request) => {
            const installed = path.resolve(this.config.packsDir, validPackId.parse(request.pack));
            if ((request.mode === 'install' || request.mode === 'upgrade') && !request.source) throw new Error(`choose a Pack source for ${request.mode}`);
            if (request.mode !== 'install' && request.mode !== 'upgrade' && request.source !== undefined) throw new Error('sharing and migration read only the installed Pack');
            const fromSource = request.mode === 'install' || request.mode === 'upgrade';
            const operation = { from: fromSource ? request.source! : installed,
              to: fromSource ? installed : request.to, mode: request.mode, assets: request.assets };
            return request.reviewSha256 === undefined ? previewPackTransfer(operation)
              : applyPackTransfer({ ...operation, reviewSha256: request.reviewSha256 });
          },
          executionContext: (runId) => this.executionContext(runId),
          executionAction: (request) => this.executionAction(request),
          observe: (req) => this.observe(req),
          judge: (runId, ruleIds, params) => this.judge.evaluate({ runId, ruleIds, params }),
          startRun: (req) => this.startRun(req),
          resumeRun: (runId, who) => this.resumeRun(runId, who),
          cancelRun: (runId) => this.cancelRun(runId),
          readExperience: (runId) => this.readExperience(runId),
          readMaterial: (runId, recordId) => this.readMaterial(runId, recordId),
          readRunAssets: (runId) => readRunAssets(this.deps(), runId),
          readArchivedMaterial: (runId, relative) => readArchivedMaterial(this.deps(), runId, relative),
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
          startPreparation: (packId, siteName, overrides) => {
            let pack;
            try { pack = loadPack(this.config.packsDir, packId); }
            catch (err) {
              return { preparation: { kind: 'pack', message: `Pack owner: repair Pack ${packId} files: ${err instanceof Error ? err.message : String(err)}` } };
            }
            const fields = { goal: goalDeclarationOf(pack), strategy: pack.contract.strategy, words: packWords(pack) };
            if (siteName === undefined) return { ...fields, proposal: this.preparation(pack, undefined, overrides) };
            let site;
            try { site = loadSite(this.config.sitesDir, siteName); }
            catch (err) {
              return { ...fields, preparation: { kind: 'site', message: `Site owner: repair configuration for ${siteName}: ${err instanceof Error ? err.message : String(err)}` } };
            }
            // Only local declarations are read. Fabric rechecks them when a Run is actually started.
            return { ...fields, check: checkPack(pack, site), proposal: this.preparation(pack, site, overrides) };
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
    for (const tool of himaTools(this.deps(), (request, agent) => openAuthoringSession(this.ctx, this.config.packsDir, request, agent),
      (pack, site, overrides) => {
        const loadedPack = loadPack(this.config.packsDir, pack);
        return this.preparation(loadedPack, site === undefined ? undefined : loadSite(this.config.sitesDir, site), overrides);
      }, { root: this.config.knowledgeDir },
      { list: () => this.sites(), discover: (request) => this.discoverSite(request), rediscoverInput: (name) => this.rediscoverInput(name) },
    )) this.ctx.effect(() => this.ctx.tools.register(tool));
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

  /** Read one Run-owned historical code or knowledge version at its recorded identity. */
  readMaterial(runId: string, recordId: string): Promise<ReadMaterialResult> {
    return readMaterial(this.deps(), runId, recordId);
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

  /** A live session's own workspace cwd, through the one resolver every cwd-dependent Hima surface
   *  uses (`agentWorkspaceOf`, `tools.ts`) — where that session's `hima/campaign.yml` lives (#41 task
   *  3). Undefined for a session id this Host does not carry an Agent for, or one with no workspace. */
  private sessionWorkspace(sessionId: string): string | undefined {
    return agentWorkspaceOf(this.ctx.get('agents')?.list().find((item) => String(item.id) === sessionId));
  }

  /** `RemoteOperations.readCampaignFile` (#41 task 3): resolve the session's workspace and read its
   *  `hima/campaign.yml`, here rather than in `remote.ts` because that module reaches no filesystem
   *  of its own. A schema/YAML failure (`CampaignFileError`) answers `invalid` with its own sentence;
   *  any other fault (`EACCES` and the like) propagates to the Host's internal-error path. */
  private readCampaignFileOf(sessionId: string): CampaignFileReadResult {
    const workspace = this.sessionWorkspace(sessionId);
    const empty = emptyCampaignFile();
    if (workspace === undefined) return { kind: 'read', exists: false, file: empty, text: serializeCampaignFile(empty), overrides: overridesOf(empty) };
    let found: ReturnType<typeof readCampaignFile>;
    try {
      found = readCampaignFile(workspace);
    } catch (err) {
      if (err instanceof CampaignFileError) return { kind: 'invalid', message: err.message };
      throw err;
    }
    const file = found?.file ?? empty;
    const text = found?.text ?? serializeCampaignFile(file);
    return { kind: 'read', exists: found !== undefined, file, text, ...(found === undefined ? {} : { mtimeMs: found.mtimeMs }), overrides: overridesOf(file) };
  }

  /** `RemoteOperations.writeCampaignFile` (#41 task 3): resolve the session's workspace and validate
   *  and write `candidate` as its `hima/campaign.yml`, for the same reason `readCampaignFileOf` is
   *  here and not in `remote.ts`. A session with no workspace is a caller's mistake the route itself
   *  already refused before reaching this. */
  private writeCampaignFileOf(sessionId: string, candidate: unknown, expectedMtimeMs?: number): CampaignFileWriteResult {
    const workspace = this.sessionWorkspace(sessionId);
    if (workspace === undefined) return { kind: 'invalid', message: 'the selected conversation has no workspace to write a Campaign file into.' };
    // The save-conflict re-read (#41 task 7 review): a caller's own `expectedMtimeMs` is held
    // against the file exactly as it now stands, immediately before the write — a second writer's
    // edit that landed after this caller's own last read must never be silently overwritten.
    if (expectedMtimeMs !== undefined) {
      let current: ReturnType<typeof readCampaignFile>;
      try {
        current = readCampaignFile(workspace);
      } catch (err) {
        if (err instanceof CampaignFileError) return { kind: 'invalid', message: err.message };
        throw err;
      }
      if (current !== undefined && current.mtimeMs !== expectedMtimeMs) {
        return { kind: 'conflict', file: current.file, text: current.text, mtimeMs: current.mtimeMs, overrides: overridesOf(current.file) };
      }
    }
    let written: ReturnType<typeof writeCampaignFile>;
    try {
      written = writeCampaignFile(workspace, candidate);
    } catch (err) {
      if (err instanceof CampaignFileError) return { kind: 'invalid', message: err.message };
      throw err;
    }
    const file = parseCampaignFile(written.text);
    return { kind: 'written', file, text: written.text, mtimeMs: written.mtimeMs, overrides: overridesOf(file) };
  }

  /** `RemoteOperations.sites` (#41 task 4): every Site this Host has installed, read fresh each
   *  time, for the reason `installed` above is — a Site discovered or edited while a page is open is
   *  one the next look offers. A Site file this Host cannot read or parse is passed over rather than
   *  raising, exactly as `installedSites` itself already is for a form that offers a name to choose. */
  private sites(): readonly SiteHeadView[] {
    return installedSites(this.config.sitesDir).flatMap((name) => {
      try { return [siteHeadViewOf(loadSite(this.config.sitesDir, name))]; }
      catch { return []; }
    });
  }

  /**
   * `RemoteOperations.discoverSite` (#41 task 4): learn a Site through the caller's own SSH
   * identity, keys and agent, and — when asked — persist it as the ordinary Site and Permit files
   * `loadSite` reads. `testDiscoveryChannelFor` swaps in a stand-in Channel under
   * `HIMA_TEST_DISCOVERY_STANDIN`; every other Host reaches the real Site over `SshChannel`, exactly
   * as `discoverSshSite`'s own default already does.
   */
  private async discoverSite(request: Omit<SiteDiscoverBody, 'sessionId'>, reviewOwner?: string): Promise<{ readonly result: SiteDiscoveryResult; readonly saved?: SiteHeadView; readonly reviewId?: string }> {
    if (request.save === true && request.reviewId !== undefined) {
      const reviewed = this.siteDiscoveryReviews.get(request.reviewId);
      if (reviewed === undefined || reviewOwner === undefined || reviewed.owner !== reviewOwner || reviewed.name !== request.name) {
        throw new BadRequest('the reviewed Site draft is absent or belongs to another conversation; rediscover and review it again');
      }
      this.siteDiscoveryReviews.delete(request.reviewId);
      return { result: reviewed.result, saved: siteHeadViewOf(saveDiscoveredSite(this.config.sitesDir, reviewed.result)) };
    }
    // Bug 2 fix: an omitted `ssh` rediscovers an already-saved ssh Site's own destination, jumps and
    // permitted roots — exactly the input `rediscoverInput` already computes for `hima_site
    // rediscover`'s tool call, now reachable from this route too so the Configuration page can offer
    // a person their own "Rediscover" button on a Site that already exists, not only a brand-new one.
    // A body naming neither `ssh` nor an existing Site of that name is still the caller's own mistake.
    const reuse = request.ssh === undefined ? this.rediscoverInput(request.name) : undefined;
    if (request.ssh === undefined && reuse === undefined) {
      throw new BadRequest(`"ssh" is required to discover a new Site; no saved ssh Site named "${request.name}" exists to rediscover`);
    }
    const ssh = request.ssh ?? reuse!.ssh;
    const selectedPack = request.pack === undefined ? undefined : loadPack(this.config.packsDir, request.pack);
    const requestedHints = selectedPack === undefined ? request.hints : {
      ...request.hints,
      allowedWrappers: [...new Set([...(request.hints?.allowedWrappers ?? []), ...selectedPack.contract.environment.wrappers])],
      toolCommands: [...new Set([...(request.hints?.toolCommands ?? []), ...selectedPack.contract.environment.commands])],
    };
    const hints = requestedHints === undefined ? reuse?.hints : {
      ...reuse?.hints,
      ...requestedHints,
      allowedReadRoots: [...new Set([...(reuse?.hints.allowedReadRoots ?? []), ...(requestedHints.allowedReadRoots ?? [])])],
      allowedWriteRoots: [...new Set([...(reuse?.hints.allowedWriteRoots ?? []), ...(requestedHints.allowedWriteRoots ?? [])])],
      allowedWrappers: [...new Set([...(reuse?.hints.allowedWrappers ?? []), ...(requestedHints.allowedWrappers ?? [])])],
      toolCommands: [...new Set([...(reuse?.hints.toolCommands ?? []), ...(requestedHints.toolCommands ?? [])])],
    };
    // Held to the schema before anything here dereferences `ssh` (#41 task 4 review round
    // 3, minor 2): a request body naming `ssh` as something other than an object is the caller's own
    // request-shape mistake — thrown here as the `ZodError` the route's own catch already turns into
    // a 400 naming the field, rather than a `TypeError` that would reach the dispatcher as an
    // unexplained 500.
    const parsed = siteDiscoveryRequestSchema.safeParse({ name: request.name, ssh, hints });
    if (!parsed.success) throw parsed.error;
    const channelFor = testDiscoveryChannelFor() ?? ((name: string, ssh: SshTarget) => new SshChannel(name, ssh));
    const resolvedSsh = { destination: parsed.data.ssh.destination, ...(parsed.data.ssh.jumps.length === 0 ? {} : { jumps: [...parsed.data.ssh.jumps] }) };
    const discovered = await discoverSshSite({ name: parsed.data.name, ssh: resolvedSsh, hints: parsed.data.hints }, channelFor);
    const withSavedBindings = reuse === undefined ? discovered : {
      ...discovered,
      site: { ...discovered.site, bindings: { ...reuse.bindings } },
    };
    // A selected Pack states the licence seats one of its Jobs needs. Discovery cannot check out a
    // vendor licence safely, so the reviewed Site draft reserves the smallest declared count rather
    // than claiming a measured pool. The person's Save remains the authority boundary.
    const requiredLicences: Record<string, number> = {};
    for (const operation of [...(selectedPack?.contract.tools ?? []), ...(selectedPack?.contract.workshops ?? [])]) {
      for (const [licence, count] of Object.entries(operation.licences)) {
        requiredLicences[licence] = Math.max(requiredLicences[licence] ?? 0, count);
      }
    }
    const result = selectedPack === undefined ? withSavedBindings : { ...withSavedBindings, site: { ...withSavedBindings.site,
      capacity: { ...withSavedBindings.site.capacity, licences: requiredLicences } } };
    if (request.save !== true) {
      if (reviewOwner === undefined) return { result };
      const reviewId = randomUUID();
      for (const [id, draft] of this.siteDiscoveryReviews) {
        if (draft.owner === reviewOwner && draft.name === request.name) this.siteDiscoveryReviews.delete(id);
      }
      this.siteDiscoveryReviews.set(reviewId, { owner: reviewOwner, name: request.name, result });
      return { result, reviewId };
    }
    return { result, saved: siteHeadViewOf(saveDiscoveredSite(this.config.sitesDir, result)) };
  }

  /** The `hima_site rediscover` input (#41 task 4 review, important 3, minor 9): a saved ssh Site's
   *  own destination and jumps, and its Permit's own roots as hints — undefined for a Site this
   *  Host cannot load, or one of kind `local`, which has no destination to rediscover at all. */
  private rediscoverInput(name: string): { readonly ssh: SiteDiscoverBody['ssh']; readonly hints: NonNullable<SiteDiscoverBody['hints']>; readonly bindings: Readonly<Record<string, string>> } | undefined {
    let site: Site;
    try { site = loadSite(this.config.sitesDir, name); }
    catch { return undefined; }
    if (site.kind !== 'ssh' || site.ssh === undefined) return undefined;
    return {
      ssh: { destination: site.ssh.destination, ...(site.ssh.jumps.length === 0 ? {} : { jumps: [...site.ssh.jumps] }) },
      hints: {
        workspaceRoot: site.workspaceRoot,
        // A saved workspaceRoot is already the Site owner's declared Campaign location. When an old
        // profile has no roots, propose that one minimal root for both reading Campaign outputs and
        // writing new work; the browser still shows the proposal and only the person can save it.
        allowedReadRoots: site.permitRules.allowedReadRoots.length === 0 ? [site.workspaceRoot] : [...site.permitRules.allowedReadRoots],
        allowedWriteRoots: site.permitRules.allowedWriteRoots.length === 0 ? [site.workspaceRoot] : [...site.permitRules.allowedWriteRoots],
        allowedWrappers: [...site.permitRules.allowedWrappers],
      },
      bindings: { ...site.bindings },
    };
  }

  /** `RemoteOperations.jobLogTail` (#41 task 4): the tail of the Job the named node currently has
   *  open on this Run, for any viewer — `nodeLogTail` (`jobs.ts`) is what actually reads the
   *  ledger's own current node records and bounds/truncates the read; this only adds the moment it
   *  was read at. A `session` with `lines` still empty is the ordinary state of a Job that is open
   *  and has simply written nothing yet, not a fault and not "no Job" — `nodeLogTail` never lets a
   *  Job whose log is not there yet reach here as a thrown error (#41 task 4, blocking review item). */
  private async jobLogTail(runId: string, nodeId: string, lines: number): Promise<LogTailView> {
    const found = await nodeLogTail(this.deps(), { run: runId, nodeId, lines });
    return { nodeId, ...(found.session === undefined ? {} : { session: found.session }), lines: found.lines, at: new Date().toISOString(), truncated: found.truncated };
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
      notify: (owner, runId, executionId, detail) => {
        if (!this.notificationsActive || (process.env.NODE_TEST_CONTEXT !== undefined && process.env.HIMA_TEST_SILENT_AGENT === '1')) {
          return { status: 'inactive', message: 'The control fact is recorded; Campaign Agent notification is inactive on this Host.' };
        }
        const agent = this.ctx.get('agents')?.list().find((item) => String(item.id) === owner);
        if (!agent) return { status: 'owner-unavailable', message: 'The control fact is recorded; the owning Campaign Agent is not currently live.' };
        try {
          const message = createUserMessage({ source: { kind: 'plugin', plugin: 'hima' }, content: [{ type: 'text', text: `Hima recorded new execution facts for Run ${runId}, execution ${executionId}. ${detail ?? 'Read hima_context once to inspect every current Job and evidence fact. You remain this Run\'s conversational owner.'} Respect pause and user instructions; this notification grants no new authority or budget.` }] });
          if (detail === undefined) {
            const key = `${owner}\u0000${runId}`;
            const pending = this.pendingProgressNotifications.get(key);
            if (pending !== undefined && agent.inbox.replace(pending, message)) {
              this.pendingProgressNotifications.set(key, message.id);
              return { status: 'queued', message: 'The control fact is recorded and the pending Campaign progress notification was updated.' };
            }
            agent.followup(message);
            this.pendingProgressNotifications.set(key, message.id);
            return { status: 'queued', message: 'The control fact is recorded and one Campaign progress notification was queued.' };
          }
          // Human stop/pause/continue/handoff and Campaign-open messages carry explicit detail and
          // remain separate, immediate turns; they must never be hidden behind progress coalescing.
          agent.followup(message);
          return { status: 'queued', message: 'The control fact is recorded and the Campaign Agent notification was queued.' };
        } catch (error) {
          this.ctx.logger.warn(`Campaign Agent notification failed after control was recorded: ${(error as Error).message}`);
          return { status: 'failed', message: 'The control fact is recorded, but the Campaign Agent notification could not be queued.' };
        }
      },
    };
  }

  /** Compose the deterministic, non-creating Campaign proposal used by the route and HimaGuide. */
  /**
   * Compose the deterministic, non-creating Campaign proposal used by the route, HimaGuide and the
   * Campaign-file routes (#41 task 3).
   *
   * `overrides` is absent for every caller that predates that task — the legacy workbench page,
   * `/hima/api/start-options`, every `hima_prepare`/`hima_run` call with no applicable Campaign
   * file — and this method's answer for them is unchanged down to the byte: a Goal and Strategy
   * filled from the Pack's own defaults, and readiness that never asks about a Goal at all. Given
   * `overrides` (a Campaign file's own, however empty), a Goal is **never** filled from a default:
   * every declared Goal parameter must be present in `overrides.goal` and within its declared
   * bounds for this preparation to be ready, and an absent one adds a sentence naming that
   * parameter's own label rather than a raw name.
   */
  private preparation(pack: ReturnType<typeof loadPack>, site: ReturnType<typeof loadSite> | undefined, overrides?: PreparationOverrides): PreparationView {
    // Authoring records and PACK.md remain inspectable Pack assets. The proposal carries their
    // compact declared structure, never entire documents on every HimaGuide turn.
    const { intent: _intent, spec: _spec, pack: _packDocument, ...overview } = packOverview(pack);
    // Campaign-file input overrides (#41 task 3), merged over the Site's own bindings in memory. The
    // Permit is untouched: `effectiveSite` keeps this same Site's own `permitFile`/`permitRules`, so
    // every overridden path still passes `decideRead`/`decideWrite` exactly as a bound path from the
    // site file would.
    const effectiveSite = site === undefined || overrides?.inputs === undefined ? site : { ...site, bindings: { ...site.bindings, ...overrides.inputs } };
    const check = effectiveSite === undefined ? undefined : checkPack(pack, effectiveSite);
    const requiredCommands = new Set(pack.contract.environment.commands);
    const discoveredCommands = new Set(site?.discovery?.facts
      .filter((fact) => fact.probe[0] === 'which' && fact.code === 0 && fact.probe[1] !== undefined)
      .map((fact) => fact.probe[1]!) ?? []);
    const missingCommands = site?.kind === 'ssh' ? [...requiredCommands].filter((command) => !discoveredCommands.has(command)) : [];
    const siteReadiness = site === undefined ? undefined : siteHeadReadiness(site);
    const words = packWords(pack);
    const goalDeclared = goalDeclarationOf(pack);
    // Every way a Campaign file's own overrides can be wrong about this Pack (#41 task 3): a Goal
    // parameter it does not declare, a declared one this file leaves unset, one given a value the
    // start path would itself refuse (`strategyValue`, the same check `goalFrom`/`strategyFrom`
    // apply at admission — a value this preparation waved through and the start later refused would
    // be a proposal calling itself ready about a Run that cannot happen), and an input override
    // naming something this Pack never declared. Every one of these is a sentence, and any of them
    // makes this preparation not ready — a Goal is never filled from a default (#41 task 3), and an
    // override this Pack does not recognize is not silently ignored either.
    const overrideUnknowns: string[] = [];
    const goal: Record<string, number> = overrides === undefined
      ? Object.fromEntries(Object.entries(goalDeclared).map(([name, declaration]) => [name, declaration.default]))
      : { ...(overrides.goal ?? {}) };
    if (overrides !== undefined) {
      for (const name of Object.keys(overrides.goal ?? {})) {
        if (!Object.hasOwn(goalDeclared, name)) overrideUnknowns.push(`Goal parameter "${name}" is not declared by Pack ${pack.id}.`);
      }
      for (const [name, declaration] of Object.entries(goalDeclared)) {
        const label = words?.goal[name]?.label ?? name;
        const given = overrides.goal?.[name];
        if (given === undefined) { overrideUnknowns.push(`Goal ${label} is not set.`); continue; }
        const held = strategyValue(name, declaration, given);
        if ('error' in held) overrideUnknowns.push(held.error.replace('strategy knob', 'Goal parameter'));
      }
      for (const name of Object.keys(overrides.inputs ?? {})) {
        if (!pack.contract.inputs.some((input) => input.name === name)) overrideUnknowns.push(`Input "${name}" is not declared by Pack ${pack.id}.`);
      }
      // H1: a file's own Strategy and Budget overrides are held to the same checks `startRun` itself
      // applies at admission (`strategyFrom`, and the Budget bounds every face's own argument reuses),
      // not only refused once a Run is actually attempted. Without this, `strategy: { nope: 1 }`,
      // `strategy: { periodNs: 9999 }` or `budget: { generations: 1000000 }` read `ready: true` here
      // and a caller confirming this very proposal would only be told at `startRun` — or, for a
      // generation count within `startRun`'s own unchecked path, would have it pass straight into the
      // ledger.
      const strategyHeld = strategyFrom(pack.contract.strategy, overrides.strategy);
      if ('error' in strategyHeld) overrideUnknowns.push(strategyHeld.error);
      if (overrides.budget?.timeBoxMinutes !== undefined) {
        const ms = Math.round(overrides.budget.timeBoxMinutes * 60_000);
        if (!allowsTimeBoxMs(ms)) {
          overrideUnknowns.push(`invalid budget.timeBoxMinutes ${JSON.stringify(overrides.budget.timeBoxMinutes)}: converts to ${String(ms)} ms; expected ${timeBoxMsBounds.what}`);
        }
      }
      if (overrides.budget?.retries !== undefined && !allowsRunArgument('retries', overrides.budget.retries)) {
        overrideUnknowns.push(badRunArgument('retries', 'budget.retries', overrides.budget.retries));
      }
      if (overrides.budget?.generations !== undefined && !allowsRunArgument('generations', overrides.budget.generations)) {
        overrideUnknowns.push(badRunArgument('generations', 'budget.generations', overrides.budget.generations));
      }
    }
    const unknowns = [
      ...(site === undefined ? ['No Site is selected.'] : []),
      ...(check?.errors ?? []),
      ...(siteReadiness === 'needs-discovery' ? ['The SSH Site has not completed bounded discovery.'] : []),
      ...(siteReadiness === 'stale' ? ['The saved SSH Site discovery is stale.'] : []),
      ...missingCommands.map((command) => `Required command ${command} was not found by Site discovery.`),
      ...overrideUnknowns,
    ];
    const strategy = overrides === undefined
      ? Object.fromEntries(Object.entries(pack.contract.strategy).map(([name, declaration]) => [name, declaration.default]))
      : Object.fromEntries(Object.entries(pack.contract.strategy).map(([name, declaration]) => [name, overrides.strategy?.[name] ?? declaration.default]));
    const referenceGraph = { entry: pack.graph.entry, nodes: pack.graph.nodes.map((node) => ({ id: node.id, kind: node.kind })),
      edges: pack.graph.edges.map((edge) => ({ from: edge.from, to: edge.to, ...(edge.outcome === undefined ? {} : { outcome: edge.outcome }), ...(edge.revisit === undefined ? {} : { revisit: edge.revisit }) })) };
    const ready = check?.fit === true && siteReadiness === 'ready' && missingCommands.length === 0 && (overrides === undefined || overrideUnknowns.length === 0);
    const proposalId = newCampaignProposalId(pack, site, overrides);
    const knowledgeScope = campaignKnowledgeScope(proposalId);
    const goalDeclaredView = Object.fromEntries(Object.entries(goalDeclared).map(([name, declaration]) => [name, {
      label: words?.goal[name]?.label ?? name,
      ...(declaration.unit === undefined ? {} : { unit: declaration.unit }),
      min: declaration.min, max: declaration.max,
      ...(declaration.precision === undefined ? {} : { precision: declaration.precision }),
    }]));
    const generationLimit = convergeOf(pack)?.generationLimit;
    const budget: PreparationView['budget'] = {
      timeBoxMinutes: overrides?.budget?.timeBoxMinutes !== undefined ? { value: overrides.budget.timeBoxMinutes, source: 'file' }
        : pack.contract.budget.timeBoxMs !== undefined ? { value: pack.contract.budget.timeBoxMs / 60_000, source: 'pack' }
        : { value: defaultTimeBoxMs / 60_000, source: 'harness' },
      retries: overrides?.budget?.retries !== undefined ? { value: overrides.budget.retries, source: 'file' }
        : { value: defaultRetryAllowance, source: 'harness' },
      generations: overrides?.budget?.generations !== undefined ? { value: overrides.budget.generations, source: 'file' }
        : generationLimit !== undefined ? { value: generationLimit, source: 'pack' }
        : { value: defaultGenerationLimit, source: 'harness' },
      ...(site === undefined ? {} : { jobCap: site.capacity.parallelJobs }),
      ...(site !== undefined && Object.keys(site.capacity.licences).length > 0 ? { licences: site.capacity.licences } : {}),
    };
    return {
      id: proposalId, ready, pack: overview,
      ...(site === undefined ? {} : { site: { name: site.name, kind: site.kind, readiness: siteReadiness!, resources: { cores: site.capacity.cores, memoryGiB: site.capacity.memoryGiB, parallelJobs: site.capacity.parallelJobs } } }),
      inputs: pack.contract.inputs.map((input) => {
        const found = check?.inputs.find((item) => item.name === input.name);
        const fromFile = overrides?.inputs?.[input.name] !== undefined;
        return { name: input.name, description: input.description, ...(found?.bound === undefined ? {} : { value: found.bound }),
          ready: found?.bound !== undefined, ...(fromFile ? { source: 'file' as const } : found?.bound !== undefined ? { source: 'site' as const } : {}) };
      }),
      knowledge: { documents: pack.contract.knowledge.length, ready: true,
        currentDocuments: currentKnowledgeDocumentCount(this.config.knowledgeDir, knowledgeScope) },
      probe: site === undefined ? { status: 'needed' } : site.kind === 'local' ? { status: 'declaration-only' } : siteReadiness === 'stale'
        ? { status: 'stale', observedAt: site.discovery?.observedAt } : site.discovery === undefined ? { status: 'needed' } : { status: 'discovered', observedAt: site.discovery.observedAt },
      goal, strategy, goalDeclared: goalDeclaredView, budget, referenceGraph, unknowns,
      nextActions: ready ? ['Review this proposal and confirm once to create the Campaign.']
        : unknowns.length > 0 ? unknowns : ['Ask HimaGuide to complete Campaign preparation.'],
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
// The pure canvas scene layout (#41 task 2): a reference graph plus execution facts, turned into
// positioned nodes, edges, frames and a Goal roundel, with no DOM and no dependency on the rest of
// this bundle. `X0` and `PAD_Y` are re-exported alongside the plan's own `PITCH, ROW, NODE` list
// because `canvas-layout.ts` declares all five as one constant statement (rule 1's `x = X0 + rank *
// PITCH` and rule 9's Goal placement both need them) and the contract test imports both.
export { layoutCanvas, fitToWidth, labelsVisibleAt, PITCH, ROW, NODE, X0, PAD_Y } from './canvas-layout.js';
export type { CanvasScene, LayoutGraph, LayoutFacts, PlacedNode, PlacedEdge, Frame, NodeVisualState } from './canvas-layout.js';

// `scene.ts`'s adapter — a reference graph plus a Run view and execution context, turned into
// `layoutCanvas`'s own two inputs above — is a pure function exactly as `layoutCanvas` itself is (#41
// task 5), so it is exported beside it: both are testable at L1 without a window, and the client
// renders from the very function the contract suite asserts on.
export { sceneInputs } from './scene.js';
// The Campaign file (#41 task 3): `hima-campaign/1`'s schema, parse/serialize, read/write under a
// session workspace, and the overrides it hands Preparation. Exported here for the same reason every
// other business format is: `test/contract/campaign-file.host.test.ts`, `tools.ts` and `remote.ts`
// all need the one reading of what this file may say.
export { CAMPAIGN_FILE_RELATIVE, CAMPAIGN_SCHEMA, campaignFileSchema, emptyCampaignFile, overridesOf, parseCampaignFile, readCampaignFile, serializeCampaignFile, writeCampaignFile } from './campaign-file.js';
export type { CampaignFile, PreparationOverrides } from './campaign-file.js';
// The pure Campaign-file diff (H8): its own leaf, with no imports of its own, so the client half can
// import it directly without pulling `campaign-file.ts`'s `node:fs`/`yaml` machinery into a browser
// bundle. Re-exported here too, beside `campaign-file.ts`'s own re-export, so every existing caller of
// this bundle's surface keeps reading it from here.
export { changedFields } from './campaign-file-diff.js';
