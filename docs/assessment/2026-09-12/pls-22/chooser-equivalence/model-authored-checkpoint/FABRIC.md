## Files written

- `contract.yml` — the run contract: two Site inputs, the two generation outputs, the `sh` wrapper, the workspace copy of `prepare.sh` and `numbers.txt`, the `prepare` tool, the `analyze` Workshop, the two rules, the one strategy knob and the one goal parameter with their bounds, defaults and words.
- `graph.yml` — the six nodes (`prepare`, `analyze`, `observe`, `judge`, `next-limit`, `blocked`), the four forward edges with their outcomes, and the one revisit edge back to `prepare`.
- `semantics.yml` — the one value type this pack's own reader emits, `numeric_sum` in count.
- `rules/numeric-sum-nonnegative.yml` — the validity constraint, `numeric_sum >= 0` in count.
- `rules/numeric-sum-meets-minimum.yml` — the goal rule, `numeric_sum >= minimum` in count, the bound supplied by the Run's goal.
- `choosers/limit-down-to-zero.yml` — the Pack-owned chooser: `goalMet: true` on constraint PASS and goal PASS, and the next strategy naming the bound fallback on constraint PASS and goal FAIL.
- `readers/read-result.yml` — the declared custom reader of `result.txt`, emitting `numeric_sum`.
- `tools/prepare.sh` — the Golden Flow's one preparation stage, run inside the Campaign's copy of the flow.
- `tools/read-result.sh` — the reader script that turns `result.txt` into `numeric_sum`, or refuses a numeric claim.
- `knowledge/numeric-strict-sum.md` — the declared analysis knowledge the Workshop is given: the symbolic strict-bound sum and the exact input/output interface, with no worked total.
- `FABRIC.md` — this record.

## Gaps

- `observe` — the spec's Run contract describes a wrapper that recomputes the strict-bound sum over `$1/flow/measured.txt`; the Golden Flow shows no command line for such a program, so none is written and the contract names no such tool. The observing act node is compiled as the reader node `observe` over `result.txt` through the reader `read-result`. To add a second, independent recomputation program, the author must supply the command line it would run.

## Reviews

- `tools/prepare.sh` — the author's verdict, in their words: "I approve the generated numeric prepare and reader scripts described above if their effects stay in the private Campaign workspace and implement the approved contract." Verified against the script: it runs the flow's stage with the flow directory set to `<workspace>/flow`, so the only file it writes is `<workspace>/flow/measured.txt`, inside the Campaign workspace, and the read-only flow root is never written.
- `tools/read-result.sh` — the author's verdict, in their words: "I approve the generated numeric prepare and reader scripts described above if their effects stay in the private Campaign workspace and implement the approved contract." Verified against the script: it reads `${REPORT}` and writes only `${OUT}`, the reading file the harness hands it inside the Campaign workspace, and it writes no other path.
