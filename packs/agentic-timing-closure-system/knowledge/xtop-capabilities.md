# XTop 能力地图

## Source

- XTop man pages, install snapshot `2025.09.tmp15` on `192.168.50.41` (read-only,
  man page footer dated `12/15/2025`), root
  `/data/eda/software/eda_tools/empyrean/xtop-2025.09.tmp15/share/doc/man/man1/`:
  `get_paths.1`, `get_attribute.1`, `size_cell.1`, `insert_buffer.1`, `remove_buffer.1`,
  `write_design_changes.1`, `save_workspace.1`, `open_workspace.1`, `undo.1`,
  `report_eco_actions.1`. T12 fix-round addition (same root, same read-only
  `ssh luzi@192.168.50.41`, `sed`/`grep`/`cat` only): `get_cells.1`,
  `foreach_in_collection.1`, `filter_collection.1` — added while verifying the
  commands `atcs_dump_cells` (`flow/templates/xtop-operator.tcl`/
  `xtop-replay.tcl`) actually uses. There is **no** `get_object_name.1` in this
  man tree, and no `get_object_name` row anywhere in `command_surface.tsv`
  (grepped directly) — an earlier draft of `atcs_dump_cells` used it; that was
  wrong and has been replaced (see the `get_cells`/`foreach_in_collection` rows
  below).
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
| Path query | `get_paths`; `analyze_setup_path_violations` / `analyze_hold_path_violations` | `get_paths` accepts `-start_points`, `-end_points`, `-through_points`, `-scenario`, `-group`, `-delay_type {all\|min\|max}`, `-path_type`, `-lower_bound`, `-upper_bound`, `-filter`; `atcs_paths` returns the bounded fixed session report body rather than only XTop's filename notice. |
| Single-endpoint slack (`atcs_point`, #66 D3) | `summarize_gba_violations` | `-with_delta -with_reference -exclude_path -with_top_n 10000 -setup\|-hold`, captured by `redirect -variable` (the `atcs_gain` probe's own command, qualified in Task 7, T06 and Q1): its `### <check> top N endpoints ###` table, rows `<slack> <scenario> <endpoint>`, filtered to the named pins. Real XTop has **no** `report_timing` (#64 Q1: `invalid command name "report_timing"`, 151 of 151 rows null); do not use it. An endpoint the table does not name reads `slack: null` with an `unknown` reason: no violation of the check when the table lists every violating endpoint the summary counts, else a slack above the last listed row. That `-with_top_n 10000` lists every violator on a real design (7430 hold in Q1) is the one unqualified part (largest value run on real XTop: 20); the reason text stays exact either way, since it compares the listed endpoints with the summary's own count |
| Pin direction (`atcs_remove_buffer` input-net admission, #66 D2) | `get_attribute <pin> direction` | `in`/`input` marks the buffer's input pin. **Not yet cross-checked** against a man page; if real XTop lacks the attribute, no net is admitted and the removal stays refused as before |
| Per-instance attribute query | `get_attribute` | `object_spec attr_name [-class {design\|pin\|cell\|port\|net\|lib_cell\|lib_pin\|lib\|timing_path}] [-scenario sce]` |
| Whole-design cell enumeration (`atcs_dump_cells`) | `get_cells` | `[-hierarchical] [-quiet] [-regex \| -exact] [-nocase] [patterns \| -of_objects objects] [-filter expression]`; `command_surface.tsv` row 123, `documentation_status = man+completion` |
| Iterate a collection (`atcs_dump_cells`) | `foreach_in_collection` | `iter_var collection body`; `command_surface.tsv` row 120, `documentation_status = man-only`. `get_attribute.1`'s own worked example re-wraps the loop variable (`foreach_in_collection i [get_dont_touch_cells] {set_dont_touch [get_cells $i] 0}`) rather than treating it as an already-typed cell object — `atcs_dump_cells` follows the identical `[get_cells $i]` re-wrap before every `get_attribute` call on it. |
| Instance name / library-cell (master) name of one cell (`atcs_dump_cells`) | `get_attribute ... full_name` / `get_attribute ... ref_name` | `ref_name` is `get_attribute.1`'s own worked example verbatim (`get_attribute [get_cells U43] ref_name` → `AN4XD1BWP12T`). `full_name` has no `get_attribute`-specific worked example, but is confirmed as a real, queryable cell attribute in the *same* man-page corpus by `filter_collection.1`'s own worked example (`filter_collection [get_cells -hierarchical] "full_name =~ U\e[0-9\e]+" -regexp`) — `get_attribute`'s own DESCRIPTION ("gets the value of an attribute on an object... attr_name — the attribute name to get") places no restriction on which attribute name may be queried this way, so this is documented-by-cross-reference, not invented. There is no `get_object_name` command in either the man tree or `command_surface.tsv`; do not use it. |
| Sizing | `size_cell` | `cell_list lib_cell [-design design_name] [-location coord]` |
| Buffer insertion | `insert_buffer` | `pin_list lib_cells [-design design_name] [-inverter_pair] [-new_cell_names names] [-new_net_names names] [-locations coord] [-force]` |
| Buffer deletion | `remove_buffer` | `cell_list [-design design_name]` |
| Change export | `write_design_changes` | `-format {NATIVE\|INNOVUS\|CUI\|SOC\|ICC\|ICC2\|PT\|ATOP\|V_DEF}`, `-eco_file_prefix`, `-output_dir`, `{-last_n count \| -reorder}`, `-exclude_new_created`, `-keep_route`, `{-write_atomic_cmd \| -force \| -strong_force}`, `-exclude_phy_info`, `-version val` |
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
- **The synopsis has two separate exclusive groups, not one.** `-last_n` and
  `-reorder` are mutually exclusive with each other (`[-last_n output_command_count |
  -reorder]`); independently, `-write_atomic_cmd`, `-force` and `-strong_force` are
  mutually exclusive with each other (`[-write_atomic_cmd | -force | -strong_force]`).
  `-reorder` is not exclusive with `-write_atomic_cmd` — the DESCRIPTION recommends
  combining them: when atomic commands end up mixed with macro commands (typically
  from `-force`), use `-reorder` to put all the atomic commands at the end of the
  output sequence. A compiler must reject only the two documented same-group
  combinations (`-last_n` with `-reorder`; any two of `-write_atomic_cmd`/`-force`/
  `-strong_force`), not the cross-group pairing of `-reorder` with
  `-write_atomic_cmd`.
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
- **A local-topology session (#66 D2) derives its edit domain once, before its ready line.**
  The target pins' and plan instances' pins' nets, and the leaf cells on them (drivers and loads), one hop,
  from `get_pins -leaf -of_objects <net>` and `get_nets -of_objects <pin>` (`get_pins -leaf` on a net
  collection is unverified on real XTop); a net with more leaf pins than `ATCS_LOCAL_FANOUT_MAX` (12) is
  global (clock, reset, scan enable), stays out and is listed in `domain.json` `globalNets`. Names that do
  not resolve are listed in `unresolved`; a derivation that errors keeps the plan's domain and records
  `error`. The replay never derives: it enters each session's sealed domain.
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

## Expert session settings

The existing Operator exposes only two added bounded surfaces: atcs_path_pin_rank and atcs_legalization_range. See xtop-expert-operator.md for the generic manual ladder and vendor-backed argument examples. Rank marking changes analysis/fix priority and must be refreshed after ECO; it is not a pure read. Legalization range enables strict placement, caps ECO displacement at1000tracks, fixes automatic original-cell displacement at0 and keeps hard readiness. Both require the current reviewed plan and are counted; neither is itself a physical ECO gain. Their settings/reports remain in the existing reads evidence and exact handoff script.

## More XTop commands

These forms are verified on XTop 2025.09.tmp15 in batch. The flags below are examples, not the full
synopsis; read `man -l <install>/share/doc/man/man1/<command>.1` for the rest. Which ones help, in what
order and with what values is for you to find out by measurement.

| Command | What it does |
|---|---|
| `purge_timing_paths` | drops the retained path-based timing paths from the session; the fixers then use GBA |
| `fix_transition_violations <pins>` / `-check_timing_margin <pins>` | electrical repair; targets from `get_transition_violated_pins -pin_type data` |
| `set_placement_constraint -max_displacement {<x>t <y>t}` | ECO placement and legalization range, in tracks |
| `set_parameter eco_max_buffer_chain_length <n>` | longest buffer/delay chain one fix may insert at a pin |
| `fix_hold_gba_violations -buffer_list <cells> -max_cluster_loader_count <n> -effort <level>` | hold fixing with an explicit cell list |
| `report_fail_reasons -stats -verbose -pins <pins>` | why fixes failed; `-stats` needs `-pins` or `-paths` |
| `fix_violations_by_clock_eco -setup -buffer <clkbuf> -count <n> -trace_level <n> -hold_wns_threshold <ns> -auto_scan` | the tool's clock-ECO fixer |
| `insert_buffer [get_pins <pins>] <cell>` / `-locations` | manual insertion, one cell per call, so `undo` removes exactly the last one |
| `get_attribute [get_pins <p>] max_rise_gba_slack -scenario <s>` (also `max_fall`, `min_rise`, `min_fall`) | the per-scenario GBA slack of one pin |

Batch hygiene: run `xtop -f <script> < /dev/null`. After a Tcl error XTop waits at its prompt, and
without input it hangs. Wrap risky commands in `catch`.
