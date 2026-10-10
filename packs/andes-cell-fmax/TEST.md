# Tests

- `sites/eda_cluster_ctu_01/mock-eda/tests/test_mock_eda.py` (python3 -m unittest, 10 tests):
  calibration (+2.50/+3.40/+5.20 %), HimaTime's ranking of the calibrated pairs, the local gain of
  each calibrated pair on the worst path (A1 140.64, B1 115.20, C1 107.76 ps with the screened
  speed-ups) and zero for off-path families, stage sums, the stock Liberty is current, every CLI's
  version/help, one round of CLIs (`himatime verify` with and without `--out`, `qualib screen
  --json`, `andescell generate --families`, the screen's dont-use honoured), and no word "mock" in
  any report a person opens.
- `test/contract/andes-cell-fmax.test.ts` (group `local`, 8 tests): the Pack loads at stage
  compiled with `reports` declared; five outsourced agents with `artifactPrefix: reports/<node id>`;
  the graph's two forks into judge joins and its four autopilot segments; the strip (four
  stations, rows 0/1/1/2, the checklist lines, every node once, the crossing edges) and a strip with
  a node in two stations or a node nowhere refused; every argv name is bound; the committed Site
  fits; the capability; the mock unit suite.
- `test/contract/andes-cell-fmax-dry-path.host.test.ts` (group `andes-dry`): the whole graph in the
  real in-process Host with the mock CLIs run locally (`CTU_MOCK_TIME_SCALE=0`) and the ACP stand-in
  behind the production resident wrapper for all five agent nodes. Round 1 XNOR3/BUF (+2.50 %), a
  Reader-refused qualib list and a Reader-refused local-gain number repaired in the same task;
  round 2 XOR2/MUX2I (+3.40 %); round 3 AOI21/OAI21 (+5.20 %), goal-met; every node's reports at
  `reports/<node>/r<k>/`, the final `report_timing.rpt` with slack MET.
- Smoke on the Site: Pack 0.1 only (recorded in FABRIC.md); 0.2 not yet.
