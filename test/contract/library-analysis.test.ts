// Contract: the QuaLib Insight tab's own library-analysis seam (`client/library-analysis.ts`) and
// the renamed mode tab. Pure client logic with no Host or Site — the discovery, the derived Campaign
// file, and the finished-Run report selection, each exercised the way the component reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en, zh } from '../../packages/harness/src/client/locale/dictionaries.ts';
import {
  ANALYSIS_TIME_BOX_MINUTES, analysisCampaignFile, analysisOutcome, declaresLibraryRoot,
  defaultLibraryFolder, discoverLibraryAnalysisPacks, goalDefaults, libraryKitKnob,
  libraryReportRef, LIB_INSIGHT_ROOT_INPUT, LIBRARY_INSIGHT_REPORT_KIND,
  type PackChoicesEntry,
} from '../../packages/harness/src/client/library-analysis.ts';
import type { StartChoices } from '../../packages/harness/src/workbench.ts';
import type { RunView } from '../../packages/harness/src/remote.ts';

/** A minimal preparation carrying only the fields these helpers read. */
function choices(inputs: readonly string[], extra: Partial<StartChoices> = {}): StartChoices {
  return { packs: [], sites: [], proposal: { inputs: inputs.map((name) => ({ name, description: name, ready: false })) }, ...extra } as unknown as StartChoices;
}

test('the mode tab reads "QuaLib Insight" in English and "QuaLib 洞察" in Chinese, Campaign unchanged', () => {
  assert.equal(en['workbench.mode.insight'], 'QuaLib Insight');
  assert.equal(zh['workbench.mode.insight'], 'QuaLib 洞察');
  assert.equal(en['workbench.mode.campaign'], 'Campaign');
  // Every new English key has a Chinese value (the shell enforces balance on registration).
  for (const key of Object.keys(en).filter((k) => k.startsWith('insight.analyse.') || k.startsWith('workbench.mode.'))) {
    assert.equal(typeof (zh as Record<string, string>)[key], 'string', `zh is missing ${key}`);
    assert.notEqual((zh as Record<string, string>)[key], undefined);
  }
});

test('discovery picks only Packs declaring the library-root input and ignores the rest', () => {
  const lib: PackChoicesEntry = { packId: 'offline-library-demo', choices: choices([LIB_INSIGHT_ROOT_INPUT, 'workspaceRoot']) };
  const timing: PackChoicesEntry = { packId: 'timing-probe', choices: choices(['design', 'workspaceRoot']) };
  const noProposal: PackChoicesEntry = { packId: 'unreadable', choices: { packs: [], sites: [] } as unknown as StartChoices };
  assert.equal(declaresLibraryRoot(lib.choices), true);
  assert.equal(declaresLibraryRoot(timing.choices), false);
  assert.equal(declaresLibraryRoot(noProposal.choices), false);
  const found = discoverLibraryAnalysisPacks([timing, lib, noProposal]);
  assert.deepEqual(found.map((entry) => entry.packId), ['offline-library-demo']);
});

test('the kit knob, default folder and Goal defaults come off the Pack declaration, not invented', () => {
  const prepared = choices([LIB_INSIGHT_ROOT_INPUT], {
    strategy: { kit: { type: 'choice', options: ['kit-a', 'kit-b'], default: 'kit-a' } },
    goal: { min_findings: { label: 'minimum findings', unit: 'count', min: 0, max: 1000, default: 1, precision: 0 } },
    proposal: { inputs: [{ name: LIB_INSIGHT_ROOT_INPUT, description: 'library root', ready: true, value: '/libs/prepared', source: 'site' }] },
  } as unknown as StartChoices);
  const kit = libraryKitKnob(prepared);
  assert.equal(kit?.name, 'kit');
  assert.deepEqual(kit?.knob.options, ['kit-a', 'kit-b']);
  assert.equal(kit?.knob.default, 'kit-a');
  assert.equal(defaultLibraryFolder(prepared), '/libs/prepared');
  assert.deepEqual(goalDefaults(prepared), { min_findings: 1 });
  // A preparation that binds no folder yields an empty field, never a stand-in value.
  assert.equal(defaultLibraryFolder(choices([LIB_INSIGHT_ROOT_INPUT])), '');
  assert.equal(libraryKitKnob(choices([LIB_INSIGHT_ROOT_INPUT])), undefined);
});

test('the Analyse Campaign file carries the folder, kit, Goal and time box, built from the request alone', () => {
  const file = analysisCampaignFile({
    packId: 'offline-library-demo', siteName: 'library-local', folder: '/libs/prepared',
    kitKnob: 'kit', kit: 'kit-b', goal: { min_findings: 1 }, timeBoxMinutes: ANALYSIS_TIME_BOX_MINUTES,
  });
  assert.equal(ANALYSIS_TIME_BOX_MINUTES, 60);
  assert.deepEqual(file, {
    schema: 'hima-campaign/1',
    name: 'QuaLib Insight analysis',
    pack: { id: 'offline-library-demo' },
    site: { name: 'library-local' },
    inputs: { [LIB_INSIGHT_ROOT_INPUT]: '/libs/prepared' },
    goal: { min_findings: 1 },
    strategy: { kit: 'kit-b' },
    budget: { timeBoxMinutes: 60 },
    knowledge: [],
    notes: '',
  });
  // Built purely from the request — the function takes no existing draft and so can never carry one
  // field of a person's `hima/campaign.yml` into the analysis file (the component saves and restores
  // that draft around the start; this derivation is what makes clobbering structurally impossible).
  const again = analysisCampaignFile({
    packId: 'offline-library-demo', siteName: 'library-local', folder: '/libs/prepared',
    kitKnob: 'kit', kit: 'kit-b', goal: { min_findings: 1 }, timeBoxMinutes: ANALYSIS_TIME_BOX_MINUTES,
  });
  assert.deepEqual(again, file);
});

test('a finished Run opens its library report; a running one waits, a blocked or report-less one fails', () => {
  const observation = (recordId: string, reportKind: string) => ({ recordId, at: '', path: '', contentSha256: '', bytes: 0, reader: { id: 'r', reportKind }, values: [] });
  const viewWith = (status: string | undefined, observations: unknown[], blocker?: string): RunView => ({
    run: { id: 'run-x', status, currentNode: 'read-insight' }, observations,
    blockers: blocker === undefined ? [] : [{ reason: blocker }], refusals: [], verdicts: [], nodes: [], generations: [], jobs: [],
  } as unknown as RunView);
  const label = (status: string) => `status:${status}`;

  const report = observation('rec-report', LIBRARY_INSIGHT_REPORT_KIND);
  const other = observation('rec-other', 'raw');
  assert.equal(libraryReportRef(viewWith('ended-goal-met', [other, report])), 'rec-report');
  assert.equal(libraryReportRef(viewWith('ended-goal-met', [other])), undefined);

  assert.deepEqual(analysisOutcome(viewWith('ended-goal-met', [other, report]), label), { kind: 'report', reportRef: 'rec-report' });
  assert.deepEqual(analysisOutcome(viewWith(undefined, []), label), { kind: 'running' });
  assert.deepEqual(analysisOutcome(viewWith('running', [report]), label), { kind: 'running' });
  assert.deepEqual(analysisOutcome(viewWith('waiting', [], 'a hard blocker stopped the Job'), label, 'a hard blocker stopped the Job'), { kind: 'failed', reason: 'a hard blocker stopped the Job' });
  // With no blocker sentence to hand, a waiting Run still fails with the status word, never silently.
  assert.deepEqual(analysisOutcome(viewWith('waiting', []), label), { kind: 'failed', reason: 'status:waiting' });
  assert.deepEqual(analysisOutcome(viewWith('ended-goal-not-met', [other]), label), { kind: 'failed', reason: 'status:ended-goal-not-met' });
});
