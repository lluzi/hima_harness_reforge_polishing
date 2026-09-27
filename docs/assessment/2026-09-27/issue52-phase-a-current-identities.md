# Issue 52 Phase A current identities

Status: binding/preflight PASS; fresh native TEST in progress. No seal/App/GUI PASS.

- Harness source: `fda5493ff699742d934a54aa487ac4b3c0cfe6ec`.
- Pack: `xtop-timing-closure@1.0.16` (development).
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
