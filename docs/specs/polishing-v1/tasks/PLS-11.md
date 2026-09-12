# [PLS-11] 回溯时保留历史并只重跑受影响的下游

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-06
Blocked by: [PLS-10 / #11](https://github.com/lluzi/hima_harness_reforge_polishing/issues/11)

## 目标与开工条件

PLS-10 接纳与方法身份已明确，并沿用其前置 PLS-19 的 Agent 节点执行协议；运行不支持的图形必须先拒绝。修订/回溯由同一个对话执行 Agent 组织，恢复逻辑不能在 Agent 缺席时自动进入旧 `drive`。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/workspace.ts` | prepareWorkspace 与执行材料版本 |
| `packages/harness/src/ledger.ts` | 输入/代码身份、替代关系与有效性记录 |
| `packages/harness/src/fabric.ts` | resumeRun / drive |
| `packages/harness/src/node-turns.ts` | observeNode / judgeNode / exploreNode 的输入选择 |
| `packages/harness/src/recovery.ts` | reconcileRuns |
| `packages/harness/src/generations.ts` | generationsOf 的历史与当前有效结果 |

## 修改内容

1. 对已接纳的策略/算法改动计算受影响依赖闭包，记录原因；内容未变且输入/环境/方法身份仍适用的结果才能复用。
2. 旧尝试、观测与代码全部保留，通过新的记录表达替代/失效，不删除历史。为需要回退的可变代码/策略保存可重用版本，不能仅移动 currentNode。
3. 读取、Judge 和 Explore 按当前有效输入依赖选择证据，不能简单用全局 latest 把旧分支结果混进新策略。
4. 恢复继续跟踪确实还活着的 Job；不重复启动。部分产物/未完成报告不能支持推论，必要时从最近失败且可验证的节点重跑。
5. 区分恢复事实与恢复业务决策：前者由基础设施完成，后者重建所属对话 Agent 的上下文后由该 Agent 发起；在途旧模式 Run 与新 Agent 模式不得同时推进。

## 验收标准

- [ ] 以 A→B→C 和不受影响的 D 反例证明：只改 B 的代码，A/D 可复用，B/C 重跑；再改 A 输入则其全部下游失效。
- [ ] 两个分支同时生成同名报告、旧报告比新报告时间晚、文件内容被改而路径不变时，仍不会错误复用。
- [ ] 在代码保存、失效记录、Job 启动、观测追加各边界中断后，可依据真实记录恢复，已运行的重复效应受到防护。
- [ ] 报告同时可查看历史与本轮有效结果，失效历史不会被删除或作为当前最佳结果。

## 分级测试

- L0/L1：依赖闭包及内容身份比较的独立反例。
- L2：真实 Ledger/文件/local tmux、跨 Host 重启、分支隔离与残缺产物矩阵。
- L3：一次回溯后的历史/当前对照与继续入口。
- L4 Site：实际修改远程文件恢复或 Job 语义时做最小检查；L5 验证完整研究中的再探索。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不通用快照整个 EDA 环境，不靠文件 mtime 证明有效性，不在旧 himaharness 中借回 Runtime。

## 回滚

保留所有版本与有效性记录；不支持新记录的旧代码不能继续该 Run，历史可只读。
