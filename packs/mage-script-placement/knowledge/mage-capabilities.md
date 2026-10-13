# MAGE capabilities

## Source

`flow/mage_placement/native/prelude.tcl`, `flow/mage_placement/native/epilogue.tcl`, and
`flow/mage_placement/native/session.py` (`FORBIDDEN_PATTERNS`, `MageSession.run_stage`); spec §7.

## The prelude procs and variables

Every stage starts with these already defined — you never write them yourself, and re-defining or
renaming any `hima_*` proc is refused before anything runs:

- `$hima_case_frb` — the manifest's FRB path.
- `$hima_case_dir` — the manifest's case directory (read-only; never written).
- `$hima_start_pla` — the frozen start-state PLA path. `source $hima_start_pla` is how round 1, and
  any later round that wants to start clean, replays it.
- `$hima_out` — this stage's own output directory, where every `hima_snapshot` writes.
- `hima_open_build ?buildFlags?` — opens the case and builds the Frame
  (`frbOpen`, `frbSetCur frame`, `smPFlow -updateUsedFiles`, `frbSetup -obj BuildFrame`,
  `smPFlow -clear`, `smPFlow -bindBlocks`, `smPFlow -buildFrame frame -mchip mainchip -mblock
  mainchip`, then `smPFlow -sortFix`/`smPFlow -sortFit`); any extra arguments you pass are appended
  to the `-buildFrame` call verbatim. It is the *only* way a stage opens the case — a bare `frbOpen`
  in your own text is refused before anything is written, so a stage can never open a second file.
  Calling `hima_open_build` more than once in one stage is **D (documented, not verified on this
  build)**: nothing in the refusal gate limits how many times you call it, but that a second build in
  the same process behaves like the first has not been confirmed here — qualify it with a passing and
  a failing stage before relying on it for a delivered candidate.
- `hima_snapshot <name>` — writes a boundary: `smPInstMgr -saveMark` and `smPFlow -saveSummary`
  into a numbered `snap-NN-<name>/` directory under `$hima_out`, then prints the `MAGE_SNAPSHOT`
  marker. `<name>` must match `[A-Za-z0-9][A-Za-z0-9_-]{0,40}`; anything else is a Tcl error inside
  your stage, not a refusal.
- `hima_check` — runs the three native checks (`frbCheckOverlap`, `frbCheckSpace`,
  `frbCheckBoundary`), plain and with `-print`, tagged to the current snapshot index. Call it after
  every move set so the resulting native rows are bound to the boundary that produced them.

## The epilogue

Runs once, automatically, after your text: the same three checks untagged (the final verify-all
`stage-report`/the Reader read), then the export (`smPInstMgr -saveMark {@OUT@/export.pla}`,
`smPFlow -saveSummary {@OUT@/summary.txt}`), then the `MAGE_ROUND_END code 0` completion marker. You
never write any of this yourself, and forging the marker text anywhere in your own script is refused.

## The refusal gate

A stage script is refused before anything is written or run — leaving no trace — when it contains
any of: `exit` (as a whole word), `frbOpen` (as a whole word), `MAGE_VERIFY`, `MAGE_ROUND_END`,
`MAGE_SNAPSHOT`, `MAGE_STAGE_ERROR`, `MAGE_CHECK`, the literal fence text
`hima:prelude-begin`/`hima:prelude-end`/`hima:agent-begin`/`hima:agent-end`, the word `rename`, the
phrase `interp alias`, or a `proc` that (re)defines a name — optionally brace- or quote-wrapped and
optionally `::`-qualified — beginning `hima_`, `frbCheck`, `smPInstMgr`, `smPFlow`, `puts`, `flush`
or `catch`. A stage is also refused when its `{` and `}` do not balance — every line counts, including
full-line `#` comments (the agent text sits inside a braced `catch { ... }` body, where Tcl counts
braces in comments too), ignoring only backslash-escaped `\{`/`\}`, and the gate refuses as soon as the
running depth drops below zero, not only when the final count is non-zero — because an unbalanced
brace would corrupt the driver's own `catch { ... }` wrapper. The word `rename` is refused anywhere in
the agent text, comments included, so comments must not use that word either. Only role `engineer` may
ever run a stage — any other role is refused before a single byte is written, because every stage is
mutating by construction.

## Stage result files

Every `mage-stage` call writes `stage-summary.json` (round, stage, role, the agent script's sha256,
the assembled stage's sha256, `completed`, `returncode`, `timedOut`, `lastBoundary`, `stageError`,
every snapshot's path and sha, the export path and sha, `stdoutSha256`, the verify files, start/end
timestamps). `stage-report --stage-dir <dir> --out <file>` turns every one of a stage's boundary
snapshots, plus the final export when the stage completed, into one row each: Fixed count, Group
count, in-group (priority) Fits, ordinary Fits, ordinary/grouped drops, an inventory check
(`pass`/`fail`), target distance (max, over-limit count, identity label), order deviation per side,
priority movement from the frozen start, and the native row counts tagged to the last snapshot
index — a `hima_check` run after a given `hima_snapshot` reports for that boundary, and any
`hima_check` run before the first snapshot is tagged index 0 and is not reported in any row. A stage
that failed mid-script still writes every snapshot taken before the failure,
plus `MAGE_STAGE_ERROR boundary <last> message <msg>` on stderr naming the last boundary reached.

## Command surface

**V — verified, run by the prelude/epilogue or confirmed on the reference case:**

| Command | Status |
|---|---|
| everything in the prelude/epilogue above | V |
| `source <pla>` | V — the only way a stage replaces the whole placement state |
| `smPFlow -placeGroup -groupItem <G> -groupTargetPoint (<x>,<y>) -groupPlaceType CT` | V (the reference method's priority placement) |
| `smPFlow -placeFix -toFix <n>` with `frbSetup -obj PlaceStep -inst <name>` | V |
| `smSLFit <item> -setAutoRefine -arOffsetRangeX/Y <value>` | V — invalidates every placed Fit on this build when run after point placement (§6 of the playbook); Group records stay intact |
| `g_params -set {smPFlow::s_ARTestConvergePrplaced true\|false}` | V |
| `smPFlow -setAutoRefineSimpleConverge -arSLType VERT\|HORZ -arConvergeNum <n>` | V |
| `frbGroupSetting -setObject -objectType {GROUP} -objectV {1}` / `-objectX {1}` | V |
| `smPFlow -autoRefine` | V — compaction (converge mode) or fill (non-converge), depending on `s_ARTestConvergePrplaced` |
| `smPInstMgr -saveMark <path>` | V — DBU-shape export; Group target points stay in micrometres even though the box coordinates are integer DBU |

**D — documented in the vendor manual only, never run by this Pack's own prelude/epilogue; qualify
with one passing and one failing stage before relying on either for a delivered candidate:**

`frbSelect`/`frbMove`, `frbGuidedMove -targetPos`, `frbOps Aln*`, `frbAlign`,
`smPInstMgr -placeDropInstFit`, `smPFlow -refine -refineRegion -refineLocation`,
`smPFlow -placeFitList`, `frbUndo`.

## Pitfalls

- **The vendor launcher exits 0.** The Site's launcher runs the real binary and then
  unconditionally exits 0, so a licence-checkout failure or a mid-script error can still return 0.
  Trust the `MAGE_ROUND_END code 0` marker in the captured stdout, never the process return code —
  `mage-stage` sets `completed` only when the return code is 0, the stage did not time out, and that
  marker is present.
- **Compute before you print.** `smPInstMgr -saveMark` exports whatever MAGE currently holds; if a
  needed `source`/placement call did not run before the export, the export reflects stale state, not
  your intended candidate.
- **The sort warning is harmless outside converge mode.** `Sort sl <lane> preplaced fits failed` on
  its own, in a non-converge fill, is not a failure signature — it is fatal only alongside
  `Failed at auto refinement` while `s_ARTestConvergePrplaced` is `true`.
- **`-savePlaDBU` is a header, not a command.** A saved PLA's own braced `-savePlaDBU {10000}` line
  is the file's own DBU-unit header, not a second export call with a path of its own; there is no
  separate DBU export command.
- **A second `hima_open_build` in one stage is unverified (D).** The reference method rebuilds
  between sub-steps and nothing in the refusal gate limits how many times you call `hima_open_build`
  (only that you never call bare `frbOpen` yourself), but a second build in the same process has not
  been confirmed on this build — treat it as a D-status step and qualify it before you rely on it.
- **One MAGE process, one licence seat, per stage.** Each `mage-stage` call is one MAGE process and
  checks out the one `mage` licence seat this Pack ever holds; a stage that hangs or exceeds
  `--timeout-s` is killed and reported `timedOut`, not retried silently.
