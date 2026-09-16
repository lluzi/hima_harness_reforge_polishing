# AES 10-cell multi-output logical ECO evidence

Date: 2026-09-16

## Result

Yes: ten new, P-canonically distinct multi-output Cell functions were inserted
successfully into a real AES Design Compiler netlist. The experiment replaced
23 existing single-output instances in `aes_sbox_0` with ten explicit
multi-output instances while preserving the delivered hierarchy. Yosys proved
the complete `aes_cipher_top` equivalent, and patch rollback reproduced the
original DC netlist SHA-256.

This is a **logical ECO result**. The Cells are function-only models. They have
no characterized delay, power, physical layout, LEF, DB, pin-access or routing
evidence, so this result does not establish commercial-tool adoption or Fmax
benefit.

## Inputs

- Design: AES, proof top `aes_cipher_top`, ECO subject `aes_sbox_0`.
- Netlist: real DC X-2025.06-SP3 output, 921,076 bytes, SHA-256
  `704006dc6a6ea98a8a508ef8f8b60915830e6d9801c327f5c384d9c720fd0762`.
- Library functions: the matching TSMC28 Liberty was read locally for Boolean
  identity and pin direction. It is not copied into Git.
- Licensed-tool jobs in this experiment: LC 0, DC 0, Innovus 0. The existing DC
  netlist was reused as the immutable input.

## Candidate construction

The miner enumerated bounded three-input cuts in `aes_sbox_0` and indexed roots
by common ordered leaves and exact output function. It inspected 1,399 cuts in
1,005 leaf buckets, performed 692 function-local pair checks and found 113
windows whose derived boundary was complete. No bucket overflow occurred.

The first selection used raw truth-vector numbers and exposed a real defect:
ten labels collapsed to seven Cell types after input permutation and output
exchange. The final selection therefore canonicalized the two outputs under one
shared input permutation, grouped output exchange, and then chose ten disjoint
families. None matches the foundry's existing HA `(2,6,8)` or FA `(3,150,232)`
multi-output signature.

| Cell | Inputs | P-canonical output tables | AES windows | Removed in chosen window |
| --- | ---: | --- | ---: | ---: |
| HMO_AES_VEC_01_D1 | 2 | 7, 8 | 41 | 3 |
| HMO_AES_VEC_02_D1 | 2 | 1, 14 | 25 | 2 |
| HMO_AES_VEC_03_D1 | 2 | 2, 13 | 18 | 3 |
| HMO_AES_VEC_04_D1 | 2 | 1, 11 | 6 | 2 |
| HMO_AES_VEC_05_D1 | 2 | 7, 11 | 6 | 2 |
| HMO_AES_VEC_06_D1 | 3 | 2, 253 | 2 | 3 |
| HMO_AES_VEC_07_D1 | 2 | 1, 7 | 3 | 2 |
| HMO_AES_VEC_08_D1 | 3 | 1, 254 | 3 | 2 |
| HMO_AES_VEC_09_D1 | 2 | 2, 7 | 2 | 2 |
| HMO_AES_VEC_10_D1 | 2 | 11, 13 | 2 | 2 |

The exact function-only definitions are retained in
[`aes-10mo-logical-cells.lib`](aes-10mo-logical-cells.lib). `area: 0.0` is an
explicit placeholder and must not enter an area comparison.

## ECO and proof

- Ten new Cell types were all adopted exactly once.
- 23 source instances were removed and ten instances inserted: net reduction 13.
- Netlist size changed from 921,076 to 920,724 bytes.
- Every window passed exhaustive truth-vector proof.
- Whole-design Yosys 0.69 `equiv_make`, `equiv_simple`, and
  `equiv_status -assert` passed from `aes_cipher_top`.
- The proof record binds the original netlist, rewritten netlist and generated
  Cell models by SHA-256.
- Rollback restored input SHA-256
  `704006dc6a6ea98a8a508ef8f8b60915830e6d9801c327f5c384d9c720fd0762`.

Structured identities, selected instances and functions are in
[`aes-10mo-logical-eco.summary.json`](aes-10mo-logical-eco.summary.json). Raw
netlist, proprietary Liberty and proof workspace remain under
`.hima-tmp/aes-mo-eco-20260916/` and are not published.

## Next gate

The logical resynthesizer can perform the requested AES ECO. The next separate
gate is physical realization: select a smaller subset by estimated topology
sharing and locality, create real multi-output layouts and timing models, then
check link, placement, routing, final master census and matched Fmax. The
current result must not be used as evidence for those claims.
