# Final local regression

The complete local group produced 463 passes and two failures out of 465 tests. The failures exposed test timing assumptions: the graph coverage test allowed only 120 seconds before its closing reserve, and a legacy resume test expected all experiment work to fit within six seconds under packaging load.

Both tests now have adequate budgets for their intended checks. All original owner, graph, evidence, attempt and wait-accounting assertions remain. No production budget, runtime or Pack behavior changed in this test correction. Independent review found no weakened assertion.

Both affected tests then passed independently; command logs and hashes are recorded in `evidence.json`. The full group was not rerun after these test-only corrections. The later ready-parent growth correction has its own focused evidence. Selector-audit cases and no-window desktop diagnostics passed separately. These local checks do not certify actual EDA, AI research, UI operation or user acceptance.
