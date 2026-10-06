---
status: accepted
---

# DBOS 承担新 Run 的持久执行与机械推进

用户于 2026-10-03 在本地可靠工作流调研后指定 DBOS：工程结果已由 Reader 验证且会话已释放，
仍可能因为 owner 少一次 completion 而无法接续，说明交接职责不能继续依赖逐节点机械调用。
因此新 Run 的推进、持久执行和恢复统一交给本地 DBOS，HimaFabric 保留 Pack、Site/Permit、
预算、业务验收、事实及展示适配；Campaign Agent 保持唯一业务 owner，Guide 继续独立。
这是已接受的责任与迁移目标，合同实现不构成 DBOS、App 或 ATCS 产品资格。

本决定替代 ADR-0008 中 owner 负责机械 begin/work/complete 的分工，以及 ADR-0016 中由
autopilot 承担新 Run 推进的机制；保留两者的业务所有权、真实并行、分支暂停与总预算约束。
ADR-0014 的 Guide 独立、ADR-0015 的关闭窗口/退出区别和 ADR-0017 的完整驻场工程责任
继续适用。ADR-0001 的架构纪律仅为本轮 DBOS 和私有本地数据库作明确例外。

## 合同与事实边界

命令、内部模型程序和完整工程 Agent 共用一项任务协议；方法由 task、sequence、choice、
parallel、repeat 的版本化数据组合表达。动态片段使用同一语义，在声明位置冻结并返回；
自由度由方法决定，不分严格/宽松模式。Pack 声明 JSON Schema 2020-12 输入/输出与明确
binding，Runtime 冻结 Run/task/effect、input/Pack/IR digest 和执行/adapter 版本。
平台封装身份，生产者返回业务值、产物引用和有来源的诊断；Reader 判断真实业务含义。
schema 不联网解析引用，不隐式转换、删除字段或补默认事实，不接受任意执行关键字。

六个有限执行投影为 pending、running、waiting、succeeded、failed、cancelled，waiting 有
结构化原因；它们不是第二套调度状态机。可消费结果须经验证、必要所属资源收束和持久提交，
随后自动接续。任务完成不等于业务 Goal 或物理签核；Goal false、负结果与 UNKNOWN 合法且
如实交付，不能由 schema 接纳或模型自述提升为 Goal met。每项拒绝都有实际正例和修正路径。

本地一个 PostgreSQL cluster 隔离 DBOS system 与 Hima application 数据库，归既有 Host
生命周期管理。DBOS 是唯一推进/恢复权威；应用数据库仅保存业务身份、控制、外部 effect、
验证结果、artifact 引用及 outbox，Ledger 按稳定 fact ID 幂等投影历史，不驱动新 Run。
提交与控制用公开 datasource 事务；不写 SDK 私表、不复制其调度表。实际外部提交前核对
当前控制/预算/Permit；恢复核对原 effect 身份，不把 checkpoint 或取消请求当作远端效果证明。

## 迁移与取舍

App、编排和数据在 macOS/Linux 本地运行，保留已有获准模型 API；不依赖 DBOS Cloud、
Conductor 或厂商激活。产品承担私有 PostgreSQL 安装、启动、退出、故障、备份和升级，
数据库故障明确阻塞，不回退旧 Fabric。代价是原生数据库分发、版本绑定与平台独立验证。
首轮固定 DBOS SDK / node-pg-datasource 5.2.11、PostgreSQL 16.15、Node24 与 Ajv 8.20.0，执行版本随冻结候选记录。

所有新 Run 使用 DBOS，受支持旧 Pack 声明经兼容编译使用同一内核；旧 Run、方法快照、
产物 hash 和原结论保持可读。活动/可恢复旧 Run 先由旧 App 正常收束，不热转换 checkpoint，
新版不启动旧 recovery/dispatcher。备份及恢复保存原版本与完整资源引用；恢复须核对备份后
新增决定/效果，缺证据保持 hold。升级不以相同执行版本掩盖调用顺序改变。

保留 owner 手工交接或扩大 autopilot 会延续双重执行责任，未选择；Temporal 等其他持久
引擎经调研后由用户明确选择 DBOS，不并存第二调度器。实际迁移、故障矩阵、两平台分发、
新版正常产品路径和当前 ATCS 真修复分别验证；历史结果与接回资格不替代验收。
计划与范围：[DBOS Fabric / ATCS migration](../plans/2026-10-03-0701-refactor-dbos-fabric-atcs-migration-plan.md)。
