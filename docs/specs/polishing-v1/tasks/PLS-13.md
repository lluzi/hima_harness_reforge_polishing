# [PLS-13] 分开方法身份与运行资产并保护 Pack 更新

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-07
Blocked by: #9

## 目标与开工条件

PLS-08 已核对上游 release/安装身份，若未交接则此任务不可进入实现。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/packs.ts` | loadPack / Pack identity 与 release 文件边界 |
| `packages/desktop/src/local-site.ts` | seedLocalSite 中 rm(packDir)/cp 更新 |
| `packages/desktop/src/hima-home.ts` | prepareHimaHome 现有安装职责 |
| `packages/harness/src/workspace.ts` | workspaceFile / PreparationIdentity |
| `packages/harness/src/ledger.ts` | Run/Workspace 记录的方法身份 |

## 修改内容

1. 复用上游已实现的 release 身份；明确哪些文件属于不可变参考方法，哪些是客户运行资产。加入新资产不能悄悄改变方法身份。
2. 本规格将运行资产固定在已安装 Pack 的 run-assets/<runId>/；若快照已有同义且满足要求的位置，由本任务记录唯一兼容映射再更新规格，不能同时维护第二归档树。
3. 修正 local seeding 和 Pack 更新的覆盖策略：仅替换版本声明中的方法文件，保留客户资产；无法验证归属/半更新目录时拒绝覆盖并说明。
4. 保护目录穿越和符号链接边界；对外方法发布使用显式方法文件清单，不依赖“整个目录复制后再删敏感文件”。

## 验收标准

- [ ] 在 installed Pack 放置真实归档样本，连续 seed/更新后字节与 hash 不变；原代码 rm/cp 导致该样本丢失的反例先在隔离 home 复现。
- [ ] 方法内容改变时版本/内容身份改变；仅添加 run-assets 时保持原方法身份。
- [ ] 中断更新、同版本不同内容、未知文件及越界 symlink 的行为明确，不能误删客户文件。
- [ ] 旧 Run 仍能定位原方法身份，不能因安装了新版本而用新代码解释旧实验。

## 分级测试

- L0/L1：文件集合与身份边界。
- L2：真实临时目录的 seeding、更新、冲突、中断和越界；不用 EDA 或模型。
- L3：本任务只改安装文件逻辑时不需要全流程；若启动/错误界面改变，保留一次对应 desktop 检查。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不建知识服务/索引，不静默给旧方法补造不存在的内容身份，不覆盖源码 Pack 或 prototype。

## 回滚

保留原方法与更新前 manifest；回退安装逻辑不得回到会删除新资产的路径，必要时禁用旧 seeding 并明确报错。
