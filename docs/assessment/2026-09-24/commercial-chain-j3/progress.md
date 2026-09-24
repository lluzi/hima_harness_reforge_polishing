# #55 -> #59 -> #50 -> commercial chain -> #61 J3 progress

Date: 2026-09-24. Source: `81142134d08a2e0abb0c5f40b311cded262721ab` on `main`.

This record separates completed evidence from the one administrator gate that stopped the commercial chain. It does not promote a development Pack, claim timing closure, or count a partial chain as J3.

## #55 current-source precheck

The current source passed the minimum falsifying set before the commercial run:

- `pnpm run build`;
- local Host/Judge/XTop files: 25 passed, 0 failed, 0 skipped;
- `packs/xtop-timing-closure/flow/tests/test_closure.py`: 31 passed.

The run used a new private control-arm workspace:
`/data/eda/project/hima_harness/xtop-timing-closure-runs/qualification-v109-20260924-1535`.
It did not resume, copy from, or modify trial30. The staged `closure.py` SHA-256 is
`64b06c97a08383635b63d63fdbf14377ef2425114ebb2059f99a22e23e3a331b`.
Preparation verified 27 Foundation source files and copied the Site-bound input checkpoint to the private workspace. The input database tree identity is
`a29e4d036db10c87e2427a42d69cfbe573a44ebbe80d983b74e2f9a530a79f11`.

### Fresh baseline chain

The following stages completed from the new workspace:

| Stage | Result | Retained facts |
| --- | --- | --- |
| Innovus restore/export/physical checks | passed | routed DEF `47fca89e...3e1`; netlist `a762b91f...569`; DRC 72,799; connectivity 3,465 |
| StarRC | passed | `cworst_T` SPEF `f4a3270f...49e`; `cbest` SPEF `40a01364...f74` |
| PrimeTime | passed | four declared scenarios, four retained logs |
| closure-state summarize | passed | 153 named violating endpoints; three unconstrained endpoints |

The physical reports use `verify_drc -limit 1000000` and
`verifyConnectivity -noAntenna -error 1000000`; both totals are below the declared limits and every listed error is retained. This proves complete baseline coverage for the Pack's relative-adoption rule. It is not clean signoff: the starting database itself has 72,799 DRC and 3,465 connectivity findings.

Fresh baseline metrics are setup WNS/TNS `-0.04/-0.12 ns` with 12 violations and hold WNS/TNS `-0.16/-8.86 ns` with 221 violations. Closure score is 243.58. The control-arm plan was frozen before XTop dispatch as SHA-256
`d864beb5c544978d0322bc3e6749f3d17c11de387b01ad144f673b6a68dd024f`; it selects one high-effort hold-buffer action on the three largest measured hold families with a 0.02 ns setup margin.

### Administrator stop

Before XTop, the Site reported `selected=new old=inactive new=active`, and no `qualib_exe` or `icexplorer-xtop_exe` client was active. The required switch to the mutually exclusive XTop service was attempted only through the Site owner's `/usr/local/bin/empyrean-license old` guard. The guard reached `sudo`, which refused the non-interactive SSH session because no terminal/password was available. No service changed: a postcheck still reported `selected=new old=inactive new=active` and no active client.

The commercial chain is therefore stopped before its first XTop process. The completed baseline, frozen plan and all logs remain in the new workspace. The exact continuation is one administrator-authenticated
`sudo /usr/local/bin/empyrean-license old`, followed by status/client rechecks and the retained `xtop -> apply-eco -> extract -> timing -> summarize -> compare` sequence. Blind retry, bypassing the switch guard, or treating the baseline as a candidate result is prohibited.

## #50 confinement progress

The generic Podman result from the earlier audit was extended with nested command tests, still without starting XTop or changing a licence. The exact image is
`localhost/edarunner@sha256:8467102dbae851e4136e998661ae3a01ad9b65d49711c82f2b0883ab8d1bbb8c`.
The container used `--userns=keep-id`, the calling UID/GID, `--network none`, a read-only root,
all capabilities dropped, `no-new-privileges`, a bounded PID count, read-only `/data/eda`, and one private writable bind.

Inside Tcl:

- a direct write to a protected sibling failed with `read-only file system`;
- a sourced Tcl file attempting the same escape failed;
- Tcl `exec /bin/sh` attempting the same escape failed;
- writing the private child succeeded;
- all three protected host files remained absent after container exit.

The retained test-script SHA-256 values are `00432d04...1357` and `dc893468...687`; the result log is `d964aaf2...06a` under
`/data/eda/project/hima_harness/operator-qualification-20260924/private/`.
This proves the mount boundary for these three negative cases only. Production mutation remains unavailable until the same pinned environment completes an XTop bootstrap, licence/network check, versioned adapter session, transcript/recovery test, one work-copy mutation and independent fresh physical/timing verification. No Harness code flips confinement to `enforced` in this partial tranche.

## #59 real feedback A/B

The live-only qualification entrypoint was added in `611279c` and corrected in `12260ea`. The correction reused the existing `hima-moment` response-only composition so both model sessions had an empty tool schema, and fixed `openMoment` so its public result contains only visible `text` blocks rather than concatenating private `reasoning` blocks. A new replay fixture reproduced the original leak as `We need ... READY` before the fix and returns only `READY` afterwards. The combined Model-moment and live-entrypoint local subset passed 11/11.

The first retained historical request considered for A/B was rejected before a model call because its evaluation/frontier bytes no longer matched the request hashes. The selected request from `custom-cell-fmax-dtco-20260921-005920-f064` passed all current Pack loaders: request SHA-256 `8f63a18e...a1ec`, frozen input identity `51b8569c...8e22`, 77-proposal pool `01fd993e...3e02`, and complete-matched commercial response evidence `565a45c7...908b` / response `c11d7fd6...af19`.

The source-clean final run used commit `12260ea01915c7f4fb2c6b473ce1933ebebf74d7`. Two independent real `deepseek-official/deepseek-flash` sessions each completed one request step with no replay and no tool schema. The no-feedback arm selected 12 proposal keys; the with-feedback arm selected 6. The deterministic Pack comparison recorded three added and nine removed keys, `selection_changed=true`, and the reason `commercial feedback changed candidate selection`. Both proposals passed the existing context loader, strict proposal validator and isolated candidate-program runner. The model interpretation itself retained the single-pair/no-statistics/no-causality limits.

Final ignored evidence:

- `feedback-ab.json` SHA-256 `1a0ef9319fcd7f6729c405e1168449b1d88cc773dcfeda23fb44c7ac0b2797fe`;
- `feedback-ab.md` SHA-256 `61687cdbb8e909965fcdfa699ce57ebe38e5be7f36c07ca2738f874ce80b7aa9`;
- LiveCheck `evidence.json` SHA-256 `c57ba34eb6fae3d605efc580c8721817efd29229204057519311f49c9cd60b8b`.

This qualifies one real feedback-sensitive selection path. It ran no commercial EDA and proves no PPA benefit. Earlier failed runs remain retained: tool exposure, reasoning/text mixing, a scalar `evidence_sha256`, and an over-strict request-step assertion were each allowed to fail closed and were not rewritten into the final evidence.

## J3 status

The authorized study scope, arms, budgets, stop conditions, data handling and verdict vocabulary are fixed in [the J3 charter](charter.md). J3 remains gated because the XTop-dependent candidate half of #55, #50 production Operator qualification, a complete Hima arm, Pack sealing and independent final result review have not all completed. The correct current verdict is `blocked` at an administrator authentication boundary, with useful completed baseline, real-model feedback and confinement evidence retained.
