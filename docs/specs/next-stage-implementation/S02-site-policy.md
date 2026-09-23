# S02 — Site 再发现保留管理员政策

覆盖：NXT-A2。基线：`1a79cb1`。状态：规格可派工，无实现/测试运行。

## Problem Statement

工程师重新探测服务器是为了更新能力事实，不是清空绑定、许可证和管理员访问限制。当前保存发现结果会重建 Site/Permit，可能丢失手工配置。

## Solution

升级现有 discover/save 路径：区分探测事实与政策，保留已有政策，对实际改变给出 diff 并精确提交；不引入 Site 管理服务。

## User Stories

1. 作为管理员，我希望再发现后许可证配额保持，从而不超卖授权资源。
2. 作为工程师，我希望 workspace/bindings 保留，从而旧 Pack 仍能找到输入。
3. 作为管理员，我希望 Permit 原路径和规则保留，从而探测不会扩大权限。
4. 作为工程师，我希望看到新发现和旧政策冲突，从而能联系正确的人处理。
5. 作为管理员，我希望明确批准一个差异后只改变该差异，从而更新可审查。
6. 作为工程师，我希望保存前有人改配置时被提示刷新，从而不覆盖其修改。
7. 作为工程师，我希望探测失败保留旧可读配置，从而可以诊断和回退。
8. 作为管理员，我希望日志不含凭据，从而能安全共享诊断材料。

## Implementation Decisions

| 现有文件 / 符号 | 当前证据与升级 |
| --- | --- |
| `packages/harness/src/sites.ts` / `discoverSshSite`, `saveDiscoveredSite` | save 重建 `<name>.permit.yml`、重写 Site；改为读取既有 Site/Permit、保留管理员字段并产生需审阅差异 |
| 同文件 / `siteSchema`, `permitSchema`, `loadSite`, `discoveryIsStale` | 沿用同一模型，discovery 仍是事实；capacity/licences、bindings、workspaceRoot、permit 引用及规则属于政策 |
| `packages/harness/src/channel.ts` / `discoverSiteFacts` | 只读能力探测保留，不将工具存在转换为执行授权 |
| `packages/harness/src/remote.ts` / Site discover/save 路由 | 复用接口加入当前配置身份、reviewed diff 与陈旧拒绝；集成者接线 |
| `packages/harness/src/client/ConfigurationPage.tsx` | diff/冲突/Retry 渲染交由 S08，不由本规格新增第二设置页 |

输入为发现事实、Site 身份、既有配置内容身份；输出为保存后的 Site 或带原因的 conflict。首次发现沿用原路径；更新必须验证预览时读到的 Site 和实际 Permit 字节没有变化。只更 discovery 时不写 Permit；政策变更只能是用户明确选择的字段，不能从探测结果隐式推导。

对两个文件的修改，先验证双方可写与输入身份、保留原字节；提交失败时不把半写状态当成功。优先避免不必要双文件写，确需双写时在现有保存函数内恢复一致状态，不建通用事务服务。未知原字段不能静默丢弃：解析不支持即拒绝保存并说明。

### 切片与并行

S02a：对已有 Site 复现丢字段，补纯文件正反例；S02b：save 差异提交与 Host 回执；S02c：S08 接 UI。`sites.ts/channel.ts` 的发现部分由 S02 拥有，S09 的 Channel 交互变更待 S02 合入再接线。可与 S01、S04 内容、S10 作者材料并行，不要求真实 SSH。

## Testing Decisions

主 seam 是真实文件上的 `saveDiscoveredSite/loadSite` 与 Host Site 路由。既有 `test/contract/site-discovery.test.ts`、`site-surface.host.test.ts`；关键 UI 用 `site-rediscover.desktop.test.ts`。正例：自定义 Permit 文件、许可证 0、多个 bindings 再发现后逐项保留。反例：配置在预览后变化、解析未知政策、保存失败、探测空值均不得拓宽政策或报告成功；原 Site 继续可读取。

实现后最低：`pnpm run build`；`pnpm run test:local --files test/contract/site-discovery.test.ts test/contract/site-surface.host.test.ts`。UI 接线后选择既有 L3 分组用例，禁止为此自动运行真实 EDA。

## Out of Scope

凭据管理平台、自动扩大 Permit、站点资源调度重写、客户全局配置迁移。

## Further Notes

无业务依赖，可先开发；公共 Host/UI 文件按主索引所有权接线。保留旧 Site/Permit 字节及身份作为回滚，切片可单独 revert。实现 Terra/Medium，权限复核 Sol/High。
