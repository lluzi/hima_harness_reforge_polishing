// The observe operation: site → run → permit → channel → reader → ledger. One path, every layer.
import { createHash } from 'node:crypto';
import type { Ledger, ObservationRecord, RefusalRecord, RunRecord, WriterRole } from './ledger.js';
import { loadSite } from './sites.js';
import { channelFor } from './channel.js';
import { decideRead } from './shell.js';
import { declarationOf, readerNamed } from './readers.js';
import { runFor } from './runs.js';

export interface ObserveRequest {
  readonly site: string;
  readonly path: string;
  readonly reader?: string;
  /**
   * An existing Run to append this observation to. Absent, the observation opens a Run of its own —
   * the probe case. Given, a Run spans several observations, which is what a fabric Loop needs
   * before it can read two reports and judge them together (D36).
   */
  readonly run?: string;
  /**
   * The branch of a fork this reading was taken inside, when a fork took it (#29). Carried onto the
   * observation record, because the join judges **each branch's latest observation** and a Run whose
   * branches read two reports in the same instant cannot say which reading was whose from the order
   * they were appended in. A reading taken outside every fork carries none.
   */
  readonly branchId?: string;
}
export type ObserveResult =
  | { readonly kind: 'observed'; readonly run: RunRecord; readonly record: ObservationRecord }
  | { readonly kind: 'refused'; readonly run: RunRecord; readonly record: RefusalRecord };

export interface ObserveDeps { readonly ledger: Ledger; readonly sitesDir: string }

export async function observe(deps: ObserveDeps, req: ObserveRequest): Promise<ObserveResult> {
  const site = loadSite(deps.sitesDir, req.site);
  const run = await runFor(deps.ledger, site, req.run);
  /** Every way this operation declines to read: one recorded refusal, never a silent empty result. */
  const refuse = async (reason: string, writer?: WriterRole): Promise<ObserveResult> => ({
    kind: 'refused',
    run,
    record: await deps.ledger.appendRefusal(run.id, { path: req.path, reason }, writer),
  });
  // One channel for the whole operation: the permit decision resolves the path where the file lives,
  // then the same warm channel reads it.
  const channel = channelFor(site);
  const decision = await decideRead(site, req.path, channel);
  if (!decision.ok) return refuse(decision.reason);
  const reader = readerNamed(req.reader ?? 'raw');
  if (!reader) return refuse(`unknown reader "${req.reader}"`);
  const bytes = await channel.readFile(decision.absPath);
  // The executor's own decision, not the shell's: the permit allowed the read, the reader declined the report.
  if (!reader.accepts(bytes)) {
    return refuse(`reader "${reader.id}" does not accept ${req.path}: not a recognised report for this reader`, 'executor');
  }
  const { values } = reader.read(bytes);
  // An absent key, never an undefined one: a reading taken outside every fork says so by omission.
  const inBranch = req.branchId === undefined ? {} : { branchId: req.branchId };
  const record = await deps.ledger.appendObservation(run.id, {
    ...inBranch,
    path: req.path,
    contentSha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    reader: declarationOf(reader),
    values,
  });
  return { kind: 'observed', run, record };
}
