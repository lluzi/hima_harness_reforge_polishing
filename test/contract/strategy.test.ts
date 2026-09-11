// Ticket #58: the Strategy is the pack's. The contract declares the knobs a Run of that pack is set
// to — a number with a unit and bounds, a choice out of a list — and every face shows them in the
// pack's own words and carries them on the wire by name.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam every
// step-3 and step-4 test boots through: a Campaign is started by filling the form and clicking
// start, and what is asserted is what the page shows, what the routes answer with the session the
// shell established, and what the report the Site holds says. The two command faces — `/hima run
// --set` and `/hima status` — are words, and words are what `bootInProcess` is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootDriver, fillForm as fillTheForm, theOneRunId, waitForKnobs, type BootedDriver } from './support/driver.ts';
import { killSessions, localFabric, sessionsOf } from './support/fabric.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { api } from './support/hima-api.ts';
import { installTwoKnobs, packsDirOf, shippedStrategyBlock, shippedWordsBlock, timingProbePackId, twoKnobPackId, twoKnobStrategyBlock, twoKnobWordsBlock, writePackVariant } from './support/pack.ts';
import { badStrategyValue, unknownStrategyKnob } from '@hima/harness';
import type { DecisionRecord, LedgerRecord, RunView } from '@hima/harness';

/** What the two-knob variant's own form is filled with, beside the knobs it declares. */
const FORM = {
  'start-site': 'local',
  'start-target': '2.0',
  'start-time-box': '5',
  'start-retries': '2',
  'start-generations': '4',
} as const;

/**
 * The three generations this Campaign takes on the stand-in flow, which closes at 2.20 ns.
 *
 * Generation one asks for the knob's declared default, 2.40 ns, and meets it — so the report states
 * no margin at all, the way Design Compiler states one (#54) — and the chooser tightens the number
 * knob by the whole guard band this variant binds: 2.40 − 0.00 − 0.25. Generation two asks for that
 * 2.15 ns and misses by 0.05, so the constraint fails and the chooser sets the *choice* knob
 * instead, leaving the number where it is. Generation three asks for the same 2.15 ns again, which
 * is a move of nothing, and the exploration is converged.
 */
const GENERATIONS = [
  { periodNs: 2.4, profile: 'balanced' },
  { periodNs: 2.15, profile: 'balanced' },
  { periodNs: 2.15, profile: 'dense' },
] as const;

/** This file's own fields, filled by the shared `fillForm` (`support/driver.ts`). The pack is not
 *  among them: it is chosen first, by `choosePack`, because choosing it replaces the knob fields. */
const fillForm = (d: BootedDriver, changes: Readonly<Record<string, string>> = {}): Promise<void> => fillTheForm(d, FORM, changes);

/**
 * Choose the two-knob pack on the start form and wait for the page to have re-read its declaration.
 *
 * The knob fields are the selected pack's, so they are replaced when the selection changes; a test
 * that filled one before the replacement would be filling a field about to be thrown away. The wait
 * itself is the shared one every face of this form uses.
 */
async function choosePack(d: BootedDriver, pack: string): Promise<void> {
  const chose = await d.fill('start-pack', pack);
  assert.ok(chose.ok, `fill start-pack: ${JSON.stringify(chose)}`);
  await waitForKnobs(d, pack);
}

/** That Run over the route, with the session the shell established. */
async function runOverTheRoute(d: BootedDriver, runId: string): Promise<RunView> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}`);
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return JSON.parse(text) as RunView;
}

/** Every record of one Run, exactly as the ledger holds it, over the route the window reads. */
async function recordsOf(d: BootedDriver, runId: string): Promise<LedgerRecord[]> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}/records`);
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return (JSON.parse(text) as { readonly records: LedgerRecord[] }).records;
}

test('a pack declaring two knobs shows both on the start form in its own words, and the Run it starts carries both by name through the row, the decision, the card and the report', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const pack = await installTwoKnobs(packsDirOf(d.home));
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    const form = await d.read('start');
    assert.ok(form.ok, `the workbench page carries the start form: ${JSON.stringify(form)}`);
    assert.equal(form.state.packs, '2', `the shipped pack and the variant are both installed: ${JSON.stringify(form)}`);

    // The form shows one field per declared knob, in the pack's words: the label, the unit and the
    // bounds for the number, the label and the options for the choice. Never the names the wire
    // carries them under, which is what the words are declared instead of.
    await choosePack(d, pack);
    const knobs = await d.read('start-knobs');
    assert.ok(knobs.ok, JSON.stringify(knobs));
    for (const said of ['clock period', 'ns', '0.5', '10', 'mining profile', 'plain', 'balanced', 'dense']) {
      assert.ok(knobs.text.includes(said), `the knob fields say "${said}": ${knobs.text}`);
    }
    assert.ok(!knobs.text.includes('periodNs'), `and not the name the wire carries the number knob under: ${knobs.text}`);

    // The number knob is left at the default the contract declares; the choice is set to one the
    // contract offers. So the Run that starts says both things at once: what the form filled in of
    // its own accord, and what a person chose.
    await fillForm(d);
    const chosen = await d.fill('start-knob-profile', 'balanced');
    assert.ok(chosen.ok, `fill start-knob-profile: ${JSON.stringify(chosen)}`);
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));

    const status = await d.wait('run-status', 'ended', 180_000);
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, 'ended-converged', `the exploration stopped moving: ${JSON.stringify(status)}`);

    const runId = await theOneRunId(d);
    const view = await runOverTheRoute(d, runId);
    assert.equal(view.run.packId, pack, 'the pack the form named');
    // The wire carries the knobs by name, both of them, and the words beside them.
    assert.deepEqual(
      view.generations[0]?.strategy,
      { periodNs: 2.4, profile: 'balanced' },
      `the first generation was set to the declared default and the chosen option: ${JSON.stringify(view.generations[0])}`,
    );
    // And the number knob landed where a knob actually goes: on the command line the Site was given.
    const launched = view.jobs.find((j) => j.event === 'launched');
    assert.ok(launched, `the Run launched a job: ${JSON.stringify(view.jobs)}`);
    assert.match(launched.job.wire, /CLOCK_PERIOD_NS=2\.4\b/, `synthesized at the default the form filled in: ${launched.job.wire}`);
    assert.deepEqual(
      view.run.words?.strategy,
      { periodNs: { label: 'clock period', unit: 'ns' }, profile: { label: 'mining profile' } },
      `the pack's words for both knobs, the choice knob's without a unit: ${JSON.stringify(view.run.words)}`,
    );
    assert.deepEqual(
      view.generations.map((g) => g.strategy),
      GENERATIONS.map((g) => ({ ...g })),
      `each generation says what its whole Strategy asked for: ${JSON.stringify(view.generations)}`,
    );

    // The chooser set the choice knob on a failed constraint, and the decision carries the whole
    // Strategy it chose — the knob it changed and the knob it carried over — by name.
    const decisions = (await recordsOf(d, runId)).filter((r): r is DecisionRecord => r.type === 'decision');
    assert.equal(decisions.length, 3, `one decision per generation: ${JSON.stringify(decisions)}`);
    assert.deepEqual(decisions[0]!.chosen, { strategy: { periodNs: 2.15, profile: 'balanced' } }, 'generation one tightened the number knob and carried the choice over');
    assert.deepEqual(decisions[1]!.chosen, { strategy: { periodNs: 2.15, profile: 'dense' } }, 'generation two set the choice knob and carried the number over');
    assert.ok('converged' in decisions[2]!.chosen, `and generation three converged: ${JSON.stringify(decisions[2])}`);

    // The generations table says that decision in the pack's words, both knobs.
    assert.equal(view.generations[1]!.decision, 'next strategy: clock period 2.15 ns, mining profile dense', JSON.stringify(view.generations[1]));

    // And so does the card's banner, off the row the Run ended on. The card is opened again because
    // the run id above was read off the list page, which is where a person reads it too.
    const card = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(card.ok, JSON.stringify(card));
    const said = await d.wait('run-status', 'strategy: clock period 2.15 ns, mining profile dense', 30_000);
    assert.ok(said.ok, `wait run-status: ${JSON.stringify(said)}`);
    assert.ok(!said.text.includes('periodNs'), `the name the wire carries is nowhere on the card: ${said.text}`);

    // The Campaign's technical report says the same thing in the same words.
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const answered = await api(host, await d.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}/experience.md`);
    const markdown = await answered.text();
    assert.equal(answered.status, 200, markdown);
    assert.ok(markdown.includes('clock period 2.15 ns, mining profile dense'), `the report says the strategy in the pack's words: ${markdown}`);
    assert.ok(!markdown.includes('periodNs'), `and not the name the wire carries it under: ${markdown}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a knob value outside its bounds or outside its list is refused in the window in the validator\'s own words, and no Run is started', async (t) => {
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const pack = await installTwoKnobs(packsDirOf(d.home));
    const opened = await d.open('/hima/');
    assert.ok(opened.ok, JSON.stringify(opened));
    const before = await d.read('start-error');
    assert.ok(before.ok, `the region is there before anything was refused: ${JSON.stringify(before)}`);
    assert.equal(before.text, '', 'and says nothing');

    await choosePack(d, pack);
    await fillForm(d);
    const typed = await d.fill('start-knob-periodNs', '12');
    assert.ok(typed.ok, `fill start-knob-periodNs: ${JSON.stringify(typed)}`);
    const clicked = await d.click('start');
    assert.ok(clicked.ok, JSON.stringify(clicked));

    const outOfBounds = badStrategyValue('periodNs', { type: 'number', unit: 'ns', min: 0.5, max: 10, default: 2.4 }, 12);
    const refused = await d.wait('start-error', outOfBounds, 30_000);
    assert.ok(refused.ok, `wait start-error: ${JSON.stringify(refused)}`);
    assert.ok(refused.text.includes(outOfBounds), `the window says what the shared validator says: ${JSON.stringify(refused)}`);

    const runs = await d.read('runs');
    assert.ok(runs.ok, JSON.stringify(runs));
    assert.equal(runs.state.count, '0', `nothing was started: ${JSON.stringify(runs)}`);

    // The choice knob's own refusal, over the route the form posts to: the select offers only what
    // the pack declares, so a value outside the list is one a caller composed rather than one a
    // person could click, and it is refused in the same words for the same reason.
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const started = await api(host, await d.cookie(), '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { profile: 'aggressive' } }),
      headers: { 'content-type': 'application/json' },
    });
    const text = await started.text();
    assert.equal(started.status, 400, text);
    const notAnOption = badStrategyValue('profile', { type: 'choice', options: ['plain', 'balanced', 'dense'], default: 'plain' }, 'aggressive');
    // The route answers JSON, so the sentence is in it with its quotes escaped: compared as the JSON
    // holds it rather than by a looser match a half-sentence would satisfy.
    assert.ok(text.includes(JSON.stringify(notAnOption).slice(1, -1)), `the route says what the shared validator says: ${text}`);
    const after = await d.read('runs');
    assert.ok(after.ok, JSON.stringify(after));
    assert.equal(after.state.count, '0', `and started nothing either: ${JSON.stringify(after)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('/hima run sets a knob by name with --set, refuses a value the declaration does not allow, and /hima status says every knob in the pack\'s words', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const pack = await installTwoKnobs(packsDirOf(h));

    // A value the declaration does not allow is refused before any Campaign exists, in the words the
    // window is refused in: one table, three faces.
    const refused = await himaCommand(host, h.workspace, `/hima run ${pack} --site local --goal target_period_ns=2.0 --set profile=aggressive`);
    assert.equal(refused.kind, 'error', refused.text);
    assert.ok(
      refused.text.includes(badStrategyValue('profile', { type: 'choice', options: ['plain', 'balanced', 'dense'], default: 'plain' }, 'aggressive')),
      `the command says what the shared validator says: ${refused.text}`,
    );
    assert.equal(refused.runId, undefined, `and started nothing: ${refused.text}`);

    // And a knob no pack declares, which is the other half of the same table (#58): a caller setting
    // a knob that is not there is setting nothing, and a Run started for them would have run at the
    // defaults without saying so. Refused in the validator's own sentence, naming what this pack
    // does declare, before any Campaign exists.
    const notAKnob = await himaCommand(host, h.workspace, `/hima run ${pack} --site local --goal target_period_ns=2.0 --set nosuch=1`);
    assert.equal(notAKnob.kind, 'error', notAKnob.text);
    assert.ok(
      notAKnob.text.includes(unknownStrategyKnob('nosuch', ['periodNs', 'profile'])),
      `the command says what the shared validator says: ${notAKnob.text}`,
    );
    assert.equal(notAKnob.runId, undefined, `and started nothing: ${notAKnob.text}`);

    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.4 --set profile=dense --generations 1`,
      siteCommandTimeoutMs,
    );
    assert.equal(started.kind, 'success', started.text);
    const runId = started.runId!;
    sessions = sessionsOf(host, runId);

    // Both knobs, in the pack's words, on the one line the card says them on: the number with its
    // unit, the choice without one.
    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    assert.equal(status.kind, 'success', status.text);
    assert.match(status.text, /^ {2}strategy: clock period 2\.4 ns, mining profile dense$/m, `the strategy in the pack's words: ${status.text}`);
    assert.match(status.text, /^ {2}decision: .* chose clock period 2\.15 ns, mining profile dense by test-profile-by-outcome/m, `and the decision it chose: ${status.text}`);
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('a contract declaring no strategy knob at all is refused when the pack is loaded, in the contract schema\'s own words', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    // Every other rule of the `strategy:` block is in the schema — the bounds hold, the default is
    // inside them, a choice's default is one of its options — and so is this one, because a pack
    // declaring an empty block is a pack whose start form would have nothing on it, whose Explore
    // node would choose between nothing, and whose first Run would otherwise be refused deep in the
    // ledger's own row schema rather than in a sentence about the pack.
    await writePackVariant(packsDirOf(h), 'declares-no-knob', [[shippedStrategyBlock, 'strategy: {}']]);
    // Refused where the contract is read, so it is refused the way every other thing the contract
    // can be wrong about itself is: a pack whose own files do not parse propagates out of the
    // command rather than being answered, because there is no pack there to report on.
    await assert.rejects(
      () => himaCommand(host, h.workspace, '/hima pack check declares-no-knob --site local'),
      /strategy: declares no knob, and a pack whose Strategy has nothing in it has nothing for an Explore node to choose/,
      'the empty block is refused for being empty, and not further down for the chooser and words that then have no knob to name',
    );

    // The shipped pack, unvaried, is the control: the refusal above is about the one thing that was
    // varied and not about a pack that could never have loaded.
    const fits = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site local`);
    assert.equal(fits.kind, 'success', fits.text);
  } finally {
    await dispose();
  }
});

test('/hima pack check holds a chooser\'s knobs and a pack\'s words against the contract\'s own declaration, before a Campaign exists', async (t) => {
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const packsDir = packsDirOf(h);
    await installTwoKnobs(packsDir);

    // A chooser that sets a knob the contract does not declare is a decision the engine could never
    // act on: the value would reach no node, and the Run would go round again at the Strategy that
    // just ran. Said where every other thing a pack can be wrong about a Site is said, and before a
    // licence-minute of synthesis.
    await writePackVariant(packsDir, 'sets-an-undeclared-knob', [[twoKnobStrategyBlock, `strategy:
  periodNs: { type: number, unit: ns, min: 0.5, max: 10, default: 2.40 }`], [twoKnobWordsBlock, shippedWordsBlock]], [], twoKnobPackId);
    const undeclared = await himaCommand(host, h.workspace, '/hima pack check sets-an-undeclared-knob --site local');
    assert.equal(undeclared.kind, 'error', undeclared.text);
    assert.match(undeclared.text, /sets knob "profile" in clause 3, which contract\.yml does not declare; it declares "periodNs"/, undeclared.text);

    // And a knob the contract declares and says no words for: a field on the start form, a line on
    // the card and a column of the ledger that a person would read under the name the wire carries,
    // which for a knob — the pack's own invention — is nothing they could read it as.
    await writePackVariant(packsDir, 'says-nothing-for-a-knob', [[twoKnobWordsBlock, shippedWordsBlock]], [], twoKnobPackId);
    const wordless = await himaCommand(host, h.workspace, '/hima pack check says-nothing-for-a-knob --site local');
    assert.equal(wordless.kind, 'error', wordless.text);
    assert.match(wordless.text, /words: says nothing for strategy knob "profile", which this pack declares/, wordless.text);

    // And that refusal is the gate D47 states, at the face a person starts from: `startRun` runs
    // `checkPack` before anything else it does (`fabric.ts`), so a start of that same pack is
    // refused in the pack check's own sentence and no Run row is written. The start form falls back
    // to the name the wire carries for a knob it has no word for, on purpose — a form that would
    // not render is a worse answer than a name — so this is the assertion that says the fallback is
    // never what a Campaign runs on.
    const startedWordless = await himaCommand(host, h.workspace, '/hima run says-nothing-for-a-knob --site local --goal target_period_ns=2.0');
    assert.equal(startedWordless.kind, 'error', startedWordless.text);
    assert.match(startedWordless.text, /words: says nothing for strategy knob "profile", which this pack declares/, startedWordless.text);
    assert.equal(startedWordless.runId, undefined, `and named no Run: ${startedWordless.text}`);
    assert.deepEqual(host.ctx.hima.ledger.runs(), [], 'no Run row exists: the Campaign was refused before one was opened');

    // A choice knob given a unit is the other half of the same rule: a profile is not measured in
    // anything, and `mining profile dense ns` is what a face would otherwise print.
    await writePackVariant(packsDir, 'measures-a-choice', [[
      '  profile: { label: mining profile }',
      '  profile: { label: mining profile, unit: ns }',
    ]], [], twoKnobPackId);
    const measured = await himaCommand(host, h.workspace, '/hima pack check measures-a-choice --site local');
    assert.equal(measured.kind, 'error', measured.text);
    assert.match(measured.text, /words: gives strategy knob "profile" the unit "ns", and it is a choice of "plain", "balanced", "dense": a choice is measured in nothing/, measured.text);

    // The variant itself, unvaried, fits: the three refusals above are about what was varied and not
    // about a pack that could never have fitted.
    const fits = await himaCommand(host, h.workspace, `/hima pack check ${twoKnobPackId} --site local`);
    assert.equal(fits.kind, 'success', fits.text);
  } finally {
    await dispose();
  }
});
