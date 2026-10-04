# libinsight-offline-demo

A demo-only HimaPack that runs the LibInsight analysis of a standard-cell library release offline,
from a prepared LibInsight store, and reports library health. It deliberately does not implement the
LibInsight integration spec (`docs/specs/libinsight/spec.zh-CN.md`): no LEF/pin-access analysis, no
Design-specific journey, no interactive navigation, no library modification.

## Contract

- **inputs:** `libInsightRoot` (read-only lib_insight folder), `workspaceRoot`.
- **strategy:** `kit` choice of `tsmc28-180a` (default) or `n12-100`.
- **goal:** `min_findings` (default 1).
- **wrappers:** `/usr/bin/python3` only. No licences.
- **tools:** `analyse` (validate the root and run `libinsight.batch analyse` into the workspace,
  copy calibration, write the run manifest) and `report` (build the v1 insight report, `summary.md`
  and `prototype-app.json` from the derived output).
- **outputs:** `runManifest` (artifact), `insightReport` (read by `libinsight-insight`).
- **rules:** `libinsight-report-valid` (constraint), `libinsight-findings-reported` (goal),
  `libinsight-files-analysed`.

## Graph

`analyse -> report -> read-insight -> judge`. On a PASS the `complete` explore node applies the
`libinsight-complete` chooser, which ends the Campaign goal-met once the report is valid and carries
findings; a FAIL or UNDETERMINED routes to the `blocked` wait node.

## Report

`hima-library-insight-report/1`, `evidenceClass: native-qualified`, most severe findings first,
capped at the schema limit (<=5000 findings, <2 MiB) with the total finding count and the cap stated
in `conditions.unknowns`.
