# PLS-19 explicit graph completion implementation

Base: `7dfe25ddaec75dae1ae276199e80b6683e769b68`. The four independently authored
Host tests and their original red evidence were applied from
`faa9615ea283255185b00514b29857e764e6cd28` without a separate local commit. The
manifest conflict retained both `ledger-import.test.ts` and `agent-graph.host.test.ts`.
The earlier red specification is retained in [graphs](../graphs/README.md).

This slice implements graph context and the explicit completion boundary in the
existing Fabric/node-turns/Ledger modules. It adds no engine, service or component.
It does not complete PLS-19, Workshop interactions, recovery/adoption, or product
verification with a real model or EDA Site.

## Behavior and evidence

- Context exposes the retained method contract and reference graph, real branch
  candidates and Loop identity. Node pauses fence that node and dependencies;
  independent fork siblings remain available. A previously admitted execution
  is not silently claimed again.
- Completing fork entry opens branch positions without work. Each branch carries
  its real branch identity; completion updates only that branch. The join is
  unavailable until both branches finish and uses the existing per-branch Judge.
- Completing a Loop opener opens its declared Loop without a Job. Inner decisions
  reuse existing revisit/closure routing; each next node and generation still
  needs an explicit Agent request. Outer and inner generation identities remain
  distinct.
- Explore completion requires current observations and the required Judge
  verdicts. False goal success, invented convergence, stale generation citations,
  and an invalid Strategy are refused without advancing control facts. Goal-met
  requires every required verdict to be PASS. Convergence records only verified
  measured values from the existing recommendation path.
- The readonly factual preparation is factored as `exploreEvidence`. A legal
  Agent next-strategy remains admissible when the reference chooser would compute
  an illegal value. The Agent's session, execution and text rationale are stored;
  unrelated chooser numbers are not presented as the Agent's numeric rationale.
- At the generation limit, a legal next-strategy decision ends honestly as budget
  exhausted without another Job.
- A Pack wait operation exposes a ready execution and pauses that node. Agent
  Continue cannot impersonate human clearance. A human-origin control Continue
  records the person action and clears the wait pause; Agent completion is still
  required to move onward. This test calls the actual Host operation with the
  native-origin boundary; UI provenance/Continue-button behavior remains root
  integration verification.
- Completion requests are persisted before decisions/routing and remain uncertain
  if recording is interrupted. Context fences new work until an admitted
  completion finishes. Restart/fault-injection verification belongs to the
  parallel recovery slice and is not claimed by these graph results.

## Actual checks

Node 24.16.0, pnpm 11.25.0. This worktree installed its own dependencies from the
unchanged frozen lockfile using the polishing `.hima-tmp/pnpm-store`.
All model-triggered notifications were silenced by the test file's existing
`HIMA_TEST_SILENT_AGENT=1` setting.

| Check | Result |
| --- | --- |
| Baseline build | PASS; [log](baseline-build.log) |
| Current-base independent red tests | 0 pass / 4 fail / 0 skip, 15.233 s; [log](baseline-red.log). Ordinary work now succeeds, but explore/Loop completion is refused and fork context exposes the join instead of branches. |
| First type check | FAIL on the completion record annotation accidentally requiring base fields `siteId`/`writer`; corrected to the existing Ledger appender parameter type. [log](first-types.log) |
| Original four graph tests, unchanged expectations | 4 pass / 0 fail / 0 skip, 26.371 s; [log](first-green-attempt.log) |
| Added counterexamples and human wait | 6 pass / 0 fail / 0 skip, 31.846 s; [log](graphs-green.log) |
| Final affected Host regression after completion admission hardening | 10 pass / 0 fail / 0 skip, 39.141 s; [log](graph-regression.log). Six graph cases plus four existing admission cases. |
| Build and full workspace/test TypeScript | PASS; [build](build.log), [types](types.log) |
| Seam, boundary, test inventory, whitespace | PASS; [seams](seams.log), [boundary](boundary.log), [inventory](inventory.log), [whitespace](whitespace.log) |

The final regression used ten in-process Host boots, zero Host subprocess boots,
zero Electron launches and zero SSH subprocess attempts. Its local stand-in Jobs
prove execution mechanics and source/evidence identity, not semiconductor results
or model research quality. No full local suite, desktop, real model, SSH or EDA
suite was run. One inventory invocation initially used shell-default Node 22 and
was refused by the existing Node requirement; the recorded invocation used Node 24.

Commands (all pnpm calls used `--config.verifyDepsBeforeRun=false`):

```sh
export PATH=/Users/lluzi/.local/node24/bin:$PATH
pnpm install --frozen-lockfile --store-dir /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pnpm-store
pnpm run build
pnpm run typecheck
pnpm run test:local --files test/contract/agent-graph.host.test.ts test/contract/agent-execution.host.test.ts
node scripts/run-contract-tests.mjs --check
node scripts/check-seams.mjs
node scripts/check-boundary.mjs
git diff --check
```

`source-hashes.json` identifies the implementation/test sources and lockfile.
Rollback reverts this commit's three existing-module edits, graph tests, manifest
entry and assessment directories. It does not alter Pack reference fixtures,
source projects, or any running user job. The admission base remains separate.
