"""Example insight rules: each reads lib-insight-facts/1 files and writes one rule object in the shape of
knowledge/insight-rule-shape.md (the page template draws it).

- vmin_bottleneck            kind vmin   cells that slow more than the inverter when the supply drops
- size_coverage_gaps         kind gaps   missing drive strengths inside a function's ladder
- critical_path_faster_cells kind path   faster equivalents of the cells on a timing report's worst paths
- table_spikes_kinks         kind spike  table points off the chord between their neighbours

Shared helpers: `facts` (loading, units, table lookup, naming, functional signatures) and `netlists` (cell SPICE
and gate-level Verilog). Each rule module has `run(...) -> dict` and `main(argv)`; run one from flow/ with
`python3 -m libinsight_analysis.rules.<rule> --help`. Standard library only, Python 3.6 through 3.12.
"""
