# Tests

The design data of openc910 is installed per Site and never in git. Every test runs the Site tools
on the synthetic fixture bundle `sites/eda_cluster_ctu_01/mock-eda/tests/fixtures/openc910-mini/`
(env `CTU_OPENC910_DATA`), and writes the Pack's generated knowledge into a temporary copy.

- `sites/eda_cluster_ctu_01/mock-eda/tests/` (python3 -m unittest): the Site tools, the aes model
  (`test_mock_eda.py`) and the openc910 replay on the fixture with a real-bundle smoke that skips
  when the bundle is absent (`test_openc910.py`).
- `test/contract/andes-cell-fmax.test.ts` (group `local`, 10 tests): the Pack with its generated
  knowledge loads at stage compiled (0.4.0, Goal `target_timing_gain_pct` default +1 %, round limit
  2, converge on `bestWns`, headline `timing_gain_pct`, no "mock", "model" or Fmax in any word the App
  shows) with `reports` declared; five outsourced agents with `artifactPrefix: reports/<node id>`
  whose prompts draft their delivery from the tool's own output; the graph's two forks into judge
  joins (`cells-gain-positive`, `cells-screened`; `round-valid`, `timing-goal`) and its four
  autopilot segments; the strip and a refused strip; every argv name bound; the committed Site fits
  the Pack with its generated knowledge (and does not without it); the capability; the generated
  knowledge (seven charts that validate against `himaChart` and carry the fixture's route numbers,
  design notes that name them with every field filled, both git-ignored); one round of the Pack's
  deterministic steps on the fixture (bind → reference → timing → drafts → Readers → generate →
  verify → build → compare): a typed arc, a typed what-if gain, a changed constraint, other AndesCell
  settings and a typed kept count are refused, the drafts pass, the round reads the fixture's gain at
  route, and every chart a person sees validates; the Site unit suites.
- `test/contract/andes-cell-fmax-dry-path.host.test.ts` (group `andes-dry`): the whole graph in the
  real in-process Host with the Site CLIs run locally (`CTU_MOCK_TIME_SCALE=0`, the fixture bundle)
  and the ACP stand-in behind the production resident wrapper for all five agent nodes. One round,
  every delivery drafted from the tools, goal-met at the +1 % Goal; a Reader-refused Qualib list (a
  cell Qualib did not analyse) and a Reader-refused kept count repaired in the same task; every tool
  and agent node's report at `reports/<node>/r1/`; every run chart validates against `himaChart`
  and carries the tools' numbers; no "mock" or "model" in what the App shows.
- `python3 flow/knowledge_charts.py <EDA_ROOT> <dir>` against the real bundle (by hand, not in a
  test): the notes and charts read well and equal the data owner's numbers.
- Smoke on the Site: Pack 0.1 only (recorded in FABRIC.md); 0.2–0.4 not yet.
