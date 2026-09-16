# Fresh AES 50-Cell E0 timing diagnosis

Date: 2026-09-16  
Source observation: [Fresh AES 50-Cell Framework-to-E0 observation](2026-09-16-fresh-aes-50cell-e0.md)  
Machine-readable summary: [`fresh-aes-50cell-root-cause.summary.json`](fresh-aes-50cell-root-cause.summary.json)

## Conclusion

The generated arm's -2.792% Fmax result is not explained by one universal XS Cell-delay inflation.
The strongest observed cause is path migration plus different launch/capture clock timing and setup
cost after the changed netlist passes through placement, CTS and route. Logic compression is real on
some paths, but it is not preserved consistently at route. The mock Liberty model and the D1-only
Library remain material secondary risks: they remove much of the cell-delay margin and are too
uncertain for a 5% Fmax target.

No algorithm or Pack behavior was changed during this diagnosis, and no EDA job was rerun.

## 1. Final reg-to-reg timing difference

The final-database comparison covers the 100 reported worst flop-to-flop paths from each arm. These
are two ranked samples, not 100 matched path pairs: only six beginpoint/endpoint pairs appear in both
reports.

| Top-100 mean unless stated | Foundry | Generated | Generated - foundry |
| --- | ---: | ---: | ---: |
| Slack median | -48 ps | -56 ps | -8 ps |
| Slack mean | -48.17 ps | -56.06 ps | -7.89 ps |
| Data arrival | 410.87 ps | 415.33 ps | +4.46 ps |
| Required time | 362.66 ps | 359.28 ps | -3.38 ps |
| Combinational stages | 15.92 | 15.15 | **-0.77** |
| Combinational Cell delay | 276.95 ps | 277.53 ps | +0.58 ps |
| Net delay inside the data segment | 14.81 ps | 13.30 ps | -1.51 ps |
| Clock-to-Q | 64.53 ps | 65.12 ps | +0.59 ps |
| Launch clock arrival | 52.84 ps | 57.62 ps | **+4.78 ps** |
| Capture clock arrival | 52.03 ps | 50.93 ps | **-1.10 ps** |
| Setup cost | 14.37 ps | 16.73 ps | **+2.36 ps** |

The data Cell, net and clock-to-Q changes nearly cancel. The later launch clock, earlier capture
clock and larger setup cost account for most of the average slack loss. This is an accounting over
the two worst-path samples, not proof that CTS alone caused every endpoint's regression.

The generated top-100 contains 61 paths with at least one XS Cell and 39 without one. Their median
slacks are -55 ps and -56 ps respectively. Paths without XS are therefore not protected from the
regression: the changed Library alters synthesis, placement, sizing, CTS and the set of paths that
become critical even when a final sampled path contains no retained XS instance.

For the six common register pairs, the generated paths have a median 2.5 fewer stages and 5.5 ps
less Cell delay, but 14.5 ps more net delay. Three XS-bearing common paths remove 3–5 stages and
reduce Cell delay by 4–8 ps, yet add 14–18 ps of net delay. This is direct evidence that some mined
logic works logically but loses its margin in physical realization.

## 2. Why the generated report looks broadly worse

The two reports have 94% path-pair migration. The generated arm also has 13 audited DCCK clock-tree
Cells versus 10 in the foundry arm. Both comply with the same DCCK-only policy, core, pin plan and
route uncertainty, but the changed data netlist leads CTS to a different legal tree and changes
launch/capture skew. The generated worst-path population also carries a larger average setup cost.

This explains why the degradation appears broad instead of limited to rows displaying an XS master.
The final comparison still remains valid: clock-tree and physical consequences are part of the
Library change. They must be modelled as factors if the free layer is to select better Libraries.

## 3. Logic depth and netlist structure

The DC top-20 timing samples show an improvement before physical design:

| DC top-20 mean | Foundry | Generated |
| --- | ---: | ---: |
| Reg-to-reg WNS | -100 ps | -90 ps |
| Stages | 17.95 | 17.70 |
| Cell delay | 331.5 ps | 311.5 ps |

Module-local graph analysis gives a mixed result. It counts combinational levels inside each Verilog
module and does not cross hierarchy boundaries.

- At DC, `aes_cipher_top` improves from depth 9 to 6 and loses 320 combinational instances, but among
  all 23 modules only 8 improve, 5 remain equal and 10 become deeper.
- Post-route, `aes_cipher_top` contains 390 fewer combinational instances but its local maximum depth
  changes from 11 to 12. Across 23 modules, 8 improve, 6 remain equal and 9 become deeper.
- The final top-100 timing paths are slightly shallower on average, while their total Cell delay is
  unchanged. The average delay per surviving stage is therefore higher.

The mining strategy does reduce logic in useful places, but it does not yet optimize for
**depth-reduction survival through physical implementation**. Whole-design instance reduction is
not a substitute for that factor.

## 4. Mock Liberty assessment

XS output-arc delays observed on the generated final top-100 paths range from 17 to 54 ps, with a
29 ps median and 38 ps P90. Ordinary combinational output arcs on the same paths have a 17 ps median.
The comparison is not one-for-one: one XS Cell represents a multi-level Boolean cone. The proper
question is whether its delay is below the removed cone delay at the realized slew and load.

The generated Library has one D1 implementation per function. Its feature distribution is inside
the training maxima, so this is not a gross extrapolation beyond the training set. It is, however,
weak and stack-heavy relative to the training center:

| Feature median | Training arcs | XS arcs |
| --- | ---: | ---: |
| Total devices | 20 | 16 |
| N series depth | 1 | 2 |
| P series depth | 1 | 3 |
| Output N width sum | 1.12 | 0.56 |
| Output P width sum | 1.36 | 0.68 |

Every routed XS instance has fanout one, often because it directly drives the endpoint; 45 of the 73
XS occurrences in the top-100 timing tables are the last combinational stage. A stronger XS variant
could therefore reduce the final arc without changing logic depth, but the current Library gives
DC/Innovus no XS sizing choice.

As a diagnostic, nearest foundry training arcs in the model's feature space have lower measured
intrinsic delay than the generated prediction: the predicted/neighbor ratio is 1.11 at the median,
1.43 at P90 and 2.21 at the maximum. This is an approximate neighbor comparison, not measured
characterization of the new Cell.

The model's retained validation also leaves little margin for a 5% target:

- intrinsic delay HGB cell-held-out median error: 14.6–15.7%; P90: 40.5–42.9%;
- reconstructed HGB-v2 delay-table median error: 9.8–11.7%; P90: 41.4–42.4%.

This evidence supports treating mock timing uncertainty as a real factor. It does not prove a
uniform positive bias or make the mock model the primary cause of this E0 result. Measured SPICE
characterization of the routed critical XS masters is required to establish signed model error.

## Root-cause ranking

1. **Supported, primary:** physical path and clock migration. Only 6/100 path pairs match; clock and
   setup accounting dominates the mean slack difference; no-XS paths regress too.
2. **Supported:** synthesis compression is not consistently preserved through route. DC top-level
   depth improves 9 to 6, post-route depth changes 11 to 12, and module results are mixed.
3. **Partially supported:** XS delay consumes the compression margin. XS arc delay is higher per
   stage and final total Cell delay stays flat despite fewer stages, but common XS paths often still
   reduce Cell delay.
4. **Not proven as primary:** a systematic mock-delay bug. Model uncertainty and neighbor pessimism
   are substantial, but the sample does not show every XS Cell or every XS path as the source of the
   regression.

## Method implications for the next design step

The next Framework revision should be specified around four measurable factors before another E0:

- predicted XS delay margin against the complete removed cone at matched slew/load, with model
  uncertainty retained;
- more than one drive variant for functions expected on critical endpoints, within the same total
  Cell budget;
- survival of synthesis depth/Cell-delay benefit after a license-free physical proxy or after
  retained post-route feedback;
- launch/capture clock, setup, net-delay and path-migration indicators kept separate from logic
  compression.

The current E0 gate semantics need not be rewritten from one sample. This sample should enter the
factor-history used to decide which new factor has positive association with later E0 benefit.

## Evidence and limits

The deterministic diagnostic command set was run twice and produced byte-identical outputs:

- timing decomposition: `e63f2406c4ab7a1a3cdd6612c70a93616e45d0fdaa9ed2168674ebf6575e3e66`;
- netlist module-depth analysis: `840f92fb8428cfd3cdf5933587390e99b63df841771f0b8ef8cd94ef8d76929d`;
- mock-model/feature analysis: `673ea6836cd52c1ddb44e3c5bb45945b4de49e59e193f84bad619ba91c1bd5c0`;
- XS fanout analysis: `331555a9ac2d3482361aad5d1b335a45bed78a0f490bde24eb621a370e9e7d3a`.

Raw reports, netlists, model files and generated Cell assets remain under
`.hima-tmp/lfr-aes-fresh-50-20260915/diagnosis/` and are not committed. The top-100 and top-20
reports are ranked samples; module-local depth excludes hierarchy crossings; nearest-neighbor model
comparison is not an actual new-Cell characterization.

