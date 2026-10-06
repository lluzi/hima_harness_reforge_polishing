# `lib-insight-facts/1` — QuaLib-extracted Liberty facts

LibInsight's extractor (`extract/libapi_extract.py`) reads one Liberty file with the QuaLib 2026
Liberty API and writes one gzip JSON record per file. LibInsight's own reader
(`libinsight/store.py: convert_facts`) refuses any other schema and any `status` other than `ok`.
Facts mode reads these files with plain `gzip` + `json`; no licence is needed.

```python
import gzip, json
with gzip.open(path, "rt") as stream:
    facts = json.load(stream)
assert facts["schema"] == "lib-insight-facts/1" and facts["status"] == "ok"
```

A 20 MB SAED14 file (922 cells, 115150 tables) loads in about 1.5 s with Python 3.6 or 3.12.
The corpus on linglong (`factsCorpus` in the prepared request) holds subfolders `saed14`,
`tsmc28`, `tsmc28-views`, `n12`, `vendor` (88 files on 2026-10-05; `tsmc28` files average about
30 MB and `n12` files about 110 MB compressed), so load one file at a time and keep only what you
need.

## Top level

| Key | Meaning |
| --- | --- |
| `schema` | `"lib-insight-facts/1"` |
| `source` | `{path, bytes, sha256}` of the Liberty file read; newer records also carry `sha256_after` and `source_unchanged`. `source.sha256` is the `libertySha256` you report. |
| `producer` | `{api, api_home, python, extractor_sha256, schema}` |
| `started`, `finished` | local timestamps |
| `timing` | `{parse_s, extract_s, counts: {cells, pins, timing_groups, power_groups, tables, ccs_tables_skipped}}` |
| `status` | `ok`, or `failed` with `failure` text (never analyse a failed record) |
| `library` | the facts below |
| `roundtrip` | optional write-back/re-read check: `{result: "match"\|"mismatch", source_sha256_after, n_problems, ...}` |
| `max_rss_kb` | extractor memory |

The extractor writes the keys in this order, so `schema`, `source` and `status` sit in the first
few hundred bytes; the Pack's `prepare-request` reads only that header.

## `library`

| Key | Meaning |
| --- | --- |
| `name` | Liberty library name |
| `units` | SI scale of one library unit: `time_s` (e.g. `1e-09`), `cap_F` (`1e-15`), `res_ohm`, `voltage_V`, `current_A`, `leakage_W` (`1e-12`), `dynamic_W` |
| `attrs` | library attributes as read, e.g. `time_unit: "1ns"`, `capacitive_load_unit: [1, "ff"]`, `leakage_power_unit: "1pW"` |
| `operating_conditions` | `[{name, attrs: {voltage, temperature, process, ...}}]` |
| `templates` | `[{type, name, variables: [...], index: [...]}]`; `variables[i]` names table axis i (`input_net_transition`, `total_output_net_capacitance`, `related_pin_transition`, `constrained_pin_transition`, ...). Template `index` entries are raw API tuples (`[ok, [values]]`); use the table's own `index`. |
| `other_groups` | counts of other library groups |
| `cells` | list of cells |

## Cell

| Key | Meaning |
| --- | --- |
| `name`, `area`, `footprint` | `area` is unitless Liberty area |
| `flags` | `{dff, latch, clock_gating, icg, memory}` booleans |
| `attrs` | all cell attributes (e.g. `cell_leakage_power`, `cell_footprint`, `area`, `dont_use`) |
| `leakage` | `[{when, value, related_pg_pin}]` in leakage units |
| `pg_pins` | `[{name, pg_type, attrs}]` |
| `pins` | signal pins |
| `sequential` | `[{type: ff\|latch\|..., names, attrs}]` |
| `other_groups` | counts |

## Pin

`{name, direction ("input"|"output"|"inout"|"internal"), is_clock, is_bus, is_bus_bit, cap, attrs,
timing: [...], internal_power: [...], receiver_cap_groups?, min_pulse_width?, minimum_period?,
other_groups?}`. `cap` is in capacitance units.

Timing group: `{related_pin, timing_type ("combinational", "rising_edge", "setup_rising", ...),
timing_sense, when, sdf_cond, tables: [...], ccs_groups?, attrs?}`.

Internal power group: `{related_pin, related_pg_pin, when, tables: [...]}`.

## Table

`{kind, sigma, template, index: [[...], ...], values: [...], attrs?}`

- `kind`: `cell_rise`, `cell_fall`, `rise_transition`, `fall_transition`, `rise_constraint`,
  `fall_constraint`, `rise_power`, `fall_power`, ...; CCS and vector models are not extracted
  (`timing.counts.ccs_tables_skipped` counts them).
- `index[i]` are the axis points of template variable `i`; `values` are row-major over `index[0]`
  then `index[1]` (`values[i * len(index[1]) + j]`).
- A table with `template: null` is a scalar reported with a dummy axis; LibInsight treats it as
  having no axes.
- Units (LibInsight `value_scale`/`index_scale`): delays, transitions, constraints, `retaining_*`
  and `ocv_*` in time units; `*_power` (internal power) is energy in `cap_F × voltage_V²`;
  capacitance kinds in cap units; slew axes in time, load axes in cap.

## Missing values

Liberty values arrive as numbers or strings. A value that is absent or not numeric is unknown: keep
it `null` with a `nullMeans` reason in your dataset, never 0. LibInsight converts with
`float(value)` only for real numbers and numeric strings and records `missing` versus
`non-numeric` reasons.

## SAED14 note (observed 2026-10-05)

SAED14 RVT inverter tables are drive-scaled: every `SAEDRVT14_INV_*` table shares the slew axis,
but its load axis grows with drive (mid-grid load 4.08 fF at drive 0.5 to 152 fF at drive 20). A
comparison "at the mid grid point" therefore compares different loads; interpolate to one common
load inside every grid (see `example-custom-analysis.md`).
