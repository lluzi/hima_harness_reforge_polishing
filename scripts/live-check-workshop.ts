// The live check for the workshop (#62): one real model writing one real script, with the owner's
// own key, through the product.
//
// Everything about a workshop that the contract suite can prove, it proves against dsh's keyless
// replay adapter: the session is real, the loop is real, the three tools are real, the Permit and the
// Job are real — the model's words are recorded. What no keyless run can prove is that a *model*,
// given the instructions this harness composes and the three tools it hands over, writes a script
// that the pack's own reader can then read. That is what this script is, and it is the reason it is a
// script rather than a test: the contract suite has no key and must never need one, and this is run
// once, by hand, by whoever has it, before a merge (D48: any merge that touches a moment).
//
// It is `live-check-moment.ts`'s shape — a record beside the run, every claim a check with its own
// predicate, a failed check writing the record and exiting non-zero — over the smallest Campaign that
// has a workshop in it: one isolated home, the stand-in flow and the workshop pack variant on the
// local Site, one generation, one moment, one Job, one reading.
//
// **The key.** It comes from the environment this script is launched with and from nowhere else. This
// product writes no key, reads none from a file of its own, and puts none in a record: what the
// record carries is the key's *shape* — its length and its first four characters — which is enough to
// tell one key from another when a check fails and is not enough to be one. Run without a key, this
// refuses in words, says where a key comes from, and exits non-zero without booting anything.
//
// Run it as:
//   DEEPSEEK_API_KEY=… node scripts/live-check-workshop.ts [--out <dir>]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { bootDriver, type BootedDriver } from '../test/contract/support/driver.ts';
import { repoRoot } from '../test/contract/support/dsh-home.ts';
import { localHome } from '../test/contract/support/fabric.ts';
import { api } from '../test/contract/support/hima-api.ts';
import { cell } from '../test/contract/support/markdown.ts';
import { scanForSecret } from '../test/contract/support/moments.ts';
import {
  candidateCountType,
  installWorkshopPack,
  packsDirOf,
  workshopDirectory,
  workshopEntry,
  workshopId,
} from '../test/contract/support/pack.ts';
import {
  HIMA_MOMENT_PRESET,
  WORKSHOP_KNOWLEDGE_TOOL,
  WORKSHOP_READ_TOOL,
  WORKSHOP_WRITE_TOOL,
  type CodeRecord,
  type RecordsView,
  type RunView,
  type SessionRecord,
} from '@hima/harness';

/** The environment variable dsh's own DeepSeek adapter reads a key from; this script reads the same one. */
const KEY_VARIABLE = 'DEEPSEEK_API_KEY';

/** The three tools a workshop's moment is given, in the order dsh reports them for its scope. */
const WORKSHOP_TOOLS = [WORKSHOP_WRITE_TOOL, WORKSHOP_READ_TOOL, WORKSHOP_KNOWLEDGE_TOOL];

/** How long the whole Campaign is given: one real model session writing one script, then two Jobs. */
const CAMPAIGN_TIMEOUT_MS = 600_000;

const usage = [
  'usage: DEEPSEEK_API_KEY=… node scripts/live-check-workshop.ts [--out <dir>]',
  '',
  '  --out   the directory the record is written into. Default docs/validation/ in this repository.',
].join('\n');

// ---------------------------------------------------------------------------------------------
// The refusal, before anything at all is prepared.
// ---------------------------------------------------------------------------------------------

const key = process.env[KEY_VARIABLE];
if (key === undefined || key.trim() === '') {
  process.stderr.write([
    `live-check-workshop: there is no ${KEY_VARIABLE} in this environment, and this check is one of the things in HimaHarness that needs one.`,
    '',
    'A DeepSeek key reaches this product through DeepSeek Harness\'s own three doors, and through no door of this harness\'s:',
    `  - the launching environment: ${KEY_VARIABLE} exported in the shell that starts the harness, which is what this check wants;`,
    '  - dsh\'s own credentials store, $DSH_HOME/.credentials.yaml, which the window\'s Models page writes and nothing here does;',
    '  - an env file dsh loads, $DSH_HOME/.env or the invoking directory\'s.',
    '',
    'HimaHarness writes none of those files, reads a key by no other path, and puts no key in any record it writes.',
    'Nothing was prepared and nothing was booted. Export a key and run this again:',
    `  ${KEY_VARIABLE}=… node scripts/live-check-workshop.ts`,
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
  if (given.startsWith('--') && given !== '--out') { process.stderr.write(`live-check-workshop: unknown option ${given}\n${usage}\n`); process.exit(2); }
}
const outDir = path.resolve(option('--out') ?? path.join(repoRoot, 'docs/validation'));

const startedAt = new Date();
const stamp = startedAt.toISOString().slice(0, 10);
const base = `${stamp}-live-check-workshop`;
const jsonAt = path.join(outDir, `${base}.json`);
const markdownAt = path.join(outDir, `${base}.md`);

// Beside the key check and not beside the write, for the reason `live-check-moment.ts` states: by the
// time a record could be written, a shell has booted and one real DeepSeek session has been paid for
// with the owner's key, and a refusal at that point would throw that away rather than prevent it.
if (existsSync(jsonAt) || existsSync(markdownAt)) {
  process.stderr.write(`live-check-workshop: ${base}.{md,json} already exists in ${outDir}; move the earlier record aside first\n`);
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
  packId?: string;
  runId?: string;
  status?: string;
  sessions?: SessionRecord[];
  code?: CodeRecord[];
  script?: string;
  values?: unknown;
  scanned?: number;
  holding?: readonly string[];
  unreadable?: readonly string[];
}
const observed: Observed = {};
let refusal: string | undefined;

/** Poll until something is true, or fail saying what never happened. */
async function until(what: string, ready: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await ready()) return;
    if (Date.now() >= deadline) throw new Error(`waited ${String(timeoutMs)} ms and ${what} never happened`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function run(): Promise<void> {
  const home = await localHome(noSkip, { sleepSeconds: 1 });
  if (!home) throw new Error('the local stand-in flow could not be written');
  let d: BootedDriver | undefined;
  try {
    const packId = await installWorkshopPack(packsDirOf(home.h));
    observed.packId = packId;
    // **No `model` option**: this boot gets no replay overlay, so the host composes the product's own
    // DeepSeek adapter and the key below is the only reason a moment can answer at all.
    d = await bootDriver(noSkip, { existing: home.h, env: { [KEY_VARIABLE]: key! } });
    if (!d) throw new Error('the shell did not boot');
    const host = await d.host();
    if (!host.ok) throw new Error(`the shell refused host: ${host.error}`);
    const cookie = await d.cookie();

    const started = await api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      // No `retries` here on purpose, so the Run takes the **default** Retry allowance — three
      // attempts (`defaultRetryAllowance`, `budget.ts`) — which is what an ordinary Campaign of this
      // product runs under.
      //
      // The live check of 2026-09-12 is why. It ran with an allowance of one, the real model's first
      // script exited 1 because nothing on the flow said what to count, and that single failure was a
      // Hard blocker — so what the check measured was whether a model gets it right first time. What
      // #62 promises is narrower and truer: that a workshop reaches an observation *within its
      // allowance*, a retry being given the reason and the log tail of the attempt before it. So the
      // allowance is left at the default and the checks below say "within the allowance".
      body: JSON.stringify({ pack: packId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1, timeBox: 10 }),
      headers: { 'content-type': 'application/json' },
    });
    const startedText = await started.text();
    if (started.status !== 200) throw new Error(`the run did not start: ${String(started.status)} ${startedText}`);
    const view = JSON.parse(startedText) as RunView;
    observed.runId = view.run.id;
    observed.status = view.run.status;

    const runView = async (): Promise<RunView> => {
      const answered = await api(host, cookie, `/hima/api/runs/${view.run.id}`);
      const text = await answered.text();
      if (answered.status !== 200) throw new Error(`the run view did not answer: ${String(answered.status)} ${text}`);
      return JSON.parse(text) as RunView;
    };
    // The start route answers when the Run stops, so this is already over; the wait is here for the
    // one case where it is not — a Run the host is still carrying when the route answered.
    await until('the campaign stopped', async () => (await runView()).run.status !== 'running', CAMPAIGN_TIMEOUT_MS);
    const final = await runView();
    observed.status = final.run.status;

    const listed = await api(host, cookie, `/hima/api/runs/${view.run.id}/records?type=session`);
    const listedText = await listed.text();
    if (listed.status !== 200) throw new Error(`the records route did not answer: ${String(listed.status)} ${listedText}`);
    const sessions = (JSON.parse(listedText) as RecordsView).records.filter((r): r is SessionRecord => r.type === 'session');
    observed.sessions = sessions;

    const opened = sessions.find((r) => r.event === 'opened');
    check('a model moment opened at the workshop node', `an opened session record at node ${workshopId}`,
      JSON.stringify(sessions.map((r) => `${r.event}@${r.nodeId}`)),
      opened !== undefined && opened.nodeId === workshopId);
    check('the moment reached exactly the workshop\'s three tools', `tools === ${JSON.stringify(WORKSHOP_TOOLS)}`,
      JSON.stringify(opened?.tools ?? null),
      JSON.stringify(opened?.tools ?? null) === JSON.stringify(WORKSHOP_TOOLS));
    check('the moment closed having done what it was opened for', 'a closed record with outcome completed',
      JSON.stringify(sessions.filter((r) => r.event === 'closed').map((r) => r.outcome)),
      sessions.some((r) => r.event === 'closed' && r.outcome === 'completed'));

    const codeAnswer = await api(host, cookie, `/hima/api/runs/${view.run.id}/records?type=code`);
    const codeText = await codeAnswer.text();
    if (codeAnswer.status !== 200) throw new Error(`the records route did not answer: ${String(codeAnswer.status)} ${codeText}`);
    const code = (JSON.parse(codeText) as RecordsView).records.filter((r): r is CodeRecord => r.type === 'code');
    observed.code = code;

    const entry = code.find((r) => r.path.endsWith(path.join(workshopDirectory, workshopEntry)));
    check('the model wrote the entry inside the workshop directory', `a code record whose path ends ${path.join(workshopDirectory, workshopEntry)}`,
      JSON.stringify(code.map((r) => r.path)), entry !== undefined);
    if (entry !== undefined) {
      // The hash on the record, held against the bytes that are really on the Site. This is the whole
      // of what a code record claims, and the local Site is a directory this process can read.
      let onDisk: string | undefined;
      try {
        const bytes = await readFile(entry.path);
        observed.script = bytes.toString('utf8');
        onDisk = createHash('sha256').update(bytes).digest('hex');
      } catch (err) {
        onDisk = `could not read ${entry.path}: ${err instanceof Error ? err.message : String(err)}`;
      }
      check('the record hashes the bytes that are really on the site', `sha256 === ${entry.sha256}`, String(onDisk), onDisk === entry.sha256);
    }

    const job = final.jobs.filter((j) => j.job.name === `workshop-${workshopId}`);
    check('the fabric ran what the model wrote, within the allowance', `a launched and an ended job named workshop-${workshopId} that exited 0`,
      JSON.stringify(job.map((j) => `${j.event}${j.exitCode === undefined ? '' : `:${String(j.exitCode)}`}`)),
      job.some((j) => j.event === 'launched') && job.some((j) => j.exitCode === 0));

    const reading = final.observations.at(-1);
    observed.values = reading?.values ?? null;
    check('the node after it read what the script produced', `an observation holding ${candidateCountType}`,
      JSON.stringify(reading?.values ?? null),
      reading?.values.some((v) => v.type === candidateCountType) === true);
    check('the workshop node is done, within the allowance', 'the run\'s path holds the workshop node in state done',
      JSON.stringify(final.nodes.filter((n) => n.nodeId === workshopId).map((n) => n.state)),
      final.nodes.some((n) => n.nodeId === workshopId && n.state === 'done'));

    // Everything is flushed once the window and its host are gone; only then is the home read.
    const stopped = await d.quit();
    if (!stopped.ok) throw new Error(`the shell refused quit: ${stopped.error}`);
    await d.exit();

    const scan = await scanForSecret([home.h.home, home.h.workspace, path.join(home.h.home, 'electron-user-data')], key!);
    observed.scanned = scan.files.length;
    observed.holding = scan.holding;
    observed.unreadable = scan.unreadable.map((file) => `${file.path} (${file.error})`);
    check('the scan read the home rather than nothing', 'more than fifty files were read', `${String(scan.files.length)} files`, scan.files.length > 50);
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
    `# Live check: the workshop, ${stamp}`,
    '',
    `One real model writing one real script through the product, with a key from the launching environment (${keyShape}).`,
    `HimaHarness on DeepSeek Harness 0.1.5-alpha.1 (Node ${process.version}), driven through the desktop shell in driver mode with **no replay overlay**: the host composed its own DeepSeek adapter.`,
    '',
    `**${failed.length === 0 && refusal === undefined ? 'PASS' : 'FAIL'}** — ${String(checks.filter((c) => c.passed).length)} of ${String(checks.length)} checks passed.`,
    ...(refusal === undefined ? [] : ['', `The run did not finish: ${refusal}`]),
    '',
    '## What ran',
    '',
    `- Run \`${observed.runId ?? '—'}\` of the \`${observed.packId ?? '—'}\` pack on site \`local\`, one generation; it ended \`${observed.status ?? '—'}\`.`,
    `- Workshop \`${workshopId}\`, writing into \`${workshopDirectory}\`, entry \`${workshopEntry}\`, preset \`${HIMA_MOMENT_PRESET}\`.`,
    `- The moment reached: ${JSON.stringify(observed.sessions?.find((r) => r.event === 'opened')?.tools ?? [])}.`,
    `- What the reader took out of what the script produced: ${JSON.stringify(observed.values ?? null)}.`,
    '',
    '## What the model wrote',
    '',
    '```sh',
    observed.script ?? '(nothing was written)',
    '```',
    '',
    '## The records',
    '',
    '```json',
    JSON.stringify({ sessions: observed.sessions ?? [], code: observed.code ?? [] }, null, 2),
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
  check: 'live-check-workshop',
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  node: process.version,
  keyShape,
  run: { id: observed.runId, pack: observed.packId, site: 'local', status: observed.status },
  workshop: { id: workshopId, directory: workshopDirectory, entry: workshopEntry, preset: HIMA_MOMENT_PRESET },
  sessions: observed.sessions ?? [],
  code: observed.code ?? [],
  script: observed.script ?? null,
  values: observed.values ?? null,
  home: { filesRead: observed.scanned ?? 0, unreadable: observed.unreadable ?? [], holdingTheKey: observed.holding ?? [] },
  refusal: refusal ?? null,
  checks,
  passed: refusal === undefined && checks.every((c) => c.passed),
}, null, 2)}\n`);
writeFileSync(markdownAt, markdown());
process.stdout.write(`${markdown()}\nrecord: ${jsonAt}\n`);
process.exit(refusal === undefined && checks.every((c) => c.passed) ? 0 : 1);
