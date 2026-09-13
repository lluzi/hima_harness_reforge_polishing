// One row per Generation of a Run's Loop. One reason to change: how a Run's records fold into
// generation rows.
//
// The run view already carries the Run's path — one entry per node, the latest transition of it —
// which says where a Run *stands*. It does not say what a Campaign has *learned*, because a node
// touched in three generations is still one entry there. A generation is the unit a Loop learns in
// (CONTEXT.md, *Generation*), so this is the fold that makes a Campaign readable: the Run's records,
// grouped by the generation the ledger stamped on each of them, oldest first, one row each.
//
// Every number a row carries is the ledger's. The observed period and the slack are the values of
// that generation's own observation record, the verdicts are its verdict records, the decision is
// its decision record said in the card's own words, and the wall time is the span between the first
// and the last record the generation wrote. Nothing is re-read from a Site, recomputed from a flow,
// or inferred from a report this module opens itself.
//
// A drill-down Loop folds the same way (#28): its records are the ones the ledger stamped with its
// id, its turns are Generations in the same sense, and its rows hang off the outer generation that
// opened it. So one fold reads a Campaign at either depth, and the card shows the same six columns
// under a nested row as over a top-level one.
//
// Nothing here reaches a filesystem, a Site or a storage domain, and nothing it imports does: it is
// called from `runView` in `remote.ts`, which the browser bundle also imports, so a runtime import
// of the ledger's own module here would pull `node:crypto` and `node:fs` into the client build. The
// ledger's *types* are imported, and types are erased.
import { chosenSaid } from './card-labels.js';
import type { DecisionRecord, GrowthRecord, JobRecord, LedgerRecord, LoopOutcome, LoopRecord, NodeRecord, ObservationRecord, RunBranch, RunRecord, RunStrategy, VerdictOutcome, VerdictRecord } from './ledger.js';
import { jobView, nodeView, observationView, type JobView, type NodeView, type ObservationView } from './record-views.js';
// Type-only, and erased: the pack's words for its own knobs, which the decision each row carries is
// said in (#42, #58). Declared in `remote.ts` beside the rest of the run view, which this module is
// part of composing.
import type { RunWords } from './remote.js';

/**
 * Where one generation stands. Three words and no more, because a generation is either the one the
 * Run is in, one it has finished, or one it is stuck in — the node states behind it are the path's
 * to say, and the Run's status is the banner's.
 */
export type GenerationState = 'running' | 'done' | 'blocked';

/** One verdict of a generation as its row shows it: which rule, and what that rule concluded. The
 *  citations behind it are the verdicts section's, which carries every one of them resolved. */
export interface GenerationVerdictView {
  readonly ruleId: string;
  readonly outcome: VerdictOutcome;
  /** Optional only for views written before report schema 2. These identify the judge's facts. */
  readonly recordId?: string;
  readonly cites?: readonly string[];
}

/** One Generation of a Run's Loop as HimaGuide shows it: what it was asked for, what it measured,
 *  what was concluded, what was decided, and how long it took. */
export interface GenerationView {
  /** Which generation this is, counted from one inside its Loop, as the ledger stamped it. */
  readonly generation: number;
  /**
   * The whole Strategy this generation asked the flow for, knob by knob, in the pack's own names
   * (#58). Always known, which is what makes the `asked → observed` pair worth reading: a generation
   * where the two differ is a generation whose tool did not synthesize at what it was given.
   *
   * A revisit edge is one write of the run row — the target node, the generation, and the Strategy
   * the decision chose, together — so the decision that opened a generation is where that
   * generation's Strategy is on record, and every generation after the first reads it from there.
   *
   * Generation one was opened by no decision. Its Strategy is the run row's `firstStrategy`, which
   * is written once when the Run is opened and never again, precisely so this row can be read after
   * the Loop has moved `strategy` on to a later generation's. Generation one of a drill-down Loop is
   * the same rule one level down (#28): it asked for whatever the Run was set to when the Loop
   * opened, which is the outer generation's own asked Strategy, because a Loop is entered with the
   * Strategy the Campaign is on and only its own decisions move it after that.
   */
  readonly strategy: RunStrategy;
  /** This generation's raw reading and node transitions, for report provenance, not a new verdict. */
  readonly observation?: ObservationView;
  readonly nodes?: readonly NodeView[];
  /**
   * The clock period this generation's latest observation stated. Absent until one has been read —
   * and absent for the whole of a generation that **forked** (#29): its branches each synthesized at
   * their own period and each read their own report, so there is no one reading the generation took,
   * and picking whichever branch happened to read last would put a number here a person could not
   * tell from a measurement of the Campaign. `branches[].observation` is where those readings are.
   */
  readonly observedPeriodNs?: number;
  /** The setup slack that same observation stated, absent under the same two conditions. */
  readonly slackNs?: number;
  /** This generation's verdicts, in the order the judge node wrote them. */
  readonly verdicts: readonly GenerationVerdictView[];
  /** What this generation's Explore node decided, in the card's own words. Absent until it decided. */
  readonly decision?: string;
  readonly decisionRecordId?: string;
  /** From this generation's first record to its last — or to now, for the current generation of a
   *  Run that is still running. Zero for a generation the row has opened and nothing has written in. */
  readonly wallMs: number;
  readonly state: GenerationState;
  /** The drill-down Loops an Explore node opened during this generation, in the order they opened.
   *  Absent for a generation that opened none, which is every generation of a pack that drills
   *  nowhere. */
  readonly loops?: readonly LoopView[];
  /** Additive per-Run research branches accepted or refused in this generation. */
  readonly growths?: readonly GrowthBranchView[];
  /** The branches of the fork this generation ran, in the order the records name them. Absent for a
   *  generation that forked nowhere, which is every generation of a pack that does not fork. */
  readonly branches?: readonly BranchView[];
  /** The join **this generation's** branches converged into, absent for a generation that forked
   *  nowhere. Beside `branches` and never off the Run's path, because the path holds one entry per
   *  node: a pack that forked in two generations would otherwise show the join's latest transition
   *  on both of their lines, and an open fork would relabel an earlier closed one. */
  readonly join?: GenerationJoinView;
}

/**
 * What a forked generation's join is, and what it concluded (#29): the judge node this generation's
 * branches converged into, and the outcome that judge settled on over all of them.
 *
 * `outcome` is absent while the fork is still open — a join judges when every branch has reached it
 * and not before — and that is the one condition under which a face may say a join has judged
 * nothing yet. Once it is there it is the engine's own answer, written by the judge node's turn
 * (`forkOutcome`, `packs.ts`: PASS only where every branch passed), and never a card's second fold
 * of the branches' verdicts.
 */
export interface GenerationJoinView {
  /** The judge node the branches converge into. */
  readonly nodeId: string;
  readonly outcome?: VerdictOutcome;
}

/**
 * One branch of a fork as HimaGuide shows it (#29): which branch, what its act nodes did, the Jobs
 * they launched, where it stands, the reading it took, and what the join concluded about it.
 *
 * Its own rows and not the generation's, because a fork is several things happening at once and a
 * generation row can only say one of them: the periods, the slack and the verdicts of a forked
 * generation belong to a branch each, and a table that folded them together would show one branch's
 * measurement beside another's verdict.
 *
 * `nodes` is one entry per transition and not one per node, unlike the run view's own path: a branch
 * is a short chain a person reads whole — launched, waited for a slot, ran, done — and the whole of
 * it is four or five records.
 */
export interface BranchView {
  /** The branch's id, which is the id of its first node: what every record of it carries. */
  readonly id: string;
  readonly nodes: readonly NodeView[];
  readonly jobs: readonly JobView[];
  /** Where this branch stands, as the row's own `fork.branches` says while a fork is open, and as
   *  its last node record says once it has closed. */
  readonly state: BranchState;
  /** The latest reading this branch took, which is the one the join judged it on. Absent until it
   *  has read anything. */
  readonly observation?: ObservationView;
  /**
   * What that reading stated, folded here exactly as `GenerationView` carries a generation's own:
   * the clock period the report stated and the setup slack it closed with, each absent where nothing
   * read one.
   *
   * A branch says no *asked* Strategy at all, which is why there is no `strategy` beside these: what
   * a branch's act node was given is the pack's to state — a Strategy knob for one branch, a literal
   * in the graph for another — and the ledger carries neither, so the asked side of that column is
   * the em dash a value nobody recorded is always shown as.
   */
  readonly observedPeriodNs?: number;
  readonly slackNs?: number;
  /** What the join concluded about this branch, one verdict per rule, in the order it wrote them. */
  readonly verdicts: readonly GenerationVerdictView[];
}

/** Where one branch of a fork stands. The run row's own four words (`RunBranch`), so a face reading
 *  a branch reads what the engine wrote and never a second vocabulary for it. */
export type BranchState = RunBranch['state'];

/**
 * One drill-down Loop as HimaGuide shows it (#28): which Loop, which Explore node opened it, what it
 * came to, and one row per Generation *of that Loop*.
 *
 * Its generations are `GenerationView`s and not a shape of their own, because a Loop's turn is a
 * Generation in exactly the sense CONTEXT.md means: the act nodes run once with one Strategy, judged,
 * and decided. So the card reads the same six columns at either depth, and a person reading a nested
 * row is reading the same thing they read one level up.
 */
export interface LoopView {
  readonly id: string;
  /** The name the pack declares this Loop under. */
  readonly name: string;
  /** The Explore node whose `opens:` it is — the row of the outer graph it hangs under. */
  readonly nodeId: string;
  /** What it closed with. Absent while it is open, and on a Run cancelled inside it. */
  readonly outcome?: LoopOutcome;
  readonly generations: readonly GenerationView[];
}

/** One accepted or rejected additive research proposal as part of the actual generation path. */
export interface GrowthBranchView {
  readonly proposalId: string;
  readonly event: GrowthRecord['event'];
  readonly recordId: string;
  readonly parentNode?: string;
  readonly entry?: string;
  readonly returnNode?: string;
  readonly optional?: boolean;
  readonly nodes: readonly NodeView[];
  readonly jobs: readonly JobView[];
  readonly evidence: readonly string[];
  readonly reason?: string;
}

/**
 * The generations of one Run, oldest first: one row per generation the Run has opened.
 *
 * How many that is comes from the run row's own `generation` and not from a count of the records,
 * so a generation the Loop has just opened and not yet written anything in is a row that is there
 * and empty rather than a row that is missing. A Run HimaFabric never started — an observation's own
 * Probe-campaign Run — has opened none, and gets none.
 *
 * @param run - the run row, which says which generation the Run is in, what it started with, and
 *              where it stands.
 * @param all - that Run's records, in sequence order, as the ledger holds them; every one of them,
 *              because what this fold leaves out is its own to decide.
 * @returns one row per generation, generation one first.
 */
export function generationsOf(run: RunRecord, all: readonly LedgerRecord[], words?: RunWords): GenerationView[] {
  // Two record types are about the Run and not about a turn of its Loop, and folding either into the
  // generation the row happened to be standing in would put time that generation did not spend into
  // that generation's wall time — making the Campaign's own report disagree with the card about the
  // same Campaign, which is the one thing a report of a Campaign must not do.
  //
  // The Campaign's technical report (#30) is the first: it is written once the Run has ended, out of
  // these very rows, so the time spent writing it would land in the generation the report was written
  // from. A Model moment (#59) is the second, for the same reason and one more: a moment is not a
  // turn of the Loop at all — it is one isolated model session, opened at a node, which spends
  // nothing of the Run's Budget and is bracketed by its own pair of records. A moment opened on a Run
  // that has *ended* (the fenced route does exactly that, and so does the live check) would otherwise
  // stretch the last generation's wall time by however long a model took, after the report had been
  // written from the earlier number. An in-turn moment is not lost by this: the node's own records
  // bracket the turn that opened it, and that turn's time is that generation's either way.
  //
  // A `code` record (#62) is the third, and it belongs with the moment that wrote it for the same
  // reason: a file written inside a Model moment is not a turn of the Loop, it is something that
  // happened inside one turn of one node, and the node's own records already bracket that turn. The
  // workshop's own view is where a person reads what was written (`record-views.ts`), and it reads
  // these records directly rather than through a generation row.
  // Delivery and later provenance reads cannot extend an already completed experiment's duration.
  const records = all.filter((r) => r.type !== 'experience' && r.type !== 'archive' && r.type !== 'analysis'
    && r.type !== 'session' && r.type !== 'code' && r.type !== 'knowledge');
  const opened = run.generation;
  const first = run.firstStrategy;
  // Both are written by the one call that opens a Run HimaFabric started, so a row carrying one and
  // not the other is not a shape the ledger writes; a Run no fabric started carries neither, and has
  // no generations to show.
  if (opened === undefined || first === undefined) return [];
  // One instant for the whole fold: the current generation of a running Run is measured against the
  // moment this view was composed, and two rows of one view must not be measured against two.
  const now = Date.now();
  // The outer graph's own records: everything written outside every drill-down Loop. What was
  // written inside one belongs to that Loop's generations and not to the outer generation it was
  // opened in, so the two folds never see each other's records.
  const outer = records.filter((r) => r.loopId === undefined);
  const rows = rowsOf({ run, now, current: run.generation }, outer, opened, first, words);
  const nested = loopsOf(run, records, rows, now, words);
  // An absent key, never an undefined one: a generation that opened no Loop, and one that forked
  // nowhere, each say so by omission.
  return rows.map((row) => {
    const loops = nested.get(row.generation);
    const branches = branchesOf(run, outer, row.generation);
    const growths = growthBranchesOf(outer, row.generation);
    const withGrowth = growths === undefined ? row : { ...row, growths };
    const withLoops = loops === undefined ? withGrowth : { ...withGrowth, loops };
    if (branches === undefined) return withLoops;
    // The join belongs to the generation whose branches converged into it, and is composed here
    // beside them for that reason: a face reading a fork off the Run's path reads one entry per node
    // and so reads the *latest* transition of the join on every generation that ever forked.
    const join = joinOf(run, outer, row.generation);
    return join === undefined ? { ...withLoops, branches } : { ...withLoops, branches, join };
  });
}

function growthBranchesOf(records: readonly LedgerRecord[], generation: number): GrowthBranchView[] | undefined {
  const accepted = records.filter((record): record is GrowthRecord => record.type === 'growth' && record.event === 'accepted' && record.generation === generation);
  const rejected = records.filter((record): record is GrowthRecord => record.type === 'growth' && record.event === 'rejected' && record.generation === generation);
  const subjects = [...accepted, ...rejected].sort((a, b) => a.seq - b.seq);
  if (subjects.length === 0) return undefined;
  return subjects.map((subject) => {
    const events = records.filter((record): record is GrowthRecord => record.type === 'growth' && record.proposalId === subject.proposalId && record.seq >= subject.seq);
    const latest = events.at(-1) ?? subject;
    const nodeIds = new Set(subject.nodeIds ?? []);
    const until = events.find((event) => event.event === 'returned')?.seq ?? Number.POSITIVE_INFINITY;
    const own = records.filter((record) => record.seq >= subject.seq && record.seq <= until && 'nodeId' in record && typeof record.nodeId === 'string' && nodeIds.has(record.nodeId));
    return {
      proposalId: subject.proposalId, event: latest.event, recordId: latest.id,
      ...(subject.parentNode === undefined ? {} : { parentNode: subject.parentNode }),
      ...(subject.entry === undefined ? {} : { entry: subject.entry }),
      ...(subject.returnNode === undefined ? {} : { returnNode: subject.returnNode }),
      ...(subject.optional === undefined ? {} : { optional: subject.optional }),
      nodes: own.filter((record): record is NodeRecord => record.type === 'node').map(nodeView),
      jobs: own.filter((record): record is JobRecord => record.type === 'job').map(jobView),
      evidence: [...new Set(events.flatMap((event) => event.evidence ?? []))],
      ...(latest.reason === undefined ? {} : { reason: latest.reason }),
    };
  });
}

/**
 * Everything one fold of generations is measured against: the Run whose rows these are, the instant
 * the view was composed, and which generation *of this graph* the Run is standing in — the outer
 * one's own for the pack's graph, a Loop's own while the Run is inside that Loop, and undefined for
 * a Loop the Run has left, none of whose rows is still running.
 */
interface Fold {
  readonly run: RunRecord;
  readonly now: number;
  readonly current: number | undefined;
}

/**
 * One graph's generations, oldest first: the fold the outer graph and each drill-down Loop are both
 * read by, because a Loop's turn is a Generation in exactly the sense the outer Loop's is.
 *
 * @param fold - the Run, the view's instant, and which generation of this graph is under way.
 * @param own - this graph's own records, in sequence order.
 * @param opened - how many generations this graph has opened.
 * @param first - what generation one's Strategy was; every later one reads its own off the decision
 *                that opened it.
 * @param words - what the pack calls its knobs, for the decision each row says in them (#58).
 */
function rowsOf(fold: Fold, own: readonly LedgerRecord[], opened: number, first: RunStrategy, words: RunWords | undefined): GenerationView[] {
  const byGeneration = new Map<number, LedgerRecord[]>();
  for (const record of own) {
    if (record.generation === undefined) continue;
    const held = byGeneration.get(record.generation);
    if (held === undefined) byGeneration.set(record.generation, [record]);
    else held.push(record);
  }
  const rows: GenerationView[] = [];
  for (let generation = 1; generation <= opened; generation += 1) {
    const records = byGeneration.get(generation) ?? [];
    const asked = generation === 1 ? first : openedWith(decisionIn(byGeneration.get(generation - 1) ?? []));
    // A generation after the first exists because a decision chose a Strategy and the write that
    // acted on it opened this one, so what it asked for is always on record. Where it is not, this
    // is not a ledger any engine wrote, and the rows stop: a Strategy invented for a generation
    // nothing is known to have opened would be values a person could not tell from measurements.
    if (asked === undefined) break;
    rows.push(rowOf(fold, generation, asked, records, words));
  }
  return rows;
}

/**
 * The drill-down Loops a Run opened, by the outer generation each was opened in (#28).
 *
 * A Loop's records are the ones the ledger stamped with its id, and its `opened` record is the one
 * exception: that record was written before the Run moved into the Loop, so it carries the *outer*
 * generation — which is exactly what says which row this Loop hangs under, and exactly why it is not
 * one of the records the Loop's own generations are folded out of.
 *
 * Generation one of a Loop asked the flow for whatever the Run was set to when the Loop opened,
 * which is the outer generation's own asked period: a Loop is entered with the Strategy the Campaign
 * is on, and only its own decisions move it after that.
 */
function loopsOf(run: RunRecord, records: readonly LedgerRecord[], rows: readonly GenerationView[], now: number, words: RunWords | undefined): Map<number, LoopView[]> {
  const nested = new Map<number, LoopView[]>();
  for (const open of records) {
    if (open.type !== 'loop' || open.event !== 'opened' || open.generation === undefined) continue;
    const outerRow = rows.find((r) => r.generation === open.generation);
    if (outerRow === undefined) continue;
    const own = records.filter((r) => r.loopId === open.loopId && r !== open);
    const closed = own.find((r): r is LoopRecord => r.type === 'loop' && r.event === 'closed');
    const inside = run.loop?.id === open.loopId ? run.loop.generation : undefined;
    // How many generations it ran: what the `closed` record counted, else where the row says the Run
    // is inside it now — a Loop a cancel left open really did run that many — else the highest any of
    // its records carries, for a Loop nothing closed and no row is standing in.
    const ran = closed?.generations ?? inside ?? own.reduce((most, r) => Math.max(most, r.generation ?? 0), 0);
    if (ran < 1) continue;
    const view: LoopView = {
      id: open.loopId,
      name: open.name,
      nodeId: open.nodeId,
      ...(closed?.outcome === undefined ? {} : { outcome: closed.outcome }),
      generations: rowsOf({ run, now, current: inside }, own, ran, outerRow.strategy, words),
    };
    const held = nested.get(open.generation);
    if (held === undefined) nested.set(open.generation, [view]);
    else held.push(view);
  }
  return nested;
}

/**
 * The branches this generation forked into (#29), in the order the records first name them.
 *
 * Read off the records' own `branchId` and not off the run row's `fork`, because the fork is cleared
 * from the row the moment the branches converge and a generation that has been judged must still say
 * what its branches did. The row is read for one thing only, and only while it is there: where a
 * branch stands *now*, which is the one fact the records cannot give — a branch that reached the
 * join wrote `done` on the row and nothing on any record says so.
 *
 * Its rows are that branch's own records and nothing else: the node transitions the branch wrote, the
 * Jobs its launches carry, its latest reading, and the verdicts the join wrote about it. A record
 * that carries no branch belongs to the generation itself — the node that forked, the join's own
 * transition — and is the generation row's, exactly as it always was.
 *
 * @param run - the run row, which says where an open fork's branches stand.
 * @param own - this graph's records, in sequence order.
 * @param generation - the generation these branches ran in.
 * @returns one entry per branch, or undefined for a generation that forked nowhere.
 */
function branchesOf(run: RunRecord, own: readonly LedgerRecord[], generation: number): BranchView[] | undefined {
  const here = own.filter((r) => r.generation === generation && 'branchId' in r && r.branchId !== undefined);
  if (here.length === 0) return undefined;
  const ids: string[] = [];
  for (const record of here) {
    const id = (record as { readonly branchId: string }).branchId;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.map((id) => {
    const mine = here.filter((r) => (r as { readonly branchId?: string }).branchId === id);
    const nodes = mine.filter((r): r is NodeRecord => r.type === 'node');
    const observation = mine.findLast((r): r is ObservationRecord => r.type === 'observation');
    const head = {
      id,
      nodes: nodes.map(nodeView),
      jobs: mine.filter((r): r is JobRecord => r.type === 'job').map(jobView),
      state: branchState(run, generation, id, nodes),
      verdicts: mine.filter((r): r is VerdictRecord => r.type === 'verdict').map((v) => ({ ruleId: v.ruleId, outcome: v.outcome, recordId: v.id, cites: v.cites })),
      // The branch's own numbers, off the branch's own latest reading and through the fold a
      // generation's row is composed by: one table, one arithmetic, whichever depth a row is at.
      ...quantitiesOf(observation),
    };
    // An absent key, never an undefined one: a branch that has read nothing yet says so by omission.
    return observation === undefined ? head : { ...head, observation: observationView(observation) };
  });
}

/**
 * The join this generation's branches converged into (#29), and what it concluded of them.
 *
 * Read out of **this generation's own records**, which is the whole point of it being here: a face
 * that asked the Run's path instead would get one entry per node — the join's latest transition —
 * and would write that outcome on every generation that ever forked, and on the line of a fork still
 * open. A generation's records are the generation's, so two forks of one Run are two answers.
 *
 * Which of a generation's records is the join: the first judge node transition written **at or after
 * the last record any branch of the fork wrote**. A judge before the fork is not it — a fork leaves
 * an act node, so a judge node can stand in front of one — and the branches' own last words, the
 * per-branch verdicts the join itself writes, come immediately before the join's transition, so the
 * cut is exact without this fold ever reading the graph.
 *
 * Before that transition exists there is only the run row, and only while the Run is standing in
 * this generation: a fork that is open is the fork the Run is inside, and the row names the join it
 * is standing at. That is the one state in which a join has an id and no outcome, which is the one
 * state in which a face may say it has judged nothing yet.
 *
 * @param run - the run row, which names the join of a fork that is still open.
 * @param own - this graph's records, in sequence order.
 * @param generation - the generation whose fork this is.
 * @returns the join, or undefined for a generation whose fork neither closed nor is still open.
 */
function joinOf(run: RunRecord, own: readonly LedgerRecord[], generation: number): GenerationJoinView | undefined {
  const here = own.filter((r) => r.generation === generation);
  const lastOfBranches = here.findLastIndex((r) => 'branchId' in r && r.branchId !== undefined);
  const judged = lastOfBranches < 0
    ? undefined
    : here.slice(lastOfBranches).find((r): r is NodeRecord => r.type === 'node' && r.kind === 'judge' && r.branchId === undefined);
  if (judged !== undefined) {
    // An absent key, never an undefined one: a join that has not concluded says so by omission.
    return judged.outcome === undefined ? { nodeId: judged.nodeId } : { nodeId: judged.nodeId, outcome: judged.outcome };
  }
  return run.fork === undefined || run.generation !== generation ? undefined : { nodeId: run.fork.join };
}

/**
 * Where one branch stands: what the row says while *this generation's* fork is open, and otherwise
 * what the branch's own last node transition says.
 *
 * The row is the authority while it holds one, because it is what the engine writes and what a
 * resume re-enters. Once the fork has closed, every branch of it reached the join — that is what
 * closing a fork means — so a branch whose last transition settled is `done`, and one whose last
 * transition is a `blocked` on a Run that was stopped inside the fork says so.
 *
 * The row is the authority only for the generation the Run is standing in, exactly as it is in
 * `joinOf`. A branch id is the branch's first node id, so a graph that forks and revisits gives
 * every generation branches of the same names: without the generation, the settled branches of
 * generation one would read the open fork of generation two and a person would watch an ended row
 * start running again.
 */
function branchState(run: RunRecord, generation: number, id: string, nodes: readonly NodeRecord[]): BranchState {
  const stands = run.generation === generation ? run.fork?.branches[id] : undefined;
  if (stands !== undefined) return stands.state;
  const last = nodes[nodes.length - 1];
  if (last === undefined) return 'running';
  if (last.state === 'blocked' || last.state === 'cancelled') return 'blocked';
  if (last.state === 'waiting-for-slot') return 'waiting-for-slot';
  return last.state === 'done' ? 'done' : 'running';
}

/**
 * One generation's row, from its own records and the period the decision before it opened it with.
 *
 * The reading it shows is the generation's **own**: an observation a branch of a fork took is that
 * branch's row and not this one's (#29), so a generation that forked shows no measured period or
 * slack at all rather than whichever branch read last. Everything else here is the generation's
 * whatever wrote it — the verdicts a join wrote about every branch are what the generation was
 * judged to be, and its wall time spans all of them.
 */
function rowOf(fold: Fold, generation: number, strategy: RunStrategy, own: readonly LedgerRecord[], words: RunWords | undefined): GenerationView {
  const observation = own.findLast((r): r is ObservationRecord => r.type === 'observation' && r.branchId === undefined);
  const decision = decisionIn(own);
  const head = {
    generation,
    strategy,
    nodes: own.filter((r): r is NodeRecord => r.type === 'node' && r.branchId === undefined).map(nodeView),
    ...(observation === undefined ? {} : { observation: observationView(observation) }),
    ...quantitiesOf(observation),
    verdicts: own
      .filter((r): r is VerdictRecord => r.type === 'verdict')
      .map((v) => ({ ruleId: v.ruleId, outcome: v.outcome, recordId: v.id, cites: v.cites })),
    wallMs: wallMsOf(fold, generation, own),
    state: stateOf(fold, generation, own),
  };
  // An absent key, never an undefined one, as everywhere else a view is composed: a generation that
  // has decided nothing yet says so by omission.
  return decision === undefined ? head : { ...head, decision: chosenSaid(decision, words), decisionRecordId: decision.id };
}

/** The decision one generation made, out of that generation's own records. */
const decisionIn = (records: readonly LedgerRecord[]): DecisionRecord | undefined =>
  records.findLast((r): r is DecisionRecord => r.type === 'decision');

/**
 * The Strategy a decision opened the generation after it with, and undefined for a decision that
 * chose none — which is a decision that ended the Run, and so opened nothing.
 *
 * @param opening - the decision the generation before this one made, which is what opened it.
 */
const openedWith = (opening: DecisionRecord | undefined): RunStrategy | undefined =>
  (opening !== undefined && 'strategy' in opening.chosen ? opening.chosen.strategy : undefined);

/** The clock period or setup slack this observation stated, or undefined where nothing read one: a
 *  value the reader marked unknown is absent here, never a zero standing in for a missing reading. */
function measured(observation: ObservationRecord | undefined, type: string): number | undefined {
  if (observation === undefined) return undefined;
  const value = observation.values.findLast((v) => v.type === type && v.value !== null);
  return value?.value ?? undefined;
}

/**
 * **The two numbers a reading is shown by, stated once**: the clock period the report stated and the
 * setup slack it closed with, in the ledger's own semantic types.
 *
 * One fold and one pair of type names for both places a reading is shown — a generation's own row
 * and a branch's row under it — because they are the same two columns of the same table, and two
 * spellings of `'clock_period'` are two places a reader would have to be told which one the card
 * actually uses.
 *
 * An absent key, never an undefined one, as everywhere else a view is composed.
 */
function quantitiesOf(observation: ObservationRecord | undefined): { readonly observedPeriodNs?: number; readonly slackNs?: number } {
  const observedPeriodNs = measured(observation, 'clock_period');
  const slackNs = measured(observation, 'setup_wns');
  return {
    ...(observedPeriodNs === undefined ? {} : { observedPeriodNs }),
    ...(slackNs === undefined ? {} : { slackNs }),
  };
}

/**
 * How long this generation has taken: from its first record to its last, or to the view's own time
 * for the current generation of a Run that is still running — which is the only generation whose
 * last record is not its last word.
 */
function wallMsOf(fold: Fold, generation: number, own: readonly LedgerRecord[]): number {
  const first = own[0];
  const last = own[own.length - 1];
  if (first === undefined || last === undefined) return 0;
  const until = isCurrent(fold, generation) ? fold.now : Date.parse(last.at);
  return Math.max(0, until - Date.parse(first.at));
}

/** Is this the generation the Run is standing in, of the graph these rows are, while it is moving? */
const isCurrent = (fold: Fold, generation: number): boolean => generation === fold.current && fold.run.status === 'running';

/**
 * Where this generation stands.
 *
 * `blocked` first, and read off the generation's own latest node record rather than off the Run's
 * status, because a Run only ever waits at a node it has recorded as blocked — a Wait node, a spent
 * Retry allowance, a preparation that never got past the entry node — so a `waiting` Run's current
 * generation says which of the two it is by pointing at the record that says so. A generation that
 * was blocked and then resumed is not blocked any more, and its later records say so.
 *
 * Then `running`, and only for the generation the Run is actually in while the Run is actually
 * moving. Everything else is `done`: a generation a later one has replaced is finished whatever else
 * is true of it, and so is the one a Run ended on, however it ended.
 *
 * "The generation the Run is in" is one per graph and so **two rows of a view can read `running` at
 * once** (#28): while a drill-down Loop is open, the Loop's current row is running and so is the
 * outer generation that opened it, because that outer generation genuinely is in progress — its
 * Explore node's turn is not over until the Loop it opened has closed. A face that renders both
 * depths shows both, and a face that reads only the outer rows (`generationsState`) sees the one it
 * always saw.
 */
function stateOf(fold: Fold, generation: number, own: readonly LedgerRecord[]): GenerationState {
  const node = own.findLast((r): r is NodeRecord => r.type === 'node');
  if (node?.state === 'blocked') return 'blocked';
  return isCurrent(fold, generation) ? 'running' : 'done';
}
