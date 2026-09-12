// The readers this bundle ships: the default library, and no longer the only way a report is read.
// The raw reader records only identity; the two Innovus readers and the qor reader below turn a
// recognised report kind into the value types `packages/harness/semantics.yml` declares.
//
// Since #61 a HimaPack brings readers of its own — a script in its tools folder, shipped to the Site
// and launched as a Job, whose output is validated against the pack's own `semantics.yml` — so what
// is here is what every pack of this kind would otherwise write out again, and a pack that ships its
// own scripts for these report kinds runs on those instead.
//
// Every reader declares itself: the report kind it accepts, the value types it can emit, and its own
// version. The declaration is `ReaderRef`, so it travels into each observation record unchanged and
// a pack can state the readers a goal needs without running one. **What it declares it emits is what
// it emits**: every type in `emits` appears in every reading, unknown with a reason where the report
// does not state it, because the one validator (`semantics.ts`) holds the set of types produced
// against the set declared — a reader that quietly emitted fewer on some reports would be a rule
// going UNDETERMINED for want of a number nobody noticed was missing.
import { gunzipSync } from 'node:zlib';
import type { ReaderRef } from './ledger.js';
import type { SemanticValue } from './semantics.js';

export interface Reader extends ReaderRef {
  /** Can this reader make sense of these bytes? Checked before read(): a "no" is a refusal, not an empty read. */
  accepts(bytes: Uint8Array): boolean;
  read(bytes: Uint8Array): { values: SemanticValue[] };
}

/** The declaration alone, without the reading: what a record carries and what a pack would list. */
export const declarationOf = ({ id, version, reportKind, emits }: Reader): ReaderRef => ({ id, version, reportKind, emits: [...emits] });

export const rawReader: Reader = {
  id: 'raw',
  version: '1',
  // Not a report kind at all: the raw reader records a file's identity and reads no semantics from it.
  reportKind: 'raw',
  emits: [],
  accepts: () => true,
  read: () => ({ values: [] }),
};

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Decode a report's bytes to text, inflating first when the bytes are gzip-compressed (sniffed by magic). */
function decodeText(bytes: Uint8Array): string {
  const plain = isGzip(bytes) ? gunzipSync(bytes) : bytes;
  return Buffer.from(plain).toString('utf8');
}

const OPTDESIGN_COMMAND = /^#\s*Command:\s*optDesign\b/m;
const VERIFY_DRC_COMMAND = /^#\s*Command:\s*verify_drc\b/m;

/** One `|`-delimited table row, trimmed and stripped of the empty cells the leading/trailing `|` leave behind. */
function splitTableRow(line: string): string[] {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

type Mode = 'setup' | 'hold';

/** The row that names the analysis mode and, in the cells that follow, the path-scope columns. */
function findModeHeader(lines: string[]): { mode: Mode; columns: string[] } | undefined {
  for (const line of lines) {
    const cells = splitTableRow(line);
    const label = /^(Setup|Hold) mode$/i.exec(cells[0] ?? '');
    if (label) return { mode: label[1]!.toLowerCase() as Mode, columns: cells.slice(1) };
  }
  return undefined;
}

/** The value cells of the first row whose label cell matches, if any such row exists. */
function findRow(lines: string[], labelPattern: RegExp): string[] | undefined {
  for (const line of lines) {
    const cells = splitTableRow(line);
    if (cells[0] !== undefined && labelPattern.test(cells[0])) return cells.slice(1);
  }
  return undefined;
}

/** The numeric cell for `scope`, matching columns (from the mode header) against a value row by position. */
function cellFor(columns: string[], row: string[], scope: 'all' | 'reg2reg'): number | undefined {
  const idx = columns.findIndex((c) => c.toLowerCase() === scope);
  if (idx < 0 || idx >= row.length) return undefined;
  const n = Number(row[idx]);
  return Number.isFinite(n) ? n : undefined;
}

function timingValue(
  kind: 'wns' | 'tns',
  mode: Mode,
  scope: 'all' | 'reg2reg',
  columns: string[],
  row: string[] | undefined,
  missingReason: string,
): SemanticValue {
  const n = row ? cellFor(columns, row, scope) : undefined;
  if (n === undefined) return { type: `${mode}_${kind}`, unit: 'ns', mode, scope, value: null, unknownReason: missingReason };
  return { type: `${mode}_${kind}`, unit: 'ns', mode, scope, value: n };
}

/** The two analysis passes and the two path scopes, in the order a reader states them. */
const MODES: readonly Mode[] = ['setup', 'hold'];
const SCOPES: readonly ('all' | 'reg2reg')[] = ['all', 'reg2reg'];

/** All four WNS/TNS values of one analysis pass, unknown for the one reason none of them was read. */
function unreadTiming(mode: Mode, reason: string): SemanticValue[] {
  return (['wns', 'tns'] as const).flatMap((kind) =>
    SCOPES.map((scope): SemanticValue => ({ type: `${mode}_${kind}`, unit: 'ns', mode, scope, value: null, unknownReason: reason })));
}

/**
 * Reads an Innovus `optDesign -postRoute` summary (gzip or plain text). Detects Setup vs Hold mode
 * from the table header and emits WNS/TNS for the `all` and `reg2reg` scopes in that mode, plus
 * placement density from the `Density:` line. A clock period is never stated in this report, so it
 * is always emitted unknown.
 *
 * The *other* mode's four values are emitted unknown too, saying which mode the report actually
 * states — and if the header itself cannot be found (a report truncated before its table), all eight
 * are unknown saying that. Nothing is guessed at either way: fabricating a mode would be worse than
 * saying nothing, and *omitting* a declared type would be this reader's record promising a hold slack
 * its reading never mentions. An unknown with the report's own reason on it is the honest third
 * answer, exactly as it is for a missing line.
 */
export const innovusTimingSummaryReader: Reader = {
  id: 'innovus-timing-summary',
  version: '1',
  reportKind: 'innovus-optdesign-summary',
  // Both modes are declared: which of the two a given report yields is decided by its own table
  // header, and a pack asking for hold slack needs to know this reader is the one that can produce it.
  emits: ['setup_wns', 'setup_tns', 'hold_wns', 'hold_tns', 'placement_density', 'clock_period'],
  accepts(bytes) {
    try {
      return OPTDESIGN_COMMAND.test(decodeText(bytes));
    } catch {
      return false;
    }
  },
  read(bytes) {
    const text = decodeText(bytes);
    const lines = text.split(/\r?\n/);
    const values: SemanticValue[] = [];

    const header = findModeHeader(lines);
    // Both analysis passes, always, because both are declared: one report states one of them, and the
    // other is reported unknown saying so rather than left out. A reading that simply omitted the
    // other pass would be a reader emitting fewer types than its own record says it can, and a hold
    // rule applied to it would go UNDETERMINED with nothing anywhere saying why.
    for (const mode of MODES) {
      if (header === undefined) {
        values.push(...unreadTiming(mode, 'no "Setup mode" or "Hold mode" timing table header found in the report'));
        continue;
      }
      if (header.mode !== mode) {
        values.push(...unreadTiming(mode, `this report states the ${header.mode} mode timing table, so it says nothing about ${mode} timing`));
        continue;
      }
      const { columns } = header;
      const wnsRow = findRow(lines, /^WNS \(ns\):$/);
      const tnsRow = findRow(lines, /^TNS \(ns\):$/);
      const wnsReason = `no "WNS (ns):" row found in the ${mode} mode timing table`;
      const tnsReason = `no "TNS (ns):" row found in the ${mode} mode timing table`;
      for (const scope of SCOPES) values.push(timingValue('wns', mode, scope, columns, wnsRow, wnsReason));
      for (const scope of SCOPES) values.push(timingValue('tns', mode, scope, columns, tnsRow, tnsReason));
    }

    const densityMatch = /^Density:\s*([0-9.]+)%/m.exec(text);
    values.push(
      densityMatch
        ? { type: 'placement_density', unit: 'percent', value: Number(densityMatch[1]) }
        : { type: 'placement_density', unit: 'percent', value: null, unknownReason: 'no "Density:" line found in the report' },
    );

    values.push({ type: 'clock_period', unit: 'ns', value: null, unknownReason: 'not stated in an Innovus optDesign summary' });
    return { values };
  },
};

/**
 * Reads an Innovus `verify_drc` report and emits the total violation count from its
 * `Total Violations : N Viols.` line, unknown if that line is absent (for example a truncated report).
 */
export const innovusVerifyDrcReader: Reader = {
  id: 'innovus-verify-drc',
  version: '1',
  reportKind: 'innovus-verify-drc',
  emits: ['drc_violation_count'],
  accepts(bytes) {
    try {
      return VERIFY_DRC_COMMAND.test(decodeText(bytes));
    } catch {
      return false;
    }
  },
  read(bytes) {
    const text = decodeText(bytes);
    const match = /Total Violations\s*:\s*(\d+)\s*Viols\.?/.exec(text);
    const values: SemanticValue[] = match
      ? [{ type: 'drc_violation_count', unit: 'count', value: Number(match[1]) }]
      : [{ type: 'drc_violation_count', unit: 'count', value: null, unknownReason: 'no "Total Violations" line found in the report' }];
    return { values };
  },
};

const QOR_HEADER = /^Report\s*:\s*qor\b/m;
const PATH_GROUP_HEADING = /^\s*Timing Path Group '([^']*)'/gm;

/** One numeric field pulled from a Design Compiler qor `Label:   value` line, undefined if absent. */
function qorField(text: string, label: string): number | undefined {
  const m = new RegExp(`^\\s*${label}:\\s*(-?[0-9.]+)`, 'm').exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** One `Timing Path Group '<name>'` block: its name and the slice of text from its heading to the next one (or the report's end). */
interface PathGroupChunk { readonly name: string; readonly text: string }

/** Every path-group block in a qor report, in the order they appear. */
function pathGroupChunks(text: string): PathGroupChunk[] {
  const headings = [...text.matchAll(PATH_GROUP_HEADING)];
  return headings.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < headings.length ? headings[i + 1]!.index : text.length;
    return { name: m[1]!, text: text.slice(start, end) };
  });
}

/** One path group's timing metrics, each undefined when its line is missing from the block. */
interface PathGroupMetrics {
  readonly name: string;
  readonly slack: number | undefined;
  readonly clkPeriod: number | undefined;
  readonly tns: number | undefined;
  readonly holdViolation: number | undefined;
}

function pathGroupMetrics(chunk: PathGroupChunk): PathGroupMetrics {
  return {
    name: chunk.name,
    slack: qorField(chunk.text, 'Critical Path Slack'),
    clkPeriod: qorField(chunk.text, 'Critical Path Clk Period'),
    tns: qorField(chunk.text, 'Total Negative Slack'),
    holdViolation: qorField(chunk.text, 'Worst Hold Violation'),
  };
}

/**
 * The first group (in report order) missing the line `pick` reads, if any. The one rule every
 * aggregation below follows: a value folded across path groups is known only when every group
 * contributed the line it needs, so this is the single place that decides whether one did not.
 */
function firstMissing(groups: readonly PathGroupMetrics[], pick: (g: PathGroupMetrics) => number | undefined): PathGroupMetrics | undefined {
  return groups.find((g) => pick(g) === undefined);
}

/**
 * The group with the worst (minimum) critical-path slack, chosen only when every group states its
 * `Critical Path Slack` line. If any group is missing it, no group can be honestly called "worst" —
 * skipping that group and taking the minimum over the rest would let a partially unparseable report
 * report an optimistic setup WNS, so the choice itself is unknown, naming the group and the line.
 */
function worstSlackGroup(groups: readonly PathGroupMetrics[]): { ok: true; group: PathGroupMetrics } | { ok: false; reason: string } {
  const missing = firstMissing(groups, (g) => g.slack);
  if (missing) return { ok: false, reason: `no "Critical Path Slack:" line found in path group '${missing.name}'` };
  let worst = groups[0]!;
  for (const g of groups) if (g.slack! < worst.slack!) worst = g;
  return { ok: true, group: worst };
}

/**
 * The group with the worst (largest) `Worst Hold Violation`, chosen only when every group states
 * that line, for the same reason `worstSlackGroup` requires it of every group: skipping a group that
 * does not state it would let a partially unparseable report understate the violation. Ties go to
 * the first group in report order, as they do for slack — a report where two groups state the same
 * worst violation is answered by naming one of the groups that really did state it.
 */
function worstHoldGroup(groups: readonly PathGroupMetrics[]): { ok: true; group: PathGroupMetrics } | { ok: false; reason: string } {
  const missing = firstMissing(groups, (g) => g.holdViolation);
  if (missing) return { ok: false, reason: `no "Worst Hold Violation:" line found in path group '${missing.name}'` };
  let worst = groups[0]!;
  for (const g of groups) if (g.holdViolation! > worst.holdViolation!) worst = g;
  return { ok: true, group: worst };
}

/**
 * The worst hold violation over the report's path groups, turned into the hold slack `hold_wns` is.
 *
 * Design Compiler prints `Worst Hold Violation` as a positive magnitude: how much hold margin the
 * worst path is short of, 0.00 when no path is short of any. `hold_wns` is a slack — the same
 * quantity Innovus's hold summary states directly, and the quantity `hold-wns-all-nonnegative`
 * passes at `>= 0` — so the magnitude is negated: a 0.02 ns violation is −0.02 ns of slack. No
 * violation stays exactly `0`, never `-0`, so a report with nothing wrong reads as the zero a person
 * and a strict comparison both expect.
 */
function asHoldSlack(worstViolationNs: number): number {
  return worstViolationNs === 0 ? 0 : -worstViolationNs;
}

/**
 * Is this the name of one of Design Compiler's own built-in path groups rather than a clock's?
 *
 * DC files paths that belong to no clock into groups it names in double asterisks — `**default**`,
 * `**async_default**`, `**clock_gating_default**` — and names every other group after the clock that
 * launches it. The asterisks are DC's own marking, not a convention this reader invents, so this is
 * the report's own answer to "is this a clock?" read back rather than a list of names to keep up to
 * date. It matters because the built-in groups routinely hold the worst slack in a real report while
 * stating a `Critical Path Clk Period` that is no clock's period at all.
 */
function isBuiltInGroup(name: string): boolean {
  return /^\*\*.+\*\*$/.test(name);
}

/** `'a', 'b'` — group names as a report reader would recognise them in a reason. */
function nameList(groups: readonly PathGroupMetrics[]): string {
  return groups.map((g) => `'${g.name}'`).join(', ');
}

/**
 * The one path group whose `Critical Path Clk Period` is the design's clock period.
 *
 * The worst-slack group is the wrong answer even though it used to be this reader's: on a real
 * report that group is often a DC built-in, whose stated period is not a period the design was
 * synthesized at. A Loop that fed such a number back through a chooser would push the next
 * generation against a period nobody asked for, and it would look like a measurement.
 *
 * So the clock group is the group that is not a built-in — and only when the report states exactly
 * one. Zero of them, or several, and the report alone does not say which clock the Run's period is;
 * that is a question a pack's contract will answer in a later step, and guessing it here would be
 * the same silent wrong number in a new place. The choice is unknown then, its reason naming the
 * groups the report did state so a person can see what it had to choose between.
 */
function clockGroup(groups: readonly PathGroupMetrics[]): { ok: true; group: PathGroupMetrics } | { ok: false; reason: string } {
  const clocks = groups.filter((g) => !isBuiltInGroup(g.name));
  if (clocks.length === 1) return { ok: true, group: clocks[0]! };
  if (clocks.length === 0) {
    return { ok: false, reason: `no clock path group in the qor report: every group it states is a Design Compiler built-in (${nameList(groups)})` };
  }
  return { ok: false, reason: `the qor report states more than one clock path group (${nameList(clocks)}), so which one's period the Run asked for is not stated by the report` };
}

/**
 * One qor timing value. `group` names the path group the number was read out of, and is left off
 * entirely — never set to undefined — when no one group is its source: a value folded over every
 * group, or one whose group could not be chosen at all.
 */
function qorValue(
  type: 'setup_wns' | 'setup_tns' | 'hold_wns',
  mode: Mode,
  n: number | undefined,
  missingReason: string,
  group?: string,
): SemanticValue {
  const named = group === undefined ? {} : { group };
  return n === undefined
    ? { type, unit: 'ns', mode, scope: 'all', value: null, unknownReason: missingReason, ...named }
    : { type, unit: 'ns', mode, scope: 'all', value: n, ...named };
}

/**
 * Reads a Design Compiler `report_qor` summary (gzip or plain text, DC X-2025.06-SP3 shape): a
 * `Timing Path Group` block per group, then Cell Count, Area, Design Rules, and compile statistics.
 *
 * Which group each value comes from is part of what the value means, so each one says so in its
 * `group`, and the two answers are not the same group:
 *
 * - `setup_wns` is the minimum critical-path slack over *every* group, clock or built-in, naming the
 *   group that holds it — the worst path in the design is the worst path wherever it lives.
 * - `clock_period` is the *clock* group's `Critical Path Clk Period` (`clockGroup` above), not the
 *   worst group's. Unknown, naming the groups found, when the report states no clock group or more
 *   than one.
 * - `setup_tns` is the sum of every group's total negative slack, so it names no group.
 * - `hold_wns` is the worst hold *slack* over every group, naming the group that stated it: the
 *   worst (largest) `Worst Hold Violation` in the report, negated — DC prints a violation as a
 *   positive magnitude, `hold_wns` is a slack, so a 0.02 ns violation is −0.02 ns and 0.00 (no
 *   violation anywhere) stays 0.
 * - `cell_area` comes from the report's one `Cell Area:` line, outside any group, and names none.
 *
 * Nothing is defaulted: a missing line is unknown, not zero. Every fold over the groups follows the
 * same rule: a value is known only when every path group contributed the line it needs. A group
 * missing that line never gets skipped in favour of the ones that have it — doing so would let a
 * partially unparseable report understate setup WNS or the worst hold violation — so that value goes
 * unknown, its reason naming the group and the line, and the values whose lines are all present
 * still read. A report with no path group at all (for example one truncated before the first) leaves
 * every value unknown the same way.
 */
export const dcQorReportReader: Reader = {
  id: 'dc-qor-report',
  version: '1',
  reportKind: 'dc-qor-report',
  emits: ['setup_wns', 'setup_tns', 'clock_period', 'hold_wns', 'cell_area'],
  accepts(bytes) {
    try {
      return QOR_HEADER.test(decodeText(bytes));
    } catch {
      return false;
    }
  },
  read(bytes) {
    const text = decodeText(bytes);
    const groups = pathGroupChunks(text).map(pathGroupMetrics);
    const values: SemanticValue[] = [];

    if (groups.length === 0) {
      const reason = 'no "Timing Path Group" block found in the qor report';
      values.push(qorValue('setup_wns', 'setup', undefined, reason));
      values.push(qorValue('setup_tns', 'setup', undefined, reason));
      values.push({ type: 'clock_period', unit: 'ns', value: null, unknownReason: reason });
      values.push(qorValue('hold_wns', 'hold', undefined, reason));
    } else {
      const worst = worstSlackGroup(groups);
      values.push(worst.ok
        ? qorValue('setup_wns', 'setup', worst.group.slack, '', worst.group.name)
        : qorValue('setup_wns', 'setup', undefined, worst.reason));

      // Independent of the worst-slack choice above: the clock period is the clock group's whether
      // or not that group is the one in trouble, and it stays readable on a report whose worst-slack
      // group cannot be chosen at all.
      const clock = clockGroup(groups);
      if (!clock.ok) {
        values.push({ type: 'clock_period', unit: 'ns', value: null, unknownReason: clock.reason });
      } else {
        values.push(clock.group.clkPeriod === undefined
          ? { type: 'clock_period', unit: 'ns', value: null, group: clock.group.name, unknownReason: `no "Critical Path Clk Period:" line found in path group '${clock.group.name}'` }
          : { type: 'clock_period', unit: 'ns', value: clock.group.clkPeriod, group: clock.group.name });
      }

      // A sum over every group is no single group's, so it names none.
      const missingTns = firstMissing(groups, (g) => g.tns);
      values.push(missingTns
        ? qorValue('setup_tns', 'setup', undefined, `no "Total Negative Slack:" line found in path group '${missingTns.name}'`)
        : qorValue('setup_tns', 'setup', groups.reduce((sum, g) => sum + g.tns!, 0), ''));

      const hold = worstHoldGroup(groups);
      values.push(hold.ok
        ? qorValue('hold_wns', 'hold', asHoldSlack(hold.group.holdViolation!), '', hold.group.name)
        : qorValue('hold_wns', 'hold', undefined, hold.reason));
    }

    const cellArea = qorField(text, 'Cell Area');
    values.push(cellArea === undefined
      ? { type: 'cell_area', unit: 'um2', value: null, unknownReason: 'no "Cell Area:" line found in the report' }
      : { type: 'cell_area', unit: 'um2', value: cellArea });

    return { values };
  },
};

const registry = new Map<string, Reader>(
  [rawReader, innovusTimingSummaryReader, innovusVerifyDrcReader, dcQorReportReader].map((r) => [r.id, r]),
);
export function readerNamed(id: string): Reader | undefined {
  return registry.get(id);
}

/**
 * Every reader this bundle ships, as a declaration: what each accepts and what each emits (#61).
 *
 * On the surface because the bundle is now one of two places a reader can come from, and both a pack
 * author composing a contract and the contract test that holds these `emits` against
 * `packages/harness/semantics.yml` need the same list the registry answers from. Derived from the
 * registry rather than written out again, so a reader added there cannot be missing from here.
 */
export const bundledReaders: readonly ReaderRef[] = [...registry.values()].map(declarationOf);
