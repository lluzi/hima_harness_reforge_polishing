# Library Function Richness Framework development track

Status: planned

This directory tracks the Package-specific development of the Library Function Richness
Optimization Framework for `packs/custom-cell-fmax-dtco`.

It is deliberately separate from the Product Upgrade v2 PLS task line. Work in this track uses the
identifiers `LFR-FW-*` for the independently exercised Framework and `LFR-PACK-*` for its HimaPack
integration. It does not create PLS-36, PLS-37 or PLS-38.

GitHub tracker: [#40 — Build and integrate the Library Function Richness Framework](https://github.com/lluzi/hima_harness_reforge_polishing/issues/40)

- [中文开发文档](framework-development.zh-CN.md)
- [English development document](framework-development.en.md)
- [Methodology design](../../specs/product-upgrade-v2/library-function-richness-optimization-framework.md)
- [Current HimaPack](../../../packs/custom-cell-fmax-dtco/)

The Chinese and English documents carry the same section and task identities. The Chinese document
is authoritative if wording diverges. Method evidence and Pack-release evidence remain separate:
the first proves that the optimization Framework deserves use; the second proves that HimaHarness
can execute the resulting HimaPack correctly.

## Track status

| Work item | State | Exit |
| --- | --- | --- |
| LFR-FW-01 through LFR-FW-08 | planned | Standalone Framework assessment accepted; no commercial EDA search loop |
| LFR-PACK-01 through LFR-PACK-08 | blocked by Framework assessment | Pack check, test Campaign and release evidence complete |

No item is complete merely because code exists. Each item closes only with the evidence named in
the development document.
