# Trial.13 cumulative Library capacity review

Trial.13 used HimaHarness 0.3.0-trial.13 and Pack 5.1.8 on one persistent
`aes_cipher_top` Campaign. Four complete commercial generations produced
matched post-route Fmax changes of `-0.177%`, `-3.259%`, `-1.053%` and
`-1.742%`. None met the `+5%` Goal.

The trial established two positive product facts. Materialized portfolio
identity passed with round ids `0001` through `0004`, and every 40-Cell delta
used a disjoint generation namespace through `_G0005`. Trial.11 and trial.12's
identity blockers therefore remained cleared across sustained use.

Generation 5 exposed a different deterministic blocker. Four frozen 40-Cell
shards had filled the Site-bound cumulative cap of `MAX_CELLS=160`. The next
40-Cell delta was rejected twice before commercial mapping with
`current delta would exceed the MAX_CELLS cumulative Library cap`. The Run
still had about 174 of 720 minutes and three of eight declared generations
available. This was a capacity-contract mismatch, not a research conclusion,
EDA failure, transient retry or portfolio-identity regression.

The Run remained `running` but unable to advance after its retry allowance was
spent. Its truthful trial verdict is therefore `PARTIAL`: the 5.1.8 fix was
accepted through four complete generations, while the Campaign did not reach
a terminal status and did not complete its declared research budget.

Evidence is retained in
`.hima-tmp/ui-trial-0.3.0-trial.13/Agent Trial Report.md` and on the Site at
`/data/eda/project/hima_harness/polishing-runs/custom-cell-fmax-dtco-20260919-140208-21e5`.
The v13 bug-fix worktree remained clean.
