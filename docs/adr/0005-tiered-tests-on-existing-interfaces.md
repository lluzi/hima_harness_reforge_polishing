---
status: accepted
---

# 按验证对象分层，复用真实 Host 与桌面 driver

用户于 2026-09-11 在生成 polishing spec 时明确要求按分级测试制度执行，不持续依赖最昂贵的 desktop 实际操作。Prototype ADR-0004 为证明用户窗口的真实行为，将 Step 3 测试统一放到 Electron driver；polishing 保留窗口行为的真实验证，把大量纯规则和执行状态组合放到已有函数接口、真实 dsh Host/HTTP 与本地受控作业中，按所改行为选择最低成本且有效的层级。这是 polishing 对上游该测试约定的明确调整，源 ADR 保持原样。

这不增加产品运行组件或新的测试框架，也不以自建假的 Host、Ledger 或 Fabric 替代集成测试。现有 driver 留给桌面交互，真实模型与 Site 分别做小规模依赖验证，完整研究和人工产品验收留给 pilot 候选版；迁移测试时保留对应的真实集成验证并说明原断言在哪里继续受到检查。详细方案见 [分级测试](/Users/lluzi/code/hima_harness_reforge_polishing/docs/testing-strategy.md)。
