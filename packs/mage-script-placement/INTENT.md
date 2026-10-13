# MAGE script-method test-structure placement 0.1.0

## Business

Mask tape-out engineers place test structures in the scribe lanes of a full product Frame. The
customer's own method is a long vendor Tcl script: point-place the priority Groups at a target
table in request order, compact the placed Groups to consolidate the adjustable gaps, freeze them,
and let Auto Refine fill the remaining structures; whatever still finds no room is dropped. On the
current MAGE build this method breaks in two places: editing per-item offset-range settings after
point placement invalidates every placed Fit while the Group metadata records remain intact, and
the compaction call fails with a native sort message once that invalidation has happened. The
customer's retained historical artifact shows 18 ordinary drops / 52,453 µm (plus one dropped
priority Group of 616 µm); that result has not been reproduced on the current build, and the
current build's own no-compaction fill from the same frozen start drops 27 ordinary structures
totalling 135,113 µm (225 priority Fits, 319 ordinary requests, 10 Fixed).

This Pack gives one resident MAGE Engineer the customer's own engineering pattern in real MAGE,
writing and repairing the Tcl itself, each round in a fresh session with the method journal and
best state as its only memory. The customer's verified script is Site-bound reference material the
Engineer reads; it is never replayed by the Pack as a result. The product claim this Pack delivers
evidence for: a replayable, script-based placement solution demonstrated in real MAGE, with an
honest before/after comparison against the 135,113 µm baseline and the 52,453 µm customer
reference, reported at five proof levels (Reproduction, Improvement, Match, Surpass, Customer
completion), and with every number recomputed by Pack code from MAGE's own exports. A smaller drop
total obtained by deleting requests, losing Group associations, resizing cells, or relaxing rules
is never an improvement. A quantified failure analysis of compaction, honestly reported, is an
acceptable ending — leaving residual drops reported is a failure of the placement problem the
Engineer was handed, not of this Pack.

## Golden flow

One `hima-flow/1` sequence: `prepare-case` → `measure-incumbent` → a `repeat` of up to six rounds
(`engineer-script` → `decide-round`) → `evaluate-placement` → `deliver`. Each round is a single
resident session and one Reader Job: the Engineer reads the previous rounds' best state and journal,
writes its hypothesis, authors and runs one or more Tcl stage scripts through `mage-stage`, reads
every boundary with `stage-report`, and delivers its best stage as a candidate with a journal entry;
`decide-round` (program code, not a resident role) ranks the round by Reader values only, updates
the best state, appends the journal, and routes `continue` or `stop`. The round limit is fixed at
six in `graph.yml`'s `maxIterations`; strategy knobs cannot change it.

## Answers

Success is measured against the frozen-start baseline and, when the manifest names one, the
customer's retained reference length, on the eight delivery rules: candidate error count,
every priority mark placed, zero native violations, dropped count within goal, target distance
within goal, order deviation within goal on each side (LR and TB, checked separately per the
customer's own per-side convention), and priority movement from the frozen start within its
declared budget. `goalMet` is explicit and may legitimately be false on a complete, honestly
reported best-effort delivery whose journal names exactly what was tried and where it stopped. Cost,
round count, and session count are not engineering victory conditions.

## Ambiguities resolved

The user's 2026-10-12 steering decided five things this document records so a later reader does not
re-litigate them:

1. **A script-method Pack, not the sibling's planner-first, consumer-review design.** The resident
   Engineer re-implements the customer's own four-stage Tcl method directly; there is no exact slot
   planner driving placement by default (`plan-slots`/`lane-view` stay available as optional tools)
   and no consumer-review loop — this case has one engineering audience, not four downstream
   consumer roles.
2. **Agent-authored Tcl, with the customer's verified script as Site-bound reference, never
   replayed as a result.** The Engineer writes and runs its own stage scripts; the reference
   method's entry script and files are read-only evidence (`reference-method-guide.md`) about what
   the customer's method does and which of its stages are verified history versus unreproduced on
   this build.
3. **One Engineer per round, in a repeat of up to six fresh resident sessions — no consumer
   roles.** Every round is a fresh session with its state in files, not a long-lived conversation;
   the journal and the best state so far are the only continuity between rounds. Six rounds, not
   the sibling's four, because a script-method round costs one resident session and one Reader Job
   rather than one Engineer plus four consumers.
4. **The Pack id is `mage-script-placement`**, distinct from the sibling `mage-scribe-placement`,
   naming the script method rather than the planner/reviewer scribe pattern.
5. **Its own Site, `linglong-mage-script`, rather than reusing `linglong-mage`.** The sibling Pack's
   manifest schema is closed (`additionalProperties: false`); a manifest carrying this Pack's new
   `referenceMethod`/`referenceFiles`/`referenceNotes`/`referenceOrdinaryDropLengthUm` fields would
   break the sibling's own `prepare-case`. This Pack binds its own Site-local manifest file through
   its own Site (same host, permit, capability, workspace root and `mage: 1` seat as `linglong-mage`;
   no `consumerContext` binding — the contract test still asserts that an extra `consumerContext`
   binding on a Site is tolerated).

## Knowledge applied

`script-method-playbook.md` carries the Engineer's whole method: the four stages of the reference
method as exact Tcl, the two known failure signatures and the compatibility repairs, the
stage-boundary discipline, the action order, the fixed round-1 baseline script, explicit
compaction, the two displacement metrics, and the journal discipline. `mage-capabilities.md`
separates the prelude/epilogue and the verified command surface from the documented-only commands,
with the stage result files and the pitfalls specific to this build. `state-and-evidence.md` keeps
modelled, native, and (absent) device facts from being mixed, and names the F8 cross-stage identity
anomaly as its own `identity-unknown` diagnosis class. `reference-method-guide.md` is how to read
the Site's reference material as evidence, never as a result. `role-script-engineer.md` gives the
Engineer its own complete brief, consistent with its `contract.yml` tool description and the real
CLI subcommands and flags it may call.
