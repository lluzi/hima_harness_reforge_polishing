# Over-constrain, and read the violation

A passing timing constraint establishes closure at the tested target and conditions. Preserve the
actual reported slack, whether zero or positive. Some synthesis flows report zero once a target is
met; that zero does not establish the fastest achievable implementation. A pass alone does not
prove global optimality, and a negative slack does not prove the tool exhausted every strategy.

A setup violation is a measured shortfall. For an asked period P and slack V < 0, P + |V| can guide
the next trial when the timing model makes that approximation useful. It remains a hypothesis:
resynthesis, path changes, and period-dependent IO delays or clock latency can change the result.
Only a new valid trial can establish closure at its tested period.

## What this means for a Pack

- Keep the requested target, reported clock period, actual slack and proposed next target distinct.
  Check the report's units, scope and conditions before using it in a decision.
- A deliberately tighter first trial can expose a shortfall; a passing trial is still useful
  evidence. Choose the initial pressure from the business question and available budget.
- A Pack may recommend `P + |V| - step` after failure and `P - step` after a passing trial that
  misses Goal. Do not systematically relax a zero-slack passing trial by adding a guard band.
  Validate every candidate against the Pack's bounds and precision before launching it.
- Use the tool's actual reporting precision. Repeated rounded values can hide differences;
  convergence is limited to the observed resolution and tested conditions.
- State: “Trial X measured slack Y; the next proposed period is Z and remains untested.”
  Claim Goal met only from current, valid measurements and the required Judge verdicts.
- Execution faults, incomplete reports and changed inputs cannot support a design conclusion.
  Retain the failure and resolve it before deriving the next strategy.

## Source and limits

The reference opene902 stand-in exposed a chooser that relaxed the period on every zero-slack pass.
That counterexample motivated the over-constraining recommendation. It does not establish that
all tools always report zero, or that one failed synthesis reveals the exact achievable period.
When citing this file, identify the recommendation used and the actual evidence behind the decision.
