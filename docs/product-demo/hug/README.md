# HUG demo recordings: handoff

Read this before any HUG take; it replaces chat history. Use the `aix-demo-video` skill for the
recording and editing process itself. These notes are the HUG-specific inputs.

## The build (freeze; never patch between takes)

- **App:** `.hima-tmp/hug-release/app-rc3/HimaHarness.app`, packaged from tag `hug-rc3` (`d95c55ff`), the
  aiX UI and brand v2 on HUG-DBOS. It passed the packager's verification and its relocated-Host smoke
  test, and a fresh-Home launch showed the aiX lockup and home screen.
- **Packs and Sites:** use the same tag. The packager already made the source snapshot for the kits:
  `.hima-tmp/hug-release/src-rc3`.
- **Point every kit script at rc3.** Their defaults are older Apps:
  - LibInsight / MAGE: `HIMA_DEMO_APP=$PWD/.hima-tmp/hug-release/app-rc3/HimaHarness.app`;
  - PixelPack `mkkit.sh`: `APP=... SRC=.hima-tmp/hug-release/src-rc3`;
  - ATCS / AndesCell `kit.mjs`: `"app"` in the kit spec.
- **First launch in a new Home** shows the "Internal Testing Notice" (still worded "DeepSeek Harness")
  and the API-key prompt. Clear both while preparing the kit, not on camera.
- **Older builds:** `app-rc1` (`hug-rc1`) and `app-rc2` (`hug-rc2`) have the pre-aiX UI. Don't mix
  them with rc3 takes in one video. Runs started on another build don't resume on rc3.
- **If a take exposes a product bug:** fix it on `HUG-DBOS`, tag `hug-rc4`, repackage with
  `.hima-tmp/hug-release/package.sh hug-rc4 rc4`, and re-record only the affected demo. Never patch a
  packaged App or inject CSS by hand.

## The five demos

The App seeds only the Packs named in `HIMA_BUNDLED_PACKS` (README, packaged App section). Set it in
each kit's launch environment, so the Guide only sees that demo's Pack.

| Demo | Pack | Site | `HIMA_BUNDLED_PACKS` | Prep | Licence / notes |
|---|---|---|---|---|---|
| ATCS (timing closure, XTop tutorial) | `agentic-timing-closure-system` 0.4.11 | `linglong-xtop-tutorial` | `agentic-timing-closure-system` | ATCS kit from the tester skill (`kit.mjs`) | XTop: licence mode `old`. The Reader's 75-min time box applies to Goal-unmet deliveries. |
| LibInsight (QuaLib insight page) | `libinsight-analysis` 0.2.0 | `linglong-libinsight` | `libinsight-analysis` | `.hima-tmp/libinsight-embed/prepare-kit-li.mjs` | QuaLib: licence mode `new`. Ask it to read the `.lib` files live through the QuaLib API. |
| MAGE scribe placement (agent team) | `mage-scribe-placement` (the kit installs it from the snapshot) | `linglong-mage` | *(empty)* | `.hima-tmp/mage-demo/prepare-kit-team.mjs` | The user opens a MAGE licence window. Not at the same time as PixelPack. |
| AndesCell DTCO (mock EDA data) | `andes-cell-fmax` (the kit installs it) | `eda_cluster_ctu_01` | *(empty)* | Generate `knowledge/design-notes.md` with `flow/knowledge_charts.py` on the kit (git-ignored, real data). Save the Site first (`.hima-tmp/hltbf/andes-01/save-site.mjs`). | No licence. Mock EDA serving real OpenC910 values: keep the claim boundary in records. |
| PixelPack (OLED pixel layout) | `pixel-layout-optimization` (the kit installs it) | `linglong-pixel` | *(empty)* | the PixelPack session's kit | FPD licence mode excludes MAGE: separate slot. |

**Agent wrappers on Linglong.** All five Sites use the current wrapper (sha256 prefix `02a46760`), which
reports live activity to the station view:
- `operator-admin/resident-engineering-hug/` serves ATCS, LibInsight and PixelPack (deployed 2026-10-14);
- `resident-engineering-mage-team/` serves MAGE;
- `resident-engineering-ctu01-hug/` serves AndesCell.

**First takes.** ATCS, LibInsight and PixelPack have not had a live Run on this wrapper yet; their
first take is the proof. If one misbehaves, revert that Site's `site.yml`/`permit.yml` to
`resident-engineering-v1` (still deployed, unchanged) and say so in the take record.

## One style for every video

- **Live tab:** the Pack's station view (`view.yml`); every HUG Pack ships one. The "Full graph" toggle
  shows the node graph if a take needs it.
- **Wording:** "Project", not "Campaign", on screen and from the Guide.
- **Chat flow:** greeting → "what can you do" → the designer's need → name the Pack, goal and budget.
- **Recording:** app-only capture; record the App in **Dark**, so the App, the cards and the Keynote deck
  share one aiX dark theme (#101d30).
- **Edit:** every cut opens on a front card and closes on an end card with the result; data cards are
  drawn from the take's own `state/` and `reports/` and cut in, opaque and full-frame, at every milestone.
  Output is 16:9 (1920×1080). Ship all seven lengths (full / 12 min / 6 min / 3 min / 1 min / 30 s / 15 s)
  with an honest time-lapse badge.
- **Retakes:** a retake reuses the proven App and kit unchanged. Quit the App and stop the recorder when
  a take ends.
- **Data:** real customer or foundry data never goes into git, issues or hosted pages.

## Verified before freezing (on `hug-rc1`)

- **Host stand-in routes: 10/10.**
  - AndesCell: 1, reaching +1 % in one round, with both agents genuinely overlapping.
  - ATCS: 3, including the time box.
  - LibInsight: 3.
  - MAGE: 2.
  - PixelPack: 1.
- **Contract tests:** the view, reports, charts and overflow tests pass.
- **Local checks:** build, typecheck, the seams and boundary checks, and 47/47 unit tests.
- **Known, not ours:**
  - tests that pin ATCS 0.4.0;
  - one crash-replay test;
  - the desktop Refresh test, which also fails on `main`.
- **Not re-verified:** a clean full desktop-suite run. App start-up timed out while another session's
  heavy tests loaded the machine.
