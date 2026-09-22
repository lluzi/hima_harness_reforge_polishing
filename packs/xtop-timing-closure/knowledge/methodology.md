# XTop timing-closure method

The business input and output are Innovus checkpoints. The selected output is the best database
measured after a complete physical and timing refresh, never the last database merely attempted.

Every generation is one controlled experiment:

1. Read the current PrimeTime endpoint state and all retained experience.
2. Explain what the last generation fixed, left, introduced or regressed.
3. Write a bounded plan using only XTop size-cell and insert-buffer setup/hold actions.
4. Let XTop propose an ECO. XTop post-opt numbers are a prediction, not admission evidence.
5. Restore the exactly matching Innovus database, source XTop's logical then physical macro Tcl,
   require `-keep_route` output with no route-destructive commands, and run `ecoRoute`.
6. Export the resulting DEF and netlist, run fresh StarRC extraction and all declared PrimeTime
   scenarios, and compare like for like.
7. Append both successful and unsuccessful experience. Keep the lower-ranked database as evidence;
   point the business output only at the best admitted database.

The Campaign reaches its business goal when every declared setup and hold WNS reaches the bound
target. It may end converged when the measured closure score stops moving for two generations.
Convergence means the tool-driven frontier stopped advancing under the tried strategies. It does not
mean sign-off clean, globally optimal, DRC clean or free of unconstrained endpoints.

Foundation source hashes, DB tree identity, ECO files, logs, SPEF, PT reports, endpoint deltas and
the selected database identity are retained. A missing report, changed source, stale SPEF, unmatched
database, empty ECO or tool error blocks the generation instead of becoming a zero.

The Workshop writes exactly this contract, with `iteration` equal to current state plus one:

```json
{
  "schema": "xtop-timing-fix-plan/1",
  "iteration": 1,
  "diagnosis": "what changed and what remains",
  "hypotheses": ["evidence-linked alternative considered"],
  "endpointGroups": ["scenario|setup|path-group"],
  "actions": [{
    "kind": "setup-size",
    "effort": "high",
    "setupTargetNs": 0.0,
    "holdTargetNs": 0.0,
    "setupMarginNs": 0.02,
    "holdMarginNs": 0.02,
    "endpointGroups": ["scenario|setup|path-group"],
    "reason": "why this action addresses this remaining group"
  }],
  "avoid": ["action not repeated and why"],
  "reasoning": "why this bounded portfolio is preferred"
}
```

`kind` is one of `setup-size`, `setup-buffer`, `hold-size`, `hold-buffer`; `effort` is `medium` or
`high`; each numeric target or margin is finite and between -0.2 ns and 0.2 ns; one through eight
actions are allowed. The adapter rejects extra or missing fields and never executes model-authored
Tcl directly.
