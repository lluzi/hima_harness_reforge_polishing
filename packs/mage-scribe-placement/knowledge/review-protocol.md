# Review protocol

## Source

- Spec §6 ("The roles and the round protocol"), §9 (records); `flow/schemas/finding.json`,
  `request.json`, `ledger-entry.json`, `decision-request.json`; `flow/mage_placement_cli.py`
  (`evaluate`, `review`, `candidate` subcommands); `flow/mage_placement/rounds.py` (`decide`).

## Workspace

Every CLI call's `WORKSPACE` is your own private task workspace (the envelope's `workspace`), never
the read-only `identity.campaignWorkspace` — see `placement-playbook.md`'s "Workspace convention".

## Applies when

Every round, for the Engineer answering the previous round's Requests and for every consumer
filing this round's Findings and Requests.

## The four steps, in order

1. **Engineer delivers.** Reads `state/round-decision.json` (round k−1's open Requests, best state
   so far, Decision Requests), runs one MAGE round, assembles `mage.placement-candidate/1` with
   `candidate`, and writes a `mage.ledger-entry/1` for **every** open Request from round k−1:
   `satisfied`, `alternative`, or `declined`, each with evidence.
2. **Each consumer reviews.** Reads the current candidate's own snapshot and native verify files
   (never a prior round's), runs `evaluate` under its own consumer model, and files Findings and
   Requests. A consumer never edits the layout, a rule file, or any consumer model — it only reads
   and reports. **If the candidate's `outcome` is `blocked`** (a failed attempt that produced no
   snapshot), the consumer runs `review` with **no** findings file and does **not** run `evaluate`:
   the result is an empty review (zero Findings/Requests, `candidateOutcome: blocked`) bound to the
   candidate id, which the Reader accepts without reading a snapshot and `decide-round` treats as
   `continue` while a round remains.
3. **`decide-round` joins.** (Program code, not a resident role.) Checks every open Request has a
   Ledger answer, updates the best measured state, turns conflicting Requests (one consumer's
   `move`/`place` against another's `keep`) into Decision Request options with every consumer's own
   numbers, and routes `continue` or `stop`.
4. **No voting; hard requirements are never traded.** `unknown` stays `unknown`. A Decision Request
   travels in the delivery; there is no mid-task way to ask a human. A user message naming a
   Decision Request's `id` during the Run counts as its decision.

## Record shapes, each with one real example

**Finding** (`mage.finding/1`) — one per requirement x affected scope, from `evaluate`, never
hand-written:

```json
{"schema": "mage.finding/1", "id": "F-wat-3", "round": 1, "snapshotSha256": "<candidate sha>",
 "consumer": "wat", "consumerModel": "wat@0.1.0", "evaluatorReceipt": "<receipt sha256>",
 "targets": ["KEY_V.KEY_V"], "predicate": "placed", "status": "fail", "severity": "hard",
 "numbers": {"blockType": "TSK/MPAD"}, "explanation": "KEY_V.KEY_V is still pending (not placed)"}
```

**Request** (`mage.request/1`) — one per hard-fail Finding you want acted on; you author this one
yourself (`requestedOutcome`/`acceptableAlternatives`/`strength`), then `review` stamps its `schema`
and a per-consumer, round-scoped sequence `id` (`R-<consumer>-<round>-<n>`, e.g. `R-wat-2-1`, so
neither one Run's four reviews nor the same consumer across rounds ever collide):

```json
{"fromFinding": "F-wat-3", "consumer": "wat", "snapshotSha256": "<candidate sha>",
 "requestedOutcome": {"kind": "place", "targets": ["KEY_V.KEY_V"], "limitsUm": {},
                       "text": "place KEY_V"},
 "acceptableAlternatives": [], "strength": "hard"}
```

**Ledger entry** (`mage.ledger-entry/1`) — the Engineer writes one per open Request, passed to
`candidate --ledger <file>`; `request` names the Request's full round-scoped id (`R-<consumer>-<round>-<n>`),
so answering litho-pie's request never silently answers wat's:

```json
{"schema": "mage.ledger-entry/1", "id": "L-1", "request": "R-wat-2-1", "answer": "declined",
 "answeredInSnapshot": "<this round's candidate snapshot sha>", "evidence": [],
 "note": "capacity-limited; KEY_V stays dropped this round"}
```

**Decision Request** (`mage.decision-request/1`) — written by `decide-round`, never by a resident
role; you only ever read one, never author it:

```json
{"schema": "mage.decision-request/1", "id": "D-3-1", "round": 3,
 "question": "litho-pie wants OVL_B moved onto its CT target; wat's rigid-unit requirement forbids the only feasible slot",
 "options": [{"id": "O-1", "description": "move OVL_B, accept wat's rigid-unit fail",
              "perConsumer": {"litho-pie": {"targetDistanceUm": "0"}, "wat": {"rigidUnitFailCount": 1}},
              "nativeChecked": true, "snapshotSha256": "<option candidate sha>"}],
 "blockingRequests": ["R-litho-pie-1", "R-wat-1"]}
```

## Worked round (abbreviated; the real numbers come from `evaluate`/`candidate`, never hand-copied)

Round 1: OVL_B sits 150 µm off its CT target and KEY_V stays dropped. `review-litho-pie` runs
`evaluate --consumer litho-pie ...`, gets a hard-fail Finding on OVL_B's `target_distance`, and
authors a `move` Request. `review-wat` gets a hard-fail Finding on KEY_V's `placed` and authors a
`place` Request. `decide-round` sees two open Requests and routes `continue`.

Round 2: the Engineer moves OVL_B onto its CT target (satisfied in the Ledger) but KEY_V stays
dropped for a capacity reason already explained (declined in the Ledger). `review-litho-pie`'s
Finding now passes, so it files no new Request. `review-wat`'s Finding still fails mechanically, but
with nothing new to add it need not re-file an identical Request. `decide-round` sees zero open
Requests and routes `stop`.

## Round-numbered support paths

Every round's support files are immutable once published, under the resident's own
`artifactPrefix`: the Engineer's own round material lives at `placement/round-NN/` (its `candidate`
subcommand reads `--round-dir placement/round-NN/`); each consumer's evaluator receipt and requests
file live at `reviews/<role>/round-NN/`. Never reuse or overwrite a previous round's directory; a
repair to a rejected delivery edits only the round's own result document (`state/round/...`), never
a published support file.

## Delivery: list only your own output

`resident-delivery.json` lists exactly one `kind: "result"` artifact (your result document, named
by its WORKSPACE-relative path) plus `kind: "support"` entries only for files you yourself wrote
under your own `artifactPrefix` — `reviews/<role>/round-NN/…` for a consumer (your evaluator
receipt/findings file, your requests file), `placement/round-NN/…` for the Engineer. Never list an
input you merely read or copied as a support artifact — the candidate document, its
`snapshot.json`, `state/round-decision.json`, `state/case-readiness.json`, or any knowledge file:
these already exist in the Campaign workspace under someone else's prefix, and the Host's
`materializeEngineeringResult` refuses the whole delivery, leaving the Run waiting with no message
back to you, the moment one support path falls outside your own `artifactPrefix`.

A correct consumer example (litho-pie, round 2):

```json
{"schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
 "summary": "...", "stopReason": "...",
 "artifacts": [
   {"path": "state/round/review-litho-pie.json", "sha256": "<...>", "kind": "result"},
   {"path": "reviews/litho-pie/round-02/findings.json", "sha256": "<...>", "kind": "support"},
   {"path": "reviews/litho-pie/round-02/requests.json", "sha256": "<...>", "kind": "support"}
 ]}
```

A correct Engineer example (round 2) — never fewer than every file the round produced under
`placement/round-02/`, and never an input such as `state/start-snapshot.json`:

```json
{"schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
 "summary": "...", "stopReason": "...",
 "artifacts": [
   {"path": "state/round/placement-candidate.json", "sha256": "<...>", "kind": "result"},
   {"path": "placement/round-02/candidate.pla", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/round.tcl", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/session.jsonl", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/round-summary.json", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/out/export.pla", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/out/snapshot.json", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/out/verify-OVERLAP.txt", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/out/verify-SPACE.txt", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/out/verify-BOUNDARY.txt", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/out/summary.txt", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/out/stdout.log", "sha256": "<...>", "kind": "support"},
   {"path": "placement/round-02/out/stderr.log", "sha256": "<...>", "kind": "support"}
 ]}
```

## Consumer prohibitions

A consumer role may never: edit the candidate layout, the rule file, the target table, any consumer
model, the Goal limits, or any other consumer's review; hold a MAGE licence; hand-write a Finding's
`numbers` (every Finding must trace to an `evaluate` run's own evaluator receipt); or re-file an
identical, already-declined Request with nothing new to add.
