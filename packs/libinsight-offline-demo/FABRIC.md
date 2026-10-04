# Fabric notes

A Run of this Pack on a `local` Site holding `/usr/bin/python3` and read access to the lib_insight
folder does, in order:

1. `analyse` (act, tool) validates `libInsightRoot` and runs the offline LibInsight analysis into
   `${WORKSPACE}/derived/<kit>`, copies the pre-existing calibration, and writes
   `${WORKSPACE}/derived/run-manifest.json`. The analysis subprocess runs with the working directory
   and `PYTHONPATH` at the root and `PYTHONDONTWRITEBYTECODE=1`, so nothing is written into the
   read-only root.
2. `report` (act, tool) reads the derived output and writes `${WORKSPACE}/derived/insight-report.json`
   (the v1 report), `summary.md` and `prototype-app.json`.
3. `read-insight` (act, observes `insightReport`) runs the `libinsight-insight` reader, which
   validates the report and emits `files_analysed`, `report_valid` and `findings_reported` in one
   observation.
4. `judge` applies the three rules; its first rule (`libinsight-report-valid`) is the constraint and
   its second (`libinsight-findings-reported`) is the goal. A PASS leads to `complete`.
5. `complete` (explore, chooser `libinsight-complete`) ends the Campaign goal-met when the
   constraint and goal both passed and every required verdict passed.

No licence seat is held. The analysis takes roughly 4-7 minutes depending on the kit.
