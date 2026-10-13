# State and evidence

## Source

- `flow/mage_placement/snapshot.py`, `flow/mage_placement/native/session.py`, `tools/read-mage.py`.
- Spec `docs/superpowers/specs/2026-10-12-mage-script-placement-pack-design.md` §7, §8, §13 (the F8
  identity anomaly).

## Applies when

Every round: deciding what a number means, what a snapshot sha binds to, and what to write when a
fact cannot be established.

## Three kinds of fact, never mixed

- **Modelled.** `measure-incumbent`'s numbers on the retained incumbent are the Pack's own
  deterministic code run over a `mage.layout-snapshot/2`. They are real arithmetic on real
  geometry, but they are not a MAGE verdict: nothing in MAGE ran to produce them.
- **Native.** The three native check files that `hima_check` and the epilogue produce
  (OVERLAP/SPACE/BOUNDARY, via `frbCheckOverlap`/`frbCheckSpace`/`frbCheckBoundary`) are MAGE's own
  judgement, produced only by a real `mage-stage` run. A `stage-report` row's native counts and the
  Reader's `mage_native_<type>_rows` facts come from these files, never from a modelled snapshot.
- **Device.** No device data exists in this Pack. Native verification is prediction-only; it never
  stands for post-fab signoff. Say "natively verified" or "natively clean", never "correct" or
  "manufacturable".

Never report a modelled number as if it were native, and never claim a native check proves anything
about silicon.

## Snapshot binding

Every `mage.layout-snapshot/2` carries its own `snapshotSha256` (a digest of its body with that
field left out). A `mage.script-candidate/1` names `startSnapshotSha256` and `snapshotSha256`, and
every boundary snapshot it references carries its own path and sha256 in `files.snapshots[]`.
Before using any number from a document, check that the sha it names is the sha of the snapshot you
are actually looking at — a journal observation bound to a stale or wrong snapshot is worthless even
if every number inside it is arithmetically correct. The Reader enforces this by rejection; you
enforce it by never hand-copying a number from one round's boundary into another round's document.

## Unknown stays unknown

`core.known(value)` / `core.unknown(reason)` are the only two shapes a Measure takes. An unbound
target, a re-mastered priority Fit the matcher cannot bind by exact id, or a native verify file a
stage did not produce, is `unknown` with a stated reason — never a guessed value, never a silent
`0`, never a default `pass`. `0` means "measured and found to be zero"; it is not interchangeable
with "not measured."

## Ordinary versus grouped drops

`metrics.drops` splits every dropped pending entry into `ordinary` (empty `inGroup`) and `grouped`
(non-empty `inGroup` — a Group-placed, priority mark). The two always sum to the plain `count`/
`lengthUm` totals; the Reader emits both splits as `mage_dropped_ordinary_count`/
`mage_dropped_ordinary_length_um` right alongside the existing `mage_dropped_count`/
`mage_dropped_length_um`. The comparison objective against the incumbent or the reference method is
**ordinary dropped length** — a dropped priority mark is a correctness problem on its own
(`priority-all-placed` already fails the round for it) and must never be folded into, or used to
inflate or deflate, the ordinary comparison. Report both lengths together with the total whenever
you report drops at all; never report one without the others.

## Identity: the F8 class

A mark's identity can be lost across stages even when nothing you did changed its geometry: an
auto-refine replay can re-suffix or re-master an in-group priority instance while keeping it in its
Group. `metrics.displacement`'s priority block matches a priority Fit to its start Fit by exact id
first, then by `(pinstGroup)` when that Group holds exactly one in-group Fit on both sides;
otherwise it is `unmatched`, and the movement maximum is `unknown` — never a silent `0`. Treat this
as its own diagnosis class, `identity-unknown`, distinct from a genuine drop, and never claim a
mark's identity is preserved across stages without an exact or Group-unique binding to show it. When
you hit it, say so plainly in the journal's `observations` rather than guessing which old mark a new
one "must be."

## Counterexample

A boundary's `stage-report` row can read `inGroupFits: 0` while `groups` stays at its full count —
the exact invalidation signature a settings edit after point placement produces on this build
(`script-method-playbook.md` §6). Reporting that boundary's export as "all priority placed" because
the Group records are intact, without reading `inGroupFits` itself, would be a stronger claim than
the evidence supports: the Group metadata surviving says nothing about whether any Fit is actually
bound to it. Read the row's own `inGroupFits` count before drawing any conclusion about what a
boundary did or did not preserve.
