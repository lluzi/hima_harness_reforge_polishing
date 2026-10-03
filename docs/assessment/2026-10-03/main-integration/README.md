# Main integration and branch audit — 2026-10-03

The user requested branch cleanup and integration of the latest code into `main`, then explicitly
selected `codex/issue82-opencode-design` as the product baseline after being shown the divergent
history and 42 conflicting paths. This is source integration, not a new product release or GUI/EDA
acceptance.

## Sources and decisions

- Previous main: `0626bba394db8b29a02aa9defa718aba07554571` (ATCS 0.1.10 delivery).
- Resident engineering baseline: `eb38cb7d0fb6097d42ad52c65ffaed349d62197c`.
- Keep resident engineering execution, declared autopilot, recorded input bindings and Ledger v31.
- Preserve main's applicable improvements: interactive-only batch refusal before admission,
  actionable schema/plan diagnostics, version-aware Python entry syntax checks, and durable
  interactive/retry failure log tails. Independent review found a primitive-JSON diagnostic crash;
  the combined implementation rejects non-object results and has real Host regression coverage.
- Preserve the original 0.1.10 Pack and release evidence as an explicitly historical snapshot;
  its release seal must not describe the current development Pack. Legacy declaration tests use
  their matching historical declarations. Current product tests continue to use current declarations.
- Preserve main's ATCS bundle identity checks. Historical interactive bindings are checked against
  their historical Pack, and are refused against incompatible current declarations.
- Preserve six previously unintegrated historical reports byte-for-byte: `docs/trial-26-findings.md`
  from `1a19a52718381efdbd10491fd2526b2ac013ed38`, and the five root-level `Issue63 ATCS …` reports
  from `88eccb2db73e6c601b60cff9f3d67df3baf8c9e2`. These remain historical observations.

## Validation and limits

Validation results are recorded after the integration checks finish. Commercial EDA, real model
calls, GUI acceptance and release sealing are outside this branch-maintenance task. Existing
evidence is not relabelled as new acceptance. Tests of old Pack versions do not prove current Pack
behavior.

## Branch cleanup safeguards

The initial audit found 142 local branches and 117 origin branches (142 distinct names), plus 128
registered worktrees. Before integration, 47 non-main local branches and 33 non-main origin branches
were ancestors of main; another 27 in each scope had entirely patch-equivalent commits on main.
These are separate counts, not 259 independent lines of development.

All branch histories were saved in a verified complete Git bundle before cleanup. Existing dirty
worktrees, including the resident development worktree's uncommitted test additions, are preserved.
Fourteen stale worktree registrations pointed to missing Git metadata and were pruned; no worktree
directory was deleted. Final cleanup uses fresh ref identities and records each removed ref.

Local audit artifacts live in `.hima-tmp/branch-audit/`, including the initial inventory,
worktree status, patch equivalence, historical-report blob receipts, independent review,
test logs and `pre-cleanup.bundle`. The bundle contains full history and must be retained until
the user is satisfied with cleanup. Source integration remains reversible through the recorded
parents and the bundle.

Integration was coordinated in one isolated polishing worktree. GPT-6.1 Sol/high workers handled
Pack conflicts, test conflicts and independent review with disjoint file ownership. The coordinator
alone stages, commits and synchronizes the integration. Product model calls and EDA jobs: zero.
Development token/cost attribution was not measured.
