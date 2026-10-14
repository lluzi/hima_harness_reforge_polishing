// The Results face's before/after table (`contract.yml` `results`): which Reader fills each column
// and which semantic values are its rows, folded from the Run's own observations for one round. A
// pure read of `RunView` — every number is a Reader observation in HimaLedger; nothing is computed
// here beyond choosing which observation a cell shows and how many digits it prints.
import type { PackResults } from '../packs.js';
import type { RunView } from '../remote.js';

type Row = PackResults['rows'][number];

export interface ResultsCell {
  /** The value as printed, or an em dash when the column has no reading of this row yet. */
  readonly display: string;
  readonly value?: number;
  /** The last column, when it beats the first under the row's own `better`. Never the reference. */
  readonly better?: true;
}

export interface ResultsTable {
  readonly round: number;
  readonly rounds: readonly number[];
  readonly columns: readonly string[];
  readonly rows: readonly { readonly label: string; readonly unit?: string; readonly type: string; readonly cells: readonly ResultsCell[] }[];
  readonly headline?: { readonly label: string; readonly display: string };
}

const DASH = '—';

/** Every round the Run has opened, oldest first; round 1 when it has opened none yet. */
export function resultsRounds(view: Pick<RunView, 'generations' | 'observations'>): readonly number[] {
  const rounds = new Set(view.generations.map((generation) => generation.generation));
  for (const observation of view.observations) if (observation.generation !== undefined) rounds.add(observation.generation);
  return rounds.size === 0 ? [1] : [...rounds].sort((a, b) => a - b);
}

/** The rounds with a result to show: those the last column's Reader (the round's own build) has read
 *  in, oldest first. A round still running has none and is not offered yet. */
function readRounds(results: PackResults, view: Pick<RunView, 'observations'>): readonly number[] {
  const reader = results.columns[results.columns.length - 1]!.reader;
  const rounds = new Set<number>();
  for (const observation of view.observations) if (observation.reader.id === reader) rounds.add(observation.generation ?? 1);
  return [...rounds].sort((a, b) => a - b);
}

/** One reader's reading of one value type for a round: that round's latest, else its latest earlier. */
function readingOf(view: Pick<RunView, 'observations'>, reader: string, type: string, round: number): { value: number | null; round: number } | undefined {
  let best: { value: number | null; round: number } | undefined;
  for (const observation of view.observations) {
    if (observation.reader.id !== reader) continue;
    const at = observation.generation ?? 0;
    if (at > round) continue;
    const found = observation.values.find((value) => value.type === type);
    if (found === undefined) continue;
    // Later rounds win; within one round, the later observation (observations are oldest first).
    if (best === undefined || at >= best.round) best = { value: found.value, round: at };
  }
  return best;
}

const formatted = (value: number, digits: number | undefined): string => (digits === undefined ? String(value) : value.toFixed(digits));

/** The table for one round: only rounds the last column has read are offered, the latest by
 *  default; `round` outside them is answered for that latest one. Before any is read, the table
 *  shows the Run's latest round (the reference may already be in) with no headline. */
export function resultsTable(results: PackResults, view: Pick<RunView, 'generations' | 'observations'>, round?: number): ResultsTable {
  const rounds = readRounds(results, view);
  const opened = resultsRounds(view);
  const selected = round !== undefined && rounds.includes(round) ? round : rounds.at(-1) ?? opened[opened.length - 1]!;
  const cellOf = (reader: string, row: Row): ResultsCell => {
    const reading = readingOf(view, reader, row.type, selected);
    if (reading === undefined || reading.value === null) return { display: DASH };
    return { display: formatted(reading.value, row.digits), value: reading.value };
  };
  const rows = results.rows.map((row) => {
    const cells = results.columns.map((column) => cellOf(column.reader, row));
    const first = cells[0]?.value, last = cells.length > 1 ? cells[cells.length - 1]?.value : undefined;
    if (row.better !== undefined && first !== undefined && last !== undefined && (row.better === 'higher' ? last > first : last < first)) {
      cells[cells.length - 1] = { ...cells[cells.length - 1]!, better: true };
    }
    return { label: row.label, type: row.type, ...(row.unit === undefined ? {} : { unit: row.unit }), cells };
  });
  const headlineRow = results.headline;
  let headline: ResultsTable['headline'];
  if (headlineRow !== undefined) {
    const lastColumn = results.columns[results.columns.length - 1]!;
    const reading = readingOf(view, lastColumn.reader, headlineRow.type, selected);
    if (rounds.includes(selected) && reading !== undefined && reading.value !== null) {
      const sign = reading.value > 0 ? '+' : '';
      headline = { label: headlineRow.label, display: `${sign}${formatted(reading.value, headlineRow.digits)}${headlineRow.unit === undefined ? '' : ` ${headlineRow.unit}`}` };
    }
  }
  return { round: selected, rounds, columns: results.columns.map((column) => column.label), rows, ...(headline === undefined ? {} : { headline }) };
}

/** The best headline value over every round read so far, under the headline's own `better` (higher
 *  when it states none), printed as the table prints it; absent until a round has been read. */
export function bestHeadline(results: PackResults, view: Pick<RunView, 'generations' | 'observations'>): { readonly value: number; readonly display: string } | undefined {
  const row = results.headline;
  if (row === undefined) return undefined;
  const reader = results.columns[results.columns.length - 1]!.reader;
  let best: number | undefined;
  for (const observation of view.observations) {
    if (observation.reader.id !== reader) continue;
    const found = observation.values.find((value) => value.type === row.type);
    if (found === undefined || found.value === null) continue;
    if (best === undefined || (row.better === 'lower' ? found.value < best : found.value > best)) best = found.value;
  }
  if (best === undefined) return undefined;
  const sign = best > 0 ? '+' : '';
  return { value: best, display: `${sign}${formatted(best, row.digits)}${row.unit === undefined ? '' : ` ${row.unit}`}` };
}
