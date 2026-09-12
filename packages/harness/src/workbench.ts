// The workbench page: `GET /hima/`, served by the bundle under the host's own origin, behind the
// same session fence as every route (ADR-0002). It starts a Campaign from a form, lists the ledger's
// Runs newest first, and with `?run=<id>` shows that Run's card with the controls that stop it or
// carry it on — the page the desktop shell's driver opens, reads, fills and clicks (D42, ADR-0004),
// and the page a person reaches from the window's Workbench menu item.
//
// The page holds no IPC and no state of its own (D39): its two inline scripts act over the very
// `/hima/api/` routes the card is rendered from, with the session the document was loaded under.
//
// The card here is rendered on the host from the run view, with the same sections, the same words
// and the same markers as the card the HimaGuide tool view renders in dsh's chat. It is not that
// React component mounted a second time: dsh's client-module envelope answers React and the
// baseline libraries only inside the web app's own index, and mounting the client bundle on a page
// of ours would have meant a second bundle carrying its own React. So the words live in one module
// both mounts read (`card-labels.ts`), the markers are the same attributes, and this file is the
// structure — one HTML string per section, mirroring `client/HimaRunCard.tsx` section for section.
// A change to what the card says goes to `card-labels.ts`; a change to what it shows goes to both.
//
// What the page *looks* like is `workbench-style.ts`: one stylesheet, opening with one delimited
// token sheet, light and dark selected by `prefers-color-scheme`. This file states no colour at all
// and no type size; the only sizes it states are the ones that are a table's shape rather than its
// look — the `<col>` width of each of a ledger's columns, which are the proportions of the table
// itself, and from which the `min-width` it may not be squeezed below is *computed* (`ledgerTable`)
// — and the percentages that place a bar's fill, its tick and the plot's two values where the
// numbers they draw actually fall. A section a
// later ticket adds is a `<section class="band">` with an `<h2 class="eyebrow">`, and it inherits
// the whole look; the classes are listed in the README under "Driving the window".
//
// The page is laid out in three bands at every width, so its canvas is never mostly empty:
//   1. the verdict — the Run's status as a seal with one anatomy and three moments (running, ended,
//      waiting), beside the four questions a person asks first as a fixed key/value grid;
//   2. the ledger — one row per Generation with its quantities drawn against their bounds, over a
//      plot of the convergence, and the path underneath;
//   3. the evidence — the blocker and its log tail, the cancel record, refusals, observations,
//      verdicts, and the decision.
//
// The markers a driver reads, on the card wherever it is mounted:
//   data-hima-region="run-status"       the verdict band; data-hima-state-status="<RunStatus>"
//   data-hima-region="run-meters"       the Budget: every meter against the bound the Run was started
//                                       under. -elapsed-ms, -time-box-ms, -generation,
//                                       -generation-limit, -jobs, -job-cap, -attempts,
//                                       -retry-allowance, one -licence-<name>="held/declared" per
//                                       licence the Site declares (the name lower-cased, because that
//                                       is how the DOM holds an attribute name on either mount), and
//                                       -ended-by="time-box"|"generation-limit"|"cancel" on a Run one
//                                       of them ended. A key the run row does not hold both halves of
//                                       is absent, never a zero. On this page the region is nested
//                                       *inside* `run-status`, under the third question — what it has
//                                       spent — so `read('run-status')` hands back the meters' words
//                                       too; `read`/`wait` find a region by name wherever it sits.
//   data-hima-region="run-generations"  the generations table, one row per generation the Run opened;
//                                       -count, -current (the generation running, else the last),
//                                       and -g<n>="running"|"done"|"blocked" per row. The keys are
//                                       the *outer* graph's rows, as they were: a drill-down Loop's
//                                       generations are rows of the same table but not generations
//                                       of the Campaign, and `run-loops` is what says anything of them
//   data-hima-region="run-loops"        the same ledger, when the Run opened a drill-down Loop (#28):
//                                       -count, how many it opened, and -open, the name of the one
//                                       still open, empty when none is. Absent on a Run that opened
//                                       none. It wraps the whole table because how many Loops a
//                                       Campaign opened is a fact about the Campaign and not about
//                                       one of its rows, and because reading it hands back every
//                                       nested row, whichever generation opened it
//   data-hima-loop="<loopId>"           not a region: it marks the rows of one drill-down Loop —
//                                       its group's head row, each of its generations' rows, and its
//                                       foot row — with the id the `opened` record minted, so the two
//                                       depths of the ledger are told apart in the page's own HTML
//   data-hima-region="run-branches"     the same ledger, when the Run forked (#29): each branch is a
//                                       row under the generation that forked it, and the join's line
//                                       closes them. -count, how many branches the Campaign forked
//                                       into, and -open, the join of the fork it is standing inside
//                                       — empty when it is standing inside none. Absent on a Run that
//                                       forked nowhere. It wraps the whole table for the reasons
//                                       `run-loops` does: both keys are facts about the Campaign
//                                       rather than about one of its rows, and reading it hands back
//                                       every branch row whichever generation forked it
//   data-hima-branch="<branchId>"       not a region: it marks one branch's own row with the branch's
//                                       id — the id of its first node, which every record of it
//                                       carries — so a fork's branches are told apart in the page's
//                                       own HTML and never by the order they happen to be in
//   data-hima-region="run-nodes"        the path; data-hima-state-<nodeId>="<NodeState>" per node
//   data-hima-region="run-cancel"       the stop a person asked for; -observed, what came of the latest
//   data-hima-region="run-blocker"      the blockers; -count, and -node naming the latest
//   data-hima-region="run-blocker-tail" the latest blocker's log tail, as the Job wrote it
//   data-hima-region="run-refusal"      what the run refused to read or to write down, and why; -count
//   data-hima-region="run-workshop"     where the node the Run stands at stands as a workshop (#62),
//                                       and what its current attempt wrote; -workshop, -state,
//                                       -files and -node
//   data-hima-region="run-observation"  what was observed; -count
//   data-hima-region="run-decision"     the decision; -chosen="goal-met"|"converged"|"next-strategy",
//                                       -strategy on a next strategy (the whole Strategy as JSON, by
//                                       the pack's own knob names, because an attribute name is
//                                       case-folded and a knob's is not), -read on a converged one
//   data-hima-region="run-experience"   the Campaign's technical report, on a Run that has ended and
//                                       had one written (#30): where both files are on the Site, what
//                                       each hashes to, a link to the `.md` route, and the report
//                                       itself rendered from its own Markdown. -sha256, the
//                                       Markdown's, and -written-at, the instant both files state as
//                                       their own. Absent on every Run whose report is not written
//   data-hima-region="run-error"        why a control's request was refused; empty text when none.
//                                       On this page it is nested *inside* `run-status`, under the
//                                       fourth question, beside the controls it belongs to — so
//                                       `read('run-status')` hands back a refusal's words and the
//                                       controls' too. `read`/`wait` find a region by name wherever
//                                       it sits, and its own text is still exactly the refusal.
//   data-hima-control="cancel"          stops the Run; shown while it is running or waiting
//   data-hima-control="resume"          carries a waiting Run on; shown only while it waits
// and on this page alone, which is where a Campaign is started (a chat has `/hima run`):
//   data-hima-region="runs"             the run list; -count, and -<runId>="<RunStatus>" per row that
//                                       has one, so a driver reads where a Run stands off the list
//   data-hima-region="start"            the start form; -packs and -sites, what this home has
//   data-hima-region="start-error"      why a start was refused; empty text when none
//   data-hima-control="start-pack"      the pack, chosen from the installed ones
//   data-hima-control="start-site"      the Site, chosen from the installed ones
//   data-hima-control="start-target"    the Goal's target_period_ns
//   data-hima-region="start-knobs"      the fields of the selected pack's own strategy knobs (#58),
//                                       one per knob it declares; -pack, which pack's they are, so
//                                       the page can tell whether a change of selection needs them
//                                       re-read
//   data-hima-control="start-knob-<name>" one such knob, under the name its pack declares: a text
//                                       field for a number, a select of its options for a choice
//   data-hima-control="start-time-box"  the Budget's time box, in minutes
//   data-hima-control="start-retries"   the Retry allowance
//   data-hima-control="start-generations" the Budget's generation limit
//   data-hima-control="start"           submits the form
import { answeredWithNoCode, bad, bannerLines, runPurposeMark, branchesIn, branchesState, branchLines, branchPointSaid, branchStateLabel, cancelAsked, cancelObserved, chosenSaid, citedSaid, couldNotReach, counted, decisionColour, decisionState, duration, EXPERIENCE_HEADING, EXPERIENCE_MARKDOWN_LINK, experienceFileSaid, experienceMarkdownHref, experienceState, experienceWrittenSaid, factQuestions, generationColumns, good, generationDecisionSaid, generationsState, generationStateLabel, groupSaid, jobEnding, joinSaid, labelled, LEDGER_ORDER, ledgerRows, loopClosedSaid, loopOpenedSaid, loopOutcomeLabel, loopSaid, loopsIn, loopsState, meterRows, metersState, nameOf, askedObservedSaid, startKnobField, NO_FABRIC_STATE, NO_RUNS, NOT_HELD, NOT_RECORDED, NOTHING_JUDGED, NOTHING_TO_DO_ENDED, NOTHING_TO_DO_NO_FABRIC, nodeStateLabel, workshopStateLabel, workshopSaid, workshopState, codeSaid, codeOfWorkshop, readerSaid, outcomeColour, pathColumns, plain, plotLabels, plotValue, runColumns, runControls, runStatusLabel, showsCancel, showsResume, slackSaid, START_HEADING, START_NO_PACK, START_NO_SITE, START_STATIC_FIT, START_STATIC_UNFIT, START_STATIC_LIMIT, startControl, startForm, tailSaid, warn } from './card-labels.js';
import type { PackCheck } from './packs.js';
import type { LedgerBranchRow, LedgerGenerationRow, LedgerJoinRow, LedgerRow, MeterRow, StartField } from './card-labels.js';
import { experienceReport, reportBlocks } from './experience-report.js';
import { HIMA_RUNS_PATH, HIMA_RUNS_START_PATH, HIMA_WORKBENCH_PATH, runCardPath } from './paths.js';
import { chosenKind, type ChosenKind, type WorkshopState } from './record-views.js';
import type { BranchState, BranchView, GenerationState, GenerationVerdictView, GenerationView, LoopView } from './generations.js';
import type { LoopOutcome, NodeState, RunStatus, RunStrategy } from './ledger.js';
import type { BlockerView, DecisionView, ExperienceView, NodeView, ObservationView, RunHeadView, RunView, RunWords, StrategyDeclaration, VerdictView } from './remote.js';
import { WORKBENCH_STYLE } from './workbench-style.js';

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One element's attributes, escaped, from a record of name to value. */
function attributes(pairs: Readonly<Record<string, string>>): string {
  return Object.entries(pairs).map(([name, value]) => ` ${name}="${escape(value)}"`).join('');
}

/** The `data-hima-state-*` attributes of a region, from the state it carries. */
const stateAttributes = (state: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(Object.entries(state).map(([key, value]) => [`data-hima-state-${key}`, value]));

const note = (text: string): string => `<div class="note">${escape(text)}</div>`;
const faint = (text: string): string => `<div class="faint">${escape(text)}</div>`;
const mono = (text: string): string => `<span class="mono">${escape(text)}</span>`;

/**
 * A sentence with its numbers set in the mono face, so a figure can be read off a line of prose.
 *
 * Wrapping and not rewriting: the spans are inline, so the rendered text of the element is character
 * for character the sentence `card-labels.ts` composed — which is what a driver reads and what the
 * suite asserts on ("converged: period moved by less than 0.05 over 1 generation, at 2.25 then
 * 2.25"). A number that changed shape on the way to the screen would be a fourth face saying a
 * decision differently.
 *
 * A *number*, and never a digit that happens to sit inside a name: the boundaries are what keep
 * `tmux session hima-2b9eabb1-synthesize-e0a881 is gone` — the sentence a cancelled Run's seal and
 * its cancel record are written from — one identifier in one face, rather than eight alternating
 * fragments with its hyphens eaten. No test of the rendered *text* can see that go wrong, because
 * the spans are inline and the words come out the same either way, so the guard is the fix and the
 * page's own HTML is where it is held (`window.test.ts`).
 *
 * A colon is one of those boundaries for the same reason a hyphen is (#30): `2026-09-10T10:00:07Z`
 * is an instant, which is a name and not a quantity, and the report the experience section renders
 * states one in a table cell — figured, its minutes would be set in a face its hours were not.
 */
const figured = (text: string): string =>
  escape(text).replace(/(?<![\w.:-])-?\d+(?:\.\d+)?(?![\w.:-])/g, (n) => `<span class="fig">${n}</span>`);

// ---------------------------------------------------------------------------------------------
// The glyph grammar: shape first, colour second
// ---------------------------------------------------------------------------------------------

/**
 * The six shapes every state on this page is drawn with. Shape *and* word, never hue alone: the
 * page reads correctly in greyscale, to a person who does not separate red from green, and in a
 * screenshot printed on a Site's black-and-white printer.
 *
 * The shapes are CSS (`workbench-style.ts`, `.g-*`), drawn as pseudo-elements so that a region's
 * rendered text is exactly the word — a driver reading "FAIL clock-period-at-most" reads what a
 * person reads, with nothing of the drawing in it.
 */
type Glyph = 'done' | 'running' | 'waiting' | 'missed' | 'pending' | 'blocked';

/**
 * Which shape each Run status wears.
 *
 * Keyed by every `RunStatus` there is, for the reason `card-labels.ts`'s tables are: a status added
 * to the ledger must be a build error here rather than a state drawn as nothing.
 *
 * `ended-converged` wears the waiting diamond and not the crossed square. The Campaign did what it
 * was asked and stopped spending to learn what it had already learned; the Goal was not met, and
 * what is in front of the person reading it is a decision to make, not a failure to fix — which is
 * exactly what the warning colour beside it says.
 */
const runStatusGlyph: Readonly<Record<RunStatus, Glyph>> = {
  running: 'running',
  waiting: 'waiting',
  cancelled: 'missed',
  'ended-goal-met': 'done',
  'ended-goal-not-met': 'missed',
  'ended-converged': 'waiting',
  'ended-budget-exhausted': 'missed',
};

/** Which shape each node state wears, keyed by every one the ledger can write. `reconciled` wears
 *  the dashed ring of a node nothing has settled yet, because that is what it is: a host picked the
 *  attempt up again and it has not concluded. */
const nodeStateGlyph: Readonly<Record<NodeState, Glyph>> = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  retrying: 'waiting',
  blocked: 'blocked',
  cancelled: 'missed',
  'waiting-for-slot': 'waiting',
  reconciled: 'pending',
};

/** Which shape a workshop node's own state wears, keyed by every one there is for the reason the
 *  node states are: a state this page cannot draw must not be drawn as nothing. */
const workshopGlyph: Readonly<Record<WorkshopState, Glyph>> = {
  writing: 'running',
  written: 'pending',
  'no-entry': 'missed',
  running: 'running',
  done: 'done',
  failed: 'waiting',
  blocked: 'blocked',
  interrupted: 'waiting',
};

/** Which shape each generation's row wears. */
const generationGlyph: Readonly<Record<GenerationState, Glyph>> = { running: 'running', done: 'done', blocked: 'blocked' };

/**
 * Which shape a drill-down Loop's ending wears at the head of its group of rows, keyed by every
 * `LoopOutcome` there is for the reason every other table here is keyed by its type.
 *
 * The Run statuses' shapes read one level down, exactly as `loopOutcomeLabel`'s colours are: a Loop
 * that met its Goal is done, one that converged wears the same decision-to-make diamond a converged
 * Campaign does, and one stopped by its own generation limit did not finish what it was asked.
 */
const loopOutcomeGlyph: Readonly<Record<LoopOutcome, Glyph>> = {
  'goal-met': 'done',
  converged: 'waiting',
  'generation-limit': 'missed',
};

/**
 * Which shape one branch of a fork wears on its row, keyed by every `BranchState` there is for the
 * reason every other table here is keyed by its type.
 *
 * The node states' shapes read one branch up, exactly as `branchStateLabel`'s colours are: a branch
 * is a little chain of act nodes, and what it is doing is what its current node is doing — running,
 * queued behind a full Site, done, or stopped for a person.
 */
const branchGlyph: Readonly<Record<BranchState, Glyph>> = {
  running: 'running',
  'waiting-for-slot': 'waiting',
  done: 'done',
  blocked: 'blocked',
};

/** Which shape each verdict outcome wears; an outcome this build has no shape for wears the ring of
 *  something nobody has concluded, for the same reason `labelled` says an unknown state plainly. */
const outcomeGlyph: Readonly<Record<string, Glyph>> = { PASS: 'done', FAIL: 'missed', UNDETERMINED: 'waiting' };

/** One state as a pill: the shape, the word, and the colour `card-labels.ts` says it in. */
function pill(said: string, colour: string, glyph: Glyph): string {
  return `<span class="pill g-${glyph}" style="color:${colour}">${escape(said)}</span>`;
}

/**
 * A ledger table: its opening tag and its columns, from the one list of widths.
 *
 * The widths are stated so a ledger's proportions are the design's and not the browser's guess at
 * what its longest cell happened to be. Pixels, because a column of numbers read against another
 * column of numbers is a shape, and these are the one size this file states.
 *
 * **The `min-width` is their sum, computed here**, which is what makes the rule this file states
 * true rather than remembered: the table is `table-layout: fixed` inside a `width: 100%` scroller,
 * so below its own minimum a browser scales every one of these columns down and the proportions the
 * widths are for are gone. Two of the three tables here had stated a smaller number than their
 * columns add up to and had been quietly scaling between the two ever since (the final review of
 * step 3b, H5). A number a caller may state separately is a number that can disagree with the
 * columns beside it; this one cannot.
 *
 * @param widths - one width per column, in page pixels, in the order the heads are written.
 * @returns the `<table>` open tag and its `<colgroup>`; the caller writes the head and the body.
 */
function ledgerTable(widths: readonly number[]): string {
  const minWidth = widths.reduce((sum, width) => sum + width, 0);
  return `<table class="ledger fixed" style="min-width:${String(minWidth)}px">`
    + `<colgroup>${widths.map((w) => `<col style="width:${String(w)}px">`).join('')}</colgroup>`;
}

/** One column head, with a trailing parenthetical kept whole: `period (asked → observed)` broken as
 *  "period (asked →" / "observed)" reads as two half-thoughts. The head is `card-labels.ts`'s word,
 *  shared with the card in the chat, so it is wrapped here rather than shortened there. */
const head = (said: string): string =>
  `<th>${escape(said).replace(/ (\([^()]*\))$/, ' <span class="nobr">$1</span>')}</th>`;

/** One state read out of a label table, drawn as a pill with the table's colour and its shape. */
function statePill(
  table: Readonly<Record<string, { readonly said: string; readonly colour: string } | undefined>>,
  glyphs: Readonly<Record<string, Glyph | undefined>>,
  state: string,
): string {
  const label = labelled(table, state);
  return pill(label.said, label.colour, glyphs[state] ?? 'pending');
}

// ---------------------------------------------------------------------------------------------
// Band 1: the verdict
// ---------------------------------------------------------------------------------------------

/**
 * The seal: where the Run stands, at the one display size this page spends, through one anatomy and
 * three moments.
 *
 * **running** is an open mark that breathes — the only motion on this page, because motion means
 * liveness and nothing else, and none of it under `prefers-reduced-motion`. **ended** is a plate,
 * perfectly still, carrying the verdict and the sentence behind it: the decision that ended the
 * Campaign, or for a Run a person stopped, what was actually observed to stop. **waiting** is the
 * boundary held rather than an error: the blocker's own sentence at reading size, inside the one red
 * this page spends.
 */
function seal(view: RunView): string {
  const { run } = view;
  const status = run.status;
  if (status === undefined) {
    return '<div class="seal" data-seal="none">'
      + pill(NO_FABRIC_STATE, plain, 'pending')
      + '</div>';
  }
  const label = labelled(runStatusLabel, status);
  const moment = status === 'running' ? 'running' : status === 'waiting' ? 'waiting' : 'ended';
  const blocker = view.blockers.at(-1);
  const cancel = view.cancels.at(-1);
  const said = status === 'cancelled' && cancel !== undefined
    ? cancelObserved(view, cancel).said
    : view.decision === null ? undefined : chosenSaid(view.decision, view.run.words);
  const beside = (moment === 'waiting' && blocker !== undefined ? `<p class="seal-blocked">${escape(blocker.reason)}</p>` : '')
    + (said === undefined ? '' : `<p class="seal-note">${figured(said)}</p>`);
  return `<div class="seal" data-seal="${moment}">`
    + '<div class="seal-head">'
    + (moment === 'running' ? `<span class="mark" style="color:${label.colour}"></span>` : '')
    + pill(label.said, label.colour, runStatusGlyph[status])
    + '</div>'
    + (beside === '' ? '' : `<div class="seal-said">${beside}</div>`)
    + '</div>';
}

/**
 * One meter drawn against its bound, where a bar can be drawn honestly at all: the track is the
 * bound, the fill is what has been spent, and the tick is where the bound falls.
 *
 * A meter no bar can draw — jobs launched against a cap on how many may run at once, a licence's
 * seats held beside what it has cost in milliseconds — leaves the bar column empty rather than
 * drawing something that would be read as an overrun. Empty and not absent: the column is a column,
 * and a row that skipped its middle cell would put its sentence under the bars.
 */
function meterBar(row: MeterRow): string {
  if (row.bar === undefined) return '<span class="meter-none"></span>';
  const { now, bound } = row.bar;
  const scale = Math.max(bound, now, 1);
  const filled = Math.min(100, (now / scale) * 100);
  const tick = Math.min(100, (bound / scale) * 100);
  // The meter that ended this Run is drawn in the one red the page spends, because it is the
  // answer to the question a person opened the card with.
  const colour = row.spent === true ? bad : plain;
  return `<span class="meter" style="color:${colour}">`
    + `<span class="meter-fill" style="width:${filled.toFixed(1)}%"></span>`
    + `<span class="meter-tick" style="left:calc(${tick.toFixed(1)}% - 1px)"></span>`
    + '</span>';
}

/**
 * What the Campaign has spent, every meter against the bound it was started under: the Budget's own
 * section of the card, on the page as in the chat (`run-meters`).
 *
 * One row per meter, in the three columns the band's meters have had since #41 — what the meter is
 * called, the meter drawn against its bound, and the rest of the sentence that says it. The words
 * are `card-labels.ts`' and are never typed twice, which is what keeps this section, `/hima status`
 * and the chat's card saying one Budget; the split between the name and the rest is that module's
 * too, so neither mount cuts a word off a sentence of its own.
 *
 * The bars are the middle column and not the last, so each sits beside the name of the meter it
 * draws however long that meter's sentence is. Held to one column because a bar is read against the
 * bar above it, and the sentences run past it to the right, where a line of prose belongs.
 *
 * The region's state attributes are `metersState`'s, which is the same set the chat's card carries
 * and the same set `/hima status` prints from: one meter, one key, wherever a Budget is read.
 */
function meterSection(view: RunView): string {
  const rows = meterRows(view);
  if (rows.length === 0) return '';
  const cells = rows.map((row) => `<div class="k">${escape(row.label)}</div>${meterBar(row)}<div class="note">${figured(row.detail)}</div>`);
  const marked = { 'data-hima-region': 'run-meters', ...stateAttributes(metersState(view)) };
  return `<div class="meters"${attributes(marked)}>${cells.join('')}</div>`;
}

/** Where the Run stands right now: which generation of how many, and which node it is at. */
function standingLines(view: RunView): string {
  const lines = bannerLines(view.run);
  const at = view.run.currentNode;
  const node = at === undefined ? undefined : view.nodes.find((n) => n.nodeId === at);
  return (lines.generation === undefined ? faint(NOT_RECORDED) : `<div>${figured(lines.generation)}</div>`)
    + (at === undefined
      ? ''
      : `<div>${mono(at)} ${node === undefined ? '' : statePill(nodeStateLabel, nodeStateGlyph, node.state)}</div>`);
}

/**
 * The two controls a person acts on a Run with, each shown only where it can act: cancel while the
 * Run is running or waiting, resume only while it waits — computed here, on the host, out of the
 * Run's own status, so a control on screen is a control that does something. Beside them, the region
 * that says why a click was refused — a control that silently does nothing is a control nobody can
 * trust, and the one refusal re-reading the card does not explain is a Site that could not be asked,
 * where nothing at all was written.
 *
 * Where neither can act, the question is still answered in words: an empty cell under "what a person
 * must do" is the one answer a person cannot act on.
 */
function controls(view: RunView): string {
  const status = view.run.status;
  const shown = [
    ...(showsCancel(status) ? [runControls.cancel] : []),
    ...(showsResume(status) ? [runControls.resume] : []),
  ];
  const buttons = shown.length === 0
    ? note(status === undefined ? NOTHING_TO_DO_NO_FABRIC : NOTHING_TO_DO_ENDED)
    : `<div class="controls">${shown.map((c) => `<button type="button"${attributes({ 'data-hima-control': c.control })}>${escape(c.said)}</button>`).join('')}</div>`;
  return buttons + `<p class="refusal"${attributes({ 'data-hima-region': 'run-error' })}></p>`;
}

/** One row of the headline board: the question, and what this Run answers it with. */
const fact = (question: string, answer: string, wide = false): string =>
  `<dt>${escape(question)}</dt><dd${wide ? ' class="wide"' : ''}>${answer}</dd>`;

/**
 * The verdict band: the seal, and the four questions a person asks first as a fixed grid.
 *
 * Fixed, and in this order, whatever the Run is doing: four ordered questions a person can learn
 * the position of beat a feed of whatever happened last, and the fourth is always answered because
 * "what must I do" with no answer is where a watched Campaign stalls.
 */
function verdictBand(view: RunView): string {
  const { run } = view;
  const lines = bannerLines(view.run);
  const marked = { 'data-hima-region': 'run-status', ...(run.status === undefined ? {} : { 'data-hima-state-status': run.status }) };
  // A test run says so before anything else on the card (#64): it is a pack author exercising their
  // own work, and reading one as a result of that pack is the mistake this mark exists to stop.
  const purpose = runPurposeMark(run.purpose);
  const exploring = (purpose === undefined ? '' : `<div${attributes({ 'data-hima-state-purpose': run.purpose! })}>${escape(purpose)}</div>`)
    + (run.packId === undefined ? '' : `<div>${mono(run.packId)}<span class="faint"> · </span>${mono(run.siteId)}</div>`)
    + (lines.goal === undefined ? '' : `<div>${figured(lines.goal)}</div>`)
    + (lines.strategy === undefined ? '' : `<div>${figured(lines.strategy)}</div>`);
  const spent = meterSection(view);
  return `<section id="run-overview" class="band verdict"${attributes(marked)}>`
    + seal(view)
    + '<dl class="facts">'
    + fact(factQuestions.exploring, exploring === '' ? faint(NOT_RECORDED) : exploring)
    + fact(factQuestions.standing, standingLines(view))
    // The last two answers run the width of the board: what a Run has spent is one sentence per
    // meter beside the bar that draws it, and a sentence that wraps three times is a sentence a
    // person stops reading.
    + fact(factQuestions.spent, spent === '' ? faint(NOT_RECORDED) : spent, true)
    + fact(factQuestions.todo, controls(view), true)
    + '</dl></section>';
}

// ---------------------------------------------------------------------------------------------
// Band 2: the generation ledger, over the plot of its convergence, over the path
// ---------------------------------------------------------------------------------------------

/**
 * Every row the ledger shows, at both depths, in the order it shows them — the outer generation,
 * then each Loop it opened as a head, its own rows and a foot — and the Generation rows of that
 * order, which are the ones the plot draws and the ones the scales are taken over.
 *
 * One walk of the tree for the table, the plot and the chat's card (`ledgerRows`, `card-labels.ts`).
 * The plot's axis is the Generation rows of the very list the table renders, so "one order for the
 * picture and the table, and never two" holds because there is one list, not because three walks
 * were kept agreeing by hand.
 */
const generationRowsOf = (rows: readonly LedgerRow[]): LedgerGenerationRow[] =>
  rows.filter((r): r is LedgerGenerationRow => r.kind === 'generation');

/** The branch rows of that same order (#29b): the rows a fork's own readings are on, which the table
 *  scales its bars over and the plot draws a point each for — at the generation that forked them,
 *  because that is the generation they were read in. */
const branchRowsOf = (rows: readonly LedgerRow[]): LedgerBranchRow[] =>
  rows.filter((r): r is LedgerBranchRow => r.kind === 'branch');

/**
 * The plot's drawing area, in user units. No text is drawn inside the SVG: the values live in the
 * HTML over it, so the picture scales with the band without the words scaling with it — which is
 * the whole reason for `gutter`, the margin at each end that the drawing stops short of and the two
 * values are written in (`.plot-value`, `workbench-style.ts`).
 */
const PLOT = { width: 1000, gutter: 76, laneTop: 4, laneHeight: 38, laneGap: 8 } as const;

/** Where the drawing's own edges fall, as a percentage of the figure — where the two values sit. */
const GUTTER_PERCENT = (PLOT.gutter / PLOT.width) * 100;

/** Where generation `index` (counted from zero) sits across the plot. */
function plotX(index: number, count: number): number {
  const span = PLOT.width - PLOT.gutter * 2;
  return count < 2 ? PLOT.gutter + span / 2 : PLOT.gutter + (index * span) / (count - 1);
}

/** A y-scale over a lane: the domain padded so a flat line does not sit on the lane's own edge. */
function scale(values: readonly number[], top: number): (value: number) => number {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low) * 0.15 || Math.max(Math.abs(high) * 0.15, 0.05);
  const min = low - pad;
  const max = high + pad;
  return (value) => top + PLOT.laneHeight - ((value - min) / (max - min)) * PLOT.laneHeight;
}

/**
 * The convergence, as a picture: the clock period each generation measured against the Goal's target
 * period, and the setup slack each generation closed with against zero.
 *
 * Drawn on the host as one inline SVG — no script, no canvas a person has to drag, no external
 * asset, because the window's fence permits none and this page must render offline. It is the one
 * thing on this page that says at a glance what the numbers underneath it say one row at a time: a
 * Campaign converging is a line going flat.
 *
 * Two values are written on it, in its own margins: the target period at the dashed line drawn for
 * it, and the period the last generation measured at its own dot. A picture whose only readable
 * words are its keys makes a person read the ledger under it to learn what it drew — and these two
 * are the pair the whole drawing is about, the bound and where the Campaign got to.
 *
 * Absent, rather than empty, while no generation has measured anything: a plot of no measurements is
 * a picture of nothing.
 *
 * A drill-down Loop's generations are on it too (#28), as a series of their own inside a marked span:
 * the sub-question the Campaign stopped to ask converges — or does not — in front of a person,
 * instead of collapsing into the one outer row that opened it. The span says which stretch of the
 * axis is one level down, and the key beside the picture names it.
 *
 * The axis is the ledger's order, which on such a Campaign is not the clock's — and `figure` carries
 * one line under the drawing saying so (`LEDGER_ORDER`), because a picture that claims an order it
 * does not have is worse than a picture with no order at all.
 */
function convergencePlot(view: RunView): { readonly keys: string; readonly figure: string } {
  // The Generation rows of the ledger's own list, in the ledger's own order: the head and the foot
  // of a Loop's group, a branch's row and the join's line are rows of the table and not places on
  // the axis — a fork ran *inside* one generation, so its branches are drawn at that generation.
  const all = ledgerRows(view.generations);
  const rows = generationRowsOf(all);
  const measured = rows.filter((r): r is LedgerGenerationRow & { row: GenerationView & { observedPeriodNs: number } } => r.row.observedPeriodNs !== undefined);
  // A fork's branches each read their own report and the generation that forked them read none of
  // its own (#29), so on a forked Campaign every measurement there is is a branch's.
  const generationOf = new Map(rows.map((r) => [r.row, r]));
  const branchPoints = branchRowsOf(all).flatMap((entry) => {
    // The branch's own numbers, off the branch view the fold composed: the period the point is drawn
    // at and the slack its bar is drawn from are two columns of one reading.
    const { observedPeriodNs, slackNs } = entry.branch;
    const on = generationOf.get(entry.row);
    return observedPeriodNs === undefined || on === undefined
      ? []
      : [{ on, branch: entry.branch, ns: observedPeriodNs, slackNs }];
  });
  if (measured.length === 0 && branchPoints.length === 0) return { keys: '', figure: '' };
  const target = view.run.goal?.target_period_ns;
  const periodTop = PLOT.laneTop;
  const slackTop = PLOT.laneTop + PLOT.laneHeight + PLOT.laneGap;
  const height = slackTop + PLOT.laneHeight + PLOT.laneTop;
  const yPeriod = scale([...measured.map((r) => r.row.observedPeriodNs), ...branchPoints.map((p) => p.ns), ...(target === undefined ? [] : [target])], periodTop);
  const slacks = [...rows.map((r) => r.row.slackNs), ...branchPoints.map((p) => p.slackNs)].filter((s): s is number => s !== undefined);
  const ySlack = scale([...slacks, 0], slackTop);
  const at = (entry: LedgerGenerationRow): number => plotX(rows.indexOf(entry), rows.length);

  // One line per series, and a Loop's generations are a series of their own: they are the same
  // quantity measured while a different question was being asked, and a line drawn straight through
  // both depths would say the Campaign moved from an outer measurement to an inner one.
  const seriesOf = (loop: LoopView | undefined): typeof measured => measured.filter((r) => r.loop === loop);
  const point = (r: (typeof measured)[number]): string => `${at(r).toFixed(1)},${yPeriod(r.row.observedPeriodNs).toFixed(1)}`;
  // A series is drawn as a line only where there is a line to draw. Every measurement is a dot of
  // its own either way, so a series of one point is on the picture; the polyline through it would be
  // a shape of no length, and the key beside the picture would name a line nobody can see.
  const polyline = (own: typeof measured, kind: string): string =>
    (own.length < 2 ? '' : `<polyline class="${kind}" points="${own.map(point).join(' ')}"/>`);
  const line = polyline(seriesOf(undefined), 'plot-line');
  const loops = loopsIn(view);
  const inner = loops.map((loop) => polyline(seriesOf(loop), 'plot-line-in')).join('');
  const dots = measured.map((r) => `<circle class="${r.loop === undefined ? 'plot-dot' : 'plot-dot-in'}" cx="${at(r).toFixed(1)}" cy="${yPeriod(r.row.observedPeriodNs).toFixed(1)}" r="4"/>`).join('');
  // A fork's branches are points and never a line: they did not follow one another, they ran at
  // once, and a line through them would say a Campaign moved from one branch's reading to another's.
  // Two points at one place on the axis, so each is named beside itself in the HTML over the drawing.
  const branchDots = branchPoints.map((p) => `<circle class="plot-dot-branch" cx="${at(p.on).toFixed(1)}" cy="${yPeriod(p.ns).toFixed(1)}" r="4"/>`).join('');
  const bound = target === undefined
    ? ''
    : `<line class="plot-bound" x1="${String(PLOT.gutter)}" y1="${yPeriod(target).toFixed(1)}" x2="${String(PLOT.width - PLOT.gutter)}" y2="${yPeriod(target).toFixed(1)}"/>`;
  const zero = ySlack(0);
  /** One slack bar: from the zero line to where the slack falls, at `x`. */
  const slackBar = (slackNs: number, x: number): string => {
    const y = ySlack(slackNs);
    const top = Math.min(y, zero);
    const tall = Math.max(Math.abs(y - zero), 1.5);
    return `<rect class="${slackNs < 0 ? 'plot-bar-neg' : 'plot-bar'}" x="${(x - 7).toFixed(1)}" y="${top.toFixed(1)}" width="14" height="${tall.toFixed(1)}" rx="1"/>`;
  };
  const bars = rows.filter((r) => r.row.slackNs !== undefined).map((r) => slackBar(r.row.slackNs!, at(r))).join('');
  // A forked generation closed at one slack per branch, so its bars stand side by side at the one
  // place on the axis, in the order the graph draws the branches — which is the order of their rows
  // in the ledger underneath, so the two are read together.
  const branchBars = branchPoints.map((p) => {
    const beside = branchPoints.filter((other) => other.on === p.on);
    const place = beside.indexOf(p);
    return p.slackNs === undefined ? '' : slackBar(p.slackNs, at(p.on) + (place - (beside.length - 1) / 2) * 16);
  }).join('');
  // The stretch of the axis one level down: half a step past the Loop's first and last rows, so the
  // span reaches to the gap on either side of them and never over the outer row it hangs under.
  const step = rows.length < 2 ? 0 : (PLOT.width - PLOT.gutter * 2) / (rows.length - 1);
  const spans = loops.map((loop) => {
    const own = rows.filter((r) => r.loop === loop);
    const first = own[0];
    const last = own.at(-1);
    if (first === undefined || last === undefined) return '';
    const from = Math.max(0, at(first) - step / 2);
    const to = Math.min(PLOT.width, at(last) + step / 2);
    return `<rect class="plot-span" x="${from.toFixed(1)}" y="${String(PLOT.laneTop)}" width="${(to - from).toFixed(1)}" height="${String(slackTop + PLOT.laneHeight - PLOT.laneTop)}" rx="4"/>`;
  }).join('');
  // The generation the Campaign ended on, marked where it falls: a Run that met its Goal or stopped
  // learning ended *at* a generation, and that is the one a person is looking for on the picture. The
  // outer graph's own last row, because that is where a Campaign ends — a Loop ends inside it.
  const ending = view.run.status === 'ended-goal-met' || view.run.status === 'ended-converged'
    ? rows.filter((r) => r.loop === undefined).at(-1)
    : undefined;
  const mark = ending === undefined
    ? ''
    : `<line class="plot-endmark" x1="${at(ending).toFixed(1)}" y1="${String(PLOT.laneTop)}" x2="${at(ending).toFixed(1)}" y2="${String(slackTop + PLOT.laneHeight)}"/>`;
  const keys = [
    `<span class="key key-line">${escape(plotLabels.period)}</span>`,
    ...(target === undefined ? [] : [`<span class="key key-bound">${escape(plotLabels.target)}</span>`]),
    `<span class="key key-bar">${escape(plotLabels.slackOk)}</span>`,
    `<span class="key key-bar-neg">${escape(plotLabels.slackBad)}</span>`,
    ...(loops.length === 0 ? [] : [`<span class="key key-span">${escape(plotLabels.inLoop)}</span>`]),
    ...(branchPoints.length === 0 ? [] : [`<span class="key key-branch">${escape(plotLabels.branches)}</span>`]),
  ].join('');
  const lane = (top: number): string =>
    `<rect class="plot-lane" x="0" y="${String(top)}" width="${String(PLOT.width)}" height="${String(PLOT.laneHeight)}" rx="4"/>`;
  // Each value sits at its own mark's height, in the margin on its own side of the drawing: the
  // bound at the left end of the line it is drawn for, the last measurement past the last dot. Two
  // sides, so neither can ever land on the other however close the two numbers come.
  const atHeight = (y: number): string => `top:${((y / height) * 100).toFixed(2)}%`;
  // The Campaign's own last measurement, and nothing where it took none: on a Campaign whose only
  // readings are a fork's, "where it got to" is two places at once and each of them is named at its
  // own point below, so a number in this margin would be one branch's reading passed off as the
  // Campaign's.
  const last = measured.at(-1);
  const values = (target === undefined
    ? ''
    : `<span class="plot-value plot-value-bound" style="${atHeight(yPeriod(target))};right:${(100 - GUTTER_PERCENT).toFixed(2)}%">${escape(plotValue(target))}</span>`)
    + (last === undefined
      ? ''
      : `<span class="plot-value plot-value-last" style="${atHeight(yPeriod(last.row.observedPeriodNs))};left:${(100 - GUTTER_PERCENT).toFixed(2)}%">${escape(plotValue(last.row.observedPeriodNs))}</span>`)
    // Each branch's own reading, named beside its own point: two branches share one place on the
    // axis, so the label is what tells them apart. On the side of the point away from the nearer
    // edge, so a label at the last generation is never written off the picture.
    + branchPoints.map((p) => {
      const x = (at(p.on) / PLOT.width) * 100;
      const side = x > 50 ? `right:${(100 - x).toFixed(2)}%` : `left:${x.toFixed(2)}%`;
      return `<span class="plot-value plot-branch" style="${atHeight(yPeriod(p.ns))};${side}">${escape(branchPointSaid(p.branch, p.ns))}</span>`;
    }).join('');
  // What the left-to-right of this picture is, said under it and only where it could be misread: a
  // Campaign that drilled down has a row — the outer generation's own measurement — that the ledger
  // lists before rows the clock ran first, and the axis follows the ledger. Under the figure and not
  // a caption inside it, because the two values written over the drawing are placed at a percentage
  // of the figure's own height and a caption inside would move them off their marks.
  const order = loops.length === 0 ? '' : `<p class="note plot-order">${escape(LEDGER_ORDER)}</p>`;
  return {
    keys: `<p class="plot-keys">${keys}</p>`,
    figure: '<figure class="plot">'
      + `<svg class="plot-svg" viewBox="0 0 ${String(PLOT.width)} ${String(height)}" role="img" aria-label="${escape(plotLabels.caption)}">`
      + lane(periodTop)
      + lane(slackTop)
      + spans
      + mark
      + bound
      + line
      + inner
      + dots
      + branchDots
      + `<line class="plot-axis" x1="${String(PLOT.gutter)}" y1="${zero.toFixed(1)}" x2="${String(PLOT.width - PLOT.gutter)}" y2="${zero.toFixed(1)}"/>`
      + bars
      + branchBars
      + '</svg>'
      + values
      + '</figure>'
      + order,
  };
}

/** A number this page states beside another number of the same kind: rounded where floating point
 *  would otherwise print a difference nobody measured, and signed, because the sign is the reading. */
function signed(value: number): string {
  const rounded = Number(value.toFixed(4));
  return rounded > 0 ? `+${String(rounded)}` : String(rounded);
}

/** How much this generation moved a number from the generation before it, or nothing at all to say
 *  for the first one and for a generation whose measurement is not in yet. */
function delta(rows: readonly GenerationView[], row: GenerationView, read: (r: GenerationView) => number | undefined): string {
  const before = rows[rows.indexOf(row) - 1];
  const now = read(row);
  const then = before === undefined ? undefined : read(before);
  if (now === undefined || then === undefined) return '';
  return ` <span class="delta">${escape(signed(now - then))}</span>`;
}

/**
 * One quantity drawn against its bound: the tick where the bound falls, and the fill running from
 * that tick to where the quantity actually is.
 *
 * From the bound and not from the left edge, because what a person reads off these rows is the
 * *distance* — how far this generation's period is from the target it was asked for, how far its
 * slack is from zero — and a bar that started at the low end of the scale would draw the generation
 * sitting exactly on its bound as an empty track, which is the one reading it must not have.
 */
function bar(value: number, bound: number, low: number, high: number, colour: string): string {
  const pad = (high - low) * 0.08;
  const min = low - pad;
  const span = (high + pad) - min || 1;
  const place = (at: number): number => Math.max(0, Math.min(100, ((at - min) / span) * 100));
  const from = place(Math.min(value, bound));
  const to = place(Math.max(value, bound));
  return `<span class="bar" style="color:${colour}">`
    + `<span class="bar-fill" style="left:${from.toFixed(1)}%;width:${(to - from).toFixed(1)}%"></span>`
    + `<span class="bar-tick" style="left:calc(${place(bound).toFixed(1)}% - 1px)"></span>`
    + '</span>';
}

/** The scales one ledger's bars are drawn against, at either depth. One set for the whole table,
 *  because two rows in one column are read against each other: a nested row whose bar was drawn on a
 *  scale of its own would be a picture nobody could compare with the row above it. */
interface Scales {
  readonly target?: number;
  readonly periodLow: number;
  readonly periodHigh: number;
  readonly slackLow: number;
  readonly slackHigh: number;
}

/**
 * One Generation's row, at either depth (#28): what its Strategy asked for against what it measured,
 * the slack it closed with, what was concluded, what was decided, and what it cost — each quantity
 * drawn against its bound as well as printed.
 *
 * One renderer for both depths on purpose. A Loop's turn is a Generation in exactly the sense the
 * outer Loop's is (CONTEXT.md), so a person reading a nested row is reading the same six columns,
 * in the same order, said in the same words, and can compare a drill-down's third turn with the
 * Campaign's first by looking straight up the column.
 */
function generationRow(entry: LedgerGenerationRow, scales: Scales, words: RunWords | undefined): string {
  const { row, loop, siblings } = entry;
  // A nested row says which Loop it is a Generation of, so a driver — and anything reading the page's
  // own HTML — can tell the two depths apart without reading the group's head above it.
  const classes = [...(loop === undefined ? [] : ['in-loop']), ...(row.state === 'running' ? ['now'] : [])];
  return `<tr${classes.length === 0 ? '' : ` class="${classes.join(' ')}"`}${loop === undefined ? '' : attributes({ 'data-hima-loop': loop.id })}>`
    + `<td><span class="folio fig">${escape(String(row.generation))}</span> ${statePill(generationStateLabel, generationGlyph, row.state)}</td>`
    + quantityCells(row, scales, words, { period: delta(siblings, row, (r) => r.observedPeriodNs), slack: delta(siblings, row, (r) => r.slackNs) })
    + `<td>${verdictCell(row.verdicts)}</td>`
    + `<td><div class="said-decision">${figured(generationDecisionSaid(row))}</div></td>`
    + `<td class="num fig">${escape(duration(row.wallMs))}</td>`
    + '</tr>';
}

/**
 * The two quantity columns of one row — the period against the Goal's target, the slack against zero
 * — printed and drawn, at either depth and for a branch of a fork as well.
 *
 * One renderer for every row that carries numbers, because two rows in one column are read against
 * each other: a branch's period drawn by a second piece of code on a second scale would be a picture
 * nobody could compare with the generation's above it.
 *
 * @param row - whatever numbers this row holds; a side it does not hold is the em dash and no bar.
 * @param scales - the scales the whole table's bars are drawn on.
 * @param deltas - the signed move from the row before it in its own series, where there is one to
 *                 state; a branch of a fork states neither, because the row before it is another
 *                 branch and a move between two branches is a move nothing made.
 */
function quantityCells(
  row: { readonly strategy?: RunStrategy; readonly observedPeriodNs?: number; readonly slackNs?: number },
  scales: Scales,
  words: RunWords | undefined,
  deltas: { readonly period: string; readonly slack: string } = { period: '', slack: '' },
): string {
  const { target } = scales;
  const periodCell = `<div class="value fig">${escape(askedObservedSaid(row, words?.strategy))}${deltas.period}</div>`
    + (row.observedPeriodNs === undefined || target === undefined ? '' : bar(row.observedPeriodNs, target, scales.periodLow, scales.periodHigh, row.observedPeriodNs <= target ? good : warn));
  const slackCell = `<div class="value fig">${escape(slackSaid(row))}${deltas.slack}</div>`
    + (row.slackNs === undefined ? '' : bar(row.slackNs, 0, scales.slackLow, scales.slackHigh, row.slackNs < 0 ? bad : good));
  return `<td class="qty"><div class="cell">${periodCell}</div></td><td class="qty"><div class="cell">${slackCell}</div></td>`;
}

/** The verdicts column of one row: what each rule concluded, as a shape, a word and the rule's own
 *  name. One renderer for a generation's verdicts and for a branch's, which are the same records
 *  read one level apart. */
const verdictCell = (verdicts: readonly GenerationVerdictView[]): string =>
  (verdicts.length === 0
    ? `<div class="faint">${escape(NOTHING_JUDGED)}</div>`
    : verdicts.map((v) => `<div class="verdict-line">${pill(v.outcome, outcomeColour[v.outcome] ?? plain, outcomeGlyph[v.outcome] ?? 'pending')} ${mono(v.ruleId)}</div>`).join(''));

/**
 * One branch of a fork, as a row of the same table under the generation that forked it (#29b): what
 * it is and where it stands, the reading it took, what the join concluded of it, and what it did —
 * the Job it launched and how that Job ended, the moment it queued behind a full Site, and the
 * blocker it stopped at.
 *
 * The same six columns as the row above it, drawn by the same renderer where a branch's numbers fit
 * them, so a branch's period is read straight up the column against the Campaign's target. Two of
 * them a branch does not hold: it asked for what its own act node was given, which the ledger does
 * not carry, and it decided nothing — a fork is decided at its join, whose line is under these rows.
 * The wall time is the generation's, which is where a person reads it: a branch's own span is not a
 * number the run view states, and this card measures nothing of its own.
 */
function branchRow(view: RunView, branch: BranchView, scales: Scales, words: RunWords | undefined): string {
  // Never empty: a branch that has launched nothing still says so ("0 jobs"), which is exactly what
  // a person watching a fork queue behind a full Site is looking for.
  const said = branchLines(view, branch);
  return `<tr class="in-fork"${attributes({ 'data-hima-branch': branch.id })}>`
    // Which branch, then what it is doing: the same anatomy as a generation's row one column over,
    // set one under the other because the generation column is 104 px — the proportion every other
    // row of this table is read by — and a branch's whole line does not fit across it at any size
    // this page spends. What `branchSaid` says on a command line, in the shape a column has.
    + `<td><div class="cell">${mono(branch.id)}`
    + `<div>${statePill(branchStateLabel, branchGlyph, branch.state)}</div></div></td>`
    + quantityCells(branch, scales, words)
    + `<td>${verdictCell(branch.verdicts)}</td>`
    + `<td><div class="cell">${said.map((line) => `<div class="said-decision">${figured(line)}</div>`).join('')}</div></td>`
    + `<td class="num faint fig">${escape(NOT_HELD)}</td>`
    + '</tr>';
}

/** The foot of a forked generation's group: what the join concluded over all its branches, in the
 *  rule's own words. The other end of the bracket the first branch row opened, so a person can see
 *  where the fork stops without counting rows. */
const joinRow = (entry: LedgerJoinRow): string =>
  `<tr class="fork-join"><td colspan="6"><span class="faint">${escape(joinSaid(entry.join, entry.branches))}</span></td></tr>`;

/**
 * The head of a nested Loop's group of rows: what the Loop is, what it came to and how many
 * Generations that took, and the Explore node it was opened at — which is the row directly above it.
 *
 * A row of the same table and not a table of its own, so the six columns under it are the six columns
 * over it: a nested Generation's period is read straight up the column against the outer one's.
 */
const loopHeadRow = (loop: LoopView): string =>
  `<tr class="loop-head"${attributes({ 'data-hima-loop': loop.id })}><td colspan="6">`
  + pill(
    loopSaid(loop),
    loop.outcome === undefined ? plain : labelled(loopOutcomeLabel, loop.outcome).colour,
    loop.outcome === undefined ? 'running' : loopOutcomeGlyph[loop.outcome],
  )
  + ` <span class="faint">${escape(loopOpenedSaid(loop))}</span></td></tr>`;

/** The foot of the group: what closed the Loop, or that nothing has yet and the Run is still inside
 *  it. The other end of the bracket the head opened, so a person scrolling a long group can see
 *  where it stops without scrolling back. */
const loopFootRow = (loop: LoopView): string =>
  `<tr class="loop-foot"${attributes({ 'data-hima-loop': loop.id })}><td colspan="6">`
  + `<span class="faint">${escape(loopClosedSaid(loop))}</span></td></tr>`;

/**
 * The generation ledger: one row per Generation the Run has opened, oldest first, with the
 * generation as the primary axis — which is the axis a Campaign converges along, and the one the
 * prior product computed and never showed.
 *
 * Every quantity is drawn as well as printed: the period against the Goal's target, the slack
 * against zero, each with a tick at its bound and the signed move from the generation before it. A
 * table of numbers says what happened; the same numbers against their bounds say whether it is
 * getting better, which is the question a person is watching for.
 *
 * A Generation whose Explore node drilled down carries the Loop it opened as a group of rows under
 * its own (#28): a head naming the Loop and where it opened, its Generations in the same six
 * columns, and a foot saying what closed it. The group is inside the region `run-loops`, which is
 * the whole ledger — how many Loops a Campaign opened and which one is open is a fact about the
 * Campaign, not about any one of its rows — and it is there only on a Run that opened one, so a
 * Campaign that drills nowhere renders exactly the page it did before.
 */
function generationLedger(view: RunView): string {
  const rows = view.generations;
  // What this pack calls its own knobs, for the column that says what each generation asked for.
  const words = view.run.words;
  const all = ledgerRows(rows);
  // The scales are taken over every row that carries numbers — the Generations at both depths and
  // each branch of a fork — because that is what "read against each other" means: the head and the
  // foot of a Loop's group and the join's line say what happened and carry no quantity of their own.
  const numbered = generationRowsOf(all);
  const branched = branchRowsOf(all).map((r) => r.branch);
  const target = view.run.goal?.target_period_ns;
  // Every period any row *measured*, which is what the bars in this column are drawn from: a bar
  // runs from the Goal's target to the period the report stated. What a generation asked for is no
  // longer a number this table holds — it is the whole Strategy, in the pack's own knobs (#58), and
  // a scale over a Strategy is not a thing — so the scale covers the measurements and the target
  // they are drawn against, which is every value actually plotted on it.
  const periods = [
    ...numbered.flatMap((r) => (r.row.observedPeriodNs === undefined ? [] : [r.row.observedPeriodNs])),
    ...branched.map((q) => q.observedPeriodNs).filter((p): p is number => p !== undefined),
  ];
  const slacks = [...numbered.map((r) => r.row.slackNs), ...branched.map((q) => q.slackNs)].filter((s): s is number => s !== undefined);
  const scales: Scales = {
    ...(target === undefined ? {} : { target }),
    periodLow: Math.min(...periods, ...(target === undefined ? [] : [target])),
    periodHigh: Math.max(...periods, ...(target === undefined ? [] : [target])),
    slackLow: Math.min(0, ...slacks),
    slackHigh: Math.max(0, ...slacks),
  };
  const heads = [generationColumns.generation, generationColumns.period, generationColumns.slack, generationColumns.verdicts, generationColumns.decision, generationColumns.wall];
  // Every row of the table from the one walk, in the one order: nesting a Loop's rows under the row
  // that opened it is what `ledgerRows` does, and this renders whatever it yields.
  const body = all.map((entry) => {
    if (entry.kind === 'generation') return generationRow(entry, scales, words);
    if (entry.kind === 'branch') return branchRow(view, entry.branch, scales, words);
    if (entry.kind === 'join') return joinRow(entry);
    return entry.kind === 'loop-head' ? loopHeadRow(entry.loop) : loopFootRow(entry.loop);
  }).join('');
  const marked = { 'data-hima-region': 'run-generations', ...stateAttributes(generationsState(rows)) };
  const loops = loopsIn(view);
  const nested = loops.length === 0 ? undefined : { 'data-hima-region': 'run-loops', ...stateAttributes(loopsState(view)) };
  // The fork's region wraps the same ledger, for the same reasons the drill-down's does: how many
  // branches a Campaign forked into and which fork it is standing inside are facts about the
  // Campaign and not about any one of its rows, and reading it hands a driver every branch row
  // whichever generation forked it. Absent on a Run that forked nowhere.
  const forked = branchesIn(view).length === 0 ? undefined : { 'data-hima-region': 'run-branches', ...stateAttributes(branchesState(view)) };
  // The widths are read off the words at the sizes they are set in; the table's own minimum is their
  // sum, computed by `ledgerTable`, so at the width this page is designed for the ledger fills its
  // band and scrolls in neither direction, and below it the whole table scrolls inside its scroller
  // rather than every column shrinking. The decision is the column that gives — it is prose, and
  // prose wraps.
  return `<section${attributes(marked)}>`
    + (nested === undefined ? '' : `<div${attributes(nested)}>`)
    + (forked === undefined ? '' : `<div${attributes(forked)}>`)
    + '<div class="scroller">'
    + ledgerTable([104, 172, 96, 296, 186, 88])
    + `<thead><tr>${heads.map(head).join('')}</tr></thead>`
    + `<tbody>${body}</tbody></table></div>`
    + (forked === undefined ? '' : '</div>')
    + (nested === undefined ? '' : '</div>')
    + '</section>';
}

/**
 * The path: one row per node the Run touched, the latest transition of it, as a compact table.
 *
 * Under the ledger and not inside it: the run view carries one entry per node and not one per node
 * per generation, so a path split by generation would be a split this view cannot make honestly.
 * It is where the Run *stands*; the ledger above is what it has *done*. #28 nests a drill-down
 * Loop's generations in that ledger and not here, for the same reason and one level down: a node
 * touched in three turns of a Loop is still one entry. A per-generation path is a ticket of its
 * own, and it would follow this table's classes.
 */
function pathTable(view: RunView): string {
  const heads = [pathColumns.index, pathColumns.node, pathColumns.kind, pathColumns.state, pathColumns.attempt, pathColumns.said];
  const body = view.nodes.map((node, index) => {
    const exit = jobEnding(view, node.jobSession);
    const facts = [
      ...(node.outcome === undefined ? [] : [escape(node.outcome)]),
      ...(exit === undefined ? [] : [escape(exit)]),
      ...(node.waitedForSlot === true ? ['waited for a slot'] : []),
      ...(node.jobSession === undefined ? [] : [`<span class="mono">${escape(node.jobSession)}</span>`]),
    ];
    const said = (facts.length === 0 ? '' : `<div class="faint">${facts.join(' · ')}</div>`)
      + (node.reason === undefined ? '' : note(node.reason));
    return '<tr>'
      + `<td class="num faint fig">${String(index + 1)}</td>`
      + `<td>${mono(node.nodeId)}</td>`
      + `<td class="faint">${escape(node.kind)}</td>`
      + `<td>${statePill(nodeStateLabel, nodeStateGlyph, node.state)}</td>`
      + `<td class="num fig">${escape(String(node.attempt))}</td>`
      + `<td><div class="cell">${said === '' ? `<span class="faint">${escape(NOT_HELD)}</span>` : said}</div></td>`
      + '</tr>';
  }).join('');
  const marked = { 'data-hima-region': 'run-nodes', ...stateAttributes(Object.fromEntries(view.nodes.map((n) => [n.nodeId, n.state]))) };
  return `<section${attributes(marked)}><h3 class="eyebrow">path</h3>`
    + '<div class="scroller">'
    + ledgerTable([36, 168, 84, 124, 78, 452])
    + `<thead><tr>${heads.map(head).join('')}</tr></thead>`
    + `<tbody>${body}</tbody></table></div></section>`;
}

// ---------------------------------------------------------------------------------------------
// Band 3: the evidence
// ---------------------------------------------------------------------------------------------

/**
 * One Hard blocker, full width, owning its own log tail: the sentence at reading size, what it
 * spent, and the last lines the Job wrote in a well that keeps dark glass in both themes, with the
 * range of what is in it stated. A tail truncated into a tooltip is a tail nobody reads.
 *
 * The latest one's tail is the region a driver reads: `read` takes the first element marked with a
 * name, so marking every tail would hand back the oldest — and the tail a person is looking for is
 * the one belonging to the blocker they have to clear now.
 */
function blockerBlock(blocker: BlockerView, latest: boolean): string {
  const after = `after ${counted(blocker.attempts, 'attempt')}${blocker.lastExitCode === undefined ? '' : `, last exit ${String(blocker.lastExitCode)}`}`;
  const tail = latest ? attributes({ 'data-hima-region': 'run-blocker-tail' }) : '';
  return '<div class="block block-bad">'
    + `<div>${pill('blocked', bad, 'blocked')} ${mono(blocker.nodeId)} <span class="faint">${escape(after)}</span></div>`
    + `<p class="lead">${escape(blocker.reason)}</p>`
    + (blocker.logTail === undefined
      ? ''
      : `${faint(tailSaid(blocker.logTail))}<pre class="well"${tail}>${escape(blocker.logTail)}</pre>`)
    + '</div>';
}

/** The stop a person asked for, and what came of it: two records, said as two lines (#9). */
function cancelBlock(view: RunView, cancel: RunView['cancels'][number]): string {
  return '<div class="block">'
    + note(cancelAsked(cancel))
    + `<div>${figured(cancelObserved(view, cancel).said)}</div>`
    + '</div>';
}

/**
 * Which shape a decision wears: what it chose is what it is. A next Strategy is the Campaign still
 * running, goal met is done, and converged is the same decision-to-make the seal draws.
 *
 * Keyed by every kind of choice there is, like every other table on this page, so a fourth thing an
 * Explore node could decide cannot reach a person in a shape nobody chose.
 */
const decisionGlyphs: Readonly<Record<ChosenKind, Glyph>> = {
  'goal-met': 'done',
  converged: 'waiting',
  'next-strategy': 'running',
};

const decisionGlyph = (decision: DecisionView): Glyph => decisionGlyphs[chosenKind(decision)];

function decisionBlock(decision: DecisionView, view: RunView): string {
  const from = `from ${Object.entries(decision.rationale).map(([name, value]) => `${name} ${String(value)}`).join(', ')}`;
  return '<div class="block">'
    + `<div>${pill(chosenSaid(decision, view.run.words), decisionColour(decision), decisionGlyph(decision))} <span class="faint">by ${escape(decision.chooser)} at ${escape(decision.nodeId)}</span></div>`
    + `<div class="note">${figured(from)}</div>`
    + decision.cites.map((recordId) => faint(`cites ${citedSaid(view, recordId)}`)).join('')
    + '</div>';
}

/** The typed values an observation carried, each naming the tool's path group it was read out of
 *  where one group is its source — the same line, in the same words, the chat's card renders. */
function valueRows(observation: ObservationView): string {
  if (observation.values.length === 0) return '';
  return '<div class="values">' + observation.values.map((v) => `<span class="n mono">${escape(nameOf(v))}</span>`
    // A value the reader could not read says so where the number would have been, in the words it
    // said it in: a reader never substitutes a zero for a reading nobody took, and neither does this.
    + (v.value === null
      ? `<span class="faint wide">unknown — ${escape(v.unknownReason ?? '')}</span>`
      : `<span class="q fig">${escape(String(v.value))}</span><span class="faint">${escape(v.unit)}${escape(groupSaid(v))}</span>`)).join('') + '</div>';
}

function observationBlock(observation: ObservationView): string {
  return '<div class="block">'
    + `<div class="mono">${escape(observation.path)}</div>`
    + valueRows(observation)
    + faint(`sha256 ${observation.contentSha256}`)
    + faint(`read by ${readerSaid(observation.reader)} · ${String(observation.bytes)} bytes · ${observation.at}`)
    + '</div>';
}

function verdictBlock(verdict: VerdictView): string {
  const cites = verdict.cites.length === 0
    ? faint('cites nothing')
    : verdict.cites.map((c) => (c.observation === null
      ? faint(`cited record ${c.recordId} is not an observation of this run`)
      : observationBlock(c.observation))).join('');
  return '<div class="block">'
    + `<div>${pill(verdict.outcome, outcomeColour[verdict.outcome] ?? plain, outcomeGlyph[verdict.outcome] ?? 'pending')} ${mono(`${verdict.ruleId}@${verdict.ruleVersion}`)}</div>`
    + (verdict.reason === undefined ? '' : note(verdict.reason))
    + cites
    + '</div>';
}

/**
 * The Campaign's technical report, at the end of the evidence (#30): where it is on the Site, what
 * each file hashes to, a link to the Markdown as the Site has it, and the report itself.
 *
 * The text is a current ledger preview. The saved document may use an older renderer. Only the
 * link reads the original file and verifies its recorded hash, without rewriting historical bytes.
 */
function experienceBlock(view: RunView, experience: ExperienceView): string {
  return '<div class="block">'
    + note(experienceWrittenSaid(experience))
    + faint(experienceFileSaid('markdown', experience.markdown))
    + faint(experienceFileSaid('json', experience.json))
    + `<div><a href="${escape(experienceMarkdownHref(view.run.id))}">${escape(EXPERIENCE_MARKDOWN_LINK)}</a></div>`
    + '</div>'
    + `<div class="report">${reportHtml(experienceReport(view, experience.writtenAt).markdown)}</div>`;
}

/**
 * The report itself, rendered from its own small dialect of Markdown: headings, paragraphs, tables
 * and fenced code, and nothing else (`reportBlocks`).
 *
 * The page's own renderer and no library, for the reason everything else on this page is the page's
 * own: a document this harness wrote is a document it can render, the dialect is closed, and a
 * Markdown library in the bundle would be a second opinion about what the file says. A table is the
 * page's own ledger table, so the report's rows read like every other table here, and a fenced block
 * is the same well a Job's log is shown in.
 */
function reportHtml(markdown: string): string {
  return reportBlocks(markdown).map((block) => {
    if (block.kind === 'heading') {
      // Under the drawer's own `<h3 class="eyebrow">`: the report's title is a level below the
      // section that holds it, wherever the document starts.
      const level = Math.min(6, block.level + 3);
      return `<h${String(level)}>${escape(block.text)}</h${String(level)}>`;
    }
    if (block.kind === 'paragraph') return `<p>${figured(block.text)}</p>`;
    if (block.kind === 'code') return `<pre class="well">${escape(block.text)}</pre>`;
    return '<div class="scroller"><table class="ledger">'
      + `<thead><tr>${block.head.map(head).join('')}</tr></thead>`
      + `<tbody>${block.rows.map((cells) => `<tr>${cells.map((c) => `<td>${figured(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
      + '</table></div>';
  }).join('');
}

/**
 * The workshop of the node the Run stands at: where it stands, and what its current attempt wrote.
 *
 * The state's own pill beside the standing line, and then one row per file — its path, the head of
 * its hash, its size and the language the pack says it is in. The hash is what a person holds the
 * file on the Site against, which is why it is on the row rather than in a drawer of its own; the
 * file's *contents* are not shown, and reading one is #66.
 *
 * A workshop that has written nothing yet renders the line alone, which is the honest thing to show
 * for a moment that is still open.
 */
function workshopBlock(view: RunView): string {
  const workshop = view.workshop!;
  const label = labelled(workshopStateLabel, workshop.state);
  const files = codeOfWorkshop(view);
  return '<div class="block">'
    + `<div>${statePill(workshopStateLabel, workshopGlyph, workshop.state)} ${figured(workshopSaid(workshop))}</div>`
    + faint(`node ${workshop.nodeId}, attempt ${String(workshop.attempt)}, entry ${workshop.entry}${workshop.sessionId === undefined ? '' : `, session ${workshop.sessionId}`}`)
    + (files.length === 0
      ? note(`nothing written yet — ${label.said}`)
      : files.map((code) => `<div class="mono">${figured(codeSaid(code))}</div>`).join(''))
    + '</div>';
}

/** One part of the evidence drawer, with a region marker when a driver reads it; only ever rendered
 *  with something in it. */
function drawer(title: string, body: string, region?: { readonly name: string; readonly state: Readonly<Record<string, string>> }): string {
  const marked = region === undefined ? {} : { 'data-hima-region': region.name, ...stateAttributes(region.state) };
  return `<section${attributes(marked)}><h3 class="eyebrow">${escape(title)}</h3>${body}</section>`;
}

// ---------------------------------------------------------------------------------------------
// The whole card
// ---------------------------------------------------------------------------------------------

/** The whole card, in the order a person asks about a Run, each band only where the view carries
 *  something to put in it. */
function renderCard(view: RunView): string {
  const latestBlocker = view.blockers.at(-1);
  const latestCancel = view.cancels.at(-1);
  const evidence = (latestCancel === undefined ? '' : drawer('cancel', view.cancels.map((c) => cancelBlock(view, c)).join(''), { name: 'run-cancel', state: { observed: cancelObserved(view, latestCancel).key } }))
    + (view.blockers.length === 0 ? '' : drawer('blocker', view.blockers.map((b) => blockerBlock(b, b === latestBlocker)).join(''), { name: 'run-blocker', state: { count: String(view.blockers.length), ...(latestBlocker === undefined ? {} : { node: latestBlocker.nodeId }) } }))
    // Marked for a driver like the blocker beside it (#61): a refusal is where a Campaign says a
    // pack's own reader produced something nobody could stand behind, and a test that read only the
    // node table would be asserting that a node is blocked without ever reading the sentence a
    // person is given about why.
    + (view.refusals.length === 0 ? '' : drawer('refused', view.refusals.map((r) =>
      `<div class="block block-bad"><div>${pill('refused', warn, 'missed')}</div><div class="mono">${escape(r.path)}</div>${note(r.reason)}</div>`).join(''), { name: 'run-refusal', state: { count: String(view.refusals.length) } }))
    // The workshop of the node the Run stands at, where that node is one (#62): the standing line with
    // the state's own pill, and this attempt's files under it. Before the reading, because it is
    // where the Run *is* — a person watching a workshop is watching something being written now, and
    // what was read is what the generation before it produced.
    + (view.workshop === undefined ? '' : drawer('workshop', workshopBlock(view), { name: 'run-workshop', state: workshopState(view.workshop) }))
    + (view.observations.length === 0 ? '' : drawer('observed', view.observations.map(observationBlock).join(''), { name: 'run-observation', state: { count: String(view.observations.length) } }))
    + (view.verdicts.length === 0 ? '' : drawer('verdicts', view.verdicts.map(verdictBlock).join('')))
    + (view.decision === null ? '' : drawer('decision', decisionBlock(view.decision, view), { name: 'run-decision', state: decisionState(view.decision) }));
  // A report has its own reading destination, while its original file and evidence remain intact.
  const report = (view.experience === undefined
      ? (view.experienceUnavailable === undefined ? '' : drawer(EXPERIENCE_HEADING, note(view.experienceUnavailable), { name: 'run-experience', state: { source: 'not-written' } }))
      : drawer(EXPERIENCE_HEADING, experienceBlock(view, view.experience), { name: 'run-experience', state: experienceState(view.experience) }));
  // The band's own head carries the plot's keys beside the section's name: a legend is a line of
  // labels, and a line of labels does not need a line of its own.
  const plot = convergencePlot(view);
  const ledger = view.generations.length === 0 && view.nodes.length === 0
    ? ''
    : '<section id="run-experiments" class="band">'
      + `<div class="band-head"><h2 class="eyebrow">generations</h2>${plot.keys}</div>`
      + plot.figure
      + (view.generations.length === 0 ? '' : generationLedger(view))
      + (view.nodes.length === 0 ? '' : pathTable(view))
      + '</section>';
  return '<article class="card">'
    + '<nav class="section-nav" aria-label="In this Run">'
    + '<a href="#run-overview" data-hima-control="show-overview">Overview</a>'
    + (ledger === '' ? '' : '<a href="#run-experiments" data-hima-control="show-experiments">Experiments</a>')
    + (evidence === '' ? '' : '<a href="#run-evidence" data-hima-control="show-evidence">Evidence</a>')
    + (report === '' ? '' : '<a href="#run-report" data-hima-control="show-report">Technical report</a>')
    + '</nav>'
    + verdictBand(view)
    + ledger
    + (evidence === '' ? '' : `<section id="run-evidence" class="band"><h2 class="eyebrow">evidence</h2>${evidence}</section>`)
    + (report === '' ? '' : `<section id="run-report" class="band">${report}</section>`)
    + '</article>';
}

// ---------------------------------------------------------------------------------------------
// The list page: what a Campaign is started from, and what has been started
// ---------------------------------------------------------------------------------------------

/**
 * What this home has installed, which is what the start form offers to start a Campaign of — and
 * which pack's Strategy the knob fields are for.
 *
 * `pack` is the selection the form is rendered *for*: the one the page asked for by `?pack=`, else
 * the first installed. `strategy` is that pack's own declaration and `words` its own words (#58),
 * both read by the host when the page is composed. The selected Site and static check travel with
 * those fields. Unreadable declarations carry a preparation diagnostic and cannot be submitted;
 * the final start operation still reloads and checks the Pack and Site.
 */
export interface StartChoices {
  readonly packs: readonly string[];
  readonly sites: readonly string[];
  readonly pack?: string;
  readonly site?: string;
  readonly check?: PackCheck;
  readonly preparation?: { readonly kind: 'request' | 'pack' | 'site'; readonly message: string };
  readonly strategy?: StrategyDeclaration;
  readonly words?: RunWords;
  /**
   * What each pack's option is marked with, by pack id (#64): `test pack (<stage>)` for a folder the
   * authoring pipeline has started and not finished, `unreadable: <why>` for one whose own reading
   * refuses it, and nothing at all for a released pack or a hand-written one.
   *
   * Read by the host when the page is composed, for the reason `strategy` is: a pack folder is a
   * directory and this module opens none. A pack with no entry here is offered plain, which is every
   * pack this repository ships.
   */
  readonly marks?: Readonly<Record<string, string>>;
  /**
   * The packs a person may not choose: a folder whose own reading refuses it has no contract, no
   * graph and no rung, so there is nothing for a start to be a start of (#64).
   *
   * Still listed, and listed with its mark: a pack that vanished off the form would tell a person
   * nothing, and what they need is the path the reading refused. Absent when every installed folder
   * reads, which is every home this repository's own tests leave behind but the two that arrange one
   * on purpose — and it is composed whether or not any folder is startable, because a home where
   * none is, is the one that most needs every option to say why.
   */
  readonly cannotStart?: readonly string[];
}

/** One `<option>` per installed thing; the value is the identity a route takes, which is also the
 *  word a person reads, because a pack id and a Site name are what they are called everywhere else.
 *  An option in `unchoosable` is rendered `disabled`: it is still on the list, with its mark saying
 *  why, and it is not something a person can select (#64). */
const options = (
  values: readonly string[],
  selected?: string,
  marks: Readonly<Record<string, string>> = {},
  unchoosable: readonly string[] = [],
): string =>
  (selected !== undefined && !values.includes(selected) ? [selected, ...values] : values).map((v) => {
    // The value is the pack id whatever the option reads, because the value is what the start route
    // takes: a mark is something a person reads, never something a request carries.
    const mark = marks[v];
    const disabled = unchoosable.includes(v) ? ' disabled' : '';
    return `<option value="${escape(v)}"${disabled}${v === selected ? ' selected' : ''}>${escape(mark === undefined ? v : `${v} — ${mark}`)}</option>`;
  }).join('');

/** One labelled field: the label above the control it wraps, and the sentence under it saying what
 *  may go in it. A wrapping `<label>` needs no `for`, so the control's marker is its only identity. */
function field(said: string, hint: string, input: string): string {
  return `<label class="field"><span class="said">${escape(said)}</span>${input}<span class="faint">${escape(hint)}</span></label>`;
}

/**
 * The start form: what an engineer starts a Campaign from, above the list of the ones already
 * started. It is a form and not a set of links because a Campaign takes seven answers, and it submits
 * over the same fenced route everything else on this page reads through (ADR-0002) — the page keeps
 * no IPC of its own (D39).
 *
 * Every number is typed into a text field rather than an `<input type="number">` on purpose: what a
 * knob, a time box and an allowance may be is the shared validator's to say (`run-arguments.ts`),
 * in the words all three faces use, and a browser that clamped or silently dropped a value first
 * would be a fourth face refusing things in words of its own.
 *
 * The Strategy's own fields are the selected pack's (#58): one per knob it declares, in its words,
 * rendered by `renderKnobFields` into a region of their own so a change of pack re-reads them.
 *
 * Rendered above `<main>` rather than inside it, because `<main>` is swapped whole every time the
 * host renders something different — and a form whose fields emptied themselves under a person's
 * hands each time a Run somewhere else moved on would be unusable.
 */
function renderStartForm(choices: StartChoices): string {
  const marked = { 'data-hima-region': 'start', 'data-hima-state-packs': String(choices.packs.length), 'data-hima-state-sites': String(choices.sites.length) };
  return '<section class="band">'
    + `<h2 class="eyebrow">${escape(START_HEADING)}</h2>`
    + `<form${attributes(marked)}>`
    + '<fieldset class="form-group"><legend>Method and environment</legend><div class="fields">'
    + choiceField(startForm.pack, choices.packs, choices.pack, choices.marks, choices.cannotStart)
    + choiceField(startForm.site, choices.sites, choices.site)
    + '</div></fieldset>'
    + '<fieldset class="form-group"><legend>Goal and starting strategy</legend><div class="fields">'
    + numberField(startForm.target)
    + renderKnobFields(choices)
    + '</div></fieldset>'
    + '<fieldset class="form-group"><legend>Exploration budget</legend><div class="fields budget-fields">'
    + numberField(startForm.timeBox)
    + numberField(startForm.retries)
    + numberField(startForm.generations)
    + '</div></fieldset>'
    + renderStartCheck(choices)
    + `<button type="submit" class="primary"${attributes({ 'data-hima-control': startControl.control })}${choices.check?.fit === true ? '' : ' disabled'}>${escape(startControl.said)}</button>`
    + '</form>'
    + `<p class="refusal"${attributes({ 'data-hima-region': 'start-error' })}></p>`
    + '</section>';
}

/** Static fit is a local declaration check, never a claim that a remote Site is ready. */
function renderStartCheck(choices: StartChoices): string {
  const status = choices.preparation?.kind ?? (choices.check === undefined ? 'empty' : choices.check.fit ? 'fit' : 'unfit');
  const messages = [
    ...(choices.packs.length === 0 ? [START_NO_PACK] : []),
    ...(choices.sites.length === 0 ? [START_NO_SITE] : []),
    ...(choices.preparation === undefined ? [] : [choices.preparation.message]),
    ...(choices.check === undefined ? [] : [choices.check.fit ? START_STATIC_FIT : START_STATIC_UNFIT]),
  ];
  return `<div role="status" aria-live="polite"${attributes({ 'data-hima-region': 'start-check', 'data-hima-state-pack': choices.pack ?? '', 'data-hima-state-site': choices.site ?? '', 'data-hima-state-status': status })}>`
    + messages.map((message) => `<p>${escape(message)}</p>`).join('')
    + (choices.check !== undefined && !choices.check.fit ? `<ul>${choices.check.errors.map((error) => `<li>${escape(error)}</li>`).join('')}</ul>` : '')
    + `<p class="faint">${escape(START_STATIC_LIMIT)}</p></div>`;
}

const numberField = (f: StartField): string =>
  field(f.said, f.hint, `<input type="text" inputmode="decimal" autocomplete="off"${attributes({ 'data-hima-control': f.control })}>`);

const choiceField = (
  f: StartField,
  values: readonly string[],
  selected?: string,
  marks?: Readonly<Record<string, string>>,
  unchoosable?: readonly string[],
): string =>
  field(f.said, f.hint, `<select${attributes({ 'data-hima-control': f.control })}>${options(values, selected, marks, unchoosable)}</select>`);

/**
 * One field per knob the selected pack declares its Strategy to be made of (#58), each labelled with
 * that pack's own word for it and filled with the default it declares: a number in a text field, a
 * choice in a select of its own options.
 *
 * A number is typed into a text field rather than an `<input type="number">` for the reason every
 * other number on this form is: what a value may be is the shared validator's to say, against the
 * pack's declaration, in the words all three faces use — and a browser that clamped or silently
 * dropped a value first would be a fourth face refusing things in words of its own. The bounds are
 * under the field all the same, because a person about to type a period should be able to read what
 * this pack will take without submitting to find out.
 *
 * Its own region, and it says which pack it was rendered for, because the selection can change under
 * a person's hand: the page re-reads this very region for the newly selected pack and swaps it in,
 * exactly as it re-reads `<main>` for the Run it is watching.
 */
function renderKnobFields(choices: StartChoices): string {
  const marked = { 'data-hima-region': 'start-knobs', 'data-hima-state-pack': choices.pack ?? '' };
  const fields = Object.entries(choices.strategy ?? {}).map(([name, knob]) => {
    const f = startKnobField(name, knob, choices.words?.strategy[name]);
    return knob.type === 'choice' ? choiceField(f, knob.options, knob.default) : numberFieldAt(f, knob.default, knob.unit);
  });
  return `<div class="knobs"${attributes(marked)}>${fields.join('')}</div>`;
}

/** A number field already holding the value a pack declares a Run of it starts at. */
const numberFieldAt = (f: StartField, value: number, unit: string): string =>
  field(f.said, f.hint, `<input type="text" inputmode="decimal" autocomplete="off"${attributes({ 'data-hima-control': f.control, 'data-hima-unit': unit, value: String(value) })}>`);

/**
 * The run list: every Run the ledger holds, newest first, each row a link to its own card.
 *
 * Each row carries its Run's status under the Run's own id as well as saying it in words, so a
 * driver — and a person reading a screenshot — sees where every Campaign stands without opening one.
 */
function renderRunList(runs: readonly RunHeadView[]): string {
  const heads = [runColumns.run, runColumns.status, runColumns.pack, runColumns.started, runColumns.generation];
  const rows = runs.map((run) => '<tr>'
    + `<td><a class="mono" href="${runCardPath(run.id)}">${escape(run.id)}</a></td>`
    + `<td>${run.status === undefined ? `<span class="faint">${escape(NO_FABRIC_STATE)}</span>` : statePill(runStatusLabel, runStatusGlyph, run.status)}</td>`
    + `<td class="mono">${run.packId === undefined ? `<span class="faint">${escape(NOT_RECORDED)}</span>` : escape(run.packId)}`
    + `${runPurposeMark(run.purpose) === undefined ? '' : `<span class="faint"> · ${escape(runPurposeMark(run.purpose)!)}</span>`}</td>`
    // The timestamp in the page's own reading face (`--hima-font-ui`) and not the mono one: the
    // body sets `tabular-nums`, so its digits line up down the column either way, and twenty-four
    // monospaced characters here is what pushed the run id — the column a person actually reads a
    // row by — onto a second line.
    + `<td class="faint">${escape(run.createdAt)}</td>`
    + `<td class="num fig">${run.generation === undefined ? escape(NOT_HELD) : escape(String(run.generation))}</td>`
    + '</tr>').join('');
  const states = Object.fromEntries(runs.filter((r) => r.status !== undefined).map((r) => [r.id, r.status!]));
  const marked = { 'data-hima-region': 'runs', 'data-hima-state-count': String(runs.length), ...stateAttributes(states) };
  return `<section class="band"${attributes(marked)}><h2 class="eyebrow">runs</h2>`
    + (runs.length === 0
      ? `<p class="note">${escape(NO_RUNS)}</p>`
      : '<div class="scroller">'
        + ledgerTable([356, 168, 188, 146, 84])
        + `<thead><tr>${heads.map(head).join('')}</tr></thead>`
        + `<tbody>${rows}</tbody></table></div>`)
    + '</section>';
}

// A Run moves while it is watched, and the host renders this page once. So the open document asks
// the same URL for itself every second — same route, same fence, the session it was loaded under —
// and swaps `<main>` only when the host rendered something different. There is no second endpoint,
// no stream and no state in the page: what it shows is always one render of the run view, whole.
//
// Swapping only on a difference is what lets a driver read and click between refreshes: the DOM
// stands still while the Run does, and every marker of the card lives inside `<main>`, so a swap
// replaces the regions and their `data-hima-state-*` attributes together (D42, ADR-0004 — a `wait`
// is only meaningful against a page that changes). The start form is deliberately outside `<main>`,
// because a form is what a person is typing into and not a rendering of anything the ledger holds.
//
// A control's own refusal (`run-error`) is inside `<main>` and so is cleared by the next swap. That
// is the right lifetime rather than an oversight: every refusal a caller can act on by re-reading
// the Run *is* the swap that clears it, and the one refusal that leaves the Run untouched — a Site
// that could not be asked, where nothing at all was written — leaves the card unchanged too, so its
// message stays on screen for exactly as long as it is still true.
//
// Every value here is a literal: the client bundle imports `HIMA_API_PREFIX` from `remote.ts`, which
// imports this module, and a call at module scope is a side effect esbuild may not shake out — this
// server-side string would then be shipped to the browser for nothing.
const REFRESH = `(() => {
  const main = document.querySelector('main');
  if (main === null) return;
  let shown = main.innerHTML;
  const look = async () => {
    const answer = await fetch(location.href, { credentials: 'same-origin', headers: { accept: 'text/html' } });
    if (!answer.ok) return;
    const fresh = new DOMParser().parseFromString(await answer.text(), 'text/html').querySelector('main');
    if (fresh === null || fresh.innerHTML === shown) return;
    shown = fresh.innerHTML;
    main.innerHTML = shown;
  };
  setInterval(() => { look().catch(() => undefined); }, 1000);
})();`;

// The two scripts below compose their three paths and their two refusals from the modules that own
// them: `paths.ts` for `/hima/api/runs/start`, `/hima/api/runs/<id>/<action>` and the way to a card,
// and `card-labels.ts` for the sentences a person reads when a request came back with nothing to
// render. Both were spelled out here as literals until the final review of step 3b (H3, H4), on the
// ground that the client bundle imported `HIMA_API_PREFIX` from `remote.ts`, which imports this
// module, so an interpolation here would ship these server-side scripts to every browser. The
// dependency direction was the fault: `paths.ts` is a leaf with no imports at all, `client/api.ts`
// reads the prefix from there now, and nothing in the browser bundle reaches this module any more.
// Measured after the change, and again by `pnpm run build`, which prints the bundle's size: the
// bundle carries neither script.
//
// A path a browser assembles at run time is assembled in the script; a path known at render time is
// interpolated into it. The scripts are held true by the window tests, which start, cancel and
// resume a Run by clicking these very controls.

/**
 * One of the shared sentences as JavaScript source, with a page expression where its number or its
 * reason goes: `answeredWithNoCode` and a page's `answer.status` become
 * `"the harness answered " + answer.status + " with no coded error"`.
 *
 * The word is asked for itself, split at a marker no sentence contains, and each half is quoted by
 * `JSON.stringify` — so a sentence that one day holds an apostrophe or a backslash cannot break the
 * script it is composed into. This is what lets the page's inline scripts say the words the card's
 * two mounts say without a second spelling of them.
 *
 * @param said - the shared word, from `card-labels.ts`.
 * @param expression - the page expression that fills its blank, as JavaScript source.
 */
function scriptSaid(said: (part: string) => string, expression: string): string {
  const marker = '\u0000';
  const [before = '', after = ''] = said(marker).split(marker);
  // A half the sentence does not have is not concatenated: a word ending at its blank would
  // otherwise compose `… + err.message + ""`, which is a page saying something it does not mean.
  return [before === '' ? undefined : JSON.stringify(before), expression, after === '' ? undefined : JSON.stringify(after)]
    .filter((part) => part !== undefined)
    .join(' + ');
}

// The start form's own script: it reads the fields, posts them, and either opens the Run it started
// or shows the refusal where it asked for it. There is no validation here at all — what a knob, a
// time box and an allowance may be is `run-arguments.ts`'s to say, against the pack's own
// declaration, and the route's refusal is the only sentence a person reads about it, which is what
// keeps this face saying what the other three say. A field left empty is a field not given; a field
// holding something that is not a number is sent as typed, so the refusal quotes what the person
// actually wrote.
//
// Pack/Site changes re-read this page through its existing fence. Only the latest matching reply
// is applied, preserving compatible fields as they stand when the reply arrives. Static fit does
// not replace startRun validation; it only prevents starting with an incomplete selection.
const START_FORM = `(() => {
  const form = document.querySelector('[data-hima-region="start"]');
  const shown = document.querySelector('[data-hima-region="start-error"]');
  if (form === null || shown === null) return;
  const control = (name) => form.querySelector('[data-hima-control="' + name + '"]');
  const held = (name) => {
    const el = control(name);
    return el === null ? '' : String(el.value).trim();
  };
  const number = (control) => {
    const raw = held(control);
    if (raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  };
  const knobs = () => {
    const set = {};
    for (const el of form.querySelectorAll('[data-hima-control^="start-knob-"]')) {
      const name = el.getAttribute('data-hima-control').slice('start-knob-'.length);
      const raw = String(el.value).trim();
      if (raw === '') continue;
      if (el.tagName === 'SELECT') { set[name] = raw; continue; }
      const n = Number(raw);
      set[name] = Number.isFinite(n) ? n : raw;
    }
    return set;
  };
  const button = control('start');
  let checking = false;
  let submitting = false;
  let selection = 0;
  const currentCheck = () => form.querySelector('[data-hima-region="start-check"]');
  const fits = () => {
    const check = currentCheck();
    return check !== null && check.getAttribute('data-hima-state-status') === 'fit'
      && check.getAttribute('data-hima-state-pack') === held('start-pack')
      && check.getAttribute('data-hima-state-site') === held('start-site');
  };
  const enable = () => { if (button !== null) button.disabled = checking || submitting || !fits(); };
  const refreshSelection = async () => {
    const pack = held('start-pack');
    const site = held('start-site');
    const own = ++selection;
    const current = () => own === selection && held('start-pack') === pack && held('start-site') === site;
    checking = true;
    shown.textContent = '';
    enable();
    const check = currentCheck();
    if (check !== null) {
      check.setAttribute('data-hima-state-status', 'checking');
      check.textContent = 'Checking the selected Pack and Site declarations…';
    }
    try {
      const answer = await fetch('${HIMA_WORKBENCH_PATH}?pack=' + encodeURIComponent(pack) + '&site=' + encodeURIComponent(site), {
        credentials: 'same-origin', cache: 'no-store', headers: { accept: 'text/html' },
      });
      if (!answer.ok) throw new Error('static check request answered HTTP ' + answer.status + '; reload or check the Host log');
      const page = new DOMParser().parseFromString(await answer.text(), 'text/html');
      if (!current()) return;
      const fresh = page.querySelector('[data-hima-region="start-knobs"]');
      const checked = page.querySelector('[data-hima-region="start-check"]');
      if (fresh === null || checked === null || checked.getAttribute('data-hima-state-pack') !== pack || checked.getAttribute('data-hima-state-site') !== site) {
        throw new Error('static check did not describe the selected Pack and Site; reload to retry');
      }
      const where = form.querySelector('[data-hima-region="start-knobs"]');
      if (where !== null) {
        const focused = where.contains(document.activeElement) ? document.activeElement : null;
        const focusName = focused?.getAttribute('data-hima-control');
        const selectionStart = focused?.selectionStart;
        const selectionEnd = focused?.selectionEnd;
        // Read values now, including typing while the response was in flight. Keeping a number is
        // not validating it: the same server validator still reports any changed bound on submit.
        for (const incoming of fresh.querySelectorAll('[data-hima-control]')) {
          const previous = control(incoming.getAttribute('data-hima-control'));
          if (previous === null || previous.tagName !== incoming.tagName) continue;
          if (incoming.tagName === 'SELECT') {
            if (Array.from(incoming.options).some((option) => option.value === previous.value)) incoming.value = previous.value;
          } else if (incoming.getAttribute('data-hima-unit') === previous.getAttribute('data-hima-unit')) incoming.value = previous.value;
        }
        // Move actual nodes: innerHTML would discard the values just retained as DOM properties.
        where.replaceChildren(...fresh.childNodes);
        where.setAttribute('data-hima-state-pack', pack);
        const nextFocus = focusName ? control(focusName) : null;
        if (nextFocus !== null) {
          nextFocus.focus();
          if (typeof selectionStart === 'number' && typeof selectionEnd === 'number' && nextFocus.tagName === 'INPUT') nextFocus.setSelectionRange(selectionStart, selectionEnd);
        }
      }
      currentCheck()?.replaceWith(checked);
    } catch (err) {
      if (!current()) return;
      const check = currentCheck();
      if (check !== null) { check.setAttribute('data-hima-state-status', 'failed'); check.textContent = 'Static check unavailable. Change the selection or reload to retry.'; }
      shown.textContent = ${scriptSaid(couldNotReach, 'err.message')};
    } finally {
      if (current()) { checking = false; enable(); }
    }
  };
  for (const name of ['start-pack', 'start-site']) control(name)?.addEventListener('change', refreshSelection);
  const said = (answer, body) => (body && body.error && body.error.message)
    || (${scriptSaid(answeredWithNoCode, 'answer.status')});
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (submitting || checking || !fits()) return;
    submitting = true;
    shown.textContent = '';
    enable();
    for (const name of ['start-pack', 'start-site']) { const el = control(name); if (el !== null) el.disabled = true; }
    fetch('${HIMA_RUNS_START_PATH}', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        pack: held('start-pack'),
        site: held('start-site'),
        goal: { target_period_ns: number('start-target') },
        strategy: knobs(),
        timeBox: number('start-time-box'),
        retries: number('start-retries'),
        generations: number('start-generations'),
      }),
    }).then((answer) => answer.json().catch(() => null).then((body) => {
      if (answer.ok && body && body.run && typeof body.run.id === 'string') {
        location.href = '${HIMA_WORKBENCH_PATH}?run=' + encodeURIComponent(body.run.id);
        return;
      }
      shown.textContent = said(answer, body);
    })).catch((err) => { shown.textContent = ${scriptSaid(couldNotReach, 'err.message')}; })
      .finally(() => {
        submitting = false;
        for (const name of ['start-pack', 'start-site']) { const el = control(name); if (el !== null) el.disabled = false; }
        enable();
      });
  });
})();`;

// The card's own script: cancel and resume, over the same fenced routes everything else here reads
// through. The listener is on the document and not on the buttons, because `<main>` is swapped whole
// every time the host renders something different and a listener bound to a button would go with it.
// Nothing is rendered from the route's answer: the card refreshes itself from the host a second
// later, so what a person ends up looking at is one render of the run view and never a page that has
// patched itself with half of one.
//
// The control is enabled again however the request ended, exactly as the start form's is, and for
// the one case that would otherwise be a dead end: a refusal that writes nothing — a Site that could
// not be asked, a Site this harness can no longer read — leaves the run view identical, so `<main>`
// is never swapped and no fresh button ever arrives to replace the disabled one. The words would
// stand in `run-error` beside a control nobody could click again, and only a reload would give it
// back. It is also what makes the two mounts behave alike: the React card clears its own in-flight
// state on both arms.
const RUN_CONTROLS = `(() => {
  const runId = new URLSearchParams(location.search).get('run');
  if (runId === null) return;
  const show = (text) => {
    const where = document.querySelector('[data-hima-region="run-error"]');
    if (where !== null) where.textContent = text;
  };
  document.addEventListener('click', (event) => {
    const control = event.target && event.target.closest ? event.target.closest('[data-hima-control]') : null;
    if (control === null) return;
    const name = control.getAttribute('data-hima-control');
    if (name !== 'cancel' && name !== 'resume') return;
    show('');
    control.disabled = true;
    fetch('${HIMA_RUNS_PATH}/' + encodeURIComponent(runId) + '/' + name, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    }).then((answer) => {
      if (answer.ok) return undefined;
      return answer.json().catch(() => null).then((body) => {
        show((body && body.error && body.error.message) || (${scriptSaid(answeredWithNoCode, 'answer.status')}));
      });
    }).catch((err) => { show(${scriptSaid(couldNotReach, 'err.message')}); })
      .finally(() => { control.disabled = false; });
  });
})();`;

/**
 * One whole page: the head, the chrome with the way back to the chat and the list, whatever stands
 * above the swapped `<main>`, the body, and the scripts this page needs.
 */
function page(title: string, crumb: string, body: string, above = '', script = ''): string {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escape(title)}</title><style>${WORKBENCH_STYLE}</style></head><body>`
    + '<a class="skip-link" href="#workbench-content">Skip to workbench content</a>'
    + `<header class="chrome"><h1>HimaHarness</h1><nav aria-label="Main navigation"><a href="/" data-hima-control="open-chat">HimaGuide</a><a href="${HIMA_WORKBENCH_PATH}" aria-current="${crumb === '' ? 'page' : 'true'}" data-hima-control="open-workbench">Workbench</a></nav>${crumb}</header>`
    + `<div id="workbench-content" class="page" tabindex="-1">${above}<main>${body}</main></div>`
    + `<script>${REFRESH}</script>${script === '' ? '' : `<script>${script}</script>`}</body></html>`;
}

/** `GET /hima/`, and `GET /hima/?pack=<id>` for the same page with that pack's knobs on its form
 *  (#58): the start form, and the run list under it. */
export const runsPage = (runs: readonly RunHeadView[], choices: StartChoices): string =>
  page('HimaHarness workbench', '', renderRunList(runs), '<div class="page-heading"><h2>Research workbench</h2><p>Choose a method, set a goal and budget, then follow each experiment back to its evidence.</p></div>' + renderStartForm(choices), START_FORM);

/** `GET /hima/?run=<id>`: that Run's card, with the controls a person acts on it through. */
export const runPage = (view: RunView): string =>
  page(`HimaHarness workbench — ${view.run.id}`, `<span class="crumb mono" title="${escape(view.run.id)}">${escape(view.run.id)}</span>`, renderCard(view), '', RUN_CONTROLS);

/** `GET /hima/?run=<id>` for a Run the ledger does not hold, or a request the fence or the method refused: the reason, on the same page. */
export const messagePage = (message: string): string =>
  page('HimaHarness workbench', '', `<section class="band"><p class="note">${escape(message)}</p></section>`);
