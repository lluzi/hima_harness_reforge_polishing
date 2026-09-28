# ATCS original post-route baseline receipt (Issue 63)

The user corrected the ATCS test baseline. The next ATCS test starts from the original post-route
Innovus state, `postroute_final`, not from the twice-optimized `xtop_round2_eco_route` state. The
original first-round XTop ECO flow restores `restoreDesign ./DBS/postroute_final.enc.dat swerv_wrapper`.

**Foundation root (read-only, never written):** `/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation`

**New Site input:**
- File: `/data/eda/project/hima_harness/atcs-inputs/designStateManifest-postroute-final.json`
- Repository template: `sites/linglong-atcs28/inputs/designStateManifest-postroute-final.json`
- Previous input: `designStateManifest.json` (round-3 state). It is unchanged and no longer bound.

## Identities verified on 2026-09-28 (read-only SHA-256)

| File | SHA-256 |
| --- | --- |
| `DBS/postroute_final.enc` | `79d098156f87a6ecdfc6a3591ac20b9e9533091409b9dbf8cd09fcaa1f70bc9d` (1) |
| `DBS/postroute_final.enc.dat` tree digest (2) | `e86ef476761e162d2601c39ed4effc82331d2ea0feb4fd82ae662a4b0b78cfbe` (57 files) |
| `EXPORT/swerv_wrapper.postroute.v` | `6c9ed3189d9012a29229af594c22f230818e40b52bb3f307cb66ae07dc812e86` |
| `EXPORT/swerv_wrapper.postroute.def` | `73e25dc78bb761de2ab2636ed25dead880f4e6761b41f41cc54d4941ebd6192b` |
| `EXPORT/swerv_wrapper.input.sdc` | `47b51fc7a7f2ea572c78cbd48645ded06c8b21f016ae8ea6e4ca541232f9b565` |
| `SIGNOFF/STARRC/swerv_wrapper.cworst_T.spef` | `c4f610b1354c91c7c60290926efbc2be485f6fcdb089cc7a640521542c5c3cd6` |
| `SIGNOFF/STARRC/swerv_wrapper.cbest.spef` | `3fc820b3a7c8e15413cc225cf1498fa80cabd214995dfd5a35f7cb9760845d7b` |

(1) The value in the user's brief ends `…70bc9`, which is 63 hex digits. The full hash ends
`…70bc9d`; the only difference is that final `d`.

(2) The tree digest is ATCS `core.tree_digest`: the SHA-256 of the canonical JSON list of
`{path, size, sha256}`. Plain `find | sha256sum` recipes give different values.

## Original PrimeTime evidence

From `SIGNOFF/PT/reports/<scenario>/global_timing.rpt`, in ns:

| Scenario | Setup WNS / TNS / NUM | Hold WNS / TNS / NUM |
| --- | --- | --- |
| func_ssg_rcworst_m40 | -0.16 / -15.42 / 281 | -0.20 / -274.53 / 5675 |
| func_ssg_rcworst_125 | -0.09 / -2.76 / 86 | -0.18 / -180.65 / 4587 |
| func_ffg_cbest_m40 | none reported | -0.08 / -41.65 / 3490 |
| func_ffg_cbest_125 | none reported | -0.09 / -44.09 / 2514 |

The worst values match the user's expectations: setup WNS about -0.16, hold WNS about -0.20,
setup TNS about -15.42 and hold TNS about -274.53, all from `func_ssg_rcworst_m40`.

## Baseline gate for the new Campaign

Before any XTop ECO, the Run's own reader-backed baseline PrimeTime observation must match these
values per scenario, within report-precision rounding. A material difference is an identity
mismatch and stops the test. XTop internal estimates never count as convergence. Only refreshed
PrimeTime runs on the implemented database and newly extracted SPEF count.

## Installed and validated

- The server file SHA-256 is `b3b9893ee3506f5fd2ee41445f7e1980cc820a4a07d25f9e8d2f95a4803e3fdc`, mode 0444, written as
  a new file. No existing input was overwritten.
- The Pack 0.1.4 `input_readiness` reports `missingCount` 0 and scope `post-route-only`. The design-state id is
  `320aae0af7a5e94c72e6`.
- `sites/linglong-atcs28/site.yml` now binds `designStateManifest` to the new file, which changes the Site
  identity. The Pack, wrapper, verifier and Site profile bytes are unchanged.
