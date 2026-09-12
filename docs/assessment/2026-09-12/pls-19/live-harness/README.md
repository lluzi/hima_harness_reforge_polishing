# Bounded real-model checks: prepared, L4 not run here

This change replaces the former Electron/separate-moment Workshop check and the older authoring
check with two opt-in headless real-Host checks. It changes test scripts, the native user-message
adapter, and the installed `hima-test` skill. It adds no product execution protocol or graph engine.

Preparation source: `9614b78` (`codex/pls19-live-checks`). The integrated runner records its actual
Git SHA, dirty-file listing, Node version and hashes of every installed bundle asset. Build the
integrated product once before running. Credentials are accepted only from the inherited
`DEEPSEEK_API_KEY`; no credential or credential metadata is recorded. This preparation did not
seek or use a key, boot a model, replay a model, run Electron or execute EDA.

## Run from the integrated build

```sh
export PATH=/Users/lluzi/.local/node24/bin:$PATH
node scripts/live-check-workshop.ts --out <fresh-workshop-evidence-directory> --timeout-ms 600000 --max-turns 16 --max-steps 160
node scripts/live-check-pipeline.ts --out <fresh-authoring-evidence-directory> --timeout-ms 600000 --max-turns 24 --max-steps 160
```

The environment must already contain the authorized key. Do not put the key in these commands,
an env file, a transcript or an evidence record. Each directory must be new. Missing credentials
exit 2 before preparation. `--help` requires no credential. Defaults and maxima are visible there.
The total deadline is at most ten minutes per check. `--max-turns` bounds submitted user messages;
`--max-steps` separately bounds native Agent model-request steps. Those steps do not count internal
adapter retries. API request counts and token use are explicitly unmeasured. Title generation is
disabled; business model requests retain the native adapter.

## What the checks actually judge

**Workshop:** a declared numeric Pack contains prepare → Workshop → reader → Judge. Every run gets
new input integers and a new LIMIT. The same real conversational Agent prepares and owns the Run,
reads context/recommendation, reads the actual output and declared knowledge, writes an executable,
launches a Job, and drives the reader/Judge. The checker independently computes the expected sum
from the input and verifies recorded code hashes against the actual files. The declared script
sleeps 60 seconds, providing a bounded intervention interval. Once its actual tmux Job exists, the
checker sends a `source:user` message through public `agent.steer`, rather than queuing a follow-up
behind the turn. Success requires the Agent's own pause action while that Job remains active,
mechanical Job completion without a successor while paused, then an explicit user continue and
same-owner completion. Assertions use tool calls and ledger/Job facts, not assistant phrases.

**Authoring:** `hima_author` opens the native Pack workspace. One author Agent receives the actual
five skill invocations. The model writes INTENT, SPEC, contract, graph, knowledge, reader, FABRIC,
TEST and release through the respective product path; the checker never copies an authored Pack
fixture or writes a substitute INTENT. The business is the same small numerical task. Success
requires an executable Workshop declaration and graph, a true owned test Run, a matching method
digest, independent numeric result, actual generated-code hashes, and a release seal naming that
Run. Author responses/reviews are bounded and retained.

The Host loads `bundleMode: installed`. Generic model file reads resolve symlinks and are held to
installed bundle, installed Packs, declared numeric Golden Flow and private Site workspace roots.
Ordinary file writes are held to the author's Pack; shell, delegation and other generic tools are
refused. Product-controlled runtime reads/writes retain the real Site/execution constraints.
The Golden Flow and other Packs are hashed before/after authoring. Ordinary Coding is outside
these two L4 checks and remains covered separately at L2.

## Evidence and cleanup

`evidence.json` checkpoints the actual model tool sequence and results, native session identities,
user messages/delivery, Run/control state, all Ledger records, code bytes/hashes and installed-build
hashes. A checkpoint is `in-progress` and never an early PASS. On failure it preserves the last
observable state and error. `README.md` reports the final check outcome and scope. Native sessions,
model sessions, request steps, user messages and Host/Electron counts are distinct.

Each run owns a short `/tmp/hima-l4-*` root and private tmux socket. Finalization cancels only its
Agents, snapshots product facts before cleanup, terminates only its private tmux server, disposes
its Host and scans its private files plus evidence for the exact supplied secret. A detected secret
is removed from retained bytes and fails validation; its prefix/shape/length is never published.
The hard deadline retains a failure checkpoint and performs an emergency scan. Private diagnostic
homes remain available after success or failure so code, outputs and author files can be inspected.
A cleanup termination is not reported as a successful Agent cancellation. No external Site or
user-owned process is cleaned up by these scripts.

## Local preparation validation

- Frozen-lockfile install with Node 24 and the shared pnpm store: passed; 534 reused packages,
  no model request.
- `pnpm run build`: passed.
- Two scripts checked with the repository TypeScript options and `erasableSyntaxOnly`: passed.
- `pnpm run typecheck`: passed with the root-owned one-line correction of the existing
  `agent-workshop.host.test.ts` type import from product `src/fabric.js` to the exported
  `@hima/harness` type. That unrelated correction is not included in this change.
- `pnpm run check:seams` and `pnpm run check:boundary`: passed.
- `loadPack` accepted the numeric check Pack: five nodes and one Workshop.
- Both no-key commands: exit 2, no output directory/Home/Host/model prepared.
- Real DeepSeek L4, replay, Electron, EDA, full suite and L5: **not run** in this preparation.

The scripts require the integrated PLS-19 Workshop `read`/`write`/`knowledge`/`recommend` actions and
updated metadata. A prepared checker is not evidence those product actions or model behavior pass.
Rollback is limited to these scripts, the two small native Agent adapters, and `hima-test` text.
