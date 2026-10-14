# Pixel layout optimization

## Business

An OLED display pixel is a small repeated cell: a handful of thin-film transistors (TFTs), one storage
capacitor and the lines that connect them, drawn on a few conductive layers under an emitting anode.
A designer draws it by hand. The customer then wants the same circuit in a smaller cell, with less
parasitic coupling onto the storage node and a transmittance inside a window. Today that is manual
GUI work, iterating over DRC, LVS, extraction and simulation, often over weeks. An earlier vendor
agent prototype automated part of it by moving one polygon edge at a time. This Pack starts from the
designer's original layout and optimizes it.

**What is explored.** Within a fixed circuit, fixed transistors and a fixed layer stack, a Run varies:
- the positions of polygon edges that are not part of a TFT channel or the storage capacitor (µm, on
  the layout grid);
- the cell pitch in x and y (µm);
- a small set of declared edits the resident may switch on, each with its own parameters: a shield
  plate on a fixed-potential net, a storage-capacitor stretch (only as a declared schematic change),
  a shift of the emission opening, and slimming of an opaque band;
- moving a contact or reordering lines, only when the Goal allows topology changes.

TFT channels (gate over poly) stay congruent to the original's, nets stay as the schematic says, and
the storage capacitor's LVS value stays inside its tolerance unless a declared change says otherwise.

**What is measured.** Every candidate is judged from the commercial tools' own reports:
- DRC: Argus with the authority deck on the single cell and on 2×2 and 3×3 tiles; the reference deck
  is reported separately; the deck's connectivity (`geom_interact`) rules are checked in geometry when
  the Site's licence cannot run them.
- LVS against the declared schematic, including the W/L/C tolerances.
- Pairwise capacitances from RCExplorer pixel extraction. From those:
  - the coupling ratio Ct/Cs, where Ct is the sum over a declared list of aggressor nets onto the
    storage node, and Cs is the storage node to its storage net;
  - the named couplings with limits (e.g. storage node to Data, supply to Data);
  - the total capacitance of each line whose load the Goal limits (e.g. the scan line, the anode).
- Geometry: cell outline; channel congruence; transmittance on the tiled array and on the own cell;
  emission area; the vendor prototype's PDL-symmetry figure, kept so results compare with the
  customer's own reports.
- Post-layout simulation through ALPS, only when the Site provides a testbench consistent with the
  LVS schematic.

**What ends it.** See Answers 3. Every ending is stated with the values that show it. Running out of
budget is reported as running out of budget, never as a conclusion.

**What a person must never have to guess.**
- Which Ct definition a ratio uses, and its net list.
- Which deck is the authority, and which deck and tile a DRC count came from.
- Whether a capacitance is the LVS device value (from the capacitor marker) or the extracted N1-to-storage-net value, which also includes overlap outside the marker.
- Whether transmittance is tiled or own-cell.
- Whether a number is measured by a tool, estimated by the Pack's fitted model, or unknown.
- Whether a change to the schematic was declared.
- Whether the Goal was met, or the Run delivered a best effort with a stated shortfall.

**Counterexamples the readers and rules must survive.** All four are real files seen on the
reference Site:
1. An extraction whose GDS import failed. An empty or missing `RCEResult.sp` reads as unknown, never
   as zero coupling. A stale library from an earlier candidate must be refused (fresh library per
   candidate).
2. A DRC run that produced no summary file. That is a refusal, not a clean result.
3. A layout whose anode net is open (the vendor prototype's own starting pixel). LVS must report it
   incorrect.
4. A layout with an enlarged storage capacitor and an unchanged schematic. LVS must fail on the C
   tolerance, and the ratio must not be credited.

**Input, feedback and budget.**
- **Input identity:** one Site manifest naming, with hashes:
  - the original GDS and its top cell;
  - the authority and reference DRC decks;
  - the LVS deck (or its validated translation) and the schematic;
  - the extraction set (technology file, layer maps, run script);
  - optionally an ALPS testbench and models;
  - the layer roles and net roles (storage node, storage net, aggressors, loaded lines).
- **Feedback that may change the next move:** the tools' reports on earlier candidates, and the
  Pack's model fitted to them.
- **Budget:** a time box, a round limit, and the extraction parallelism the Site allows.

## Golden Flow

The flow lies on the reference Site (Linglong). It was proven on 2026-10-13 by taking the designer's
original cell to a smaller cell, clean on the authority deck, with LVS passing and the TFTs
unchanged. Read there, never copied:
- `tools/eval_v2.sh`: one candidate's whole judgement. DRC on both decks × 1×1/2×2/3×3; LVS through
  the Calibre translation; GDS into a fresh OA library and RCExplorer pixel extraction; markers and
  logs.
- `tools/batch_v4.sh`, `tools/reap.py`, `tools/summarize.py`: parallel judgement in a dedicated
  container with a reaper, and the stdlib summary of each candidate's reports.
- `tools/lvs_calibre.svrf.tmpl`, `tools/RCEInput.tcl.tmpl`, `tools/gds_layer.map`,
  `tools/drc_case.base`, `tools/drc_agent.base`: the templated decks and extraction script.
- `pytools/`: the method.
  - `compact.py` + `euclid.py`: the LP compactor.
  - `checks.py`, `nets.py`, `dspace*.py`: geometry checks, connectivity, coupling attribution and
    its fitted model.
  - `edit.py`, `shield.py`, `ttrim.py`, `v2.py`: edit operators.
  - `drcmarks.py`, `lazy.py`: DRC marker feedback.
  - `fixes.py`, `post.py`, `targeted.py`: case-specific recipes, reference only.
- `env38/`: the Python 3.8 venv inside the EDA container (numpy, SciPy with HiGHS, Shapely, gdstk).
- `*.jsonl`: the judged history of every candidate of the proving campaign.
- `inputs/`: read-only copies of the customer case.

The customer case itself lies at
`/data/eda/project/pixel_agent/Pixel_Agent_20261013/OLED_Case_V2_20260918`.

Flow root: /data/eda/project/hima_harness/pixel-runs

## Answers

1. **Name.** `pixel-layout-optimization`.
2. **Starting point and comparison.** The Run starts from the designer's original layout. Beating the
   vendor prototype's results is not a Goal, and no comparison with another tool runs inside the Run;
   those comparisons are made outside the product.
3. **Endings.** Four:
   - **Goal met:** outline and ratio targets met, with every hard limit holding, on Reader values.
   - **Converged:** the best Goal ratio at the best legal outline improved by less than the declared
     band over two rounds, and the limiting bound (pitch chain or coupling floor) is reported.
   - **Blocked by a hard limit:** a target that cannot be reached without breaking a hard limit ends
     with a Decision Request carrying the trade-off table.
   - **Budget reached:** stated as such, with the best layout so far and its shortfall. Not dressed up
     as a conclusion.
4. **What is explored.** Non-device edges, the pitch, and the declared edits in Business. Contact
   moves only when the Goal allows topology changes. Transistors, nets and the stack stay frozen.
5. **Goal.** Met only when both the outline and the ratio targets are met on checked values.
   Otherwise the delivery is the best layout found, plus the trade-off curve, with the shortfall
   stated.
6. **History.** Every judged candidate is recorded with its round, its edits and its measures. The
   Run delivers a trend chart like the vendor prototype's report: each measure normalised to its
   target (1.0 = target line), per candidate and best so far.
7. **Customer answers not yet given.** Every one is a Goal, Strategy or manifest value, so a later
   answer is a new value, not a new Pack:
   - the Ct net list and the ratio target;
   - the outline target;
   - the authority deck;
   - the storage-capacitor policy (fixed within the LVS tolerance, or a declared ceiling);
   - the load allowance per limited line (default: at most +5 % over the original);
   - whether extracted N1-to-storage-net overlap outside the capacitor marker may count toward Cs (default: counted as extracted, and reported separately);
   - the ALPS testbench (default: absent, so simulation values are unknown).
   
   The values known today belong to the Site's case manifest and the Run's Goal, not to this Pack.
8. **Golden Flow.** The proving campaign on Linglong (see Golden Flow), plus the customer case.
9. **Counterexamples.** The four in Business.
10. **Budget.** A 3-hour time box and at most 6 rounds. Extraction parallelism comes from the Site
    (3 today, until the container's process limit is raised). The FPD licence mode excludes other
    licence modes while a Run is active.
11. **Who does what.**
    - The resident engineering agent (OpenCode) reads a design-space card and writes a plan for each
      round: which edits, which front points, which extra pair constraints. It repairs the last few
      DRC markers with bounded edits.
    - Program tasks do the solving, judging, deciding and delivering.
    - The agent never grades its own candidates.

## Ambiguities resolved

- **Which Ct.** The vendor prototype's code sums five aggressor nets ("narrow"); the customer's
  report adds the scan line and the anode ("broad"). Settled: the Goal names the net list. Both
  ratios are always measured and reported, and the Run's Goal names which one is judged.
- **Which deck.** The two decks on the Site disagree (different spacing values). Settled: the
  manifest names the authority deck, which the Goal judges; the other deck's counts are reported
  under their own names.
- **Which capacitance is Cs.** LVS measures the capacitor device from its marker; extraction measures
  all N1-to-storage-net coupling, including overlap outside the marker. Settled: both are reported. LVS keeps
  the device within tolerance; a Strategy value says whether extra overlap may count.
- **How a transistor is "unchanged".** The vendor prototype checks bounding-box W/L; one of its results
  passed that while reshaping a channel. Settled: channels must be congruent to the original's, plus
  LVS W/L. The bounding-box figure is not used.
- **Which transmittance.** The customer's report gives the own-cell value; neighbours' overhangs make
  the tiled value the physical one. Settled: both are reported. A Goal value names which one the
  window judges, default tiled.
- **Which LVS engine.** The deck is written for Argus LVS, but the Site licence lacks the feature it
  needs. Settled: the Site declares the engine. The Calibre translation is the validated one today: it
  passes the original and fails the open-anode and enlarged-capacitor counterexamples.
- **Case recipes vs a portable method.** The proving campaign used coordinate-specific repairs. Settled:
  the Pack ships generic edit operations and the agent writes case recipes at run time; the
  campaign's recipes stay on the Site as reference.
- **Numeric dependencies.** The Pack's method needs numpy, SciPy (HiGHS), Shapely and gdstk, where the
  MAGE Packs are stdlib-only. Settled: the Site provides a pinned venv inside the EDA container
  (verified on Linglong), and preparation checks its versions before any work.
- **Simulation.** The Site's ALPS testbench disagrees with the LVS schematic on node names and W/L.
  Settled: ALPS runs only with a testbench the manifest marks consistent; otherwise its values are
  unknown, not failed.

## Knowledge applied

- `assert-the-checker-options.md`: every judgement records and asserts the deck hash, the authority
  flag, the tile, the DRC precision option, the LVS tolerances, the extraction set's hashes and the
  tool versions as typed values. A mismatch is a blocker, not a result.
- `one-checker-per-session.md`: authority-deck DRC, reference-deck DRC, LVS and extraction are
  separate sessions with separate reports and separately named values, one per deck and tile. No
  count is summed across decks or tools.
- `end-honestly-in-more-than-one-way.md`: the four endings in Answers 3 each name the value that
  detects them. Converged is measured on the Goal ratio at the best legal outline, with the limiting
  bound stated. The round limit stays a budget.
- `over-constrain-and-read-the-violation.md`: the shrink is tried at the target pitch first, and
  infeasibility or residual markers are read as a measured shortfall. A relaxed pitch is a proposed,
  untested next trial, and requested and achieved outlines are kept distinct.
- `attribute-by-database-relation.md`: transistor identity comes from the channel geometry relation
  (gate over poly) and the LVS device match, and coupling attribution from the extraction tool's own
  net pairs. Device names and label text are never trusted on their own.
- `what-a-golden-flow-is.md`: the record points at the proving campaign and the customer case where
  they lie on the Site, and nothing of either is copied into this public repository.
