# Trial.9 result review: first complete E0, loop routing defect

Run: `run-47218b96-978e-49c8-8ff4-c0d1748bba0c`

Pack: `custom-cell-fmax-dtco@5.1.4`

Verdict: `PARTIAL`

## Proven progress

The Run completed all six free miners, one AI Workshop, a 40-Cell cumulative Library, LC, matched DC,
adoption, both matched Innovus arms, verification and comparison. Six generated masters were adopted
as 104 synthesis instances and 31 instances survived route. DCAP remained zero. The generated arm
reduced power, area and route density but changed Fmax by `-0.8787346221440925%`.

The commercial frontier response was complete: reference 128, generated 130, resolved 0, entrants 2,
remaining 130. This is the first real factor-versus-E0 sample for the Self-Improving process.

## Blocking defect

The Harness intentionally branches a judge node on its first rule. `final-judge` listed
`comparison-evidence-valid` first, so a valid comparison with a missed Fmax goal produced node outcome
PASS. The graph had only `FAIL -> next-research`; the Run ended after generation one with most of its
budget unused.

Pack 5.1.5 fixes this within the Pack by placing `fmax-improvement-at-least-target` first. No Harness
judge semantics change is required.

## Bounded adaptive upgrade

The existing `research-candidates` Workshop is the sequential seventh strategy, named
`onsite-inspiration`. It runs after the six fixed miners, shares their candidate pool, the same
cumulative Library and the same E0. It has a maximum of ten proposals within the existing 50-Cell
round budget. From generation two onward its lens must cite the current commercial frontier response.

No new Runtime component, commercial arm, planner, Run or asset system is introduced.

The redundant literal `arm_scripts_matched: true` was removed. Authoritative matching remains the
normalized script contract, frozen core/pin identities, common-condition reread and
`matched_conditions`.
