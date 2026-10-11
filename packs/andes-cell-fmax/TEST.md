# Tests

- `sites/eda_cluster_ctu_01/mock-eda/tests/test_mock_eda.py` (python3 -m unittest, 14 tests): the
  timing math of the ~2 GHz model (0.500 ns, setup + uncertainty 20 ps, 20–30 levels a path of
  10–30 ps cells and 2–5 ps nets, no stock cell above 34 ps; A1 = 34 + 369 + 89.4 ps, slack
  −12.4 ps, Fmax 1951.60 MHz, TNS −0.596 ns over 74 endpoints), round 1 (XNOR3 −10 %, BUF −8 %:
  13.84 ps off A1, B1 then limits, 1980.98 MHz, +1.51 %), HimaTime's ranking (XNOR3, BUF, then
  XOR2, AOI21), the QoR per flow stage (synthesis +9.6 ps … route −27.0 ps, post-route opt at the
  final numbers; area and instances grow; DRC 0 after routing; 80 s / 84 s), the local gain 8–20 ps and zero for off-path families, stage sums, the stock
  library files are current, every CLI's version/help, one round of CLIs (`himatime verify` local
  gain 16.88 ps with and without `--out`, `qualib screen --json`, `andescell generate --families`,
  the screen's dont-use honoured, every timed cell stage under 35 ps), and no word "mock" in any
  report a person opens.
- `test/contract/andes-cell-fmax.test.ts` (group `local`, 9 tests): the Pack loads at stage
  compiled (0.3.1, default Goal +1 %, round limit 2) with `reports` declared; five outsourced agents
  with `artifactPrefix: reports/<node id>`; the graph's two forks into judge joins and its four
  autopilot segments; the strip (four stations, rows 0/1/1/2, the checklist lines, every node once,
  the crossing edges) and a strip with a node in two stations or a node nowhere refused; every argv
  name is bound; the committed Site fits; the capability; the knowledge charts validate against
  `himaChart` (the reference summary a metrics table), equal what `flow/knowledge_charts.py` writes from the tools today and are named in
  `design-notes.md`; the mock unit suite.
- `test/contract/andes-cell-fmax-dry-path.host.test.ts` (group `andes-dry`): the whole graph in the
  real in-process Host with the mock CLIs run locally (`CTU_MOCK_TIME_SCALE=0`) and the ACP stand-in
  behind the production resident wrapper for all five agent nodes. One round, XNOR3/BUF, +1.51 %,
  goal-met at the +1 % Goal; a Reader-refused qualib list and a Reader-refused local-gain number
  repaired in the same task; every tool and agent node's human-readable report at
  `reports/<node>/r1/` (with `flow_summary.rpt` for both builds); the run charts (the RTL2GDS
  summary and comparison tables, the flow-stage charts and the rest) validate against `himaChart` and carry the tools'
  numbers; no "mock" in what the App shows.
- Smoke on the Site: Pack 0.1 only (recorded in FABRIC.md); 0.2 and 0.3 not yet.
