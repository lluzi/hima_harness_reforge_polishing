# PLS-19 graph tests — intentional red specification

Production baseline: `96580d221c01399fe2b9f8dc72071e0c189d6b3a`.
The bounded test branch adds `test/contract/agent-graph.host.test.ts` and its local
group entry. It changes no production code and does not complete PLS-19.

The four cases use the real in-process dsh Host, a real root Agent identity,
public execution operations and Ledger reads, and private local stand-in Jobs.
There is no model/replay, Electron, SSH or EDA execution. The local stand-in
computes reports; its numbers are test inputs, not measured silicon or EDA data.
`HIMA_TEST_SILENT_AGENT=1` suppresses notification-triggered model turns in the
file's isolated Node test process.

| Required behavior | Independent counterexample / expectation |
| --- | --- |
| Agent owns strategy selection; completion needs evidence | A 2.40 ns trial misses a 2.30 ns goal. False goal-met and negative period must be refused. The Agent then chooses 2.30 directly, while the declared fixed chooser would choose 2.35. Only the actual second trial can support goal-met. |
| Generation budget prevents extra experiments | With one generation allowed, a valid 2.27 ns next-strategy request must end as generation-limit, leave one Job and no generation-2 observation, and reject another begin. |
| Explicit fork/join and node-scope pause | Completing the fork entry starts neither branch. After branch A synthesis, pausing A fences its read and join while branch B can run. Join waits for both observations, and four verdicts cite their own branch evidence. |
| Declared nested Loop does not hide automatic work | Explicit completion of probe opens push; each inner node and second generation need explicit requests. Two observed 2.30 ns trials satisfy the declared convergence band. Closure exposes final-read without running it. Loop/branch/generation identities remain distinct, and convergence never becomes goal-met. |

The existing `installFork` and `installDrillDown` fixtures are reused unchanged.
The case helper does not pick successors: each node call is written explicitly
in the scenario. It waits for the current execution's public ready/failed phase
and requires completion to add neither another execution nor a Job.

## Commands and actual result

Node `24.16.0`, pnpm `11.25.0`; the worktree installed its own dependencies from
the unchanged frozen lockfile, reusing the local content-addressed store.

```sh
export PATH=/Users/lluzi/.local/node24/bin:$PATH
pnpm --config.verifyDepsBeforeRun=false install --frozen-lockfile
pnpm --config.verifyDepsBeforeRun=false run build
pnpm --config.verifyDepsBeforeRun=false exec tsc -p test/tsconfig.json
pnpm --config.verifyDepsBeforeRun=false run test:local --files test/contract/agent-graph.host.test.ts
node scripts/run-contract-tests.mjs --check
git diff --check
```

- Fresh build: exit 0; [output](build.log).
- Test TypeScript check: exit 0; [empty successful output](test-types.log).
  An initially unexported type import and a filter narrowing error were corrected
  in test code before this successful check; no production export was added.
- Selected L2 run: **0 pass, 4 fail, 0 skip**, exit 1, 14.588 seconds;
  [complete TAP output](baseline-red.log).
- Each failure is the first `work` returning `refused` with
  `this execution operation is not implemented`. Preparation and owned begin
  reached the real Host in all four cases. No Job launched on this baseline.
- Runner resources: 4 in-process Host boots, 0 Host subprocesses, 0 Electron,
  0 SSH subprocess attempts. No model/EDA was requested.
- Inventory: 60 contract files, each assigned exactly once. Diff whitespace check
  passed. Full local, desktop and live groups were not run.

All assertions after the first work request remain **unreached**, including
strategy validation, completed Jobs, budget ending, branch isolation and Loop
completion. These tests must be rerun against the implementation and any failure
diagnosed before claiming those behaviors pass. This red result establishes the
missing execution operation, not that every later test expectation already works.

Rollback removes this new test, its single local group entry and this evidence
directory. No production behavior or reference fixture is changed.
