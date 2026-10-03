# Issue #83: ATCS repairs Timing; evaluation compares externally

The human corrected the responsibility boundary: HimaHarness uses ATCS to fix
Timing. The external evaluator compares separately retained actual results with
Serial AutoFix. Product Goal, Campaign owner and FL user requests must not acquire
that benchmark responsibility.

## Change from d0a66377 / ATCS 0.3.2

ATCS 0.3.3 removes the mandatory serial-reference node, tool declaration, output,
outsourcing input, Reader reference/effect values and beats-AutoFix Goal rule.
The existing common-R1 preparation remains an actual initial AutoFix repair step;
native AutoFix remains available to the engineer as a repair tactic. The result
Reader requires the same task/delivery, fixed inputs, raw before/selected timing,
checkpoint, scripts/ECO and reproduction evidence. Its regression classification
uses the method's unchanged fixed 0 ns setup/hold targets, independently of any
external reference. Known regressions and unknown collateral remain visible;
best effort and no-op retain their original evidence requirements.

The effect comparator moves into the existing `flow/tests` evaluation materials.
It reads the verified product result and an independently rooted reference,
checks exact input/R1 identity, targets and raw before/after reports, and never
writes a product fact. Reference strategy strength and execution fairness remain
an external evidence-review responsibility; numerical comparison does not prove
them. The existing serial producer is retained only as a historical/external
helper, absent from production declarations. Tests/evaluation code is not copied
into the Campaign flow.

Harness, App, Site and wrapper code are unchanged. Frozen r5 and its admitted
0.3.2 Run are not patched. A read-only check verified r5's original Pack digest
and manifest, including its historical benchmark graph; no live Home was opened.
Historical methods use their own preserved bytes. Reverting this commit restores
the previous source method without rewriting any Run or raw artifact.

## Verification

Evidence: `.hima-tmp/issue83-product-scope/` in the source worktree.

- Initial negative fixture: product reading failed without an external reference,
  demonstrating the undesired dependency.
- Python Reader/evaluator: 16/16 PASS. Covers absent/unrelated reference,
  legitimate no-op, residual and mixed effects, missing/forged timing, retained
  UNKNOWN, independently derived known regression, external wrong identity,
  tampered reference and mismatched external targets.
- Current Pack load/declarations: 1/1 PASS.
- Public Host delivery/ending: 4/4 PASS with no reference file. Covers actual local
  production-wrapper delivery, best effort, narrow target success with UNKNOWN,
  residual refusing goal-met, and broader regression remaining FAIL.
- Independent review identified an external-evaluator target gap: caller and
  reference could agree on a different target. A failing fixture reproduced it;
  the helper now refuses targets other than this product method's fixed targets.
  Finding-only recheck is recorded in the local review note.

DL uses the user-selected Astra/high. Independent review was dispatched to fresh
Sol/high; applied child settings are not independently observable. Product model
and commercial EDA calls: zero. Requests/tokens/cost are unmeasured. No new App
build, GUI, deployment or live Run was performed for this Pack-only correction;
the unchanged App's prior qualification remains scoped to those bytes. Whole
test-project typecheck was not rerun; its previously recorded 16 baseline
diagnostics are not presented as a pass. Actual 0.3.3 product acceptance remains
pending a serial field handoff.

The current FL had received privileged implementation/benchmark context. Its
measured behavior remains evidence of developer-informed operator validation,
not cognitively isolated independent acceptance. Future user-facing handoffs
contain only the task, normal entry, declared environment/permissions and visible
outcome. Evaluator criteria and developer diagnosis stay with DRI/DL. This note
does not dispatch a new operator session or Run.
