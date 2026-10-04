## Business

Library insight analysis of a standard-cell library release from a prepared LibInsight store
(offline; no vendor API or licence). Point this Pack at a folder that already holds a LibInsight
Kit Release and store — the `lib_insight` repository — and it runs the LibInsight analysis engine
offline and produces a read-only Library Insight report plus a human-readable summary.

Choose this Pack when a user asks for a **library insight analysis** of a standard-cell library and
points at the lib_insight folder: it reads `kits/<kit>.json` and `data/store`, runs the analysis,
and reports library health (completeness, consistency, table precision, drive ladders,
optimization limits and the other LibInsight checks) with the most severe findings first.

This is a demo Pack (`status: development`). It deliberately does **not** implement the full
LibInsight integration spec (`docs/specs/libinsight/spec.zh-CN.md`): there is no LEF/pin-access
analysis, no Design-specific journey and no interactive navigation here. It exercises the offline
analysis-to-report chain only, so a customer demo can be driven end to end without the vendor
Liberty API or a QuaLib licence.

## Golden Flow

The Site binds `libInsightRoot` to the read-only LibInsight folder and `workspaceRoot` to the
Campaign's private workspace. The `analyse` tool validates the root (the Kit manifest and the store
are present, and every store file the Kit references exists) and runs
`python3 -m libinsight.batch analyse` into `${WORKSPACE}/derived/<kit>`, copying the pre-existing
reliability calibration in beside it. The `report` tool turns that output into a versioned v1
Library Insight report (`hima-library-insight-report/1`), a `summary.md`, and a `prototype-app.json`
that points the LibInsight prototype UI at this run. The reader validates the report and the Judge
ends the Campaign goal-met once analysis and report both succeed.

## Answers

The reader is authoritative for whether the report is valid, how many library files were analysed,
and how many findings the report carries. `evidenceClass` is `native-qualified`: the numbers come
from the qualified LibInsight analysis engine over a prepared store. The report is capped at the
schema limit (at most 5000 findings, under 2 MiB) with an explicit note of the total finding count
and the applied cap; omitted findings remain in the workspace output and the prototype UI.

## Ambiguities resolved

The only executable is `/usr/bin/python3`; no EDA licence is required. The LibInsight repository is
a read-only input — nothing is ever written into it (`PYTHONDONTWRITEBYTECODE=1`, output only under
the workspace, no use of `batch convert`, `calibrate`, the vendor extract path, `tmlib`, `edarun`
or any licence). The chosen `kit` (`tsmc28-180a` or `n12-100`) is a Strategy knob.

## Knowledge applied

`knowledge/analysis-method.md` records the offline scope, the inputs, the evidence class and the
limits of this demo analysis.
