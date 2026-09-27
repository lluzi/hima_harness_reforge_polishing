# Issue 52 Phase A current identities

Status: Phase A PASS. Native TEST/seal, Pack release, trial.33 App and composed
no-model/no-Desktop/no-commercial preflight are fixed. GUI acceptance remains pending.

- App/Pack release source: `b2759b0a3a7cc6ba889fa81f523b274fc5a0fbf7`.
- Pack: `xtop-timing-closure@1.0.16`, natively sealed; declared maturity remains development.
- Method digest: `5cab1ddba6d2b6d35f27e2c5a1ddc05a8cd1b8758d1330c9c6c569dfd0cd78b1`.
- Binding id: `linglong-swerv28:xtop-operator-v5:5cab1ddba6d2b6d3`.
- Binding file: `.hima-tmp/issue52-phase-a-v5/interactive-bindings-current.json`.
- Binding SHA-256: `77c6022957c03a777de0481bbe9dc06c753be258b26e204ba23d3009a2977dfa`.
- Administrator environment SHA-256: `32bef2cc363de6bebacf41c4d26f6243d8cb1a8870f58b1e96509bec3a351ae8`.
- No-commercial binding preflight: `.hima-tmp/issue52-phase-a-v5/current-binding-preflight/evidence.json`.
- Fresh native TEST Run: `run-2306b485-ccae-4cca-9b56-4ba2c618ac88`.
- Fresh native TEST evidence: `.hima-tmp/issue52-phase-a-v5/native-test-current/evidence.json`.
- Fresh isolated test root: `/private/tmp/hima-l4-VRd0wS`.
- New remote workspace: `/data/eda/project/hima_harness/xtop-timing-closure-runs/xtop-timing-closure-20260927-125801-5802`.
- Native report/seal receipt: `.hima-tmp/issue52-phase-a-v5/native-test-current-report-qualified/evidence.json`.
- TEST SHA: `63c0755313f77d623615fb9d15b7823401807026c9daf1b629efbfab9b71f901`.
- VERSION SHA: `02327a2f68f8587a870d1c7a24de043978c86dedfcf995902408db9bb3ecd33b`.
- Pack release: https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/xtop-timing-closure-v1.0.16
- Published archive SHA: `a3708faf3776016e6fcd409a09672c9b208923697c9bb6400cd190b0cb4848d9` (GitHub digest verified).
- App: `.hima-tmp/issue52-app-trial33/HimaHarness.app`, version `0.3.0-trial.33`.
- App artifact digest: `1d264f164b8b14381d18d81db50422ecd14c600a17809cd4a03ccadb79e71609`.
- Manifest SHA: `64e22e3242f50c9f802bd091bb7e8574340d79844a3d5f342b0a44ca625042f9`.
- Combined App/Home/Pack/Site/Permit/binding preflight: `.hima-tmp/issue52-phase-a-v5/app-preflight.json`.
- GUI Home Site SHA: `03ba5dde4d92279e0f89632ca0c0f0e8b255a07f4211f0fd6f19a0d369f105b8`.
- GUI Permit SHA: `895a6cd8ac679a3cd4ebe1e45085a69c14dd83f20ff44b4053bb74e9801fd165`.
- GUI manual: `docs/user-guide/issue52-trial33-gui-acceptance.md`, SHA `aec3ec2a9abdf81abcd153832af2d9a991ba23a62bb0b64940cec0c65aa46ba1`.

The original driver failure and first report refusal remain separate failed receipts.
Their reproduced close-projection/author-format defects were minimally fixed and tested;
only reporting/sealing followed, without another commercial Run or changes to Run evidence.
No GUI, timing-closure, PPA, signoff or ROI PASS is implied by Phase A.

## Lower qualification reuse

The changed bytes are the Researcher method instructions and generic Harness input delivery,
not the commercial adapter/startup/wrapper. Reuse is restricted to these verified identities:

- wrapper v5 `dd0cb56535f30c6516ae509efd10cb97d9f7da4ba006e6b6eb8e1f935b34a7e5`;
- `flow/closure.py` `e6295c35803199827f2261dcd96d01880e36178f82e9f6a4c75dc4513f006a56`;
- startup Tcl `a605792ec91b677fc9249590b590b9f35e615ac1ba11bbcfebd8db227167959c`;
- exact image `localhost/edarunner@sha256:8467102dbae851e4136e998661ae3a01ad9b65d49711c82f2b0883ab8d1bbb8c`;
- adapter/command classification digests unchanged from direct v5 qualification.

An additional zero-EDA container probe with the same confinement mounts confirmed both
`/data/eda` and `/usr/bin` write attempts failed with `Read-only file system`, while the new
private workspace remained writable. Probe workspace:
`/data/eda/project/hima_harness/xtop-timing-closure-runs/issue52-binding-probe-fda5493f`.
No historical workspace was modified by this probe.

The old direct v5 transcript and unique ECO hashes remain the lower commercial evidence,
not a new Run PASS. Fresh native TEST is required by the native seal gate: same method digest,
test purpose and an `ended-*` Run. Its existing reference graph cannot legally bypass its
dependencies to manufacture that ending. The final Claude GUI journey remains bounded at
`read-xtop` and reuses closed J3 downstream evidence. No QoR direction is graded.

All historical Runs, including Attempt 4, remain excluded from PASS and unchanged.
