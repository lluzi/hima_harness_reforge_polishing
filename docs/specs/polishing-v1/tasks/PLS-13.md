# [PLS-13] 分开方法身份与运行资产并保护 Pack 更新

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-07
Blocked by: [PLS-20 / #23](https://github.com/lluzi/hima_harness_reforge_polishing/issues/23)

## 目标与开工条件

PLS-20 已接收并核对 release/安装模块后可实施；不再依赖尚需正式 probe 的 PLS-08，以免形成发布与交接循环依赖。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/pack-folder.ts` | snapshotPackFolder / packDigestExcludes / 方法与资产唯一文件集合 |
| `packages/harness/src/release.ts` | releasePack / releaseIssue 与方法身份、旧 seal 兼容 |
| `packages/harness/src/packs.ts` | loadPack / Pack identity 与 release 文件边界 |
| `packages/desktop/src/local-site.ts` | seedLocalSite 中 rm(packDir)/cp 更新 |
| `packages/desktop/src/hima-home.ts` | prepareHimaHome 现有安装职责 |
| `packages/harness/src/workspace.ts` | workspaceFile / PreparationIdentity |
| `packages/harness/src/ledger.ts` | Run/Workspace 记录的方法身份 |

## 修改内容

1. 统一 Run packDigest、loader/check、test record、release seal、安装更新使用的文件集合；上游当前只排除五个 pipeline record，需显式处理 run-assets，而不能只改一个消费者。复用上游已实现的 release 身份；明确哪些文件属于不可变参考方法，哪些是客户运行资产。加入新资产不能悄悄改变方法身份。
2. 本规格将运行资产固定在已安装 Pack 的 run-assets/<runId>/；若快照已有同义且满足要求的位置，由本任务记录唯一兼容映射再更新规格，不能同时维护第二归档树。
3. 修正 local seeding 和 Pack 更新的覆盖策略：仅替换版本声明中的方法文件，保留客户资产；无法验证归属/半更新目录时拒绝覆盖并说明。
4. 保护目录穿越和符号链接边界；对外方法发布使用显式方法文件清单，不依赖“整个目录复制后再删敏感文件”。

## 验收标准

- [x] 在 installed Pack 放置真实归档样本，连续 seed/更新后字节与 hash 不变；原代码 rm/cp 导致该样本丢失的反例先在隔离 home 复现。
- [x] 方法内容改变时版本/内容身份改变；仅添加 run-assets 时保持原方法身份。
- [x] 中断更新、同版本不同内容、未知文件及越界 symlink 的行为明确，不能误删客户文件。
- [x] 旧 Run 仍能定位原方法身份，不能因安装了新版本而用新代码解释旧实验。

## 分级测试

- L0/L1：文件集合与身份边界。
- L2：真实临时目录的 seeding、更新、冲突、中断和越界；不用 EDA 或模型。
- L3：本任务只改安装文件逻辑时不需要全流程；若启动/错误界面改变，保留一次对应 desktop 检查。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 本轮验收证据

状态：本轮实现与验收已完成。完整 local 377/377、安装态作者只读终检11/11通过；原始模型 finalization 的属性顺序比较失败记录保留，闭环由实际模型执行/发布事实和独立只读终检共同确认。详见[本批验收](../../../assessment/2026-09-12/pls-next/README.md)。

[方法与运行资产](../../../assessment/2026-09-12/pls-13/README.md)保存旧 seeding 实际删掉隔离归档样本的反例，以及连续 seed/更新后同字节/hash、方法-only 导出、同版本冲突、未知文件/目录、symlink 和中断更新矩阵。样本是通过真实文件系统写入的合成报告，不是客户研究成果。

[发布文件清单](../../../assessment/2026-09-12/pls-13/publication-fix/README.md)与[历史方法标签](../../../assessment/2026-09-12/pls-13/historical-words/README.md)覆盖 release/test/安装和旧 Run 消费者；[整合验收](../../../assessment/2026-09-12/pls-next/README.md)记录最终回归与独立审查。`run-assets/<runId>/` 已与方法身份隔离并受更新保护，自动知识归档写入由 PLS-14 实施。保留 Pack 方法不等于冻结 Harness、Site、整个工作区与外部工具环境。

## 不在范围内

不建知识服务/索引，不静默给旧方法补造不存在的内容身份，不覆盖源码 Pack 或 prototype。

## 回滚

保留原方法与更新前 manifest；回退安装逻辑不得回到会删除新资产的路径，必要时禁用旧 seeding 并明确报错。
