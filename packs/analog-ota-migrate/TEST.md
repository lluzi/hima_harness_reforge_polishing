# Tests

Real PDKs are installed per Site and never in git. The tests run the Pack's steps on two synthetic
BSIM4 processes (`test/fixtures/analog-pdks/`, made up, 1.8 V and 1.2 V).

- `test/contract/analog-ota-migrate.test.ts` (group `local`, no simulator): the Pack loads at stage
  compiled (0.1.0, four Goal lines with their defaults, headline `target_margin_pct`, two result
  columns), no "mock" or "model" in any word the App shows; both resident agents with
  `artifactPrefix: reports/<node id>` and their knowledge; the graph (the source judge's PASS to the
  migration agent, FAIL/UNDETERMINED to the record; the revisit to the sizing agent); the strip places
  every node once; every argv name bound.
- The same file, offline: the Spectre adapter reads the committed Spectre output (operating points,
  supply power, the AC sweep, a characterization sweep) and agrees with an independent reading; the
  AC arithmetic recovers gain, unity-gain frequency and phase margin of a known two-pole response.
- `test/contract/analog-ota-migrate-sim.test.ts` (group `analog-sim`, real ngspice; the binary is
  `HIMA_NGSPICE` or `ngspice` on PATH; without one the tests are skipped and say so): bind and
  characterize both synthetic PDKs; the first cut from the spec; refusals (a length below the
  minimum, a mismatched pair, a typed gain, a target design that does not cite the source); a source
  design accepted and simulated at three corners with every value a Reader emits; the naive port
  missing the spec at the 1.2 V process; a re-biased port meeting it; the round record and the Goal
  verdict the round Reader gives; every chart validates against `himaChart`; ngspice and the
  committed Spectre output agree on the same OTA at the same corner.
