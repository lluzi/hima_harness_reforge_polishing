# Fast-Convergence Testing Principles

User-supplied on 2026-09-29. These principles govern the remaining HimaHarness and ATCS tests and
sit above `docs/testing-strategy.md`'s layer table for the ATCS delivery and effectiveness work.

## 1. Test the minimum product claim
Prove only the next required capability. #63 tests Pack delivery and component integration; #64
tests timing-method effectiveness. Timing benefit must not block Pack delivery. Optional
completeness, UI polish and broad portability are deferred.

## 2. Use the cheapest falsifier first
```
schema/fixture → unit test → Reader → Host contract → wrapper preflight → no-model dry path → commercial tool → GUI Campaign
```
Never use a full Campaign to find a schema, path, parser, environment or binding error.

## 3. A gate must protect correctness, not obstruct progress
A gate is justified only when it prevents false evidence, wrong identity, unauthorized mutation,
duplicate effects, broken recovery or unsafe physical adoption. Do not add gates merely to demand
more documentation, completeness or presentation quality.

## 4. Every gate needs an executable success path
A gate is invalid when the system can refuse but has no practical path to PASS. Before adding a
gate, prove: a valid positive fixture passes; one meaningful negative fixture fails; the error says
exactly what must change; recovery does not require recreating unrelated work.

## 5. Freeze one candidate
Before expensive testing, freeze source, App, Harness, Pack, flow, Site, Permit, wrapper, binding
and inputs. Do not change candidate bytes during a Run. If bytes change, create one new candidate.
Do not mix evidence across identities.

## 6. Reuse unchanged evidence
Do not rerun qualification when the relevant bytes are identical. Requalify only the changed
surface: Pack parser change → Pack tests; wrapper change → wrapper qualification; Harness change →
Host contract tests; App change → App cold-start checks. Identity changes are not a reason to rerun
unrelated commercial EDA.

## 7. One deterministic blocker per fix cycle
```
observe → reproduce at the lowest seam → root cause → smallest fix → GREEN → nearest regression → one review → continue
```
Do not combine unrelated cleanup, refactoring or feature work with the fix.

## 8. Two-probe rule
If two bounded probes do not clarify a noncritical issue: record it, defer it, return to the
milestone. Escalate only identity, permission, evidence, duplicate-effect and recovery ambiguity.

## 9. Pack-first fixes
Ownership order: Pack → Site/wrapper/binding → existing generic extension seam → Harness core.
Modify Harness only when a generic contract test proves the Pack and Site cannot correctly own the
behavior.

## 10. Validate model outputs before using a model
Every model-written document must have an admitted example, a schema validator, a Reader fixture
and an actionable error message. A live model must not be the first producer ever tested against a
schema.

## 11. Separate Explore budget from physical-refresh budget
Research, revisit and schema repair must not consume physical-refresh allowance. Count a refresh
only after implemented DB → StarRC → PrimeTime. The refresh limit is frozen at Campaign creation
and cannot be raised by the owner.

## 12. Use no-model dry paths
Before a live Campaign, execute the complete path using retained deterministic inputs:
plan → worker → Contribution → composition → implementation → extraction → STA → evaluation →
experience → ending. The live Campaign should test model decisions, not infrastructure wiring.

## 13. One GUI acceptance per frozen candidate
GUI acceptance begins only after all lower gates pass. One HimaHarness process, one window, one
Home, one Workspace, one Campaign, one Run, one GUI operator. Finish with normal App teardown and
zero-process verification.

## 14. Preserve progress across recoverable failures
A recoverable failure restarts from the nearest safe boundary. Do not require rebuilding the
baseline, completed EDA results, accepted child results or unchanged artifacts. Recreate the whole
Campaign only when method bytes or authoritative input identity changed.

## 15. Do not repeat reviews
One scoped reviewer after the candidate is fixed, checking the exact changed diff, the originating
requirement and directly affected tests. Do not repeatedly re-review unchanged files or historical
evidence.

## 16. Keep mutable ownership singular
Parallelize research, source reading, test execution, log analysis and independent review.
Serialize main integration, the HimaHarness GUI, licence actions, a Run and release publication.

## 17. Stop at an honest bounded result
A valid result is PASS, FAIL, BLOCKED, NEGATIVE or INCONCLUSIVE. Do not keep running merely to turn
an honest negative result into a positive narrative.

## 18. Evidence should be sufficient, not maximal
Retain exact identities, commands and exit codes, required artifacts, authoritative metrics, the
blocker and the limitation. Do not repeatedly collect screenshots, logs and reports that do not
change the decision.

## 19. Promote every expensive failure into a cheap regression
A failure discovered in a live Campaign must become a lower-level automated test. The same failure
class should never require another commercial Campaign to rediscover it.

## 20. Optimize for frontier movement
Before every task ask: what is the cheapest action that can move or falsify the current delivery
frontier? If the task cannot change the next milestone decision, defer it.
```
Cheap gates first. Freeze once. Test changed surfaces only. Run one dry path. Run one live Campaign. Accept honest outcomes. Move forward.
```
