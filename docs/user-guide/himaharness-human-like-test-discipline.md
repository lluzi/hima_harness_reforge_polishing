# HimaHarness human-like test discipline

Status: mandatory for every Desktop trial after 2026-09-28.

## Objective

Produce evidence about one released App/Pack through one unambiguous human-like
test surface. Window placement, process identity and teardown are test gates,
not presentation preferences.

## Fixed two-display test surface

- **Catsights external display:** the only active HimaHarness window, fully
  contained on that physical display.
- **Mac primary display:** Claude Desktop, Codex, Code, Terminal and report
  editors. These windows never overlap or enter Catsights.
- **Physical collaboration:** the two displays sit side by side; Catsights is
  the product-operation surface and the Mac primary display is the
  coordination/development surface.
- **Instances:** one HimaHarness main process, one HimaHarness window, one Claude
  tester session, one Catsights observation surface.
- **Identity:** the checkpoint records App path/version, Home, kit, Pack digest,
  Site and visible window title before the first click.

Before any product action, the tester captures Catsights showing the complete
HimaHarness window and records a two-display window inventory. HimaHarness on
the primary display, any coding window on Catsights, or an ambiguous/stacked
target is `TEST_ENV_BLOCKED`; no product verdict may follow from it.

## Context discipline

- Use a fresh Claude session for each released candidate or bug-reproduction
  objective.
- Invoke `/himaharness-human-like-tester` and wait for the active marker before
  sending the task envelope.
- Do not reuse a compacted test conversation. Do not start a new trial when the
  session context is already above 50%.
- One turn may inspect and advance one recorded Campaign. A turn ending never
  creates another Campaign.
- Stop on the first deterministic defect. The tester writes the symptom and
  handoff; the improver performs diagnosis and fixes in main.

## Process preflight

Before launch:

1. verify no HimaHarness main process remains from a previous test;
2. verify no licensed EDA Job or interactive lease belongs to the intended new
   trial;
3. launch the exact assigned App once with the exact assigned Home;
4. verify one main process and one window;
5. move that window fully onto the Catsights external display;
6. capture Catsights and record the two-display inventory.

Electron helper processes are expected and are not separate App instances.
Multiple main executables, windows with different kits/Homes, or an unknown
window identity fail preflight.

## Test execution

- Claude alone clicks HimaHarness and Catsights.
- The improver reads checkpoints and retained evidence; it does not operate a
  competing product window.
- Visible controls are used only after the target window identity is confirmed.
- A control action records the window title, Run, epoch/revision, requested
  scope and returned receipt.
- A wrong-window or wrong-scope click is a tester defect. Preserve it, remove it
  from the product verdict and restart only after a clean test surface exists.
- Shell/source reads can diagnose a preserved symptom. They cannot replace a
  failed GUI action or mutate the Run.

## Teardown

Every test ends with the same sequence, including blocked or manually stopped
tests:

1. write report, checkpoint and `CODEX_HANDOFF_READY` marker;
2. record active Job/lease state without killing it;
3. close the assigned HimaHarness window and quit the assigned App normally;
4. verify zero HimaHarness main processes for the assigned Home;
5. capture the clean desktop/process result;
6. keep Campaign, Run, Ledger and evidence unchanged.

A trial is not complete while its HimaHarness App remains open. The next trial
cannot start until teardown is proven.

## Minimal verdicts

- `PASS`: required user path and teardown passed.
- `FAIL`: a verified product behavior contradicted the task.
- `BLOCKED`: an external or product gate prevented the required path.
- `TEST_ENV_BLOCKED`: screen, window, process or context identity was ambiguous.

`TEST_ENV_BLOCKED` never becomes a product bug or Pack verdict.
