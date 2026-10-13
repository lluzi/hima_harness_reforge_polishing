# MAGE script-method test-structure placement 0.1.0 test record

## L1 — Pack-local unittest on synthetic fixtures

`cd packs/mage-script-placement && /usr/bin/python3 -m unittest discover -s flow/tests -t flow`

148 tests passed before this Task's additions (Tasks 1–7's driver, Reader, rules, schemas and
fixtures). This Task (8) added `flow/tests/test_knowledge.py` (7 tests: every `contract.yml`-named
knowledge file exists and is flat-named, no placeholder text remains, the top-level `knowledge:`
table equals the `engineer-script` tool's own `outsourcing.knowledge` union, the Engineer's five
files stay under the 12,000-word budget, every CLI subcommand/flag a knowledge file names is real
(including the checker's own negative self-test), and every `state/...` path named is a declared
`contract.yml` output or a `state/history/round-NN/...` archive path). Current total:

```
Ran 155 tests in 5.943s

OK
```

No skips, no `--pattern` narrowing. Python 3.9.6 (Mac, `/usr/bin/python3`); the Linglong resident
container's own Python 3.8.16 has not yet been checked for this Task's additions (test code is
written to the 3.8-compatible standard-library-only constraint: no f-string syntax beyond 3.8, no
`match` statements, no walrus-dependent control flow).

## L0/L2 — Host contract test (pending)

Not run by this Task. Expected command, once the Host contract test exists:
`pnpm run build && pnpm run test:local -- --files test/contract/mage-script-placement.test.ts`.

## L2 dry route (pending — Task 9)

Not run by this Task. Expected command, once `test/contract/mage-script-placement-durable.host.test.ts`
and its stand-in ACP Engineer/MAGE fixtures exist: registered in `test/contract-groups.json`'s
`atcs-dry` group, run via `node scripts/run-contract-tests.mjs atcs-dry --files
test/contract/mage-script-placement-durable.host.test.ts`. This will prove the Harness/Pack wiring
(rounds, task counts, one Reader Job per resident execution, journal entries, `goalMet`) against a
stand-in MAGE interpreter that accepts this Task's own round-1 baseline script verbatim — not MAGE's
own behaviour.

## L4 (S2) — native qualification (pending — Tasks 10, 12, 13)

Not started. Needs the permanent MAGE licence server, a stamped Site manifest version carrying
`referenceMethod`/`referenceFiles`/`referenceNotes`, and the user's own live, watched Run before any
D-status command in `knowledge/mage-capabilities.md` can move from documented to qualified, and
before the knowledge's exact Tcl command text (the four reference-method stages, the two known
failure signatures, the compatibility repairs) can be confirmed against the real build rather than
only against the Pack's own code.

## No model, no EDA

Every test in this Task's own work (`test_knowledge.py`) runs with `/usr/bin/python3` against the
Pack's own `contract.yml` and `flow/mage_placement_cli.py` source text — no model call, no licensed
MAGE binary, and no GUI ran anything recorded in this Task.
