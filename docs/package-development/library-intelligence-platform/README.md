# LibInsight development track

LibInsight is the unified HimaHarness capability for Liberty (`.lib`) and LEF (`.lef`) evaluation, including
geometry-based pin access probabilities and traceable cross-view cell/pin analysis. The canonical scope is in
[the product definition](../../product-definition.md#libinsight-产品面).

Status: the existing bounded Liberty E1–E4 implementation and dated validation scope are recorded in
[S11](../../specs/next-stage-implementation/S11-library.md). LEF/pin-access probability work has research and
model definitions; implementation and combined evaluation are pending. Historical directory, Pack and protocol
identifiers remain stable; this product-scope update does not migrate released assets.

User-designated feature prototype: `/Users/lluzi/code/lib_insight`, read-only. Its existing Library analysis is the
functional reuse baseline, separately from Hima's bounded E1–E4 slice. See the
[source-grounded capability audit and 274-test receipt](research/prototype-capabilities.zh-CN.md).

Start here:

1. [Canonical competitive and Liberty strategy](competitive-liberty-strategy.zh-CN.md)
2. [Claude Code prototype execution brief](CLAUDE-CODE-PROTOTYPE-BRIEF.md)
3. [DeepSeek Harness BI/plugin reuse](deepseek-harness-bi-plugin-reuse.md)
4. [Competitor capability atlas](research/competitor-capability-atlas.md)
5. [Liberty semantic-to-chip-value map](research/liberty-semantic-value-map.md)
6. [First falsifiable implementation slice](first-slice-spec.md)
7. [Environment qualification](environment-qualification.md)
8. [Research verification](research-verification.md)
9. [Current QuaLib 2026 bounded qualification](qualification/2026-09-24-qualib-2026.md)
10. [Standard cell pin accessibility analysis and modeling research](research/pin-accessibility-report.zh-CN.md) — physical-view requirements, academic/industrial methods and validation boundaries; research only.
11. [LEF geometry based pin access probability model](research/pin-access-probability-model.zh-CN.md) — first-principles events, blocked-pose sets, joint resources, probability metrics and future calibration; proposed model with exact synthetic checks.

Research control artifacts:

- [Research contract](research-contract.md)
- [Main evidence ledger](evidence-ledger.md)
- [Competitor evidence](research/competitor-evidence.md)
- [Liberty semantic evidence](research/liberty-evidence.md)

GitHub tracker: [#49](https://github.com/lluzi/hima_harness_reforge_polishing/issues/49)

No document in this directory claims that Hima already exceeds DigWise, Solido, PrimeLib, Liberate or QuaLib. The
current product thesis is that design-conditioned evidence and a safe, replayable finding-to-action loop can create a
defensible advantage. It remains subject to API qualification and real user/task validation.
