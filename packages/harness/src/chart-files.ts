// The Host side of `hima_chart`: find one chart file a tool or a Pack wrote, read its exact bytes,
// hold them to `himaChart`, and answer `HimaChartAnswer`. The model names a file; it never passes a
// number. Two places a chart may live, and nowhere else:
//   - a Run report, `<reports dir>/<node>/r<k>/<name>.chart.json`, read through `RunReports.readChart`
//     (the same bounded, permit-checked Site read as the Reports face);
//   - an installed Pack's own knowledge, `knowledge/charts/<name>.chart.json`, read from the Pack folder
//     the Host loaded (`loadPack`), so a chart is exactly what that Pack ships.
// Every refusal is one plain sentence with no host path in it: it is what the chat card shows.
import { createHash } from 'node:crypto';
import { HIMA_CHART_SCHEMA, himaChart, type HimaChartAnswer, type HimaChartSource } from './charts.js';
import { PackNotFoundError, ReportPathError, RunReferenceError } from './errors.js';
import { loadPack, type Pack } from './packs.js';
import { reportReadLimit, type RunReports } from './run-reports.js';

/** The most characters an agent's one-line reading of a chart may have. */
export const chartNoteLimit = 200;

/** The one shape a Pack chart file may have, relative to the Pack's `knowledge/` folder. */
export const packChartPattern = /^charts\/[A-Za-z0-9._-]{1,120}\.chart\.json$/;

/** A chart that cannot be shown, in one plain sentence. */
export class ChartFileError extends Error {}

/** What `hima_chart` is asked: a Run report or a Pack file, and the agent's optional one-line note. */
export type ChartRequest = { readonly note?: string } & (
  | { readonly runId: string; readonly path: string }
  | { readonly pack: string; readonly file: string });

/** Exactly one of the two addresses, and a note within its bound; refuses anything else. */
export function chartRequestOf(args: { runId?: string; path?: string; pack?: string; file?: string; note?: string }): ChartRequest {
  const run = args.runId !== undefined || args.path !== undefined;
  const pack = args.pack !== undefined || args.file !== undefined;
  if (run === pack) throw new ChartFileError('Name one chart: either a Run report (runId and path) or a Pack file (pack and file).');
  if (args.note !== undefined && args.note.length > chartNoteLimit) throw new ChartFileError(`The note is ${String(args.note.length)} characters; keep it to one line of at most ${String(chartNoteLimit)}.`);
  const note = args.note?.trim() ? { note: args.note.trim() } : {};
  if (run) {
    if (!args.runId || !args.path) throw new ChartFileError('A Run chart needs both runId and path.');
    return { runId: args.runId, path: args.path, ...note };
  }
  if (!args.pack || !args.file) throw new ChartFileError('A Pack chart needs both pack and file.');
  return { pack: args.pack, file: args.file, ...note };
}

/** Bytes that are one `hima-chart/1` chart, or why not, naming the file as `label`. */
export function chartOf(bytes: Uint8Array, label: string): HimaChartAnswer['chart'] {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch {
    throw new ChartFileError(`${label} is not a chart: it is not readable JSON.`);
  }
  const parsed = himaChart.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.length === 0 ? 'the file' : issue.path.join('.')} ${issue.message}`);
    throw new ChartFileError(`${label} is not a valid ${HIMA_CHART_SCHEMA} chart: ${issues.join('; ')}.`);
  }
  return parsed.data;
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A Run report chart. Run access is the caller's to check first (`hima_chart` does it as `hima_context` does). */
async function runChart(reports: RunReports, runId: string, relative: string): Promise<{ readonly bytes: Uint8Array; readonly source: HimaChartSource }> {
  let read;
  try { read = await reports.readChart(runId, relative); } catch (error) {
    if (error instanceof ReportPathError) throw new ChartFileError(error.missing && /^There is no report at /.test(error.message) ? `There is no chart at ${relative} in this Run's reports.` : error.message);
    if (error instanceof RunReferenceError) throw new ChartFileError(`There is no Run ${runId}.`);
    throw new ChartFileError(`The chart ${relative} could not be read from this Run's Site right now.`);
  }
  if (read.truncated) throw new ChartFileError(`${relative} is larger than a chart file may be (${String(reportReadLimit / 1024)} KiB).`);
  return { bytes: read.bytes, source: { kind: 'run', runId, path: relative, sha256: sha256Of(read.bytes) } };
}

/** A chart an installed Pack ships under `knowledge/charts/`. */
function packChart(packsDir: string, packId: string, file: string): { readonly bytes: Uint8Array; readonly source: HimaChartSource } {
  if (!packChartPattern.test(file)) throw new ChartFileError(`"${file}" is not a Pack chart file; a Pack chart is charts/<name>.chart.json in the Pack's knowledge folder.`);
  let pack: Pack;
  try { pack = loadPack(packsDir, packId); } catch (error) {
    if (error instanceof PackNotFoundError) throw new ChartFileError(`The Pack ${packId} is not installed on this computer.`);
    throw new ChartFileError(`The installed Pack ${packId} cannot be read, so its charts cannot be shown.`);
  }
  const bytes = pack.folder.files.get(`knowledge/${file}`);
  if (bytes === undefined) throw new ChartFileError(`The Pack ${packId} has no chart knowledge/${file}.`);
  if (bytes.byteLength > reportReadLimit) throw new ChartFileError(`knowledge/${file} of Pack ${packId} is larger than a chart file may be (${String(reportReadLimit / 1024)} KiB).`);
  return { bytes, source: { kind: 'pack', pack: packId, file, sha256: sha256Of(bytes) } };
}

/** `hima_chart`'s answer: the validated chart, where its bytes came from (with their SHA-256), and the note. */
export async function readChartAnswer(deps: { readonly reports: RunReports; readonly packsDir: string }, request: ChartRequest): Promise<HimaChartAnswer> {
  const found = 'runId' in request ? await runChart(deps.reports, request.runId, request.path) : packChart(deps.packsDir, request.pack, request.file);
  const label = found.source.kind === 'run' ? found.source.path : `knowledge/${found.source.file} of Pack ${found.source.pack}`;
  return { chart: chartOf(found.bytes, label), source: found.source, ...(request.note === undefined ? {} : { note: request.note }) };
}
