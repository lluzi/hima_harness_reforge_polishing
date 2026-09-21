# HimaHarness Pack 5.2.10 Trial 24 Report

## Verdict

**LOOP_WORKS_TARGET_MISS**

Across 7 fully-closed generations the Pack's research/calibration/next-research
loop worked correctly, and generation 1's original blocker class (trial 23's
`evaluation exceeds the bound evidence file byte limit`) never recurred at any
of the `final-judge`-FAIL→`next-research`→`research-candidates` transitions
exercised this trial. Every matched commercial Fmax result obtained (gen 7) was
a valid negative result below the 5% target. The Run ended honestly on
`ended-budget-exhausted` (`meters.endedBy: "time-box"`) while generation 8's
matched P&R pair was still executing, cut short by severe, sustained host I/O
contention on the Site machine — an environment condition, not a Pack or App
defect. The Campaign never reached goal-met.

## Exact identities

| Item | Value |
| --- | --- |
| App | `HimaHarness.app`, `.hima-tmp/ui-trial-0.3.0-trial.15/` |
| App source | `7a054151810da8e2dbc15989a040dcc74725cbf1` |
| Pack | `custom-cell-fmax-dtco` 5.2.10 |
| Pack digest | `e60bbfb6e3466872ff24e590adb31aab62f4232b5eb9c9db71db9c75dddb629c` |
| Site | `luzi@192.168.50.41` |
| Campaign | `custom-cell-fmax-dtco-20260921-030211-aed8` |
| Run | `run-adf41cad-660b-41fc-99b0-bfc23d2c4c99` |
| Owner session (final) | `session-daf02e5c-b5da-424e-a61a-52e658127a6a` (epoch 2) |
| Created | `2026-09-21T03:02:11.921Z` |
| Ended | `2026-09-21T15:02:12.138Z` (`status: ended-budget-exhausted`) |
| Goal | period ≤ 0.5 ns, matched post-route Fmax improvement ≥ 5% |
| Budget | `timeBoxMs=43,200,000` (720 min), `closingReserveMs=900,000`, `generationLimit=8` |
| Final `elapsedMs` | `43,200,479` (over budget by 479 ms at closure) |
| Design top | `aes_cipher_top` |

## Generation-by-generation trajectory

| Gen | Research strategy knob | Calibration result | Matched P&R outcome |
| --- | --- | --- | --- |
| 1 | `algorithmRevision=0` | rejected, 38/42 met | **-3.92%** Fmax (via calibration-research→gen2, not next-research) |
| 2 | `algorithmRevision=0`(carried) | rejected, 38/42 met (byte-identical to gen1) | — (calibration-gate FAIL routed to research) |
| 3 | `algorithmRevision=1` | rejected, 39/42 met (unmet: 3 demands) | — |
| 4 | `algorithmRevision=2` | rejected, **38/42 (regressed)** | — (root cause: stale un-authored `entry.py` silently seeded the last-accepted gen1/2 program — see Findings) |
| 5 | `algorithmRevision=3` | rejected, 39/42 met (same 3 unmet as gen3 — fresh `entry.py` this time) | — |
| 6 | `algorithmRevision=4` | rejected, 39/42 met (same 3 unmet — 3-generation plateau) | — |
| 7 | `algorithmRevision=5` | **accepted, 38/38 met** (narrowed demand set, not the original 42) | **-2.93%** Fmax (foundry 1773.05 MHz vs generated 1721.17 MHz), matched, comparison_valid |
| 8 | `algorithmRevision=6` | **accepted, 7/7 met** (further narrowed demand set) | **incomplete** — `pnr-foundry` still executing when budget exhausted |

## Generation 7's matched commercial facts (only completed matched pair)

From `flow/records/compare.json` (Site, `run-534cb079b8d941b3ad7db917e5df50f2`),
and ledger `final-judge` verdicts (`#001336`-`#001339`):

```
comparison_valid:        true
matched_conditions:      true
fmax_improved:           false
fmax_improvement_pct:    -2.9259896729776047
foundry_fmax_mhz:        1773.0496453900707
generated_fmax_mhz:      1721.1703958691912
fmax_delta_mhz:          -51.87924952087951
setup_wns (generated):   -0.081
foundry_setup_wns:       -0.064
verification_error_count: 0
adopted_instance_count:  374
```

`final-judge` rules: `fmax-improvement-at-least-target` **FAIL**,
`comparison-evidence-valid` **PASS**, `fmax-improved` **FAIL**,
`clock-period-at-most` **PASS**. The Run correctly continued through
`next-research` into generation 8 rather than terminating — confirming the
Pack 5.2.10 fix holds at exactly the transition where trial 23 blocked.

## Findings

### 1. The trial-23/generation-2 byte-limit blocker did not recur (fix confirmed)

`research-candidates` executed cleanly at every generation boundary this
trial, including the one direct exercise of the `final-judge`-FAIL →
`next-research` → fresh `research-candidates` path (gen7→gen8, ledger
`#001341`-`#001458`, node reached `done` with no error). This is the scenario
in which trial 23 hit `evaluation exceeds the bound evidence file byte
limit`. No repeat occurred anywhere in trial 24.

### 2. Stale un-authored Workshop `entry.py` is silently seeded (harness/methodology trap, generation 4)

Generation 4's `research-candidates` `complete` was called without first
writing a fresh `entry.py`. The harness silently validated the **last accepted
program** for that node (from generation 1/2) instead of requiring a fresh
one, producing a byte-identical 38/42 regression. This was root-caused
precisely by the embedded agent itself and not retroactively "fixed" by
reopening the closed generation (not authorized); generation 5 onward
explicitly verified a fresh, distinct `entry.py` was authored each time.
**This is a genuine product/methodology finding**: an un-authored Workshop
`entry.py` should be rejected on `complete`, not silently backfilled from the
last accepted program.

### 3. Calibration acceptance narrowed the demand set rather than closing the original gap

The original mining/merge cycle (generations 1-6) worked against a stable
42-Cell-Demand set, of which 3 demands (`DEMAND_5F9D403DB10DFF2A1E5826B0`,
`DEMAND_8D1E38916B6241A20FF968D8`, `DEMAND_DC6F89E91BF862A88CF44D9F`) plateaued
unmet across generations 3, 5 and 6. Generation 7's research produced a
smaller 38-demand set that was fully satisfiable (38/38), and generation 8
narrowed further to 7/7. Calibration was technically **accepted** both times,
but neither generation closed the original 42-demand gap or demonstrably
addressed the 3 plateaued demands — this is a legitimate strategy the
research loop is permitted to take, but it means "calibration accepted" after
generation 6 does not mean the harder demands were solved; it means research
chose an easier, smaller target. Worth flagging for anyone reading calibration
acceptance as a proxy for library completeness.

### 4. Session-ownership handoff mechanism (recovery procedure exercised successfully)

Mid-trial, the original owning session appeared to run low on context. The
full explicit-handoff procedure was exercised for the first time this trial
series: the owning session called `hima_execute action=handoff` naming a
fresh session's self-confirmed conversation id as `targetOwner`; the Run was
left paused (`scope: ["*"]`, `available: []`); the new owner called
`action=continue` to resume. No data loss, no duplicate Campaign. This
confirms the recovery path works as designed.

### 5. A session can silently stall awaiting instruction it doesn't need

Entering generation 7, the owning session halted at `evaluation-baseline`
believing (incorrectly) that the human's prior standing instructions scoped
work to generation 6 only. It took no destructive action and reported its
state accurately when asked, but an explicit "continue" chat message was
required to unblock it. Not a defect, but worth noting for future manual
authors: session prose about scope should be cross-checked against the actual
ledger/manual rather than trusted at face value (consistent with this skill's
standing "verify, don't trust agent prose" discipline).

### 6. Generation 8's `pnr-foundry` was killed by severe, sustained host I/O contention — an environment blocker, not a product defect

Generation 8 reached calibration acceptance and progressed cleanly through
`portfolio-gate`, `freeze-cumulative-library`, `compile`, both synthesis arms,
and `adoption-gate`, then launched the real Cadence Innovus `pnr-foundry` job
(`run-91265678a90c429198757be0da592f60`, PID 489155) at 11:03:29 UTC.

The Site host (`luzi@192.168.50.41`) was under chronic, severe load for the
job's entire ~4-hour lifetime: `/proc/loadavg` held steady at **44-55**
throughout (confirmed via more than 25 independent SSH checks over the final
~4 hours), driven by unrelated long-running host processes
(`systemd-journald` at 15,000+ accumulated CPU-minutes since Sep 1,
`wireplumber`, a Baidu Netdisk client, `gnome-shell`) rather than anything
this trial launched. The Innovus process was confirmed alive throughout via
direct `ps`/`/proc` inspection, consistently in kernel state `D`
(uninterruptible disk-I/O sleep), blocked in `__bio_queue_enter` — genuinely
progressing, but at an observed rate of roughly **1-2 seconds of CPU time per
8 minutes of wall clock**. Disk space was not the cause (`/data` at 56% used,
1.7 TB free).

The HimaHarness GUI's own Campaign graph surfaced a `blocked`/`hard-blocker`
heuristic annotation on the `pnr-foundry` node during this period, though the
Ledger recorded no error — consistent with the harness's own "this job is
running unusually long" detector, not a distinct defect.

At `2026-09-21T15:02:12.138Z` the Run's time-box fired
(`meters.endedBy: "time-box"`, `run.status = "ended-budget-exhausted"`,
`elapsedMs` finalized at `43,200,479` against the `43,200,000` budget). The
harness correctly recorded a `cancel` → `job killed` → `node cancelled`
sequence (ledger `#1577`-`#1579`) and wrote a full closure "experience"
record (`#1580`). Independently notable: the underlying OS process (PID
489155) was **still alive** several minutes after the harness's kill signal,
because a process blocked in uninterruptible disk-I/O sleep cannot be
terminated — even by SIGKILL — until the I/O completes. This is a further,
independent confirmation of how severe the host's I/O contention was; it is a
host/OS-level condition, not a HimaHarness defect (the harness did send the
correct cancellation).

`generationMs[7]` (generation 8) consumed 16,039,726 ms (~267 minutes) of the
Run's total budget, by far the longest of any generation (next-longest:
generation 2 at ~118 minutes); nearly all of it (`Innovus` `licenceMs`:
16,425,404 ms) was consumed by this one stuck P&R job.

### 6b. Time-box accounting note

The `run['meters']['elapsedMs']` field does **not** update live while a node
is executing — it remained frozen at `28,877,601` (~481 min) for the
generation-8 `pnr-foundry` job's entire ~4-hour runtime, only jumping to the
final `43,200,479` at closure. Raw wall-clock time since Run creation
(`2026-09-21T03:02:11.921Z`) crossed 720 minutes at approximately
`2026-09-21T15:02:11Z` and the Run closed within one second of that instant —
so in this case the two bases coincided, but that was because the stuck job
happened to be the one consuming the remaining budget when the clock ran out;
`elapsedMs` should not be assumed to track live wall-clock during a running
node in general monitoring.

## What was not reached

- Generation 8 never reached `verify`, `compare`, or `final-judge` — the
  matched foundry/generated P&R comparison for generation 8 does not exist.
- No generation 9 was possible (`generationLimit=8`); the Run's budget was
  exhausted before generation 8 could produce its own matched Fmax result.
- Whether generation 8's narrower research (7/7 demand acceptance) would have
  produced a materially different matched Fmax result than generation 7's
  -2.93% is unknown and not claimed.

## Retained evidence paths

- Ledger: `.hima-tmp/ui-trial-0.3.0-trial.15/Trial Data/dsh/storages/hima_ledger.json`
- Generation 7 calibration: Site
  `.../characterize/run-4108f6551f3248718063c14a0d6e7b55/mock-liberty-calibration.json`
- Generation 8 calibration: Site
  `.../characterize/run-f265ae9409ac4c879482f1a2d60b6516/mock-liberty-calibration.json`
- Generation 7 compare: Site `flow/records/compare.json`
  (artifact `flow/artifacts/compare/run-534cb079b8d941b3ad7db917e5df50f2/comparison.json`)
- Generation 8 stuck job: Site
  `flow/artifacts/pnr-foundry/run-91265678a90c429198757be0da592f60/`
- Closure experience record: Site
  `hima-experience/run-adf41cad-660b-41fc-99b0-bfc23d2c4c99.{md,json}`

## What I did not do

- Did not modify any Pack file, evidence file, or the installed method.
- Did not retroactively reopen or alter any closed generation (including
  generation 4's regression).
- Did not attempt to speed up, restart, or otherwise intervene in the stuck
  `pnr-foundry` job or the host's resource contention.
- Did not create a duplicate Campaign or touch trials 13-23's Runs.
- Did not promote generation 8's incomplete state to any terminal per-generation
  verdict; only the Run's own `ended-budget-exhausted` status is reported as
  terminal.
