# MAGE capabilities

## Source

- `flow/mage_placement/native/session.py` (`MUTATING_MARKERS`, `MageSession.run_round`,
  `mutating()`), `flow/templates/*.tcl` (the four templates this Pack ships and actually runs).
- Spec §7 ("The Engineer's mechanism"), §12.3, §12.5.

## Applies when

Planning or running a MAGE round in `engineer-place` (`mage-round --role engineer`), and judging
whether a Tcl command you are tempted to write by hand is safe to rely on.

## V/D status: only two levels exist in this Pack

- **V (verified)** — ran against real bytes on the Oct-12 build and reproduced a known result
  (replaying `pre_place_all.pla`: 225 Fit / 10 Fixed exact).
- **D (documented)** — named in the vendor manual, used nowhere in this Pack's own templates, and
  never run against a real design in this session. A D command is not wrong, but it is unqualified:
  before relying on it for a real decision, qualify it yourself with one passing example and one
  failing example on the current case, and say in your candidate's `remaining`/`unknown` that you
  did this.

There is no "A" (assumption) status for MAGE commands in this Pack — a command is either in the
templates below (V) or it is not (D).

## The four templates (V — this is the whole verified path)

| Template | Commands (verbatim) | Role |
|---|---|---|
| `open-build.tcl` | `frbOpen {@FRB@}`; `frbSetCur frame`; `frbSetup -obj BuildFrame`; `smPFlow -setAutoRefine -arEnabled 0`; `smPFlow -bindBlocks`; `smPFlow -buildFrame frame -mchip mainchip -mblock mainchip` | open the case and build the Frame with Auto Refine disabled |
| `replay-pla.tcl` | `source {@PLA@}` | replay a **complete** candidate PLA — this is the one way this Pack ever changes placement |
| `verify-all.tcl` | `smVerify -checkType <TYPE> -doCheck -save {@OUT@/verify-<TYPE>.txt}` for each of OVERLAP, SPACE, BOUNDARY, CROSS, OFFGRID, DIECORNER, PEPPER, PADS, LOCATION, AUTOREFINE, each wrapped in `catch` | run every native check and save its own report |
| `export.tcl` | `smPInstMgr -saveMark {@OUT@/export.pla}`; `catch {smPInstMgr -savePlaDBU {@OUT@/export-dbu.pla}}`; `smPFlow -saveSummary {@OUT@/summary.txt}` | export the placed PLA and a text summary |

`mage-round --round <n> --pla <file> --role engineer --out-dir <dir>` runs exactly these four
templates in this order through `mage-frb <script> -noterm`, under the Site's `siteCapabilities`
executable and environment, and returns the export/verify/log paths `candidate` then reads. This
is the **only** subcommand that touches the real MAGE binary; every other resident subcommand
(`snapshot`, `plan-slots`, `evaluate`, `candidate`, `review`) is pure Python over files MAGE already
produced.

`source {@PLA@}` is itself one of `MUTATING_MARKERS` — replaying a PLA changes placement state even
though it is the verified path. `MageSession.run_round` refuses with `MageError('writer', ...)`
before writing or running anything when `role != "engineer"` and the assembled script is mutating —
so no consumer role can ever become a second writer, and you (the Engineer) are the only role this
Pack ever lets run a mutating script.

## D commands (documented, not qualified in this Pack)

These are the markers `mutating()` also recognizes, confirming MAGE treats them as placement edits,
but none of them appears in this Pack's own templates and none has been run against a real design
in this session: `-addInstFit`, `-addInstFix`, `-addGroup`, `frbMove`, `frbOps`, `frbAlign`,
`frbGuidedMove`, `-placeDropInstFit`, `-refine`, `-autoRefine`, `-setAutoRefine -arEnabled 1`.

If replaying a complete PLA cannot express the move you need (for example, you want MAGE to run its
own incremental refine step rather than a full replay), you may write Tcl using one of these
commands — but only after qualifying it: run it once in a script you expect to pass and once in a
script you expect to fail, confirm both outcomes against the native verify files, and record both
examples (script path, sha256, the verify-file evidence) in your candidate's `unknown` list before
using it for a real round. Never assume a D command's effect from the manual alone.

## Pitfalls

- **Compute before you print.** `smPInstMgr -saveMark` exports the placed geometry as MAGE itself
  currently holds it; if you forgot to `source` your candidate PLA first, the export reflects
  whatever state was already open, not your candidate.
- **No instance filter in this Pack's templates.** `verify-all.tcl` always checks every instance in
  the Frame — there is no narrowed, single-mark verify path here. A clean run on nine keys does not
  tell you the rest of the Frame is clean; read the whole `verify-<TYPE>.txt` file.
- **Stale results.** `MageSession.run_round` refuses with `MageError('round-exists', ...)` if
  `round_dir/round.tcl` already exists — each `--round N --out-dir <dir>` call needs a fresh
  directory. Never reuse a previous round's `out/` files as if they were this round's; always read
  the files the current `mage-round` call just wrote.
- **Units.** Templates and native output are MAGE's own units (µm in saved PLAs, DBU inside this
  Pack's snapshot). `core.um_to_dbu`/`dbu_to_um` are exact `Decimal` conversions — never estimate a
  DBU value by hand; let the Pack's own code convert it, and never report `dbuPerUm` from anywhere
  but the case manifest (P23: 10000).
- **`-savePlaDBU` is wrapped in `catch`.** It may not exist on every build; `export.tcl` tolerates
  its absence. Do not treat a missing `export-dbu.pla` as a round failure by itself — check
  `export.pla` and the verify files first.
