## Goal template

`target_setup_wns_ns` and `target_hold_wns_ns` default to 0 ns. A clean result satisfies both over
all declared refreshed PrimeTime scenarios. The Run may also stop as measured convergence after two
generations whose closure score differs by less than 0.001.

## Constraints

The input database and Foundation sources are read-only. Every tool writes only inside the Campaign
workspace. XTop uses whitelisted fix commands. An Innovus ECO always starts from the database that
created its PT/XTop input. Every physical result is re-extracted and re-analyzed before comparison.
No path is deleted, no historical iteration is overwritten, and source/hash mismatches fail closed.

## Run contract

The Site binds `inputInnovusDatabase`, `siteProfile`, `sourceManifest` and `workspaceRoot`.
Preparation records their identity. Fabric calls separate Innovus export, StarRC extraction,
PrimeTime analysis, Workshop planning, XTop fix, Innovus ECO, refreshed extraction, refreshed PT and
comparison nodes. Output is the materialized `flow/output/best.enc` plus `best.enc.dat`, bound by
`best-database.json`.

Best-database adoption also requires comparable, complete full-chip DRC and connectivity counts
from the same database state. An Innovus DRC `Total Violations` footer is readable only with its
declared `verify_drc -limit 1000000` command and a count below that bound. A connectivity report
that prints 1000 problems without proof of an untruncated count remains `unknown`; identical printed
counts across generations do not prove no new error. Unknown physical coverage cannot authorize a
new best database.

## Semantics

The Pack emits setup/hold WNS, TNS and violation counts, unconstrained endpoints, endpoint delta
counts, a closure score, plan action count, evidence validity and database readiness. Missing values
are errors rather than zeros. Endpoint keys include scenario, mode, path group and endpoint.

## Judge rules

`xtop-iteration-evidence-valid` prevents incomplete refreshes from advancing. `xtop-setup-clean` and
`xtop-hold-clean` compare refreshed WNS against the Campaign goal. The constraint rule routes
invalid evidence to `blocked`; the two goal rules let the Explore node distinguish clean closure
from another measured iteration.

## Choosers

`xtop-next-iteration` ends goal-met when both setup and hold pass. Otherwise it opens another
generation. The Explore convergence declaration observes `xtop_closure_score`, requires two stable
generations and caps the reference method at 12 generations. The chooser does not invent an ECO;
the next Workshop does so from the full endpoint feedback.

## Endings

The Run ends goal-met when setup and hold targets pass, converged when the measured score stops
moving, budget-exhausted at the declared wall/generation bound, or waiting on a hard blocker. Only
goal-met is clean timing. Every ending retains the best database and the unresolved boundary.

## Workshops

`plan-fix` is the only AI-authored code surface. It reads current closure state, prior experience and
the prior plan, then writes an exact JSON plan with diagnosis, competing hypotheses, endpoint groups,
actions, avoid-list and reasoning. The deterministic adapter validates fields, ranges and action
whitelist before any licensed tool starts.

## Knowledge

The Pack carries the verified source method and source manifest, its completion boundary, and the
endpoint feedback vocabulary. Site paths and credentials remain outside the Pack. Campaign results
remain in the Campaign workspace and do not silently modify Pack knowledge.
