# Multi-output Netlist Resynthesizer isolated POC evidence

Date: 2026-09-16
Scope: logical in-place ECO only; no Pack graph integration, placement, route,
commercial timing, or Fmax claim.

## Implemented boundary

The Pack-local `hima-mo-resynth` command now accepts the frozen request/result
schema. It hash-binds the input netlist and Liberty, preserves the selected top,
ports and hierarchy text, builds a bounded three-input/two-output multi-level
cut index, uses a Library function-pair hash join, and deterministically chooses
non-overlapping windows. Directed mode derives each boundary from actual
driver/load facts and compares it with the caller's expected boundary.

For rewrite, the tool emits explicit allowed multi-output instances through a
structural IR edit, records the removed and inserted fragments, reconstructs
the exact original SHA-256 through rollback, proves the window truth vector,
then runs Yosys top equivalence. A changed netlist is not published when the
proof backend is absent, fails, times out, or returns unknown. All outputs keep
commercial timing, physical benefit and Fmax claims false.

## Falsifying tests

- L0 domain suite: 11/11 focused resynthesizer tests passed.
- L0 domain regression: 75/75 domain tests passed after this implementation.
- Non-FA held-out vector: an AND/OR pair is matched to `MO_ANDOR` by exact
  two-output truth vector, independent of the HA/FA form.
- Multi-level vector: two two-level cones are found from a three-leaf cut and
  replaced by one exact two-output master.
- Eight-stage ripple fixture: the Hima cut/provenance layer selects eight
  disjoint full-adder replacements.
- Scaling fixture: 20 independent opportunity groups produce 20 pair checks;
  discovery does not enumerate all root pairs. Bucket overflow refuses rather
  than entering an unbounded pair loop.
- A changed HA rewrite passed portable Yosys 0.69
  `equiv_make`, `equiv_simple`, and `equiv_status -assert`; exact rollback also
  restored the input hash. A second proof kept two DFF instances as formal
  black-box boundaries and proved the rewritten combinational logic feeding
  their D pins.
- Tampering the requested vector fails before rewrite; removing Yosys refuses a
  changed rewrite and publishes no rewritten netlist.
- With no allowed multi-output Library, rewrite is byte-identical to the input
  and uses the input SHA-256 as its identity proof.

## Pinned mockturtle finding

The diagnostic source was compiled against mockturtle commit
`0886ebfdd101ce1110daf3d60b96d72edd3143ea`.

| Fixture | mapped gates | multi-output gates | result |
| --- | ---: | ---: | --- |
| upstream-equivalent 8-bit ripple adder | 8 | 8 | upstream HA/FA path works |
| held-out AND/OR two-output vector | 2 | 0 | pinned upstream does not perform the generic mapping |

The second row is a retained negative result. The product tool therefore does
not claim that pinned `emap` discovers arbitrary two-output Cells. Hima's exact
Library-vector cut join discovers the held-out opportunity, while mockturtle is
kept as a diagnostic mapping factor until its generic coverage is extended and
re-proven.

## Unverified exits

The POC has not yet consumed a real DC AES netlist, generated an OpenROAD
placement locality result, handled DEF/SPEF, emitted vendor ECO Tcl, or run
LC/DC/Innovus. It has not shown area, timing, route, adoption, or Fmax benefit.
Those are later gates; this evidence proves only bounded opportunity discovery,
reversible structural ECO, and exact logical equivalence.
