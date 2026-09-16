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
| LFR-PACK-08 | blocked by PACK-07 and business exit | A Harness-owned positive matched E0 benefit observation and Harness-generated release seal remain |

No item is complete merely because code exists. Each item closes only with the evidence named in
the development document.
