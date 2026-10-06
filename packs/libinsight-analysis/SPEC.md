# LibInsight resident custom analysis 0.1.0 run contract

## Goal template

No numeric Goal parameter. The terminal `deliver` value carries `goalMet: true` exactly when an
accepted analysis was admitted into the library; a blocked or cancelled resident outcome ends with
`goalMet: false` and the reason.

## Constraints

- Inputs: `analysisRequest` (a `hima-libinsight-request/1` file the Host writes per Run and
  overrides per Run), `analysisLibrary`, `factsCorpus`, `engineeringCapabilities`,
  `licenceModeFile`, `workspaceRoot`.
- Request: exactly `{schema, requestId ^req-[0-9]{14}-[a-z0-9]{6}$, question 1..4000, sources ≤32
  absolute .lib/.json.gz, buildsOn ≤8 id@version, createdAt ISO-8601}`.
- Sources must be plain readable files inside the resident sandbox's read-only roots; facts files
  must be `status: ok` `lib-insight-facts/1` records whose Liberty source did not change during
  extraction.
- A Liberty source with no facts file in the corpus needs live QuaLib; with the licence mode file
  not `new`, prepare-request fails with "linglong's Empyrean licence is in XTop mode; the operator
  switches it with `empyrean-license new` (and back with `empyrean-license old` before XTop work)".
- The resident holds one `QuaLib-2026-new-59099` seat for its whole task; the Pack never changes a
  licence.
- Budget: 45 minute time box with a 5 minute closing reserve; admit-analysis and deliver are closing
  tasks.

## Run contract

| Task | Producer | Output |
| --- | --- | --- |
| prepare-request | `libinsight_cli.py task-prepare-request` | `state/prepared-request.json` (`hima-libinsight-prepared-request/1`); committed value `{requestId, question, preparedPath, preparedSha256, sources, buildsOn, libraryAnalyses, goal}` |
| custom-analysis | resident engineering agent (outsourced, artifactPrefix `analysis`) | `state/analysis-result.json` (`hima-libinsight-analysis/1`) + `analysis/...`; committed Reader observation and engineering outcome |
| admit-analysis | `task-admit-analysis` | `<library>/<id>/v<version>/{admission.json, analysis-result.json, analysis/...}`; `state/admission.json` |
| deliver | `task-deliver` | `delivery/report.json`, `delivery/REPORT.md`, `delivery/analysis-result.json` |

## Semantics

`li_analysis_error_count` (0 only after complete verification; any problem fails the Reader),
`li_analysis_plot_count`, `li_analysis_dataset_count`, `li_analysis_row_count`, all `count`.

## Judge rules

`analysis-delivery-ready`: `li_analysis_error_count eq 0`.

## Choosers

None. The route is a fixed sequence.

## Endings

`deliver` ends the Run: `ended-goal-met` when admitted, `ended-goal-not-met` for an honest blocked
or cancelled delivery. A Reader rejection never ends the Run; it is repaired in the same resident
task until the time box.

## Workshops

None. Code is written by the resident engineering agent in its private workspace.

## Knowledge

`custom-analysis-contract.md`, `qualib-api-playbook.md`, `facts-schema.md`, `analysis-library.md`,
`example-custom-analysis.md`; all five are handed to the resident task.
