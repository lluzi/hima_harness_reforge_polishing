# ATCS 0.3 run contract

## Goal template

Repair every target native XTop setup and hold violation, leave no known transition, capacitance,
fanout or legality violation, introduce no required-check regression, and produce a strictly better
repair effect than matched ordinary iterative AutoFix. Targets are 0 ns setup WNS and 0 ns hold WNS.
A complete best-effort delivery may end with this Goal false.

## Constraints

The staged design, common R1, constraints, libraries and ordered scenarios are fixed. No model or
script may change them to improve numbers. Native XTop results are prediction-only with respect to
final physical signoff and never emit tc_final facts. There is no fixed seat plan, mutation count,
model-step count, design object list or method deadline; Runtime/Site budget remains authoritative.

## Run contract

designStateManifest is staged and hashed as baselineState. nativeTimingContext identifies retained
same-design timing data, source reports, SDC hashes, ordered scenarios and producer provenance.
prepare-native-context copies and re-hashes those bytes and current Site libraries without launching
PrimeTime. The route then produces actual common R1 and runs matched ordinary AutoFix from that same
R1 against the same Run Goal. A mode already meeting Goal may spend positive margin while another
residual improves; the control may not lose a satisfied mode or worsen an unsatisfied residual.
It stops on goal, non-improvement, regression or oscillation and exports the best actual checkpoint,
ECO and reports rather than the last attempted state. The Campaign owner uses engineering
start/message/status/delivery/release. After delivery, the graph reads the result and judges delivery
then Goal.

The Site must publish nativeTimingContext as real data. A template or absent file blocks preparation.
nativeReportPaths controls common raw evidence breadth from 1,000 to 100,000 paths; it does not limit
repair techniques or iterations.

## Semantics

atcs-engineering-result emits result-error count, native setup/hold WNS and TNS, known remaining
violation count, regression count, unknown required-collateral count and effect versus AutoFix.
Effect is 1 for resident dominance, 0 for exact tie, -1 for AutoFix dominance, and unknown for mixed
or incomparable timing effects. Cost, duration, calls and seats are absent.

The Reader binds the primary result to exactly one signed Host delivery manifest and current
task/run/execution/node identity. It re-hashes raw reports, parses their WNS/TNS/count, and re-hashes
scripts, logical/physical ECO, checkpoint, reproduction and native trace. Missing or tampered
identity/evidence refuses the result rather than producing zero.

Collateral evidence names before/after state, scenario scope and a hashed native XTop source report.
The Reader parses known XTop fail-reason tables itself and derives a positive blocker lower bound
plus witnessed regressions. That timing-fix scope remains unknown for each required global
transition, capacitance, fanout and legality check even when it finds blockers; it can never prove
global zero. An unsupported native format is also unknown. Model-authored counts and lists never
drive Goal values. A future all-clear path requires a separately admitted real native global report
and parser; no synthetic or model-normalized document can create that PASS.

## Judge rules

engineering-delivery-ready requires a fully verified result. engineering-setup-goal and
engineering-hold-goal compare actual native WNS to the Run targets. engineering-no-remaining refuses
known violations and is undetermined when required collateral is unknown. engineering-no-regression
requires zero regressions. engineering-beats-autofix requires effect 1.

## Choosers

None. The resident chooses engineering tactics inside one task; Hima does not reproduce its internal
team or strategy loop. The final Judge result terminates this single-generation reference graph.

## Endings

Input or delivery failure reaches wait-for-person. A verified result reaches the terminal Goal Judge.
PASS ends goal-met. FAIL or UNDETERMINED ends honestly without claiming Goal success. Budget and
cancel endings retain normal Runtime meaning. A no-op is valid only with equal actual before/after
metrics and real hashed no-op script/ECO exports.

## Workshops

None. fix-timing is one ordinary act node with optional outsourcing. Its tool description and
resident-timing-playbook.md form the complete task. The resident may research, code, operate any
authorized XTop technique, measure candidates, undo regressions and return the best actual state.

## Knowledge

resident-timing-playbook.md defines whole-task autonomy, experiment loop, best-state selection and
the admitted result shape. xtop-capabilities.md describes native mechanics without prescribing a
design answer. state-and-evidence.md keeps actual, predicted, unknown and final-signoff meanings
separate. Version 0.2.10's contract, graph, semantics and method records remain under legacy/0.2.10.
