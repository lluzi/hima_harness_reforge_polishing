# Tests

Real PDKs are installed per Site and never in git. The tests run the Pack's steps on two synthetic
BSIM4 processes (`test/fixtures/analog-pdks/`, made up, 1.8 V and 1.2 V).

- `test/contract/analog-ota-migrate.test.ts` (group `local`, no simulator): the Pack loads at stage
  compiled (0.1.0, four Goal lines with their defaults, headline `target_margin_pct`, two result
  columns), no "mock" or "model" in any word the App shows; both resident agents with
  `artifactPrefix: reports/<node id>` and their knowledge; the graph (the source judge's PASS to the
  migration agent, FAIL/UNDETERMINED to the record; the revisit to the sizing agent); the strip places
  every node once; every argv name bound; the harness's own `choose` on `ota-next` for goal met,
  a missed line, an invalid round before any valid round and an undetermined goal.
- The same file, offline: the Spectre adapter reads the committed Spectre output (operating points,
  supply power, the AC sweep, a characterization sweep) and agrees with an independent reading; the
  AC arithmetic recovers gain, unity-gain frequency and phase margin of a known two-pole response and
  answers unknown for a response that is not flat or not in phase at the sweep start; the PSF reader
  keeps every struct whatever their order; the IHP-to-Spectre install tool on a made-up file set in
  IHP's shape (type n/p, version 103.6, no SOA limits, RF cards or ngspice conditionals, the five
  corner sections including the Spectre devices).
- `test/contract/analog-ota-migrate-sim.test.ts` (group `analog-sim`, real ngspice; the binary is
  `HIMA_NGSPICE` or `ngspice` on PATH; without one the tests are skipped and say so): bind and
  characterize both synthetic PDKs; the first cut from the spec; refusals (a length below the
  minimum, a mismatched pair, a typed gain, a number in the intent, devices that do not follow the
  intent, a wrong report path, a target citing the wrong SHA-256, an analysis not in the agent's
  workspace); a textbook first cut that misses GBW is not migrated and its round says why; a source
  design accepted and simulated at three corners with every value a Reader emits; the naive port
  missing the spec at the 1.2 V process; a re-biased port meeting it; the round record and the Goal
  verdict the round Reader gives; every chart validates against `himaChart`; ngspice and the
  committed Spectre output agree on the same OTA at the same corner; three `sim` attempts into one
  folder each get their own files.
