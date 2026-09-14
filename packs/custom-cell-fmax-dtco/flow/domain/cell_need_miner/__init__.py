"""Package-owned subset of the cell_need_miner prototype.

Only the three modules the bounded pattern search actually needs are packaged:
``liberty`` (skeleton + Liberty-function parsing), ``npn`` (exact NPN
canonicalization) and ``generator_contract`` (truth tables, timing sense,
equivalence digest, request validation).

The upstream ``__init__`` eagerly imported ``netlist``/``unmap``/``mine``/
``verify`` -- an AIG-based unmapper this Package does not use, because the
technology-independent graph is already supplied. Importing them here would make the
Package carry unexercised code, so this ``__init__`` deliberately imports
nothing.
"""

__all__ = ["liberty", "npn", "generator_contract"]
