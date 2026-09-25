# Wave 0: authority and value-measurement alignment

Date: 2026-09-25. Scope: Wave 0 of the open-Issue closure plan. This slice launches no model,
Desktop, SSH or commercial EDA work and changes no Site or licence state.

## Current closure contracts

The GitHub Issue body is the current task surface. Each listed Issue has one Wave 0 block linking
the closure plan and naming its owning wave, dependencies and terminal condition. Earlier body text
and comments remain historical evidence; `ready-for-agent`, `BLOCKED`, `PARTIAL`, local tests and a
release ZIP are not terminal dispositions.

| Issue | Owning wave | Dependencies | Terminal condition |
| --- | --- | --- | --- |
| #44 | 1 | Wave 0 | PASS: one continuous Fabric `compile -> read-compile -> foundry-synth` L4 with DC exit 0, no DB-1, a non-empty netlist and matching Run/Job/Reader identities. |
| #49 | 1–2 | Wave 0; E2–E4 after E1 | PASS: actual Pack-to-Host E1 plus separately evidenced E2 facts, E3 report and bounded E4 proposal. |
| #56 | 1 | Wave 0 | PASS: sourced Guide explanation, independent handoff, late-response rejection and control receipt in real-model human-facing acceptance. |
| #58 | 1 | #56; closed #50 Operator contract | PASS: bounded real-model children, cancellation, shared-budget aggregation, transcript/result visibility, adoption and one qualified Operator delegation. |
| #57 | 2 | #49 E1, #56 and #58 | PASS: compact/reopen/restart/correction recovery always re-reads current Run/Job/report/control authority and preserves corrections. |
| #60 | 3 | #49 E4 and #57 | PASS: an independent second author completes five stages, real TEST, seal, install/upgrade, stale-review refusal, rollback and customer-asset preservation. |
| #38 | 3 | #44 | PASS: portable two-design method, bounded L4 tool/model evidence, traceability and a sealed Pack. Positive held-out Fmax remains #39. |
| #40 | 3 | #44 and #38 | PASS or TERMINAL_NEGATIVE after bounded residual-frontier assessment, declared real Campaign and sealed evidence. |
| #39 | 4 | #38, #40, #57, #58, #60 and this value receipt | PASS on a valid positive held-out result, or TERMINAL_NEGATIVE on a valid zero/negative result. Invalid evidence returns to its lowest owner and does not consume the attempt. |
| #30 | 5 | #38 and #39 plus explicit evidence/SUPERSEDED mappings for remaining owned requirements | PASS when every owned mechanism and held-out gate is terminal; future research gets a new Issue. |
| #52 | 5 | #44, #49, #56, #57, #58 and #60 | PASS when every listed child/frontier is terminal; future research gets a new Issue. |

## Current S11 authority

`library-intelligence@0.2.0` is runnable from `qualify-api`. Host admission and Reader acceptance
bind the loaded Permit, nested paths, private workspace, runtime/wrapper bytes, QuaLib resource and
same-Run durable Job history. The historical `lib.name` exit 139 and default-blocked graph remain in
dated evidence only. E1 is not yet PASS: it requires one actual Pack-to-Host run for the vendor,
SAED14 and TSMC28 inputs under `selected=new` with no XTop client. E2–E4 remain subsequent gates.

## Value-measurement contract

`valueMeasurementReceipt(run, records)` is the sole Wave 0 projection. Every current `RunView`
includes its result as `valueMeasurement`; the receipt has schema `hima-value-measurement/1` and is
bound to `runId`, `throughSeq` and the current control revision.

An authenticated human can post `measure-value` through the existing Run control endpoint with one
of the three categories, ISO start/end instants and an external stopwatch evidence reference. The
same idempotent control receipt carries the observation; it does not change Run status, meters or
execution ownership. Agent tools do not expose this action and cannot author human-effort evidence.

The receipt reads only existing authorities:

| Measurement | Authority | Result rule |
| --- | --- | --- |
| Job count and ending | Ledger `job` launch/finish/kill records | Count exact durable records; list unsettled sessions. |
| Commercial-tool seat time | `Run.meters.licenceMs`, derived by the existing Budget fold from Job records | Report seat-ms; an open licensed Job makes the result partial. |
| Model participation | Ledger Model-moment `session` open/close records | Count sessions and list incomplete identities. |
| Model requests/tokens | Provider usage, if the pinned surface exposes it | Current surface does not expose it, so both are `unmeasured`, never zero or inferred from sessions. |
| Human business-decision, environment-recovery and evidence-review time | Authenticated `measure-value` control receipt plus explicit stopwatch evidence ref | Sum only explicit start/end segments in each category; absent categories are `unmeasured`. |
| Campaign human wait | `Run.meters.waitedMs` | Report separately with a claim limit: wait time is not active human labour. |
| Human control count | `Run.control.requests` with `origin=human` | Count exact retained request identities; do not convert count to minutes. |

The receipt is a deterministic projection, not a telemetry service: it writes no Ledger record,
contacts no provider and starts no timer. A matched value study retains this JSON beside its control
receipt and supplies explicit stopwatch/provider evidence where available. `unmeasured` is not zero,
and no labor-saving or ROI claim is valid while comparable human categories are unmeasured.

## Verification boundary

- Node 24 build and focused local contract tests cover receipt source selection, open/incomplete
  behavior, cross-Run/snapshot exclusion and the RunView projection.
- Static S11/spec checks ensure current status no longer points an autonomous agent to the retired
  crash or blocked graph.
- GitHub bodies are updated after the implementation commit is pushed, so their Wave 0 blocks can
  cite an immutable SHA. Historical Issue text is preserved below each current block.
- Not run: Desktop, real model, SSH, Site, QuaLib, XTop or any other commercial tool.

Rollback is the single Wave 0 implementation commit plus removal of the marked Issue-body blocks.
It does not alter a Run, Pack seal, customer asset, historical evidence or Site state.
