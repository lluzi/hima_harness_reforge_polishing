# Live check: the model moment, 2026-09-11

One real model turn through the product, with a key from the launching environment (35 characters, beginning "sk-b").
HimaHarness on DeepSeek Harness 0.1.5-alpha.1 (Node v24.20.0), driven through the desktop shell in driver mode with **no replay overlay**: the host composed its own DeepSeek adapter.

**PASS** — 10 of 10 checks passed.

## What ran

- Run `run-7729af51-2e37-4011-9314-eb24b76657b5` of the `opene902-timing-probe` pack on site `local`, one generation, standing at node `next-period`.
- Moment: preset `hima-moment`, session `session-5ef7cc71-a18c-4953-a885-0f19364e5475`, model `deepseek-v4-flash`, tools [].
- Instructions: `Answer with exactly the word READY. Say nothing else.`
- The model answered: `The user is asking me to answer with exactly the word READY. There's a mention of an approval policy changing from "ask" to "never" — that's a system-level note, likely indicating I should just comply. The instruction is clear: answer with exactly the word READY, nothing else.READY`

## The records

```json
[
  {
    "id": "run-7729af51-2e37-4011-9314-eb24b76657b5#000017",
    "runId": "run-7729af51-2e37-4011-9314-eb24b76657b5",
    "siteId": "local",
    "seq": 17,
    "at": "2026-09-11T07:38:51.113Z",
    "writer": "executor",
    "generation": 1,
    "type": "session",
    "preset": "hima-moment",
    "sessionId": "session-5ef7cc71-a18c-4953-a885-0f19364e5475",
    "model": "deepseek-v4-flash",
    "nodeId": "next-period",
    "attempt": 1,
    "event": "opened",
    "tools": []
  },
  {
    "id": "run-7729af51-2e37-4011-9314-eb24b76657b5#000018",
    "runId": "run-7729af51-2e37-4011-9314-eb24b76657b5",
    "siteId": "local",
    "seq": 18,
    "at": "2026-09-11T07:38:52.689Z",
    "writer": "executor",
    "generation": 1,
    "type": "session",
    "preset": "hima-moment",
    "sessionId": "session-5ef7cc71-a18c-4953-a885-0f19364e5475",
    "model": "deepseek-v4-flash",
    "nodeId": "next-period",
    "attempt": 1,
    "event": "closed",
    "outcome": "completed"
  }
]
```

## The home, read afterwards

- 99 files read under `$DSH_HOME`, the window's user-data directory and the workspace.
- Files holding the key: [].

The key came from the launching environment. HimaHarness writes no credentials file and no env file, reads a key by no path of its own, and no record above carries one.

## Checks

| Claim | Predicate | Saw | |
|---|---|---|---|
| the moment route answered | `POST /hima/api/runs/<id>/moment answers 200` | `200 {"sessionId":"session-5ef7cc71-a18c-4953-a885-0f19364e5475","model":"deepseek-v4-flash","tools":[],"text":"The user is asking me to answer with exactly the word READY. There's a mention of an appr` | PASS |
| the model followed the instruction | `the answer contains "READY"` | `"The user is asking me to answer with exactly the word READY. There's a mention of an approval policy changing from \"ask\" to \"never\" — that's a system-level note, likely indicating I should just c` | PASS |
| the model is the profile's default | `the session's model is deepseek-v4-flash` | `deepseek-v4-flash` | PASS |
| the session reached no tool | `the tool list dsh reports for the session is empty` | `[]` | PASS |
| the answer names dsh's own session | `the session id begins "session-"` | `session-5ef7cc71-a18c-4953-a885-0f19364e5475` | PASS |
| the ledger holds the pair that brackets the moment | `exactly one opened and one closed record` | `["opened","closed:completed"]` | PASS |
| both records name the moment's own session, preset and model | `sessionId === session-5ef7cc71-a18c-4953-a885-0f19364e5475, preset === hima-moment, model === deepseek-v4-flash` | `[{"sessionId":"session-5ef7cc71-a18c-4953-a885-0f19364e5475","preset":"hima-moment","model":"deepseek-v4-flash","nodeId":"next-period","attempt":1,"generation":1},{"sessionId":"session-5ef7cc71-a18c-4` | PASS |
| the scan read the home rather than nothing | `more than fifty files were read` | `99 files` | PASS |
| the key reached no file the run wrote | `no file under the home holds the key` | `[]` | PASS |
| the harness wrote no env file | `no .env exists under the home` | `[]` | PASS |

