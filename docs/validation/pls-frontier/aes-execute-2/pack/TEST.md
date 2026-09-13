## Site

Site `linglong-aes`. The Run was checked against the Golden Flow that `INTENT.md` points at: `./flow` inside this Pack folder, read in place and never written — `./flow/README.md` (the method, the exact command, the manifest, the recommended initial period and goal, and the scope caveat), `./flow/probe.py`, `./flow/synth.tcl` and `./flow/read-probe.py`. The Run's workspace was prepared from the Site's separately staged `flowRoot` `/data/eda/project/hima_harness/polishing-inputs/aes-probe-66e57dc6bfbf`, for design `aes_cipher_top`, under `workspaceRoot` `/data/eda/project/hima_harness/polishing-runs`, in Campaign workspace `aes-tsmc28-dtco-20260913-023713-097f`.

## Run

run: run-3ef44159-1b5a-4baf-ab5c-107b8104fd98

Goal `target_period_ns = 0.5` ns and initial Strategy `periodNs = 0.35` ns, with `generations = 2`, `retries = 1` and `timeBox = 12` minutes (720000 ms). The Campaign was started with purpose `test` on pack `aes-tsmc28-dtco@1`, packDigest `84cefd82286358ce2930a81ae37f03bd9358432ee91844cd85f9c4b9a3e7bd7f`. Both numbers came from the author's message; 0.5 ns is also the SPEC Goal template's recommended value and 0.35 ns the Pack's declared strategy default.

## Ending

status: ended-budget-exhausted

The SPEC `Endings` section declares this ending as **Budget exhausted** — "reached when the Loop's `generationLimit` of 2 is spent (the revisit that would open generation three does not happen, with the period it would have tried still on record) or when the Run's own time box expires". The ledger records `endedBy: "generation-limit"` with the Explore decision `#000030` carrying the untried period 0.335 ns. This ending is declared by the pack, so there is no disagreement.

## Generations

- Generation 1 — asked clock period 0.35 ns; measured `clock_period` 0.35 ns, `setup_wns` −0.000969827 ns (setup/all) and `cell_area` 8667.161987 um2 on observation `#000010`; verdicts `setup-wns-all-nonnegative@1` FAIL (`#000012`) and `clock-period-at-most@1` PASS (`#000013`, 0.35 ≤ 0.5); decision `#000015` next strategy, clock period 0.341 ns.
- Generation 2 — asked clock period 0.341 ns; measured `clock_period` 0.341 ns, `setup_wns` −0.00422013 ns (setup/all) and `cell_area` 9142.181989 um2 on observation `#000025`; verdicts `setup-wns-all-nonnegative@1` FAIL (`#000027`) and `clock-period-at-most@1` PASS (`#000028`, 0.341 ≤ 0.5); decision `#000030` next strategy, clock period 0.335 ns, left untried because the generation limit of 2 was spent.

## Code

none

## Refusals

none

## Disagreements

none

This was checked rather than assumed. The Run's `blockers`, `cancels` and `refusals` are all empty and it wrote no code records. Each of the four jobs it launched — two `synthesize` jobs (`hima-3ef44159-synthesize-33d14a` at `--period 0.35`, `hima-3ef44159-synthesize-3c37f3` at `--period 0.341`) and two `aes-probe-reading` reader jobs (`hima-3ef44159-reader-aes-probe-reading-a42be9`, `hima-3ef44159-reader-aes-probe-reading-3f1f5e`) — finished with exit code 0, and the `synthesize` job-log tails report only a trial directory and an elapsed time, with no refusal or error. Held against the flow's own words: `flow/README.md` recommends the initial period 0.35 ns and the Goal 0.5 ns, which is what the Run asked for; its failure rule ("asked period minus negative slack estimates a relaxed next trial; apply a 0.01 ns over-constraining step") and its pass rule ("try 0.01 ns tighter") agree with the chooser's FAIL clause `period + |slack| − stepNs` and PASS clause `period − stepNs`; a zero slack, a repeated violation and a two-generation budget all read as the flow says they do. The ending reached is one the pack declares, and no stage was driven that the flow refused.
