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
import { setTimeout as waitForFactPoll } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { installedExecutableManifest, startDurableRuntime, type DurableRuntime } from './durable-runtime.js';
import { flowWorkflowDefinitions } from './flow-workflow.js';
import { resolveDurableTaskAdapter } from './durable-task-adapters.js';
import { knownDurableRun, durableProposalRun, durableStartRequestDigest, durableStartResult } from './durable-fabric.js';
import type { DurableCommand } from './run-store.js';
import { nativeDelegationPolicy } from './native-task-adapters.js';
import { operateTaskInteractive, type TaskInteractiveDeps } from './task-interactive.js';
import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
// Type-only: these take the `ctx.commands` and `ctx.tools` declaration merges the registrations below
// stand on. What is registered is built in the two face modules, which face those seams themselves.
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-commands';
import { hasEnded, Ledger, ledgerSpec, recordValidityOf, currentRecordsIn, type RunRecord } from './ledger.js';
import { observe, type ObserveRequest, type ObserveResult } from './observe.js';
import { convergeOf, newCampaignProposalId, resumeRun, startRun, preparationWorkflowDefinitions, recoverDurablePreparations, readExecutionContext, controlDurableRun, type FabricDeps, type ResumeResult, type StartRunRequest, type StartRunResult } from './fabric.js';
import { defaultGenerationLimit, defaultRetryAllowance, defaultTimeBoxMs, ownedWaitedMs, timeBoxRemainingMs } from './budget.js';
import { readEngineeringAsset, controlling, identityOf, drainExecutionObservers, reconcileExecutionIntents, executionAction, executionContext, type ExecutionActionRequest, type ExecutionActionResult, type ExecutionContext } from './fabric.js';
import { cancelRun, reconcileRuns, type CancelResult, type ReconcileOutcome } from './recovery.js';
import { operateRunDelegation, runDelegations, delegationRuntimePolicy, operatorInteractiveAuthority, settleStrandedTeamExecutions, unreservedDelegationMs, type RunDelegationRequest } from './delegation-runtime.js';
import { registerDelegationGuard, registerAsyncDelegationGuard, parseDelegationResultObservedPayload, reviewedScopeProblem, delegationInputSelected, selectDelegationInput, type DelegationInputSelection } from './delegation.js';
import { createInteractiveBindingBridge, testFixtureCanRunHere } from './interactive-binding.js';
import { operateInteractive, parseInteractiveRequest, listInteractiveSessions, reconcileInteractiveState, createInteractiveTimerController, interactiveDelegationGrant, type InteractiveRuntimeDeps, type InteractiveTimerController } from './interactive-runtime.js';
import { executionPack, interactiveDriving, reconcileInteractiveExecution } from './fabric.js';
import { Autopilot } from './autopilot.js';
/** How often the Host re-kicks a Run standing idle on a self-driving node (#64 D-T04-1). */
const autopilotSweepMs = 15_000;
import { autopilotDrives } from './packs.js';
import { claimSlot } from './job-cap.js';
import { readDurableHostExitStatus, type HostExitRequest, type HostExitStatus } from './host-exit.js';
import { startLocalDatabase, localDatabaseHome, localDatabaseRuntime, type LocalDatabase } from './local-database.js';
import { nativeSessionMemoryEvidence } from './native-session-memory.js';
import { readMaterial, readReportMaterial, readRunAssets, readArchivedMaterial, readWorkMemorySummary, writeWorkMemorySummary, workMemoryEvidence, listRunKnowledge,
  recordExperienceAdoption, type ExperienceAdoptionRequest, type WorkMemoryScope, type ReadExperienceResult, type ReadMaterialResult } from './experience.js';
import { handleHimaCommand, himaCommandDescription, versionLine } from './commands.js';
import { agentWorkspaceOf, himaTools, guideTools } from './tools.js';
import { createJudge, type Judge } from './judge.js';
import { registerHimaRoutes, BadRequest, type LogTailView, type SiteDiscoverBody, type SiteHeadView } from './remote.js';
import { createDurableViewReaders } from './durable-views.js';
import { previewPackTransfer, applyPackTransfer, loadRunPack } from './release.js';
import { packId as validPackId } from './pack-folder.js';
import { checkPack, loadPack, goalDeclarationOf, packWords, runPackWords, installedPacks, packOverview, outputPath } from './packs.js';
import { strategyValue, strategyFrom, allowsRunArgument, badRunArgument, allowsTimeBoxMs, timeBoxMsBounds } from './run-arguments.js';
import { discoverSshSite, installedSites, loadSite, saveDiscoveredSite, siteSaveIdentity, siteDiscoveryRequestSchema, type Site, type SiteDiscoveryResult, type SiteSaveIdentity, type SshTarget } from './sites.js';
import { SshChannel, type Channel } from './channel.js';
import { nodeLogTail } from './jobs.js';
import { SiteUnreadableError } from './errors.js';
import { momentOnCurrentNode, type MomentOnNode } from './moments.js';
import { installedPackStages } from './packs.js';
import { registerHimaSkills } from './skills.js';
import { openAuthoringSession, registerAuthoringGuard, terminalDenial, SHELL_TOOL, TERMINAL_TOOLS } from './authoring.js';
export { TERMINAL_TOOLS, terminalDenial } from './authoring.js';
import { prepareCampaignSession, readChildSessionView, listSessionChildren } from './guide-sessions.js';
import { authorizeProjectRun, readGuideContext, readNativeSessionContext, resolveReportAddress, sessionProject } from './guide-context.js';
export { readGuideContext, readNativeSessionContext, resolveReportAddress, targetAddress } from './guide-context.js';
export type { TargetAddress, GuideContextView } from './guide-context.js';
import { authenticCampaignProposalId, sameCampaignProposalFacts } from './fabric.js';
import { legacyAutomaticAllowed } from './runs.js';
export { prepareCampaignSession, readChildSessionView, listSessionChildren } from './guide-sessions.js';
export type { PreparedCampaignSession } from './guide-sessions.js';
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
export { channelFor, controlPathFor, remoteCommands, clearRemoteCommands, remoteCommandWindow, remoteCommandWindowFilled, readOnlyProbes, siteDiscoveryProbes, discoverSiteFacts, jobPlumbing, workspacePlumbing, processProbes, quote, LocalChannel, SshChannel } from './channel.js';
export type { Channel, ExecResult, ExecOptions, RemoteCommand, SiteDiscoveryFact } from './channel.js';
export { loadSite, installedSites, discoverSshSite, saveDiscoveredSite, discoveryIsStale, siteSaveIdentity, SiteDiscoveryConflictError } from './sites.js';
export { WORK_MEMORY_SCHEMA, readWorkMemorySummary, writeWorkMemorySummary, workMemoryEvidence, recordExperienceAdoption } from './experience.js';
export * from './delegation.js';
export { runDelegations, delegationRuntimePolicy, operateRunDelegation } from './delegation-runtime.js';
export { WORKSHOP_ENTRY_SCHEMA } from './autopilot.js';
export { autopilotOf, autopilotSegmentOf, autopilotDrives } from './packs.js';
export * from './interactive-job.js';
export * from './interactive-runtime.js';
export * from './interactive-binding.js';
export * from './library-insight-report.js';
export * from './generation-feedback-report.js';
export { readReportMaterial } from './experience.js';
export { batchToolRefusal } from './packs.js';
export { launchInteractiveJob } from './jobs.js';
export { nativeSessionMemoryEvidence } from './native-session-memory.js';
export type { NativeSessionMemoryEvidence, NativeSessionMemoryReader } from './experience.js';
export type { WorkMemoryScope, WorkMemorySummary, WorkMemoryRead, WorkMemoryAuthority, ExperienceAdoptionRequest } from './experience.js';
export type { ExperienceAdoptionRecord, DelegationRecord } from './ledger.js';
export type { Site, SshTarget, Permit, SiteDiscovery, SiteDiscoveryRequest, SiteDiscoveryResult, SiteSaveIdentity } from './sites.js';

// A HimaPack is data, and reading it is part of the bundle's surface: an operator inspects a pack
// against a Site before starting a Campaign, and the contract suite reads the same answer.
export { loadPack, installedPacks, checkPack, packOverview, packKnowledgeManifestOf, packKnowledgeManifest, normalizePackAuthorStatus, harnessVersion, flowDirName, workspaceFileName, packFiles, toolArgv, outputPath, boundInputs, strategyKnobsOf, resolveRule, resolveChooser, packReadersDir, packKnowledgeDir, growthProposal, validateGrowthGraph, withGrowthGraphs, runGraphsOf } from './packs.js';
export type { Pack, PackContract, PackGraph, PackNode, PackEdge, PackTool, PackWorkshop, PackAgentTeam, PackAgentTeamMember, PackKnowledgeManifest, ContractOutput, PackCheck, PackOverview, PackAuthorStatus, ChooserCheck, KnowledgeCheck, WorkshopCheck, PackDataAt, GrowthProposal, GrowthGraph, GrowthGraphValidation } from './packs.js';
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
export { readEngineeringAsset, startRun, resumeRun, executionAction, executionContext, revisionImpactOf, authenticCampaignProposalId } from './fabric.js';
export { cancelRun, reconcileRuns } from './recovery.js';
// Model moments (#59): the one generic element a model needs, on the surface because the contract
// suite and the live check both open one, and because the acceptance record names the preset.
export { openMoment, momentOnCurrentNode, closeInterruptedMoments, openMomentsIn, nextMomentAttempt, HIMA_MOMENT_PRESET } from './moments.js';
export type { Moment, MomentDeps, MomentRequest, MomentTurn, MomentOnNode } from './moments.js';
export { MomentTurnError, NoCurrentNodeError, SiteUnreadableError } from './errors.js';
export { writeExperience, readExperience, readMaterial, retainRunMaterial, writeRunAssets, readRunAssets, readArchivedMaterial, listRunKnowledge, readRunKnowledge, HISTORY_SUMMARY_CAP, HISTORY_READ_CAP } from './experience.js';
export type { WriteExperienceResult, ReadExperienceResult, WriteRunAssetsResult, ReadRunAssetsResult, ReadArchivedMaterialResult, RunKnowledgeCandidate, RunKnowledgeList, ReadRunKnowledgeResult } from './experience.js';
export { RUN_ASSET_MANIFEST_SCHEMA } from './experience-report.js';
export type { RunAssetManifest, ExperienceAsset } from './experience-report.js';
export { humanEffortMeasurement, valueMeasurementReceipt, VALUE_MEASUREMENT_SCHEMA } from './value-measurement.js';
export type { HumanEffortMeasurement, ValueMeasurementReceipt, MeasuredCount, MeasuredDuration, SeatTimeMeasurement, UnmeasuredValue } from './value-measurement.js';
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
export { startLocalDatabase, localDatabaseHome, localDatabaseRuntime, POSTGRES_VERSION } from './local-database.js';
export type { LocalDatabase, LocalDatabaseConnection } from './local-database.js';
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
export { taskStateForNode, taskCanRespond, runStatusSaid, runCanControl, runSnapshotOlder, goalSaid, sealSaid, nodeCaption, jobFolded, absentSaid } from './card-labels.js';

// The node card's own pure layout and tab-set facts (#41 task 6): on the surface so its L1 tests
// (`test/contract/canvas-layout.test.ts`) can assert on the same functions `client/NodeCard.tsx`
// renders from, without pulling React/JSX into the host bundle to do it.
export { cardPosition, TABS_BY_KIND, NODE_CARD_WIDTH, NODE_CARD_HEIGHT } from './node-card-layout.js';
export type { NodeCardTabKey } from './node-card-layout.js';

// What the ledger holds, for a caller reading records back through the namespace. `hasEnded` is the
// one predicate over a Run's status every face shares: what counts as an ending is the ledger's to
// say, not each caller's.
export { hasEnded, ledgerSpec, runIdPattern, importLegacyLedger, revisionRecordsIn, recordValidityOf, currentRecordsIn, retainedRecordMaterial } from './ledger.js';
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
export { launchJob, reconcileLaunchIntent, jobStatus, jobKill, nodeLogTail, nodeLogTailMaxLines } from './jobs.js';
export type { LaunchIntent, JobDeps, LaunchRequest, LaunchResult, ReconciledLaunch, NodeLogTailResult } from './jobs.js';
export { claimSlot, claimSlotAndLaunch } from './job-cap.js';
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
  /** Administrator-owned exact adapter/environment qualification file; absent means unavailable. */
  interactiveBindingsFile?: string;
}

/** Stable, role-neutral product knowledge shared by Guide, owner and bounded children.
 *
 * Role-specific duties come from the dynamic inventory and the retained delegation contract. Keeping
 * this section neutral prevents a child Operator from inheriting HimaGuide or Campaign-owner identity.
 */
export const HIMA_PRODUCT_CONTEXT = [
  'HimaHarness adds governed chip-design Campaigns and Data Insight to DeepSeek Harness. A HimaPack declares one transparent method; a Site supplies the permitted execution environment; one persistent Run records facts, work and evidence.',
  'Your current role, task, inputs, tools, budget and recipient are stated separately. Follow that exact role: a Guide serves the person, a Campaign owner coordinates the Run, and a bounded child performs only its delegated work.',
  'Use only granted inputs and tools. Do not search product source code to rediscover a Pack or tool contract; report a missing professional fact or capability to the recipient instead.',
  'For a declared resident engineering task, the workflow starts the Site executor, collects its contract-checked delivery and closes its resources automatically. The Campaign owner may use hima_execute engineering message on the recorded execution to give business steering, and hima_context to inspect current facts. A status reply is one snapshot: when no actionable fact changed, explain that work remains active and yield instead of busy-polling. The external engineering session executes this task and does not acquire Run ownership.',
  'Tool receipts and refreshed engineering evidence are authoritative. Preserve setup/hold units and conditions, distinguish unknown from failure, and never repeat an effect whose outcome is uncertain.',
  'Keep default replies focused on the engineering result, missing evidence and next useful action; internal protocol detail belongs in retained evidence.',
].join('\n');

/** The small, current snapshot that accompanies ordinary root-Agent turns. No local path, YAML,
 * Run id or customer material is exposed. Read afresh for every prompt assembly. */
export function himaRuntimeContext(ledger: Ledger, packsDir: string, sitesDir: string, visibleRuns?: readonly RunRecord[]): string {
  const packs = installedPacks(packsDir);
  const sites = installedSites(sitesDir);
  const active = (visibleRuns ?? ledger.runs()).filter((run) => !hasEnded(run.status)).slice(-5);
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

/** The tool an act node of `pack` runs, when `nodeId` names one. */
function nodeTool(pack: import('./packs.js').Pack, nodeId: string): import('./packs.js').PackTool | undefined {
  const node = pack.graph.nodes.find(item => item.id === nodeId);
  return node?.kind === 'act' && node.parameters.tool ? pack.contract.tools.find(item => item.id === node.parameters.tool) : undefined;
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
  static Config = z.object({ sitesDir: z.string().required(), packsDir: z.string().required(), knowledgeDir: z.string().required(), interactiveBindingsFile:z.string() });

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
  /** DBOS owns new durable workflows; its store is the application fact authority. */
  durable!: DurableRuntime;
  private releaseDurableAdapters!: () => void;
  private readonly durableAdaptersReady = new Promise<void>(resolve => { this.releaseDurableAdapters = resolve; });
  private notificationsActive = false;
  private exitRequest: HostExitRequest | undefined;
  private closeHostResources!:()=>Promise<void>;
  private resourcesClosing:Promise<void>|undefined;
  private exitFinalization:Promise<HostExitStatus>|undefined;
  private finalizationRequestId:string|undefined;
  private finalExitStatus:HostExitStatus|undefined;
  private interactiveRuntime:InteractiveRuntimeDeps|undefined;
  private taskInteractiveRuntime:TaskInteractiveDeps|undefined;
  private interactiveTimers:InteractiveTimerController|undefined;
  private readonly recoveredOwners = new Set<string>();
  private readonly delegationTimers = new Map<string,ReturnType<typeof setTimeout>>();
  ownerRecovery: Promise<void> = Promise.resolve();
  /** One ordinary execution-fact wake-up per owner/Run while it is still pending in dsh's inbox.
   *  The ledger remains the fact authority; replacing this hint loses no execution evidence and
   *  prevents a fast Run from producing more durable turns than its Agent can consume. */
  private readonly pendingProgressNotifications = new Map<string, MessageId>();
  private readonly guideNoticeIdentities = new Map<string,string>();
  private readonly factStop = new AbortController();
  private factProjection:Promise<void>=Promise.resolve();
  private factNotifications:Promise<void>=Promise.resolve();
  private readonly notifiedSourceRevisions=new Map<string,number>();
  /** The Harness's own driver of Pack-declared autopilot regions (ADR-0016). */
  private autopilot: Autopilot | undefined;
  private autopilotStopped = false;
  /** Browser-only Site drafts awaiting the same person's explicit Save. The reviewed result stays
   *  on the Host, so saving cannot silently rerun probes and persist facts the person never saw. */
  private readonly siteDiscoveryReviews = new Map<string, { readonly owner: string; readonly name: string; readonly result: SiteDiscoveryResult; readonly identity: SiteSaveIdentity }>();

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'hima');
  }

  async [Service.init](): Promise<void> {
    let databaseStarting: Promise<LocalDatabase>;
    let domainStarting: Promise<{ close(): void | Promise<void> }> | undefined;
    let durableStarting: Promise<DurableRuntime> | undefined;
    let closing = false;
    let closeHostResources = async () => {
      const database = await databaseStarting;
      const durable = await durableStarting?.catch(() => undefined);
      if (durable) await durable.stop();
      try { if (domainStarting) await (await domainStarting).close(); }
      finally { await database.stop(); }
    };
    // Cordis disposes independent effects concurrently: one ordered disposer owns both the
    // application resources and PostgreSQL. Register before starting either resource: mid-boot
    // disposal waits for their actual creation and then closes them instead of missing their owner.
    this.closeHostResources=()=>this.resourcesClosing??=(async()=>{
      closing=true;
      try {
        await closeHostResources();
        await new Promise<void>(resolve=>process.stderr.write(`hima: resource shutdown confirmed; pid=${process.pid}\n`,()=>resolve()));
      } catch(error) {
        await new Promise<void>(resolve=>process.stderr.write(`hima: resource shutdown unconfirmed; pid=${process.pid}\n`,()=>resolve()));
        throw error;
      }
    })();
    this.ctx.effect(()=>()=>this.closeHostResources(),'hima: Host and local database lifetime');
    // The same product-owned lifecycle is used by the headless profile and Electron's Host.
    databaseStarting = startLocalDatabase({ home: localDatabaseHome(), runtimeDirectory: localDatabaseRuntime() });
    const database = await databaseStarting;
    if (closing) return;
    const openingDomain = this.ctx.storageDomain.open(ledgerSpec);
    domainStarting = openingDomain;
    const domain = await openingDomain;
    if (closing) return;
    this.ledger = new Ledger(domain);
    const manifest = await installedExecutableManifest();
    if (closing) return;
    const interactiveBridge = createInteractiveBindingBridge({ packsDir: this.config.packsDir, sitesDir: this.config.sitesDir,
      interactiveBindingsFile: this.config.interactiveBindingsFile });
    const workflows = [
      ...preparationWorkflowDefinitions({ sitesDir: this.config.sitesDir }),
      ...flowWorkflowDefinitions({ resolveAdapter: async context => {
        await this.durableAdaptersReady;
        return resolveDurableTaskAdapter(context, { ctx: this.ctx, sitesDir: this.config.sitesDir,
          retainedMaterialsDir: path.join(localDatabaseHome(), 'hima', 'run-assets', 'dbos'),
          interactive: { bridge: interactiveBridge,
            ...(testFixtureCanRunHere() && process.env.HIMA_TEST_INTERACTIVE_BINDING_ID
              ? { trustedTestQualification: { bindingId: process.env.HIMA_TEST_INTERACTIVE_BINDING_ID } } : {}) } });
      } }),
    ];
    durableStarting = startDurableRuntime({ database, manifest, workflows });
    this.durable = await durableStarting;
    if (closing) return;
    closeHostResources = async () => {
      await this.durable.stop();
      try { await domain.close(); }
      finally { await database.stop(); }
    };
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
      text: context => {
        const agent = (context as { agent?: import('@deepseek-ai/dsh-agent').Agent }).agent;
        if (!agent) return himaRuntimeContext(this.ledger, this.config.packsDir, this.config.sitesDir);
        const id = String(agent.id);
        const childPolicy=delegationRuntimePolicy(this.deps(),id);
        if(childPolicy)return JSON.stringify({role:childPolicy.effective.role,delegation:childPolicy,source:'Ledger delegation admission',note:'You are a bounded child, not the Campaign owner or Guide. Return candidate evidence; do not adopt results or change authority.'});
        const linked = this.ledger.runs().filter(run => run.control?.owner === id || run.control?.guideSessionId === id);
        const role=linked.some(run => run.control?.owner === id)?'execution-owner':'guide';
        const roleInstruction=role==='execution-owner'
          ? 'Role: Campaign owner. Coordinate the retained Pack method, children and tools for your Run; use current Ledger evidence and ask the person only for a genuine business decision or authority expansion.'
          : 'Role: HimaGuide. Help the person understand capabilities, prepare Pack/Site/inputs, arrange a separate execution conversation, and explain sourced results. Do not become a Run owner.';
        return [himaRuntimeContext(this.ledger, this.config.packsDir, this.config.sitesDir, linked),
          roleInstruction,
          'This task inventory includes only this conversation\'s recorded assignments. Other selected targets must be inspected explicitly.',
          JSON.stringify({ asOf: new Date().toISOString(), sessionId: id,
            role,
            assignments: linked.slice(-5).map(run => ({ runId: run.id, source: 'Ledger RunControl', owner: run.control?.owner,
              epoch: run.control?.epoch, revision: run.control?.revision, paused: run.control?.paused, status: run.status })) })].join('\n');
      },
    }), 'hima: current product inventory');
    this.ctx.effect(() => { this.notificationsActive = true; return () => { this.notificationsActive = false; }; });
    // The judge takes the ledger's one verdict-writer capability here; nothing else can obtain it.
    this.judge = createJudge(this.ledger, this.config.packsDir);
    // Legacy records remain readable. Only DBOS advances new Runs; no old dispatcher is started.
    closeHostResources = async () => {
      this.notificationsActive = false;
      this.pendingProgressNotifications.clear();
      for(const timer of this.delegationTimers.values())clearTimeout(timer);this.delegationTimers.clear();
      this.interactiveTimers?.dispose();
      this.autopilotStopped = true;
      this.factStop.abort();
      await this.autopilot?.drain();
      await drainExecutionObservers(this.ledger);
      await this.reconciled?.catch(() => undefined);
      await Promise.all([this.factProjection,this.factNotifications]);
      await this.durable.stop();
      await domain.close();
      await database.stop();
    };
    // The HimaGuide face: the Hima namespace, mounted only where a browser surface is composed.
    // A headless host has no web server and no browser session to guard it with, and still works.
    this.ctx.inject(['webServer', 'connection'], (webCtx) => {
      webCtx.effect(
        () => registerHimaRoutes(webCtx, {
          ledger: this.ledger,
          readRunView: runId=>this.viewReaders().readRunView(runId),
          listRunHeads: ()=>this.viewReaders().listRunHeads(),
          readRunRecord: recordId=>this.viewReaders().readRunRecord(recordId),
          readRunRecords: (runId,type)=>this.viewReaders().readRunRecords(runId,type),
          prepareExit: request=>this.prepareExit(request),
          exitStatus: ()=>this.exitStatus(),
          finishExit: id=>this.finishExit(id),
          cancelExit: id=>this.cancelExit(id),
          authorizeDesktopExit: token=>this.authorizeDesktopExit(token),
          validateSession: (id) => this.ctx.get('agents')?.list().some((agent) => String(agent.id) === id) === true,
          sessionWorkspace: (id) => this.sessionWorkspace(id),
          authorizeRunAccess: (sessionId, runId) => authorizeProjectRun(this.guideDeps(), sessionId, runId),
          readGuideContext: request => readGuideContext(this.guideDeps(), request),
          readSessionContext: request=>readNativeSessionContext(this.ctx,request,this.ledger,this.viewReaders().assignedGuide),
          resolveReportAddress: (sessionId, ref) => resolveReportAddress(this.guideDeps(), sessionId, ref),
          listSessionChildren: request => listSessionChildren(this.ctx, {...request,assignedGuide:this.viewReaders().assignedGuide}),
          workMemory: (sessionId, request) => this.workMemory(sessionId, request, 'person'),
          correctExperience: (sessionId, request) => this.correctExperience(sessionId, request),
          experienceCandidates: (sessionId,runId)=>this.experienceCandidates(sessionId,runId),
          delegations: (sessionId,runId)=>this.delegations(sessionId,runId),
          delegate: request=>this.delegate(request),
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
          interactive:(sessionId,request)=>this.interactive(sessionId,request),
          interactiveSessions:(sessionId,runId)=>this.interactiveSessions(sessionId,runId),
          executionContext: (runId) => this.viewReaders().executionContext(runId),
          executionAction: (request) => this.executionAction(request),
          observe: (req) => this.observe(req),
          judge: (runId, ruleIds, params) => this.judge.evaluate({ runId, ruleIds, params }),
          startRun: (req) => this.startGuidedRun(req),
          resumeRun: (runId, who) => this.resumeRun(runId, who),
          cancelRun: (runId) => this.cancelRun(runId),
          readExperience: (runId) => this.readExperience(runId),
          readMaterial: (runId, recordId) => this.readMaterial(runId, recordId),
          readRunAssets: (runId) => readRunAssets(this.deps(), runId),
          readTaskArtifact: (runId,effectId,name) => this.viewReaders().readTaskArtifact(runId,effectId,name),
          readEngineeringAsset: (runId, executionId, requestId, artifactId, treeId, download) => readEngineeringAsset(this.deps(), runId, executionId, requestId, artifactId, treeId, download),
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
      (request) => this.startGuidedRun(request),
    )) this.ctx.effect(() => this.ctx.tools.register(tool));
    for (const tool of guideTools({
      inspect: (sessionId, requestId, target) => readGuideContext(this.guideDeps(), { sessionId, requestId, target }),
      memory: (sessionId, request) => this.workMemory(sessionId, request, 'model'),
      delegate: request=>this.delegate(request),
      delegationInput:(sessionId,request)=>this.delegationInput(sessionId,request),
      interactive:(sessionId,request)=>this.interactive(sessionId,request),
    })) this.ctx.effect(() => this.ctx.tools.register(tool));
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
    this.ctx.effect(() => this.ctx.tools.guard(execution => terminalDenial(execution, this.ledger)), 'hima: raw shell and terminals stay outside Campaign execution');
    this.ctx.effect(()=>registerDelegationGuard(this.ctx,id=>delegationRuntimePolicy(this.deps(),id)),'hima: delegated tool grants');
    this.ctx.effect(()=>registerAsyncDelegationGuard(this.ctx,async id=>{
      const policy=await nativeDelegationPolicy(this.durable.store,id);
      if(!policy&&(await this.durableConversationAuthority(id)).uncontracted)
        throw new Error('A child of a retained Campaign needs a recorded native task delegation contract.');
      return policy;
    }),'hima: durable native task grants');
    this.ctx.effect(() => this.ctx.on('tools/execute', async (execution, next) => {
      if (execution.agent && (execution.name === SHELL_TOOL || (TERMINAL_TOOLS as readonly string[]).includes(execution.name)
        || ['subagent','subagent_fork'].includes(execution.name))) {
        if ((await this.durableConversationAuthority(String(execution.agent.id))).retained)
          throw new Error('This conversation belongs to a retained Campaign. Use its recorded task delegation and qualified Site tools; raw child creation, shell and terminal access do not acquire task authority.');
      }
      return next();
    }), 'hima: durable Campaign child and terminal authority');
    this.ctx.effect(() => (this.ctx as unknown as { on(name: 'system-prompt/assemble', listener:
      (assembly: { contexts: { name: string; text: string }[] }, context: { agent?: import('@deepseek-ai/dsh-agent').Agent },
        next: () => Promise<{ contexts: { name: string; text: string }[] }>) => Promise<{ contexts: { name: string; text: string }[] }>): () => void })
      .on('system-prompt/assemble', async (_assembly, context, next) => {
        const assembled = await next();
        if (!context.agent) return assembled;
        const actor = String(context.agent.id), owned = await this.durable.store.runsForOwner(actor);
        const guided = (await this.durable.store.runs()).filter(run =>
          (run.opening.data as { product?: { guideSessionId?: string } }).product?.guideSessionId === actor);
        if (!owned.length && !guided.length) return assembled;
        const assignments = [...new Map([...owned, ...guided].map(run => [run.runId, run])).values()];
        const role = owned.some(run => run.owner === actor) ? 'execution-owner' : owned.length ? 'former-owner' : 'guide';
        const inventory = assembled.contexts.find(item => item.name === 'hima:inventory');
        if (inventory) inventory.text = JSON.stringify({ role, sessionId: actor, source: 'hima-postgresql',
          assignments: assignments.map(run => ({ runId: run.runId, owner: run.owner, epoch: run.epoch,
            revision: run.revision, hold: run.hold, cancelled: run.cancelled })),
          note: role === 'execution-owner'
            ? 'Understand the goal, discuss business decisions and inspect current task evidence. The workflow advances automatically after verified results and resource closure; do not call begin/work/complete for mechanical progression.'
            : role === 'former-owner' ? 'Ownership has moved. You can explain retained evidence; a former assignment grants no current business execution authority.'
              : 'Remain the independent Guide. Inspect sourced task progress and help the person reach the assigned owner; viewing a Run does not transfer ownership.' });
        return assembled;
      }), 'hima: durable conversation roles');
    this.ctx.effect(()=>this.ctx.tools.guard(execution=>{
      const agent=execution.agent;if(!agent)return;
      const parent=agent.session.header.parentSession;
      if(parent&&this.ledger.runs().some(r=>r.control?.owner===String(parent))&&!delegationRuntimePolicy(this.deps(),String(agent.id)))return 'A child of a Campaign owner needs a recorded Hima delegation contract.';
      if(this.ledger.runs().some(r=>r.control?.owner===String(agent.id))&&['subagent','subagent_fork'].includes(execution.name))return 'Use hima_delegate so this Run owns the child budget and write grant.';
    }),'hima: native child creation does not bypass Run delegation');
    this.syncDelegationDeadlines();
    // Last, and deliberately not awaited: every Run the last process left in flight is picked up
    // again from the ledger and carried on. The host serves while that happens — a Run resumed here
    // may have an hour of synthesis still to wait for, and a workbench that would not answer until
    // then is one nobody could cancel from.
    this.reconciled = this.durableAdaptersReady.then(() => recoverDurablePreparations(this.durable)).then(async () => {
      const previous=await this.durable.store.hostExit();
      if(previous)await this.durable.store.releaseHostExit(previous.requestId,true);
      return [];
    });
    void this.reconciled.catch(error => this.ctx.logger.warn(`Durable preparation recovery remains unavailable: ${String(error)}`));
    this.ctx.inject(['sessionController'], nativeCtx => {
      nativeCtx.effect(() => {
        this.ownerRecovery=this.reconciled.then(()=>this.recoverOwners());
        void this.ownerRecovery.catch(error=>this.ctx.logger.warn(`Owner recovery remains unavailable: ${String(error)}`));
        return ()=>{};
      });
    });
    this.releaseDurableAdapters();
    this.factProjection=this.observeDurableFacts('history',()=>this.projectDurableHistory());
    this.factNotifications=this.observeDurableFacts('notifications',()=>this.deliverDurableBoundaries());
  }

  /**
   * An interactive session whose Operator no longer holds its authority — its delegation expired,
   * was cancelled, completed or never became live — has nobody left who may type into it, and holds
   * its Site slot and licence seats until something stops it (#64 D-T02-5: w04–w06 of attempt 2 stayed
   * open for an hour after the App relaunch). Such a session is closed once, through the same
   * process-group close any close takes, under a request id derived from the session, so a later
   * pass or a later restart finds that close's receipt and does nothing again; the Job's own records
   * settle its execution and the owner is told once. A session whose Operator still holds its
   * authority is re-attached as it stands: its deadlines are projected again and the Host's own
   * deadline stop ends it if nobody drives it. A session the owner opened itself belongs to the
   * recovered owner. A `process-survived` session is a person's blocker and is not touched again.
   * Asked when a Host starts and each time an Operator's delegation deadline is recorded.
   */
  private async closeUndrivableInteractiveSessions(runId?:string):Promise<void> {
    const runtime=this.interactiveDeps();
    const closes:Promise<void>[]=[];
    for(const run of this.ledger.runs()) {
      if(runId!==undefined&&run.id!==runId)continue;
      const control=run.control;if(!control||(run.status!=='running'&&run.status!=='waiting'))continue;
      for(const session of listInteractiveSessions(this.ledger,run.id)) {
        if(session.status==='closed'||session.status==='intent'||session.job===undefined||session.survivedPid!==undefined)continue;
        if(session.operatorSessionId===control.owner)continue;
        if(operatorInteractiveAuthority(this.deps(),session.operatorSessionId,{runId:run.id,nodeId:session.nodeId,executionId:session.executionId})!==undefined)continue;
        const requestId=`operator-ended-close-${session.toolSessionId}`.slice(0,160);
        if(this.ledger.records({runId:run.id,type:'interactive'}).some(record=>record.type==='interactive'&&record.requestId===requestId))continue;
        closes.push((async()=>{
          const result=await operateInteractive(runtime,{runId:run.id,executionId:session.executionId,nodeId:session.nodeId,toolSessionId:session.toolSessionId,
            actor:control.owner,ownerEpoch:control.epoch,controlRevision:control.revision,requestId,hostStop:'recovery',action:'close'});
          this.ctx.logger.info(`hima: interactive session ${session.toolSessionId} of ${run.id} without a live Operator: ${JSON.stringify(result)}`);
          if(result.status==='duplicate'||this.autopilotNode(run.id,session.nodeId))return;
          this.deps().notify?.(control.owner,run.id,session.executionId,result.status==='refused'
            ?`Interactive session ${session.toolSessionId} of node ${session.nodeId} has no Operator that may still drive it, and the Host could not close it: ${result.reason}`
            :`Interactive session ${session.toolSessionId} of node ${session.nodeId} has no Operator that may still drive it; the Host closed it (${result.status}). Its execution settles from the Job's own records; inspect them before a retry.`);
        })().catch(error=>this.ctx.logger.warn(`hima: closing interactive session ${session.toolSessionId} of ${run.id} failed: ${String(error)}`)));
      }
    }
    await Promise.all(closes);
  }

  /** Persisted ancestry carries Campaign responsibility through raw descendants and reopening.
   * Only an exact PG native grant authorizes a child; lineage itself never grants execution. */
  private async durableConversationAuthority(sessionId:string):Promise<{retained:boolean;uncontracted:boolean}> {
    const owner=(await this.durable.store.runsForOwner(sessionId)).length>0;
    const granted=await this.durable.store.nativeSessionEffect(sessionId)!==undefined;
    if(owner||granted)return {retained:true,uncontracted:false};
    const persistence=this.ctx.get('sessionPersistence') as {stat(id:string):Promise<{header:{parentSession?:string}}|undefined>}|undefined;
    const seen=new Set<string>();
    let current:string|undefined=sessionId;
    while(current!==undefined){
      if(seen.has(current))throw new Error('Uncontracted conversation has cyclic retained ancestry.');
      seen.add(current);
      const live:import('@deepseek-ai/dsh-agent').Agent|undefined=this.ctx.get('agents')?.get(current as never);
      const header:{readonly parentSession?:string}|undefined=live?.session.header??(await persistence?.stat(current))?.header;
      current=header?.parentSession===undefined?undefined:String(header.parentSession);
      if(current!==undefined&&((await this.durable.store.runsForOwner(current)).length>0
        ||await this.durable.store.nativeSessionEffect(current)!==undefined))return {retained:true,uncontracted:true};
    }
    return {retained:false,uncontracted:false};
  }

  /** Restore the exact recorded native conversations; DBOS alone resumes their business tasks. */
  private async recoverOwners(): Promise<void> {
    const persistence = this.ctx.get('sessionPersistence') as { stat(id: string): Promise<{ header: { cwd?: string; agentPreset?: string; parentSession?: string } } | undefined> } | undefined;
    const controller = this.ctx.get('sessionController') as { create(req: { sessionId: string; cwd?: string; workspaceId?: string; agentPreset?: string }): Promise<{ sessionId: string }> } | undefined;
    const registry = this.ctx.get('workspaceRegistry') as { list(): { id: string; path: string; sessionIds: readonly string[] }[] } | undefined;
    if (!persistence || !controller) return;
    for (const run of await this.durable.store.runs()) {
      const product = (run.opening.data as { product?: { parentSessionId?: string } }).product;
      if (!product?.parentSessionId || run.cancelled) continue;
      // Original parent lineage survives handoff; the current owner has separate business authority.
      for (const sessionId of new Set([product.parentSessionId, run.owner])) {
        const key = `${run.runId}:${run.epoch}:${sessionId}`;
        if (this.recoveredOwners.has(key)) continue;
        if (this.ctx.get('agents')?.get(sessionId as never)) { this.recoveredOwners.add(key); continue; }
        try {
          const old = await persistence.stat(sessionId);
          if (!old?.header.cwd || old.header.parentSession) continue;
          const membership = registry?.list().find(workspace => workspace.sessionIds.includes(sessionId));
          if (membership && membership.path !== old.header.cwd) continue;
          await controller.create({ sessionId, ...(membership ? { workspaceId: membership.id } : { cwd: old.header.cwd }),
            ...(old.header.agentPreset ? { agentPreset: old.header.agentPreset } : {}) });
          if (this.factStop.signal.aborted || this.exitRequest) return;
          this.recoveredOwners.add(key);
        } catch(error) {
          this.ctx.logger.warn(`Conversation ${sessionId} for Run ${run.runId} could not be restored: ${String(error)}`);
        }
      }
    }
  }

  // The operations, as the service's own methods: what the routes are given, and what a caller
  // holding `ctx.hima` reaches. Each is the module operation with this host's dependencies handed
  // to it, and none of them decides anything of its own.

  observe(req: ObserveRequest): Promise<ObserveResult> {
    return observe(this.deps(), req);
  }

  startRun(request: StartRunRequest): Promise<StartRunResult> {
    if (this.exitRequest) return Promise.reject(new Error('the App is closing; no new Campaign may start'));
    return startRun(this.deps(), request).then(started => { if (started.kind === 'ran') this.autopilot?.kick(started.run.id); return started; });
  }

  /** What the autopilot told each Run's owner, oldest first (ADR-0016); for inspection and tests. */
  autopilotNotices(runId: string): readonly string[] { return this.autopilot?.notices(runId) ?? []; }

  /** Whether the Pack's autopilot drives this node of this Run. */
  private autopilotNode(runId: string, nodeId: string): boolean {
    const run = this.ledger.run(runId);
    if (!run?.control) return false;
    try { return autopilotDrives(executionPack(this.deps(), run), nodeId); } catch { return false; }
  }

  readExecutionContext(runId: string) { return readExecutionContext(this.deps(), runId); }
  controlDurableRun(command: DurableCommand) { return controlDurableRun(this.deps(), command); }

  private viewReaders() {
    return createDurableViewReaders(this.deps(),{retainedMaterialsDir:path.join(localDatabaseHome(),'hima','run-assets','dbos')});
  }

  private guideDeps() {
    const readers=this.viewReaders();
    return { ctx: this.ctx, ledger: this.ledger,
      executionContext: readers.executionContext,readRun:readers.readRun,readRunRecord:readers.readRunRecord,assignedGuide:readers.assignedGuide,
      readExperience: readers.readExperience,readReportMaterial:readers.readReportMaterial,readTaskArtifact:readers.readTaskArtifact };
  }

  async workMemory(sessionId: string, request: { action: 'read' | 'sources' | 'save'; runId?: string; summary?: unknown }, authoredBy: 'model' | 'person' = 'person'): Promise<object> {
    const workspaceRef = await sessionProject(this.ctx, sessionId, true);
    if (request.runId) await authorizeProjectRun(this.guideDeps(), sessionId, request.runId);
    const parentSessionId=this.ctx.get('agents')?.get(sessionId as never)?.session.header.parentSession;
    const scope: WorkMemoryScope = request.runId ? { kind: 'campaign', workspaceRef, runId: request.runId }
      : parentSessionId?{kind:'child',workspaceRef,sessionId,parentSessionId:String(parentSessionId)}:{ kind: 'session', workspaceRef, sessionId };
    if(request.action==='sources') {
      if(request.runId)return {kind:'sources',scope,...workMemoryEvidence(this.ledger,request.runId),nativeSources:[]};
      const native=await nativeSessionMemoryEvidence(this.ctx,{sessionId,workspaceRef,...(parentSessionId?{parentSessionId:String(parentSessionId)}:{})});
      const {workspaceRef: _workspace,parentSessionId: _parent,currentThroughSeq: _current,...source}=native;
      return {kind:'sources',scope,references:[],sources:[],nativeSources:[source]};
    }
    const checkSources = async (summary: { sources: readonly { runId: string }[] }) => {
      for (const source of summary.sources) await authorizeProjectRun(this.guideDeps(), sessionId, source.runId);
    };
    if (request.action === 'save') {
      const packs = path.resolve(this.config.packsDir);
      if (workspaceRef === packs || workspaceRef.startsWith(`${packs}${path.sep}`)) throw new BadRequest('working summaries do not modify an installed Pack; use the separate project workspace');
      if (!request.summary || typeof request.summary !== 'object' || Array.isArray(request.summary)) throw new BadRequest('saving memory needs a source-linked summary');
      const summary = request.summary as Record<string, unknown>;
      if (!Array.isArray(summary.sources) || summary.sources.some(source => !source || typeof source !== 'object' || typeof source.runId !== 'string')) throw new BadRequest('summary sources must name recorded project Runs');
      await checkSources(summary as { sources: { runId: string }[] });
      await writeWorkMemorySummary(this.ledger, workspaceRef, { ...summary, schema: 'hima-work-memory/1', generatedAt:new Date().toISOString(), scope, modelGenerated: authoredBy === 'model' }, source => nativeSessionMemoryEvidence(this.ctx, source));
    }
    const result = await readWorkMemorySummary(this.ledger, workspaceRef, scope, source => nativeSessionMemoryEvidence(this.ctx, source));
    if ('summary' in result) {await checkSources(result.summary);return {...result,scope:result.summary.scope,references:result.summary.references,sources:result.summary.sources,nativeSources:result.summary.nativeSources??[]};}
    return {...result,scope};
  }

  async correctExperience(sessionId: string, request: Omit<ExperienceAdoptionRequest, 'workspaceRef' | 'changedBy'>) {
    const workspaceRef = await authorizeProjectRun(this.guideDeps(), sessionId, request.runId);
    await authorizeProjectRun(this.guideDeps(), sessionId, request.candidate.sourceRun);
    return recordExperienceAdoption(this.deps(), { ...request, workspaceRef, changedBy: sessionId });
  }

  private authorizeDesktopExit(token: string | undefined): boolean {
    const expected = process.env.HIMA_DESKTOP_CONTROL_TOKEN;
    if (!expected || !token || !/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(token)) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
  }

  async prepareExit(request: HostExitRequest): Promise<HostExitStatus> {
    if(this.resourcesClosing)throw new BadRequest('Host resources are finalizing; no new exit operation is allowed');
    if(!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,120}$/.test(request.requestId)||(request.expectedRequestId!==undefined&&!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,120}$/.test(request.expectedRequestId))||!['drain','keep-jobs','stop-jobs'].includes(request.mode))throw new BadRequest('invalid App exit request');
    await this.reconciled;
    await this.durable.store.acceptHostExit(request);
    this.exitRequest=request;
    if(request.mode==='stop-jobs') {
      // Reuse finite cleanup of the original identities; do not cancel the whole Run.
      const work=(async()=>{
        for(const run of await this.durable.store.runs()) {
          for(const invocation of await this.durable.store.flowInvocations(run.runId)) {
            const active=await this.durable.store.hostExit();
            if(active?.requestId!==request.requestId||active.mode!=='stop-jobs')return;
            const physical=await this.durable.store.flowPhysicalFacts(run.runId);
            const owned=[invocation.identity,...(await this.durable.store.derivedEffects(invocation.identity)).map(effect=>effect.identity)];
            if(!physical.effects.some(effect=>owned.some(identity=>identity.effectId===effect.identity.effectId)&&effect.dispatches.some(dispatch=>!dispatch.dispatchId.startsWith('stop:')&&!dispatch.dispatchId.startsWith('cleanup:'))))continue;
            const handle=await this.durable.startWorkflow('hima.flow.cleanup',`hima-app-exit:${identityOf([request.requestId,invocation.identity.effectId])}`,
              {runId:run.runId,invocation:invocation as unknown as import('./task-contract.js').JsonValue,reason:'app-exit',exitRequestId:request.requestId});
            const result=await handle.getResult() as {closed?:boolean;reason?:string};
            if(!result.closed) {
              const active=await this.durable.store.hostExit();
              if(active?.requestId!==request.requestId||active.mode!=='stop-jobs')return;
              await this.durable.store.putFlowFact(run.runId,`app-exit-failed:${request.requestId}`,result as import('./task-contract.js').JsonValue);
              throw new Error(result.reason??'Original stop closure is unproved');
            }
          }
        }
        await this.durable.store.withHostExitStopBoundary(request.requestId,()=>{
          for(const agent of this.ctx.get('agents')?.list()??[])agent.cancel({kind:'hook',reason:'App exit requested stopping active work'});
        });
      })();
      void work.catch(async error=>{
        try { if((await this.durable.store.hostExit())?.requestId===request.requestId)await this.cancelExit(request.requestId); }
        catch(releaseError){this.ctx.logger.warn(`App exit stop failed and its fence release failed: ${String(releaseError)}`);}
        this.ctx.logger.warn(`App exit stop failed: ${String(error)}`);
      });
    }
    return this.exitStatus();
  }

  async cancelExit(requestId:string):Promise<HostExitStatus> {
    if(this.resourcesClosing)throw new BadRequest('Host resources are finalizing; exit cannot be cancelled');
    await this.durable.store.releaseHostExit(requestId);
    this.exitRequest=undefined;return this.exitStatus();
  }

  exitStatus():Promise<HostExitStatus> {
    if(this.finalExitStatus)return Promise.resolve(this.finalExitStatus);
    return readDurableHostExitStatus(this.durable.store,this.ctx.get('agents'));
  }

  /** Finish owned resources while the native transport still serves, before SIGTERM starts
   * the vendor's unrelated five-second whole-tree deadline. One closer owns both paths. */
  async finishExit(requestId:string):Promise<HostExitStatus> {
    if(this.exitFinalization) {
      if(this.finalizationRequestId!==requestId)throw new BadRequest('App exit finalization request is stale');
      return this.exitFinalization;
    }
    this.finalizationRequestId=requestId;
    this.exitFinalization=(async()=>{
      await this.reconciled;
      const state=await this.exitStatus();
      if(state.requestId!==requestId)throw new BadRequest('App exit finalization request is stale');
      if(!state.ready)throw new BadRequest('App exit has not reached its actual resource boundary');
      await this.durable.store.beginHostExitFinalization(requestId);
      this.finalExitStatus={...state,finalized:false};
      try {
        await this.closeHostResources();
        return this.finalExitStatus={...state,finalized:true};
      } catch(error) {
        this.finalExitStatus={...state,ready:false,finalized:false};
        throw error;
      }
    })();
    try {return await this.exitFinalization;}
    catch(error) {
      if(!this.resourcesClosing){this.exitFinalization=undefined;this.finalizationRequestId=undefined;}
      throw error;
    }
  }

  async experienceCandidates(sessionId:string,runId:string):Promise<object> {
    const workspaceRef=await authorizeProjectRun(this.guideDeps(),sessionId,runId);
    const history=await listRunKnowledge(this.deps(),runId,undefined,[],workspaceRef);
    const availableEvidence=workMemoryEvidence(this.ledger,runId).references.map(ref=>({recordId:ref.recordId,label:ref.recordId}));
    return {candidates:history.candidates.map(item=>({candidate:{sourceRun:item.sourceRun,sourceManifestSha256:item.sourceManifestSha256,sourceMaterialPath:item.sourceMaterialPath,sourceMaterialSha256:item.sourceMaterialSha256},title:item.sourceRun,adoption:item.adoption,availableEvidence})),unavailable:history.unavailable};
  }

  private interactiveDeps():InteractiveRuntimeDeps {
    if(this.interactiveRuntime)return this.interactiveRuntime;
    const bridge=createInteractiveBindingBridge({packsDir:this.config.packsDir,sitesDir:this.config.sitesDir,interactiveBindingsFile:this.config.interactiveBindingsFile});
    const runtime:InteractiveRuntimeDeps={fabric:this.deps(),
      ...(testFixtureCanRunHere()&&process.env.HIMA_TEST_INTERACTIVE_BINDING_ID?{trustedTestQualification:{bindingId:process.env.HIMA_TEST_INTERACTIVE_BINDING_ID}}:{}),
      resolveOperation:async(run,execution)=>{
        const driving=interactiveDriving(this.deps(),run,execution);
        return bridge.resolve({pack:driving.pack,run,execution,site:driving.site,workspace:driving.workspace,bindings:driving.bindings});
      },verifyAdminBinding:binding=>bridge.verifyAdminBinding(binding),encodeCommand:(binding,request)=>bridge.encodeCommand(binding,request),
      claimJobSlot:async request=>{
        if(!request.run.budget)return {kind:'stopped',reason:'Original Run budget is unavailable.'};
        const result=await claimSlot(this.deps(),{site:{name:request.site,jobs:request.run.budget.jobCap,licences:request.run.budget.licences},holds:request.licences,launch:request.launch});
        return result.kind==='claimed'?result:{kind:result.kind,reason:result.kind==='at-cap'?'The Site Job or licence cap is full.':result.error.message};
      },
      onDeadline:async deadline=>{
        const run=this.ledger.run(deadline.runId);if(!run?.control)return;
        const requestId=`deadline-${identityOf(deadline).slice(0,40)}`;
        // One stop and one notice per deadline (#64 D-T02-5): a deadline whose stop is already in the
        // Ledger — this Host's, or one before a restart — is not stopped or announced again.
        if(this.ledger.records({runId:run.id,type:'interactive'}).some(record=>record.type==='interactive'&&record.requestId===requestId))return;
        const common={runId:run.id,executionId:deadline.executionId,nodeId:deadline.nodeId,toolSessionId:deadline.toolSessionId,actor:run.control.owner,ownerEpoch:run.control.epoch,controlRevision:run.control.revision,requestId,hostStop:'deadline' as const};
        const result=await operateInteractive(runtime,deadline.kind==='command'?{...common,action:'signal',signal:'interrupt'}:{...common,action:'close'});
        this.ctx.logger.info(`Interactive ${deadline.kind} deadline: ${JSON.stringify(result)}`);
        // ADR-0016: an autopilot node's deadline is a Ledger fact the driver acts on, never a person's notice.
        if(this.autopilotNode(run.id,deadline.nodeId))return;
        this.deps().notify?.(run.control.owner,run.id,deadline.executionId,result.status==='refused'
          ?`An interactive ${deadline.kind} deadline of session ${deadline.toolSessionId} was reached, and the Host could not stop it: ${result.reason}`
          :`An interactive ${deadline.kind} deadline of session ${deadline.toolSessionId} was reached and the Host ${deadline.kind==='command'?'interrupted the command':'closed the session'} (${result.status}). Inspect the exact stop receipt and original Job; no checkpoint or successful design result is implied.`);
      },
    };
    this.interactiveRuntime=runtime;this.interactiveTimers=createInteractiveTimerController(runtime);return runtime;
  }
  private taskInteractiveDeps():TaskInteractiveDeps {
    if (this.taskInteractiveRuntime) return this.taskInteractiveRuntime;
    const bridge = createInteractiveBindingBridge({ packsDir: this.config.packsDir, sitesDir: this.config.sitesDir,
      interactiveBindingsFile: this.config.interactiveBindingsFile });
    this.taskInteractiveRuntime = { store: this.durable.store, sitesDir: this.config.sitesDir, bridge,
      ...(testFixtureCanRunHere() && process.env.HIMA_TEST_INTERACTIVE_BINDING_ID
        ? { trustedTestQualification: { bindingId: process.env.HIMA_TEST_INTERACTIVE_BINDING_ID } } : {}) };
    return this.taskInteractiveRuntime;
  }
  async interactive(sessionId:string,raw:unknown):Promise<object> {
    if (await this.durable.store.nativeSessionEffect(sessionId)) {
      return operateTaskInteractive(this.taskInteractiveDeps(), sessionId, raw);
    }
    let request=parseInteractiveRequest(raw,sessionId);
    const run=this.ledger.run(request.runId);
    const delegated=run?.control&&run.control.owner!==sessionId?operatorInteractiveAuthority(this.deps(),sessionId,request):undefined;
    if(!delegated)await authorizeProjectRun(this.guideDeps(),sessionId,request.runId);
    if(run?.control?.owner===sessionId&&request.action==='open') {
      const qualification=await interactiveDelegationGrant(this.interactiveDeps(),{runId:run.id,nodeId:request.nodeId,
        executionId:request.executionId,actor:sessionId,ownerEpoch:request.ownerEpoch,controlRevision:request.controlRevision});
      if(!('reason' in qualification)&&!qualification.testOnly)return {status:'refused',
        reason:'A production-qualified interactive execution must be operated by a recorded Operator child. Use hima_delegate to create role operator for this exact freshly begun node execution; the Run owner adopts its retained candidate result.'};
    }
    if(run?.control&&run.control.owner!==sessionId) {
      if(!delegated)return {status:'refused',reason:'This conversation has no active Operator delegation for the exact Run execution.'};
      // A reviewed scope is enforced at runtime admission against the Run's retained Pack classification.
      const reviewedScope=delegated.reviewedAction?.mode==='scope'?{...delegated.reviewedAction.scope,
        planHashArgument:delegated.reviewedAction.planHashArgument,planSha256:delegated.reviewedAction.planSha256}:undefined;
      if(request.action==='input'&&delegated.reviewedAction!==undefined&&delegated.reviewedAction.mode!=='scope') {
        const command=request.command;
        if(command.name===delegated.reviewedAction.command
            &&identityOf(command.args)!==identityOf(delegated.reviewedAction.arguments))return {status:'refused',reason:'The Operator mutation differs from the immutable owner-adopted reviewed action.'};
        if(!run.packId||!request.nodeId)return {status:'refused',reason:'The Operator target Pack/node identity is unavailable.'};
        const tool=nodeTool(loadPack(this.config.packsDir,run.packId),request.nodeId);
        const mutations=new Set(tool?.interactive?.commands.mutate??[]);
        if(mutations.has(command.name)&&command.name!==delegated.reviewedAction.command)return {status:'refused',reason:'The Operator requested a different mutation than the immutable owner-adopted reviewed action.'};
      }
      request={...request,ownerEpoch:run.control.epoch,controlRevision:run.control.revision,...delegated,
        ...(reviewedScope===undefined?{}:{reviewedScope})};
    }
    if(this.factStop.signal.aborted)return {status:'refused',reason:'The Host is stopping.'};
    const result=await operateInteractive(this.interactiveDeps(),request);
    await reconcileInteractiveExecution(this.deps(),request.runId,request.executionId);
    await this.interactiveTimers!.reconcile();
    const context=this.executionContext(request.runId);
    const execution=context.executions.find((entry)=>entry.id===request.executionId);
    const delegation=runDelegations(this.deps(),request.runId).find((entry)=>entry.childSessionId===sessionId);
    const taskDeadline=delegation?.reservation.deadlineAt;
    const taskRemainingMs=taskDeadline===undefined?undefined:Math.max(0,Date.parse(taskDeadline)-Date.now());
    const mutationLimit=request.reviewedScope?.maxMutations;
    const mutationsUsed=this.ledger.records({runId:request.runId,type:'interactive'}).filter((record)=>record.type==='interactive'
      && (record.payload as {event?:string;executionId?:string;actor?:string;scopeMutation?:boolean}).event==='input-intent'
      && (record.payload as {executionId?:string}).executionId===request.executionId
      && (record.payload as {actor?:string}).actor===sessionId
      && (record.payload as {scopeMutation?:boolean}).scopeMutation===true).length;
    return {...result,context:{
      run:{id:context.run.id,status:context.run.status,currentNode:context.run.currentNode,generation:context.run.generation},
      execution:execution===undefined?undefined:{id:execution.id,nodeId:execution.nodeId,phase:execution.phase,attempt:execution.attempt},
      budget:context.budget,
      operator:{mutationsUsed,...(mutationLimit===undefined?{}:{mutationLimit,mutationsRemaining:Math.max(0,mutationLimit-mutationsUsed)}),
        ...(taskDeadline===undefined?{}:{taskDeadline,taskRemainingMs,taskState:delegation?.state})},
      ...(context.reason===undefined?{}:{reason:context.reason}),
      asOf:new Date().toISOString(),
    }};
  }
  async interactiveSessions(sessionId:string,runId:string):Promise<object> {
    await authorizeProjectRun(this.guideDeps(),sessionId,runId);
    return {sessions:listInteractiveSessions(this.ledger,runId).map(({activeCommand,...entry})=>({...entry,...(activeCommand?{activeCommand:{commandId:activeCommand.commandId,state:activeCommand.state,commandDeadlineAt:activeCommand.commandDeadlineAt}}:{})})),asOf:new Date().toISOString()};
  }

  async delegationInput(sessionId:string,request:{runId:string;recordId:string}&DelegationInputSelection):Promise<object> {
    const native = await this.durable.store.nativeSessionEffect(sessionId);
    if (native) {
      const policy = await nativeDelegationPolicy(this.durable.store, sessionId);
      if (!policy?.toolsAllowed || policy.effective.runRef?.runId !== request.runId
        || native.identity.runId !== request.runId || !policy.effective.inputRefs.includes(request.recordId)) {
        throw new BadRequest('This child has no retained grant for that exact durable input reference.');
      }
      const fact = await this.durable.store.fact(request.recordId);
      if (!fact || fact.runId !== request.runId) throw new BadRequest('The delegated durable input is missing or belongs to another Run.');
      const base = { runId: fact.runId, recordId: fact.factId, recordType: fact.kind,
        source: 'hima-postgresql', seq: fact.seq, at: fact.at };
      const viewLimitBytes = 40000;
      const fits = (value: object) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= viewLimitBytes;
      if (delegationInputSelected(request)) {
        const answer = (value: unknown, window: object) => ({ ...base, kind: 'selection', path: request.path ?? '', window, value });
        const selected = selectDelegationInput(JSON.stringify(fact.payload), request, (value, window) => fits(answer(value, window)));
        if (!selected.ok) throw new BadRequest(`${selected.reason} Select an existing JSON field with offset and limit.`);
        return answer(selected.value, selected.window);
      }
      const answer = { ...base, kind: 'fact', value: fact.payload };
      return fits(answer) ? answer : { ...base, kind: 'unavailable', truncated: true, viewLimitBytes,
        reason: 'The durable input exceeds the native view; select its JSON fields with path, offset and limit.' };
    }
    const policy=delegationRuntimePolicy(this.deps(),sessionId);
    const entry=runDelegations(this.deps(),request.runId).find(item=>item.childSessionId===sessionId);
    if(!policy||!('toolsAllowed' in policy)||policy.toolsAllowed!==true||!entry||entry.effective.runRef?.runId!==request.runId||!entry.contract.inputRefs.includes(request.recordId))throw new BadRequest('This child has no current grant for that exact input reference.');
    const record=this.ledger.record(request.recordId);
    if(!record||record.runId!==request.runId||!recordValidityOf(this.ledger.records({runId:request.runId}),record.id).valid)throw new BadRequest('The delegated input is missing or invalidated.');
    const base={runId:request.runId,recordId:record.id,recordType:record.type};
    // DSH's native spill-policy caps model-facing plain-text results at 50,000 UTF-8
    // bytes. Bound the complete envelope below that ceiling, not just report text.
    const viewLimitBytes=40000;
    const viewBytes=(value:object)=>Buffer.byteLength(JSON.stringify(value),'utf8');
    const bounded=(value:object,handoffSource?:{outputIdentity:string;contractRecordId:string}):object=>viewBytes(value)<=viewLimitBytes?value:{...base,kind:'unavailable',
      truncated:true,viewLimitBytes,
      ...(handoffSource===undefined?{}:{...handoffSource,source:'durable-ledger-child-handoff',identityEncoding:'sha256-native-assistant-output'}),
      ...(record.type==='observation'?{contentSha256:record.contentSha256,bytes:record.bytes}
        :record.type==='code'||record.type==='knowledge'?{sha256:record.sha256,bytes:record.bytes}:{}),
      reason:'The typed input exceeds the bounded native child view; read it in bounded parts with path, offset and limit, or delegate smaller verified material.'};
    // #64 T05 w03: a selection reads one window of the input's retained material, under this same grant,
    // record identity and content hash, inside the same bounded view.
    if(delegationInputSelected(request)) {
      if(!['observation','code','knowledge'].includes(record.type))throw new BadRequest(`A bounded selection reads the retained material of an observation, code or knowledge input; this record is ${record.type}.`);
      const hash=record.type==='observation'?{contentSha256:record.contentSha256}:{sha256:(record as {sha256:string}).sha256};
      const material=await readReportMaterial(this.deps(),request.runId,record.id);
      if(material.kind!=='read')return {...base,kind:'unavailable',...hash,reason:`Recorded material is unavailable; nothing of it is delivered: ${material.why}`};
      const answer=(value:unknown,window:object)=>({...base,kind:'selection',...hash,bytes:(record as {bytes:number}).bytes,path:request.path??'',window,value});
      const selected=selectDelegationInput(material.text,request,(value,window)=>viewBytes(answer(value,window))<=viewLimitBytes);
      if(!selected.ok)throw new BadRequest(`${selected.reason} Record ${record.id}; select a dotted field path or JSON pointer that exists in it, with offset and limit.`);
      return answer(selected.value,selected.window);
    }
    if(record.type==='code'||record.type==='knowledge') {
      if(record.bytes>1024*1024)return {...base,kind:'unavailable',reason:'This material exceeds the bounded child input view; delegate a smaller verified source.'};
      const material=await readMaterial(this.deps(),request.runId,record.id);
      if(material.kind!=='read')return {...base,kind:'unavailable',reason:`Recorded material is ${material.kind}; original bytes were not delivered.`};
      return bounded({...base,kind:'material',sha256:record.sha256,bytes:record.bytes,text:material.text,
        returnedBytes:Buffer.byteLength(material.text,'utf8'),truncated:false});
    }
    if(record.type==='delegation'&&record.event==='result-observed') {
      const source=runDelegations(this.deps(),request.runId).find(item=>item.delegationId===record.delegationId);
      if(!source)return {...base,kind:'unavailable',reason:'The child result source is missing.'};
      let observed:ReturnType<typeof parseDelegationResultObservedPayload>;
      try {observed=parseDelegationResultObservedPayload(record.payload);} catch {return {...base,kind:'unavailable',reason:'This observed child result predates or fails the durable handoff schema.'};}
      const handoff=observed.handoff;
      const contractRecord=this.ledger.record(handoff.contract.recordId);
      if(source.contractRecordId!==handoff.contract.recordId||source.requestDigest!==handoff.contract.requestDigest
          ||!contractRecord||contractRecord.type!=='delegation'||contractRecord.event!=='create-intent'
          ||contractRecord.runId!==request.runId||contractRecord.delegationId!==record.delegationId
          ||contractRecord.requestDigest!==handoff.contract.requestDigest
          ||!recordValidityOf(this.ledger.records({runId:request.runId}),contractRecord.id).valid) {
        return {...base,kind:'unavailable',reason:'The exact recorded delegation contract for this child handoff is missing or invalidated.'};
      }
      return bounded({...base,kind:'record-fact',payload:{candidateOnly:true,outputIdentity:handoff.outputIdentity,
        contractRecordId:contractRecord.id,task:source.contract.task,inputRefs:source.contract.inputRefs,
        text:handoff.output.text,content:handoff.output.content,truncated:handoff.output.truncated,
        completedTurn:handoff.completedTurn,unknowns:handoff.unknowns,evidence:handoff.evidence,
        artifacts:handoff.evidence.artifactRefs.map(({path:_path,...artifact})=>artifact),limitations:handoff.evidence.limitations},
        source:'durable-ledger-child-handoff',identity:handoff.outputIdentity,identityEncoding:'sha256-native-assistant-output'},
        {outputIdentity:handoff.outputIdentity,contractRecordId:contractRecord.id});
    }
    let observationMaterial:{text:string;returnedBytes:number;truncated:boolean}|undefined;
    let observationJson:unknown;
    if(record.type==='observation') {
      const retained=await readReportMaterial(this.deps(),request.runId,record.id);
      if(retained.kind==='read') {
        observationMaterial={text:retained.text,returnedBytes:Buffer.byteLength(retained.text,'utf8'),truncated:false};
        try { observationJson=JSON.parse(retained.text); } catch { /* non-JSON reports retain the bounded text projection */ }
      }
    }
    let payload:unknown=record.type==='observation'?{reader:record.reader,contentSha256:record.contentSha256,bytes:record.bytes,values:record.values,
        ...(observationMaterial===undefined?{materialUnavailable:'No bounded retained report bytes are available.'}:{material:observationMaterial})}
      :record.type==='verdict'?{outcome:record.outcome,ruleId:record.ruleId,ruleVersion:record.ruleVersion,cites:record.cites,valuesAsRead:record.valuesAsRead,reason:record.reason}
      :record.type==='analysis'?{analysis:record.analysis}:undefined;
    if(payload===undefined)return {...base,kind:'unavailable',reason:'This record type has no bounded delegated material projection.'};
    if(viewBytes({...base,kind:'record-fact',payload,identity:'0'.repeat(64),identityEncoding:'canonical-ledger-projection'})>viewLimitBytes&&record.type==='observation'&&observationJson!==undefined) {
      payload={reader:record.reader,contentSha256:record.contentSha256,bytes:record.bytes,values:record.values,
        material:{encoding:'json',value:observationJson,returnedBytes:Buffer.byteLength(JSON.stringify(observationJson),'utf8'),truncated:false}};
    }
    if(record.type==='observation'&&observationMaterial!==undefined
        &&viewBytes({...base,kind:'record-fact',payload,identity:'0'.repeat(64),identityEncoding:'canonical-ledger-projection'})>viewLimitBytes) {
      payload={reader:record.reader,contentSha256:record.contentSha256,bytes:record.bytes,values:record.values,
        material:{encoding:observationJson===undefined?'text':'json',truncated:true,returnedBytes:0,
          reason:`Complete material exceeds the bounded native view limit (${viewLimitBytes} bytes); only typed reader values are delivered. Read it in bounded parts: path (a dotted field path or JSON pointer, such as candidate.targets), offset and limit.`}};
    }
    return bounded({...base,kind:'record-fact',payload,identity:identityOf(payload),identityEncoding:'canonical-ledger-projection'});
  }

  async delegate(request:RunDelegationRequest,signal:AbortSignal=AbortSignal.timeout(30000)):Promise<object> {
    // Only the Host's own driver acts as the autopilot; no caller of this service may.
    if(request.origin==='autopilot')return {unknowns:[],status:'refused',artifacts:[],reason:'only the Harness takes autopilot turns'};
    return this.runDelegation(request,signal);
  }

  private async runDelegation(request:RunDelegationRequest,signal:AbortSignal=AbortSignal.timeout(30000)):Promise<Record<string,unknown>> {
    await authorizeProjectRun(this.guideDeps(),request.actor,request.runId);
    let normalizedRequest=request;
    let materializedFromRecipe=false;
    let operatorGrant:import('./delegation.js').OperatorDelegationGrant|undefined;
    if(request.action==='create'&&request.recipe!==undefined) {
      if(request.contract!==undefined||request.text!==undefined)return {unknowns:[],status:'refused',artifacts:[],reason:'A Pack Agent Team recipe supplies its own task and contract; caller contract/text is not accepted.'};
      const run=this.ledger.run(request.runId);
      if(!run?.control)return {unknowns:[],status:'refused',artifacts:[],reason:'Agent Team materialization requires a controlled Run.'};
      if(!run.packId)return {unknowns:[],status:'refused',artifacts:[],reason:'The controlled Run has no retained Pack identity.'};
      if(!run.packDigest)return {unknowns:[],status:'refused',artifacts:[],reason:'The controlled Run has no retained Pack digest.'};
      const pack=loadRunPack(this.config.packsDir,run.packId,run.packDigest);
      const team=pack.contract.agentTeams.find(item=>item.id===request.recipe!.teamId&&item.version===request.recipe!.version);
      const member=team?.members.find(item=>item.id===request.recipe!.memberId);
      if(!team||!member)return {unknowns:[],status:'refused',artifacts:[],reason:'The retained Pack does not declare that Agent Team recipe/member version.'};
      const execution=run.control.executions[request.recipe.executionId];
      if(!execution||execution.nodeId!==member.node||execution.supersededBy||execution.phase!=='begun')return {unknowns:[],status:'refused',artifacts:[],reason:'The recipe member requires its exact freshly begun target execution.'};
      if(team.triggerNode!==execution.nodeId)return {unknowns:[],status:'refused',artifacts:[],reason:'The recipe trigger node differs from the requested execution.'};
      const records=currentRecordsIn(this.ledger.records({runId:run.id}));
      const recipeSite=loadSite(this.config.sitesDir,run.siteId);
      const inputRefs:string[]=[];const outputRecords=new Map<string,Extract<(typeof records)[number],{type:'observation'}>>();
      for(const name of member.inputs) {
        const output=pack.contract.outputs.find(item=>item.name===name)!;
        const expectedPath=outputPath(output,recipeSite.bindings);
        const matches=records.filter((item):item is Extract<typeof item,{type:'observation'}>=>item.type==='observation'
          &&item.generation===execution.generation&&item.reader.id===output.reader
          &&(item.path===expectedPath||item.path.endsWith(`/${expectedPath}`)));
        if(matches.length!==1)return {unknowns:[],status:'refused',artifacts:[],reason:`Recipe input ${name} needs one current Reader observation; found ${matches.length}.`};
        inputRefs.push(matches[0]!.id);outputRecords.set(name,matches[0]!);
      }
      const existing=runDelegations(this.deps(),run.id);const dependencyIds:string[]=[];
      for(const dependency of member.dependencyRoles) {
        const found=existing.find(row=>row.effective.recipe?.teamId===team.id&&row.effective.recipe.version===team.version
          &&row.effective.recipe.memberId===dependency&&row.effective.recipe.executionId===execution.id);
        if(!found?.resultRecordId)return {unknowns:[],status:'refused',artifacts:[],reason:`Recipe dependency ${dependency} has no exact observed candidate result.`};
        const source=team.members.find(item=>item.id===dependency)!;
        if(source.ownerAdoption==='required'&&!found.adoptedRecordId)return {unknowns:[],status:'refused',artifacts:[],reason:`Recipe dependency ${dependency} requires explicit owner adoption.`};
        dependencyIds.push(found.delegationId);inputRefs.push(found.resultRecordId);
      }
      let inlinePayload:import('./delegation.js').TeamRecipeBinding['inlinePayload'];
      let reviewOutput:import('./delegation.js').TeamRecipeBinding['reviewOutput'];
      const operatorConsumer=team.members.find(item=>item.reviewedAction!==undefined&&item.reviewedAction.mode!=='request-scope'&&item.reviewedAction.fromRole===member.id);
      if(operatorConsumer?.reviewedAction?.mode==='scope') {
        const reviewed=operatorConsumer.reviewedAction;
        const tool=nodeTool(pack,operatorConsumer.node);
        if(reviewed.commands.some(command=>!tool?.interactive?.arguments[command]))return {unknowns:[],status:'refused',artifacts:[],reason:'The Pack Reviewer output contract has no matching typed Operator command.'};
        reviewOutput={mode:'scope',scopeField:reviewed.scopeField,commands:reviewed.commands,maxMutations:reviewed.maxMutations};
      } else if(operatorConsumer?.reviewedAction&&operatorConsumer.reviewedAction.mode!=='request-scope') {
        const tool=nodeTool(pack,operatorConsumer.node);
        const declaration=tool?.interactive?.arguments[operatorConsumer.reviewedAction.command];
        if(!declaration)return {unknowns:[],status:'refused',artifacts:[],reason:'The Pack Reviewer output contract has no matching typed Operator command.'};
        reviewOutput={command:operatorConsumer.reviewedAction.command,
          arguments:declaration.filter(item=>item.name!==operatorConsumer.reviewedAction!.hostPlanHashArgument).map(item=>item.name)};
      }
      if(member.reviewedAction?.mode==='request-scope') {
        // ADR-0016: the admitted request is the Operator's scope. The Host reads it out of the exact
        // Reader-backed bytes, holds it to the Pack recipe and binds every mutation to that reading.
        const reviewed=member.reviewedAction;
        const planRecord=outputRecords.get(reviewed.planInput);
        if(!planRecord)return {unknowns:[],status:'refused',artifacts:[],reason:'The request scope plan input has no current Reader observation.'};
        const retainedPlan=await readReportMaterial(this.deps(),run.id,planRecord.id);
        if(retainedPlan.kind!=='read')return {unknowns:[],status:'refused',artifacts:[],reason:`The exact request scope bytes are unavailable: ${retainedPlan.why}`};
        let plan:unknown;try{plan=JSON.parse(retainedPlan.text);}catch{return {unknowns:[],status:'refused',artifacts:[],reason:'The request scope plan bytes are not JSON.'};}
        let scope:unknown=plan;
        for(const key of reviewed.scopePath)scope=scope!==null&&typeof scope==='object'&&!Array.isArray(scope)?(scope as Record<string,unknown>)[key]:undefined;
        const problem=reviewedScopeProblem(scope,reviewed);
        if(problem!==undefined)return {unknowns:[],status:'refused',artifacts:[],reason:`The admitted request's ${reviewed.scopePath.join('.')} is not a scope the Pack recipe allows: ${problem}.`};
        const {commands,maxMutations}=scope as {commands:string[];maxMutations:number};
        inlinePayload={mode:'scope',sourceResultRecordId:planRecord.id,adoptionRecordId:planRecord.id,planSha256:planRecord.contentSha256,
          planHashArgument:reviewed.hostPlanHashArgument,scope:{commands,maxMutations}};
      } else if(member.reviewedAction) {
        const reviewedFrom=member.reviewedAction.fromRole;
        const source=existing.find(row=>row.effective.recipe?.teamId===team.id&&row.effective.recipe.version===team.version
          &&row.effective.recipe.memberId===reviewedFrom&&row.effective.recipe.executionId===execution.id)!;
        const result=this.ledger.record(source.resultRecordId!);if(!result||result.type!=='delegation'||result.event!=='result-observed')return {unknowns:[],status:'refused',artifacts:[],reason:'The reviewed action result record is unavailable.'};
        let observed:ReturnType<typeof parseDelegationResultObservedPayload>;try{observed=parseDelegationResultObservedPayload(result.payload);}catch{return {unknowns:[],status:'refused',artifacts:[],reason:'The reviewed action handoff is malformed.'};}
        let payload:Record<string,unknown>;try{payload=JSON.parse(observed.handoff.output.text) as Record<string,unknown>;}catch{return {unknowns:[],status:'refused',artifacts:[],reason:'The reviewed action must be one JSON object.'};}
        if(payload===null||typeof payload!=='object'||Array.isArray(payload))return {unknowns:[],status:'refused',artifacts:[],reason:'The reviewed action must be one JSON object.'};
        const sourceMember=team.members.find(item=>item.id===reviewedFrom)!;
        {const missing=sourceMember.resultSchema.required.filter(field=>!(field in payload));if(payload.schema!==sourceMember.resultSchema.id||missing.length>0)return {unknowns:[],status:'refused',artifacts:[],reason:`The reviewed action does not satisfy Pack result schema ${JSON.stringify(sourceMember.resultSchema.id)}: ${[payload.schema===sourceMember.resultSchema.id?'':`its schema field is ${payload.schema===undefined?'absent':JSON.stringify(payload.schema)}, not ${JSON.stringify(sourceMember.resultSchema.id)}`,missing.length===0?'':`missing required field(s): ${missing.join(', ')}`].filter(Boolean).join('; ')}.`};}
        if(member.reviewedAction.mode==='scope') {
          const reviewed=member.reviewedAction;
          const planHash=payload[reviewed.planHashField];const scope=payload[reviewed.scopeField];
          if(typeof planHash!=='string'||planHash!==outputRecords.get(reviewed.planInput)?.contentSha256)return {unknowns:[],status:'refused',artifacts:[],reason:'The reviewed scope plan SHA-256 differs from the current reader-backed plan.'};
          // Second guard: the Reviewer result gate already refused this; a Ledger result that bypassed it still cannot pass.
          const problem=reviewedScopeProblem(scope,reviewed);
          if(problem!==undefined)return {unknowns:[],status:'refused',artifacts:[],reason:`${problem[0]!.toUpperCase()}${problem.slice(1)}.`};
          const {commands,maxMutations}=scope as {commands:string[];maxMutations:number};
          const tool=nodeTool(pack,member.node);
          const untyped=commands.filter(command=>!tool?.interactive?.commands.mutate.includes(command)
            ||!tool.interactive.arguments[command]?.some(item=>item.name===reviewed.hostPlanHashArgument&&item.type==='string'));
          if(untyped.length>0)return {unknowns:[],status:'refused',artifacts:[],reason:`The reviewed scope names commands that are not hash-bearing mutations of the Operator tool: ${untyped.join(', ')}.`};
          inlinePayload={mode:'scope',sourceResultRecordId:result.id,adoptionRecordId:source.adoptedRecordId!,planSha256:planHash,
            planHashArgument:reviewed.hostPlanHashArgument,scope:{commands,maxMutations}};
        } else {
        const planHash=payload[member.reviewedAction.planHashField];const command=payload[member.reviewedAction.commandField];const args=payload[member.reviewedAction.argumentsField];
        const planRecord=outputRecords.get(member.reviewedAction.planInput);
        if(typeof planHash!=='string'||planHash!==planRecord?.contentSha256)return {unknowns:[],status:'refused',artifacts:[],reason:`The reviewed action plan SHA-256 ${typeof planHash==='string'?JSON.stringify(planHash):'(absent)'} differs from the current reader-backed fix plan ${planRecord?.contentSha256===undefined?'(unavailable)':JSON.stringify(planRecord.contentSha256)}.`};
        if(typeof command!=='string'||!args||typeof args!=='object'||Array.isArray(args))return {unknowns:[],status:'refused',artifacts:[],reason:'The reviewed action command or arguments are malformed.'};
        const tool=nodeTool(pack,member.node);
        const declaration=tool?.interactive?.arguments[command];if(command!==member.reviewedAction.command||!declaration||!Object.values(tool!.interactive!.commands).flat().includes(command))return {unknowns:[],status:'refused',artifacts:[],reason:'The reviewed action command is not the Pack recipe mutation.'};
        const values=args as Record<string,unknown>;const actionDeclaration=declaration.filter(item=>item.name!==member.reviewedAction!.hostPlanHashArgument);
        if(new Set([...Object.keys(values),...actionDeclaration.map(item=>item.name)]).size!==actionDeclaration.length)return {unknowns:[],status:'refused',artifacts:[],reason:'The reviewed action arguments differ from the typed Pack command.'};
        for(const item of actionDeclaration){const value=values[item.name];if(typeof value!==item.type||item.choices&&!item.choices.includes(value as never)||typeof value==='number'&&(item.minimum!==undefined&&value<item.minimum||item.maximum!==undefined&&value>item.maximum))return {unknowns:[],status:'refused',artifacts:[],reason:`Reviewed argument ${item.name} violates the typed Pack command.`};}
        const retainedPlan=await readReportMaterial(this.deps(),run.id,planRecord.id);
        if(retainedPlan.kind!=='read')return {unknowns:[],status:'refused',artifacts:[],reason:`The exact reviewed plan bytes are unavailable: ${retainedPlan.why}`};
        let plan:Record<string,unknown>;try{plan=JSON.parse(retainedPlan.text) as Record<string,unknown>;}catch{return {unknowns:[],status:'refused',artifacts:[],reason:'The exact reviewed plan bytes are not JSON.'};}
        const candidates=plan[member.reviewedAction.actionListField];
        if(!Array.isArray(candidates))return {unknowns:[],status:'refused',artifacts:[],reason:`The owner-adopted reviewed action cannot be matched: the reviewed plan declares no action list at ${JSON.stringify(member.reviewedAction.actionListField)}.`};
        if(!candidates.some(candidate=>candidate&&typeof candidate==='object'
            &&actionDeclaration.every(item=>(candidate as Record<string,unknown>)[item.name]===values[item.name]))){
          const adopted=actionDeclaration.map(item=>`${item.name}=${JSON.stringify(values[item.name])}`).join(', ');
          return {unknowns:[],status:'refused',artifacts:[],reason:`The owner-adopted reviewed action (${adopted}) is not one action in the exact reader-backed fix plan at ${JSON.stringify(member.reviewedAction.actionListField)}; the adopted argument values match no plan entry.`};
        }
        const effectiveArguments={...values,[member.reviewedAction.hostPlanHashArgument]:planHash} as Record<string,string|number|boolean>;
        inlinePayload={sourceResultRecordId:result.id,adoptionRecordId:source.adoptedRecordId!,planSha256:planHash,command,arguments:effectiveArguments};
        }
      }
      const delegationId=`team-${team.id}-${member.id}-${identityOf({runId:run.id,executionId:execution.id}).slice(0,16)}`;
      const priorRecipe=existing.find(row=>row.delegationId===delegationId);
      const recipeDigest=identityOf({packDigest:run.packDigest,team,member});
      // #64 M-T03-1: the exact Reader-backed bytes of each declared task input, embedded, so the member
      // works from the request itself and never from a record id it cannot read.
      const embedded:string[]=[];
      for(const wanted of member.taskInputs) {
        const reading=outputRecords.get(wanted.input);
        if(!reading)return {unknowns:[],status:'refused',artifacts:[],reason:`Task input ${wanted.input} has no current Reader observation.`};
        const bytes=await readReportMaterial(this.deps(),run.id,reading.id);
        if(bytes.kind!=='read')return {unknowns:[],status:'refused',artifacts:[],reason:`The exact bytes of task input ${wanted.input} are unavailable: ${bytes.why}`};
        let text=bytes.text;
        if(wanted.fields!==undefined) {
          let value:unknown;try{value=JSON.parse(bytes.text);}catch{return {unknowns:[],status:'refused',artifacts:[],reason:`Task input ${wanted.input} is not JSON, so its fields cannot be picked.`};}
          if(value===null||typeof value!=='object'||Array.isArray(value))return {unknowns:[],status:'refused',artifacts:[],reason:`Task input ${wanted.input} is not one JSON object.`};
          text=JSON.stringify(Object.fromEntries(wanted.fields.filter(field=>field in (value as object)).map(field=>[field,(value as Record<string,unknown>)[field]])));
        }
        embedded.push(`Exact input ${wanted.input} (Reader observation ${reading.id}, content SHA-256 ${reading.contentSha256}${wanted.fields===undefined?'':`, fields ${wanted.fields.join(', ')}`}):\n${text}`);
      }
      const task=[member.taskTemplate,`Runtime inputs: ${inputRefs.join(', ')}.`,inlinePayload?`${inlinePayload.mode==='scope'?'Immutable reviewed scope':'Immutable reviewed action'}: ${JSON.stringify(inlinePayload)}.`:'',...embedded].filter(Boolean).join('\n');
      normalizedRequest={...request,recipe:undefined,...(priorRecipe?.reservation.admittedRevision===undefined?{}:{expectedRevision:priorRecipe.reservation.admittedRevision}),contract:{delegationId,role:member.role,task,inputRefs,nodeRef:member.node,
        allowedTools:member.allowedTools,budgetShare:member.budgetShare,dependencyIds,recipient:{kind:'run-owner',sessionId:run.control.owner},
        recipe:{teamId:team.id,version:team.version,memberId:member.id,executionId:execution.id,recipeDigest,resultSchema:member.resultSchema,...(inlinePayload?{inlinePayload}:{})}}};
      if(reviewOutput) normalizedRequest={...normalizedRequest,contract:{...(normalizedRequest.contract as object),recipe:{...((normalizedRequest.contract as {recipe:object}).recipe),reviewOutput}}};
      materializedFromRecipe=true;
    }
    request=normalizedRequest;
    if(request.action==='create'&&request.contract&&typeof request.contract==='object'
        &&(request.contract as Record<string,unknown>).recipe!==undefined&&!materializedFromRecipe) {
      return {unknowns:[],status:'refused',artifacts:[],reason:'Delegation recipe provenance is Host-materialized and cannot be supplied in a manual contract.'};
    }
    if(request.action==='create'&&request.contract&&typeof request.contract==='object'
        &&(request.contract as {role?:unknown}).role==='operator') {
      const raw=request.contract as Record<string,unknown>;
      const declaredNodeRef=typeof raw.nodeRef==='string'?raw.nodeRef:undefined;
      const nodeIdAlias=typeof raw.nodeId==='string'?raw.nodeId:undefined;
      if(declaredNodeRef!==undefined&&nodeIdAlias!==undefined&&declaredNodeRef!==nodeIdAlias)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator contract nodeId and nodeRef name different nodes.'};
      const nodeRef=declaredNodeRef??nodeIdAlias;
      if(nodeRef===undefined)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator contract requires nodeRef; nodeId is accepted as its owner-facing alias.'};
      const requestedExecutionId=typeof raw.executionId==='string'?raw.executionId:undefined;
      const legacyFull=typeof raw.delegationId==='string'&&typeof raw.nodeRef==='string'&&typeof raw.task==='string'
        &&Array.isArray(raw.inputRefs)&&Array.isArray(raw.allowedTools)&&raw.budgetShare!==null
        &&typeof raw.budgetShare==='object'&&!Array.isArray(raw.budgetShare)&&Array.isArray(raw.dependencyIds)
        &&raw.recipient!==null&&typeof raw.recipient==='object';
      if(requestedExecutionId===undefined&&!legacyFull)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator contract requires the exact executionId; only the complete legacy nodeRef contract may resolve the unique begun execution.'};
      const run=this.ledger.run(request.runId);
      if(!run?.control)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation requires a controlled Run.'};
      if(!materializedFromRecipe&&run.packId&&run.packDigest) {
        const retained=loadRunPack(this.config.packsDir,run.packId,run.packDigest);
        const required=retained.contract.agentTeams.some(team=>team.members.some(member=>member.role==='operator'&&member.node===nodeRef));
        if(required)return {unknowns:[],status:'refused',artifacts:[],reason:'This Pack declares an Operator Agent Team recipe for the execution; materialize that recipe after its required Reviewer adoption.'};
      }
      const delegationId=typeof raw.delegationId==='string'?raw.delegationId:`operator-${requestedExecutionId!}`;
      const existingDelegations=runDelegations(this.deps(),request.runId);
      const prior=existingDelegations.find(row=>row.delegationId===delegationId);
      let targetExecutionId=requestedExecutionId;
      if(prior?.effective.operator) {
        const retained=prior.effective.operator;
        targetExecutionId??=retained.executionId;
        if(retained.runId!==run.id||retained.nodeId!==nodeRef||retained.executionId!==targetExecutionId
            ||prior.effective.role!=='operator')return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation identity belongs to a different Run, node or execution.'};
      } else {
        const executions=Object.values(run.control.executions).filter(entry=>entry.nodeId===nodeRef&&!entry.supersededBy&&entry.phase==='begun');
        if(executions.length!==1)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation requires exactly one freshly begun interactive execution at its declared node.'};
        if(targetExecutionId!==undefined&&executions[0]!.id!==targetExecutionId)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator contract executionId differs from the exact freshly begun execution.'};
        targetExecutionId=executions[0]!.id;
      }
      const task=typeof raw.task==='string'&&raw.task.trim()!==''?raw.task:typeof request.text==='string'&&request.text.trim()!==''?request.text:undefined;
      if(task===undefined)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation requires a bounded task in contract.task or text.'};
      if(raw.budgetShare!==undefined&&(raw.budgetShare===null||typeof raw.budgetShare!=='object'||Array.isArray(raw.budgetShare)))return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation budgetShare must be an object.'};
      const suppliedBudget=raw.budgetShare===undefined?{}:raw.budgetShare as Record<string,unknown>;
      if(suppliedBudget.maxTotalTokens!==undefined||suppliedBudget.maxCost!==undefined)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation has no enforceable task-total token or cost cap; omit maxTotalTokens and maxCost.'};
      for(const [name,allowZero] of [['maxElapsedMs',false],['maxFollowups',true],['maxTokensPerTurn',false]] as const) {
        const value=suppliedBudget[name];
        if(value!==undefined&&(typeof value!=='number'||!Number.isSafeInteger(value)||(allowZero?value<0:value<=0)))return {unknowns:[],status:'refused',artifacts:[],reason:`Operator delegation budget ${name} is invalid.`};
      }
      if(raw.readScope!==undefined||raw.writeScope!==undefined)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation cannot receive generic readScope or writeScope.'};
      const stringArray=(value:unknown,name:string):readonly string[]|{readonly reason:string}=>value===undefined?[]:Array.isArray(value)&&value.every(item=>typeof item==='string')?value:{reason:`Operator delegation ${name} must be an array of record identities.`};
      const inputRefs=stringArray(raw.inputRefs,'inputRefs');if('reason' in inputRefs)return {unknowns:[],status:'refused',artifacts:[],reason:inputRefs.reason};
      const dependencyIds=stringArray(raw.dependencyIds,'dependencyIds');if('reason' in dependencyIds)return {unknowns:[],status:'refused',artifacts:[],reason:dependencyIds.reason};
      if(raw.allowedTools!==undefined&&(!Array.isArray(raw.allowedTools)||!raw.allowedTools.every(item=>typeof item==='string')||!raw.allowedTools.includes('hima_interactive')))return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation allowedTools must include hima_interactive.'};
      if(raw.recipient!==undefined&&((raw.recipient as {kind?:unknown;sessionId?:unknown}).kind!=='run-owner'
          ||(raw.recipient as {sessionId?:unknown}).sessionId!==run.control.owner))return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation recipient must be the current Run owner.'};
      const workspaceRef=raw.workspaceRef===undefined?undefined:typeof raw.workspaceRef==='string'?raw.workspaceRef:null;
      if(workspaceRef===null)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation workspaceRef must be a string.'};
      let budgetCeiling:number;
      let budgetDefault:import('./delegation.js').DelegationBudgetShare;
      if(prior) {
        budgetDefault=prior.contract.budgetShare;budgetCeiling=budgetDefault.maxElapsedMs;
      } else {
        // The same delegation time the admission charges: lane time not held by a live child or spent by an ended one.
        const unreservedMs=unreservedDelegationMs(this.deps(),run,existingDelegations);
        const totalAvailableMs=unreservedMs===undefined?20*60_000:Math.max(0,unreservedMs);
        const remainingMs=timeBoxRemainingMs(run,ownedWaitedMs(run))??20*60_000;
        // Leave admission-time clock drift outside the child share; authority re-reads the deadline.
        // #66 H2a: a recipe Operator's share is the Pack's Team member share, held only to the lane and
        // the time box; the 20-minute, one-follow-up, 5000-token ceiling is the Host's manual default.
        budgetCeiling=Math.min(materializedFromRecipe?Number.POSITIVE_INFINITY:20*60_000,totalAvailableMs,Math.max(0,remainingMs-1_000));
        if(budgetCeiling<1)return {unknowns:[],status:'refused',artifacts:[],reason:'Operator delegation has no remaining Run time budget.'};
        budgetDefault=materializedFromRecipe
          ?{maxElapsedMs:budgetCeiling,maxFollowups:(suppliedBudget.maxFollowups as number|undefined)??1,maxTokensPerTurn:(suppliedBudget.maxTokensPerTurn as number|undefined)??5_000}
          :{maxElapsedMs:budgetCeiling,maxFollowups:1,maxTokensPerTurn:5_000};
      }
      // #64 T05 w03: a Pack recipe Operator may also read its exact recorded inputs in bounded windows
      // (packs.ts admits only these two tools for it); a manual Operator contract stays interactive-only.
      const operatorTools=materializedFromRecipe&&Array.isArray(raw.allowedTools)&&raw.allowedTools.includes('hima_delegation_input')
        ?['hima_interactive','hima_delegation_input']:['hima_interactive'];
      const normalizedContract={delegationId,role:'operator' as const,task,inputRefs,nodeRef,allowedTools:operatorTools,
        ...(workspaceRef===undefined?{}:{workspaceRef}),
        budgetShare:{maxElapsedMs:suppliedBudget.maxElapsedMs===undefined?budgetDefault.maxElapsedMs:Math.min(suppliedBudget.maxElapsedMs as number,budgetCeiling),
          maxFollowups:suppliedBudget.maxFollowups===undefined?budgetDefault.maxFollowups:Math.min(suppliedBudget.maxFollowups as number,budgetDefault.maxFollowups),
          maxTokensPerTurn:suppliedBudget.maxTokensPerTurn===undefined?budgetDefault.maxTokensPerTurn:Math.min(suppliedBudget.maxTokensPerTurn as number,budgetDefault.maxTokensPerTurn??5_000)},
        dependencyIds,recipient:{kind:'run-owner' as const,sessionId:run.control.owner},
        ...(!materializedFromRecipe||raw.recipe===undefined?{}:{recipe:raw.recipe})};
      normalizedRequest={...request,...(prior?.reservation.admittedRevision===undefined?{}:{expectedRevision:prior.reservation.admittedRevision}),contract:normalizedContract};
      if(prior?.effective.operator) operatorGrant=prior.effective.operator;
      else {
        const qualification=await interactiveDelegationGrant(this.interactiveDeps(),{runId:run.id,nodeId:nodeRef as string,executionId:targetExecutionId!,
          actor:run.control.owner,ownerEpoch:run.control.epoch,controlRevision:run.control.revision});
        if('reason' in qualification)return {unknowns:[],status:'refused',artifacts:[],reason:qualification.reason};
        operatorGrant={runId:run.id,nodeId:nodeRef as string,executionId:targetExecutionId!,...qualification};
      }
    }
    const result=await operateRunDelegation(this.ctx,this.deps(),normalizedRequest,signal,{operatorGrant});this.syncDelegationDeadlines();
    await this.settleStrandedTeams(request.runId);return {'unknowns':[],...result};
  }
  /** A delegation fact never fails the call that recorded it; the next trigger or restart settles again. */
  private settleStrandedTeams(runId:string):Promise<void> {
    return controlling(this.deps(),runId,async()=>{await settleStrandedTeamExecutions(this.deps(),runId);})
      .catch(error=>this.ctx.logger.warn(`hima: Team execution settlement for ${runId} remains pending: ${String(error)}`));
  }
  async delegations(sessionId:string,runId:string):Promise<object> {
    await authorizeProjectRun(this.guideDeps(),sessionId,runId);
    return {delegations:runDelegations(this.deps(),runId).map(row=>({...row,...row.contract,status:row.state,effective:row.effective,requested:{allowedTools:row.contract.allowedTools,readScope:row.contract.readScope,writeScope:row.contract.writeScope,budgetShare:row.contract.budgetShare},nativeStatus:this.ctx.get('agents')?.get(row.childSessionId as never)?.status,unknowns:row.effective.unavailable,artifacts:this.delegationEvidence(runId,row.delegationId)?.artifactRefs.map(item=>item.path)??[],evidence:this.delegationEvidence(runId,row.delegationId)})),asOf:new Date().toISOString(),sourceRevision:this.ledger.run(runId)?.control?.revision};
  }
  private delegationEvidence(runId:string,delegationId:string):import('./delegation.js').DelegationCandidateResult['evidence']|undefined {
    const last=this.ledger.records({runId,type:'delegation'}).findLast(record=>record.type==='delegation'&&record.delegationId===delegationId&&record.event==='result-observed');
    if(!last||last.type!=='delegation')return undefined;
    const evidence=(last.payload as {evidence?:import('./delegation.js').DelegationCandidateResult['evidence']}).evidence;
    return evidence&&Array.isArray(evidence.artifactRefs)&&Array.isArray(evidence.diffRefs)&&Array.isArray(evidence.testRefs)&&Array.isArray(evidence.limitations)?evidence:undefined;
  }
  private syncDelegationDeadlines():void {
    for(const run of this.ledger.runs())for(const row of runDelegations(this.deps(),run.id)) {
      const key=row.childSessionId;if(this.delegationTimers.has(key)||!['intent','accepted'].includes(row.state))continue;
      const timer=setTimeout(()=>{
        this.delegationTimers.delete(key);
        this.ctx.get('agents')?.get(key as never)?.cancel({kind:'hook',reason:'The recorded delegation deadline expired.'});
        void controlling(this.deps(),run.id,async()=>{const latest=runDelegations(this.deps(),run.id).find(d=>d.childSessionId===key);if(!latest||!['intent','accepted'].includes(latest.state))return;await this.ledger.appendDelegation(run.id,{delegationId:row.delegationId,parentSessionId:row.parentSessionId,childSessionId:key,requestId:`deadline:${row.delegationId}`,requestDigest:identityOf({deadlineAt:row.reservation.deadlineAt}),event:'deadline',payload:{reason:'Original child time allocation expired; new work is fenced.',stopObserved:this.ctx.get('agents')?.get(key as never)?.status==='idle'}});}).then(()=>this.settleStrandedTeams(run.id)).then(()=>this.closeUndrivableInteractiveSessions(run.id)).catch(error=>this.ctx.logger.warn(String(error)));
      },Math.max(1,Date.parse(row.reservation.deadlineAt)-Date.now()));timer.unref();this.delegationTimers.set(key,timer);
    }
  }

  /** A confirmed Guide proposal starts in an independent native session. Fabric still owns Run admission. */
  async startGuidedRun(request: StartRunRequest): Promise<StartRunResult> {
    if(this.exitRequest)throw new BadRequest('the App is closing; no new task may start');
    if (legacyAutomaticAllowed()) return this.startRun(request);
    if (!request.ownerSessionId || !request.proposalId) {
      throw new BadRequest('confirm a current Campaign proposal from a live Guide conversation before starting');
    }
    const prior = await durableProposalRun(this.deps(),request.proposalId,durableStartRequestDigest(request));
    if (prior) {
      const product=(prior.opening.data as {product?:{guideSessionId?:string;parentSessionId?:string}}).product;
      if(product?.guideSessionId!==request.ownerSessionId) throw new BadRequest('this proposal belongs to another Guide; open its existing Campaign');
      // A duplicate confirmation reads the accepted Run, including after handoff or Pack upgrade.
      // It cannot create another owner or reinterpret the original method from today's files.
      return durableStartResult(this.durable,prior);
    }
    if (!authenticCampaignProposalId(request.proposalId)) throw new BadRequest('the Campaign proposal is not an authenticated current confirmation');
    const preparation = this.preparation(loadPack(this.config.packsDir, request.pack), loadSite(this.config.sitesDir, request.site), request.overrides);
    if (!preparation.ready || !sameCampaignProposalFacts(preparation.id, request.proposalId)) throw new BadRequest('Campaign preparation changed; review the current proposal before starting');
    const task = await prepareCampaignSession(this.ctx, { guideSessionId: request.ownerSessionId, proposalId: request.proposalId });
    return this.startRun({ ...request, ownerSessionId: task.sessionId, guideSessionId: request.ownerSessionId, notifyOwnerOnOpen: true });
  }

  executionContext(runId: string): ExecutionContext { return executionContext(this.deps(), runId); }

  async executionAction(request: ExecutionActionRequest): Promise<ExecutionActionResult> {
    // Only the Host's own driver acts as the autopilot; no caller of this service may.
    if(request.origin==='autopilot')return {kind:'refused',context:await this.readExecutionContext(request.runId),reason:'Callers cannot take scheduler turns; inspect the current Run facts'};
    const result=await executionAction(this.deps(),request);
    if(result.kind==='accepted'){this.notifyGuideBoundary(request.runId);this.autopilot?.kick(request.runId);}
    return result;
  }

  /** Independent sinks of committed facts: neither loop chooses or advances business work. */
  private async observeDurableFacts(label:string,consume:()=>Promise<void>):Promise<void> {
    let lastFailure:string|undefined;
    while(!this.factStop.signal.aborted) {
      try {await consume();lastFailure=undefined;}
      catch(error) {const failure=String(error);if(failure!==lastFailure&&!this.factStop.signal.aborted)this.ctx.logger.warn(`Durable ${label} remains pending: ${failure}`);lastFailure=failure;}
      await waitForFactPoll(2000,undefined,{signal:this.factStop.signal}).catch(()=>undefined);
    }
  }

  private async projectDurableHistory():Promise<void> {
    const originals=new Map((await this.durable.store.runs()).map(run=>[run.runId,run]));
    await this.durable.store.projectFacts(async fact=>{
      if(this.factStop.signal.aborted)throw new Error('Host is stopping; history facts remain pending');
      const original=originals.get(fact.runId)??await this.durable.store.run(fact.runId);
      const opening=(original.opening.data as unknown as {run:import('./ledger.js').RunRecord}).run;
      await this.ledger.projectDurableFact(fact,opening);
    });
  }

  private async deliverDurableBoundaries():Promise<void> {
    if(!this.notificationsActive||this.exitRequest||(process.env.NODE_TEST_CONTEXT!==undefined&&process.env.HIMA_TEST_SILENT_AGENT==='1'))return;
    for(const original of await this.durable.store.runs()) {
      if(this.factStop.signal.aborted||this.exitRequest)return;
      const sourceRevision=await this.durable.store.sourceRevision(original.runId);
      if(this.notifiedSourceRevisions.get(original.runId)===sourceRevision)continue;
      const view=await this.viewReaders().readRunView(original.runId);if(!view)continue;
      const blockers=(view.tasks??[]).filter(task=>task.current!==false&&(task.projection.state==='failed'||task.projection.state==='waiting'&&
        ['human-response','reader-rejected','resource-closure','adapter-materialization','input-schema','output-schema','output-envelope','artifact-identity'].includes(task.projection.reason.code)))
        .map(task=>({taskId:task.taskId,effectId:task.identity?.effectId,projection:task.projection}));
      const terminal=hasEnded(view.run.status),stop=view.run.stopState,control=await this.durable.store.latestControlFact(original.runId);
      if(!terminal&&!blockers.length&&!stop&&!control){this.notifiedSourceRevisions.set(original.runId,sourceRevision);continue;}
      const current=await this.durable.store.run(original.runId);
      if(current.epoch!==original.epoch||current.revision!==original.revision)continue;
      const guide=(original.opening.data as {product?:{guideSessionId?:string}}).product?.guideSessionId;
      const boundary={runId:original.runId,epoch:current.epoch,revision:current.revision,status:view.run.status??null,
        goalState:view.run.goalState??'unknown',stop:stop??null,blockers,control:control?{action:control.command.action,commandId:control.command.commandId,source:control.factId}:null};
      const fingerprint=identityOf({...boundary,stop:stop?.state??null});
      let allDelivered=true;
      for(const recipient of new Set([current.owner,...(guide&&(terminal||blockers.length||stop)?[guide]:[])])) {
        const key=`notice:${identityOf({recipient,fingerprint})}`;
        if(await this.durable.store.flowFact(original.runId,key))continue;
        const agent=this.ctx.get('agents')?.get(recipient as never);if(!agent){allDelivered=false;continue;}
        const marker=`Hima durable boundary ${fingerprint}`;
        const messages=[...agent.session.deriveMessages(),...agent.inbox.nextTurn,...agent.inbox.nextStep];
        if(!JSON.stringify(messages).includes(marker)) {
          const text=`${marker}. Source: Hima PostgreSQL Run ${original.runId}, read watermark ${view.run.sourceRevision}. ${JSON.stringify(boundary)}. Read current task facts and explain the verified outcome or actionable blocker. Workflow continuation is automatic. Current owner is ${current.owner}; this notice grants no execution authority, new Campaign, or additional budget.`;
          agent.followup(createUserMessage({source:{kind:'plugin',plugin:'hima'},content:[{type:'text',text}]}));
        }
        await this.durable.store.putFlowFact(original.runId,key,{recipient,fingerprint,sourceRevision:view.run.sourceRevision??0});
      }
      if(allDelivered)this.notifiedSourceRevisions.set(original.runId,sourceRevision);
    }
  }

  /** A source-linked important boundary reaches the original Guide; it grants no execution authority. */
  private notifyGuideBoundary(runId:string):void {
    if(!this.notificationsActive||(process.env.NODE_TEST_CONTEXT!==undefined&&process.env.HIMA_TEST_SILENT_AGENT==='1'))return;
    const run=this.ledger.run(runId);const guideId=run?.control?.guideSessionId;
    if(!run?.control||!guideId||guideId===run.control.owner)return;
    const failed=Object.values(run.control.executions).filter(e=>!e.supersededBy&&['failed','uncertain'].includes(e.phase)).map(e=>({id:e.id,phase:e.phase}));
    if(!hasEnded(run.status)&&run.status!=='waiting'&&failed.length===0)return;
    const fingerprint=identityOf({runId,status:run.status,failed,stop:run.control.stop});
    const key=`guide:${guideId}:${runId}`;
    if(this.guideNoticeIdentities.get(key)===fingerprint)return;
    const guide=this.ctx.get('agents')?.get(guideId as never);if(!guide)return;
    const marker=`Hima Guide boundary ${fingerprint}`;
    if(JSON.stringify(guide.session.deriveMessages()).includes(marker)){this.guideNoticeIdentities.set(key,fingerprint);return;}
    const message=createUserMessage({source:{kind:'plugin',plugin:'hima'},content:[{type:'text',text:`${marker}. Task ${runId} is ${run.status}; ${failed.length} execution(s) need review. Read the current Run facts and explain its verified outcome, blockers and next options to the user. Execution owner remains ${run.control.owner}; this notice does not authorize continuation, a new Campaign, or extra budget.`}]});
    const prior=this.pendingProgressNotifications.get(key);
    if(!prior||!guide.inbox.replace(prior,message))guide.followup(message);
    this.pendingProgressNotifications.set(key,message.id);this.guideNoticeIdentities.set(key,fingerprint);
  }

  resumeRun(runId: string, who: string): Promise<ResumeResult> {
    return resumeRun(this.deps(), { runId, who });
  }

  cancelRun(runId: string): Promise<CancelResult> {
    return cancelRun(this.deps(), runId);
  }

  /** Read a Campaign's technical report back off its Site, both files held against their hashes. */
  readExperience(runId: string): Promise<ReadExperienceResult> {
    return this.viewReaders().readExperience(runId);
  }

  /** Read one Run-owned historical code or knowledge version at its recorded identity. */
  readMaterial(runId: string, recordId: string): Promise<ReadMaterialResult> {
    return this.viewReaders().readMaterial(runId,recordId);
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
      return { result: reviewed.result, saved: siteHeadViewOf(saveDiscoveredSite(this.config.sitesDir, reviewed.result, reviewed.identity)) };
    }
    // Bug 2 fix: an omitted `ssh` rediscovers an already-saved ssh Site's own destination, jumps and
    // permitted roots — exactly the input `rediscoverInput` already computes for `hima_site
    // rediscover`'s tool call, now reachable from this route too so the Configuration page can offer
    // a person their own "Rediscover" button on a Site that already exists, not only a brand-new one.
    // A body naming neither `ssh` nor an existing Site of that name is still the caller's own mistake.
    const identity = siteSaveIdentity(this.config.sitesDir, request.name);
    const existing = identity.kind === 'existing' ? loadSite(this.config.sitesDir, request.name) : undefined;
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
    const draft = selectedPack === undefined ? withSavedBindings : { ...withSavedBindings, site: { ...withSavedBindings.site,
      capacity: { ...withSavedBindings.site.capacity, licences: requiredLicences } } };
    // Rediscovery measures capabilities. It cannot offer policy changes as if they were discovered facts.
    const result: SiteDiscoveryResult = existing === undefined ? draft : { ...draft,
      site: { ...draft.site, workspaceRoot: existing.workspaceRoot, permit: existing.permit,
        capacity: existing.capacity, bindings: existing.bindings }, permit: existing.permitRules,
    };
    if (request.save !== true) {
      if (reviewOwner === undefined) return { result };
      const reviewId = randomUUID();
      for (const [id, draft] of this.siteDiscoveryReviews) {
        if (draft.owner === reviewOwner && draft.name === request.name) this.siteDiscoveryReviews.delete(id);
      }
      this.siteDiscoveryReviews.set(reviewId, { owner: reviewOwner, name: request.name, result, identity });
      return { result, reviewId };
    }
    return { result, saved: siteHeadViewOf(saveDiscoveredSite(this.config.sitesDir, result, identity)) };
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
    const original=await knownDurableRun(this.deps(),runId);
    if(original) {
      const records=await this.viewReaders().readRunRecords(runId,'job');
      const record=records.findLast(record=>record.type==='job'&&record.nodeId===nodeId);
      if(record?.type!=='job')return {nodeId,lines:[],at:new Date().toISOString(),truncated:false};
      const product=(original.opening.data as unknown as {product:{siteId:string;siteDigest:string}}).product;
      const site=loadSite(this.config.sitesDir,product.siteId);
      const {jsonDigest}=await import('./run-store.js');
      if(jsonDigest(JSON.parse(JSON.stringify(site)))!==product.siteDigest)throw new Error('Original Site changed; job log requires its recorded Site definition');
      const {retainedJobTail}=await import('./jobs.js');
      const bound=Math.min(Math.max(Math.trunc(lines),1),100),text=await retainedJobTail(site,record.job,bound+1),rows=text.split('\n');
      if(rows.at(-1)==='')rows.pop();
      return {nodeId,session:record.job.session,lines:rows.slice(-bound),truncated:rows.length>bound,at:new Date().toISOString()};
    }
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
      durable: this.durable,
      durableModelSelection: this.ctx.get('agentDefaultModel')?.currentSelection(),
      projectOfRun: async runId => {
        const durable = await knownDurableRun(this.deps(), runId);
        if (durable) {
          const product = (durable.opening.data as { product?: { guideSessionId?: string; parentSessionId?: string } }).product;
          return sessionProject(this.ctx, product?.guideSessionId ?? product?.parentSessionId ?? durable.owner);
        }
        const run = this.ledger.run(runId);
        const source = run?.projectSessionId ?? run?.control?.guideSessionId ?? run?.control?.owner;
        if (!source) return undefined;
        try { return await sessionProject(this.ctx, source); } catch { return undefined; }
      },
      judge: this.judge,
      sitesDir: this.config.sitesDir,
      packsDir: this.config.packsDir,
      // The host a workshop's Model moment is composed on (#62). The one thing here that is not a
      // file or a record, handed in for the same reason the moment route is handed `openMoment`: a
      // moment is composed out of this context, and every other operation reaches no host at all.
      host: this.ctx,
      stopSignal: this.factStop.signal,
      beforeSlotClaim:(siteName)=>reconcileExecutionIntents(this.deps(),siteName),
      log: (line) => this.ctx.logger.info(line),
      notify: (owner, runId, executionId, detail) => {
        this.notifyGuideBoundary(runId);
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
    // A Budget value the person asked for in the conversation (#64 D-T02-1) says so; one the Campaign
    // file wrote says 'file'. Both are the same override and join the proposal's facts the same way.
    const overridden = (key: 'timeBoxMinutes' | 'retries' | 'generations'): 'request' | 'file' =>
      overrides?.requestedBudget?.includes(key) ? 'request' : 'file';
    const budget: PreparationView['budget'] = {
      timeBoxMinutes: overrides?.budget?.timeBoxMinutes !== undefined ? { value: overrides.budget.timeBoxMinutes, source: overridden('timeBoxMinutes') }
        : pack.contract.budget.timeBoxMs !== undefined ? { value: pack.contract.budget.timeBoxMs / 60_000, source: 'pack' }
        : { value: defaultTimeBoxMs / 60_000, source: 'harness' },
      retries: overrides?.budget?.retries !== undefined ? { value: overrides.budget.retries, source: overridden('retries') }
        : { value: defaultRetryAllowance, source: 'harness' },
      generations: overrides?.budget?.generations !== undefined ? { value: overrides.budget.generations, source: overridden('generations') }
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

// Shared data boundary for DBOS tasks; adapters and Pack compilation consume one contract.
export { taskResultProtocol, taskSchemaDraft, taskJsonValue, taskIdentity, taskInputBinding,
  taskOutputBinding, taskSchema, taskContract, taskArtifact, taskDiagnostic, taskProjectionState,
  taskProjection, taskToolOutput, taskResult, TaskContractError, validateTaskInput, createTaskResult } from './task-contract.js';
export type { JsonValue, TaskIdentity, TaskInputBinding, TaskOutputBinding, TaskSchema, TaskContract,
  TaskLocalSchemas, TaskArtifact, TaskDiagnostic, TaskProjectionState, TaskProjection,
  TaskToolOutput, TaskResult, TaskContractErrorCode, TaskContractIssue } from './task-contract.js';

export { flowSourceVersion, flowIRVersion, flowElement, flowExtensionSlot, flowSource } from './flow-definition.js';
export type { FlowTask, FlowSequence, FlowChoice, FlowParallel, FlowRepeat, Flow, FlowSource,
  FlowExtensionSlot, FlowBlock, FlowBranch, CompiledTask, CompiledFlow, FrozenFlowFragment, FrozenLegacyFlowFragment } from './flow-definition.js';
export { FlowCompileError, compileFlow, compilePackFlow, compileLegacyFlow, compileLegacyGrowth,
  freezeFlowFragment } from './flow-compiler.js';
export type { CompileFlowOptions } from './flow-compiler.js';

export { startFlow, controlFlow, readFlow, scheduleFlowDeadline, flowWorkflowDefinitions } from './flow-workflow.js';
export type { FlowStart, FlowAdapterContext, FlowInvocation, FlowOutcome, FlowWorkflowOptions } from './flow-workflow.js';
