# Library Insight authoring-qualification SOP

This is a fresh source package for the Wave 3 Pack-authoring acceptance. It is
not the Wave 2 `packs/library-intelligence` development directory and must not
be copied into a Pack wholesale.

The author is to create a small, separately named Pack that verifies the
identity and required fields of one bounded Library Insight input. Its only
purpose is to exercise the authoring and release chain against Library-method
requirements: a source has a SHA-256 identity; qualification state, report
schema, provenance and explicit unknowns remain visible; an absent required
field is a refusal rather than a successful zero.

The compiled method has two ordered Judge rules and one explicit Explore
decision. First, `library-contract-nonnegative` is the constraint rule: it
requires `library_contract_ready >= 0 count`. Second,
`library-contract-goal` is the goal rule: it requires the same reading to meet
the bound goal of `1 count`. Only PASS/PASS may let the `decide` Explore node
record `goalMet` and end the Run. A FAIL or unknown reading goes to the declared
wait/refusal path; it must not be converted into a goal result. A TEST record
may be written only after that explicit decision has made the Run terminal.

Because the graph contains Explore, the Pack contract must declare exactly one
strategy knob: `inputFixture`, a choice whose only allowed and default value is
`library-input.json`. The analyze node binds `INPUT_FIXTURE` from that knob.
The PASS/PASS chooser concludes `goalMet`; it does not invent a next strategy.

The Golden Flow is the adjacent `flow/` directory. Read it in place. It is a
local authoring-qualification flow: it does not load a Liberty file, invoke
QuaLib, call `edarun`, or make a production Library finding. The author may
write Pack-local wrappers and readers only from its stated command line and
output contract. Do not copy this flow into the Pack.

The resulting Pack must declare this limited scope in its intent, specification
and test record. Its test Run is a real local Host Run with a local Job, Reader
and Judge, but it does not requalify the Wave 2 E1--E4 method or replace its
commercial evidence.
