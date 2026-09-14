# [PLS-29] 从 SSH 发现并保存 safe Site profile

状态：ready-for-agent
父规格：[Product Upgrade v2 / #30](https://github.com/lluzi/hima_harness_reforge_polishing/issues/30)
Issue：[PLS-29 / #33](https://github.com/lluzi/hima_harness_reforge_polishing/issues/33)
模型：`gpt-5.6-terra` / medium；Permit/凭据边界由 `gpt-5.6-sol` / high 复核
最低测试：L0 + L1/L2；稳定后一次 L4 SSH

## 用户场景

用户只提供 SSH 地址、账号、可选 jump host 和少量说明。HimaGuide 像工程师一样使用现有系统权限发现环境，保存可修改的 safe Site profile，不要求用户编写 YAML。

## 当前证据

- `packages/harness/src/sites.ts` 已有 `siteSchema`、`permitSchema`、`loadSite`、`installedSites`。
- `packages/harness/src/channel.ts:SshChannel` 已支持 destination、jump chain、warm control socket 和审计。
- `readOnlyProbes` 当前只有 `cat`/`realpath`，不足以发现 OS、工具、tmux、资源和版本。
- `shell.ts` 与 Site Permit 已负责 read/write root、wrapper 和删除红线；DSH permission preset 不能替代它。

## 固定代码范围

- `packages/harness/src/sites.ts`：兼容现有 schema，增加 discovery facts、staleness 和 profile save/import。
- `packages/harness/src/channel.ts`：`SshChannel`、`readOnlyProbes`、审计；只增加固定 argv 的安全 probe。
- `packages/harness/src/shell.ts`：只在现有 Permit 判定需要接收 discovery 结果时修改。
- `packages/desktop/src/hima-home.ts`：仅确保现有 `hima/sites` 位置被准备，不写私有 Site。
- `test/contract/site-name.test.ts`、`ssh.test.ts`、`ssh.live.test.ts`；新增 `site-discovery.test.ts`。

## 精确增量

1. 定义一个非 Campaign 的 Site discovery request/result，输入为名称、SSH target/jumps 和可选提示，输出为可保存的现有 Site 数据加 observed facts/observedAt/unknowns。
2. 通过 `SshChannel` 执行固定、可审计的直接命令，发现主机/OS、tmux、当前支持工具栈的命令与版本、可用目录、基础资源和最小 licence/tool probe；不运行无界 shell、递归全盘扫描或批量 EDA。
3. 复用 OpenSSH config、keys 和 agent。Site profile 不保存 password、token、private key 或模型 secret；用户选择保存的 secret 仍由 DSH credentials provider 管理。
4. 自动保存或更新 `sitesDir/<name>.yml` 与 Permit，向上层返回摘要、未知和冲突；多个合理路径/工具时不猜业务选择。
5. 输入、工具或事实变化时标记旧 discovery stale；旧 Campaign 仍保留其使用过的身份。
6. 第二 Site 必须重新发现，不能复制第一 Site YAML 作为通过证据。

## 保持项

- 继续使用 `Site`、`Permit`、`SshChannel` 和现有 Channel audit，不新增远程执行层。
- Full DSH 权限不绕过 Site Permit；Hima Channel 没有 `rm`。
- 系统账号/目录权限决定实际读取能力，不叠加逐目录用户审批。

## 验收标准

- 最小 SSH 输入生成结构化 draft；未知事实明确保留。
- 保存后 `loadSite`/`installedSites` 可读取，同一 Pack check 使用同一 profile。
- 凭据从未进入 Site/Permit、日志、tool result 或 fixture。
- 不可达、命令缺失、版本不识别、多个候选和 stale update 分别可行动。
- discovery audit 只包含允许的固定 probe，无写入、删除或 Campaign Job。
- 一次真实 SSH L4 在现有用户权限下发现当前 Site 并完成最小工具 probe；失败不算 PASS。

## 测试

- L0：build/typecheck/boundary。
- L1/L2：`pnpm run test:local --files test/contract/site-discovery.test.ts test/contract/site-name.test.ts test/contract/ssh.test.ts test/contract/pack.test.ts`。
- L4：`pnpm run test:live:site --files test/contract/ssh.live.test.ts` 的定点 discovery 场景；不运行完整 EDA Campaign。

## 并行与回滚

本任务独占 `sites.ts`、`channel.ts` 和 discovery 测试。PLS-31 只通过结构化结果接线。新增 Site 字段保持可选；回滚代码不删除已保存 profile，旧 loader 应忽略或明确迁移新字段。
