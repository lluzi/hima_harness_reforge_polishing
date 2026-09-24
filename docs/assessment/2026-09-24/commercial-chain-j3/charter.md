# SWERV28 commercial-chain and J3 value-study charter

Status: authorized, gated execution in progress. Date: 2026-09-24.

## Authorization and scope

The authorization is the owner's direct 2026-09-24 instruction in the active Codex task to implement and close, in order,
`#55 result adoption -> #59 endpoint feedback -> #50 interactive Operator -> complete commercial chain -> #61 J3`, including necessary operation of HimaHarness. It supersedes the earlier pause on starting a successor trial, but it does not authorize alteration of trial30, golden inputs, licence servers, unrelated projects, or deletion of retained evidence.

This study covers one design and one Site:

- design: `swerv_wrapper`, starting from the Site-bound `xtop_round2_eco_route.enc.dat` checkpoint;
- Site: `linglong-swerv28`;
- goal: setup WNS >= 0 ns and hold WNS >= 0 ns under all four declared scenarios;
- current method candidate: `xtop-timing-closure@1.0.9` from source commit `81142134d08a2e0abb0c5f40b311cded262721ab`;
- comparison unit: one complete baseline and one complete candidate generation through Innovus export and physical checks, StarRC, PrimeTime, XTop, Innovus ECO, fresh StarRC/PrimeTime, comparison and best-database admission;
- excluded claims: clean signoff, tapeout readiness, universal Fmax/PPA gain, replacement of an engineering team, and extrapolation to another design, person or Site.

The development Pack is not promoted to a released Pack until the commercial-chain evidence, retained method identity, tests and independent review all pass. A failed or negative chain remains a valid study result and does not permit a best-database adoption.

## Arms and non-interference

The control arm is a direct, auditable invocation of the retained Pack adapter in a fresh private Site workspace. It measures the human orchestration needed to obtain one complete generation without Hima's Campaign owner. The Hima arm must start from a separate fresh copy of the same input checkpoint and use the same source manifest, Site profile, tool versions, scenarios, goals, generation limit and commercial-tool concurrency. Neither arm may consume the other's candidate database or new strategy result.

The control workspace is:
`/data/eda/project/hima_harness/xtop-timing-closure-runs/qualification-v109-20260924-1535`.
The Hima arm workspace and Run identity will be recorded before its first business node starts.

## Gates and order

1. The current source must pass the focused #55 Host/Judge/XTop contracts and Pack closure tests.
2. #55 must retain complete, same-generation DB, scenario, STA, SPEF, DRC and connectivity identities. Both physical reports must use the fixed 1,000,000 limits, remain below those limits, and introduce no new normalized error identity relative to the original and retained-best references.
3. #59 must run a real `deepseek-flash` frozen-pool feedback A/B. Replay or a deterministic Reader check is not a substitute. A changed choice and an unchanged choice are both acceptable when the reason and source identities are retained.
4. #50 production mutation remains closed until the exact XTop image/runtime, mounts, writable roots, licence path, adapter commands, transcript and recovery behavior pass qualification. A read-only bootstrap does not qualify mutation.
5. Only after those gates may the Hima arm execute the complete commercial chain and J3 compare the arms.

## Budgets and stop conditions

- commercial-tool concurrency: one Job on `linglong-swerv28`;
- control-arm command timeout: 30 minutes for Innovus or XTop and 60 minutes for StarRC or PrimeTime stages, unless a retained stage-specific receipt records a smaller bound;
- Hima arm: one candidate generation for the first comparison, with the Pack's closing reserve intact;
- model: `deepseek-flash`; model requests and spend are recorded when the product exposes them, otherwise reported as unmeasured rather than inferred;
- no blind retry after a dispatch with unknown outcome;
- stop immediately on input/method/tool identity drift, an active conflicting XTop or QuaLib client, licence-mode mismatch, evidence truncation, incomplete scenario coverage, a production-confinement failure, or an exhausted budget;
- switching Empyrean to `old` is allowed only after confirming no QuaLib 2026 client is active; the selected mode is checked before and after each XTop qualification and restored to `new` after the XTop-dependent work finishes.

## Measurements and verdicts

Both arms record:

- exact input, Pack, Site policy, source-manifest and tool identities;
- setup/hold WNS, TNS and violating endpoint counts for every declared scenario;
- endpoint fixed, remaining, entrant, regressed and missing sets, including comparability reasons;
- complete DRC and connectivity counts and normalized identities;
- best versus last database identity and the adoption reason;
- wall time, commercial-tool seat-minutes, number of launched Jobs, model calls when measurable, and human minutes split into business judgment, environment recovery and evidence review;
- handoff completeness: whether an independent reviewer can reproduce the decision from retained references without relying on the conversation.

The result vocabulary is `positive`, `negative`, `inconclusive`, `blocked` or `unknown`. Hima is positive only for this case if it reaches an equally qualified or better engineering result with less human intervention or a materially better evidence/continuation outcome under the declared budget. A useful negative result is not rewritten as success. Missing comparable data produces `inconclusive` or `unknown`, not zero.

## Data handling and review

Raw design data, databases and commercial reports remain on the approved Site or in ignored local evidence directories. Repository records contain identities, bounded summaries and commands, not proprietary raw bytes or credentials. There is no telemetry or automatic upload. The primary agent owns execution evidence; a fresh-context Sol/High reviewer must independently check result validity, permissions, data scope and the final J3 interpretation before sign-off.
