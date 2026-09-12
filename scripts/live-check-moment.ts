// The live check for the Model moment (#59): one real model turn, with the owner's own key, through
// the product.
//
// Everything about a moment that the contract suite can prove, it proves against dsh's keyless replay
// adapter: the session is real, the loop is real, the tool catalog is real — the model's words are
// recorded. What no keyless run can prove is that a moment reaches DeepSeek at all: that the route
// the profile names resolves, that the key the owner holds is read from where this product says it is
// read from, that the model this bundle never names is the one that answers. That is what this
// script is, and it is the reason it is a script rather than a test: the contract suite has no key
// and must never need one, and this is run once, by hand, by whoever has it, before a merge.
//
// It is D24's shape — a record beside the run, every claim a check with its own predicate, a failed
// check writing the record and exiting non-zero — and it is the smallest such run there can be: one
// isolated home, one Campaign of one generation on the local stand-in Site so that there is a node
// to open a moment at, one moment, one turn, and a scan of everything the run wrote.
//
// **The key.** It comes from the environment this script is launched with and from nowhere else.
// This product writes no key, reads none from a file of its own, and puts none in a record: what the
// record carries is the key's *shape* — its length and its first four characters — which is enough
// to tell one key from another when a check fails and is not enough to be one. Run without a key,
// this refuses in words, says where a key comes from, and exits non-zero without booting anything.
//
// Run it as:
//   DEEPSEEK_API_KEY=… node scripts/live-check-moment.ts [--out <dir>]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { bootDriver, type BootedDriver } from '../test/contract/support/driver.ts';
import { repoRoot } from '../test/contract/support/dsh-home.ts';
import { localHome } from '../test/contract/support/fabric.ts';
import { api } from '../test/contract/support/hima-api.ts';
import { cell } from '../test/contract/support/markdown.ts';
import { scanForSecret } from '../test/contract/support/moments.ts';
import { timingProbePackId } from '../test/contract/support/pack.ts';
import { HIMA_MOMENT_PRESET, type MomentAnswer, type RecordsView, type RunView, type SessionRecord } from '@hima/harness';

/** The environment variable dsh's own DeepSeek adapter reads a key from; this script reads the same one. */
const KEY_VARIABLE = 'DEEPSEEK_API_KEY';

/** The model the profile's default selects (D9), which this run holds the answer against. */
const EXPECTED_MODEL = 'deepseek-v4-flash';

/** What the moment is told, chosen so that the answer is checkable without judging a model's prose. */
const INSTRUCTIONS = 'Answer with exactly the word READY. Say nothing else.';

/** The word the answer must contain for the turn to count as this instruction having been followed. */
const EXPECTED_WORD = 'READY';

const usage = [
  'usage: DEEPSEEK_API_KEY=… node scripts/live-check-moment.ts [--out <dir>]',
  '',
  '  --out   the directory the record is written into. Default docs/validation/ in this repository.',
].join('\n');

// ---------------------------------------------------------------------------------------------
// The refusal, before anything at all is prepared.
// ---------------------------------------------------------------------------------------------

const key = process.env[KEY_VARIABLE];
if (key === undefined || key.trim() === '') {
  process.stderr.write([
    `live-check-moment: there is no ${KEY_VARIABLE} in this environment, and this check is one of the two things in HimaHarness that needs one.`,
    '',
    'A DeepSeek key reaches this product through DeepSeek Harness\'s own three doors, and through no door of this harness\'s:',
    `  - the launching environment: ${KEY_VARIABLE} exported in the shell that starts the harness, which is what this check wants;`,
    '  - dsh\'s own credentials store, $DSH_HOME/.credentials.yaml, which the window\'s Models page writes and nothing here does;',
    '  - an env file dsh loads, $DSH_HOME/.env or the invoking directory\'s.',
    '',
    'HimaHarness writes none of those files, reads a key by no other path, and puts no key in any record it writes.',
    'Nothing was prepared and nothing was booted. Export a key and run this again:',
    `  ${KEY_VARIABLE}=… node scripts/live-check-moment.ts`,
    '',
  ].join('\n'));
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(`${usage}\n`); process.exit(0); }
const option = (name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
for (const given of argv) {
  if (given.startsWith('--') && given !== '--out') { process.stderr.write(`live-check-moment: unknown option ${given}\n${usage}\n`); process.exit(2); }
}
const outDir = path.resolve(option('--out') ?? path.join(repoRoot, 'docs/validation'));

const startedAt = new Date();
const stamp = startedAt.toISOString().slice(0, 10);
const base = `${stamp}-live-check-moment`;
const jsonAt = path.join(outDir, `${base}.json`);
const markdownAt = path.join(outDir, `${base}.md`);

// Beside the key check and not beside the write, because of what this script spends. By the time a
// record could be written, a shell has booted, a Campaign has run and one real DeepSeek turn has been
// paid for with the owner's key — and a refusal at that point would throw that turn away rather than
// prevent it. Every refusal in this script is pre-flight for the same reason: nothing here is worth
// discovering after the model has already answered.
if (existsSync(jsonAt) || existsSync(markdownAt)) {
  process.stderr.write(`live-check-moment: ${base}.{md,json} already exists in ${outDir}; move the earlier record aside first\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// The record.
// ---------------------------------------------------------------------------------------------

/** One claim this run makes, with the predicate it was judged by and what was actually seen. */
interface Check {
  readonly claim: string;
  readonly predicate: string;
  readonly saw: string;
  readonly passed: boolean;
}

const checks: Check[] = [];
const check = (claim: string, predicate: string, saw: string, passed: boolean): boolean => {
  checks.push({ claim, predicate, saw, passed });
  return passed;
};

/** The key's shape, which is what a record may carry: never the key. */
const keyShape = `${String(key.length)} characters, beginning "${key.slice(0, 4)}"`;

/** A skip is not available to a script: what a driver test skips on, this reports as a refusal. */
const noSkip = {
  skip: (reason?: string) => {
    throw new Error(`this check needs what a driver test needs, and this machine has not got it: ${reason ?? 'no reason given'}`);
  },
} as unknown as TestContext;

interface Observed {
  runId?: string;
  nodeId?: string;
  moment?: MomentAnswer;
  records?: SessionRecord[];
  scanned?: number;
  holding?: readonly string[];
  unreadable?: readonly string[];
}
const observed: Observed = {};
let refusal: string | undefined;

async function run(): Promise<void> {
  const home = await localHome(noSkip, { sleepSeconds: 1 });
  if (!home) throw new Error('the local stand-in flow could not be written');
  let d: BootedDriver | undefined;
  try {
    // **No `model` option**: this boot gets no replay overlay, so the host composes the product's own
    // DeepSeek adapter and the key below is the only reason a turn can answer at all.
    d = await bootDriver(noSkip, { existing: home.h, env: { [KEY_VARIABLE]: key! } });
    if (!d) throw new Error('the shell did not boot');
    const host = await d.host();
    if (!host.ok) throw new Error(`the shell refused host: ${host.error}`);
    const cookie = await d.cookie();

    // The Strategy knob by knob in the pack's own names (#58), and stated rather than left to the
    // pack's declared default: this check's record is read later against the Run it names, so what
    // the Run was set to belongs in the request and not in a contract file that can move under it.
    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    if (started.status !== 200) throw new Error(`the run did not start: ${String(started.status)} ${startedText}`);
    const view = JSON.parse(startedText) as RunView;
    observed.runId = view.run.id;
    observed.nodeId = view.run.currentNode;

    const answered = await api(host, cookie, `/hima/api/runs/${view.run.id}/moment`, {
      method: 'POST',
      body: JSON.stringify({ instructions: INSTRUCTIONS }),
      headers: { 'content-type': 'application/json' },
    });
    const answeredText = await answered.text();
    const reached = check(
      'the moment route answered',
      'POST /hima/api/runs/<id>/moment answers 200',
      `${String(answered.status)} ${answeredText.slice(0, 400)}`,
      answered.status === 200,
    );
    if (!reached) return;
    const moment = JSON.parse(answeredText) as MomentAnswer;
    observed.moment = moment;

    check('the model followed the instruction', `the answer contains "${EXPECTED_WORD}"`, JSON.stringify(moment.text), moment.text.includes(EXPECTED_WORD));
    check('the model is the profile\'s default', `the session's model is ${EXPECTED_MODEL}`, moment.model, moment.model === EXPECTED_MODEL);
    check('the session reached no tool', 'the tool list dsh reports for the session is empty', JSON.stringify(moment.tools), moment.tools.length === 0);
    check('the answer names dsh\'s own session', 'the session id begins "session-"', moment.sessionId, moment.sessionId.startsWith('session-'));

    const listed = await api(host, cookie, `/hima/api/runs/${view.run.id}/records?type=session`);
    const listedText = await listed.text();
    if (listed.status !== 200) throw new Error(`the records route did not answer: ${String(listed.status)} ${listedText}`);
    const records = (JSON.parse(listedText) as RecordsView).records.filter((r): r is SessionRecord => r.type === 'session');
    observed.records = records;

    check('the ledger holds the pair that brackets the moment', 'exactly one opened and one closed record',
      JSON.stringify(records.map((r) => `${r.event}${r.outcome === undefined ? '' : `:${r.outcome}`}`)),
      records.length === 2 && records[0]?.event === 'opened' && records[1]?.event === 'closed' && records[1]?.outcome === 'completed');
    check('both records name the moment\'s own session, preset and model',
      `sessionId === ${moment.sessionId}, preset === ${HIMA_MOMENT_PRESET}, model === ${moment.model}`,
      JSON.stringify(records.map((r) => ({ sessionId: r.sessionId, preset: r.preset, model: r.model, nodeId: r.nodeId, attempt: r.attempt, generation: r.generation }))),
      records.length === 2 && records.every((r) => r.sessionId === moment.sessionId && r.preset === HIMA_MOMENT_PRESET && r.model === moment.model));

    // Everything is flushed once the window and its host are gone; only then is the home read.
    const stopped = await d.quit();
    if (!stopped.ok) throw new Error(`the shell refused quit: ${stopped.error}`);
    await d.exit();

    const scan = await scanForSecret([home.h.home, home.h.workspace, path.join(home.h.home, 'electron-user-data')], key!);
    observed.scanned = scan.files.length;
    observed.holding = scan.holding;
    observed.unreadable = scan.unreadable.map((file) => `${file.path} (${file.error})`);
    check('the scan read the home rather than nothing', 'more than fifty files were read', `${String(scan.files.length)} files`, scan.files.length > 50);
    // Asked before the claim it qualifies: a regular file the scan could not open is a hole in "no
    // file holds the key" exactly the size of that file, and this run may not report PASS over one.
    check('the scan read every file it found', 'no file under the home was unreadable', JSON.stringify(observed.unreadable), scan.unreadable.length === 0);
    check('the key reached no file the run wrote', 'no file under the home holds the key', JSON.stringify(scan.holding), scan.holding.length === 0);
    const envFiles = scan.credentialFiles.filter((at) => path.basename(at) === '.env');
    check('the harness wrote no env file', 'no .env exists under the home', JSON.stringify(envFiles), envFiles.length === 0);
  } finally {
    if (d) await d.dispose();
    await home.h.dispose();
  }
}

function markdown(): string {
  const failed = checks.filter((c) => !c.passed);
  const lines = [
    `# Live check: the model moment, ${stamp}`,
    '',
    `One real model turn through the product, with a key from the launching environment (${keyShape}).`,
    `HimaHarness on DeepSeek Harness 0.1.5-alpha.1 (Node ${process.version}), driven through the desktop shell in driver mode with **no replay overlay**: the host composed its own DeepSeek adapter.`,
    '',
    `**${failed.length === 0 && refusal === undefined ? 'PASS' : 'FAIL'}** — ${String(checks.filter((c) => c.passed).length)} of ${String(checks.length)} checks passed.`,
    ...(refusal === undefined ? [] : ['', `The run did not finish: ${refusal}`]),
    '',
    '## What ran',
    '',
    `- Run \`${observed.runId ?? '—'}\` of the \`${timingProbePackId}\` pack on site \`local\`, one generation, standing at node \`${observed.nodeId ?? '—'}\`.`,
    `- Moment: preset \`${HIMA_MOMENT_PRESET}\`, session \`${observed.moment?.sessionId ?? '—'}\`, model \`${observed.moment?.model ?? '—'}\`, tools ${JSON.stringify(observed.moment?.tools ?? [])}.`,
    `- Instructions: \`${INSTRUCTIONS}\``,
    `- The model answered: \`${observed.moment?.text ?? '—'}\``,
    '',
    '## The records',
    '',
    '```json',
    JSON.stringify(observed.records ?? [], null, 2),
    '```',
    '',
    '## The home, read afterwards',
    '',
    `- ${String(observed.scanned ?? 0)} files read under \`$DSH_HOME\`, the window's user-data directory and the workspace.`,
    `- Files that could not be read: ${JSON.stringify(observed.unreadable ?? [])}.`,
    `- Files holding the key: ${JSON.stringify(observed.holding ?? [])}.`,
    '',
    'The key came from the launching environment. HimaHarness writes no credentials file and no env file, reads a key by no path of its own, and no record above carries one.',
    '',
    '## Checks',
    '',
    '| Claim | Predicate | Saw | |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c.claim} | ${cell(c.predicate)} | ${cell(c.saw)} | ${c.passed ? 'PASS' : '**FAIL**'} |`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

try {
  await run();
} catch (err) {
  refusal = err instanceof Error ? err.message : String(err);
  check('the check ran to its end', 'no refusal on the way', refusal, false);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(jsonAt, `${JSON.stringify({
  check: 'live-check-moment',
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  node: process.version,
  keyShape,
  instructions: INSTRUCTIONS,
  run: { id: observed.runId, nodeId: observed.nodeId, pack: timingProbePackId, site: 'local' },
  moment: observed.moment ?? null,
  records: observed.records ?? [],
  home: { filesRead: observed.scanned ?? 0, unreadable: observed.unreadable ?? [], holdingTheKey: observed.holding ?? [] },
  refusal: refusal ?? null,
  checks,
  passed: refusal === undefined && checks.every((c) => c.passed),
}, null, 2)}\n`);
writeFileSync(markdownAt, markdown());
process.stdout.write(`${markdown()}\nrecord: ${jsonAt}\n`);
process.exit(refusal === undefined && checks.every((c) => c.passed) ? 0 : 1);
