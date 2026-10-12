# Analog design in HimaHarness: what the field does and how it maps onto Packs

Research date: 2026-10-12. Question from leadership: can HimaHarness handle analog design, namely
analog migration, spec-driven synthesis, adaptive optimization and expert knowledge capture?
Sources are primary (papers, official repositories at a named commit, vendor product pages, simulator
manuals) plus our own measurements on the lab EDA server. Every claim and link is in the
[evidence file](2026-10-12-analog-design-evidence.md). The one-page answer for leadership is
[here](2026-10-12-analog-leader-answer.md); the Pack design is
[docs/specs/analog-ota-pack/spec.md](../specs/analog-ota-pack/spec.md).

**Bottom line.** All four capabilities fit HimaHarness's existing shape without architecture change.
The mapping is: resident agents propose, the Site's simulator measures, and Readers and judges outside
the agent decide against a spec-sheet Goal within a budget. The designer's method ships as tested
code in the Pack. The research literature converges on that split: the strongest results pair an LLM
with a deterministic optimizer and judge, and the reusable asset in migration is the sizing procedure
plus the testbenches, not the sized netlist.

A first Pack slice is built and tested on branch `demo/analog-ota`:

- It sizes a two-stage OTA from a spec sheet with gm/Id and migrates it to a second process.
- It measures with Cadence Spectre on the lab server.
- It lets the agents iterate in open ngspice, which agreed with Spectre within 0.1 dB, 1 % and
  0.5° on every design checked on the same device decks.

What is not yet there:

- layout;
- Monte Carlo and mismatch;
- a second Spectre-readable open PDK;
- the Site deployment;
- an App run.

## 1. What the field has

| Area | State of the art (evidence file sections) | What it tells us |
| --- | --- | --- |
| gm/Id method | Silveira/Flandre/Jespers 1996; Jespers & Murmann 2017. Open table tooling: mosplot (Apache-2.0, ngspice/HSPICE/Spectre), pygmid (Apache-2.0). Murmann's open starter kits cover SKY130, GF180MCU and IHP (AGPL-3.0). | Inversion level is the process-independent design variable; only the lookup tables change per process. This makes it the natural migration and knowledge-capture vehicle. |
| Generators | BAG2/BAG3: one methodology code base across five commercial nodes, with only the primitives rewritten. Needs Virtuoso; maintenance has been low since 2022–2024. | "Expert method as tested code" is the right abstraction. Borrow the split (procedure / process primitives / testbench), not the framework. |
| Layout | ALIGN (active) and MAGICAL (dormant since 2021) turn a netlist into GDS. gLayout (MIT) produces DRC-clean SKY130/GF180 layouts. | Layout is a separate deterministic step with DRC/LVS/PEX judges. It is not needed for a first slice. |
| BO / RL sizing | BO ~120–900 simulations per circuit (AnalogGym rerun). KATO transfers 180→40 nm with 2.52× fewer simulations. RL needs thousands of simulations. AutoCkt is the only post-layout loop. | Optimizers are pluggable deterministic steps; RL does not fit a budgeted Run. |
| LLM sizing and synthesis | ADO-LLM (LLM + BO, 105 sims, all specs met), LEDRO, AmpAgent, AgenticSizing, EEsizer (agent edits netlist with a simulator). AnalogCoder, AnalogGenie and LaMAGIC generate topologies. | LLMs work best as priors and space-pruners for a deterministic optimizer, and judges are often weak. Most work is schematic-only on ideal or predictive models, with small benchmarks. |
| Migration | Cadence documents the steps: device and parameter mapping, re-bias and re-size, re-centring by optimization, PVT/Monte Carlo, layout regeneration, and designer review. Academic work (CAIRO+/CHAMS, Cachaço 2017) captures the procedure. | Mapping, re-bias and review hold the expertise; the rest is mechanical once the testbenches exist. |
| Commercial flows | **Cadence:** Custom Design Migration, ADE Explorer/Assembler/Artist optimization, ViraStack AI Super Agent (2026). **Synopsys:** ASO.ai migration and RL optimization. **Siemens:** Solido variation/yield, "self-verifying" agents. **Empyrean:** Aether, ALPS, PyAether (12k+ APIs) and Aether Coder; Andes Analog's scope is not public, and no public analog optimizer or migration product exists. | In every vendor flow the tool that proposes also declares the pass. HimaHarness's edge is a verifier outside both the agent and the vendor, plus captured, re-runnable method. Vendor optimizers are steps, not competitors. |
| Open simulators and PDKs | ngspice-47 (BSD), Xyce 7.10 (GPL-3.0). SKY130 (BSIM4, 1.8 V), GF180MCU (BSIM4, 3.3 V) and IHP SG13G2 (PSP via OSDI, 1.2 V) are all Apache-2.0. JKU and IHP AnalogAcademy publish first-party OTA material. No open PDK ships Spectre decks. | A public demo is possible with open data only. Whether Spectre can read a given PDK's decks has to be tested. |

## 2. Four capabilities mapped onto HimaHarness

The concepts referred to below:

- **Graph:** the Pack's graph nodes, i.e. act/judge/explore steps and forks.
- **Resident:** a resident OpenCode agent with its playbook, verified outside the agent.
- **Readers/judges.**
- **Goal/budget.**
- **Knowledge:** knowledge docs and executable method code.
- **Site:** the Site toolchain.

### 2.1 Spec-driven synthesis (sizing; topology from a spec)

| Concept | How it maps | Status |
| --- | --- | --- |
| Graph | `characterize` (tool) → `size-agent` (resident) → `simulate-source` (tool) → `check-source` (judge) | Built (slice 1) |
| Resident | Sizing agent: drafts a first cut from the spec, simulates its own drafts, refines, and delivers sizes only | Built; resident path not yet exercised in the Host |
| Readers/judges | The `ota-design` Reader refuses illegal or matched-pair-breaking designs and any typed performance number. The `ota-source` Reader states the worst corner; the spec rules judge it. | Built |
| Goal/budget | Goal = the spec sheet (gain, GBW, PM, power) judged at the worst corner; strategy = load, input common mode; budget = time box plus round limit | Built |
| Knowledge | `draft intent` (textbook two-stage procedure in gm/Id form) and `draft size` (gm/Id tables → W) are code; the playbook explains the moves | Built |
| Site | Spectre (Cadence) measures; ngspice in the agent sandbox | Checked by hand on the server; Site not deployed |

- **Supported now:** sizing of a fixed topology.
- **A Pack can add:** more topologies (5T, folded cascode, LDO), each a netlist template plus testbench; topology *selection* as a resident choice among templates judged by the same Readers.
- **Needs product change:** nothing for sizing. Free-form topology *generation* (AnalogCoder style) needs only a Reader that refuses unsized or unsimulated circuits; no Harness change.

### 2.2 Migration (port to a new node or PDK)

| Concept | How it maps | Status |
| --- | --- | --- |
| Graph | `migrate-agent` (resident) → `simulate-target` → `record-round` → `judge-round` | Built |
| Resident | Migration agent starts from the gm/Id-preserving port and re-biases for the new supply and devices | Built |
| Readers/judges | The target design must cite the accepted source design by SHA-256; the same testbench and arithmetic judge both PDKs | Built |
| Goal/budget | Same spec sheet at the target supply; round loop with lessons | Built |
| Knowledge | `draft migrate` = device mapping, same gm/Id and currents, lengths at the same multiple of Lmin, widths from the target tables. The migration playbook covers headroom, intrinsic gain and corners. | Built |
| Site | The PDK card states the decks, corners and which simulator reads them | GF180MCU card checked in Spectre and ngspice |

- **Supported now:** schematic-level migration between processes with SPICE models.
- **A Pack can add:** a mapping-table step for multi-device-type PDKs; Monte Carlo/mismatch as an extra judge; layout migration as a deterministic step (gLayout for open PDKs; Virtuoso layout migrate with a customer's OA PDK) with DRC/LVS/PEX Readers.
- **Needs product change:** none for schematic migration. Driving Virtuoso layout migration through its GUI would use the interactive EDA operator work already specified (`docs/specs/interactive-eda-v1`).

### 2.3 Adaptive optimization (closed-loop sizing against simulation)

| Concept | How it maps | Status |
| --- | --- | --- |
| Graph | The `next-round` explore node revisits the sizing agent with verified lessons; inside a round the agent runs its own simulate-and-refine loop | Built |
| Resident | The agent iterates with the Pack's own `sim` command (same testbench, same arithmetic) in its sandbox | Built |
| Readers/judges | The Pack re-simulates every delivery; the agent's own numbers are never results | Built |
| Goal/budget | Converge on the best worst-case margin; generation limit 3; time box | Built |
| Knowledge | Playbook tables (symptom → cause → move) | Built |
| Site | Simulation is cheap: about 3 s for a 3-corner Spectre run including the container start | Measured |

- **Supported now:** agent-in-the-loop optimization with external verification.
- **A Pack can add:** a deterministic optimizer step (BO/TuRBO, or a vendor optimizer where a customer has one) that the agent seeds and bounds (the ADO-LLM/LEDRO pattern). This is a tool node plus a Reader, with no Harness change.
- **Needs product change:** possibly Site licence accounting if a Pack fans out many Spectre jobs. The Site schema already has `capacity.licences`; whether the Harness enforces it for tool Jobs needs checking before a large optimizer step.

### 2.4 Expert knowledge (capturing designers' know-how)

| Concept | How it maps | Status |
| --- | --- | --- |
| Knowledge | **Executable:** the gm/Id procedure, the first-cut equations, the port and the legality gate (tested code). **Prose:** playbooks (moves, pitfalls). **Data:** PDK cards (device names, corners, limits). | Built |
| Readers/judges | The judge encodes the senior designer's acceptance (worst corner, saturation margin, no typed numbers) | Built |
| Archive | Run reports and lessons go to the Pack archive via the existing knowledge-asset path | Existing product path; not exercised for this Pack |

- **Supported now:** method as code, playbooks and PDK cards.
- **A Pack can add:** a designer's own scripts as additional `draft` kinds, under the same precheck. Captured knowledge stays versioned and regression-tested, which the literature does not do (evidence §A.10).
- **Needs product change:** none.

### 2.5 What would need product changes (all optional for the first demo)

1. **Curve charts.** `hima-chart/1` has only `bar` and `metrics`. A Bode plot, gm/Id design curves or a corner spread want a `line` kind (`charts.ts` plus the client). Today the Pack shows tables.
2. **Commercial simulator inside the agent sandbox.** Residents run in the open-tools image, so they iterate with ngspice. Giving them Spectre would be a Site capability change (the EDA container plus licence in the sandbox), not a Harness change, and the correlation we measured makes it unnecessary for BSIM4 PDKs.
3. **Licence-aware fan-out**, if optimizer or Monte Carlo steps run many simulations in parallel (see 2.3).
4. **Schematic or netlist viewing** in the App, a nice-to-have for designers reviewing an agent's circuit.

## 3. The lab EDA server, checked read-only on 2026-10-12

- **Analog tools installed:**
  - Cadence Spectre 23.1 and Virtuoso IC 23.1 / IC 6.1.8, with ADE Explorer/Assembler and optimizer features in the licence;
  - Synopsys HSPICE and PrimeSim X-2025.06;
  - Keysight ADS.
- **Empyrean:** only QuaLib, XTop, Mage (mask/reticle composition) and the Liberty API. **No Empyrean analog tool (Aether, ALPS) is installed.**
- **Open tools:** ngspice, Xyce and OpenVAF are not on the host. All three are in the resident sandbox image (IIC-OSIC-TOOLS 2026.06: ngspice 46, Xyce, OpenVAF), together with SKY130A, GF180MCU-D and IHP SG13G2.
- **What Spectre reads** (one job at a time, in a temporary directory, Cadence licence only):

  | PDK decks | In Spectre 23.1 |
  | --- | --- |
  | Synthetic BSIM4 test decks | Simulate. The Pack CLI end to end gives the same printed worst corner as ngspice 47: source 65.2 dB / 11.98 MHz / 69.4° / 161.6 µW. |
  | GF180MCU 3.3 V `.spice` decks (device sections loaded per corner) | Simulate. The Pack's gm/Id characterization and a three-corner OTA run give 92.1 dB / 10.7 MHz / 63.3° / 218.2 µW at the worst corner. ngspice 46 in the sandbox gives the same worst corner. |
  | SKY130 | Fail: the decks use ngspice brace expressions. A mechanical conversion still leaves 392 errors. |
  | IHP SG13G2 | Not usable as shipped: `.if` subcircuits and OSDI `N` devices. |

- **Consequence:** with "use commercial tools" (user, 2026-10-12), the Site measures with Spectre wherever the PDK reads in Spectre, which today means GF180MCU and the test decks. An open target PDK is measured with ngspice, or the target is a customer's own Spectre PDK at their Site.

## 4. Risks and open questions

- **Vendor overlap.** Cadence ViraStack already claims agentic migration and optimization inside Virtuoso, and Synopsys ASO.ai claims 10,000 optimizer searches in about 2 h. HimaHarness should not sell "a better optimizer". It sells an independent verifier, budget and evidence, captured method, and vendor neutrality. On Empyrean-only customers there is a real gap today (no public analog optimizer or migration product), watched against Andes Analog and Aether Coder.
- **Schematic-only claims.** A design that meets the spec in schematic simulation is not migrated silicon. The Pack's claim boundary says so on every record. Layout, PEX and Monte Carlo are later slices.
- **Second Spectre PDK.** No second open PDK reads in Spectre. A public all-Spectre migration demo needs either a converted deck (SKY130 conversion failed; IHP would need a PSP wrapper) or a mixed-simulator demo (GF180MCU in Spectre → IHP in ngspice). A customer demo would use their foundry PDK at their Site; it must never enter this public repo.
- **Agent quality on DeepSeek Flash** for the sizing loop is untested. The Pack's draft commands do most of the arithmetic, so the agent's job is choosing gm/Id, L and currents and reading corners.
- **PSP saturation check.** The saturation gate reads Vdsat. PSP-based IHP devices name their operating-point outputs differently, which has to be checked before an IHP card is used.

## 5. Recommendation

1. Demo the OTA Pack with GF180MCU 3.3 V as the source, measured by Spectre. For the target, choose one of:
   - IHP SG13G2 1.2 V measured by ngspice (mixed simulators, all open data);
   - the synthetic 130 nm-class test process (all Spectre, but not a real process).
2. In the same Pack, add an LDO as the second circuit card, then a BO step seeded by the agent, then Monte Carlo as a judge.
3. Pitch to customers on their own PDK at their Site: Spectre or ALPS as the measuring simulator, verify outside the vendor, and keep the method as code.
