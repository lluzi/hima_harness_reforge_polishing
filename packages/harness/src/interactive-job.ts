// @hima-seam tools wrapped
// Interactive transport for an existing Hima Job identity. Fabric/Ledger own
// authorization and facts; tmux owns the durable process and transcript.
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

export interface InteractiveChannel {
  readonly siteName: string;
  exec(argv: readonly string[], options?: { readonly stdin?: Uint8Array }): Promise<{ readonly code: number; readonly stdout: Uint8Array; readonly stderr: string }>;
}

/** Structural match for the existing Ledger JobIdentity; Ledger remains its schema authority. */
export interface InteractiveJobIdentity {
  readonly session: string; readonly pid?: number; readonly workspace: string;
  readonly name: string; readonly startedAt: string; readonly wire: string;
}

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const plainId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/);
const protocolToken = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const common = {
  runId: z.string().min(1), executionId: z.string().min(1), nodeId: z.string().min(1),
  toolSessionId: z.string().min(1), requestId: plainId, actor: z.string().min(1),
  ownerEpoch: z.number().int().positive(), controlRevision: z.number().int().nonnegative(),
  callerDigest: sha256, operationDigest: sha256, at: z.string(),
};
const qualification = z.strictObject({
  bindingDigest: sha256,
  adapter: z.strictObject({ id: z.string().min(1), version: z.string().min(1), digest: sha256,
    completionProtocol: z.enum(['versioned-marker', 'none']), allowsMultiline: z.boolean() }),
  environment: z.strictObject({ id: z.string().min(1), digest: sha256 }),
  mutation: z.enum(['qualified', 'unavailable']),
  testOnly: z.boolean(),
});
export type InteractiveQualification = z.infer<typeof qualification>;

const cursor = z.strictObject({ requested: z.number().int().nonnegative(), start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), bytesSha256: sha256,
  gap: z.strictObject({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), reason: z.enum(['window-exceeded', 'transcript-shrank']) }).optional() });
export type InteractiveCursor = z.infer<typeof cursor>;

const openIntentRecord = z.strictObject({ ...common, event: z.literal('open-intent'), jobSession: z.string(), transcriptPath: z.string(),
  exitPath: z.string(), sessionDeadlineAt: z.string() });
const openOutcomeRecord = z.strictObject({ ...common, event: z.enum(['opened', 'open-uncertain']), jobSession: z.string(),
  qualification, readiness: z.enum(['starting', 'ready']).optional(), reason: z.string().optional() });
const openReleasedRecord = z.strictObject({ ...common, event: z.literal('open-released'), jobSession: z.string(), reason: z.string() });
const inputIntentRecord = z.strictObject({ ...common, event: z.literal('input-intent'), commandId: plainId, inputDigest: sha256,
  requestDigest: sha256, protocolToken,
  inputBytes: z.number().int().nonnegative(), submit: z.boolean(), effect: z.enum(['read', 'mutation', 'reply', 'close']),
  replyToCommandId: plainId.optional(), cursorBefore: z.number().int().nonnegative(), commandDeadlineAt: z.string() });
const inputOutcomeRecord = z.strictObject({ ...common, event: z.enum(['input-sent', 'input-uncertain', 'command-completed', 'command-failed']), commandId: plainId,
  inputDigest: sha256, cursorAfter: z.number().int().nonnegative().optional(), reason: z.string().optional() });
const signalRecord = z.strictObject({ ...common, event: z.enum(['signal-intent', 'signal-delivered', 'signal-uncertain']),
  signal: z.literal('interrupt'), reason: z.string().optional() });
const closeRecord = z.strictObject({ ...common, event: z.enum(['close-intent', 'closed', 'close-uncertain']), reason: z.string().optional() });

/** Payload stored under one narrow Ledger interactive record. Existing Job records own process state. */
export const interactiveRecord = z.union([openIntentRecord, openOutcomeRecord, openReleasedRecord, inputIntentRecord, inputOutcomeRecord, signalRecord, closeRecord]);
export type InteractiveRecord = z.infer<typeof interactiveRecord>;
type OpenIntentRecord = z.infer<typeof openIntentRecord>;
type InputIntentRecord = z.infer<typeof inputIntentRecord>;
type SignalRecord = z.infer<typeof signalRecord> & { readonly event: 'signal-intent' };
type CloseRecord = z.infer<typeof closeRecord> & { readonly event: 'close-intent' };

export const parseInteractiveRecord = (value: unknown): InteractiveRecord => interactiveRecord.parse(value);

export type InteractiveIntent =
  | { readonly action: 'open'; readonly record: OpenIntentRecord }
  | { readonly action: 'input'; readonly record: InputIntentRecord }
  | { readonly action: 'signal'; readonly record: SignalRecord }
  | { readonly action: 'close'; readonly record: CloseRecord };

export type InteractiveReceipt =
  | InteractiveOpenResult | InteractiveInputResult | InteractiveSignalResult | InteractiveCloseResult;

export interface InteractiveAuthority {
  /** Existing Fabric lock re-reads owner/epoch/hold/budget, appends this intent, and returns qualification from approved Site/Pack facts. */
  admit(intent: InteractiveIntent): Promise<
    | { readonly kind: 'reserved'; readonly reservationId: string; readonly qualification: InteractiveQualification }
    | { readonly kind: 'duplicate'; readonly receipt: InteractiveReceipt }
    | { readonly kind: 'refused'; readonly reason: string }>;
  /** Required immediately before each native tmux mutation, after all preparatory awaits. */
  authorizeBeforeDispatch(input: { readonly reservationId: string; readonly operationDigest: string }): Promise<
    | { readonly kind: 'authorized'; readonly qualification: InteractiveQualification }
    | { readonly kind: 'refused'; readonly reason: string }>;
  /** Append only a value already parsed by interactiveRecord. */
  record(record: InteractiveRecord): Promise<void>;
  /** Append the ordinary existing Job launched fact before the tool process is started. */
  recordJobLaunch(job: InteractiveJobIdentity): Promise<void>;
  /** Append the ordinary existing Job killed fact only after a live session is observed gone. */
  recordJobStop(job: InteractiveJobIdentity, outcome: { readonly wasRunning: boolean; readonly observedGone: boolean }): Promise<void>;
}

export interface InteractiveAddress {
  readonly runId: string; readonly executionId: string; readonly nodeId: string;
  readonly requestId: string; readonly actor: string; readonly ownerEpoch: number; readonly controlRevision: number;
}

export interface InteractiveSession {
  readonly job: InteractiveJobIdentity;
  readonly toolSessionId: string;
  readonly transcriptPath: string;
  readonly exitPath: string;
  readonly qualification: InteractiveQualification;
  readonly sessionDeadlineAt: string;
}

export type InteractiveOpenResult =
  | { readonly status: 'opened' | 'duplicate'; readonly session: InteractiveSession; readonly readiness: 'starting' | 'ready' }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'uncertain'; readonly session?: InteractiveSession; readonly reason: string };

export interface OpenInteractiveRequest extends InteractiveAddress {
  readonly callerDigest: string;
  readonly siteName: string; readonly workspace: string; readonly argv: readonly string[];
  readonly name: string; readonly sessionDeadlineAt: string; readonly startupWaitMs: number;
}

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = (): string => new Date().toISOString();
const bufferName = (commandId: string): string => `hima-${createHash('sha256').update(commandId).digest('hex').slice(0, 24)}`;
const quote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;
const exactJobSession = (session: string): string => `=${session}`;
// A Site may set tmux base-index/pane-base-index to non-zero values. Commands that target a pane
// can name the exact session alone; tmux then resolves that session's active pane without assuming
// the administrator's window numbering policy.
const jobPane = (session: string): string => `${exactJobSession(session)}:`;
const jobLogPath = (job: Pick<InteractiveJobIdentity, 'workspace' | 'session'>): string => path.posix.join(job.workspace, `${job.session}.log`);
const jobExitPath = (job: Pick<InteractiveJobIdentity, 'workspace' | 'session'>): string => path.posix.join(job.workspace, `${job.session}.exit`);
const safeJobName = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'job';
async function mustRun(on: InteractiveChannel, argv: readonly string[], what: string, options?: { readonly stdin?: Uint8Array }): Promise<string> {
  const answer = await on.exec(argv, options);
  if (answer.code !== 0) throw new Error(`cannot ${what}: ${argv[0] ?? 'command'} exited ${String(answer.code)}${answer.stderr.trim() ? `: ${answer.stderr.trim()}` : ''}`);
  return Buffer.from(answer.stdout).toString('utf8');
}
async function allocateInteractiveJobSession(on: InteractiveChannel, runId: string, requestedName: string): Promise<{ session: string; name: string }> {
  const name = safeJobName(requestedName); const run = runId.replace(/^run-/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = `hima-${run}-${name}-${randomBytes(3).toString('hex')}`;
    if (!await interactiveSessionThere(on, session, true)) return { session, name };
  }
  throw new Error(`no free tmux session name for interactive job "${name}" of ${runId}`);
}
async function interactiveSessionThere(on: InteractiveChannel, session: string, missingSocketIsAbsent = false): Promise<boolean> {
  const probe = await on.exec(['tmux', 'has-session', '-t', exactJobSession(session)]);
  if (probe.code === 0) return true;
  const said = probe.stderr.trim();
  const absent = said.includes("can't find session") || said.includes('session not found') || said.includes('no server running on');
  const noSocket = said.includes('error connecting to') && said.includes('(No such file or directory)');
  if (probe.code === 1 && (absent || missingSocketIsAbsent && noSocket)) return false;
  throw new Error(`cannot tell whether interactive tmux session ${session} exists: tmux exited ${String(probe.code)}${said ? `: ${said}` : ''}`);
}
const recordBase = (request: InteractiveAddress & { readonly callerDigest: string }, toolSessionId: string, operationDigest: string) => ({
  runId: request.runId, executionId: request.executionId, nodeId: request.nodeId,
  requestId: request.requestId, actor: request.actor, ownerEpoch: request.ownerEpoch,
  controlRevision: request.controlRevision, toolSessionId, callerDigest: request.callerDigest, operationDigest, at: now(),
});

function sameQualification(a: InteractiveQualification, b: InteractiveQualification): boolean {
  return a.bindingDigest === b.bindingDigest && JSON.stringify(a) === JSON.stringify(b);
}

function assertQualificationStable(admitted: InteractiveQualification, dispatch: InteractiveQualification): void {
  if (!sameQualification(admitted, dispatch)) throw new Error('interactive qualification changed between admission and dispatch');
}

async function paste(on: InteractiveChannel, session: string, commandId: string, bytes: Uint8Array, submit: boolean,
  authorize: () => Promise<void>): Promise<void> {
  const buffer = bufferName(commandId);
  await mustRun(on, ['tmux', 'load-buffer', '-b', buffer, '-'], `stage input for interactive session ${session}`, { stdin: bytes });
  await authorize();
  await mustRun(on, ['tmux', 'paste-buffer', '-d', '-b', buffer, '-t', jobPane(session)], `paste input into interactive session ${session}`);
  if (submit) { await authorize(); await mustRun(on, ['tmux', 'send-keys', '-t', jobPane(session), 'Enter'], `submit input to interactive session ${session}`); }
}

export async function openInteractiveJob(on: InteractiveChannel, request: OpenInteractiveRequest, authority: InteractiveAuthority): Promise<InteractiveOpenResult> {
  if (request.argv.length === 0 || request.argv.some((word) => word.includes('\0'))) return { status: 'refused', reason: 'interactive Job argv must contain non-NUL words' };
  if (!Number.isSafeInteger(request.startupWaitMs) || request.startupWaitMs < 0 || request.startupWaitMs > 60_000) return { status: 'refused', reason: 'startupWaitMs must be 0..60000' };
  const allocated = await allocateInteractiveJobSession(on, request.runId, request.name);
  const transcriptPath = jobLogPath({ workspace: request.workspace, session: allocated.session });
  const exitPath = jobExitPath({ workspace: request.workspace, session: allocated.session });
  const toolStartup = `${request.argv.map(quote).join(' ')}; hima_status=$?; printf '%s\\n' "$hima_status" > ${quote(exitPath)}; exit "$hima_status"`;
  // Replace tmux's interactive shell with a non-interactive process-group leader. Otherwise shell
  // job control moves the wrapper into a child foreground group and killing the tmux pane can leave
  // a licensed vendor process orphaned outside the recorded Job session.
  const startup = `exec /bin/sh -c ${quote(toolStartup)}`;
  const operationDigest = digest({ ...request, session: allocated.session, transcriptPath, exitPath, startup });
  const openIntent = parseInteractiveRecord({ ...recordBase(request, allocated.session, operationDigest), event: 'open-intent',
    jobSession: allocated.session, transcriptPath, exitPath, sessionDeadlineAt: request.sessionDeadlineAt }) as OpenIntentRecord;
  const admitted = await authority.admit({ action: 'open', record: openIntent });
  if (admitted.kind === 'refused') return { status: 'refused', reason: admitted.reason };
  if (admitted.kind === 'duplicate') return admitted.receipt as InteractiveOpenResult;
  const authorized = await authority.authorizeBeforeDispatch({ reservationId: admitted.reservationId, operationDigest });
  if (authorized.kind === 'refused') return { status: 'refused', reason: authorized.reason };
  try { assertQualificationStable(admitted.qualification, authorized.qualification); }
  catch (error) { return { status: 'refused', reason: (error as Error).message }; }
  let job: InteractiveJobIdentity | undefined;
  try {
    const printed = await mustRun(on, ['tmux', 'new-session', '-d', '-P', '-F', '#{pane_pid}', '-s', allocated.session,
      '-c', request.workspace, '/bin/sh'], `open interactive job ${allocated.name} in ${request.workspace}`);
    const pid = Number(printed.trim());
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`tmux reported ${JSON.stringify(printed.trim())} instead of a pane pid`);
    job = { session: allocated.session, pid, workspace: request.workspace, name: allocated.name, startedAt: now(), wire: startup };
    await authority.recordJobLaunch(job);
    await mustRun(on, ['tmux', 'pipe-pane', '-o', '-t', jobPane(allocated.session), `cat >> ${quote(transcriptPath)}`],
      `attach the durable transcript for interactive session ${allocated.session}`);
    // Recheck after creating the inert shell and transcript but immediately before starting the tool.
    const startAuthorized = await authority.authorizeBeforeDispatch({ reservationId: admitted.reservationId, operationDigest });
    if (startAuthorized.kind === 'refused') throw new Error(`interactive tool start lost authority: ${startAuthorized.reason}`);
    assertQualificationStable(admitted.qualification, startAuthorized.qualification);
    const authorizeStart = async (): Promise<void> => {
      const latest = await authority.authorizeBeforeDispatch({ reservationId: admitted.reservationId, operationDigest });
      if (latest.kind === 'refused') throw new Error(`interactive tool start lost authority: ${latest.reason}`);
      assertQualificationStable(admitted.qualification, latest.qualification);
    };
    await paste(on, allocated.session, `open-${request.requestId}`, Buffer.from(startup, 'utf8'), true, authorizeStart);
    const session: InteractiveSession = { job, toolSessionId: allocated.session, transcriptPath, exitPath,
      qualification: admitted.qualification, sessionDeadlineAt: request.sessionDeadlineAt };
    const readyMarker = `HIMA:${admitted.qualification.adapter.id}:${admitted.qualification.adapter.version}:READY`;
    const readyDeadline = Date.now() + request.startupWaitMs;
    let readiness: 'starting' | 'ready' = 'starting';
    do {
      const transcript = await readInteractiveTranscript(on, session);
      if (hasMarker(transcript.text, readyMarker)) { readiness = 'ready'; break; }
      if (Date.now() >= readyDeadline) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, readyDeadline - Date.now()))));
    } while (readiness === 'starting');
    await authority.record(parseInteractiveRecord({ ...recordBase(request, allocated.session, operationDigest),
      event: 'opened', jobSession: allocated.session, qualification: admitted.qualification, readiness }));
    return { status: 'opened', session, readiness };
  } catch (error) {
    let reason = error instanceof Error ? error.message : String(error);
    let sessionStillAlive = false;
    if (job !== undefined) {
      try {
        const wasRunning = await interactiveSessionThere(on, job.session, true);
        if (wasRunning) {
          const stopped = await on.exec(['tmux', 'kill-session', '-t', exactJobSession(job.session)]);
          if (stopped.code !== 0) reason += `; cleanup kill exited ${String(stopped.code)}${stopped.stderr.trim() ? `: ${stopped.stderr.trim()}` : ''}`;
        }
        sessionStillAlive = await interactiveSessionThere(on, job.session, true);
        await authority.recordJobStop(job, { wasRunning, observedGone: !sessionStillAlive });
      } catch (cleanupError) {
        sessionStillAlive = true;
        reason += `; cleanup outcome is uncertain: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
    }
    await authority.record(parseInteractiveRecord({ ...recordBase(request, allocated.session, operationDigest),
      event: 'open-uncertain', jobSession: allocated.session, qualification: admitted.qualification, reason }));
    return { status: 'uncertain', ...(job === undefined || !sessionStillAlive ? {} : { session: { job, toolSessionId: allocated.session,
      transcriptPath, exitPath, qualification: admitted.qualification, sessionDeadlineAt: request.sessionDeadlineAt } }), reason };
  }
}

export interface TranscriptRead {
  readonly cursor: InteractiveCursor;
  readonly bytesBase64: string;
  readonly text: string;
  readonly utf8: 'complete' | 'partial';
}

export async function readInteractiveTranscript(on: InteractiveChannel, session: InteractiveSession, requested = 0, maxBytes = 64 * 1024): Promise<TranscriptRead> {
  if (!Number.isSafeInteger(requested) || requested < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) {
    throw new Error('interactive transcript cursor/maxBytes is invalid');
  }
  const sizeText = await mustRun(on, ['wc', '-c', '--', session.transcriptPath], `measure interactive transcript ${session.transcriptPath}`);
  const total = Number(/^\s*(\d+)/.exec(sizeText)?.[1]);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error(`wc returned no valid transcript size: ${JSON.stringify(sizeText)}`);
  const take = Math.min(total, maxBytes);
  let tail = Buffer.alloc(0);
  if (take > 0) {
    const tailed = await on.exec(['tail', '-c', String(take), '--', session.transcriptPath]);
    if (tailed.code !== 0) throw new Error(`cannot read interactive transcript tail: tail exited ${String(tailed.code)}${tailed.stderr.trim() ? `: ${tailed.stderr.trim()}` : ''}`);
    tail = Buffer.from(tailed.stdout);
  }
  const availableStart = total - tail.byteLength;
  const shrank = requested > total;
  const start = shrank ? availableStart : Math.max(requested, availableStart);
  const bytes = tail.subarray(start - availableStart);
  const text = bytes.toString('utf8');
  const utf8 = Buffer.from(text, 'utf8').equals(bytes) ? 'complete' : 'partial';
  const gap = shrank ? { from: total, to: requested, reason: 'transcript-shrank' as const }
    : requested < availableStart ? { from: requested, to: availableStart, reason: 'window-exceeded' as const } : undefined;
  return { cursor: cursor.parse({ requested, start, end: total, bytes: bytes.byteLength,
    bytesSha256: createHash('sha256').update(bytes).digest('hex'), ...(gap === undefined ? {} : { gap }) }),
    bytesBase64: bytes.toString('base64'), text, utf8 };
}

export interface SendInteractiveRequest extends InteractiveAddress {
  readonly callerDigest: string;
  readonly session: InteractiveSession; readonly commandId: string; readonly text: string; readonly submit: boolean;
  /** Host-minted unpredictable capability persisted before dispatch; never accepted from a model-facing request. */
  readonly protocolToken: string;
  /** Stable digest of the typed caller intent before the Host adds protocolToken. */
  readonly requestDigest: string;
  readonly effect: 'read' | 'mutation' | 'reply' | 'close'; readonly replyToCommandId?: string;
  readonly cursorBefore: number; readonly waitMs: number; readonly commandDeadlineAt: string;
}

export type InteractiveInputResult =
  | { readonly status: 'sent' | 'completed' | 'failed'; readonly commandId: string; readonly inputDigest: string;
      readonly transcript: TranscriptRead; readonly acknowledged: boolean }
  | { readonly status: 'duplicate'; readonly commandId: string; readonly inputDigest: string;
      readonly outcome?: 'sent' | 'completed' | 'failed' | 'outcome-unknown'; readonly cursorAfter?: number }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'outcome-unknown'; readonly commandId: string; readonly inputDigest: string; readonly reason: string };

function inputBytes(request: SendInteractiveRequest): Uint8Array {
  const bytes = Buffer.from(request.text, 'utf8');
  for (const byte of bytes) {
    if (byte === 0x1b || byte < 0x09 || byte === 0x0b || byte === 0x0c || (byte > 0x0d && byte < 0x20) || byte === 0x7f) {
      throw new Error('normal interactive input may not contain terminal escape/control bytes; use signal/close');
    }
  }
  if (!request.session.qualification.adapter.allowsMultiline && /[\r\n]/.test(request.text)) throw new Error('this qualified adapter accepts one logical line per input');
  return bytes;
}

export const interactiveCommandMarker = (token: string, kind: 'ACK' | 'DONE' | 'FAIL'): string => `HIMA:${token}:${kind}`;

const hasMarker = (text: string, marker: string): boolean =>
  text.split(/\r?\n/).some((line) => line.trimEnd() === marker);

export async function waitForInteractiveCommand(on: InteractiveChannel, request: Pick<SendInteractiveRequest, 'session' | 'commandId' | 'protocolToken' | 'cursorBefore' | 'waitMs'>): Promise<{ transcript: TranscriptRead; acknowledged: boolean; completed: boolean; failed: boolean }> {
  if (!Number.isSafeInteger(request.waitMs) || request.waitMs < 0 || request.waitMs > 60_000) throw new Error('waitMs must be 0..60000');
  const deadline = Date.now() + request.waitMs;
  const markerCursor = Math.max(0, request.cursorBefore - 256);
  let markerView = await readInteractiveTranscript(on, request.session, markerCursor, 64 * 1024 + 256);
  for (;;) {
    // A pipe writer can commit the first bytes of one marker between the size sample and the next
    // tail. Search a bounded overlap for this command's unique marker while returning only bytes at
    // the caller's cursor.
    const completed = request.session.qualification.adapter.completionProtocol === 'versioned-marker'
      && hasMarker(markerView.text, interactiveCommandMarker(request.protocolToken, 'DONE'));
    const failed = request.session.qualification.adapter.completionProtocol === 'versioned-marker'
      && hasMarker(markerView.text, interactiveCommandMarker(request.protocolToken, 'FAIL'));
    const acknowledged = completed || failed || hasMarker(markerView.text, interactiveCommandMarker(request.protocolToken, 'ACK'));
    if (completed || failed || Date.now() >= deadline) return { transcript: await readInteractiveTranscript(on, request.session, request.cursorBefore), acknowledged, completed, failed };
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(1, deadline - Date.now()))));
    markerView = await readInteractiveTranscript(on, request.session, markerCursor, 64 * 1024 + 256);
  }
}

export async function sendInteractiveInput(on: InteractiveChannel, request: SendInteractiveRequest, authority: InteractiveAuthority): Promise<InteractiveInputResult> {
  let bytes: Uint8Array;
  try { bytes = inputBytes(request); } catch (error) { return { status: 'refused', reason: (error as Error).message }; }
  if (request.effect === 'mutation' && request.session.qualification.mutation !== 'qualified') {
    return { status: 'refused', reason: 'mutation is unavailable: no exact approved adapter/environment binding qualifies this session' };
  }
  if (request.replyToCommandId !== undefined && request.effect !== 'reply') return { status: 'refused', reason: 'replyToCommandId requires reply effect' };
  const inputDigest = digest({ bytes: Buffer.from(bytes).toString('base64'), submit: request.submit,
    effect: request.effect, replyToCommandId: request.replyToCommandId, protocolToken: request.protocolToken });
  const operationDigest = digest({ session: request.session.toolSessionId, commandId: request.commandId, inputDigest });
  const record = parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest),
    event: 'input-intent', commandId: request.commandId, inputDigest, inputBytes: bytes.byteLength,
    requestDigest: request.requestDigest, protocolToken: request.protocolToken,
    submit: request.submit, effect: request.effect, ...(request.replyToCommandId === undefined ? {} : { replyToCommandId: request.replyToCommandId }),
    cursorBefore: request.cursorBefore, commandDeadlineAt: request.commandDeadlineAt }) as InputIntentRecord;
  const admitted = await authority.admit({ action: 'input', record });
  if (admitted.kind === 'refused') return { status: 'refused', reason: admitted.reason };
  if (admitted.kind === 'duplicate') return admitted.receipt as InteractiveInputResult;
  try { assertQualificationStable(request.session.qualification, admitted.qualification); }
  catch (error) { return { status: 'refused', reason: (error as Error).message }; }
  // Re-anchor after durable admission so startup/prior-command bytes that arrived while the lock
  // was being acquired cannot split this command's ACK marker. Authorization is re-read again in
  // `paste` after its buffer-staging await and immediately before bytes enter the pane.
  let dispatchCursor: number;
  try { dispatchCursor = (await readInteractiveTranscript(on, request.session, request.cursorBefore)).cursor.end; }
  catch (error) { return { status: 'outcome-unknown', commandId: request.commandId, inputDigest,
    reason: `cannot establish the pre-dispatch transcript cursor: ${error instanceof Error ? error.message : String(error)}` }; }
  const authorizeSend = async (): Promise<void> => {
    const latest = await authority.authorizeBeforeDispatch({ reservationId: admitted.reservationId, operationDigest });
    if (latest.kind === 'refused') throw new Error(`interactive input lost authority before dispatch: ${latest.reason}`);
    assertQualificationStable(admitted.qualification, latest.qualification);
  };
  try { await paste(on, request.session.toolSessionId, request.commandId, bytes, request.submit, authorizeSend); }
  catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest),
      event: 'input-uncertain', commandId: request.commandId, inputDigest, reason }));
    return { status: 'outcome-unknown', commandId: request.commandId, inputDigest, reason };
  }
  await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest),
    event: 'input-sent', commandId: request.commandId, inputDigest }));
  const observed = await waitForInteractiveCommand(on, { ...request, cursorBefore: dispatchCursor });
  if (observed.completed || observed.failed) await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest),
    event: observed.failed ? 'command-failed' : 'command-completed', commandId: request.commandId, inputDigest, cursorAfter: observed.transcript.cursor.end }));
  return { status: observed.failed ? 'failed' : observed.completed ? 'completed' : 'sent', commandId: request.commandId, inputDigest,
    transcript: observed.transcript, acknowledged: observed.acknowledged };
}

/** Reconcile one already-sent command without sending bytes again. */
export async function observeInteractiveCommand(on: InteractiveChannel, request: SendInteractiveRequest, authority: InteractiveAuthority): Promise<InteractiveInputResult> {
  let bytes: Uint8Array;
  try { bytes = inputBytes(request); } catch (error) { return { status: 'refused', reason: (error as Error).message }; }
  const inputDigest = digest({ bytes: Buffer.from(bytes).toString('base64'), submit: request.submit,
    effect: request.effect, replyToCommandId: request.replyToCommandId, protocolToken: request.protocolToken });
  const operationDigest = digest({ session: request.session.toolSessionId, commandId: request.commandId, inputDigest });
  const observed = await waitForInteractiveCommand(on, request);
  if (observed.completed || observed.failed) await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest),
    event: observed.failed ? 'command-failed' : 'command-completed', commandId: request.commandId, inputDigest, cursorAfter: observed.transcript.cursor.end }));
  return { status: observed.failed ? 'failed' : observed.completed ? 'completed' : 'sent', commandId: request.commandId, inputDigest,
    transcript: observed.transcript, acknowledged: observed.acknowledged };
}

export interface ObserveInteractiveRequest extends InteractiveAddress {
  readonly callerDigest: string;
  readonly session: InteractiveSession; readonly commandId: string; readonly protocolToken: string;
  readonly inputDigest: string; readonly operationDigest: string; readonly cursorBefore: number; readonly waitMs: number;
}

/** Restart-safe observation from the durable intent; it has no input bytes and therefore cannot resend. */
export async function observeInteractiveToken(on: InteractiveChannel, request: ObserveInteractiveRequest, authority: InteractiveAuthority): Promise<InteractiveInputResult> {
  const observed = await waitForInteractiveCommand(on, request);
  if (observed.completed || observed.failed) await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, request.operationDigest),
    event: observed.failed ? 'command-failed' : 'command-completed', commandId: request.commandId, inputDigest: request.inputDigest, cursorAfter: observed.transcript.cursor.end }));
  return { status: observed.failed ? 'failed' : observed.completed ? 'completed' : 'sent', commandId: request.commandId, inputDigest: request.inputDigest,
    transcript: observed.transcript, acknowledged: observed.acknowledged };
}

export type InteractiveSignalResult =
  | { readonly status: 'delivered' | 'duplicate'; readonly process: 'running-or-exited' }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'uncertain'; readonly reason: string };

export async function signalInteractiveJob(on: InteractiveChannel, request: InteractiveAddress & { readonly callerDigest: string; readonly session: InteractiveSession; readonly signal: 'interrupt' }, authority: InteractiveAuthority): Promise<InteractiveSignalResult> {
  const operationDigest = digest({ session: request.session.toolSessionId, signal: request.signal });
  const record = parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest),
    event: 'signal-intent', signal: request.signal }) as SignalRecord;
  const admitted = await authority.admit({ action: 'signal', record });
  if (admitted.kind === 'refused') return { status: 'refused', reason: admitted.reason };
  if (admitted.kind === 'duplicate') return admitted.receipt as InteractiveSignalResult;
  const authorized = await authority.authorizeBeforeDispatch({ reservationId: admitted.reservationId, operationDigest });
  if (authorized.kind === 'refused') return { status: 'refused', reason: authorized.reason };
  try {
    assertQualificationStable(request.session.qualification, admitted.qualification);
    assertQualificationStable(admitted.qualification, authorized.qualification);
    await mustRun(on, ['tmux', 'send-keys', '-t', jobPane(request.session.toolSessionId), 'C-c'], `interrupt interactive session ${request.session.toolSessionId}`);
    await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest), event: 'signal-delivered', signal: request.signal }));
    return { status: 'delivered', process: 'running-or-exited' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest), event: 'signal-uncertain', signal: request.signal, reason }));
    return { status: 'uncertain', reason };
  }
}

export type InteractiveCloseResult =
  | { readonly status: 'closed' | 'duplicate'; readonly process: 'exited' }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'uncertain'; readonly reason: string };

/** Force-close transport only. Adapter save/exit is a separately recorded typed input. */
export async function closeInteractiveJob(on: InteractiveChannel, request: InteractiveAddress & { readonly callerDigest: string; readonly session: InteractiveSession }, authority: InteractiveAuthority): Promise<InteractiveCloseResult> {
  const operationDigest = digest({ session: request.session.toolSessionId, close: true });
  const record = parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest), event: 'close-intent' }) as CloseRecord;
  const admitted = await authority.admit({ action: 'close', record });
  if (admitted.kind === 'refused') return { status: 'refused', reason: admitted.reason };
  if (admitted.kind === 'duplicate') return admitted.receipt as InteractiveCloseResult;
  const authorized = await authority.authorizeBeforeDispatch({ reservationId: admitted.reservationId, operationDigest });
  if (authorized.kind === 'refused') return { status: 'refused', reason: authorized.reason };
  try {
    assertQualificationStable(request.session.qualification, admitted.qualification);
    assertQualificationStable(admitted.qualification, authorized.qualification);
    const wasRunning = await interactiveSessionThere(on, request.session.toolSessionId);
    const killed = wasRunning ? await on.exec(['tmux', 'kill-session', '-t', exactJobSession(request.session.toolSessionId)]) : undefined;
    if (killed !== undefined && killed.code !== 0 && killed.code !== 1) throw new Error(`tmux kill-session exited ${String(killed.code)}: ${killed.stderr}`);
    const observedGone = !await interactiveSessionThere(on, request.session.toolSessionId);
    if (!observedGone) throw new Error('interactive tmux session remained after close request');
    await authority.recordJobStop(request.session.job, { wasRunning, observedGone });
    await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest), event: 'closed' }));
    return { status: 'closed', process: 'exited' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await authority.record(parseInteractiveRecord({ ...recordBase(request, request.session.toolSessionId, operationDigest), event: 'close-uncertain', reason }));
    return { status: 'uncertain', reason };
  }
}
