## Business

**What a generation varies.** Exactly one number: the clock period handed to Design Compiler,
`periodNs`, measured in ns, declared bounds 0.1..5, default 0.35, precision 3. A generation is one
bounded foundry-only synthesis of `aes_cipher_top` at one asked period, with a 600-second
subprocess deadline and eight cores, in a fresh `flow/probes/trial-<uuid>/` that never overwrites
an earlier trial. Nothing else changes between generations of this pack.

**What is measured.** One hashed Design Compiler measurement, read from the trial's `metrics.tsv`
through the generation's manifest `flow/probe.json`, and emitted as the value types the harness
already declares, with no renamed semantics:
- `clock_period`, ns: the period the synthesis was asked for (`asked_period_ns`). `synth.tcl`
  creates the clock at that period, so the asked period is the period synthesized.
- `setup_wns`, ns, mode `setup`, scope `all`: the worst constrained setup slack across every path
  group (`worst_slack_ns`). Negative when the period cannot be met; a real 0.00 when it can.
- `cell_area`, um2: the synthesized cell area (`cell_area_um2`).

Two Judge rules read those values, in this order: `setup-wns-all-nonnegative` (`setup_wns ≥ 0`),
then the goal rule `clock-period-at-most` (`clock_period ≤ target_period_ns`), whose target the Run
binds from its Goal. The first rule's outcome chooses the edge out; the second says whether the Run
is done.

**What ends it.** Every honest ending is named here, and the generation limit is only a budget:
- *Goal met* — a generation whose both current Judge verdicts are PASS: setup closed and the
  measured `clock_period` is at most the Goal's `target_period_ns` (ns, bounds 0.1..5,
  default 0.5). Only both actual current verdicts PASS allow the explicit goal-met decision.
- *Converged* — `next-period` declares convergence on its own `period` read, band 0.005 ns over 1
  successive generation. It is an honest negative or incomplete result: the measured periods
  stopped moving. It does not say setup closed, and it does not say the Goal was met.
- *Budget exhausted* — `generationLimit` 2 (a two-generation probe may honestly exhaust its budget)
  or the Run's own time box. An honest incomplete result, never performance success, and reported
  as what it is.
- *Hard blocker* — a node spends its Retry allowance and the Run waits at the one `blocked` wait
  node (`hard-blocker`) for a person.
- *No new result* — a synthesis that fails or omits a required artefact raises and publishes no new
  `flow/probe.json`; a manifest that is malformed, missing, nonfinite or hash-changed is refused by
  the reader. Both are honest negatives or blockers, never passes.

**What a person must never have to guess.**
- *Zero slack* — a met constraint reports a real 0.00: asked for, met, done. It states no margin,
  and it never means "no more was possible".
- *Actual versus estimated period* — the period a generation is judged on is the one the
  measurement states, never the number that was asked for; a period the chooser computes
  (`clock_period + |setup_wns| − stepNs`) is a hypothesis about the next experiment, not a
  measurement, and never appears among measured results.
- *Matching conditions* — two generations are comparable only when method, library, RTL and
  constraints match; the manifest carries sha256 for the two method scripts, the inputs binding,
  the foundry database, every RTL file and every evidence file, so a comparison can be shown fair,
  and retests under matching conditions assess stability.
- *Report hashes* — the reading is of hashed bytes: the reader checks format, toolExit, the
  measurement's sha256, the exact field set and finiteness before it emits any value.
- *Constraints* — setup closure is `setup_wns ≥ 0` over all path groups; the Goal is
  `clock_period ≤ target_period_ns`. They are two rules, applied in that order.
- *Finite timing/netlist samples* — `timing.rpt` names actual timing path points and `netlist.v`
  names actual instances, both hashed in the manifest; later analysis takes finite samples with
  line/object provenance and verifies generated candidates against an independent enumeration, and
  a failed extraction is a blocker rather than a fabricated count.
- *Scope* — this is foundry-only synthesis. No value of this pack is a post-route signoff or a
  measured silicon Fmax claim.
- *One file, two declared names* — `flow/probe.json` is both the judged `probe` output, read
  through the reader, and the unparsed `timingManifest` evidence pointer.

## Golden Flow

Read in place, never written, and no file of it authored into the Pack:

- The approved Golden Flow root, read with read/glob only: `./flow`
- `README.md` — the method, the exact command, the manifest, the recommended initial period and goal, and the scope caveat: `./flow/README.md`
- `probe.py` — one bounded foundry-only synthesis in a fresh trial directory, writing `flow/probe.json` and its own `manifest.json`: `./flow/probe.py`
- `synth.tcl` — the Design Compiler method (real and virtual clocks, 20% I/O delay, 19.7% clock-latency ratio, `compile_ultra`) and the `metrics.tsv` fields: `./flow/synth.tcl`
- `read-probe.py` — the hashed reader emitting `clock_period`, `setup_wns` (setup/all) and `cell_area`: `./flow/read-probe.py`
- The Site's separately staged `flowRoot` — that directory plus a private `inputs.json` with `design`, `rtlGlob`, `foundryDb`, `edaWrapper`; resolved from the Site binding `flowRoot`; its deployed location is not the Pack-local copy
- The Pack's own existing `flow/` copy (author-supplied method source, kept unchanged, not the Campaign's copy source): `./flow`

## Answers

1. What does a generation vary, and in what units? — `periodNs`, ns: the clock period handed to the
   synthesis. Bounds 0.1..5, default 0.35, precision 3.
2. What command runs one generation? — `/usr/bin/python3 ${WORKSPACE}/flow/probe.py --workspace
   ${WORKSPACE} --period ${PERIOD_NS}`, with inputs WORKSPACE and PERIOD_NS and one Design-Compiler
   licence.
3. What is the human-facing tool file? — a file under the Pack's `tools/` that documents and
   implements that same command, so a person can reproduce a generation by hand.
4. Which wrappers? — `/usr/bin/python3` for the tool and for the reader.
5. What is copied from `flowRoot`? — exactly `probe.py`, `synth.tcl`, `read-probe.py` and
   `inputs.json`, into `<workspace>/flow/`. `inputs.json` is Site-private and is never authored or
   added to the Pack.
6. Which outputs? — `probe` at `flow/probe.json`, read by the pack's reader; and `timingManifest`
   at `flow/probe.json`, unparsed, for evidence access. It names the immutable timing reports and
   netlist with their hashes for subsequent analysis.
7. Which reader, and with what argv? — an exact copy of the Golden Flow `read-probe.py` under the
   Pack's `tools/`, launched as `/usr/bin/python3 ${READER} ${REPORT} ${OUT}`.
8. What does the reader emit? — the existing `clock_period` (ns), `setup_wns` (ns, mode setup,
   scope all) and `cell_area` (um2). No renamed semantics, so the Pack declares no semantics of its
   own.
9. What is the Goal? — `target_period_ns`, ns, bounds 0.1..5, default 0.5, bound by the Judge into
   `clock-period-at-most`.
10. Which Judge rules, in which order? — `setup-wns-all-nonnegative` first, then
    `clock-period-at-most`.
11. What is the graph? — `synthesize` (tool) → `read-probe` (observes `probe`) → `judge` →
    `next-period` (explore) → `synthesize` (revisit); both Judge PASS and FAIL go to `next-period`;
    plus one `blocked` wait node declaring `hard-blocker`, with no edge drawn to it.
12. Which chooser, and what step? — the reference `opene902-timing-probe` pack's
    `over-constraining-push` chooser, copied/referenced, with `stepNs` 0.01 ns.
13. How is convergence declared? — read `period`, band 0.005, generations 1, generationLimit 2.
14. When may the Run say the Goal is met? — only when both actual current Judge verdicts are PASS.
    Convergence and a spent budget are honest negatives or incomplete results, never performance
    success.
15. Is there a Workshop in this version? — No. This initial probe version declares none; PLS09 adds
    the AI-written analysis later.
16. What domain knowledge does the Pack carry? — one file explaining zero slack, actual versus
    estimated period, matching conditions, report hashes, the constraints, and finite timing/netlist
    samples.
17. Where is the Golden Flow and what was read there? — the approved path above; `README.md`,
    `probe.py`, `synth.tcl` and `read-probe.py` were read in place with read/glob and kept unchanged.
    Nothing from it is authored into the Pack, and the Pack's pre-existing `flow/` copy is left
    untouched.
18. May this pack claim Fmax? — No. Its own scope string is foundry-only synthesis, not post-route
    signoff or measured silicon Fmax.
19. What does the Site bind? — `linglong-aes` binds `flowRoot` (a separately staged root),
    `design` as `aes_cipher_top`, and `workspaceRoot`. No customer path or credential belongs in the
    Pack.
20. Where did the shape of the declarations come from? — the installed
    `knowledge/pack-anatomy.md` and the installed reference pack
    `opene902-timing-probe`. A number knob
    really does carry an optional `precision` field, so `precision: 3` is declared, not invented.

## Ambiguities resolved

- **The same workspace file is declared as two outputs.** The author's words put `probe` and
  `timingManifest` both at `flow/probe.json`, while the reference `opene902-timing-probe` pack keeps
  its judged output and its unparsed log at different paths (`qorReport` and `dc_shell.log`). Held
  against the loader, this is legal — the harness holds output *names* unique, not paths — so the
  two names stay as the author asked: `probe` is the reader-backed judged output, `timingManifest`
  the unparsed pointer to the same current manifest.
- **A copy of the Golden Flow sits inside the pack folder.** `knowledge/what-a-golden-flow-is.md`
  says not one file of the Golden Flow is copied into a pack folder, and the method record carries
  pointers only; the Pack folder already holds `flow/README.md`, `flow/probe.py`,
  `flow/synth.tcl` and `flow/read-probe.py`. The author supplied those as method source and
  instructed that they be kept unchanged, so they are recorded and left exactly as they are; they
  are not the Campaign's copy source, which is the Site's `flowRoot`, and the SPEC will not extend
  or edit them.
- **`design` is bound by the Site but referenced by no path.** In `opene902-timing-probe` the
  output path carries `${design}`; here `flow/probe.json` is fixed, and no tool argument names
  `${DESIGN}`. It is declared anyway because the Site binds it and `probe.py` enforces the same
  value from the private `inputs.json` — the Pack states the binding, the flow checks it.
- **`read-probe.py` exists in two places at once.** The author asks for an exact copy under
  `tools/` for the reader declaration, while the `flowRoot` copy also brings it into
  `<workspace>/flow/`. Both are byte-identical copies of the Golden Flow script and neither is
  edited: the `flow/` copy is the method source the trial tree runs beside, and `tools/read-probe.py`
  is what `${READER}` resolves to when the harness launches the reader.
- **A zero slack could be read two ways.** The Golden Flow README says a zero slack is a real zero
  and forbids a guard that systematically relaxes a passing trial, while `over-constraining-push`'s
  constraint-PASS clause tightens by `stepNs`. They agree: that clause reads no margin at all, so a
  zero — or any — slack cannot make it loosen.
- **A 0.005 ns convergence band against a 0.01 ns step.** A band half the step looks like a move
  the next report could never show. It is the intended reading: "moved less than 0.005" is satisfied
  when two successive generations asked and measured the same period, which is exactly what
  `clock_period + |setup_wns| − stepNs` produces once the shortfall is stable.
- **`inputs.json` is copied and is also forbidden.** The author says copy it from `flowRoot` and
  never author it into the Pack. Both hold: `workspace.copy` names it as a file taken from the
  Site's own `flowRoot`, and the Pack authors no such file.

## Knowledge applied

- `what-a-golden-flow-is.md` — the Golden Flow is recorded as pointers to the path that was read,
  and no file of it is authored into the Pack; it is also what made the pack folder's pre-existing
  `flow/` copy an ambiguity to state rather than to extend or delete.
- `over-constrain-and-read-the-violation.md` — made the violation the value the method runs on: the
  first generation is expected to fail, a met constraint states no margin, and the chooser's
  constraint-FAIL clause reads `clock_period + |setup_wns| − stepNs` while its PASS clause never
  reads the margin.
- `end-honestly-in-more-than-one-way.md` — named the endings in the pack's own words, with
  convergence declared over the chooser's own `period` read and its band, and kept the generation
  limit a Budget that ends as an honest incomplete result rather than as success.
- `assert-the-checker-options.md` — the reading is asserted before any value counts: the reader
  holds format, `toolExit`, the measurement's sha256, the exact field set and finiteness, and
  refuses rather than defaulting a number nobody read.
- `one-checker-per-session.md` — one synthesis per `synthesize` node and one reader per output, so
  every measured value belongs to one tool run; the two Judge rules read that one observation
  instead of folding counts across sessions.
- `attribute-by-database-relation.md` — the Pack's knowledge tells later analysis to take actual
  path points from `timing.rpt` and actual instances from `netlist.v` with provenance and an
  independent enumeration, and to report a failed extraction as a blocker rather than substitute a
  name-matched count.
