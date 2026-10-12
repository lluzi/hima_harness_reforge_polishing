# MAGE capabilities

## Source

- `flow/mage_placement/native/session.py` (`MUTATING_MARKERS`, `MageSession.run_round`,
  `mutating()`, `slice_verify`, `write_verify_files`), `flow/templates/*.tcl` (the five templates
  this Pack ships and actually runs).
- The Site's proven native route, confirmed on the Oct-12 build by the resident kit evidence
  (the recorded replay/compaction run described below), and Spec §7 ("The Engineer's mechanism"),
  §12.3, §12.5.

## Applies when

Planning or running a MAGE round in `engineer-place` (`mage-round --role engineer`), and judging
whether a Tcl command you are tempted to write by hand is safe to rely on.

## V/D status: only two levels exist in this Pack

- **V (verified)** — part of the five templates below, which reproduce the Site's own proven
  native route on the Oct-12 build.
- **D (documented)** — named in the vendor manual, used nowhere in this Pack's own templates, and
  never run against a real design in this session. A D command is not wrong, but it is unqualified:
  before relying on it, qualify it yourself with one passing and one failing `--experiment` on the
  current case (see "Experiments"), and say in your candidate's `remaining`/`unknown` that you did.

There is no "A" (assumption) status for MAGE commands in this Pack — a command is either in the
templates below (V) or it is not (D).

## The five templates (V — this is the whole verified path)

| Template | Commands (verbatim) | Role |
|---|---|---|
| `open-build.tcl` | `frbOpen {@FRB@}`; `frbSetCur frame`; `smPFlow -updateUsedFiles`; `frbSetup -obj BuildFrame`; `smPFlow -clear`; `smPFlow -bindBlocks`; `smPFlow -buildFrame frame -mchip mainchip -mblock mainchip`; `smPFlow -sortFix`; `smPFlow -sortFit` | open the case and build the Frame exactly as the proven kit route does — no `-setAutoRefine -arEnabled 0` |
| `replay-pla.tcl` | `source {@PLA@}` | replay a **complete** candidate PLA — this is the one way this Pack ever changes placement |
| `fill-autorefine.tcl` | the converge lines (from the manifest), then `g_params -set {smPFlow::s_ARTestConvergePrplaced false}`, then `smPFlow -autoRefine` | the Pack's own fill stage (only when `--fill` is given) |
| `verify-all.tcl` | a `foreach` over `OVERLAP frbCheckOverlap SPACE frbCheckSpace BOUNDARY frbCheckBoundary`, each run plain and with `-print`, bracketed by `MAGE_VERIFY_BEGIN`/`MAGE_VERIFY_CODE`/`MAGE_VERIFY_END` markers | run the three native checks and print their results to stdout |
| `export.tcl` | `smPInstMgr -saveMark {@OUT@/export.pla}`; `smPFlow -saveSummary {@OUT@/summary.txt}`; `puts [list MAGE_ROUND_END code 0]` | export the placed PLA (the saved PLA is a DBU file with a braced `-savePlaDBU {10000}` header and µm Group target points) and a text summary, then print the completion marker |

`mage-round --round <n> --pla <file> --role engineer --out-dir <dir> [--fill] [--experiment <file>]`
runs these templates in order (open-build → replay-pla → experiment, if any → fill, if `--fill` →
verify-all → export) through `mage-frb <script> -noterm`, under the Site's `siteCapabilities`
executable and environment, and returns the export/verify/log paths `candidate` then reads. This is
the **only** subcommand that touches the real MAGE binary; every other resident subcommand
(`snapshot`, `plan-slots`, `evaluate`, `candidate`, `review`) is pure Python over files MAGE already
produced.

`source {@PLA@}` is itself one of `MUTATING_MARKERS` — replaying a PLA changes placement state even
though it is the verified path. `MageSession.run_round` refuses with `MageError('writer', ...)`
before writing or running anything when `role != "engineer"` and the assembled script is mutating —
so no consumer role can ever become a second writer, and you (the Engineer) are the only role this
Pack ever lets run a mutating script.

## The three native checks (V) and what their counts mean

The round runs exactly three native checks and the driver writes one `out/verify-<TYPE>.txt` per
check from the stdout markers, each with the canonical header
`# mage-verify/1 type=<T> command=<cmd> instances=<N>`:

- **OVERLAP** (`frbCheckOverlap`) — overlapping instances.
- **SPACE** (`frbCheckSpace`) — spacing violations. Each row is one offending **instance**, not a
  pair count: two instances too close yield instance rows, not one "pair". Read the count as
  instances.
- **BOUNDARY** (`frbCheckBoundary`) — instances outside the frame boundary.

`instances=0` for a type means "MAGE ran the check and found zero"; a check whose catch failed, or
whose count could not be read, produces **no** file and stays `unknown` downstream — never a bare
`0`. `metrics.native_rows` reads only that header line; `mage_native_violation_total` is the sum of
the three, unknown whenever any one is unknown.

## D commands (documented, not qualified in this Pack)

These are the markers `mutating()` also recognizes, confirming MAGE treats them as placement edits,
but none appears in this Pack's own templates run by itself: `-addInstFit`, `-addInstFix`,
`-addGroup`, `frbMove`, `frbOps`, `frbAlign`, `frbGuidedMove`, `-placeDropInstFit`, `-refine`,
`-autoRefine`, `-setAutoRefine -arEnabled 1`. The old ten-way `smVerify -checkType <TYPE> -doCheck`
family is also D: it is not the proven route and this Pack does not run it; the three native checks
above are the verified path, and `smVerify` is unqualified here.

## Experiments

When replaying a complete PLA cannot express what you need (for example, you want MAGE to run its
own refine from a particular state rather than a full replay), write the Tcl into a file and pass it
as `--experiment <file>`. The driver copies its bytes verbatim to `placement/round-NN/experiment.tcl`,
sources it after the replay and before any fill, and records its sha256 in the session log, the
round summary and your candidate's `files.scripts[]` and `reproduction.experimentSha256`. An
experiment containing the word `exit` or `frbOpen` is refused (`MageError('experiment', ...)`) before
anything is written — an experiment must never re-open a case or quit the interpreter. Only the
Engineer may run one (it is mutating). **Qualify a D command with one passing and one failing
experiment before relying on it:** run the command in an experiment you expect to pass and one you
expect to fail, confirm both outcomes against the three native verify files, and record both
(script path, sha256, the verify evidence) in your candidate's `unknown` before trusting it.

## Native compaction, as the customer's successful method does it

The proven method's own compaction, verbatim, for reference when you author an experiment:

- **Group compaction:** `g_params -set {smPFlow::s_ARTestConvergePrplaced true}`, then the converge
  settings (`smPFlow -setAutoRefineSimpleConverge -arSLType VERT -arConvergeNum <v>` and the HORZ
  line), then `frbGroupSetting -setObject -objectType {GROUP} -objectV {1}` and
  `frbGroupSetting -setObject -objectType {GROUP} -objectX {1}`, then `smPFlow -autoRefine`.
- **The fill:** restore the offsets, set `g_params -set {smPFlow::s_ARTestConvergePrplaced false}`,
  and run a second `smPFlow -autoRefine`. (This is exactly what `--fill` does: the converge lines,
  the `false` setting, and `smPFlow -autoRefine`.)
- **Relaxing offset ranges:** the method's documented knob is relaxing a rule's zero
  `-arOffsetRangeX`/`-arOffsetRangeY` settings to `-1.000000` (meaning unbounded), not leaving them
  at `0`.

Recorded pitfalls from the kit evidence:

- **Settings edits can clear Fits while Group metadata remains.** After any reset or settings edit,
  always read back both the Fits and their Group association — the Fits can be gone while the Group
  records still look intact.
- **A naive PLA replay can restore Fits without Group association.** Replaying a PLA may put the Fit
  boxes back but leave them unbound to their Groups; check the binding, do not assume replay restored it.
- **The compaction failed on `SCRIBE_LEFT`/`SCRIBE_V_2` on this build.** That is a failed native
  *strategy* on those marks for this build, not proof the placement is infeasible — say so, and do
  not report a failed strategy as native infeasibility.
- **DBU vs µm.** The native files are MAGE's own units (µm in saved PLAs); the snapshot is DBU. Never
  mix them, and never hand-convert — let `core.um_to_dbu`/`dbu_to_um` do it.

## Pitfalls

- **The vendor launcher exits 0.** `bin/mage-frb` runs the real binary and then unconditionally
  `exit 0`, so the process return code is 0 even when MAGE failed (a licence-checkout failure, a
  mid-script error). Trust the `MAGE_ROUND_END code 0` marker and the exported files, never the
  return code: `run_round` sets `completed` only when the code is 0, the round did not time out, and
  that marker is present, and `candidate` reports `blocked` otherwise.
- **Compute before you print.** `smPInstMgr -saveMark` exports the placed geometry as MAGE currently
  holds it; if you forgot to `source` your candidate PLA first, the export reflects whatever state
  was already open, not your candidate.
- **No instance filter in this Pack's templates.** `verify-all.tcl` always checks every instance in
  the Frame — there is no narrowed, single-mark verify path here. Read the whole `verify-<TYPE>.txt`.
- **Stale results.** `MageSession.run_round` refuses with `MageError('round-exists', ...)` if
  `round_dir/round.tcl` already exists — each `--round N --out-dir <dir>` call needs a fresh
  directory. Always read the files the current `mage-round` call just wrote.
- **`-savePlaDBU` is not an export command.** Confirmed against a real native export on the Oct-12
  build: on this build `-savePlaDBU` is the DBU header line a saved PLA itself carries, not a
  second command that exports to its own path. `export.tcl` therefore runs `-saveMark` only;
  `export.pla` is itself the native DBU file whenever MAGE's own `-saveMark` behaviour on this
  build writes DBU (a braced `smPInstMgr -savePlaDBU {10000}` header, integer-DBU boxes, and
  `pinstGroupProperty` Group target points still in micrometres — `pla.read_pla` detects this
  automatically). There is no separate `export-dbu.pla` and no `exportDbuPla` result key.
