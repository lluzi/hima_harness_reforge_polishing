# PLS-10 growth core evidence

Baseline: `6438c9f1cb76075bc31b25338b6937ac48d1a6bb` on `codex/pls10-growth`.

Implementation used `gpt-5.6-sol` high as allocated by `docs/agents/model-policy.md`, with no child
agents. The product tests made zero model calls and used no EDA or remote Site. They used the real
dsh Host, Hima module, JSON Ledger, local files and local stand-in Jobs.

## Behavior covered

- One `explore.parameters.growth: true` point is allowed at top level. Multiple or nested points and
  nested Explore additions are rejected before acceptance.
- A strict proposal binds method, parent generation, current Ledger boundary, content-identified
  input records, impact nodes, expected changes, additive nodes/edges, required outputs, ending,
  return and optionality.
- Reference ids and edges cannot be overwritten; new ids are unique; cycles, missing references,
  incomplete Judge routing, path authority overrides and branches without one return are rejected.
- Proposal and acceptance precede any added Job. Accepted graphs are reconstructed from Ledger
  records after restart, including the acceptance/Run-row crash window. Repeated request and proposal
  identities do not duplicate records or Jobs.
- A normal return requires completed, current observation and Judge facts. Optional failed,
  cancelled and abandoned branches retain lifecycle records and return to the same reference Explore
  node, so the reference checks still execute.
- `ExecutionContext.growths` and `GenerationView.growths` expose accepted/refused lifecycle, actual
  nodes, Jobs and evidence while `method.reference` remains the original Pack graph.

## Current verification

- `logs/l0.log`: Node gate, seam check, boundary check, build and typecheck, exit 0.
- `logs/growth-l1-l2.tap`: 9/9 pass, 0 fail, 21.809 s; zero Electron and SSH attempts.
- `logs/adjacent-agent-graph-recovery.tap`: 18/18 pass, 0 fail, 57.231 s; existing fork, Loop,
  explicit execution and restart behavior remained green.

L3 is not run in this worker because UI is owned by the integrating task. L4 real DeepSeek tool
collaboration and L5 pilot are not run; local deterministic checks do not establish model research
quality or EDA validity. The integrating task owns the combined Ledger schema/import version after
PLS-14/15 and the L3/L4 evidence.
