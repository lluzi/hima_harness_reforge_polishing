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
import { localFabric } from './support/fabric.ts';
import { himaCommand } from './support/command.ts';
import { installTwoKnobs, packsDirOf, shippedStrategyBlock, shippedWordsBlock, timingProbePackId, twoKnobPackId, twoKnobStrategyBlock, twoKnobWordsBlock, writePackVariant } from './support/pack.ts';

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
    // can be wrong about itself is. Since #63 the check answers that refusal rather than throwing
    // it, with the rung the folder stands on beside it — a pack that will not load is a folder that
    // has not reached `compiled`, and a person told only what is broken is not told what writes the
    // file that would fix it.
    const refusedDeclaresNoKnob = await himaCommand(host, h.workspace, '/hima pack check declares-no-knob --site local');
    assert.equal(refusedDeclaresNoKnob.kind, 'error', refusedDeclaresNoKnob.text);
    assert.match(refusedDeclaresNoKnob.text, /strategy: declares no knob, and a pack whose Strategy has nothing in it has nothing for an Explore node to choose/,
      `the empty block is refused for being empty, and not further down for the chooser and words that then have no knob to name: ${refusedDeclaresNoKnob.text}`);

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
