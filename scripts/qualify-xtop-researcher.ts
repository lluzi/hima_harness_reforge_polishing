// @hima-seam agent wrapped
// @hima-seam tools direct
// One isolated L4 check of the Pack-declared Researcher response contract.  It reads a copy of
// the parked r6 child session and never opens, resumes, cancels, or writes that historical Run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installPackMethod, loadPack, packDigestExcludes } from '@hima/harness';
import { bootInProcess, createTestAgentWithModel, resumeTestAgent, saidByModel, sayAsUser, toolCalls, toolResults } from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';

const PACK_ID = 'xtop-timing-closure';
const RETAINED_RUN = 'run-08161316-d1c4-4214-9ced-c35ab5bb5689';
const RETAINED_CHILD = 'hima-child-c68d49a2a3ec2b2f5c3dc4c16bfd454d';
const RETAINED_HOME = '/private/tmp/hima-l4-ic8Tpi/hima-home-0dXckX';
const EXPECTED_INPUTS = new Set(['closureState', 'closureExperience']);
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

const args = process.argv.slice(2);
const inspectOnly = args.includes('--inspect-only');
if (inspectOnly) args.splice(args.indexOf('--inspect-only'), 1);
const take = (flag: string): string => {
  const at = args.indexOf(flag); const value = at < 0 ? undefined : args[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing ${flag}`);
  args.splice(at, 2); return value;
};
const out = path.resolve(take('--out'));
if (args.length !== 0) throw new Error('usage: node scripts/qualify-xtop-researcher.ts --out <fresh-directory>');
if (existsSync(out)) throw new Error(`evidence directory already exists: ${out}`);
if (!existsSync(RETAINED_HOME)) throw new Error(`retained r6 Home is unavailable: ${RETAINED_HOME}`);
mkdirSync(out, { recursive: true });

type RetainedInput = {
  readonly name: string;
  readonly recordId: string;
  readonly contentSha256: string;
  readonly declaredBytes: number;
  readonly renderedText: string;
  readonly adjacentOmissionCharacters: number;
  readonly renderedTruncated: boolean;
  readonly transcriptInput: { readonly runId: string; readonly recordId: string };
};
type Receipt = Record<string, unknown>;
const receipt: Receipt = { check: 'qualify-xtop-researcher', startedAt: now(), retained: {
  home: RETAINED_HOME, runId: RETAINED_RUN, childSessionId: RETAINED_CHILD,
  access: 'copied-session-read-only; the original Home is never booted or mutated',
} };
const writeReceipt = () => writeFileSync(path.join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
const secret = process.env.DEEPSEEK_API_KEY;
const redact = (value: string) => secret ? value.split(secret).join('[REDACTED]') : value;

/** DSH may render one tool payload plus an adjacent display block.  Decode only the first JSON value. */
const firstJsonObject = (text: string): { readonly value: Record<string, unknown>; readonly raw: string; readonly trailingCharacters: number } => {
  const start = text.indexOf('{'); if (start < 0) throw new Error('retained tool result contains no JSON object');
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{') depth += 1;
    if (char === '}') { depth -= 1; if (depth === 0) { const raw = text.slice(start, index + 1); return { value: JSON.parse(raw) as Record<string, unknown>, raw, trailingCharacters: text.length - index - 1 }; } }
  }
  throw new Error('retained tool result has no closed JSON object');
};

/** Use a disposable clone: DSH reads its own durable session API while the parked Home stays inert. */
const retainedCopy = mkdtempSync(path.join(out, 'retained-home-copy-'));
cpSync(RETAINED_HOME, retainedCopy, { recursive: true, dereference: false });
const copiedHome: HimaHome = {
  home: retainedCopy,
  profileDir: path.join(retainedCopy, 'profiles/hima'),
  workspace: path.join(retainedCopy, 'workspace'),
  env: { ...process.env, DSH_HOME: retainedCopy, DSH_AGENTS_HOME: path.join(retainedCopy, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
  dispose: async () => rmSync(retainedCopy, { recursive: true, force: true }),
};

const readRetainedInputs = async (): Promise<readonly RetainedInput[]> => {
  const host = await bootInProcess(copiedHome);
  try {
    const resumed = await resumeTestAgent(host.ctx, RETAINED_CHILD);
    try {
      const calls = toolCalls(resumed.agent);
      const results = toolResults(resumed.agent);
      assert.equal(calls.length, results.length, 'native retained tool calls/results are not pairable');
      const inputs: RetainedInput[] = [];
      for (let index = 0; index < calls.length; index += 1) {
        if (calls[index]!.name !== 'hima_delegation_input') continue;
        const request = calls[index]!.args;
        assert.equal(request.runId, RETAINED_RUN, 'retained input was read from another Run');
        assert.equal(typeof request.recordId, 'string', 'retained input call has no record identity');
        const decoded = firstJsonObject(results[index]!.text);
        const response = decoded.value;
        assert.equal(response.kind, 'record-fact', `retained input ${String(request.recordId)} is not an observation fact`);
        assert.equal(response.runId, RETAINED_RUN, 'retained input response names another Run');
        assert.equal(response.recordId, request.recordId, 'retained input response identity changed');
        const payload = response.payload as Record<string, unknown>;
        assert.ok(payload && typeof payload === 'object', 'retained observation has no payload');
        assert.equal(typeof payload.contentSha256, 'string', 'retained observation has no content SHA-256');
        assert.match(String(payload.contentSha256), /^[0-9a-f]{64}$/);
        assert.equal(typeof payload.bytes, 'number', 'retained observation has no byte count');
        const reader = payload.reader as Record<string, unknown>;
        assert.ok(reader && typeof reader === 'object' && typeof reader.id === 'string', 'retained observation has no reader identity');
        const name = reader.id === 'xtop-closure-state' ? 'closureState' : reader.id === 'xtop-closure-experience' ? 'closureExperience' : undefined;
        assert.ok(name, `retained reader ${String(reader.id)} is not a declared Researcher input`);
        const material = payload.material as Record<string, unknown> | undefined;
        const record = host.ctx.hima.ledger.record(String(request.recordId));
        assert.equal(record?.type, 'observation', 'retained input ledger record is unavailable');
        assert.equal(record.contentSha256, payload.contentSha256, 'retained transcript content SHA-256 differs from immutable ledger record');
        assert.equal(record.bytes, payload.bytes, 'retained transcript byte count differs from immutable ledger record');
        inputs.push({ name, recordId: String(request.recordId), contentSha256: String(payload.contentSha256),
          declaredBytes: Number(payload.bytes), renderedText: decoded.raw, adjacentOmissionCharacters: decoded.trailingCharacters,
          renderedTruncated: material?.truncated === true,
          transcriptInput: { runId: String(request.runId), recordId: String(request.recordId) } });
      }
      assert.equal(inputs.length, 2, 'retained Researcher did not record exactly two input reads');
      assert.deepEqual(new Set(inputs.map(input => input.name)), EXPECTED_INPUTS,
        'retained reader responses cannot be identified as one closureState and one closureExperience');
      return inputs;
    } finally { /* Host disposal releases this read-only resumed handle. */ }
  } finally { await host.dispose(); }
};

const parseCandidate = (text: string) => {
  const parsed = JSON.parse(text) as unknown;
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'candidate is not one JSON object');
  const candidate = parsed as Record<string, unknown>;
  assert.deepEqual(Object.keys(candidate).sort(), ['evidenceRefs', 'hypotheses', 'limitations', 'schema']);
  assert.equal(candidate.schema, 'xtop-timing-research/1');
  for (const key of ['hypotheses', 'evidenceRefs', 'limitations']) assert.ok(Array.isArray(candidate[key]), `${key} must be an array`);
  assert.ok((candidate.hypotheses as unknown[]).length <= 3, 'candidate has more than three hypotheses');
  assert.ok(text.length <= 2000, 'candidate exceeds the Pack compact-output limit');
  return candidate;
};

try {
  const inputs = await readRetainedInputs();
  receipt.retainedInputs = inputs.map(input => ({ name: input.name, recordId: input.recordId, contentSha256: input.contentSha256,
    bytes: input.declaredBytes, renderedCharacters: input.renderedText.length, adjacentOmissionCharacters: input.adjacentOmissionCharacters,
    renderedTextSha256: sha256(input.renderedText),
    renderedTruncated: input.renderedTruncated, transcriptInput: input.transcriptInput }));
  // The input reader's stored identity is verified above, but a native transcript can still omit
  // presentation bytes.  The qualification deliberately carries that boundary into the candidate.
  receipt.inputVisibility = 'ledger observation content SHA-256 and byte counts match the retained tool results; rendered text is not claimed complete or byte-identical to the source material.';

  if (inspectOnly) {
    receipt.verdict = 'INSPECTED'; receipt.finishedAt = now(); writeReceipt();
    process.stdout.write(`${JSON.stringify({ verdict: receipt.verdict, evidence: out, inputs: receipt.retainedInputs }, null, 2)}\n`);
    process.exitCode = 0;
  } else {

  const sourcePack = loadPack(path.join(repoRoot, 'packs'), PACK_ID);
  const sourceDigest = sourcePack.folder.digest(packDigestExcludes);
  const researcher = sourcePack.contract.agentTeams.find(team => team.id === 'timing-eco-team')?.members.find(member => member.id === 'researcher');
  assert.ok(researcher, 'current Pack has no timing-eco-team Researcher');
  assert.equal(researcher.budgetShare.maxTokensPerTurn, 5000, 'Researcher Pack budget is not 5000 tokens');
  receipt.pack = { id: PACK_ID, version: sourcePack.contract.version, digest: sourceDigest,
    taskTemplateSha256: sha256(researcher.taskTemplate), taskTemplateCharacters: researcher.taskTemplate.length,
    effectiveMaxTokensPerTurn: researcher.budgetShare.maxTokensPerTurn };

  const qualificationHome = await createHimaHome();
  const installedPackDirectory = path.join(qualificationHome.home, 'hima/packs', PACK_ID);
  try {
    const installation = installPackMethod({ from: path.join(repoRoot, 'packs', PACK_ID), to: installedPackDirectory });
    assert.equal(installation.digest, sourceDigest, 'isolated Home did not receive the current Pack bytes');
    assert.ok(lstatSync(installedPackDirectory).isDirectory() && !lstatSync(installedPackDirectory).isSymbolicLink());
    const host = await bootInProcess(qualificationHome);
    try {
      const defaultModel = host.ctx.get('agentDefaultModel');
      assert.ok(defaultModel, 'native Agent services are unavailable');
      const selection = defaultModel.currentSelection();
      assert.equal(selection.provider, 'deepseek-official'); assert.equal(selection.model, 'deepseek-flash');
      // This direct native Agent is intentionally not a Run or delegated child: it qualifies Pack
      // response bytes before a new TEST Run exists.  maxTokens is the pinned native request limit.
      const agent = await createTestAgentWithModel(host.ctx, installedPackDirectory,
        { provider: selection.provider, model: selection.model, maxTokens: 5000 });
      try {
        host.ctx.tools.guard(() => 'This isolated Researcher qualification permits no tools, filesystem access, Run control, Desktop, SSH, or EDA. Return the requested JSON only.');
        const presentation = inputs.map(input => `Retained ${input.name} input identity: record ${input.recordId}; content SHA-256 ${input.contentSha256}; original bytes ${input.declaredBytes}; native rendered characters ${input.renderedText.length}; rendered-truncated ${String(input.renderedTruncated)}.\n${input.renderedText}`).join('\n\n');
        const prompt = `${researcher.taskTemplate}\n\nThis is an isolated no-commercial qualification, not a Campaign. Do not use tools, change a Run, operate XTop, or claim timing closure. Use only the two retained native input presentations below. Their SHA-256 and byte counts were verified against the retained Ledger, but rendered text may omit bytes even when rendered-truncated is false; state that limitation. Return exactly one compact raw JSON object and nothing else. It must have exactly these four top-level fields: schema, hypotheses, evidenceRefs, limitations. schema must be "xtop-timing-research/1". hypotheses, evidenceRefs and limitations must be arrays. Return at most three group-level hypotheses; do not inventory endpoints, wrap in Markdown, or add fields. Keep the entire response at most 2000 characters.\n\n${presentation}`;
        const before = agent.session.seq;
        const qualificationTurn = sayAsUser(agent, prompt);
        const deadline = Date.now() + 600_000;
        let turns = agent.session.snapshotEvents(before).filter(event => event.type === 'turn/end');
        while (turns.length === 0 && Date.now() < deadline) {
          await Promise.race([agent.whenIdle(), new Promise(resolve => setTimeout(resolve, 100))]);
          turns = agent.session.snapshotEvents(before).filter(event => event.type === 'turn/end');
        }
        assert.ok(turns.length > 0, 'qualification exceeded its 10 minute wall limit without a terminal native turn');
        await qualificationTurn;
        assert.equal(turns.length, 1, 'qualification did not end at one native turn');
        assert.equal((turns[0]!.data as { reason?: { kind?: string } }).reason?.kind, 'completed', 'qualification native turn was not completed');
        const calls = toolCalls(agent); assert.equal(calls.length, 0, 'qualification attempted a forbidden tool');
        const messages = saidByModel(agent); assert.equal(messages.length, 1, 'qualification produced more than one assistant output');
        const raw = messages[0]!;
        const candidate = parseCandidate(raw);
        if (secret && raw.includes(secret)) throw new Error('candidate contains the API credential');
        writeFileSync(path.join(out, 'candidate.json'), `${raw}\n`);
        receipt.native = { provider: selection.provider, model: selection.model, maxTokens: 5000, turns: 1, toolCalls: 0,
          terminalReason: 'completed', candidateSha256: sha256(raw), candidateCharacters: raw.length };
        receipt.verdict = 'PASS'; receipt.finishedAt = now();
        receipt.candidate = candidate;
      } finally { /* The disposable qualification Home is removed after Host disposal. */ }
    } finally { await host.dispose(); }
  } finally { await qualificationHome.dispose(); }
  writeReceipt();
  process.stdout.write(`${JSON.stringify({ verdict: receipt.verdict, evidence: out, packDigest: sourceDigest }, null, 2)}\n`);
  }
} catch (error) {
  receipt.verdict = 'FAIL'; receipt.finishedAt = now(); receipt.error = redact(String(error));
  writeReceipt();
  process.stderr.write(`${JSON.stringify({ verdict: 'FAIL', evidence: out, error: receipt.error }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  rmSync(retainedCopy, { recursive: true, force: true });
}
