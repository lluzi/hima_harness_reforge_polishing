# Trial.16 — Pack 5.2.1 still cannot read its own residual research document

Date: 2026-09-20
Author: Claude (HimaHarness trial.16 Campaign operator)
Branch: `agent/hima-trial-bugfix-v16`
Worktree: `/Users/lluzi/code/hima_harness_agent_trial_fix_v16`
Fix commit: `d06d3e42333f0a63763497903948dbe5c7bed900` (pushed; remote SHA verified)
Base: `1cdaa4b6456f072ac768b64f1f981dea56729197` (= `origin/main` at the time of the Trial.16 install)

## 1. What happened

The run `run-19769586-9d6a-457d-bab9-1c5813657c1f`
(Campaign `custom-cell-fmax-dtco-20260920-040652-6870`, Pack
`custom-cell-fmax-dtco` 5.2.1, digest
`5c6a86445128e05f464399ac9c0ecf3ec95e4af182d37f15d83c8058465067c2`) completed the
whole licence-free first generation — bind-inputs, baseline evaluation, six miners,
six Readers, `merge-join` PASS, F0/F1 evaluation, and the `research-candidates`
Workshop on its first attempt (50 proposals, 10 `onsite-inspiration`,
program sha256 `b16d26f121967597cd353ea03f5d378273385b709b517f44580adf279d2ddfe0`,
document sha256 `ec63ebeb60183fd2f8c89aa78ab14eefa0799f3c57accdb9c6adb137c2cf1a9e`) —
and then died at `read-research-selection`, the same node that stopped 5.2.0.

Reader Job `hima-19769586-reader-read-ai-research-selectio-a13234` exited **1**:

```
File ".../flow/read-stage.py", line 1557, in read_residual_ai_research
    normalized = validate_residual_research_proposal({
File ".../flow/ai_research_runner.py", line 1238, in validate_residual_research_proposal
    raise ValueError(
ValueError: residual research must return lenses, candidate_program, feedback_interpretation and stop_reason
```

## 2. Root cause

`flow/read-stage.py` (and its byte-identical mirror `tools/read-stage.py`) re-validates
the **published document's** creative fields:

```python
normalized = validate_residual_research_proposal({
    "research_lenses": document["research_lenses"],
    "candidate_program": document["candidate_program"],
    "stop_reason": document["stop_reason"],
}, context)
if any(normalized[key] != document[key] for key in normalized):
    raise ValueError("residual AI research proposal is not canonical")
```

`validate_residual_research_proposal` requires exactly four keys —
`research_lenses`, `candidate_program`, `feedback_interpretation`, `stop_reason` —
and the call passes three. The writer (`run_residual_research`) never puts a
top-level `feedback_interpretation` in the document; it keeps the text in
`feedback_ab["interpretation"]`. The following canonicality loop would also have
raised `KeyError` on `document["feedback_interpretation"]`.

So 5.2.1 moved the failure exactly one check later than 5.2.0: the 5.2.0 Reader
died at the field-set gate (missing `feedback_ab`), and the 5.2.1 Reader dies at
the proposal re-validation. No document produced by this Runner can ever satisfy
this Reader.

**Why the 5.2.1 fix looked green.** Its regression test
(`flow/domain/tests/test_residual_research_document_contract.py`) asserts that a
document carrying `feedback_ab` "reaches the deeper checks"; it never asserted
that the Reader *accepts* the document (exit 0). The defect sat one assertion
deeper than the test.

## 3. Change (minimal, Reader side only)

```python
    feedback = document["feedback_ab"]
    if not isinstance(feedback, dict) or not isinstance(feedback.get("interpretation"), str):
        raise ValueError("residual AI research feedback interpretation is absent")
    normalized = validate_residual_research_proposal({
        "research_lenses": document["research_lenses"],
        "candidate_program": document["candidate_program"],
        "feedback_interpretation": feedback["interpretation"],
        "stop_reason": document["stop_reason"],
    }, context)
    for key in ("research_lenses", "candidate_program", "stop_reason"):
        if normalized[key] != document[key]:
            raise ValueError("residual AI research proposal is not canonical")
```

Files: `packs/custom-cell-fmax-dtco/flow/read-stage.py`,
`packs/custom-cell-fmax-dtco/tools/read-stage.py` (kept byte-identical),
plus the new regression test.

No graph, generation algorithm, electrical model, EDA method, schema or budget is
touched. The writer is unchanged.

## 4. Red / green evidence

**Red — the Run's real failing bytes.** The exact `research.json` this Campaign
produced (`ec63ebeb…`) plus the real staged `flow/` were copied read-only to
`Trial Workspace/step3-failure-scene/` and replayed through the pristine 5.2.1
Reader in a throwaway local workspace: **exit 1**, the identical `ValueError`.

**Green — the same bytes through the fixed Reader.** With only the change above:
**exit 0** and

```json
{"values": [{"type": "research_hypothesis_count", "unit": "count", "value": 7},
            {"type": "selected_count", "unit": "count", "value": 50},
            {"type": "onsite_inspiration_selected_count", "unit": "count", "value": 10},
            {"type": "retained_candidate_count", "unit": "count", "value": 0},
            {"type": "theoretical_gain_upper_pct", "unit": "percent",
             "unknownReason": "residual research does not estimate commercial gain", "value": null}]}
```

**Regression test.** `flow/domain/tests/test_residual_research_reader_round_trip.py`
drives the real writer and then the real Reader over the produced bytes.
It **fails** on the pristine 5.2.1 Reader with the Campaign's exact error and
**passes** after the change.

**Relevant low-cost subset (all rc=0 after the change):**
`test_residual_research_reader_round_trip.py` (new),
`test_residual_research_document_contract.py`,
`test_ai_residual_research_context.py`, `test_lfr_pack_reader.py`,
`test_pack_lfr_stage_adapter.py`, `test_abstract_cell_v5.py`,
`test_drive_family_and_mock_liberty.py`.

## 5. Boundary respected

* `main` is untouched (still `1cdaa4b`); no tag, no release, no merge, no rebase.
* Only `agent/hima-trial-bugfix-v16` was pushed.
* The Run was **paused** (`paused: ["*"]`, revision 65) at the failure boundary
  before any source change; its staged workspace, `research.json`, `entry.py`
  (sha256 `bbb66c46289a04c694f63950489328d718739a9cd5bcf5cd36efd75778c73e5b`),
  Job log and exit marker are preserved unchanged.
* Trials 13/14/15 Runs were not touched.

## 6. What is needed from the integrator

1. Integrate `d06d3e4` (or an equivalent fix) into `main`.
2. Release it as a **new Pack version** (5.2.2 or later) with a native seal and a
   test record that asserts the *round trip*, not the field-set gate alone.
3. Return the new Pack version/digest and the continuation instruction; the
   paused Run is pinned to 5.2.1 and cannot be resumed onto a new method digest,
   so Trial.16 needs one new Campaign on that version.

The Run's remaining work after this gate is already proven reachable: the
Workshop's 50 typed Cell Demands are on disk, so `merge` →
`generate` → `layout` → `characterize` (the five-drive family and
`mock-liberty-calibration.json`), then the bounded LC/DC check and the matched
P&R pair, are the next steps.
