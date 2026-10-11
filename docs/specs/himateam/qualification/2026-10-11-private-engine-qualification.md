# Private engineering engine and SDK partial qualification

This implements a bounded #100 increment through the existing Host-owned C7/C8 lifecycle and Settings. It does not close #100 or unlock #101/#104. macOS arm64 uses privately configured Podman 6.1.3 / AppleHV with explicit Rosetta=false. Linux x64 rootless and clean installation remain unqualified. No broker, daemon, second scheduler or production Member activation was added.

## Fixed asset identity

The corrected Hindsight/PG base retains 52,535 files: manifest `34438a93a12bbdf1b0a585ee8e9b392fee0b23acf2a5ea1ab2143fcac26f2680`, inventory `21e3f3ae6db521a736fe6c615013cbd5b0f7a3e4cf4c7d235f64c12523fc4583`. Python uses explicit `-I -B -m`; older bytecode-mutated inputs were refused rather than rehashed.

The noticed SDK candidate has 52,543 files, manifest `1b2e21757b7424b5ee89e5fda69ef25864377e3a8ec744310f5acd3412c4f52c`, inventory `1f32d7c0bd1e1b95ffa3c65e50b4343f7bf5e2cefad5d89c4c5b8e3c5dedf071`. Its OCI archive SHA is `4af56e03ea4ad4753b17a391d1c3b81a54a986ae7a3f7d4980ddbeb3c6fa6479`, 511,858,688 bytes; config `5b85228ad9c434283f92be24858a074c4b06f9e80d569bdb67659c25786a52c2`. Eight original base layers and one SDK layer are bound by the published pin. Compressed layer hashes and uncompressed diff_ids are separately verified. The original npm topology includes 388 contained links; 32 deployment metadata rewrites bind both original and final bytes. Runtime/notice bytes are unchanged by relocation. Receipts and the OCI contain no source workstation paths.

The offline producer accepts only explicit local pinned inputs. Staging updates OCI, manifest, inventory and the published pin together and keeps the original prefix/pin. Formal packaging refuses the retained release blockers and trusted-fixture-only qualification. Successful layer intermediates are removed; failed evidence is retained. An earlier successful stage left an unpinned duplicate: the existing packager refused it. The exact duplicate was reconciled using the embedded layer hash, retaining original failure evidence; real 52,543-file repackaging then passed without changing declared bytes.

## Verification

Public C7 mechanism tests pass 9/9 with no skips. Persisted receipts are immutable snapshots; the admitted private connection is bound to its machine/config/key/helper identities. Same-name connection drift is refused before endpoint commands, leaving resources unknown for reconciliation. No arbitrary persisted PID or foreign machine is killed. Missing engine assets preserve Guide and Hindsight independence.

The packaging subset passes 24/25, zero failures, one explicit retained-Hindsight-input skip. It includes a positive SDK stage→existing-packager round trip, source/pin preservation, formal-distribution refusal and absence of unpinned successful intermediates. Source/test typechecking passes. These are mechanism results, not native installer acceptance.

The real Mac SDK run passed all six fixed-cohort probes: Node 24.20.0, OpenCode 1.18.34, rg 15.2.0, fd 10.5.0, Pi 1.1.0 and OAR 0.46.0 module import (105 exports). The first run failed with OpenCode EROFS at `/root/.local`. The corrected trusted fixture uses bounded ephemeral HOME/work/tmp mounts; root remains read-only, capabilities dropped, no-new-privileges enabled, and no Host HOME or engine socket is mounted. Actual writes to private HOME/work succeeded, root writes failed, and the engine socket was absent. This does not provide #101 durable Member workspaces.

The same run observed bounded inet default-drop rules before the trusted namespace lease, GitHub TLS 200, online C8 inventory export and exact container/VM/helper closure; default user container inventory was unchanged. Direct machine-SSH policy installation had previously returned empty output without installing rules; the gate refused it. The generation-owned read-only-transfer controller preserves actual guest-local subprocess stdin/stdout/exit status.

Earlier actual Playwright Electron Settings passed 2/2 without skips against the fixed-connection engine source (193.286 seconds). The final noticed SDK candidate also passed 2/2 without skips (67.734 seconds), including actual operator startup/status/stop with closed resources. App/Home/database/ports and private resources are isolated; no exclusive screen is required.

## Review and open gates

Independent Standards and Spec review identified mutable historical receipts, private connection rebinding, an unpinned successful intermediate and source-prefix pin mutation. Their reproductions and red/green results are retained; corrected receipt/connection reviews accepted the affected fixes. Both axes accepted the SDK fixes and ephemeral-directory boundary; no new actionable findings. Their fixed patches and reports are retained before synchronization.

The notice audit matches 14 supplemental scopes to exact primary-source license bytes. Four npm notice scopes (three AWS packages and proxy-agent-negotiate), Python/transitive and native corresponding-source/build/offer obligations remain unclosed. Linux x64 native cohort, configured-provider DNS/CDN/expiry/external IPv6 and complete isolation, two-platform clean installation and final distribution remain gates. Active Team exit composition belongs to #105; complete same-cut workspace/business backup to #108; final package/business acceptance to #109.

Development used Sol/medium coding and Sol/high coordination/review. Product-model/EDA/external-SSH calls were zero; local private Podman guest control is distinguished from external SSH. Development usage was not measured. Original/final assets, failed generations and review evidence remain retained.

Evidence root: `.hima-tmp/himateam-issue97/engine-integrator/.scratch/engine-I/`: `namespace-green.log`, `sdk-roundtrip-green.log`, `sdk-final-types.log`, `native-sdk-home-fixed/result.json`, `intermediate-reconciliation.json`, `repackage-green-result.json`, `app-connection-fixed.log`, `app-sdk-final.log`, and fixed review patches/reports. Notice evidence: `.scratch/himateam-issue97/rights-audit/`.
