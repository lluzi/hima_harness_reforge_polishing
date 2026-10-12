# Analog design for HimaHarness: evidence appendix

Date: 2026-10-12. Main text: [research](2026-10-12-analog-design-for-himaharness.md); leadership
answer: [one page](2026-10-12-analog-leader-answer.md). This file keeps the research contract, the
server checks and the three source reports as the research workers wrote them (primary sources,
links at a named commit or page, "Inference:" marking reasoning). It is evidence, not product
specification.

## Research contract

- **Question:** can HimaHarness handle analog migration, spec-driven synthesis, adaptive optimization
  and expert knowledge capture; how each maps onto Pack graph nodes, resident agents with playbooks,
  Readers/judges, Goal and budget, knowledge and executable method, and the Site toolchain; what
  exists, what a Pack can add, what needs product changes.
- **Scope:** academic and open-source automation (A), migration approaches and commercial flows (B),
  open simulators and PDKs usable for a public demo (C), and a read-only check of the lab EDA server
  (D). Primary sources only.
- **Method:** three research workers (Claude Opus 5.5, web, read-only) wrote A, B and C; the main
  agent checked the server and ran the probes in D, then synthesized.
- **Out of scope:** licence switching (the user's), writes to other users' projects, proprietary PDK
  or foundry data (never in this repository).

## D. Lab EDA server checks (2026-10-12)

All checks were read-only except the probes, which ran one job at a time in a temporary directory
under `/tmp` on the server, using the Cadence licence only (no Empyrean licence switch).

**Installed analog tools.**

- Cadence Spectre 23.1 (`spectre -V`: 23.1.0 64bit, ISR15) and Virtuoso IC 23.1 / IC 6.1.8. The
  Cadence licence includes ADE Explorer/Assembler/Verifier, optimizer, variation, layout-migrate and
  Spectre X/XPS features; only the feature names were read.
- Synopsys HSPICE, PrimeSim, FineSim and XA X-2025.06; Siemens Eldo; Keysight ADS.
- Empyrean: QuaLib 2025.09/2026.06, XTop 2025.09, Mage 2026.06 (mask/reticle composition, per its
  own guide on the server), Liberty API 2026. **No Aether or ALPS.**

**Open tools and PDKs.**

- None on the host (no ngspice, Xyce or open PDK).
- The resident sandbox image (IIC-OSIC-TOOLS 2026.06 derivative) has:
  - ngspice-46, Xyce, OpenVAF, VACASK, PyOPUS, Python 3.12 with numpy 2.5 and scipy 1.18;
  - `/foss/pdks/{sky130A, gf180mcuD, ihp-sg13g2, ihp-sg13cmos5l}` at open_pdks b344c97e.
- No PDK in the image ships Spectre decks (`libs.tech` lists ngspice, xyce, qucs-s, vacask and
  verilog-a only).

**Spectre against open PDK decks.**

| Probe | Result |
| --- | --- |
| Synthetic BSIM4 deck with ngspice brace expressions | Refused (`{}` is not Spectre SPICE syntax); fixed in the fixtures with `'expr'`, which both simulators read |
| Synthetic OTA, op + oppoint info + AC | Runs; PSF ASCII; `Virtuoso_Spectre` feature checked out; 0.36 s |
| GF180MCU, `sm141064.spice` `typical` section | Refused: duplicate `nfet_03v3` (the `fets_mm` section's subcircuit) |
| GF180MCU, sections `nfet_03v3_t`, `pfet_03v3_t` | Refused: `nfet_03v3_noia` undefined |
| GF180MCU, plus `noise_corner` | Runs: nfet_03v3 W 10 um L 0.5 um at Vgs 0.9 V, Vds 1.65 V: Id 73.5 uA, Vth 0.712 V |
| SKY130 `combined/sky130.lib.spice tt` | Refused: brace expressions |
| SKY130 after brace-to-quote conversion | 392 errors (nested expressions); abandoned |
| IHP SG13G2 as shipped | Not readable: the decks use ngspice `.if` subcircuits and OSDI `N` devices (PSP); the model cards themselves are Spectre-style (quoted expressions) |
| SAED14 educational kit | No transistor SPICE models (only a model PDF) |
| IHP SG13G2 through `ihp_spectre.py`: cards on Spectre `psp103` | Runs; first attempt reported every NMOS as `ctype -1`: Spectre reads `type = +1` as p, so the converter writes `type=n/p`; SOA limits and `dta` dropped (Spectre warnings) |
| Same, NMOS/PMOS W 1 um L 0.13 um at +/-0.6 V | Spectre 18.36885 / 12.75485 uA; ngspice 46 with IHP's OSDI deck 18.36885 / 12.75485 uA |

**The Pack's CLI on the server (`ota_cli.py`, commit 629388c2).** The same values were measured
locally with ngspice 47, and the local tests assert them.

| Run | Simulator | Worst corner (gain dB / GBW MHz / PM deg / power uW / saturated) |
| --- | --- | --- |
| synth180 source, round 1 | Spectre 23.1 | 65.2 / 11.98 / 69.4 / 161.6 / yes |
| synth130 naive gm/Id port | Spectre 23.1 | 61.3 / 8.75 / 73.1 / 98.9 / no (tail device) |
| synth130 re-biased port, round 2 | Spectre 23.1 | 62.6 / 13.63 / 68.2 / 96.7 / yes; margin 4.31 % |
| GF180MCU first cut from the spec | Spectre 23.1 | 92.1 / 10.7 / 63.3 / 218.2 / yes |
| GF180MCU first cut, same files | ngspice 46 in the sandbox image | 92.1 / 10.7 / 63.3 / 218.2 / yes |

| GF180MCU source, round 1 (spec 60 dB / 10 MHz / 60 deg / 200 uW) | Spectre 23.1 | 92.1 / 11.63 / 61.5 / 188.7 / yes |
| IHP SG13G2 naive gm/Id port | Spectre 23.1 | 46.8 / 10.45 / 77.2 / 93.3 / yes; margin -21.98 % |
| IHP SG13G2 re-biased port, round 2 | Spectre 23.1 | 62.8 / 14.79 / 70.9 / 144.9 / yes; margin 4.67 % |
| IHP re-biased port, same files | ngspice 46 (IHP OSDI deck) in the sandbox image | 62.8 / 14.79 / 70.94 / 144.94 / yes |

- GF180MCU characterization in Spectre: nmos gm/Id 0.4 to 27.7 /V, Id/W up to 477 uA/um at
  L 0.28 um; pmos up to 26.5 /V.
- Wall time: about 3 s to characterize both PDKs (four Spectre runs through the EDA container) and
  about 3 s per three-corner simulate step.
- Operating points of the GF180MCU first cut at tt land on the requested gm/Id (14.98, 9.89, 11.9
  against 15, 10, 12).



---

## A. Academic and open-source analog design automation

Retrieved 2026-10-12. The sources are papers (arXiv, IEEE, ACM, PMLR) and official GitHub repositories. Repository claims cite the head commit I read through the GitHub API on the retrieval date. Abstracts for some IEEE and ACM papers came from the Semantic Scholar index because the publisher page did not render; each such case says so. "Inference:" marks my own reasoning.

The four HimaHarness capabilities are written as **MIG** (migrate to a new PDK), **SYN** (synthesis from a spec), **OPT** (closed-loop sizing) and **KNOW** (knowledge capture). **Pattern fit** asks whether the work splits into three parts: the agent proposes, a deterministic simulator measures, and an external judge verifies.

---

### 1. gm/Id methodology and lookup-table tooling

**What it is.** Silveira, Flandre and Jespers proposed a sizing method built on the relation between gm/ID and normalized current ID/(W/L). It treats all inversion regions in one framework, and they demonstrated it on an SOI micropower OTA ([JSSC 31(9), 1996, doi:10.1109/4.535416](https://doi.org/10.1109/4.535416)). The abstract calls this relation a universal characteristic of all transistors in one process. Jespers and Murmann's book extends the idea to script-based design that sizes from SPICE-generated lookup tables, aiming for close agreement between hand analysis and simulation ([Cambridge 2017, doi:10.1017/9781108125840](https://doi.org/10.1017/9781108125840)).

**Why it ports across processes.** Inference: the design procedure is written in technology-normalized variables: gm/ID, current density, fT and intrinsic gain as functions of L. Only the tables are process-specific. To port, you regenerate the tables from the new PDK's models and rerun the same script. mosplot states this directly: porting to a new technology needs a configuration file with the new tables, operating conditions and targets ([medwatt/gmid README @6c4c5e1642](https://github.com/medwatt/gmid/tree/6c4c5e1642)).

**Open tooling.**
- Murmann's book repository ships ngspice + Xschem table-generation setups for **SKY130, GF180MCU-D and IHP-SG13G2**. The SKY130 and IHP folders hold ready-made `.mat` tables, and pygmid is the Python reader. The README says a full 4-D sweep runs in a few minutes, and also that the files are "far from plug and play". Licence AGPL-3.0, last commit 2025-10-06 ([bmurmann/Book-on-gm-ID-design @9bc96fbcfc, starter_files_open_source_tools](https://github.com/bmurmann/Book-on-gm-ID-design/tree/9bc96fbcfc/starter_files_open_source_tools)).
- **pygmid** is a Python 3 port of Murmann's MATLAB starter kit. It provides `lookup` (modes 1–3) and `lookupVGS`, and reads `.mat`/`.pkl` tables. Its own sweep CLI is described as "in a state of flux". Licence Apache-2.0, released with Murmann's permission, last commit 2026-01-26 ([dreoilin/pygmid @a9563980b3](https://github.com/dreoilin/pygmid/tree/a9563980b3)).
- **mosplot (medwatt/gmid)** generates tables with **ngspice, HSPICE or Spectre**, one table per technology and corner, and plots design charts. Its "automated multicorner sizing" writes the circuit as a system of equations over the tables, optimizes against all corners at once, and **emits a netlist for simulator verification**. Licence Apache-2.0, last commit 2026-09-22. The README cites a TCAS-I 2026 paper (doi 10.1109/TCSI.2026.3736902), which I did not open ([medwatt/gmid @6c4c5e1642](https://github.com/medwatt/gmid/tree/6c4c5e1642)).
- **LLM + gm/Id ("White-Box Reasoning").** This paper gives Gemini-2.0-flash gm/Id lookup tables for **SKY130** in the prompt's knowledge base, with ngspice 42 as the simulator. On a two-stage op-amp, all TT specs were met in 5 iterations, plus 1 more to pass all PVT corners. Without gm/Id data the run took 16 iterations and failed PVT (FOM 119.7 vs 265.7). A gm/Id script without the LLM did not converge. The paper claims a better FOM and 27% less area than one senior engineer's design. That is a single circuit and a single comparison, and the paper states no code release ([arXiv:2508.13172](https://arxiv.org/abs/2508.13172)).

**HimaHarness fit: MIG + SYN + KNOW, strong pattern fit.** Tables are deterministic artifacts generated on the EDA server. A gm/Id design script is exactly the "expert method as tested executable code" that a Pack ships. The agent picks the gm/ID and L targets, the simulator verifies the emitted netlist, and the Reader checks specs per corner. Limitation: the tables are intrinsic-device data. Layout parasitics, mismatch and well-proximity effects are absent until post-layout simulation.

---

### 2. BAG / BAG2 / BAG3 (Berkeley Analog Generator)

**What it does.** A BAG generator is a parametrized design procedure that produces the schematic, layout and verification testbenches for a circuit from its input specifications. BAG2 added a universal verification framework and two process-portable layout engines, XBase and Laygo. The authors report generators for a time-interleaved SAR ADC and a SerDes front end, built from **one methodology code base with only the primitives adapted per process**, in TSMC 28/16 nm, GF 45RFSOI, ST 28FDSOI and GF 22FDX ([Chang et al., CICC 2018, doi:10.1109/CICC.2018.8357061](https://doi.org/10.1109/CICC.2018.8357061)). I read the abstract through an indexed copy because IEEE Xplore did not render. BAG1 background is in [Crossley, UCB EECS-2014-195](https://www2.eecs.berkeley.edu/Pubs/TechRpts/2014/EECS-2014-195.html).

**Code, licence and status.**
- BAG2 is BSD-3-Clause. Its own README calls the documentation "very outdated", and the last commit was 2022-12-04 ([ucb-art/BAG_framework @daf4b0aaa7](https://github.com/ucb-art/BAG_framework/tree/daf4b0aaa7)).
- BAG3 describes itself as "a fork and successor" of BAG_framework, under Apache-2.0 with some files also under BSD-3. The default branch was last committed in 2020-08 and the repository was last pushed in 2024-07 ([bluecheetah/bag @a496368ad8](https://github.com/bluecheetah/bag/tree/a496368ad8)).
- A SKY130 BAG3 workspace exists, but its setup **launches Cadence Virtuoso** and loads a SKILL bridge (`start_bag.il`). It is BSD-3, last commit 2024-05-27 ([ucb-art/bag3_skywater130_workspace @5ef44273a7](https://github.com/ucb-art/bag3_skywater130_workspace/tree/5ef44273a7)).
- BagNet adds a DNN discriminator to cut evolutionary-search simulations and claims at least 100× sample-efficiency gains, including on an optical-link receiver layout ([arXiv:1907.10515](https://arxiv.org/abs/1907.10515)).

**Limitations.** The flow depends on Virtuoso/OpenAccess, maintenance is low since 2022–2024, and porting still requires writing per-process primitives.

**HimaHarness fit: MIG + KNOW, partly SYN, strong pattern fit.** A generator is executable expert method. It is the closest academic precedent for "Pack = tested code", and it already produces its own testbenches for an external judge. Inference: rather than adopt BAG wholesale, HimaHarness could borrow its separation of design procedure, process primitives and testbench.

---

### 3. ALIGN (Analog Layout, Intelligently Generated from Netlists)

**What it does.** ALIGN turns a SPICE netlist plus optional per-hierarchy constraint JSON into GDSII. It detects hierarchy automatically, generates primitive cells from a design-rule abstraction, then places and routes them. It is applied to low-frequency, wireline, wireless and power-delivery blocks ([arXiv:2008.10682](https://arxiv.org/abs/2008.10682); [DAC 2019, doi:10.1145/3316781.3323471](https://doi.org/10.1145/3316781.3323471)). **It does layout, not sizing.**

**PDK abstraction.** The repository ships mock PDKs (FinFET14nm_Mock, Bulk45nm_Mock, Bulk65nm_Mock, Nonuniform_mock) and a PDK Abstraction Guide ([ALIGN-public @8d3cc2e9aa, pdks/](https://github.com/ALIGN-analoglayout/ALIGN-public/tree/8d3cc2e9aa/pdks)). I found no SKY130 or other real open PDK in that directory.

**Status.** BSD-3-Clause and active: the last merge was 2026-09-15 ([ALIGN-public @8d3cc2e9aa](https://github.com/ALIGN-analoglayout/ALIGN-public/tree/8d3cc2e9aa)).

**HimaHarness fit: MIG (layout re-generation), weak on SYN/OPT.** It suits the pattern as a deterministic tool step: netlist in, GDS out, then DRC/LVS/PEX as judges. Inference: a real PDK needs an in-house PDK abstraction file, which is a non-trivial one-time task.

---

### 4. MAGICAL (UT Austin)

**What it does.** MAGICAL produces GDS from a netlist plus design rules, fully automatically: symmetry-constraint extraction, then placement, then routing ([IEEE D&T 2021, doi:10.1109/MDAT.2020.3024153](https://doi.org/10.1109/MDAT.2020.3024153); [ICCAD 2019, doi:10.1109/ICCAD45719.2019.8942060](https://doi.org/10.1109/ICCAD45719.2019.8942060)). **It does layout, not sizing.**

**Benchmarks and status.** The benchmarks are 1 ADC, 1 comparator and 3 OTAs, using sample technology parameters "not related to any proprietary PDK". The README notes routing issues on adc2. Licence is BSD-3-Clause. The default branch was last committed 2021-09-10, even though the README still says it is under active development ([magical-eda/MAGICAL @199ab0719f](https://github.com/magical-eda/MAGICAL/tree/199ab0719f)).

**HimaHarness fit: MIG (layout) only.** It is effectively dormant, so ALIGN or gLayout is the better choice.

---

### 5. OpenFASOC / gLayout

**OpenFASOC.** OpenFASOC targets automated analog generation "from user specification to GDSII" using cell-based synthesizable analog circuits and open tools. Its generators cover a temperature sensor, LDO, DC-DC, cryo, PLL/DCO and others, each with CI workflows on sky130hd/hvl. Licence Apache-2.0, last commit 2025-10-22 ([idea-fasoc/OpenFASOC @426c17025c](https://github.com/idea-fasoc/OpenFASOC/tree/426c17025c)). The temperature sensor takes user specs such as a −20 to 125 °C range and a frequency range ([temp-sense-gen README](https://github.com/idea-fasoc/OpenFASOC/tree/426c17025c/openfasoc/generators/temp-sense-gen)). The readthedocs site returned HTTP 429, so I did not verify the docs.

**gLayout.** A "PDK-agnostic layout automation framework" in Python that produces DRC-clean layouts for SKY130A and GF180MCU-D. It has generators (vias, FETs, guard rings and more), KLayout verification, and an optional natural-language-to-layout LLM path with fine-tuning scripts. MIT licence, last commit 2026-08-28. The README cites MLCAD 2024 (human language to layout) and ICCAD 2024 (RL-enhanced generator) ([ReaLLMASIC/gLayout @3e129ede58](https://github.com/ReaLLMASIC/gLayout/tree/3e129ede58)).

**HimaHarness fit: MIG (open PDKs), SYN for synthesizable blocks, good pattern fit.** Generators run as deterministic tools, and Magic/KLayout/netgen act as judges. The limitation is that only open PDKs are supported, so a commercial node needs new technology plumbing.

---

### 6. Benchmarks: AnalogGym and OCB

**AnalogGym.** 30 topologies: 16 amplifiers, 6 LDOs, 6 sensing front ends, 3 voltage references and 1 PLL. **Only the amplifiers and LDOs run on ngspice + SKY130**; the rest need Spectre or HSPICE ([arXiv:2409.08534, ICCAD 2024](https://arxiv.org/abs/2409.08534)). The paper evaluates GCN-RL, WEIBO, cVTS-BO, SMEA and MTEA on four SKY130 amplifiers across 4 PVT corners. cVTS-BO reached the best FOM_AMP in about 120 function evaluations, against about 800–900 for WEIBO and 5,000–6,800 for GCN-RL. Counter-evidence: the paper says each algorithm was "limited to 1000 simulations", yet its own table reports GCN-RL using more than 5,000. AnalogGym is netlists, testbenches and extraction scripts, not a gym API. It is BSD-3-Clause, last commit 2025-10-29 ([CODA-Team/AnalogGym @0a9d1390ad](https://github.com/CODA-Team/AnalogGym/tree/0a9d1390ad)).

**OCB / CktGNN.** Ckt-Bench-101 has 10k op-amps and Ckt-Bench-301 has 50k. They are used for joint topology and sizing with a two-level GNN ([arXiv:2308.16406, ICLR 2023](https://arxiv.org/abs/2308.16406); [zehao-dong/CktGNN @416cd035f7](https://github.com/zehao-dong/CktGNN/tree/416cd035f7), MIT, last commit 2023-09). The circuits are behavioural-level op-amps, not PDK transistor netlists. Inference from the README's dataset description.

**HimaHarness fit.** AnalogGym is the most useful **acceptance fixture**: open netlists, a SKY130 testbench, a defined FOM and PVT corners, all ready for a Reader.

---

### 7. Bayesian-optimization sizing

| Work | Method | Setup | Reported result | Code |
|---|---|---|---|---|
| **WEIBO** ([Lyu et al., TCAS-I 2018, doi:10.1109/TCSI.2017.2768826](https://doi.org/10.1109/TCSI.2017.2768826)) | GP surrogates; EI weighted by probability of feasibility; multi-objective extension | Abstract only (Semantic Scholar index) | "Better results with significantly less number of simulations" than the listed state of the art | Not found |
| **MACE** ([ICML 2018, PMLR v80](https://proceedings.mlr.press/v80/lyu18a.html)) | Batch BO from the Pareto front of several acquisition functions | Analytical functions plus real analog circuits | No numbers on the landing page | [Alaya-in-Matrix/MACE @6e5d2cd5be](https://github.com/Alaya-in-Matrix/MACE/tree/6e5d2cd5be), no licence, 2018 |
| **KATO** ([arXiv:2404.14433, DAC 2024](https://arxiv.org/abs/2404.14433)) | MACE plus neural kernel plus selective transfer across circuits and nodes | 180 nm and 40 nm PDKs; two/three-stage op-amps, bandgap; 5 seeds | ~50% fewer simulations, up to 1.2× FOM; **180→40 nm transfer: 2.52× speed-up, 1.18× performance**; topology plus node transfer: 2.40× | Builds on MACE |
| **Parallel TuRBO** ([ISEDA 2024, doi:10.1109/ISEDA62518.2024.10617503](https://doi.org/10.1109/ISEDA62518.2024.10617503)) | Trust-region BO in parallel regions with bandit sampling | Abstract only | 1.19–1.31× fewer iterations than TuRBO | Not found |

**HimaHarness fit: OPT, good pattern fit.** BO is a deterministic optimizer step. The agent's role is to set bounds, choose variables and pick the FOM. Limitation: all results are schematic-level. KATO's transfer is the only measured BO evidence across technology nodes (MIG).

---

### 8. RL and DNN sizing

- **AutoCkt** ([arXiv:2001.01808](https://arxiv.org/abs/2001.01808)). PPO trained on sparsely sampled target specs, then deployed to new targets.
  - Schematic results: a TIA in **45 nm BSIM predictive** models, and a two-stage op-amp with negative-gm load in **TSMC 16 nm FinFET under Spectre**. It met all specs on ≥96.3% of target goals and was about 40× more sample-efficient than a GA.
  - Post-layout: a **BAG generator** produced 40/40 LVS-passing designs in 68 hours on one CPU core, with 23 simulation steps per design versus 220 for a GA+ML baseline (9.6× better).
  - Code: [ksettaluri6/AutoCkt @a6c8a61d3d](https://github.com/ksettaluri6/AutoCkt/tree/a6c8a61d3d), **no licence file**, last commit 2022.
- **GCN-RL** ([arXiv:2005.00406, DAC 2020](https://arxiv.org/abs/2005.00406)). DDPG with a GCN over the transistor graph.
  - Four circuits in **TSMC 180 nm** (Spectre and HSPICE). It beat ES, BO, MACE and expert designs on FOM after 10k steps; BO and MACE got equal runtime of about 5 hours.
  - **Transfer from 180 nm to 250/130/65/45 nm, 300 steps:** Three-TIA FOM 1.06–1.29 with transfer versus 0.53–0.69 without.
  - Counter-evidence: in AnalogGym's SKY130 rerun, GCN-RL was the least sample-efficient method (Section 6). I did not locate an official repository.
- **DNN-Opt** ([arXiv:2110.00211, DAC 2021](https://arxiv.org/abs/2110.00211)). An actor-critic-style two-stage DNN optimizer.
  - On a 180 nm folded-cascode amplifier and a StrongARM comparator, it used 132 simulations versus 3,200 for DE, with BO-wEI and GASPAD needing more than 500 within a 500 budget. Claimed gains are 5–30×.
  - It also ran on four industrial circuits at "a very advanced node", using critical-device identification, but only against a commercial simulated-annealing optimizer.
  - No code is stated.

**HimaHarness fit: OPT; MIG only through transfer results.** RL needs thousands of simulations to train, which is a poor fit for budgeted Runs. AutoCkt's BAG post-layout loop is the best example of measuring inside the loop.

---

### 9. LLM-based analog work

| Work | What the LLM does | Simulator / models | Verification | Reported numbers | Code / licence |
|---|---|---|---|---|---|
| **AnalogCoder** ([arXiv:2405.14918, AAAI 2025](https://arxiv.org/abs/2405.14918)) | Writes PySpice Python for a topology plus nominal sizes; feedback loop; library of solved sub-circuits | ngspice via PySpice; **Level-1 MOS models** (kp, vto), 5 V | 4-stage check: requirements, operating point, DC sweep, functional AC/DC/transient criteria per circuit type | 24 tasks; GPT-4o-based Pass@1 66.1, Pass@5 75.9, 20/24 solved (GPT-4o alone 15) | [laiyao1/AnalogCoder @591a865427](https://github.com/laiyao1/AnalogCoder/tree/591a865427), MIT, active 2026-09 |
| **AnalogCoder-Pro** ([arXiv:2508.02518](https://arxiv.org/abs/2508.02518)) | Adds multimodal repair from waveform images; generates topology from spec, extracts parameters, then **BO sizing** | ngspice/PySpice; **BPTM 45 nm** | Simulation and FOM | 28 circuits with GPT-5, versus 14 with GPT-3.5 | [laiyao1/AnalogCoderPro @05542af460](https://github.com/laiyao1/AnalogCoderPro/tree/05542af460), no licence detected |
| **ADO-LLM** ([arXiv:2406.18770](https://arxiv.org/abs/2406.18770)) | GPT-3.5 proposes 5 initial points and 1 per iteration, alongside 4 GP-BO (qEI) points; top-5 designs fed back in-context | **HSPICE, commercial 90 nm** | Simulated specs and FOM | 105 sims: amplifier FOM 3.52 with 0 missed specs versus GP-BO 1.89 (2.10 at ~405 sims); comparator 0.90 versus −3.38. Only 2 circuits | No repository linked |
| **LEDRO** ([arXiv:2411.12930](https://arxiv.org/abs/2411.12930)) | LLM shrinks the search box each round; TuRBO searches inside it | **Spectre, PTM-MG FinFET 7/10/14/16 nm** | Simulated FOM | 22 op-amps × 4 nodes: +13% FOM and 2.15× (low complexity), +48% and 1.7× (high complexity) versus the best baseline | [dimplekochar/LEDRO @e970d3059e](https://github.com/dimplekochar/LEDRO/tree/e970d3059e), no licence |
| **EEsizer** ([arXiv:2509.25510](https://arxiv.org/abs/2509.25510)) | Agent edits W/L and bias in the netlist through function calls, giving a reason per change | **ngspice, PTM 180/130/90 nm** | Each spec within 5%, no device in sub-threshold | o3 reached 100% on 6 basic circuits; on a 20-transistor op-amp only o3 succeeded at 90 nm; success fell as the node shrank | [eelab-dev/EEsizer @3af9421bd4](https://github.com/eelab-dev/EEsizer/tree/3af9421bd4), MIT |
| **AgenticSizing** ([arXiv:2609.25873](https://arxiv.org/abs/2609.25873)) | Planner plus role-specific sizer agents (LangGraph, GPT-5.2); topology decomposition; reusable "lightweight design knowledge" | **Spectre**; node not stated in the parts I read | Specs met within a wall-clock budget, 5 trials | 8 circuits, up to 55 transistors and 60 variables. Two-stage FC: 80% in 11–29 sims, where DE/BO/MA-RL failed. LDO: 4/5 in ~79 sims versus BO 4/5 in ~524. **Inconsistency:** the abstract says 60% for LDO | [aprilaihub/agentic-analog-sizing @d4b59e00bb](https://github.com/aprilaihub/agentic-analog-sizing/tree/d4b59e00bb), Apache-2.0 |
| **AmpAgent** ([arXiv:2409.14739](https://arxiv.org/abs/2409.14739)) | Three agents: literature RAG (formulas, transfer functions), SymPy pole-zero derivation into gm targets, and sizing using ABC/TuRBO | **Spectre, 0.18 µm** (only node named) | Simulation; checked for no RHP poles; GBW, PM, gain, IFOM | 7 multi-stage amplifiers; success 95–100% versus TuRBO 73–95% (AZC: all baselines failed); IFOM 1.63–27.25× over the source papers. "Success rate" is not formally defined | No repository linked |
| **Artisan** ([DAC 2024, doi:10.1145/3649329.3655903](https://doi.org/10.1145/3649329.3655903)) | Domain-tuned LLM generates op-amp topologies; ToT/CoT multi-agent Q&A | Not verified: **full text not reached**, abstract read through the Semantic Scholar index | Abstract claims better success rate and metrics, up to 50.1× faster | Abstract says "will be released"; not verified |
| **AnalogXpert** ([arXiv:2412.19824](https://arxiv.org/abs/2412.19824)) | GPT-4o picks and connects blocks from a sub-circuit library (SPICE), then proofreads | **No simulation**: a rule checker, plus human check on real cases | Structural correctness | 40% synthetic (2k), 23% real (30), versus GPT-4o at 3%. No sizing | Paper links none. A repo of that name exists ([zhywhite/AnalogXpert @72a4e45039](https://github.com/zhywhite/AnalogXpert/tree/72a4e45039)), official status unconfirmed |
| **LaMAGIC / LaMAGIC2** ([arXiv:2407.18269, ICML 2024](https://arxiv.org/abs/2407.18269); [arXiv:2506.10235, ICML 2025](https://arxiv.org/abs/2506.10235)) | Fine-tuned Flan-T5 (248M) maps spec to power-converter topology in one pass | ngspice labels voltage conversion ratio and efficiency; 3–6 component converters | Simulated within tolerance | Up to 96% at tolerance 0.01; LaMAGIC2 claims +34% success | [turtleben/LaMAGIC @0cde737684](https://github.com/turtleben/LaMAGIC/tree/0cde737684), no licence |
| **AnalogGenie** ([arXiv:2503.00205, ICLR 2025](https://arxiv.org/abs/2503.00205)) | 11.8M GPT trained on Eulerian pin sequences of 3,350 topologies; RL fine-tuning | ngspice validity check; GA sizing; no PDK named in the paper | Simulation with default sizing, then GA-sized FOM | 93.2% valid, ~99% novel; op-amp FOM 36.5 versus CktGNN 10.9 | [xz-group/AnalogGenie @efc2535893](https://github.com/xz-group/AnalogGenie/tree/efc2535893), MIT, with HF dataset and checkpoint |

Also seen but not analysed in depth:
- [AnaFlow](https://arxiv.org/abs/2511.03697): explainable multi-agent sizing, 2 circuits.
- [AaLLM](https://arxiv.org/abs/2608.13472): RAG knowledge base built from papers and textbooks; Designer/Critic/Evaluator agents.
- **LADAC**: I could not locate a primary source. It is mentioned only in citing papers.

**Patterns across the LLM work.**
1. **Ideal or predictive models dominate.** The models are Level-1, PTM/BPTM, or SKY130 at best. Only ADO-LLM (90 nm), GCN-RL/DNN-Opt (180 nm) and AmpAgent/relationship-extraction use commercial PDKs, and none report post-layout results.
2. **Benchmarks are small:** 2–30 circuits per paper.
3. **Weak judges.** Several works count "success" by structural rules (AnalogXpert) or let the same pipeline judge itself. The stronger designs pair the LLM with a classical optimizer (ADO-LLM, LEDRO, AmpAgent, AnalogCoder-Pro).

Inference: the LLM adds most value as a **prior or space-pruner** for a deterministic optimizer, not as the sizer itself. That matches "agent proposes, tools measure, judge verifies".

**HimaHarness fit.**
- **OPT:** ADO-LLM, LEDRO, EEsizer, AgenticSizing.
- **SYN:** AnalogCoder(-Pro), AnalogGenie, LaMAGIC, Artisan, AnalogXpert.
- **MIG:** EEsizer (node sweep), LEDRO (four nodes), AmpAgent ("process porting" from literature).
- **Pattern fit:** the optimizer-hybrid works fit directly. The topology generators need a Reader that sizes and simulates before claiming success.

---

### 10. Knowledge capture

- **Generators as encoded procedure.** BAG2's "parametrized design procedure" ([CICC 2018](https://doi.org/10.1109/CICC.2018.8357061)) and mosplot's equation-system sizing scripts ([medwatt/gmid](https://github.com/medwatt/gmid/tree/6c4c5e1642)) capture expert method as code that reruns on a new process.
- **Sizing relationships mined from papers.** LLM agents extract inter-device sizing relations from papers and use them to prune the optimizer's space. Tested on a BGR (SMIC 180 nm), an op-amp and an LDO (TSMC 65 nm):
  - Pass rates rose from 0/10, 0/10 and 5/10 to 8/10, 10/10 and 10/10.
  - Time dropped 2.32–26.6×.
  - The unconstrained op-amp "passed" its numbers but oscillated, which shows the judge must include stability checks ([arXiv:2506.18424](https://arxiv.org/abs/2506.18424)).
- **Libraries of solved designs.** AnalogCoder archives verified sub-circuits for reuse ([arXiv:2405.14918](https://arxiv.org/abs/2405.14918)). AgenticSizing reuses extracted "lightweight design knowledge" ([arXiv:2609.25873](https://arxiv.org/abs/2609.25873)).
- **Literature to formulas to targets.** AmpAgent turns papers into transfer functions and gm targets ([arXiv:2409.14739](https://arxiv.org/abs/2409.14739)).
- Inference: none of these versions, tests or regression-checks the captured knowledge. HimaHarness's "tested executable method plus knowledge docs" would be new relative to this literature.

---

### Limitations across the field

- Almost all results are **schematic-level**. AutoCkt's BAG/PEX loop is the main exception.
- PVT coverage is rare: AnalogGym, White-Box, mosplot.
- Statistical, mismatch and Monte Carlo verification is essentially absent.
- **Migration evidence is thin:**
  - GCN-RL (180 nm to 4 nodes, schematic only).
  - KATO (180 nm to 40 nm, three circuits).
  - EEsizer (PTM 180/130/90 nm, success degrades with scaling).
  - LEDRO (PTM FinFET nodes).
  - BAG2 (silicon examples across five commercial nodes, with hand-ported primitives).
- Licence gaps: AutoCkt, MACE, LaMAGIC, LEDRO and AnalogCoderPro have no licence file. Treat them as reference only.

---

### Most useful for a first demo

1. **gm/Id tables (Murmann's SKY130/IHP/GF180 sweeps plus pygmid, or mosplot) as a Pack's deterministic method.** Port a two-stage OTA between SKY130 and GF180 or IHP by regenerating the tables and rerunning the same sizing script. The Reader checks ngspice results per corner. This shows MIG + KNOW with all-open, permissively licensed tooling (Apache-2.0 for pygmid and mosplot; note AGPL-3.0 on Murmann's repo).
2. **AnalogGym SKY130 amplifiers and LDOs as the acceptance fixture.** Open netlists, testbenches, a FOM and 4 PVT corners give an external judge and published baselines (WEIBO, cVTS-BO, GCN-RL) to beat on simulation count. BSD-3-Clause.
3. **An ADO-LLM/LEDRO-style hybrid for OPT.** The resident proposes seed points or narrows bounds, a BO or TuRBO step on the EDA server runs the simulations, and the Reader enforces specs plus stability. Published evidence says this hybrid beats both LLM-only and BO-only at about 100–1,200 simulations. EEsizer (MIT) is an open ngspice reference for the agent loop.
4. **gLayout (MIT) as an optional layout step** for SKY130/GF180, so the Goal can include DRC/LVS-clean GDS and post-layout re-simulation. This addresses the field's biggest gap: schematic-only claims.
5. **AnalogCoder (MIT) as a SYN baseline.** Use it only with a Reader that re-simulates on real PDK models. Its own Level-1-model successes should not be taken as evidence of real-process feasibility.

---

## B. Analog migration and commercial analog-automation flows

Research worker B. Retrieved 2026-10-12. Sources are vendor product pages, vendor press releases and blogs, exchange filings, and papers. Vendor performance numbers are the vendors' own claims, and nobody independent has checked them. Inline "Inference:" marks my reasoning; everything else carries a link.

Access notes: `cadence.com` returned HTTP 403 to the fetch tool, so I read Cadence pages in a real browser. BusinessWire (the Keysight/Synopsys RF-migration release) returned "Access Denied". The HAL record `hal-01289302` was behind an Anubis wall. `par.nsf.gov/servlets/purl/10586512` (Murmann, script-based gm/ID design) closed the socket every time. Cadence, Synopsys, Siemens and Empyrean user manuals all sit behind customer logins, so I saw only public pages for every vendor's batch interface.

---

### 1. What a real analog migration consists of

Vendor and academic descriptions agree on the same pipeline. Cadence's public FAQ gives the clearest end-to-end version ([Cadence Custom Design Migration](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)):

| # | Step | What it involves | Deterministic or judgement |
|---|---|---|---|
| 1 | **Inventory and device mapping** | Map each source-PDK cell to a target-PDK cell. Device names, terminals, footprints, orientations, layout-only dummies, layer names and model assumptions "can differ materially across PDKs or foundries" ([Cadence](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). | The mapping table is judgement. Checking coverage against it is deterministic. |
| 2 | **Terminal and parameter mapping** | Pin mapping plus "equation-based parameter mapping" in a spreadsheet-style table, supplied "through a text file or graphical user interface". The tool rewires automatically when symbols do not match ([Cadence](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). MunEDA SPT described "flexible property mapping and automated shrinking" for MOS devices, resistors and capacitors ([MunEDA release via Design&Reuse, 2011](https://us.design-reuse.com/news/26029/process-technology-porting-of-circuit-schematics-ip.html)). | Mostly deterministic once the table exists. |
| 3 | **Re-bias and re-size** | Analog does not scale linearly: "supply voltage, intrinsic gain, leakage, reliability, device quantization, and layout parasitics" all change ([Cadence FAQ](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). MunEDA put it this way: most blocks need "individual adjustment of topology, geometries, biasing" ([MunEDA release](https://us.design-reuse.com/news/26029/process-technology-porting-of-circuit-schematics-ip.html)). | This is the expert step. |
| 4 | **Re-center by optimization** | The mapped schematic and the reused testbenches go into the simulation environment, which optimizes device sizes "so that the circuit performance meets the specifications" ([Cadence](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). | Simulation in the loop. |
| 5 | **Verify across PVT, Monte Carlo and parasitics** | "Local or global optimization, design centering, Monte Carlo analysis/statistical corners, and parasitic-aware optimization as needed" ([Cadence FAQ](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). | Deterministic measurement. |
| 6 | **Layout migration** | The tool extracts grouping, relative placement, symmetry, pins, guard rings and routing topology from the LVS-clean source layout, turns them into templates, and re-places and re-routes in the target node so the result is "DRC and LVS correct" ([Cadence](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). | Template extraction plus automatic P&R. |
| 7 | **Post-layout sign-off and designer review** | The migrated design "still requires simulation, corners, parasitics, DRC/LVS, post-layout verification, and designer review". If the topology cannot meet the target node, the flow should "expose the tradeoff limits … rather than issuing a false pass" ([Cadence FAQ](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). | Human gate. |

Inference: steps 2, 4, 5 and 6 are mostly mechanical once two artifacts exist: a correct mapping table and a correct specification and testbench set. Steps 1, 3 and 7 hold the expertise. Step 7 is also where a vendor's own optimizer has a conflict of interest when it is the one declaring success.

---

### 2. Academic approaches

**gm/ID and lookup-table re-sizing.** The gm/ID method sizes transistors from their inversion level instead of from W/L ([Silveira, Flandre, Jespers, IEEE JSSC 1996](https://doi.org/10.1109/4.535416)). In the lookup-table form, SPICE sweeps of the target PDK are precomputed, so a sizing script can be re-run on a new node without iterating the simulator ([Jespers & Murmann, *Systematic Design of Analog CMOS Circuits*, CUP 2017, ch. 3](https://www.cambridge.org/core/books/systematic-design-of-analog-cmos-circuits/basic-sizing-using-the-gmid-methodology/185BE8CB4F04AD9FFC08CDE06D3EA8A9)). Konishi et al. built SPICE-based gm/ID tables from worst-case simulations for an OTA and tested the flow explicitly as a technology-migration tool. They used differences in gm/ID characteristics for failure analysis ([IEICE Trans. Electron. E94-C(3), 2011, abstract](https://www.doi.org/10.1587/TRANSELE.E94.C.334)). Inference: gm/ID is the cleanest form of "re-bias first, then re-size", because the operating-point intent moves to the new node while W/L does not.

**Knowledge-based, technology-independent procedures.** The LIP6 line of work (CAIRO+, then CHAMS) records the designer's sizing and biasing procedure as an executable operator graph that is technology-independent by construction. Javid, Iskander, Durbin and Louërat attach a bipartite graph of sizing and biasing operators to the circuit, then size a folded-cascode OTA in 130 nm and migrate it to 65 nm ([2012 paper PDF, index entry; I could not open the full text on 2026-10-12](https://yadda.icm.edu.pl/baztech/element/bwmeta1.element.baztech-article-LODD-0002-0020/c/Javid_Iskander_Durbin_Louerat_Analog_1_2012.pdf)). Cachaço et al. add a "generic cell library" abstraction holding topology and testbench descriptions per circuit class. They pair it with a multi-objective sizing optimizer and validate it by migrating continuous-time comparators from XFAB 350 nm to ATMEL 150 nm SOI ([DATE 2017](https://past.date-conference.com/proceedings-archive/2017/pdf/0257.pdf)). The common thread is that the reusable asset is the procedure plus the testbenches, not the sized netlist.

**Layout migration.** IBM's Tang and Yuan convert layout shapes into simple geometric objects ("sticks") that keep the topology, then legalize them to the target node's restrictive design rules ([ICCAD 2006](https://www.cecs.uci.edu/~papers/iccad06/papers/9A_1.pdf)). Patents also cover analog-specific migration: retargeting ([US 7,730,433](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7730433)), automated AMS migration ([US 7,761,820](https://patents.google.com/patent/US7761820)) and fast analog layout migration ([US 8,607,182](https://patents.google.com/patent/US8607182)). The IMECAS patent splits the source circuit into DC paths and re-optimizes them one at a time in signal-propagation order ([US 8,516,429](https://patents.google.com/patent/US8516429)).

**ML transfer across nodes.** GCN-RL Circuit Designer represents the circuit as a graph and trains an RL agent with a graph convolutional network. Knowledge then transfers across five technology nodes and two topologies, giving higher FoM than the same agent without transfer ([Wang et al., DAC 2020, arXiv:2005.00406](https://arxiv.org/abs/2005.00406)). KATO adds transfer learning to Bayesian optimization across circuits and nodes, reporting up to 2× fewer simulations and 1.2× better designs ([Xing et al., DAC 2024, arXiv:2404.14433](https://arxiv.org/abs/2404.14433)).

**LLM agents with SPICE in the loop.** EEsizer couples LLMs to a circuit simulator and analysis functions for closed-loop sizing. It sized a 20-transistor rail-to-rail op-amp and carried the method from 180 nm to 90 nm. With OpenAI o3 it met the target at 90 nm within 20 iterations ([Liu & Chitnis, arXiv:2509.25510](https://arxiv.org/abs/2509.25510)). AnaFlow, a multi-agent sizing workflow that calls a simulator for .ac and .tran analyses, is at [arXiv:2511.03697](https://arxiv.org/pdf/2511.03697). A multi-agent framework extracts sizing relationships from papers to prune the search space ([arXiv:2506.18424](https://arxiv.org/abs/2506.18424v1)). ZhuLong is directly relevant to Empyrean. It is an LLM agent that writes PyAether scripts, evaluated on 158 assertion-checked tasks (EDA-Eval-PyAether). It reaches 78.5 % Pass@1 "in the commercial Empyrean Aether environment" against 23.6 % for a plain LLM, and removing sandbox execution costs 41.2 points ([arXiv:2608.07925](https://arxiv.org/abs/2608.07925)). Inference: the result that matters for us is that executing against the real tool, not model quality, is what makes Aether scripting reliable.

---

### 3. Commercial flows by vendor

### 3.1 Cadence

**Products (exact names, as on cadence.com on 2026-10-12):**
- **Custom Design Migration**: a Virtuoso Studio flow, not a separately named product ([page](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)).
- **Virtuoso ADE Explorer, Assembler, Artist and Verifier** ([Circuit Design page](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/circuit-design.html)).
- **Virtuoso AI Studio**.
- **ViraStack AI Super Agent** ([page](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virastack-ai-super-agent.html)).

No product is named "Virtuoso Design Migration".

**What is automated:**
- Schematic mapping uses a device and parameter table, supplied as a text file or through the GUI, with automatic rewiring. ADE Suite then optimizes sizes against the reused testbenches, with "built-in algorithms or the ability to integrate private algorithms" ("Choice of design optimizers including your own"). Layout is regenerated from extracted templates, with placement reuse and "topology-based routing migration" ([Custom Design Migration](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)).
- The April 2023 TSMC release: Virtuoso "automatically migrates schematic cells, parameters, pins and wiring". ADE "tunes and optimizes the new schematic". Customers saw migration time drop 2.5× against manual migration ([Cadence PR, 25 Apr 2023](https://www.cadence.com/en_US/home/company/newsroom/press-releases/pr/2023/cadence-custom-design-migration-flow-accelerates-adoption-of.html)).
- The Samsung Foundry certification release is dated 28 Jun 2023, per the listing on the migration page. Cadence returned 403 to the fetch tool and I did not open the release text in the browser.
- ADE Artist is "the centerpiece of the Virtuoso custom migration flow". It provides Spectre Fast Monte Carlo, smart corners, high-yield estimation, sensitivity and "advanced optimization flows with new AI-based algorithms" ([Circuit Design page](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/circuit-design.html)). ADE Explorer covers sweeps, corners, Monte Carlo and sensitivity. ADE Verifier links top-level requirements to the individual tests (same page).
- ViraStack (2026) runs "autonomous, multi-agent orchestration" with a design-migration agent, an optimization agent, an IP-catalog agent, a debug/verification agent and a layout agent. A "mental model" captures "design intent, circuit functionality, and the key design knowledge in a predefined structured format". The migration flow gains "automated mapfile creation, and independent orchestration of the complete flow" ([ViraStack](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virastack-ai-super-agent.html); [Custom Design Migration](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). Cadence pitches it explicitly against scripts, which "break when design conditions change" ([ViraStack FAQ](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virastack-ai-super-agent.html)).

**What the human does:** defines "high-level design intent and constraints", reviews mappings, and validates results. The FAQ describes the shift as "from managing tool flows to validating results" ([ViraStack FAQ](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virastack-ai-super-agent.html)).

**Batch interfaces (public):**
- The mapping table is a text file ([migration page](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)).
- ADE Artist offers "Simple YAML-based regression scripting" and simulates "large amounts of ADE-based testbenches from the command line" ([Circuit Design](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/circuit-design.html)).
- SKILL is named as a manual task the agent reduces ([ViraStack FAQ](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virastack-ai-super-agent.html)).
- OCEAN and the details of the Spectre command line are in login-only documentation, so I did not confirm them here.

**Simulation in the loop:** yes. Optimization and re-centering run Spectre through ADE.

**MunEDA:** on 2026-10-12, `https://www.muneda.com/` returned HTTP 301 to Cadence's Virtuoso Studio page (observed with `curl -I`). Aggregators date a Cadence acquisition of MunEDA to 16 May 2024 ([Mergr](https://mergr.com/transaction/cadence-acquires-muneda), [PitchBook](https://pitchbook.com/profiles/company/277460-83)). These are third-party sources. I found no Cadence press release. MunEDA's WiCkeD SPT ported schematics with property mapping and shrinking inside Virtuoso, and claimed 10–100× speed over manual porting ([2011 MunEDA release](https://us.design-reuse.com/news/26029/process-technology-porting-of-circuit-schematics-ip.html)).

### 3.2 Synopsys

**Products:**
- **Synopsys ASO.ai**, part of Synopsys.ai ([product page](https://www.synopsys.com/ai/ai-powered-eda/aso-ai.html)).
- **Custom Compiler**, **PrimeWave Design Environment**, **PrimeSim** (SPICE, HSPICE and others), and **IC Validator**.

**What is automated:**
- ASO.ai claims "analog IP migration across technology nodes using knowledge-based reuse". It also claims RL-based multi-objective optimization over hierarchical schematics, post-layout parasitics, PVT corners and multiple testbenches, plus AI clustering of waveforms across thousands of simulations ([ASO.ai page](https://www.synopsys.com/ai/ai-powered-eda/aso-ai.html)).
- A Synopsys China blog describes the full chain from schematic migration through circuit optimization to layout generation, "通过强化学习在数百个PVT、工艺角下同步优化设计". Layout migration turns the source layout into constraints and then regenerates it under the new rules ([Synopsys AMS Tech Day blog, 13 May 2026](https://www.synopsys.com/zh-cn/blogs/chip-design/ams-tech-day.html)).
- In the Credo case, a VCO moved from 5 nm to 7 nm in "a few hours, including setup" (claimed up to 100×), and the optimizer ran over 10,000 searches in about 2 h ([Synopsys blog, 30 Sep 2024](https://www.synopsys.com/blogs/chip-design/analog-ic-design-migration-ai.html)).
- Simulation and verification integrate with PrimeSim SPICE and IC Validator ([Synopsys blog, 14 Aug 2025](https://synopsys.com/blogs/chip-design/ai-driven-analog-digital-node-migration.html)).
- The public pages do not describe device or parameter mapping mechanics ([webinar page](https://www.synopsys.com/webinars/migrate-analog-design.html)).

**What the human does:** not described beyond setup and specifications.

**Batch interfaces:** PrimeWave "can be controlled in either GUI or Batch mode with scripting". Any setup can be "saved as a Tcl script", and pre- and post-run procedures and "a rich set of open APIs" are available ([PrimeWave datasheet PDF](https://www.synopsys.com/content/dam/synopsys/implementation&signoff/datasheets/primewave-ds.pdf)). No public page says how ASO.ai itself is invoked from a script.

**Simulation in the loop:** yes, PrimeSim.

### 3.3 Siemens

**Products:**
- **Solido Design Environment**, launched 10 Jul 2023 ([Siemens news](https://news.siemens.com/en-us/solido-design-environment/)).
- **Solido Simulation Suite**: Solido SPICE, FastSPICE and LibSPICE.
- **Solido Characterization Suite**: Characterizer, **Generator**, Analytics.
- **Solido Layout Analyzer**.
- **Fuse EDA AI Agent**.

"Solido Generator" exists, but it is a library-characterization component: it uses baseline Liberty files to train models that generate additional library views without SPICE ([Siemens, May 2026](https://news.siemens.com/en-us/siemens-solido-characterizer/)). It is not an analog migration tool. I found no Siemens analog schematic-migration product.

**What is automated:**
- AI identifies "optimization paths" for power, performance and area, and runs statistical yield analysis "in a fraction of the runtime" of brute force. "Additive Learning" reuses retained models ([Siemens news, 2023](https://news.siemens.com/en-us/solido-design-environment/)).
- The product page claims "orders-of-magnitude faster yield verification for 3, 4, 5, and 6+ sigma" with brute-force accuracy ([Solido DE](https://www.siemens.com/en-us/products/ic/solido/design-environment/)).
- At DAC 2026, Siemens announced "self-verifying agentic AI workflows" in which agents check decisions against "deterministic, physics-based EDA engines". The concrete Solido agent workflow it named is Liberty characterization, claiming more than 10× TAT reduction ([Siemens/NVIDIA, 26 Jul 2026](https://news.siemens.com/en-us/siemens-nvidia-dac-2026/)). The release names no analog sizing or migration agent. The DAC blog promises agentic demos "across the custom IC workflow" without naming agents ([Siemens blog, 10 Jul 2026](https://blogs.sw.siemens.com/cicv/2026/07/10/agentic-ai-solido-at-dac-2026/)).

**Batch interfaces:** "Multiple use models: GUI or batch mode" and "Supports third-party simulators" ([Solido DE](https://www.siemens.com/en-us/products/ic/solido/design-environment/)). No public API details.

**Simulation in the loop:** yes. Variation analysis is simulation-driven, with AI used to cut the number of simulations needed.

### 3.4 Empyrean (华大九天)

**Analog tool family:** the official analog page lists Aether (schematic and layout), ALPS (SPICE), ALPS-GT (CPU-GPU heterogeneous SPICE), Argus (physical verification), RCExplorer (extraction), ADA (layout parasitic analysis), Polas (power-device reliability), Patron (transistor-level PI) and **Andes Power** ("一键生成并自动优化Power MOSFET版图") ([Empyrean analog page](https://www.empyrean.com.cn/products/eda/analog.html)).

**Optimization and migration offerings (what can be confirmed):**
- An exchange-filed investor-relations record states that in 2024 Empyrean launched the design-automation platform **Andes**, comprising **Andes Analog** (模拟设计自动化) and **Andes Power**. Andes Power "在优化流程中深度融入了 AI 技术" ([IR record 2025-002, 20 May 2025](https://file.finance.qq.com/finance/hs/pdf/2025/05/20/1223610203.PDF)). I found no public product page describing what Andes Analog does.
- At the October 2025 user conference, Empyrean announced the **ALPS VX** circuit simulator ("性能提升3倍+"). It announced a flow upgrade with physical-constraint awareness "提升版图设计及工艺迁移效率3-5倍". It also released **Aether Coder**, a script-generation agent for the design platform ([Empyrean news, 24 Oct 2025](https://www.empyrean.com.cn/article/item-221.html)). The same page reports that community PyAether work includes "工艺Porting".
- I found no Empyrean product page for a standalone analog sizing optimizer or a schematic-migration tool comparable to ASO.ai or Cadence Custom Design Migration. Inference: migration on Empyrean today is probably a mix of flow features and PyAether scripting rather than a packaged migration product. Customers should confirm this with Empyrean.

**Batch and scripting interfaces (this matters most for us):**
- **PyAether** is a Python platform on Aether with "超过1.2万个Python API接口" for circuit and layout automation and data processing. It includes the AetherWings toolkit with partial source, plus a mechanism for integrating third-party verification tools ([PyAether page](https://www.empyrean.com.cn/solutions/index-128.html)).
- **Aether SE** exports CDL, SPICE, Verilog and Verilog-A netlists and imports and exports EDIF 200 ([Aether page](https://www.empyrean.com.cn/products/eda/analog-design/schematic-and-layout-editor.html)).
- **Aether MDE** sets options, stimuli, analyses, corners and post-processing. Its parameter and corner settings "可以单独Save为文本，并可以单独Reload" ([same page](https://www.empyrean.com.cn/products/eda/analog-design/schematic-and-layout-editor.html)).
- **Aether LE** offers PDK automation scripts, SDL, and integrated Argus DRC and LVS (same page).
- **ALPS** is described only as a high-speed parallel SPICE engine that handles more than 100 million devices ([ALPS page](https://www.empyrean.com.cn/products/eda/analog-design/spice-simulator.html)). Its command-line usage and input netlist dialects are not public. Inference: a batch netlist-in, results-out interface almost certainly exists, but we must check it on the customer's server.

**Simulation in the loop:** none of the public analog optimization pages show it. The ZhuLong paper shows that LLM-driven PyAether scripting with sandbox execution works in a commercial Aether install ([arXiv:2608.07925](https://arxiv.org/abs/2608.07925)).

### 3.5 Side-by-side

| | Cadence | Synopsys | Siemens | Empyrean |
|---|---|---|---|---|
| Schematic migration | Yes: mapping table, rewiring | Yes, claimed (ASO.ai), mechanics not public | Not found | Not a public product; "工艺迁移" flow upgrade claimed |
| Sizing optimizer | ADE (local, global, AI), BYO optimizer | ASO.ai RL | Solido DE "optimization paths" | Andes Power (PowerMOS, AI); Andes Analog scope not public |
| Layout migration | Template extract and regenerate | Constraint extract and regenerate | Not found | Not public |
| Agentic layer | ViraStack AI Super Agent | Synopsys.ai (agent naming not checked here) | Fuse EDA AI Agent; "self-verifying" | Aether Coder (scripts) |
| Batch interface | YAML regression, CLI, text map files, SKILL | Tcl (PrimeWave), batch mode | GUI or batch | PyAether (12k+ APIs), text netlists, text corner files |
| Who declares pass | Same vendor stack | Same vendor stack | Same vendor stack (deterministic engines) | Same vendor stack |

---

### Implications for HimaHarness

**Steps a Pack can drive in batch on an Empyrean server.** Inference throughout, grounded in the interfaces above:

1. **Inventory and mapping proposal.** A resident agent drafts the source-to-target device, terminal and parameter map from both PDKs' device lists. A deterministic step then checks coverage: every source instance is mapped, every terminal is accounted for, and every parameter expression evaluates. This mirrors Cadence's "design-inventory" check ([Cadence FAQ](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)).
2. **Netlist or schematic transform.** This works either as a text transform of the CDL or SPICE netlist (Aether SE exports both) or through PyAether. Deterministic tooling can confirm the target netlist parses and is connectivity-equivalent to the source.
3. **Target-PDK characterization.** ALPS sweeps the target devices to build gm/ID lookup tables. These are deterministic and cacheable per PDK, and they feed the re-bias step ([Jespers & Murmann](https://www.cambridge.org/core/books/systematic-design-of-analog-cmos-circuits/basic-sizing-using-the-gmid-methodology/185BE8CB4F04AD9FFC08CDE06D3EA8A9)).
4. **Re-bias and re-size loop.** The agent proposes sizes, starting from the gm/ID-preserving point. ALPS runs the reused testbenches across corners, using MDE-style text corner files or plain netlist decks. A Reader judges a spec table within a simulation-count budget. EEsizer-style closed loops show this can work for small blocks ([arXiv:2509.25510](https://arxiv.org/abs/2509.25510)). Classical optimizers (BO, or transfer-BO as in KATO) can be deterministic Pack steps alongside the agent.
5. **Statistical sign-off.** Monte Carlo and corners run on ALPS or ALPS-GT, and an external judge computes yield and margin.
6. **Layout.** This is the weakest step to automate. PyAether and Aether LE scripting plus Argus DRC/LVS can verify a migrated layout, but generating it is vendor territory. Inference: keep layout out of a first analog Pack, or limit it to verification-only steps (DRC, LVS, extraction, then post-layout re-simulation).

**Where HimaHarness adds value over the vendor's own optimizer:**
- **Independent verification.** In every vendor flow, the tool that proposes the design also declares it passed. Cadence itself warns against a "false pass" ([FAQ](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virtuoso-studio/custom-design-migration.html)). A HimaHarness Reader that re-runs the spec table from the raw netlist on a frozen corner set gives a separately owned acceptance gate, with budget and evidence on record. The gap is narrowing, though: Siemens now markets "self-verifying" agents checked against deterministic engines ([Siemens, Jul 2026](https://news.siemens.com/en-us/siemens-nvidia-dac-2026/)). Our differentiator has to be that the verifier sits *outside the agent and outside the vendor*, not merely that verification happens.
- **The Empyrean gap.** No public Empyrean product matches ASO.ai or Cadence Custom Design Migration plus ADE optimization for analog. PyAether provides the interface, and Aether Coder writes scripts but does not plan migrations or own verification. Inference: on an Empyrean-only server, an agent-planned migration Pack fills a real gap. Watch Andes Analog, which may grow into one.
- **Knowledge capture as executable procedure.** The literature's reusable asset is a technology-independent sizing procedure plus testbenches (LIP6 CAIRO+/CHAMS; [Cachaço et al.](https://past.date-conference.com/proceedings-archive/2017/pdf/0257.pdf)). Cadence's "mental model" and IP catalog chase the same goal inside Virtuoso. A Pack that ships an expert's gm/ID sizing script, mapping table and spec/testbench set as tested code, re-runnable on the next PDK, fits HimaHarness's executable-method stance. It also stays portable across vendors.
- **Vendor neutrality.** Customers with mixed Cadence, Synopsys and Empyrean stacks get one orchestration and evidence layer. Where the vendor exposes one, its optimizer can be a step: Cadence explicitly allows "your own" optimizer.

**Risks of competing with vendor optimizers:**
- **Algorithm parity.** ASO.ai's claimed 10,000 searches in about 2 h ([Synopsys](https://www.synopsys.com/blogs/chip-design/analog-ic-design-migration-ai.html)) and Cadence's built-in global optimizer are hard to beat with an LLM proposing one point per turn. Inference: HimaHarness should not sell a better optimizer. It should sell planning, verification, budget control and knowledge capture, and treat any optimizer (vendor, BO or agent) as a pluggable step.
- **Direct overlap with agent products.** ViraStack already claims agentic migration, optimization and verification inside Virtuoso, with an IP and knowledge layer ([Cadence](https://www.cadence.com/en_US/home/tools/custom-ic-analog-rf-design/virastack-ai-super-agent.html)). On Cadence-centric customers, HimaHarness would compete head-on with the incumbent. On Empyrean customers, Empyrean's own roadmap (Aether Coder, Andes) is the risk.
- **Interface uncertainty.** ALPS batch syntax, netlist dialect, licence-per-simulation cost and PyAether headless operation are not publicly documented. Each must be verified on the customer's EDA server before any Pack design commits to a simulation budget.
- **Layout and PDK legality.** A migrated schematic that passes simulation can still be unbuildable. A Pack that stops before DRC/LVS and post-layout re-simulation must not report "migrated", only "schematic re-centered".

---

## C. Open simulators and open PDKs for a public analog Pack

Retrieved 2026-10-12. Only primary sources were used: official repos (with commit or tag), simulator manuals and project pages. "Inference:" marks my own conclusions. Unreachable sources: `xyce.sandia.gov` (socket closed for the release-notes page and the 7.10 PDF) and `skywater-pdk.readthedocs.io` (HTTP 429). For those I used the GitHub repos instead.

### 1. Simulators

### ngspice (recommended)

- **Version.** ngspice-47 was released on 2026-08-11. ngspice-46 came out on 2026-03-29 and 45.2 on 2025-09-06 ([news](https://ngspice.sourceforge.io/news.html)). The download page calls ngspice-47 the latest stable release ([download](https://ngspice.sourceforge.io/download.html)). The HTML manual covers "Version 47+ (development)" ([manual](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).
- **Licence.** The COPYING file says "The ngspice license is the 'Modified BSD' license". Some parts use other licences, for example the OSDI files (MPL-2.0) and some LGPLv2 components ([COPYING](https://sourceforge.net/p/ngspice/ngspice/ci/master/tree/COPYING)).
- **OSDI/OpenVAF, needed for IHP's PSP 103.**
  - OSDI arrived in ngspice-39. Noise support for OSDI models came in ngspice-42. ngspice-43 "made OSDI a standard configure option" ([news](https://ngspice.sourceforge.io/news.html)).
  - The configure flag is `--enable-osdi`. Models are loaded at runtime with `osdi <file.osdi>` in a spinit/`.spiceinit`, or with `pre_osdi <file.osdi>` inside `.control` ([manual §9.2–9.3, §13.5.57](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).
  - OSDI device instances start with the letter `N` ([osdi page](https://ngspice.sourceforge.io/osdi.html)).
  - **Gotcha:** "Noise simulation … is only available with the Sparse 1.3 matrix solver, not with KLU" ([manual §9.2](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).
- **OpenVAF compiler.**
  - The maintained fork is OpenVAF-Reloaded (binary `openvaf-r`, GPL-3.0). Its latest release, v24.0.2mob (2026-08-25), ships linux-x86_64, **macos-aarch64**, macos-x86_64 and Windows tarballs ([release](https://github.com/OpenVAF/OpenVAF-Reloaded/releases/tag/v24.0.2mob)).
  - It emits OSDI 0.4. Ngspice ≥44 accepts OSDI 0.3 and 0.4 ([README @fdf2522b70f4](https://github.com/OpenVAF/OpenVAF-Reloaded/tree/fdf2522b70f4)).
  - The ngspice OSDI page still says OpenVAF has "no macOS for now". That line is out of date now that the Reloaded fork ships macOS builds ([osdi page](https://ngspice.sourceforge.io/osdi.html)).
- **Batch and control-language use.**
  - Command-line options: `-b/--batch`, `-r/--rawfile=FILE` and `-o/--output=FILE` (log) ([manual §12.3](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).
  - `.meas` results are not available in `-b -r` mode, because data streams straight to the rawfile. The manual's recommended pattern is a `.control … run … write out.raw … .endc` block, with `meas` commands inside `.control` ([manual §11.4.2](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).
  - `set filetype=ascii` switches the rawfile to ASCII ([manual §12.6](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)). JKU's sweep testbenches use `wrdata`, `set wr_singlescale` and `set wr_vecnames` for column text output ([techsweep @5635f2f5bb52](https://github.com/iic-jku/analog-circuit-design/blob/5635f2f5bb52/xschem/techsweep_sg13cmos5l_lv_nmos.sch)).
  - IIC-OSIC-TOOLS CI runs PDK smoke tests as `ngspice --rawfile=run.raw --output=run.log -b tb.spice` ([test_ngspice_sky130a.sh @9fc644d17593](https://github.com/iic-jku/IIC-OSIC-TOOLS/blob/9fc644d17593/_tests/06/test_ngspice_sky130a.sh)).
- **Compatibility mode.**
  - `set ngbehavior=hs` enables recursive HSPICE-style `.lib` handling and the `nf` flag. The `a` suffix (`hsa`) applies the mode to the whole netlist rather than only to included libraries ([manual §12.11](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).
  - The manual's suggested `.spiceinit` for the SkyWater PDK is `set ngbehavior=hsa`, `set ng_nomodcheck`, `option noinit`, `option klu` ([manual §12.6](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).
- **Run time.**
  - The OSDI page says OpenVAF compiles a model in about 2 s and that simulation speed is "similar to" built-in C models ([osdi page](https://ngspice.sourceforge.io/osdi.html)).
  - Murmann's open-tool README says a full four-dimensional gm/Id sweep in ngspice `.control` loops "executes relatively fast (a few minutes)" ([README @9bc96fbcfc0d](https://github.com/bmurmann/Book-on-gm-ID-design/blob/9bc96fbcfc0d/starter_files_open_source_tools/README.md)).
  - Inference: one op + ac + tran on a 5–10-transistor OTA should take well under a second of compute. The binned SKY130 libraries are large, so model loading is likely the dominant cost. That is why the manual recommends `ng_nomodcheck`. Measure this on the server before setting agent time-boxes.
- **Installation routes.**
  - **Homebrew:** ngspice 47, with bottles for arm64 macOS (sonoma → tahoe) and x86_64/arm64 Linux ([formula API](https://formulae.brew.sh/api/formula/ngspice.json)). The formula configures `--enable-cider --enable-xspice --disable-openmp --enable-pss` and does not pass `--enable-osdi` explicitly ([ngspice.rb](https://github.com/Homebrew/homebrew-core/blob/HEAD/Formula/n/ngspice.rb)). Inference: OSDI should still be built in, because it has been a standard configure option since ngspice-43. Verify with a `pre_osdi` smoke test.
  - **conda-forge:** stuck at **ngspice 41**, for linux-64, osx-64 and win-64 only (no osx-arm64) ([anaconda.org](https://anaconda.org/conda-forge/ngspice)). Not usable for IHP.
  - **RHEL/Rocky:** the Fedora metadata API has no ngspice package for `epel9` or `epel10` (HTTP 400, whereas a control package returns 200). Fedora rawhide has `47-1.fc45` ([mdapi](https://mdapi.fedoraproject.org/rawhide/pkg/ngspice)). The ngspice project ships no Linux binaries and tells Linux users to use distro packages or build from the tarball ([download](https://ngspice.sourceforge.io/download.html)).
  - **Docker:** the IIC-OSIC-TOOLS image pins ngspice tag `ngspice-47`, Xyce `Release-7.10.0`, VACASK, OpenVAF and open_pdks `1689ac3f…` ([tool_metadata.yml @9fc644d17593](https://github.com/iic-jku/IIC-OSIC-TOOLS/blob/9fc644d17593/_build/tool_metadata.yml)). It is published as `hpretl/iic-osic-tools` (latest tag `2026.09`), is about 4 GB compressed and needs at least 20 GB of disk. It supports amd64 and arm64 natively on an Ubuntu 24.04 base, under Apache-2.0 ([README](https://github.com/iic-jku/IIC-OSIC-TOOLS), [release 2026.09](https://github.com/iic-jku/IIC-OSIC-TOOLS/releases/tag/2026.09)).
  - Inference: for a RHEL server, a source build of ngspice-47 with `--enable-osdi --enable-klu` plus the `openvaf-r` Linux tarball is the lightest route. The docker image is the most reproducible.

### Xyce

- **Version and licence.** Release-7.10.0 (GitHub release 2025-07-21) is the latest tag. Its licence is GPL-3.0. Sandia's binary installers for Windows, Mac and Red Hat Linux "include proprietary compact models", so they differ from the GPL build. Xyce is also available through Spack ([release](https://github.com/Xyce/Xyce/releases/tag/Release-7.10.0), [README](https://github.com/Xyce/Xyce)). I could not reach the 7.10 release notes.
- **IHP.** IHP ships `libs.tech/xyce/models/`, an xschem `sg13g2_tests_xyce` set, and an ADMS script (`adms-compile-va.sh`). The script builds PSP as a plugin (`Xyce -plugin …/Xyce_Plugin_PSP103_VA.so netlist`) ([verilog-a/README.md @main 5e6d592e4002](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/ihp-sg13g2/libs.tech/verilog-a/README.md)). IHP's tested version is Xyce 7.8 ([versions.txt](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/versions.txt)).
- **GF180.** The primitives repo ships `design.xyce`, `sm141064.xyce` and `smbb000149.xyce` ([models/README.rst @9f992d5a9186](https://github.com/google/globalfoundries-pdk-libs-gf180mcu_fd_pr/blob/9f992d5a9186/models/README.rst)).
- **SKY130.** open_pdks' sky130 and gf180mcu Makefiles install only `libs.tech/ngspice` and contain no Xyce target ([sky130/Makefile.in @0ec4fa67eade](https://github.com/RTimothyEdwards/open_pdks/blob/0ec4fa67eade/sky130/Makefile.in)). Inference: Xyce on SKY130 would rely on third-party ports. Xyce is only useful here as an optional cross-check on IHP or GF180.

### VACASK and others

- **VACASK** ([Codeberg](https://codeberg.org/arpadbuermen/VACASK)):
  - Licence AGPL-3.0, with a Spectre-like netlist syntax. Every device is an OSDI model built with OpenVAF-Reloaded (BSIM4v8, PSP103.4, VBIC, and others).
  - It covers op/dc/ac/noise/tran plus PSS, PAC, PNoise and HB.
  - It claims "IHP Open PDK support for the sg13g2 and sg13cmos5l technologies" and "GF180 PDK support". Sky130 is not mentioned.
  - Pre-built packages exist for Debian-based Linux and Windows. macOS needs a source build.
  - IIC-OSIC-TOOLS ships it with a `fix_cmos5l_vacask_converter.py` patch ([tree @9fc644d17593](https://github.com/iic-jku/IIC-OSIC-TOOLS/tree/9fc644d17593/_build/images/open_pdks/scripts)).
  - Inference: VACASK is promising but too young to anchor a demo.
- **Spectre/HSPICE.** No open PDK here ships Spectre `.scs` decks. Within ngspice, `ngbehavior=spe` only affects `nf` handling: "True compatibility today is still far away" ([manual §12.11.9](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).

### 2. Open PDKs

| | SKY130 | GF180MCU | IHP SG13G2 (+SG13CMOS5L) |
|---|---|---|---|
| Licence | Apache-2.0 ([skywater-pdk](https://github.com/google/skywater-pdk)) | Apache-2.0 ([gf180mcu-pdk](https://github.com/google/gf180mcu-pdk)) | Apache-2.0 ([IHP-Open-PDK](https://github.com/IHP-GmbH/IHP-Open-PDK)) |
| Status | "experimental preview / alpha" ([README @7198cf647113](https://github.com/google/skywater-pdk/blob/7198cf647113/README.rst)) | Google repo **archived** (last commit 2023-05-31); maintained through open_pdks; wafer.space keeps a `gf180mcuD` dev repo ([wafer-space/gf180mcu @ac7d8696de96](https://github.com/wafer-space/gf180mcu)) | "preview only", release v0.3.0 (2026-03-11); active `dev` branch (d9b9e531f6ec, 2026-10-12) ([README](https://github.com/IHP-GmbH/IHP-Open-PDK)) |
| MOS model | BSIM4 `level = 54.0`, `version = 4.5`, binned ([nfet_01v8 tt pm3](https://github.com/google/skywater-pdk-libs-sky130_fd_pr/blob/main/cells/nfet_01v8/sky130_fd_pr__nfet_01v8__tt.pm3.spice)); open_pdks also installs "combined" continuous models ([Makefile.in](https://github.com/RTimothyEdwards/open_pdks/blob/0ec4fa67eade/sky130/Makefile.in)) | BSIM4 `level = 54`, versions 4.5 and 4.6 ([sm141064.ngspice](https://github.com/google/globalfoundries-pdk-libs-gf180mcu_fd_pr/blob/9f992d5a9186/models/ngspice/sm141064.ngspice)) | **PSP 103.8.2** Verilog-A (JUNCAP 200.6.2), loaded via OSDI ([psp103.va](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/ihp-sg13g2/libs.tech/verilog-a/psp103/psp103.va)); HBT model is **VBIC** (level 9), not HICUM, in the ngspice deck ([sg13g2_hbt_mod.lib](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/ihp-sg13g2/libs.tech/ngspice/models/sg13g2_hbt_mod.lib)) |
| Simulators | ngspice (open_pdks); no first-party Xyce | ngspice and Xyce decks | ngspice 43, Xyce 7.8, OpenVAF 23.5.0 listed as tested ([versions.txt](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/versions.txt)) |
| MOS corners | `tt sf ff ss fs ll hh hl lh` ([sky130.lib.spice](https://github.com/google/skywater-pdk-libs-sky130_fd_pr/blob/main/models/sky130.lib.spice)) | `typical ff ss fs sf` (+ `bjt_*`, `diode_*`, `res_*`) | `mos_tt mos_ss mos_ff mos_sf mos_fs` (+ `_mismatch`, `mos_tt_stat`); `cap_typ/bcs/wcs`, `res_typ/bcs/wcs`, `hbt_typ/bcs/wcs` ([cornerMOSlv.lib](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/ihp-sg13g2/libs.tech/ngspice/models/cornerMOSlv.lib)) |
| Core devices | 1.8 V `sky130_fd_pr__nfet_01v8`, `pfet_01v8`, `_lvt`, `pfet_01v8_hvt`; 5 V/10.5 V `g5v0d10v5`; 20 V devices ([device-details.rst](https://github.com/google/skywater-pdk/blob/7198cf647113/docs/rules/device-details.rst)) | "0.18 µm 3.3V/6V MCU process" ([README](https://github.com/google/gf180mcu-pdk)); open_pdks names `nfet_03v3`, `pfet_03v3`, `nfet_05v0`/`06v0` | thin oxide **1.2 V** `sg13_lv_nmos/pmos` (L ≥ 0.13 µm), thick oxide **3.3 V** `sg13_hv_*`; SiGe HBT fT 350 GHz ([README](https://github.com/IHP-GmbH/IHP-Open-PDK)) |
| ciel build (compressed) | `common` 6 MB + `sky130_fd_pr` 13 MB; full build >3 GB including std cells ([ciel-releases sky130-f6eeac7d…, 2026-07-14](https://github.com/fossi-foundation/ciel-releases/releases/tag/sky130-f6eeac7dad085ffcc829ccfd721f7b4ce39edcf7)) | `common` 162 MB (build 2026-10-01) | `common` 414 MB, matching IHP main 5e6d592e4002; `ihp-sg13` family 421 MB including CMOS5L |

**Version manager.** ciel 3.0.1 (2026-10-06, Apache-2.0) succeeds volare. It installs sky130 and gf180mcu builds keyed by open_pdks commit, and ihp-sg13g2 builds keyed by IHP-Open-PDK commit. Install with `python3 -m pip install --user ciel`. It supports macOS and RHEL 8+ ([README @d2af9cd67681](https://github.com/fossi-foundation/ciel)). The current open_pdks version is 1.0.611 ([VERSION @0ec4fa67eade](https://github.com/RTimothyEdwards/open_pdks/blob/0ec4fa67eade/VERSION)).

### Exact include lines (verified in first-party testbenches)

SKY130. These lines come from IIC-OSIC-TOOLS CI, which comments the first as "old binned models" and the second as "new continuous models" ([ngspice_boris.spice @9fc644d17593](https://github.com/iic-jku/IIC-OSIC-TOOLS/blob/9fc644d17593/_tests/06/ngspice_boris.spice)):
```spice
* old binned:      .lib $PDK_ROOT/sky130A/libs.tech/ngspice/sky130.lib.spice tt
.lib $PDK_ROOT/sky130A/libs.tech/combined/sky130.lib.spice tt
XM1 d g s b sky130_fd_pr__nfet_01v8 L=0.15 W=1 nf=1 ...
```
The required `.spiceinit` is the one IIC-OSIC-TOOLS ships ([skel .spiceinit](https://github.com/iic-jku/IIC-OSIC-TOOLS/blob/9fc644d17593/_build/images/iic-osic-tools/skel/headless/.spiceinit)): `set ngbehavior=hsa`, `set ng_nomodcheck`, `set num_threads=4`, and `set enable_noisy_r`. The last one exists because "sky130A uses behaviour resistor in models, make sure they add noise". Devices are subcircuits, so instances use `X`.

GF180MCU. `design.ngspice` must be included **before** the corner `.lib` ([inv_tb.spice @9fc644d17593](https://github.com/iic-jku/IIC-OSIC-TOOLS/blob/9fc644d17593/_tests/14/inv_tb.spice)):
```spice
.include $PDK_ROOT/gf180mcuD/libs.tech/ngspice/design.ngspice
.lib     $PDK_ROOT/gf180mcuD/libs.tech/ngspice/sm141064.ngspice typical
XM1 vo vi vss vss nfet_03v3 L=0.28u W=1u nf=1 ...
```
`design.ngspice` holds the global Monte-Carlo and mismatch switches (`sw_stat_global`, `sw_stat_mismatch`) and the flicker-noise settings. High-voltage devices live in a separate deck, `smbb000149.ngspice` ([models/README.rst](https://github.com/google/globalfoundries-pdk-libs-gf180mcu_fd_pr/blob/9f992d5a9186/models/README.rst)). The metal-stack variants are A–D, and both Murmann and IIC-OSIC-TOOLS use `gf180mcuD`.

IHP SG13G2. The corner `.lib` is referenced by bare file name, which relies on `sourcepath` being set in IHP's own `.spiceinit` ([dc_lv_nmos.spice @9fc644d17593](https://github.com/iic-jku/IIC-OSIC-TOOLS/blob/9fc644d17593/_tests/05/dc_lv_nmos.spice), [.spiceinit @5e6d592e4002](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/ihp-sg13g2/libs.tech/ngspice/.spiceinit)):
```spice
.lib cornerMOSlv.lib mos_tt          $ or cornerMOShv.lib; cap: .lib cornerCAP.lib cap_typ
XM1 d g s b sg13_lv_nmos w=1.0u l=0.13u ng=1 m=1
```
The IHP `.spiceinit` does three things:
- It sets `setcs sourcepath = ( $sourcepath $PDK_ROOT/$PDK/libs.tech/ngspice/models … )`.
- It loads `osdi '$PDK_ROOT/$PDK/libs.tech/ngspice/osdi/psp103.osdi'`, plus `psp103_nqs`, `r3_cmc`, `mosvar`, `cap_cmomi` and `cap_cmomf`.
- It keeps `ngbehavior=hsa` **commented out** and warns that "KLU solver still do not work correctly for every simulation".

The `.osdi` files are **not in git**. They must be compiled with `ihp-sg13g2/libs.tech/verilog-a/openvaf-compile-va.sh`, which prefers `openvaf-r` and falls back to `openvaf`, and accepts `--compile-model-generic` for a portable CPU target ([script](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/ihp-sg13g2/libs.tech/verilog-a/openvaf-compile-va.sh)). Alternatively, run `libs.tech/ngspice/install.py`, which compiles the models and symlinks `.spiceinit` into `$HOME` ([install.py](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/ihp-sg13g2/libs.tech/ngspice/install.py)). The PSP model inside each device subcircuit is an `N` instance (`Nsg13_lv_nmos d g s b sg13g2_lv_nmos_psp`) ([sg13g2_moslv_mod.lib](https://github.com/IHP-GmbH/IHP-Open-PDK/blob/5e6d592e4002/ihp-sg13g2/libs.tech/ngspice/models/sg13g2_moslv_mod.lib)).

**SG13CMOS5L.** This is a CMOS-only variant. Its standalone repo is archived and says the content "has been merged into the IHP-Open-PDK repository" ([ihp-sg13cmos5l](https://github.com/IHP-GmbH/ihp-sg13cmos5l)). At present the `ihp-sg13cmos5l/` directory exists on the `dev` branch but not on `main` ([dev tree](https://github.com/IHP-GmbH/IHP-Open-PDK/tree/dev)). JKU's characterisation of it uses the same `.lib cornerMOSlv.lib mos_tt` and `sg13_lv_nmos` device ([techsweep_sg13cmos5l_lv_nmos.sch](https://github.com/iic-jku/analog-circuit-design/blob/5635f2f5bb52/xschem/techsweep_sg13cmos5l_lv_nmos.sch)).

### Gotchas summary

- **SKY130**
  - Without `hsa` the HSPICE-style nested `.lib` decks do not parse ([manual §12.11.10](https://ngspice.sourceforge.io/docs/ngspice-html-manual/manual.xhtml)).
  - Binned models are slow to load, which is why the manual recommends `ng_nomodcheck`.
  - `enable_noisy_r` is needed for correct resistor noise.
  - Area and perimeter parameters (`ad/as/pd/ps` expressions with 0.29 µm) must be supplied on each instance, as the CI netlists do.
- **GF180**
  - The Google repo is archived, so pin an open_pdks or ciel commit.
  - Include `design.ngspice` first.
  - The 6 V thick-oxide devices sit in the same deck as the 3.3 V devices, with HV devices in a separate deck.
- **IHP**
  - The OSDI binaries must be compiled per platform, with separate builds for macOS arm64 and Linux x86_64.
  - `$PDK_ROOT` and `$PDK` must be exported for the `.spiceinit`.
  - Noise with OSDI models requires Sparse, not KLU.
  - Maximum single-finger width is 10 µm, so use `ng` for wider devices ([AnalogAcademy OTA](https://github.com/IHP-GmbH/IHP-AnalogAcademy/blob/133ecf657572/modules/module_1_bandgap_reference/part_1_OTA/README.md)).

### 3. Ready open reference circuits (first-party preferred)

- **JKU "Analog (Integrated) Circuit Design" course.** Harald Pretl, Apache-2.0, release v1.1 (2026-09-17), head 5635f2f5bb52 ([repo](https://github.com/iic-jku/analog-circuit-design)). It is the best fit for this Pack.
  - It uses ngspice and xschem on **SG13CMOS5L**.
  - It ships `ota-5t`, `ota-improved` and `ota-diff` schematics with `tb-ac`, `tb-loopgain`, `tb-noise` and `tb-tran` testbenches, plus a simple-LDO figure.
  - It includes gm/Id sizing notebooks (`sizing_basic_ota*.ipynb`, `sizing_diff_ota.ipynb`), SG13 lookup tables (`sg13_lv_nmos.mat` and others) and **CACE datasheets** (`cace/voltage-buffer-ota.yaml`).
  - The datasheet sets PDK `ihp-sg13cmos5l`, Vdd 1.45–1.55 V, Ibias 20 µA, Cload 50 fF and gain spec 0.97–1.03 V/V, swept across corner, temperature and Vdd ([yaml](https://github.com/iic-jku/analog-circuit-design/blob/5635f2f5bb52/cace/voltage-buffer-ota.yaml)).
  - Inference: this spec, simulate and judge structure maps directly onto "agents propose, simulator measures, deterministic readers judge".
- **CACE (Circuit Automatic Characterization Engine).** Apache-2.0, `pip install cace`, head dedb5e0d30f5 ([fossi-foundation/cace](https://github.com/fossi-foundation/cace)). It is a spec-driven characterisation runner with corner, Monte-Carlo and mismatch sweeps and a summary report.
- **IHP AnalogAcademy.** Apache-2.0, head 133ecf657572 ([repo](https://github.com/IHP-GmbH/IHP-AnalogAcademy)).
  - Module 1 is a two-stage Miller OTA on SG13G2 lv devices at 0–1.2 V with Cc ≈ 750 fF MIM.
  - It provides a testbench, a mismatch Monte-Carlo testbench and a gm/Id sizing notebook (`gmid_example/scripting/OTA_low_gain.ipynb`) that uses `mosplot` LUTs.
  - Modules 1–3 then cover a bandgap, a 50 GHz PA and an 8-bit SAR ADC.
- **Murmann gm/Id starter files.** **AGPL-3.0** ([Book-on-gm-ID-design @9bc96fbcfc0d](https://github.com/bmurmann/Book-on-gm-ID-design/tree/9bc96fbcfc0d/starter_files_open_source_tools)). It has xschem and ngspice `techsweep_*.sch` files plus pre-generated `.mat` LUTs for **sky130** (`nfet_01v8`, `_lvt`, `pfet_01v8`, `_lvt`), **ihp-sg13g2** (lv/hv nmos/pmos) and **gf180mcuD** (`nfet_03v3`, `05v0`, `pfet_*`). These are the same three PDKs, characterised with one method.
- **IHP device testbenches** under `libs.tech/xschem/sg13g2_tests`: dc/ac/Monte-Carlo for lv/hv MOS and HBT. They are useful as smoke tests for the simulator ([tree](https://github.com/IHP-GmbH/IHP-Open-PDK/tree/5e6d592e4002/ihp-sg13g2/libs.tech/xschem/sg13g2_tests)).
- **SKY130 OTA/LDO.** I found no first-party (Google or SkyWater) OTA or LDO reference. Community repos exist but are not first-party, for example `mole99/sky130_leo_ip__ota5t` (Apache-2.0, by a CACE maintainer) and `efabless/sky130_ef_ip__power_on_reset` (Apache-2.0, includes an LDO). Treat them as unvetted.

### 4. gm/Id lookup-table tooling

| Tool | Licence | ngspice/PDK fit |
|---|---|---|
| **mosplot** ([medwatt/gmid @6c4c5e164295](https://github.com/medwatt/gmid)) | Apache-2.0 | Generates LUTs by driving ngspice, HSPICE or Spectre. `NgspiceSimulator(include_paths=…, lib_mappings=[(lib, "tt")], osdi_paths=[…])`, so IHP PSP is supported directly. Builds one table per corner. Its multicorner optimiser writes a sizing netlist for verification ([docs/lookup_tables.md](https://github.com/medwatt/gmid/blob/6c4c5e164295/docs/lookup_tables.md)). Used by the IHP AnalogAcademy. |
| **pygmid** ([dreoilin/pygmid @a9563980b30b](https://github.com/dreoilin/pygmid)) | Apache-2.0 | Python port of Murmann's `look_up`. Reads `.mat` or its own `.pkl` (`pip install pygmid`). Murmann's open starter kit recommends it. |
| **Murmann techsweep** (above) | AGPL-3.0 | Uses ngspice `.control` `foreach` loops, `alterparam`, `wrdata`, then txt → `.mat`. Inference: do not vendor its `.mat` or `.sch` files into an Apache repo. Regenerate the tables with Apache-licensed scripts instead. |
| **JKU techsweep** ([xschem/techsweep_sg13cmos5l_*.sch](https://github.com/iic-jku/analog-circuit-design/tree/5635f2f5bb52/xschem)) | Apache-2.0 | Same loop structure: L ∈ {0.13 … 10 µm}, VGS/VDS 0–1.5 V in 25 mV steps, VSB ∈ {0, 0.4, 0.8, 1.2}. Safe to adapt. |

### 5. Recommendation

**Simulator: ngspice-47.**
- All three PDKs ship ngspice decks first-party.
- Its licence is Modified BSD, and `.meas`, `.control`, `wrdata` and rawfile output give deterministic, parseable results.
- OSDI covers PSP.
- Xyce adds GPL-3.0, an uneven PDK story (no SKY130 deck) and differences between the proprietary binary and the open source build. Use it at most as an optional IHP cross-check.
- Pin `openvaf-r` v24.0.2mob for the IHP models.

**Migration pair: SKY130 (1.8 V, BSIM4) → IHP SG13G2/SG13CMOS5L (1.2 V lv, PSP 103.8.2).**

Inference, reasoning:
1. **The migration is meaningful.** Supply drops from 1.8 V to 1.2 V and Lmin goes from 0.15 to 0.13 µm. A 1.8 V two-stage OTA's headroom budget, input common-mode range and cascode options have to be re-derived, not just rescaled. The model family also changes from BSIM4 to PSP, so the gm/Id curves differ in shape. That is a real reason to re-derive the design from LUTs.
2. **The reference material is credible.** The IHP side has the strongest first-party analog material anywhere in open source: JKU OTAs with CACE specs and AnalogAcademy OTAs. Murmann provides one-method LUT kits for both PDKs.
3. **The audience knows SKY130**, so it is a recognisable "origin" node.
4. **The cost is moderate.** The IHP OSDI compile is a one-time step per platform, and OpenVAF-Reloaded now ships macOS arm64 builds. SPICE-only payloads are small: about 19 MB compressed for SKY130 (`common` + `fd_pr`), though the IHP `common` build is 414 MB.

**Lower-risk fallback: GF180MCU (3.3 V) → SKY130 (1.8 V).**
- Both use BSIM4, so there is no OSDI, and the 180 → 130 nm and 3.3 → 1.8 V story is clean.
- The drawbacks are an archived upstream repo and fewer first-party analog references.

**Avoid IHP ↔ SKY130 at the 3.3 V hv devices**, because it weakens the voltage-scaling story.

**Pin everything by commit:** open_pdks / ciel build hash, IHP-Open-PDK `5e6d592e4002`, ngspice-47, and openvaf-r v24.0.2mob. Before any agent loop, smoke-test with each PDK's own dc testbench.
