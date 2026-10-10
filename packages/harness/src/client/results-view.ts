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
  /** The earlier round this cell's observation came from, when the selected round has none. */
  readonly fromRound?: number;
  /** The better of the first and last columns under the row's own `better`. */
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

/** The table for one round. `round` outside the Run's rounds is answered for its latest round. */
export function resultsTable(results: PackResults, view: Pick<RunView, 'generations' | 'observations'>, round?: number): ResultsTable {
  const rounds = resultsRounds(view);
  const selected = round !== undefined && rounds.includes(round) ? round : rounds[rounds.length - 1]!;
  const cellOf = (reader: string, row: Row): ResultsCell => {
    const reading = readingOf(view, reader, row.type, selected);
    if (reading === undefined || reading.value === null) return { display: DASH };
    return { display: formatted(reading.value, row.digits), value: reading.value, ...(reading.round < selected && reading.round > 0 ? { fromRound: reading.round } : {}) };
  };
  const rows = results.rows.map((row) => {
    const cells = results.columns.map((column) => cellOf(column.reader, row));
    const first = cells[0]?.value, last = cells.length > 1 ? cells[cells.length - 1]?.value : undefined;
    if (row.better !== undefined && first !== undefined && last !== undefined && first !== last) {
      const lastWins = row.better === 'higher' ? last > first : last < first;
      const index = lastWins ? cells.length - 1 : 0;
      cells[index] = { ...cells[index]!, better: true };
    }
    return { label: row.label, type: row.type, ...(row.unit === undefined ? {} : { unit: row.unit }), cells };
  });
  const headlineRow = results.headline;
  let headline: ResultsTable['headline'];
  if (headlineRow !== undefined) {
    const lastColumn = results.columns[results.columns.length - 1]!;
    const reading = readingOf(view, lastColumn.reader, headlineRow.type, selected);
    if (reading !== undefined && reading.value !== null) {
      const sign = reading.value > 0 ? '+' : '';
      headline = { label: headlineRow.label, display: `${sign}${formatted(reading.value, headlineRow.digits)}${headlineRow.unit === undefined ? '' : ` ${headlineRow.unit}`}` };
    }
  }
  return { round: selected, rounds, columns: results.columns.map((column) => column.label), rows, ...(headline === undefined ? {} : { headline }) };
}
