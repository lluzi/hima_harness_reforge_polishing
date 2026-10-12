# Analog OTA Pack: spec-driven sizing and migration with the simulator in the loop

Status: design accepted for slice 1 by the main agent on 2026-10-12, under the user's brief:
"spec-driven sizing plus migration with adaptive optimization; agents propose, the Site's simulator
measures; expert knowledge as playbooks and executable method code; use commercial tools, we have
the Cadence analog toolchain". Slice 1 is built and tested on branch `demo/analog-ota` (Pack 0.1.0,
commit 629388c2). The later slices are a plan, not results. Research basis:
[analog research](../../research/2026-10-12-analog-design-for-himaharness.md).

## User scenario

An analog designer (or an FDE demonstrating HimaHarness to one) opens the App, installs the Pack
`analog-ota-migrate`, picks the analog Site, and states a spec sheet:

| Spec line | Value |
| --- | --- |
| DC gain | >= 60 dB |
| Unity-gain frequency | >= 10 MHz |
| Phase margin | >= 60 deg |
| Power | <= 200 uW |
| Load | 2 pF |
| Input common mode | 60 % of supply |

The Campaign then runs as follows:

1. It characterizes both processes.
2. A sizing agent sizes a two-stage Miller OTA in the source PDK.
3. The Site simulator verifies it at every corner.
4. A migration agent ports it to the target PDK and re-biases it for the new supply.
5. The simulator verifies the port.
6. The Campaign ends with a before/after table against the spec sheet, or with another round
   carrying verified lessons.

The designer sees each agent's reasoning and tries, the simulator's numbers, and why a naive port
failed.

## Current evidence

- **Product shape.** The reference Pack `packs/andes-cell-fmax` (branch `demo/andes-openc910`)
  provides the layout to copy:
  - resident agents through `outsourcing` (`role: resident-engineering-agent`, `produces`,
    `artifactPrefix`, `knowledge`);
  - Readers that re-ask the tools;
  - a strip `view` and `reports.dir`;
  - `draft`/`precheck` commands so agents never type tool numbers;
  - an explore loop.

  `packs.ts` validates every construct used here. The analog Pack loads at stage `compiled`.
- **Simulators** (lab server, 2026-10-12; [evidence D](../../research/2026-10-12-analog-design-evidence.md)):
  - Cadence Spectre 23.1 is installed and licensed, and runs through the EDA container (`edarun`).
  - ngspice-46 is in the resident sandbox image.
  - Spectre reads GF180MCU and the synthetic decks as shipped. It reads IHP SG13G2 after
    `sites/analog_sim_01/install/ihp_spectre.py`, which matches IHP's own OSDI deck to the printed
    digit. It does not read SKY130.
  - Spectre and ngspice agree within 0.1 dB, 1 % and 0.5° on every design checked on the same BSIM4 decks.
- **No Empyrean analog tool** (Aether/ALPS) on the lab server.

## Behaviour ownership

| Behaviour | Owner | Interface |
| --- | --- | --- |
| Method: topology template, gm/Id characterization, first cut, port, legality, measurements, round record | Pack (`flow/ota_cli.py`) | CLI commands bound in `contract.yml` tools |
| Which PDK files and which simulator per PDK | Pack (`flow/pdks.json` cards) + Site (`simulators`, `pdkRoot` bindings) | `bind` writes `state/inputs.json` |
| Acceptance | Pack Readers (`tools/read-*.py`) + rules + chooser | existing Reader/judge/explore contract |
| Running agents | existing resident engineering Host path | `outsourcing` in `contract.yml` |
| Running simulators | Site toolchain wrappers | commands named in the `simulators` binding |
| Charts, reports | Pack (`reports/<node>/r<k>/`, `hima-chart/1`) | existing Reports tab and `hima_chart` |

No Harness module changes. New files only: the Pack, its tests and fixtures, and (slice 3) a Site
folder.

## Design

### Circuit and testbench

The circuit is a two-stage Miller OTA: NMOS input pair M1/M2, PMOS mirror M3/M4, tail M5, PMOS
common-source M6, sink M7, bias diode M8, with Miller Cc plus nulling Rz. The bias current, Cc, Rz
and the load are ideal.

The testbench is open loop: a 1 GH inductor gives DC unity feedback and a 1 F capacitor grounds the
inverting input for AC. The non-inverting input sits at the input common mode with an AC magnitude
of 1.

Per corner, the testbench measures:

- gain at 0.1 Hz (unknown unless the response is flat and in phase there);
- unity-gain frequency (log-log interpolation where |H| falls through 1);
- phase margin = 180 + (phase at unity gain − phase at 0.1 Hz), with the phase unwrapped;
- supply power;
- each device's Vds, Vdsat, Id, gm and gds; saturated means |Vds| ≥ |Vdsat| + 50 mV.

The worst corner is the minimum gain, GBW and PM and the maximum power. Any unknown makes the worst
value unknown.

### Simulator adapters

Two adapters share one measurement arithmetic.

| | Spectre | ngspice |
| --- | --- | --- |
| Netlist | Spectre language, with the PDK decks under `simulator lang=spice` | SPICE |
| Characterization sweep | `dc dev=VG lin=N` with op-parameter saves | `dc` with `@m[...]` vectors and `wrdata` |
| Testbench analyses | `dcop`, `info what=oppoint`, `ac` | `op`, echoed op parameters, `ac`, `wrdata` |
| Output | PSF ASCII | text |

Each PDK card lists the simulators that read its decks, in order of preference. `bind` picks the
first one the Site has, so Spectre measures where it can. Agents run the same testbench and
arithmetic in their sandbox through `sim`, with `OTA_SIM=ngspice` and `OTA_PDK_ROOT=/foss/pdks`.

### The design file (`hima-ota-design/1`)

The design file carries:

- `stage`, `pdk`, `topology`, `round`;
- `ibiasUa`, `ccPf`, `rzKohm`;
- `devices` M1 to M8 as `{wUm, lUm}`;
- an optional `intent` (the gm/Id choices);
- `migratedFrom {pdk, sha256}` (target only);
- `summary`, `reason`, `report`.

Precheck and the Reader refuse:

- any other field, so a typed gain is refused;
- sizes outside the card's limits or off its grid;
- unmatched pairs;
- out-of-range bias or compensation;
- a missing analysis report;
- a target design not citing the accepted source by SHA-256.

### Executable method (`draft`)

| Kind | Input | What it computes |
| --- | --- | --- |
| `intent` | the spec sheet | Textbook first cut: Cc = 0.3 CL; gm1 = 2π·GBW·Cc·1.25 at gm/Id 15; gm6 = max(2.5·2π·GBW·CL, 10·gm1) at gm/Id 10; Rz = 1/gm6; mirrors at gm/Id 12; L ≈ 3 Lmin. |
| `size` | an intent | W = Id / (Id/W) from the source tables. The tail, sink and bias mirror share gm/Id and L; M6 takes the load's gm/Id and L (zero systematic offset). |
| `migrate` | the accepted source design | Same gm/Id and currents; L at the same multiple of Lmin, snapped to a characterized length; W from the target tables. |
| `keep` | last round's accepted source design | The same design, re-issued for this round. |

### Graph

```
bind-inputs → characterize → read-tables → check-tables ─PASS→ size-agent → simulate-source → read-source → check-source
check-source ─PASS→ migrate-agent → simulate-target → record-round
check-source ─FAIL/UNDETERMINED→ record-round
record-round → read-round → judge-round → next-round ─revisit→ size-agent
check-tables ─FAIL/UNDETERMINED→ blocked
```

There are four autopilot segments, and the owner drives the two resident nodes. A judge takes its edge
from its first rule and a chooser weighs the judge's first two, so:

- `check-source` leads with `source-meets-spec`: every Goal line at the worst corner with every
  device saturated, stated by `simulate-source`, which is given the Goal.
- `judge-round` leads with `round-valid` (the source met the spec; both measurements are of the
  accepted designs with the same load, common mode and spec; the migrated OTA is saturated and
  fully measured), then `target-margin` (worst normalized margin ≥ 0).
- The per-line rules (`gain-spec`, `gbw-spec`, `pm-spec`, `power-spec`, `devices-saturated`) follow
  for the record. Chooser `ota-next`:
goal met, or another round. Generation limit 3 (convergence is declared but needs four rounds, so the limit ends a Campaign that misses the Goal); 2 h time box.

### Results the App shows

- **Headline:** the worst spec margin after migration.
- **Table columns:** Source PDK (Reader `ota-source`) and Target PDK (Reader `ota-round`).
- **Table rows:** gain, GBW, PM and power at the worst corner, plus active area.
- **Charts** (metrics tables; `hima-chart/1` has no curve kind):
  - gm/Id design curves per PDK;
  - corners per simulated design;
  - the before/after migration table.
- **Words:** no "mock" or "synthetic" on screen; the claim boundary in every record.

## Preserved

- Harness modules, schemas and the reference Pack stay unchanged.
- No foundry or customer data enters the repository. Open PDKs are installed per Site; the
  synthetic test decks are made up.
- The lab server: no writes outside our own project area, no licence switching (Spectre uses the
  running Cadence licence), at most three jobs.

## Slices

| Slice | Content | Test level | Status |
| --- | --- | --- | --- |
| 1 | Pack 0.1.0: method, adapters, Readers, rules, chooser, playbooks; synthetic PDKs; GF180MCU and IHP SG13G2 cards; independent review fixes | L0/L1/L2 local (`local`: 12 tests, about 1.5 s), real ngspice (`analog-sim`: 9 tests, about 10 s); Spectre by hand on the server | **Done** |
| 2 | Resident dry path: both agents through the production resident wrapper with the ACP stand-in, in the in-process Host (pattern: `andes-cell-fmax-dry-path.host.test.ts`); refused deliveries repaired in the same task; goal met in round 2 after a naive port | L2 Host (`analog-dry` group) | Next |
| 3 | Site `analog_sim_01` (needs user approval for server writes under our project area). Contents: the Spectre wrapper through `edarun`; the ngspice wrapper through the pinned sandbox image; PDK install (GF180MCU and IHP SG13G2 from the image, plus the IHP Spectre conversion); Permit; resident capability (sandbox image with `/foss/pdks`); `simulators: spectre=…,ngspice=…`. The SSH destination is an alias, not an IP. | L4 live-site: bind, characterize, one round by hand, then `analog-ota-migrate.live.test.ts` | Needs approval for server writes |
| 4 | Target PDK: **decided** (user, 2026-10-12, "Spectre and open PDK"): IHP SG13G2 1.2 V, measured by Spectre through the converter. Card `ihp-sg13g2` (lengths to 3.12 µm, 10 µm per finger, `vdss` as Vdsat). By hand on the server: GF180MCU → IHP two rounds all in Spectre (naive port 46.8 dB, margin −22 %; re-biased 62.8 dB, margin +4.7 %). | L4 by hand | **Done** (card and converter); the live test comes with slice 3 |
| 5 | App run on Catsights with DeepSeek Flash residents; one take; demo panels per milestone from the run's reports | L5 | After 2 to 4 |
| Later | LDO card; BO/TuRBO optimizer step seeded by the agent; Monte Carlo and mismatch judge; curve charts (product change in `charts.ts`); layout (gLayout for open PDKs, Virtuoso with a customer OA PDK) with DRC/LVS/PEX Readers | per slice | Not started |

## Acceptance examples

**Pass:**

- On the synthetic pair, the textbook source design meets the spec at all three corners.
- The naive port misses at 1.2 V (tail device out of saturation, GBW short).
- In round 2 the re-biased port meets every line (margin 4.31 % in Spectre and ngspice), and the
  round Reader emits `round_valid` 1 and `specs_met` 4.

**Refusals:**

- a length below the minimum;
- M1 ≠ M2;
- a W off the grid;
- a typed `gainDb`;
- a wrong round;
- a missing device;
- Cc out of range;
- a target without `migratedFrom`;
- a design edited after its simulation (the round becomes invalid).

## Rollback

Delete the branch `demo/analog-ota`, or revert its commits from 629388c2 on. Nothing outside the new files
changed except `test/contract-groups.json`, which gains two entries.

## Model allocation

| Role | Model |
| --- | --- |
| Research workers and the independent reviewer | Claude Opus 5.5 subagents (per `docs/agents/model-policy.md`, Claude sub-agents are Opus 5.5) |
| Main implementation | Claude Opus 5.5 |
| Product residents | DeepSeek 4.1 Flash, unchanged |

Slices 2 and 3 are well specified and can go to one implementation worker plus one reviewer.
