# Library Function Richness Framework development track

Status: in development

This directory tracks the Package-specific development of the Library Function Richness
Optimization Framework for `packs/custom-cell-fmax-dtco`.

It is deliberately separate from the Product Upgrade v2 PLS task line. Work in this track uses the
identifiers `LFR-FW-*` for the independently exercised Framework and `LFR-PACK-*` for its HimaPack
integration. It does not create PLS-36, PLS-37 or PLS-38.

GitHub tracker: [#40 — Build and integrate the Library Function Richness Framework](https://github.com/lluzi/hima_harness_reforge_polishing/issues/40)

- [中文开发文档](framework-development.zh-CN.md)
- [English development document](framework-development.en.md)
- [Methodology design](../../specs/product-upgrade-v2/library-function-richness-optimization-framework.md)
- [Methodology v2 implementation specification](methodology-v2.zh-CN.md)
- [累计收益驱动的协同优化方法学 v3](cumulative-gain-cooptimization-v3.zh-CN.md)
- [Post-route Design Information Graph 驱动的协同优化方法学 v4](postroute-design-information-graph-methodology-v4.zh-CN.md)
- [第一性原理与 Active Frontier 驱动的协同优化方法学 v5](first-principles-frontier-methodology-v5.zh-CN.md)
- [Information Graph 数据库与开源基础设施选型](information-graph-database-technology-selection.zh-CN.md)
- [Multi-output netlist resynthesizer specification](multi-output-resynthesizer.zh-CN.md)
- [Multi-output resynthesizer isolated POC evidence](evidence/2026-09-16-multi-output-resynthesizer-poc.md)
- [AES ten-cell multi-output logical ECO](evidence/2026-09-16-aes-10mo-logical-eco.md)
- [AES 20-cell multi-output commercial P&R](evidence/2026-09-16-aes-mo20-commercial-pnr.md)
- [AES hierarchy-scaled 40-cell 2/3-output commercial result](evidence/2026-09-16-aes-mo40-hier3-commercial.md)
- [AES 100-Cell cumulative-gain commercial observation](evidence/2026-09-16-aes-cgo100-cumulative-gain.md)
- [Third-party theory review](evidence/2026-09-16-third-party-theory-review.md)
- [Current HimaPack](../../../packs/custom-cell-fmax-dtco/)

The Chinese and English documents carry the same section and task identities. The Chinese document
is authoritative if wording diverges. Method evidence and Pack-release evidence remain separate:
the first proves that the optimization Framework deserves use; the second proves that HimaHarness
can execute the resulting HimaPack correctly.

The open-source layer is a multi-index evaluation agent, not a commercial-QoR predictor. F0 is the
feasibility prerequisite; F1 local structure, F2 design mapping and F3 timing are parallel free
factors over one candidate Library. Matched commercial E0 is the expensive observed result. The
Framework retains condition-labelled factor/E0 relationships and advances a Pareto frontier instead
of fitting a portable benefit forecast.

## Track status

| Work item | State | Exit |
| --- | --- | --- |
| LFR-FW-01 | complete | Frozen identity-only corpus; no raw Site evidence in Git |
| LFR-FW-02 | complete | Deterministic paired Yosys/ABC adapter and real FW-T2 smoke |
| LFR-FW-03 | complete | Strict Liberty, flat mapped-netlist reg2reg evaluation and fail-closed limits |
| LFR-FW-04 | complete | Available F0/F2/F3 baselines placed beside retained E0 observations; F1 remains a declared gap |
| LFR-FW-05 | complete | Multi-index influence, full-cone counterfactual and verified pre/post-mapping portfolio |
| LFR-FW-06 | complete | Immutable shards, disk hash verification, delta-only Jobs and state history |
| LFR-FW-07 | complete | Real held-out mapping rounds, cross-round frontier, DeepSeek residual code and bounded execution |
| LFR-FW-08 | complete | Independent assessment approved Phase 2; no commercial EDA search loop |
| LFR-PACK-01 through LFR-PACK-06 | complete | Intent/Spec, contract, graph, stage dispatch, Readers/Judges and residual Workshop wrap the assessed Framework |
| LFR-PACK-07 | in progress | Local contracts and real Yosys/ABC integration pass; Harness-owned test Campaign and Ledger evidence remain |
| Fresh AES 50-Cell standalone E0 | complete, negative | Fresh F0-F3 admitted one Library; matched E0 observed -2.792% Fmax, so it is relationship evidence rather than a release candidate |
| AES 10-cell multi-output logical ECO | complete, logical only | Ten P-canonical Cell types replace 23 instances with ten explicit masters; whole `aes_cipher_top` equivalence and rollback pass |
| AES 20-cell multi-output commercial P&R | complete, model-conditioned positive | Innovus retains 6/20 masters; Fmax +0.180%, logic area -7.274%, wirelength -6.507%, modeled power -4.294% |
| AES 40-cell hierarchy 2/3-output P&R | complete, negative | 40/120 instances retained; 22 triple-output instances survive, but Fmax -0.179%, area +9.181%, wirelength +2.669%, modeled power +7.071% vs baseline |
| Post-route DIG v4 | observation calibration implemented | Free proxies are observation-only; source-cover 5%/10% Mock Liberty, single/multi CCEI and two matched AES E0 runs completed. Best Fmax +1.085% with area/power cost; full PPA and 5% target remain open |
| First-principles frontier v5 | implemented; first AES E0 complete, 5% target negative | PG/DCAP/85%/full-placement baseline and 530-endpoint DIG are real; WNS 0%, TNS +0.756 ns, area/wire/power improved; next work is the residual 127-endpoint frontier and PG DRC tuning |
| LFR-PACK-08 | blocked by PACK-07 and business exit | A Harness-owned positive matched E0 benefit observation and Harness-generated release seal remain |

No item is complete merely because code exists. Each item closes only with the evidence named in
the development document.
