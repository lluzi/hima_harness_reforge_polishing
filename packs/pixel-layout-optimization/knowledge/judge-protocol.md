# How every candidate is judged, and how to read what the judge says

Every candidate of a Run, the original included, is judged the same way, in its own directory, by
program tasks. Read this to understand a receipt; you never run the judge yourself.

## One candidate, separate sessions

For each candidate the judge writes the single cell and the 2×2 and 3×3 arrays at the cell pitch,
then runs, each in its own directory with its own report:

1. **Authority DRC**: Argus with the manifest's authority deck on each of the three layouts. Tiles
   matter: a shape that is legal alone can violate against its neighbour's copy.
2. **Reference DRC**: the same with the reference deck. Reported under its own name, never judged.
3. **Connectivity rules in geometry**: the manifest's `interactRules` (every shape of a layer must
   touch one of the listed layer intersections), checked by the Pack as well. Where the Site licence
   runs the deck's own `geom_interact` rules, Argus reports them too; where it cannot, they are
   stripped from the deck and this geometry check is the only one.
4. **LVS** against the declared schematic, with the deck's W/L/C tolerances. The Site declares the
   engine: Argus with the customer's own LVS deck where the licence allows it (as on the reference
   Site), or a validated translation for another engine.
5. **Extraction**: the candidate's GDS imported into a fresh library (holding only the technology
   files), then RCExplorer pixel extraction with the boundary condition of the manifest's Tcl
   template. The net-pair capacitances come from its `RCEResult.sp`.
6. **Geometry**: outline, channel congruence, capacitor-marker device value, transmittance tiled and
   own-cell, emission area, the PDL-symmetry figure.

Each report's path and sha256, and the options it was made under (deck digests, the
`layout_use_db_precision( yes )` setting, the LVS deck and schematic digests, the extraction set,
the tool versions), go into the candidate's `receipt.json`.

## Sources of a number

| Source | Meaning | Judged? |
|---|---|---|
| `measured` | Read from a tool's own report | Yes |
| `geometry` | Computed by the Pack on the candidate's GDS | Yes |
| `estimated` | From the fitted model | No; only ranks moves |
| `unknown` | No report states it | Never a PASS |

Zero and unknown are different. A DRC run that wrote no summary is unknown, not clean. An
extraction whose import failed or whose result file is empty is unknown, not zero coupling.

## What the Reader refuses

The `pixel-receipt` Reader re-parses every report the receipt names and counts as receipt errors:
a missing or changed report, an option that disagrees with the case-readiness record, a library
not freshly made for the candidate (an old library would be extracted silently instead of the
candidate), and a stripped deck rule with no geometry check. A candidate with receipt errors is
never legal.

## The four counterexamples the judge was built to survive

1. An extraction whose GDS import failed reads as unknown, never as zero coupling.
2. A DRC run that produced no summary file is a refusal, not a clean result.
3. A layout whose anode net is open fails LVS.
4. A layout with an enlarged storage capacitor and an unchanged schematic fails LVS on its
   capacitance tolerance, and its ratio is not credited.

`judge-original` also judges two mutants the Pack makes from the original (one contact removed;
one space shrunk below its rule). If the judge passes either, the Run stops before any work: a judge
that cannot fail is not a judge.

## Previews

`try-edit` runs only the authority deck on the single cell and the 3×3 tile, in your private
workspace. It shows whether an edit clears a marker. It is never a judgement: the edited layout is
judged in full only when a plan carrying the edit is solved and judged by the program.
