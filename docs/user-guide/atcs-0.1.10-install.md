# ATCS 0.1.10: install, cold start, and rollback

> Historical delivery notes. Since the 2026-10-03 main integration, the Pack root follows the
> resident engineering development line. The original sealed 0.1.10 source is retained at
> [`legacy/0.1.10`](../../packs/agentic-timing-closure-system/legacy/0.1.10/), with its
> [snapshot explanation](../../packs/agentic-timing-closure-system/legacy/0.1.10-README.md).
> The identities and acceptance below apply only to that historical delivery.

These notes cover installing the sealed `agentic-timing-closure-system@0.1.10` Pack from the Issue #63 final
App, checking that it installed correctly, and rolling it back. The App is an unsigned local trial candidate
(ad-hoc signed, not notarized) for this station. It is not a public release.

## Identities

| Item | Value |
|---|---|
| Release source | `main` at `8fefd07341a5ea732d392539605f1d2e7ad5be87`, clean. The release commit is `082498d0` (TEST.md and VERSION.yml). |
| Pack | `agentic-timing-closure-system@0.1.10`, stage `released` |
| Method digest | `cb9d64d2596411673c97ed09f457e7b80d3542841a88f78e17e28bfb202c6683` (the same value appears in VERSION.yml `methodDigest` and in the installed digest) |
| Test record | TEST.md sha256 `526a0cf90d7fcd9e8b372f40cd7275090c044539a962faa844723d3554995fab`, Run `run-351d12f3-813f-4acb-bd15-402b27b427f7`, which ended `ended-goal-not-met` |
| Seal | VERSION.yml sha256 `2a9bcf70b029f4e9a773a7aa141a87aeb5b32aafb0b5ac3f1f30b2d3935d5e40`. It was written by `/hima-release` and never edited by hand. |
| App | `.hima-tmp/issue63-app-8fefd073-final/HimaHarness.app`, version `0.3.0-trial.34`, macOS arm64, bundled Node 24 |
| App artifact digest | `596d2cfa408a424e1a0ceb312dad360eabde6e2ea046706c33b1a06ada9ec337`; trial-manifest.json sha256 `42d98049706a1fd6827ffe1d960128d313e1455e284c44a961af311684e4a66d` |
| Site | `linglong-atcs28`: site.yml `f223e393…a6091`, permit.yml `9f04adfc…b054f` |
| Operator binding | `linglong-atcs28:xtop-operator-v9:cb9d64d259641167`, environment `linglong-atcs28:xtop-operator-v9` (sha256 `79616ea0…c631e8`) |
| Wrapper | `/data/eda/project/hima_harness/operator-admin/atcs-v9/atcs-xtop-operator-v9.sh`, sha256 `259c67b3…b9293be`. It pins adapter `d1fb9b6b…` and flow digest `e6ccfabc…`. |
| Rollback target | `.hima-tmp/issue63-app-41d8c1af/HimaHarness.app`: the same method digest `cb9d64d2…` at stage `compiled` (no TEST.md or VERSION.yml), artifact digest `94d0d4d6…5231f` |

The method digest leaves out the pipeline's own records (TEST.md and VERSION.yml). As a result, the sealed
Pack and the rollback Pack have the same digest. What separates them is the stage (`released` versus
`compiled`) and whether the two record files are present.

## Qualified tools

The Pack runs on Site `linglong-atcs28` with one licence each of Innovus, StarRC, PrimeTime and XTop
(`jobCap` 1), plus `python3` for its flow CLI (`flow/atcs_cli.py`). The only interactive tool is
`xtop-operator`. It runs through the administrator wrapper above, confined to the writable root
`/data/eda/project/hima_harness/atcs-runs`.

## Scope and claim limits

- Single worker `w01` only. Workers `w02` and `w03` cannot be reached on this graph.
- Post-route input only. Full flow and earlier APR stages are out of scope for this release.
- At most one physical refresh per Goal (`max_physical_refreshes = 1`). Once it is spent, the
  `refresh-budget` rule routes to `wait-for-person` and the Run ends there.
- **No timing benefit is claimed.** The sealing Run ended `ended-goal-not-met`: generation 4 failed
  `setup-goal`, and the hold gap of about 0.196 ns was not movable on the sequential-only candidate path.
  The seal certifies that this method, on this Site, ran end to end with a verifiable record. It does not
  certify that the method closes timing.

## Install

1. Verify the App before use:
   `node scripts/package-trial.mjs --verify <App>`, run from a checkout of the release source.
   The check compares the file inventory against the manifest and the artifact digest. It also checks
   codesign, Node 24, and the bundled seals.
2. Use a fresh, version-isolated Home. The kit builder
   (`himaharness-human-like-tester-and-bug-fixer/scripts/kit.mjs`) prepares the Home from the App. It
   then installs the Pack with `installPackMethod`, copies the Site and Permit, and re-stamps the binding
   for the installed digest. Every preflight must be `ok`:
   - `pack-digest-matches-source`
   - `pack-fits-site`
   - `binding-enforced`
   - `wrapper-pins-pack-flow`
   - `host-cold-start`
   - `home-has-no-run`
3. Read the installation back:
   - The Host's `/hima pack check agentic-timing-closure-system --site linglong-atcs28` must report `fit`
     and `stage: released (… TEST.md, VERSION.yml validate)`.
   - The installed `.hima-method-install.json` must carry digest `cb9d64d2…`.
4. Upgrading a Home that already holds this Pack goes through the Host's Pack transfer in `upgrade` mode:
   review first, then apply with the review hash. The source must be the App's bundled
   `packs/agentic-timing-closure-system`. The upgrade refuses a candidate that has no tested release.

The binding is station-scoped. Its environment file is an absolute path on this Mac (under
`.hima-tmp/atcs63-final-8fefd073/`), so keep that directory. The App cannot be handed to another machine
as it is.

## Rollback

On the Pack level, you can return an installed Home to the unsealed compiled Pack:

1. Install the previous App's bundled Pack with `installPackMethod`:
   `from = .hima-tmp/issue63-app-41d8c1af/HimaHarness.app/Contents/Resources/app/packs/agentic-timing-closure-system`,
   `to = <Home>/hima/packs/agentic-timing-closure-system`.
   - The Host's `upgrade` transfer refuses this on purpose ("upgrade candidate must have a tested release").
   - An `install` transfer refuses an existing destination.
   - The installer keeps the replaced method under `.hima-method-history` and never removes run-assets.
2. Read it back:
   - digest `cb9d64d2…`
   - `/hima pack check` reports `stage: compiled`
   - the install manifest lists 130 files
   - TEST.md and VERSION.yml are absent
3. To restore the release, apply an `upgrade` transfer from the final App's bundled Pack. Its change list
   is TEST.md and VERSION.yml. Then read back `released`, 132 files, and digest `cb9d64d2…`.

On the App level, quit HimaHarness and start the previous App on its own kit Home. Run
`package-trial.mjs --verify` on it first; it passes, with artifact digest `94d0d4d6…`. That App bundles no
operator binding, so its kit installs the binding. Because the digest is unchanged, the current binding
(`…:cb9d64d259641167`) also binds the rollback Pack.

This sequence was run on a fresh Home on 2026-09-29, with no GUI and no EDA. Every step read back as
stated above.
