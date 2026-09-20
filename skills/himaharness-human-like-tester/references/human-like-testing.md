# Human-like HimaHarness testing

## Required journey

Unless the operation manual narrows it, cover this order:

1. Start from the delivered App and ask what the product and installed Pack do.
2. Install or upgrade the exact released Pack through visible product controls.
3. Discover/review the Site and let HimaGuide prepare missing inputs.
4. Confirm one Campaign proposal once.
5. Observe the business graph, current node, background Job and evidence.
6. Exercise normal conversation while the Campaign runs.
7. Pause/intervene/resume only when the task calls for it.
8. Inspect Research, Cell Demand, generated views, commercial results and report.
9. Decide the verdict from retained evidence.

Do not follow a memorized happy-path script when the UI offers a plausible user
choice. Explore as a competent new user would, while staying within the assigned
Campaign and permissions.

## UI evidence versus diagnostic evidence

A UI claim needs UI evidence: visible controls, state text, screenshots and the
result of clicking or typing. Shell, API and source evidence may explain a UI
symptom, but cannot substitute for performing the user path.

A backend claim needs authoritative backend evidence: Ledger/Run state, exact
stage record, process/Job state, tool exit and artifact digest. UI labels may be
stale; record the disagreement instead of choosing the convenient side.

## Action discipline

- Re-observe the screen before using an old element index.
- Use visible labels and current state rather than guessed coordinates when
  possible.
- Keep HimaHarness and Catsights as the only product-control surfaces.
- Do not switch foreground displays away from the assigned secondary display.
- Preserve screenshots and recordings named by Campaign/Run and timestamp.
- Record one unconfirmed occurrence as unconfirmed; reproduce before filing a
  deterministic bug.

## Checkpoint minimum

A checkpoint records:

- cycle, Pack/App/digest and tester branch;
- Campaign, Run, owner, workspace and current node;
- running Job/session or `none`;
- last completed evidence record;
- actual Run status and UI-displayed status when they differ;
- next action and next scheduled check;
- report path and observed blockers.

## Report minimum

Lead with the verdict and exact stopping point. Then include identities, user
journey, facts versus interpretation, every failure, repro command, fix commit,
tests, evidence paths, rollback and untested scope. A report must let the
improver reproduce the issue without reading the full Claude conversation.
