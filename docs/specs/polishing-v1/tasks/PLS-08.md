# [PLS-08] 验收 Step 4 基础接收与正式 probe 交接

Part of [#1](https://github.com/lluzi/hima_harness_reforge_polishing/issues/1) · [接续规格](../../step4-takeover/spec.md)

GitHub: [PLS-08 / #9](https://github.com/lluzi/hima_harness_reforge_polishing/issues/9)

Blocked by: [PLS-20 / #23](https://github.com/lluzi/hima_harness_reforge_polishing/issues/23), [PLS-22 / #25](https://github.com/lluzi/hima_harness_reforge_polishing/issues/25), [PLS-23 / #26](https://github.com/lluzi/hima_harness_reforge_polishing/issues/26)

## 目标与开工条件

本任务从“等待上游完整 Step 4”改为 polishing 的递进交接验收。PLS-20 可以立即整合固定快照；PLS-22 补齐作者流程，PLS-23 提供正式 probe 后，本任务才可关闭。它不包含第二份导入实现，也不要求 Claude Code 恢复额度。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 核对内容 |
| --- | --- |
| `docs/specs/step4-takeover/baseline.json` | 计划中的 B/P/U，不当作已完成导入清单 |
| `docs/assessment/2026-09-11/source-import.json` | 原映射；本轮由 PLS-20 新建独立证据，不覆盖此文件 |
| `packages/harness/src/moments.ts`、`node-turns.ts`、`authoring.ts` | 导入后模型/Workshop/作者能力与 PLS-19 执行所有权的实际接口 |
| `packages/harness/src/pack-folder.ts`、`release.ts`、`packs.ts` | 方法身份、安装/发布与运行资产边界 |
| `packages/harness/src/tools.ts`、`remote.ts` | 从实际对话进入作者/Run/节点工具的生产路径 |
| `packs/aes-tsmc28-dtco/` | PLS-23 计划创建的正式 probe、分析样本与版本身份 |

## 修改内容

1. 对账 PLS-20 的导入来源、保留成果、重叠处理、覆盖迁移和兼容记录；不把导入完成写成 Step 4 完成。
2. 按真实生产入口清点模型、Pack reader/知识、Workshop、五阶段作者、安装自足性和正式 probe；记录模块、符号、输入输出、样本与测试 SHA。
3. 核对同一 Agent 的执行方式已由 PLS-19 接通，旧 drive/独立默认 moment 不冒充新主路径。
4. 确认 PLS-09 可使用的有限分析输入、可执行分析路线、独立校验方法及来源。原先“正式 Pack 至少一条挖掘/分析路线”的要求在 probe 分析路线落实；完整挖掘由 PLS-25 承接，不能声称已完成。

## 验收标准

- [ ] PLS-20/22/23 的独立证据完整，代码与源目录无共享可写运行依赖。
- [ ] 已交付 PLS/UI 行为继续成立；外部真实模型/EDA 的来源证据和本地重新验证区分明确。
- [ ] 正式 probe 的方法版本、test Run、release 和真实输入输出可复核，后续 AI 研究有可用样本及独立 oracle。
- [ ] 接口清单说明已完成、未完成、未验证；完整挖掘、附加研究、资产交付和 L5 没有因本任务关闭而被暗示完成。

## 分级测试

- L0–L3：审阅各依赖的适用证据及固定 SHA；不为关闭交接任务机械重跑同一套测试。
- L4 模型/Site：复用 PLS-19/22/23 本轮实际执行的证据，遇接口或版本变化才补测。
- L5：不在本任务运行；由 PLS-18/26 负责。

## 交付证据

记录实际 commit、构建/Pack/输入/环境身份、命令及退出码、通过/失败/跳过/未跑、耗时、Host/窗口启动数、模型调用与 Site 作业数、材料 hash 和原断言去向。每个本地提交立即推送并核对远端 SHA。

## 不在范围内

不修改 prototype，不复制第二个模型驱动器，不把准备工作或已提交代码当作完整研究验收。

## 回滚

发现交接缺口时保留集成基线和事实，重开相应依赖；任何回退先核对新旧 Ledger/Pack/资产兼容，不删除客户材料。
