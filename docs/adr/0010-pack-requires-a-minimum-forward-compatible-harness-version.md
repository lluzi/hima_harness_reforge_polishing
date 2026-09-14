---
status: accepted
---

# Pack 只依赖最低的向前兼容 Harness 版本

用户于 2026-09-14 决定：HimaPack 与 HimaHarness 分开交付，Pack 只声明一个最低 Harness 版本，HimaHarness 对既有 Pack 保持向前兼容；准备阶段用普通版本依赖判断是否可运行，不建立严格 capability negotiation 或精确版本锁。Pack 作者声明的开发、试用或发布状态只用于展示，不改变兼容检查和 Runtime 执行逻辑；真正无法向前兼容的变化必须提升 Harness 主版本并提供明确迁移。
