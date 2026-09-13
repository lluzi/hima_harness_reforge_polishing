# [PLS-23] 通过编写流程交付 AES 的真实 Fmax probe Pack

Part of [#1](https://github.com/lluzi/hima_harness_reforge_polishing/issues/1) · [本轮规格](../../step4-takeover/spec.md)

GitHub: [PLS-23 / #26](https://github.com/lluzi/hima_harness_reforge_polishing/issues/26)

Blocked by: [PLS-19 / #22](https://github.com/lluzi/hima_harness_reforge_polishing/issues/22), [PLS-21 / #24](https://github.com/lluzi/hima_harness_reforge_polishing/issues/24), [PLS-22 / #25](https://github.com/lluzi/hima_harness_reforge_polishing/issues/25), [PLS-13 / #14](https://github.com/lluzi/hima_harness_reforge_polishing/issues/14)

承接来源：[上游 #65](https://github.com/lluzi/hima_harness_reforge_claude/issues/65)。原项目任务只读，完成状态由本仓库独立验证。

Triage: `ready-for-agent`。标签不解除依赖与真实资源前置；真人验收不能由 agent 代做。

## 目标与开工条件

Agent 基础、参数边界、作者流程与方法身份完成；真实 Site/模型/输入/预算具备后运行。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改内容与目标 |
| --- | --- |
| `packs/aes-tsmc28-dtco/` | 计划新增的正式 Pack 目录：先 probe，再在 PLS-25 扩展；不是新 Harness 组件 |
| `sites/` | 只按已核实环境补齐 Site 绑定与 Permit，运行配置留隔离 home |
| `packages/harness/skills/` | 复用五阶段流程；仅修复真实业务暴露的通用指令缺口 |
| `scripts/acceptance-step3.ts` | 复用审计/真实观测/重启回读的方法，不另建运行引擎 |
| `docs/validation/` | 保存 polishing 自己的 Pack bring-up、test Run 与 release 证据 |

## 修改内容

1. 只读学习 Golden Flow 与上游 Site 探测资料，重新核实当前输入、工具/库、wrapper、路径和资源。旧架构不迁入；从业务参考创建本仓库的 Pack 文件与工具。
2. 用作者流程形成 intent/spec/graph/contract/工具/reader/规则/知识，表达 foundry-only 综合、over-constraining、报告解释、不可变 Goal 和收敛条件。
3. 由 PLS-19 的同一对话 Agent 推进节点；每代保留 asked period、实测 slack、推导值与是否实际闭合。推导可达值不冒充测量结果。
4. 先本地闭环，再一个有界真实 Site probe；执行问题优先修 Pack/工具，通用缺口需最小反例和独立切片。最终 test record 与 release 由真实记录生成。
5. 向 PLS-09 交付有来源的有限输入、输入输出语义、一条可执行分析路线与独立校验方法；无需等全量 cell-mining 才提供研究输入。

## 验收标准

- [x] Pack 文件可独立交付，客户路径/凭据不硬编码进方法，安装后 check 能清楚表达缺口。
- [x] 真实 AES probe 在预算内给出稳定测量或诚实结束；无论 Goal 是否达成都保留实际报告/方法版本/环境。不能用 stand-in 收敛代替真实 probe。
- [x] 在相同有效条件下判断收敛；若工具报零 slack，策略不会因为添加 guard 而逐代无根据放宽。
- [x] 发布身份对应实际 test Run 的方法摘要；后续分析样本和算法校验入口实际可用。

## 分级测试

- L0/L2：Pack schema、方法对照、目标可达/不可达/故障、报告/来源校验。
- L4 模型：作者与节点执行使用指定 V4 Flash；可复用同一真实小任务的有效证据。
- L4 Site：只读预检后有界真实综合 probe，记录资源与实际作业数。
- L3：统一界面启动/观察一次；不做完整挖掘 L5。

## 交付证据

记录实际 commit、构建/Pack/输入/环境身份、命令及退出码、通过/失败/跳过/未跑、耗时、Host/窗口启动数、模型调用与 Site 作业数、材料 hash 和原断言去向。每个本地提交立即推送并核对远端 SHA。

## 不在范围内

不改只读源项目，不新增第二图/模型/知识/测试服务，不将 stand-in、replay 或上游历史记录称为本版本真实研究通过。纯重构只有本切片的有效反例或交付要求需要时才做。

## 回滚

保留已完成版本、workspace、Job 和负结果；回退方法建立新版本或恢复指定旧版本，不覆写既有发布身份。

## 实施验收

已完成。实际版本、原始失败、分级验证及边界见 [本轮交付](../../../validation/pls-frontier/probe-handoff.md)。不据此声明 PLS-09、PLS-25 或完整 L5 完成。
