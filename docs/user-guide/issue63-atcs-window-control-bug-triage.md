# Issue #63 — ATCS window/control bug triage

This is a fresh-context, read-only diagnostic. It does not continue ATCS
acceptance and does not authorize a Campaign, Run, EDA Job, licence action,
mutation, pause or continue request.

## Purpose

Determine whether the prior Run-level control difficulty was a HimaHarness UI
defect or a wrong-window tester action caused by overlapping App/Code windows.

## Mandatory preflight

Follow [HimaHarness human-like test discipline](himaharness-human-like-test-discipline.md).

- Screen policy: primary macOS display, one Space, HimaHarness left 60%,
  Claude/Catsights right 40%.
- Start from zero HimaHarness main processes. The user manually stopped the old
  test; verify rather than assume.
- Use one fresh Claude session with context below 50%.
- Launch exactly one assigned HimaHarness App/Home. The coordinator must provide
  those fixed identities in `HIMA_TEST_TASK_V1` before launch.
- Record window titles and capture the side-by-side screenshot before clicking.

## Read-only diagnostic

1. Open the retained ATCS 0.1.2 Run only for inspection.
2. Record its Run id, epoch/revision and paused scope from the visible product.
3. Locate the node-level and Run-level controls without invoking either.
4. Record each visible label, inspector scope and target Run identity.
5. Determine whether the Run-level control is reachable in the clean layout.
6. Do not click Continue, do not clear a hold and do not create a successor.

The verdict is one of:

- `UI_CONTROL_PRESENT`: Run-level control is visible and bound to the correct Run;
- `UI_CONTROL_MISSING`: clean layout proves the required control is absent;
- `WRONG_WINDOW_REPRODUCED`: the earlier action targeted a stale/different window;
- `TEST_ENV_BLOCKED`: window or process identity remains ambiguous.

## Teardown

Write the report and checkpoint, quit the one HimaHarness App, verify zero main
processes, capture the clean desktop, then send `CODEX_HANDOFF_READY`. Do not
resume acceptance in the same Claude context.
