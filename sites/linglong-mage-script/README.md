# linglong-mage-script Site

Site for the `mage-script-placement` Pack: the resident engineering agent authors and runs Tcl
stage scripts against the real Empyrean MAGE script-method placement task on linglong, round by
round, inside one Fabric repeat. It is the sibling of `linglong-mage` (the `mage-scribe-placement`
Pack's Site): same host, same permit, same workspace root, the same one `mage` licence seat; only
the manifest binding differs, and this Site has no `consumerContext` binding.

## Layout on linglong

| Path | Use |
| --- | --- |
| `/data/eda/project/hima_harness/mage-runs` | Campaign workspaces (`workspaceRoot`) |
| `/data/eda/project/hima_harness/mage-inputs/scribe-case-v1/` | the staged frame case, shared with `linglong-mage`: a frozen customer bundle copy with the pblock GDS path adapted to `${MAGE_PBLOCK_HOME}/output.gds` and `case-adaptation.json` recording the original and adapted sha256; `incumbent/placement.pla` is the kit's native baseline. `manifest-script.json` and `site-capabilities.json` are machine-local and bound below. The case's own `case/` contents, and any measurement figures taken from it, are not named here or anywhere in this repository. |
| `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-mage-v1.json` | the installed capability (`bindings.engineeringCapabilities`), shared with `linglong-mage` |

`manifest-script.json` is a Site-local stamped manifest, separate from `linglong-mage`'s
`manifest.json`, carrying the same case-manifest fields plus the script-method's reference-method
block:

- `referenceMethod` -- the case's reference entry script (the vendor's own `smPFlow -autoRefine`
  invocation and converge settings), read as evidence for the first fixed round, never executed by
  this Pack.
- `referenceFiles` -- the reference directory's files, each with the sha256 the Pack re-verifies.
- `referenceNotes` -- Site-local notes on the reference run (what was observed, not what to repeat).
- `referenceOrdinaryDropLengthUm` -- the retained reference figure the Pack's comparison objective
  scores a candidate's own `mage_dropped_ordinary_length_um` against. Its sha is recorded here
  after Task 12 stamps the manifest:

  `manifest-script.json` sha256 `a609aa5adb1386edb2c4a6d09d44ee4863582b9fe35356c869c963067bafd3e5` (id `1c44e5625d4c24cfe0a7`), stamped 2026-10-12 with 54 reference files, 24 reference notes, and the reference ordinary drop length 52,453 µm.

## Known constraints

Copied from `linglong-mage/README.md`; unchanged for this sibling Site.

- **Licence server.** The MAGE licence (`EMPYREAN_LICENSE_FILE_OVERRIDE` / `EMPYREAN_LICENSE_FILE`
  `59003@localhost`) is served by the permanent `empyrean-mage-lmgrd.service` systemd unit (Empyrean
  Mage 2026 FlexNet), which covers every MAGE feature used here (MAGE_GUI, MAGE_SHELL,
  MAGE_AUTO_REFINE, MAGE_DRC, …; 5 seats each; features expire 31-oct-2026). Verify with
  `<MAGE_HOME>/exe/lmutil lmstat -a -c 59003@localhost`.
- **Parallel jobs.** `parallelJobs: 2`; a Site declaring only 1 slot stalls resident release (the
  release of one round's seat needs a second slot free to proceed), so this Site always declares 2
  even though the Pack holds the `mage` licence (seat count 1) only during `engineer-script`.
- **Round-end detection.** `mage-stage` is this Pack's own stage driver (not vendor tooling); it
  wraps the agent's Tcl in the Pack's prelude/epilogue and runs MAGE. The vendor launcher exits 0
  unconditionally, so the Pack judges each stage's outcome by the `MAGE_ROUND_END code 0` marker its
  own epilogue prints to stdout, never by the process exit code.
- **Python version.** Inside the resident container, after the EDA init script runs, `python3` is
  3.8.16; the Pack's Python stays 3.8-compatible for this Site.

## What is not installed

Nothing new on linglong except the `manifest-script.json` manifest file and the reference-method
notes directory it points at. The capability file, wrapper, OpenCode binary, podman image and
licence server are all already installed for `linglong-mage` and the other resident capabilities on
this host; this Site reuses them unchanged.
