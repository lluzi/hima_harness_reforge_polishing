## Files written

- `contract.yml` (0.1.0; Goal: four spec lines; strategy: load, input common mode, round counter;
  results: source vs migrated design at the worst corner, headline `target_margin_pct`),
  `graph.yml` (the strip view: simulator and judges, sizing agent, migration agent),
  `semantics.yml`.
- `flow/ota_cli.py`: two simulator adapters (Cadence Spectre: Spectre-language netlist with the
  PDK's SPICE decks, PSF ASCII output; ngspice: batch netlist, wrdata output), one measurement
  arithmetic for both (gain, unity-gain frequency and phase margin from the AC response; saturation
  from the operating point); bind, characterize (gm/Id tables by DC sweep), design (delivery check),
  simulate (the corner testbench), record (round record, lessons, summary), draft (intent from the
  spec, size from an intent, the gm/Id-preserving port, keep), precheck, sim (the testbench on an
  agent's own draft). `flow/pdks.json`: PDK cards (`synth180`, `synth130`, `gf180mcuD`).
- `tools/read-{tables,design,measure,round}.py` with `readers/ota-{tables,design,source,round}.yml`;
  `rules/*.yml` (nine); `choosers/ota-next.yml`; `knowledge/*.md` (five).
- Outside the Pack: `test/fixtures/analog-pdks/` (the synthetic PDKs), `test/fixtures/analog-spectre/`
  (Spectre 23.1 output on the synthetic PDKs, for the offline parser tests) and
  `test/contract/analog-ota-migrate*.test.ts`.

## Gaps

- Real-PDK cards: `gf180mcuD` and `ihp-sg13g2` (checked by hand on the EDA server, below; not in a
  repository test, because the PDKs are installed per Site). IHP's Spectre deck is the Site's
  conversion (`sites/analog_sim_01/install/ihp_spectre.py`), not IHP's release. No `sky130A` card:
  SKY130's decks do not read in Spectre.
- No Site yet: the analog Site (the Spectre wrapper through the Site's EDA container, ngspice in the
  pinned tool image, the PDK install, the Permit and the resident capability) is the next slice,
  after the user approves server writes. Cadence ADE optimization and layout migration need a
  Virtuoso PDK (OpenAccess libraries); no open PDK on the server has one.
- The resident path (both agents through the production wrapper and the ACP stand-in) is not yet
  covered by a Host dry-path test (slice 2).
- Schematic level only: ideal bias source, Cc, Rz and load; no layout, parasitics, mismatch or
  Monte Carlo. One topology.

## Reviews

- By hand on the EDA server (2026-10-12, temporary directory, removed after): GF180MCU 3.3 V →
  IHP SG13G2 1.2 V, two rounds of the Pack's CLI, all in Spectre 23.1. Round 1: the GF180MCU
  source meets the spec (92.1 dB, 11.63 MHz, 61.5 deg, 188.7 uW). The naive gm/Id port reaches
  46.8 dB at 1.2 V (margin -21.98 %). Round 2: the re-biased port reaches 62.8 dB, 14.79 MHz,
  70.9 deg, 144.9 uW (margin 4.67 %). ngspice 46 on IHP's own OSDI deck gives the same worst corner
  for the re-biased port.

- Independent review (Claude Opus 5.5, 2026-10-12) of 629388c2: two blockers fixed. (1) A judge
  takes its edge from its first rule only, so `check-source` led by `devices-saturated` would have
  migrated a saturated source that missed GBW; it now leads with `source-meets-spec`, and a round is
  valid only when its source met the spec. (2) The chooser weighs the judge's first two rules, so
  `judge-round` now has `round-valid` then the composite `target-margin`, a clause for an
  undetermined goal, and a converge read that is always known (-100 before the first valid
  round). Also fixed: a crash and a false "improved" on an unknown margin; phase margin and gain are
  unknown, never shifted, when the response is not flat and in phase at 0.1 Hz; the PSF reader
  missed every struct after the first (`) PROP(` terminator); a later attempt never reads an earlier
  attempt's output (fresh names, a completion marker); the intent is choices only and the devices
  must follow it; chart sources name the measuring simulator; the round records the port's movement
  and the unsaturated devices per corner; the pmos curve labels. Not changed: the migration agent's
  `reads` (the per-device lessons carry what round 2 needs, and a target output does not exist in
  round 1); `bind` still asks every bound simulator to answer.
- Re-review of 5c00f979 (same reviewer): both blockers and the should-fix items confirmed fixed; two
  issues the fixes introduced are fixed in the next commit: attempt files now share one stem per run
  (`ota-tt.attempt-3.cir`, `ota-tt.attempt-3-ac.dat`, `ota-tt.attempt-3.raw`), and `converge` needs
  three flat moves so three never-valid rounds end at the round limit, not "converged" on the -100
  floor (the report says "none yet"). A margin is withheld when a measurement is not of the accepted
  design or conditions; an unknown source verdict is worded as unknown. Spectre path rerun by hand on
  the server after the fixes: same numbers; the temporary directory was removed.

- By hand on the EDA server (2026-10-12, temporary directory, one job at a time, Cadence licence
  only): the Pack's CLI end to end with Spectre 23.1 on the synthetic pair, the same worst corners as
  ngspice 47 (source 65.2 dB, 11.98 MHz, 69.4 deg, 161.6 uW; re-biased port 62.6 dB, 13.63 MHz, 68.2
  deg, 96.7 uW; round 2 margin 4.31 %); GF180MCU 3.3 V characterized in Spectre (gm/Id up to 27.7 /V
  nmos) and the textbook first cut simulated at three corners: 92.1 dB, 10.7 MHz, 63.3 deg, 218.2 uW
  worst corner, every device saturated, with the same worst corner from ngspice 46 in the resident
  sandbox image.

- `test/contract/analog-ota-migrate.test.ts` (group `local`): the Pack loads at stage compiled with
  plain words; both resident agents' outsourcing; graph shape and strip; argv bindings.
- `test/contract/analog-ota-migrate-sim.test.ts` (group `analog-sim`, needs ngspice): one round of the
  Pack's deterministic steps on the synthetic PDKs with real ngspice, and the refusals.
