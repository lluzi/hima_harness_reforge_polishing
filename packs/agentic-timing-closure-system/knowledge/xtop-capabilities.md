# XTop 能力地图

## Source

- XTop man pages, install snapshot `2025.09.tmp15` on `192.168.50.41` (read-only,
  man page footer dated `12/15/2025`), root
  `/data/eda/software/eda_tools/empyrean/xtop-2025.09.tmp15/share/doc/man/man1/`:
  `get_paths.1`, `get_attribute.1`, `size_cell.1`, `insert_buffer.1`, `remove_buffer.1`,
  `write_design_changes.1`, `save_workspace.1`, `open_workspace.1`, `undo.1`,
  `report_eco_actions.1`.
- `/data/eda/software/eda_tools/empyrean/xtop-2025.09.tmp15/utilities/post_verification/refine_xtop_eco_commands.tcl`
  (295 lines, read on `192.168.50.41`): `refine_xtop_eco_commands`/`revert_xtop_eco_commands`
  procedures for PT-format sizing ECO scripts.
- `/data/eda/project/design_zoo/docs/xtop_advanced_timing_closure/evidence/command_surface.tsv`
  (389 rows, read on `192.168.50.41`): cross-checked `documentation_status` = `man+completion`
  or `man-only` for every command name below; `PACK_SHA256SUMS.txt` in the same directory
  verified at read time.
- `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md`
  (2026-09-26 snapshot) §7.1 "XTop Adapter": the six adapter operations
  (`open_state`/`query_context`/`run_scoped_experiment`/`capture_changes`/
  `replay_contribution`/`checkpoint_and_export`) these commands are meant to back.

## Applies when

- T7/T12 compile a Workshop's candidate action into a real XTop command sequence
  (`flow/atcs/adapters.py`, `flow/templates/*.tcl`).
- Any Reader or Judge decides whether a claimed operation trace (`ops.jsonl`) is
  plausible given what XTop actually exposes.
- A candidate action names a capability not in this table: it must be reported as an
  unqualified/out-of-scope action (`outOfScope[]` on the `contribution` artifact), not
  attempted with an improvised command.

## Changes this decision

Every row below is **documented** — confirmed to exist with these exact flags in the
man page and cross-checked against `command_surface.tsv` — not **qualified**: no XTop
session has been opened and no command has actually been run against a real design in
this task. A Workshop may compile a plan that uses these commands; a Reader/Judge must
still treat their real-world effect as unverified until a `contribution`'s
`validationLevel` records an actual XTop run.

| Need | Command (documented) | Flags relevant to this Pack |
|---|---|---|
| Path query | `get_paths` | `-start_points`, `-end_points`, `-through_points`, `-scenario`, `-group`, `-delay_type {all\|min\|max}`, `-path_type`, `-lower_bound`, `-upper_bound`, `-filter` |
| Per-instance attribute query | `get_attribute` | `object_spec attr_name [-class {design\|pin\|cell\|port\|net\|lib_cell\|lib_pin\|lib\|timing_path}] [-scenario sce]` |
| Sizing | `size_cell` | `cell_list lib_cell [-design design_name] [-location coord]` |
| Buffer insertion | `insert_buffer` | `pin_list lib_cells [-design design_name] [-inverter_pair] [-new_cell_names names] [-new_net_names names] [-locations coord] [-force]` |
| Buffer deletion | `remove_buffer` | `cell_list [-design design_name]` |
| Change export | `write_design_changes` | `-format {NATIVE\|INNOVUS\|CUI\|SOC\|ICC\|ICC2\|PT\|ATOP\|V_DEF}`, `-eco_file_prefix`, `-output_dir`, `-last_n count`, `-reorder`, `-exclude_new_created`, `-keep_route`, `-write_atomic_cmd \| -force \| -strong_force`, `-exclude_phy_info`, `-version val` |
| Workspace save | `save_workspace` | `[-as path [-overwrite]]` |
| Workspace restore | `open_workspace` | `workspace_path` |
| ECO action audit | `report_eco_actions` | `-last_n count`, `-types {move_cell\|size_cell\|exchange_cells\|insert_buffer\|remove_buffer\|insert_dummy_cell\|reconnect_pin\|insert_buffer_chain\|split_load\|split_net}`, `-top_n count`, `-sort_by {count\|area}` |
| Manual-ECO undo | `undo` | no flags; undoes the latest manual ECO checkpoint only |

Boundaries a compiler must respect, each confirmed directly in the man page text:

- **`write_design_changes -last_n` bounds only the logical (netlist) change count.**
  The man page states physical changes are always written in full ("For physical
  changes, it will always output all the changes"). A `capture_changes` operation
  cannot infer a contribution's full edit boundary from `-last_n` or from counting
  commands in the physical file; it must diff against the declared base state instead.
- **`-write_atomic_cmd` and `-reorder` are mutually exclusive** in the command's own
  synopsis (`[-last_n output_command_count | -reorder]` sits in the same alternative
  group as the atomic-command flags); a template that needs both is invalid and must
  be rejected before compiling, not discovered by a tool error at runtime.
- **`undo` checkpoints do not survive `save_workspace`/`open_workspace` round-trips.**
  `undo.1`: "Once a workspace is closed and reopened again, the check points will be
  destroyed." `save_workspace.1` confirms the same for a saved-then-reopened workspace:
  ECO actions remain consistent, but "the manual ECO action cannot be undone since all
  check points have been cleaned." Recovery logic must never assume an unlimited or
  cross-session `undo`; it must instead recompose state from a fresh `open_workspace`
  plus the recorded operation trace.
- **`insert_buffer`/`size_cell` route legalization is best-effort by default.** Both
  man pages describe the same fallback: if legalization fails, the cell is placed at
  the specified location and XTop continues; only
  `placement_legalization_obligated(1)` turns a legalization failure into a hard
  error. A compiled action that requires legalized placement must set that parameter
  explicitly rather than assume the default behavior fails closed.
- **`remove_buffer` refuses to leave a pass-through net or an already-cascaded pair
  broken.** Its man page lists these as explicit error conditions; a buffer-deletion
  request compiled without checking that the target is a genuinely cascaded
  buffer/inverter pair will be rejected by the tool, not silently accepted.

## Counterexample

A plan that reads `write_design_changes -eco_file_prefix wp -format INNOVUS -last_n 5`
and assumes the resulting physical file contains only the last 5 operations' placement
changes would misattribute every other physical-only change (e.g. legalization moves
from earlier, unrelated operations) to the 5 logical operations it intended to export.
The man page is explicit that `-last_n` applies to logical changes only, and that the
physical-change output is always complete regardless of it. A `contribution`'s
`touches`/`delta` must
therefore be computed from an object-level diff against the declared base state, never
from the `-last_n` boundary of a single export call — otherwise a later `seal()` would
silently attribute a stray physical move to the wrong contribution, and reversing a
different contribution would corrupt this one's recorded scope.
