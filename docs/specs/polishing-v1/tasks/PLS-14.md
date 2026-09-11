# [PLS-14] 把 Campaign 知识材料可靠归档到 Pack 内

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-07
Blocked by: #8, #14

## 目标与开工条件

归档路径及方法身份确定；在既有 Experience 职责内实现。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/experience.ts` | writeExperience / readExperience / 欠交付重试 |
| `packages/harness/src/experience-report.ts` | 报告 schema 与材料 manifest |
| `packages/harness/src/ledger.ts` | 归档完成/失败和文件内容身份 |
| `packages/harness/src/recovery.ts` | 既有重启 reconciliation 补交付 |
| `packages/harness/src/remote.ts` | ExperienceView 和材料读取 |
| `packages/harness/src/packs.ts` | 已安装 Pack 资产定位 |

## 修改内容

1. 保留 Site 原报告，将报告、必要数据/环境声明、算法脚本和支持材料归档至对应 installed Pack 的固定运行目录；不把仓库源码 Pack 当运行写入目录。
2. 每项材料记录来源、大小、hash、必要性、方法/Run 身份与缺失原因。必需材料不能仅用一个将来可能消失的远程路径替代。
3. 先写同目录暂存材料并验证，再发布完成 manifest 并追加 Ledger 完成记录；断电/进程中断后可重试，重复同内容幂等，不同内容不能静默覆盖。
4. 区分 Run 执行结束和资产交付状态；失败保留已有证据，通过已有恢复入口补齐，不引入另一个后台归档服务。

## 验收标准

- [ ] 成功、负结果、预算结束、取消各有资产或明确的缺失/无法交付说明。
- [ ] 没有 workspace 的早期失败仍可在 Pack 中保留本地已有事实与缺失说明，不伪造不存在的 Site 文件。
- [ ] 一半文件写完中断、manifest 前后中断、目录只读、文件被篡改、源丢失、重复调用均不出现假的 complete。
- [ ] 恢复后完整材料 hash 可验证，核心算法可离线阅读；未获授权的 Site 文件不被归档。

## 分级测试

- L0/L1：manifest/schema 与必要材料完整性。
- L2：真实 Host、临时文件和受控传输，注入中断/错误，验证恢复与幂等。
- L3：一个报告与材料可打开的路径；文件故障矩阵不走 desktop。
- L4 Site：若新增远程传输/读取行为，使用一份有预算的真实材料验证；不跑完整 EDA。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不复制全部 EDA workspace，不自动上传外部知识库，不用“尽力写入”冒充完整资产。

## 回滚

禁用新归档触发仍保留所有 run-assets 和 manifest；历史读取保持兼容。
