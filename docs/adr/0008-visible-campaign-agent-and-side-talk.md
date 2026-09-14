---
status: accepted
---

# 由可见 Campaign Agent 执行业务，并允许独立 Side Talk

用户于 2026-09-14 决定：一个可见的 Campaign Agent 继续作为该 Campaign 持久 Run 的唯一业务 owner，并通过现有 `hima_context`、`hima_execute` 和 Fabric 约束执行节点；用户可以在同一 HimaHarness 中新开独立 Side Talk 进行普通对话或 Coding，切换会话不结束 Campaign、不改变 owner，只有显式 handoff 才转移执行权。该决定取代 ADR-0006 中“用户必须始终在同一个 owning conversation 内交互”的部分，保留 Agent 主导、Fabric/Ledger/Judge 保有事实权威以及禁止第二执行主脑的部分。

现有 DeepSeek Harness 已提供多个 live root Agent/Session、原生 New Session、会话切换和 Agent Registry，Hima 也已有 owner conversation 打开、非 owner 查看和 handoff，因此复用这些 seam，不增加第二 Hima Agent Loop、隐藏执行 Agent 或 side-chat 运行时。实现前以一个 L3 场景验证：Campaign Agent A 启动长任务后，用户创建会话 B 并完成普通对话；A 仍 live、Campaign 继续，B 不获得 owner 动作，显式 handoff 后旧 epoch 失效。
