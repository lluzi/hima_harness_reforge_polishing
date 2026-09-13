## Site

Site: `linglong-aes`.

Golden Flow checked against, by the pointer `INTENT.md` gives: the approved Golden Flow root `./flow`, read in place with read/glob only — `flow/README.md` (the method, the exact command, the manifest, the recommended initial period and goal, and the scope caveat), `flow/probe.py` (one bounded foundry-only synthesis in a fresh trial directory), `flow/synth.tcl` (the Design Compiler method and the `metrics.tsv` fields) and `flow/read-probe.py` (the hashed reader emitting `clock_period`, `setup_wns`, `cell_area`). `INTENT.md`'s last Golden Flow pointer is the Site's separately staged `flowRoot`, resolved from the Site binding, and that is the directory this Campaign's `<workspace>/flow/` copy was actually taken from: the Run's workspace block records `flowRoot: /data/eda/project/hima_harness/polishing-inputs/aes-probe-748761b052d8`, `design: aes_cipher_top`, container `hima-aes-tsmc28-dtco-20260913-041329-eec9`. The Campaign workspace was `/data/eda/project/hima_harness/polishing-runs/aes-tsmc28-dtco-20260913-041329-eec9`.

## Run

run: run-7505e553-5cb2-4610-aa5d-a84057532031

Goal: `target_period_ns = 0.5` ns, read as *clock period at most*, taken from the author's message (the pack's `Goal template` recommends the same value and declares bounds 0.1..5 ns). Initial Strategy: `periodNs = 0.35` ns, read as *clock period*, also taken from the author's message (equal to the pack's declared default). Run arguments the author gave: `generations = 2`, `retries = 1`, `timeBox = 12` minutes; the Run's row records them as `budget.generationLimit 2`, `budget.retryAllowance 1`, `budget.timeBoxMs 720000`, one Design-Compiler seat. The Run is marked a test run (`purpose: "test"`) of pack version `2`, campaign `aes-tsmc28-dtco-20260913-041329-eec9`, method digest `7ec42e6b1c1742ca14a7a6fe0c01b21964c7882b8c8027f960de6ed1de74ef72`. This conversation owned and drove every node through `hima_run`/`hima_execute`; no other Agent drove the graph. Two Design-Compiler synthesis jobs ran, each under its own 600-second subprocess deadline.

## Ending

status: ended-budget-exhausted

SPEC's `Endings` declares this ending: *Budget exhausted* — "reached when the Loop's `generationLimit` of 2 is spent (the revisit that would open generation three does not happen, with the period it would have tried still on record) or when the Run's own time box expires". The Run's row carries exactly that: `status: ended-budget-exhausted`, `meters.endedBy: "generation-limit"`, with 372474 ms of the 720000 ms time box elapsed, and the period the Run would have tried next (0.335 ns) still on record as decision `#000030`. So the ending this pack declares and the ending the ledger recorded are the same ending, and there is no disagreement to identify. It is reported as an honest incomplete result and never as performance success: neither generation closed setup, so no closed Fmax is claimed. The two measured periods (0.35 ns and 0.341 ns) are asked-and-synthesized periods whose setup constraint FAILed — they are not closure points and not an Fmax.

## Generations

- Generation 1 — asked `periodNs = 0.35` ns. Measured: `clock_period = 0.35` ns, `setup_wns = -0.000969827` ns (mode setup, scope all), `cell_area = 8667.161987` um2, observation `#000010` over `flow/probe.json` content sha256 `6ab68790342ff223f482f9c1ee56ce068b14e74d1aa009158a0b1ff9a8e9fe0d` (7010 bytes). Verdicts: `setup-wns-all-nonnegative@1` **FAIL** (`#000012`, read `-0.000969827 < 0` ns) and `clock-period-at-most@1` **PASS** (`#000013`, read `0.35 <= 0.5` ns, bound `#000010`). Decision `#000015`: next strategy `periodNs = 0.341` ns. Synthesis job `hima-7505e553-synthesize-a46597` exit 0 (81.7 s, trial `trial-6bd9c886f1a040b7bb075f11e736fd0c`); reader job `hima-7505e553-reader-aes-probe-reading-8e4407` exit 0.
- Generation 2 — asked `periodNs = 0.341` ns. Measured: `clock_period = 0.341` ns, `setup_wns = -0.00422013` ns (mode setup, scope all), `cell_area = 9142.181989` um2, observation `#000025` over `flow/probe.json` content sha256 `d4c2605b46c991392423e4d6fa70f23cacf20b2614fc9f3d36fe4d0ec41bb756` (7010 bytes). Verdicts: `setup-wns-all-nonnegative@1` **FAIL** (`#000027`, read `-0.00422013 < 0` ns) and `clock-period-at-most@1` **PASS** (`#000028`, read `0.341 <= 0.5` ns, bound `#000025`). Decision `#000030`: next strategy `periodNs = 0.335` ns; the converge block's `period` read moved 0.009 ns between the two measured periods, not less than its 0.005 ns band, so this was not a converged ending, and the spent generation limit would not let the Run try the chosen period. Synthesis job `hima-7505e553-synthesize-4d7b25` exit 0 (84.7 s, trial `trial-ae034c4170ad4937b05cf6cea8d4e84c`); reader job `hima-7505e553-reader-aes-probe-reading-f3bc4a` exit 0.

## Code

none

## Refusals

none

## Disagreements

none
