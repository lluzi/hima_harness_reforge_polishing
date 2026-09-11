# [PLS-01] 本地测试不加载真实 Site 用例

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-01
Blocked by: none

## 目标与开工条件

可立即开始；本任务不连接真实 Site。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `test/contract/pack.test.ts` | probeSite / 真实 Site describe 与本地 Pack 用例 |
| `test/contract/ssh.test.ts` | probeSite / SSH 集成 describe 与静态配置用例 |
| `test/contract/support/site.ts` | 保持本地与 reference Site 安装辅助函数职责 |
| `test/contract/support/tmux.ts` | 核对测试拥有的 session/socket 清理范围 |

## 修改内容

1. 逐例清点现有 29 个 contract 文件的资源需求、断言和清理副作用；同一文件混合多种成本时不能仅按文件名分类。
2. 将两个混合文件中的真实 Site 测试及其专属探测/清理代码移入显式 live Site 文件；保留本地配置、schema、路径与 Pack 检查断言。可以增加测试文件，不新增测试框架。
3. 明确列出本地、桌面、真实 Site 的文件归属及受支持入口；live 初始化只能在显式选择 live 组后发生。

## 验收标准

- [ ] 在没有 SSH 凭据或不可达 Site 的环境中，本地组仍能加载、完成；使用仅观察子进程的测试期 fail-fast ssh 哨兵验证没有 SSH 启动尝试，不能只证明网络碰巧失败。
- [ ] 每条原断言记录原位置、新位置和层级；缺少 fixture、未选择 live、真实依赖不可用分别记录，不能计为通过。
- [ ] 所有清理只作用于测试拥有的临时 home/workspace/session/socket；不得删除共享 SSH 控制连接。
- [ ] 新增未归类测试文件会被入口校验发现，不能静默失去覆盖。

## 分级测试

- L0：测试文件类型检查及入口清单检查。
- L1/L2：完整运行拆分后的本地用例，核对前后断言及结果；测试期进程哨兵只用于验证边界，不替代生产 Channel。
- L3：无需运行，本任务不改变窗口行为。
- L4 Site：本轮只迁移文件时不自动实跑；对应 live 用例保持未验证，后续执行前先核对 Site 与清理范围。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不改生产 Pack/Channel/Fabric，不以一次全量桌面运行代替分类，不触发远程作业。

## 回滚

恢复测试拆分及清单；保留迁移前对账。
