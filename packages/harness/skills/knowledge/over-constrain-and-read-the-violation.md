# Over-constrain, and read the violation

**A met constraint states no margin.** When a tool is asked for a target it can reach, it stops
optimizing the moment it reaches it and reports exactly zero slack — not "zero more was possible",
just "asked for, met, done". A pass therefore tells you one thing only: the target was reachable. It
tells you nothing about how much further the design could have gone, and a method that reads a pass
as a measurement is reading a number that was never measured.

**A violation is a measurement.** When the same tool is asked for a target it cannot reach, it
optimizes as hard as it can and then reports the shortfall. That shortfall is arithmetic you can
use: the achievable value is `asked + |violation|`. One failing run states the answer that any
number of passing runs cannot.

## What this means for a pack you are authoring

- **Ask one step tighter than you believe possible, on purpose.** The first generation of a Loop
  should be expected to fail. That failure is how the Loop learns where the frontier is; a first
  generation that passes has bought you nothing but a lower bound you already had.
- **Make the violation a typed value of its own.** The judge and the chooser both need it. A pack
  whose semantics carry only "passed / failed" has thrown away the one number the method runs on.
- **Write the chooser in terms of the violation.** On a violation, the next target is
  `asked + |violation|`, rounded the way the tool prints it. On a pass, the next target is *tighter*
  — never looser. A chooser that loosens on a pass moves away from the frontier every generation and
  can only end at its generation limit.
- **Round the way the report does.** If the tool prints two decimals, the chooser works in two
  decimals. A move smaller than the printed resolution is a move the next report cannot show, and a
  Loop that makes one cannot converge.
- **Say all of this in the pack's own words.** Every face — the card, the decision record, the
  report — must be able to say "this generation asked for X, the tool was short by Y, so the
  achievable value is X + Y". A person who has to reconstruct that from two numbers will get it
  wrong.

## Where this came from

A reference campaign ran to its generation limit while every one of its generations passed. Its
chooser read the reported zero slack as "no room left" and loosened the target by its guard band each
time. The first generation's violation had already stated the answer; nobody read it. The fault was
the pack's, not the runner's — the runner ran exactly the method it was given.

## Citing it

When this file shaped a decision, cite it by name and say what it changed — "turned 'a pass proves
the target' into 'a pass states no margin', and made the violation the value the chooser reads".
