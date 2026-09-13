# PLS-25: consolidation after fork/join

The full AES method needs six candidate branches, an explicit merged measurement, a new Judge and
an owner decision. The existing Pack loader refused every Explore reachable after a join. The
runtime already validates the latest unbranched observation and the current Judge citations.

The loader now admits this explicit consolidation only when every route to Explore establishes a
new unbranched observation and a non-join Judge with constraint/Goal rules. Direct branch evidence,
a read without a new Judge, or any bypass stays refused. Revisit edges reset the proof state and
are walked too, so a legal first generation cannot hide an invalid second generation.

Retained tests use the real in-process Host, real Ledger and local synthetic EDA processes. No
model, Electron, SSH or real EDA was started. The initial failure is the original blanket-admission
error. The first green proved consolidation; the existing rejection matrix remained green. An
independent review found a revisit bypass in the initial implementation. The final two cases
(11.565 s) execute two valid fork generations and reject the read-without-Judge revisit before Run
creation. The final negative consolidated measurement cannot be turned into success just because
the last branch passed. Completion launches no successor work.

The retained commands started five in-process Hosts in total, including the failed baseline. The
review delta is closed (Standards 0, Spec 0); the full local suite is reserved for the end of the
requested PLS batch. This is a minimal existing-module correction, not a new execution component.
