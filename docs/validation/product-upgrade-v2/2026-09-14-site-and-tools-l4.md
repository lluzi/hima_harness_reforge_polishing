# Product Upgrade v2 Site and tool L4

Status: PASS for bounded Site discovery and command/report compatibility. This is not a complete
Campaign, Fmax benefit, PPA comparison, signoff or release result.

## Scope

The held-out design was the public GCD RTL selected before the portable Pack tests were written.
Its source SHA-256 is `5009f224876d39e5e77e59ee1528cb0d2a03697251f0971b77cf3e8b0426dd3e` as retained in the private Site staging record. HimaHarness
started from an isolated Home, installed `custom-cell-fmax-dtco`, discovered the SSH Site through
the fixed read-only probe vocabulary, prepared a signed proposal, deployed the Pack-owned flow,
ran `bind-inputs`, opened the nested probe and launched one real Design Compiler synthesis. The
Campaign was then stopped; no full DTCO exploration was claimed.

Private Site paths, input profiles, logs, reports and databases remain on the Site and are not
committed or uploaded. The identifiers below permit a reviewer with Site access to locate and hash
those retained facts without publishing customer-style material.

## Results

- Site discovery suite: 9/9 PASS in 15.963 s. It exercised a real report read, Permit refusal,
  literal argument quoting, warm connection recovery, stale socket recovery, bounded host/tool
  discovery, read-only command enforcement and jump-host routing. It launched no EDA job.
- Hima Run `run-6f1bdcd8-5a47-4d5a-9be4-f315de974a46`: Pack-source workspace and complete input
  binding passed; one real GCD DC probe settled successfully. Pack method digest at launch was
  `af5bc585e104969c5cc93f956177de4f72f064106104743cac7b398de9c73506`; retained `probe.json`
  SHA-256 is `107f5df357e40a81884954d36d099c2bbfd05a48bb7b7e920cabcfed6cc6d91b`.
- Library Compiler T-2022.03 accepted a current-format generated Liberty after the L4 fixture's
  internal library name was made consistent with the requested output. The DB SHA-256 is
  `ef67e643ed209f9d2c8ea4784a63f2c9cf0e6fb72c697df1ab5b629f72922258` and the stage record
  SHA-256 is `7890d91e18e6e171cf92691da15cff3b5a07f507720db3ff348e2c5112d75bbe`.
- Innovus 23.14 restored an existing final routed database and successfully exercised final setup
  timing, hold timing, `write_sdc`, generated-library visibility, `dbGet` final-instance census,
  cell DRC, connectivity, power, gate-count and summary reports. This compatibility probe reused a
  prior routed database and therefore makes no GCD or new-result claim.

## Findings converted into fixes

The first binding attempt retained an honest failure because the staged profile omitted
`CLOCK_NAME`. The next direct probe exposed a missing lowercase `edaWrapper` compatibility alias;
commit `19ef3ae` added and tested it. Real Innovus then showed that hold-mode files are named
`hold_hold.summary.gz` and `hold_all_hold.tarpt.gz`, and that connectivity totals are expressed as
`N Problem(s)`. Commit `d9c73fc` aligned both production readers and added counterexamples.

The same real reports established current parsable secondary facts: total power in mW, gate and
cell counts, cell area, routed instance count and pure gate density. Congestion overflow is not
present in the verified summary format and is emitted as unknown rather than zero. The post-fix
custom/AES domain set passed 26/26 with no SSH or EDA repetition.

## Retained evidence identities

- setup summary `f3f31344327de587fb469b98808be2ddebc9e2ed04511a79b61aecdc067afc9a`
- setup paths `6f0a13ef747959d213a12d315a29ecb29b5438591dfd81726f751e5019e30f25`
- hold summary `d64c1b75b7f314b5f0384b56a6667fe3aa670865c35caa2bc69ad31b598b50a4`
- hold paths `43ea12f54b94a282d459b841faf007b26e46d863cb94b5246b929fca3c5e898d`
- exported SDC `ab84dd8a3eadfae4f77d8ba3a50e6d9aa0c01cf0258280f7b7ecf83af0f98dfb`
- DRC report `c9bc92e31cd880e0001d57f6d76c1352f1f01b0d903c369a36ef0af22d1db40f`
- connectivity report `d5624d15600f9616efb9606f5d26f0d3770248fb3918b76a122d63f69812c584`
- power report `0ebf238ba1a34a41b064a70e995304c907f55e66f5fa67c395da734b9ba2e554`
- gate-count report `5f965c6f366ac918cd745b2d56f164901dde23428a0dcbde85b1d105764948f5`
- route summary `6cf35b957acb452856fa43ff454d4a73b359cb539732274c1b887949e5944066`

Still required: one bounded DeepSeek selection/knowledge task and the single complete held-out L5
Campaign. These L4 results do not authorize a trial release.
