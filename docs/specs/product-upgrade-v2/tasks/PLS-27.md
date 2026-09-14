# [PLS-27] 让 HimaGuide 从产品上下文回答自身能力

状态：ready-for-agent
父规格：[Product Upgrade v2](../spec.md)
模型：`gpt-5.6-terra` / medium
最低测试：L0 + 定点 L2；prompt 通过后一次小型 L4 DeepSeek

## 用户场景

用户第一次打开 HimaHarness，直接问“你是什么、能做什么、有哪些 Pack”。HimaGuide 应从产品定义和当前安装 inventory 回答，不扫描源码或猜测文件位置。

## 当前证据

- `packages/harness/src/index.ts` 的 `Hima.static inject` 只有 storage/commands/tools/skills，尚未使用 DSH `systemPrompt` seam。
- `index.ts[Service.init]` 已能通过 `installedPacks()`、`installedSites()`、Ledger 和 package version 取得所需事实。
- `packages/harness/src/commands.ts:himaCommandDescription` 仍含旧的 Fabric 自动执行叙述。
- `profiles/hima/cordis.patch.yml` 已复用 dsh-base，不需要新增 persona 或 Agent Loop。

## 固定代码范围

- `packages/harness/src/index.ts`：`Hima.static inject`、`Hima[Service.init]`。
- `packages/harness/src/commands.ts`：`himaCommandDescription`、`versionLine`。
- `profiles/hima/cordis.patch.yml`：仅在现有 prompt composition 必须显式配置时修改。
- `test/contract/product-context.host.test.ts`：新增定点 Host 测试。
- `test/contract/agent-desktop-replay.host.test.ts`：仅复用已有 Agent/replay 先例，不扩大为 Desktop 测试。

## 精确增量

1. 在现有 Hima plugin 中注入 DSH `systemPrompt`，注册一个简短静态 section：产品身份、Campaign/HimaPack/Site/HimaGuide/Campaign Agent/Fabric 的职责和普通 Coding 能力。
2. 注册一个小型动态 context，只包含产品/Harness 版本、已安装 Pack id/status、已保存 Site 名称和活动 Campaign 摘要；空集合明确说空并给行动，不包含 Home、YAML、内部路径或 Run ID。
3. 上下文按实际 inventory 每次组装，安装 Pack/Site 后无需重启或源码扫描即可更新。
4. 修正 `/hima` 说明，使 Campaign Agent 主导业务节点、Fabric 提供约束和事实。
5. 保持 isolated Model moment 的 complete prompt，不向其注入普通产品 persona。

## 保持项

- 继续使用 DSH 根 Agent、system prompt registry 和 Agent Loop。
- 不新增 HimaGuide Agent 类型、FAQ 服务、向量检索或首页状态存储。
- 不读取客户材料或把 inventory 写入模型系统提示以外的第二事实源。

## 验收标准

- 空 Home 和已有 Pack/Site 两种 Host 均组装出准确、短小的 Hima context。
- replay Agent 对三类产品问题直接回答，工具轨迹中没有 fs、grep、glob、bash、web 或源码读取。
- 安装 inventory 变化后下一次组装反映新状态。
- Model moment 的 tool/prompt 隔离测试保持通过。
- 文案不宣称 Pack/Site ready、Fmax 提升或当前未验证能力。

## 测试

- L0：`pnpm run check:seams`、`pnpm run build`、`pnpm run typecheck`。
- L2：`pnpm run test:local --files test/contract/product-context.host.test.ts test/contract/moment.host.test.ts test/contract/command.test.ts`。
- L4：机制稳定后用 DeepSeek V4 Flash 只问一次产品身份/Pack 问题，记录输入 token、工具调用和回答；不启动 Campaign、Desktop 或 EDA。

## 并行与回滚

本任务拥有 `index.ts` 的第一轮 prompt 改动；PLS-31/32 的共享接线随后由主集成者完成。回滚为删除 Hima prompt registrations并恢复命令说明，不影响 Ledger、Pack、Site 或 Run 数据。
