# aiX UI visual acceptance

Issue: https://github.com/lluzi/hima_harness_reforge_polishing/issues/115

Baseline: `HUG-DBOS@969cf62b8ae9ac8468ee070ab64c94b497ec34bf`. Work branch: `aixui`.

## Result

The existing GUI now shares navy/ice theme aliases, Manrope and native CJK fallbacks, geometric aiX branding, currentColor SVG controls, cool surfaces and consistent selection/focus/disabled states. Native Appearance continues to own light/dark/system. The configuration pane retains usable height above memory and stacks its fields at narrow widths. Startup/error pages, window title, Dock and native package icon use the same identity; executable, bundle identifier, API and legacy HimaHarness user-data directory remain unchanged.

Screenshots are actual Electron windows on Catsights, not design mockups:

- [Before](before.png)
- [Light](light.png), [dark](dark.png), [narrow pane](narrow.png)
- [Native Appearance](appearance.png), [verified report](report.png)

## Verification

- Fresh workspace build, TypeScript, seam and boundary checks passed.
- 56 focused local contracts passed: client-style, workbench-address, reports-and-sections-view and canvas-layout.
- Three real desktop workflows passed with no skips: native branding/theme/narrow configuration, Guide/Campaign/Data Insight navigation, and conversation draft/native files/verified reports with a real local Run.
- The theme workflow was strengthened and passed again after review: actual native Light under dark OS media, actual native Dark under light OS media, shell aliases and Project surfaces agree, and composer draft survives.
- The two served-bundle registration cases reproduced `ReferenceError: document is not defined` before the guard. Both passed after the fix. The related actual Electron served-bundle case also passed 1/1. A separate whole-file registration run passed 13/13, but it overlapped the rebuild and is supplementary rather than the primary before/after evidence.
- Native icon: macOS `iconutil` decoded the generated ICNS; PNG resources span 16–1024 px. The actual packager stamping block applied to the upstream Electron plist copied exact icon bytes, selected `aix.icns`, and retained executable/bundle identities. This was a packaging fixture check, not a full signed/notarized release or live Finder acceptance.
- Two pre-existing dirty task-effects files retained the exact original patch SHA256: `e0c7efe456b64e667973bde9293b114b62113ec6e449474f3a3bf296eff98d5c`. Neither belongs to this change.

## Independent review

The actual `ce-code-review` receipt is [initial-review.json](initial-review.json), status `complete`, run `20261015-aixui-639635fb`. Its initial verdict was Not ready. Both P2 findings were fixed and received targeted read-only follow-up:

1. The browser-only CSS effect now guards absent `document`; the actual served-bundle tests remain unchanged and pass. Validator marked the original finding closed, with no increment defects.
2. The same aiX artwork now generates ICNS, is copied/referenced before package signing and is assigned to the development Dock after readiness. Adversarial reviewer marked the original finding closed, with no increment defects.

The manual native theme gap was also closed by the real desktop test. No second full review was run. Review roles: correctness, project standards, testing, maintainability and adversarial, each fresh `gpt-6.1-sol/high` context under the repository policy. No external Claude or different-serving-family corroboration. Implementation remained one writer. Requests, tokens and task-specific model cost were not measured. Tests used isolated Homes, the pinned local PostgreSQL runtime and local stand-in tasks; zero product model, SSH or commercial EDA calls.

## Merge gate

The full local regression did **not** pass. The run was interrupted after concrete failures and is not a completed full-suite result:

- ATCS source is `0.4.11` while several unchanged tests demand `0.4.0`. The unchanged method installation test additionally expects a released `VERSION.yml`, which the current development Pack does not contain. These mismatches exist in the selected HUG-DBOS source and are not repaired by issuing a fabricated release seal.
- `dbos-flow.host.test.ts` failed during input revision with `Derived task parent is terminal or released; no new business work`. Relevant backend/test files are unchanged by this UI upgrade. Its root cause has not been established, so it is not classified as a proven baseline defect.

The pre-push hook requires `pnpm run check:local`. Until that gate succeeds or the user explicitly chooses a different delivery rule, this candidate must not be represented as merged or fully qualified. Merge target remains HUG-DBOS. No data migration is required; rollback is the independent visual commit.

Raw build/test logs and native icon fixture receipt are under `.scratch/aixui/` in the working checkout.
