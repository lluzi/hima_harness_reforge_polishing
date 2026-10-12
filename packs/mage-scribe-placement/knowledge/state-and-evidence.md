# State and evidence

## Source

- `flow/mage_placement/snapshot.py`, `flow/mage_placement/native/session.py`, `tools/read-mage.py`
  (the frozen module signatures in `mage-frozen-interfaces.md`).
- Spec `docs/superpowers/specs/2026-10-12-mage-scribe-placement-pack-design.md` §2, §7, §13 (the F8
  identity anomaly).

## Applies when

Every round, for every role: deciding what a number means, what a snapshot sha binds to, and what
to write when a fact cannot be established.

## Three kinds of fact, never mixed

- **Modelled.** `measure-incumbent`'s numbers on the retained incumbent, and a consumer's
  `evaluate` numbers on any candidate, are the Pack's own deterministic code run over a
  `mage.layout-snapshot/2`. They are real arithmetic on real geometry, but they are not a MAGE
  verdict: nothing in MAGE ran to produce them.
- **Native.** The ten `smVerify` check files (`verify-OVERLAP.txt` ... `verify-AUTOREFINE.txt`)
  under a round's `out/` directory are MAGE's own judgement, produced only by `mage-round`. A
  candidate's `metrics.nativeRows` and the Reader's `mage_native_<type>_rows` facts come from these
  files, never from the modelled snapshot.
- **Device.** No device data exists in this Pack. Native verification is prediction-only; it never
  stands for post-fab signoff. Say "natively verified" or "natively clean", never "correct" or
  "manufacturable".

Never report a modelled number as if it were native, and never claim a native check proves anything
about silicon.

## Snapshot binding

Every `mage.layout-snapshot/2` carries its own `snapshotSha256` (a digest of its body with that
field left out). A `mage.placement-candidate/1` names `startSnapshotSha256` and `snapshotSha256`; a
`mage.consumer-review/1` names the `snapshotSha256` of the exact candidate it reviewed. Before using
any number from a document, check that the sha it names is the sha of the snapshot you are actually
looking at — a review bound to a stale or wrong snapshot is worthless even if every number inside it
is arithmetically correct. The Reader enforces this by rejection; you enforce it by never
hand-copying a number from one round into another round's document.

## Unknown stays unknown

`core.known(value)` / `core.unknown(reason)` are the only two shapes a Measure takes. A missing
`consumerContext` parameter, a consumer model's `not_implemented` predicate (the Canon side-rule
gap), or a native verify file the round did not produce, is `unknown` with a stated reason — never a
guessed value, never a silent `0`, never a default `pass`. `0` means "measured and found to be
zero"; it is not interchangeable with "not measured."

## Identity: the F8 class

A mark's identity can be lost across stages even when nothing you did changed its geometry: the
reference case shows a Group label (`groupItem`/`pinstGroup`) relabel across stages that the
snapshot cannot resolve by exact `targetPointDbu` match. `targets.bind_targets` raises
`MageError('identity')` when a target binds to zero or more than one Group, or a Group has other
than exactly one Fit. Treat this as its own diagnosis class, `identity-unknown` — distinct from
every other diagnosis in `placement-playbook.md` — and never claim a mark's identity is preserved
across stages without an exact binding to show it. When you hit it, say so plainly in `unknown`/
`blocked` rather than guessing which old mark a new one "must be."

## Counterexample

Treating a consumer's modelled `edit_on_move` cost number as equivalent to a native `smVerify`
finding would let a Finding claim "native violation" when no native round ever ran against that
candidate. The schema keeps these separate on purpose: `mage.finding/1.evaluatorReceipt` always
names the modelled evaluator's own receipt file, never a native verify file, and
`mage.placement-candidate/1.files.verify` is the only place native check output lives. A reviewer
who blurs the two would report a stronger claim than the evidence supports.
