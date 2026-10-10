# HimaTeam implementation baseline

2026-10-10: implementation is authorized by the user on `codex/himateam-platform`,
starting at `d458ec761899a83200b7264f8e19272df6965c88` from
`feat/libinsight-insight-demo`. The existing LibInsight commits are inherited.

The product authority is [#97](https://github.com/lluzi/hima_harness_reforge_polishing/issues/97),
mirrored byte-for-byte in [spec.zh-CN.md](spec.zh-CN.md), together with the product
definition, CONTEXT and accepted ADRs. Implementation scope and dependencies are
the bodies and GitHub native blocked-by relations of **#98–#109**. The older
2026-10-09 plan's U identifiers are code-location references only. Its old
dependencies and planning-only delivery statement do not govern this execution.

Initial unblocked tickets: #98 (definition and independent controlled task),
#99 (DSH compatibility), #100 (managed runtime dependencies). Later tickets start
only when their actual prerequisites have landed; contract discussion is not
dependency completion. Each ticket retains its explicit composition owner.

The integrator owns shared contracts, migrations, routes, tools, client API,
runtime wiring, package manifests/lock and test registration. Workers receive
one bounded package in a separate worktree from this documentation baseline,
use `gpt-6.1-sol / medium` and `fork_turns="none"`, and return uncommitted changes
and evidence. Coordination, architecture, diagnosis and independent review use
`gpt-6.1-sol / high`. Workers do not delegate recursively. Environment capacity
currently permits three concurrent workers alongside the coordinator.

Tests use the already agreed Host seams with TDD and isolated storage/processes.
Mechanism, actual runtime, desktop/install and business acceptance are recorded
separately. Repository hooks remain intact; every integration commit is pushed
immediately and its remote SHA verified. Main merge and product release are
outside this authorization.

Current execution facts live in `.scratch/himateam-issue97/development-baton.json`.
The older plan, interview, research and scratch artifacts remain outside this
baseline commit. They have not become new implementation instructions or
acceptance evidence.
