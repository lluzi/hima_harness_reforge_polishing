# Offline LibInsight demo analysis method

## Scope

This Pack runs the LibInsight analysis engine over an **already prepared** store and Kit Release and
reports library health. It is a demo of the offline analysis-to-report chain, not the LibInsight
integration spec: no LEF/pin-access analysis, no Design-specific journey, no interactive navigation,
no library modification.

## Inputs

- `libInsightRoot` — a read-only folder holding `kits/<kit>.json` and `data/store` (the `lib_insight`
  repository). The chosen `kit` Strategy knob selects the manifest (`tsmc28-180a` or `n12-100`).
- `workspaceRoot` — the Campaign's private workspace; all output is written here.

## Steps

1. **analyse** validates the root (manifest present, store present, every store file the Kit
   references exists) and runs `python3 -m libinsight.batch analyse --kit kits/<kit>.json
   --store data/store --out ${WORKSPACE}/derived/<kit> --jobs 6`, with the working directory and
   `PYTHONPATH` at the root so `-m libinsight.batch` resolves. It copies the pre-existing
   `calibration.json` and `calibration/` from the root's `data/derived/<kit>` into the workspace
   output (a read-only copy, so reliability shows), and writes `derived/run-manifest.json`.
2. **report** reads only the derived output in the workspace (kit.json, the findings shards,
   causes.json and the calibration) and writes the v1 insight report, `summary.md` and
   `prototype-app.json`.

## Evidence class

`native-qualified`: the measured numbers come from the qualified LibInsight analysis engine running
over a prepared store. Estimated quantities carry the copied calibration/audit status rather than a
measured error. Design impact is unknown because no design is supplied.

## Hard limits

No vendor Liberty API and no licence are used. The LibInsight repository is never written to:
`PYTHONDONTWRITEBYTECODE=1` is set, output is written only under the workspace, and the tools never
invoke `batch convert`, `calibrate`, the vendor extract path, `tmlib`, `edarun`,
`EMPYREAN_LICENSE_FILE`, or the prototype server's POST routes. The report is capped at the schema
limit (at most 5000 findings, under 2 MiB) with the total finding count and the cap stated in the
report's `conditions.unknowns`.
