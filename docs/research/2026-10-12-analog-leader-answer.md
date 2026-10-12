# Can HimaHarness do analog design? (one page, 2026-10-12)

**Yes, for all four asks, using the same mechanism as the digital demos.** AI agents propose designs.
The EDA server's simulator measures every design: Cadence Spectre on our lab server, with open
ngspice as the agents' sketch pad. Independent checks outside the agent decide against the spec sheet,
within a time and round budget. The senior designer's method ships inside the Pack as tested code
plus playbooks, so it re-runs on the next process. No HimaHarness architecture change is needed;
analog is a new Pack plus a Site.

| Ask | Answer | How |
| --- | --- | --- |
| **Analog migration** (port to a new process/PDK) | **Yes, at schematic level today; layout later.** | The gm/Id method keeps each transistor's inversion level and current and recomputes widths from the new process's measured tables. A migration agent then re-biases for the new supply. The same testbench judges both processes at every corner. Layout migration, extraction and Monte Carlo are later steps. |
| **Spec-driven synthesis** | **Yes for sizing of known topologies; topology choice is a next step.** | The spec sheet is the Goal (gain, bandwidth, phase margin, power). The Pack turns it into a textbook first cut automatically; the agent refines and the simulator confirms. New topologies (LDO, folded cascode) are templates added to the same Pack. |
| **Adaptive optimization** | **Yes.** | The agent iterates against the simulator inside its task. The Pack re-simulates every delivery and can loop rounds with verified lessons. A classical optimizer (Bayesian optimization, or a vendor optimizer) can be added as a step the agent seeds; published work shows that hybrid beats either alone. |
| **Expert knowledge** | **Yes; this is our differentiator.** | Know-how becomes executable, regression-tested Pack code: sizing equations, porting rules and acceptance checks. Playbooks cover the judgement. Vendors (Cadence ViraStack, Synopsys ASO.ai) let the same tool propose and declare the pass; we verify outside both the agent and the vendor. |

**What already works (branch `demo/analog-ota`, tested):**

- **Spec to OTA.** A two-stage OTA goes from a spec sheet to a sized design to a migrated design to a
  before/after table.
- **Cadence Spectre on the lab server:**
  - Spectre 23.1 runs the whole flow.
  - Results on GF180MCU, a real open 180 nm PDK: the textbook first cut gives 92 dB gain, 10.7 MHz,
    63° phase margin and 218 µW at the worst corner. It meets every line except power, which is 9 %
    over at 3.3 V — exactly the kind of miss the agent then fixes.
  - Open ngspice gives the same worst-corner numbers as Spectre on the same decks. Agents can
    iterate cheaply while Spectre stays the judge.
- **Migration on synthetic test processes** (1.8 V → 1.2 V): the direct port misses the spec because
  the lower supply leaves too little headroom. A re-biased port meets it with 4.3 % margin. This is
  the story the agents will tell on screen.

**Proposed first demo** (about 15 minutes in the App, recorded like the AndesCell demo):

1. The designer gives a spec sheet: 60 dB, 10 MHz, 60°, 200 µW, 2 pF load.
2. The Pack builds gm/Id design curves for both processes.
3. The sizing agent sizes the OTA in GF180MCU and Spectre verifies it at three corners.
4. The migration agent ports it to the second process; the naive port fails, the agent re-biases,
   and the simulator confirms.
5. The run ends on a before/after table and charts.

**Decision needed:** the second process, one of:

- IHP SG13G2 1.2 V (open, real, measured with ngspice, because its models do not load in Spectre);
- a customer's own foundry PDK at their site (all Spectre; that data never enters our public repo).

**Risks:**

1. **Schematic-only** until layout, extraction and Monte Carlo steps are added. We must not claim a
   "migrated chip".
2. **Overlap with Cadence ViraStack and Synopsys ASO.ai** on Cadence/Synopsys customers. Sell
   independent verification, captured method and vendor neutrality, not a faster optimizer.
3. **Empyrean.** Our lab server has no Empyrean analog tools (Aether/ALPS), so an Empyrean-native
   analog story needs those installed and their batch interface checked.
4. **Agent quality.** DeepSeek Flash as the sizing agent is not yet measured. The Pack's tools do the
   arithmetic, which lowers this risk.

Details: [research](2026-10-12-analog-design-for-himaharness.md) ·
[evidence](2026-10-12-analog-design-evidence.md) · [Pack spec](../specs/analog-ota-pack/spec.md)
