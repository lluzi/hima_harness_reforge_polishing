# Assert the verification tool's options before the run counts

A verification session answers the question its options asked, not the question you meant. The same
tool, on the same data, with a different rule deck, a different cell view, a different set of checks
enabled or a different severity threshold, will answer "clean" and "not clean" with equal confidence
— and both answers are correct for what was actually asked.

**So a run whose options were not asserted has not verified anything.** It has produced a number
whose meaning nobody can state afterwards, and a pass obtained under the wrong options is worse than
a failure: it is a failure that looks like success and travels into a report as a fact.

## What this means for a pack you are authoring

- **Declare the options in the pack, beside the constraint they serve.** Which checks, which rule
  set, which views, which thresholds. Not "the usual ones" — the list, written down.
- **Assert them at run time, before the count is read.** The session must be made to state the
  options it ran under, and a reader must hold that statement against the declaration. If the two
  disagree, the generation has no verdict: it has a blocker, and the pack says so in words.
- **Make the assertion a typed value, not a comment.** "Options as declared: yes/no", plus the list
  the session reported, so the judge can cite it and a person reading the report six months later can
  see exactly what was checked.
- **Never infer the options from the result.** A clean result is not evidence that the right checks
  ran; it is equally consistent with no checks having run at all.
- **Record the tool's own version beside them.** Options mean different things across versions, and a
  Campaign compared against an earlier one has to be able to say whether that comparison is fair.

## The failure this prevents

A generation passes; the report says the design is clean; the option set had one whole class of check
switched off. Nothing in the ledger is wrong — every number is what the tool said — and the
conclusion is false. There is no way to detect this later from the numbers alone, which is why the
assertion has to happen before the count is read rather than after the campaign is over.

## Citing it

When this file shaped a decision, cite it by name and say what it changed — "added the declared
option list to the run contract and an assertion reader that fails the generation when the session
reports anything else".
