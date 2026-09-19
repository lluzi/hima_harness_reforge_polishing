# Trial.10 result review

Trial.10 ran `custom-cell-fmax-dtco@5.1.5` in Campaign
`custom-cell-fmax-dtco-20260919-030238-9933`, Run
`run-d61a1768-d129-4dde-9819-627b80406560`.

## What the trial proved

- The generation-1 matched comparison missed the 5% target with
  `fmax_improvement_pct = -1.2259194395796709`.
- `final-judge` therefore ended with node outcome `FAIL` and routed through
  `next-research`, rather than ending the Campaign.
- The same Run entered generation 2 and advanced `algorithmRevision` from 0 to 1.
- The generation-2 Workshop produced seven lenses, including the bounded
  `onsite-inspiration` lens tied to the generation-1 commercial response.

These are Ledger-backed results from the trial report. Generation 2 did not reach a new Library or E0 result.

## Reproduced blocker

`read-research-selection` failed twice with:

```text
ValueError: history[0] exceeds the bound evidence file byte limit
```

The residual research writer permits a complete round document up to 8 MiB, but
`load_residual_research_context()` read historical round documents through the
512 KiB context-evidence default. The real first-generation research document
was therefore valid when written and impossible to consume in generation 2.

Pack 5.1.6 passes `RESIDUAL_DOCUMENT_BYTES` when reading each hash-bound history
document. Other evidence remains subject to the smaller bounds, and a history
document above 8 MiB is still rejected. The fix changes no graph, ownership,
budget, EDA flow or evidence authority.

## Next falsifying observation

A new 5.1.6 Campaign must show all of the following before the loop is considered operational:

1. generation 2 `read-research-selection` completes on a prior round larger than 512 KiB;
2. its observation reports `onsite_inspiration_selected_count`;
3. the same Run proceeds through cumulative Library creation and a second matched E0;
4. another target miss either starts a later generation or reaches a genuine budget/convergence ending;
5. only a matched post-route result of at least 5% satisfies the Campaign goal.

No commercial EDA rerun was used to publish this maintenance fix.
