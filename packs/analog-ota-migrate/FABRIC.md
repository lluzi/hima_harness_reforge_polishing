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

- Real-PDK cards: `gf180mcuD` only (checked by hand on the EDA server, below). `ihp-sg13g2` (ngspice
  with PSP through OSDI; operating-point names for the saturation check) and `sky130A` (ngspice, its
  `.spiceinit`) are not written: SKY130 and IHP decks do not read in Spectre (SKY130's brace
  expressions, IHP's `.if` subcircuits and OSDI devices).
- No Site yet: the analog Site (the Spectre wrapper through the Site's EDA container, ngspice in the
  pinned tool image, the PDK install, the Permit and the resident capability) is the next slice,
  after the user approves server writes. Cadence ADE optimization and layout migration need a
  Virtuoso PDK (OpenAccess libraries); no open PDK on the server has one.
- The resident path (both agents through the production wrapper and the ACP stand-in) is not yet
  covered by a Host dry-path test (slice 2).
- Schematic level only: ideal bias source, Cc, Rz and load; no layout, parasitics, mismatch or
  Monte Carlo. One topology.

## Reviews

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
