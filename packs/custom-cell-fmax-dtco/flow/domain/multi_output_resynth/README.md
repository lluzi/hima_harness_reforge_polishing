# Multi-output netlist resynthesizer

This directory is the isolated logical-ECO POC owned by the
`custom-cell-fmax-dtco` Pack. Its public interface is:

```text
../hima-mo-resynth --request request.json --result result.json
```

The Python service reads a hash-bound structural netlist and Liberty, builds a
bounded three-input/two-output cut index, joins only vector functions admitted
by the allowed Library masters, selects disjoint windows, emits a reversible
structural ECO, proves each window exhaustively, and requires Yosys top
equivalence before publishing a changed netlist. Analysis may run without
Yosys. A changed rewrite fails closed when Yosys is absent or inconclusive.

`main.cpp` is a diagnostic against mockturtle commit
`0886ebfdd101ce1110daf3d60b96d72edd3143ea`. It intentionally contains only the
upstream ripple-adder fixture and a held-out non-FA fixture. It does not emit an
ECO and is not the public interface. This keeps mockturtle's whole-network
renaming and experimental HA/FA assumptions out of the provenance-sensitive
patch path.

The normal L0 suite does not download or build third-party tools. The retained
POC evidence records the pinned source hash, compiler invocation, fixture
results, portable Yosys identity, and zero commercial-tool jobs.
