# AES 100-Cell cumulative-gain commercial observation

Date: 2026-09-16
Status: commercial P&R complete; primary Fmax result negative

## What was tested

This run exercised the cumulative-gain implementation against the same immutable
`aes_cipher_top` DC netlist, SDC, 0.5 ns clock, 0.175 ns route uncertainty, core/floorplan,
pin plan, foundry views, DCCK CTS policy and setup-only post-route flow used by the retained
baseline. The existing baseline was reused by exact identity; no baseline or DC arm was rerun.

The free phase mined 100 design-driven function/physical variants under the owner's 100-Cell
budget. The pool contained 50 native bool2cmos multi-output Cells and 50 single-output fusion or
cluster Cells. All 100 generated, all 100 passed abstract layout, and all 100 received learned-model
Liberty. D1 screening was too slow to form a complete positive portfolio, so the same 100 function
requirements were evaluated as D8 sizing variants. The final delta Library did not contain the
D1 proxy variants.

The endpoint-bound pool touched all 50 unique endpoints in the available baseline top-path report.
The stateful optimizer evaluated 461 non-conflicting site Actions, selected 11 Actions / 11 Cell
Demands, and projected WNS from -57 ps to -49 ps and frozen frontier deficit from 150 ps to 6 ps.
Nine selected Cells were dual-output and two were single-output physical fusions.

Before P&R, all 11 windows passed exhaustive truth-vector proof. Eight modified combinational leaf
modules passed Yosys equivalence. Two top-level replacements were composed from exact window proofs;
the structural patch had byte-exact rollback. LC T-2022.03 read, checked and wrote the 11-Cell D8
Library. The final result is still limited to learned timing and abstract LEF; it is not a GDS or
measured characterization result.

## Commercial results

| Metric | Frozen baseline | ECO, optimizer free | ECO, 11 Cells preserved |
| --- | ---: | ---: | ---: |
| Final custom instances | 0 | 0 | **11** |
| reg-to-reg WNS | -57 ps | -58 ps | **-75 ps** |
| Derived Fmax | 1795.33 MHz | 1792.11 MHz | **1739.13 MHz** |
| Fmax delta | — | -0.179% | **-3.130%** |
| TNS | -7.213 ns | -7.593 ns | **-8.799 ns** |
| Violating paths | 315 | 318 | **295** |
| Logic area | 22614.354 µm² | 22076.8 µm² | **18545.4 µm²** |
| Wire length | 188099.67 µm | 181355.345 µm | **167314.185 µm** |
| Modeled total power | 26.5230 | 26.2566 | **23.5288** |
| Route DRC | 5 | 2 | **9** |

The unprotected arm is not evidence of custom-Cell benefit: Innovus removed all 11 ECO instances.
It is retained because it exposed a missing ECO semantic. Multi-output and physical-fusion Actions
are ECO-only, so the corrected arm applied `dont_touch` to exactly those 11 instances. All 11 then
survived placement, CTS, route and post-route optimization.

The preserved arm improved area by 17.99%, wire length by 11.05%, modeled power by 11.29%, and the
violating-path count by 6.35%. It failed the primary objective: WNS lost 18 ps and Fmax lost 3.13%.
No secondary metric upgrades this run to success.

## What the run falsified

The available baseline report supplied one sampled worst launch path for almost every endpoint. It
did not supply the alternative launch paths inside each endpoint cone. The proxy therefore treated
endpoint coverage as complete even though it had only sampled top paths. After ECO, the worst path
migrated inside the same endpoints to launch/cone combinations that were not present in the free
state.

The loaded post-route timing also showed the mismatch directly. Seven custom masters appeared in
the top-100 report, across 98 custom path-stage rows; observed custom arc delays reached 67 ps. In
the new worst path, `XS_CGO_ENDPOINT_FRONTIER_MAPPED_SINGLE_0009_Y_D8` contributed 36 ps. The
learned-Liberty operating-point screen and the summed DC source-cover estimate did not bound these
loaded, routed conditions tightly enough.

Two implementation defects were found and fixed during the run:

1. post-route instance membership previously required the Innovus master to equal the DC master,
   discarding normal sizing/swaps and nearly all data-path cells;
2. a sampled top-path report could open the commercial gate. The gate now fails closed unless the
   endpoint frontier explicitly declares complete coverage.

The earlier malformed concatenated LEF attempt, the optimizer-free zero-adoption arm, and the
preserved negative arm remain in the Site workspace. They were not overwritten or rewritten into a
positive story.

## Decision

CGO-01 through CGO-07 now execute through real commercial observation. CGO-08 synthesis expansion
is skipped because the ECO result is negative. Another commercial observation is not admitted until
the free state contains multiple launch paths per endpoint (or an equivalent complete timing-cone
representation) and F3/F4 is recalibrated against the observed 33–67 ps custom arcs and path
migration.

Structured evidence and hashes are in
[`aes-cgo100-cumulative-gain.summary.json`](aes-cgo100-cumulative-gain.summary.json). The exact 11-Cell
function/timing Library delivered to LC is
[`aes-cgo100-selected-d8.lib.gz`](aes-cgo100-selected-d8.lib.gz). Raw reports, netlists, proofs, failed
attempts, route databases and generated assets remain at:

`/data/eda/project/hima_harness/polishing-runs/aes-cgo100-20260916-v1`
